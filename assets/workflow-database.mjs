const KEY='research-desk.workflow.v1';
const CATALOG='research-desk.workflow.active-nebulae.v1';
const copy=value=>JSON.parse(JSON.stringify(value));
export function createWorkflowDatabase(fetcher=fetch){
 let store=null,revision=null,active=false,raw=null;
 const request=async(method,body)=>{const response=await fetcher('/api/workflow',{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(value.error||`Workflow 数据库不可用：HTTP ${response.status}`);return value;};
 const accept=value=>{store=value.store;raw=store?JSON.stringify(store):null;revision=value.revision;active=true;return store;};
 return {
  get active(){return active;},
  get raw(){return raw;},
  async initialize(browserStore){
   const value=await request('GET');
   if(value.store)return accept(value);
   // The browser includes changes not necessarily present in the last GitHub backup.
   const baseline=value.legacyStore||{version:1,cases:[]};
   // A present browser store is authoritative, including intentional deletions.
   // The old file remains untouched as a separate migration backup.
   const merged=copy(browserStore??baseline);
   return accept(await request('PUT',{store:merged,revision:null}));
  },
  async refresh(){return accept(await request('GET'));},
  async save(raw,expectedRaw,version){
   if(this.raw!==expectedRaw)throw Error('Workflow 已被其他页面更新，请刷新后重试');
   const value=await request('PUT',{store:JSON.parse(raw),revision,...(version?{version}:{})});
   return accept(value);
  },
  clear(){store=null;raw=null;revision=null;active=false;},
 };
}
export {KEY,CATALOG};
