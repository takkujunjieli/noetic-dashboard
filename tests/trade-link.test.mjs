import test from 'node:test';
import assert from 'node:assert/strict';
import {createCase,record,validateStore,VERSION,clone,archiveCase} from '../assets/workflow-model.mjs';
import {applyExecutionEvent,validateExecutionLinks} from '../assets/trade-link-model.mjs';
const event=(c,revision,status='active')=>({event_id:'event-'+revision,revision,action:status==='active'?'link':'unlink',link:{workflow_case_id:c.id,link_id:'link-one',trade_id:'trade-one',fill_ids:['fill-one'],allocations:[{fill_id:'fill-one',quantity:2}],status,role:'entry',journal_revision:2}});
test('execution events preserve old snapshots, freeze fill membership and survive validation',()=>{
 const c=createCase({title:'Link test'}),before=clone(c.events),e=event(c,1);
 assert.equal(applyExecutionEvent(c,e),true);record(c,'关联','positions','entry');
 assert.deepEqual(c.events.slice(0,before.length),before);
 assert.equal(applyExecutionEvent(c,e),false);
 const activeSnapshot=clone(c.events.at(-1).snapshot);
 assert.equal(applyExecutionEvent(c,event(c,2,'unlinked')),true);record(c,'解除','positions','unlink');
 assert.equal(activeSnapshot.nodes.positions.data.executionLinks[0].status,'active');
 const roundtrip=validateStore({version:VERSION,cases:[c]});
 assert.deepEqual(roundtrip.cases[0],c);
 assert.deepEqual(c.nodes.positions.data.executionLinks[0].fill_ids,['fill-one']);
 archiveCase(c);assert.deepEqual(validateStore({version:VERSION,cases:[c]}).cases[0],c);
});
test('reject invalid quantities and orphan event association',()=>{
 assert.throws(()=>validateExecutionLinks([{allocations:[{quantity:-1}]}]),/无效/);
 const c=createCase({title:'different'});assert.equal(applyExecutionEvent(c,{...event(c,1),link:{...event(c,1).link,workflow_case_id:'other'}}),false);
});
