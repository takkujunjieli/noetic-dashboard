// Read-only evidence: account P&L is never assigned automatically to a thesis.
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
export function attributionEvidence(c,pnl,{start,end,window='ytd'}){
 if(!day(start)||!day(end)||start>end)throw Error('请填写有效的起止日期');
 if(!['ytd','3m','1m'].includes(window))throw Error('盈亏窗口无效');
 if(!pnl?.accounts||!day(pnl.as_of)||!Number.isFinite(Date.parse(pnl.updated_at)))throw Error('盈亏文件格式不完整');
 const rules=c.nodes.positions.data.binding?.rules||[],pairs=new Set(rules.map(r=>JSON.stringify([r.account,r.symbol])));
 const rows=[],warnings=[];
 if(!pairs.size)warnings.push('没有已确认的账户与合约归属，无法自动筛选参考成交。');
 const asOf=new Date(pnl.as_of+'T00:00:00Z');
 const coverageStart=window==='ytd'?pnl.as_of.slice(0,4)+'-01-01':new Date(asOf.getTime()-(window==='3m'?90:30)*86400000).toISOString().slice(0,10);
 if(start<coverageStart||end>pnl.as_of)warnings.push(`所选日期超出源窗口覆盖范围 ${coverageStart} 至 ${pnl.as_of}；记录可能不完整。`);
 for(const account of new Set(rules.map(r=>r.account))){
  if(account==='_all')continue;
  const trades=pnl.accounts[account]?.windows?.[window]?.trades;
  if(!Array.isArray(trades)){warnings.push(`账户 ${account} 缺少 ${window} 窗口记录。`);continue;}
  // Exactly one window: do not union overlapping windows or deduplicate identical fills.
  for(const t of trades){
   if(!pairs.has(JSON.stringify([account,t.s])))continue;
   if(!day(t.d)||!['equity','option'].includes(t.k)||typeof t.p!=='number'||!Number.isFinite(t.p))throw Error('匹配的盈亏记录格式无效');
   if(t.d<start||t.d>end)continue;
   rows.push({account,symbol:t.s,date:t.d,kind:t.k,pnl:t.p});
  }
 }
 const result={version:1,capturedAt:new Date().toISOString(),sourceUpdatedAt:pnl.updated_at,asOf:pnl.as_of,start,end,window,coverageStart,rows,warnings};
 validateAttributionEvidence(result);return result;
}
export function validateAttributionEvidence(e){
 if(e==null)return;
 if(e.version!==1||!Number.isFinite(Date.parse(e.capturedAt))||!Number.isFinite(Date.parse(e.sourceUpdatedAt))||![e.asOf,e.start,e.end,e.coverageStart].every(day)||e.start>e.end||!['ytd','3m','1m'].includes(e.window)||!Array.isArray(e.rows)||!Array.isArray(e.warnings)||!e.warnings.every(x=>typeof x==='string'))throw Error('归因证据格式无效');
 for(const r of e.rows)if(typeof r.account!=='string'||typeof r.symbol!=='string'||!day(r.date)||r.date<e.start||r.date>e.end||!['equity','option'].includes(r.kind)||!Number.isFinite(r.pnl))throw Error('归因成交格式无效');
}
