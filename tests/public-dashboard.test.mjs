import test from 'node:test';
import assert from 'node:assert/strict';
import {privateDashboard} from '../assets/dashboard-mode.mjs';
import {nodeContent,positionTable,HIDDEN} from '../assets/public-dashboard.mjs';

test('public deployment never loads private view, including on localhost and with old local storage',()=>{
  assert.equal(privateDashboard({hostname:'example.github.io',search:''}),false);
  assert.equal(privateDashboard({hostname:'localhost',search:''},'public'),false);
  assert.equal(privateDashboard({hostname:'localhost',search:'?view=public'}),false);
  assert.equal(privateDashboard({hostname:'127.0.0.1',search:''}),true);
  assert.equal(privateDashboard({hostname:'localhost.attacker.example',search:''}),false);
});
test('public tables show placeholders even if handed financial values accidentally',()=>{
  const p={symbol:'Fe',account:'account-a',kind:'stock',side:'long',qty:98765,price:98765,cost:98765,pnl:98765,pnlPct:98765};
  const c={id:'nebula-a',title:'猎户座星云',symbols:['Fe'],plans:[{id:'bundle-a',frozen:true,legs:[{symbol:'Fe',type:'stock',side:'long',qty:98765,entry:98765,strike:98765}]}]};
  for(const key of ['hypothesis','construction','returns','risk','positions','attribution']){
    const html=nodeContent(c,key,{positions:[p],accounts:[]});assert.doesNotMatch(html,/98765/);assert.ok(html.includes(HIDDEN));
  }
  assert.match(positionTable([p],[c],[]),/view=public/);
});
