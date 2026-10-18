import {greekScenarioMatrix} from './expected-return.mjs?v=20261015-1';
import {bundleMetrics} from './trade-structure.mjs';

export const ACTIVE_NEBULAE_KEY='research-desk.workflow.active-nebulae.v1';

export function activeNebulaCatalog(store,updatedAt=new Date().toISOString()){
 const cases=(store?.cases||[]).filter(c=>c.activeThesis&&!c.archived).map(c=>JSON.parse(JSON.stringify(c)));
 return {version:1,updatedAt,cases};
}

export function readActiveNebulaCatalog(storage=localStorage){
 try{const value=JSON.parse(storage.getItem(ACTIVE_NEBULAE_KEY)||'null');return value?.version===1&&Array.isArray(value.cases)?value:{version:1,updatedAt:'',cases:[]};}
 catch{return {version:1,updatedAt:'',cases:[]};}
}

// Legacy assignment compatibility helpers. Live Portfolio ownership is now
// derived by workflow-ownership.mjs, never from these manual assignments.
// The old heatmap ownership is a view-only grouping. It never receives or
// returns a Workflow object, so changing it cannot rewrite frozen bundles or
// an In Action Risk Budget.
export function setHeatmapAssignment(groups,symbol,thesis){
 const next={...(groups&&typeof groups==='object'&&!Array.isArray(groups)?groups:{})};
 const key=String(symbol||'').trim().toUpperCase();
 if(!key)throw Error('热力图标的无效');
 if(thesis)next[key]=String(thesis);else delete next[key];
 return next;
}

// File assignments are the durable baseline. Browser overrides can replace an
// assignment or explicitly clear it with null; stale/non-active thesis names
// are ignored so the heatmap cannot silently bind to an archived workflow.
export function effectiveHeatmapAssignments(fileAssignments={},overrides={},validTitles=[]){
 const valid=new Set(validTitles),next={};
 for(const [symbol,title] of Object.entries(fileAssignments||{}))if(valid.has(title))next[symbol]=title;
 for(const [symbol,title] of Object.entries(overrides||{})){
  if(title&&valid.has(title))next[symbol]=title;else delete next[symbol];
 }
 return next;
}

export function nebulaRiskModels(c,accountCapital,atrByUnderlying={}){
 const allocation=c.design?.allocation,weighted=allocation?.inAction&&['risk-budget-kelly','multivariate-kelly','monte-carlo-kelly'].includes(allocation.method),matrix=greekScenarioMatrix(c.nodes.returns.data,c.design?.plans||[]),bear=matrix.rows.find(row=>row.id==='bear');
 const bull=c.nodes.returns.data?.scenarios?.find(row=>row.id==='bull');
 const byId=new Map((weighted?allocation.items:[]).map(row=>[row.bundleId,row]));
 return (c.design?.plans||[]).map((bundle,index)=>{
  const metrics=bundleMetrics(bundle.construction),target=byId.get(bundle.id),cell=bear?.cells[index];
  const bullPriceMove=Number(target?.bullPriceMove??bull?.moves?.[bundle.id]?.priceMove);
  const bearReturn=target?.bearReturn==null?cell?.returnRate==null?null:cell.returnRate/100:Number(target.bearReturn);
  const targetFraction=target?.fraction??null;
  // Legacy allocations stored one stopPrice. Current Risk Budget snapshots
  // preserve both directions and name the independently adverse one.
  const storedStop=target?.stopPrice??target?.adverseStopPrice??(target?.adverseStopDirection==='up'?target?.upStopPrice:target?.adverseStopDirection==='down'?target?.downStopPrice:null);
  const stopPrice=storedStop===''||storedStop==null?null:Number(storedStop);
  // New allocations snapshot the Portfolio Construction Reference Spot at the
  // moment Risk Budget becomes In Action. Older records fall back to the
  // already-saved bundle because they predate this explicit snapshot field.
  const referencePrice=Number(target?.referencePrice??metrics.referenceSpot);
  return {caseId:c.id,bundleId:bundle.id,title:c.title,underlying:metrics.underlying,running:c.nodes.risk.state==='running',targetFraction,targetCapital:targetFraction==null||!(Number(accountCapital)>0)?null:targetFraction*Number(accountCapital),kellyWeight:target?.weight??null,excluded:target?.eligible===false,exclusionReason:target?.eligible===false?target.exclusionReason||'该 Bundle 已从风险分配中排除':'',bullPriceMove:Number.isFinite(bullPriceMove)?bullPriceMove:null,bearReturn:Number.isFinite(bearReturn)?bearReturn:null,referencePrice:Number.isFinite(referencePrice)&&referencePrice>0?referencePrice:null,referenceAt:allocation?.at||null,stopPrice:Number.isFinite(stopPrice)?stopPrice:null,stopAt:allocation?.at||null,constraintIssue:weighted?'':'请先设置 In Action Risk Budget'};
 }).filter(x=>x.underlying);
}
