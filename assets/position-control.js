import { loadJSON } from './shared.js';
import { normalizePortfolio, liveClaims } from './position-link.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=x=>x===''||x==null?'未知':Number(x).toLocaleString('en-US',{maximumFractionDigits:4});
export async function loadPositionSource(){return normalizePortfolio(await loadJSON('data/portfolio.json'));}
function table(positions){return `<div class="table-wrap"><table><thead><tr><th>账户 / 持仓</th><th>方向 / 数量</th><th>成本 / 现价</th></tr></thead><tbody>${positions.map(l=>`<tr><td>${esc(l.account)}<br>${esc(l.symbol)}</td><td>${esc(l.side)} · ${number(l.qty)}</td><td>$${number(l.entry)} / $${number(l.mark)}<br><span class="hint">报价时间：${esc(l.priceAt||'未提供')}</span></td></tr>`).join('')}</tbody></table></div>`;}
export async function mountPositionControl(host,{c,cases,readonly,onBind,onSync,onRule,onDirty}){
 const data=c.nodes.positions.data;
 if(readonly){host.innerHTML=`<h3>实际持仓 · 历史快照</h3><p class="hint">${data.source==='portfolio'?'Portfolio 本地快照':'手工记录'} · 不读取当前账户</p>${table(data.positions)}${data.binding?`<p class="hint">源构建时间：${esc(data.sync?.builtAt)} · ${esc(data.sync?.status)}</p>${(data.sync?.issues||[]).map(i=>`<p class="gate">${esc(i.message)}</p>`).join('')}`:''}`;return null;}
 host.innerHTML='<p class="hint">读取 Portfolio 持仓快照…</p>';
 let source,sourceError='',draft=false,account='',busy=false;
 const selection=new Map((data.binding?.rules||[]).filter(r=>!r.closed).map(r=>[r.key,{key:r.key,mode:r.mode,qty:r.qty}]));
 const load=async()=>{try{source=await loadPositionSource();sourceError='';}catch(e){sourceError=e.message;source=null;}if(host.isConnected)paint();};
 function paint(){
  if(!host.isConnected)return;
  const linked=data.binding?.rules||[],active=linked.filter(r=>!r.closed);
  host.innerHTML=`<h3>关联 Portfolio 实际持仓</h3><p class="hint">复用同一份本地持仓文件。这里的刷新不会调用券商 MCP；券商刷新流程仍由 Portfolio 原有流程负责。</p>
   <div class="toolbar"><button type="button" data-position-refresh>刷新持仓快照</button><span class="hint">页面停留于此节点时，每 60 秒读取一次；编辑中暂停。</span></div>
   <p class="position-status ${sourceError?'gate':'hint'}" role="status">${sourceError?esc(sourceError)+'；已保留上次持仓。':`文件构建时间：${esc(source?.builtAt)}`}</p>
   ${source?`<label>账户<select data-position-account><option value="">全部账户</option>${source.accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===account?'selected':''}>${esc(a.label)}</option>`).join('')}</select></label>
   <p class="hint">券商源时间：${source.accounts.filter(a=>!account||a.id===account).map(a=>`${esc(a.label)} ${esc(a.sourceAt||'未提供')}`).join(' · ')}</p>
   <p class="hint">只列出 ${esc(c.symbol)} 及其完整期权合约。整仓跟随会同步后续增减仓；固定数量保留指定份额。固定份额减仓归属不明时暂停同步。</p>
   <div class="table-wrap"><table class="position-picker"><thead><tr><th>归属</th><th>持仓 / 账户</th><th>账户数量 / 他用</th><th>方式 / 分配量</th></tr></thead><tbody>${source.rows.filter(r=>r.underlying===c.symbol.toUpperCase()&&(!account||r.account===account)).map(r=>{
    const sel=selection.get(r.key),others=liveClaims(cases,r.key,c.id),occupied=others.some(o=>o.mode==='all'),disabled=occupied||r.entry===''||!r.sourceAt;
    return `<tr><td><input type="checkbox" aria-label="选择 ${esc(r.symbol)} ${esc(r.account)}" data-position-key="${esc(r.key)}" ${sel?'checked':''} ${disabled?'disabled':''}></td><td>${esc(r.symbol)}<br><span class="hint">${esc(r.accountLabel||r.account)} · ${esc(r.side)}</span></td><td>${number(r.qty)} / ${occupied?'整仓':number(others.reduce((s,o)=>s+(+o.qty),0))}${others.length?`<br><span class="hint">${others.map(o=>esc(o.title)).join(' / ')}</span>`:''}${disabled?'<br><span class="gate">已占用 / 成本或源时间缺失</span>':''}</td><td><select aria-label="归属方式 ${esc(r.symbol)} ${esc(r.account)}" data-position-mode="${esc(r.key)}" ${!sel?'disabled':''}><option value="all" ${sel?.mode!=='fixed'?'selected':''}>整仓跟随</option><option value="fixed" ${sel?.mode==='fixed'?'selected':''}>固定数量</option></select><input aria-label="分配数量 ${esc(r.symbol)} ${esc(r.account)}" data-position-qty="${esc(r.key)}" type="number" min="0" step="${r.type==='stock'?'any':'1'}" value="${esc(sel?.qty??r.qty)}" ${!sel||sel.mode==='all'?'disabled':''}></td></tr>`;
   }).join('')}</tbody></table></div>
   ${source.unsupported.filter(r=>!account||r.account===account).length?`<details><summary>有暂不支持自动关联的持仓</summary>${source.unsupported.filter(r=>!account||r.account===account).map(r=>`<p class="hint">${esc(r.symbol)}：${esc(r.reason)}</p>`).join('')}</details>`:''}
   <p class="hint">期权成本/价格从“每张美元”转换为单位权利金（÷100）。分配成本使用账户平均成本，不是成交批次成本；此数据不支持可靠的批次归属。</p>
   <label>归属说明<input data-position-reason placeholder="为什么这些数量属于此 thesis"></label>
   <button type="button" class="primary" data-position-bind>${data.source==='manual'&&data.positions.length?'确认归属并替换手工快照':'确认归属并同步'}</button>
   ${data.source==='manual'&&data.positions.length?'<p class="hint">当前手工快照会被所选账户持仓替换，旧版本仍保留在时间线。</p>':''}`:''}
   ${linked.length?`<h3 class="position-assigned-heading">已确认归属</h3>${active.length?active.map(r=>`<div class="position-assignment"><strong>${esc(r.symbol)} · ${esc(r.accountLabel||r.account)}</strong><p class="hint">${r.mode==='all'?'整仓跟随':'固定数量'} · ${number(r.qty)} · ${esc(r.side)}</p><div class="toolbar"><button type="button" data-position-close="${esc(r.key)}">确认此项已清仓</button><button type="button" data-position-release="${esc(r.key)}">解除归属</button></div></div>`).join(''):'<p class="hint">所有归属已结束。完成退出说明后，可将节点标记为已平仓。</p>'}${table(data.positions)}${(data.sync?.issues||[]).map(i=>`<p class="gate">${esc(linked.find(r=>r.key===i.key)?.symbol||'持仓')}：${esc(i.message)}</p>`).join('')}`:''}`;
 }
 host.addEventListener('change',e=>{
  if(e.target.hasAttribute('data-position-account')){account=e.target.value;paint();return;}
  const key=e.target.dataset.positionKey||e.target.dataset.positionMode||e.target.dataset.positionQty;if(!key)return;
  if(e.target.hasAttribute('data-position-key')){if(e.target.checked){const r=source.rows.find(r=>r.key===key);selection.set(key,{key,mode:liveClaims(cases,key,c.id).length?'fixed':'all',qty:r.qty});}else selection.delete(key);}
  else if(e.target.hasAttribute('data-position-mode'))selection.get(key).mode=e.target.value;
  else selection.get(key).qty=e.target.value===''?'':+e.target.value;
  draft=true;onDirty?.();const reason=host.querySelector('[data-position-reason]')?.value||'';paint();const field=host.querySelector('[data-position-reason]');if(field)field.value=reason;
 });
 host.addEventListener('input',e=>{if(e.target.hasAttribute('data-position-reason')||e.target.hasAttribute('data-position-qty')){draft=true;onDirty?.();}});
 host.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||busy)return;
  if(b.hasAttribute('data-position-refresh')){if(draft){host.querySelector('.position-status').textContent='请先确认归属编辑；刷新不会丢弃未提交的分配。';return;}busy=true;await load();if(source)await onSync(source);busy=false;return;}
  if(b.hasAttribute('data-position-bind')){
   const reason=host.querySelector('[data-position-reason]').value.trim();if(!reason){host.querySelector('.position-status').textContent='请填写归属说明';return;}
   busy=true;b.disabled=true;await onBind([...selection.values()],reason);busy=false;if(b.isConnected)b.disabled=false;return;
  }
  const key=b.dataset.positionClose||b.dataset.positionRelease;if(key){const mode=b.hasAttribute('data-position-close')?'close':'release';
   const reason=prompt(mode==='close'?'确认已清仓：请填写核对依据（不会自动执行平仓）':'解除归属不会卖出持仓，也不代表已实现盈亏。请填写原因');if(!reason?.trim())return;
   busy=true;await onRule(key,mode,reason);busy=false;
  }
 });
 await load();
 return {source:()=>source,hasDraft:()=>draft,refresh:async()=>{if(draft||busy)return;busy=true;try{await load();if(source)await onSync(source);}finally{busy=false;}}};
}
