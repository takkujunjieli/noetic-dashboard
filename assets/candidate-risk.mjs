import {numeric,legPayoff,payoffGroups} from './expected-return.mjs';
import {structureExposure,ticker,candidateDraft,positionLabel} from './trade-structure.mjs';

const finite=value=>value!==''&&value!=null&&Number.isFinite(Number(value));
const positive=value=>finite(value)&&Number(value)>0;

export function emptyRiskPolicy(){return {riskBudget:'',capitalLimit:'',maxDollarDelta:'',priceShock:10,positionRiskCapPct:60};}

export function candidateMetrics(position,policy={}){
 const construction=position.construction||{},candidate=candidateDraft(construction),legs=construction.legs||[],exposure=structureExposure(legs,construction.greekScale),groups=payoffGroups(construction),errors=[];
 if(!candidate.underlying)errors.push('缺少 Underlying');
 if(!legs.length)errors.push('等待 Instrument 生成单位结构');
 const capital=exposure.cash==null?null:Math.abs(exposure.cash),shock=positive(policy.priceShock)?Number(policy.priceShock):10;
 let stressLoss=0,maxLoss=0,dollarDelta=0,hasStress=true,hasMax=true,hasDelta=true;
 for(const group of groups){
  if(group.error||group.reference==null){hasStress=false;if(group.error)errors.push(group.error);}else{
   const signedDelta=exposure.groups.find(x=>x.symbol===group.symbol)?.delta;
   if(signedDelta==null)hasDelta=false;else dollarDelta+=signedDelta*group.reference;
   const direction=signedDelta!=null&&signedDelta<0?1:-1,price=Math.max(0,group.reference*(1+direction*shock/100));
   stressLoss+=Math.max(0,-group.legs.reduce((sum,leg)=>sum+legPayoff(leg,price),0));
  }
  if(group.error||group.maxLoss==null||!Number.isFinite(group.maxLoss))hasMax=false;else maxLoss+=group.maxLoss;
 }
 if(capital==null)errors.push('缺少 Reference Mark');
 if(!hasStress)errors.push('缺少共同压力情景所需行情');
 const theoreticalMaxLoss=hasMax?maxLoss:null,commonStressLoss=hasStress?stressLoss:null;
 const optionOnly=legs.length>0&&legs.every(l=>l.type!=='stock'),riskCharge=optionOnly&&theoreticalMaxLoss!=null&&commonStressLoss!=null?Math.max(theoreticalMaxLoss,commonStressLoss):commonStressLoss;
 const expected=numeric(position.returns?.expectedNet)?Number(position.returns.expectedNet):null;
 return {id:position.id,name:position.name||positionLabel(construction),candidate,capital,theoreticalMaxLoss,commonStressLoss,riskCharge,dollarDelta:hasDelta?dollarDelta:null,gamma:exposure.groups.length===1?exposure.groups[0].gamma:null,theta:exposure.groups.length===1?exposure.groups[0].theta:null,vega:exposure.groups.length===1?exposure.groups[0].vega:null,expected,efficiency:riskCharge>0&&expected!=null?expected/riskCharge:null,errors:[...new Set(errors)]};
}

export function optimizeCandidates(positions,policy={}){
 const metrics=positions.map(p=>candidateMetrics(p,policy)),riskBudget=positive(policy.riskBudget)?Number(policy.riskBudget):null,capitalLimit=positive(policy.capitalLimit)?Number(policy.capitalLimit):Infinity,maxDelta=positive(policy.maxDollarDelta)?Number(policy.maxDollarDelta):Infinity,capPct=positive(policy.positionRiskCapPct)?Math.min(100,Number(policy.positionRiskCapPct)):60;
 const allocations=metrics.map(m=>({positionId:m.id,quantity:0,risk:0,capital:0,expected:0,dollarDelta:0}));
 if(riskBudget==null)return {metrics,allocations,riskBudget:null,usedRisk:0,usedCapital:0,expected:0,dollarDelta:0,complete:false,error:'填写 Thesis Risk Budget 后才能优化数量'};
 let remainingRisk=riskBudget,remainingCapital=capitalLimit,remainingDelta=maxDelta;
 const ranked=metrics.map((m,index)=>({m,index,score:m.efficiency})).filter(x=>x.m.riskCharge>0&&x.m.capital!=null&&x.m.expected!=null&&x.m.expected>0).sort((a,b)=>b.score-a.score);
 for(const {m,index} of ranked){
  const riskCap=riskBudget*capPct/100,byRisk=Math.floor(Math.min(remainingRisk,riskCap)/m.riskCharge),byCapital=m.capital>0?Math.floor(remainingCapital/m.capital):Infinity,byDelta=m.dollarDelta==null||m.dollarDelta===0?Infinity:Math.floor(remainingDelta/Math.abs(m.dollarDelta)),quantity=Math.max(0,Math.min(byRisk,byCapital,byDelta));
  const row=allocations[index];Object.assign(row,{quantity,risk:quantity*m.riskCharge,capital:quantity*m.capital,expected:quantity*m.expected,dollarDelta:quantity*(m.dollarDelta||0)});remainingRisk-=row.risk;remainingCapital-=row.capital;remainingDelta-=Math.abs(row.dollarDelta);
 }
 const usedRisk=allocations.reduce((s,x)=>s+x.risk,0),usedCapital=allocations.reduce((s,x)=>s+x.capital,0),expected=allocations.reduce((s,x)=>s+x.expected,0),dollarDelta=allocations.reduce((s,x)=>s+x.dollarDelta,0);
 return {metrics,allocations,riskBudget,usedRisk,usedCapital,expected,dollarDelta,complete:metrics.length>0&&metrics.every(m=>!m.errors.length),error:ranked.length?'':'所有 Candidate Position 都缺少完整行情或单位 Expected P&L'};
}
