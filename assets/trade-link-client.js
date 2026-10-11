import {KEY,validateStore,record} from './workflow-model.mjs?v=20261010-links';
import {applyExecutionEvent,TRADE_ROLES} from './trade-link-model.mjs';
import {thesisUnderlyings} from './attribution-transactions.mjs';
import {readUnsyncedNebulae,writeUnsyncedNebulae} from './workflow-sync.js?v=20260929-3';
export {TRADE_ROLES};
export function workflowLinkCases(storage=localStorage) {
  const raw=storage.getItem(KEY);
  if (!raw) return [];
  return validateStore(JSON.parse(raw)).cases.filter(c=>!c.archived&&!c.demo).map(c=>{
    let underlyings=[];try{underlyings=thesisUnderlyings(c);}catch{}
    return {id:c.id,title:c.title,revision:c.revision,archived:false,underlyings};
  });
}
export async function readTradeLinks() {
  const response=await fetch('/api/trade-links',{cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'无法读取成交关联');
  return {data,etag:response.headers.get('ETag')};
}
// The private event log is authoritative. Replaying missing events repairs a browser
// crash between the server commit and the local Workflow snapshot write.
export function reconcileTradeLinks(document, storage=localStorage) {
  const raw=storage.getItem(KEY);if(!raw)return false;
  const store=validateStore(JSON.parse(raw));let changed=false;
  for(const event of document.events){
    const c=store.cases.find(c=>c.id===event.link.workflow_case_id);
    if(!c||c.archived)continue;
    if(applyExecutionEvent(c,event)){
      record(c,event.action==='unlink'?'解除成交关联':'关联成交 · '+TRADE_ROLES[event.link.role],'positions',event.link.trade_id+' · '+event.action);
      changed=true;
    }
  }
  if(!changed)return false;
  if(storage.getItem(KEY)!==raw)throw Error('Workflow 已被其他页面更新；关联已保存，请在 Monitor 重新读取');
  storage.setItem(KEY,JSON.stringify(store));
  const ids=readUnsyncedNebulae(storage);
  for(const event of document.events)if(store.cases.some(c=>c.id===event.link.workflow_case_id))ids.add(event.link.workflow_case_id);
  writeUnsyncedNebulae(ids,storage);return true;
}
export async function writeTradeLink(body, state) {
  const fingerprint=JSON.stringify(body);
  if(state.pending?.fingerprint!==fingerprint)state.pending={fingerprint,operation_id:crypto.randomUUID()};
  const operation_id=state.pending.operation_id;
  const headers={'Content-Type':'application/json',...(state.etag?{'If-Match':state.etag}:{'If-None-Match':'*'})};
  const response=await fetch('/api/trade-links',{method:'POST',headers,body:JSON.stringify({...body,operation_id})});
  let data=await response.json(), tag=response.headers.get('ETag');
  if(response.status===409){
    const latest=await readTradeLinks();state.data=latest.data;state.etag=latest.etag;
    if(!latest.data.events.some(event=>event.operation_id===operation_id)){
      state.pending=null;throw Error(data.error||'关联已被其他页面更新');
    }
    data=latest.data;tag=latest.etag;
  }else if(!response.ok){state.pending=null;throw Error(data.error||'保存关联失败');}
  state.data=data;state.etag=tag;
  state.pending=null;
  try{reconcileTradeLinks(data);}catch(error){return {warning:'关联已保存；Workflow 待恢复：'+error.message};}
  return {};
}
