import test from 'node:test';
import assert from 'node:assert/strict';
import {newStructureLeg,templateLegs,structureDraft,structureError,structureExposure} from '../assets/trade-structure.mjs';
import {createCase,saveNode,scenario,exposure,savePlan,setActivePlan,deletePlan,selectPlan,record,validateStore,clone} from '../assets/workflow-model.mjs';
const leg=(symbol,type='stock',side='long',qty=1)=>({...newStructureLeg(type,side,qty),underlying:symbol,entry:10,...(type==='stock'?{}:{strike:100,expiry:'2030-01-01'})});
test('thesis can start without symbol; incomplete independent legs survive reload as drafts',()=>{const c=createCase({title:'relative thesis'}),d=clone(c.nodes.construction.data);d.legs=templateLegs('strangle');d.template='strangle';saveNode(c,'construction',d);assert.equal(d.legs[0].underlying,'');assert.equal(validateStore({version:1,cases:[c]}).cases[0].symbol,'');assert.equal(c.design.plans.length,1);});
test('per-underlying exposure cannot net across symbols; option signs and unknowns',()=>{const legs=[leg('A','stock','long',100),leg('SPY','stock','short',100),{...leg('A','call','short'),delta:.5,gamma:.02,theta:-.1,vega:.2,iv:30}];const e=structureExposure(legs);assert.equal(e.groups[0].delta,50);assert.equal(e.groups[0].theta,10);assert.equal(e.groups[0].vega,-20);assert.equal(e.groups[1].delta,-100);assert.equal(exposure(legs).delta,null);assert.equal(structureExposure([leg('A','call')]).groups[0].delta,null);});
test('multi-symbol structures do not run through single-symbol scenario calculator',()=>{const c=createCase({title:'pair',horizon:'2030-01-01'});c.nodes.construction.data.legs=[leg('A'),leg('SPY')];c.nodes.returns.data.spot=100;assert.match(scenario(c).error,/多标的/);});
test('plans isolate returns/risk, active policy is independent of viewed plan, deletion retains snapshots',()=>{
 const c=createCase({title:'plans',horizon:'2030-01-01'}),a=savePlan(c,null,'Stock',{...c.nodes.construction.data,legs:[leg('A')]}),d=clone(c.nodes.construction.data);
 saveNode(c,'returns',{...c.nodes.returns.data,spot:100});saveNode(c,'risk',{...c.nodes.risk.data,lossBudget:500});setActivePlan(c,a);const historic=clone(c.events.at(-1));
 const b=savePlan(c,null,'Call',{...d,legs:[leg('A','call')]});assert.equal(c.design.activeId,a);assert.equal(c.nodes.returns.data.spot,'');saveNode(c,'returns',{...c.nodes.returns.data,spot:120});
 selectPlan(c,a);assert.equal(c.nodes.returns.data.spot,100);assert.equal(c.nodes.risk.data.lossBudget,500);assert.throws(()=>savePlan(c,b,'Stock',d),/已存在/);
 deletePlan(c,a);assert.equal(c.design.activeId,'');assert.equal(c.nodes.returns.data.spot,120);assert.deepEqual(c.events.find(e=>e.id===historic.id),historic);validateStore({version:1,cases:[c]});
 deletePlan(c,b);assert.equal(c.design.plans.length,0);assert.equal(c.nodes.construction.data.legs.length,0);validateStore({version:1,cases:[c]});
});
test('legacy frozen design migrates once into active plan without touching old snapshots',()=>{
 const c=createCase({title:'legacy',horizon:'2030-01-01'});delete c.design;c.designFrozen=true;c.nodes.construction.data.legs=[leg('A')];c.events=[];c.revision=0;record(c,'选定设计基准','construction','legacy');const history=clone(c.events);
 const migrated=validateStore({version:1,cases:[c]}),m=migrated.cases[0];assert.equal(m.design.plans.length,1);assert.equal(m.design.activeId,m.design.selectedId);assert.equal(m.designFrozen,undefined);assert.deepEqual(m.events.slice(0,-1),history);assert.deepEqual(validateStore(migrated),migrated);
 const corrupt=clone(migrated);corrupt.cases[0].design.activeId='missing';assert.throws(()=>validateStore(corrupt),/引用/);
});
test('legacy legs preserve historical ticker only during conversion, and draft validation catches bad input',()=>{const old={legs:[{type:'stock',side:'long',qty:20,entry:100}],notes:'old'};const d=structureDraft(old,'A','2030-01-01');assert.equal(d.legs[0].underlying,'A');assert.equal(newStructureLeg().underlying,'');assert.equal(old.notes,'old');d.legs[0].qty=-1;assert.match(structureError(d),/数量/);});
