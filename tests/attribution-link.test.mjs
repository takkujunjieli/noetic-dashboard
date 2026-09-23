import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attributionEvidence,validateAttributionEvidence} from '../assets/attribution-link.mjs';
const c={nodes:{positions:{data:{binding:{rules:[{account:'a',symbol:'A',closed:true},{account:'a',symbol:'A 2030-01-01 15C'}]}}}}};
const pnl={updated_at:'2026-09-22T12:00:00Z',as_of:'2026-09-22',accounts:{a:{windows:{ytd:{trades:[{d:'2026-09-20',s:'A',k:'equity',p:10},{d:'2026-09-20',s:'A',k:'equity',p:10},{d:'2026-09-20',s:'AB',k:'equity',p:99},{d:'2026-09-21',s:'A 2030-01-01 15C',k:'option',p:100}]},'1m':{trades:[{d:'2026-09-20',s:'A',k:'equity',p:10}]}}},b:{windows:{ytd:{trades:[{d:'2026-09-20',s:'A',k:'equity',p:200}]}}}}};
const range={start:'2026-09-01',end:'2026-09-22'};
test('exact account and contract matching including closed bindings; one window only; identical events preserved',()=>{const e=attributionEvidence(c,pnl,range);assert.equal(e.rows.length,3);assert.equal(e.rows.reduce((s,r)=>s+r.pnl,0),120);assert.equal(e.warnings.length,0);validateAttributionEvidence(JSON.parse(JSON.stringify(e)));});
test('partial coverage and unlinked sources explicitly reported; option dollars not multiplied',()=>{assert.match(attributionEvidence(c,pnl,{...range,start:'2025-01-01'}).warnings.join(),/不完整/);assert.equal(attributionEvidence(c,pnl,range).rows.at(-1).pnl,100);assert.equal(attributionEvidence({nodes:{positions:{data:{}}}},pnl,range).rows.length,0);});
test('invalid dates and invalid matched financial data fail instead of fabricating zero',()=>{assert.throws(()=>attributionEvidence(c,pnl,{...range,end:'bad'}));const bad=structuredClone(pnl);bad.accounts.a.windows.ytd.trades[0].p=null;assert.throws(()=>attributionEvidence(c,bad,range));});
