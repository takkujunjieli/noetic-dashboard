import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateTradeDetails,dedupeTradeFills,equityPositionsAtBars,fillMarkerKind,groupTradeFills,optionMarkerText} from '../assets/trade-markers.mjs';

const dayOf=ms=>new Date(ms).toISOString().slice(0,10);
const bars=[[Date.parse('2026-10-06T13:30:00Z'),1,2,0,1,10],[Date.parse('2026-10-06T13:35:00Z'),1,2,0,1,10]];
test('groups equity fills by bar and calculates quantity-weighted price',()=>{
 const fills=[
  {timestamp:'2026-10-06T13:31:00Z',kind:'equity',side:'buy',qty:1,price:10,trade_id:'a'},
  {timestamp:'2026-10-06T13:32:00Z',kind:'equity',side:'buy',qty:3,price:14,trade_id:'b'},
  {timestamp:'2026-10-06T13:33:00Z',kind:'equity',side:'sell_short',qty:2,price:15,trade_id:'c'},
 ];
 const groups=groupTradeFills({fills,bars,tf:'5m',dayOf});
 assert.equal(groups.length,2);assert.equal(groups[0].kind,'buy');assert.equal(groups[0].averagePrice,13);
 assert.equal(groups[1].kind,'sell');assert.equal(fillMarkerKind(fills[2]),'sell');
});
test('daily options keep exact multi-leg trade and compact label',()=>{
 const daily=[[Date.parse('2026-10-06T04:00:00Z'),1,2,0,1,10]];
 const base={timestamp:'2026-10-06T15:00:00Z',kind:'option',trade_id:'combo'};
 const fills=[
  {...base,side:'buy',qty:1,price:2,instrument:{contract_details_complete:true,expiry:'2026-11-06',strike:120,right:'C'}},
  {...base,side:'sell',qty:1,price:1,instrument:{contract_details_complete:true,expiry:'2026-11-06',strike:150,right:'C'}},
 ];
 const [group]=groupTradeFills({fills,bars:daily,tf:'1d',dayOf});
 assert.equal(optionMarkerText(group),'O 1106 +120C/−150C');
});
test('aggregates same-account executions with quantity-weighted price',()=>{
 const fills=[
  {timestamp:'2026-10-06T14:00:00Z',kind:'equity',side:'sell_short',qty:4,price:359.6,trade_id:'a',broker:'rh',account:'takku-rh-2566'},
  {timestamp:'2026-10-06T15:00:00Z',kind:'equity',side:'sell_short',qty:2,price:360.4,trade_id:'b',broker:'rh',account:'takku-rh-2566'},
  {timestamp:'2026-10-06T15:30:00Z',kind:'equity',side:'sell',qty:1,price:361,trade_id:'c',broker:'rh',account:'rh-7159'},
 ];
 const details=aggregateTradeDetails(fills,dayOf);
 assert.equal(details.length,2);
 const takku=details.find(x=>x.account==='takku-rh-2566');
 assert.equal(takku.qty,6);assert.ok(Math.abs(takku.averagePrice-359.8666666666667)<1e-9);
 assert.deepEqual(takku.tradeIds,['a','b']);assert.deepEqual(takku.sides,['sell_short']);
});
test('calculates integer-share equity position at each bar end and ignores options',()=>{
 const dailyBars=[
  [Date.parse('2026-10-05T12:00:00Z')],
  [Date.parse('2026-10-06T12:00:00Z')],
 ];
 const fills=[
  {timestamp:'2026-10-05T14:00:00Z',kind:'equity',side:'buy',qty:2.8},
  {timestamp:'2026-10-06T14:00:00Z',kind:'equity',side:'sell_short',qty:4},
  {timestamp:'2026-10-06T15:00:00Z',kind:'option',side:'buy',qty:99},
  {timestamp:'2026-10-06T15:30:00Z',kind:'equity',side:'buy_back',qty:1},
 ];
 const positions=equityPositionsAtBars({fills,bars:dailyBars,daily:true,dayOf,barWidth:86_400_000});
  assert.equal(positions[0],2.8);assert.ok(Math.abs(positions[1]+.2)<1e-9);
});
test('maps hidden-session executions to the next visible bar',()=>{
 const gapBars=[
  [Date.parse('2026-10-09T19:55:00Z')],
  [Date.parse('2026-10-12T13:30:00Z')],
 ];
 const fill={timestamp:'2026-10-12T01:00:00Z',kind:'equity',side:'buy',qty:2,price:10,trade_id:'overnight'};
 const [group]=groupTradeFills({fills:[fill],bars:gapBars,tf:'5m',dayOf});
 assert.equal(group.barMs,gapBars[1][0]);
 const positions=equityPositionsAtBars({fills:[fill],bars:gapBars,daily:false,dayOf,barWidth:300_000});
 assert.deepEqual(positions,[0,2]);
});
test('uses the next daily session for executions at or after 20:00 ET',()=>{
 const dailyBars=[
  [Date.parse('2026-10-09T04:00:00Z')],
  [Date.parse('2026-10-12T04:00:00Z')],
 ];
 const sessionDayOf=ms=>ms===Date.parse('2026-10-12T01:00:00Z')?'2026-10-12':dayOf(ms);
 const fill={timestamp:'2026-10-12T01:00:00Z',kind:'equity',side:'buy',qty:3,price:10,trade_id:'sunday'};
 const [group]=groupTradeFills({fills:[fill],bars:dailyBars,tf:'1d',dayOf,sessionDayOf});
 assert.equal(group.barMs,dailyBars[1][0]);
 const positions=equityPositionsAtBars({fills:[fill],bars:dailyBars,daily:true,dayOf,sessionDayOf,barWidth:86_400_000});
  assert.deepEqual(positions,[0,3]);
});
test('anchors the curve to the broker position and removes aggregate shadow imports',()=>{
 const timestamp='2026-10-06T14:00:00Z';
 const fills=[
  {timestamp,kind:'equity',symbol:'A',side:'buy',qty:2,price:10,identity_quality:'broker_execution',execution_id:'one'},
  {timestamp,kind:'equity',symbol:'A',side:'buy',qty:3,price:10,identity_quality:'broker_execution',execution_id:'two'},
  {timestamp,kind:'equity',symbol:'A',side:'buy',qty:5,price:10,identity_quality:'fingerprint'},
 ];
 assert.equal(dedupeTradeFills(fills).length,2);
 const dailyBars=[[Date.parse('2026-10-05T12:00:00Z')],[Date.parse('2026-10-06T12:00:00Z')]];
 const positions=equityPositionsAtBars({fills,bars:dailyBars,daily:true,dayOf,barWidth:86_400_000,
  endingPosition:7,anchorMs:Date.parse('2026-10-07T00:00:00Z')});
 assert.deepEqual(positions,[2,7]);
});
