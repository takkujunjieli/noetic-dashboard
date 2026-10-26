import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseSymbols,previewSymbols,numberInput} from '../assets/qlib-universe.mjs';
test('manual symbols normalize, deduplicate and reject injected text',()=>{
  assert.deepEqual(parseSymbols('purr, NVDA，purr BRK.B'),['BRK.B','NVDA','PURR']);
  assert.throws(()=>parseSymbols('PURR <script>'));
});
test('themes union with manual entries and excludes take precedence',()=>{
  const groups=[{id:'hype',symbols:['PURR']},{id:'memory',symbols:['MU','SNDK']}];
  assert.deepEqual(previewSymbols(['AAPL'],{include_base:false,groups:['hype','memory'],include:['NVDA'],exclude:['MU']},groups),['NVDA','PURR','SNDK']);
});
test('display units convert to USD and blank market cap maximum means unbounded',()=>{
  assert.equal(numberInput('2.5',{scale:1e8}),250000000);
  assert.equal(numberInput('',{nullable:true}),null);
  assert.equal(numberInput(''),0);
  assert.throws(()=>numberInput('-1'));assert.throws(()=>numberInput('Infinity'));
});
