import {nebulaRiskModels} from './workflow-risk-bridge.mjs?v=20261019-half-kelly';
import {KELLY_FRACTION,SIZING_METHOD} from './kelly-allocation.mjs?v=20261019-half-kelly';
import {parseInstrument} from './position-link.mjs';

const finite=v=>v!==''&&v!=null&&Number.isFinite(Number(v));
const nonnegative=v=>finite(v)&&Number(v)>=0;
const states=['bull','base','bear'];
const sum=values=>values.reduce((s,v)=>s+v,0);

// Use the same visible row scope, market value and Bear charge at every level.
// This is the heatmap's scenario exposure estimate, not loss to an old price target.
export const isHeatmapPosition=p=>finite(p.qty)&&Number(p.qty)!==0&&((p.kind||'equity')!=='equity'||Math.abs(Number(p.qty))>1);
export const heatmapMarketValue=p=>finite(p.mkt_value)?Math.abs(Number(p.mkt_value)):finite(p.qty)&&finite(p.price)?Math.abs(Number(p.qty)*Number(p.price)):null;
export function heatmapBearRisk(marketValue,bearReturn){
 return nonnegative(marketValue)&&finite(bearReturn)?Math.max(0,-Number(bearReturn)*Number(marketValue)):null;
}
function actualGroupRisk(models,positions){
 // Match the heatmap's existing preference when an underlying has multiple bundles.
 const model=models.find(m=>!m.excluded)||models.at(-1);
 const risks=positions.filter(isHeatmapPosition).map(p=>heatmapBearRisk(heatmapMarketValue(p),model?.bearReturn));
 return {risk:risks.every(v=>v!=null)?sum(risks):null,knownRisk:sum(risks.filter(v=>v!=null))};
}

