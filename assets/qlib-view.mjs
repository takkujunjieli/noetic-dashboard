// Pure presentation helpers, shared with offline tests. Never interpret score as probability.
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const number=(value,digits=2)=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(digits):'—';
export const percent=(value,scale=1)=>typeof value==='number'&&Number.isFinite(value)?`${(value*scale).toFixed(2)}%`:'—';
export const table=(headers,rows)=>`<table class="qlib-table"><thead><tr>${headers.map(h=>`<th scope="col">${escapeHTML(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
export function icStats(cs={}){
  return [{label:'IC',value:number(cs.ic,4),detail:'横截面 Pearson 均值'},
    {label:'ICIR',value:number(cs.icir,4),detail:'IC 均值 / 样本标准差 · 不年化'},
    {label:'Rank IC',value:number(cs.rank_ic,4),detail:'横截面 Spearman 均值'},
    {label:'Rank ICIR',value:number(cs.rank_icir,4),detail:'Rank IC 均值 / 样本标准差'}];
}
export function staleSessions(asof,now=new Date()){
  // Calendar age only; the UI labels this explicitly instead of claiming trading-session precision.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asof||''))return true;
  return now.getTime()-Date.parse(asof+'T23:59:59-04:00')>4*86400000;
}
