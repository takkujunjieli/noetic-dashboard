import {test} from 'node:test';import assert from 'node:assert/strict';
import {captureWorkflow,syncWorkflowSnapshot,UNSYNCED_KEY,readUnsyncedNebulae,writeUnsyncedNebulae,remainingUnsyncedNebulae} from '../assets/workflow-sync.js';
import {KEY,VERSION,createCase} from '../assets/workflow-model.mjs';
test('full workflow sync excludes credentials, guards remote conflicts and handles failed reads',async()=>{
 const map=new Map([[KEY,JSON.stringify({version:VERSION,cases:[createCase({title:'真实 Thesis'})]})],['ghPat','test-only'],['riskPolicy',JSON.stringify({account_equity:1000})]]);
 globalThis.localStorage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const payload=captureWorkflow();assert.ok(payload.entries[KEY].cases[0].events.length);assert.equal(payload.entries.ghPat,undefined);
 const requests=[];globalThis.fetch=async(url,options)=>{requests.push(options);return options.method==='PUT'?{ok:true,json:async()=>({content:{sha:'new'}})}:{ok:false,status:404};};
 await syncWorkflowSnapshot(payload);assert.equal(requests.length,2);assert.equal(map.get(KEY+'.remote-sha'),'new');
 const posted=JSON.parse(requests[1].body);assert.equal(JSON.parse(Buffer.from(posted.content,'base64').toString()).entries[KEY].cases[0].title,'真实 Thesis');
 globalThis.fetch=async()=>({ok:true,json:async()=>({sha:'other',content:Buffer.from(JSON.stringify({version:1,entries:{}})).toString('base64')})});
 await assert.rejects(syncWorkflowSnapshot(payload),/停止覆盖/);
 globalThis.fetch=async()=>({ok:false,status:503});await assert.rejects(syncWorkflowSnapshot(payload),/无法读取/);
});
test('unsynced Nebula markers persist and clear only cases identical to the uploaded snapshot',()=>{
 const a=createCase({title:'A'}),b=createCase({title:'B'}),map=new Map([[KEY,JSON.stringify({version:VERSION,cases:[a,b]})]]),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const marked=new Set([a.id,b.id]);writeUnsyncedNebulae(marked,storage);assert.deepEqual(readUnsyncedNebulae(storage),marked);assert.ok(map.has(UNSYNCED_KEY));
 const payload=captureWorkflow(storage),current=structuredClone(payload.entries[KEY]);current.cases[1].title='B changed during sync';
 assert.deepEqual(remainingUnsyncedNebulae(marked,current,payload),new Set([b.id]));
});
test('sync reports empty or malformed JSON with the exact source instead of a raw parser error',async()=>{
 const c=createCase({title:'A'}),map=new Map([[KEY,JSON.stringify({version:VERSION,cases:[c]})],['riskGroups','']]),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 assert.doesNotThrow(()=>captureWorkflow(storage));map.set('riskGroups','{');assert.throws(()=>captureWorkflow(storage),/riskGroups 不是有效 JSON/);
 globalThis.localStorage={getItem:k=>k==='ghPat'?'test-only':map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 globalThis.fetch=async()=>({ok:true,status:200,text:async()=>''});await assert.rejects(syncWorkflowSnapshot({version:1,entries:{}}),/读取 GitHub Workflow 时返回空响应/);
 const requests=[];globalThis.fetch=async(url,options={})=>{requests.push(options);return options.method==='PUT'?{ok:true,status:200,text:async()=>JSON.stringify({content:{sha:'initialized'}})}:{ok:true,status:200,text:async()=>JSON.stringify({sha:'empty-file',content:''})};};
 await syncWorkflowSnapshot({version:1,entries:{}});assert.equal(requests.length,2);assert.equal(JSON.parse(requests[1].body).sha,'empty-file');assert.equal(map.get(KEY+'.remote-sha'),'initialized');
});
