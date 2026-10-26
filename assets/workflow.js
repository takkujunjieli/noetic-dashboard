import {dashboardStorage as localStorage,isPublicDashboard} from './dashboard-data.mjs';
import {queuePublicExport,syncPublicSnapshot} from './public-export.js';
import {mountMonitorTrades} from './trade-link-ui.js?v=20261020-account-name';
import {readTradeLinks,reconcileTradeLinks} from './trade-link-client.js?v=20261017-portfolio-assignment';
import {captureWorkflow,syncWorkflowSnapshot,refreshActiveNebulaCatalog,UNSYNCED_KEY,readUnsyncedNebulae,writeUnsyncedNebulae,remainingUnsyncedNebulae} from './workflow-sync.js?v=20261019-compact-active-catalog';
import {createGalaxy} from './galaxy-scene.js?v=20261018-thesis-freshness';
import {getPat,setPat} from './shared.js';
import {expectedCharts,readScenarioUnderwriting,scenarioUnderwritingForm,syncDerivedUnderwriting} from './expected-return.js?v=20261015-underwriting-layout';
import {planTable} from './design-plans.js?v=20261019-actual-cost';
import {loadPortfolioBundleDrafts} from './portfolio-autofill.js?v=20261019-actual-cost';
import {appendBundleLeg,constructionFields,constructionSummary,readConstruction,removeBundleLeg,resetBundleLegs} from './trade-structure.js?v=20261015-reference-iv';
import {kellyAllocationView,kellyPolicyForm,readKellyPolicy} from './kelly-allocation.js?v=20261019-half-kelly';
import {riskBudgetAllocation} from './kelly-allocation.mjs?v=20261019-half-kelly';
import {freshnessSummary,marketPricesFromResearch,thesisFreshness} from './workflow-freshness.mjs?v=20261019-tilt-slider';
import {bundleMetrics,newStructureLeg} from './trade-structure.mjs?v=20261015-reference-iv';
import { mountTransactionHistory } from './attribution-transactions.js?v=20261020-account-name';
import { renderJournal, syncLegacyWorkflowData } from "./portfolio-support.js?v=20261025-qlib";
import {VERSION,KEY,NODES,LAYERS,LABELS,displayState,hypothesisFields,archiveCase,emptyDesign,initializePlans,savePlan,setPlanFrozen,setAllPlansFrozen,selectPlan,setActiveAllocation,confirmAllocationReview,deletePlan,clone,createCase,record,saveNode,transition,gate,demoCase,validateStore} from './workflow-model.mjs?v=20261019-half-kelly';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null||v===undefined||Number.isNaN(v)?'未估计':Number.isFinite(v)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v):'无上界';
const fmt=v=>v===null||v===undefined||Number.isNaN(v)?'缺少数据':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
const date=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('zh-CN',{hour12:false}):'—';
const DRAWER_WIDTH_KEY='research-desk.nebula-drawer-width';
let raw=null,store={version:VERSION,cases:[]},blocked=false,selected='',node='hypothesis',filter='active',replay=null,dirty=false,libraryOpen=false;
function notice(message){$('#notice').textContent=message;}
try{raw=localStorage.getItem(KEY);if(raw){store=validateStore(JSON.parse(raw));const migrated=JSON.stringify(store);if(migrated!==raw){if(localStorage.getItem(KEY)!==raw)throw Error('另一个窗口已更新数据，请刷新后迁移');localStorage.setItem(KEY,migrated);raw=migrated;}}}catch(e){blocked=true;notice('本地存储不可读，已停止写入以保留原始数据。请保留原始存储数据。'+e.message);}
let unsyncedNebulae=readUnsyncedNebulae();
let planEditor=null;
let galaxy=null,panelOpen=false;
let kellySizing={atr:{},atrUpdated:'',prices:{},priceUpdated:''};
async function loadAtrRiskData(){
 try{const [atrResponse,researchResponse]=await Promise.all([fetch(`data/atr.json?t=${Date.now()}`,{cache:'no-store'}),fetch(`data/research.json?t=${Date.now()}`,{cache:'no-store'})]);const atrData=atrResponse.ok?await atrResponse.json():{},researchData=researchResponse.ok?await researchResponse.json():{};kellySizing={atr:atrData.atr14||{},atrUpdated:atrData.updated||'',prices:marketPricesFromResearch(researchData),priceUpdated:researchData.updated_at||''};if(panelOpen&&['returns','risk'].includes(node)&&!dirty)render();else renderLibrary();}catch{}
}
function saveUnsyncedNebulae(){try{writeUnsyncedNebulae(unsyncedNebulae);}catch(e){notice('未同步提示无法持久化：'+e.message);}}
function markNebulaUnsynced(id){if(!id)return;unsyncedNebulae.add(id);saveUnsyncedNebulae();}
function current(){return store.cases.find(c=>c.id===selected);}
function drawerBounds(){const mobile=innerWidth<=800,max=Math.max(260,mobile?innerWidth*.96:innerWidth-320);return {min:Math.min(mobile?260:360,max),max};}
function setDrawerWidth(value,persistWidth=false){const {min,max}=drawerBounds(),width=Math.round(Math.max(min,Math.min(max,+value||min)));document.documentElement.style.setProperty('--nebula-drawer-width',width+'px');const handle=$('.nebula-drawer-resizer');if(handle){handle.setAttribute('aria-valuemin',String(Math.round(min)));handle.setAttribute('aria-valuemax',String(Math.round(max)));handle.setAttribute('aria-valuenow',String(width));}if(persistWidth)try{localStorage.setItem(DRAWER_WIDTH_KEY,String(width));}catch{}return width;}
try{const savedWidth=Number(localStorage.getItem(DRAWER_WIDTH_KEY));if(savedWidth)setDrawerWidth(savedWidth);}catch{}
function visible(){const c=current();if(!replay)return c;const historical=clone(c?.events.find(e=>e.id===replay)?.snapshot);if(historical){for(const n of Object.values(historical.nodes))n.state=displayState(n.state);historical.nodes.hypothesis.data=hypothesisFields(historical.nodes.hypothesis.data);if(!historical.design)initializePlans(historical);}return historical;}
function readOnly(){return isPublicDashboard()||blocked||!!replay||!!current()?.archived;}
function persist(next){
 if(isPublicDashboard())throw Error('公开页面只读');
 if(blocked)throw Error('本地存储不可用，无法保存');
 if(localStorage.getItem(KEY)!==raw)throw Error('另一个窗口已更新数据。请刷新页面以避免覆盖。');
 const json=JSON.stringify(next);localStorage.setItem(KEY,json);raw=json;store=next;const syncButton=$('#sync-workflow');if(syncButton&&!syncButton.disabled)syncButton.textContent='同步全部';
 queuePublicExport(captureWorkflow());
}
function mutate(fn){try{const next=clone(store),c=next.cases.find(x=>x.id===selected);fn(c,next);persist(next);markNebulaUnsynced(c?.id);dirty=false;render();notice('');return true;}catch(e){notice('未保存：'+e.message);return false;}}
function leave(){return !dirty||confirm('节点内容尚未保存。放弃这些编辑并继续？');}
function selectCase(id){if(!leave())return;panelOpen=false;libraryOpen=false;selected=id;replay=null;dirty=false;planEditor=null;node='hypothesis';const c=current();if(c)filter=c.archived?'archived':'active';history.replaceState(null,'',`#${encodeURIComponent(id)}`);$('#galaxy-search').value='';render();galaxy?.focus(id);}
function freshnessFor(c,preview=null){return freshnessSummary(thesisFreshness(c,{atr:kellySizing.atr,prices:kellySizing.prices,preview}));}
function freshnessView(c,preview=null){const value=freshnessFor(c,preview);if(value.status==='none')return '';const messages=value.issues.map(x=>`<li>${esc(x.message)}</li>`).join('');return `<section class="freshness-card is-${value.status}" aria-label="Thesis freshness"><div><strong>${value.label}</strong><span> · Thesis 参数复核</span></div>${messages?`<ul>${messages}</ul>`:'<p>当前未发现参数过期或显著 drift。</p>'}<p class="hint">最近人工复核：${date(value.reviewedAt)}。确认仅更新复核时间；参数变更、情景到期和价格偏移仍需重新评估。</p>${readOnly()?'':`<button type="button" id="confirm-thesis-review">确认已复核</button>`}</section>`;}
function renderLibrary(){const cases=store.cases.filter(c=>c.archived===(filter==='archived'));$('#count').textContent=cases.length+' NEBULAE';document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===filter));
 const query=$('#galaxy-search').value.trim().toLowerCase();$('#cases').hidden=!query;$('#cases').innerHTML=cases.filter(c=>(c.title+' '+c.symbol+' '+(c.linkedSymbols||[]).join(' ')).toLowerCase().includes(query)).map(c=>`<button class="case ${unsyncedNebulae.has(c.id)?'is-unsynced':''} ${c.activeThesis?'is-active-thesis':''}" data-case="${esc(c.id)}"><strong>${unsyncedNebulae.has(c.id)?'<i class="sync-dot" aria-hidden="true"></i>':''}${esc(c.title)}</strong><small>${esc(c.symbol||c.linkedSymbols?.join(' · ')||'Nebula')} · ${c.demo?'DEMO':c.archived?'Archive':c.activeThesis?'Active Thesis':'Existing'}</small></button>`).join('')||'<p class="hint">没有匹配的 Nebula</p>';
 const list=$('#nebula-list'),resizeHandle=$('#nebula-drawer-resizer');document.body.classList.toggle('nebula-list-open',libraryOpen);list.hidden=!libraryOpen;resizeHandle.hidden=!libraryOpen;list.innerHTML=libraryOpen?`<div class="nebula-list-head"><span>Nebula</span><span>创建时间</span><span>最后修改时间</span><span aria-label="设置"></span></div>${cases.map(c=>`<div class="nebula-list-row ${unsyncedNebulae.has(c.id)?'is-unsynced':''} ${c.activeThesis?'is-active-thesis':''}" data-nebula-row="${esc(c.id)}"><button class="nebula-list-name" data-case="${esc(c.id)}">${unsyncedNebulae.has(c.id)?'<i class="sync-dot" aria-hidden="true"></i>':''}${esc(c.title)}</button><time class="nebula-list-time nebula-created">${date(c.createdAt)}</time><time class="nebula-list-time">${date(c.updatedAt)}</time><button class="nebula-more" data-nebula-menu="nebula-menu-${esc(c.id)}" aria-label="${esc(c.title)} 设置" aria-expanded="false">⋯</button><div class="nebula-menu" id="nebula-menu-${esc(c.id)}" popover>${c.archived?'':`<button data-toggle-active-thesis="${esc(c.id)}">${c.activeThesis?'离线':'激活'}</button>`}<button data-archive-nebula="${esc(c.id)}" ${c.archived?'disabled':''}>存档</button><button class="danger" data-delete-nebula="${esc(c.id)}">删除</button></div></div>`).join('')||'<p class="nebula-list-empty">当前没有 Nebula。</p>'}`:'';if(libraryOpen)setDrawerWidth(list.getBoundingClientRect().width);
 $('#galaxy-empty').hidden=!!cases.length;
 const shown=cases.map(x=>{const value=(replay&&x.id===selected)?visible():x;return {...value,unsynced:unsyncedNebulae.has(x.id),freshness:freshnessFor(value)};});galaxy?.update(shown,panelOpen?{caseId:selected,key:node}:null);
 $('#galaxy-location').textContent=panelOpen&&current()?`${current().title} / ${NODES[node].name}`:'GALAXY / OVERVIEW';
}
const F={
 hypothesis:[['expectation','市场结果预期假设 · 我认为市场最终会发生什么？','textarea'],['rationale','论点依据 · 为什么市场目前可能定价错误？','textarea'],['verification','验证条件 · 什么新证据会提高该假设的可信度？','textarea'],['invalidation','证伪条件 · 什么新证据会证明原始逻辑已经不成立？','textarea']],
 returns:[],
 construction:[],
 risk:[],
 positions:[],
 attribution:[]
};
const FIELD_PLACEHOLDERS={
 expectation:'示例：未来四到六周，市场将上调该公司的下一财年收入预期，股票相对半导体指数取得 8%–12% 的超额收益。',
 rationale:'示例：云服务商资本开支高于市场预期；渠道数据表明新产品订单加速；分析师盈利预测尚未充分上调；当前机构仓位低于过去两年的平均水平。',
 verification:'示例：接下来两周至少出现两项：卖方上调收入预测；公司主要客户提高资本开支；股票在成交量放大的情况下相对半导体指数走强；期权市场的上行偏斜增强。',
 invalidation:'示例：主要客户削减资本开支；渠道订单连续下降；公司下调交付或收入指引；即使行业上涨，该股票仍持续显著跑输。'
};
function field([key,label,type='text',options],data,prefix='f'){
 const name=`${prefix}.${key}`,value=data[key]??'',placeholder=FIELD_PLACEHOLDERS[key]||'';
 return `<label>${esc(label)}${type==='textarea'?`<textarea name="${name}" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`:type==='select'?`<select name="${name}">${options.map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`:`<input name="${name}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(value)}" ${placeholder?`placeholder="${esc(placeholder)}"`:''}>`}</label>`;
}
function metrics(items){return `<div class="metrics">${items.map(([label,value])=>`<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join('')}</div>`;}
function positionsInspector(c){const ro=readOnly(),n=c.nodes.positions;return `<section class="inspector empty-node" aria-label="Monitor"><div id="wf-monitor-trades"></div><div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':`<div class="toolbar">${NODES.positions.states[n.state].map(to=>`<button data-transition="${to}">${LABELS[to]}</button>`).join('')}</div>`}</div></section>`;}
function editorCase(c){const copy={...c,events:[],nodes:{...c.nodes,construction:{...c.nodes.construction}}};if(planEditor?.id){const p=c.design?.plans.find(p=>p.id===planEditor.id);if(p)copy.nodes.construction.data=clone(p.construction);}else{copy.nodes.construction.data=emptyDesign(c.horizon).construction;copy.nodes.construction.data.legs=[newStructureLeg()];copy.symbol='';}return copy;}
function constructionInspector(c){const ro=readOnly(),p=c.design?.plans.find(p=>p.id===planEditor?.id),edit=editorCase(c);return `<section class="inspector">${planTable(c,ro,planEditor?.id||'')}${planEditor?`<section class="plan-editor">${p?'':'<h3>添加 Underlying Greek Bundle</h3>'}<form id="node-form"><fieldset ${ro?'disabled':''}>${constructionFields(edit)}<div id="editor-preview">${constructionSummary(edit)}</div>${ro?'':'<button type="submit" class="primary">保存并计算 Bundle</button>'}<span id="dirty-label" class="hint"></span></fieldset></form></section>`:''}<div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':NODES.construction.states[c.nodes.construction.state].map(to=>`<button data-transition="${to}">${LABELS[to]}</button>`).join('')}</div></section>`;}
function returnHistoryCases(c){if(!replay)return store.cases;return store.cases.map(x=>{const events=x.events.filter(e=>e.at<=c.updatedAt&&(x.id!==c.id||e.revision<=c.revision)),last=events.at(-1);return last?{...clone(last.snapshot),events}:null;}).filter(Boolean);}
function returnsInspector(c){const ro=readOnly(),hasPlan=!!c.design?.plans.length;return `<section class="inspector expected-return-inspector" aria-label="Scenario Underwriting"><div id="freshness-summary">${freshnessView(c)}</div><form id="node-form"><fieldset ${ro||!hasPlan?'disabled':''}>${scenarioUnderwritingForm(c,kellySizing)}<button class="primary" type="submit">保存并计算情景收益</button><span id="dirty-label" class="hint"></span></fieldset></form><div id="live-summary">${expectedCharts(c)}</div><div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':NODES.returns.states[c.nodes.returns.state].map(to=>`<button data-transition="${to}">${LABELS[to]}</button>`).join('')}</div></section>`;}
function inspector(c){if(node==='risk')return riskInspector(c);if(node==='returns')return returnsInspector(c);if(node==='construction')return constructionInspector(c);if(node==='positions')return positionsInspector(c);if(node==='attribution')return `<section class="inspector" aria-label="Attribution"><div id="wf-transaction-history"></div></section>`;const n=c.nodes[node],ro=readOnly();
 return `<section class="inspector" aria-label="${esc(NODES[node].name)}"><div id="live-summary"></div><form id="node-form"><fieldset ${ro?'disabled':''}>${F[node].map(f=>field(f,n.data)).join('')}<label>本次修改说明<input name="reason" placeholder="记录为什么修改，写入事件日志"></label><button class="primary" type="submit">保存节点</button><span id="dirty-label" class="hint"></span></fieldset></form><div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':`<div class="toolbar">${NODES[node].states[n.state].map(to=>`<button data-transition="${to}" ${gate(c,node,to)?'disabled':''}>${LABELS[to]}</button>`).join('')||'<span class="hint">此节点生命周期已结束。</span>'}</div><div class="gate">${[...new Set(NODES[node].states[n.state].map(to=>gate(c,node,to)).filter(Boolean))].map(esc).join('<br>')}</div>`}</div></section>`;
}
function timeline(c,limit=20){return `<section class="timeline"><div class="section-heading"><h2>Activity & Snapshots</h2><span class="badge">${c.events.length} 条记录</span></div><ol>${c.events.slice(-limit).reverse().map(e=>`<li class="event"><time>${date(e.at)}</time><div><strong>v${e.revision} · ${esc(NODES[e.node]?.name||'Legacy Signal')} · ${esc(e.type.replaceAll('In Action Policy','In Action'))}</strong><p>${esc(e.reason.replaceAll('In Action Policy','In Action'))}</p></div><button data-replay="${esc(e.id)}">查看快照</button></li>`).join('')}</ol>${c.events.length>limit?`<button type="button" data-more-history="${limit+20}">加载更早记录</button>`:''}</section>`;}
function render(){renderLibrary();const c=visible(),live=current();$('#main').hidden=!c||!panelOpen;document.body.classList.toggle('panel-open',!!c&&panelOpen);if(!c||!panelOpen){$('#main').innerHTML='';return;}
 $('#main').innerHTML=`<button id="close-star-panel" class="panel-close" aria-label="关闭节点面板">✕</button>${replay?`<div class="replay"><span>历史快照 · v${c.revision} · ${date(c.updatedAt)}<br>节点、参数与状态均为当时记录；只读。</span><button id="exit-replay">返回当前版本</button></div>`:''}<div class="instance-header"><div><p class="eyebrow">${esc(c.symbol)} ${c.demo?' / SIMULATED':''}</p><h2 id="nebula-title" ${node==='hypothesis'&&!readOnly()?'data-rename-nebula title="双击重命名 Nebula"':''}>${esc(c.title)}</h2><div class="instance-meta"><span>v${c.revision}</span><span>${LABELS[c.nodes[node].state]}</span></div></div>${node==='attribution'&&!readOnly()?'<div class="toolbar"><button id="archive-case">归档实例</button></div>':''}</div>${inspector(c)}<details class="nebula-context"><summary>Nebula · 来源与历史记录 · ${live.events.length} 条</summary><div class="nebula-history-content"></div></details>`;
 const monitorHost=$('#wf-monitor-trades');
 if(monitorHost)mountMonitorTrades(monitorHost,c,{readonly:readOnly(),replay:!!replay,onRefresh:refreshExecutionLinks});
 const transactionHost=$('#wf-transaction-history');
 if(transactionHost){
  mountTransactionHistory(transactionHost,{c,readonly:readOnly(),onSave:transactionFilePath=>{if(!transactionHost.isConnected||readOnly())return false;const data=readDraft();delete data.transactionFile;data.transactionFilePath=transactionFilePath;return mutate(c=>saveNode(c,'attribution',data,'更新 In Action 交易历史文件引用'));}});
 }
}
function readDraft(){const form=$('#node-form');if(node==='construction'&&form)return readConstruction(form,editorCase(visible()));if(node==='returns'&&form)return readScenarioUnderwriting(form,visible());if(node==='risk'&&form)return readKellyPolicy(form,visible().nodes.risk.data);const d=clone(visible().nodes[node].data);if(!form)return d;for(const [key,,type]of F[node]){const el=form.elements.namedItem(`f.${key}`);if(!el)continue;d[key]=type==='number'&&el.value!==''?Number(el.value):el.value;}
 if(node==='construction'){d.legs=[...form.querySelectorAll('.leg')].map(el=>{const l={};el.querySelectorAll('[name]').forEach(input=>{const k=input.name.split('.')[1];l[k]=input.type==='number'&&input.value!==''?+input.value:input.value;});return l;});}
 return d;
}
function syncCandidateRules(form){const instrument=form?.elements.namedItem('candidate.instrument')?.value,stockOnly=['stock','shortStock'].includes(instrument),hasLongOption=['call','put','bullPut','bearPut','bullCall','bearCall','straddle','strangle'].includes(instrument),hasShortOption=['bullPut','bearPut','bullCall','bearCall','coveredCall'].includes(instrument),details=form?.querySelector('.candidate-rules');if(!details)return;details.hidden=stockOnly;const long=details.querySelector('[data-candidate-rule="long"]'),short=details.querySelector('[data-candidate-rule="short"]');long.hidden=!hasLongOption;short.hidden=!hasShortOption;if(!hasLongOption)long.querySelector('input').value='';if(!hasShortOption)short.querySelector('input').value='';if(stockOnly)for(const input of details.querySelectorAll('input'))input.value='';}
function updatePreview(){
 // Input handlers only mark drafts. All valuation and risk work uses saved inputs.
 dirty=true;const label=$('#dirty-label');if(label)label.textContent=' · 未保存，点击保存并计算以更新结果';
 document.querySelectorAll('[data-transition]').forEach(b=>b.disabled=true);
 const activate=$('#activate-allocation');if(activate)activate.disabled=true;const review=$('#confirm-thesis-review');if(review)review.disabled=true;
}

function openNew(){if(!leave())return;$('#new-form').reset();$('#new-dialog').showModal();}
function addDemo(){if(!leave())return;const c=demoCase();try{const next=clone(store);next.cases.push(c);persist(next);markNebulaUnsynced(c.id);dirty=false;selectCase(c.id);notice('已创建模拟案例。所有价格、Greeks 与预算均为示例。');}catch(e){notice(e.message);}}
$('#new').addEventListener('click',openNew);$('#cancel-new').addEventListener('click',()=>$('#new-dialog').close());
$('#new-form').addEventListener('submit',e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target)),c=createCase(data);if(!c.title)return;try{const next=clone(store);next.cases.push(c);persist(next);markNebulaUnsynced(c.id);dirty=false;$('#new-dialog').close();selectCase(c.id);}catch(err){notice(err.message);}});
document.addEventListener('dblclick',e=>{
 const title=e.target.closest('[data-rename-nebula]');if(!title||node!=='hypothesis'||readOnly())return;
 const input=document.createElement('input');input.id='nebula-title-input';input.maxLength=140;input.value=current().title;title.replaceWith(input);input.focus();input.select();let settled=false;
 const finish=save=>{if(settled)return;settled=true;const nextTitle=input.value.trim(),previous=current()?.title||'';if(!save||nextTitle===previous){render();return;}if(!nextTitle){notice('Nebula 名称不能为空。');render();return;}mutate(c=>{c.title=nextTitle;record(c,'重命名 Nebula','hypothesis',`「${previous}」→「${nextTitle}」`);});};
 input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();finish(true);}else if(event.key==='Escape'){event.preventDefault();finish(false);}});
 input.addEventListener('blur',()=>finish(true),{once:true});
});
document.addEventListener('input',e=>{if(e.target.name==='kelly.kellyTiltPct'){const output=e.target.closest('label').querySelector('[data-kelly-tilt-value]');if(output)output.textContent=e.target.value+'%';}if(e.target.name==='candidate.instrument')resetBundleLegs(e.target.form);if(e.target.closest('#node-form')&&e.target.name!=='reason'){if(node==='returns')syncDerivedUnderwriting(e.target.form,visible());updatePreview();}});
document.addEventListener('submit',e=>{if(e.target.id!=='node-form')return;e.preventDefault();if(readOnly())return;if(node==='risk'){const data=readDraft();if(!dirty){render();return;}mutate(c=>saveNode(c,'risk',data,'保存并计算风险配置'));return;}if(node==='construction'){if(readOnly())return;const data=readDraft(),id=planEditor?.id,previous=planEditor;planEditor=null;if(!mutate(c=>savePlan(c,id,'',data)))planEditor=previous;return;}if(node==='returns'&&!dirty){render();return;}const data=readDraft(),reason=e.target.elements.namedItem('reason')?.value.trim()||'更新节点内容';mutate(c=>{if(!saveNode(c,node,data,reason))throw Error('没有内容变更');});});
document.addEventListener('toggle',e=>{const details=e.target;if(!details.matches?.('.nebula-context')||!details.open)return;const host=details.querySelector('.nebula-history-content');if(host&&!host.hasChildNodes())host.innerHTML=sourceLinkHTML(visible())+timeline(current());},true);
document.addEventListener('click',async e=>{let b=e.target.closest('button');
 if(!b&&!e.target.closest('[popover]')){const row=e.target.closest('[data-plan-row]');if(row)b=row.querySelector('[data-edit-plan]');}
 if(!b)return;
 if(b.dataset.moreHistory){const host=b.closest('.nebula-history-content');if(host)host.innerHTML=sourceLinkHTML(visible())+timeline(current(),Number(b.dataset.moreHistory));return;}
 if(b.dataset.planMenu){const menu=document.getElementById(b.dataset.planMenu);if(menu.matches(':popover-open')){menu.hidePopover();return;}const box=b.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(box.right-190,innerWidth-198))+'px';menu.style.top=Math.max(8,Math.min(box.bottom+6,innerHeight-110))+'px';menu.showPopover();b.setAttribute('aria-expanded','true');menu.addEventListener('toggle',()=>b.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));return;}
 if(b.dataset.nebulaMenu){const menu=document.getElementById(b.dataset.nebulaMenu);if(menu.matches(':popover-open')){menu.hidePopover();return;}const box=b.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(box.right-150,innerWidth-158))+'px';menu.style.top=Math.max(8,Math.min(box.bottom+5,innerHeight-132))+'px';menu.showPopover();b.setAttribute('aria-expanded','true');menu.addEventListener('toggle',()=>b.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));return;}
 if(b.closest('[popover]')?.matches(':popover-open'))b.closest('[popover]').hidePopover();
 if(b.hasAttribute('data-new'))return openNew();if(b.hasAttribute('data-demo'))return addDemo();
 if(b.id==='add-bundle-leg'){appendBundleLeg(b.form);updatePreview();return;}
 if(b.dataset.removeBundleLeg!==undefined){removeBundleLeg(b.form,Number(b.dataset.removeBundleLeg));updatePreview();return;}
 if(b.dataset.case)return selectCase(b.dataset.case);
 if(b.dataset.filter){if(!leave())return;panelOpen=false;const same=filter===b.dataset.filter;filter=b.dataset.filter;libraryOpen=!(libraryOpen&&same);planEditor=null;selected=store.cases.find(c=>c.archived===(filter==='archived'))?.id||'';replay=null;dirty=false;render();galaxy?.overview();return;}
 if(b.dataset.toggleActiveThesis){const id=b.dataset.toggleActiveThesis,c=store.cases.find(c=>c.id===id);if(!c||c.archived)return;selected=id;panelOpen=false;mutate(item=>{item.activeThesis=!item.activeThesis;record(item,item.activeThesis?'激活 Thesis':'Thesis 离线','hypothesis',item.activeThesis?'标记为 Active Thesis':'移出 Active Thesis');});libraryOpen=true;galaxy?.overview();return;}
 if(b.dataset.archiveNebula){const id=b.dataset.archiveNebula,c=store.cases.find(c=>c.id===id);if(!c||c.archived||!confirm(`存档 Nebula「${c.title}」？存档后将变为只读。`))return;selected=id;panelOpen=false;if(mutate(c=>archiveCase(c))){filter='active';libraryOpen=true;selected=store.cases.find(c=>!c.archived)?.id||'';render();galaxy?.overview();}return;}
 if(b.dataset.deleteNebula){const id=b.dataset.deleteNebula,c=store.cases.find(c=>c.id===id);if(!c||!confirm(`永久删除 Nebula「${c.title}」及其全部快照？此操作无法撤销。`))return;try{const next=clone(store);next.cases=next.cases.filter(c=>c.id!==id);persist(next);unsyncedNebulae.delete(id);saveUnsyncedNebulae();if(selected===id)selected=next.cases.find(c=>c.archived===(filter==='archived'))?.id||'';panelOpen=false;replay=null;dirty=false;render();galaxy?.overview();notice('');}catch(err){notice('删除失败：'+err.message);}return;}
 if(b.dataset.node&&!b.dataset.star){openStar(selected,b.dataset.node);return;}
 if(b.dataset.replay){if(!leave())return;replay=b.dataset.replay;dirty=false;planEditor=null;render();return;}
 if(b.id==='exit-replay'){replay=null;planEditor=null;render();return;}
 if(b.id==='archive-case'){if(dirty){notice('请先保存节点内容');return;}if(mutate(c=>archiveCase(c))){filter='archived';render();}return;}
 if(b.id==='autofill-bundles'){
  if(readOnly()||!leave())return;b.disabled=true;b.textContent='读取中…';
  try{
   const result=await loadPortfolioBundleDrafts(current()),byUnderlying=new Map(result.bundles.map(x=>[x.underlying,x]));
   if(!result.matchedPositions){notice(`没有找到归属于「${result.names.join(' / ')||current().title}」的本地 Portfolio 持仓。可以先在 Portfolio 热力图为未归属标的选择此 Thesis，再回来点击自动填写。`);return;}
   let created=0,updated=0,frozen=0;planEditor=null;
   if(mutate(c=>{
    // Construction edits preserve the frozen budget. Freshness marks the old
    // In Action snapshot stale until the user explicitly activates a new one.
    c.portfolioUnderlyings=[...new Set([...(c.portfolioUnderlyings||[]),...result.bundles.map(item=>item.underlying)])].sort();
    const covered=new Set();
    for(const p of c.design.plans){const underlying=bundleMetrics(p.construction).underlying,item=byUnderlying.get(underlying);if(!item)continue;covered.add(underlying);if(p.frozen){frozen++;continue;}savePlan(c,p.id,'',item.construction);updated++;}
    for(const item of result.bundles)if(!covered.has(item.underlying)){savePlan(c,null,'',item.construction);created++;}
   })){
    const unsupported=result.unsupported.length;
    notice(`自动填写完成：新建 ${created} 个，刷新 ${updated} 个${frozen?`，跳过 ${frozen} 个 Frozen Bundle`:''}${unsupported?`；${unsupported} 个无法识别的持仓未导入`:''}。`);
   }
  }catch(err){notice('自动填写失败：'+err.message);}
  finally{if(b.isConnected){b.disabled=false;b.textContent='自动填写';}}
  return;
 }
 if(b.id==='add-plan'){if(readOnly()||!leave())return;planEditor=planEditor?.id===null?null:{id:null};dirty=false;render();return;}
 if(b.dataset.toggleAllPlansFrozen){if(readOnly()||!leave())return;mutate(c=>setAllPlansFrozen(c,b.dataset.toggleAllPlansFrozen==='true'));return;}
 if(b.dataset.togglePlanFrozen){if(readOnly()||!leave())return;const p=current().design.plans.find(p=>p.id===b.dataset.togglePlanFrozen);if(p)mutate(c=>setPlanFrozen(c,p.id,!p.frozen));return;}
 if(b.dataset.editPlan){if(!leave())return;const id=b.dataset.editPlan;
  if(planEditor?.id===id){planEditor=null;dirty=false;render();return;}
  if(readOnly()){planEditor={id};dirty=false;render();return;}
  planEditor={id};if(!mutate(c=>selectPlan(c,id)))planEditor=null;return;
 }
 if(b.id==='activate-allocation'){if(dirty){notice('请先保存并计算风险配置。');return;}if(readOnly()){notice('当前版本只读。');return;}const policy=current().nodes.risk.data,result=riskBudgetAllocation(current(),policy,kellySizing.atr);mutate(c=>{c.nodes.risk.data=clone(policy);setActiveAllocation(c,result);});return;}
 if(b.id==='confirm-thesis-review'){if(readOnly())return;if(dirty){notice('请先保存当前修改，再确认复核。');return;}if(mutate(c=>confirmAllocationReview(c))){const remaining=freshnessFor(current()).issues;notice(remaining.length?'已记录人工复核时间。以下提醒仍需处理：'+remaining.map(x=>x.message).join('；'):'已记录人工复核时间，当前状态为 Fresh。');}return;}
 if(b.dataset.deletePlan){if(readOnly()||!leave())return;const id=b.dataset.deletePlan,p=current().design.plans.find(p=>p.id===id);if(!confirm(`删除 Underlying Greek Bundle「${p.name}」及其单位收益假设？历史快照仍保留。`))return;planEditor=null;mutate(c=>deletePlan(c,id));return;}
 if(b.dataset.transition){if(dirty){notice('请先保存节点内容');return;}const to=b.dataset.transition;
 if(mutate(c=>transition(c,node,to))&&current().archived){filter='archived';render();}return;}
});
document.addEventListener('change',e=>{if(e.target.matches('[data-leg-toggle]')){e.target.closest('.payoff-card').classList.toggle('show-legs',e.target.checked);return;}if(e.target.name?.startsWith('kelly.'))return;if(e.target.id!=='design-plan-selector')return;const id=e.target.value;if(!leave()){e.target.value=visible().design.selectedId;return;}if(readOnly()){const c=visible(),p=c.design?.plans.find(p=>p.id===id);if(p){notice('历史快照按当时查看的方案回放；其他方案可在 Portfolio Construction 查看交易腿。');e.target.value=c.design.selectedId;}return;}mutate(c=>selectPlan(c,id));});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{
 if(e.key===KEY){
  const latest=localStorage.getItem(KEY);
  const riskDraft=panelOpen&&node==='risk'&&current()&&JSON.stringify(readDraft())!==JSON.stringify(current().nodes.risk.data);
  if(!dirty&&!riskDraft&&!blocked&&!syncingWorkflow&&!replay&&latest){
   try{
    const next=validateStore(JSON.parse(latest));store=next;raw=latest;planEditor=null;
    if(!current()){selected=store.cases.find(c=>!c.archived)?.id||'';panelOpen=false;}
    unsyncedNebulae=readUnsyncedNebulae();render();notice('');
   }catch{notice('其他页面的 Workflow 数据不可读，请刷新页面后检查。');}
  }else notice('另一个窗口修改了 Workflow 数据，请先保留当前编辑，再刷新页面。当前窗口不会覆盖新数据。');
 }
 if(e.key===UNSYNCED_KEY){unsyncedNebulae=readUnsyncedNebulae();renderLibrary();}
});

