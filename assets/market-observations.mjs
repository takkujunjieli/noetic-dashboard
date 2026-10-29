export function sortObservations(rows,period='20',metric='momentum',direction='desc'){
  const sign=direction==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    if(metric==='symbol')return a.symbol.localeCompare(b.symbol)*sign;
    const x=metric==='price'?a.price:a.periods?.[period]?.[metric],y=metric==='price'?b.price:b.periods?.[period]?.[metric];
    const valid=v=>typeof v==='number'&&Number.isFinite(v);
    if(!valid(x))return valid(y)?1:a.symbol.localeCompare(b.symbol);
    if(!valid(y))return -1;
    return (x-y)*sign||a.symbol.localeCompare(b.symbol);
  });
}
