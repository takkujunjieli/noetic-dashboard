// Pure adapter for the existing private portfolio.json contract.
// Legacy option prices are dollars per contract; Workflow legs use per-share premium.
const copy = x => JSON.parse(JSON.stringify(x));
const finite = x => x !== '' && x != null && Number.isFinite(+x);
const stamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : '';
export function parseInstrument(p) {
 const symbol=String(p.sym||'').trim().toUpperCase();
 if((p.kind||'equity')==='equity')return symbol?{type:'stock',underlying:symbol,strike:'',expiry:''}:null;
 if(p.kind!=='option')return null;
 const m=symbol.match(/^([A-Z0-9.\-]+)\s+(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)([CP])$/);
 if(!m||+m[3]<=0)return null;
 const date=new Date(m[2]+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==m[2])return null;
 if(p.multiplier!=null&&+p.multiplier!==100)return null;
 return {type:m[4]==='C'?'call':'put',underlying:m[1],strike:+m[3],expiry:m[2]};
}
export function positionKey(row) {return JSON.stringify([row.broker||'',row.account,row.type,row.underlying,row.expiry,row.strike,row.side]);}
export function normalizePortfolio(raw) {
 if(!raw||!Array.isArray(raw.accounts)||!Array.isArray(raw.positions)||!stamp(raw.updated_at))throw Error('持仓快照缺少账户、持仓列表或有效构建时间；保留旧记录');
 const accounts=raw.accounts.filter(a=>a&&typeof a.id==='string'&&!/agentic/i.test(`${a.label||''} ${a.nickname||''} ${a.name||''}`)).map(a=>({id:a.id,label:a.label||a.id,broker:a.broker||'',sourceAt:stamp(a.source_updated_at)||stamp(raw.source_updated_at)}));
 if(new Set(accounts.map(a=>a.id)).size!==accounts.length)throw Error('账户 ID 重复，无法同步');
 const rows=[],unsupported=[],seen=new Set();
 for(const p of raw.positions){
  const account=accounts.find(a=>a.id===p.account);if(!account)continue;
  if(!finite(p.qty)){unsupported.push({account:p.account,symbol:String(p.sym||''),reason:'持仓数量缺失'});continue;}
  if(+p.qty===0)continue;
  const ins=parseInstrument(p);
  if(!ins){unsupported.push({account:p.account,symbol:String(p.sym||''),reason:'合约格式/乘数不支持，需要完整到期年份；可继续手工记录'});continue;}
  const qty=Math.abs(+p.qty),factor=ins.type==='stock'?1:100;
  if(ins.type!=='stock'&&!Number.isInteger(qty)){unsupported.push({account:p.account,symbol:String(p.sym||''),reason:'期权张数不是整数'});continue;}
  const row={...ins,account:p.account,accountLabel:account.label,broker:p.broker||account.broker,symbol:String(p.sym),side:+p.qty<0?'short':'long',qty,
   entry:finite(p.avg_cost)&&+p.avg_cost>=0?+p.avg_cost/factor:'',mark:finite(p.price)&&+p.price>=0?+p.price/factor:'',
   sourceAt:account.sourceAt,priceAt:stamp(p.price_as_of),instrumentId:String(p.instrument_id||'')};
  row.key=positionKey(row);if(seen.has(row.key))throw Error('同账户存在重复合约行，不能安全分配');seen.add(row.key);rows.push(row);
 }
 return {builtAt:raw.updated_at,accounts,rows,unsupported};
}
export function liveClaims(cases,key,excludeId='') {
 return cases.filter(c=>c.id!==excludeId&&!c.archived&&c.nodes.positions.state!=='closed').flatMap(c=>(c.nodes.positions.data.binding?.rules||[]).filter(r=>!r.closed&&r.key===key).map(r=>({...r,caseId:c.id,title:c.title})));
}
export function validateBindingsAcrossCases(cases) {
 const byKey=new Map();
 for(const c of cases){if(c.archived||c.nodes.positions.state==='closed')continue;
  for(const r of c.nodes.positions.data.binding?.rules||[]){if(r.closed)continue;const list=byKey.get(r.key)||[];list.push(r);byKey.set(r.key,list);}
 }
 for(const list of byKey.values())if(list.length>1&&list.some(r=>r.mode==='all'))throw Error('同一持仓的整仓归属与其他实例冲突');
}
export function bindingFromSelection(c,cases,source,selection) {
 if(c.archived||c.nodes.positions.state==='closed')throw Error('已结束的实例不能新增持仓归属');
 if(!selection.length)throw Error('至少选择一项实际持仓');
 if(new Set(selection.map(x=>x.key)).size!==selection.length)throw Error('持仓选择重复');
 const rules=selection.map(choice=>{
  const row=source.rows.find(r=>r.key===choice.key);if(!row)throw Error('选择的持仓已变化，请刷新列表');
  const oldRule=c.nodes.positions.data.binding?.rules.find(r=>r.key===row.key);
  if(oldRule&&Date.parse(row.sourceAt)<Date.parse(oldRule.sourceAt))throw Error('快照早于已保存持仓，不能确认归属');
  if(row.underlying!==c.symbol.toUpperCase())throw Error('持仓标的与当前 thesis 不匹配');
  if(row.entry==='')throw Error(`${row.symbol} 缺少有效成本，不能生成实际持仓快照`);
  if(!row.sourceAt)throw Error(`${row.symbol} 缺少券商源时间，请先更新 Portfolio 数据`);
  const others=liveClaims(cases,row.key,c.id),mode=choice.mode;
  if(!['all','fixed'].includes(mode))throw Error('归属方式无效');
  if((mode==='all'&&others.length)||others.some(r=>r.mode==='all'))throw Error(`${row.symbol} 已被其他 thesis 占用；整仓跟随不能重复关联`);
  const qty=mode==='all'?row.qty:+choice.qty;
  if(!Number.isFinite(qty)||qty<=0||(row.type!=='stock'&&!Number.isInteger(qty)))throw Error('分配数量须大于 0，期权为整数张');
  if(qty+others.reduce((s,r)=>s+(+r.qty),0)>row.qty+1e-8)throw Error(`${row.symbol} 分配总量超过账户实际数量`);
  return {...row,mode,qty,closed:false};
 });
 // Existing omitted mappings cannot silently disappear. Only an explicit close/release may remove one.
 for(const old of c.nodes.positions.data.binding?.rules||[])if(!old.closed&&!rules.some(r=>r.key===old.key))throw Error('已关联项不能直接取消勾选；请先使用解除归属或确认清仓');
 return {version:1,rules};
}
function legFrom(row,qty) {return {type:row.type,side:row.side,qty,entry:row.entry,mark:row.mark,strike:row.strike,expiry:row.expiry,
 delta:'',gamma:'',theta:'',vega:'',sourceKey:row.key,account:row.account,broker:row.broker,symbol:row.symbol,sourceAt:row.sourceAt,priceAt:row.priceAt};}
