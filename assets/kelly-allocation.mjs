import {deriveBaseScenario,greekScenarioMatrix,scenarioUnderwriting,scenarioUnderwritingError} from './expected-return.mjs?v=20261015-atr-uncertainty';
import {bundleMetrics} from './trade-structure.mjs';

const finite=value=>value!==''&&value!=null&&Number.isFinite(Number(value));
const EPS=1e-12;
const ELIGIBILITY_EPS=1e-9;
export const RISK_WEIGHTING_METHOD='equal-atr-risk-kelly-v1';
export const DEFAULT_KELLY_TILT_PCT=25;
export const KELLY_FRACTION=0.5;
export const SIZING_METHOD='half-kelly-at-risk-v1';
export const emptyKellyPolicy=()=>({allocationVersion:2,thesisAtRiskLimitPct:'',atrStopMultiple:2.5,kellyTiltPct:DEFAULT_KELLY_TILT_PCT});

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
function hasUncertainty(data){const d=scenarioUnderwriting(data);return Number(d.probabilityUncertainty)>0||Number(d.atrMultiple)>0||Number(d.ivUncertaintyRatio)>0;}
function uncertaintyIssues(data,bundles,atrByUnderlying={}){
 const d=scenarioUnderwriting(data),issues=[];
 for(const bundle of bundles){const m=bundleMetrics(bundle.construction),hasOption=(bundle.construction?.legs||[]).some(leg=>leg.type!=='stock');
  if(Number(d.atrMultiple)>0&&(!(Number(atrByUnderlying?.[m.underlying])>0)||!(Number(m.referenceSpot)>0)))issues.push(`${m.underlying||bundle.name} 缺少 ATR 或 Reference Spot，无法计算 Price Move uncertainty`);
  if(Number(d.ivUncertaintyRatio)>0&&hasOption&&!(Number(m.referenceIv)>0))issues.push(`${m.underlying||bundle.name} 缺少 Reference IV，无法计算 Option uncertainty`);
 }
 return issues;
}
const normalized=values=>{const total=values.reduce((sum,x)=>sum+Math.max(0,x),0);return total>EPS?values.map(x=>Math.max(0,x)/total):values.map(()=>0);};

// Equal risk across underlyings, then across bundles within each underlying.
// Mix in risk space: equal capital would give leveraged options more risk.
export function diversifiedRiskWeights(rows,kellyFractions,kellyTiltPct=DEFAULT_KELLY_TILT_PCT){
 if(!finite(kellyTiltPct)||Number(kellyTiltPct)<0||Number(kellyTiltPct)>100)throw Error('Kelly Tilt 须在 0% 到 100% 之间');
 if(rows.length!==kellyFractions.length||rows.some(row=>!row.underlying||!Number.isFinite(row.stopRiskRate)||row.stopRiskRate<=EPS))throw Error('风险等权需要每个 Bundle 有正的独立 ATR 风险率');
 const groups=new Map();for(const row of rows){const key=row.underlying.toUpperCase();groups.set(key,(groups.get(key)||0)+1);}
 const baselineRiskShares=rows.map(row=>1/groups.size/groups.get(row.underlying.toUpperCase()));
 const baselineWeights=normalized(rows.map((row,i)=>baselineRiskShares[i]/row.stopRiskRate));
 const kellyRiskShares=normalized(rows.map((row,i)=>kellyFractions[i]*row.stopRiskRate));
 const alpha=kellyRiskShares.some(x=>x>0)?Number(kellyTiltPct)/100:0;
 const riskShares=baselineRiskShares.map((q,i)=>(1-alpha)*q+alpha*kellyRiskShares[i]);
 const weights=normalized(rows.map((row,i)=>riskShares[i]/row.stopRiskRate));
 return {baselineRiskShares,baselineWeights,kellyRiskShares,riskShares,weights};
}

