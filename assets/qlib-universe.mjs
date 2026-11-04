export function parseSymbols(text){
  const symbols=[...new Set(text.toUpperCase().split(/[\s,;，；]+/).filter(Boolean))].sort();
  if(symbols.some(s=>! /^[A-Z][A-Z0-9.\-]{0,14}$/.test(s)))throw Error('Invalid ticker format.');
  return symbols;
}
export function previewSymbols(base,profile,groups,{keepBenchmark=false}={}){
  const selected=new Set(profile.include_base?base:[]);
  groups.filter(g=>profile.groups.includes(g.id)).forEach(g=>g.symbols.forEach(s=>selected.add(s)));
  profile.include.forEach(s=>selected.add(s));profile.exclude.forEach(s=>selected.delete(s));
  return [...selected].filter(s=>keepBenchmark||s!=='SPY').sort();
}
export function numberInput(value,{scale=1,nullable=false}={}){
  if(value.trim()==='')return nullable?null:0;
  const result=Number(value)*scale;
  if(!Number.isFinite(result)||result<0)throw Error('Filter values must be finite, nonnegative numbers.');
  return result;
}
