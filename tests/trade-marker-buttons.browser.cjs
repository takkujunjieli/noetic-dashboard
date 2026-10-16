const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  const annotationWrites=[];
  let annotationState={"trade-buy":{trade_id:"trade-buy",reason:"分批建仓"}};
  page.on('pageerror',e=>errors.push(e.message));
 const fills=[
  {fill_id:'circle-buy',trade_id:'trade-buy',underlying:'INTC',symbol:'INTC',timestamp:'2026-10-06T14:00:00Z',kind:'equity',side:'buy',qty:2,price:103.25,broker:'rh',account:'takku-rh-2566',instrument:{}},
  {fill_id:'circle-sell-takku-1',trade_id:'trade-sell-takku-1',underlying:'INTC',symbol:'INTC',timestamp:'2026-10-06T14:00:00Z',kind:'equity',side:'sell_short',qty:4,price:359.6,broker:'rh',account:'takku-rh-2566',instrument:{}},
  {fill_id:'circle-sell-takku-2',trade_id:'trade-sell-takku-2',underlying:'INTC',symbol:'INTC',timestamp:'2026-10-06T14:01:00Z',kind:'equity',side:'sell_short',qty:2,price:359.6,broker:'rh',account:'takku-rh-2566',instrument:{}},
  {fill_id:'circle-sell-hui',trade_id:'trade-sell-hui',underlying:'INTC',symbol:'INTC',timestamp:'2026-10-06T14:02:00Z',kind:'equity',side:'sell',qty:1,price:361,broker:'rh',account:'rh-7159',instrument:{}},
  {fill_id:'circle-sell-moomoo',trade_id:'trade-sell-moomoo',underlying:'INTC',symbol:'INTC',timestamp:'2026-10-06T14:03:00Z',kind:'equity',side:'sell',qty:3,price:358,broker:'moomoo',account:'moomoo-8609',instrument:{}},
  {fill_id:'circle-option',trade_id:'trade-option',underlying:'INTC',symbol:'INTC 2026-11-06 120C',timestamp:'2026-10-06T14:00:00Z',kind:'option',side:'buy',qty:2,price:3.25,broker:'rh',account:'takku-rh-2566',instrument:{expiry:'2026-11-06',strike:120,right:'C',contract_details_complete:true}},
 ];
  await page.route('**/api/trade-journal',r=>r.fulfill({json:{fills,journal:{revision:1}}}));
  await page.route('**/api/trade-journal/import',r=>r.fulfill({json:{import:{inserted:0,duplicates:3,conflicts:0,invalid:0,sources:[]}}}));
  await page.route('**/api/trade-annotations',async r=>{
   if(r.request().method()==='PUT'){
    const payload=r.request().postDataJSON();annotationWrites.push(payload);
    for(const trade_id of payload.trade_ids){if(payload.reason.trim())annotationState[trade_id]={trade_id,reason:payload.reason};else delete annotationState[trade_id];}
    return r.fulfill({json:{revision:1,annotations:annotationState},headers:{ETag:'"saved"'}});
   }
   return r.fulfill({json:{annotations:annotationState},headers:{ETag:'"initial"'}});
  });
  await page.route('**/api/trade-links',r=>r.fulfill({json:{links:[],events:[],revision:0}}));
  const base=process.env.DASHBOARD_URL||'http://127.0.0.1:8642';
  await page.goto(base+'/trading.html?sym=INTC&tf=1d&date=2026-10-06&trade=trade-buy');
  await page.locator('#trade-note-card:not([hidden])').waitFor();
  await page.locator('[data-trade-close]').click();
  assert.equal(await page.locator('#trade-coverage-end').innerText(),'已回填至 2026-10-06 ET');
  assert.equal(await page.locator('#trade-backfill-start').count(),0);
  assert.equal(await page.locator('#trade-backfill-end').count(),0);
  assert.equal(await page.locator('#trade-backfill-run').count(),0);
  const syncButton=page.locator('#trade-sync');
  assert.equal(await syncButton.innerText(),'同步成交记录');
  await syncButton.click();
  await page.waitForFunction(()=>document.querySelector('#trade-import-status').textContent.startsWith('同步完成'));
  assert.match(await page.locator('#trade-import-status').innerText(),/新增 0 · 重复 3/);
  const markers=page.locator('.trade-marker-button:not([hidden])');
  await markers.first().waitFor();
  assert.deepEqual((await markers.allTextContents()).sort(),['B','O','S']);
  assert.equal(await markers.filter({hasText:/^B$/}).evaluate(el=>el.classList.contains('has-reason')),true);
  assert.equal(await markers.filter({hasText:/^S$/}).evaluate(el=>el.classList.contains('has-reason')),true);
  assert.equal(await markers.filter({hasText:/^O$/}).evaluate(el=>el.classList.contains('has-reason')),true);
  assert.match(await markers.filter({hasText:/^B$/}).evaluate(el=>getComputedStyle(el).boxShadow),/rgba\(74, 222, 128, 0\.9\)/);
  assert.equal(await markers.filter({hasText:/^S$/}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(252, 165, 165, 0.38)');
  assert.equal(await markers.filter({hasText:/^O$/}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(255, 255, 255, 0.45)');
  const buy=markers.filter({hasText:/^B$/});
  await page.mouse.move(0,0);await page.waitForTimeout(200);
  const normal=await buy.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius,transition:getComputedStyle(el).transitionDuration,width:el.offsetWidth,height:el.offsetHeight}));
  assert.equal(normal.bg,'rgba(134, 239, 172, 0.38)');assert.equal(normal.radius,'50%');assert.equal(normal.width,20);assert.equal(normal.height,20);assert.ok(normal.transition.split(', ').every(value=>value==='0.16s'));
  await buy.hover();await page.waitForTimeout(220);
  const hover=await buy.evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(hover,'rgba(74, 222, 128, 0.55)');
  const candleHighlight=page.locator('#trade-candle-highlight');
  assert.equal(await candleHighlight.isVisible(),true);
  const volumeHighlight=page.locator('#trade-volume-highlight');
  assert.equal(await volumeHighlight.isVisible(),true);
  const markerBox=await buy.boundingBox(),highlightBox=await candleHighlight.boundingBox();
  const volumeHighlightBox=await volumeHighlight.boundingBox();
  assert.ok(Math.abs((markerBox.x+markerBox.width/2)-(highlightBox.x+highlightBox.width/2))<2);
  assert.ok(Math.abs((markerBox.x+markerBox.width/2)-(volumeHighlightBox.x+volumeHighlightBox.width/2))<2);
  assert.ok(volumeHighlightBox.y>highlightBox.y);
  await page.mouse.down();await page.waitForTimeout(220);
  const pressed=await buy.evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(pressed,'rgba(34, 197, 94, 0.72)');
  await page.mouse.up();await page.locator('#trade-note-card:not([hidden])').waitFor();
  await page.mouse.move(0,0);await page.waitForTimeout(150);assert.equal(await candleHighlight.isVisible(),false);assert.equal(await volumeHighlight.isVisible(),false);
  assert.match(await page.locator('#trade-note-card').innerText(),/103.25/);
  assert.equal(await page.locator('[data-reason-label]').innerText(),'交易理由（已保存，可编辑）');
  assert.equal(await page.locator('#trade-note-card textarea').inputValue(),'分批建仓');
  await page.locator('[data-trade-close]').click();
  await markers.filter({hasText:/^S$/}).click();await page.locator('#trade-note-card:not([hidden])').waitFor();
  assert.equal(await page.locator('.trade-note-head b').innerText(),'INTC');
  assert.equal(await page.locator('.trade-note-head').innerText(),'INTC\n×');
  assert.equal(await page.locator('.trade-account-summary li').count(),3);
  const takkuSummary=page.locator('.trade-account-summary li[data-account-tone="takku"]');
  assert.match(await takkuSummary.innerText(),/2026-10-06\nsell_short · 6 @ 359.60 · takku-rh-2566/);
  assert.equal(await takkuSummary.evaluate(el=>getComputedStyle(el).color),'rgb(125, 211, 252)');
  assert.equal(await page.locator('.trade-account-summary li[data-account-tone="hui"]').evaluate(el=>getComputedStyle(el).color),'rgb(192, 132, 252)');
  assert.match(await page.locator('.trade-account-summary li[data-account-tone="hui"]').innerText(),/hui-rh-7159/);
  assert.equal(await page.locator('.trade-account-summary li[data-account-tone="moomoo"]').evaluate(el=>getComputedStyle(el).color),'rgb(251, 146, 60)');
  assert.equal(await page.locator('#trade-note-card textarea').count(),1);
  assert.equal(await page.locator('#trade-note-card textarea').inputValue(),'分批建仓');
  assert.equal(await page.locator('#trade-note-card [data-link-group-editor]').count(),1);
  assert.equal(await page.locator('#trade-note-card').getByText('Workflow 关联',{exact:true}).count(),1);
  await page.locator('#trade-note-card textarea').fill('共同交易理由');
  await page.locator('[data-trade-save]').click();
  await page.waitForFunction(()=>document.querySelector('#trade-note-card .trade-note-actions [role="status"]').textContent!=='保存中…');
  assert.match(await page.locator('#trade-note-card .trade-note-actions [role="status"]').innerText(),/^已保存/);
  assert.equal(annotationWrites.length,1);
  assert.equal(annotationWrites[0].trade_ids.length,6);
  assert.equal(annotationWrites[0].reason,'共同交易理由');
  assert.equal(await page.locator('.trade-marker-button',{hasText:/^S$/}).evaluate(el=>el.classList.contains('has-reason')),true);
  assert.equal(await page.locator('[data-reason-label]').innerText(),'交易理由（已保存，可编辑）');
  assert.equal(await page.locator('#trade-note-card textarea').inputValue(),'共同交易理由');
  assert.equal(await page.locator('[data-trade-save]').innerText(),'更新理由');
  await page.locator('[data-trade-close]').click();
  for(const fill of fills) annotationState[fill.trade_id]={trade_id:fill.trade_id,reason:'外部页面更新的一日理由',updated_at:'2026-10-14T12:00:00Z'};
  await page.locator('#refresh-btn').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.trade-marker-button')].some(el=>el.textContent==='O'&&el.classList.contains('has-reason')));
  await page.locator('.trade-marker-button',{hasText:/^O$/}).click();
  assert.equal(await page.locator('#trade-note-card textarea').inputValue(),'外部页面更新的一日理由');
  await page.locator('[data-trade-close]').click();
  await page.locator('#avwap-ctrl [data-a="add"]').click();
  const before=await page.evaluate(()=>localStorage.getItem('wbAvwap'));
  await buy.click();await page.locator('#trade-note-card:not([hidden])').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('wbAvwap')),before);
  await page.locator('[data-trade-close]').click();
  const accountFilter=page.locator('#trade-account-filter');
  assert.equal(await accountFilter.locator('option').count(),4);
  assert.equal(await accountFilter.locator('option[value="rh|rh-7159"]').innerText(),'rh · hui-rh-7159');
  await accountFilter.selectOption('rh|rh-7159');
  assert.equal(await accountFilter.evaluate(el=>getComputedStyle(el).color),'rgb(192, 132, 252)');
  await page.waitForFunction(()=>[...document.querySelectorAll('.trade-marker-button')].map(x=>x.textContent).join('')==='S');
  await accountFilter.selectOption('all');
  await page.waitForFunction(()=>document.querySelectorAll('.trade-marker-button').length===3);
  await page.waitForTimeout(300);
  const chart=await page.locator('#chart').boundingBox();
  const buyBox=await buy.boundingBox();
  await page.mouse.move(buyBox.x+buyBox.width/2,chart.y+120);await page.waitForTimeout(100);
  assert.match(await page.locator('#chart-legend').innerText(),/[+-]?\d[\d,]*股/);
  assert.doesNotMatch(await page.locator('#chart-legend').innerText(),/持仓（截至该K）/);
  await page.mouse.move(chart.x+chart.width*.6,chart.y+180);await page.mouse.wheel(0,-250);await page.waitForTimeout(250);
  assert.ok(await page.locator('.trade-marker-button').count()>0);
  await page.locator('#chart').screenshot({path:'/tmp/trade-circle-markers.png'});
  await page.locator('#tf-chips [data-tf="5m"]').click();
  await page.locator('.trade-marker-button').first().waitFor({state:'attached'});
  // The historical intraday fill can be outside the default viewport; DOM still has only letters.
  assert.deepEqual((await page.locator('.trade-marker-button').allTextContents()).sort(),['B','O','S']);
  assert.equal(await page.locator('#trade-note-card').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({normal,hover,pressed,letters:['B','S','O'],dailyCard:true,avwapUnchanged:true,volumeHighlight:true,positionHover:true,coverage:true,sync:true,pageErrors:errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
