import {escapeHTML as esc,number,percent} from './qlib-view.mjs';
import {sortObservations} from './market-observations.mjs';
const $=id=>document.getElementById(id);
let report,dirty=false,revision=null,running=false,pollTimer=null;
let sortKey='20:momentum',sortDirection='desc';
const columns=[['symbol','股票'],['price','最新收盘价'],['60:momentum','60日动量'],['60:volatility','60日波动率'],['20:momentum','20日动量'],['20:volatility','20日波动率'],['5:momentum','5日动量'],['5:volatility','5日波动率']];
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
function button(){ $('observations-refresh').disabled=dirty||running; }
function render(){
  if(!report)return;
  const [period,metric]=sortKey.includes(':')?sortKey.split(':'):['',sortKey];
  const rows=sortObservations(report.rows,period,metric,sortDirection);
  $('observations-meta').textContent=`${report.universe_name} · ${rows.length}只 · 行情截至 ${report.asof} · ${report.provider}`;
  const mismatch=revision&&revision!==report.settings_revision;
  $('observations-stale').textContent=mismatch?'股票池配置已更新，请点击「更新行情」应用新名单。':'';
  const body=rows.map(r=>{
    const values=[esc(r.symbol),number(r.price),...['60','20','5'].flatMap(p=>[percent(r.periods[p].momentum,100),percent(r.periods[p].volatility,100)])];
    return `<tr>${values.map(v=>`<td>${v}</td>`).join('')}</tr>`;
  });
  const headers=columns.map(([key,label])=>{
    const active=key===sortKey,order=active?(sortDirection==='asc'?'ascending':'descending'):'none';
    const arrow=active?(sortDirection==='asc'?'▲':'▼'):'↕';
    return `<th scope="col" aria-sort="${order}"><button type="button" class="observations-column-sort" data-observations-sort="${key}" title="点击按${label}排序">${label} <span aria-hidden="true">${arrow}</span></button></th>`;
  }).join('');
  $('observations-table').innerHTML=rows.length?`<table class="qlib-table"><thead><tr>${headers}</tr></thead><tbody>${body.join('')}</tbody></table>`:'<p class="qlib-empty">当前筛选条件下没有股票。</p>';
  if(!mismatch){
    $('observations-panel').dataset.loaded='true';
    $('pool-current-name').textContent=report.universe_name;
    $('pool-current').textContent=`${rows.length}只 · ${report.rows.map(r=>r.symbol).sort().join(' · ')}`;
  }
}
async function load(){
  const response=await fetch('data/market_observations.json?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)return;
  const value=await response.json();if(value.schema!=='market-observations-v1')return;
  report=value;render();
}
async function status(){
  try{
    const response=await fetch('/api/qlib/status',{cache:'no-store'});
    if(!response.ok)return;
    const job=await response.json();running=job.running;button();
    if(job.running){
      $('observations-job').textContent=job.kind==='observations'?'正在更新行情与历史统计…':'研究任务运行中，请稍后更新行情。';
      pollTimer=setTimeout(status,2500);
    }else if(job.kind==='observations'&&job.started_at){
      $('observations-job').textContent=job.exit_code===0?'行情统计已更新':'更新失败，保留上次结果。';
      if(job.exit_code===0)await load();
    }else $('observations-job').textContent='';
  }catch{ $('observations-job').textContent='无法读取本地更新状态。'; }
}
export function initObservations(){
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
      clearTimeout(pollTimer);await status();
    }catch{running=false;button();$('observations-job').textContent='行情更新启动失败。';}
  });
  load().catch(()=>{$('observations-job').textContent='暂无行情统计，请先更新行情。';});
  if(local)status();
}
