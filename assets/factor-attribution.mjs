import {escapeHTML as esc, percent, number} from './qlib-view.mjs';
export const labels={'Mkt-RF':'市场',SMB:'规模',HML:'价值',RMW:'盈利',CMA:'投资',Mom:'动量',industry:'行业独立部分',RF:'无风险',intercept:'截距',residual:'残差'};
export function contributionRows(period){
  if(period?.status!=='ok')return [];
  return ['RF','Mkt-RF','industry','SMB','HML','RMW','CMA','Mom','intercept','residual'].map(key=>({key,label:labels[key],value:period.contributions[key]}));
}
export function detailHTML(row,days){
  const p=row?.periods?.[days];
  if(p?.status!=='ok')return `<p class="qlib-empty">${esc(row?.symbol||'')}：${esc(p?.reason||row?.reason||'此区间样本不足')}</p>`;
  const parts=contributionRows(p),scale=Math.max(...parts.map(r=>Math.abs(r.value)),.0001);
  return `<h3>${esc(row.symbol)} · ${esc(row.industry_proxy)} 行业代理 · ${esc(p.start)} 至 ${esc(p.end)}</h3>
    <div class="qlib-stats"><div class="qlib-stat"><span>区间实际收益 · 含分红</span><strong>${percent(p.actual_return,100)}</strong></div><div class="qlib-stat"><span>未解释贡献 · 截距 + 残差</span><strong>${percent(p.unexplained,100)}</strong></div><div class="qlib-stat"><span>最新估计窗口 R²</span><strong>${percent(p.r_squared,100)}</strong></div><div class="qlib-stat"><span>市场 Beta</span><strong>${number(p.beta['Mkt-RF'],2)}</strong></div></div>
    <div class="attribution-bars" role="img" aria-label="各因子贡献，单位为收益百分点">${parts.map(r=>`<div class="attribution-bar-row"><span>${esc(r.label)}</span><div class="attribution-bar-track"><i class="${r.value<0?'negative':'positive'}" style="width:${Math.abs(r.value)/scale*48}%;${r.value<0?'right':'left'}:50%"></i></div><span>${number(r.value*100,2)} pp</span></div>`).join('')}</div>
    <p class="muted small">估计窗口 ${esc(p.train_start)} 至 ${esc(p.train_end)} · ${number(p.observations,0)}个交易日 · 残差年化波动 ${percent(p.residual_volatility,100)} · 对账误差 ${number(p.reconciliation_error*100,8)} pp</p>
    <details><summary>因子暴露（最新估计窗口）</summary><p class="muted small">${Object.entries(p.beta).map(([k,v])=>`${esc(labels[k])} ${number(v,3)}`).join(' · ')}</p></details>`;
}
