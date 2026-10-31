import test from 'node:test';
import assert from 'node:assert/strict';
import {packWorkflowStorage,unpackWorkflowStorage,workflowStorageGet,workflowStorageSet} from '../assets/workflow-storage.mjs';
import {createCase,record,saveNode,KEY,VERSION,validateStore} from '../assets/workflow-model.mjs';
import {captureWorkflow} from '../assets/workflow-sync.js';

const history=()=>{const c=createCase({title:'2m-回归',rationale:'中文论点与风险条件'.repeat(300)});for(let i=0;i<70;i++)record(c,'更新记录','hypothesis','保留历史 '+i);return {version:VERSION,cases:[c]};};
const storage=(initial,limit)=>{const map=new Map(initial);return {getItem:key=>map.get(key)??null,setItem(key,value){const next=new Map(map);next.set(key,String(value));if([...next].reduce((sum,[k,v])=>sum+k.length+v.length,0)>limit)throw new DOMException('quota','QuotaExceededError');map.set(key,String(value));},removeItem:key=>map.delete(key)};};

test('all revisions, nested strings, arrays and Unicode survive exact storage roundtrip',()=>{
 const raw=JSON.stringify(history()),packed=packWorkflowStorage(raw);
 assert.ok(packed.length<raw.length*.3);assert.equal(unpackWorkflowStorage(packed),raw);
 assert.deepEqual(validateStore(JSON.parse(unpackWorkflowStorage(packed))),JSON.parse(raw));
 const special=JSON.parse('{"__proto__":{"x":1},"constructor":"文字","values":[null,true,false,0,-1,1.234,"文本"]}');
 special.history=Array(2000).fill(special.values);
 const specialRaw=JSON.stringify(special);assert.equal(unpackWorkflowStorage(packWorkflowStorage(specialRaw)),specialRaw);
 assert.equal({}.x,undefined);
});

test('quota-bound legacy JSON is replaced atomically without deleting any history or other settings',()=>{
 const initial=history(),raw=JSON.stringify(initial),physical=storage([[KEY,raw],['riskPolicy','{}']],raw.length+KEY.length+500);
 const updated=structuredClone(initial);saveNode(updated.cases[0],'hypothesis',{...updated.cases[0].nodes.hypothesis.data,rationale:'更新后的论点'.repeat(600)});
 const next=JSON.stringify(updated);assert.throws(()=>physical.setItem(KEY,next),{name:'QuotaExceededError'});
 workflowStorageSet(physical,KEY,next);assert.equal(workflowStorageGet(physical,KEY),next);
 assert.equal(physical.getItem('riskPolicy'),'{}');assert.equal(physical.getItem(KEY).startsWith('{"schema":"workflow-storage-dag"'),true);
 const adapter={getItem:key=>workflowStorageGet(physical,key)};
 assert.deepEqual(captureWorkflow(adapter).entries[KEY],updated);
 // A fresh storage object models reload / a second tab, without the read cache.
 assert.equal(workflowStorageGet({getItem:key=>physical.getItem(key)},KEY),next);
});

test('failed writes preserve the prior durable value and never poison the read cache',()=>{
 const physical=storage([],1000000),original=JSON.stringify(history());workflowStorageSet(physical,KEY,original);
 const failed={getItem:key=>physical.getItem(key),setItem(){throw new DOMException('quota','QuotaExceededError');}};
 assert.equal(workflowStorageGet(failed,KEY),original);
 assert.throws(()=>workflowStorageSet(failed,KEY,JSON.stringify({version:1,cases:[]})),{name:'QuotaExceededError'});
 assert.equal(workflowStorageGet(failed,KEY),original);
});

test('legacy JSON and unrelated keys stay readable; corrupt packed data is never silently erased',()=>{
 assert.equal(unpackWorkflowStorage(null),null);assert.equal(unpackWorkflowStorage('{"version":1}'),'{"version":1}');
 const legacy=' { "version": 1, "cases": [] } ';assert.equal(packWorkflowStorage(legacy),legacy);
 const bad='{"schema":"workflow-storage-dag","version":1,"root":[0],"nodes":[[0,[[0]]]]}';
 const physical=storage([[KEY,bad]],1000);assert.throws(()=>workflowStorageGet(physical,KEY),/引用无效/);assert.equal(physical.getItem(KEY),bad);
 const plain=storage([],1000);workflowStorageSet(plain,'riskPolicy','{"account_equity":100}');assert.equal(plain.getItem('riskPolicy'),'{"account_equity":100}');
});

test('versioned and legacy dashboard module URLs use the same storage/public runtime',async()=>{
 const legacy=await import('../assets/dashboard-data.mjs');
 const versioned=await import('../assets/dashboard-data.mjs?v=20261028-storage-v2');
 assert.equal(legacy.dashboardStorage,versioned.dashboardStorage);
 assert.equal(legacy.configurePublicDashboard,versioned.configurePublicDashboard);
});