function riskInspector(c){const ro=readOnly(),hasPositions=!!c.design?.plans.length,result=riskBudgetAllocation(c,c.nodes.risk.data,kellySizing.atr);return `<section class="inspector kelly-allocation-inspector"><div id="freshness-summary">${freshnessView(c,result)}</div><form id="node-form"><fieldset ${ro||!hasPositions?'disabled':''}>${kellyPolicyForm(c.nodes.risk.data)}<button class="primary" type="submit">保存并计算风险配置</button><span id="dirty-label" class="hint"></span></fieldset></form><div id="live-summary">${kellyAllocationView(c,c.nodes.risk.data,kellySizing,result)}</div>${ro?'':`<button id="activate-allocation" ${hasPositions?'':'disabled'}>设为 In Action Risk Budget</button>`}<div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':NODES.risk.states[c.nodes.risk.state].map(to=>`<button data-transition="${to}">${LABELS[to]}</button>`).join('')}</div></section>`;}
galaxy=createGalaxy($('#galaxy-scene'),{onStar:openStar,onNebula:selectCase,onBackground:closeStar});
loadAtrRiskData();
try{selected=decodeURIComponent(location.hash.slice(1));}catch{selected='';}if(!current())selected=store.cases.find(c=>!c.archived)?.id||store.cases[0]?.id||'';if(current())filter=current().archived?'archived':'active';if(['attribution','positions'].includes(new URLSearchParams(location.search).get('node'))){node=new URLSearchParams(location.search).get('node');panelOpen=!!current();}render();galaxy.overview();if(panelOpen)galaxy.focus(selected,node);

