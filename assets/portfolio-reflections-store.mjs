export const REFLECTIONS_KEY='research-desk.portfolio-reflections.v1';

function validate(value){
 if(!value||value.version!==1||!Array.isArray(value.entries))throw Error('Saved reflections could not be read. Existing data has been kept.');
 const ids=new Set();
 for(const entry of value.entries){
  if(!entry||typeof entry.id!=='string'||!entry.id||ids.has(entry.id)||
   !['title','period','body','createdAt','updatedAt'].every(key=>typeof entry[key]==='string')||
   !Number.isInteger(entry.revision)||entry.revision<1)throw Error('Saved reflections could not be read. Existing data has been kept.');
  ids.add(entry.id);
 }
 return value;
}
export function createReflectionsStore(storage,{now=()=>new Date().toISOString(),id=()=>globalThis.crypto.randomUUID()}={}){
 function read(){
  const raw=storage.getItem(REFLECTIONS_KEY);
  if(raw===null)return {version:1,entries:[]};
  try{return validate(JSON.parse(raw));}catch{throw Error('Saved reflections could not be read. Existing data has been kept.');}
 }
 function write(value){
  try{storage.setItem(REFLECTIONS_KEY,JSON.stringify(value));}
  catch{throw Error('Unable to save locally. Your text is still in the editor; copy it before closing.');}
 }
 const conflict=()=>Error('This entry changed in another tab. Copy your text, then reopen the latest entry.');
 return {
  list(){return read().entries.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
  get(entryId){return read().entries.find(entry=>entry.id===entryId)||null;},
  save(input,expectedRevision=null){
   if(typeof input.title!=='string'||!input.title.trim()||typeof input.body!=='string'||!input.body.trim())throw Error('Enter a title and some text.');
   const data=read(),current=input.id?data.entries.find(entry=>entry.id===input.id):null;
   if(input.id&&(!current||current.revision!==expectedRevision))throw conflict();
   const stamp=now(),entry={id:current?.id||id(),title:input.title.trim(),period:String(input.period||'').trim(),body:input.body,
    createdAt:current?.createdAt||stamp,updatedAt:stamp,revision:(current?.revision||0)+1};
   data.entries=data.entries.filter(item=>item.id!==entry.id);data.entries.push(entry);write(data);return entry;
  },
  remove(entryId,expectedRevision){
   const data=read(),current=data.entries.find(entry=>entry.id===entryId);
   if(!current||current.revision!==expectedRevision)throw conflict();
   data.entries=data.entries.filter(entry=>entry.id!==entryId);write(data);
  }
 };
}
