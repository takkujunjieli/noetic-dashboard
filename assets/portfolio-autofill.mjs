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
  entry:finite(row.mark)?+row.mark:'',strike:row.strike,expiry:row.expiry,
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
  // Draft valuation starts at the latest available market observation, never
  // acquisition cost. Option premiums and underlying prices have separate units.
  const spotQuotes=rows.map(row=>({price:row.type==='stock'?row.mark:row.underlyingPrice,at:Date.parse(row.priceAt||row.sourceAt)||0}))
   .filter(quote=>finite(quote.price)&&+quote.price>0).sort((a,b)=>b.at-a.at);
  const spot=spotQuotes[0]?.price??'';
  const legs=rows.map(row=>legFrom(row,spot));
  // Gross absolute market value is an explicit capital proxy, not broker margin.
  // Missing marks leave the denominator incomplete rather than falling back to cost.
  const referenceCapital=rows.every(row=>finite(row.mark))?rows.reduce((sum,row)=>
   sum+Math.abs(row.qty*row.mark*(row.type==='stock'?1:100)),0):null;
  const heldIvs=rows.filter(row=>row.type!=='stock'&&finite(row.iv)&&+row.iv>0).map(row=>+row.iv).sort((a,b)=>a-b),heldIv=heldIvs.length?heldIvs[Math.floor(heldIvs.length/2)]:null,marketIv=referenceIvByUnderlying[underlying],referenceIv=marketIv?.iv??heldIv??'';
  const draft={structureVersion:1,greekScale:10000,template:'custom',evaluationDate:'',candidate:{version:1,underlying,instrument:'stock',referenceCapital:referenceCapital?Math.round(referenceCapital*100)/100:'',referenceIv,referenceIvAt:marketIv?.at||(heldIv!=null?source.builtAt:''),referenceIvDte:marketIv?.dte??'',targetDte:'',longDelta:'',shortDelta:'',plannedEntry:''},legs};
  draft.candidate.instrument=inferInstrument(draft);
  return {underlying,construction:draft,positionCount:rows.length};
 });
 return {bundles,matchedPositions:matched.length,unsupported:source.unsupported,sourceAt:source.builtAt,names:[...names]};
}
