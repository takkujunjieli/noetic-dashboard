export const HIDDEN = '<span class="public-hidden" aria-label="已隐藏">…</span>';
export const NODE_NAMES = {hypothesis:'Hypothesis',construction:'Portfolio Construction',returns:'Scenario Underwriting',risk:'Risk Budget',positions:'Monitor',attribution:'Attribution'};
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const nameCase = c => c.title;
export const table = (headers, rows) => `<div class="public-table-wrap"><table class="sc-table public-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
export const row = values => `<tr>${values.map(v=>`<td>${v}</td>`).join('')}</tr>`;
export const metrics = labels => `<div class="public-metrics">${labels.map(label=>`<div class="public-metric"><small>${esc(label)}</small><strong>${HIDDEN}</strong></div>`).join('')}</div>`;
export function caseLink(c, node='hypothesis') {
  return `<a href="workflow.html?view=public&node=${node}#${encodeURIComponent(c.id)}">${esc(nameCase(c))}</a>`;
}
export function positionTable(positions, cases, accounts) {
  return table(['标的','账户','工具','方向','数量','现价','成本','市值','浮盈','浮盈 %','Thesis'], positions.map(p=>row([
    esc(p.symbol), esc(accounts.find(a=>a.id===p.account)?.label || '匿名账户'),p.kind==='stock'?'正股':'期权',p.side==='short'?'空':'多',
    HIDDEN,HIDDEN,HIDDEN,HIDDEN,HIDDEN,HIDDEN,cases.filter(c=>c.symbols.includes(p.symbol)).map(c=>caseLink(c,'construction')).join('<br>') || '—'
  ])));
}
export function nodeContent(c, key, portfolio) {
  if (key==='hypothesis') return ['市场结果预期假设','论点依据','验证条件','证伪条件'].map(label=>`<section class="public-prose"><h3>${label}</h3><p>${HIDDEN}</p></section>`).join('');
  if (key==='construction') return c.plans.map((p,i)=>`<section class="public-bundle"><h3>Bundle ${i+1} · … <span class="hint">${p.frozen?'Frozen':'Draft'}</span></h3>${table(['标的','工具','方向','数量','Reference Mark / 成本','行权价','到期日','Greeks'],p.legs.map(l=>row([esc(l.symbol)||'…',esc(l.type),esc(l.side),HIDDEN,HIDDEN,HIDDEN,HIDDEN,HIDDEN])))}</section>`).join('') || '<p class="hint">尚未建立 Bundle。</p>';
  if (key==='returns') return table(['Bundle','情景','概率','标的涨跌幅','预期收益 / 损失'],c.plans.flatMap((p,i)=>['Bull Case','Base Case','Bear Case'].map(s=>row([`Bundle ${i+1}`,s,HIDDEN,HIDDEN,HIDDEN]))));
  if (key==='risk') return metrics(['账户净值','账户总风险上限','当前已用风险','剩余风险预算','目标配置','预期收益','最大损失']);
  if (key==='positions') return positionTable(portfolio.positions.filter(p=>c.symbols.includes(p.symbol)),[],portfolio.accounts);
  return metrics(['已实现 P&L','未实现 P&L','收益率','交易成本']) + ['结果','归因','复盘','对账记录'].map(label=>`<section class="public-prose"><h3>${label}</h3><p>${HIDDEN}</p></section>`).join('');
}
