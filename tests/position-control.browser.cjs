const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const base=process.env.DASHBOARD_URL||'http://127.0.0.1:8642';
(async()=>{const b=await chromium.launch({headless:true,channel:'chrome'}),ctx=await b.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
let bad=false,pf={updated_at:'2026-09-22T15:00:00Z',accounts:[{id:'test',label:'Test',broker:'rh',source_updated_at:'2026-09-22T14:00:00Z'}],positions:[{account:'test',broker:'rh',sym:'A',kind:'equity',qty:100,avg_cost:10,price:12},{account:'test',broker:'rh',sym:'A 2030-01-01 15C',kind:'option',qty:2,avg_cost:100,price:150}]};
await ctx.route('**/data/portfolio.json*',r=>bad?r.fulfill({status:500,body:'offline'}):r.fulfill({json:pf}));
await ctx.route('**/api.github.com/**',r=>r.abort());
await p.goto(`${base}/workflow.html`);await p.locator('[data-demo]').click();await p.locator('[data-node="positions"]').click();await p.locator('[data-position-key]').first().waitFor();
await p.locator('[data-position-key]').first().check();await p.locator('[data-position-key]').nth(1).check();await p.locator('[data-position-reason]').fill('两条持仓表达当前 thesis');await p.locator('[data-position-bind]').click();
await p.waitForFunction(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.positions.data.source==='portfolio');
let saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0]);assert.equal(saved.nodes.positions.data.positions.length,2);assert.equal(saved.nodes.positions.data.positions[1].entry,1);assert.equal(await p.locator('#add-leg').count(),0);
const initial=saved.events.at(-1).id;
await p.locator('[name="f.exitRules"]').fill('假设失效则退出');await p.getByRole('button',{name:'保存节点',exact:true}).click();await p.locator('[data-transition="running"]').click();await p.waitForFunction(()=>document.querySelector('[data-node="positions"]').textContent.includes('running'));
// Source refresh updates quantity, cost and price, not the trading plan.
pf.accounts[0].source_updated_at='2026-09-23T14:00:00Z';pf.updated_at='2026-09-23T14:01:00Z';pf.positions[0].qty=120;pf.positions[0].avg_cost=11;pf.positions[0].price=14;
await p.locator('[data-position-refresh]').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.positions.data.positions[0].qty===120);
// Failed reads retain the saved snapshot.
bad=true;await p.locator('[data-position-refresh]').click();await p.waitForFunction(()=>document.querySelector('.position-status').textContent.includes('保留'));assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.positions.data.positions[0].qty),120);bad=false;
// Missing holdings require reconciliation, never automatic closure.
pf.accounts[0].source_updated_at='2026-09-24T14:00:00Z';pf.updated_at='2026-09-24T14:01:00Z';pf.positions=[];await p.locator('[data-position-refresh]').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.positions.data.sync.status==='attention');assert.equal(await p.locator('[data-transition="closed"]').count(),0);
p.on('dialog',d=>d.accept('已核对券商账户，确认平仓'));
await p.locator('[data-position-close]').first().click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.positions.data.positions.length===1);
await p.locator('[data-position-close]').first().click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.positions.data.positions.length===0);
await p.locator('[name="f.notes"]').fill('全部平仓并核对');await p.getByRole('button',{name:'保存节点',exact:true}).click();await p.locator('[data-transition="pending"]').click();
await p.locator(`[data-replay="${initial}"]`).click();assert.match(await p.locator('#wf-position-control').textContent(),/100/);assert.equal(await p.locator('[data-position-refresh]').count(),0);
await p.getByRole('button',{name:'返回当前版本'}).click();await p.reload();await p.locator('[data-node="positions"]').click();await p.locator('[data-position-refresh]').waitFor();
await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
if(process.env.SCREENSHOT_PATH)await p.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});console.log('PASS: account/option binding, normalized premium, read-only linked legs, active lifecycle, quantity/cost/price refresh, read failure retention, missing-position reconciliation, explicit exit, frozen replay, reload and mobile');await b.close();})().catch(e=>{console.error(e);process.exit(1)});
