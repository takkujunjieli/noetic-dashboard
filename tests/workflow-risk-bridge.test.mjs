import test from 'node:test';
import assert from 'node:assert/strict';
import {activeNebulaCatalog,nebulaRiskModels,setHeatmapAssignment,effectiveHeatmapAssignments} from '../assets/workflow-risk-bridge.mjs';
import {createCase,savePlan,saveNode,setActiveAllocation,setPlanFrozen} from '../assets/workflow-model.mjs';
import {newStructureLeg} from '../assets/trade-structure.mjs';
import {riskBudgetAllocation} from '../assets/kelly-allocation.mjs';
import {portfolioBundleDrafts} from '../assets/portfolio-autofill.mjs';
import {allocationInputFingerprint,thesisFreshness} from '../assets/workflow-freshness.mjs';

function activeCase(title='Active'){
 const c=createCase({title});c.activeThesis=true;c.nodes.risk.state='running';
 const construction={structureVersion:1,template:'stock',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock','long',100),underlying:'MU',entry:100,underlyingPrice:100}]};
 const id=savePlan(c,null,'',construction),moves=priceMove=>({[id]:{priceMove,priceMoveRange:0,ivChange:0,ivChangeRange:0}});
 saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:[{id:'bull',name:'Bull',probability:55,probabilityRange:0,moves:moves(20)},{id:'base',name:'Base',probability:0,probabilityRange:0,moves:moves(0)},{id:'bear',name:'Bear',probability:45,probabilityRange:0,moves:moves(-20)}]});
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5});setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));return {c,id};
}

test('active catalog exposes account-independent target fractions and Portfolio dollarizes them',()=>{
 const {c}=activeCase(),archived=createCase({title:'Archived'});archived.activeThesis=true;archived.archived=true;c.events.push({id:'large-history',snapshot:{payload:'x'.repeat(10000)}});
 const catalog=activeNebulaCatalog({cases:[c,archived]},'2026-09-29T00:00:00Z');assert.deepEqual(catalog.cases.map(x=>x.title),['Active']);
 assert.equal(Object.hasOwn(catalog.cases[0],'events'),false);assert.ok(JSON.stringify(catalog).length<JSON.stringify(c).length/2);
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

function legacyCase(){
 const {c,id}=activeCase('Legacy budget');
 // Older activation snapshots predate these explicit frozen input fields.
 for(const allocation of [c.design.allocation,...c.events.map(e=>e.snapshot?.design?.allocation).filter(Boolean)]){
  for(const item of allocation.items)for(const field of ['referencePrice','bullPriceMove','bearReturn'])delete item[field];
 }
 c.design.plans[0].construction.legs[0].underlyingPrice=51.825;
 c.nodes.returns.data.scenarios.find(x=>x.id==='bull').moves[id].priceMove=80;
 c.nodes.returns.data.scenarios.find(x=>x.id==='bear').moves[id].priceMove=-5;
 return c;
}

test('legacy budgets recover reference and scenario inputs from their activation snapshot, including compact catalogs',()=>{
 const c=legacyCase(),before=JSON.stringify(c),model=nebulaRiskModels(c,100000)[0];
 assert.equal(model.referencePrice,100);assert.equal(model.bullPriceMove,20);assert.equal(model.bearReturn,-.2);
 assert.equal(model.referenceAt,c.design.allocation.at);assert.equal(model.stopPrice,95);
 const catalog=activeNebulaCatalog({cases:[c]});
 assert.equal(Object.hasOwn(catalog.cases[0],'events'),false);
 assert.deepEqual(nebulaRiskModels(catalog.cases[0],100000),[model]);
 assert.equal(JSON.stringify(c),before,'reading legacy data must not rewrite Workflow or its history');
});

test('legacy budgets without the matching activation snapshot never use newer draft inputs',()=>{
 const c=legacyCase();
 for(const e of c.events)if(e.snapshot?.design?.allocation)e.snapshot.design.allocation.at='2000-01-01T00:00:00Z';
 const missing=nebulaRiskModels(c,100000)[0];
 assert.equal(missing.referencePrice,null);assert.equal(missing.bullPriceMove,null);assert.equal(missing.bearReturn,null);
 assert.equal(missing.stopPrice,95);assert.ok(missing.targetCapital>0);
 c.events=[];
 assert.deepEqual(nebulaRiskModels(activeNebulaCatalog({cases:[c]}).cases[0],100000),[missing]);
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


test('market refresh changes the calculation draft; only In Action replaces official spot and capital',()=>{
 const {c,id}=activeCase('Market review'),before=structuredClone(c.design.allocation);
 const raw={updated_at:new Date().toISOString(),accounts:[{id:'rh'}],positions:[{account:'rh',kind:'equity',sym:'MU',qty:100,avg_cost:80,price:140}]};
 const draft=portfolioBundleDrafts(c,raw,{assignments:{MU:c.title}}).bundles[0].construction;
 savePlan(c,id,'',draft);
 assert.equal(c.design.plans[0].construction.legs[0].underlyingPrice,140);
 assert.equal(c.design.plans[0].construction.candidate.referenceCapital,14000);
 assert.deepEqual(c.design.allocation,before);
 assert.equal(nebulaRiskModels(c,100000)[0].referencePrice,100);
 assert.equal(nebulaRiskModels(c,100000)[0].referenceCapital,10000);
 const result=riskBudgetAllocation(c,c.nodes.risk.data,{MU:4}),pending=thesisFreshness(c,{prices:{MU:140},preview:result});
 assert.ok(pending.issues.some(issue=>issue.code==='draft-newer'));
 setActiveAllocation(c,result);
 const model=nebulaRiskModels(c,100000)[0];
 assert.equal(model.referencePrice,140);assert.equal(model.referenceCapital,14000);
 assert.equal(c.design.allocation.sourceFingerprint,allocationInputFingerprint(c));
 const activated=thesisFreshness(c,{prices:{MU:140},preview:result});
 assert.ok(!activated.issues.some(issue=>['draft-newer','price-drift'].includes(issue.code)));
 assert.deepEqual(activeNebulaCatalog({cases:[c]}).cases[0].design.allocation,c.design.allocation);
});
