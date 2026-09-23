import {planTable,planSelector} from './design-plans.js';
import {constructionFields,constructionLegs,constructionSummary,readConstruction} from './trade-structure.js';
import {templateLegs,newStructureLeg,ticker} from './trade-structure.mjs';
import { mountAttributionControl } from './attribution-control.js';
import { mountPositionControl, loadPositionSource } from "./position-control.js";
import { bindingFromSelection, reconcilePositions, closeOrReleaseRule, positionLinkFingerprint, validateBindingsAcrossCases } from "./position-link.mjs";
import { mountWorkflowRiskControl, loadRiskEnvironment } from "./risk-control.js";
import { accountFingerprint } from "./risk-budget.mjs";
import {VERSION,KEY,NODES,LAYERS,LABELS,displayState,hypothesisFields,archiveCase,emptyDesign,initializePlans,savePlan,selectPlan,setActivePlan,deletePlan,planView,clone,createCase,record,saveNode,transition,gate,scenario,exposure,riskCheck,demoCase,validateStore} from './workflow-model.mjs';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null||v===undefined||Number.isNaN(v)?'未估计':Number.isFinite(v)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v):'无上界';
const fmt=v=>v===null||v===undefined||Number.isNaN(v)?'缺少数据':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
const date=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('zh-CN',{hour12:false}):'—';
let raw=null,store={version:VERSION,cases:[]},blocked=false,selected='',node='hypothesis',filter='active',replay=null,dirty=false;
function notice(message){$('#notice').textContent=message;}
try{raw=localStorage.getItem(KEY);if(raw){store=validateStore(JSON.parse(raw));const migrated=JSON.stringify(store);if(migrated!==raw){if(localStorage.getItem(KEY)!==raw)throw Error('另一个窗口已更新数据，请刷新后迁移');localStorage.setItem(KEY,migrated);raw=migrated;}}}catch(e){blocked=true;notice('本地存储不可读，已停止写入以保留原始数据。可先导出备份。'+e.message);}
let riskController=null,positionController=null,planEditor=null;
function current(){return store.cases.find(c=>c.id===selected);}
function visible(){const c=current();if(!replay)return c;const historical=clone(c?.events.find(e=>e.id===replay)?.snapshot);if(historical){for(const n of Object.values(historical.nodes))n.state=displayState(n.state);historical.nodes.hypothesis.data=hypothesisFields(historical.nodes.hypothesis.data);if(!historical.design)initializePlans(historical);}return historical;}
function readOnly(){return blocked||!!replay||!!current()?.archived;}
function persist(next){
 if(blocked)throw Error('本地存储不可用，无法保存');
 if(localStorage.getItem(KEY)!==raw)throw Error('另一个窗口已更新数据。请先导出当前内容，再刷新页面以避免覆盖。');
 const json=JSON.stringify(next);localStorage.setItem(KEY,json);raw=json;store=next;
}
function mutate(fn){try{const next=clone(store),c=next.cases.find(x=>x.id===selected);fn(c,next);persist(next);dirty=false;render();notice('已保存到此浏览器。');return true;}catch(e){notice('未保存：'+e.message);return false;}}
function leave(){return !dirty||confirm('节点内容尚未保存。放弃这些编辑并继续？');}
function selectCase(id){if(!leave())return;selected=id;replay=null;dirty=false;planEditor=null;node='hypothesis';const c=current();if(c)filter=c.archived?'archived':'active';history.replaceState(null,'',`#${encodeURIComponent(id)}`);render();}
function renderLibrary(){const cases=store.cases.filter(c=>c.archived===(filter==='archived'));$('#count').textContent=cases.length;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===filter));
 $('#cases').innerHTML=cases.length?cases.slice().reverse().map(c=>`<button class="case ${selected===c.id?'selected':''}" data-case="${esc(c.id)}"><span class="case-meta"><span>${esc(c.symbol)}</span><span class="badge">${c.demo?'模拟':c.archived?'归档':'活跃'}</span></span><strong>${esc(c.title)}</strong><small>${esc(c.horizon)} · v${c.revision}</small><br><small>${esc(LABELS[c.nodes.positions.state])} · ${esc(LABELS[c.nodes.risk.state])}</small></button>`).join(''):'<p class="hint">这里还没有实例。</p>';
}
function graph(c){return `<section class="graph" aria-label="四层工作流图"><div class="graph-heading"><span>WORKFLOW MAP</span><span>7 nodes · 4 layers</span></div>${LAYERS.map((layer,i)=>`<div class="layer"><div class="layer-label"><span class="layer-number">0${i+1}</span><div><strong>${layer.name}</strong><small>${layer.cn}</small></div></div><div class="nodes">${layer.nodes.map((k,j)=>`${j?`<span class="peer-edge" aria-hidden="true">${i===0?'→':'↔'}</span>`:''}<button class="node ${c.nodes[k].state==='running'?'done':''} " data-node="${k}" aria-pressed="${node===k}"><span class="node-name">${NODES[k].name}</span><span class="node-state">● ${LABELS[c.nodes[k].state]}</span></button>`).join('')}</div>${i===1?'<div class="edge">↔ 三节点联动：收益 × 结构 × 风险</div>':''}</div>${i<3?`<div class="edge"><b>↓</b>${['研究假设与信号 → 构建表达方式','保存方案 · 关联实际持仓','生命周期结束 · 完成对账'][i]}</div>`:''}`).join('')}<div class="graph-foot">研究 → 设计 → 持仓 → 归因 · 方案变更保留快照<br>未建仓实例也可记录归因。pending / running 仅表示工作进度。</div></section>`;}
const F={
 hypothesis:[['expectation','市场结果预期假设','textarea'],['rationale','论点依据','textarea'],['verification','验证条件','textarea'],['invalidation','证伪条件','textarea']],
 signal:[['indicator','信号名称'],['condition','触发规则','textarea'],['expires','信号有效至','date'],['evidence','触发证据与观察时间','textarea']],
 returns:[['spot','参考股价 ($)','number'],['cost','整个组合总交易成本 ($)','number'],['down','下行情景涨跌幅 (%)','number'],['base','基准情景涨跌幅 (%)','number'],['up','上行情景涨跌幅 (%)','number'],['pDown','下行情景概率 (%) · 可选','number'],['pBase','基准情景概率 (%) · 可选','number'],['pUp','上行情景概率 (%) · 可选','number'],['probabilityBasis','概率依据 · 填写概率时必填','textarea'],['notes','情景假设 / 未覆盖的风险','textarea']],
 construction:[],
 risk:[['lossBudget','本实例到期理论损失预算 ($)','number'],['deltaBudget','同标的合计 |Delta| 上限 (股)','number'],['existingDelta','同标的其他持仓 Delta (股)','number'],['context','账户风险检查：集中度 / 购买力 / 相关性','textarea'],['notes','其他约束与应对','textarea']],
 positions:[['asOf','实际持仓观察时间','datetime-local'],['exitRules','退出规则 / 管理触发条件','textarea'],['action','本次管理动作与原因','textarea'],['notes','持仓备注 / 平仓说明','textarea']],
 attribution:[['realized','实际净已实现损益 ($) · 未建仓填 0','number'],['reconciliation','对账记录 / 数据来源','textarea'],['outcome','论点结果与预期差异','textarea'],['drivers','收益来源：方向 / 工具 / 仓位 / 调整 / 成本','textarea'],['lesson','复盘结论 / 待验证问题','textarea']]
};
const INTROS={hypothesis:'记录市场结果预期假设及其依据、验证与证伪条件。四项均可留空，后续逐步完善。',signal:'先定义规则，再记录实际触发证据。当前采用人工确认。',returns:'使用组合腿计算目标日损益；有依据的概率才用于期望收益。',construction:'管理并比较候选方案。保存后同步到 Expected Return 与 Risk Budget；In Action 标记当前采用的方案。',risk:'检查本实例损失与同标的合计 Delta，并记录账户层面的人工核查。',positions:'实际持仓与方案分开管理；记录持有、调整与退出的全过程。',attribution:'对照最初假设和历次方案，保存结果与经验。归档后只读。'};
function field([key,label,type='text',options],data,prefix='f'){
 const name=`${prefix}.${key}`,value=data[key]??'';
 return `<label>${esc(label)}${type==='textarea'?`<textarea name="${name}" rows="3">${esc(value)}</textarea>`:type==='select'?`<select name="${name}">${options.map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`:`<input name="${name}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(value)}">`}</label>`;
}
const legDefaults=()=>({type:'stock',side:'long',qty:1,entry:'',strike:'',expiry:visible()?.horizon||'',delta:'',gamma:'',theta:'',vega:'',mark:''});
function legsHTML(legs,actual){return legs.map((l,i)=>`<div class="leg"><div class="leg-top"><strong>Leg ${i+1}</strong><button type="button" data-remove-leg="${i}" class="quiet">移除</button></div><div class="fields">${[
 ['type','工具','select',[['stock','Stock'],['put','Put'],['call','Call']]],['side','方向','select',[['long','Long'],['short','Short']]],['qty','数量 · 股 / 张','number'],['entry','单位成本 / 权利金 ($)','number'],...(actual?[['mark','当前单位价格 ($)','number']]:[])
 ].map(f=>field(f,l,`leg${i}`)).join('')}<div class="option-fields" ${l.type==='stock'?'hidden':''}>${[['strike','行权价','number'],['expiry','到期日','date']].map(f=>field(f,l,`leg${i}`)).join('')}</div></div><details class="greek-fields" ${l.type==='stock'?'hidden':''}><summary>Greeks · ${l.delta===''||l.delta==null?'未填写 Delta':'Delta '+esc(l.delta)} · 展开编辑</summary><div class="fields">${[['delta','Delta · 多头单位口径','number'],['gamma','Gamma · 每 $1','number'],['theta','Theta · 每天','number'],['vega','Vega · 每 1 vol point','number']].map(f=>field(f,l,`leg${i}`)).join('')}</div></details></div>`).join('');}

function metrics(items){return `<div class="metrics">${items.map(([label,value])=>`<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join('')}</div>`;}
function designSummary(c){const result=scenario(c),ex=exposure(c.nodes.construction.data.legs),r=c.nodes.risk.data;
 return `<section aria-label="组合方案对照"><h3>组合方案对照 · 保存后形成新版本</h3>${metrics([['净 Delta · 股',fmt(ex.delta)],['期望损益',money(result.expected)],['到期理论最大损失',money(result.maxLoss)]])}<p class="hint">Gamma ${fmt(ex.gamma)} · Theta ${fmt(ex.theta)} / 天 · Vega ${fmt(ex.vega)} / vol point</p>${result.error?`<div class="callout">${esc(result.error)}</div>`:`<div class="table-wrap"><table><thead><tr><th>目标日情景</th><th>股价</th><th>涨跌</th><th>组合净损益</th></tr></thead><tbody>${result.rows.map(row=>`<tr><td>${row.name}</td><td>${money(row.price)}</td><td>${row.change}%</td><td class="${row.pnl<0?'negative':'positive'}">${money(row.pnl)}</td></tr>`).join('')}</tbody></table></div><p class="hint">目标日 ${esc(result.expiry)}。${result.expected===null?'未使用概率加权；概率需完整且合计 100%。':'期望值按手工概率加权，非预测保证。'}</p>`}<p class="hint">股票线性损益 + 同到期日期权内在价值，标准合约乘数 100。未模拟到期前 IV / 时间价值、提前行权、指派与到期腿风险。跨到期结构不计算。</p>${node==='risk'?`<div class="callout">${riskCheck(c).length?riskCheck(c).map(esc).join('<br>'):'当前模型内检查满足；账户其他风险按人工核查记录。'}<br>同标的合计 Delta：${ex.delta===null||r.existingDelta===''?'未计算':fmt(ex.delta+(+r.existingDelta))}</div>`:''}</section>`;
}
function positionSummary(c){const legs=c.nodes.positions.data.positions,ex=exposure(legs),pnl=legs.length&&legs.every(l=>l.mark!==''&&l.mark!=null)?legs.reduce((s,l)=>s+(+l.mark-+l.entry)*+l.qty*(l.type==='stock'?1:100)*(l.side==='short'?-1:1),0):null,plannedLegs=c.design?c.design.plans.find(p=>p.id===c.design.activeId)?.construction.legs||[]:c.nodes.construction.data.legs,planned=exposure(plannedLegs);
 return metrics([['实际 Delta · 股',legs.length?fmt(ex.delta):'无持仓'],['与方案 Delta 差异',legs.length&&plannedLegs.length&&ex.delta!==null&&planned.delta!==null&&new Set([...legs,...plannedLegs].map(l=>ticker(l)||c.symbol)).size===1?fmt(ex.delta-planned.delta):'—'],['浮动损益 · 未扣费用',money(pnl)]])+`<p class="hint">${c.nodes.positions.data.asOf?'观察时间：'+esc(c.nodes.positions.data.asOf):'尚未记录持仓观察时间'} · 来源：${c.nodes.positions.data.source==='portfolio'?'Portfolio 本地快照（非实时券商查询）':'人工录入'}${c.nodes.positions.data.sync?.status==='attention'?' · 待核对，保留上次已知持仓':''}</p>`;
}
function editorCase(c){const copy=clone(c);if(planEditor?.id){const p=c.design?.plans.find(p=>p.id===planEditor.id);if(p)copy.nodes.construction.data=clone(p.construction);}else copy.nodes.construction.data=emptyDesign(c.horizon).construction;return copy;}
function constructionInspector(c){const ro=readOnly(),p=c.design?.plans.find(p=>p.id===planEditor?.id),edit=editorCase(c);return `<section class="inspector"><p class="eyebrow">组合构建</p><h2>Portfolio Construction</h2><p class="intro">${INTROS.construction}</p><div class="current-state">当前状态：${LABELS[c.nodes.construction.state]}</div>${planTable(c,ro)}${planEditor?`<section class="plan-editor"><div class="section-heading"><h3>${p?'编辑方案':'添加方案'}</h3><button type="button" id="close-plan-editor">关闭面板</button></div><form id="node-form"><fieldset ${ro||(['returns','risk'].includes(node)&&!c.design?.plans.length)?'disabled':''}><label>方案名称<input name="plan-name" maxlength="100" value="${esc(p?.name||'')}" placeholder="例如：Bull Call Spread"></label>${constructionFields(edit)}<div id="editor-preview">${constructionSummary(edit)}</div>${ro?'':'<button type="submit" class="primary">保存方案</button>'}<span id="dirty-label" class="hint"></span></fieldset></form></section>`:''}<div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':NODES.construction.states[c.nodes.construction.state].map(to=>`<button data-transition="${to}">${LABELS[to]}</button>`).join('')}</div></section>`;}
function inspector(c){if(node==='construction')return constructionInspector(c);const n=c.nodes[node],ro=readOnly(),legKey=node==='construction'?'legs':'positions',hasLegs=node==='positions'&&!c.nodes.positions.data.binding,isDesign=['returns','construction','risk'].includes(node);
 return `<section class="inspector" aria-label="节点工作区"><p class="eyebrow">${NODES[node].cn}</p><h2>${NODES[node].name}</h2><p class="intro">${INTROS[node]}</p><div class="current-state">当前状态：${LABELS[n.state]}</div>${node==='positions'?'<div class="callout">可关联 Portfolio 已同步的实际持仓，或保留手工记录。关联与刷新均不发送交易指令。</div>':''}${['returns','risk'].includes(node)?planSelector(c):''}<div id="live-summary">${node==='construction'?constructionSummary(c):isDesign?designSummary(c):node==='positions'?positionSummary(c):node==='attribution'?attributionSummary(c):''}</div>${node==='risk'?'<div id="wf-risk-control" class="shared-risk-control"></div>':''}${node==='positions'?'<div id="wf-position-control" class="shared-position-control"></div>':''}${node==='attribution'?'<div id="wf-attribution-control"></div>':''}<form id="node-form"><fieldset ${ro||(['returns','risk'].includes(node)&&!c.design?.plans.length)?'disabled':''}>${node==='construction'?constructionFields(c):''}${hasLegs?`<div id="legs">${legsHTML(n.data[legKey],node==='positions')}</div><button type="button" id="add-leg">＋ 添加${node==='positions'?'实际持仓':'组合腿'}</button><p class="hint">全部属于 ${esc(c.symbol)}；期权 Greeks 填多头每单位值，系统按方向与 100 倍乘数汇总。未知请留空。</p>`:''}${F[node].filter(f=>!(node==='positions'&&n.data.binding&&f[0]==='asOf')).map(f=>field(f,n.data)).join('')}${node!=='construction'?'<label>本次修改说明<input name="reason" placeholder="记录为什么修改，写入事件日志"></label>':''}<button class="primary" type="submit">保存节点</button><span id="dirty-label" class="hint"></span></fieldset></form><div class="state-control"><h3>状态流转</h3>${ro?'<p class="hint">历史快照与归档实例只读。</p>':`<div class="toolbar">${NODES[node].states[n.state].map(to=>`<button data-transition="${to}" ${gate(c,node,to)?'disabled':''}>${LABELS[to]}</button>`).join('')||'<span class="hint">此节点生命周期已结束。</span>'}</div><div class="gate">${[...new Set(NODES[node].states[n.state].map(to=>gate(c,node,to)).filter(Boolean))].map(esc).join('<br>')}</div>`}</div></section>`;
}
function attributionSummary(c){
 const events=c.events||current().events.filter(e=>e.revision<=c.revision),baseline=events.find(e=>e.node==='construction'&&((['设置 In Action Policy','设置 In Action'].includes(e.type)&&e.snapshot.design?.activeId)||e.type==='选定设计基准'||e.snapshot.nodes.construction.state==='baseline'))?.snapshot;
 const expected=baseline?(scenario(baseline.design?.activeId?planView(baseline,baseline.design.activeId):baseline).expected??null):null,actual=c.nodes.attribution.data.realized;
 return metrics([['首次基准期望损益',money(expected)],['人工确认净已实现损益',actual===''?'待对账':money(Number(actual))],['与基准期望差异',actual!==''&&expected!==null?money(Number(actual)-expected):'—']])+`<p class="hint">${baseline?`首次基准方案 v${baseline.revision} · 目标日 ${esc(baseline.horizon)}；差异仅用于比较，不代表因果归因。`:'尚无已确认基准方案。'} 下方时间线保留原始假设、方案和管理动作。</p>`;
}
function timeline(c){return `<section class="timeline"><div class="section-heading"><h2>Activity & Snapshots</h2><span class="badge">${c.events.length} 条记录</span></div><ol>${c.events.slice().reverse().map(e=>`<li class="event"><time>${date(e.at)}</time><div><strong>v${e.revision} · ${esc(NODES[e.node].name)} · ${esc(e.type.replaceAll('In Action Policy','In Action'))}</strong><p>${esc(e.reason.replaceAll('In Action Policy','In Action'))}</p></div><button data-replay="${esc(e.id)}">查看快照</button></li>`).join('')}</ol></section>`;}
function render(){riskController=null;positionController=null;renderLibrary();const c=visible(),live=current();if(!c){$('#main').innerHTML='<section class="empty"><p class="eyebrow">ONE THESIS. ONE LIFECYCLE.</p><h2>给每个交易观点，一条清晰的路径。</h2><p>建立假设、确认信号，比较组合的收益与风险。管理持仓，最后归档整个决策过程。</p><button class="primary" data-new>创建第一个 Thesis</button><button class="quiet" data-demo>查看模拟案例</button></section>';return;}
 $('#main').innerHTML=`${replay?`<div class="replay"><span>历史快照 · v${c.revision} · ${date(c.updatedAt)}<br>节点、参数与状态均为当时记录；只读。</span><button id="exit-replay">返回当前版本</button></div>`:''}<div class="instance-header"><div><p class="eyebrow">${esc(c.symbol)} ${c.demo?' / SIMULATED':''}</p><h2>${esc(c.title)}</h2><div class="instance-meta"><span>目标 ${esc(c.horizon)}</span><span>v${c.revision}</span><span>${c.archived?'Archived':'Active'}</span></div></div><div class="toolbar"><button id="snapshot" ${readOnly()?'disabled':''}>保存快照</button><button id="export-case">导出实例</button>${node==='attribution'&&!readOnly()?'<button id="archive-case">归档实例</button>':''}</div></div><div class="workbench">${graph(c)}${inspector(c)}</div>${timeline(live)}`;
 mountRiskPanel(c);
 mountPositionPanel(c);
 const attributionHost=$('#wf-attribution-control');
 if(attributionHost)mountAttributionControl(attributionHost,{c,readonly:readOnly(),onSave:evidence=>{if(!attributionHost.isConnected||readOnly())return;const data=readDraft();data.evidence=clone(evidence);mutate(c=>saveNode(c,'attribution',data,'保存账户已实现盈亏对账参考（非 thesis 自动归属）'));}});
}
function readDraft(){const form=$('#node-form');if(node==='construction'&&form)return readConstruction(form,editorCase(visible()));const d=clone(visible().nodes[node].data);if(!form)return d;for(const [key,,type]of F[node]){const el=form.elements.namedItem(`f.${key}`);if(!el)continue;d[key]=type==='number'&&el.value!==''?Number(el.value):el.value;}
 if(node==='construction'||(node==='positions'&&!visible().nodes.positions.data.binding)){const key=node==='construction'?'legs':'positions';d[key]=[...form.querySelectorAll('.leg')].map((el,i)=>{const l={};el.querySelectorAll('[name]').forEach(input=>{const k=input.name.split('.')[1];l[k]=input.type==='number'&&input.value!==''?+input.value:input.value;});return l;});}
 if(node==='risk'&&riskController&&!readOnly()){d.sizing=riskController.read();d.accountSnapshot=clone(riskController.context());}
 return d;
}
function updatePreview(){dirty=true;$('#dirty-label').textContent=' · 未保存';document.querySelectorAll('[data-transition]').forEach(b=>b.disabled=true);const c=clone(visible());c.nodes[node].data=readDraft();const preview=$(node==='construction'?'#editor-preview':'#live-summary');if(preview)preview.innerHTML=node==='construction'?constructionSummary(c):['returns','risk'].includes(node)?designSummary(c):node==='positions'?positionSummary(c):node==='attribution'?attributionSummary(c):'';}
function openNew(){if(!leave())return;$('#new-form').reset();$('#new-dialog').showModal();}
function addDemo(){if(!leave())return;const c=demoCase();try{const next=clone(store);next.cases.push(c);persist(next);dirty=false;selectCase(c.id);notice('已创建模拟案例。所有价格、Greeks 与预算均为示例。');}catch(e){notice(e.message);}}
function download(data,name){const blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#import-trigger').addEventListener('click',()=>$('#import').click());
$('#new').addEventListener('click',openNew);$('#cancel-new').addEventListener('click',()=>$('#new-dialog').close());$('#demo').addEventListener('click',addDemo);
$('#new-form').addEventListener('submit',e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target)),c=createCase(data);if(!c.title)return;try{const next=clone(store);next.cases.push(c);persist(next);dirty=false;$('#new-dialog').close();selectCase(c.id);}catch(err){notice(err.message);}});
$('#export').addEventListener('click',()=>download(blocked&&raw?raw:store,`workflow-backup-${new Date().toISOString().slice(0,10)}.json`));
$('#import').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file||!leave())return;try{if(file.size>20*1024*1024)throw Error('备份超过 20 MB');const incoming=validateStore(JSON.parse(await file.text())),next=clone(store);let added=0,skipped=0;for(const c of incoming.cases){if(next.cases.some(x=>x.id===c.id)){skipped++;continue;}next.cases.push(c);added++;}if(next.cases.length>500)throw Error('最多保存 500 个实例');validateBindingsAcrossCases(next.cases);persist(next);dirty=false;selected=next.cases.at(-1)?.id||'';replay=null;filter=current()?.archived?'archived':'active';render();notice(`导入 ${added} 个实例；跳过 ${skipped} 个已有 ID（不会覆盖现有历史）。`);}catch(err){notice('未导入：'+err.message);}});
document.addEventListener('input',e=>{if(e.target.closest('#node-form')&&e.target.name!=='reason'){if(node==='construction'&&['underlying','type','strike','expiry'].includes(e.target.name.split('.')[1])){const leg=e.target.closest('.structure-leg');if(leg)for(const key of ['delta','gamma','theta','vega','iv','quoteAt','underlyingPrice']){const input=leg.querySelector(`[name$=".${key}"]`);if(input)input.value='';}}if(e.target.name.endsWith('.type')){const leg=e.target.closest('.leg');leg.querySelector(node==='construction'?'.structure-option-fields':'.option-fields').hidden=e.target.value==='stock';leg.querySelector(node==='construction'?'.structure-greeks':'.greek-fields').hidden=e.target.value==='stock';}updatePreview();}});
document.addEventListener('submit',e=>{if(e.target.id!=='node-form')return;e.preventDefault();if(node==='construction'){if(readOnly())return;const data=readDraft(),name=e.target.elements.namedItem('plan-name').value,id=planEditor?.id;const previous=planEditor;planEditor=null;if(!mutate(c=>savePlan(c,id,name,data)))planEditor=previous;return;}if(node==='positions'&&positionController?.hasDraft()){notice('请先用「确认归属并同步」保存持仓分配');return;}if(node==='risk'&&!riskController){notice('账户风控数据未载入，暂不能保存评估');return;}const data=readDraft(),reason=e.target.elements.namedItem('reason')?.value.trim()||'更新节点内容';mutate(c=>{if(!saveNode(c,node,data,reason))throw Error('没有内容变更');});});
document.addEventListener('click',async e=>{let b=e.target.closest('button');
 if(!b&&!e.target.closest('[popover]')){const row=e.target.closest('[data-plan-row]');if(row)b=row.querySelector('[data-edit-plan]');}
 if(!b)return;
 if(b.dataset.planMenu){const menu=document.getElementById(b.dataset.planMenu);if(menu.matches(':popover-open')){menu.hidePopover();return;}const box=b.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(box.right-190,innerWidth-198))+'px';menu.style.top=Math.max(8,Math.min(box.bottom+6,innerHeight-110))+'px';menu.showPopover();b.setAttribute('aria-expanded','true');menu.addEventListener('toggle',()=>b.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));return;}
 if(b.closest('[popover]')?.matches(':popover-open'))b.closest('[popover]').hidePopover();
 if(b.hasAttribute('data-new'))return openNew();if(b.hasAttribute('data-demo'))return addDemo();
 if(b.dataset.case)return selectCase(b.dataset.case);
 if(b.dataset.filter){if(!leave())return;filter=b.dataset.filter;planEditor=null;selected=store.cases.find(c=>c.archived===(filter==='archived'))?.id||'';replay=null;dirty=false;render();return;}
 if(b.dataset.node){if(!leave())return;node=b.dataset.node;dirty=false;planEditor=null;render();return;}
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
 if(b.id==='add-leg'||b.hasAttribute('data-remove-leg')){const d=readDraft(),key=node==='construction'?'legs':'positions';if(b.id==='add-leg')d[key].push(legDefaults());else d[key].splice(+b.dataset.removeLeg,1);$('#legs').innerHTML=legsHTML(d[key],node==='positions');updatePreview();return;}
 if(b.dataset.transition){if(dirty){notice('请先保存节点内容');return;}const to=b.dataset.transition;
 if(mutate(c=>transition(c,node,to))&&current().archived){filter='archived';render();}return;}
});
document.addEventListener('change',e=>{if(e.target.id!=='design-plan-selector')return;const id=e.target.value;if(!leave()){e.target.value=visible().design.selectedId;return;}if(readOnly()){const c=visible(),p=c.design?.plans.find(p=>p.id===id);if(p){notice('历史快照按当时查看的方案回放；其他方案可在 Portfolio Construction 查看交易腿。');e.target.value=c.design.selectedId;}return;}mutate(c=>selectPlan(c,id));});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===KEY)notice('另一个窗口修改了 Workflow 数据，请导出当前备份后刷新。当前窗口不会覆盖新数据。');});

