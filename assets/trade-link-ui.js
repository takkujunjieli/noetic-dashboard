import {esc} from './shared.js';
import {readTradeLinks,writeTradeLink,workflowLinkCases} from './trade-link-client.js?v=20261017-portfolio-assignment';
import {thesisUnderlyings} from './attribution-transactions.mjs';
const etDay=ts=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts));

// By policy one ticker has one active thesis. This deliberately removes manual
// thesis, role, and partial-allocation choices from the Trading Desk.
export async function mountTradeLinkGroupEditor(host,trades,onChanged){
 host.innerHTML='<p class="muted small">读取 Workflow 归属…</p>';
 try{const state=await readTradeLinks();if(!host.isConnected)return;
  const fills=trades.flatMap(t=>t.fills),tradeIds=new Set(trades.map(t=>t.tradeId));
  const links=state.data.links.filter(l=>l.status==='active'&&tradeIds.has(l.trade_id));
  if(links.length){const l=links[0];host.innerHTML=`<p><b>Workflow</b> · <a href="workflow.html?node=positions#${encodeURIComponent(l.workflow_case_id)}">${esc(l.workflow_title)}</a> · 已自动关联</p>`;return;}
  const syms=[...new Set(fills.map(f=>f.underlying).filter(Boolean))];
  const cases=workflowLinkCases().filter(c=>syms.every(sym=>c.underlyings.includes(sym)));
  if(cases.length!==1){host.innerHTML=`<p class="muted small">${cases.length?'多个 active thesis 命中，拒绝自动归属。':'该标的当前没有 active thesis，未建立关联。'}</p>`;return;}
  const c=cases[0];host.innerHTML=`<p><b>Workflow</b> · 将自动关联至 <a href="workflow.html?node=positions#${encodeURIComponent(c.id)}">${esc(c.title)}</a></p><button type="button" class="mini-btn" data-auto-link>关联全部成交</button><p data-link-status class="muted small" role="status"></p>`;
  host.querySelector('[data-auto-link]').onclick=async()=>{const b=host.querySelector('[data-auto-link]'),s=host.querySelector('[data-link-status]');b.disabled=true;try{for(const trade of trades){const allocations=trade.fills.map(f=>({fill_id:f.fill_id,quantity:Number(f.qty)}));if(allocations.length)await writeTradeLink({action:'link',trade_id:trade.tradeId,workflow_case:c,allocations},state);}onChanged?.(state.data);host.innerHTML=`<p><b>Workflow</b> · ${esc(c.title)} · 已自动关联</p>`;}catch(e){s.textContent=e.message;b.disabled=false;}};
 }catch(e){if(host.isConnected)host.textContent='关联不可用：'+e.message;}
}

const money=n=>Number(n).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
function brokerPnlView(c,ledger){let syms=[];try{syms=thesisUnderlyings(c);}catch{}const rows=(ledger.events||[]).filter(x=>syms.includes(x.symbol));const total=rows.reduce((s,x)=>s+Number(x.realized_gain||0),0);const byAccount=new Map();for(const x of rows)byAccount.set(x.account,(byAccount.get(x.account)||0)+Number(x.realized_gain||0));return `<section class="broker-pnl"><h3>经纪商已实现 P&amp;L</h3><p class="hint">范围：${syms.length?esc(syms.join(', ')):'未冻结 In Action underlying'} · 截点：${esc(ledger.updated_at||'尚未同步')}</p>${rows.length?`<div class="metrics"><div class="metric"><small>累计已实现</small><strong>${money(total)}</strong></div>${[...byAccount].map(([a,v])=>`<div class="metric"><small>${esc(a)}</small><strong>${money(v)}</strong></div>`).join('')}</div><div class="table-wrap"><table><thead><tr><th>时间</th><th>账户</th><th>标的</th><th>数量</th><th>平仓价</th><th>已实现 P&amp;L</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(etDay(x.timestamp))}</td><td>${esc(x.account)}</td><td>${esc(x.symbol)}</td><td>${esc(x.quantity)}</td><td>${esc(x.price)}</td><td>${money(x.realized_gain)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted small">暂无此 thesis 的券商已实现 P&amp;L；下一次 MCP 同步后可用。</p>'}</section>`;}
export async function mountMonitorTrades(host,c,{readonly=false,replay=false,onRefresh}={}){
 host.innerHTML='<h3>执行记录</h3><p>读取成交事实…</p>';
 try{const [jr,nr,pr]=await Promise.all([fetch('/api/trade-journal',{cache:'no-store'}),fetch('/api/trade-annotations',{cache:'no-store'}),fetch('/api/broker-pnl',{cache:'no-store'})]);if(!jr.ok||!nr.ok||!pr.ok)throw Error('本地成交服务不可用');const journal=await jr.json(),notes=await nr.json(),ledger=await pr.json();if(!host.isConnected)return;const fills=new Map(journal.fills.map(f=>[f.fill_id,f])),links=c.nodes.positions.data.executionLinks||[];
 host.innerHTML=`<h3>执行记录 · Monitor</h3><p class="hint">${replay?'按快照中冻结的关联展示。':'成交由 Trading Desk 按唯一 active thesis 自动关联。'}${readonly?' · 只读':''}</p>${!readonly?'<button type="button" data-monitor-refresh>重新读取关联</button>':''}<div class="table-wrap"><table><thead><tr><th>美东日期</th><th>标的 / 合约</th><th>方向</th><th>数量</th><th>成交价</th><th>理由</th><th>状态</th></tr></thead><tbody>${links.flatMap(l=>l.allocations.map(a=>{const f=fills.get(a.fill_id);if(!f)return `<tr><td colspan="7">${esc(a.fill_id)} · 成交源缺失</td></tr>`;const url=`trading.html?sym=${encodeURIComponent(f.underlying)}&tf=1d&date=${etDay(f.timestamp)}&trade=${encodeURIComponent(l.trade_id)}`;return `<tr><td><a href="${url}">${etDay(f.timestamp)}</a></td><td>${esc(f.symbol)}</td><td>${esc(f.side)}</td><td>${a.quantity}</td><td>${esc(f.price)}</td><td>${esc(notes.annotations?.[l.trade_id]?.reason||'未填写')}</td><td>${l.status==='active'?'已关联':'已解除'}</td></tr>`;})).join('')||'<tr><td colspan="7">暂无关联成交。</td></tr>'}</tbody></table></div>`;host.querySelector('[data-monitor-refresh]')?.addEventListener('click',onRefresh);
 host.insertAdjacentHTML('beforeend',brokerPnlView(c,ledger));
 }catch(e){if(host.isConnected)host.textContent=e.message;}
}
