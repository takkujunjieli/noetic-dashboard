import test from 'node:test';
import assert from 'node:assert/strict';
import {solveKelly,kellyAllocation,kellyPolicyError} from '../assets/kelly-allocation.mjs';
import {newStructureLeg} from '../assets/trade-structure.mjs';
import {VERSION,createCase,savePlan,saveNode,setActiveAllocation,validateStore} from '../assets/workflow-model.mjs';

test('single bundle Kelly matches the closed-form binary result',()=>{
 const result=solveKelly([{probability:.55,returns:[.2]},{probability:.45,returns:[-.2]}],1);
 assert.ok(Math.abs(result.fractions[0]-.5)<1e-4);
 assert.ok(result.expectedLogGrowth>0);
});

test('multivariate Kelly consumes the joint Greek scenario matrix and scales the whole bundle',()=>{
 const bundle={id:'mu',name:'MU Bundle',construction:{structureVersion:1,template:'stock',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock','long',100),underlying:'MU',entry:100,underlyingPrice:100}]}};
 const c={design:{plans:[bundle]},nodes:{returns:{data:{scenarioVersion:1,daysForward:0,scenarios:[{id:'bull',name:'Bull',probability:55,moves:{mu:{priceMove:20,ivChange:''}}},{id:'base',name:'Base',probability:0,moves:{mu:{priceMove:0,ivChange:''}}},{id:'bear',name:'Bear',probability:45,moves:{mu:{priceMove:-20,ivChange:''}}}]}},risk:{data:{allocationVersion:1,bankroll:50000}}}};
 const result=kellyAllocation(c);
 assert.equal(kellyPolicyError(c,c.nodes.risk.data),'');
 assert.equal(result.complete,true);
 assert.ok(Math.abs(result.bundles[0].fraction-.5)<1e-4);
 assert.ok(Math.abs(result.bundles[0].targetCapital-25000)<5);
 assert.ok(Math.abs(result.bundles[0].scale-2.5)<.001);
 assert.ok(Math.abs(result.bundles[0].delta-250)<.1);
 assert.ok(result.scenarios.every(s=>s.wealth>0));
 for(const scenario of c.nodes.returns.data.scenarios){scenario.probabilityRange=scenario.id==='base'?0:10;scenario.moves.mu.priceMoveRange=5;scenario.moves.mu.ivChangeRange='';}
 const uncertain=kellyAllocation(c),repeat=kellyAllocation(c);
 assert.equal(uncertain.uncertaintyAware,true);assert.equal(uncertain.monteCarlo.samples,500);assert.deepEqual(uncertain.fractions,repeat.fractions);assert.ok(uncertain.bundles[0].fraction<uncertain.bundles[0].fullFraction);
 c.nodes.risk.data.targetQuantile=50;const q50=kellyAllocation(c);c.nodes.risk.data.targetQuantile=100;const q100=kellyAllocation(c);
 assert.equal(q50.targetQuantile,50);assert.equal(q100.targetQuantile,100);assert.ok(q50.fractions[0]>=uncertain.fractions[0]);assert.ok(q100.fractions[0]>=q50.fractions[0]);
});

test('Kelly refuses incomplete underwriting and nonpositive bankroll',()=>{
 const c={design:{plans:[]},nodes:{returns:{data:{}},risk:{data:{allocationVersion:1,bankroll:0}}}};
 const result=kellyAllocation(c);
 assert.equal(result.complete,false);
 assert.match(kellyPolicyError(c,c.nodes.risk.data),/Bankroll/);
 assert.match(kellyPolicyError(c,{bankroll:10000,targetQuantile:75}),/Q25/);
});

test('In Action Kelly allocation freezes a valid attribution basis and roundtrips',()=>{
 const c=createCase({title:'Kelly snapshot'}),construction={structureVersion:1,template:'stock',evaluationDate:'',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{...newStructureLeg('stock','long',100),underlying:'MU',entry:100,underlyingPrice:100}]};
 const id=savePlan(c,null,'',construction),moves=priceMove=>({[id]:{priceMove,ivChange:''}});
 saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:[{id:'bull',name:'Bull',probability:55,moves:moves(20)},{id:'base',name:'Base',probability:0,moves:moves(0)},{id:'bear',name:'Bear',probability:45,moves:moves(-20)}]});
 saveNode(c,'risk',{allocationVersion:1,bankroll:50000});setActiveAllocation(c,kellyAllocation(c));
 assert.equal(c.design.allocation.method,'multivariate-kelly');assert.ok(c.returnBasis.capital>0);assert.equal(c.returnBasis.planName,'Kelly Allocation');
 validateStore({version:VERSION,cases:[c]});
});