function mountRiskPanel(c){
 const host=$('#wf-risk-control');if(!host||!c.design?.plans.length)return;
 mountWorkflowRiskControl(host,{data:c.nodes.risk.data,entry:c.nodes.returns.data.spot,legs:c.nodes.construction.data.legs,readonly:readOnly(),
  onChange:()=>updatePreview(),onAccountChange:context=>{updatePreview();}
 }).then(control=>{
  if(!host.isConnected||selected!==c.id)return;riskController=control;
  if(control&&!readOnly()){
   const stale=!c.nodes.risk.data.sizing||accountFingerprint(c.nodes.risk.data.accountSnapshot)!==control.fingerprint();
   if(stale){
    host.querySelector('.rc-status').textContent='保存 Risk Budget 时会记录账户与仓位评估快照。此前评估尚未保存或已过期。';}
   
  }
 }).catch(e=>notice('账户风控载入失败：'+e.message));
}
window.addEventListener('storage',async e=>{
 if(!['riskPolicy','riskMaxHeat','riskGroups','riskStops'].includes(e.key))return;
 try{const {context}=await loadRiskEnvironment();
  if(node==='risk'&&!readOnly()&&riskController){await riskController.refresh();updatePreview();}
  notice('Portfolio 的共享风控设置已更新；请保存并重新评估 Risk Budget。');
 }catch(err){notice('共享风控刷新失败：'+err.message);}
});


