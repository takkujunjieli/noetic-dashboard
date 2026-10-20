import test from 'node:test';
import assert from 'node:assert/strict';
import {accountRiskPlan,heatmapBearRisk,heatmapMarketValue,isHeatmapPosition} from '../assets/account-risk-plan.mjs';
import {createCase,savePlan,saveNode,setActiveAllocation} from '../assets/workflow-model.mjs';
import {riskBudgetAllocation} from '../assets/kelly-allocation.mjs';
import {newStructureLeg} from '../assets/trade-structure.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(symbol='A',option=false){
 const c=createCase({title:symbol});c.activeThesis=true;
 savePlan(c,null,symbol,{structureVersion:1,template:'custom',greekScale:10000,candidate:{underlying:symbol,referenceCapital:option?1000:10000},legs:[{...newStructureLeg(option?'call':'stock','long',option?1:100),underlying:symbol,entry:option?10:100,underlyingPrice:100,strike:option?100:'',expiry:option?'2030-01-18':'',delta:option?5000:'',gamma:option?100:'',theta:0,vega:0,iv:option?30:''}]});
 saveNode(c,'returns',{scenarioVersion:3,daysForward:0,probabilityUncertainty:0,atrMultiple:0,ivUncertaintyRatio:0,scenarios:[['bull',55,20],['base',0,0],['bear',45,-20]].map(([id,p,move])=>({id,name:id,probability:p,moves:{[c.design.plans[0].id]:{priceMove:move,ivChange:0}}}))});
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:10,atrStopMultiple:2.5});
 setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{[symbol]:2}));return c;
}
const stock=(sym,qty=100,extra={})=>({kind:'equity',sym,qty,price:100,avg_cost:100,mkt_value:qty*100,...extra});

test('account risk sums thesis charges, scales all targets together and preserves Workflow',()=>{
 const cases=[fixture('A'),fixture('B')],before=JSON.stringify(cases);
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases,positions:[stock('A'),stock('B',50)]});
 assert.equal(plan.valid,true);close(plan.proposedRisk,10000);close(plan.scale,.6);close(plan.targetRisk,6000);
 close(plan.actualRisk,3000);close(plan.actualRemaining,3000);
 plan.rows.forEach(row=>{close(row.nebulaFraction,.25);close(row.accountFraction,.15);close(row.models[0].accountCapital,15000);});
 close(plan.cashFraction,.7);assert.equal(JSON.stringify(cases),before);
});

test('mapped holdings are replaced by targets, while other holdings reserve capital and risk once',()=>{
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[fixture('A'),fixture('B')],positions:[stock('A',1000),stock('C')],atr:{C:4}});
 assert.equal(plan.valid,true);close(plan.actualRisk,21000);close(plan.otherRisk,1000);
 close(plan.proposedRisk,11000);close(plan.scale,.5);close(plan.targetRisk,6000);close(plan.cashFraction,.65);
 assert.ok(plan.actualRemaining<0,'an over-budget actual holding must not be replaced in actual metrics');
});

test('no cross-thesis hedge credit is granted, even with opposite joint scenarios',()=>{
 const a=fixture('A'),b=fixture('B');
 const item=b.design.allocation.items[0];item.scenarioReturns={bull:-.2,base:0,bear:.2};
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[a,b]});
 close(plan.proposedRisk,10000);close(plan.targetRisk,6000);close(plan.scale,.6);
});

test('unknown other risk blocks final targets rather than silently counting zero',()=>{
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[fixture()],positions:[stock('UNKNOWN')]});
 assert.equal(plan.valid,false);assert.equal(plan.otherRisk,null);assert.equal(plan.actualRisk,null);assert.equal(plan.targetRisk,null);assert.equal(plan.rows[0].accountFraction,null);assert.match(plan.actualIssues.join(' '),/ATR/);
});

test('unsupported other options and missing equity prevent an apparently valid target',()=>{
 const option=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[fixture()],positions:[{kind:'option',sym:'X 2030-01-18 100C',qty:1,price:100}]});
 assert.equal(option.valid,false);assert.equal(option.actualRisk,null);
 const missing=accountRiskPlan({equity:100000,equityReliable:false,maxRiskPct:6,cases:[fixture()]});
 assert.equal(missing.valid,false);assert.equal(missing.totalBudget,null);assert.equal(missing.proposedRisk,null);assert.equal(missing.rows[0].models[0].accountCapital,null);
});

test('legacy frozen targets stay visible but require explicit reactivation before account sizing',()=>{
 const c=fixture(),before=JSON.stringify(c);delete c.design.allocation.sizingMethod;const legacy=JSON.stringify(c);
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[c]});
 close(plan.rows[0].nebulaFraction,.25);assert.equal(plan.rows[0].accountFraction,null);assert.match(plan.issues.join(' '),/重新设为 In Action/);assert.equal(JSON.stringify(c),legacy);assert.notEqual(before,legacy);
});

test('all-cash decisions are valid, and missing ATR for a zero target does not invent risk',()=>{
 const c=fixture();c.nodes.returns.data.scenarios[0].probability=20;c.nodes.returns.data.scenarios[2].probability=80;
 setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{}));
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[c]});
 assert.equal(plan.valid,true);close(plan.targetRisk,0);close(plan.rows[0].accountFraction,0);close(plan.cashFraction,1);
});

test('account size and selected holdings affect dollars without mutating frozen proportions',()=>{
 const cases=[fixture()],large=accountRiskPlan({equity:100000,maxRiskPct:6,cases,positions:[stock('A')]}),small=accountRiskPlan({equity:50000,maxRiskPct:6,cases,positions:[stock('A',50)]});
 close(large.rows[0].accountFraction,small.rows[0].accountFraction);close(large.rows[0].models[0].accountCapital,2*small.rows[0].models[0].accountCapital);close(large.actualRisk,2*small.actualRisk);
});

