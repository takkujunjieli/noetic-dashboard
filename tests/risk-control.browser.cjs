const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const base=process.env.DASHBOARD_URL || 'http://127.0.0.1:8642';
(async()=>{
const b=await chromium.launch({headless:true,channel:'chrome'}),context=await b.newContext({viewport:{width:1440,height:1000}});
const errors=[],writes=[];
const policy={account_equity:10000,atr_period:14,default_bundle:'Existing',portfolio:{max_total_heat_pct:15},bundles:{Existing:{risk_pct:2,total_risk_pct:6,atr_mult:2,max_position_pct:null,total_position_pct:null},Untouched:{risk_pct:1,total_risk_pct:3,atr_mult:3}},assignments:{A:'Existing'},stop_bases:[]};
const pf={updated_at:'2026-09-22T14:00:00Z',source_updated_at:'2026-09-22T13:59:00Z',accounts:[{id:'test',label:'Test account',equity:10000}],positions:[{account:'test',sym:'A',kind:'equity',qty:10,price:100,avg_cost:90,mkt_value:1000,pnl:100,pnl_pct:.11}],transactions:[]};
await context.route('**/api.github.com/**',r=>{if(r.request().method()!=='GET')writes.push(r.request().url());return r.abort();});
await context.route('**/config/risk_policy.json*',r=>r.fulfill({json:policy}));
await context.route('**/data/**',r=>{const path=new URL(r.request().url()).pathname;if(path.endsWith('/portfolio.json'))return r.fulfill({json:pf});if(path.endsWith('/atr.json'))return r.fulfill({json:{updated_at:'2026-09-22',atr14:{A:2}}});return r.fulfill({status:404,body:'not in fixture'});});
const portfolio=await context.newPage();portfolio.on('pageerror',e=>errors.push(e.message));await portfolio.goto(`${base}/portfolio.html`,{waitUntil:'domcontentloaded'});await portfolio.locator('#rk-eq').waitFor();assert.equal(await portfolio.locator('#rk-eq').inputValue(),'10000');assert.match(await portfolio.locator('#rk-out').textContent(),/33/);
const wf=await context.newPage();wf.on('pageerror',e=>errors.push(e.message));await wf.goto(`${base}/workflow.html`);await wf.locator('[data-demo]').click();await wf.locator('[data-node="risk"]').click();await wf.locator('#rc-template').waitFor();await wf.locator('#rc-template').selectOption('Existing');await wf.locator('[data-sizing="stop"]').fill('94');await wf.locator('[data-sizing="optionRisk"]').fill('50');assert.match(await wf.locator('.rc-results').textContent(),/33/);
await wf.getByRole('button',{name:'保存节点',exact:true}).click();await wf.locator('#rc-template').waitFor();await wf.locator('[data-transition="pending"]').click();await wf.waitForFunction(()=>document.querySelector('[data-node="risk"]').textContent.includes('pending'));
const before=await wf.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0]);assert.equal(before.nodes.risk.data.accountSnapshot.equity,10000);assert.equal(before.nodes.risk.data.sizing.risk_pct,2);
// Shared account changes propagate to the existing Portfolio editor, without changing its bundles.
await wf.locator('[data-account="equity"]').fill('12000');await wf.locator('[data-account="equity"]').blur();await portfolio.waitForFunction(()=>document.querySelector('#rk-eq')?.value==='12000');
await wf.waitForFunction(()=>document.querySelector('[data-node="risk"]').textContent.includes('pending'));
const local=await portfolio.evaluate(()=>JSON.parse(localStorage.getItem('riskPolicy')));assert.equal(local.account_equity,12000);
// Reverse direction while Workflow has an unsaved instance edit; preserve that edit.
await wf.locator('[data-sizing="risk_pct"]').fill('3');await portfolio.locator('#rk-eq').fill('15000');await portfolio.locator('#rk-eq').blur();await wf.waitForFunction(()=>document.querySelector('[data-account="equity"]')?.value==='15000');assert.equal(await wf.locator('[data-sizing="risk_pct"]').inputValue(),'3');
await wf.getByRole('button',{name:'保存节点',exact:true}).click();await wf.locator('#rc-template').waitFor();assert.equal(await portfolio.locator('#rk-risk').inputValue(),'2');
await wf.locator('[data-account="maxHeat"]').fill('12');await wf.locator('[data-account="maxHeat"]').blur();await portfolio.waitForFunction(()=>document.querySelector('#rk-maxheat')?.value==='12');
await wf.getByRole('button',{name:'保存节点',exact:true}).click();await wf.locator('#rc-template').waitFor();
const saved=await wf.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0]);assert.equal(saved.nodes.risk.data.accountSnapshot.equity,15000);assert.equal(saved.nodes.risk.data.accountSnapshot.maxHeat,12);
// Historical account view is frozen despite global setting changes.
const old=saved.events.find(e=>e.snapshot.nodes.risk.data.accountSnapshot?.equity===10000);await wf.locator(`[data-replay="${old.id}"]`).click();await wf.locator('[data-account="equity"]').waitFor();assert.equal(await wf.locator('[data-account="equity"]').inputValue(),'10000');assert.equal(await wf.locator('[data-account="equity"]').isDisabled(),true);
await wf.getByRole('button',{name:'返回当前版本'}).click();await wf.locator('#rc-template').waitFor();if(process.env.SCREENSHOT_PATH)await wf.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
await wf.reload();await wf.locator('[data-node="risk"]').click();await wf.locator('#rc-template').waitFor();assert.equal(await wf.locator('[data-sizing="risk_pct"]').inputValue(),'3');
await wf.setViewportSize({width:390,height:844});assert.equal(await wf.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
const finalPolicy=await wf.evaluate(()=>JSON.parse(localStorage.getItem('riskPolicy')));assert.deepEqual(finalPolicy.bundles.Untouched,policy.bundles.Untouched);assert.equal(finalPolicy.bundles.Existing.risk_pct,2);assert.equal(writes.length,0);assert.deepEqual(errors,[]);
console.log('PASS: Portfolio legacy calculator, shared formulas, template copy isolation, Workflow risk progress, two-way account sync, heat limit sync, risk progress preserved, unsaved draft protection, immutable replay, reload, mobile, no remote writes/errors');await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
