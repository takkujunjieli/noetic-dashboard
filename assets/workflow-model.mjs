import {returnInputError,captureReturnBasis,validateReturnBasis,numeric} from './expected-return.mjs';
import {structureDraft,structureError,ticker,structureExposure} from './trade-structure.mjs';
import { validateAttributionEvidence } from './attribution-link.mjs';
import { validatePositionLink, validateBindingsAcrossCases } from "./position-link.mjs";
import { allocationIssues } from "./risk-budget.mjs";
// Standalone workflow domain. No dependencies on dashboard data or broker credentials.
export const VERSION = 1;
export const KEY = 'research-desk.workflow.v1';
const LEGACY_NODES = {
 hypothesis:{name:'Hypothesis',cn:'交易论点',initial:'draft',states:{draft:['defined','abandoned'],defined:['valid','invalidated','expired','abandoned'],valid:['invalidated','expired','abandoned'],invalidated:['draft'],expired:['draft'],abandoned:['draft']}},
 signal:{name:'Signal',cn:'信号与触发',initial:'unconfigured',states:{unconfigured:['watching'],watching:['triggered','expired'],triggered:['stale','watching'],stale:['watching'],expired:['watching']}},
 returns:{name:'Expected Return',cn:'收益情景',initial:'pending',states:{pending:['evaluated'],evaluated:['reassess'],reassess:['evaluated']}},
 construction:{name:'Portfolio Construction',cn:'组合构建',initial:'draft',states:{draft:['feasible'],feasible:['baseline','revise'],baseline:['revise'],revise:['feasible']}},
 risk:{name:'Risk Budget',cn:'风险预算',initial:'unchecked',states:{unchecked:['within','breached'],within:['recheck','breached'],breached:['recheck'],recheck:['within','breached']}},
 positions:{name:'Position Management',cn:'持仓生命周期',initial:'unlinked',states:{unlinked:['active','closed'],active:['adjusting','exiting','closed'],adjusting:['active','exiting','closed'],exiting:['active','closed'],closed:[]}},
 attribution:{name:'Attribution',cn:'归因与归档',initial:'reconcile',states:{reconcile:['review'],review:['reviewed'],reviewed:['review','archived'],archived:[]}}
};
export const LABELS = {pending:'pending',running:'running'};
export const NODES = Object.fromEntries(Object.entries(LEGACY_NODES).map(([key,n])=>[key,{name:n.name,cn:n.cn,initial:'pending',states:{pending:['running'],running:['pending']}}]));
export function displayState(state){return ['draft','unconfigured','pending','unchecked','unlinked','reconcile'].includes(state)?'pending':'running';}
export function hypothesisFields(data){
 return {expectation:data.expectation??(data.target!==''&&data.target!=null?`预期标的涨跌幅 ${data.target}%`:''),rationale:data.rationale??'',verification:data.verification??'',invalidation:data.invalidation??''};
}
export const LAYERS = [
 {name:'Alpha Research',cn:'超额收益研究层',nodes:['hypothesis','signal']},
 {name:'Portfolio Design & Risk Allocation',cn:'组合设计与风险配置层',nodes:['returns','construction','risk']},
 {name:'Position Lifecycle Management',cn:'持仓生命周期管理层',nodes:['positions']},
 {name:'Performance Attribution',cn:'绩效归因层',nodes:['attribution']}
];
export const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const uid = () => globalThis.crypto.randomUUID();
export function createCase({title,symbol='',horizon='',rationale='',demo=false}) {
 const c={id:uid(),title:title.trim(),symbol:symbol.trim().toUpperCase(),horizon,demo,createdAt:now(),updatedAt:now(),revision:0,stateVersion:2,archived:false,nodes:{},events:[]};
 for(const [key,node] of Object.entries(NODES)) c.nodes[key]={state:node.initial,data:{}};
 Object.assign(c.nodes.hypothesis.data,{expectation:'',rationale,verification:'',invalidation:''});
 Object.assign(c.nodes.signal.data,{indicator:'MACD 金叉',condition:'',expires:'',evidence:''});
 Object.assign(c.nodes.returns.data,{expectedNet:'',capital:'',averageLoss:'',expectedDate:'',spot:'',down:-10,base:0,up:10,pDown:'',pBase:'',pUp:'',probabilityBasis:'',cost:0,notes:''});
 Object.assign(c.nodes.construction.data,{structureVersion:1,template:'custom',evaluationDate:horizon,legs:[]});
 Object.assign(c.nodes.risk.data,{lossBudget:'',deltaBudget:'',existingDelta:'',context:'',notes:''});
 Object.assign(c.nodes.positions.data,{source:'manual',asOf:'',positions:[],action:'',exitRules:'',notes:''});
 Object.assign(c.nodes.attribution.data,{realized:'',outcome:'',drivers:'',lesson:'',reconciliation:''});
 c.design={version:1,plans:[],selectedId:'',activeId:''};
 record(c,'创建实例','hypothesis',demo?'模拟案例，不是真实持仓':'创建交易论点');
 return c;
}
export function snapshot(c){ const {events,...body}=c; return clone(body); }
export function record(c,type,node,reason){c.revision++;c.updatedAt=now();c.events.push({id:uid(),at:c.updatedAt,type,node,reason,revision:c.revision,snapshot:snapshot(c)});}
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
 if(c.nodes.positions.data.positions.length||c.nodes.positions.data.binding?.rules.some(r=>!r.closed))throw Error('请先核对并结束实际持仓归属后再归档');
 captureReturnBasis(c,now());
 if(c.returnBasis&&numeric(c.nodes.attribution.data.realized))c.performance={basis:clone(c.returnBasis),actualNet:Number(c.nodes.attribution.data.realized),completedAt:now()};
 c.archived=true;record(c,'归档实例','attribution','保存完整工作流与复盘快照');
}
export function saveNode(c,key,data,reason='更新节点内容'){
 if(c.archived)throw Error('归档实例只读');

 if(key==='returns'){const error=returnInputError(data);if(error)throw Error(error);}
 if(key==='positions')validatePositionLink(data);
 if(['construction','positions'].includes(key)){const error=key==='construction'&&data.structureVersion===1?structureError(data):legError(data[key==='construction'?'legs':'positions'],key==='positions');if(error)throw Error(error);}
 if(JSON.stringify(c.nodes[key].data)===JSON.stringify(data))return false;
 c.nodes[key].data=clone(data);
 if(['construction','returns','risk'].includes(key)){
  if(!c.design?.plans.length)initializePlans(c);
  const plan=c.design?.plans.find(p=>p.id===c.design.selectedId);if(plan)plan[key]=clone(data);
 }
 if(key==='returns')captureReturnBasis(c,now());
 record(c,'更新内容',key,reason);return true;
}
const DESIGN_KEYS=['construction','returns','risk'];
export function emptyDesign(horizon=''){
 return {construction:{structureVersion:1,template:'custom',evaluationDate:horizon,legs:[]},returns:{expectedNet:'',capital:'',averageLoss:'',expectedDate:'',spot:'',down:-10,base:0,up:10,pDown:'',pBase:'',pUp:'',probabilityBasis:'',cost:0,notes:''},risk:{lossBudget:'',deltaBudget:'',existingDelta:'',context:'',notes:''}};
}
export function initializePlans(c){
 const id='legacy-'+c.id,plan={id,name:'现有方案',...Object.fromEntries(DESIGN_KEYS.map(k=>[k,clone(c.nodes[k].data)]))};
 c.design={version:1,plans:[plan],selectedId:id,activeId:c.designFrozen?id:''};delete c.designFrozen;
}
function writable(c){if(c.archived)throw Error('归档实例只读');}
function projectPlan(c,id){const p=c.design.plans.find(p=>p.id===id);c.design.selectedId=p?.id||'';const values=p||emptyDesign(c.horizon);for(const key of DESIGN_KEYS)c.nodes[key].data=clone(values[key]);}
export function savePlan(c,id,name,construction){
 writable(c);name=String(name||'').trim();if(!name||name.length>100)throw Error('请填写方案名称（最多 100 字）');
 if(c.design.plans.some(p=>p.id!==id&&p.name===name))throw Error('方案名称已存在');
 const error=structureError(construction);if(error)throw Error(error);
 let p=c.design.plans.find(p=>p.id===id);if(id&&!p)throw Error('方案已不存在');
 if(!p){if(c.design.plans.length>=30)throw Error('每个 thesis 最多 30 个方案');p={id:uid(),name,...emptyDesign(c.horizon)};c.design.plans.push(p);}
 p.name=name;p.construction=clone(construction);projectPlan(c,p.id);
 record(c,id?'更新方案':'添加方案','construction',name);return p.id;
}
export function selectPlan(c,id){writable(c);if(!c.design.plans.some(p=>p.id===id))throw Error('方案不存在');if(c.design.selectedId===id)return;projectPlan(c,id);record(c,'切换查看方案','construction',c.design.plans.find(p=>p.id===id).name);}
export function setActivePlan(c,id){writable(c);if(id&&!c.design.plans.some(p=>p.id===id))throw Error('方案不存在');c.design.activeId=id;captureReturnBasis(c,now());record(c,'设置 In Action','construction',id?c.design.plans.find(p=>p.id===id).name:'取消 In Action');}
export function deletePlan(c,id){writable(c);const p=c.design.plans.find(p=>p.id===id);if(!p)throw Error('方案不存在');c.design.plans=c.design.plans.filter(p=>p.id!==id);if(c.design.activeId===id)c.design.activeId='';if(c.design.selectedId===id)projectPlan(c,c.design.plans[0]?.id||'');record(c,'删除方案','construction',p.name+'；历史快照保留');}
export function planView(c,id){const copy=clone(c),p=c.design?.plans.find(p=>p.id===id);if(p)for(const key of DESIGN_KEYS)copy.nodes[key].data=clone(p[key]);return copy;}
export function demoCase(){const horizon=new Date(Date.now()+30*86400000).toISOString().slice(0,10),c=createCase({title:'A 股票 · 一个月上涨 10%',symbol:'A',horizon,demo:true,rationale:'模拟：产品催化与盈利预期上修。所有价格、概率、Greeks 都是假设值。'});
 Object.assign(c.nodes.hypothesis.data,{expectation:'一个月内股价上涨约 10%',verification:'催化兑现，股价向目标区间运行',invalidation:'催化未兑现，或关键支撑失效'});c.nodes.hypothesis.state='running';
 Object.assign(c.nodes.signal.data,{condition:'日线收盘 MACD 上穿信号线，次日确认',expires:horizon,evidence:'模拟：日线金叉已确认'});c.nodes.signal.state='running';
 Object.assign(c.nodes.returns.data,{spot:100,down:-10,base:0,up:10,notes:'只展示到期情景；未估计概率。'});
 c.nodes.construction.data.legs=[{type:'stock',side:'long',qty:20,entry:100,strike:'',expiry:'',delta:'',gamma:'',theta:'',vega:''},{type:'put',side:'short',qty:1,entry:3,strike:100,expiry:horizon,delta:-.45,gamma:.03,theta:-.04,vega:.1},{type:'put',side:'long',qty:1,entry:1,strike:95,expiry:horizon,delta:-.25,gamma:.02,theta:-.03,vega:.08}];c.nodes.construction.data.legs=c.nodes.construction.data.legs.map(l=>({...l,underlying:'A',iv:'',quoteAt:'',underlyingPrice:''}));c.nodes.construction.state='running';c.nodes.returns.state='running';
 Object.assign(c.nodes.risk.data,{lossBudget:2500,deltaBudget:100,existingDelta:0,context:'模拟：同标的无其他持仓；其他标的相关性与购买力需人工核查。'});c.nodes.risk.state='running';
 initializePlans(c);
 record(c,'加载模拟方案','construction','Long stock + bull put spread；未关联任何实际持仓');return c;}
