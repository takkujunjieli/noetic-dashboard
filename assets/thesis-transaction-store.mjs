import {parseTransactionFile} from './attribution-transactions.mjs';
const url=id=>`/api/thesis-transactions/${encodeURIComponent(id)}`;
async function responseBody(response){
 const type=response.headers.get('content-type')||'';
 if(!type.includes('application/json'))throw Error('自动保存需要本地文件服务，请使用 python3 scripts/serve_dashboard.py 启动页面');
 const body=await response.json();
 if(!response.ok)throw Error(body.error||`交易文件请求失败：${response.status}`);
 return body;
}
export async function readTransactionStore(id){
 const r=await fetch(url(id),{cache:'no-store'}),body=await responseBody(r);
 if(body.file===null)return {file:null,etag:null,path:body.path};
 const file=parseTransactionFile(JSON.stringify(body.file));
 if(file.thesis.id!==id)throw Error('交易文件不属于此 thesis');
 return {file,etag:r.headers.get('ETag'),path:body.path};
}
export async function writeTransactionStore(id,file,etag){
 parseTransactionFile(JSON.stringify(file));
 const headers={'Content-Type':'application/json',...(etag?{'If-Match':etag}:{'If-None-Match':'*'})};
 await responseBody(await fetch(url(id),{method:'PUT',headers,body:JSON.stringify(file)}));
 // The display and all subsequent queries use the persisted file, not the input payload.
 return readTransactionStore(id);
}
export async function deleteTransactionStore(id,etag){
 if(!etag)throw Error('请先读取交易文件');
 return responseBody(await fetch(url(id),{method:'DELETE',headers:{'If-Match':etag}}));
}
export async function readLocalBrokerHistory(){
 return responseBody(await fetch('/api/transaction-history',{cache:'no-store'}));
}
