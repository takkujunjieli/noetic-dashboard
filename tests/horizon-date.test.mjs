import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDeadline,displayDeadline,easternDay,daysToDeadline} from '../assets/horizon-date.mjs';
import {createCase,saveNode,savePlan,setActiveAllocation,validateStore,VERSION} from '../assets/workflow-model.mjs';
import {riskBudgetAllocation} from '../assets/kelly-allocation.mjs';
import {scenarioUnderwriting} from '../assets/expected-return.mjs';
import {readScenarioUnderwriting} from '../assets/expected-return.js';
import {thesisFreshness} from '../assets/workflow-freshness.mjs';

test('deadline parsing enforces mm/dd/yyyy calendar validity and preserves blank',()=>{
 assert.equal(parseDeadline('12/31/2030'),'2030-12-31');assert.equal(displayDeadline('2030-12-31'),'12/31/2030');
 for(const bad of ['2/01/2030','02/30/2030','13/01/2030','02/29/2030','text'])assert.equal(parseDeadline(bad),null);
 assert.equal(parseDeadline('02/29/2032'),'2032-02-29');assert.equal(parseDeadline(''),'');
 assert.equal(easternDay('2030-01-02T02:00:00Z'),'2030-01-01');
 assert.equal(daysToDeadline('2030-03-11','2030-03-09'),2);
});

function make(){const c=createCase({title:'Deadline',horizon:'2026-10-07'});const id=savePlan(c,null,'',{structureVersion:1,template:'stock',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{type:'stock',side:'long',underlying:'MU',qty:100,entry:100,underlyingPrice:100}]});
 saveNode(c,'returns',{scenarioVersion:3,daysForward:1,scenarios:[{id:'bull',probability:55,moves:{[id]:{priceMove:20,ivChange:''}}},{id:'base',probability:0,moves:{}},{id:'bear',probability:45,moves:{[id]:{priceMove:-20,ivChange:''}}}]});saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5});return c;}

test('Hypothesis deadline replaces the old target and days clock without changing historical snapshots',()=>{
 const c=make(),old=structuredClone(c.events.at(-1));setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));const frozen=structuredClone(c.design.allocation);
 saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,horizonDate:'12/31/2030',expectation:'New thesis'});
 assert.equal(c.horizon,'2030-12-31');assert.equal(c.nodes.returns.data.deadline,'2030-12-31');assert.equal(c.nodes.hypothesis.data.expectation,'New thesis');assert.deepEqual(c.design.allocation,frozen);
 assert.deepEqual(c.events.at(-3),old);
 assert.throws(()=>saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,horizonDate:'02/30/2030'}),/mm\/dd\/yyyy/);
 const parsed=readScenarioUnderwriting({elements:{namedItem:()=>null}},c);assert.equal(parsed.deadline,'2030-12-31');
 setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));assert.equal(c.design.allocation.horizonMode,'deadline');assert.equal(c.design.allocation.scenarioHorizon,'2030-12-31');
 const before=thesisFreshness(c,{now:'2030-12-31T16:00:00Z',prices:{MU:100},preview:{complete:true,bundles:[]}});
 assert.ok(!before.issues.some(i=>['horizon-expired','scenario-expired'].includes(i.code)));
 assert.ok(thesisFreshness(c,{now:'2031-01-01T16:00:00Z',prices:{MU:100},preview:{complete:true,bundles:[]}}).issues.some(i=>i.code==='horizon-expired'));
 assert.equal(validateStore({version:VERSION,cases:[c]}).cases[0].horizon,'2030-12-31');
});

test('deadline drives Theta days instead of the legacy fixed number; clearing removes both draft clocks',()=>{
 const c=make();saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,horizonDate:'12/31/2030'});
 assert.equal(scenarioUnderwriting(c.nodes.returns.data).daysForward,daysToDeadline('2030-12-31'));
 saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,horizonDate:''});
 assert.equal(c.horizon,'');assert.equal(c.nodes.returns.data.deadline,'');assert.equal(scenarioUnderwriting(c.nodes.returns.data).daysForward,'');
});
