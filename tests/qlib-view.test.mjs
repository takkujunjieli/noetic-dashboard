import assert from 'node:assert/strict';
import {test} from 'node:test';
import {icStats,escapeHTML,percent,staleSessions} from '../assets/qlib-view.mjs';
test('zero is a valid score, null is never presented as a forecast',()=>{
  assert.equal(percent(0,100),'0.00%');assert.equal(percent(null,100),'—');assert.equal(percent(NaN),'—');
});
test('source-controlled symbols and external text are escaped',()=>{
  assert.equal(escapeHTML('<img src=x onerror="alert(1)">'),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});
test('signal summary shows only IC/ICIR and preserves undefined values',()=>{
  const stats=icStats({ic:0,icir:null,rank_ic:-.1,rank_icir:-.2});
  assert.deepEqual(stats.map(s=>s.label),['IC','ICIR','Rank IC','Rank ICIR']);
  assert.equal(stats[0].value,'0.0000');assert.equal(stats[1].value,'—');
});
test('older outputs are visibly stale',()=>{
  assert.equal(staleSessions('2026-10-23',new Date('2026-10-25T02:00:00Z')),false);
  assert.equal(staleSessions('2026-09-01',new Date('2026-10-25T02:00:00Z')),true);
});
