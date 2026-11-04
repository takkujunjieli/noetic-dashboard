import {escapeHTML as esc,number,percent} from './qlib-view.mjs?v=20261103-en';
import {sortObservations} from './market-observations.mjs?v=20261103-en';
const $=id=>document.getElementById(id);
let report,dirty=false,revision=null,running=false,pollTimer=null;
let sortKey='20:momentum',sortDirection='desc';
const columns=[['symbol','Ticker'],['price','Latest close'],['60:momentum','60-session momentum'],['60:volatility','60-session volatility'],['20:momentum','20-session momentum'],['20:volatility','20-session volatility'],['5:momentum','5-session momentum'],['5:volatility','5-session volatility']];
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
function button(){ $('observations-refresh').disabled=dirty||running; }
function render(){
  if(!report)return;
  const [period,metric]=sortKey.includes(':')?sortKey.split(':'):['',sortKey];
  const rows=sortObservations(report.rows,period,metric,sortDirection);
  $('observations-meta').textContent=`${report.universe_name} · ${rows.length} tickers · Prices through ${report.asof} · ${report.provider}`;
  const mismatch=revision&&revision!==report.settings_revision;
  $('observations-stale').textContent=mismatch?'The universe has changed. Select Update prices to apply the new list.':'';
  const body=rows.map(r=>{
    const values=[esc(r.symbol)+(r.reason?` <span class="muted" title="${esc(r.reason)}">· Unavailable</span>`:''),number(r.price),...['60','20','5'].flatMap(p=>[percent(r.periods[p].momentum,100),percent(r.periods[p].volatility,100)])];
    return `<tr>${values.map(v=>`<td>${v}</td>`).join('')}</tr>`;
  });
  const headers=columns.map(([key,label])=>{
    const active=key===sortKey,order=active?(sortDirection==='asc'?'ascending':'descending'):'none';
    const arrow=active?(sortDirection==='asc'?'▲':'▼'):'↕';
    return `<th scope="col" aria-sort="${order}"><button type="button" class="observations-column-sort" data-observations-sort="${key}" title="Sort by ${label}">${label} <span aria-hidden="true">${arrow}</span></button></th>`;
  }).join('');
  $('observations-table').innerHTML=rows.length?`<table class="qlib-table"><thead><tr>${headers}</tr></thead><tbody>${body.join('')}</tbody></table>`:'<p class="qlib-empty">No tickers match the current filters.</p>';
  if(!mismatch){
    $('observations-panel').dataset.loaded='true';
    $('pool-current-name').textContent=report.universe_name;
    $('pool-current').textContent=`${rows.length} tickers · ${report.rows.map(r=>r.symbol).sort().join(' · ')}`;
  }
}
async function load(){
  const response=await fetch('data/market_observations.json?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)return;
  const value=await response.json();if(value.schema!=='market-observations-v1')return;
  report=value;render();
  document.dispatchEvent(new CustomEvent('market-observations-loaded',{detail:{asof:report.asof,revision:report.settings_revision}}));
}
async function status(){
  try{
    const response=await fetch('/api/qlib/status',{cache:'no-store'});
    if(!response.ok)return;
    const job=await response.json();running=job.running;button();
    if(job.running){
      $('observations-job').textContent=job.kind==='observations'?'Updating prices and historical statistics…':'An attribution or research task is running. Update prices after it finishes.';
      pollTimer=setTimeout(status,2500);
    }else if(job.kind==='observations'&&job.started_at){
      $('observations-job').textContent=job.exit_code===0?'Price statistics updated':'Update failed; previous results retained.';
      if(job.exit_code===0)await load();
    }else $('observations-job').textContent='';
  }catch{ $('observations-job').textContent='Unable to read local update status.'; }
}
export function initObservations(){
  document.addEventListener('quant-job-started',()=>{clearTimeout(pollTimer);status();});
  $('observations-table').addEventListener('click',event=>{
    const header=event.target.closest('[data-observations-sort]');if(!header)return;
    const key=header.dataset.observationsSort;
    sortDirection=key===sortKey&&sortDirection==='desc'?'asc':'desc';sortKey=key;
    const focused=document.activeElement===header;render();
    if(focused)$('observations-table').querySelector(`[data-observations-sort="${key}"]`)?.focus({preventScroll:true});
  });
  document.addEventListener('qlib-universe-change',event=>{dirty=event.detail.dirty;button();});
  document.addEventListener('qlib-universe-saved',event=>{revision=event.detail.revision;render();});
  $('observations-refresh').hidden=!local;
  $('observations-refresh').addEventListener('click',async()=>{
    running=true;button();
    try{
      const response=await fetch('/api/qlib/observations/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!response.ok)throw Error('refresh');
      document.dispatchEvent(new CustomEvent('quant-job-started'));
    }catch{running=false;button();$('observations-job').textContent='Unable to start the price update.';}
  });
  load().catch(()=>{$('observations-job').textContent='No price statistics yet. Update prices first.';});
  if(local)status();
}
