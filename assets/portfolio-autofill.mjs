import {normalizePortfolio} from './position-link.mjs';
import {inferInstrument,newStructureLeg} from './trade-structure.mjs';

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
 const cents=x=>finite(x)?Math.round(+x*100)/100:'';
 const leg={...newStructureLeg(row.type,row.side,row.qty),underlying:row.underlying,
  entry:cents(row.mark!==''?row.mark:row.entry),strike:row.strike,expiry:row.expiry,
  underlyingPrice:cents(finite(row.underlyingPrice)?row.underlyingPrice:spot),
  delta:row.type==='stock'||!finite(row.delta)?'':Math.round(Math.abs(row.delta)*10000),gamma:row.type==='stock'||!finite(row.gamma)?'':Math.round(Math.abs(row.gamma)*10000),
  theta:row.type==='stock'||!finite(row.theta)?'':Math.round(Math.abs(row.theta)*10000),vega:row.type==='stock'||!finite(row.vega)?'':Math.round(Math.abs(row.vega)*10000),
  iv:row.type==='stock'?'':row.iv,quoteAt:row.priceAt||row.sourceAt||''};
 return leg;
}

export function portfolioBundleDrafts(c,rawPortfolio,policy={},localAssignments={}){
 const source=normalizePortfolio(rawPortfolio),assignments=mergedPortfolioAssignments(policy,localAssignments),names=thesisNames(c);
 const matched=source.rows.filter(row=>names.has(String(assignedThesis(row,assignments)||'').trim()));
 const groups=new Map();
 for(const row of matched){const rows=groups.get(row.underlying)||[];rows.push(row);groups.set(row.underlying,rows);}
 const bundles=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([underlying,rows])=>{
  const equity=rows.find(row=>row.type==='stock'&&finite(row.mark)),spot=equity?.mark??rows.find(row=>finite(row.underlyingPrice))?.underlyingPrice??'';
  const legs=rows.map(row=>legFrom(row,spot));
  const referenceCapital=rows.reduce((sum,row)=>{
   const mark=row.mark!==''?row.mark:row.entry;if(!finite(mark))return sum;
   return sum+Math.abs(row.qty*+mark*(row.type==='stock'?1:100));
  },0);
  const draft={structureVersion:1,greekScale:10000,template:'custom',evaluationDate:'',candidate:{version:1,underlying,instrument:'stock',referenceCapital:referenceCapital?Math.round(referenceCapital):'',targetDte:'',longDelta:'',shortDelta:'',plannedEntry:''},legs};
  draft.candidate.instrument=inferInstrument(draft);
  return {underlying,construction:draft,positionCount:rows.length};
 });
 return {bundles,matchedPositions:matched.length,unsupported:source.unsupported,sourceAt:source.builtAt,names:[...names]};
}
