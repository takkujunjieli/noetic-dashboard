import {escapeHTML as esc} from './qlib-view.mjs';
import {parseSymbols,previewSymbols,numberInput} from './qlib-universe.mjs';
const $=id=>document.getElementById(id);
let source,settings,dirty=false;
const profile=()=>settings.profiles[settings.active];
function changed(value=true){dirty=value;document.dispatchEvent(new CustomEvent('qlib-universe-change',{detail:{dirty}}));$('pool-save').disabled=!value;$('pool-message').textContent=value?'有未保存的修改':'';}
function collect(){
  return {name:$('pool-name').value.trim(),include_base:$('pool-base').checked,
    groups:[...document.querySelectorAll('#pool-groups input:checked')].map(i=>i.value).sort(),
    include:parseSymbols($('pool-include').value),exclude:parseSymbols($('pool-exclude').value),
    filters:{min_price:numberInput($('pool-min-price').value),
      min_dollar_volume:numberInput($('pool-min-volume').value,{scale:10000}),
      volume_window:numberInput($('pool-volume-window').value),
      min_market_cap:numberInput($('pool-min-cap').value,{scale:100000000}),
      max_market_cap:numberInput($('pool-max-cap').value,{scale:100000000,nullable:true}),
      min_history:numberInput($('pool-history').value)}};
}
function preview(){
  try{
    const symbols=previewSymbols(source.base_symbols,collect(),source.catalog.groups);
    $('pool-preview').textContent=`待筛选 ${symbols.length} 只：${symbols.join(' · ')}`;
  }catch(e){$('pool-preview').textContent=e.message;}
}
function populate(){
  $('pool-profile').innerHTML=Object.entries(settings.profiles).map(([id,p])=>`<option value="${esc(id)}" ${id===settings.active?'selected':''}>${esc(p.name)}</option>`).join('');
  const p=profile(),f=p.filters;
  $('pool-name').value=p.name;$('pool-base').checked=p.include_base;
  $('pool-include').value=p.include.join(' ');$('pool-exclude').value=p.exclude.join(' ');
  $('pool-min-price').value=f.min_price;$('pool-min-volume').value=f.min_dollar_volume/10000;
  $('pool-volume-window').value=f.volume_window;$('pool-min-cap').value=f.min_market_cap/100000000;
  $('pool-max-cap').value=f.max_market_cap==null?'':f.max_market_cap/100000000;$('pool-history').value=f.min_history;
  $('pool-groups').innerHTML=source.catalog.groups.map(g=>`<label class="pool-group"><input type="checkbox" value="${esc(g.id)}" ${p.groups.includes(g.id)?'checked':''}><span>${esc(g.name)} <small>${g.symbols.length}只</small></span></label>`).join('');
  preview();
}
export async function initUniverse(){
  if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))return;
  try{
    const response=await fetch('/api/qlib/universe',{cache:'no-store'});
    if(!response.ok)return;
    source=await response.json();settings=structuredClone(source.settings);
    document.dispatchEvent(new CustomEvent('qlib-universe-saved',{detail:{revision:source.revision}}));
    $('pool-editor').hidden=false;populate();
    $('pool-form').addEventListener('input',event=>{if(['pool-search','pool-profile'].includes(event.target.id))return;changed();preview();});
    $('pool-profile').addEventListener('change',()=>{settings.active=$('pool-profile').value;populate();changed();});
    $('pool-new').addEventListener('click',()=>{
      try{settings.profiles[settings.active]=collect();}catch(e){$('pool-message').textContent=e.message;return;}
      const id='pool-'+Date.now().toString(36);settings.profiles[id]=structuredClone(profile());
      settings.profiles[id].name='新研究股票池';settings.active=id;populate();changed();$('pool-name').focus();
    });
    $('pool-search').addEventListener('input',()=>{
      const query=$('pool-search').value.toLowerCase();
      document.querySelectorAll('#pool-groups label').forEach(label=>{label.hidden=!label.textContent.toLowerCase().includes(query);});
    });
    $('pool-form').addEventListener('submit',async event=>{
      event.preventDefault();$('pool-save').disabled=true;
      try{
        settings.profiles[settings.active]=collect();
        const response=await fetch('/api/qlib/universe',{method:'PUT',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({settings,revision:source.revision})});
        const result=await response.json();if(!response.ok)throw Error(result.error||'保存失败');
        source=result;settings=structuredClone(result.settings);populate();changed(false);
        $('pool-message').textContent='已保存。点击「更新行情」查看动量与波动；需要预测时再点击「刷新研究」。';
        document.dispatchEvent(new CustomEvent('qlib-universe-saved',{detail:{revision:source.revision}}));
      }catch(e){$('pool-message').textContent=e.message;$('pool-save').disabled=false;}
    });
  }catch{ $('pool-editor').hidden=true; }
}
