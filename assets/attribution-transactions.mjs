import {ticker} from './trade-structure.mjs';

export const TIME_ZONE='America/New_York';
const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const timestampValid=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/i.test(value)&&Number.isFinite(Date.parse(value));
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function easternTime(value){
 if(!timestampValid(value))throw Error('交易时间缺失或不含明确时区，无法按美东时间筛选');
 const p=Object.fromEntries(formatter.formatToParts(new Date(value)).map(p=>[p.type,p.value]));
 return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${String(new Date(value).getUTCMilliseconds()).padStart(3,'0')}`;
}
export function thesisUnderlyings(c){
 const allocation=c.design?.allocation;
 if(!allocation?.inAction||!['multivariate-kelly','monte-carlo-kelly'].includes(allocation.method))throw Error('请先设置 In Action Kelly Allocation');
 const symbols=[];
 for(const item of allocation.items||[]){
  // Older Kelly snapshots stored the frozen underlying in `name`.
  // Allocation membership, rather than its current target weight, defines the thesis scope.
  // Never resolve via mutable candidate plans, imported symbols or Portfolio assignments.
  const symbol=item.underlying??item.name;
  if(typeof symbol!=='string'||!symbol.trim()||!/^[A-Z0-9.\-]{1,24}$/i.test(symbol.trim()))throw Error('In Action Kelly Allocation 缺少明确的 underlying，请重新设置配置');
  symbols.push(ticker({underlying:symbol}));
 }
 return [...new Set(symbols)].sort();
}
export function transactionRange(start,end){
 if(!dateValid(start)||!dateValid(end)||start>end)throw Error('请填写有效的起止日期');
 return {startDate:start,endDate:end,startTime:'02:00',endTime:'24:00',timeZone:TIME_ZONE,
  startLocal:`${start}T02:00:00.000`,endLocal:`${end}T24:00:00.000`,
  semantics:'continuous interval; inclusive boundaries; 24:00 is exclusive next-day midnight'};
}
function underlyingOf(row){
 if(row.underlying)return ticker({underlying:row.underlying});
 const symbol=String(row.sym||'').trim().toUpperCase();
 if(row.kind==='option'){
  const match=symbol.match(/^(.+?)\s+\d{4}-\d{2}-\d{2}\s+[\d.]+[CP]$/)||symbol.match(/^([A-Z.]+)\s*\d{6}[CP]\d{8}$/)||symbol.match(/^([A-Z0-9.\-]{1,24})(?:\s+(?:LONG|SHORT)_(?:PUT|CALL))?$/);
  if(!match)throw Error(`期权 ${symbol} 缺少可识别的 underlying，不能保证完整导出`);
  return match[1];
 }
 return symbol;
}
export function createTransactionFile(c,history,{start,end}){
 const range=transactionRange(start,end),underlyings=thesisUnderlyings(c);
 if(!underlyings.length)throw Error('In Action Kelly Allocation 没有 underlying 配置');
 if(history?.version!==1||!Array.isArray(history.transactions)||!Array.isArray(history.sources)||!timestampValid(history.generated_at))throw Error('完整交易历史不可用，请先运行 scripts/build_transaction_history.py');
 const wanted=new Set(underlyings),transactions=[];
 for(const row of history.transactions){
  const underlying=underlyingOf(row);
  if(!wanted.has(underlying))continue;
  const local=easternTime(row.ts);
  if(local<range.startLocal||local>range.endLocal)continue;
  const incomplete=row.kind==='option'&&!/\d{4}-\d{2}-\d{2}|\d{6}[CP]\d{8}$/.test(row.sym||'');
  transactions.push({...row,underlying,time_et:local,...(incomplete?{contract_details_missing:true}:{})});
 }
 transactions.sort((a,b)=>Date.parse(a.ts)-Date.parse(b.ts));
 return {schema:'thesis-transaction-history',version:1,generated_at:new Date().toISOString(),
  thesis:{id:c.id,title:c.title,revision:c.revision,underlyings,allocation_at:c.design.allocation.at},range,
  scope:'All accounts in the local source; equities and options matched by underlying, not exclusive thesis ownership.',
  source:{generated_at:history.generated_at,coverage:history.coverage||'Local history completeness is not verified.',sources:history.sources},
  warnings:['仅包含本地已记录的交易，未验证券商全历史完整性；生成文件不会刷新券商数据。','同 underlying 可能包含其他 thesis 的交易；保留原始价格、数量和状态，不自动计算盈亏或推断期权价格单位。',...(transactions.some(t=>t.contract_details_missing)?['部分旧期权记录缺少到期日、行权价或类型，已保留并标记 contract_details_missing；未补造合约信息。']:[])],
  transaction_count:transactions.length,transactions};
}
export function parseTransactionFile(text){
 const f=JSON.parse(text);
 if(f?.schema!=='thesis-transaction-history'||f.version!==1||typeof f.thesis?.id!=='string'||!Array.isArray(f.thesis?.underlyings)||!f.thesis.underlyings.every(x=>typeof x==='string')||!Array.isArray(f.transactions)||f.transaction_count!==f.transactions.length||!Array.isArray(f.warnings)||!f.warnings.every(x=>typeof x==='string')||!Array.isArray(f.source?.sources)||!f.source.sources.every(s=>s&&typeof s.file==='string')||!timestampValid(f.generated_at))throw Error('交易历史文件格式无效');
 const legacyNoon=f.range?.endTime==='12:00',range=legacyNoon
  ?{...transactionRange(f.range?.startDate,f.range?.endDate),endTime:'12:00',endLocal:`${f.range.endDate}T12:00:00.000`}
  :transactionRange(f.range?.startDate,f.range?.endDate);
 // 12:00 is accepted only to keep immutable files embedded by the previous
 // version readable. New generation and the file API always require 24:00.
 if(f.range.timeZone!==TIME_ZONE||f.range.startTime!=='02:00'||f.range.startLocal!==range.startLocal||f.range.endTime!==range.endTime||f.range.endLocal!==range.endLocal)throw Error('交易历史时间范围无效');
 for(const t of f.transactions)if(!timestampValid(t.ts)||typeof t.sym!=='string'||!f.thesis.underlyings.includes(t.underlying)||easternTime(t.ts)<range.startLocal||easternTime(t.ts)>range.endLocal)throw Error('交易历史记录格式无效');
 return f;
}
export function transactionFilename(f){
 return `${f.thesis.id}.json`;
}
