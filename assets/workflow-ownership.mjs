import {dashboardStorage as localStorage} from './dashboard-data.mjs?v=20261028-manual-versions';
import {thesisUnderlyings} from './attribution-transactions.mjs';

export const WORKFLOW_STORE_KEY='research-desk.workflow.v1';
const CATALOG_KEY='research-desk.workflow.active-nebulae.v1';

export const workflowAssignmentCases=(cases=[])=>cases.filter(c=>c.activeThesis&&!c.archived&&!c.demo);

export function workflowCaseUnderlyings(c){
 let budget=[];try{budget=thesisUnderlyings(c);}catch{}
 return [...new Set([...budget,...(c.portfolioUnderlyings||[])])].sort();
}

export function workflowHasBudgetUnderlying(c,symbol){
 try{return thesisUnderlyings(c).includes(symbol);}catch{return false;}
}

// Early Portfolio assignments live inside the Workflow itself. In Action
// membership remains authoritative; zero target weights still retain ownership.
export function workflowOwnershipCases(cases=[]){
 return workflowAssignmentCases(cases).filter(c=>workflowCaseUnderlyings(c).length>0);
}

export function readWorkflowAssignmentCases(storage=localStorage){
 try{
  const raw=storage.getItem(WORKFLOW_STORE_KEY);
  // The main store wins even when empty. Never resurrect stale catalog owners.
  const value=JSON.parse(raw==null?(storage.getItem(CATALOG_KEY)||'null'):raw);
  return value?.version===1&&Array.isArray(value.cases)?workflowAssignmentCases(value.cases):[];
 }catch{return [];}
}

export const readWorkflowOwnershipCases=(storage=localStorage)=>workflowOwnershipCases(readWorkflowAssignmentCases(storage));

export function workflowOwnershipIndex(cases=[]){
 const index=new Map(),eligible=workflowOwnershipCases(cases),budgetSymbols=new Set();
 const add=(symbol,c)=>{
  const owners=index.get(symbol)||[];
  if(!owners.some(owner=>owner.id===c.id))owners.push(c);
  index.set(symbol,owners);
 };
 for(const c of eligible){
  let symbols=[];try{symbols=thesisUnderlyings(c);}catch{}
  for(const symbol of symbols){budgetSymbols.add(symbol);add(symbol,c);}
 }
 for(const c of eligible)for(const symbol of c.portfolioUnderlyings||[])if(!budgetSymbols.has(symbol))add(symbol,c);
 return index;
}
