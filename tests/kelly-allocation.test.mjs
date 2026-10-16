import test from 'node:test';
import assert from 'node:assert/strict';
import {solveKelly,riskBudgetAllocation,kellyPolicyError} from '../assets/kelly-allocation.mjs';
import {newStructureLeg} from '../assets/trade-structure.mjs';
import {VERSION,createCase,savePlan,saveNode,setActiveAllocation,validateStore} from '../assets/workflow-model.mjs';

const stockBundle=(id,underlying,side='long')=>({id,name:`${underlying} Bundle`,construction:{structureVersion:1,template:'stock',candidate:{underlying,instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock',side,100),underlying,entry:100,underlyingPrice:100}]}});
const underwriting=(moves,probabilities=[60,0,40])=>({scenarioVersion:1,daysForward:0,scenarios:[['bull','Bull'],['base','Base'],['bear','Bear']].map(([id,name],i)=>({id,name,probability:probabilities[i],probabilityRange:0,moves:Object.fromEntries(Object.entries(moves[id]).map(([bundleId,priceMove])=>[bundleId,{priceMove,priceMoveRange:0,ivChange:'',ivChangeRange:''}]))}))});

test('single bundle Kelly matches the closed-form binary result',()=>{
 const result=solveKelly([{probability:.55,returns:[.2]},{probability:.45,returns:[-.2]}],1);
 assert.ok(Math.abs(result.fractions[0]-.5)<1e-4);
 assert.ok(result.expectedLogGrowth>0);
});

test('Kelly supplies relative Bundle weights while At-Risk supplies total account allocation',()=>{
 const bundle=stockBundle('mu','MU'),c={design:{plans:[bundle]},nodes:{returns:{data:underwriting({bull:{mu:20},base:{mu:0},bear:{mu:-20}},[55,0,45])},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5}}}};
 const result=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2});
 assert.equal(kellyPolicyError(c,c.nodes.risk.data),'');assert.equal(result.complete,true);
 assert.ok(Math.abs(result.bundles[0].fullFraction-.5)<1e-4);assert.equal(result.bundles[0].weight,1);
 assert.ok(Math.abs(result.scenarioRiskRate-.2)<1e-9);assert.ok(Math.abs(result.stopRiskRate-.05)<1e-9);assert.equal(result.bindingRisk,'scenario');
 assert.ok(Math.abs(result.allocatedFraction-.05)<1e-9);assert.ok(Math.abs(result.bundles[0].fraction-.05)<1e-9);
 assert.equal(result.bundles[0].downStopPrice,95);assert.equal(result.bundles[0].upStopPrice,105);assert.equal(result.bundles[0].adverseStopDirection,'down');
 assert.equal(Object.hasOwn(result.bundles[0],'targetCapital'),false);
});

test('ATR Stop Risk uses each Bundle independently adverse direction while Scenario Risk keeps joint moves',()=>{
 const long=stockBundle('long','LONG','long'),short=stockBundle('short','SHORT','short');
 const data=underwriting({bull:{long:10,short:-10},base:{long:0,short:0},bear:{long:-4,short:4}}),c={design:{plans:[long,short]},nodes:{returns:{data},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:2,atrStopMultiple:2.5}}}};
 const result=riskBudgetAllocation(c,c.nodes.risk.data,{LONG:2,SHORT:4});
 assert.equal(result.complete,true);assert.ok(result.bundles.every(row=>Math.abs(row.weight-.5)<1e-5));
 const [longRow,shortRow]=result.bundles;
 assert.equal(longRow.adverseStopDirection,'down');assert.equal(shortRow.adverseStopDirection,'up');
 assert.ok(Math.abs(longRow.stopRiskRate-.05)<1e-9);assert.ok(Math.abs(shortRow.stopRiskRate-.1)<1e-9);
 assert.ok(Math.abs(result.stopRiskRate-.075)<1e-6);assert.ok(Math.abs(result.scenarioRiskRate-.04)<1e-6);assert.equal(result.bindingRisk,'atr-stop');
 assert.ok(Math.abs(result.allocatedFraction-(.02/.075))<1e-5);
 const bear=result.scenarios.find(row=>row.id==='bear');assert.ok(Math.abs(bear.weightReturn+.04)<1e-6);
});

