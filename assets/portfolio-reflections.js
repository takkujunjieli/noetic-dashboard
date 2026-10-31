import {privateDashboard} from './dashboard-mode.mjs';
import {createReflectionsStore,REFLECTIONS_KEY} from './portfolio-reflections-store.mjs?v=20261031-reflections';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=value=>{
 const stamp=new Date(value);
 return Number.isNaN(stamp.getTime())?'':new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'numeric'}).format(stamp);
};
export function mountPortfolioReflections(host,storage=globalThis.localStorage){
 if(!host||host.dataset.mounted)return;
 host.dataset.mounted='true';host.hidden=false;
 const store=createReflectionsStore(storage);
 host.innerHTML=`<details class="pr-notebook"><summary><span class="pr-heading">Trading Reflections</span><span class="pr-count muted small"></span></summary>
  <div class="pr-toolbar"><span class="muted small">Notes on a week, a month, or any period.</span><button type="button" data-reflection-action="new">Write a reflection</button></div>
  <p class="pr-list-status down small" role="status"></p><ol class="pr-list"></ol></details>
  <dialog class="pr-dialog" aria-labelledby="pr-dialog-title"><div class="pr-dialog-head"><span class="pr-eyebrow">TRADING REFLECTIONS</span><button type="button" data-reflection-action="close" aria-label="Close reflection">Close</button></div><div class="pr-content"></div><p class="pr-editor-status small" role="status" aria-live="polite"></p></dialog>`;
 const notebook=host.querySelector('details'),list=host.querySelector('.pr-list'),dialog=host.querySelector('dialog'),content=host.querySelector('.pr-content');
 const status=host.querySelector('.pr-editor-status');
 let editing=false,selected=null,initial='',opener=null;
 const fields=()=>{const form=content.querySelector('form');return {title:form.elements.title.value,period:form.elements.period.value,body:form.elements.body.value};};
 const dirty=()=>editing&&JSON.stringify(fields())!==initial;
 const setStatus=(message,error=false)=>{status.textContent=message;status.classList.toggle('down',error);};
 function renderList(){
  const listStatus=host.querySelector('.pr-list-status'),newButton=host.querySelector('[data-reflection-action="new"]');
  try{
   const entries=store.list();newButton.disabled=false;listStatus.textContent='';
   host.querySelector('.pr-count').textContent=`${entries.length} ${entries.length===1?'entry':'entries'}`;
   list.innerHTML=entries.length?entries.map(entry=>`<li><button type="button" class="pr-entry" data-reflection-action="read" data-id="${esc(entry.id)}"><time datetime="${esc(entry.updatedAt)}">${esc(date(entry.updatedAt))}</time><span class="pr-entry-copy"><strong>${esc(entry.title)}</strong>${entry.period?`<span class="pr-period">${esc(entry.period)}</span>`:''}<span class="pr-excerpt">${esc(entry.body.replace(/\s+/g,' ').slice(0,160))}</span></span><span class="pr-entry-arrow" aria-hidden="true">↗</span></button></li>`).join(''):'<li class="pr-empty muted">No reflections yet.</li>';
  }catch(error){newButton.disabled=true;listStatus.textContent=error.message;notebook.open=true;}
 }
 function show(){
  if(!dialog.open){opener=document.activeElement;dialog.showModal();}
  setStatus('');
 }
 function readEntry(entry){
  selected=entry;editing=false;
  content.innerHTML=`<article class="pr-article"><h2 id="pr-dialog-title">${esc(entry.title)}</h2><div class="pr-meta">${entry.period?`<span>${esc(entry.period)}</span><span aria-hidden="true"> · </span>`:''}<time datetime="${esc(entry.updatedAt)}">${esc(date(entry.updatedAt))}</time></div><div class="pr-body"></div></article><div class="pr-actions"><button type="button" data-reflection-action="edit">Edit</button><button type="button" class="pr-delete" data-reflection-action="delete">Delete</button></div>`;
  content.querySelector('.pr-body').textContent=entry.body;show();
 }
 function editEntry(entry=null){
  selected=entry;editing=true;
  content.innerHTML=`<h2 id="pr-dialog-title">${entry?'Edit reflection':'New reflection'}</h2><form class="pr-form"><label>Title<input name="title" maxlength="180" required placeholder="October trading review"></label><label>Period <span class="muted">(optional)</span><input name="period" maxlength="120" placeholder="October 2026 · Earnings week · Any period"></label><label>Reflection<textarea name="body" rows="16" required placeholder="What happened? What worked? What would you do differently?"></textarea></label><div class="pr-actions"><button type="submit" class="pr-save">Save reflection</button><button type="button" data-reflection-action="close">Cancel</button></div></form>`;
  const form=content.querySelector('form');
  for(const key of ['title','period','body'])form.elements[key].value=entry?.[key]||'';
  initial=JSON.stringify(fields());show();form.elements.title.focus();
  form.addEventListener('input',()=>setStatus(dirty()?'Unsaved changes':''));
  form.addEventListener('submit',event=>{
   event.preventDefault();
   try{const saved=store.save({...fields(),...(selected?{id:selected.id}:{})},selected?.revision??null);renderList();readEntry(saved);setStatus('Saved locally.');}
   catch(error){setStatus(error.message,true);}
  });
 }
 function close(){
  if(dirty()&&!globalThis.confirm('Discard unsaved changes?'))return;
  editing=false;dialog.close();
  if(opener?.isConnected)opener.focus();else notebook.querySelector('summary').focus();
 }
 host.addEventListener('click',event=>{
  const button=event.target.closest('[data-reflection-action]');if(!button)return;
  try{
   const action=button.dataset.reflectionAction;
   if(action==='new')editEntry();
   else if(action==='read'){const entry=store.get(button.dataset.id);if(!entry)throw Error('This reflection was deleted.');readEntry(entry);}
   else if(action==='edit'){const entry=store.get(selected.id);if(!entry)throw Error('This reflection was deleted.');editEntry(entry);}
   else if(action==='close')close();
   else if(action==='delete'&&globalThis.confirm('Delete this reflection?')){store.remove(selected.id,selected.revision);editing=false;dialog.close();renderList();notebook.querySelector('summary').focus();}
  }catch(error){if(dialog.open)setStatus(error.message,true);else host.querySelector('.pr-list-status').textContent=error.message;}
 });
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
 window.addEventListener('storage',event=>{if(event.key===null||event.key===REFLECTIONS_KEY){renderList();if(dialog.open)setStatus('Reflections changed in another tab. Reopen the entry to load the latest version.');}});
 renderList();
}

if(typeof document!=='undefined'&&privateDashboard(location,document.querySelector('meta[name="dashboard-mode"]')?.content)){
 mountPortfolioReflections(document.getElementById('portfolio-reflections'));
}
