import { KEY, validateStore } from './workflow-model.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function workflowArchiveHTML(){
 try{
  const raw=localStorage.getItem(KEY),cases=raw?validateStore(JSON.parse(raw)).cases.filter(c=>c.archived):[];
  return `<section data-workflow-archives><h3>Workflow · Attribution 归档</h3><p class="muted small">同一浏览器保存的复盘，点击查看完整工作流与历史快照。</p>${cases.length?`<div class="sc-wrap"><table class="sc-table"><tr><th>Thesis</th><th>确认净损益</th><th>复盘结论</th></tr>${cases.slice().reverse().map(c=>`<tr><td><a href="workflow.html?node=attribution#${encodeURIComponent(c.id)}">${esc(c.title)} · ${esc(c.symbol)}</a><br><span class="muted small">${esc(c.updatedAt.slice(0,10))}</span></td><td>${c.nodes.attribution.data.realized===''?'未填写':esc(Number(c.nodes.attribution.data.realized).toLocaleString('en-US',{style:'currency',currency:'USD'}))}</td><td>${esc(c.nodes.attribution.data.lesson)}</td></tr>`).join('')}</table></div>`:'<p class="muted small">暂无 Workflow 归档。完成 Attribution 复盘后会显示在这里。</p>'}</section>`;
 }catch{return '<p class="muted small">Workflow 归档暂不可读，请在 Workflow 检查本地数据；原有复盘不受影响。</p>';}
}
