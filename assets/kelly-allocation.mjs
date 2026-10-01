import {greekScenarioMatrix,scenarioUnderwriting,scenarioUnderwritingError} from './expected-return.mjs?v=20260929-2';
import {bundleMetrics} from './trade-structure.mjs';

const finite=value=>value!==''&&value!=null&&Number.isFinite(Number(value));
export const REFERENCE_BANKROLL=100000;
export const emptyKellyPolicy=()=>({allocationVersion:1,targetQuantile:25,thesisAtRiskLimitPct:'',atrReviewMultiple:1.5,atrHardStopMultiple:2.5});

function projectSimplex(values){
 const positive=values.map(x=>Math.max(0,x));
 if(positive.reduce((a,b)=>a+b,0)<=1)return positive;
 const sorted=[...positive].sort((a,b)=>b-a);let sum=0,theta=0;
 for(let i=0;i<sorted.length;i++){sum+=sorted[i];const t=(sum-1)/(i+1);if(i===sorted.length-1||sorted[i+1]<=t){theta=t;break;}}
 return positive.map(x=>Math.max(0,x-theta));
}
function objective(f,scenarios){let value=0;for(const s of scenarios){const wealth=1+s.returns.reduce((sum,r,j)=>sum+f[j]*r,0);if(!(wealth>0))return -Infinity;value+=s.probability*Math.log(wealth);}return value;}
function hashSeed(value){let h=2166136261;for(const c of JSON.stringify(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let x=seed||1;return()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const sampleAround=(center,range,random,min=-Infinity)=>Math.max(min,Number(center)+(random()*2-1)*(Number(range)||0));
const quantile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*q,lo=Math.floor(index),hi=Math.ceil(index);return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo);};
function hasUncertainty(data){const d=scenarioUnderwriting(data);return d.scenarios.some(s=>Number(s.probabilityRange)>0||Object.values(s.moves).some(m=>Number(m.priceMoveRange)>0||Number(m.ivChangeRange)>0));}

export function monteCarloKelly(data,bundles,samples=500){
 const d=scenarioUnderwriting(data),random=rng(hashSeed({d,bundles:bundles.map(b=>b.id),samples})),draws=[];
 for(let k=0;k<samples;k++){
  const sampled=JSON.parse(JSON.stringify(d));let total=0;
  for(const s of sampled.scenarios){s.probability=sampleAround(s.probability,s.probabilityRange,random,0);total+=s.probability;for(const b of bundles){const move=s.moves[b.id];move.priceMove=sampleAround(move.priceMove,move.priceMoveRange,random,-100);if(move.ivChange!==''&&move.ivChange!=null)move.ivChange=sampleAround(move.ivChange,move.ivChangeRange,random);}}
  if(!(total>0))continue;for(const s of sampled.scenarios)s.probability=s.probability/total*100;
  const matrix=greekScenarioMatrix(sampled,bundles);if(matrix.rows.some(row=>row.cells.some(cell=>cell.returnRate==null)))continue;
  const scenarios=matrix.rows.map(row=>({probability:row.probability/100,returns:row.cells.map(cell=>cell.returnRate/100)}));draws.push(solveKelly(scenarios,bundles.length).fractions);
 }
 if(!draws.length)return null;
 return {samples:draws.length,q25:bundles.map((_,j)=>quantile(draws.map(x=>x[j]),.25)),q50:bundles.map((_,j)=>quantile(draws.map(x=>x[j]),.5)),q100:bundles.map((_,j)=>quantile(draws.map(x=>x[j]),1))};
}

export function solveKelly(scenarios,count){
 let fractions=Array(count).fill(0),score=objective(fractions,scenarios),iterations=0;
 for(;iterations<5000;iterations++){
  const gradient=Array(count).fill(0);
  for(const s of scenarios){const wealth=1+s.returns.reduce((sum,r,j)=>sum+fractions[j]*r,0);for(let j=0;j<count;j++)gradient[j]+=s.probability*s.returns[j]/wealth;}
  if(Math.max(...gradient.map(Math.abs),0)<1e-10)break;
  let step=.25,accepted=false,next=fractions,nextScore=score;
  while(step>1e-10){const candidate=projectSimplex(fractions.map((x,j)=>x+step*gradient[j])),candidateScore=objective(candidate,scenarios);if(Number.isFinite(candidateScore)&&candidateScore>=score+1e-12){next=candidate;nextScore=candidateScore;accepted=true;break;}step/=2;}
  if(!accepted)break;
  const change=Math.max(...next.map((x,j)=>Math.abs(x-fractions[j])));fractions=next;score=nextScore;if(change<1e-9)break;
 }
 return {fractions,expectedLogGrowth:score,iterations};
}

export function kellyAllocation(c,data=c.nodes.risk.data,capitalBase=null,atrByUnderlying={}){
 const bundles=c.design?.plans||[],referenceBankroll=bundles.reduce((sum,bundle)=>sum+(Number(bundleMetrics(bundle.construction).referenceCapital)||0),0),bankroll=finite(capitalBase)&&Number(capitalBase)>0?Number(capitalBase):referenceBankroll;
 const underwritingError=scenarioUnderwritingError(c.nodes.returns.data,bundles),matrix=greekScenarioMatrix(c.nodes.returns.data,bundles),issues=[];
 if(!bundles.length)issues.push('先在 Portfolio Construction 添加 Underlying Greek Bundle');
 if(underwritingError)issues.push(underwritingError);
 if(!(bankroll>0))issues.push('请先为 Underlying Greek Bundle 填写 Reference Capital');
 const complete=!issues.length&&matrix.rows.every(row=>row.cells.every(cell=>cell.returnRate!=null));
 if(!complete)return {complete:false,issues:[...new Set(issues)],bankroll,bundles:[],scenarios:[],fractions:[],allocatedFraction:0,cashFraction:1,expectedLogGrowth:null};
 const scenarios=matrix.rows.map(row=>({id:row.id,name:row.name,probability:Number(row.probability)/100,returns:row.cells.map(cell=>cell.returnRate/100)}));
 const solution=solveKelly(scenarios,bundles.length),uncertaintyAware=hasUncertainty(c.nodes.returns.data),monteCarlo=uncertaintyAware?monteCarloKelly(c.nodes.returns.data,bundles):null,targetQuantile=[25,50,100].includes(Number(data?.targetQuantile))?Number(data.targetQuantile):25;
 const selected=monteCarlo?.[`q${targetQuantile}`];
 const kellyFractions=selected?projectSimplex(selected):solution.fractions;
 const hardStopMultiple=finite(data?.atrHardStopMultiple)&&Number(data.atrHardStopMultiple)>0?Number(data.atrHardStopMultiple):2.5;
 const atRiskLimitPct=finite(data?.thesisAtRiskLimitPct)&&Number(data.thesisAtRiskLimitPct)>0?Number(data.thesisAtRiskLimitPct):null,atRiskLimitFraction=atRiskLimitPct==null?null:atRiskLimitPct/100,atRiskLimit=atRiskLimitFraction==null?null:bankroll*atRiskLimitFraction;
 const preliminary=bundles.map((bundle,index)=>{
  const metrics=bundleMetrics(bundle.construction);
  const fullFraction=solution.fractions[index],fraction=kellyFractions[index];
  const targetCapital=fraction*bankroll;
  const referenceCapital=Number(metrics.referenceCapital);
  const scale=referenceCapital>0?targetCapital/referenceCapital:null;
  const atr=Number(atrByUnderlying?.[metrics.underlying]),spot=Number(metrics.referenceSpot),direction=Math.sign(Number(metrics.netDelta)||0),stopMove=atr>0&&direction?(-direction*hardStopMultiple*atr):null;
  const referenceStopPnl=stopMove==null||metrics.netDelta==null||metrics.netGamma==null?null:metrics.netDelta*stopMove+.5*metrics.netGamma*stopMove*stopMove;
  const referenceStopRisk=referenceStopPnl==null?null:Math.max(0,-referenceStopPnl),referenceStopRiskRate=referenceStopRisk==null||!(referenceCapital>0)?null:referenceStopRisk/referenceCapital,estimatedStopRiskFraction=referenceStopRiskRate==null?null:fraction*referenceStopRiskRate,estimatedStopRisk=estimatedStopRiskFraction==null?null:estimatedStopRiskFraction*bankroll;
  return {bundleId:bundle.id,name:metrics.underlying||bundle.name,underlying:metrics.underlying,fullFraction,fraction,q25:monteCarlo?.q25[index]??fullFraction,q50:monteCarlo?.q50[index]??fullFraction,q100:monteCarlo?.q100[index]??fullFraction,targetCapital,referenceCapital,scale,atr:Number.isFinite(atr)&&atr>0?atr:null,stopMove,stopPrice:Number.isFinite(spot)&&stopMove!=null?spot+stopMove:null,referenceStopRisk,referenceStopRiskRate,estimatedStopRiskFraction,estimatedStopRisk,delta:metrics.netDelta==null||scale==null?null:metrics.netDelta*scale,gamma:metrics.netGamma==null||scale==null?null:metrics.netGamma*scale,vega:metrics.netVega==null||scale==null?null:metrics.netVega*scale,theta:metrics.netTheta==null||scale==null?null:metrics.netTheta*scale};
 });
 const rawStopRiskFraction=preliminary.reduce((sum,row)=>sum+(row.estimatedStopRiskFraction??0),0),rawStopRisk=rawStopRiskFraction*bankroll,hasCompleteAtr=preliminary.every(row=>row.atr!=null&&row.estimatedStopRiskFraction!=null);
 const riskScale=atRiskLimitFraction&&hasCompleteAtr&&rawStopRiskFraction>atRiskLimitFraction?atRiskLimitFraction/rawStopRiskFraction:1,targetFractions=kellyFractions.map(x=>x*riskScale);
 const rows=preliminary.map(row=>{const scale=row.scale==null?null:row.scale*riskScale;return {...row,fraction:row.fraction*riskScale,targetCapital:row.targetCapital*riskScale,scale,estimatedStopRiskFraction:row.estimatedStopRiskFraction==null?null:row.estimatedStopRiskFraction*riskScale,estimatedStopRisk:row.estimatedStopRisk==null?null:row.estimatedStopRisk*riskScale,delta:row.delta==null?null:row.delta*riskScale,gamma:row.gamma==null?null:row.gamma*riskScale,vega:row.vega==null?null:row.vega*riskScale,theta:row.theta==null?null:row.theta*riskScale};});
 const allocatedFraction=targetFractions.reduce((a,b)=>a+b,0),scenarioResults=scenarios.map(s=>{const portfolioReturn=s.returns.reduce((sum,r,j)=>sum+targetFractions[j]*r,0);return {id:s.id,name:s.name,probability:s.probability,portfolioReturn,pnl:portfolioReturn*bankroll,wealth:1+portfolioReturn};});
 return {complete:true,issues:[],bankroll,bundles:rows,scenarios:scenarioResults,fractions:targetFractions,kellyFractions,fullFractions:solution.fractions,allocatedFraction,cashFraction:Math.max(0,1-allocatedFraction),expectedLogGrowth:objective(targetFractions,scenarios),pointExpectedLogGrowth:solution.expectedLogGrowth,iterations:solution.iterations,uncertaintyAware,monteCarlo,targetQuantile,atRiskLimitPct,atRiskLimit,hardStopMultiple,reviewMultiple:finite(data?.atrReviewMultiple)?Number(data.atrReviewMultiple):1.5,rawStopRisk,rawStopRiskFraction,estimatedStopRisk:rows.reduce((sum,row)=>sum+(row.estimatedStopRisk??0),0),estimatedStopRiskFraction:rows.reduce((sum,row)=>sum+(row.estimatedStopRiskFraction??0),0),riskScale,hasCompleteAtr,constraintIssue:atRiskLimitFraction&&!hasCompleteAtr?'部分 Underlying 缺少 ATR、Reference Spot 或可计算 Greeks，无法执行 Thesis At-Risk Limit':''};
}

export function kellyPolicyError(c,data){
 if(data.targetQuantile!=null&&![25,50,100].includes(Number(data.targetQuantile)))return 'Target Quantile 只支持 Q25、Q50 或 Q100';
 if(data.thesisAtRiskLimitPct!==''&&data.thesisAtRiskLimitPct!=null&&(!finite(data.thesisAtRiskLimitPct)||Number(data.thesisAtRiskLimitPct)<=0||Number(data.thesisAtRiskLimitPct)>100))return 'Thesis At-Risk Limit 必须在 0% 到 100% 之间或留空';
 const review=data.atrReviewMultiple??1.5,hardStop=data.atrHardStopMultiple??2.5;
 if(!finite(review)||Number(review)<=0)return 'ATR Review Multiple 必须大于 0';
 if(!finite(hardStop)||Number(hardStop)<=0)return 'ATR Hard-Stop Multiple 必须大于 0';
 if(Number(hardStop)<=Number(review))return 'ATR Hard-Stop Multiple 必须大于 ATR Review Multiple';
 return '';
}
