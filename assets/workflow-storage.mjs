// Lossless JSON subtree interning for the synchronous Workflow storage contract.
// Histories remain complete; only their repeated physical representation changes.
const SCHEMA='workflow-storage-dag';
const PREFIX='{"schema":"'+SCHEMA+'"';

export function packWorkflowStorage(raw){
 if(raw.length<65536)return raw;
 const value=JSON.parse(raw);
 // Preserve the exact getItem/setItem string contract, including legacy formatting.
 if(JSON.stringify(value)!==raw)return raw;
 const nodes=[],seen=new Map();
 function intern(node){const signature=JSON.stringify(node);let id=seen.get(signature);if(id===undefined){id=nodes.length;nodes.push(node);seen.set(signature,id);}return [id];}
 function visit(value){
  if(typeof value==='string'&&value.length>=128)return intern([2,value]);
  if(value===null||typeof value!=='object')return value;
  const array=Array.isArray(value),body=array?value.map(visit):Object.entries(value).flatMap(([key,item])=>[key,visit(item)]);
  return intern([array?0:1,body]);
 }
 const root=visit(value),packed=JSON.stringify({schema:SCHEMA,version:1,root,nodes});
 return packed.length<raw.length?packed:raw;
}

export function unpackWorkflowStorage(raw){
 if(raw==null||!raw.startsWith(PREFIX))return raw;
 const packed=JSON.parse(raw);
 if(packed.version!==1||!Array.isArray(packed.nodes))throw Error('Workflow 本地存储格式无效；保留原始数据');
 const values=[];
 const resolve=(item,limit)=>{
  if(item===null||typeof item!=='object')return item;
  if(!Array.isArray(item)||item.length!==1||!Number.isInteger(item[0])||item[0]<0||item[0]>=limit)throw Error('Workflow 本地存储引用无效；保留原始数据');
  return values[item[0]];
 };
 for(const node of packed.nodes){
  if(!Array.isArray(node)||node.length!==2||![0,1,2].includes(node[0])||(node[0]===2?typeof node[1]!=='string':!Array.isArray(node[1])))throw Error('Workflow 本地存储节点无效；保留原始数据');
  const [kind,body]=node,limit=values.length;
  if(kind===2)values.push(body);
  else if(kind===0)values.push(body.map(item=>resolve(item,limit)));
  else{
   if(body.length%2)throw Error('Workflow 本地存储属性无效；保留原始数据');
   const entries=[];for(let i=0;i<body.length;i+=2){if(typeof body[i]!=='string')throw Error('Workflow 本地存储属性无效；保留原始数据');entries.push([body[i],resolve(body[i+1],limit)]);}
   values.push(Object.fromEntries(entries));
  }
 }
 return JSON.stringify(resolve(packed.root,values.length));
}

// Cache by backing Storage object so repeated conflict checks do not decode history.
const caches=new WeakMap();
export function workflowStorageGet(storage,key){
 const physical=storage?.getItem(key)??null;
 if(key!=='research-desk.workflow.v1')return physical;
 const cached=storage&&caches.get(storage);
 if(cached?.physical===physical)return cached.logical;
 const logical=unpackWorkflowStorage(physical);
 if(storage)caches.set(storage,{physical,logical});
 return logical;
}
export function workflowStorageSet(storage,key,raw){
 raw=String(raw);
 const physical=key==='research-desk.workflow.v1'?packWorkflowStorage(raw):raw;
 // Storage.setItem is atomic. A rejected write never changes the last good copy.
 try{storage?.setItem(key,physical);}catch(error){
  if(key!=='research-desk.workflow.v1'||(error?.name!=='QuotaExceededError'&&error?.code!==22))throw error;
  const oldChars=storage.getItem(key)?.length??0;
  const failure=new Error(`Workflow 存储 v2：浏览器拒绝写入。逻辑数据 ${raw.length.toLocaleString()} 字符，去重后 ${physical.length.toLocaleString()} 字符，旧值 ${oldChars.toLocaleString()} 字符。原有数据未被覆盖。`);
  failure.name='QuotaExceededError';failure.cause=error;throw failure;
 }
 if(storage&&key==='research-desk.workflow.v1')caches.set(storage,{physical,logical:raw});
}
