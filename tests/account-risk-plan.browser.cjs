const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

// Real Portfolio UI, isolated browser storage and synthetic data only.
(async()=>{
 const model=await import('../assets/workflow-model.mjs'),kelly=await import('../assets/kelly-allocation.mjs'),structure=await import('../assets/trade-structure.mjs');
 const cases=['A','B'].map(symbol=>{
  const c=model.createCase({title:`Thesis ${symbol}`});c.activeThesis=true;
  const id=model.savePlan(c,null,symbol,{structureVersion:1,template:'stock',candidate:{underlying:symbol,referenceCapital:10000},legs:[{...structure.newStructureLeg('stock','long',100),underlying:symbol,entry:100,underlyingPrice:100}]});
  model.saveNode(c,'returns',{scenarioVersion:3,daysForward:0,scenarios:[['bull',55,20],['base',0,0],['bear',45,-20]].map(([id,p,move])=>({id,name:id,probability:p,moves:{[c.design.plans[0].id]:{priceMove:move,ivChange:0}}}))});
  model.saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:10,atrStopMultiple:2.5});model.setActiveAllocation(c,kelly.riskBudgetAllocation(c,c.nodes.risk.data,{[symbol]:2}));return c;
 });
 let unknown=false;
 const pf={updated_at:'2026-10-19T12:00:00Z',source_updated_at:'2026-10-19T12:00:00Z',accounts:[{id:'one',label:'One',equity:60000},{id:'two',label:'Two',equity:40000}],positions:[{account:'one',kind:'equity',sym:'A',qty:100,price:100,avg_cost:100,mkt_value:10000},{account:'two',kind:'equity',sym:'B',qty:50,price:100,avg_cost:100,mkt_value:5000}],transactions:[]};
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1100}}),page=await ctx.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(store=>{if(!localStorage.getItem('research-desk.workflow.v1'))localStorage.setItem('research-desk.workflow.v1',JSON.stringify(store));},{version:1,cases});
  await ctx.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()!=='GET'){writes.push(req.method()+' '+url.pathname);return route.abort();}
   if(url.hostname==='unpkg.com')return route.fulfill({body:'window.LightweightCharts={CrosshairMode:{Normal:0},LineStyle:{Dotted:1,Dashed:2}};',contentType:'text/javascript'});
   if(url.origin!=='http://127.0.0.1:8765')return route.abort();
   if(url.pathname==='/data/portfolio.json')return route.fulfill({json:{...pf,positions:[...pf.positions,...(unknown?[{account:'one',kind:'equity',sym:'UNKNOWN',qty:10,price:10,avg_cost:10,mkt_value:100}]:[])]}});
   if(url.pathname==='/data/atr.json')return route.fulfill({json:{updated:'2026-10-19',atr14:{A:2,B:2}}});
   if(url.pathname==='/config/risk_policy.json')return route.fulfill({json:{portfolio:{max_total_heat_pct:6},bundles:{}}});
   if(url.pathname.startsWith('/data/')||url.pathname.startsWith('/api/')||url.pathname.startsWith('/config/'))return route.fulfill({status:404,body:'No fixture data'});
   if(url.pathname==='/risk-fixture')return route.fulfill({body:'<!doctype html><html><head><link rel="stylesheet" href="/assets/style.css"><link rel="stylesheet" href="/assets/workflow.css"></head><body><div id="risk"></div></body></html>',contentType:'text/html'});
   const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))return route.abort();
   try{return route.fulfill({body:await fs.readFile(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':'application/octet-stream'});}catch{return route.fulfill({status:404,body:'Missing fixture asset'});}
  });
  await page.goto('http://127.0.0.1:8765/portfolio.html');
  await page.locator('#account-budget-table').waitFor();
  const first=page.locator('#account-budget-table tbody tr').first();
  assert.deepEqual(await first.locator('td').allTextContents(),['Thesis A','$2,000 · 2.00%','25.00%','15.00%','$3,000 · 3.00%','账户风险预算缩放至 60.0%']);
  assert.match(await page.locator('#risk-heat').innerText(),/实际持仓 · 当前已用风险/);assert.match(await page.locator('#risk-heat').innerText(),/目标方案 · 约束后风险/);
  assert.equal(await page.locator('#risk-heat .wb-statbar').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),4);
  await page.locator('#account-bundle-targets').evaluate(el=>el.closest('details').open=true);
  await page.screenshot({path:'/private/tmp/account-risk-plan-desktop.png',fullPage:true});
  const frozen=await page.evaluate(()=>localStorage.getItem('research-desk.workflow.v1'));
  await page.locator('#rk-maxheat').fill('4');await page.locator('#rk-maxheat').press('Tab');
  await page.waitForFunction(()=>document.querySelector('#account-budget-table tbody tr td:nth-child(4)').textContent==='10.00%');
  assert.equal(await page.evaluate(()=>localStorage.getItem('research-desk.workflow.v1')),frozen);
  await page.locator('#pf-acct').selectOption('one');
  await page.waitForFunction(()=>document.querySelector('#account-budget-table tbody tr td:nth-child(2)').textContent.includes('3.33%'));
  assert.match(await page.locator('#risk-heat').innerText(),/One/);
  await page.locator('#rk-maxheat').fill('0');await page.locator('#rk-maxheat').press('Tab');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('riskMaxHeat'))),4);
  unknown=true;await page.reload();await page.getByText(/无法完成预算检查/).waitFor();
  assert.equal(await page.locator('#account-budget-table tbody tr td:nth-child(4)').first().innerText(),'—');
  unknown=false;await page.evaluate(()=>{const store=JSON.parse(localStorage.getItem('research-desk.workflow.v1'));delete store.cases[0].design.allocation.sizingMethod;localStorage.setItem('research-desk.workflow.v1',JSON.stringify(store));});
  await page.reload();await page.getByText(/旧冻结预算/).first().waitFor();
  assert.equal(await page.locator('#account-budget-table tbody tr td:nth-child(4)').first().innerText(),'—');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#risk-heat .wb-statbar').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Portfolio mobile must scroll tables locally');
  await page.screenshot({path:'/private/tmp/account-risk-plan-mobile.png',fullPage:true});
  await page.goto('http://127.0.0.1:8765/risk-fixture');
  await page.evaluate(async c=>{const {kellyAllocationView,kellyPolicyForm}=await import('/assets/kelly-allocation.js');document.querySelector('#risk').innerHTML=kellyPolicyForm(c.nodes.risk.data)+kellyAllocationView(c,c.nodes.risk.data,{atr:{A:2}});},cases[0]);
  assert.match(await page.locator('#risk').innerText(),/Half Kelly Cap/);assert.doesNotMatch(await page.locator('#risk').innerText(),/Full Kelly/);
  await page.screenshot({path:'/private/tmp/half-kelly-risk-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  console.log('PASS: real Portfolio account scope, shared budget, scaled targets, actual/target separation, frozen history, missing risk, legacy refresh and mobile; Risk Budget has no Full Kelly UI; no external writes');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