test('uncertainty is solved as one joint distribution and is reproducible',()=>{
 const bundle=stockBundle('mu','MU'),legacy=underwriting({bull:{mu:20},base:{mu:0},bear:{mu:-20}},[55,0,45]),data={...legacy,scenarioVersion:3,probabilityUncertainty:10,atrMultiple:1,ivUncertaintyRatio:''};
 const c={design:{plans:[bundle]},nodes:{returns:{data},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5}}}};
 const first=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}),repeat=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2});
 assert.equal(first.uncertaintyAware,true);assert.equal(first.monteCarlo.samples,500);assert.deepEqual(first.fractions,repeat.fractions);
 assert.equal(Object.hasOwn(first.monteCarlo,'q100'),false);
});

test('Risk Budget validates policy and requires ATR only for positive Kelly weights',()=>{
 const empty={design:{plans:[]},nodes:{returns:{data:{}},risk:{data:{allocationVersion:2}}}};
 assert.equal(riskBudgetAllocation(empty).complete,false);assert.match(riskBudgetAllocation(empty).issues.join(' '),/At-Risk/);
 assert.match(kellyPolicyError(empty,{thesisAtRiskLimitPct:2,atrStopMultiple:0}),/ATR Stop/);
 const bundle=stockBundle('mu','MU'),positive={design:{plans:[bundle]},nodes:{returns:{data:underwriting({bull:{mu:20},base:{mu:0},bear:{mu:-20}},[55,0,45])},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5}}}};
 assert.match(riskBudgetAllocation(positive,positive.nodes.risk.data,{}).constraintIssue,/缺少 ATR/);
 const cash={design:{plans:[bundle]},nodes:{returns:{data:underwriting({bull:{mu:10},base:{mu:0},bear:{mu:-20}},[20,30,50])},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5}}}};
 const result=riskBudgetAllocation(cash,cash.nodes.risk.data,{});assert.equal(result.hasPositiveKelly,false);assert.equal(result.allocatedFraction,0);assert.equal(result.constraintIssue,'');
});

test('In Action Risk Budget freezes account percentages without a capital base and roundtrips',()=>{
 const c=createCase({title:'Risk Budget snapshot'}),construction=stockBundle('unused','MU').construction;
 const id=savePlan(c,null,'',construction),moves=priceMove=>({[id]:{priceMove,priceMoveRange:0,ivChange:'',ivChangeRange:''}});
 saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:[{id:'bull',name:'Bull',probability:55,probabilityRange:0,moves:moves(20)},{id:'base',name:'Base',probability:0,probabilityRange:0,moves:moves(0)},{id:'bear',name:'Bear',probability:45,probabilityRange:0,moves:moves(-20)}]});
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5});setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));
 assert.equal(c.design.allocation.method,'risk-budget-kelly');assert.equal(c.returnBasis,undefined);assert.equal(c.design.allocation.atrStopMultiple,2.5);assert.equal(Object.hasOwn(c.design.allocation.items[0],'targetCapital'),false);
 validateStore({version:VERSION,cases:[c]});
});

test('zero Kelly allocation can be frozen as an explicit cash decision',()=>{
 const c=createCase({title:'Cash decision'}),construction=stockBundle('unused','MU').construction,id=savePlan(c,null,'',construction),moves=priceMove=>({[id]:{priceMove,priceMoveRange:0,ivChange:'',ivChangeRange:''}});
 saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:[{id:'bull',name:'Bull',probability:20,probabilityRange:0,moves:moves(10)},{id:'base',name:'Base',probability:30,probabilityRange:0,moves:moves(0)},{id:'bear',name:'Bear',probability:50,probabilityRange:0,moves:moves(-20)}]});
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5});const result=riskBudgetAllocation(c,c.nodes.risk.data,{});assert.equal(result.allocatedFraction,0);setActiveAllocation(c,result);
 assert.equal(c.design.allocation.inAction,true);assert.equal(c.design.allocation.allocatedFraction,0);assert.equal(c.design.allocation.cashFraction,1);assert.match(c.events.at(-1).reason,/保持现金/);
});
