import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sortObservations} from '../assets/market-observations.mjs';
test('historical momentum and volatility sorting are independent of prediction scores',()=>{
  const rows=[{symbol:'A',score:100,periods:{'20':{momentum:-.1,volatility:.2}}},
    {symbol:'B',score:-100,periods:{'20':{momentum:.2,volatility:.1}}},
    {symbol:'C',periods:{'20':{momentum:null,volatility:null}}}];
  assert.deepEqual(sortObservations(rows).map(r=>r.symbol),['B','A','C']);
  assert.deepEqual(sortObservations(rows,'20','volatility','desc').map(r=>r.symbol),['A','B','C']);
  assert.deepEqual(sortObservations(rows,'20','momentum','asc').map(r=>r.symbol),['A','B','C']);
  assert.equal(rows[0].symbol,'A');
});
