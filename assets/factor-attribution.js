import {escapeHTML as esc,percent,number,table} from './qlib-view.mjs';
import {detailHTML} from './factor-attribution.mjs';
const $=id=>document.getElementById(id);
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
let report,days='20',symbol='',revision,marketAsOf,dirty=false,running=false,timer;
function button(){ $('attribution-refresh').disabled=dirty||running; }
function render(){
  if(!report)return;
  const rows=report.rows||[];
  $('attribution-meta').textContent=`${report.universe_name} · 归因截至 ${report.asof} · 行情截至 ${report.market_asof} · 因子截至 ${report.factor_asof} · 可归因 ${report.coverage.available}/${report.coverage.total}只`;
  $('attribution-stale').textContent=revision&&revision!==report.settings_revision?'股票池配置已改变，请先更新行情，再更新归因。':marketAsOf&&marketAsOf!==report.market_asof?'行情统计已更新，请更新归因；归因仍受因子发布日期限制。':report.asof<report.market_asof?'因子发布滞后，归因与上方动量的截止日期不同。':'';
  if(!rows.some(r=>r.symbol===symbol))symbol=rows.find(r=>r.periods?.[days]?.status==='ok')?.symbol||rows[0]?.symbol||'';
  $('attribution-symbol').innerHTML=rows.map(r=>`<option value="${esc(r.symbol)}" ${r.symbol===symbol?'selected':''}>${esc(r.symbol)}${r.status==='ok'?'':' · 暂不可用'}</option>`).join('');
  $('attribution-detail').innerHTML=detailHTML(rows.find(r=>r.symbol===symbol),days);
  const body=rows.map(r=>{
    const p=r.periods?.[days];
    const name=`<button type="button" data-attribution-symbol="${esc(r.symbol)}" class="observations-column-sort">${esc(r.symbol)}</button>`;
    if(p?.status!=='ok')return `<tr><td>${name}</td><td>${esc(r.industry_proxy||'—')}</td><td colspan="8" class="muted">${esc(p?.reason||r.reason||'样本不足')}</td></tr>`;
    const c=p.contributions;
    return `<tr><td>${name}</td>${[esc(r.industry_proxy),percent(p.actual_return,100),number(c['Mkt-RF']*100,2),number(c.industry*100,2),number(p.style*100,2),number(c.RF*100,2),number(p.unexplained*100,2),percent(p.r_squared,100),number(p.beta['Mkt-RF'],2)].map(v=>`<td>${v}</td>`).join('')}</tr>`;
  });
  $('attribution-table').innerHTML=table(['股票','行业代理','实际收益','市场 pp','行业 pp','风格合计 pp','无风险 pp','未解释 pp','估计窗口 R²','市场 Beta'],body);
  $('attribution-warnings').innerHTML=(report.warnings||[]).map(w=>`<li>${esc(w)}</li>`).join('');
  $('attribution-sources').textContent='数据来源：Kenneth French Data Library · Yahoo Finance（含分红复权收盘价）';
}
async function load(){
  const response=await fetch('data/factor_attribution.json?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('missing');
  const next=await response.json();if(next.schema!=='factor-attribution-v1')throw Error('schema');
  report=next;render();
}
async function status(){
  try{
    const response=await fetch('/api/qlib/status',{cache:'no-store'});if(!response.ok)return;
    const job=await response.json();running=job.running;button();
    if(running){$('attribution-job').textContent=job.kind==='attribution'?'正在下载因子及含分红行情、计算归因…':'行情或研究任务正在运行，请稍后。';timer=setTimeout(status,2500);}
    else if(job.kind==='attribution'&&job.started_at){$('attribution-job').textContent=job.exit_code===0?'归因已更新':`更新失败，保留上次结果；${job.error||'请检查 attribution-refresh.log'}`;if(job.exit_code===0)await load();}
    else $('attribution-job').textContent='';
  }catch{$('attribution-job').textContent='无法读取本地更新状态。';}
}
export function initAttribution(){
  document.addEventListener('quant-job-started',()=>{clearTimeout(timer);status();});
  document.addEventListener('market-observations-loaded',e=>{marketAsOf=e.detail.asof;render();});
  document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{
    days=b.dataset.period;document.querySelectorAll('[data-period]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});render();
  }));
  $('attribution-symbol').addEventListener('change',e=>{symbol=e.target.value;render();});
  $('attribution-table').addEventListener('click',e=>{const b=e.target.closest('[data-attribution-symbol]');if(b){symbol=b.dataset.attributionSymbol;render();}});
  document.addEventListener('qlib-universe-change',e=>{dirty=e.detail.dirty;button();});
  document.addEventListener('qlib-universe-saved',e=>{revision=e.detail.revision;render();});
  $('attribution-refresh').hidden=!local;
  $('attribution-refresh').addEventListener('click',async()=>{
    running=true;button();
    try{const r=await fetch('/api/qlib/attribution/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('refresh');document.dispatchEvent(new CustomEvent('quant-job-started'));}
    catch{running=false;button();$('attribution-job').textContent='归因启动失败，请检查本地服务。';}
  });
  load().catch(()=>{$('attribution-meta').textContent='暂无归因数据，更新行情后点击「更新归因」。';});
  if(local)status();
}