test('actual risk follows current heatmap value, not loss to the old frozen terminal price',()=>{
 const c=fixture(),base=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[c],positions:[stock('A')]}),rally=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[c],positions:[stock('A',100,{price:110,mkt_value:11000})]});
 close(base.actualRisk,2000);close(rally.actualRisk,2200);close(base.targetRisk,rally.targetRisk);
 const drawdown=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[c],positions:[stock('A',100,{price:70,mkt_value:7000})],stops:{A:95}});
 close(drawdown.actualRisk,1400);close(drawdown.rows[0].actualRisk,1400);close(drawdown.actualRemaining,4600);
 close(base.targetRisk,drawdown.targetRisk);close(base.rows[0].accountFraction,drawdown.rows[0].accountFraction);
});

test('actual option exposure uses exactly the Bear charge shown by the existing heatmap',()=>{
 const c=fixture('OPT',true),position={kind:'option',sym:'OPT 2030-01-18 100C',qty:2,price:1000,mkt_value:2000};
 const good=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[c],positions:[position]});
 assert.equal(good.actualIssues.length,0);close(good.actualRisk,heatmapBearRisk(2000,c.design.allocation.items[0].bearReturn));
 const changed=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[c],positions:[{...position,price:1500,mkt_value:3000}]});
 close(changed.actualRisk,good.actualRisk*1.5);close(changed.targetRisk,good.targetRisk);
});

test('duplicate underlying ownership blocks the plan even with no current holdings',()=>{
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[fixture(),fixture()]});
 assert.equal(plan.valid,false);assert.equal(plan.scale,null);assert.match(plan.issues.join(' '),/重复归属/);
});

test('capital already occupied by other holdings can tighten sizing without using risk budget',()=>{
 const plan=accountRiskPlan({equity:100000,maxRiskPct:20,cases:[fixture()],positions:[stock('OTHER',900)],atr:{OTHER:.01}});
 assert.equal(plan.valid,true);close(plan.scale,.4);close(plan.rows[0].accountFraction,.1);close(plan.cashFraction,0);
});

test('a fixed other holding above the risk cap cannot be presented as a compliant target',()=>{
 const plan=accountRiskPlan({equity:100000,maxRiskPct:1,cases:[fixture()],positions:[stock('OTHER',100)],atr:{OTHER:10}});
 assert.equal(plan.valid,false);close(plan.actualRisk,2500);assert.equal(plan.targetRisk,null);assert.match(plan.issues.join(' '),/其他持仓已超过/);
 const missing=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[fixture()],positions:[stock('OTHER',NaN)]});
 assert.equal(missing.valid,false);assert.equal(missing.actualRisk,null);assert.equal(missing.scale,null);
});

test('legacy metadata is unnecessary for actual Bear risk but still required for target sizing',()=>{
 const c=fixture();delete c.design.allocation.sizingMethod;
 delete c.design.allocation.items[0].riskBasis;delete c.design.allocation.items[0].scenarioReturns;
 const before=JSON.stringify(c),plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[c],positions:[stock('A')]});
 close(plan.rows[0].actualRisk,2000);close(plan.actualRisk,2000);close(plan.actualRemaining,4000);
 assert.equal(plan.rows[0].accountFraction,null);assert.equal(JSON.stringify(c),before);
});

test('missing Bear risk never becomes zero at Nebula or account level',()=>{
 const c=fixture();c.design.allocation.items[0].bearReturn=null;c.events=[];
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[c],positions:[stock('A')]});
 assert.equal(plan.rows[0].actualRisk,null);assert.equal(plan.actualRisk,null);assert.equal(plan.actualRemaining,null);
 assert.match(plan.actualIssues.join(' '),/Bear/);
});

test('duplicate ownership marks both Nebula risks unknown instead of zero',()=>{
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[fixture(),fixture()],positions:[stock('A')]});
 assert.ok(plan.rows.every(r=>r.actualRisk===null));assert.equal(plan.actualRisk,null);assert.equal(plan.actualRemaining,null);
});

test('upper totals reconcile with every visible heatmap row without offsetting Bear gains',()=>{
 const cases=[fixture('A'),fixture('B')];cases[1].design.allocation.items[0].bearReturn=.2;
 const positions=[stock('A',100,{price:70,mkt_value:7000}),stock('B',20),stock('A',1)];
 const visible=positions.filter(isHeatmapPosition),displayed=visible.reduce((sum,p)=>sum+heatmapBearRisk(heatmapMarketValue(p),cases.find(c=>c.title===p.sym).design.allocation.items[0].bearReturn),0);
 const plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases,positions});
 close(displayed,1400);close(plan.actualRisk,displayed);close(plan.rows.reduce((sum,r)=>sum+r.actualRisk,0),displayed);
});

test('displayed and aggregate risk both fall back to mark times quantity for missing market value',()=>{
 const p=stock('A',10,{mkt_value:null,price:70}),plan=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[fixture()],positions:[p]});
 close(heatmapMarketValue(p),700);close(plan.actualRisk,140);
 const missing=accountRiskPlan({equity:100000,maxRiskPct:6,cases:[fixture()],positions:[{...p,price:null}]});
 assert.equal(heatmapMarketValue({...p,price:null}),null);assert.equal(missing.rows[0].actualRisk,null);assert.equal(missing.actualRisk,null);
});
