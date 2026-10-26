import {HIDDEN,NODE_NAMES,esc,nameCase,table,row,metrics,caseLink,positionTable,nodeContent} from './public-dashboard.mjs';
const $ = id => document.getElementById(id);
function style() {
  const link=document.createElement('link');link.rel='stylesheet';link.href='assets/public-dashboard.css';document.head.append(link);
  for(const anchor of document.querySelectorAll('nav a[href]')){
    const url=new URL(anchor.href);if(['portfolio.html','workflow.html'].some(name=>url.pathname.endsWith('/'+name))){url.searchParams.set('view','public');anchor.href=url.href;}
  }
}
async function snapshot() {
  const response=await fetch('data/public-dashboard.json',{cache:'no-store'});
  if(!response.ok)throw Error('公开快照暂未发布');
  const data=await response.json();
  if(data.schema!=='anonymous-dashboard'||data.version!==1)throw Error('公开快照格式不兼容');
  return data;
}
function banner(data) { return `<p class="public-notice">公开只读版 · Thesis 使用星云名，标的使用元素符号；正文和财务数据已隐藏。${data?`<span>快照 ${esc(data.publishedAt.slice(0,10))}</span>`:''}</p>`; }
export async function mountPublicPortfolio() {
  style();document.body.classList.add('public-dashboard');
  document.querySelector('section h2 .muted')?.replaceChildren(document.createTextNode('公开版 · 匿名持仓'));
  document.querySelector('footer').textContent='匿名公开快照 · 财务数值不对外提供。非投资建议。';
  for(const id of ['sec-robust','sec-sizing'])$(id).hidden=true;
  $('risk-expo').hidden=true;
  document.querySelector('#sec-expo h2').innerHTML='风险敞口热力图 <span class="muted small">匿名标的 × Workflow</span>';
  try {
    const data=await snapshot(),{accounts,positions}=data.portfolio,cases=data.workflow.cases;
    let selected='';
    function render() {
      const shown=positions.filter(p=>!selected||p.account===selected);
      $('portfolio').innerHTML=banner(data)+`<div class="card"><label class="pf-acctbar">账户 <select id="public-account" class="pf-acct"><option value="">全部账户</option>${accounts.map(a=>`<option value="${esc(a.id)}" ${selected===a.id?'selected':''}>${esc(a.label)}</option>`).join('')}</select></label>${metrics(['账户净值','总市值','账户已实现 P&L','账户未实现 P&L','账户收益率'])}<div class="public-counts">${shown.length} 项持仓 · ${selected?'单一匿名账户':accounts.length+' 个匿名账户'}</div>${positionTable(shown,cases,accounts)}<h3>账户盈亏诊断</h3>${metrics(['累计 P&L','月度 P&L','月度收益率','胜率','盈亏比','Sharpe','Sortino','最大回撤'])}</div>`;
      $('public-account').onchange=e=>{selected=e.target.value;render();};
      $('risk-heat').innerHTML=metrics(['账户净值','风险上限','当前已用风险','剩余风险预算'])+table(['标的','Thesis','数量','现价','成本','止盈','止损','仓位 %','浮盈 %','Bear 在险','距目标'],shown.map(p=>row([esc(p.symbol),cases.filter(c=>c.symbols.includes(p.symbol)).map(c=>caseLink(c,'risk')).join('<br>')||'—',...Array(9).fill(HIDDEN)])));
    }
    render();
  } catch(error) { $('portfolio').innerHTML=banner()+`<div class="card">${esc(error.message)}</div>`;$('risk-heat').textContent='…'; }
}
export async function mountPublicWorkflow() {
  style();document.body.classList.add('public-dashboard');
  for(const id of ['sync-workflow','legacy-history','new','galaxy-empty','nebula-drawer-resizer'])$(id).hidden=true;
  document.querySelector('.galaxy-caption span:last-child').textContent='拖移 · 旋转 · 缩放 · 点击 Star 查看';
  document.querySelector('.galaxy-legend .sync-dot')?.parentElement?.remove();
  $('notice').textContent='';
  const info=document.createElement('span');info.className='public-mode-info';info.textContent='匿名公开版 · 财务数据已隐藏';
  document.querySelector('.galaxy-header .toolbar').append(info);
  try {
    const data=await snapshot(),cases=data.workflow.cases;
    // No localStorage, broker endpoints or private sync modules are accessed in public mode.
    const {createGalaxy}=await import('./galaxy-scene.js');
    let filter='active',selected='',node='hypothesis',scene;
    const visible=()=>cases.filter(c=>c.archived===(filter==='archived'));
    const sceneCases=()=>visible().map(c=>({...c,title:nameCase(c)}));
    function close() {selected='';$('main').hidden=true;document.body.classList.remove('panel-open');scene?.update(sceneCases(),null);}
    function open(id,key='hypothesis') {
      const c=cases.find(c=>c.id===id);if(!c||!NODE_NAMES[key])return;
      selected=id;node=key;filter=c.archived?'archived':'active';renderList();
      $('main').hidden=false;document.body.classList.add('panel-open');
      $('main').innerHTML=`<button id="close-star-panel" class="panel-close" aria-label="关闭节点面板">✕</button><div class="instance-header"><div><p class="eyebrow">${esc(c.symbols.join(' · '))}</p><h2>${esc(nameCase(c))}</h2><span class="badge">${c.nodes[key].state}</span></div></div><nav class="public-node-nav" aria-label="Workflow 节点">${Object.entries(NODE_NAMES).map(([k,label])=>`<button data-public-node="${k}" aria-pressed="${node===k}">${label}</button>`).join('')}</nav><section class="inspector"><h3>${NODE_NAMES[key]}</h3>${nodeContent(c,key,data.portfolio)}</section><details class="nebula-context"><summary>Activity & Snapshots · ${c.events.length} 条</summary><ol>${c.events.slice().reverse().map((e,i)=>`<li><button data-public-event="${c.events.length-i-1}">${esc(NODE_NAMES[e.node])} · …</button></li>`).join('')}</ol><div id="public-history"></div></details>`;
      $('close-star-panel').onclick=close;
      $('main').querySelectorAll('[data-public-node]').forEach(b=>b.onclick=()=>open(id,b.dataset.publicNode));
      $('main').querySelectorAll('[data-public-event]').forEach(b=>b.onclick=()=>{
        const e=c.events[+b.dataset.publicEvent];$('public-history').innerHTML='<h3>历史节点状态</h3>'+table(['节点','状态'],Object.entries(e.states).map(([k,s])=>row([NODE_NAMES[k],esc(s)])))+'<p>修改说明：…</p>';
      });
      history.replaceState(null,'',`?view=public&node=${key}#${id}`);scene.update(sceneCases(),{caseId:id,key});scene.focus(id,key);
      $('galaxy-location').textContent=nameCase(c)+' / '+NODE_NAMES[key];
    }
    function renderList() {
      const query=$('galaxy-search').value.trim().toLowerCase(),shown=visible();
      $('count').textContent=shown.length+' NEBULAE';
      document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
      $('nebula-list').hidden=false;document.body.classList.add('nebula-list-open');
      $('nebula-list').innerHTML=shown.filter(c=>(nameCase(c)+' '+c.symbols.join(' ')).toLowerCase().includes(query)).map(c=>`<div class="nebula-list-row"><button class="nebula-list-name" data-public-case="${c.id}">${esc(nameCase(c))}</button><span class="hint">${c.activeThesis?'Active Thesis':c.archived?'Archive':'Existing'}</span></div>`).join('')||'<p class="hint">没有匹配的 Nebula。</p>';
      $('nebula-list').querySelectorAll('[data-public-case]').forEach(b=>b.onclick=()=>open(b.dataset.publicCase));
      scene?.update(sceneCases(),selected?{caseId:selected,key:node}:null);
    }
    scene=createGalaxy($('galaxy-scene'),{onStar:open,onNebula:id=>open(id),onBackground:close});
    info.textContent='匿名公开版 · 快照 '+data.publishedAt.slice(0,10)+' · 财务数据已隐藏';
    document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;close();renderList();scene.overview();});
    $('galaxy-search').oninput=renderList;
    $('galaxy-home').onclick=()=>{close();scene.overview();};
    $('galaxy-zoom-in').onclick=()=>scene.zoom(.8);$('galaxy-zoom-out').onclick=()=>scene.zoom(1.25);
    const id=location.hash.slice(1),key=new URLSearchParams(location.search).get('node');
    renderList();scene.overview();if(cases.some(c=>c.id===id))open(id,NODE_NAMES[key]?key:'hypothesis');
    window.addEventListener('pagehide',e=>{if(!e.persisted)scene.destroy();});
  } catch(error) { $('notice').textContent=error.message; }
}
