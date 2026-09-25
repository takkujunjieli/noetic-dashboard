import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceCatalog,linkSource} from '../assets/workflow-source.mjs';
import {validateStore,VERSION} from '../assets/workflow-model.mjs';
const policy={account_equity:10000,bundles:{Thesis:{edge:'because',invalid:'unless',risk_pct:1}},assignments:{A:'Thesis',B:'Thesis'}};
const portfolio={updated_at:'2026-09-23T12:00:00Z',accounts:[{id:'test',source_updated_at:'2026-09-23T11:00:00Z'}],positions:['A','B'].map(sym=>({sym,account:'test',kind:'equity',qty:2,avg_cost:10,price:12}))};
test('link multiple underlyings without writing sources; duplicates and occupied positions protected',()=>{
 const before=JSON.stringify({policy,portfolio}),catalog=sourceCatalog(policy,portfolio),c=linkSource(catalog.items[0],catalog,[]);
 assert.deepEqual(c.nodes.positions.data,{});assert.equal(c.nodes.positions.state,'pending');assert.deepEqual(c.linkedSymbols,['A','B']);assert.equal(c.nodes.hypothesis.data.rationale,'because');assert.equal(c.nodes.hypothesis.data.invalidation,'unless');assert.equal(c.design.plans.length,0);
 assert.equal(validateStore({version:VERSION,cases:[c]}).cases.length,1);
 assert.equal(JSON.stringify({policy,portfolio}),before);
 assert.throws(()=>linkSource(catalog.items[0],catalog,[c]),/已关联/);
 const other={...catalog.items[0],name:'Other'},d=linkSource(other,catalog,[c]);assert.deepEqual(d.nodes.positions.data,{});assert.equal(d.sourceLink.warnings.length,0);
});
test('local thesis policy overrides file and missing portfolio does not invent positions',()=>{
 const catalog=sourceCatalog(policy,null,{bundles:{Local:{edge:'local'}}},{B:'Local'}),c=linkSource(catalog.items[0],catalog,[]);
 assert.equal(c.title,'Local');assert.equal(c.symbol,'B');assert.deepEqual(c.nodes.positions.data,{});assert.ok(catalog.error);
});
