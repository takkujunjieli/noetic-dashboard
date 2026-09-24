import {createCase,record,clone} from './workflow-model.mjs';
import {normalizePortfolio,bindingFromSelection,reconcilePositions,liveClaims} from './position-link.mjs';
export function sourceCatalog(policy,portfolio,localPolicy={},groups={}){
 const merged={...policy,...localPolicy,bundles:localPolicy?.bundles&&Object.keys(localPolicy.bundles).length?localPolicy.bundles:policy.bundles||{}};
 const assignments={...policy.assignments,...localPolicy.assignments,...groups};
 let source=null,error='';try{source=normalizePortfolio(portfolio);}catch(e){error=e.message;}
 return {policy:merged,source,error,items:Object.entries(merged.bundles).map(([name,bundle])=>{
  const symbols=Object.keys(assignments).filter(s=>assignments[s]===name).map(s=>s.toUpperCase());
  return {name,bundle,symbols,rows:source?.rows.filter(r=>symbols.includes(r.underlying)||symbols.includes(r.symbol.toUpperCase()))||[]};
 })};
}
export function linkSource(item,catalog,cases){
 if(cases.some(c=>c.sourceLink?.name===item.name))throw Error('此来源已关联，请打开已有实例');
 const c=createCase({title:item.name,symbol:item.symbols.length===1?item.symbols[0]:'',horizon:item.bundle.shelf||'',rationale:item.bundle.edge||''});
 c.linkedSymbols=[...new Set([...item.symbols,...item.rows.map(r=>r.underlying)])];
 c.sourceLink={kind:'risk-policy',name:item.name,linkedAt:new Date().toISOString(),symbols:c.linkedSymbols};
 c.nodes.hypothesis.data.invalidation=item.bundle.invalid||'';
 c.nodes.signal.data.indicator='';
 c.accountRiskSnapshot=JSON.stringify({policy:{...clone(catalog.policy),default_bundle:item.name},calculator:{entry:'100',mode:'manual',stop:'94',atr:'3'},done:[]});
 const skipped=[];const eligible=item.rows.filter(r=>{
  const reason=r.entry===''?'缺少成本':!r.sourceAt?'缺少券商源时间':liveClaims(cases,r.key).length?'已被其他 Workflow 分配':'';
  if(reason)skipped.push(`${r.symbol}：${reason}`);return !reason;
 });
 if(eligible.length){const binding=bindingFromSelection(c,cases,catalog.source,eligible.map(r=>({key:r.key,mode:'all',qty:r.qty})));c.nodes.positions.data=reconcilePositions(c,cases,catalog.source,binding);c.nodes.positions.state='running';}
 c.sourceLink.warnings=skipped;
 record(c,'关联现有 Thesis','hypothesis','读取现有论点、风险参数与 Portfolio 分组；源数据保持不变');
 return c;
}
