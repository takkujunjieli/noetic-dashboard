import {createTransactionFile,easternTime,thesisUnderlyings,transactionRange} from './attribution-transactions.mjs';
import {readTransactionStore,writeTransactionStore,deleteTransactionStore,readLocalBrokerHistory} from './thesis-transaction-store.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cell=x=>x==null?'—':esc(x);
function fileHTML(file,path,range,underlyings){
 if(!file)return '<p class="hint">尚未保存交易历史文件。</p>';
 const matches=JSON.stringify(file.thesis.underlyings.slice().sort())===JSON.stringify(underlyings);
 if(!matches)return '<p class="gate">文件中的标的与当前 In Action Kelly Allocation 不一致，请重新生成。旧文件中的交易不参与当前查询。</p>';
 const rows=file.transactions.filter(t=>{const at=easternTime(t.ts);return at>=range.startLocal&&at<=range.endLocal;});
 return `<p class="hint">${esc(path)}<br>In Action：${esc(underlyings.join(' · '))} · 查询 ${rows.length} / 已保存 ${file.transaction_count} 条<br>文件覆盖：${esc(file.range.startDate)} 02:00 — ${esc(file.range.endDate)} ${esc(file.range.endTime)} ET<br>文件更新：${esc(easternTime(file.generated_at))} ET</p>${range.startLocal<file.range.startLocal||range.endLocal>file.range.endLocal?'<p class="gate">查询范围超出已保存文件的日期范围；如需补充数据，请生成 / 更新文件。</p>':''}<details><summary>数据来源与覆盖范围</summary><p class="hint">只包含 In Action Kelly Allocation 的非零配置标的，覆盖本地来源账户中的正股及期权。查询只读取此 thesis 的文件。</p>${file.source.sources.map(s=>`<p class="hint">${esc(s.file)} · 券商源更新：${esc(s.source_updated_at?easternTime(s.source_updated_at)+' ET':'未知')}</p>`).join('')}${file.warnings.map(w=>`<p class="hint">${esc(w)}</p>`).join('')}</details><div class="table-wrap"><table><thead><tr><th>成交时间 ET</th><th>券商 / 账户</th><th>Underlying / 合约</th><th>方向</th><th>数量</th><th>原始价格</th><th>状态</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${esc(easternTime(t.ts).replace('T',' '))}</td><td>${cell(t.broker)} / ${cell(t.account)}</td><td>${esc(t.underlying)}<br>${esc(t.sym)}</td><td>${cell(t.side)}</td><td>${cell(t.qty)}</td><td>${cell(t.price)}</td><td>${cell(t.state)}</td></tr>`).join('')||'<tr><td colspan="7">此查询范围内无匹配交易。</td></tr>'}</tbody></table></div>`;
}
export function mountTransactionHistory(host,{c,readonly,onSave}){
 let underlyings=[],allocationError='';try{underlyings=thesisUnderlyings(c);}catch(e){allocationError=e.message;}
 const today=easternTime(new Date().toISOString()).slice(0,10);
 host.innerHTML=`<h3>Transaction History · 交易历史文件</h3><p class="hint">每个 thesis 固定一个 JSON 文件。生成 / 更新会保存当前日期范围的数据；查询只读取该文件，不重新拉取券商数据。</p><p class="${allocationError?'gate':'hint'}">${esc(allocationError||'In Action underlying：'+(underlyings.join(' · ')||'无非零配置'))}</p><fieldset data-tx-fields disabled><div class="fields"><label>开始日期 · 02:00 ET<input type="date" data-tx-start value="${esc(easternTime(c.createdAt).slice(0,10))}"></label><label>结束日期 · 24:00 ET<input type="date" data-tx-end value="${esc(today)}"></label></div><p class="hint">连续区间固定为开始日 02:00 至结束日 24:00，美东时间（自动适配夏令时）。${readonly?'当前节点只读，展示同一交易文件的当前内容。':''}</p><div class="toolbar">${readonly?'':`<button type="button" data-tx-generate ${allocationError||!underlyings.length?'disabled':''}>生成 / 更新交易历史文件</button>`}<button type="button" data-tx-query>查询已保存文件</button>${readonly?'':'<button type="button" data-tx-delete class="danger" hidden>删除交易文件</button>'}</div></fieldset><p data-tx-status role="status">正在读取交易文件…</p><div data-tx-file></div>`;
 const fields=host.querySelector('[data-tx-fields]'),status=host.querySelector('[data-tx-status]'),view=host.querySelector('[data-tx-file]');
 let state=null;
 const options=()=>({start:host.querySelector('[data-tx-start]').value,end:host.querySelector('[data-tx-end]').value});
 function render(){
  const {start,end}=options();
  view.innerHTML=fileHTML(state.file,state.path,transactionRange(start,end),underlyings);
  const remove=host.querySelector('[data-tx-delete]');if(remove)remove.hidden=!state.file;
 }
 async function read(initial=false){
  fields.disabled=true;
  try{
   const next=await readTransactionStore(c.id);if(!host.isConnected)return;state=next;
   if(initial&&state.file){host.querySelector('[data-tx-start]').value=state.file.range.startDate;host.querySelector('[data-tx-end]').value=state.file.range.endDate;}
   render();status.textContent=state.file?'已读取已保存文件。':'尚无文件，请先生成。';
  }catch(e){if(host.isConnected)status.textContent='读取失败：'+e.message;}
  finally{if(host.isConnected)fields.disabled=false;}
 }
 host.querySelector('[data-tx-query]').onclick=()=>read();
 host.querySelector('[data-tx-generate]')?.addEventListener('click',async()=>{
  fields.disabled=true;status.textContent='正在读取本地券商原料并保存…';
  try{
   if(!state)throw Error('请先成功读取交易文件状态');
   const history=await readLocalBrokerHistory();if(!host.isConnected)return;
   const file=createTransactionFile(c,history,options());
   state=await writeTransactionStore(c.id,file,state.etag);if(!host.isConnected)return;
   render();status.textContent='已保存到 '+state.path;
   if(onSave&&onSave(state.path)===false)status.textContent+='；节点备注未保存，请查看页面提示。';
  }catch(e){if(host.isConnected)status.textContent='未完成更新：'+e.message;}
  finally{if(host.isConnected)fields.disabled=false;}
 });
 host.querySelector('[data-tx-delete]')?.addEventListener('click',async()=>{
  if(!state?.file||!confirm('删除此 thesis 的交易文件？本地券商原始记录不会删除。'))return;
  fields.disabled=true;
  try{await deleteTransactionStore(c.id,state.etag);if(!host.isConnected)return;state=await readTransactionStore(c.id);if(!host.isConnected)return;render();status.textContent='交易文件已删除。';onSave?.('');}
  catch(e){if(host.isConnected)status.textContent='未删除：'+e.message;}
  finally{if(host.isConnected)fields.disabled=false;}
 });
 read(true);
}
