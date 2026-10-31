import {parseDeadline,daysToDeadline} from './horizon-date.mjs';
import {validateExecutionLinks} from './trade-link-model.mjs';
import {emptyScenarioUnderwriting,scenarioUnderwriting,returnInputError,scenarioUnderwritingError,captureReturnBasis,validateReturnBasis,numeric} from './expected-return.mjs?v=20261028-deadline';
import {structureDraft,structureError,ticker,structureExposure,positionLabel,candidateDraft} from './trade-structure.mjs';
import { validateAttributionEvidence } from './attribution-link.mjs';
import { parseTransactionFile } from './attribution-transactions.mjs?v=20261004-3';
import { allocationIssues } from "./risk-budget.mjs";
import {emptyKellyPolicy,kellyPolicyError} from './kelly-allocation.mjs?v=20261028-deadline';
import {allocationInputFingerprint} from './workflow-freshness.mjs?v=20261028-deadline';
// Standalone workflow domain. No dependencies on dashboard data or broker credentials.
export const VERSION = 1;
export const KEY = 'research-desk.workflow.v1';
const LEGACY_NODES = {
 hypothesis:{name:'Hypothesis',cn:'交易论点',initial:'draft',states:{draft:['defined','abandoned'],defined:['valid','invalidated','expired','abandoned'],valid:['invalidated','expired','abandoned'],invalidated:['draft'],expired:['draft'],abandoned:['draft']}},
 signal:{name:'Signal',cn:'信号与触发',initial:'unconfigured',states:{unconfigured:['watching'],watching:['triggered','expired'],triggered:['stale','watching'],stale:['watching'],expired:['watching']}},
 returns:{name:'Scenario Underwriting',cn:'联合情景承保',initial:'pending',states:{pending:['evaluated'],evaluated:['reassess'],reassess:['evaluated']}},
 construction:{name:'Portfolio Construction',cn:'组合构建',initial:'draft',states:{draft:['feasible'],feasible:['baseline','revise'],baseline:['revise'],revise:['feasible']}},
 risk:{name:'Risk Budget',cn:'风险预算',initial:'unchecked',states:{unchecked:['within','breached'],within:['recheck','breached'],breached:['recheck'],recheck:['within','breached']}},
 positions:{name:'Monitor',cn:'盘中监控',initial:'unlinked',states:{unlinked:['active','closed'],active:['adjusting','exiting','closed'],adjusting:['active','exiting','closed'],exiting:['active','closed'],closed:[]}},
 attribution:{name:'Attribution',cn:'归因与归档',initial:'reconcile',states:{reconcile:['review'],review:['reviewed'],reviewed:['review','archived'],archived:[]}}
};
export const LABELS = {pending:'pending',running:'running'};
export const NODES = Object.fromEntries(Object.entries(LEGACY_NODES).filter(([key])=>key!=='signal').map(([key,n])=>[key,{name:n.name,cn:n.cn,initial:'pending',states:{pending:['running'],running:['pending']}}]));
export function displayState(state){return ['draft','unconfigured','pending','unchecked','unlinked','reconcile'].includes(state)?'pending':'running';}
export function hypothesisFields(data){
 return {expectation:data.expectation??(data.target!==''&&data.target!=null?`预期标的涨跌幅 ${data.target}%`:''),rationale:data.rationale??'',verification:data.verification??'',invalidation:data.invalidation??''};
}
export const LAYERS = [
 {name:'Alpha Research',cn:'超额收益研究层',nodes:['hypothesis']},
 {name:'Portfolio Design & Risk Allocation',cn:'组合设计与风险配置层',nodes:['returns','construction','risk']},
 {name:'Monitoring',cn:'盘中监控层',nodes:['positions']},
 {name:'Performance Attribution',cn:'绩效归因层',nodes:['attribution']}
];
export const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const uid = () => globalThis.crypto.randomUUID();
export function createCase({title,symbol='',horizon='',rationale='',demo=false,historyMode='automatic'}) {
 const c={...(historyMode==='manual'?{historyMode:'manual'}:{}),id:uid(),title:title.trim(),symbol:symbol.trim().toUpperCase(),horizon,demo,createdAt:now(),updatedAt:now(),revision:0,stateVersion:2,positionNodeVersion:1,archived:false,activeThesis:false,nodes:{},events:[]};
 for(const [key,node] of Object.entries(NODES)) c.nodes[key]={state:node.initial,data:{}};
 Object.assign(c.nodes.hypothesis.data,{expectation:'',rationale,verification:'',invalidation:''});
 c.nodes.returns.data=emptyScenarioUnderwriting();
 Object.assign(c.nodes.construction.data,{structureVersion:1,template:'custom',evaluationDate:horizon,legs:[]});
 c.nodes.risk.data=emptyKellyPolicy();
 c.nodes.positions.data={};
 Object.assign(c.nodes.attribution.data,{realized:'',outcome:'',drivers:'',lesson:'',reconciliation:''});
 c.design={version:1,plans:[],selectedId:'',activeId:''};
 record(c,'创建实例','hypothesis',demo?'模拟案例，不是真实持仓':'创建交易论点');
 return c;
}
export function snapshot(c){ const {events,...body}=c; return clone(body); }
export function record(c,type,node,reason){if(c.historyMode==='manual'){c.updatedAt=now();return;}c.revision++;c.updatedAt=now();c.events.push({id:uid(),at:c.updatedAt,type,node,reason,revision:c.revision,snapshot:snapshot(c)});}
export function generateVersion(c){
 writable(c);c.historyMode='manual';c.revision++;c.updatedAt=now();
 const event={id:uid(),at:c.updatedAt,type:'手动生成版本',node:'hypothesis',reason:'保存当前完整 Workflow 版本',revision:c.revision,snapshot:snapshot(c)};
 c.events.push(event);return event;
}
export function legError(legs,positions=false){
 if(!Array.isArray(legs)||legs.length>60)return '持仓腿格式无效（最多 60 条）';
 for(const l of legs){
  if(!['stock','call','put'].includes(l.type)||!['long','short'].includes(l.side))return '请选择有效的工具和方向';
  if(!Number.isFinite(+l.qty)||+l.qty<=0|| (l.type!=='stock'&&!Number.isInteger(+l.qty)))return '数量必须大于 0，期权张数必须为整数';
  if(l.entry===''||!Number.isFinite(+l.entry)||+l.entry<0)return '请填写有效的单位成本/权利金';
  if(l.type!=='stock'&&(!/^\d{4}-\d{2}-\d{2}$/.test(l.expiry)||!Number.isFinite(+l.strike)||+l.strike<=0))return '期权需要有效的到期日与行权价';
  for(const f of ['delta','gamma','theta','vega'])if(l[f]!==''&&l[f]!=null&&!Number.isFinite(+l[f]))return 'Greeks 必须为数值或留空';
  if(l.delta!==''&&l.delta!=null&&(Math.abs(+l.delta)>1||(l.type==='call'&&+l.delta<0)||(l.type==='put'&&+l.delta>0)))return 'Delta 使用每单位多头合约口径：call 0 到 1；put −1 到 0';
  if(positions&&l.mark!==''&&l.mark!=null&&(!Number.isFinite(+l.mark)||+l.mark<0))return '当前价格必须非负或留空';
 }
 return '';
}
const num = v => v!==''&&v!=null&&Number.isFinite(+v);
export function exposure(legs){
 const result={delta:0,gamma:0,theta:0,vega:0,cash:0};
 for(const l of legs){const q=+l.qty*(l.type==='stock'?1:100)*(l.side==='short'?-1:1); result.cash=result.cash===null||!num(l.entry)?null:result.cash+q*+l.entry;
  for(const k of ['delta','gamma','theta','vega']) {const value=l.type==='stock'?(k==='delta'?1:0):(num(l[k])?+l[k]:null);result[k]=result[k]===null||value===null?null:result[k]+q*value;}
 }
 if(new Set(legs.map(ticker)).size>1){result.delta=null;result.gamma=null;result.vega=null;}
 return result;
}
export function scenario(c){
 const d=c.nodes.returns.data,construction=c.nodes.construction.data,legs=construction.legs;
 const evaluationDate=construction.evaluationDate||c.horizon;
 if(construction.structureVersion===1){const error=structureError(construction,true);if(error)return {error};}
 if(new Set(legs.map(ticker)).size>1)return {error:'多标的结构已保存；当前收益模型仅支持单标的，跨标的情景与风险计算待扩展。'};
 if(!num(d.spot)||+d.spot<=0||!legs.length||legError(legs))return {error:'先填写参考股价与有效的组合腿。'};
 const expiries=[...new Set(legs.filter(l=>l.type!=='stock').map(l=>l.expiry))];
 if(expiries.length>1)return {error:'不同到期日的期权需要定价模型；当前仅支持同到期日损益。'};
 if(expiries.length&&expiries[0]!==evaluationDate)return {error:'期权到期日必须与结构评估日期一致，才能使用当前到期损益模型。'};
 if(!['down','base','up'].every(k=>num(d[k])&&+d[k]>=-100)||!num(d.cost)||+d.cost<0)return {error:'请填写有效情景涨跌幅（不低于 −100%）与非负总成本。'};
 const pnlAt=price=>legs.reduce((sum,l)=>{const value=l.type==='stock'?price:l.type==='call'?Math.max(price-+l.strike,0):Math.max(+l.strike-price,0);return sum+(value-+l.entry)*+l.qty*(l.type==='stock'?1:100)*(l.side==='short'?-1:1);},0)-+d.cost;
 const rows=['down','base','up'].map((k,i)=>({name:['下行情景','基准情景','上行情景'][i],change:+d[k],price:+d.spot*(1+(+d[k]/100)),pnl:pnlAt(+d.spot*(1+(+d[k]/100)))}));
 const ps=[d.pDown,d.pBase,d.pUp];const validProb=ps.every(p=>num(p)&&+p>=0&&+p<=100)&&Math.abs(ps.reduce((a,p)=>a+(+p),0)-100)<.0001;
 const points=[0,...legs.filter(l=>l.type!=='stock').map(l=>+l.strike)];
 const tail=legs.reduce((a,l)=>a+(['stock','call'].includes(l.type)?+l.qty*(l.type==='stock'?1:100)*(l.side==='short'?-1:1):0),0);
 const maxLoss=tail<0?Infinity:Math.max(0,-Math.min(...points.map(pnlAt)));
 return {rows,expected:validProb?rows.reduce((a,r,i)=>a+r.pnl*(+ps[i]/100),0):null,maxLoss,expiry:expiries[0]||evaluationDate};
}
export function riskCheck(c){
 const s=scenario(c),d=c.nodes.risk.data,e=exposure(c.nodes.construction.data.legs),issues=[];
 if(d.sizing)issues.push(...allocationIssues(d.sizing,d.accountSnapshot,c.nodes.construction.data.legs));
 if(s.error)issues.push(s.error);
 if(!num(d.lossBudget)||+d.lossBudget<=0)issues.push('填写本实例损失预算');
 else if(s.maxLoss>+d.lossBudget)issues.push('到期理论最大损失超过实例预算');
 if(!num(d.deltaBudget)||+d.deltaBudget<=0||!num(d.existingDelta))issues.push('填写同标的已有 Delta 与总 Delta 上限');
 else if(e.delta===null)issues.push('期权 Delta 缺失，不能检查方向敞口');
 else if(Math.abs(+d.existingDelta+e.delta)>+d.deltaBudget)issues.push('同标的合计 Delta 超出上限');
 if(!d.context?.trim())issues.push('补充账户风险检查（其他标的集中度、购买力等）');
 return issues;
}
export function gate(c,key,to){
 if(c.archived)return '归档实例只读';

 return NODES[key]?.states[c.nodes[key]?.state]?.includes(to)?'':'此状态转换不可用';
}
export function transition(c,key,to){
 const error=gate(c,key,to);if(error)throw Error(error);
 const from=c.nodes[key].state;c.nodes[key].state=to;
 record(c,`${from} → ${to}`,key,'');
}
export function archiveCase(c){
 if(c.archived)throw Error('归档实例只读');
 captureReturnBasis(c,now());
 if(c.returnBasis&&numeric(c.nodes.attribution.data.realized))c.performance={basis:clone(c.returnBasis),actualNet:Number(c.nodes.attribution.data.realized),completedAt:now()};
 c.activeThesis=false;c.archived=true;record(c,'归档实例','attribution','保存完整工作流与复盘快照');
}
export function saveNode(c,key,data,reason='更新节点内容'){
 if(c.archived)throw Error('归档实例只读');
 if(key==='attribution'&&data.transactionFile){const file=parseTransactionFile(data.transactionFile);if(file.thesis.id!==c.id)throw Error('交易历史文件不属于此 thesis');}

 // Horizon is edited with Hypothesis. Keep its established calculation key
 // so legacy theses, snapshots and all Greek/Kelly consumers share one value.
 let horizonChanged=false,horizonValue,deadlineChanged=false,deadlineValue;
 if(key==='hypothesis'&&Object.hasOwn(data,'horizonDate')){
  data=clone(data);deadlineValue=parseDeadline(data.horizonDate);delete data.horizonDate;
  if(deadlineValue===null)throw Error('Horizon 请填写有效的 mm/dd/yyyy 截止日期，或留空');
  deadlineChanged=deadlineValue!==(c.nodes.returns.data.deadline??null)||deadlineValue!==c.horizon;
 }
 if(key==='hypothesis'&&Object.hasOwn(data,'daysForward')){
  data=clone(data);horizonValue=data.daysForward;delete data.daysForward;
  if(horizonValue!==''&&(!numeric(horizonValue)||Number(horizonValue)<0))throw Error('Horizon 须为非负天数，或留空');
  horizonValue=horizonValue===''?'':Number(horizonValue);
  horizonChanged=horizonValue!==(c.nodes.returns.data.daysForward??'');
 }
 if(key==='returns'){const error=[1,2,3].includes(data?.scenarioVersion)?scenarioUnderwritingError(data,c.design?.plans||[]):returnInputError(data);if(error)throw Error(error);}
 if(key==='risk'&&[1,2].includes(data?.allocationVersion)){const error=kellyPolicyError(c,data);if(error)throw Error(error);}
 if(key==='positions')throw Error('Monitor 当前为空节点，暂不保存字段');
 if(key==='construction'){const error=data.structureVersion===1?structureError(data):legError(data.legs);if(error)throw Error(error);}
 if(JSON.stringify(c.nodes[key].data)===JSON.stringify(data)&&!horizonChanged&&!deadlineChanged)return false;
 if(horizonChanged)c.nodes.returns.data.daysForward=horizonValue;
 if(deadlineChanged){c.horizon=deadlineValue;c.nodes.returns.data.deadline=deadlineValue;c.nodes.returns.data.daysForward=daysToDeadline(deadlineValue);}
 c.nodes[key].data=clone(data);
 if(key==='construction'){
  if(!c.design?.plans.length)initializePlans(c);
  const plan=c.design?.plans.find(p=>p.id===c.design.selectedId);if(plan)plan[key]=clone(data);
 }
 if(key==='returns')captureReturnBasis(c,now());
 record(c,'更新内容',key,reason);return true;
}
const DESIGN_KEYS=['construction'];
export function emptyDesign(horizon=''){
 return {construction:{structureVersion:1,greekScale:10000,template:'stock',evaluationDate:horizon,candidate:{version:1,underlying:'',instrument:'stock',referenceCapital:'',referenceIv:'',referenceIvAt:'',referenceIvDte:'',targetDte:'',longDelta:'',shortDelta:'',plannedEntry:''},legs:[]}};
}
export function initializePlans(c){
 const id='legacy-'+c.id,plan={id,name:'现有方案',...Object.fromEntries(DESIGN_KEYS.map(k=>[k,clone(c.nodes[k].data)]))};
 c.design={version:1,plans:[plan],selectedId:id,activeId:c.designFrozen?id:''};delete c.designFrozen;
}
function writable(c){if(c.archived)throw Error('归档实例只读');}
function projectPlan(c,id){const p=c.design.plans.find(p=>p.id===id);c.design.selectedId=p?.id||'';const values=p||emptyDesign(c.horizon);for(const key of DESIGN_KEYS)c.nodes[key].data=clone(values[key]);}
export function savePlan(c,id,name,construction){
 writable(c);const modern=!!construction.candidate;if(modern){construction=clone(construction);construction.candidate=candidateDraft(construction,c.symbol);name=positionLabel(construction,c.symbol);if(!construction.candidate.underlying)throw Error('请填写 Underlying');}else{name=String(name||'').trim();if(!name||name.length>100)throw Error('请填写方案名称（最多 100 字）');if(c.design.plans.some(p=>p.id!==id&&p.name===name))throw Error('方案名称已存在');}
 const error=structureError(construction);if(error)throw Error(error);
 let p=c.design.plans.find(p=>p.id===id);if(id&&!p)throw Error('Underlying Greek Bundle 已不存在');
 if(!p){if(c.design.plans.length>=30)throw Error('每个 thesis 最多 30 个 Underlying Greek Bundle');p={id:uid(),name,frozen:false,...emptyDesign(c.horizon)};c.design.plans.push(p);}
 p.name=name;p.construction=clone(construction);projectPlan(c,p.id);
 record(c,id?'更新 Underlying Greek Bundle':'添加 Underlying Greek Bundle','construction',name);return p.id;
}
export function setPlanFrozen(c,id,frozen){
 writable(c);const p=c.design.plans.find(p=>p.id===id);if(!p)throw Error('Underlying Greek Bundle 不存在');
 if(typeof frozen!=='boolean')throw Error('Bundle Freeze 状态无效');if(!!p.frozen===frozen)return;
 p.frozen=frozen;record(c,frozen?'Frozen Bundle':'Unfrozen Bundle','construction',p.name);
}
export function setAllPlansFrozen(c,frozen){
 writable(c);if(typeof frozen!=='boolean')throw Error('Bundle Freeze 状态无效');const changed=c.design.plans.filter(p=>!!p.frozen!==frozen);if(!changed.length)return;
 for(const p of changed)p.frozen=frozen;record(c,frozen?'锁定全部 Bundle':'解锁全部 Bundle','construction',`${changed.length} 个 Underlying Greek Bundle`);
}
export function selectPlan(c,id){writable(c);if(!c.design.plans.some(p=>p.id===id))throw Error('方案不存在');if(c.design.selectedId===id)return;projectPlan(c,id);record(c,'切换查看方案','construction',c.design.plans.find(p=>p.id===id).name);}
export function setActivePlan(c,id){writable(c);if(id&&!c.design.plans.some(p=>p.id===id))throw Error('方案不存在');c.design.activeId=id;captureReturnBasis(c,now());record(c,'设置 In Action','construction',id?c.design.plans.find(p=>p.id===id).name:'取消 In Action');}
function allocationContent(allocation){
 if(!allocation)return '';
 const {at,underwrittenAt,reviewedAt,...content}=allocation;
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 return JSON.stringify(canonical(content));
}
export function setActiveAllocation(c,result){
 writable(c);
 if(result?.complete===false)throw Error((result.issues||[]).join('；')||'Risk Budget 输入不完整');
 if(result?.complete&&Array.isArray(result.bundles)){
  if(result.constraintIssue)throw Error(result.constraintIssue);
  const items=result.bundles.map(({bundleId,name,underlying,eligible,exclusionReason,standaloneExpectedReturn,fullFraction,kellyFraction,kellyWeight,baselineRiskShare,baselineWeight,kellyRiskShare,riskShare,weight,fraction,referencePrice,referenceCapital,riskBasis,scenarioReturns,atr,stopDistance,downStopPrice,upStopPrice,adverseStopMove,adverseStopPrice,adverseStopDirection,stopRiskRate,estimatedStopRiskFraction,bullPriceMove,bearReturn})=>({bundleId,name,underlying:underlying||name,eligible,exclusionReason,standaloneExpectedReturn,fullFraction,kellyFraction,kellyWeight,baselineRiskShare,baselineWeight,kellyRiskShare,riskShare,weight,fraction,referencePrice,referenceCapital,riskBasis:clone(riskBasis),scenarioReturns:clone(scenarioReturns),atr,stopDistance,downStopPrice,upStopPrice,adverseStopMove,adverseStopPrice,adverseStopDirection,stopRiskRate,estimatedStopRiskFraction,bullPriceMove,bearReturn}));
  const scenarios=result.scenarios.map(({id,name,probability,weightReturn,portfolioReturn,wealth})=>({id,name,probability,weightReturn,portfolioReturn,wealth}));
  const activatedAt=now();
  const allocation={method:'risk-budget-kelly',weightingMethod:result.weightingMethod,kellyTiltPct:result.kellyTiltPct,inAction:true,at:activatedAt,underwrittenAt:activatedAt,reviewedAt:activatedAt,scenarioDaysForward:scenarioUnderwriting(c.nodes.returns.data).daysForward,scenarioHorizon:c.horizon||'',sourceFingerprint:allocationInputFingerprint(c),allocatedFraction:result.allocatedFraction,cashFraction:result.cashFraction,expectedLogGrowth:result.expectedLogGrowth,kellyExpectedLogGrowth:result.kellyExpectedLogGrowth,thesisAtRiskLimitPct:result.atRiskLimitPct,atrStopMultiple:result.atrStopMultiple,stopRiskRate:result.stopRiskRate,scenarioRiskRate:result.scenarioRiskRate,effectiveLossRate:result.effectiveLossRate,bindingRisk:result.bindingRisk,estimatedStopRiskPct:result.estimatedStopRiskFraction*100,items,scenarios,monteCarlo:result.monteCarlo?{samples:result.monteCarlo.samples}:null};
  if(Object.hasOwn(c.nodes.returns.data,'deadline'))allocation.horizonMode='deadline';
  Object.assign(allocation,{sizingMethod:result.sizingMethod,kellyFraction:result.kellyFraction,halfKellyCap:result.halfKellyCap,atRiskCap:result.atRiskCap,limitingConstraint:result.limitingConstraint});
  if(allocationContent(c.design.allocation)===allocationContent(allocation))return false;
  c.design.allocation=allocation;delete c.returnBasis;
  const active=result.bundles.filter(x=>x.fraction>0).map(x=>`${x.name} ${Number(x.fraction*100).toFixed(2)}%`).join('；');
  record(c,'设置 In Action Risk Budget','risk',active||'Target Allocation 0% · 保持现金');return true;
 }
 if(!result||!Array.isArray(result.allocations)||!result.allocations.some(x=>x.quantity>0))throw Error('当前没有可执行的优化数量');
 c.design.allocation={inAction:true,at:now(),items:clone(result.allocations),riskBudget:result.riskBudget,usedRisk:result.usedRisk,usedCapital:result.usedCapital,expected:result.expected,dollarDelta:result.dollarDelta};
 if(result.usedCapital>0)c.returnBasis={planId:'allocation',planName:'Optimized Allocation',expectedNet:result.expected,capital:result.usedCapital,expectedDate:c.horizon||'',rate:result.expected/result.usedCapital*100,at:c.design.allocation.at};
 record(c,'设置 In Action Allocation','risk',c.design.allocation.items.filter(x=>x.quantity).map(x=>`${x.positionId} × ${x.quantity}`).join('；'));
}
export function deletePlan(c,id){writable(c);const p=c.design.plans.find(p=>p.id===id);if(!p)throw Error('Underlying Greek Bundle 不存在');c.design.plans=c.design.plans.filter(p=>p.id!==id);if(c.design.activeId===id)c.design.activeId='';delete c.design.allocation;if(c.design.selectedId===id)projectPlan(c,c.design.plans[0]?.id||'');record(c,'删除 Underlying Greek Bundle','construction',p.name+'；历史快照保留');}
export function planView(c,id){const copy=clone(c),p=c.design?.plans.find(p=>p.id===id);if(p)for(const key of DESIGN_KEYS)copy.nodes[key].data=clone(p[key]);return copy;}
export function demoCase(){const horizon=new Date(Date.now()+30*86400000).toISOString().slice(0,10),c=createCase({title:'A 股票 · 一个月上涨 10%',symbol:'A',horizon,demo:true,rationale:'模拟：产品催化与盈利预期上修。所有价格、概率、Greeks 都是假设值。'});
 Object.assign(c.nodes.hypothesis.data,{expectation:'一个月内股价上涨约 10%',verification:'催化兑现，股价向目标区间运行',invalidation:'催化未兑现，或关键支撑失效'});c.nodes.hypothesis.state='running';
 c.nodes.returns.data=emptyScenarioUnderwriting();
 c.nodes.construction.data.legs=[{type:'stock',side:'long',qty:20,entry:100,strike:'',expiry:'',delta:'',gamma:'',theta:'',vega:''},{type:'put',side:'short',qty:1,entry:3,strike:100,expiry:horizon,delta:4500,gamma:300,theta:400,vega:1000},{type:'put',side:'long',qty:1,entry:1,strike:95,expiry:horizon,delta:2500,gamma:200,theta:300,vega:800}];c.nodes.construction.data.legs=c.nodes.construction.data.legs.map(l=>({...l,underlying:'A',iv:'',quoteAt:'',underlyingPrice:''}));c.nodes.construction.state='running';c.nodes.returns.state='running';
 c.nodes.risk.data={allocationVersion:2,thesisAtRiskLimitPct:'',atrStopMultiple:2.5};c.nodes.risk.state='running';
 initializePlans(c);
 record(c,'加载模拟方案','construction','Long stock + bull put spread；未关联任何实际持仓');return c;}
