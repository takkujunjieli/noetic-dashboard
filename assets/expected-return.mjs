import {ticker, multiplier, structureDraft, structureError} from './trade-structure.mjs';
export const numeric=x=>x!==''&&x!=null&&typeof x!=='boolean'&&Number.isFinite(Number(x));
export const validDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
export function returnInputError(d){
 for(const k of ['expectedNet','capital','averageLoss'])if(d[k]!=null&&d[k]!==''&&(!numeric(d[k])||(k!=='expectedNet'&&Number(d[k])<=0)))return k==='expectedNet'?'预期净损益须为有效金额':'配置资本与平均亏损须大于 0，或留空';
 if(d.expectedDate&&!validDay(d.expectedDate))return '预计完成日期无效';return '';
}
export function rate(net,capital){const result=numeric(net)&&numeric(capital)&&Number(capital)>0?Number(net)/Number(capital)*100:null;return Number.isFinite(result)?result:null;}
export function legPayoff(l,price){const value=l.type==='stock'?price:l.type==='call'?Math.max(price-Number(l.strike),0):Math.max(Number(l.strike)-price,0);return (value-Number(l.entry))*Number(l.qty)*multiplier(l)*(l.side==='short'?-1:1);}
export function payoffGroups(construction,legacySymbol='',horizon='',legacySpot=''){
 const d=structureDraft(construction,legacySymbol,horizon),groups=new Map();
 for(const l of d.legs){const symbol=ticker(l)||'未指定标的';if(!groups.has(symbol))groups.set(symbol,[]);groups.get(symbol).push(l);}
 return [...groups].map(([symbol,legs])=>{
  const base={symbol,legs,date:d.evaluationDate||horizon};
  const error=structureError({...d,evaluationDate:base.date,legs},true);if(error)return {...base,error};
  const expiries=[...new Set(legs.filter(l=>l.type!=='stock').map(l=>l.expiry))];
  if(expiries.length>1||expiries.some(exp=>exp!==base.date))return {...base,error:'需要期权估值模型：该评估日期上存在未到期或已到期的合约，不能统一按内在价值计算。'};
  const quoted=[...new Set(legs.filter(l=>numeric(l.underlyingPrice)&&Number(l.underlyingPrice)>0).map(l=>Number(l.underlyingPrice)))];
  const reference=quoted.length===1?quoted[0]:quoted.length===0&&groups.size===1&&numeric(legacySpot)&&Number(legacySpot)>0?Number(legacySpot):null;
  const anchors=[...legs.filter(l=>l.type!=='stock').map(l=>Number(l.strike)),...legs.filter(l=>l.type==='stock').map(l=>Number(l.entry)),...(reference!==null?[reference]:[])].filter(x=>x>0);
  const anchorsMax=anchors.length?Math.max(...anchors):1;
  const pnl=x=>legs.reduce((sum,l)=>sum+legPayoff(l,x),0);
  const knots=[...new Set([0,...legs.filter(l=>l.type!=='stock').map(l=>Number(l.strike))])].sort((a,b)=>a-b),breakEven=[],zeroIntervals=[];
  for(let i=0;i<knots.length;i++){
   const a=knots[i],b=knots[i+1]??a+Math.max(1,anchorsMax),fa=pnl(a),fb=pnl(b),slope=(fb-fa)/(b-a),last=i===knots.length-1;
   if(Math.abs(fa)<1e-8)breakEven.push(a);
   if(Math.abs(slope)<1e-10){if(Math.abs(fa)<1e-8)zeroIntervals.push([a,last?null:b]);continue;}
   const root=a-fa/slope;if(root>=a-1e-8&&(last||root<=b+1e-8))breakEven.push(Math.max(0,root));
  }
  const roots=[...new Set(breakEven.map(x=>Number(x.toFixed(8))))].filter(x=>!zeroIntervals.some(([a,b])=>x>=a-1e-8&&(b===null||x<=b+1e-8)));
  const xMin=0,xMax=Math.max(anchorsMax*1.6,...roots.map(x=>x*1.15),1),xs=[...new Set([...Array.from({length:101},(_,i)=>xMax*i/100),...knots,...roots,...(reference!==null?[reference]:[])])].sort((a,b)=>a-b);
  const tail=legs.reduce((s,l)=>s+(['stock','call'].includes(l.type)?Number(l.qty)*multiplier(l)*(l.side==='short'?-1:1):0),0);
  return {...base,reference,referenceWarning:quoted.length>1?'标的参考报价不一致，未绘制参考价线。':'',breakEven:roots,zeroIntervals,xMin,xMax,points:xs.map(x=>({x,y:pnl(x)})),legPoints:legs.map(l=>xs.map(x=>({x,y:legPayoff(l,x)}))),maxLoss:tail<0?Infinity:Math.max(0,-Math.min(...knots.map(pnl)))};
 });
}
export function forecastFor(c,planId=c.design?.selectedId){
 const p=c.design?.plans.find(p=>p.id===planId),d=p&&p.id!==c.design?.selectedId?p.returns:c.nodes.returns.data;
 return {planId:p?.id||'',planName:p?.name||'现有方案',expectedNet:numeric(d.expectedNet)?Number(d.expectedNet):null,capital:numeric(d.capital)&&Number(d.capital)>0?Number(d.capital):null,expectedDate:d.expectedDate||p?.construction.evaluationDate||c.nodes.construction.data.evaluationDate||c.horizon||'',rate:rate(d.expectedNet,d.capital)};
}
export function captureReturnBasis(c,at){
 if(c.returnBasis||!c.design?.activeId)return;
 const f=forecastFor(c,c.design.activeId);if(f.rate===null)return;
 c.returnBasis={...f,at};
}
export function completedReturn(c){
 if(!c.archived)return null;
 const basis=c.performance?.basis||c.returnBasis;
 const net=c.performance?c.performance.actualNet:c.nodes.attribution.data.realized;
 const completedAt=c.performance?.completedAt||c.events?.find(e=>e.type==='归档实例'||e.snapshot?.archived)?.at||c.updatedAt;
 const actualRate=basis?rate(net,basis.capital):null;
 if(actualRate===null||!Number.isFinite(Date.parse(completedAt)))return null;
 return {id:c.id,title:c.title,planName:basis.planName,date:completedAt.slice(0,10),rate:actualRate,net:Number(net),capital:basis.capital,basis};
}
export function historyPoints(c,cases){
 // Demo examples are never mixed into actual trading history.
 const eligible=cases.filter(x=>Boolean(x.demo)===Boolean(c.demo)),actuals=eligible.map(completedReturn).filter(Boolean);
 const f=c.archived&&c.performance?.basis?c.performance.basis:forecastFor(c);
 const predicted=f.rate!==null&&validDay(f.expectedDate)?{id:c.id,title:c.title,planName:f.planName,date:f.expectedDate,rate:f.rate,net:f.expectedNet,capital:f.capital}:null;
 return {actuals,predicted,omitted:eligible.filter(x=>x.archived).length-actuals.length};
}
export const WIN_RATES=[.3,.4,.5,.6,.7,.8,.9];
export const PAYOFF_RATIOS=[.5,1,1.5,2,3,4];
export function expectancyMatrix(d){
 const loss=numeric(d.averageLoss)&&Number(d.averageLoss)>0?Number(d.averageLoss):null,target=numeric(d.expectedNet)?Number(d.expectedNet):null;
 return WIN_RATES.map(p=>({p,required:loss&&target!==null?(target/loss+1-p)/p:null,cells:PAYOFF_RATIOS.map(b=>{const r=p*b-(1-p),net=loss===null?null:r*loss;return {b,r,net,returnRate:net===null?null:rate(net,d.capital),meets:net!==null&&target!==null?net>=target-1e-8:null};})}));
}
export function validateReturnBasis(b){if(!b||typeof b.planId!=='string'||typeof b.planName!=='string'||!numeric(b.expectedNet)||!numeric(b.capital)||Number(b.capital)<=0||(b.expectedDate!==''&&!validDay(b.expectedDate))||!Number.isFinite(Date.parse(b.at))||Math.abs(rate(b.expectedNet,b.capital)-b.rate)>1e-8||!Number.isFinite(b.rate))throw Error('收益基准快照格式无效');}
