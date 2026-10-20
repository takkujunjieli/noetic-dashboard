import test from 'node:test';
import assert from 'node:assert/strict';
import {solveKelly,riskBudgetAllocation,kellyPolicyError,diversifiedRiskWeights,atrStopProfile,RISK_WEIGHTING_METHOD,SIZING_METHOD,fractionalKellyCap} from '../assets/kelly-allocation.mjs';
import {kellyAllocationView,kellyPolicyForm,readKellyPolicy} from '../assets/kelly-allocation.js';
import {newStructureLeg} from '../assets/trade-structure.mjs';
import {VERSION,createCase,savePlan,saveNode,setActiveAllocation,validateStore} from '../assets/workflow-model.mjs';

const stockBundle=(id,underlying,side='long')=>({id,name:`${underlying} Bundle`,construction:{structureVersion:1,template:'stock',candidate:{underlying,instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock',side,100),underlying,entry:100,underlyingPrice:100}]}});
const underwriting=(moves,probabilities=[60,0,40])=>({scenarioVersion:1,daysForward:0,scenarios:[['bull','Bull'],['base','Base'],['bear','Bear']].map(([id,name],i)=>({id,name,probability:probabilities[i],probabilityRange:0,moves:Object.fromEntries(Object.entries(moves[id]).map(([bundleId,priceMove])=>[bundleId,{priceMove,priceMoveRange:0,ivChange:'',ivChangeRange:''}]))}))});

test('single bundle Kelly matches the closed-form binary result',()=>{
 const result=solveKelly([{probability:.55,returns:[.2]},{probability:.45,returns:[-.2]}],1);
 assert.ok(Math.abs(result.fractions[0]-.5)<1e-4);
 assert.ok(result.expectedLogGrowth>0);
});

test('At-Risk caps the target when tighter than Half Kelly',()=>{
 const bundle=stockBundle('mu','MU'),c={design:{plans:[bundle]},nodes:{returns:{data:underwriting({bull:{mu:20},base:{mu:0},bear:{mu:-20}},[55,0,45])},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5}}}};
 const result=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2});
 assert.equal(kellyPolicyError(c,c.nodes.risk.data),'');assert.equal(result.complete,true);
 assert.ok(Math.abs(result.bundles[0].fullFraction-.5)<1e-4);assert.equal(result.bundles[0].weight,1);
 assert.ok(Math.abs(result.scenarioRiskRate-.2)<1e-9);assert.ok(Math.abs(result.stopRiskRate-.05)<1e-9);assert.equal(result.bindingRisk,'scenario');
 assert.ok(Math.abs(result.allocatedFraction-.05)<1e-9);assert.ok(Math.abs(result.bundles[0].fraction-.05)<1e-9);
 assert.equal(result.bundles[0].downStopPrice,95);assert.equal(result.bundles[0].upStopPrice,105);assert.equal(result.bundles[0].adverseStopDirection,'down');
 assert.equal(Object.hasOwn(result.bundles[0],'targetCapital'),false);
});

test('Half Kelly retains cash even when the At-Risk budget allows a larger investment',()=>{
 const bundle=stockBundle('mu','MU'),c={design:{plans:[bundle]},nodes:{returns:{data:underwriting({bull:{mu:20},base:{mu:0},bear:{mu:-20}},[55,0,45])},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:10,atrStopMultiple:2.5}}}};
 const result=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2});
 assert.ok(Math.abs(result.halfKellyCap-.25)<1e-10);assert.equal(result.atRiskCap,.5);
 assert.equal(result.limitingConstraint,'half-kelly');assert.equal(result.sizingMethod,SIZING_METHOD);
 assert.ok(Math.abs(result.allocatedFraction-.25)<1e-10);assert.ok(Math.abs(result.cashFraction-.75)<1e-10);
 const html=kellyAllocationView(c,c.nodes.risk.data,{atr:{MU:2}});
 assert.match(html,/Half Kelly Cap/);assert.match(html,/Nebula Target %/);assert.doesNotMatch(html,/Full Kelly/);
});

test('cash sizing is solved along the diversified mix, not by renormalizing Kelly fractions',()=>{
 const scenarios=[{probability:.55,returns:[.3,.1]},{probability:.45,returns:[-.3,-.1]}];
 assert.ok(Math.abs(fractionalKellyCap(scenarios,[.5,.5])-.25)<1e-10);
 assert.equal(fractionalKellyCap([{probability:1,returns:[-.1]}],[1]),0);
 assert.equal(fractionalKellyCap([{probability:1,returns:[.1]}],[1]),.5);
 assert.ok(Number.isFinite(fractionalKellyCap([{probability:.8,returns:[.2]},{probability:.2,returns:[-2]}],[1])));
});

