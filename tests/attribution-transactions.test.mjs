import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransactionFile,easternTime,parseTransactionFile,thesisUnderlyings} from '../assets/attribution-transactions.mjs';
import {createCase,saveNode,savePlan,record,validateStore,archiveCase} from '../assets/workflow-model.mjs';
const history=transactions=>({version:1,generated_at:'2026-10-04T00:00:00Z',sources:[],transactions});
const row=(ts,sym='AMD',extra={})=>({ts,sym,kind:'equity',account:'one',side:'buy',qty:1,price:10,...extra});
const c=()=>{
 const thesis={...createCase({title:'Semis',symbol:'UNRELATED'}),linkedSymbols:['OLD']};
 const items=['AMD','INTC'].map(name=>({bundleId:savePlan(thesis,null,'',{structureVersion:1,template:'stock',candidate:{underlying:name,instrument:'stock',referenceCapital:100},evaluationDate:'',legs:[]}),name,fraction:.25}));
 thesis.design.allocation={method:'multivariate-kelly',inAction:true,at:'2026-10-01T12:00:00Z',items};record(thesis,'test allocation','risk','');return thesis;
};

test('exports all underlying contracts/accounts, preserves execution IDs, duplicates, raw units and older history',()=>{
 const thesis=c(),fill=row('2025-07-01T14:00:00Z','AMD 2025-08-15 150C',{kind:'option',price:123,execution_id:'fill-1'});
 const f=createTransactionFile(thesis,history([fill,fill,row('2025-07-01T15:00:00Z','INTC',{account:'two'}),row('2025-07-01T15:00:00Z','AMDX')]),{start:'2025-07-01',end:'2025-07-01'});
 assert.equal(f.transaction_count,3);assert.equal(f.transactions[0].price,123);assert.equal(f.transactions[1].execution_id,'fill-1');assert.equal(f.transactions[2].account,'two');
 assert.deepEqual(parseTransactionFile(JSON.stringify(f)),f);
});
test('ET bounds follow daylight saving and always end at midnight',()=>{
 for(const [date,stamps] of [
  ['2026-01-10',['2026-01-10T06:59:59Z','2026-01-10T07:00:00Z','2026-01-10T17:00:00Z','2026-01-11T04:59:59Z']],
  ['2026-07-10',['2026-07-10T05:59:59Z','2026-07-10T06:00:00Z','2026-07-10T16:00:00Z','2026-07-11T03:59:59Z']]]){
  const f=createTransactionFile(c(),history(stamps.map(ts=>row(ts))),{start:date,end:date});
  assert.equal(f.transaction_count,3);assert.equal(f.range.endTime,'24:00');
 }
 assert.match(easternTime('2026-03-08T07:00:00Z'),/T03:00/);
 const rows=[row('2026-07-10T22:00:00Z'),row('2026-07-11T03:59:59Z'),row('2026-07-11T04:00:00Z')];
 assert.equal(createTransactionFile(c(),history(rows),{start:'2026-07-10',end:'2026-07-10'}).transaction_count,2);
 assert.equal(createTransactionFile(c(),history(rows),{start:'2026-07-10',end:'2026-07-11'}).transaction_count,3);
});
test('all frozen In Action underlyings are used regardless of target weight; candidate edits and old assignments cannot widen scope',()=>{
 const thesis=c();thesis.design.plans.push({construction:{candidate:{underlying:'MU'},legs:[{underlying:'NVDA'}]}});
 thesis.design.allocation.items.push({name:'AVGO',fraction:0});
 assert.deepEqual(thesisUnderlyings(thesis,{'TSLA':'Semis'}),['AMD','AVGO','INTC']);
 thesis.design.allocation.items[0].underlying='MSFT';
 assert.deepEqual(thesisUnderlyings(thesis),['AVGO','INTC','MSFT']);
 delete thesis.design.allocation;
 assert.throws(()=>thesisUnderlyings(thesis),/In Action/);
});
test('missing source, invalid dates, unknown option identity and ambiguous timestamps fail explicitly',()=>{
 assert.throws(()=>createTransactionFile(c(),null,{start:'2026-01-01',end:'2026-01-02'}),/完整交易历史/);
 assert.throws(()=>createTransactionFile(c(),history([]),{start:'2026-02-30',end:'2026-03-01'}),/日期/);
 assert.throws(()=>createTransactionFile(c(),history([row('2026-01-01T10:00:00')]),{start:'2026-01-01',end:'2026-01-02'}),/时区/);
 assert.throws(()=>createTransactionFile(c(),history([row('2026-01-01T10:00:00Z','??? malformed contract',{kind:'option'})]),{start:'2026-01-01',end:'2026-01-02'}),/underlying/);
});
test('legacy underlying-only and named option strategies remain exportable with missing-contract flags',()=>{
 const f=createTransactionFile(c(),history([row('2026-01-01T15:00:00Z','AMD',{kind:'option'}),row('2026-01-01T15:00:00Z','INTC long_put',{kind:'option'})]),{start:'2026-01-01',end:'2026-01-01'});
 assert.equal(f.transaction_count,2);assert.ok(f.transactions.every(t=>t.contract_details_missing));assert.match(f.warnings.at(-1),/缺少/);
});
test('workflow stores only a stable file reference; raw transactions do not enter new snapshots',()=>{
 const thesis=c(),path=`/private/thesis_transactions/${thesis.id}.json`;
 saveNode(thesis,'attribution',{...thesis.nodes.attribution.data,realized:42,transactionFilePath:path});
 archiveCase(thesis);const store=validateStore(JSON.parse(JSON.stringify({version:1,cases:[thesis]})));
 assert.equal(store.cases[0].nodes.attribution.data.transactionFilePath,path);
 assert.equal(store.cases[0].nodes.attribution.data.realized,42);
 assert.ok(store.cases[0].events.every(e=>!e.snapshot.nodes.attribution.data.transactionFile));
});
test('legacy embedded noon files remain readable without allowing new noon generation',()=>{
 const f=createTransactionFile(c(),history([row('2026-07-01T14:00:00Z')]),{start:'2026-07-01',end:'2026-07-01'});
 f.range.endTime='12:00';f.range.endLocal='2026-07-01T12:00:00.000';
 assert.equal(parseTransactionFile(JSON.stringify(f)).range.endTime,'12:00');
 assert.equal(createTransactionFile(c(),history([]),{start:'2026-07-01',end:'2026-07-01',endTime:'12:00'}).range.endTime,'24:00');
});
