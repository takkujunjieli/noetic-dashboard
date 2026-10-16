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

// Portfolio heatmap ownership is a view-only grouping. It never receives or
// returns a Workflow object, so changing it cannot rewrite frozen bundles or
// an In Action Risk Budget.
export function setHeatmapAssignment(groups,symbol,thesis){
 const next={...(groups&&typeof groups==='object'&&!Array.isArray(groups)?groups:{})};
 const key=String(symbol||'').trim().toUpperCase();
 if(!key)throw Error('热力图标的无效');
 if(thesis)next[key]=String(thesis);else delete next[key];
 return next;
}

export function nebulaRiskModels(c,accountCapital,atrByUnderlying={}){
 const allocation=c.design?.allocation,weighted=allocation?.inAction&&['risk-budget-kelly','multivariate-kelly','monte-carlo-kelly'].includes(allocation.method),matrix=greekScenarioMatrix(c.nodes.returns.data,c.design?.plans||[]),bear=matrix.rows.find(row=>row.id==='bear');
 const bull=c.nodes.returns.data?.scenarios?.find(row=>row.id==='bull');
 const byId=new Map((weighted?allocation.items:[]).map(row=>[row.bundleId,row]));
 return (c.design?.plans||[]).map((bundle,index)=>{
  const metrics=bundleMetrics(bundle.construction),target=byId.get(bundle.id),cell=bear?.cells[index];
  const bullPriceMove=Number(bull?.moves?.[bundle.id]?.priceMove);
  const targetFraction=target?.fraction??null;
  return {caseId:c.id,title:c.title,underlying:metrics.underlying,running:c.nodes.risk.state==='running',targetFraction,targetCapital:targetFraction==null||!(Number(accountCapital)>0)?null:targetFraction*Number(accountCapital),kellyWeight:target?.weight??null,bullPriceMove:Number.isFinite(bullPriceMove)?bullPriceMove:null,bearReturn:cell?.returnRate==null?null:cell.returnRate/100,constraintIssue:weighted?'':'请先设置 In Action Risk Budget'};
 }).filter(x=>x.underlying);
}