test('ATR Stop Risk uses each Bundle independently adverse direction while Scenario Risk keeps joint moves',()=>{
 const long=stockBundle('long','LONG','long'),short=stockBundle('short','SHORT','short');
 const data=underwriting({bull:{long:10,short:-10},base:{long:0,short:0},bear:{long:-4,short:4}}),c={design:{plans:[long,short]},nodes:{returns:{data},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:2,atrStopMultiple:2.5}}}};
 const result=riskBudgetAllocation(c,c.nodes.risk.data,{LONG:2,SHORT:4});
 assert.equal(result.complete,true);assert.ok(Math.abs(result.weights[0]-22/35)<1e-5);assert.ok(Math.abs(result.weights[1]-13/35)<1e-5);
 const [longRow,shortRow]=result.bundles;
 assert.equal(longRow.adverseStopDirection,'down');assert.equal(shortRow.adverseStopDirection,'up');
 assert.ok(Math.abs(longRow.stopRiskRate-.05)<1e-9);assert.ok(Math.abs(shortRow.stopRiskRate-.1)<1e-9);
 const mixedStop=22/35*.05+13/35*.1;
 assert.ok(Math.abs(result.stopRiskRate-mixedStop)<1e-6);assert.ok(Math.abs(result.scenarioRiskRate-.04)<1e-6);assert.equal(result.bindingRisk,'atr-stop');
 assert.ok(Math.abs(result.allocatedFraction-(.02/mixedStop))<1e-5);
 const bear=result.scenarios.find(row=>row.id==='bear');assert.ok(Math.abs(bear.weightReturn+.04)<1e-6);
});

test('uncertainty is solved as one joint distribution and is reproducible',()=>{
 const bundle=stockBundle('mu','MU'),legacy=underwriting({bull:{mu:20},base:{mu:0},bear:{mu:-20}},[55,0,45]),data={...legacy,scenarioVersion:3,probabilityUncertainty:10,atrMultiple:1,ivUncertaintyRatio:''};
 const c={design:{plans:[bundle]},nodes:{returns:{data},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5}}}};
 const first=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}),repeat=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2});
 assert.equal(first.uncertaintyAware,true);assert.equal(first.monteCarlo.samples,500);assert.deepEqual(first.fractions,repeat.fractions);
 assert.equal(Object.hasOwn(first.monteCarlo,'q100'),false);
});

test('Risk Budget validates policy and requires candidate ATR when allocating, preserving explicit cash',()=>{
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
 assert.equal(c.design.allocation.weightingMethod,RISK_WEIGHTING_METHOD);assert.equal(c.design.allocation.kellyTiltPct,25);
 assert.equal(c.design.allocation.items[0].baselineRiskShare,1);assert.equal(c.design.allocation.items[0].riskShare,1);
 validateStore({version:VERSION,cases:[c]});
});

const approx=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const riskCase=(plans,bull,bear,tilt=25)=>({design:{plans},nodes:{returns:{data:underwriting({bull,base:bull,bear})},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:2,atrStopMultiple:2.5,kellyTiltPct:tilt}}}});
const optionBundle=(id,type='call',side='long')=>({id,name:id,construction:{structureVersion:1,greekScale:10000,candidate:{underlying:id,referenceCapital:1000},legs:[{...newStructureLeg(type,side,1),underlying:id,entry:10,underlyingPrice:100,strike:100,expiry:'2030-01-01',delta:5000,gamma:100,theta:100,vega:100,iv:30}]}});

test('risk mixing bounds a winner at 50% for three underlyings and converts to capital',()=>{
 const rows=[{underlying:'A',stopRiskRate:.1},{underlying:'B',stopRiskRate:.12},{underlying:'C',stopRiskRate:.15}];
 const r=diversifiedRiskWeights(rows,[1,0,0]);
 assert.deepEqual(r.riskShares,[.5,.25,.25]);
 r.weights.forEach((w,i)=>approx(w,[4/7,5/21,4/21][i]));
 const sumRisk=rows.reduce((v,row,i)=>v+row.stopRiskRate*r.weights[i],0);
 rows.forEach((row,i)=>approx(row.stopRiskRate*r.weights[i]/sumRisk,r.riskShares[i]));
});

