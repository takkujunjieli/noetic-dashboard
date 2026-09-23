export const TEMPLATES={custom:'自定义',stock:'正股 / ETF',call:'Long Call',put:'Long Put',bullPut:'Bull Put Spread',bullCall:'Bull Call Spread',straddle:'Long Straddle',strangle:'Long Strangle',coveredCall:'Covered Call',stockBullPut:'正股 + Bull Put Spread'};
export const ticker=l=>String(l.underlying??l.symbol??'').trim().toUpperCase().replace(/\s+\d{4}-\d{2}-\d{2}\s+[\d.]+[CP]$/, '');
export const multiplier=l=>l.type==='stock'?1:100;
const num=x=>x!==''&&x!=null&&Number.isFinite(+x);
export function newStructureLeg(type='stock',side='long',qty=1){return {underlying:'',type,side,qty,entry:'',strike:'',expiry:'',underlyingPrice:'',delta:'',gamma:'',theta:'',vega:'',iv:'',quoteAt:''};}
export function templateLegs(template){
 const l=newStructureLeg;
 switch(template){
 case 'stock':return [l()];case 'call':return [l('call')];case 'put':return [l('put')];
 case 'bullPut':return [l('put','short'),l('put')];case 'bullCall':return [l('call'),l('call','short')];
 case 'straddle':case 'strangle':return [l('call'),l('put')];
 case 'coveredCall':return [l('stock','long',100),l('call','short')];
 case 'stockBullPut':return [l('stock','long',20),l('put','short'),l('put')];
 default:return [];
 }
}
export function structureDraft(data,legacySymbol='',horizon=''){
 const d=JSON.parse(JSON.stringify(data));
 if(d.structureVersion!==1){d.structureVersion=1;d.template='custom';d.evaluationDate=horizon;d.legs=d.legs.map(l=>({...newStructureLeg(),...l,underlying:l.underlying??legacySymbol}));}
 delete d.notes;return d;
}
export function structureError(d,complete=false){
 if(d.structureVersion!==1)return '';
 if(!Object.hasOwn(TEMPLATES,d.template)||!Array.isArray(d.legs)||d.legs.length>60)return '交易结构格式无效';
 const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
 if(d.evaluationDate&&!date(d.evaluationDate))return '评估日期无效';
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
  for(const k of ['delta','gamma','theta','vega'])if(l[k]!==''&&l[k]!=null&&!num(l[k]))return 'Greeks 须为数值或留空';
  if(l.type!=='stock'&&num(l.delta)&&(Math.abs(+l.delta)>1||(l.type==='call'&&+l.delta<0)||(l.type==='put'&&+l.delta>0)))return 'Delta 使用多头合约口径：Call 0 到 1；Put −1 到 0';
  if(l.quoteAt&&!Number.isFinite(Date.parse(l.quoteAt)))return '指标观察时间无效';
 }
 return '';
}
export function structureExposure(legs){
 const groups=new Map();let cash=0;
 for(const l of legs){
  const key=ticker(l)||'未指定标的';if(!groups.has(key))groups.set(key,{symbol:key,delta:0,gamma:0,theta:0,vega:0});
  const g=groups.get(key),q=num(l.qty)?+l.qty*multiplier(l)*(l.side==='short'?-1:1):null;
  cash=cash===null||q===null||!num(l.entry)?null:cash+q*+l.entry;
  for(const k of ['delta','gamma','theta','vega']){
   const v=l.type==='stock'?(k==='delta'?1:0):(num(l[k])?+l[k]:null);
   g[k]=g[k]===null||q===null||v===null?null:g[k]+q*v;
  }
 }
 return {cash:legs.length?cash:null,groups:[...groups.values()]};
}
