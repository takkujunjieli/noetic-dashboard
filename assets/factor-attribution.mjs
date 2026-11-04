import {escapeHTML as esc, percent, number} from './qlib-view.mjs?v=20261103-en';
export const labels={'Mkt-RF':'Market',SMB:'Size',HML:'Value',RMW:'Profitability',CMA:'Investment',Mom:'Momentum',industry:'Industry-specific',RF:'Risk-free',intercept:'Intercept',residual:'Residual'};
export function contributionRows(period){
  if(period?.status!=='ok')return [];
  return ['RF','Mkt-RF','industry','SMB','HML','RMW','CMA','Mom','intercept','residual'].map(key=>({key,label:labels[key],value:period.contributions[key]}));
}
export function detailHTML(row,days){
  const p=row?.periods?.[days];
  if(p?.status!=='ok')return `<p class="qlib-empty">${esc(row?.symbol||'')}: ${esc(p?.reason||row?.reason||'Insufficient data for this period')}</p>`;
  const parts=contributionRows(p),scale=Math.max(...parts.map(r=>Math.abs(r.value)),.0001);
  return `<h3>${esc(row.symbol)} · ${esc(row.industry_proxy)} Industry proxy · ${esc(p.start)} to ${esc(p.end)}</h3>
    <div class="qlib-stats"><div class="qlib-stat"><span>Actual period return · Including dividends</span><strong>${percent(p.actual_return,100)}</strong></div><div class="qlib-stat"><span>Unexplained contribution · Intercept + residual</span><strong>${percent(p.unexplained,100)}</strong></div><div class="qlib-stat"><span>Latest estimation-window R²</span><strong>${percent(p.r_squared,100)}</strong></div><div class="qlib-stat"><span>Market beta</span><strong>${number(p.beta['Mkt-RF'],2)}</strong></div></div>
    <div class="attribution-bars" role="img" aria-label="Factor contributions in percentage points">${parts.map(r=>`<div class="attribution-bar-row"><span>${esc(r.label)}</span><div class="attribution-bar-track"><i class="${r.value<0?'negative':'positive'}" style="width:${Math.abs(r.value)/scale*48}%;${r.value<0?'right':'left'}:50%"></i></div><span>${number(r.value*100,2)} pp</span></div>`).join('')}</div>
    <p class="muted small">Estimation window ${esc(p.train_start)} to ${esc(p.train_end)} · ${number(p.observations,0)} sessions · Annualized residual volatility ${percent(p.residual_volatility,100)} · Reconciliation error ${number(p.reconciliation_error*100,8)} pp</p>
    <details><summary>Factor exposures (latest estimation window)</summary><p class="muted small">${Object.entries(p.beta).map(([k,v])=>`${esc(labels[k])} ${number(v,3)}`).join(' · ')}</p></details>`;
}
