import {esc} from './shared.js';
import {readTradeLinks,writeTradeLink,workflowLinkCases,TRADE_ROLES} from './trade-link-client.js';
const etDay=ts=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts));
export async function mountTradeLinkEditor(host, tradeId, fills, onChanged) {
  host.innerHTML='<p class="muted small">读取 Workflow 关联…</p>';
  try {
    const state=await readTradeLinks();if(!host.isConnected)return;
    let editing = null;
    function draw(){
      const cases=workflowLinkCases();
      const links=state.data.links.filter(x=>x.trade_id===tradeId&&x.status==='active');
      const allFills=new Set(fills.map(f=>f.fill_id));
      host.innerHTML=`<b>Workflow 关联</b><div>${links.map(link=>`<p><a href="workflow.html?node=positions#${encodeURIComponent(link.workflow_case_id)}">${esc(link.workflow_title)} · ${TRADE_ROLES[link.role]}</a> · ${link.allocations.map(a=>esc(a.quantity)).join(' / ')} ${cases.some(c=>c.id===link.workflow_case_id)?`<button type="button" class="mini-btn" data-unlink="${esc(link.link_id)}">解除关联</button><button type="button" class="mini-btn" data-edit="${esc(link.link_id)}">编辑分配</button>`:'<span class="muted small">归档或本浏览器不可编辑</span>'}${fills.some(f=>!link.fill_ids.includes(f.fill_id))?'<br><span class="muted small">有未纳入此关联的成交；需另行选择并关联。</span>':''}${link.fill_ids.some(id=>!allFills.has(id))?'<br><span class="muted small">此关联还包含其他日期的成交。</span>':''}</p>`).join('')||'<p class="muted small">尚未关联</p>'}</div><label>Workflow<select data-link-case><option value="">选择 Workflow</option>${cases.map(c=>`<option value="${esc(c.id)}" ${editing?.workflow_case_id===c.id?'selected':''}>${esc(c.title)}${fills.every(f=>c.underlyings.includes(f.underlying))?'':' · 标的不在 In Action，仅可对冲'}</option>`).join('')}</select></label><label>交易角色<select data-link-role>${Object.entries(TRADE_ROLES).map(([key,label])=>`<option value="${key}" ${editing?.role===key?'selected':''}>${label}</option>`).join('')}</select></label><p class="muted small">分配数量：股票为股，期权为张。填 0 可排除该腿。</p>${fills.map(fill=>{
        const used=state.data.links.filter(x=>x.status==='active'&&x.link_id!==editing?.link_id).flatMap(x=>x.allocations).filter(a=>a.fill_id===fill.fill_id).reduce((s,a)=>s+a.quantity,0);
        const remaining=Math.max(0,fill.qty-used);
        return `<label>${esc(fill.symbol)} · ${esc(fill.side)} · 可分配 ${esc(remaining)}<input data-link-fill="${esc(fill.fill_id)}" type="number" min="0" max="${remaining}" step="${fill.kind==='option'?'1':'any'}" value="${editing?editing.allocations.find(a=>a.fill_id===fill.fill_id)?.quantity||0:remaining}"></label>`;
      }).join('')}<button type="button" class="mini-btn" data-link-save ${cases.length?'':'disabled'}>${editing?'保存关联修改':'关联到 Monitor'}</button><p data-link-status class="muted small" role="status"></p>`;
    }
    draw();
    host.onclick=async event=>{
      const edit=event.target.closest('[data-edit]');if(edit){editing=state.data.links.find(x=>x.link_id===edit.dataset.edit);draw();return;}
      const unlink=event.target.closest('[data-unlink]'),save=event.target.closest('[data-link-save]');if(!unlink&&!save)return;
      const status=host.querySelector('[data-link-status]');
      try{
        const latestCases=workflowLinkCases();let body;
        if(unlink){
          const link=state.data.links.find(x=>x.link_id===unlink.dataset.unlink);
          if(!latestCases.some(c=>c.id===link.workflow_case_id))throw Error('该 Workflow 已归档或不可编辑');
          body={action:'unlink',link_id:link.link_id};
        }else{
          const c=latestCases.find(c=>c.id===host.querySelector('[data-link-case]').value);if(!c)throw Error('请选择 Workflow');
          const inputs=[...host.querySelectorAll('[data-link-fill]')];
          if(inputs.some(input=>!input.checkValidity()))throw Error('请检查分配数量范围和期权整数张数');
          const allocations=inputs.map(input=>({fill_id:input.dataset.linkFill,quantity:Number(input.value)})).filter(a=>a.quantity>0);
          body={action:editing?'update':'link',...(editing?{link_id:editing.link_id}:{}),trade_id:tradeId,workflow_case:c,role:host.querySelector('[data-link-role]').value,allocations};
        }
        host.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='保存中…';
        const result=await writeTradeLink(body,state);if(!host.isConnected)return;
        editing=null;draw();onChanged?.(state.data);host.querySelector('[data-link-status]').textContent=result.warning||'已保存，Workflow 历史记录已更新';
      }catch(error){
        status.textContent=error.message;
        host.querySelectorAll('button').forEach(b=>b.disabled=false);
        if(error.message.includes('其他页面')){try{Object.assign(state,await readTradeLinks());}catch{}}
      }
    };
  }catch(error){if(host.isConnected)host.textContent='关联不可用：'+error.message;}
}

