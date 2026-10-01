import {kellyAllocation} from './kelly-allocation.mjs?v=20260930-3';
import {greekScenarioMatrix} from './expected-return.mjs?v=20260929-2';
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

export function nebulaRiskModels(c,accountCapital,atrByUnderlying={}){
 const allocation=kellyAllocation(c,c.nodes.risk.data,accountCapital,atrByUnderlying),matrix=greekScenarioMatrix(c.nodes.returns.data,c.design?.plans||[]),bear=matrix.rows.find(row=>row.id==='bear');
 const bull=c.nodes.returns.data?.scenarios?.find(row=>row.id==='bull');
 const quantile=[25,50,100].includes(Number(c.nodes.risk.data?.targetQuantile))?Number(c.nodes.risk.data.targetQuantile):25;
 const byId=new Map(allocation.bundles.map(row=>[row.bundleId,row]));
 return (c.design?.plans||[]).map((bundle,index)=>{
  const metrics=bundleMetrics(bundle.construction),target=byId.get(bundle.id),cell=bear?.cells[index];
  const bullPriceMove=Number(bull?.moves?.[bundle.id]?.priceMove);
  return {caseId:c.id,title:c.title,underlying:metrics.underlying,quantile,running:c.nodes.risk.state==='running',targetFraction:allocation.constraintIssue?null:target?.fraction??null,targetCapital:allocation.constraintIssue?null:target?.targetCapital??null,bullPriceMove:Number.isFinite(bullPriceMove)?bullPriceMove:null,bearReturn:cell?.returnRate==null?null:cell.returnRate/100,constraintIssue:allocation.constraintIssue||''};
 }).filter(x=>x.underlying);
}
