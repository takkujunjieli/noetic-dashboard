const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const ctx=await browser.newContext(),page=await ctx.newPage(),errors=[],downloads=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d));
  const base=process.env.DASHBOARD_URL||'http://127.0.0.1:8643';let fail=false,sourceReads=0;
  await ctx.route('https://api.github.com/**',r=>r.abort());
  await ctx.route('**/api/transaction-history',r=>{
   sourceReads++;return fail?r.fulfill({status:500,json:{error:'source offline'}}):r.fulfill({json:{version:1,generated_at:'2026-10-04T00:00:00Z',sources:[],transactions:[
    {ts:'2026-07-01T14:00:00Z',sym:'AMD 2026-08-21 150C',kind:'option',qty:2,price:123,side:'buy',state:'filled',account:'one',broker:'rh',execution_id:'fixture-fill'},
    {ts:'2026-07-01T15:00:00Z',sym:'INTC',kind:'equity',qty:1,price:40,side:'sell',state:'filled',account:'two',broker:'rh'},
    {ts:'2026-07-02T14:00:00Z',sym:'AMD',kind:'equity',qty:1,price:20,side:'buy',state:'filled',account:'one',broker:'rh'}
   ]}});
  });
  await page.goto(base+'/workflow.html');
  const id=await page.evaluate(async()=>{
   const m=await import('./assets/workflow-model.mjs'),c=m.createCase({title:'Transaction fixture',symbol:'UNRELATED'});
   c.linkedSymbols=['INTC'];
   const items=['AMD','INTC'].map(name=>({bundleId:m.savePlan(c,null,'',{structureVersion:1,template:'stock',candidate:{underlying:name,instrument:'stock',referenceCapital:100},evaluationDate:'',legs:[]}),name,fraction:name==='AMD'?.5:0}));
   c.design.allocation={method:'multivariate-kelly',inAction:true,at:'2026-10-01T12:00:00Z',items};m.record(c,'fixture allocation','risk','');
   localStorage.setItem(m.KEY,JSON.stringify({version:1,cases:[c]}));return c.id;
  });
  const api=base+'/api/thesis-transactions/'+id;
  await page.goto(base+'/workflow.html?node=attribution#'+id);
  await page.waitForFunction(()=>!document.querySelector('[data-tx-fields]').disabled);
  assert.equal(await page.locator('[data-tx-end-time]').count(),0);
  assert.match(await page.locator('[data-tx-fields]').textContent(),/结束日期 · 24:00 ET/);
  await page.locator('[data-tx-start]').fill('2026-07-01');await page.locator('[data-tx-end]').fill('2026-07-02');
  await page.locator('[data-tx-generate]').click();await page.waitForFunction(()=>document.querySelector('[data-tx-file] tbody')?.rows.length===3);
  let response=await page.request.get(api),body=await response.json();const path=body.path;
  assert.equal(body.file.transaction_count,3);assert.equal(body.file.range.endTime,'24:00');assert.deepEqual(body.file.thesis.underlyings,['AMD','INTC']);assert.equal(body.file.transactions[0].execution_id,'fixture-fill');
  assert.ok(path.endsWith('/'+id+'.json'));assert.deepEqual(downloads,[]);
  assert.equal(await page.evaluate(()=>!!JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.attribution.data.transactionFile),false);
  const before=sourceReads;await page.reload();await page.waitForFunction(()=>document.querySelector('[data-tx-file] tbody')?.rows.length===3);assert.equal(sourceReads,before);
  await page.locator('[data-tx-end]').fill('2026-07-01');await page.locator('[data-tx-query]').click();await page.waitForFunction(()=>document.querySelector('[data-tx-file] tbody')?.rows.length===2);assert.equal(sourceReads,before);
  // Concurrent agent writes the same file. The UI must not overwrite the unseen version.
  body.file.transactions[0].price=777;
  let changed=await page.request.put(api,{data:body.file,headers:{'If-Match':response.headers().etag}});assert.ok(changed.ok());
  await page.locator('[data-tx-generate]').click();await page.waitForFunction(()=>document.querySelector('[data-tx-status]').textContent.includes('其他页面或 agent'));
  await page.locator('[data-tx-query]').click();await page.waitForFunction(()=>document.querySelector('[data-tx-file]').textContent.includes('777'));
  await page.locator('[data-tx-generate]').click();await page.waitForFunction(()=>document.querySelector('[data-tx-file]')?.textContent.includes('已保存 2 条'));
  response=await page.request.get(api);body=await response.json();assert.equal(body.path,path);assert.equal(body.file.transaction_count,2);
  fail=true;await page.locator('[data-tx-generate]').click();await page.waitForFunction(()=>document.querySelector('[data-tx-status]').textContent.includes('source offline'));assert.equal((await (await page.request.get(api)).json()).file.transaction_count,2);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-tx-delete]').click();await page.waitForFunction(()=>document.querySelector('[data-tx-file]').textContent.includes('尚未保存'));
  assert.equal((await (await page.request.get(api)).json()).file,null);
  fail=false;await page.locator('[data-tx-generate]').click();await page.waitForFunction(()=>document.querySelector('[data-tx-file] tbody')?.rows.length===2);
  await page.locator('#archive-case').click();await page.reload();await page.waitForFunction(()=>document.querySelector('[data-tx-file] tbody')?.rows.length===2);assert.equal(await page.locator('[data-tx-generate]').count(),0);
  await page.setViewportSize({width:390,height:844});assert.deepEqual(errors,[]);assert.deepEqual(downloads,[]);
  // Fixture server uses a temp private directory; remove this test's single file.
  response=await page.request.get(api);assert.ok((await page.request.delete(api,{headers:{'If-Match':response.headers().etag}})).ok());
  console.log('Transaction browser: real single-file CRUD, full frozen-allocation scope, no downloads, persisted queries, concurrent agent edits, failures and archive passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
