import test from 'node:test';
import assert from 'node:assert/strict';
import {createCase,saveNode,savePlan,setActiveAllocation,validateStore,VERSION} from '../assets/workflow-model.mjs';
import {riskBudgetAllocation} from '../assets/kelly-allocation.mjs';
import {readScenarioUnderwriting,scenarioUnderwritingForm} from '../assets/expected-return.js';

const make=()=>{const c=createCase({title:'Horizon'});const id=savePlan(c,null,'',{structureVersion:1,template:'stock',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{type:'stock',side:'long',underlying:'MU',qty:100,entry:100,underlyingPrice:100}]});
 saveNode(c,'returns',{scenarioVersion:3,daysForward:30,scenarios:[{id:'bull',probability:55,moves:{[id]:{priceMove:20,ivChange:''}}},{id:'base',probability:0,moves:{}},{id:'bear',probability:45,moves:{[id]:{priceMove:-20,ivChange:''}}}]});
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5});return c;};

test('Hypothesis saves Horizon and text atomically, preserves old snapshots and reloads',()=>{
 const c=make(),old=structuredClone(c.events.at(-1));
 assert.equal(saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,expectation:'Updated thesis',daysForward:60}),true);
 assert.equal(c.nodes.hypothesis.data.expectation,'Updated thesis');assert.equal(c.nodes.returns.data.daysForward,60);
 assert.deepEqual(c.events.at(-2),old);assert.equal(c.events.at(-1).node,'hypothesis');
 assert.equal(validateStore({version:VERSION,cases:[c]}).cases[0].nodes.returns.data.daysForward,60);
 assert.throws(()=>saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,daysForward:-1}),/Horizon/);
 assert.equal(c.nodes.returns.data.daysForward,60);
});

test('Scenario form no longer edits Horizon and saving scenarios retains the Hypothesis value',()=>{
 const c=make();assert.ok(!scenarioUnderwritingForm(c).includes('scenario.daysForward'));
 const form={elements:{namedItem:()=>({value:''})}};
 assert.equal(readScenarioUnderwriting(form,c).daysForward,30);
 saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,daysForward:45});
 assert.equal(readScenarioUnderwriting(form,c).daysForward,45);
});

test('Horizon alone can be saved, and the official horizon updates only on In Action',()=>{
 const c=make();setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));
 const frozen=structuredClone(c.design.allocation);
 assert.equal(saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,daysForward:60}),true);
 assert.deepEqual(c.design.allocation,frozen);assert.equal(c.nodes.returns.data.daysForward,60);
 setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));
 assert.equal(c.design.allocation.scenarioDaysForward,60);
});
