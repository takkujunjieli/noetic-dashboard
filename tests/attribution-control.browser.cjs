const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch({headless:true,channel:'chrome'}),ctx=await b.newContext(),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const base=process.env.DASHBOARD_URL||'http://127.0.0.1:8642';let fail=false,reads=0;
 await ctx.route('**/data/pnl.json*',r=>{reads++;return fail?r.fulfill({status:500,body:'offline'}):r.fulfill({json:{updated_at:'2026-09-22T12:00:00Z',as_of:'2026-09-22',accounts:{test:{windows:{ytd:{trades:[{d:'2026-09-21',s:'A',k:'equity',p:123}]}}}}}});});
 await p.goto(base+'/workflow.html');
 const id=await p.evaluate(async()=>{
  const m=await import('./assets/workflow-model.mjs'),l=await import('./assets/position-link.mjs');
  const c=m.createCase({title:'Attribution fixture',symbol:'A',horizon:'2030-01-01'});
  const src=l.normalizePortfolio({updated_at:'2026-09-20T12:00:00Z',accounts:[{id:'test',label:'Test',broker:'rh',source_updated_at:'2026-09-20T12:00:00Z'}],positions:[{account:'test',broker:'rh',sym:'A',kind:'equity',qty:10,avg_cost:10,price:12}]});
  const binding=l.bindingFromSelection(c,[c],src,[{key:src.rows[0].key,mode:'all',qty:10}]);
  const data=l.reconcilePositions(c,[c],src,binding);data.binding.rules[0].closed=true;data.binding.rules[0].closedReason='confirmed_exit';data.positions=[];data.notes='closed';m.saveNode(c,'positions',data,'fixture');c.nodes.positions.state='running';m.record(c,'transition','positions','closed fixture');
  m.validateStore({version:1,cases:[c]});localStorage.setItem(m.KEY,JSON.stringify({version:1,cases:[c]}));return c.id;
 });
 await p.goto(base+'/workflow.html?node=attribution#'+id);
 await p.locator('[data-attr-start]').fill('2026-09-01');await p.locator('[data-attr-end]').fill('2026-09-22');await p.locator('[data-attr-load]').click();await p.locator('[data-attr-save]').waitFor();assert.match(await p.locator('[data-attr-preview]').textContent(),/123/);
 await p.locator('[name="f.realized"]').fill('120');await p.locator('[data-attr-save]').click();assert.equal(await p.locator('[name="f.realized"]').inputValue(),'120');assert.match(await p.locator('[data-saved-evidence]').textContent(),/123/);
 fail=true;await p.locator('[data-attr-load]').click();await p.waitForFunction(()=>document.querySelector('[data-attr-status]').textContent.includes('读取失败'));assert.match(await p.locator('[data-saved-evidence]').textContent(),/123/);
 await p.locator('[name="f.reconciliation"]').fill('Account reference 123; confirmed thesis net 120 after costs');await p.locator('[name="f.outcome"]').fill('target reached');await p.locator('[name="f.lesson"]').fill('review lesson');await p.getByRole('button',{name:'保存节点',exact:true}).click();
 await p.locator('[data-transition="running"]').click();await p.locator('#archive-case').click();
 const before=reads;await p.reload();assert.equal(reads,before);assert.equal(await p.locator('[data-attr-load]').count(),0);assert.match(await p.locator('[data-saved-evidence]').textContent(),/123/);
 const html=await p.evaluate(async()=>{const {workflowArchiveHTML}=await import('./assets/attribution-journal.js');return workflowArchiveHTML();});assert.match(html,/review lesson/);assert.match(html,/node=attribution/);
 await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('#wf-attribution-control').count(),1);assert.deepEqual(errors,[]);console.log('Attribution browser: snapshot, manual net preservation, failure retention, archive reload and Journal link passed');await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