export function validateStore(store){
 if(!store||store.version!==VERSION||!Array.isArray(store.cases)||store.cases.length>500)throw Error('备份格式不支持');
 const ids=new Set();
 function body(c){
  if(!c||typeof c.id!=='string'||typeof c.title!=='string'||typeof c.symbol!=='string'||typeof c.horizon!=='string'||typeof c.archived!=='boolean'||!Number.isInteger(c.revision)||c.revision<1)throw Error('实例内容不完整');
  if(c.linkedSymbols!=null&&(!Array.isArray(c.linkedSymbols)||c.linkedSymbols.some(x=>typeof x!=='string')))throw Error('关联标的格式无效');
  if(c.sourceLink!=null&&(c.sourceLink.kind!=='risk-policy'||typeof c.sourceLink.name!=='string'||!Array.isArray(c.sourceLink.warnings)||c.sourceLink.warnings.some(x=>typeof x!=='string')))throw Error('数据来源关联格式无效');
  for(const [key,def] of Object.entries(NODES)){const n=c.nodes?.[key];if(!n||!Object.hasOwn(c.stateVersion===2?def.states:LEGACY_NODES[key].states,n.state)||!n.data||typeof n.data!=='object'||Array.isArray(n.data))throw Error('节点状态无效');for(const [field,value] of Object.entries(n.data))if(!['legs','positions','sizing','accountSnapshot','binding','sync','evidence'].includes(field)&&!['string','number'].includes(typeof value))throw Error('节点字段格式无效');}
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
  validatePositionLink(c.nodes.positions.data);
  if(c.designFrozen!=null&&typeof c.designFrozen!=='boolean')throw Error('方案冻结标记无效');
  if(c.design!=null){
   const d=c.design;if(d.version!==1||!Array.isArray(d.plans)||d.plans.length>30||typeof d.selectedId!=='string'||typeof d.activeId!=='string')throw Error('方案列表格式无效');
   const ids=new Set(),names=new Set();
   for(const p of d.plans){
    if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||names.has(p.name))throw Error('方案名称或 ID 无效');ids.add(p.id);names.add(p.name);
    const test=clone(c);delete test.design;for(const key of DESIGN_KEYS)test.nodes[key].data=p[key];body(test);
   }
   if((d.plans.length&&!ids.has(d.selectedId))||(!d.plans.length&&d.selectedId)||(d.activeId&&!ids.has(d.activeId)))throw Error('方案引用无效');
   const selected=d.plans.find(p=>p.id===d.selectedId);if(selected&&DESIGN_KEYS.some(k=>JSON.stringify(selected[k])!==JSON.stringify(c.nodes[k].data)))throw Error('方案与节点数据不一致');
  }

  if((c.nodes.construction.data.structureVersion===1?structureError(c.nodes.construction.data):legError(c.nodes.construction.data.legs))||legError(c.nodes.positions.data.positions,true))throw Error('组合腿格式无效');
  if(c.stateVersion!==2&&c.archived!==(c.nodes.attribution.state==='archived'))throw Error('归档状态不一致');
 }
 for(const c of store.cases){body(c);if(ids.has(c.id))throw Error('实例 ID 重复');ids.add(c.id);if(!Array.isArray(c.events)||(!c.events.length&&!(c.historyClearedRevision===c.revision&&Number.isFinite(Date.parse(c.historyClearedAt)))))throw Error('缺少历史记录');let last=0;
  for(const e of c.events){if(typeof e.id!=='string'||typeof e.type!=='string'||typeof e.reason!=='string'||!Object.hasOwn(NODES,e.node)||!Number.isFinite(Date.parse(e.at))||!Number.isInteger(e.revision)||e.revision<=last)throw Error('历史记录格式无效');body(e.snapshot);if(e.snapshot.id!==c.id||e.snapshot.revision!==e.revision)throw Error('快照不匹配');last=e.revision;}
  if(c.events.length&&(last!==c.revision||JSON.stringify(c.events.at(-1).snapshot)!==JSON.stringify(snapshot(c))))throw Error('最新快照与实例不一致');
 }
 validateBindingsAcrossCases(store.cases);
 // Preserve original snapshots verbatim; migration creates one new current revision.
 const result=clone(store);
 for(const c of result.cases)if(c.stateVersion!==2){
  c.stateVersion=2;
  for(const n of Object.values(c.nodes))n.state=displayState(n.state);
  c.nodes.hypothesis.data=hypothesisFields(c.nodes.hypothesis.data);
  record(c,'迁移节点状态','hypothesis','统一为 pending / running；旧字段与状态保留在历史快照中');
 }
 for(const c of result.cases)if(!c.design){initializePlans(c);record(c,'迁移方案管理','construction','原有参数转为现有方案；历史快照保持不变');}
 return result;
}


export function clearWorkflowHistory(store){
 const next=clone(store);next.cases=next.cases.filter(c=>!c.demo);
 for(const c of next.cases){c.events=[];c.historyClearedAt=new Date().toISOString();c.historyClearedRevision=c.revision;}
 return validateStore(next);
}
