import {riskBudgetAllocation} from './kelly-allocation.mjs?v=20261015-atr-uncertainty';

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=(x,d=2)=>x==null||!Number.isFinite(Number(x))?'—':Number(x).toLocaleString('en-US',{maximumFractionDigits:d});
const pct=x=>x==null?'—':n(Number(x)*100,2)+'%';
const stopRange=row=>row.downStopPrice==null||row.upStopPrice==null?'—':`$${n(row.downStopPrice)} / $${n(row.upStopPrice)}`;

export function kellyPolicyForm(data={}){
 const atr=data.atrStopMultiple??data.atrHardStopMultiple??2.5;
 return `<div class="fields kelly-policy-fields"><label>Thesis At-Risk Limit (%)<input name="kelly.thesisAtRiskLimitPct" type="number" min="0.01" max="100" step="0.1" value="${esc(data.thesisAtRiskLimitPct??'')}"></label><label>ATR Stop Multiple<input name="kelly.atrStopMultiple" type="number" min="0.1" step="0.1" value="${esc(atr)}"></label></div>`;
}

export function readKellyPolicy(form,current={}){
 const atRisk=form.elements.namedItem('kelly.thesisAtRiskLimitPct')?.value??'',atr=form.elements.namedItem('kelly.atrStopMultiple')?.value??'';
 const next={...current,allocationVersion:2,thesisAtRiskLimitPct:atRisk===''?'':Number(atRisk),atrStopMultiple:atr===''?2.5:Number(atr)};
 for(const key of ['bankroll','thesisAtRiskLimit','targetQuantile','atrReviewMultiple','atrHardStopMultiple'])delete next[key];
 return next;
}

export function kellyAllocationView(c,data=c.nodes.risk.data,sizing={}){
 const method=c.design?.allocation?.method,active=method==='risk-budget-kelly'?`<div class="callout allocation-active"><strong>In Action · Risk Budget</strong><br><small>冻结于 ${esc(c.design.allocation.at||'—')}</small></div>`:['multivariate-kelly','monte-carlo-kelly'].includes(method)?`<div class="callout"><strong>Legacy · Kelly Allocation</strong><br><small>这是旧仓位快照；重新设为 In Action 后才会采用当前 Risk Budget 规则。</small></div>`:'',result=riskBudgetAllocation(c,data,sizing.atr||{});
 if(!result.complete)return `${active}<p class="callout">${esc(result.issues.join('；')||'Risk Budget 输入不完整')}</p>`;
 const warning=result.constraintIssue?`<p class="callout">${esc(result.constraintIssue)}</p>`:'',mode=result.uncertaintyAware?`Uncertainty-Aware Kelly · ${result.monteCarlo?.samples||0} draws`:'Point Kelly',binding=result.bindingRisk==='scenario'?'Scenario Risk':result.bindingRisk==='atr-stop'?'ATR Stop Risk':'—';
 return `${active}${warning}<div class="metrics"><div class="metric"><small>Nebula Target Allocation</small><strong>${pct(result.allocatedFraction)}</strong></div><div class="metric"><small>Thesis At-Risk Limit</small><strong>${pct(result.atRiskLimitFraction)}</strong></div><div class="metric"><small>ATR Stop Risk</small><strong>${pct(result.stopRiskRate)}</strong></div><div class="metric"><small>Scenario Risk</small><strong>${pct(result.scenarioRiskRate)}</strong></div><div class="metric"><small>Binding Risk</small><strong>${binding}</strong></div><div class="metric"><small>Kelly Weight Mode</small><strong>${mode}</strong></div></div><div class="table-wrap"><table class="kelly-allocation-table"><thead><tr><th>Underlying Bundle</th><th>Point Full Kelly</th><th>Kelly Weight</th><th>ATR</th><th>ATR Stop Range<br><small>Down / Up</small></th><th>Independent Stop Risk</th><th>Target Account %</th></tr></thead><tbody>${result.bundles.map(row=>`<tr><th>${esc(row.name)}</th><td>${pct(row.fullFraction)}</td><td>${pct(row.weight)}</td><td>${n(row.atr)}</td><td>${stopRange(row)}${row.adverseStopDirection?`<br><small>Adverse: ${row.adverseStopDirection}</small>`:''}</td><td>${pct(row.stopRiskRate)}</td><td><strong>${pct(row.fraction)}</strong></td></tr>`).join('')}</tbody></table></div><div class="table-wrap"><table class="kelly-scenario-table"><thead><tr><th>Joint Scenario</th><th>Probability</th><th>100% Weighted Mix Return</th><th>Target Account Return</th></tr></thead><tbody>${result.scenarios.map(row=>`<tr><th>${esc(row.name)}</th><td>${pct(row.probability)}</td><td class="${row.weightReturn>=0?'positive':'negative'}">${pct(row.weightReturn)}</td><td class="${row.portfolioReturn>=0?'positive':'negative'}">${pct(row.portfolioReturn)}</td></tr>`).join('')}</tbody></table></div><p class="hint">Kelly 只决定 Bundle 相对权重；其绝对仓位被丢弃。ATR Stop Risk 对每个 Bundle 分别取 ±ATR Stop Multiple 中较差的一边后加权；Scenario Risk 保留用户定义的 Bull / Base / Bear 联合相对走势。两者较大值决定 Nebula Target Allocation。Workflow 只保存账户百分比；Portfolio 选择账户后再换算目标美元与数量。Risk Budget 目前只约束当前 Nebula，不检查跨 Nebula 总风险。</p>`;
}
