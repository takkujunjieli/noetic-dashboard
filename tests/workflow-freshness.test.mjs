import test from 'node:test';
import assert from 'node:assert/strict';
import {allocationInputFingerprint,marketPricesFromResearch,thesisFreshness} from '../assets/workflow-freshness.mjs';
import {createCase,savePlan} from '../assets/workflow-model.mjs';

const base=()=>({
 horizon:'2030-12-31',
 nodes:{returns:{data:{scenarioVersion:3,daysForward:20,scenarios:[]}},risk:{data:{thesisAtRiskLimitPct:2,atrStopMultiple:2.5,kellyTiltPct:25}}},
 design:{plans:[{id:'mu',name:'MU',construction:{legs:[]}}],allocation:null}
});
const activate=c=>{const at='2030-01-01T00:00:00.000Z';c.design.allocation={inAction:true,at,underwrittenAt:at,reviewedAt:at,scenarioDaysForward:20,scenarioHorizon:'2030-12-31',sourceFingerprint:allocationInputFingerprint(c),items:[{bundleId:'mu',name:'MU',underlying:'MU',eligible:true,referencePrice:100,atr:5}]};return c;};

test('freshness uses the frozen ATR and escalates price drift at one and two ATR',()=>{
 const c=activate(base()),preview={complete:true,bundles:[{bundleId:'mu',eligible:true}]};
 assert.equal(thesisFreshness(c,{now:'2030-01-02T00:00:00Z',prices:{MU:104},preview}).status,'fresh');
 assert.equal(thesisFreshness(c,{now:'2030-01-02T00:00:00Z',prices:{MU:106},preview}).status,'review');
 assert.equal(thesisFreshness(c,{now:'2030-01-02T00:00:00Z',prices:{MU:111},preview}).status,'stale');
});

test('review confirmation does not clear a draft mismatch or extend the frozen scenario horizon',()=>{
 const c=activate(base());c.nodes.risk.data.kellyTiltPct=30;c.design.allocation.reviewedAt='2030-01-19T00:00:00Z';
 const beforeExpiry=thesisFreshness(c,{now:'2030-01-19T12:00:00Z',prices:{MU:100},preview:{complete:true,bundles:[{bundleId:'mu',eligible:true}]}});
 assert.equal(beforeExpiry.status,'stale');assert.ok(beforeExpiry.issues.some(x=>x.code==='draft-newer'));
 const expired=thesisFreshness(c,{now:'2030-01-21T00:00:00Z',prices:{MU:100},preview:{complete:true,bundles:[{bundleId:'mu',eligible:true}]}});
 assert.equal(expired.status,'expired');assert.ok(expired.issues.some(x=>x.code==='scenario-expired'));
});

test('eligibility changes are surfaced without changing the frozen allocation',()=>{
 const c=activate(base()),result=thesisFreshness(c,{now:'2030-01-02T00:00:00Z',prices:{MU:100},preview:{complete:true,bundles:[{bundleId:'mu',eligible:false}]}});
 assert.equal(result.status,'stale');assert.match(result.issues.find(x=>x.code==='eligibility-changed').message,/Included → Excluded/);assert.equal(c.design.allocation.items[0].eligible,true);
});

test('research market data reads the latest daily close and legacy snapshot price',()=>{
 assert.deepEqual(marketPricesFromResearch({tickers:{mu:{bars_d:[[1,2,3,4,99],[2,3,4,5,101]]}},snapshots:{AMD:{price:250}}}),{MU:101,AMD:250});
});

test('missing current price requests review instead of assuming the thesis is fresh',()=>{
 const c=activate(base()),result=thesisFreshness(c,{now:'2030-01-02T12:00:00Z',prices:{},preview:{complete:true,bundles:[{bundleId:'mu',eligible:true}]}});
 assert.equal(result.status,'review');assert.ok(result.issues.some(x=>x.code==='price-unavailable'));
});

test('editing a Bundle preserves the frozen allocation and marks the draft stale',()=>{
 const c=createCase({title:'Preserve allocation',horizon:'2030-12-31'}),construction={structureVersion:1,template:'stock',evaluationDate:'2030-12-31',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{underlying:'MU',type:'stock',side:'long',qty:100,entry:100,underlyingPrice:100}]},id=savePlan(c,null,'',construction),at='2030-01-01T00:00:00Z';
 c.design.allocation={inAction:true,at,underwrittenAt:at,reviewedAt:at,scenarioDaysForward:'',scenarioHorizon:'2030-12-31',sourceFingerprint:allocationInputFingerprint(c),items:[{bundleId:id,name:'MU',underlying:'MU',eligible:true,referencePrice:100,atr:5}]};
 const frozen=JSON.stringify(c.design.allocation);savePlan(c,id,'',{...construction,legs:[{...construction.legs[0],qty:120}]});
 assert.equal(JSON.stringify(c.design.allocation),frozen);
 const result=thesisFreshness(c,{now:'2030-01-02T12:00:00Z',prices:{MU:100},preview:{complete:true,bundles:[{bundleId:id,eligible:true}]}});
 assert.equal(result.status,'stale');assert.ok(result.issues.some(x=>x.code==='draft-newer'));
});