test('same underlying splits one baseline risk budget, independent of bundle order',()=>{
 const rows=[{underlying:'A',stopRiskRate:.1},{underlying:'A',stopRiskRate:.2},{underlying:'B',stopRiskRate:.05}];
 const r=diversifiedRiskWeights(rows,[1,0,0],0);
 assert.deepEqual(r.baselineRiskShares,[.25,.25,.5]);
 approx(r.weights[0],2/11);approx(r.weights[1],1/11);approx(r.weights[2],8/11);
 assert.deepEqual(diversifiedRiskWeights([...rows].reverse(),[0,0,1],0).weights,[...r.weights].reverse());
 const tilted=diversifiedRiskWeights(rows,[1,0,0],25);approx(tilted.riskShares[0]+tilted.riskShares[1],.625);
});

test('a dominated but positive candidate receives baseline risk instead of zero',()=>{
 const c=riskCase([stockBundle('a','A'),stockBundle('b','B')],{a:20,b:10},{a:-4,b:-8});
 const r=riskBudgetAllocation(c,c.nodes.risk.data,{A:2,B:4});
 assert.equal(r.constraintIssue,'');assert.equal(r.kellyFractions[1],0);
 approx(r.bundles[0].riskShare,.625);approx(r.bundles[1].riskShare,.375);
 assert.ok(r.fractions[1]>0);approx(r.allocatedFraction,Math.min(1,.02/Math.max(r.stopRiskRate,r.scenarioRiskRate)));
});

test('a nonpositive standalone candidate with zero Kelly is visibly excluded',()=>{
 const c=riskCase([stockBundle('a','A'),stockBundle('b','B')],{a:5,b:-50},{a:5,b:-50});
 const r=riskBudgetAllocation(c,c.nodes.risk.data,{A:2});
 assert.equal(r.constraintIssue,'');assert.equal(r.bundles[0].eligible,true);assert.equal(r.bundles[1].eligible,false);
 assert.match(r.bundles[1].exclusionReason,/独立预期收益非正/);assert.equal(r.bundles[1].fraction,0);assert.equal(r.bundles[1].riskShare,0);
 assert.equal(r.weights[0],1);assert.ok(r.allocatedFraction>0);
 const html=kellyAllocationView(c,c.nodes.risk.data,{atr:{A:2}});assert.match(html,/⚠ Excluded/);assert.match(html,/修改参数或从 Portfolio Construction 剔除/);
});

test('a negative standalone hedge stays eligible when joint Kelly assigns it weight',()=>{
 const c=riskCase([stockBundle('a','A'),stockBundle('b','B')],{a:50,b:-20},{a:-40,b:20});
 const r=riskBudgetAllocation(c,c.nodes.risk.data,{A:2,B:2});
 assert.ok(r.bundles[1].standaloneExpectedReturn<0);assert.ok(r.kellyFractions[1]>1e-9);assert.equal(r.bundles[1].eligible,true);assert.ok(r.bundles[1].riskShare>0);
});

test('diversified risk shares survive snapshot roundtrip and later preview changes',()=>{
 const c=createCase({title:'Diversified snapshot'}),a=savePlan(c,null,'A',stockBundle('a','A').construction),b=savePlan(c,null,'B',stockBundle('b','B').construction);
 saveNode(c,'returns',underwriting({bull:{[a]:20,[b]:10},base:{[a]:0,[b]:0},bear:{[a]:-4,[b]:-8}}));
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:2,atrStopMultiple:2.5,kellyTiltPct:0});
 const result=riskBudgetAllocation(c,c.nodes.risk.data,{A:2,B:4});setActiveAllocation(c,result);
 const saved=JSON.stringify(c.design.allocation),roundtrip=validateStore(JSON.parse(JSON.stringify({version:VERSION,cases:[c]}))).cases[0];
 assert.equal(JSON.stringify(roundtrip.design.allocation),saved);
 assert.deepEqual(roundtrip.design.allocation.items.map(x=>x.riskShare),[.5,.5]);
 result.bundles[0].riskShare=0;assert.equal(JSON.stringify(c.design.allocation),saved);
 const preview=riskBudgetAllocation(roundtrip,{...roundtrip.nodes.risk.data,kellyTiltPct:25},{A:3,B:4});
 assert.notDeepEqual(preview.fractions,roundtrip.design.allocation.items.map(x=>x.fraction));
 assert.equal(JSON.stringify(roundtrip.design.allocation),saved);
});

