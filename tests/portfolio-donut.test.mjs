import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the page's renderers without opening a browser or loading broker data.
const source=fs.readFileSync(new URL('../assets/trading.js',import.meta.url),'utf8');
const donut=source.slice(source.indexOf('function buildDonut('),source.indexOf('const usd =',source.indexOf('function buildDonut(')));
const portfolio=source.slice(source.indexOf('function renderPortfolio()'),source.indexOf('/* monthly_returns.json',source.indexOf('function renderPortfolio()')));
function render(positions){
 const host={innerHTML:''};
 const context=vm.createContext({PF_MIN_VALUE:1000,pfFilter:null,pfAccount:null,
  PORTFOLIO:{accounts:[{id:'test',equity:10000}],positions},
  $:()=>host,esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  fmtMoney:value=>`${value<0?'−':''}$${Math.abs(value)}`,fmtDT:String,
  pfColor:()=> 'hsl(0 62% 58%)',accountDisplayName:id=>id,
  tile:()=>'',buildPnlPanel:()=>''});
 vm.runInContext(donut+'\n'+portfolio+'\nrenderPortfolio();',context);
 return host.innerHTML;
}
const position=(sym,value)=>({sym,mkt_value:value,qty:value/100,price:100,account:'test'});
test('both Long and Short charts remain visible for an empty account',()=>{
 const html=render([]);
 assert.equal((html.match(/class="pf-pie"/g)||[]).length,2);
 assert.equal((html.match(/pf-donut-empty/g)||[]).length,2);
 assert.equal((html.match(/stroke="#6b7280"/g)||[]).length,2);
 assert.match(html,/Long/);assert.match(html,/Short/);
});
test('long-only and short-only portfolios keep a gray chart for the empty side',()=>{
 for(const value of [2000,-2000]){
  const html=render([position('A',value)]);
  assert.equal((html.match(/pf-donut-empty/g)||[]).length,1);
  assert.match(html,/<circle class="pf-slice/,'a single position renders a complete ring');
  assert.match(html,/data-sym="A"/);assert.match(html,/100.0%/);
  assert.match(html,new RegExp(value<0?'−\\$2000':'\\$2000'));
 }
});
test('positions below the existing display threshold leave gray placeholders',()=>{
 const html=render([position('SMALL',500),position('SHORT',-500)]);
 assert.equal((html.match(/pf-donut-empty/g)||[]).length,2);
 assert.doesNotMatch(html,/data-sym=/);
});
test('funded Long and Short charts retain slices and legends',()=>{
 const html=render([position('A',2000),position('B',3000),position('C',-4000)]);
 assert.doesNotMatch(html,/pf-donut-empty/);
 assert.match(html,/<path class="pf-slice/);assert.match(html,/data-sym="C"/);
 assert.match(html,/40.0%/);assert.match(html,/60.0%/);
});
