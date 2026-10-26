// Public views use isolated memory, never private browser settings or credentials.
const KEY='research-desk.workflow.v1';
let published=null;
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
 getItem(key){return published?memory.get(key)??null:globalThis.localStorage?.getItem(key)??null;},
 setItem(key,value){
  if(published){
   if(key==='riskPolicy'){const policy=JSON.parse(value);policy.account_equity=100000;value=JSON.stringify(policy);}
   memory.set(key,String(value));
  }else globalThis.localStorage?.setItem(key,String(value));
 },
 removeItem(key){if(published)memory.delete(key);else globalThis.localStorage?.removeItem(key);},
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
