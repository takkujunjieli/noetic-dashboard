const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const base=process.env.DASHBOARD_URL || 'http://127.0.0.1:8642';
(async()=>{
const b=await chromium.launch({headless:true,channel:'chrome'}),context=await b.newContext({viewport:{width:1440,height:1000}});
const errors=[],writes=[];
const policy={account_equity:10000,atr_period:14,default_bundle:'Existing',portfolio:{max_total_heat_pct:15},bundles:{Existing:{risk_pct:2,total_risk_pct:6,atr_mult:2,max_position_pct:null,total_position_pct:null,edge:'legacy edge',invalidation:'legacy invalidation'},Untouched:{risk_pct:1,total_risk_pct:3,atr_mult:3}},assignments:{A:'Existing'},stop_bases:[]};
const pf={updated_at:'2026-09-22T14:00:00Z',source_updated_at:'2026-09-22T13:59:00Z',accounts:[{id:'test',label:'Test account',equity:10000}],positions:[{account:'test',sym:'A',kind:'equity',qty:10,price:100,avg_cost:90,mkt_value:1000,pnl:100,pnl_pct:.11}],transactions:[]};
await context.route('**/api.github.com/**',r=>{if(r.request().method()!=='GET')writes.push(r.request().url());return r.abort();});
await context.route('**/config/risk_policy.json*',r=>r.fulfill({json:policy}));
await context.route('**/data/**',r=>{const path=new URL(r.request().url()).pathname;if(path.endsWith('/portfolio.json'))return r.fulfill({json:pf});if(path.endsWith('/atr.json'))return r.fulfill({json:{updated_at:'2026-09-22',atr14:{A:2}}});return r.fulfill({status:404,body:'not in fixture'});});

const portfolio=await context.newPage();portfolio.on('pageerror',e=>errors.push(e.message));await portfolio.goto(`${base}/portfolio.html`,{waitUntil:'domcontentloaded'});await portfolio.locator('#ps-equity').waitFor();
assert.equal(await portfolio.locator('#ps-equity').inputValue(),'10000');assert.equal(await portfolio.locator('#ps-risk').inputValue(),'2');assert.match(await portfolio.locator('#ps-out').textContent(),/33/);
await portfolio.locator('.rk-grpsel[data-sym="A"]').waitFor();assert.equal(await portfolio.locator('.rk-grpsel[data-sym="A"]').inputValue(),'Existing');
await portfolio.locator('.rk-grpsel[data-sym="A"]').selectOption('Untouched');await portfolio.waitForFunction(()=>JSON.parse(localStorage.getItem('riskGroups')).A==='Untouched');assert.equal(await portfolio.locator('.rk-grpsel[data-sym="A"]').inputValue(),'Untouched');

const wf=await context.newPage();wf.on('pageerror',e=>errors.push(e.message));await wf.goto(`${base}/workflow.html`);await wf.locator('[data-demo]').click();await wf.locator('[data-node="risk"]').click();await wf.locator('#rk-risk').waitFor();
assert.equal(await wf.locator('#rk-edge').count(),0);assert.equal(await wf.locator('#rk-invalid').count(),0);assert.equal(await wf.locator('#rk-eq').count(),0);assert.equal(await wf.locator('#rk-entry').count(),0);assert.equal(await wf.locator('#rk-out').count(),0);
assert.equal(await wf.locator('[name="f.lossBudget"]').count(),0);assert.equal(await wf.locator('#design-plan-selector').count(),0);

await wf.locator('#save-risk-snapshot').click();await wf.locator('#rk-risk').waitFor();
let saved=await wf.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0]);
assert.equal(JSON.parse(saved.accountRiskSnapshot).policy.account_equity,10000);

await portfolio.locator('#ps-equity').fill('12000');await portfolio.locator('#ps-equity').blur();
await wf.waitForFunction(()=>JSON.parse(localStorage.getItem('riskPolicy')).account_equity===12000);
await wf.locator('#save-risk-snapshot').click();
saved=await wf.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0]);
assert.equal(JSON.parse(saved.accountRiskSnapshot).policy.account_equity,12000);

await wf.locator('#rk-risk').evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
await wf.waitForFunction(()=>JSON.parse(localStorage.getItem('riskPolicy')).bundles.Existing.risk_pct===3);
await portfolio.reload();await portfolio.locator('#ps-risk').waitFor();assert.equal(await portfolio.locator('#ps-risk').inputValue(),'3');
const historical=saved.events.at(-2).id;
await wf.locator('details.nebula-context').evaluate(el=>{el.open=true;});
await wf.locator(`[data-replay="${historical}"]`).click();await wf.locator('#rk-risk').waitFor();
assert.equal(await wf.locator('#rk-risk').inputValue(),'2');assert.equal(await wf.locator('#rk-risk').isDisabled(),true);assert.equal(await wf.locator('#rk-edge').count(),0);assert.equal(await wf.locator('#rk-eq').count(),0);
await wf.getByRole('button',{name:'返回当前版本'}).click();await wf.locator('#rk-risk').waitFor();assert.equal(await wf.locator('#rk-risk').inputValue(),'3');
await wf.reload();await wf.locator('[data-node="risk"]').click();await wf.locator('#rk-risk').waitFor();assert.equal(await wf.locator('#rk-risk').inputValue(),'3');
await wf.setViewportSize({width:390,height:844});assert.equal(await wf.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
assert.equal(writes.length,0);assert.deepEqual(errors,[]);
console.log('PASS: Portfolio sizing calculator, manual heatmap Thesis selection, shared equity, Risk Budget field removal, readonly history, reload, mobile, no remote writes/errors');await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
