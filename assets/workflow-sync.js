import {KEY,validateStore} from './workflow-model.mjs';
import {getPat,ghHeaders} from './shared.js';
const URL='https://api.github.com/repos/takkujunjieli/stock-dashboard-private/contents/workflow.json';
export const UNSYNCED_KEY=KEY+'.unsynced-nebulae';
export const SYNC_KEYS=[KEY,'riskPolicy','riskGroups','riskMaxHeat','riskStops','riskTargets','completedTheses','thesisEvents'];
export function readUnsyncedNebulae(storage=localStorage){try{const value=JSON.parse(storage.getItem(UNSYNCED_KEY)||'[]');return new Set(Array.isArray(value)?value.filter(id=>typeof id==='string'):[]);}catch{return new Set();}}
export function writeUnsyncedNebulae(ids,storage=localStorage){storage.setItem(UNSYNCED_KEY,JSON.stringify([...ids]));}
export function remainingUnsyncedNebulae(ids,currentStore,payload){
 const sent=payload?.entries?.[KEY]?.cases||[],current=currentStore?.cases||[];
 return new Set([...ids].filter(id=>{const live=current.find(c=>c.id===id),captured=sent.find(c=>c.id===id);return !!live&&(!captured||JSON.stringify(live)!==JSON.stringify(captured));}));
}
export function captureWorkflow(storage=localStorage){const entries={};for(const key of SYNC_KEYS){const raw=storage.getItem(key);if(raw!=null)entries[key]=JSON.parse(raw);}if(entries[KEY])validateStore(entries[KEY]);return {version:1,entries};}
export async function syncWorkflowSnapshot(payload){
 const pat=getPat();if(!pat)throw Error('未设置 PAT');
 const response=await fetch(URL+'?ref=main',{headers:ghHeaders(pat),cache:'no-store'});let sha;
 if(response.ok){const remote=await response.json();sha=remote.sha;const content=JSON.parse(decodeURIComponent(escape(atob(remote.content.replace(/\s/g,'')))));
  if(JSON.stringify(content)!==JSON.stringify(payload)&&localStorage.getItem(KEY+'.remote-sha')!==sha)throw Error('远端 Workflow 已存在其他更新，已停止覆盖；请先核对远端版本');
  if(JSON.stringify(content)===JSON.stringify(payload)){localStorage.setItem(KEY+'.remote-sha',sha);return;}
 }else if(response.status!==404)throw Error('无法读取远端 Workflow：HTTP '+response.status);
 const r=await fetch(URL,{method:'PUT',headers:ghHeaders(pat),body:JSON.stringify({message:'chore: sync Galaxy workflows and local settings',branch:'main',sha,content:btoa(unescape(encodeURIComponent(JSON.stringify(payload,null,2)+'\n')))})});
 if(!r.ok)throw Error('Workflow 同步失败：HTTP '+r.status+(r.status===409?'（远端发生变化，请核对后重试）':''));
 const result=await r.json();localStorage.setItem(KEY+'.remote-sha',result.content.sha);
}
