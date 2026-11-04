import test from 'node:test';
import assert from 'node:assert/strict';
import {contributionRows,detailHTML} from '../assets/factor-attribution.mjs';
test('unavailable attribution is explicit and symbol text is escaped',()=>{
  assert.deepEqual(contributionRows({status:'insufficient'}),[]);
  const html=detailHTML({symbol:'<script>',reason:'Insufficient data'},'20');
  assert.match(html,/&lt;script&gt;/);assert.match(html,/Insufficient data/);assert.doesNotMatch(html,/0\.00/);
});
test('detail preserves negative contribution, intercept and residual separately',()=>{
  const contributions=Object.fromEntries(['RF','Mkt-RF','industry','SMB','HML','RMW','CMA','Mom','intercept','residual'].map(k=>[k,.001]));
  contributions.residual=-.01;
  const p={status:'ok',contributions,beta:{'Mkt-RF':1.2},actual_return:-.001,unexplained:-.009,r_squared:.5,observations:252,reconciliation_error:0};
  assert.equal(contributionRows(p).length,10);
  const html=detailHTML({symbol:'AAA',industry_proxy:'ETF',periods:{20:p}},'20');
  assert.match(html,/negative/);assert.match(html,/-1.00 pp/);assert.match(html,/Intercept/);assert.match(html,/Residual/);
});