export function atrStopProfile(netDelta,netGamma,distance){
 if(!Number.isFinite(netDelta)||!Number.isFinite(netGamma)||!(Number(distance)>0))return null;
 const d=Number(distance),points=[-d,0,d];
 if(Math.abs(netGamma)>EPS){const stationary=-netDelta/netGamma;if(stationary>-d&&stationary<d)points.push(stationary);}
 const candidates=[...new Set(points)].map(move=>({move,pnl:netDelta*move+.5*netGamma*move*move})),worst=candidates.reduce((a,b)=>b.pnl<a.pnl?b:a);
 const stopRisk=Math.max(0,-worst.pnl),direction=stopRisk<=EPS?null:Math.abs(worst.move+d)<=EPS?'down':Math.abs(worst.move-d)<=EPS?'up':'interior';
 return {downStopPnl:candidates.find(x=>x.move===-d).pnl,upStopPnl:candidates.find(x=>x.move===d).pnl,adverseStopMove:stopRisk>EPS?worst.move:null,adverseStopPnl:stopRisk>EPS?worst.pnl:null,adverseStopDirection:direction,stopRisk};
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

// Optimize the cash/mix split without normalizing fractional Kelly cash away.
export function fractionalKellyCap(scenarios,weights){
 const states=scenarios.map(s=>({p:s.probability,r:s.returns.reduce((sum,r,i)=>sum+r*weights[i],0)}));
 const derivative=a=>states.reduce((sum,s)=>s.p<=0?sum:1+a*s.r<=0?-Infinity:sum+s.p*s.r/(1+a*s.r),0);
 if(derivative(0)<=EPS)return 0;
 if(derivative(1)>=0)return KELLY_FRACTION;
 let lo=0,hi=1;
 for(let i=0;i<70;i++){const mid=(lo+hi)/2;if(derivative(mid)>0)lo=mid;else hi=mid;}
 return KELLY_FRACTION*(lo+hi)/2;
}

// Every uncertainty draw contributes its Bull/Base/Bear states to one joint
// optimization. Component-wise quantiles are deliberately not combined.
// Bounded caches retain only valuation inputs, never thesis history or snapshots.
const monteCarloCache=new Map(),allocationCache=new Map();
function remember(cache,key,value){if(cache.size>=24)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}
function calculationInputs(data,bundles,atr,samples){return JSON.stringify({data,bundles:bundles.map(b=>({id:b.id,construction:b.construction})),atr:bundles.map(b=>{const u=bundleMetrics(b.construction).underlying;return [u,atr?.[u]??null];}),samples});}
export function monteCarloKelly(data,bundles,atrByUnderlying={},samples=500){
 const key=calculationInputs(scenarioUnderwriting(data),bundles,atrByUnderlying,samples);
 if(monteCarloCache.has(key))return structuredClone(monteCarloCache.get(key));
 return structuredClone(remember(monteCarloCache,key,calculateMonteCarloKelly(data,bundles,atrByUnderlying,samples)));
}
function calculateMonteCarloKelly(data,bundles,atrByUnderlying={},samples=500){
 const d=scenarioUnderwriting(data),random=rng(hashSeed({d,bundles:bundles.map(b=>b.id),atrByUnderlying,samples})),scenarios=[];let accepted=0;
 for(let k=0;k<samples;k++){
  const sampled=JSON.parse(JSON.stringify(d)),bull=sampled.scenarios.find(s=>s.id==='bull'),bear=sampled.scenarios.find(s=>s.id==='bear'),probabilityRange=Number(d.probabilityUncertainty)||0;
  bull.probability=sampleAround(bull.probability,probabilityRange,random,0);bear.probability=sampleAround(bear.probability,probabilityRange,random,0);const sideTotal=bull.probability+bear.probability;if(sideTotal>100){bull.probability=bull.probability/sideTotal*100;bear.probability=bear.probability/sideTotal*100;}
  for(const s of [bull,bear])for(const b of bundles){const move=s.moves[b.id],m=bundleMetrics(b.construction),atr=Number(atrByUnderlying?.[m.underlying]),priceRange=atr>0&&m.referenceSpot>0?(Number(d.atrMultiple)||0)*atr/m.referenceSpot*100:0,ivRange=m.referenceIv>0?m.referenceIv*(Number(d.ivUncertaintyRatio)||0):0;move.priceMove=sampleAround(move.priceMove,priceRange,random,-100);if(move.ivChange!==''&&move.ivChange!=null)move.ivChange=sampleAround(move.ivChange,ivRange,random);}
  sampled.scenarios=[bull,deriveBaseScenario(bull,bear,bundles.map(b=>b.id)),bear];
  const matrix=greekScenarioMatrix(sampled,bundles);if(matrix.rows.some(row=>row.cells.some(cell=>cell.returnRate==null)))continue;
  accepted++;for(const row of matrix.rows)scenarios.push({probability:row.probability/100/samples,returns:row.cells.map(cell=>cell.returnRate/100)});
 }
 if(!accepted)return null;
 const mass=scenarios.reduce((sum,s)=>sum+s.probability,0);for(const s of scenarios)s.probability/=mass;
 return {samples:accepted,scenarios,...solveKelly(scenarios,bundles.length)};
}

export function riskBudgetAllocation(c,data=c.nodes.risk.data,atrByUnderlying={}){
 const key=calculationInputs({underwriting:c.nodes.returns.data,policy:data},c.design?.plans||[],atrByUnderlying);
 if(allocationCache.has(key))return structuredClone(allocationCache.get(key));
 return structuredClone(remember(allocationCache,key,calculateRiskBudgetAllocation(c,data,atrByUnderlying)));
}
function calculateRiskBudgetAllocation(c,data=c.nodes.risk.data,atrByUnderlying={}){
 const bundles=c.design?.plans||[],matrix=greekScenarioMatrix(c.nodes.returns.data,bundles),underwritingError=scenarioUnderwritingError(c.nodes.returns.data,bundles),issues=[];
 const atRiskLimitPct=finite(data?.thesisAtRiskLimitPct)&&Number(data.thesisAtRiskLimitPct)>0?Number(data.thesisAtRiskLimitPct):null,atRiskLimitFraction=atRiskLimitPct==null?null:atRiskLimitPct/100;
 const atrStopMultiple=finite(data?.atrStopMultiple)&&Number(data.atrStopMultiple)>0?Number(data.atrStopMultiple):(finite(data?.atrHardStopMultiple)&&Number(data.atrHardStopMultiple)>0?Number(data.atrHardStopMultiple):2.5);
 if(!bundles.length)issues.push('先在 Portfolio Construction 添加 Underlying Greek Bundle');
 const policyError=kellyPolicyError(c,data);if(policyError)issues.push(policyError);
 if(underwritingError)issues.push(underwritingError);
 issues.push(...uncertaintyIssues(c.nodes.returns.data,bundles,atrByUnderlying));
 if(atRiskLimitFraction==null)issues.push('请填写 Thesis At-Risk Limit');
 if(!matrix.rows.every(row=>row.cells.every(cell=>cell.returnRate!=null))&&!underwritingError)issues.push('联合情景收益不完整');
 if(issues.length)return {complete:false,issues:[...new Set(issues)],bundles:[],scenarios:[],fractions:[],allocatedFraction:0,cashFraction:1,expectedLogGrowth:null,constraintIssue:''};

 const scenarios=matrix.rows.map(row=>({id:row.id,name:row.name,probability:Number(row.probability)/100,returns:row.cells.map(cell=>cell.returnRate/100)}));
 const pointSolution=solveKelly(scenarios,bundles.length),uncertaintyAware=hasUncertainty(c.nodes.returns.data),monteCarlo=uncertaintyAware?monteCarloKelly(c.nodes.returns.data,bundles,atrByUnderlying):null;
 const weightSolution=monteCarlo||pointSolution,kellyFractions=weightSolution.fractions,kellyWeights=normalized(kellyFractions),hasPositiveKelly=kellyWeights.some(x=>x>0)&&weightSolution.expectedLogGrowth>EPS,constraintIssues=[];
 const kellyTiltPct=Number(data?.kellyTiltPct??DEFAULT_KELLY_TILT_PCT),targetScenarios=monteCarlo?.scenarios||scenarios;
 const standaloneExpectedReturns=bundles.map((_,index)=>targetScenarios.reduce((sum,s)=>sum+s.probability*s.returns[index],0));
 const preliminary=bundles.map((bundle,index)=>{
  const metrics=bundleMetrics(bundle.construction),referenceCapital=Number(metrics.referenceCapital),atr=Number(atrByUnderlying?.[metrics.underlying]),spot=Number(metrics.referenceSpot),distance=atr>0?atr*atrStopMultiple:null;
  const canPriceStop=distance!=null&&Number.isFinite(spot)&&metrics.netDelta!=null&&metrics.netGamma!=null&&referenceCapital>0;
  const stop=canPriceStop?atrStopProfile(metrics.netDelta,metrics.netGamma,distance):null,stopRisk=stop?.stopRisk??null,stopRiskRate=stopRisk==null?null:stopRisk/referenceCapital;
  const eligible=standaloneExpectedReturns[index]>ELIGIBILITY_EPS||kellyFractions[index]>ELIGIBILITY_EPS,exclusionReason=eligible?'':'独立预期收益非正且 Kelly 权重为 0；请修改参数或从 Portfolio Construction 剔除';
  return {bundleId:bundle.id,name:metrics.underlying||bundle.name,underlying:metrics.underlying,eligible,exclusionReason,standaloneExpectedReturn:standaloneExpectedReturns[index],fullFraction:pointSolution.fractions[index],kellyFraction:kellyFractions[index],kellyWeight:kellyWeights[index],referenceCapital,referencePrice:Number.isFinite(spot)&&spot>0?spot:null,atr:Number.isFinite(atr)&&atr>0?atr:null,stopDistance:distance,downStopPrice:distance==null?null:spot-distance,upStopPrice:distance==null?null:spot+distance,adverseStopPrice:stop?.adverseStopMove==null?null:spot+stop.adverseStopMove,...stop,stopRisk,stopRiskRate};
 });
 const eligibleRows=preliminary.filter(row=>row.eligible),eligibleKelly=kellyFractions.filter((_,index)=>preliminary[index].eligible);
 const canDiversify=eligibleRows.length>0&&eligibleRows.every(row=>row.underlying&&Number.isFinite(row.stopRiskRate)&&row.stopRiskRate>EPS);
 if(hasPositiveKelly&&!canDiversify)for(const row of eligibleRows){
  if(!row.underlying||row.stopRiskRate==null||!Number.isFinite(row.stopRiskRate))constraintIssues.push(`${row.name} 缺少 ATR、Reference Spot、Reference Capital 或可计算 Greeks，无法参与风险等权`);
  else if(row.stopRiskRate<=EPS)constraintIssues.push(`${row.name} 独立 ATR 风险估计为 0，无法作为风险等权的分母；请检查结构与 Greeks，不能视为无风险`);
 }
 const zero=bundles.map(()=>0),compact=canDiversify?diversifiedRiskWeights(eligibleRows,eligibleKelly,kellyTiltPct):null,expand=values=>{let j=0;return preliminary.map(row=>row.eligible?values[j++]:0);};
 const diversified=compact?{baselineRiskShares:expand(compact.baselineRiskShares),baselineWeights:expand(compact.baselineWeights),kellyRiskShares:expand(compact.kellyRiskShares),riskShares:expand(compact.riskShares),weights:expand(compact.weights)}:{baselineRiskShares:zero,baselineWeights:zero,kellyRiskShares:zero,riskShares:zero,weights:zero};
 const mixedExpectedReturn=targetScenarios.reduce((sum,s)=>sum+s.probability*s.returns.reduce((v,r,j)=>v+r*diversified.weights[j],0),0);
 if(hasPositiveKelly&&canDiversify&&mixedExpectedReturn<=EPS)constraintIssues.push('分散后组合预期收益非正；请复核候选 Bundle 与情景，系统不会为用满预算自动剔除较弱标的');
 const hasAllocation=hasPositiveKelly&&canDiversify&&!constraintIssues.length,effectiveWeights=hasAllocation?diversified.weights:zero;
 // Stop Risk sums each Bundle's independently adverse ATR direction.
 const stopRiskRate=hasAllocation?preliminary.reduce((sum,row,i)=>sum+effectiveWeights[i]*row.stopRiskRate,0):null;
 // Scenario Risk preserves each user-defined joint Bull/Base/Bear relative move.
 const scenarioWeightReturns=scenarios.map(s=>s.returns.reduce((sum,r,j)=>sum+effectiveWeights[j]*r,0)),scenarioRiskRate=hasPositiveKelly?Math.max(0,...scenarioWeightReturns.map(r=>-r)):0,effectiveLossRate=stopRiskRate==null?null:Math.max(stopRiskRate,scenarioRiskRate);
 if(hasPositiveKelly&&effectiveLossRate!=null&&effectiveLossRate<=EPS)constraintIssues.push('分散权重下 Stop Risk 与 Scenario Risk 均为 0，无法用 At-Risk 推导仓位');
 const halfKellyCap=hasAllocation?fractionalKellyCap(targetScenarios,effectiveWeights):0;
 const atRiskCap=effectiveLossRate>EPS?Math.min(1,atRiskLimitFraction/effectiveLossRate):null;
 const allocatedFraction=hasAllocation&&atRiskCap!=null?Math.min(halfKellyCap,atRiskCap):0,targetFractions=effectiveWeights.map(weight=>weight*allocatedFraction);
 const limitingConstraint=!hasAllocation||halfKellyCap<=EPS?'cash':halfKellyCap<=atRiskCap?'half-kelly':'at-risk';
 const bullIndex=scenarios.findIndex(s=>s.id==='bull'),bearIndex=scenarios.findIndex(s=>s.id==='bear');
 const rows=preliminary.map((row,index)=>({...row,bullPriceMove:bullIndex<0?null:matrix.rows[bullIndex]?.cells[index]?.priceMove??null,bearReturn:bearIndex<0?null:scenarios[bearIndex].returns[index],baselineRiskShare:diversified.baselineRiskShares[index],baselineWeight:diversified.baselineWeights[index],kellyRiskShare:diversified.kellyRiskShares[index],riskShare:hasAllocation?diversified.riskShares[index]:0,weight:effectiveWeights[index],fraction:targetFractions[index],estimatedStopRiskFraction:row.stopRiskRate==null?null:targetFractions[index]*row.stopRiskRate}));
 const scenarioResults=scenarios.map((s,index)=>{const weightReturn=scenarioWeightReturns[index],portfolioReturn=weightReturn*allocatedFraction;return {id:s.id,name:s.name,probability:s.probability,weightReturn,portfolioReturn,wealth:1+portfolioReturn};});
 for(const [index,row]of rows.entries()){row.riskBasis=structuredClone(bundles[index].construction);row.scenarioReturns=Object.fromEntries(scenarios.map(s=>[s.id,s.returns[index]]));}
 const expectedLogGrowth=objective(targetFractions,targetScenarios),bindingRisk=stopRiskRate==null?'':stopRiskRate>=scenarioRiskRate?'atr-stop':'scenario';
 return {complete:true,issues:[],sizingMethod:SIZING_METHOD,kellyFraction:KELLY_FRACTION,halfKellyCap,atRiskCap,limitingConstraint,weightingMethod:RISK_WEIGHTING_METHOD,kellyTiltPct,mixedExpectedReturn,bundles:rows,scenarios:scenarioResults,fractions:targetFractions,kellyFractions,fullFractions:pointSolution.fractions,weights:effectiveWeights,allocatedFraction,cashFraction:Math.max(0,1-allocatedFraction),expectedLogGrowth,kellyExpectedLogGrowth:weightSolution.expectedLogGrowth,pointExpectedLogGrowth:pointSolution.expectedLogGrowth,iterations:weightSolution.iterations,uncertaintyAware,monteCarlo:monteCarlo?{samples:monteCarlo.samples}:null,atRiskLimitPct,atRiskLimitFraction,atrStopMultiple,stopRiskRate,scenarioRiskRate,effectiveLossRate,bindingRisk,estimatedStopRiskFraction:rows.reduce((sum,row)=>sum+(row.estimatedStopRiskFraction??0),0),constraintIssue:constraintIssues.join('；'),hasPositiveKelly};
}

export const kellyAllocation=riskBudgetAllocation;

export function kellyPolicyError(c,data){
 const tilt=data?.kellyTiltPct??DEFAULT_KELLY_TILT_PCT;if(!finite(tilt)||Number(tilt)<0||Number(tilt)>100)return 'Kelly Tilt 须在 0% 到 100% 之间';
 if(data.thesisAtRiskLimitPct!==''&&data.thesisAtRiskLimitPct!=null&&(!finite(data.thesisAtRiskLimitPct)||Number(data.thesisAtRiskLimitPct)<=0||Number(data.thesisAtRiskLimitPct)>100))return 'Thesis At-Risk Limit 必须在 0% 到 100% 之间或留空';
 const atr=data.atrStopMultiple??data.atrHardStopMultiple??2.5;if(!finite(atr)||Number(atr)<=0)return 'ATR Stop Multiple 必须大于 0';
 return '';
}