export async function mountTradeLinkGroupEditor(host, trades, onChanged) {
  host.innerHTML='<p class="muted small">读取 Workflow 关联…</p>';
  try {
    const state=await readTradeLinks();if(!host.isConnected)return;
    const tradeIds=new Set(trades.map(trade=>trade.tradeId));
    const fills=trades.flatMap(trade=>trade.fills);
    let editing=null;
    const groups=()=>{
      const grouped=new Map();
      for(const link of state.data.links.filter(link=>link.status==='active'&&tradeIds.has(link.trade_id))){
        const key=`${link.workflow_case_id}\u0000${link.role}`;
        if(!grouped.has(key))grouped.set(key,{key,workflow_case_id:link.workflow_case_id,workflow_title:link.workflow_title,role:link.role,links:[]});
        grouped.get(key).links.push(link);
      }
      return [...grouped.values()];
    };
    function draw(){
      const cases=workflowLinkCases(),activeGroups=groups();
      const editingLinks=new Set(editing?.linkIds||[]);
      const selectedCase=editing?.workflow_case_id||'';
      const selectedRole=editing?.role||'entry';
      host.innerHTML=`<b>Workflow 关联</b><div>${activeGroups.map((group,index)=>{
        const allocations=group.links.flatMap(link=>link.allocations);
        const editable=cases.some(c=>c.id===group.workflow_case_id);
        const covered=new Set(group.links.flatMap(link=>link.fill_ids));
        return `<p><a href="workflow.html?node=positions#${encodeURIComponent(group.workflow_case_id)}">${esc(group.workflow_title)} · ${TRADE_ROLES[group.role]}</a> · ${allocations.map(a=>esc(a.quantity)).join(' / ')} ${editable?`<button type="button" class="mini-btn" data-group-unlink="${index}">解除关联</button><button type="button" class="mini-btn" data-group-edit="${index}">编辑分配</button>`:'<span class="muted small">归档或本浏览器不可编辑</span>'}${fills.some(fill=>!covered.has(fill.fill_id))?'<br><span class="muted small">部分成交尚未纳入此关联。</span>':''}</p>`;
      }).join('')||'<p class="muted small">尚未关联</p>'}</div><label>Workflow<select data-link-case><option value="">选择 Workflow</option>${cases.map(c=>`<option value="${esc(c.id)}" ${selectedCase===c.id?'selected':''}>${esc(c.title)}${fills.every(fill=>c.underlyings.includes(fill.underlying))?'':' · 标的不在 In Action，仅可对冲'}</option>`).join('')}</select></label><label>交易角色<select data-link-role>${Object.entries(TRADE_ROLES).map(([key,label])=>`<option value="${key}" ${selectedRole===key?'selected':''}>${label}</option>`).join('')}</select></label><p class="muted small">一次设置本卡片全部账户的成交分配。股票为股，期权为张；填 0 可排除该笔。</p>${fills.map(fill=>{
        const used=state.data.links.filter(link=>link.status==='active'&&!editingLinks.has(link.link_id)).flatMap(link=>link.allocations).filter(a=>a.fill_id===fill.fill_id).reduce((sum,a)=>sum+a.quantity,0);
        const remaining=Math.max(0,Number(fill.qty)-used);
        const assigned=state.data.links.filter(link=>editingLinks.has(link.link_id)).flatMap(link=>link.allocations).filter(a=>a.fill_id===fill.fill_id).reduce((sum,a)=>sum+a.quantity,0);
        return `<label>${esc(fill.account)} · ${esc(fill.symbol)} · ${esc(fill.side)} · 可分配 ${esc(remaining)}<input data-link-fill="${esc(fill.fill_id)}" data-link-trade="${esc(fill.trade_id)}" type="number" min="0" max="${remaining}" step="${fill.kind==='option'?'1':'any'}" value="${editing?assigned:remaining}"></label>`;
      }).join('')}<button type="button" class="mini-btn" data-group-save ${cases.length?'':'disabled'}>${editing?'保存关联修改':'关联到 Monitor'}</button><p data-link-status class="muted small" role="status"></p>`;
    }
    draw();
    host.onclick=async event=>{
      const activeGroups=groups();
      const edit=event.target.closest('[data-group-edit]');
      if(edit){const group=activeGroups[Number(edit.dataset.groupEdit)];editing={workflow_case_id:group.workflow_case_id,role:group.role,linkIds:group.links.map(link=>link.link_id)};draw();return;}
      const unlink=event.target.closest('[data-group-unlink]'),save=event.target.closest('[data-group-save]');if(!unlink&&!save)return;
      const status=host.querySelector('[data-link-status]');
      try{
        const latestCases=workflowLinkCases();
        host.querySelectorAll('button').forEach(button=>button.disabled=true);status.textContent='保存中…';
        if(unlink){
          const group=activeGroups[Number(unlink.dataset.groupUnlink)];
          if(!group||!latestCases.some(c=>c.id===group.workflow_case_id))throw Error('该 Workflow 已归档或不可编辑');
          for(const link of group.links)await writeTradeLink({action:'unlink',link_id:link.link_id},state);
        }else{
          const workflowCase=latestCases.find(c=>c.id===host.querySelector('[data-link-case]').value);if(!workflowCase)throw Error('请选择 Workflow');
          const inputs=[...host.querySelectorAll('[data-link-fill]')];
          if(inputs.some(input=>!input.checkValidity()))throw Error('请检查分配数量范围和期权整数张数');
          const role=host.querySelector('[data-link-role]').value;
          const editingLinks=state.data.links.filter(link=>editing?.linkIds.includes(link.link_id)&&link.status==='active');
          for(const trade of trades){
            const allocations=inputs.filter(input=>input.dataset.linkTrade===trade.tradeId).map(input=>({fill_id:input.dataset.linkFill,quantity:Number(input.value)})).filter(a=>a.quantity>0);
            let existing=editingLinks.filter(link=>link.trade_id===trade.tradeId);
            if(existing.length&&existing[0].workflow_case_id!==workflowCase.id){for(const link of existing)await writeTradeLink({action:'unlink',link_id:link.link_id},state);existing=[];}
            if(allocations.length){
              const primary=existing[0];
              await writeTradeLink({action:primary?'update':'link',...(primary?{link_id:primary.link_id}:{}),trade_id:trade.tradeId,workflow_case:workflowCase,role,allocations},state);
              for(const extra of existing.slice(1))await writeTradeLink({action:'unlink',link_id:extra.link_id},state);
            }else for(const link of existing)await writeTradeLink({action:'unlink',link_id:link.link_id},state);
          }
        }
        editing=null;draw();onChanged?.(state.data);host.querySelector('[data-link-status]').textContent='已保存，Workflow 历史记录已更新';
      }catch(error){
        status.textContent=error.message;
        host.querySelectorAll('button').forEach(button=>button.disabled=false);
        if(error.message.includes('其他页面')){try{Object.assign(state,await readTradeLinks());draw();}catch{}}
      }
    };
  }catch(error){if(host.isConnected)host.textContent='关联不可用：'+error.message;}
}
export async function mountMonitorTrades(host,c,{readonly=false,replay=false,onRefresh}={}) {
  host.innerHTML='<h3>执行记录</h3><p>读取成交事实…</p>';
  try{
    const response=await fetch('/api/trade-journal',{cache:'no-store'});if(!response.ok)throw Error('本地成交服务不可用');
    const journal=await response.json();
    const notesResponse=await fetch('/api/trade-annotations',{cache:'no-store'});if(!notesResponse.ok)throw Error('交易理由不可用');
    const notes=await notesResponse.json();if(!host.isConnected)return;
    const fills=new Map(journal.fills.map(f=>[f.fill_id,f]));
    const links=c.nodes.positions.data.executionLinks||[];
    host.innerHTML=`<h3>执行记录 · Monitor</h3><p class="hint">${replay?'按当前快照中冻结的关联和分配展示；交易理由显示当前保存内容。':'成交与分配来自已关联记录；交易理由显示当前保存内容。'}${readonly?' · 只读':''}</p>${!readonly?'<button type="button" data-monitor-refresh>重新读取关联</button>':''}<div class="table-wrap"><table><thead><tr><th>美东日期</th><th>标的 / 合约</th><th>方向</th><th>分配数量</th><th>成交价</th><th>角色</th><th>理由</th><th>状态</th></tr></thead><tbody>${links.flatMap(link=>link.allocations.map(allocation=>{
      const f=fills.get(allocation.fill_id);
      if(!f)return `<tr><td colspan="8">${esc(allocation.fill_id)} · 成交源缺失</td></tr>`;
      const url=`trading.html?sym=${encodeURIComponent(f.underlying)}&tf=1d&date=${etDay(f.timestamp)}&trade=${encodeURIComponent(link.trade_id)}`;
      return `<tr><td><a href="${url}">${etDay(f.timestamp)}</a></td><td>${esc(f.symbol)}</td><td>${esc(f.side)}</td><td>${allocation.quantity}</td><td>${esc(f.price)}</td><td>${TRADE_ROLES[link.role]}</td><td>${esc(notes.annotations?.[link.trade_id]?.reason||'未填写')}</td><td>${link.status==='active'?'已关联':'已解除'}</td></tr>`;
    })).join('')||'<tr><td colspan="8">暂无关联成交。点击 Trading 日线的 B/S/O 标记可建立关联。</td></tr>'}</tbody></table></div><p class="hint">分配数量按每条 fill 保存。回填的新成交需另行关联。</p>`;
    host.querySelector('[data-monitor-refresh]')?.addEventListener('click',onRefresh);
  }catch(error){if(host.isConnected)host.textContent=error.message;}
}