export function reconcilePositions(c,cases,source,binding=c.nodes.positions.data.binding) {
 if(!binding)return null;
 const data=copy(c.nodes.positions.data),prior=data.positions||[],issues=[],positions=[],rules=copy(binding.rules);
 for(const rule of rules){if(rule.closed)continue;
  const old=prior.find(l=>l.sourceKey===rule.key),account=source.accounts.find(a=>a.id===rule.account),row=source.rows.find(r=>r.key===rule.key);
  let issue='';
  if(!account)issue='账户在本次快照中缺失';
  else if(!account.sourceAt||Date.parse(account.sourceAt)<Date.parse(rule.sourceAt))issue='券商源时间缺失或早于已保存快照';
  else if(!row)issue='源持仓消失/方向变化：需确认清仓或核对数据';
  else if(row.entry==='')issue='成本字段缺失';
  else {
   const others=liveClaims(cases,rule.key,c.id);
   if((rule.mode==='all'&&others.length)||others.some(r=>r.mode==='all'))issue='整仓归属与其他 thesis 冲突';
   else if(rule.mode==='fixed'&&rule.qty+others.reduce((s,r)=>s+(+r.qty),0)>row.qty+1e-8)issue='账户减仓后分配总量超限，需重新确认各 thesis 数量';
  }
  if(issue){issues.push({key:rule.key,message:issue});if(old)positions.push(old);continue;}
  const qty=rule.mode==='all'?row.qty:rule.qty;
  Object.assign(rule,row,{qty});positions.push(legFrom(row,qty));
 }
 const accountTimes=Object.fromEntries([...new Set(rules.map(r=>r.account))].map(id=>[id,source.accounts.find(a=>a.id===id)?.sourceAt||'']));
 data.source='portfolio';data.binding={version:1,rules};data.positions=positions;
 data.sync={status:issues.length?'attention':'synced',builtAt:source.builtAt,accountTimes,issues};
 const times=Object.values(accountTimes).filter(Boolean);data.asOf=times.length?times.sort((a,b)=>Date.parse(a)-Date.parse(b))[0]:data.asOf;
 return data;
}
export function closeOrReleaseRule(c,source,key,mode) {
 const binding=copy(c.nodes.positions.data.binding),rule=binding?.rules.find(r=>r.key===key&&!r.closed);
 if(!rule)throw Error('未找到有效归属');
 if(mode==='close'){
  const acct=source.accounts.find(a=>a.id===rule.account);
  if(!acct?.sourceAt||Date.parse(acct.sourceAt)<=Date.parse(rule.sourceAt))throw Error('需要该账户更新后的券商源时间，才能确认源持仓已清仓');
  if(source.rows.some(r=>r.key===key))throw Error('源账户仍有该持仓；不能将整项标记为已清仓');
  if(source.unsupported.some(r=>r.account===rule.account))throw Error('账户存在无法识别的持仓行，不能推断清仓');
 }else if(mode!=='release')throw Error('归属操作无效');
 rule.closed=true;rule.closedReason=mode==='close'?'confirmed_exit':'released';return binding;
}
export function validatePositionLink(data) {
 if(!data.binding){if(data.source==='portfolio')throw Error('关联持仓缺少归属规则');return;}
 if(data.source!=='portfolio')throw Error('持仓归属的数据源必须是 Portfolio');
 const b=data.binding;
 if(b.version!==1||!Array.isArray(b.rules)||b.rules.length>60)throw Error('持仓归属格式无效');
 const seen=new Set();
 for(const r of b.rules){
  if(!r||typeof r.key!=='string'||r.key!==positionKey(r)||seen.has(r.key)||typeof r.account!=='string'||typeof r.symbol!=='string'||typeof r.underlying!=='string'||!['stock','call','put'].includes(r.type)||!['long','short'].includes(r.side)||!['all','fixed'].includes(r.mode)||typeof r.closed!=='boolean'||!finite(r.qty)||+r.qty<=0||!stamp(r.sourceAt))throw Error('持仓归属条目无效');
  if(r.type!=='stock'&&(!Number.isInteger(+r.qty)||!stamp(r.expiry)||!finite(r.strike)||+r.strike<=0))throw Error('期权归属信息无效');
  seen.add(r.key);
 }
 if(data.sync?.accountTimes&&Object.values(data.sync.accountTimes).some(v=>typeof v!=='string'||(v&&!stamp(v))))throw Error('账户源时间无效');
 if(!data.sync||!['synced','attention'].includes(data.sync.status)||!stamp(data.sync.builtAt)||!data.sync.accountTimes||!Array.isArray(data.sync.issues))throw Error('持仓同步快照无效');
 for(const issue of data.sync.issues)if(typeof issue?.key!=='string'||typeof issue.message!=='string')throw Error('持仓同步问题格式无效');
 if((data.sync.status==='synced')!==(!data.sync.issues.length))throw Error('持仓同步状态不一致');
 for(const leg of data.positions)if(!b.rules.some(r=>r.key===leg.sourceKey&&!r.closed))throw Error('实际持仓缺少有效归属');
}
export function positionLinkFingerprint(data) {
 // File rebuild alone is not a position change. Source timestamps and quote timestamps are retained.
 const d=copy(data);if(d.sync)delete d.sync.builtAt;return JSON.stringify(d);
}
