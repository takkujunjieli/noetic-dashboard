import {escapeHTML as esc,percent,number,table} from './qlib-view.mjs?v=20261103-en';
import {detailHTML} from './factor-attribution.mjs?v=20261103-en';
const $=id=>document.getElementById(id);
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
let report,days='20',symbol='',revision,marketAsOf,dirty=false,running=false,timer;
function button(){ $('attribution-refresh').disabled=dirty||running; }
function render(){
  if(!report)return;
  const rows=report.rows||[];
  $('attribution-meta').textContent=`${report.universe_name} · Attribution through ${report.asof} · Prices through ${report.market_asof} · Factors through ${report.factor_asof} · Attribution coverage ${report.coverage.available}/${report.coverage.total} tickers`;
  $('attribution-stale').textContent=revision&&revision!==report.settings_revision?'The universe has changed. Update prices first, then update attribution.':marketAsOf&&marketAsOf!==report.market_asof?'Price statistics have changed. Update attribution; factor publication dates still limit coverage.':report.asof<report.market_asof?'Factor publication lags behind prices; attribution and momentum have different end dates.':'';
  if(!rows.some(r=>r.symbol===symbol))symbol=rows.find(r=>r.periods?.[days]?.status==='ok')?.symbol||rows[0]?.symbol||'';
  $('attribution-symbol').innerHTML=rows.map(r=>`<option value="${esc(r.symbol)}" ${r.symbol===symbol?'selected':''}>${esc(r.symbol)}${r.status==='ok'?'':' · Unavailable'}</option>`).join('');
  $('attribution-detail').innerHTML=detailHTML(rows.find(r=>r.symbol===symbol),days);
  const body=rows.map(r=>{
    const p=r.periods?.[days];
    const name=`<button type="button" data-attribution-symbol="${esc(r.symbol)}" class="observations-column-sort">${esc(r.symbol)}</button>`;
    if(p?.status!=='ok')return `<tr><td>${name}</td><td>${esc(r.industry_proxy||'—')}</td><td colspan="8" class="muted">${esc(p?.reason||r.reason||'Insufficient data')}</td></tr>`;
    const c=p.contributions;
    return `<tr><td>${name}</td>${[esc(r.industry_proxy),percent(p.actual_return,100),number(c['Mkt-RF']*100,2),number(c.industry*100,2),number(p.style*100,2),number(c.RF*100,2),number(p.unexplained*100,2),percent(p.r_squared,100),number(p.beta['Mkt-RF'],2)].map(v=>`<td>${v}</td>`).join('')}</tr>`;
  });
  $('attribution-table').innerHTML=table(['Ticker','Industry proxy','Actual return','Market pp','Industry pp','Style total pp','Risk-free pp','Unexplained pp','Estimation-window R²','Market beta'],body);
  $('attribution-warnings').innerHTML=(report.warnings||[]).map(w=>`<li>${esc(w)}</li>`).join('');
  $('attribution-sources').textContent='Sources: Kenneth French Data Library · Yahoo Finance (dividend-adjusted closing prices)';
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
    if(running){$('attribution-job').textContent=job.kind==='attribution'?'Downloading factors and dividend-adjusted prices; calculating attribution…':'A price or research task is running. Please wait.';timer=setTimeout(status,2500);}
    else if(job.kind==='attribution'&&job.started_at){$('attribution-job').textContent=job.exit_code===0?'Attribution updated':`Update failed; previous results retained. ${job.error||'Check attribution-refresh.log'}`;if(job.exit_code===0)await load();}
    else $('attribution-job').textContent='';
  }catch{$('attribution-job').textContent='Unable to read local update status.';}
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
    catch{running=false;button();$('attribution-job').textContent='Unable to start attribution. Check the local server.';}
  });
  load().catch(()=>{$('attribution-meta').textContent='No attribution data yet. Update prices, then select Update attribution.';});
  if(local)status();
}
