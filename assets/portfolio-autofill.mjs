import {normalizePortfolio} from './position-link.mjs';
import {inferInstrument,newStructureLeg} from './trade-structure.mjs?v=20261015-reference-iv';

const finite=x=>x!==''&&x!=null&&Number.isFinite(+x);
const thesisNames=c=>new Set([c?.title,c?.sourceLink?.name].map(x=>String(x||'').trim()).filter(Boolean));

export function mergedPortfolioAssignments(policy={},local={}){
 return {...(policy?.assignments||{}),...(local&&typeof local==='object'&&!Array.isArray(local)?local:{})};
}

function assignedThesis(row,assignments){
 // An explicit contract assignment wins. Otherwise an option follows its Underlying assignment.
 return Object.hasOwn(assignments,row.symbol)?assignments[row.symbol]:assignments[row.underlying];
}

function legFrom(row,spot){
 const leg={...newStructureLeg(row.type,row.side,row.qty),underlying:row.underlying,
  entry:finite(row.entry)?+row.entry:'',strike:row.strike,expiry:row.expiry,
  underlyingPrice:finite(spot)?+spot:'',
  delta:row.type==='stock'||!finite(row.delta)?'':Math.round(Math.abs(row.delta)*10000),gamma:row.type==='stock'||!finite(row.gamma)?'':Math.round(Math.abs(row.gamma)*10000),
  theta:row.type==='stock'||!finite(row.theta)?'':Math.round(Math.abs(row.theta)*10000),vega:row.type==='stock'||!finite(row.vega)?'':Math.round(Math.abs(row.vega)*10000),
  iv:row.type==='stock'?'':row.iv,quoteAt:row.priceAt||row.sourceAt||''};
 return leg;
}

export function latestReferenceIv(gexDaily={}){
 const result={};
 for(const day of Object.keys(gexDaily||{}).sort().reverse())for(const [underlying,row] of Object.entries(gexDaily[day]||{})){
  if(result[underlying]||!finite(row?.atm_iv)||+row.atm_iv<=0)continue;
  result[underlying]={iv:+row.atm_iv,at:day,dte:finite(row.atm_iv_dte)?+row.atm_iv_dte:''};
 }
 return result;
}

export function localReferenceIv(database={}){
 const result={};
 for(const [underlying,value] of Object.entries(database?.tickers||{})){
  const row=Array.isArray(value)?null:value,iv=row?.reference_iv??row?.atm_iv??row?.iv;
  if(!finite(iv)||+iv<=0)continue;
  result[String(underlying).toUpperCase()]={iv:+iv,at:row.observed_at??row.updated_at??database.updated_at??'',dte:finite(row.dte)?+row.dte:''};
 }
 return result;
}

export function portfolioBundleDrafts(c,rawPortfolio,policy={},localAssignments={},referenceIvByUnderlying={}){
 const source=normalizePortfolio(rawPortfolio),assignments=mergedPortfolioAssignments(policy,localAssignments),names=thesisNames(c);
 const matched=source.rows.filter(row=>names.has(String(assignedThesis(row,assignments)||'').trim()));
 const groups=new Map();
 for(const row of matched){const rows=groups.get(row.underlying)||[];rows.push(row);groups.set(row.underlying,rows);}
 const bundles=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([underlying,rows])=>{
  // Stock Reference Spot uses the quantity-weighted acquisition cost across
  // accounts. Keep source precision for calculations; the UI formats cents.
  // An option premium is not an underlying spot: option-only bundles retain
  // the explicitly supplied underlying reference price, never the premium.
  const equities=rows.filter(row=>row.type==='stock');
  const spot=equities.length?(equities.every(row=>finite(row.entry))
   ?equities.reduce((sum,row)=>sum+row.qty*row.entry,0)/equities.reduce((sum,row)=>sum+row.qty,0):'')
   :rows.find(row=>finite(row.underlyingPrice))?.underlyingPrice??'';
  const legs=rows.map(row=>legFrom(row,spot));
  // Missing cost must not turn into either a market-price cost or a partial
  // capital denominator. Short legs contribute their absolute cost exposure.
  const referenceCapital=rows.every(row=>finite(row.entry))?rows.reduce((sum,row)=>
   sum+Math.abs(row.qty*row.entry*(row.type==='stock'?1:100)),0):null;
  const heldIvs=rows.filter(row=>row.type!=='stock'&&finite(row.iv)&&+row.iv>0).map(row=>+row.iv).sort((a,b)=>a-b),heldIv=heldIvs.length?heldIvs[Math.floor(heldIvs.length/2)]:null,marketIv=referenceIvByUnderlying[underlying],referenceIv=marketIv?.iv??heldIv??'';
  const draft={structureVersion:1,greekScale:10000,template:'custom',evaluationDate:'',candidate:{version:1,underlying,instrument:'stock',referenceCapital:referenceCapital?Math.round(referenceCapital*100)/100:'',referenceIv,referenceIvAt:marketIv?.at||(heldIv!=null?source.builtAt:''),referenceIvDte:marketIv?.dte??'',targetDte:'',longDelta:'',shortDelta:'',plannedEntry:''},legs};
  draft.candidate.instrument=inferInstrument(draft);
  return {underlying,construction:draft,positionCount:rows.length};
 });
 return {bundles,matchedPositions:matched.length,unsupported:source.unsupported,sourceAt:source.builtAt,names:[...names]};
}
