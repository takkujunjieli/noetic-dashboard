import {configurePublicDashboard,publicJSON} from './dashboard-data.mjs';
import {esc} from './shared.js';
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
  document.querySelector('section h2 .muted')?.replaceChildren(document.createTextNode('Takku · 总净值统一折算为 $100,000'));
  document.querySelector('footer').textContent='Takku 公开组合 · 股数、市值及美元盈亏按 100k 净值等比例折算；保留每股价格、收益率及杠杆。非投资建议。';
  note('Takku · Net Liq $100,000 · 全部金额及股数使用同一折算比例');
  const {portfolioReady}=await import('./portfolio.js');await portfolioReady;
  const equityInput=document.getElementById('ps-equity');if(equityInput){equityInput.value='100000';equityInput.readOnly=true;}
  const pf=publicJSON('data/portfolio.json').value;
  const details=document.createElement('section');
  const fmt=value=>value==null?'—':Number(value).toLocaleString('en-US',{maximumFractionDigits:4});
  details.innerHTML='<h2>Takku · 全部持仓明细</h2><div class="card" style="overflow:auto"><table class="sc-table"><thead><tr><th>标的</th><th>工具</th><th>折算数量</th><th>现价 / 单位</th><th>成本 / 单位</th><th>折算市值</th><th>折算浮盈</th><th>浮盈 %</th></tr></thead><tbody>'+pf.positions.map(p=>`<tr><td>${esc(p.sym)}</td><td>${p.kind==='option'?'期权 · 每张':'正股 · 每股'}</td><td>${fmt(p.qty)}</td><td>${fmt(p.price)}</td><td>${fmt(p.avg_cost)}</td><td>${fmt(p.mkt_value)}</td><td>${fmt(p.pnl)}</td><td>${fmt(p.pnl_pct)}</td></tr>`).join('')+'</tbody></table></div>';
  document.getElementById('portfolio').insertAdjacentElement('afterend',details);
 }catch(error){document.getElementById('portfolio').textContent=error.message;}
}
export async function mountPublicWorkflow(){
 try{
  await prepare();
  for(const id of ['sync-workflow','new'])document.getElementById(id).hidden=true;
  note('公开 Workflow · 研究内容与本地共用 · 其他账户财务记录已过滤');
  await import('./workflow.js');
 }catch(error){document.getElementById('notice').textContent=error.message;}
}
