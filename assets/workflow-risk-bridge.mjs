import {dashboardStorage as localStorage} from './dashboard-data.mjs?v=20261028-manual-versions';
import {greekScenarioMatrix} from './expected-return.mjs?v=20261028-deadline';
import {bundleMetrics} from './trade-structure.mjs';

export const ACTIVE_NEBULAE_KEY='research-desk.workflow.active-nebulae.v1';
const weightedAllocation=allocation=>allocation?.inAction&&['risk-budget-kelly','multivariate-kelly','monte-carlo-kelly'].includes(allocation.method);
const numberOrNull=value=>value!==''&&value!=null&&Number.isFinite(Number(value))?Number(value):null;

function frozenAllocation(c){
 const allocation=c.design?.allocation;
 if(!weightedAllocation(allocation))return allocation;
 const fields=['referencePrice','bullPriceMove','bearReturn'];
 if(allocation.items.every(item=>fields.every(field=>numberOrNull(item[field])!=null)))return allocation;
 // Legacy budgets did not persist these inputs on each allocation item. Only
 // the matching activation event can supply them; live Construction/Scenario
 // edits must never become part of an older frozen budget.
 const snapshot=allocation.at?(c.events||[]).find(event=>
  event.node==='risk'&&/^设置 In Action (Risk Budget|Kelly Allocation|Allocation)$/.test(event.type)&&
  event.snapshot?.design?.allocation?.inAction&&event.snapshot.design.allocation.at===allocation.at&&
  event.snapshot.design.allocation.method===allocation.method)?.snapshot:null;
 const plans=snapshot?.design?.plans||[],returns=snapshot?.nodes?.returns?.data||{};
 const bear=snapshot?greekScenarioMatrix(returns,plans).rows.find(row=>row.id==='bear'):null;
 const bull=returns.scenarios?.find(row=>row.id==='bull');
 return {...allocation,items:allocation.items.map(item=>{
  const index=plans.findIndex(plan=>plan.id===item.bundleId),plan=plans[index];
  const original=snapshot?.design?.allocation?.items?.find(row=>row.bundleId===item.bundleId);
  const referencePrice=numberOrNull(item.referencePrice)??numberOrNull(original?.referencePrice)??(plan?numberOrNull(bundleMetrics(plan.construction).referenceSpot):null);
  const bullPriceMove=numberOrNull(item.bullPriceMove)??numberOrNull(original?.bullPriceMove)??(plan?numberOrNull(bull?.moves?.[item.bundleId]?.priceMove):null);
  const returnRate=numberOrNull(bear?.cells[index]?.returnRate);
  const bearReturn=numberOrNull(item.bearReturn)??numberOrNull(original?.bearReturn)??(returnRate==null?null:returnRate/100);
  return {...item,referencePrice,bullPriceMove,bearReturn};
 })};
}

export function activeNebulaCatalog(store,updatedAt=new Date().toISOString()){
 // This catalog is a cross-page projection, not a second Workflow store.
 // Event snapshots are intentionally excluded because each snapshot can contain
 // the complete thesis and would duplicate the main localStorage entry many times.
 const cases=(store?.cases||[]).filter(c=>c.activeThesis&&!c.archived).map(c=>JSON.parse(JSON.stringify({
  id:c.id,title:c.title,horizon:c.horizon||'',activeThesis:true,archived:false,demo:!!c.demo,
  portfolioUnderlyings:c.portfolioUnderlyings||[],
  nodes:{returns:c.nodes?.returns||{state:'pending',data:{}},risk:c.nodes?.risk||{state:'pending',data:{}}},
  design:{plans:c.design?.plans||[],allocation:frozenAllocation(c)}
 })));
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
 const allocation=frozenAllocation(c),weighted=weightedAllocation(allocation),matrix=weighted?null:greekScenarioMatrix(c.nodes.returns.data,c.design?.plans||[]),bear=matrix?.rows.find(row=>row.id==='bear');
 const bull=c.nodes.returns.data?.scenarios?.find(row=>row.id==='bull');
 const byId=new Map((weighted?allocation.items:[]).map(row=>[row.bundleId,row]));
 return (c.design?.plans||[]).map((bundle,index)=>{
  const metrics=bundleMetrics(bundle.construction),target=byId.get(bundle.id),cell=bear?.cells[index];
  const bullPriceMove=numberOrNull(weighted?target?.bullPriceMove:bull?.moves?.[bundle.id]?.priceMove);
  const bearReturn=weighted?numberOrNull(target?.bearReturn):cell?.returnRate==null?null:cell.returnRate/100;
  const targetFraction=target?.fraction??null;
  // Legacy allocations stored one stopPrice. Current Risk Budget snapshots
  // preserve both directions and name the independently adverse one.
  const storedStop=target?.stopPrice??target?.adverseStopPrice??(target?.adverseStopDirection==='up'?target?.upStopPrice:target?.adverseStopDirection==='down'?target?.downStopPrice:null);
  const stopPrice=storedStop===''||storedStop==null?null:Number(storedStop);
  const referencePrice=numberOrNull(weighted?target?.referencePrice:metrics.referenceSpot);
  return {caseId:c.id,bundleId:bundle.id,title:c.title,underlying:target?.underlying||metrics.underlying,running:c.nodes.risk.state==='running',targetFraction,targetCapital:targetFraction==null||!(Number(accountCapital)>0)?null:targetFraction*Number(accountCapital),kellyWeight:target?.weight??null,excluded:target?.eligible===false,exclusionReason:target?.eligible===false?target.exclusionReason||'该 Bundle 已从风险分配中排除':'',bullPriceMove:Number.isFinite(bullPriceMove)?bullPriceMove:null,bearReturn:Number.isFinite(bearReturn)?bearReturn:null,referencePrice:Number.isFinite(referencePrice)&&referencePrice>0?referencePrice:null,referenceCapital:numberOrNull(target?.referenceCapital),riskBasis:target?.riskBasis??null,scenarioReturns:target?.scenarioReturns??null,stopRiskRate:numberOrNull(target?.stopRiskRate),referenceAt:allocation?.at||null,stopPrice:Number.isFinite(stopPrice)?stopPrice:null,stopAt:allocation?.at||null,constraintIssue:weighted?'':'请先设置 In Action Risk Budget'};
 }).filter(x=>x.underlying);
}
