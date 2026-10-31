import {configurePublicDashboard,publicJSON} from './dashboard-data.mjs?v=20261028-manual-versions';
import {esc} from './shared.js?v=20261028-manual-versions';
async function prepare(){
 const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
 const sources=local?['data/public-dashboard.json']:[
  'https://raw.githubusercontent.com/takkujunjieli/noetic-dashboard/main/data/public-dashboard.json?t='+Date.now(),
  'data/public-dashboard.json'];
 for(const source of sources){try{
  const response=await fetch(source,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(response.ok){configurePublicDashboard(await response.json());return;}
 }catch{}}
 throw Error('公开快照暂不可用');
}
function note(message){
 const node=document.createElement('p');node.className='muted small';node.textContent=message;
 (document.querySelector('header .toolbar')||document.querySelector('header')).append(node);
}
export async function mountPublicPortfolio(){
 try{
  await prepare();
  document.querySelector('section h2 .muted')?.replaceChildren(document.createTextNode('Takku · Net Liquidation Value normalized to $100,000'));
  document.querySelector('footer').textContent='Takku Public Portfolio · Quantities, market values and dollar P&L normalized to $100k Net Liq; unit prices, returns and leverage preserved. Not investment advice.';
  note('Takku · Net Liq $100,000 · Dollar amounts and quantities use the same normalization factor');
  const {portfolioReady}=await import('./portfolio.js?v=20261029-simple-headers');await portfolioReady;
  const equityInput=document.getElementById('ps-equity');if(equityInput){equityInput.value='100000';equityInput.readOnly=true;}
  const pf=publicJSON('data/portfolio.json').value;
  const details=document.createElement('section');
  const fmt=value=>value==null?'—':Number(value).toLocaleString('en-US',{maximumFractionDigits:4});
  details.innerHTML='<h2>Takku · All Positions</h2><div class="card" style="overflow:auto"><table class="sc-table"><thead><tr><th>Ticker</th><th>Instrument</th><th>Normalized Quantity</th><th>Price / Unit</th><th>Cost Basis / Unit</th><th>Normalized Market Value</th><th>Normalized Unrealized P&L</th><th>Unrealized P&L %</th></tr></thead><tbody>'+pf.positions.map(p=>`<tr><td>${esc(p.sym)}</td><td>${p.kind==='option'?'Option · Per contract':'Equity · Per share'}</td><td>${fmt(p.qty)}</td><td>${fmt(p.price)}</td><td>${fmt(p.avg_cost)}</td><td>${fmt(p.mkt_value)}</td><td>${fmt(p.pnl)}</td><td>${fmt(p.pnl_pct)}</td></tr>`).join('')+'</tbody></table></div>';
  document.getElementById('portfolio').insertAdjacentElement('afterend',details);
 }catch(error){document.getElementById('portfolio').textContent=error.message;}
}
export async function mountPublicWorkflow(){
 try{
  await prepare();
  for(const id of ['sync-workflow','new'])document.getElementById(id).hidden=true;
  await import('./workflow.js?v=20261029-exit-labels');
 }catch(error){document.getElementById('notice').textContent=error.message;}
}
