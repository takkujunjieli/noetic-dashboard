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
export function captureWorkflow(storage=localStorage){const entries={};for(const key of SYNC_KEYS){const raw=storage.getItem(key);if(raw==null)continue;if(!raw.trim()){if(key===KEY)throw Error('本地 Workflow 数据为空，请刷新页面后重试');continue;}try{entries[key]=JSON.parse(raw);}catch{throw Error(`本地同步数据 ${key} 不是有效 JSON，请修复或清除该项后重试`);}}if(entries[KEY])validateStore(entries[KEY]);return {version:1,entries};}
async function responseJSON(response,label){
 try{
  if(typeof response.text==='function'){const body=await response.text();if(!body.trim())throw Error(`${label}返回空响应`);return JSON.parse(body);}
  return await response.json();
 }catch(error){if(String(error?.message||error).startsWith(label))throw error;throw Error(`${label}返回的不是有效 JSON`);}
}
function decodeRemoteContent(remote){
 if(!remote||typeof remote.sha!=='string')throw Error('GitHub Workflow 元数据缺少 SHA');
 if(typeof remote.content!=='string')throw Error('GitHub Workflow 元数据缺少文件内容');
 if(!remote.content.replace(/\s/g,''))return null;
 try{return JSON.parse(decodeURIComponent(escape(atob(remote.content.replace(/\s/g,'')))));}catch{throw Error('远端 workflow.json 不是有效 JSON，请检查私有仓库文件');}
}
export async function syncWorkflowSnapshot(payload){
 const pat=getPat();if(!pat)throw Error('未设置 PAT');
 const response=await fetch(URL+'?ref=main',{headers:ghHeaders(pat),cache:'no-store'});let sha;
 if(response.ok){const remote=await responseJSON(response,'读取 GitHub Workflow 时');sha=remote.sha;const content=decodeRemoteContent(remote);
  if(content!==null&&JSON.stringify(content)!==JSON.stringify(payload)&&localStorage.getItem(KEY+'.remote-sha')!==sha)throw Error('远端 Workflow 已存在其他更新，已停止覆盖；请先核对远端版本');
  if(content!==null&&JSON.stringify(content)===JSON.stringify(payload)){localStorage.setItem(KEY+'.remote-sha',sha);return;}
 }else if(response.status!==404)throw Error('无法读取远端 Workflow：HTTP '+response.status);
 const r=await fetch(URL,{method:'PUT',headers:ghHeaders(pat),body:JSON.stringify({message:'chore: sync Galaxy workflows and local settings',branch:'main',sha,content:btoa(unescape(encodeURIComponent(JSON.stringify(payload,null,2)+'\n')))})});
 if(!r.ok)throw Error('Workflow 同步失败：HTTP '+r.status+(r.status===409?'（远端发生变化，请核对后重试）':''));
 const result=await responseJSON(r,'写入 GitHub Workflow 时');if(typeof result?.content?.sha!=='string')throw Error('写入 GitHub Workflow 后未返回文件 SHA');localStorage.setItem(KEY+'.remote-sha',result.content.sha);
}
