import test from 'node:test';
import assert from 'node:assert/strict';
import {activeNebulaCatalog,nebulaRiskModels,setHeatmapAssignment} from '../assets/workflow-risk-bridge.mjs';
import {createCase,savePlan,saveNode,setPlanFrozen} from '../assets/workflow-model.mjs';
import {newStructureLeg} from '../assets/trade-structure.mjs';

test('active catalog and heatmap model expose quantile, Bear return and Kelly target capital',()=>{
 const c=createCase({title:'Active'});c.activeThesis=true;c.nodes.risk.state='running';
 const construction={structureVersion:1,template:'stock',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock','long',100),underlying:'MU',entry:100,underlyingPrice:100}]};
 const id=savePlan(c,null,'',construction),moves=priceMove=>({[id]:{priceMove,priceMoveRange:0,ivChange:0,ivChangeRange:0}});
 saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:[{id:'bull',name:'Bull',probability:55,probabilityRange:0,moves:moves(20)},{id:'base',name:'Base',probability:0,probabilityRange:0,moves:moves(0)},{id:'bear',name:'Bear',probability:45,probabilityRange:0,moves:moves(-20)}]});
 saveNode(c,'risk',{allocationVersion:1,targetQuantile:50});
 const archived=createCase({title:'Archived'});archived.activeThesis=true;archived.archived=true;
 const catalog=activeNebulaCatalog({cases:[c,archived]},'2026-09-29T00:00:00Z');assert.deepEqual(catalog.cases.map(x=>x.title),['Active']);
 const model=nebulaRiskModels(c,50000)[0];assert.equal(model.underlying,'MU');assert.equal(model.quantile,50);assert.equal(model.running,true);assert.equal(model.bullPriceMove,20);assert.ok(Math.abs(model.targetCapital-25000)<5);assert.ok(Math.abs(model.bearReturn+.2)<1e-9);
});

test('heatmap applies the same ATR thesis-risk constraint as Workflow',()=>{
 const c=createCase({title:'ATR constrained'});c.activeThesis=true;
 const construction={structureVersion:1,template:'stock',candidate:{underlying:'RKLB',instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock','long',100),underlying:'RKLB',entry:100,underlyingPrice:100}]};
 const id=savePlan(c,null,'',construction),moves=priceMove=>({[id]:{priceMove,priceMoveRange:0,ivChange:0,ivChangeRange:0}});
 saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:[{id:'bull',name:'Bull',probability:55,probabilityRange:0,moves:moves(20)},{id:'base',name:'Base',probability:0,probabilityRange:0,moves:moves(0)},{id:'bear',name:'Bear',probability:45,probabilityRange:0,moves:moves(-20)}]});
 saveNode(c,'risk',{allocationVersion:1,targetQuantile:25,thesisAtRiskLimitPct:.5,atrReviewMultiple:1.5,atrHardStopMultiple:2.5});
 const constrained=nebulaRiskModels(c,100000,{RKLB:2})[0],missingAtr=nebulaRiskModels(c,100000,{})[0];
 assert.ok(constrained.targetFraction>0&&constrained.targetFraction<.5);assert.ok(constrained.targetCapital>0&&constrained.targetCapital<50000);assert.equal(missingAtr.targetCapital,null);assert.match(missingAtr.constraintIssue,/缺少 ATR/);
});

test('heatmap assignment is freely mutable and cannot rewrite frozen Workflow ownership or In Action Kelly',()=>{
 const c=createCase({title:'Frozen owner'}),construction={structureVersion:1,template:'stock',candidate:{underlying:'AMD',instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock','long',100),underlying:'AMD',entry:100,underlyingPrice:100}]};
 const id=savePlan(c,null,'',construction);setPlanFrozen(c,id,true);
 c.design.allocation={method:'multivariate-kelly',inAction:true,at:'2026-10-04T12:00:00Z',items:[{bundleId:id,name:'AMD',underlying:'AMD',fraction:.25}]};
 const workflowBefore=JSON.stringify(c),allocationBefore=JSON.stringify(c.design.allocation),planBefore=JSON.stringify(c.design.plans[0]);
 let groups=setHeatmapAssignment({},'AMD','Other thesis');
 assert.deepEqual(groups,{AMD:'Other thesis'});
 groups=setHeatmapAssignment(groups,'AMD','Third thesis');assert.deepEqual(groups,{AMD:'Third thesis'});
 groups=setHeatmapAssignment(groups,'AMD','');assert.deepEqual(groups,{});
 assert.equal(JSON.stringify(c),workflowBefore);assert.equal(JSON.stringify(c.design.allocation),allocationBefore);assert.equal(JSON.stringify(c.design.plans[0]),planBefore);
});
