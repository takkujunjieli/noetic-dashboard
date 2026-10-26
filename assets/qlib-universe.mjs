export function parseSymbols(text){
  const symbols=[...new Set(text.toUpperCase().split(/[\s,;，；]+/).filter(Boolean))].sort();
  if(symbols.some(s=>! /^[A-Z][A-Z0-9.\-]{0,14}$/.test(s)))throw Error('股票代码格式无效');
  return symbols;
}
export function previewSymbols(base,profile,groups){
  const selected=new Set(profile.include_base?base:[]);
  groups.filter(g=>profile.groups.includes(g.id)).forEach(g=>g.symbols.forEach(s=>selected.add(s)));
  profile.include.forEach(s=>selected.add(s));profile.exclude.forEach(s=>selected.delete(s));
  return [...selected].filter(s=>s!=='SPY').sort();
}
export function numberInput(value,{scale=1,nullable=false}={}){
  if(value.trim()==='')return nullable?null:0;
  const result=Number(value)*scale;
  if(!Number.isFinite(result)||result<0)throw Error('筛选参数必须为非负数字');
  return result;
}
