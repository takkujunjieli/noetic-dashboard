import test from 'node:test';
import assert from 'node:assert/strict';
import {activeNebulaCatalog,nebulaRiskModels,setHeatmapAssignment,effectiveHeatmapAssignments} from '../assets/workflow-risk-bridge.mjs';
import {createCase,savePlan,saveNode,setActiveAllocation,setPlanFrozen} from '../assets/workflow-model.mjs';
import {newStructureLeg} from '../assets/trade-structure.mjs';
import {riskBudgetAllocation} from '../assets/kelly-allocation.mjs';

function activeCase(title='Active'){
 const c=createCase({title});c.activeThesis=true;c.nodes.risk.state='running';
 const construction={structureVersion:1,template:'stock',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock','long',100),underlying:'MU',entry:100,underlyingPrice:100}]};
 const id=savePlan(c,null,'',construction),moves=priceMove=>({[id]:{priceMove,priceMoveRange:0,ivChange:0,ivChangeRange:0}});
 saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:[{id:'bull',name:'Bull',probability:55,probabilityRange:0,moves:moves(20)},{id:'base',name:'Base',probability:0,probabilityRange:0,moves:moves(0)},{id:'bear',name:'Bear',probability:45,probabilityRange:0,moves:moves(-20)}]});
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5});setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));return {c,id};
}

test('active catalog exposes account-independent target fractions and Portfolio dollarizes them',()=>{
 const {c}=activeCase(),archived=createCase({title:'Archived'});archived.activeThesis=true;archived.archived=true;
 const catalog=activeNebulaCatalog({cases:[c,archived]},'2026-09-29T00:00:00Z');assert.deepEqual(catalog.cases.map(x=>x.title),['Active']);
 const small=nebulaRiskModels(c,50000,{MU:2})[0],large=nebulaRiskModels(c,100000,{MU:2})[0];
 assert.equal(small.underlying,'MU');assert.equal(small.running,true);assert.equal(small.bullPriceMove,20);assert.ok(Math.abs(small.targetFraction-.05)<1e-9);assert.ok(Math.abs(small.targetCapital-2500)<1e-6);assert.ok(Math.abs(large.targetCapital-5000)<1e-6);assert.equal(small.targetFraction,large.targetFraction);assert.ok(Math.abs(small.bearReturn+.2)<1e-9);
 assert.equal(small.referencePrice,100);assert.equal(small.referenceAt,c.design.allocation.at);
});

test('Portfolio dollarizes the frozen Risk Budget and does not recalculate it from later ATR or policy edits',()=>{
 const {c}=activeCase('Frozen budget'),before=nebulaRiskModels(c,100000,{MU:2})[0];
 c.nodes.risk.data.thesisAtRiskLimitPct=9;
 c.design.plans[0].construction.legs[0].underlyingPrice=180;
 c.nodes.returns.data.scenarios.find(x=>x.id==='bull').moves[c.design.plans[0].id].priceMove=80;
 c.nodes.returns.data.scenarios.find(x=>x.id==='bear').moves[c.design.plans[0].id].priceMove=-5;
 const noAtr=nebulaRiskModels(c,100000,{})[0],changedAtr=nebulaRiskModels(c,100000,{MU:20})[0];
 assert.ok(before.targetFraction>0);assert.equal(noAtr.targetFraction,before.targetFraction);assert.equal(changedAtr.targetFraction,before.targetFraction);assert.equal(noAtr.targetCapital,before.targetCapital);assert.equal(noAtr.constraintIssue,'');
 assert.equal(noAtr.referencePrice,before.referencePrice);assert.equal(noAtr.referencePrice,100);assert.equal(noAtr.stopPrice,before.stopPrice);assert.ok(before.stopPrice>0);assert.equal(noAtr.stopAt,c.design.allocation.at);
 assert.equal(noAtr.bullPriceMove,before.bullPriceMove);assert.equal(noAtr.bearReturn,before.bearReturn);
});

test('Portfolio receives frozen exclusion status and reason',()=>{
 const {c}=activeCase('Excluded budget'),item=c.design.allocation.items[0];item.eligible=false;item.exclusionReason='独立预期收益非正且 Kelly 权重为 0';item.fraction=0;
 const model=nebulaRiskModels(c,100000,{MU:2})[0];
 assert.equal(model.excluded,true);assert.match(model.exclusionReason,/Kelly 权重为 0/);assert.equal(model.targetFraction,0);assert.equal(model.targetCapital,0);
});

test('legacy assignment compatibility merges durable records and explicit local clears',()=>{
 const file={MU:'Active',AMD:'Archived'},overrides={MU:null,AMD:'Active',NVDA:'Missing'};
 assert.deepEqual(effectiveHeatmapAssignments(file,overrides,['Active']),{AMD:'Active'});
 assert.deepEqual(effectiveHeatmapAssignments({MU:'Active'},{},['Active']),{MU:'Active'});
});

test('legacy heatmap edits cannot rewrite frozen Workflow ownership or In Action Risk Budget',()=>{
 const c=createCase({title:'Frozen owner'}),construction={structureVersion:1,template:'stock',candidate:{underlying:'AMD',instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock','long',100),underlying:'AMD',entry:100,underlyingPrice:100}]};
 const id=savePlan(c,null,'',construction);setPlanFrozen(c,id,true);
 c.design.allocation={method:'risk-budget-kelly',inAction:true,at:'2026-10-04T12:00:00Z',items:[{bundleId:id,name:'AMD',underlying:'AMD',fraction:.25}]};
 const workflowBefore=JSON.stringify(c),allocationBefore=JSON.stringify(c.design.allocation),planBefore=JSON.stringify(c.design.plans[0]);
 let groups=setHeatmapAssignment({},'AMD','Other thesis');assert.deepEqual(groups,{AMD:'Other thesis'});
 groups=setHeatmapAssignment(groups,'AMD','Third thesis');assert.deepEqual(groups,{AMD:'Third thesis'});
 groups=setHeatmapAssignment(groups,'AMD','');assert.deepEqual(groups,{});
 assert.equal(JSON.stringify(c),workflowBefore);assert.equal(JSON.stringify(c.design.allocation),allocationBefore);assert.equal(JSON.stringify(c.design.plans[0]),planBefore);
});
