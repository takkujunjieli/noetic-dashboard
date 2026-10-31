import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {privateDashboard} from '../assets/dashboard-mode.mjs';
import {configurePublicDashboard,dashboardStorage,publicJSON,dashboardFetch,isPublicDashboard} from '../assets/dashboard-data.mjs';
import {validateStore} from '../assets/workflow-model.mjs';
import {exportPublicSnapshot,syncPublicSnapshot,mountPublicExport} from '../assets/public-export.js';

test('published mode stays public on localhost and never uses private local storage',async()=>{
 assert.equal(privateDashboard({hostname:'localhost',search:''},'public'),false);
 const original=globalThis.localStorage;
 globalThis.localStorage={getItem(){throw Error('private storage read');},setItem(){throw Error('private storage changed');}};
 const snapshot={schema:'public-dashboard',version:2,basis:{netEquity:100000},workflow:{store:{version:1,cases:[]},settings:{riskPolicy:{account_equity:100000}}},files:{'data/portfolio.json':{accounts:[{id:'takku-rh-2566',equity:100000}],positions:[{qty:2}]}},api:{'/api/trade-journal':{fills:[]}}};
 configurePublicDashboard(snapshot);assert.equal(isPublicDashboard(),true);
 assert.equal(dashboardStorage.getItem('ghPat'),null);
 assert.equal(JSON.parse(dashboardStorage.getItem('research-desk.workflow.v1')).cases.length,0);
 const data=publicJSON('data/portfolio.json?t=12');assert.equal(data.handled,true);data.value.positions[0].qty=999;
 assert.equal(publicJSON('data/portfolio.json').value.positions[0].qty,2);
 assert.deepEqual(publicJSON('data/_rh_raw.json'),{handled:true,value:null});
 dashboardStorage.setItem('riskPolicy',JSON.stringify({account_equity:12}));assert.equal(JSON.parse(dashboardStorage.getItem('riskPolicy')).account_equity,100000);
 assert.deepEqual(await (await dashboardFetch('/api/trade-journal')).json(),{fills:[]});
 assert.equal((await dashboardFetch('/api/trade-links',{method:'POST'})).status,403);
 assert.equal((await dashboardFetch('/api/unknown')).status,404);
 globalThis.localStorage=original;
});
test('public synchronization uploads only the server-projected snapshot and rejects obsolete exports',async()=>{
 const snapshot={schema:'public-dashboard',version:2,basis:{netEquity:100000},files:{'data/portfolio.json':{accounts:[{id:'takku-rh-2566',equity:100000}]}},workflow:{store:{version:1,cases:[]},settings:{}},api:{}};
 configurePublicDashboard(snapshot);dashboardStorage.setItem('ghPat','fake-test-token');
 const calls=[];
 const fetcher=async(url,options={})=>{
  calls.push([url,options]);
  if(url==='/api/public-dashboard/export')return {ok:true,json:async()=>({snapshot})};
  if(!options.method)return {ok:true,json:async()=>({sha:'head-sha'})};
  return {ok:true};
 };
 await syncPublicSnapshot({privateInput:'LOCAL_PRIVATE_DATA'},fetcher);
 const github=calls.find(([url,o])=>url.startsWith('https:')&&o.method==='PUT');
 const body=JSON.parse(github[1].body),uploaded=JSON.parse(Buffer.from(body.content,'base64').toString());
 assert.deepEqual(uploaded,snapshot);assert.doesNotMatch(JSON.stringify(uploaded),/LOCAL_PRIVATE_DATA/);assert.equal(body.sha,'head-sha');
 await assert.rejects(exportPublicSnapshot({},async()=>({ok:true,json:async()=>({snapshot:{schema:'anonymous-dashboard',version:1}})})),/100k/);
});
test('the actual published research store roundtrips through the same local Workflow model',()=>{
 const snapshot=JSON.parse(fs.readFileSync(new URL('../data/public-dashboard.json',import.meta.url)));
 assert.equal(snapshot.schema,'public-dashboard');const store=validateStore(snapshot.workflow.store);
 assert.equal(store.cases.length,snapshot.workflow.store.cases.length);
 assert.ok(store.cases.some(c=>c.nodes.hypothesis.data.rationale));
 assert.ok(store.cases.some(c=>c.events.length));
});


test('Portfolio export controls stay at the bottom with or without a footer and mount only once',()=>{
 const originalDocument=globalThis.document,originalLocation=globalThis.location;
 const element=tag=>({tag,children:[],style:{},append(...nodes){this.children.push(...nodes);},setAttribute(){}});
 try{
  for(const hasFooter of [false,true]){
   const body=element('body'),header=element('header');body.append(header);
   if(hasFooter){const footer=element('footer');footer.textContent='Existing footer';body.append(footer);}
   const all=()=>{const walk=node=>[node,...(node.children||[]).flatMap(walk)];return walk(body);};
   globalThis.document={body,createElement:element,createTextNode:text=>({text}),
    getElementById:id=>all().find(node=>node.id===id),
    querySelector:selector=>all().find(node=>node.tag===selector)||null};
   globalThis.location={href:'http://localhost:8642/portfolio.html'};
   mountPublicExport({placement:'footer'});
   const footer=document.querySelector('footer'),controls=document.getElementById('public-export-controls');
   assert.equal(body.children.at(-1),footer);
   assert.equal(header.children.length,0);
   assert.equal(footer.children[0].children[0],controls);
   assert.equal(controls.children[2].href,'http://localhost:8642/portfolio.html?view=public');
   if(hasFooter)assert.equal(footer.textContent,'Existing footer');
   mountPublicExport({placement:'footer'});
   assert.equal(all().filter(node=>node.id==='public-export-controls').length,1);
   assert.equal(all().filter(node=>node.tag==='footer').length,1);
  }
 }finally{globalThis.document=originalDocument;globalThis.location=originalLocation;}
});
