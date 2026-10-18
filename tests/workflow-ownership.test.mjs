import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowOwnershipCases,workflowOwnershipIndex,readWorkflowOwnershipCases,WORKFLOW_STORE_KEY} from '../assets/workflow-ownership.mjs';
import {workflowLinkCases} from '../assets/trade-link-client.js';
import {loadPortfolioBundleDrafts} from '../assets/portfolio-autofill.js';

const thesis=(id='memory',title='Memory',fraction=.25)=>({id,title,revision:1,activeThesis:true,archived:false,demo:false,
 design:{plans:[{construction:{candidate:{underlying:'NVDA'}}}],allocation:{method:'risk-budget-kelly',inAction:true,items:[{underlying:'MU',fraction}]}}});
const storage=(cases,extra={})=>({getItem:key=>key===WORKFLOW_STORE_KEY?JSON.stringify({version:1,cases}):extra[key]??null});

test('ownership uses only active non-demo In Action underlying membership, including zero targets',()=>{
 const owner=thesis(),zero=thesis('zero','Zero',0),offline={...thesis('offline'),activeThesis:false},archived={...thesis('archive'),archived:true},demo={...thesis('demo'),demo:true},draft=thesis('draft');delete draft.design.allocation;
 assert.deepEqual(workflowOwnershipCases([owner,offline,archived,demo,draft]),[owner]);
 assert.deepEqual([...workflowOwnershipIndex([zero]).keys()],['MU']);
 assert.equal(workflowOwnershipIndex([owner]).has('NVDA'),false);
});

test('Portfolio and B/S/O share case IDs, ignore legacy manual overrides, and expose duplicate owners',()=>{
 const one=thesis(),two=thesis('other','Other');
 const s=storage([one,two],{riskGroups:JSON.stringify({MU:'Legacy'}),riskPolicy:JSON.stringify({assignments:{MU:'Legacy'}})});
 const owners=workflowOwnershipIndex(readWorkflowOwnershipCases(s)).get('MU');
 assert.deepEqual(owners.map(c=>c.id),workflowLinkCases(s).filter(c=>c.underlyings.includes('MU')).map(c=>c.id));
 assert.equal(owners.length,2);
 one.title='Renamed';
 assert.equal(workflowOwnershipIndex(readWorkflowOwnershipCases(storage([one]))).get('MU')[0].title,'Renamed');
 assert.equal(workflowOwnershipIndex(readWorkflowOwnershipCases(storage([one]))).get('MU')[0].id,'memory');
});

test('current empty or invalid Workflow store cannot resurrect an outdated active catalog',()=>{
 const catalog=JSON.stringify({version:1,cases:[thesis()]});
 assert.deepEqual(readWorkflowOwnershipCases(storage([],{'research-desk.workflow.active-nebulae.v1':catalog})),[]);
 assert.deepEqual(readWorkflowOwnershipCases({getItem:key=>key===WORKFLOW_STORE_KEY?'invalid':catalog}),[]);
 assert.equal(readWorkflowOwnershipCases({getItem:key=>key===WORKFLOW_STORE_KEY?null:catalog})[0].id,'memory');
});

test('Construction autofill follows the same Workflow owner for stocks and options without legacy assignments',async()=>{
 const oldStorage=globalThis.localStorage,oldFetch=globalThis.fetch,c=thesis();
 globalThis.localStorage=storage([c],{riskGroups:JSON.stringify({MU:'Wrong'})});
 globalThis.fetch=async url=>({ok:true,json:async()=>url.startsWith('data/portfolio.json')?{
  updated_at:'2026-10-17T12:00:00Z',accounts:[{id:'test'}],positions:[
   {account:'test',sym:'MU',kind:'equity',qty:5,price:100,avg_cost:90},
   {account:'test',sym:'MU 2026-12-18 110C',kind:'option',qty:1,price:500,avg_cost:350},
   {account:'test',sym:'NVDA',kind:'equity',qty:5,price:100,avg_cost:90}]}:{}});
 try{
  const result=await loadPortfolioBundleDrafts(c);
  assert.equal(result.matchedPositions,2);assert.deepEqual(result.bundles.map(b=>b.underlying),['MU']);
 }finally{globalThis.localStorage=oldStorage;globalThis.fetch=oldFetch;}
});
