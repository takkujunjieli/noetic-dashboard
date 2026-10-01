export const TEMPLATES={custom:'Custom Structure',stock:'Long Stock',shortStock:'Short Stock',call:'Long Call',put:'Long Put',bullPut:'Bull Put Spread',bearPut:'Bear Put Spread',bullCall:'Bull Call Spread',bearCall:'Bear Call Spread',straddle:'Long Straddle',strangle:'Long Strangle',coveredCall:'Covered Call',stockBullPut:'Long Stock + Bull Put Spread'};
export const POSITION_INSTRUMENTS=Object.fromEntries(Object.entries(TEMPLATES).filter(([key])=>!['custom','stockBullPut'].includes(key)));
export const ticker=l=>String(l.underlying??l.symbol??'').trim().toUpperCase().replace(/\s+\d{4}-\d{2}-\d{2}\s+[\d.]+[CP]$/, '');
export const multiplier=l=>l.type==='stock'?1:100;
const num=x=>x!==''&&x!=null&&Number.isFinite(+x);
export function newStructureLeg(type='stock',side='long',qty=1){return {underlying:'',type,side,qty,entry:'',strike:'',expiry:'',underlyingPrice:'',delta:'',gamma:'',theta:'',vega:'',iv:'',quoteAt:''};}
export function templateLegs(template){
 const l=newStructureLeg;
 switch(template){
 case 'stock':return [l()];case 'shortStock':return [l('stock','short')];case 'call':return [l('call')];case 'put':return [l('put')];
 case 'bullPut':return [l('put','short'),l('put')];case 'bearPut':return [l('put'),l('put','short')];case 'bullCall':return [l('call'),l('call','short')];case 'bearCall':return [l('call','short'),l('call')];
 case 'straddle':case 'strangle':return [l('call'),l('put')];
 case 'coveredCall':return [l('stock','long',100),l('call','short')];
 case 'stockBullPut':return [l('stock','long',20),l('put','short'),l('put')];
 default:return [];
 }
}
export function inferInstrument(d={}){
 if(Object.hasOwn(POSITION_INSTRUMENTS,d.template))return d.template;
 const legs=d.legs||[],signature=legs.map(l=>`${l.type}:${l.side}`).join('|');
 return ({'stock:long':'stock','stock:short':'shortStock','call:long':'call','put:long':'put','call:long|call:short':'bullCall','call:short|call:long':'bearCall','put:short|put:long':'bullPut','put:long|put:short':'bearPut','call:long|put:long':'strangle','stock:long|call:short':'coveredCall','stock:long|put:short|put:long':'stockBullPut'})[signature]||'custom';
}
export function candidateDraft(d={},legacySymbol=''){
 const legs=d.legs||[],symbols=[...new Set(legs.map(ticker).filter(Boolean))],instrument=d.candidate?.instrument||inferInstrument(d);
 const hasCandidateUnderlying=Object.hasOwn(d.candidate||{},'underlying');
 const supported=Object.hasOwn(TEMPLATES,instrument)&&instrument!=='custom';
 return {version:1,underlying:String(hasCandidateUnderlying?d.candidate.underlying:(symbols[0]||legacySymbol||'')).toUpperCase(),instrument:supported?instrument:'stock',referenceCapital:d.candidate?.referenceCapital??'',targetDte:d.candidate?.targetDte??'',longDelta:d.candidate?.longDelta??'',shortDelta:d.candidate?.shortDelta??'',plannedEntry:d.candidate?.plannedEntry??''};
}
export function positionLabel(d={},legacySymbol=''){
 const c=candidateDraft(d,legacySymbol);return `${c.underlying||'未指定标的'} Bundle`;
}
export function structureDraft(data,legacySymbol='',horizon=''){
 const d=JSON.parse(JSON.stringify(data));
 if(d.structureVersion!==1){d.structureVersion=1;d.template='custom';d.evaluationDate=horizon;d.legs=d.legs.map(l=>({...newStructureLeg(),...l,underlying:l.underlying??legacySymbol}));}
 if(d.greekScale!==10000){for(const l of d.legs||[])if(l.type!=='stock')for(const k of ['delta','gamma','theta','vega'])if(num(l[k]))l[k]=Math.abs(+l[k])*10000;d.greekScale=10000;}
 delete d.notes;return d;
}
export function structureError(d,complete=false){
 if(d.structureVersion!==1)return '';
 if(d.greekScale!=null&&d.greekScale!==10000)return 'Greeks 缩放口径无效';
 if(!Object.hasOwn(TEMPLATES,d.template)||!Array.isArray(d.legs)||d.legs.length>60)return '交易结构格式无效';
 const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
 if(d.evaluationDate&&!date(d.evaluationDate))return '评估日期无效';
 if(d.candidate?.referenceCapital!==''&&d.candidate?.referenceCapital!=null&&(!num(d.candidate.referenceCapital)||+d.candidate.referenceCapital<=0))return 'Reference Capital 须大于 0，或留空';
 if(complete&&(!d.legs.length||!date(d.evaluationDate)))return '选定方案前请填写评估日期并添加交易腿';
 for(const l of d.legs){
  if(!['stock','call','put'].includes(l.type)||!['long','short'].includes(l.side))return '交易腿类型无效';
  if(typeof l.underlying!=='string'||(l.underlying&&!/^[A-Z0-9.\-]{1,24}$/i.test(l.underlying)))return '请填写有效的标的代码';
  if(complete&&!ticker(l))return '每条腿需要独立填写标的';
  if(!num(l.qty)||+l.qty<=0||(l.type!=='stock'&&!Number.isInteger(+l.qty)))return '数量须大于 0，期权张数须为整数';
  for(const k of ['entry','strike','underlyingPrice','iv'])if(l[k]!==''&&l[k]!=null&&(!num(l[k])||+l[k]<0))return '价格、行权价与 IV 须为非负数或留空';
  if(l.type!=='stock'&&l.strike!==''&&+l.strike<=0)return '行权价须大于 0';
  if(l.type!=='stock'&&l.expiry&&!date(l.expiry))return '到期日无效';
  if(complete&&(!num(l.entry)||(l.type!=='stock'&&(!date(l.expiry)||!num(l.strike)||+l.strike<=0))))return '选定方案前请补齐参考价格与期权合约';
  for(const k of ['delta','gamma','theta','vega'])if(l[k]!==''&&l[k]!=null&&(!num(l[k])||(d.greekScale===10000&&+l[k]<0)))return 'Greeks 须为非负的 ×10,000 数值或留空';
  if(l.type!=='stock'&&num(l.delta)&&(d.greekScale===10000?+l.delta>10000:Math.abs(+l.delta)>1))return 'Delta 须为 0 到 10,000 的绝对值';
  if(l.quoteAt&&!Number.isFinite(Date.parse(l.quoteAt)))return '指标观察时间无效';
 }
 return '';
}
export function structureExposure(legs,greekScale=1){
 const groups=new Map();let cash=0;
 for(const l of legs){
  const key=ticker(l)||'未指定标的';if(!groups.has(key))groups.set(key,{symbol:key,delta:0,gamma:0,theta:0,vega:0});
  const g=groups.get(key),q=num(l.qty)?+l.qty*multiplier(l)*(l.side==='short'?-1:1):null;
  cash=cash===null||q===null||!num(l.entry)?null:cash+q*+l.entry;
  for(const k of ['delta','gamma','theta','vega']){
   const raw=num(l[k])?+l[k]:null,sign=greekScale===10000?(k==='delta'&&l.type==='put'||k==='theta'?-1:1):1;
   const v=l.type==='stock'?(k==='delta'?1:0):(raw==null?null:greekScale===10000?Math.abs(raw)/10000*sign:raw);
   g[k]=g[k]===null||q===null||v===null?null:g[k]+q*v;
  }
 }
 return {cash:legs.length?cash:null,groups:[...groups.values()]};
}
export function bundleMetrics(d={}){
 const candidate=candidateDraft(d),exposure=structureExposure(d.legs||[],d.greekScale),group=exposure.groups.find(g=>g.symbol===candidate.underlying)||exposure.groups[0]||null;
 const spots=[...new Set((d.legs||[]).filter(l=>num(l.underlyingPrice)&&+l.underlyingPrice>0).map(l=>+l.underlyingPrice))];
 const referenceCapital=num(candidate.referenceCapital)&&+candidate.referenceCapital>0?+candidate.referenceCapital:null;
 return {underlying:candidate.underlying,referenceSpot:spots.length===1?spots[0]:null,spotConflict:spots.length>1,referenceCapital,netDelta:group?.delta??null,netGamma:group?.gamma??null,netVega:group?.vega??null,netTheta:group?.theta??null,legCount:(d.legs||[]).length};
}
