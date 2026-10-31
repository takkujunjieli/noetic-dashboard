import test from 'node:test';
import assert from 'node:assert/strict';
import {createCase,saveNode,savePlan,setActiveAllocation,validateStore,VERSION} from '../assets/workflow-model.mjs';
import {riskBudgetAllocation} from '../assets/kelly-allocation.mjs';
import {thesisFreshness} from '../assets/workflow-freshness.mjs';

function setup(){
 const c=createCase({title:'Repeated In Action'});
 const id=savePlan(c,null,'',{structureVersion:1,template:'stock',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{type:'stock',side:'long',underlying:'MU',qty:100,entry:100,underlyingPrice:100}]});
 saveNode(c,'returns',{scenarioVersion:3,daysForward:30,scenarios:[{id:'bull',probability:55,moves:{[id]:{priceMove:20,ivChange:''}}},{id:'base',probability:0,moves:{}},{id:'bear',probability:45,moves:{[id]:{priceMove:-20,ivChange:''}}}]});
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5});
 return c;
}

test('repeated In Action changes neither history, versions, timestamps nor persisted content',()=>{
 const c=setup(),result=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2});
 assert.equal(setActiveAllocation(c,result),true);const before=JSON.stringify(c);
 for(let i=0;i<10;i++)assert.equal(setActiveAllocation(c,structuredClone(result)),false);
 assert.equal(JSON.stringify(c),before);
 const reloaded=validateStore(JSON.parse(JSON.stringify({version:VERSION,cases:[c]}))).cases[0];
 assert.equal(setActiveAllocation(reloaded,riskBudgetAllocation(reloaded,reloaded.nodes.risk.data,{MU:2})),false);
 assert.equal(JSON.stringify(reloaded),before);
});

test('changed market risk baseline or saved parameters still creates a new activation snapshot',()=>{
 const c=setup();setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));const revision=c.revision;
 assert.equal(setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:4})),true);
 assert.equal(c.revision,revision+1);assert.equal(c.design.allocation.items[0].atr,4);
 saveNode(c,'risk',{...c.nodes.risk.data,thesisAtRiskLimitPct:2});
 assert.equal(setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:4})),true);
 assert.equal(c.design.allocation.thesisAtRiskLimitPct,2);
});

test('repeated activation does not extend an expired Horizon',()=>{
 const c=setup(),result=riskBudgetAllocation(c,c.nodes.risk.data,{MU:2});setActiveAllocation(c,result);
 const at=c.design.allocation.underwrittenAt,now=new Date(Date.parse(at)+31*86400000).toISOString();
 assert.equal(thesisFreshness(c,{now,prices:{MU:100},preview:result}).status,'expired');
 assert.equal(setActiveAllocation(c,result),false);assert.equal(c.design.allocation.underwrittenAt,at);
 assert.equal(thesisFreshness(c,{now,prices:{MU:100},preview:result}).status,'expired');
});
