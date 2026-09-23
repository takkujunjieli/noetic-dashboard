const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),ctx=await browser.newContext(),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await ctx.route('**/data/portfolio.json*',r=>r.fulfill({json:{updated_at:'2026-09-22T12:00:00Z',accounts:[],positions:[]}}));
 await ctx.route('**/config/risk_policy.json*',r=>r.fulfill({json:{account_equity:10000,bundles:{},portfolio:{}}}));
 await ctx.route('**/data/atr.json*',r=>r.fulfill({json:{}}));
 await p.goto((process.env.DASHBOARD_URL||'http://127.0.0.1:8642')+'/workflow.html');
 await p.locator('#new').click();await p.locator('[name="title"]').fill('Optional hypothesis');await p.locator('[name="symbol"]').fill('A');await p.locator('[name="horizon"]').fill('2030-01-01');await p.getByRole('button',{name:'创建实例',exact:true}).click();
 const fields=p.locator('#node-form textarea');assert.equal(await fields.count(),4);assert.deepEqual(await fields.evaluateAll(es=>es.map(e=>e.parentElement.firstChild.textContent)),['市场结果预期假设','论点依据','验证条件','证伪条件']);assert.equal(await p.locator('[name="f.direction"],[name="f.target"],#transition-reason').count(),0);
 for(const key of ['hypothesis','signal','returns','construction','risk','positions','attribution']){
  await p.locator(`[data-node="${key}"]`).click();await p.locator('[data-transition="running"]').click();assert.match(await p.locator('.current-state').textContent(),/running/);await p.locator('[data-transition="pending"]').click();assert.match(await p.locator('.current-state').textContent(),/pending/);
 }
 await p.locator('[data-node="hypothesis"]').click();await p.locator('[name="f.expectation"]').fill('财报波动超出预期');await p.getByRole('button',{name:'保存节点',exact:true}).click();await p.reload();assert.equal(await p.locator('[name="f.expectation"]').inputValue(),'财报波动超出预期');assert.equal(await p.locator('[name="f.rationale"]').inputValue(),'');
 assert.deepEqual(errors,[]);console.log('PASS: four optional text fields, all seven nodes pending/running without reasons, save and reload');await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
