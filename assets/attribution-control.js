import { loadJSON } from './shared.js';
import { attributionEvidence } from './attribution-link.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>Number(x).toLocaleString('en-US',{style:'currency',currency:'USD'});
function evidenceHTML(e){
 if(!e)return '<p class="hint">尚未保存对账参考快照。</p>';
 return `<p class="hint">源更新时间 ${esc(e.sourceUpdatedAt)} · 已实现记录截至 ${esc(e.asOf)}<br>参考区间 ${esc(e.start)} — ${esc(e.end)} · ${esc(e.window)} 源窗口</p>${e.warnings.map(w=>`<p class="gate">${esc(w)}</p>`).join('')}<div class="table-wrap"><table><thead><tr><th>日期</th><th>账户 / 标的</th><th>账户已实现损益 · 未扣费用</th></tr></thead><tbody>${e.rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.account)}<br>${esc(r.symbol)}</td><td>${money(r.pnl)}</td></tr>`).join('')||'<tr><td colspan="3">此范围没有匹配记录；不代表 thesis 损益为零。</td></tr>'}</tbody></table></div>${e.rows.length?`<p>参考合计 ${money(e.rows.reduce((s,r)=>s+r.pnl,0))}（不是 thesis 净损益）</p>`:''}`;
}
export function mountAttributionControl(host,{c,readonly,onSave}){
 const saved=c.nodes.attribution.data.evidence;
 host.innerHTML=`<h3>已实现盈亏 · 对账参考</h3><p class="hint">复用 Dashboard 的 P&L 数据，按已确认的账户与完整合约筛选。日期范围由你核对；同标的可能包含其他 thesis，账户平均成本、费用及分仓差异需人工对账。</p><div data-saved-evidence>${evidenceHTML(saved)}</div>${readonly?'<p class="hint">历史 / 归档快照只读，不读取当前盈亏文件。</p>':`<fieldset><div class="fields"><label>起始日期<input type="date" data-attr-start value="${esc(saved?.start||c.createdAt.slice(0,10))}"></label><label>结束日期<input type="date" data-attr-end value="${esc(saved?.end||new Date().toISOString().slice(0,10))}"></label><label>源窗口<select data-attr-window>${['ytd','3m','1m'].map(w=>`<option ${w===(saved?.window||'ytd')?'selected':''}>${w}</option>`).join('')}</select></label></div><button type="button" data-attr-load>读取对账参考</button><p data-attr-status role="status"></p><div data-attr-preview></div><button type="button" data-attr-save hidden>保存参考快照到此 thesis</button></fieldset>`}`;
 if(readonly)return;
 let candidate=null;
 const status=host.querySelector('[data-attr-status]'),save=host.querySelector('[data-attr-save]');
 host.querySelector('fieldset').addEventListener('change',()=>{candidate=null;save.hidden=true;host.querySelector('[data-attr-preview]').innerHTML='';});
 host.querySelector('[data-attr-load]').onclick=async()=>{
  const start=host.querySelector('[data-attr-start]').value,end=host.querySelector('[data-attr-end]').value,window=host.querySelector('[data-attr-window]').value;
  candidate=null;save.hidden=true;status.textContent='正在读取本地盈亏快照…';
  try{const pnl=await loadJSON('data/pnl.json');if(!host.isConnected)return;
   if(start!==host.querySelector('[data-attr-start]').value||end!==host.querySelector('[data-attr-end]').value||window!==host.querySelector('[data-attr-window]').value){status.textContent='日期或窗口已变化，请重新读取。';return;}
   candidate=attributionEvidence(c,pnl,{start,end,window});host.querySelector('[data-attr-preview]').innerHTML=evidenceHTML(candidate);save.hidden=false;status.textContent='以下为待保存参考。最终净损益仍在下方人工确认。';
  }catch(e){status.textContent='读取失败，已保存快照不变：'+e.message;host.querySelector('[data-attr-preview]').innerHTML='';}
 };
 save.onclick=()=>{if(candidate)onSave(candidate);};
}
