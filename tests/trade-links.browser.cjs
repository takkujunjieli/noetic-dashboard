const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const base=process.env.DASHBOARD_URL||'http://127.0.0.1:8643';
  await page.route('https://api.github.com/**',route=>route.request().method()==='GET'?route.continue():route.abort());
  await page.goto(base+'/trading.html');
  const data=await page.evaluate(async()=>{
   const m=await import('./assets/workflow-model.mjs?v=20261010-links');
   const c=m.createCase({title:'Isolated link browser test',symbol:'INTC'});
   localStorage.setItem(m.KEY,JSON.stringify({version:m.VERSION,cases:[c]}));
   const journal=await (await fetch('/api/trade-journal')).json();
   return {caseId:c.id,tradeId:journal.fills[0].trade_id};
  });
  await page.goto(base+`/trading.html?sym=INTC&tf=1d&trade=${encodeURIComponent(data.tradeId)}&date=2026-10-07`);
  const editor=page.locator('[data-link-editor]');
  await editor.locator('[data-link-case]').waitFor({timeout:30000});
  await editor.locator('[data-link-case]').selectOption(data.caseId);
  await editor.locator('[data-link-role]').selectOption('hedge');
  await editor.locator('[data-link-fill]').fill('6');
  await editor.locator('[data-link-save]').click();
  await editor.locator('[data-edit]').waitFor();
  assert.match(await editor.innerText(),/已保存/);
  await editor.locator('[data-edit]').click();
  await editor.locator('[data-link-fill]').fill('4');
  await editor.locator('[data-link-save]').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.positions.data.executionLinks[0].allocations[0].quantity===4);
  const initial=await page.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0]);
  assert.equal(initial.positionNodeVersion,2);
  assert.equal(initial.events.filter(e=>e.node==='positions').length,2);
  await page.goto(base+`/workflow.html?node=positions#${data.caseId}`);
  await page.locator('#wf-monitor-trades tbody tr').waitFor();
  assert.match(await page.locator('#wf-monitor-trades').innerText(),/103.2/);
  assert.match(await page.locator('#wf-monitor-trades').innerText(),/对冲/);
  await page.locator('#wf-monitor-trades tbody a').click();
  await editor.locator('[data-unlink]').waitFor({timeout:30000});
  await editor.locator('[data-unlink]').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.positions.data.executionLinks[0].status==='unlinked');
  const final=await page.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0]);
  assert.equal(final.events.filter(e=>e.node==='positions').length,3);
  assert.equal(final.events.find(e=>e.node==='positions').snapshot.nodes.positions.data.executionLinks[0].status,'active');
  // Recover a missing local projection using durable server events.
  await page.evaluate(async()=>{
   const m=await import('./assets/workflow-model.mjs?v=20261010-links');const c=m.createCase({title:'replacement'});
   const old=JSON.parse(localStorage.getItem(m.KEY)).cases[0];
   c.id=old.id;c.events=[];c.revision=0;m.record(c,'创建','hypothesis','recovery fixture');
   localStorage.setItem(m.KEY,JSON.stringify({version:m.VERSION,cases:[c]}));
  });
  await page.goto(base+`/workflow.html?node=positions#${data.caseId}`);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0].nodes.positions.data.executionLinks?.[0]?.status==='unlinked');
  assert.deepEqual(errors,[]);
  console.log('PASS: card link/edit/unlink, Monitor table, bidirectional navigation, frozen history, crash recovery, no page errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