test('pure risk baseline gives equal stop-risk contributions to stocks and shorts',()=>{
 const c=riskCase([stockBundle('a','A'),stockBundle('b','B','short')],{a:20,b:-20},{a:-5,b:5},0);
 const r=riskBudgetAllocation(c,c.nodes.risk.data,{A:2,B:4});
 approx(r.weights[0],2/3);approx(r.weights[1],1/3);
 approx(r.bundles[0].estimatedStopRiskFraction,r.bundles[1].estimatedStopRiskFraction);
 assert.equal(r.bundles[1].adverseStopDirection,'up');
});

for(const [type,side,bull,bear,adverse] of [['call','long',20,-5,'down'],['call','short',-20,5,'up'],['put','long',-20,5,'up'],['put','short',20,-5,'down']]){
 test(`${side} ${type} uses signed Delta/Gamma exposure, not option premium or contract count`,()=>{
  const c=riskCase([stockBundle('stock','STOCK'),optionBundle('OPT',type,side)],{stock:20,OPT:bull},{stock:-5,OPT:bear},0);
  const r=riskBudgetAllocation(c,c.nodes.risk.data,{STOCK:2,OPT:2});
  assert.equal(r.constraintIssue,'');assert.equal(r.bundles[1].adverseStopDirection,adverse);
  approx(r.bundles[1].stopRiskRate,side==='long'?.2375:.2625);
  approx(r.bundles[0].estimatedStopRiskFraction,r.bundles[1].estimatedStopRiskFraction);
  assert.ok(r.weights[1]<r.weights[0]);
 });
}

test('option spreads use combined leg exposure and are invariant to unit rescaling',()=>{
 const option=optionBundle('OPT');option.construction.legs[0].delta=6000;option.construction.legs[0].gamma=200;
 option.construction.legs.push({...option.construction.legs[0],id:'short-leg',side:'short',strike:110,delta:3000,gamma:100});
 const c=riskCase([stockBundle('stock','STOCK'),option],{stock:20,OPT:20},{stock:-5,OPT:-5},0);
 const r=riskBudgetAllocation(c,c.nodes.risk.data,{STOCK:2,OPT:2});
 approx(r.bundles[1].stopRiskRate,.1375);approx(r.bundles[0].estimatedStopRiskFraction,r.bundles[1].estimatedStopRiskFraction);
 const scaled=structuredClone(c);scaled.design.plans[1].construction.candidate.referenceCapital*=3;scaled.design.plans[1].construction.legs.forEach(l=>l.qty*=3);
 const rr=riskBudgetAllocation(scaled,scaled.nodes.risk.data,{STOCK:2,OPT:2});
 rr.fractions.forEach((f,i)=>approx(f,r.fractions[i]));
});

test('ATR option risk checks an interior Delta/Gamma minimum, not only range endpoints',()=>{
 const direct=atrStopProfile(20,10,5);approx(direct.stopRisk,20);approx(direct.adverseStopMove,-2);assert.equal(direct.adverseStopDirection,'interior');assert.ok(direct.downStopPnl>0);assert.ok(direct.upStopPnl>0);
 const option=optionBundle('OPT');option.construction.legs[0].delta=2000;option.construction.legs[0].gamma=1000;
 const c=riskCase([option],{OPT:20},{OPT:-5},0),r=riskBudgetAllocation(c,c.nodes.risk.data,{OPT:2});
 approx(r.bundles[0].stopRiskRate,.02);approx(r.bundles[0].adverseStopPrice,98);assert.equal(r.bundles[0].adverseStopDirection,'interior');
});

test('missing risk on a zero-Kelly candidate blocks redistribution instead of silently dropping it',()=>{
 const c=riskCase([stockBundle('a','A'),stockBundle('b','B')],{a:20,b:10},{a:-4,b:-8});
 const r=riskBudgetAllocation(c,c.nodes.risk.data,{A:2});
 assert.equal(r.kellyFractions[1],0);assert.match(r.constraintIssue,/B 缺少 ATR/);assert.equal(r.allocatedFraction,0);
 assert.throws(()=>setActiveAllocation(c,r),/缺少 ATR/);
});

test('delta-neutral positive-gamma structure is not treated as a zero-risk investment',()=>{
 const option=optionBundle('OPT');option.construction.legs[0].delta=0;
 const c=riskCase([stockBundle('a','A'),option],{a:20,OPT:20},{a:-4,OPT:-20});
 const r=riskBudgetAllocation(c,c.nodes.risk.data,{A:2,OPT:2});
 assert.match(r.constraintIssue,/ATR 风险估计为 0/);assert.equal(r.allocatedFraction,0);
 assert.ok(r.fractions.every(Number.isFinite));
});

