import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSizing,calculateManualSizing,estimatePositionRisk,accountContext,candidateRisk,allocationIssues,saveAccountField,mergePolicy} from '../assets/risk-budget.mjs';
import {demoCase,saveNode,validateStore,VERSION,clone} from '../assets/workflow-model.mjs';
const sizing={equity:10000,entry:100,stop:95,atr:2,mode:'manual',side:'long',risk_pct:1,total_risk_pct:3,atr_mult:2,max_position_pct:'',total_position_pct:'',optionRisk:''};
const policy={account_equity:10000,default_bundle:'base',bundles:{base:{risk_pct:1,total_risk_pct:3,atr_mult:2}},assignments:{}};
test('same stock calculator: manual, ATR, cap and short direction',()=>{
 let r=calculateSizing(sizing);assert.equal(r.shares,20);assert.equal(r.actualRisk,100);assert.equal(r.totalPositionPct,60);
 r=calculateSizing({...sizing,mode:'atr'});assert.equal(r.stop,96);assert.equal(r.shares,25);
 r=calculateSizing({...sizing,max_position_pct:10});assert.equal(r.shares,10);assert.equal(r.capped,true);
 r=calculateSizing({...sizing,side:'short',stop:105});assert.equal(r.shares,20);
 assert.match(calculateSizing({...sizing,stop:''}).error,/止损/);assert.match(calculateSizing({...sizing,total_risk_pct:''}).error,/必填|先填写/);
});
test('standalone Portfolio calculator uses equity, risk, entry and stop without requiring ATR fields',()=>{
 let r=calculateManualSizing({equity:10000,riskPct:2,entry:100,stop:94});assert.equal(r.shares,33);assert.equal(r.positionValue,3300);assert.equal(r.actualRisk,198);assert.equal(r.capped,false);
 r=calculateManualSizing({equity:10000,riskPct:2,entry:100,stop:94,maxPositionPct:20});assert.equal(r.shares,20);assert.equal(r.positionValue,2000);assert.equal(r.capped,true);
 assert.match(calculateManualSizing({equity:10000,riskPct:2,entry:100,stop:101}).error,/止损价/);
});
test('current risk uses stop-distance for stocks and explicit market-value proxy for options',()=>{
 assert.equal(estimatePositionRisk({position:{kind:'equity',qty:-10,price:100},stop:105}).risk,50);
 assert.equal(estimatePositionRisk({position:{kind:'equity',qty:10,price:100},stop:105}).risk,0);
 const opt=estimatePositionRisk({position:{kind:'option',qty:-1,mkt_value:-200},stop:5});assert.equal(opt.risk,200);assert.equal(opt.proxy,true);assert.equal(opt.stop,5);
});
test('account missing exposure never becomes zero; honors existing small-stock filter',()=>{
 const portfolio={positions:[{kind:'equity',sym:'A',qty:10,price:100},{kind:'equity',sym:'B',qty:1,price:50}],accounts:[]};
 let c=accountContext({policy,portfolio,maxHeat:5});assert.equal(c.used,null);assert.equal(c.unknown,1);assert.equal(c.count,1);
 c=accountContext({policy,portfolio,maxHeat:5,atr:{A:2}});assert.equal(c.used,40);assert.equal(c.budget,500);
 assert.equal(accountContext({policy,portfolio:null,maxHeat:5}).used,null);
 assert.equal(accountContext({policy,portfolio:{positions:[]},maxHeat:5}).used,0);
});
test('shared writes preserve other theses and equity works without local bundles',()=>{
 const m=new Map([['riskPolicy',JSON.stringify({bundles:{keep:{risk_pct:3}},default_bundle:'keep',unknown:'preserve'})]]);
 const storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};
 saveAccountField(storage,'equity',12000);const p=JSON.parse(m.get('riskPolicy'));assert.deepEqual(p.bundles,{keep:{risk_pct:3}});assert.equal(p.unknown,'preserve');
 saveAccountField(storage,'maxHeat',8);assert.equal(m.get('riskMaxHeat'),'8');assert.equal(m.get('riskPolicyDirty'),'true');
 assert.equal(mergePolicy(policy,{account_equity:14000}).account_equity,14000);assert.deepEqual(mergePolicy(policy,{account_equity:14000}).bundles,policy.bundles);
 assert.throws(()=>saveAccountField(storage,'equity',-1));
});
test('incremental risk checks account room without netting existing positions; options require explicit estimate',()=>{
 const legs=[{type:'stock',side:'long',qty:20,entry:100}];const c={equity:10000,used:450,budget:500};assert.equal(candidateRisk(sizing,legs).risk,100);assert.match(allocationIssues(sizing,c,legs).join(),/剩余/);
 legs.push({type:'put',side:'short',qty:1,entry:3});assert.equal(candidateRisk(sizing,legs).risk,null);assert.equal(candidateRisk({...sizing,optionRisk:50},legs).risk,150);
});
test('risk assessment snapshots roundtrip and remain frozen after account setting changes',()=>{
 const c=demoCase(),snapshot=accountContext({policy,portfolio:{positions:[]},maxHeat:5});const d={...c.nodes.risk.data,sizing:{...sizing},accountSnapshot:snapshot};
 saveNode(c,'risk',d);const before=clone(c.events.at(-1).snapshot);snapshot.equity=50000;
 assert.equal(c.nodes.risk.data.accountSnapshot.equity,10000);assert.equal(before.nodes.risk.data.accountSnapshot.equity,10000);validateStore(JSON.parse(JSON.stringify({version:VERSION,cases:[c]})));
});
