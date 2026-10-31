import test from 'node:test';
import assert from 'node:assert/strict';
import {createReflectionsStore,REFLECTIONS_KEY} from '../assets/portfolio-reflections-store.mjs';

function fixture(){
 const values=new Map();let sequence=0,tick=0;
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const options={id:()=>`entry-${++sequence}`,now:()=>`2026-10-${String(20+tick++).padStart(2,'0')}T12:00:00.000Z`};
 return {values,storage,store:createReflectionsStore(storage,options),options};
}
const text={title:'October reflection',period:'A few weeks',body:'<script>plain text</script>\n\n交易总结：保留空行。\n  Indented note.'};

test('plain text and arbitrary periods survive reopening and editing without changing creation time',()=>{
 const {storage,store,options}=fixture();
 const saved=store.save(text),reopened=createReflectionsStore(storage,options);
 assert.deepEqual(reopened.get(saved.id),saved);
 const changed=reopened.save({...saved,title:'Updated reflection'},saved.revision);
 assert.equal(changed.body,text.body);assert.equal(changed.period,text.period);
 assert.equal(changed.createdAt,saved.createdAt);assert.notEqual(changed.updatedAt,saved.updatedAt);
 assert.equal(changed.revision,2);assert.equal(reopened.list().length,1);
});

test('stale edits and deletion cannot overwrite newer writing in another tab',()=>{
 const {storage,store,options}=fixture(),other=createReflectionsStore(storage,options);
 const first=store.save(text),old=other.get(first.id);
 const newer=store.save({...first,body:'Newer writing'},first.revision);
 assert.throws(()=>other.save({...old,body:'Stale writing'},old.revision),/another tab/);
 assert.throws(()=>other.remove(old.id,old.revision),/another tab/);
 assert.equal(store.get(first.id).body,'Newer writing');
 store.remove(newer.id,newer.revision);
 assert.throws(()=>other.save(old,old.revision),/another tab/);
 assert.deepEqual(store.list(),[]);
});

test('malformed saved data is preserved instead of being overwritten by a new entry',()=>{
 const {values,store}=fixture();
 for(const raw of ['{broken','null','{"version":1,"entries":[{"id":"old"}]}']){
  values.set(REFLECTIONS_KEY,raw);
  assert.throws(()=>store.save(text),/Existing data has been kept/);
  assert.equal(values.get(REFLECTIONS_KEY),raw);
 }
});

test('storage quota failures preserve the previous entry and leave the submitted text intact',()=>{
 const {storage,values,store}=fixture(),entry=store.save(text),before=values.get(REFLECTIONS_KEY);
 storage.setItem=()=>{throw Error('QuotaExceededError');};
 const edited={...entry,body:'Important unsaved text'};
 assert.throws(()=>store.save(edited,entry.revision),/text is still in the editor/);
 assert.equal(values.get(REFLECTIONS_KEY),before);assert.equal(edited.body,'Important unsaved text');
});

test('entries sort by latest edit and blank submissions do not create posts',()=>{
 const {store}=fixture(),first=store.save(text),second=store.save({...text,title:'Second'});
 assert.deepEqual(store.list().map(entry=>entry.id),[second.id,first.id]);
 store.save({...first,body:'Revisited'},first.revision);
 assert.deepEqual(store.list().map(entry=>entry.id),[first.id,second.id]);
 assert.throws(()=>store.save({...text,title:' '}),/title/);
 assert.throws(()=>store.save({...text,body:'\n '}),/text/);
 assert.equal(store.list().length,2);
});

test('public views never read private reflection storage or mount the editor',async()=>{
 const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const originalDocument=globalThis.document,originalLocation=globalThis.location;
 try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Private storage read');}});
  for(const [mode,location] of [['public',{hostname:'localhost',search:''}],['',{hostname:'example.com',search:''}],['',{hostname:'localhost',search:'?view=public'}]]){
   globalThis.location=location;
   globalThis.document={querySelector:()=>({content:mode}),getElementById(){throw Error('Private editor mounted');}};
   await import(`../assets/portfolio-reflections.js?privacy=${encodeURIComponent(mode+location.hostname+location.search)}`);
  }
 }finally{
  if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else delete globalThis.localStorage;
  globalThis.document=originalDocument;globalThis.location=originalLocation;
 }
});
