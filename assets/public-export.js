import {dashboardStorage as localStorage} from './dashboard-data.mjs?v=20261028-manual-versions';
import {getPat,ghHeaders} from './shared.js?v=20261028-manual-versions';
const KEY='research-desk.workflow.v1';
const PUBLIC_URL='https://api.github.com/repos/takkujunjieli/noetic-dashboard/contents/data/public-dashboard.json';
let timer=null,pending=null,running=false;
export async function exportPublicSnapshot(workflow,fetcher=fetch){
 const response=await fetcher('/api/public-dashboard/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(workflow?{workflow}:{})});
 const body=await response.json();if(!response.ok)throw Error(body.error||'公开快照生成失败');
 if(body.snapshot?.schema!=='public-dashboard'||body.snapshot.version!==2||body.snapshot.basis?.netEquity!==100000)throw Error('公开快照缺少 Takku 100k 校验');
 return body.snapshot;
}
export function queuePublicExport(workflow){
 pending=workflow;clearTimeout(timer);
 timer=setTimeout(async()=>{
  if(running)return;
  running=true;
  try{while(pending){const captured=pending;pending=null;await exportPublicSnapshot(captured);}}
  catch(error){console.warn('公开快照尚未更新：'+error.message);}
  finally{running=false;}
 },400);
}
export async function syncPublicSnapshot(workflow,fetcher=fetch){
 const pat=getPat();if(!pat)throw Error('未设置公开库同步 PAT');
 const snapshot=await exportPublicSnapshot(workflow,fetcher),headers=ghHeaders(pat);
 const meta=await fetcher(PUBLIC_URL+'?ref=main',{headers,cache:'no-store'});let sha;
 if(meta.ok)sha=(await meta.json()).sha;else if(meta.status!==404)throw Error('公开快照元数据读取失败：HTTP '+meta.status);
 const content=btoa(unescape(encodeURIComponent(JSON.stringify(snapshot)+'\n')));
 const response=await fetcher(PUBLIC_URL,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({message:'Update public Workflow and Takku 100k portfolio',branch:'main',sha,content})});
 if(!response.ok)throw Error('公开快照同步失败：HTTP '+response.status);
}
export function mountPublicExport({english=false,placement='auto'}={}){
 if(document.getElementById('public-export-controls'))return;
 let footer=document.querySelector('footer');
 if(!footer&&placement==='footer'){
  footer=document.createElement('footer');footer.className='muted small';document.body.append(footer);
 }
 const host=footer?document.createElement('div'):(document.querySelector('header .toolbar')||document.querySelector('header'));
 if(!host)return;
 if(footer){host.style.cssText='display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;margin-top:8px';footer.append(host);}
 const controls=document.createElement('span');controls.id='public-export-controls';host.append(controls);
 const button=document.createElement('button');button.textContent=english?'Update Public Snapshot':'更新公开快照';button.type='button';
 const preview=document.createElement('a');preview.textContent=english?'Preview Public View':'预览公开版';const url=new URL(location.href);url.searchParams.set('view','public');preview.href=url.href;
 const status=document.createElement('span');status.setAttribute('role','status');controls.append(button,document.createTextNode('｜'),preview,status);
 const capture=()=>{const entries={};for(const key of [KEY,'riskPolicy','riskGroups','riskMaxHeat','riskStops','riskTargets','portfolioExitRules','completedTheses','thesisEvents']){const value=localStorage.getItem(key);if(value)entries[key]=JSON.parse(value);}return entries[KEY]?{version:1,entries}:null;};
 button.onclick=async()=>{button.disabled=true;try{await exportPublicSnapshot(capture());status.textContent='公开快照已更新；同步全部可发布。';}catch(error){status.textContent='未更新：'+error.message;}finally{button.disabled=false;}};
 // Public exports are explicitly requested; opening a page does not save a snapshot.
}
