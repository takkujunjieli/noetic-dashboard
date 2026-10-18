const finite=value=>value!==''&&value!=null&&Number.isFinite(Number(value));

// Aggregate before calculating percentages or applying the small-stock filter.
// Opposite directions and different option contracts remain independent exposures.
export function mergeAccountPositions(positions=[]){
 const groups=new Map();
 for(const [index,position] of positions.entries()){
  if(!finite(position.qty)||Number(position.qty)===0)continue;
  const kind=position.kind||'equity',sym=String(position.sym||'').trim().toUpperCase();
  const completeContract=/\d{4}-\d{2}-\d{2}\s+[\d.]+[CP]$/.test(sym)||/\d{6}[CP]\d{8}$/.test(sym);
  // Never combine ambiguous legacy option labels or adjusted multipliers.
  const contract=kind==='equity'?null:completeContract?Number(position.multiplier)||100:`unresolved:${index}`;
  const key=JSON.stringify([kind,sym,Number(position.qty)>0?'long':'short',contract]);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(position);
 }
 return [...groups.values()].map(members=>{
  const quantity=members.reduce((sum,p)=>sum+Math.abs(Number(p.qty)),0);
  const weighted=field=>members.every(p=>finite(p[field]))
   ? members.reduce((sum,p)=>sum+Math.abs(Number(p.qty))*Number(p[field]),0)/quantity:null;
  const sumKnown=values=>values.every(finite)?values.reduce((sum,value)=>sum+Number(value),0):null;
  const signedQty=Number(members.reduce((sum,p)=>sum+Number(p.qty),0).toPrecision(12));
  const marketValues=members.map(p=>finite(p.mkt_value)?Number(p.mkt_value):finite(p.price)?Number(p.qty)*Number(p.price):null);
  const pnls=members.map(p=>finite(p.pnl)?Number(p.pnl):finite(p.price)&&finite(p.avg_cost)?Number(p.qty)*(Number(p.price)-Number(p.avg_cost)):null);
  const pnl=sumKnown(pnls),avgCost=weighted('avg_cost'),basis=avgCost==null?null:quantity*avgCost;
  return {...members[0],kind:members[0].kind||'equity',sym:String(members[0].sym||'').trim().toUpperCase(),
   account:'ALL',qty:signedQty,price:weighted('price'),avg_cost:avgCost,
   mkt_value:sumKnown(marketValues),pnl,pnl_pct:pnl!=null&&basis>0?pnl/basis:null,
   source_positions:members};
 });
}