// Targets replace mapped positions. Other holdings remain reserved, never added
// twice to a target. Independent thesis risk charges receive no correlation credit.
export function accountRiskPlan({equity,maxRiskPct,cases=[],positions=[],atr={},stops={},equityReliable=true}){
 const issues=[],actualIssues=[],rows=[],modelsBySymbol=new Map();
 if(!equityReliable||!(Number(equity)>0))issues.push('账户净值缺失；需券商净值才能完成预算检查');
 if(!(Number(maxRiskPct)>0))issues.push('账户总风险上限须大于 0');
 for(const c of cases){
  const allocation=c.design?.allocation,models=nebulaRiskModels(c,equity,atr);
  const row={id:c.id,title:c.title,nebulaFraction:null,accountFraction:null,riskRate:null,proposedRisk:null,targetRisk:null,actualRisk:0,actualCapital:0,models,reason:''};rows.push(row);
  if(!allocation?.inAction||!Array.isArray(allocation.items)||!allocation.items.length){row.reason='请先设置 In Action Risk Budget';issues.push(`${c.title}：${row.reason}`);}
  else {
   row.nebulaFraction=sum(allocation.items.map(m=>Number(m.fraction)||0));
   const risks=[allocation.stopRiskRate,allocation.scenarioRiskRate];
   if(allocation.sizingMethod!==SIZING_METHOD||allocation.kellyFraction!==KELLY_FRACTION){row.reason='旧冻结预算：请回 Workflow 重新设为 In Action';issues.push(`${c.title}：${row.reason}`);}
   else if(row.nebulaFraction===0&&allocation.items.every(m=>m.fraction===0)){row.riskRate=0;row.proposedRisk=0;}
   else if(!nonnegative(allocation.allocatedFraction)||Math.abs(row.nebulaFraction-allocation.allocatedFraction)>1e-7||!risks.every(nonnegative)||models.length!==allocation.items.length||models.some(m=>!nonnegative(m.targetFraction)||m.targetFraction>0&&(!(m.referenceCapital>0)||!m.riskBasis?.legs?.length||!states.every(s=>finite(m.scenarioReturns?.[s]))))){row.reason='冻结风险数据不完整';issues.push(`${c.title}：${row.reason}`);}
   else {row.riskRate=Math.max(...risks);row.proposedRisk=row.nebulaFraction*row.riskRate*equity;}
  }
  for(const m of models){const list=modelsBySymbol.get(m.underlying)||[];list.push(m);modelsBySymbol.set(m.underlying,list);}
 }
 const groups=new Map(),other=[],conflicted=new Set();
 for(const p of positions){
  if(!finite(p.qty)){actualIssues.push(`${p.sym||'持仓'}：数量缺失`);issues.push(`${p.sym||'持仓'}：数量缺失，无法预留风险与资本`);const symbol=parseInstrument(p)?.underlying||String(p.sym||'').split(/\s+/)[0];for(const m of modelsBySymbol.get(symbol)||[])conflicted.add(m.caseId);continue;}
  if(Number(p.qty)===0)continue;
  const ins=parseInstrument(p),underlying=ins?.underlying||String(p.sym||'').split(/\s+/)[0],models=modelsBySymbol.get(underlying)||[],owners=[...new Set(models.map(m=>m.caseId))];
  if(owners.length>1){actualIssues.push(`${underlying}：多个 Nebula 重复归属`);issues.push(`${underlying}：多个 Nebula 重复归属`);for(const id of owners)conflicted.add(id);continue;}
  if(owners.length===1){const key=JSON.stringify([owners[0],underlying]),group=groups.get(key)||{caseId:owners[0],models,positions:[]};group.positions.push(p);groups.set(key,group);}
  else other.push(p);
 }
 const actualParts=new Map(rows.map(r=>[r.id,{risk:0,unknown:conflicted.has(r.id)}]));
 for(const group of groups.values()){
  const part=actualParts.get(group.caseId),row=rows.find(r=>r.id===group.caseId);
  for(const p of group.positions.filter(isHeatmapPosition)){const mv=heatmapMarketValue(p);if(mv==null){part.unknown=true;actualIssues.push(`${p.sym}：市值缺失`);}else row.actualCapital+=mv;}
  const {risk,knownRisk}=actualGroupRisk(group.models,group.positions);part.risk+=knownRisk;
  if(risk==null){part.unknown=true;actualIssues.push(`${group.models[0].underlying}：缺少 Bear 收益或持仓市值，无法汇总热力图在险`);continue;}
 }
 for(const row of rows){const part=actualParts.get(row.id);row.actualRisk=part.unknown?null:part.risk;}
 let otherRisk=0,otherCapital=0,otherUnknown=false;
 for(const p of other){
  const mv=finite(p.mkt_value)?Math.abs(Number(p.mkt_value)):finite(p.price)?Math.abs(Number(p.qty)*Number(p.price)):null;
  if(mv==null){otherUnknown=true;actualIssues.push(`${p.sym}：市值缺失`);}else otherCapital+=mv;
  const ins=parseInstrument(p),price=Number(p.price),manual=stops[p.sym];
  if(ins?.type!=='stock'||!finite(p.price)||price<0){otherUnknown=true;actualIssues.push(`${p.sym}：其他持仓缺少可计算风险，期权需归入完整 Bundle`);continue;}
  let distance;
  if(finite(manual)&&Number(manual)>=0)distance=Math.max(0,Number(p.qty)>0?price-Number(manual):Number(manual)-price);
  else if(Number(atr[ins.underlying])>0)distance=2.5*Number(atr[ins.underlying]);
  else {otherUnknown=true;actualIssues.push(`${p.sym}：缺少止损及 ATR`);continue;}
  otherRisk+=Math.abs(Number(p.qty))*distance;
 }
 const knownActualRisk=sum([...actualParts.values()].map(part=>part.risk))+otherRisk;
 const actualRisk=actualIssues.length?null:knownActualRisk;
 if(otherUnknown)issues.push('其他持仓风险不完整，无法保留其预算');
 const totalBudget=equityReliable&&equity>0&&maxRiskPct>0?equity*maxRiskPct/100:null;
 if(!otherUnknown&&totalBudget!=null&&otherRisk>totalBudget+1e-8)issues.push('其他持仓已超过账户总风险预算，需先调整其他持仓');
 if(otherCapital>equity+1e-8)issues.push('其他持仓资本超过账户净值，无法生成无杠杆目标');
 const proposedRisk=equityReliable&&rows.every(r=>r.proposedRisk!=null)?sum(rows.map(r=>r.proposedRisk)):null;
 // Active ownership conflicts are checked even for assets not currently held.
 for(const [symbol,models]of modelsBySymbol)if(new Set(models.map(m=>m.caseId)).size>1)issues.push(`${symbol}：多个 Nebula 重复归属`);
 const valid=issues.length===0,availableRisk=valid?Math.max(0,totalBudget-otherRisk):null;
 const proposedCapital=sum(rows.map(r=>(r.nebulaFraction||0)*equity));
 const scale=valid?Math.min(1,proposedRisk>0?availableRisk/proposedRisk:1,proposedCapital>0?Math.max(0,equity-otherCapital)/proposedCapital:1):null;
 for(const row of rows){
  row.accountFraction=scale==null?null:row.nebulaFraction*scale;row.targetRisk=scale==null?null:row.proposedRisk*scale;
  if(scale!=null)row.reason=scale<1?`账户预算／可用资本缩放至 ${(scale*100).toFixed(1)}%`:'无需缩放';
  row.models=row.models.map(m=>({...m,accountFraction:scale==null||m.targetFraction==null?null:m.targetFraction*scale,accountCapital:scale==null||m.targetCapital==null?null:m.targetCapital*scale}));
 }
 return {valid,issues:[...new Set(issues)],actualIssues:[...new Set(actualIssues)],equity,totalBudget,actualRisk,knownActualRisk,actualRemaining:actualRisk==null||totalBudget==null?null:totalBudget-actualRisk,otherRisk:otherUnknown?null:otherRisk,otherCapital,proposedRisk:proposedRisk==null||otherUnknown?null:proposedRisk+otherRisk,targetRisk:scale==null?null:proposedRisk*scale+otherRisk,scale,rows,cashFraction:scale==null?null:Math.max(0,1-(otherCapital+proposedCapital*scale)/equity)};
}
