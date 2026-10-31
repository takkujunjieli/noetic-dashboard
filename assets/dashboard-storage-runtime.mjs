import {createWorkflowDatabase,CATALOG} from './workflow-database.mjs?v=20261028-manual-versions';
import {workflowStorageGet,workflowStorageSet} from './workflow-storage.mjs?v=20261028-storage-v2';
// Public views use isolated memory, never private browser settings or credentials.
const KEY='research-desk.workflow.v1';
let published=null;
const database=createWorkflowDatabase();
const privateMemory=new Map();
let channel=null;
export async function initializeWorkflowDatabase(){
 if(published||database.active)return;
 const legacy=workflowStorageGet(globalThis.localStorage,KEY);
 await database.initialize(legacy?JSON.parse(legacy):null);
 // The durable database commit must succeed before deleting the obsolete cache.
 globalThis.localStorage?.removeItem(KEY);globalThis.localStorage?.removeItem(CATALOG);
 if(typeof BroadcastChannel!=='undefined'&&typeof window!=='undefined'){
  channel=new BroadcastChannel('research-desk.workflow.database');
  channel.onmessage=async()=>{try{await database.refresh();window.dispatchEvent(new StorageEvent('storage',{key:KEY}));}catch(error){console.error(error);}};
 }
}

const memory=new Map();
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
export const isPublicDashboard=()=>published!==null;
export function configurePublicDashboard(snapshot){
 if(snapshot?.schema!=='public-dashboard'||snapshot.version!==2||snapshot.basis?.netEquity!==100000)throw Error('公开快照格式无效');
 const accounts=snapshot.files?.['data/portfolio.json']?.accounts;
 if(accounts?.length!==1||accounts[0].id!=='takku-rh-2566'||accounts[0].equity!==100000)throw Error('公开 Portfolio 必须是 Takku / 100k');
 published=clone(snapshot);memory.clear();
 for(const [key,value] of Object.entries(snapshot.workflow.settings||{}))memory.set(key,JSON.stringify(value));
 memory.set(KEY,JSON.stringify(snapshot.workflow.store));
}
export const dashboardStorage={
 getItem(key){if(!published&&database.active){if(key===KEY)return database.raw;if(key===CATALOG)return privateMemory.get(key)??null;}return published?memory.get(key)??null:workflowStorageGet(globalThis.localStorage,key);},
 setItem(key,value){
  if(!published&&database.active){if(key===KEY)throw Error('Workflow 已迁移到数据库，请使用保存接口');if(key===CATALOG){privateMemory.set(key,String(value));return;}}
  if(published){
   if(key==='riskPolicy'){const policy=JSON.parse(value);policy.account_equity=100000;value=JSON.stringify(policy);}
   memory.set(key,String(value));
  }else workflowStorageSet(globalThis.localStorage,key,String(value));
 },
 async saveWorkflow(raw,expectedRaw=database.raw,version){
  if(published)throw Error('公开页面只读');
  if(!database.active)throw Error('Workflow 数据库未连接');
  await database.save(raw,expectedRaw,version);channel?.postMessage('updated');return database.raw;
 },
 get databaseActive(){return !published&&database.active;},
 removeItem(key){if(!published&&database.active&&[KEY,CATALOG].includes(key)){if(key===KEY)throw Error('Workflow 当前数据由数据库管理');privateMemory.delete(key);return;}if(published)memory.delete(key);else globalThis.localStorage?.removeItem(key);},
 clear(){if(published)memory.clear();else globalThis.localStorage?.clear();},
};
export function publicJSON(path){
 const name=String(path).split('?')[0].replace(/^\.\//,'').replace(/^\//,'');
 if(published&&Object.hasOwn(published.files,name))return {handled:true,value:clone(published.files[name])};
 if(published&&(/^(?:data|config)\/(?:_.*_raw|portfolio(?:_history)?|pnl|monthly_returns|robustness|trade_journal|rh_networth|risk_policy|completed_theses|thesis_events|transaction_history)\.json$/.test(name)))return {handled:true,value:null};
 return {handled:false};
}
export async function dashboardFetch(input,options={}){
 const path=String(input).split('?')[0];
 if(!published||!path.startsWith('/api/'))return fetch(input,options);
 const method=(options.method||'GET').toUpperCase();
 if(method!=='GET')return new Response(JSON.stringify({error:'公开页面只读'}),{status:403,headers:{'Content-Type':'application/json'}});
 const body=published.api[path]??(path.startsWith('/api/thesis-transactions/')?{file:null,path:''}:null);
 return new Response(JSON.stringify(body??{error:'公开快照中没有此数据'}),{status:body===null?404:200,headers:{'Content-Type':'application/json'}});
}