function applyPositionSync(data,reason){
 if(!current()||readOnly())return;
 if(positionLinkFingerprint(data)===positionLinkFingerprint(current().nodes.positions.data))return;
 mutate(c=>saveNode(c,'positions',data,reason));
}
function mountPositionPanel(c){
 const host=$('#wf-position-control');if(!host)return;
 const usable=()=>host.isConnected&&selected===c.id&&node==='positions'&&!readOnly();
 mountPositionControl(host,{c,cases:store.cases,readonly:readOnly(),
  onDirty:()=>{dirty=true;$('#dirty-label').textContent=' · 有未确认归属';document.querySelectorAll('[data-transition]').forEach(b=>b.disabled=true);},
  onBind:async(selection,reason)=>{
   try{const draft=readDraft(),source=await loadPositionSource();if(!usable())return;
    if(JSON.stringify(draft)!==JSON.stringify(readDraft()))throw Error('读取期间内容已变化，请重新确认');
    const base=clone(current());base.nodes.positions.data=draft;
    const binding=bindingFromSelection(base,store.cases,source,selection),data=reconcilePositions(base,store.cases,source,binding);
    if(data.sync.status!=='synced')throw Error(data.sync.issues.map(i=>i.message).join('；'));
    mutate(c=>saveNode(c,'positions',data,'确认持仓归属：'+reason));
   }catch(err){notice('归属未保存：'+err.message);}
  },
  onSync:async source=>{if(!usable()||dirty||!current().nodes.positions.data.binding)return;applyPositionSync(reconcilePositions(current(),store.cases,source),'同步 Portfolio 本地持仓快照');},
  onRule:async(key,mode,reason)=>{
   try{if(positionController?.hasDraft())throw Error('请先确认归属编辑');const draft=readDraft(),source=await loadPositionSource();if(!usable())return;
    if(JSON.stringify(draft)!==JSON.stringify(readDraft()))throw Error('读取期间内容已变化，请重新确认');
    const base=clone(current());base.nodes.positions.data=draft;
    const binding=closeOrReleaseRule(base,source,key,mode),data=reconcilePositions(base,store.cases,source,binding);
    mutate(c=>saveNode(c,'positions',data,(mode==='close'?'确认已清仓：':'解除持仓归属：')+reason));
   }catch(err){notice('操作未保存：'+err.message);}
  }
 }).then(control=>{if(!host.isConnected)return;positionController=control;
  if(usable()&&!dirty&&control?.source()&&current().nodes.positions.data.binding)applyPositionSync(reconcilePositions(current(),store.cases,control.source()),'打开节点时同步 Portfolio 持仓');
 }).catch(err=>notice('实际持仓载入失败：'+err.message));
}
setInterval(()=>{
 if(document.visibilityState==='visible'&&node==='positions'&&!readOnly()&&!dirty&&positionController&&!positionController.hasDraft())positionController.refresh().catch(e=>notice('持仓刷新失败：'+e.message));
},60000);

try{selected=decodeURIComponent(location.hash.slice(1));}catch{selected='';}if(!current())selected=store.cases.find(c=>!c.archived)?.id||store.cases[0]?.id||'';if(current())filter=current().archived?'archived':'active';if(new URLSearchParams(location.search).get('node')==='attribution')node='attribution';render();
