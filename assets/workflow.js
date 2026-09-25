import {captureWorkflow,syncWorkflowSnapshot,UNSYNCED_KEY,readUnsyncedNebulae,writeUnsyncedNebulae,remainingUnsyncedNebulae} from './workflow-sync.js';
import {createGalaxy} from './galaxy-scene.js?v=20260924-3';
import {getPat,setPat} from './shared.js';
import {expectedCharts} from './expected-return.js';
import {forecastFor,completedReturn,rate} from './expected-return.mjs';
import {planTable,planSelector} from './design-plans.js';
import {constructionFields,constructionLegs,constructionSummary,readConstruction} from './trade-structure.js';
import {templateLegs,newStructureLeg} from './trade-structure.mjs';
import { mountAttributionControl } from './attribution-control.js';
import { renderRiskControl, renderJournal, syncLegacyWorkflowData } from "./strategy.js";
import {VERSION,KEY,NODES,LAYERS,LABELS,displayState,hypothesisFields,archiveCase,emptyDesign,initializePlans,savePlan,selectPlan,setActivePlan,deletePlan,planView,clone,createCase,record,saveNode,transition,gate,scenario,exposure,riskCheck,demoCase,validateStore} from './workflow-model.mjs';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null||v===undefined||Number.isNaN(v)?'未估计':Number.isFinite(v)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v):'无上界';
const fmt=v=>v===null||v===undefined||Number.isNaN(v)?'缺少数据':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
const date=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('zh-CN',{hour12:false}):'—';
let raw=null,store={version:VERSION,cases:[]},blocked=false,selected='',node='hypothesis',filter='active',replay=null,dirty=false;
function notice(message){$('#notice').textContent=message;}
try{raw=localStorage.getItem(KEY);if(raw){store=validateStore(JSON.parse(raw));const migrated=JSON.stringify(store);if(migrated!==raw){if(localStorage.getItem(KEY)!==raw)throw Error('另一个窗口已更新数据，请刷新后迁移');localStorage.setItem(KEY,migrated);raw=migrated;}}}catch(e){blocked=true;notice('本地存储不可读，已停止写入以保留原始数据。请保留原始存储数据。'+e.message);}
let unsyncedNebulae=readUnsyncedNebulae();
let riskController=null,planEditor=null;
let galaxy=null,panelOpen=false;
function saveUnsyncedNebulae(){try{writeUnsyncedNebulae(unsyncedNebulae);}catch(e){notice('未同步提示无法持久化：'+e.message);}}
function markNebulaUnsynced(id){if(!id)return;unsyncedNebulae.add(id);saveUnsyncedNebulae();}
function current(){return store.cases.find(c=>c.id===selected);}
function visible(){const c=current();if(!replay)return c;const historical=clone(c?.events.find(e=>e.id===replay)?.snapshot);if(historical){for(const n of Object.values(historical.nodes))n.state=displayState(n.state);historical.nodes.hypothesis.data=hypothesisFields(historical.nodes.hypothesis.data);if(!historical.design)initializePlans(historical);}return historical;}
function readOnly(){return blocked||!!replay||!!current()?.archived;}
function persist(next){
 if(blocked)throw Error('本地存储不可用，无法保存');
 if(localStorage.getItem(KEY)!==raw)throw Error('另一个窗口已更新数据。请刷新页面以避免覆盖。');
 const json=JSON.stringify(next);localStorage.setItem(KEY,json);raw=json;store=next;const syncButton=$('#sync-workflow');if(syncButton&&!syncButton.disabled)syncButton.textContent='同步全部';
}
function mutate(fn){try{const next=clone(store),c=next.cases.find(x=>x.id===selected);fn(c,next);persist(next);markNebulaUnsynced(c?.id);dirty=false;render();notice('已保存到此浏览器；金色 Nebula 表示尚未同步。');return true;}catch(e){notice('未保存：'+e.message);return false;}}
function leave(){return !dirty||confirm('节点内容尚未保存。放弃这些编辑并继续？');}
function selectCase(id){if(!leave())return;panelOpen=false;selected=id;replay=null;dirty=false;planEditor=null;node='hypothesis';const c=current();if(c)filter=c.archived?'archived':'active';history.replaceState(null,'',`#${encodeURIComponent(id)}`);$('#galaxy-search').value='';render();galaxy?.focus(id);}
function renderLibrary(){const cases=store.cases.filter(c=>c.archived===(filter==='archived'));$('#count').textContent=cases.length+' NEBULAE';document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===filter));
 const query=$('#galaxy-search').value.trim().toLowerCase();$('#cases').hidden=!query;$('#cases').innerHTML=cases.filter(c=>(c.title+' '+c.symbol+' '+(c.linkedSymbols||[]).join(' ')).toLowerCase().includes(query)).map(c=>`<button class="case ${unsyncedNebulae.has(c.id)?'is-unsynced':''}" data-case="${esc(c.id)}"><strong>${esc(c.title)}</strong><small>${esc(c.symbol||c.linkedSymbols?.join(' · ')||'Nebula')} · ${c.demo?'DEMO':c.archived?'Archive':'Active'}</small></button>`).join('')||'<p class="hint">没有匹配的 Nebula</p>';
 $('#galaxy-empty').hidden=!!cases.length;
 const shown=cases.map(x=>({...((replay&&x.id===selected)?visible():x),unsynced:unsyncedNebulae.has(x.id)}));galaxy?.update(shown,panelOpen?{caseId:selected,key:node}:null);
 $('#galaxy-location').textContent=panelOpen&&current()?`${current().title} / ${NODES[node].name}`:'GALAXY / OVERVIEW';
}
const F={
 hypothesis:[['expectation','市场结果预期假设','textarea'],['rationale','论点依据','textarea'],['verification','验证条件','textarea'],['invalidation','证伪条件','textarea']],
 signal:[['indicator','信号名称'],['condition','触发规则','textarea'],['expires','信号有效至','date'],['evidence','触发证据与观察时间','textarea']],
 returns:[['expectedNet','预期净损益 ($)','number'],['capital','配置资本 ($)','number'],['expectedDate','预计完成日期 · 留空使用结构评估日期','date'],['averageLoss','平均亏损金额 ($) · 矩阵可选输入','number']],
 construction:[],
 risk:[['lossBudget','本实例到期理论损失预算 ($)','number'],['deltaBudget','同标的合计 |Delta| 上限 (股)','number'],['existingDelta','同标的其他持仓 Delta (股)','number'],['context','账户风险检查：集中度 / 购买力 / 相关性','textarea'],['notes','其他约束与应对','textarea']],
 positions:[],
 attribution:[['realized','实际净已实现损益 ($) · 未建仓填 0','number'],['reconciliation','对账记录 / 数据来源','textarea'],['outcome','论点结果与预期差异','textarea'],['drivers','收益来源：方向 / 工具 / 仓位 / 调整 / 成本','textarea'],['lesson','复盘结论 / 待验证问题','textarea']]
};
const INTROS={hypothesis:'记录市场结果预期假设及其依据、验证与证伪条件。四项均可留空，后续逐步完善。',signal:'先定义规则，再记录实际触发证据。当前采用人工确认。',returns:'使用组合腿计算目标日损益；有依据的概率才用于期望收益。',construction:'管理并比较候选方案。保存后同步到 Expected Return；Risk Budget 共用账户风控设置。In Action 标记当前采用的方案。',risk:'检查本实例损失与同标的合计 Delta，并记录账户层面的人工核查。',positions:'此节点暂时留空，等待后续重新设计。',attribution:'对照最初假设和历次方案，保存结果与经验。归档后只读。'};
function field([key,label,type='text',options],data,prefix='f'){
 const name=`${prefix}.${key}`,value=data[key]??'';
 return `<label>${esc(label)}${type==='textarea'?`<textarea name="${name}" rows="3">${esc(value)}</textarea>`:type==='select'?`<select name="${name}">${options.map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`:`<input name="${name}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(value)}">`}</label>`;
}
function metrics(items){return `<div class="metrics">${items.map(([label,value])=>`<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join('')}</div>`;}
function designSummary(c){const result=scenario(c),ex=exposure(c.nodes.construction.data.legs),r=c.nodes.risk.data;
 return `<section aria-label="组合方案对照"><h3>组合方案对照 · 保存后形成新版本</h3>${metrics([['净 Delta · 股',fmt(ex.delta)],['手动预期净损益',money(forecastFor(c).expectedNet)],['到期理论最大损失',money(result.maxLoss)]])}<p class="hint">Gamma ${fmt(ex.gamma)} · Theta ${fmt(ex.theta)} / 天 · Vega ${fmt(ex.vega)} / vol point</p>${result.error?`<div class="callout">${esc(result.error)}</div>`:`<div class="table-wrap"><table><thead><tr><th>目标日情景</th><th>股价</th><th>涨跌</th><th>组合净损益</th></tr></thead><tbody>${result.rows.map(row=>`<tr><td>${row.name}</td><td>${money(row.price)}</td><td>${row.change}%</td><td class="${row.pnl<0?'negative':'positive'}">${money(row.pnl)}</td></tr>`).join('')}</tbody></table></div><p class="hint">目标日 ${esc(result.expiry)}。${result.expected===null?'未使用概率加权；概率需完整且合计 100%。':'期望值按手工概率加权，非预测保证。'}</p>`}<p class="hint">股票线性损益 + 同到期日期权内在价值，标准合约乘数 100。未模拟到期前 IV / 时间价值、提前行权、指派与到期腿风险。跨到期结构不计算。</p>${node==='risk'?`<div class="callout">${riskCheck(c).length?riskCheck(c).map(esc).join('<br>'):'当前模型内检查满足；账户其他风险按人工核查记录。'}<br>同标的合计 Delta：${ex.delta===null||r.existingDelta===''?'未计算':fmt(ex.delta+(+r.existingDelta))}</div>`:''}</section>`;
}
function positionsInspector(c){const ro=readOnly(),n=c.nodes.positions;return `<section class="inspector empty-node" aria-label="Position Management 空节点"><p class="eyebrow">${NODES.positions.cn}</p><h2>Position Management</h2><p class="intro">${INTROS.positions}</p><div class="current-state">当前状态：${LABELS[n.state]}</div><div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':`<div class="toolbar">${NODES.positions.states[n.state].map(to=>`<button data-transition="${to}">${LABELS[to]}</button>`).join('')}</div>`}</div></section>`;}
function editorCase(c){const copy=clone(c);if(planEditor?.id){const p=c.design?.plans.find(p=>p.id===planEditor.id);if(p)copy.nodes.construction.data=clone(p.construction);}else copy.nodes.construction.data=emptyDesign(c.horizon).construction;return copy;}
function constructionInspector(c){const ro=readOnly(),p=c.design?.plans.find(p=>p.id===planEditor?.id),edit=editorCase(c);return `<section class="inspector"><p class="eyebrow">组合构建</p><h2>Portfolio Construction</h2><p class="intro">${INTROS.construction}</p><div class="current-state">当前状态：${LABELS[c.nodes.construction.state]}</div>${planTable(c,ro)}${planEditor?`<section class="plan-editor"><div class="section-heading"><h3>${p?'编辑方案':'添加方案'}</h3><button type="button" id="close-plan-editor">关闭面板</button></div><form id="node-form"><fieldset ${ro||(['returns','risk'].includes(node)&&!c.design?.plans.length)?'disabled':''}><label>方案名称<input name="plan-name" maxlength="100" value="${esc(p?.name||'')}" placeholder="例如：Bull Call Spread"></label>${constructionFields(edit)}<div id="editor-preview">${constructionSummary(edit)}</div>${ro?'':'<button type="submit" class="primary">保存方案</button>'}<span id="dirty-label" class="hint"></span></fieldset></form></section>`:''}<div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':NODES.construction.states[c.nodes.construction.state].map(to=>`<button data-transition="${to}">${LABELS[to]}</button>`).join('')}</div></section>`;}
function returnHistoryCases(c){if(!replay)return store.cases;return store.cases.map(x=>{const events=x.events.filter(e=>e.at<=c.updatedAt&&(x.id!==c.id||e.revision<=c.revision)),last=events.at(-1);return last?{...clone(last.snapshot),events}:null;}).filter(Boolean);}
function returnsInspector(c){const ro=readOnly(),hasPlan=!!c.design?.plans.length;return `<section class="inspector expected-return-inspector" aria-label="Expected Return"><p class="eyebrow">收益与期望</p><h2>Expected Return</h2><p class="intro">收益曲线解释结构；人工预测与历史实际结果对照；矩阵展示达到预期所需的条件。</p><div class="current-state">当前状态：${LABELS[c.nodes.returns.state]}</div>${planSelector(c)}<form id="node-form"><fieldset ${ro||!hasPlan?'disabled':''}><div class="fields return-inputs">${F.returns.map(f=>field(f,c.nodes.returns.data)).join('')}</div><button class="primary" type="submit">保存节点</button><span id="dirty-label" class="hint"></span></fieldset></form><div id="live-summary">${expectedCharts(c,returnHistoryCases(c))}</div><div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':NODES.returns.states[c.nodes.returns.state].map(to=>`<button data-transition="${to}">${LABELS[to]}</button>`).join('')}</div></section>`;}
function inspector(c){if(node==='risk')return riskInspector(c);if(node==='returns')return returnsInspector(c);if(node==='construction')return constructionInspector(c);if(node==='positions')return positionsInspector(c);const n=c.nodes[node],ro=readOnly(),isDesign=['returns','construction','risk'].includes(node);
 return `<section class="inspector" aria-label="节点工作区"><p class="eyebrow">${NODES[node].cn}</p><h2>${NODES[node].name}</h2><p class="intro">${INTROS[node]}</p><div class="current-state">当前状态：${LABELS[n.state]}</div>${['returns','risk'].includes(node)?planSelector(c):''}<div id="live-summary">${node==='construction'?constructionSummary(c):isDesign?designSummary(c):node==='attribution'?attributionSummary(c):''}</div>${node==='risk'?'<div id="wf-risk-control" class="shared-risk-control"></div>':''}${node==='attribution'?'<div id="wf-attribution-control"></div>':''}<form id="node-form"><fieldset ${ro||(['returns','risk'].includes(node)&&!c.design?.plans.length)?'disabled':''}>${F[node].map(f=>field(f,n.data)).join('')}${node!=='construction'?'<label>本次修改说明<input name="reason" placeholder="记录为什么修改，写入事件日志"></label>':''}<button class="primary" type="submit">保存节点</button><span id="dirty-label" class="hint"></span></fieldset></form><div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':`<div class="toolbar">${NODES[node].states[n.state].map(to=>`<button data-transition="${to}" ${gate(c,node,to)?'disabled':''}>${LABELS[to]}</button>`).join('')||'<span class="hint">此节点生命周期已结束。</span>'}</div><div class="gate">${[...new Set(NODES[node].states[n.state].map(to=>gate(c,node,to)).filter(Boolean))].map(esc).join('<br>')}</div>`}</div></section>`;
}
function attributionSummary(c){
 const events=c.events||current().events.filter(e=>e.revision<=c.revision),baseline=events.find(e=>e.node==='construction'&&((['设置 In Action Policy','设置 In Action'].includes(e.type)&&e.snapshot.design?.activeId)||e.type==='选定设计基准'||e.snapshot.nodes.construction.state==='baseline'))?.snapshot;
 const expected=c.returnBasis?.expectedNet??(baseline?(scenario(baseline.design?.activeId?planView(baseline,baseline.design.activeId):baseline).expected??null):null),actual=c.nodes.attribution.data.realized;
 const actualReturn=completedReturn(c);
 return (c.returnBasis?metrics([['固定配置资本',money(c.returnBasis.capital)],['预期收益率',fmt(c.returnBasis.rate)+'%'],['实际收益率',actualReturn?fmt(actualReturn.rate)+'%':c.nodes.attribution.data.realized!==''?fmt(rate(c.nodes.attribution.data.realized,c.returnBasis.capital))+'%（待归档）':'待对账']]):'')+metrics([['首次基准期望损益',money(expected)],['人工确认净已实现损益',actual===''?'待对账':money(Number(actual))],['与基准期望差异',actual!==''&&expected!==null?money(Number(actual)-expected):'—']])+`<p class="hint">${baseline?`首次基准方案 v${baseline.revision} · 目标日 ${esc(baseline.horizon)}；差异仅用于比较，不代表因果归因。`:'尚无已确认基准方案。'} 下方时间线保留原始假设、方案和管理动作。</p>`;
}
function timeline(c){return `<section class="timeline"><div class="section-heading"><h2>Activity & Snapshots</h2><span class="badge">${c.events.length} 条记录</span></div><ol>${c.events.slice().reverse().map(e=>`<li class="event"><time>${date(e.at)}</time><div><strong>v${e.revision} · ${esc(NODES[e.node].name)} · ${esc(e.type.replaceAll('In Action Policy','In Action'))}</strong><p>${esc(e.reason.replaceAll('In Action Policy','In Action'))}</p></div><button data-replay="${esc(e.id)}">查看快照</button></li>`).join('')}</ol></section>`;}
function render(){$('#wf-risk-control')?._riskCleanup?.();riskController=null;renderLibrary();const c=visible(),live=current();$('#main').hidden=!c||!panelOpen;document.body.classList.toggle('panel-open',!!c&&panelOpen);if(!c||!panelOpen){$('#main').innerHTML='';return;}
 $('#main').innerHTML=`<button id="close-star-panel" class="panel-close" aria-label="关闭节点面板">✕</button>${replay?`<div class="replay"><span>历史快照 · v${c.revision} · ${date(c.updatedAt)}<br>节点、参数与状态均为当时记录；只读。</span><button id="exit-replay">返回当前版本</button></div>`:''}<div class="instance-header"><div><p class="eyebrow">${esc(c.symbol)} ${c.demo?' / SIMULATED':''}</p><h2 id="nebula-title" ${node==='hypothesis'&&!readOnly()?'data-rename-nebula title="双击重命名 Nebula"':''}>${esc(c.title)}</h2><div class="instance-meta"><span>目标 ${esc(c.horizon)}</span><span>v${c.revision}</span><span>${c.archived?'Archived':'Active'}</span></div></div><div class="toolbar"><button id="snapshot" ${readOnly()?'disabled':''}>保存快照</button><button id="export-case">导出实例</button>${node==='attribution'&&!readOnly()?'<button id="archive-case">归档实例</button>':''}</div></div>${inspector(c)}<details class="nebula-context"><summary>Nebula · 来源与历史记录</summary>${sourceLinkHTML(c)}${timeline(live)}</details>`;
 mountRiskPanel(c);
 const attributionHost=$('#wf-attribution-control');
 if(attributionHost)mountAttributionControl(attributionHost,{c,readonly:readOnly(),onSave:evidence=>{if(!attributionHost.isConnected||readOnly())return;const data=readDraft();data.evidence=clone(evidence);mutate(c=>saveNode(c,'attribution',data,'保存账户已实现盈亏对账参考（非 thesis 自动归属）'));}});
}
function readDraft(){const form=$('#node-form');if(node==='construction'&&form)return readConstruction(form,editorCase(visible()));const d=clone(visible().nodes[node].data);if(!form)return d;for(const [key,,type]of F[node]){const el=form.elements.namedItem(`f.${key}`);if(!el)continue;d[key]=type==='number'&&el.value!==''?Number(el.value):el.value;}
 if(node==='construction'){d.legs=[...form.querySelectorAll('.leg')].map(el=>{const l={};el.querySelectorAll('[name]').forEach(input=>{const k=input.name.split('.')[1];l[k]=input.type==='number'&&input.value!==''?+input.value:input.value;});return l;});}
 if(node==='risk'&&riskController&&!readOnly()){d.sizing=riskController.read();d.accountSnapshot=clone(riskController.context());}
 return d;
}
function updatePreview(){dirty=node==='returns'?JSON.stringify(readDraft())!==JSON.stringify(visible().nodes.returns.data):true;$('#dirty-label').textContent=dirty?' · 未保存':'';document.querySelectorAll('[data-transition]').forEach(b=>b.disabled=dirty||!!gate(visible(),node,b.dataset.transition));const c=clone(visible());c.nodes[node].data=readDraft();const preview=$(node==='construction'?'#editor-preview':'#live-summary');if(preview)preview.innerHTML=node==='construction'?constructionSummary(c):node==='returns'?expectedCharts(c,returnHistoryCases(c)):node==='risk'?designSummary(c):node==='attribution'?attributionSummary(c):'';}
function openNew(){if(!leave())return;$('#new-form').reset();$('#new-dialog').showModal();}
function addDemo(){if(!leave())return;const c=demoCase();try{const next=clone(store);next.cases.push(c);persist(next);markNebulaUnsynced(c.id);dirty=false;selectCase(c.id);notice('已创建模拟案例。所有价格、Greeks 与预算均为示例。');}catch(e){notice(e.message);}}
function download(data,name){const blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#new').addEventListener('click',openNew);$('#cancel-new').addEventListener('click',()=>$('#new-dialog').close());
$('#new-form').addEventListener('submit',e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target)),c=createCase(data);if(!c.title)return;try{const next=clone(store);next.cases.push(c);persist(next);markNebulaUnsynced(c.id);dirty=false;$('#new-dialog').close();selectCase(c.id);}catch(err){notice(err.message);}});
document.addEventListener('dblclick',e=>{
 const title=e.target.closest('[data-rename-nebula]');if(!title||node!=='hypothesis'||readOnly())return;
 const input=document.createElement('input');input.id='nebula-title-input';input.maxLength=140;input.value=current().title;title.replaceWith(input);input.focus();input.select();let settled=false;
 const finish=save=>{if(settled)return;settled=true;const nextTitle=input.value.trim(),previous=current()?.title||'';if(!save||nextTitle===previous){render();return;}if(!nextTitle){notice('Nebula 名称不能为空。');render();return;}mutate(c=>{c.title=nextTitle;record(c,'重命名 Nebula','hypothesis',`「${previous}」→「${nextTitle}」`);});};
 input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();finish(true);}else if(event.key==='Escape'){event.preventDefault();finish(false);}});
 input.addEventListener('blur',()=>finish(true),{once:true});
});
document.addEventListener('input',e=>{if(e.target.closest('#node-form')&&e.target.name!=='reason'){if(node==='construction'&&['underlying','type','strike','expiry'].includes(e.target.name.split('.')[1])){const leg=e.target.closest('.structure-leg');if(leg)for(const key of ['delta','gamma','theta','vega','iv','quoteAt','underlyingPrice']){const input=leg.querySelector(`[name$=".${key}"]`);if(input)input.value='';}}if(e.target.name.endsWith('.type')){const leg=e.target.closest('.leg');leg.querySelector(node==='construction'?'.structure-option-fields':'.option-fields').hidden=e.target.value==='stock';leg.querySelector(node==='construction'?'.structure-greeks':'.greek-fields').hidden=e.target.value==='stock';}updatePreview();}});
document.addEventListener('submit',e=>{if(e.target.id!=='node-form')return;e.preventDefault();if(node==='construction'){if(readOnly())return;const data=readDraft(),name=e.target.elements.namedItem('plan-name').value,id=planEditor?.id;const previous=planEditor;planEditor=null;if(!mutate(c=>savePlan(c,id,name,data)))planEditor=previous;return;}if(node==='returns'&&!dirty){notice('当前输入已保存。');return;}if(node==='risk'&&!riskController){notice('账户风控数据未载入，暂不能保存评估');return;}const data=readDraft(),reason=e.target.elements.namedItem('reason')?.value.trim()||'更新节点内容';mutate(c=>{if(!saveNode(c,node,data,reason))throw Error('没有内容变更');});});
document.addEventListener('click',async e=>{let b=e.target.closest('button');
 if(!b&&!e.target.closest('[popover]')){const row=e.target.closest('[data-plan-row]');if(row)b=row.querySelector('[data-edit-plan]');}
 if(!b)return;
 if(b.dataset.planMenu){const menu=document.getElementById(b.dataset.planMenu);if(menu.matches(':popover-open')){menu.hidePopover();return;}const box=b.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(box.right-190,innerWidth-198))+'px';menu.style.top=Math.max(8,Math.min(box.bottom+6,innerHeight-110))+'px';menu.showPopover();b.setAttribute('aria-expanded','true');menu.addEventListener('toggle',()=>b.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));return;}
 if(b.closest('[popover]')?.matches(':popover-open'))b.closest('[popover]').hidePopover();
 if(b.hasAttribute('data-new'))return openNew();if(b.hasAttribute('data-demo'))return addDemo();
 if(b.dataset.case)return selectCase(b.dataset.case);
 if(b.dataset.filter){if(!leave())return;panelOpen=false;filter=b.dataset.filter;planEditor=null;selected=store.cases.find(c=>c.archived===(filter==='archived'))?.id||'';replay=null;dirty=false;render();galaxy?.overview();return;}
 if(b.dataset.node&&!b.dataset.star){openStar(selected,b.dataset.node);return;}
 if(b.dataset.replay){if(!leave())return;replay=b.dataset.replay;dirty=false;planEditor=null;render();return;}
 if(b.id==='exit-replay'){replay=null;planEditor=null;render();return;}
 if(b.id==='archive-case'){if(dirty){notice('请先保存节点内容');return;}if(mutate(c=>archiveCase(c))){filter='archived';render();}return;}
 if(b.id==='export-case')return download({version:VERSION,cases:[current()]},`thesis-${current().id}.json`);
 if(b.id==='snapshot'){if(!leave())return;const reason=prompt('快照说明','保存当前工作流');if(reason?.trim())mutate(c=>record(c,'手动快照',node,reason));return;}
 if(b.id==='add-plan'){if(readOnly()||!leave())return;planEditor={id:null};dirty=false;render();return;}
 if(b.id==='close-plan-editor'){if(!leave())return;planEditor=null;dirty=false;render();return;}
 if(b.dataset.editPlan){if(!leave())return;const id=b.dataset.editPlan;
  if(readOnly()){planEditor={id};dirty=false;render();return;}
  planEditor={id};if(!mutate(c=>selectPlan(c,id)))planEditor=null;return;
 }
 if(b.dataset.activePlan){if(readOnly()||!leave())return;planEditor=null;mutate(c=>setActivePlan(c,c.design.activeId===b.dataset.activePlan?'':b.dataset.activePlan));return;}
 if(b.dataset.deletePlan){if(readOnly()||!leave())return;const id=b.dataset.deletePlan,p=current().design.plans.find(p=>p.id===id);if(!confirm(`删除方案「${p.name}」及其收益/风险配置？历史快照仍保留。`))return;planEditor=null;mutate(c=>deletePlan(c,id));return;}
 if(b.id==='apply-structure-template'||b.id==='add-structure-leg'||b.hasAttribute('data-remove-structure')){
  if(readOnly())return;const d=readDraft();
  if(b.id==='apply-structure-template'){if(d.legs.length&&!confirm('用模板替换当前组合腿？尚未保存的腿参数会被替换。'))return;d.legs=templateLegs(d.template);}
  else if(b.id==='add-structure-leg')d.legs.push(newStructureLeg());else d.legs.splice(Number(b.dataset.removeStructure),1);
  $('#structure-legs').innerHTML=constructionLegs(d.legs);updatePreview();return;
 }
 if(b.dataset.transition){if(dirty){notice('请先保存节点内容');return;}const to=b.dataset.transition;
 if(mutate(c=>transition(c,node,to))&&current().archived){filter='archived';render();}return;}
});
document.addEventListener('change',e=>{if(e.target.matches('[data-leg-toggle]')){e.target.closest('.payoff-card').classList.toggle('show-legs',e.target.checked);return;}if(e.target.id!=='design-plan-selector')return;const id=e.target.value;if(!leave()){e.target.value=visible().design.selectedId;return;}if(readOnly()){const c=visible(),p=c.design?.plans.find(p=>p.id===id);if(p){notice('历史快照按当时查看的方案回放；其他方案可在 Portfolio Construction 查看交易腿。');e.target.value=c.design.selectedId;}return;}mutate(c=>selectPlan(c,id));});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===KEY)notice('另一个窗口修改了 Workflow 数据，请刷新页面。当前窗口不会覆盖新数据。');if(e.key===UNSYNCED_KEY){unsyncedNebulae=readUnsyncedNebulae();renderLibrary();}});

