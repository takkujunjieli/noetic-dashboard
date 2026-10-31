import {dashboardStorage as localStorage} from './dashboard-data.mjs?v=20261028-manual-versions';
import {KEY,validateStore,record} from './workflow-model.mjs?v=20261028-manual-versions';
import {workflowAssignmentCases,workflowOwnershipIndex,workflowHasBudgetUnderlying} from './workflow-ownership.mjs?v=20261028-manual-versions';
import {refreshActiveNebulaCatalog,readUnsyncedNebulae,writeUnsyncedNebulae} from './workflow-sync.js?v=20261028-manual-versions';

// Commit the early ownership directly into the Workflow, including history and
// the existing sync marker. No second Portfolio-only assignment is created.
export function savePortfolioWorkflowOwner(symbol,caseId,storage=localStorage){
 symbol=String(symbol||'').trim().toUpperCase();
 if(!/^[A-Z0-9.\-]{1,24}$/.test(symbol))throw Error('标的代码无效');
 const raw=storage.getItem(KEY);
 if(!raw)throw Error('请先在 Workflow 创建并激活 Thesis');
 const store=validateStore(JSON.parse(raw)),cases=workflowAssignmentCases(store.cases);
 const target=caseId?cases.find(c=>c.id===caseId):null;
 if(caseId&&!target)throw Error('所选 Thesis 已离线或归档，请刷新后重试');
 const owners=workflowOwnershipIndex(cases).get(symbol)||[];
 if(owners.some(c=>workflowHasBudgetUnderlying(c,symbol)))throw Error('此标的已进入 In Action 配置，请在 Workflow 中修改归属');
 const changed=[];
 for(const c of cases){
  const previous=c.portfolioUnderlyings||[],next=previous.filter(s=>s!==symbol);
  if(c.id===target?.id)next.push(symbol);
  next.sort();
  if(JSON.stringify([...previous].sort())===JSON.stringify(next))continue;
  c.portfolioUnderlyings=next;
  record(c,c.id===target?.id?'指定持仓归属':'解除持仓归属','construction',`${symbol} · 来自 Portfolio Thesis 选择`);
  changed.push(c.id);
 }
 if(!changed.length)return;
 validateStore(store);
 if(storage.getItem(KEY)!==raw)throw Error('Workflow 已被其他页面更新，请刷新后重试');
 const finish=()=>{refreshActiveNebulaCatalog(store,storage);const unsynced=readUnsyncedNebulae(storage);for(const id of changed)unsynced.add(id);writeUnsyncedNebulae(unsynced,storage);};
 if(storage.databaseActive)return storage.saveWorkflow(JSON.stringify(store),raw).then(finish);
 storage.setItem(KEY,JSON.stringify(store));finish();
}
