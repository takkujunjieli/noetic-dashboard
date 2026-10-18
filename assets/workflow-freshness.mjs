import {riskBudgetAllocation} from './kelly-allocation.mjs?v=20261018-thesis-freshness';

const DAY=86400000;
const severity={none:0,fresh:0,review:1,stale:2,expired:3};
const labels={none:'No In Action',fresh:'Fresh',review:'Review',stale:'Stale',expired:'Expired'};
const numeric=value=>value!==''&&value!=null&&Number.isFinite(Number(value));
const canonical=value=>{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
};
const hash=value=>{
 const text=JSON.stringify(canonical(value));let result=2166136261;
 for(let i=0;i<text.length;i++)result=Math.imul(result^text.charCodeAt(i),16777619);
 return (result>>>0).toString(36);
};
const maxStatus=(a,b)=>severity[b]>severity[a]?b:a;
const issue=(status,code,message,bundleId='')=>({status,code,message,bundleId});
const ageDays=(from,to)=>{const a=Date.parse(from),b=Date.parse(to);return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,(b-a)/DAY):null;};
const easternDate=value=>{try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)),read=type=>parts.find(x=>x.type===type)?.value;return `${read('year')}-${read('month')}-${read('day')}`;}catch{return String(value).slice(0,10);}};

export function allocationInputFingerprint(c,riskData=c?.nodes?.risk?.data){
 const policy=riskData||{};
 return hash({
  horizon:c?.horizon||'',
  bundles:(c?.design?.plans||[]).map(plan=>({id:plan.id,construction:plan.construction})),
  underwriting:c?.nodes?.returns?.data||{},
  policy:{thesisAtRiskLimitPct:policy.thesisAtRiskLimitPct??'',atrStopMultiple:policy.atrStopMultiple??'',kellyTiltPct:policy.kellyTiltPct??''}
 });
}

export function marketPricesFromResearch(data){
 const prices={};
 for(const [symbol,row] of Object.entries(data?.tickers||{})){
  const bars=Array.isArray(row?.bars_d)?row.bars_d:[],last=bars.at(-1),price=Array.isArray(last)?Number(last[4]):Number(row?.price);
  if(Number.isFinite(price)&&price>0)prices[String(symbol).toUpperCase()]=price;
 }
 for(const [symbol,row] of Object.entries(data?.snapshots||{})){
  const price=Number(row?.price);if(Number.isFinite(price)&&price>0)prices[String(symbol).toUpperCase()]=price;
 }
 return prices;
}

export function thesisFreshness(c,{now=new Date().toISOString(),atr={},prices={},preview=null}={}){
 const allocation=c?.design?.allocation;
 if(!allocation?.inAction||!Array.isArray(allocation.items))return {status:'none',label:labels.none,issues:[],bundles:{},reviewCadenceDays:null};
 const issues=[];let status='fresh';
 const add=value=>{issues.push(value);status=maxStatus(status,value.status);};
 const underwriting=c?.nodes?.returns?.data||{},frozenDays=allocation.scenarioDaysForward??underwriting.daysForward;
 const daysForward=numeric(frozenDays)&&Number(frozenDays)>0?Number(frozenDays):null;
 const cadence=daysForward==null?7:Math.max(2,Math.min(7,daysForward/4));
 const underwrittenAt=allocation.underwrittenAt||allocation.at;
 const reviewedAt=allocation.reviewedAt||underwrittenAt;
 const underwritingAge=ageDays(underwrittenAt,now),reviewAge=ageDays(reviewedAt,now);
 const today=easternDate(now);
 const horizon=allocation.scenarioHorizon??c?.horizon??'';
 if(horizon&&/^\d{4}-\d{2}-\d{2}$/.test(horizon)&&today>horizon)add(issue('expired','horizon-expired',`Thesis 目标日期 ${horizon} 已过`));
 if(daysForward!=null&&underwritingAge!=null&&underwritingAge>=daysForward)add(issue('expired','scenario-expired',`Scenario 的 ${daysForward} Days Forward 已到期`));
 else if(reviewAge!=null&&reviewAge>=cadence*2)add(issue('stale','review-overdue',`已 ${Math.floor(reviewAge)} 天未复核，超过 ${Math.round(cadence*2)} 天`));
 else if(reviewAge!=null&&reviewAge>=cadence)add(issue('review','review-due',`已 ${Math.floor(reviewAge)} 天未复核`));
 if(!allocation.sourceFingerprint)add(issue('stale','missing-baseline','旧版 In Action 配置缺少 freshness baseline，请重新激活 Risk Budget'));
 else if(allocation.sourceFingerprint!==allocationInputFingerprint(c))add(issue('stale','draft-newer','Draft newer than In Action：Bundle、Scenario 或 Risk Budget 参数已修改'));

 let live=preview;
 if(!live&&atr)try{live=riskBudgetAllocation(c,c?.nodes?.risk?.data||{},atr);}catch{}
 const currentEligibility=new Map((live?.complete&&Array.isArray(live.bundles)?live.bundles:[]).map(row=>[row.bundleId,row]));
 const bundles={};
 for(const frozen of allocation.items){
  let bundleStatus='fresh';const bundleIssues=[];
  const addBundle=value=>{bundleIssues.push(value);bundleStatus=maxStatus(bundleStatus,value.status);add(value);};
  const symbol=String(frozen.underlying||'').toUpperCase(),currentPrice=Number(prices[symbol]),reference=Number(frozen.referencePrice),frozenAtr=Number(frozen.atr);
  let priceDriftAtr=null;
  if(Number.isFinite(currentPrice)&&currentPrice>0&&Number.isFinite(reference)&&reference>0&&Number.isFinite(frozenAtr)&&frozenAtr>0){
   priceDriftAtr=Math.abs(currentPrice-reference)/frozenAtr;
   if(priceDriftAtr>=2)addBundle(issue('stale','price-drift',`${frozen.name||symbol} 价格较冻结参考价偏移 ${priceDriftAtr.toFixed(1)} ATR`,frozen.bundleId));
   else if(priceDriftAtr>=1)addBundle(issue('review','price-drift',`${frozen.name||symbol} 价格较冻结参考价偏移 ${priceDriftAtr.toFixed(1)} ATR`,frozen.bundleId));
  }else if(frozen.eligible!==false&&Number.isFinite(reference)&&reference>0&&Number.isFinite(frozenAtr)&&frozenAtr>0)addBundle(issue('review','price-unavailable',`${frozen.name||symbol} 当前价格不可用，无法检查价格 drift`,frozen.bundleId));
  const current=currentEligibility.get(frozen.bundleId);
  if(current&&typeof frozen.eligible==='boolean'&&current.eligible!==frozen.eligible){
   const direction=frozen.eligible?'Included → Excluded':'Excluded → Included';
   addBundle(issue(frozen.eligible?'stale':'review','eligibility-changed',`${frozen.name||symbol} Eligibility changed：${direction}`,frozen.bundleId));
  }
  bundles[frozen.bundleId]={status:bundleStatus,label:labels[bundleStatus],issues:bundleIssues,priceDriftAtr,currentPrice:Number.isFinite(currentPrice)?currentPrice:null};
 }
 return {status,label:labels[status],issues,bundles,reviewCadenceDays:cadence,reviewedAt,underwrittenAt};
}

export function freshnessSummary(result){
 const unique=[...new Map((result?.issues||[]).map(x=>[`${x.code}\0${x.message}`,x])).values()];
 return {...result,issues:unique};
}
