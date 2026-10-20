const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

// Serve only application code through Playwright routes. No live server, private
// data, user browser profile, or external writes are used by this test.
(async()=>{
 const m=await import('../assets/workflow-model.mjs');
 const {riskBudgetAllocation}=await import('../assets/kelly-allocation.mjs');
 const c=m.createCase({title:'Diversification fixture'}),atr={A:2,B:4};
 const ids=['A','B','C'].map(underlying=>m.savePlan(c,null,underlying,{structureVersion:1,template:'stock',candidate:{underlying,instrument:'stock',referenceCapital:10000},legs:[{underlying,type:'stock',side:'long',qty:100,entry:100,underlyingPrice:100}]}));
 m.saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:['bull','base','bear'].map((id,i)=>({id,name:id,probability:[60,0,40][i],moves:{[ids[0]]:{priceMove:[20,0,-4][i],ivChange:0},[ids[1]]:{priceMove:[10,0,-8][i],ivChange:0},[ids[2]]:{priceMove:-10,ivChange:0}}}))});
 m.saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:2,atrStopMultiple:2.5});
 m.setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,atr));
 delete c.design.allocation.weightingMethod;
 m.record(c,'旧权重测试快照','risk','fixture');
 const frozen=JSON.parse(JSON.stringify(c.design.allocation)),root=path.resolve(__dirname,'..');
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(({key,store})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(store));},{key:m.KEY,store:{version:m.VERSION,cases:[c]}});
  await ctx.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){writes.push(request.method()+' '+url.pathname);return route.abort();}
   if(url.origin!=='http://127.0.0.1:8765')return route.abort();
   if(url.pathname==='/data/atr.json')return route.fulfill({json:{atr14:atr}});
   if(url.pathname!=='/workflow.html'&&!url.pathname.startsWith('/assets/'))return route.fulfill({status:404,body:'No fixture data'});
   const file=path.resolve(root,'.'+url.pathname);
   if(!file.startsWith(root+path.sep))return route.abort();
   try{return await route.fulfill({body:await fs.readFile(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':'application/octet-stream'});}catch{return route.fulfill({status:404,body:'Missing fixture asset'});}
  });
  const openRisk=async()=>{await page.locator(`[data-nebula="${c.id}"]`).click();await page.locator(`[data-star="${c.id}:risk"]`).click();};
  await page.goto(`http://127.0.0.1:8765/workflow.html#${c.id}`);await openRisk();
  const tilt=page.locator('[name="kelly.kellyTiltPct"]');
  await tilt.waitFor();assert.equal(await tilt.inputValue(),'25');
  await page.getByText(/当前 In Action 仍使用旧权重/).waitFor();
  const read=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),m.KEY);
  assert.deepEqual((await read()).cases[0].design.allocation,frozen);
  assert.deepEqual(await page.locator('.kelly-allocation-table tbody tr td:nth-child(5)').allTextContents(),['62.5%','37.5%','0%']);
  await page.getByText('⚠ Excluded',{exact:true}).waitFor();assert.match(await page.locator('.allocation-exclusion-reason').innerText(),/修改参数或从 Portfolio Construction 剔除/);
  await tilt.fill('26');await tilt.press('Tab');
  await page.locator('#activate-allocation').click();
  assert.match(await page.locator('#notice').innerText(),/Kelly Tilt/);
  assert.deepEqual((await read()).cases[0].design.allocation,frozen);
  await tilt.fill('0');await tilt.press('Tab');
  assert.deepEqual(await page.locator('.kelly-allocation-table tbody tr td:nth-child(5)').allTextContents(),['50%','50%','0%']);
  await page.locator('#activate-allocation').click();
  const saved=(await read()).cases[0].design.allocation;
  assert.equal(saved.weightingMethod,'equal-atr-risk-kelly-v1',await page.locator('#notice').innerText());assert.equal(saved.kellyTiltPct,0);
  assert.deepEqual(saved.items.map(x=>x.riskShare),[.5,.5,0]);assert.equal(saved.items[2].eligible,false);
  assert.ok(Math.abs(saved.items[0].weight-2/3)<1e-9);
  m.validateStore(await read());
  await page.reload();await openRisk();await page.locator('[name="kelly.kellyTiltPct"]').waitFor();
  assert.equal(await page.locator('[name="kelly.kellyTiltPct"]').inputValue(),'0');
  assert.deepEqual((await read()).cases[0].design.allocation,saved);
  assert.equal(await page.getByText(/当前 In Action 仍使用旧权重/).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  console.log('PASS: legacy snapshot preserved, live risk-share preview, invalid tilt rejected, explicit activation and reload persisted without external writes');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
