import test from 'node:test';import assert from 'node:assert/strict';
import {createCase,saveNode,generateVersion,validateStore,VERSION,record} from '../assets/workflow-model.mjs';
import {createWorkflowDatabase} from '../assets/workflow-database.mjs';

test('manual workflows save current data without snapshots; checkpoint alone creates a version',()=>{
 const c=createCase({title:'Manual',historyMode:'manual'});assert.equal(c.events.length,0);assert.equal(c.revision,0);
 saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,expectation:'one'});record(c,'In Action','risk','current update');
 assert.equal(c.events.length,0);assert.equal(c.revision,0);
 const event=generateVersion(c);assert.equal(c.events.length,1);assert.equal(c.revision,1);assert.equal(event.snapshot.nodes.hypothesis.data.expectation,'one');
 saveNode(c,'hypothesis',{...c.nodes.hypothesis.data,expectation:'two'});
 assert.equal(c.events.length,1);assert.equal(c.events[0].snapshot.nodes.hypothesis.data.expectation,'one');
 assert.equal(validateStore({version:VERSION,cases:[c]}).cases[0].nodes.hypothesis.data.expectation,'two');
});

test('database client migrates the newer browser state and only commits acknowledged data',async()=>{
 const calls=[];let stored=null,revision=null,fail=false;
 const fetcher=async(url,options)=>{calls.push(options);if(options.method==='GET')return {ok:true,json:async()=>({store:stored,revision,legacyStore:{version:1,cases:[{id:'one',revision:1,updatedAt:'2026-01-01'}]}})};
  const body=JSON.parse(options.body);if(fail)return {ok:false,json:async()=>({error:'conflict'})};stored=body.store;revision=(revision||0)+1;return {ok:true,json:async()=>({store:stored,revision})};};
 const client=createWorkflowDatabase(fetcher);await client.initialize({version:1,cases:[{id:'one',revision:2,updatedAt:'2026-01-02'}]});
 assert.equal(JSON.parse(client.raw).cases[0].revision,2);const before=client.raw;fail=true;
 await assert.rejects(client.save('{"version":1,"cases":[]}',before),/conflict/);assert.equal(client.raw,before);
 fail=false;await client.save('{"version":1,"cases":[]}',before);assert.equal(JSON.parse(client.raw).cases.length,0);
 await assert.rejects(client.save(before,before),/其他页面/);
});

test('In Action and saved risk changes update manual current state without generating a version',async()=>{
 const {savePlan,setActiveAllocation}=await import('../assets/workflow-model.mjs');
 const {riskBudgetAllocation}=await import('../assets/kelly-allocation.mjs');
 const c=createCase({title:'Manual allocation',historyMode:'manual'}),id=savePlan(c,null,'',{structureVersion:1,template:'stock',candidate:{underlying:'MU',instrument:'stock',referenceCapital:10000},legs:[{type:'stock',side:'long',underlying:'MU',qty:100,entry:100,underlyingPrice:100}]});
 saveNode(c,'returns',{scenarioVersion:3,daysForward:30,scenarios:[{id:'bull',probability:55,moves:{[id]:{priceMove:20,ivChange:''}}},{id:'base',probability:0,moves:{}},{id:'bear',probability:45,moves:{[id]:{priceMove:-20,ivChange:''}}}]});
 saveNode(c,'risk',{allocationVersion:2,thesisAtRiskLimitPct:1,atrStopMultiple:2.5});
 setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));
 assert.equal(c.events.length,0);assert.equal(c.revision,0);
 saveNode(c,'risk',{...c.nodes.risk.data,thesisAtRiskLimitPct:2});setActiveAllocation(c,riskBudgetAllocation(c,c.nodes.risk.data,{MU:2}));
 assert.equal(c.design.allocation.thesisAtRiskLimitPct,2);assert.equal(c.events.length,0);assert.equal(c.revision,0);
 generateVersion(c);assert.equal(c.events.length,1);assert.equal(c.events[0].snapshot.design.allocation.thesisAtRiskLimitPct,2);
});