test('tilt policy defaults and bounds are explicit, and the view distinguishes risk from capital',()=>{
 const c=riskCase([stockBundle('a','A'),stockBundle('b','B')],{a:20,b:10},{a:-4,b:-8});
 for(const value of [-1,101,NaN,''])assert.match(kellyPolicyError(c,{...c.nodes.risk.data,kellyTiltPct:value}),/Kelly Tilt/);
 assert.equal(kellyPolicyError(c,{...c.nodes.risk.data,kellyTiltPct:0}),'');
 assert.throws(()=>setActiveAllocation(c,riskBudgetAllocation(c,{...c.nodes.risk.data,kellyTiltPct:101},{A:2,B:4})),/Kelly Tilt/);
 const defaults=readKellyPolicy({elements:{namedItem:()=>null}});assert.equal(defaults.kellyTiltPct,25);
 assert.match(kellyPolicyForm({}),/kelly.kellyTiltPct/);
 const before=JSON.stringify(c),html=kellyAllocationView(c,c.nodes.risk.data,{atr:{A:2,B:4}});
 assert.match(html,/Baseline Risk Share/);assert.match(html,/Target Risk Share/);assert.match(html,/Capital Weight/);assert.equal(JSON.stringify(c),before);
 c.design.allocation={method:'risk-budget-kelly',at:'2026-10-01',items:[]};
 assert.match(kellyAllocationView(c,c.nodes.risk.data,{atr:{A:2,B:4}}),/仍使用旧权重/);
});

test('zero Kelly allocation can be frozen as an explicit cash decision',()=>{
 const c=createCase({title:'Cash decision'}),construction=stockBundle('unused','MU').construction,id=savePlan(c,null,'',construction),moves=priceMove=>({[id]:{priceMove,priceMoveRange:0,ivChange:'',ivChangeRange:''}});
 saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:[{id:'bull',name:'Bull',probability:20,probabilityRange:0,moves:moves(10)},{id:'base',name:'Base',probability:30,probabilityRange:0,moves:moves(0)},{id:'bear',name:'Bear',probability:50,probabilityRange:0,moves:moves(-20)}]});
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5});const result=riskBudgetAllocation(c,c.nodes.risk.data,{});assert.equal(result.allocatedFraction,0);setActiveAllocation(c,result);
 assert.equal(c.design.allocation.inAction,true);assert.equal(c.design.allocation.allocatedFraction,0);assert.equal(c.design.allocation.cashFraction,1);assert.match(c.events.at(-1).reason,/保持现金/);
});

test('calculation cache isolates returned values and invalidates relevant inputs',()=>{
 const b=stockBundle('cache-mu','MU'),data={...underwriting({bull:{'cache-mu':20},base:{'cache-mu':0},bear:{'cache-mu':-20}},[55,0,45]),scenarioVersion:3,probabilityUncertainty:5,atrMultiple:1,ivUncertaintyRatio:''};
 const c={design:{plans:[b]},nodes:{returns:{data},risk:{data:{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5}}}};
 const first=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}),saved=structuredClone(first);
 first.fractions[0]=999;first.bundles[0].fraction=999;
 assert.deepEqual(riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}),saved);
 c.nodes.risk.data.thesisAtRiskLimitPct=2;
 const resized=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2});assert.ok(resized.allocatedFraction>saved.allocatedFraction);assert.deepEqual(resized.kellyFractions,saved.kellyFractions);
 c.nodes.returns.data.scenarios.find(s=>s.id==='bull').probability=40;
 assert.notDeepEqual(riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}).kellyFractions,saved.kellyFractions);
 const changedAtr=riskBudgetAllocation(c,c.nodes.risk.data,{MU:4});
 assert.equal(changedAtr.bundles[0].atr,4);
 b.construction.legs[0].qty=50;
 assert.notEqual(riskBudgetAllocation(c,c.nodes.risk.data,{MU:4}).bundles[0].stopRiskRate,changedAtr.bundles[0].stopRiskRate);
});


test('Kelly tilt supports pure equal risk and pure Kelly at the slider endpoints',()=>{
 const rows=[{underlying:'A',stopRiskRate:.1},{underlying:'B',stopRiskRate:.2}];
 const equal=diversifiedRiskWeights(rows,[1,0],0),kelly=diversifiedRiskWeights(rows,[1,0],100);
 assert.deepEqual(equal.riskShares,[.5,.5]);assert.deepEqual(kelly.riskShares,[1,0]);assert.deepEqual(kelly.weights,[1,0]);
});