function riskInspector(c){const ro=readOnly();return `<section class="inspector"><p class="eyebrow">风险预算</p><h2>Risk Budget</h2><p class="intro">管理 Thesis 的风险参数与仓位上限。正股仓位手工试算已移至 Portfolio。</p><div class="current-state">当前状态：${LABELS[c.nodes.risk.state]}</div><h3>账户风险控制</h3><div id="wf-risk-control" class="workflow-legacy-risk"></div>${ro?'':'<button id="save-risk-snapshot" class="primary">保存节点快照</button>'}<div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':NODES.risk.states[c.nodes.risk.state].map(to=>`<button data-transition="${to}">${LABELS[to]}</button>`).join('')}</div></section>`;}
function mountRiskPanel(c){
 const host=$('#wf-risk-control');if(!host)return;
 const readonly=readOnly();let snapshot;
 try{snapshot=c.accountRiskSnapshot?JSON.parse(c.accountRiskSnapshot):null;}catch{}
 if(readonly&&!snapshot){host.innerHTML='<p class="hint">此历史版本尚未保存账户风险控制快照。</p>';return;}
 renderRiskControl(host,{readonly,snapshot:readonly?snapshot:null,hideSync:true,showSizing:false,showNarrative:false,initialBundle:c.sourceLink?.name}).catch(e=>notice('账户风控载入失败：'+e.message));
}
document.addEventListener('click',e=>{
 if(!e.target.closest('#save-risk-snapshot')||readOnly())return;
 const host=$('#wf-risk-control');if(!host?._riskRead){notice('账户风控仍在载入，请稍后保存。');return;}
 const snapshot=JSON.stringify(host._riskRead());
 mutate(c=>{c.accountRiskSnapshot=snapshot;record(c,'保存风控快照','risk','记录账户风险控制 · 仓位');});
});

