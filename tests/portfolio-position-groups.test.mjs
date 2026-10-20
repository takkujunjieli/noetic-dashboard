import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeAccountPositions} from '../assets/portfolio-position-groups.mjs';

test('all-account costs weight acquisition prices, and never offset opposite directions',()=>{
 const positions=[
  {account:'a',kind:'equity',sym:'A',qty:20,avg_cost:68.177,price:51.825},
  {account:'b',kind:'equity',sym:'A',qty:101,avg_cost:68.29,price:51.825},
  {account:'c',kind:'equity',sym:'A',qty:16,avg_cost:67.64,price:51.825},
  {account:'d',kind:'equity',sym:'A',qty:-10,avg_cost:80,price:51.825}];
 const [long,short]=mergeAccountPositions(positions);
 assert.equal(long.qty,137);assert.equal(long.avg_cost.toFixed(2),'68.20');
 assert.equal(short.qty,-10);assert.equal(short.avg_cost,80);
 for(const p of positions)p.price=1000;
 assert.equal(mergeAccountPositions(positions)[0].avg_cost,long.avg_cost);
 delete positions[0].avg_cost;
 assert.equal(mergeAccountPositions(positions)[0].avg_cost,null);
});

test('option costs stay in per-contract dollars and only identical contracts merge',()=>{
 const [call,put]=mergeAccountPositions([
  {account:'a',kind:'option',sym:'A 2026-12-18 110C',qty:2,avg_cost:350,price:500},
  {account:'b',kind:'option',sym:'A 2026-12-18 110C',qty:1,avg_cost:200,price:500},
  {account:'b',kind:'option',sym:'A 2026-12-18 110P',qty:1,avg_cost:100,price:50}]);
 assert.equal(call.qty,3);assert.equal(call.avg_cost,300);assert.equal(put.avg_cost,100);
});
