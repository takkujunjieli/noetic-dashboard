import {escapeHTML as esc,number,percent,table,icStats,staleSessions} from './qlib-view.mjs';
import {initUniverse} from './qlib-universe.js';
import {initObservations} from './market-observations.js';
const $=id=>document.getElementById(id);
const cell=value=>`<td>${value}</td>`;
const row=values=>`<tr>${values.map(cell).join('')}</tr>`;
const stat=(title,value,detail='')=>`<div class="qlib-stat"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
const empty=message=>`<p class="qlib-empty">${esc(message)}</p>`;
const etTime=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{timeZone:'America/New_York',hour12:false}):'—';};
const statsHTML=cs=>icStats(cs).map(s=>stat(s.label,s.value,s.detail)).join('');
const timingTable=rows=>rows?.length?table(['股票','窗口平均 IC','ICIR','窗口平均 Rank IC','Rank ICIR','有效窗口','总体观测数'],rows.map(r=>row([esc(r.symbol),number(r.windows.ic,4),number(r.windows.icir,4),number(r.windows.rank_ic,4),number(r.windows.rank_icir,4),number(r.windows.ic_periods,0),number(r.overall.observations,0)]))):empty('尚无足够的时间序列观测。');
let data,horizon='5',universeDirty=false;
document.addEventListener('qlib-universe-change',event=>{
  universeDirty=event.detail.dirty;$('qlib-refresh').disabled=universeDirty;
});

async function load(){
  const response=await fetch('data/qlib_research.json?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('missing');
  const next=await response.json();
  if(next.schema!=='qlib-research-v1')throw Error('schema');
  data=next;render();
}

async function jobStatus(){
  try{
    const response=await fetch('/api/qlib/status',{cache:'no-store'});
    if(!response.ok)return;
    const job=await response.json();
    $('qlib-refresh').hidden=!job.available;
    $('qlib-refresh').disabled=job.running||universeDirty;
    if(job.running){$('qlib-job').textContent=job.kind==='observations'?'行情统计更新中…':'下载行情并运行研究中…';setTimeout(jobStatus,3000);}
    else if(job.kind==='observations'){$('qlib-job').textContent='';}
    else if(job.started_at){
      $('qlib-job').textContent=job.exit_code===0?'刷新完成':`刷新失败，保留上次结果；${job.error||'请检查本地 refresh.log'}`;
      if(job.exit_code===0)await load();
    }
  }catch{ $('qlib-job').textContent='无法读取本地刷新状态。'; }
}
$('qlib-refresh').addEventListener('click',async()=>{
  $('qlib-refresh').disabled=true;
  try{
    const response=await fetch('/api/qlib/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(!response.ok)throw Error('refresh');
    await jobStatus();
  }catch{ $('qlib-job').textContent='刷新启动失败，请检查本地服务。';$('qlib-refresh').disabled=false; }
});

function render(){
  const block=data.horizons?.[horizon];
  if(!block){$('qlib-candidates').innerHTML=empty('此周期尚无研究结果。');return;}
  const evaluation=block.evaluation||{},candidates=block.candidates||[];
  const ledger=data.ledger?.horizons?.[horizon]||{};
  const demo=data.mode==='synthetic_demo',stale=staleSessions(data.asof);
  $('qlib-status').textContent=demo?'合成演示':stale?'数据需更新':candidates.length?'信号研究 · 待验证':'样本不足';
  const cs=evaluation.cross_sectional||{};
  $('qlib-notice').innerHTML=`<b>${demo?'当前为合成数据演示。':stale?'当前数据较旧，请先刷新研究。':'仅评估信号预测力。'}</b> ${esc(data.warnings?.[0]||'预测仍需样本外验证。')} ICIR 不年化；5日 / 20日未来收益相互重叠，不能按独立样本解读。`;
  $('qlib-meta').textContent=`行情截至 ${data.asof} · ${data.provider} · ${data.config?.universe_id||''}`;
  if(!$('observations-panel').dataset.loaded){
    $('pool-current-name').textContent=data.current_universe?.name||'';
    $('pool-current').textContent=`${data.config?.symbols?.length||0}只 · ${(data.config?.symbols||[]).join(' · ')}`;
  }
  $('qlib-summary').innerHTML=statsHTML(cs);
  $('qlib-sample').textContent=`当前候选 ${candidates.length} / ${data.config?.symbols?.length||0} 只 · 有效横截面 ${cs.ic_periods||0} 日 · 无效 / 待到期 ${cs.invalid_dates||0} 日 · 缺失标签 ${cs.missing_labels||0} 条`;
  const visible=$('qlib-all').checked?candidates:candidates.slice(0,data.config?.display_limit||10);
  $('qlib-candidates').innerHTML=visible.length?table(['排名','股票','预测分数（价格收益）','5日动量','20日动量','20日波动 / 日','参考区间起日','目标日期'],visible.map(c=>row([number(c.rank,0),esc(c.symbol),percent(c.score,100),percent(c.features?.momentum_5,100),percent(c.features?.momentum_20,100),percent(c.features?.volatility_20,100),esc(c.entry_date),esc(c.target_date)]))):empty('训练历史或合格标的不足，尚未生成候选。');
  $('qlib-timing').innerHTML=timingTable(evaluation.time_series);
  $('qlib-ic-series').innerHTML=table(['信号日','IC','Rank IC','有效股票数'],(cs.series||[]).slice(-60).reverse().map(r=>row([esc(r.date),number(r.ic,4),number(r.rank_ic,4),number(r.observations,0)])));
  $('qlib-folds').innerHTML=table(['训练开始','训练截止','训练结果最晚可得日','测试开始','测试结束','训练记录'],(evaluation.folds||[]).map(f=>row([esc(f.train_start),esc(f.train_end),esc(f.latest_training_outcome),esc(f.test_start),esc(f.test_end),number(f.train_rows,0)])));
  const forward=ledger.signal_evaluations?.[data.config?.universe_id]||{};
  $('qlib-ledger-stats').innerHTML=statsHTML(forward.cross_sectional||{});
  $('qlib-forward-timing').innerHTML=timingTable(forward.time_series);
  $('qlib-forward-sample').textContent=`审计记录 ${ledger.issued||0} 条（含历史版本） · 已到期结算 ${ledger.settled||0} 条 · 有效前向横截面 ${forward.cross_sectional?.ic_periods||0} 日 · 到期缺价 ${ledger.overdue_missing_prices||0} 条。`;
  const recent=(data.ledger?.recent||[]).filter(r=>String(r.horizon)===horizon).sort((a,b)=>b.generated_at.localeCompare(a.generated_at)||a.rank-b.rank).slice(0,30);
  const states={settled:'已结算',pending:'待到期',missing_prices:'缺少结算价格'};
  $('qlib-ledger').innerHTML=recent.length?table(['登记时间 ET','行情日期','股票','模型版本','预测收益','实际收益','到期日期','状态'],recent.map(r=>row([esc(etTime(r.generated_at)),esc(r.asof),esc(r.symbol),esc(r.model_id.slice(0,8)),percent(r.score,100),percent(r.actual_return,100),esc(r.target_date),esc(states[r.status]||r.status)]))):empty('尚无前向记录。首次真实运行后才开始累计；历史回测不会回填为前向预测。');
  $('qlib-warnings').innerHTML=(data.warnings||[]).map(w=>`<li>${esc(w)}</li>`).join('');
  $('qlib-quality').innerHTML=table(['股票','历史日线数','最后日期','上市后缺失交易日','最新数据'],(data.quality||[]).map(q=>row([esc(q.symbol),number(q.bars,0),esc(q.last_date||'—'),number(q.missing_sessions,0),q.current?'已覆盖':'缺失'])));
}
document.querySelectorAll('[data-horizon]').forEach(button=>button.addEventListener('click',()=>{
  horizon=button.dataset.horizon;
  document.querySelectorAll('[data-horizon]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
  if(data)render();
}));
$('qlib-all').addEventListener('change',()=>{if(data)render();});
try{
  await load();
}catch{
  $('qlib-status').textContent='尚未运行';
  $('qlib-notice').textContent='尚无 Qlib 研究数据。请先运行 factor-research/run_qlib.py；配置方法见项目文档。';
  $('qlib-candidates').innerHTML=empty('运行成功后，这里会显示每日候选及样本外结果。');
}
if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)){jobStatus();initUniverse();}
initObservations();
