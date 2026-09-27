const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),ctx=await browser.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 const base=process.env.DASHBOARD_URL||'http://127.0.0.1:8642';
 await p.goto(base+'/workflow.html');
 await p.locator('#new').click();
 await p.locator('[name="title"]').fill('Candidate positions');
 await p.locator('[name="symbol"]').fill('THESIS');
 await p.locator('[name="horizon"]').fill('2030-01-01');
 await p.getByRole('button',{name:'创建实例',exact:true}).click();
 await p.locator('[data-node="construction"]').click();
 assert.equal(await p.locator('.plan-editor').count(),0);

 const addPosition=async(underlying,instrument)=>{
  await p.locator('#add-plan').click();
  assert.equal(await p.locator('[name="candidate.underlying"]').inputValue(),'');
  assert.equal(await p.locator('[name="plan-name"], [name*="qty"], [name*="entry"]').count(),0);
  await p.locator('[name="candidate.underlying"]').fill(underlying);
  await p.locator('[name="candidate.instrument"]').selectOption(instrument);
  await p.getByRole('button',{name:'保存 Position',exact:true}).click();
  assert.equal(await p.locator('.plan-editor').count(),0);
 };
 await addPosition('NVDA','bullCall');
 await addPosition('NVDA','call');
 await addPosition('SPY','stock');
 let c=await p.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0]);
 assert.deepEqual(c.design.plans.map(x=>x.name),['NVDA · Bull Call Spread','NVDA · Long Call','SPY · Long Stock']);

 for(const [index,expected] of [[0,'300'],[1,'240'],[2,'8']]){
  await p.locator('[data-node="returns"]').click();
  const id=c.design.plans[index].id;
  await p.locator('#design-plan-selector').selectOption(id);
  await p.locator('[name="f.expectedNet"]').fill(expected);
  await p.getByRole('button',{name:'保存单位收益假设',exact:true}).click();
 }

 // Reference Market Snapshot is supplied by the future market-data adapter. The fixture
 // injects that normalized output so this browser test can exercise shared optimization.
 await p.evaluate(async()=>{
  const m=await import('./assets/workflow-model.mjs'),s=await import('./assets/trade-structure.mjs');
  const store=JSON.parse(localStorage.getItem(m.KEY)),c=store.cases[0];
  const option=(type,side,entry,strike,delta)=>({...s.newStructureLeg(type,side),underlying:'NVDA',entry,strike,expiry:'2030-01-01',underlyingPrice:100,delta,gamma:.01,theta:-.04,vega:.08,quoteAt:'2029-12-01T12:00:00Z'});
  c.design.plans[0].construction.legs=[option('call','long',6,100,.55),option('call','short',2,120,.25)];
  c.design.plans[1].construction.legs=[option('call','long',5,110,.4)];
  c.design.plans[2].construction.legs=[{...s.newStructureLeg(),underlying:'SPY',entry:500,underlyingPrice:500,quoteAt:'2029-12-01T12:00:00Z'}];
  const selected=c.design.plans.find(x=>x.id===c.design.selectedId);c.nodes.construction.data=structuredClone(selected.construction);c.nodes.returns.data=structuredClone(selected.returns);
  localStorage.setItem(m.KEY,JSON.stringify(store));
 });
 await p.reload();
 await p.locator('[data-node="risk"]').click();
 assert.equal(await p.locator('#design-plan-selector,#rk-risk,#rk-eq,#rk-edge,#rk-invalid').count(),0);
 assert.equal(await p.locator('.risk-comparison tbody tr').count(),3);
 assert.equal(await p.locator('.risk-status').filter({hasText:'Incomplete'}).count(),0);
 await p.locator('[name="f.riskBudget"]').fill('1200');
 await p.locator('[name="f.capitalLimit"]').fill('10000');
 await p.locator('[name="f.maxDollarDelta"]').fill('100000');
 await p.getByRole('button',{name:'保存 Risk Policy',exact:true}).click();
 assert.ok(Number(await p.locator('.risk-comparison tbody tr').first().locator('td').last().textContent())>=0);
 await p.locator('#activate-allocation').click();
 assert.equal(await p.locator('.allocation-active').count(),1);
 c=await p.evaluate(()=>JSON.parse(localStorage.getItem('research-desk.workflow.v1')).cases[0]);
 assert.equal(c.design.allocation.inAction,true);
 assert.ok(c.design.allocation.items.some(x=>x.quantity>0));
 assert.equal(c.returnBasis.planName,'Optimized Allocation');

 await p.locator('[data-node="construction"]').click();
 await p.locator('[data-plan-row]').first().locator('[data-edit-plan]').click();
 assert.equal(await p.locator('[name="candidate.underlying"]').inputValue(),'NVDA');
 assert.equal(await p.locator('.market-snapshot input').count(),0);
 await p.locator('#close-plan-editor').click();
 await p.reload();
 await p.locator('[data-node="risk"]').click();
 assert.equal(await p.locator('.allocation-active').count(),1);
 await p.setViewportSize({width:390,height:844});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.SCREENSHOT_PATH)await p.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: candidate positions, blank underlying, derived names, unit returns, reference snapshots, shared risk optimization, frozen allocation, reload and mobile');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