galaxy=createGalaxy($('#galaxy-scene'),{onStar:openStar,onNebula:selectCase,onBackground:closeStar});
try{selected=decodeURIComponent(location.hash.slice(1));}catch{selected='';}if(!current())selected=store.cases.find(c=>!c.archived)?.id||store.cases[0]?.id||'';if(current())filter=current().archived?'archived':'active';if(new URLSearchParams(location.search).get('node')==='attribution'){node='attribution';panelOpen=!!current();}render();galaxy.overview();if(panelOpen)galaxy.focus(selected,node);

function sourceLinkHTML(c){if(!c.sourceLink)return '';return `<section class="callout"><strong>已关联：${esc(c.sourceLink.name)}</strong><p class="hint">${esc(c.linkedSymbols?.join(' · ')||'尚未分配标的')} · 来源：现有 Thesis。论点为导入时副本；持仓 Thesis 归属在 Portfolio 风险敞口热力图中手动设置。Risk Budget 保留原有共享编辑器。</p>${(c.sourceLink.warnings||[]).map(w=>`<p class="hint">${esc(w)}</p>`).join('')}<details><summary>已保存的风险参数</summary><p class="hint">${(()=>{try{const p=JSON.parse(c.accountRiskSnapshot).policy,b=p.bundles[c.sourceLink.name]||{};return esc(`单笔风险 ${b.risk_pct??'—'}% · 总风险 ${b.total_risk_pct??'—'}% · ATR ${b.atr_mult??'—'} · 单笔仓位上限 ${b.max_position_pct??'自动'} · 总仓位上限 ${b.total_position_pct??'自动'}`);}catch{return '尚无快照';}})()}</p></details></section>`;}
function closeStar(){if(!panelOpen||!leave())return;panelOpen=false;dirty=false;planEditor=null;render();}
function openStar(caseId,key){const same=panelOpen&&selected===caseId&&node===key;if(same){closeStar();return;}if(!leave())return;if(selected!==caseId)replay=null;selected=caseId;node=key;panelOpen=true;dirty=false;planEditor=null;history.replaceState(null,'',`#${encodeURIComponent(caseId)}`);render();$('#main').scrollTop=0;galaxy.focus(caseId,key);}
$('#galaxy-search').addEventListener('input',renderLibrary);
$('#galaxy-home').onclick=()=>{if(!leave())return;panelOpen=false;dirty=false;planEditor=null;replay=null;render();galaxy.overview();};
$('#galaxy-zoom-in').onclick=()=>galaxy.zoom(.8);
$('#galaxy-zoom-out').onclick=()=>galaxy.zoom(1.25);
document.addEventListener('click',e=>{if(e.target.closest('#close-star-panel'))closeStar();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')){e.preventDefault();closeStar();}});
window.addEventListener('pagehide',e=>{if(!e.persisted)galaxy.destroy();});

$('#legacy-history').onclick=async()=>{const host=$('#workflow-journal');$('#legacy-history-dialog').showModal();host.textContent='读取历史 Thesis…';try{await renderJournal(host);}catch(e){host.textContent='历史记录读取失败：'+e.message;}};
$('#close-legacy-history').onclick=()=>$('#legacy-history-dialog').close();

let syncingWorkflow=false;
async function syncAllWorkflow(){
 if(syncingWorkflow||blocked)return;
 if(dirty){notice('请先保存当前 Node，再同步全部。');return;}
 if(localStorage.getItem(KEY)!==raw){notice('其他窗口已更新 Workflow，请刷新后同步。');return;}
 if(!getPat()){$('#sync-auth-dialog').showModal();return;}
 const button=$('#sync-workflow');syncingWorkflow=true;button.disabled=true;button.textContent='同步中…';let uploaded=false;
 try{const payload=captureWorkflow();await syncWorkflowSnapshot(payload);uploaded=true;await syncLegacyWorkflowData();
 const changed=JSON.stringify(captureWorkflow())!==JSON.stringify(payload);unsyncedNebulae=remainingUnsyncedNebulae(unsyncedNebulae,store,payload);saveUnsyncedNebulae();renderLibrary();button.textContent=changed?'同步全部 · 有新改动':'同步全部 · 已同步';notice(changed?'本次快照已同步；期间产生了新改动，请再次同步。':'全部 Nebula、Node、历史快照及风险/归档数据已同步到私有库。');
 }catch(e){button.textContent='同步全部 · 重试';notice((uploaded?'Workflow 快照已同步，但风险/归档同步未全部完成：':'同步未完成：')+e.message);}finally{syncingWorkflow=false;button.disabled=false;}
}
$('#sync-workflow').onclick=syncAllWorkflow;
$('#cancel-sync-auth').onclick=()=>$('#sync-auth-dialog').close();
$('#sync-auth-form').onsubmit=e=>{e.preventDefault();setPat($('#workflow-pat').value);$('#workflow-pat').value='';$('#sync-auth-dialog').close();syncAllWorkflow();};
document.addEventListener('input',()=>{if(!syncingWorkflow)$('#sync-workflow').textContent='同步全部';});
window.addEventListener('storage',()=>{if(!syncingWorkflow)$('#sync-workflow').textContent='同步全部';});