function sourceLinkHTML(c){if(!c.sourceLink)return '';return `<section class="callout"><strong>已关联：${esc(c.sourceLink.name)}</strong><p class="hint">${esc(c.linkedSymbols?.join(' · ')||'尚未分配标的')} · 来源：现有 Thesis。论点为导入时副本；持仓 Thesis 归属在 Portfolio 风险敞口热力图中手动设置。Portfolio Construction 现在使用 Underlying Greek Bundles；旧风险参数只保留为历史参考。</p>${(c.sourceLink.warnings||[]).map(w=>`<p class="hint">${esc(w)}</p>`).join('')}<details><summary>已保存的旧风险参数</summary><p class="hint">${(()=>{try{const p=JSON.parse(c.accountRiskSnapshot).policy,b=p.bundles[c.sourceLink.name]||{};return esc(`单笔风险 ${b.risk_pct??'—'}% · 总风险 ${b.total_risk_pct??'—'}% · ATR ${b.atr_mult??'—'} · 单笔仓位上限 ${b.max_position_pct??'自动'} · 总仓位上限 ${b.total_position_pct??'自动'}`);}catch{return '尚无快照';}})()}</p></details></section>`;}
function closeStar(){if(!panelOpen||!leave())return;panelOpen=false;dirty=false;planEditor=null;render();}
function openStar(caseId,key){const same=panelOpen&&selected===caseId&&node===key;if(same){closeStar();return;}if(!leave())return;if(selected!==caseId)replay=null;selected=caseId;node=key;panelOpen=true;libraryOpen=false;dirty=false;planEditor=null;history.replaceState(null,'',`#${encodeURIComponent(caseId)}`);render();$('#main').scrollTop=0;galaxy.focus(caseId,key);}
$('#galaxy-search').addEventListener('input',renderLibrary);
$('#galaxy-home').onclick=()=>{if(!leave())return;panelOpen=false;libraryOpen=false;dirty=false;planEditor=null;replay=null;render();galaxy.overview();};
$('#galaxy-zoom-in').onclick=()=>galaxy.zoom(.8);
$('#galaxy-zoom-out').onclick=()=>galaxy.zoom(1.25);
document.addEventListener('click',e=>{if(e.target.closest('#close-star-panel'))closeStar();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')){e.preventDefault();closeStar();}});
document.addEventListener('pointerdown',e=>{const handle=e.target.closest('.nebula-drawer-resizer');if(!handle)return;e.preventDefault();handle.classList.add('is-resizing');handle.setPointerCapture(e.pointerId);const move=event=>setDrawerWidth(event.clientX);const stop=event=>{handle.classList.remove('is-resizing');if(handle.hasPointerCapture?.(event.pointerId))handle.releasePointerCapture(event.pointerId);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);const width=Number.isFinite(event.clientX)?event.clientX:$('#nebula-list').getBoundingClientRect().width;setDrawerWidth(width,true);};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);});
document.addEventListener('keydown',e=>{const handle=e.target.closest('.nebula-drawer-resizer');if(!handle||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const {min,max}=drawerBounds(),currentWidth=$('#nebula-list').getBoundingClientRect().width,next=e.key==='Home'?min:e.key==='End'?max:currentWidth+(e.key==='ArrowLeft'?-24:24);setDrawerWidth(next,true);});
window.addEventListener('resize',()=>{if(libraryOpen)setDrawerWidth($('#nebula-list').getBoundingClientRect().width);});
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
 try{refreshActiveNebulaCatalog(store);const payload=captureWorkflow();await syncWorkflowSnapshot(payload);uploaded=true;await syncLegacyWorkflowData();await syncPublicSnapshot(payload);
 const changed=JSON.stringify(captureWorkflow())!==JSON.stringify(payload);unsyncedNebulae=remainingUnsyncedNebulae(unsyncedNebulae,store,payload);saveUnsyncedNebulae();renderLibrary();button.textContent=changed?'同步全部 · 有新改动':'同步全部 · 已同步';notice(changed?'本次快照已同步；期间产生了新改动，请再次同步。':'Workflow 私有备份及公开 Workflow / Takku 100k 快照均已同步。');
 }catch(e){button.textContent='同步全部 · 重试';notice((uploaded?'Workflow 已备份，但公开快照或风险/归档同步未全部完成：':'同步未完成：')+e.message);}finally{syncingWorkflow=false;button.disabled=false;}
}
$('#sync-workflow').onclick=syncAllWorkflow;
$('#cancel-sync-auth').onclick=()=>$('#sync-auth-dialog').close();
$('#sync-auth-form').onsubmit=e=>{e.preventDefault();setPat($('#workflow-pat').value);$('#workflow-pat').value='';$('#sync-auth-dialog').close();syncAllWorkflow();};
document.addEventListener('input',()=>{if(!syncingWorkflow)$('#sync-workflow').textContent='同步全部';});
window.addEventListener('storage',()=>{if(!syncingWorkflow)$('#sync-workflow').textContent='同步全部';});

async function refreshExecutionLinks(){
 if(isPublicDashboard())return;
 if(blocked||dirty||replay)return;
 try{
  if(localStorage.getItem(KEY)!==raw)throw Error('其他页面已更新 Workflow，请刷新页面后重新读取');
  const {data}=await readTradeLinks();
  if(localStorage.getItem(KEY)!==raw)throw Error('其他页面已更新 Workflow，请刷新页面后重新读取');
  if(reconcileTradeLinks(data)){raw=localStorage.getItem(KEY);store=validateStore(JSON.parse(raw));unsyncedNebulae=readUnsyncedNebulae();}
  if(panelOpen&&node==='positions')render();
 }catch(error){if(panelOpen&&node==='positions')notice(error.message);}
}
refreshExecutionLinks();