export function validateStore(store){
 if(!store||store.version!==VERSION||!Array.isArray(store.cases)||store.cases.length>500)throw Error('备份格式不支持');
 const ids=new Set();
 function body(c){
  if(!c||typeof c.id!=='string'||typeof c.title!=='string'||typeof c.symbol!=='string'||typeof c.horizon!=='string'||typeof c.archived!=='boolean'||(c.activeThesis!=null&&typeof c.activeThesis!=='boolean')||!Number.isInteger(c.revision)||c.revision<(c.historyMode==='manual'?0:1))throw Error('实例内容不完整');
  if(c.linkedSymbols!=null&&(!Array.isArray(c.linkedSymbols)||c.linkedSymbols.some(x=>typeof x!=='string')))throw Error('关联标的格式无效');
  if(c.portfolioUnderlyings!=null&&(!Array.isArray(c.portfolioUnderlyings)||c.portfolioUnderlyings.length>1000||new Set(c.portfolioUnderlyings).size!==c.portfolioUnderlyings.length||c.portfolioUnderlyings.some(x=>typeof x!=='string'||!/^[A-Z0-9.\-]{1,24}$/.test(x))))throw Error('Portfolio 归属标的格式无效');
  if(c.sourceLink!=null&&(c.sourceLink.kind!=='risk-policy'||typeof c.sourceLink.name!=='string'||!Array.isArray(c.sourceLink.warnings)||c.sourceLink.warnings.some(x=>typeof x!=='string')))throw Error('数据来源关联格式无效');
  for(const [key,def] of Object.entries(NODES)){const n=c.nodes?.[key];if(!n||!Object.hasOwn(c.stateVersion===2?def.states:LEGACY_NODES[key].states,n.state)||!n.data||typeof n.data!=='object'||Array.isArray(n.data))throw Error('节点状态无效');for(const [field,value] of Object.entries(n.data))if(!['legs','positions','sizing','accountSnapshot','binding','sync','evidence','candidate','scenarios','executionLinks'].includes(field)&&!['string','number'].includes(typeof value))throw Error('节点字段格式无效');}
  if(c.stateVersion===2&&['expectation','rationale','verification','invalidation'].some(k=>typeof c.nodes.hypothesis.data[k]!=='string'))throw Error('论点字段格式无效');
  if(c.stateVersion!=null&&c.stateVersion!==2)throw Error('节点版本不支持');
  const risk=c.nodes.risk.data;
  if(risk.sizing){
   if(typeof risk.sizing!=='object'||Array.isArray(risk.sizing)||Object.values(risk.sizing).some(v=>!['string','number'].includes(typeof v)))throw Error('仓位参数格式无效');
   if(!['long','short'].includes(risk.sizing.side)||!['manual','atr'].includes(risk.sizing.mode))throw Error('仓位方向或止损方法无效');
  }
  if(risk.accountSnapshot!=null){
   const a=risk.accountSnapshot;
   if(typeof a!=='object'||Array.isArray(a)||Object.values(a).some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)))throw Error('账户快照格式无效');
   if(typeof a.scope!=='string'||typeof a.available!=='boolean'||!Number.isInteger(a.unknown)||a.unknown<0)throw Error('账户快照缺少口径');
  }
  const returnError=returnInputError(c.nodes.returns.data);if(returnError)throw Error(returnError);
  if(c.returnBasis)validateReturnBasis(c.returnBasis);
  if(c.performance){validateReturnBasis(c.performance.basis);if(!c.archived||!numeric(c.performance.actualNet)||!Number.isFinite(Date.parse(c.performance.completedAt)))throw Error('实际收益快照格式无效');}
  validateAttributionEvidence(c.nodes.attribution.data.evidence);
  if(c.nodes.attribution.data.transactionFile){const file=parseTransactionFile(c.nodes.attribution.data.transactionFile);if(file.thesis.id!==c.id)throw Error('交易历史文件不属于此 thesis');}
  if(c.positionNodeVersion!=null&&![1,2].includes(c.positionNodeVersion))throw Error('Monitor 版本不支持');
  if(c.positionNodeVersion===1&&Object.keys(c.nodes.positions.data).length)throw Error('Monitor 必须保持为空');
  if(c.positionNodeVersion===2){if(Object.keys(c.nodes.positions.data).some(k=>k!=='executionLinks'))throw Error('Monitor 字段无效');validateExecutionLinks(c.nodes.positions.data.executionLinks);}
  if(c.designFrozen!=null&&typeof c.designFrozen!=='boolean')throw Error('方案冻结标记无效');
  if(c.design!=null){
   const d=c.design;if(d.version!==1||!Array.isArray(d.plans)||d.plans.length>30||typeof d.selectedId!=='string'||typeof d.activeId!=='string')throw Error('方案列表格式无效');
   const ids=new Set();
   for(const p of d.plans){
    if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||(p.frozen!=null&&typeof p.frozen!=='boolean'))throw Error('Position 名称、ID 或 Freeze 状态无效');ids.add(p.id);
    const test=clone(c);delete test.design;for(const key of DESIGN_KEYS)test.nodes[key].data=p[key];body(test);
   }
   if((d.plans.length&&!ids.has(d.selectedId))||(!d.plans.length&&d.selectedId)||(d.activeId&&!ids.has(d.activeId)))throw Error('方案引用无效');
   if(d.allocation!=null){const a=d.allocation,weighted=['multivariate-kelly','monte-carlo-kelly','risk-budget-kelly'].includes(a.method);if(typeof a!=='object'||!Array.isArray(a.items)||typeof a.inAction!=='boolean'||(weighted?a.items.some(x=>!ids.has(x.bundleId)||typeof x.name!=='string'||!numeric(x.fraction)||x.fraction<0||x.fraction>1||(x.targetCapital!=null&&(!numeric(x.targetCapital)||x.targetCapital<0))):a.items.some(x=>!ids.has(x.positionId)||!Number.isInteger(x.quantity)||x.quantity<0)))throw Error('Allocation 格式无效');}
   const selected=d.plans.find(p=>p.id===d.selectedId);if(selected&&DESIGN_KEYS.some(k=>JSON.stringify(selected[k])!==JSON.stringify(c.nodes[k].data)))throw Error('方案与节点数据不一致');
  }

  if(c.nodes.construction.data.structureVersion===1?structureError(c.nodes.construction.data):legError(c.nodes.construction.data.legs))throw Error('组合腿格式无效');
  if(c.stateVersion!==2&&c.archived!==(c.nodes.attribution.state==='archived'))throw Error('归档状态不一致');
 }
 for(const c of store.cases){body(c);if(ids.has(c.id))throw Error('实例 ID 重复');ids.add(c.id);if(!Array.isArray(c.events)||(!c.events.length&&c.historyMode!=='manual'&&!(c.historyClearedRevision===c.revision&&Number.isFinite(Date.parse(c.historyClearedAt)))))throw Error('缺少历史记录');let last=0;
  for(const e of c.events){if(typeof e.id!=='string'||typeof e.type!=='string'||typeof e.reason!=='string'||!Object.hasOwn(LEGACY_NODES,e.node)||!Number.isFinite(Date.parse(e.at))||!Number.isInteger(e.revision)||e.revision<=last)throw Error('历史记录格式无效');body(e.snapshot);if(e.snapshot.id!==c.id||e.snapshot.revision!==e.revision)throw Error('快照不匹配');last=e.revision;}
  if(c.historyMode==='manual'&&last>c.revision)throw Error('手动版本号无效');
  if(c.historyMode!=='manual'&&c.events.length&&(last!==c.revision||JSON.stringify(c.events.at(-1).snapshot)!==JSON.stringify(snapshot(c))))throw Error('最新快照与实例不一致');
 }
 // Preserve original snapshots verbatim; migration creates one new current revision.
 const result=clone(store);
 for(const c of result.cases)if(c.stateVersion!==2){
  c.stateVersion=2;
  for(const n of Object.values(c.nodes))n.state=displayState(n.state);
  c.nodes.hypothesis.data=hypothesisFields(c.nodes.hypothesis.data);
  record(c,'迁移节点状态','hypothesis','统一为 pending / running；旧字段与状态保留在历史快照中');
 }
 for(const c of result.cases)if(!c.design){initializePlans(c);record(c,'迁移方案管理','construction','原有参数转为现有方案；历史快照保持不变');}
 for(const c of result.cases)if(typeof c.activeThesis!=='boolean'){c.activeThesis=false;record(c,'迁移 Thesis 状态','hypothesis','初始化为 Offline；历史快照保持不变');}
 for(const c of result.cases)if(c.nodes.signal){delete c.nodes.signal;record(c,'移除 Signal 节点','hypothesis','Hypothesis 直接连接 Portfolio Construction；旧 Signal 仅保留在历史快照中');}
 // Position Management is intentionally reset to an empty reserved node. The explicit reset
 // also scrubs historical snapshots so replay cannot surface removed fields or bindings.
 for(const c of result.cases){if(c.positionNodeVersion===2)continue;let changed=c.positionNodeVersion!==1;c.positionNodeVersion=1;
  for(const e of c.events){const p=e.snapshot.nodes.positions,emptyState=e.snapshot.stateVersion===2?'pending':LEGACY_NODES.positions.initial;if(e.snapshot.positionNodeVersion!==1||Object.keys(p.data||{}).length||p.state!==emptyState){e.snapshot.positionNodeVersion=1;p.data={};p.state=emptyState;changed=true;}}
  const p=c.nodes.positions;if(Object.keys(p.data||{}).length||p.state!=='pending'){p.data={};p.state='pending';changed=true;}
  if(changed)record(c,'清空 Position Management','positions','移除全部持仓字段与归属；保留空节点供后续重新设计');
 }
 return result;
}


export function clearWorkflowHistory(store){
 const next=clone(store);next.cases=next.cases.filter(c=>!c.demo);
 for(const c of next.cases){c.events=[];c.historyClearedAt=new Date().toISOString();c.historyClearedRevision=c.revision;}
 return validateStore(next);
}
