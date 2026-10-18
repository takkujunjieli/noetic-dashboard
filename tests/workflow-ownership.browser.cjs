const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const base=process.env.DASHBOARD_URL||'http://127.0.0.1:8642';
(async()=>{
 const m=await import('../assets/workflow-model.mjs');
 const c=m.createCase({title:'Memory'});c.activeThesis=true;
 const id=m.savePlan(c,null,'MU',{structureVersion:1,template:'stock',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{underlying:'MU',type:'stock',side:'long',qty:100,entry:100,underlyingPrice:100}]});
 m.saveNode(c,'returns',{scenarioVersion:1,daysForward:0,scenarios:['bull','base','bear'].map((id,i)=>({id,name:id,probability:[55,0,45][i],moves:{[c.design.selectedId]:{priceMove:[20,0,-20][i],ivChange:0}}}))});
 c.design.allocation={method:'risk-budget-kelly',inAction:true,at:'2026-10-17T12:00:00Z',items:[{bundleId:id,name:'MU',underlying:'MU',fraction:.25,referencePrice:100,stopPrice:95}]};
 const pf={updated_at:'2026-10-17T12:00:00Z',accounts:[{id:'test',label:'Test',equity:10000}],positions:[{account:'test',sym:'MU',kind:'equity',qty:10,price:100,avg_cost:90,mkt_value:1000,pnl:100,pnl_pct:.11}],transactions:[]};
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const ctx=await browser.newContext(),page=await ctx.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(store=>{localStorage.setItem('research-desk.workflow.v1',JSON.stringify(store));localStorage.setItem('riskGroups',JSON.stringify({MU:'Wrong legacy owner'}));},{version:1,cases:[c]});
  await ctx.route('https://api.github.com/**',r=>{if(r.request().method()!=='GET')writes.push(r.request().method());return r.abort();});
  await ctx.route('**/config/risk_policy.json*',r=>r.fulfill({json:{account_equity:10000,portfolio:{max_total_heat_pct:15},bundles:{Legacy:{risk_pct:2,total_risk_pct:6,atr_mult:2}},assignments:{MU:'Legacy'}}}));
  await ctx.route('**/data/**',r=>{const p=new URL(r.request().url()).pathname;return p.endsWith('/portfolio.json')?r.fulfill({json:pf}):p.endsWith('/atr.json')?r.fulfill({json:{atr14:{MU:2}}}):r.fulfill({status:404,body:'fixture has no data'});});
  await page.goto(base+'/portfolio.html');
  const table=page.locator('#risk-expo');
  await table.getByRole('link',{name:'Memory',exact:true}).waitFor();
  assert.equal(await table.locator('select').count(),0);
  const ownerLink=table.getByRole('link',{name:'Memory'});assert.equal(await ownerLink.getAttribute('href'),`workflow.html?node=construction#${c.id}`);
  assert.match(await ownerLink.getAttribute('title'),/In Action/); // Budget node is pending: actual allocation is authoritative.
  assert.doesNotMatch(await table.innerText(),/Wrong legacy owner/);
  const row=table.locator('tr').nth(1);
  assert.equal((await row.locator('td').last().innerText()).trim(),'+15.0');
  const writer=await ctx.newPage();await ctx.route('**/ownership-writer',r=>r.fulfill({body:'<!doctype html><title>Isolated storage writer</title>',contentType:'text/html'}));await writer.goto(base+'/ownership-writer');
  const update=cases=>writer.evaluate(cases=>localStorage.setItem('research-desk.workflow.v1',JSON.stringify({version:1,cases})),cases);
  c.design.allocation.items[0].eligible=false;c.design.allocation.items[0].exclusionReason='独立预期收益非正且 Kelly 权重为 0';c.design.allocation.items[0].fraction=0;await update([c]);
  const excluded=table.locator('.sc-tk .ff-warning');await excluded.waitFor();assert.match(await excluded.getAttribute('title'),/独立预期收益非正/);
  delete c.design.allocation.items[0].eligible;delete c.design.allocation.items[0].exclusionReason;c.design.allocation.items[0].fraction=.25;await update([c]);await excluded.waitFor({state:'detached'});
  c.title='Renamed';await update([c]);await table.getByRole('link',{name:'Renamed',exact:true}).waitFor();
  const duplicate=structuredClone(c);duplicate.id='duplicate';duplicate.title='Other';await update([c,duplicate]);
  await table.getByText('归属冲突',{exact:true}).waitFor();assert.equal(await table.getByRole('link').count(),0);assert.equal((await row.locator('td').last().innerText()).trim(),'—');
  c.design.allocation.items[0].fraction=0;await update([c]);await table.getByText('−10.0',{exact:true}).waitFor();
  c.activeThesis=false;await update([c]);const unassigned=table.locator('select.rk-grpsel');await unassigned.waitFor();assert.equal(await unassigned.isDisabled(),true);assert.equal(await unassigned.inputValue(),'');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  console.log('PASS: Workflow owner link, no manual selector, actual In Action badge, share target, rename/storage refresh, duplicate rejection, zero target, offline cleanup; no page errors or remote writes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
