import test from 'node:test';
import assert from 'node:assert/strict';
import {latestReferenceIv,localReferenceIv,portfolioBundleDrafts} from '../assets/portfolio-autofill.mjs';
import {bundleMetrics} from '../assets/trade-structure.mjs';

const at='2026-09-29T14:00:00Z';
const portfolio={updated_at:at,accounts:[{id:'rh',label:'Robinhood',source_updated_at:at}],positions:[
 {account:'rh',kind:'equity',sym:'MU',qty:10,avg_cost:90,price:100,price_as_of:at},
 {account:'rh',kind:'option',sym:'MU 2026-12-18 110C',qty:2,avg_cost:350,price:500,multiplier:100,price_as_of:at,underlying_price:100,delta:.55,gamma:.02,theta:-.04,vega:.12,iv:.4},
 {account:'rh',kind:'equity',sym:'NVDA',qty:3,avg_cost:150,price:160,price_as_of:at}
]};

test('Portfolio autofill matches thesis assignments and aggregates positions by Underlying',()=>{
 const c={title:'Renamed Nebula',sourceLink:{name:'memory thesis'}},policy={assignments:{MU:'memory thesis',NVDA:'other'}},result=portfolioBundleDrafts(c,portfolio,policy,{});
 assert.equal(result.matchedPositions,2);assert.equal(result.bundles.length,1);
 const construction=result.bundles[0].construction,m=bundleMetrics(construction);
 assert.equal(m.underlying,'MU');assert.equal(m.referenceSpot,100);assert.equal(m.referenceCapital,2000);
 assert.equal(construction.legs[0].entry,100);
 assert.equal(construction.legs.length,2);assert.equal(construction.greekScale,10000);assert.equal(construction.legs[1].entry,5);assert.equal(construction.legs[1].delta,5500);assert.equal(construction.legs[1].iv,.4);
 assert.equal(construction.legs[1].quoteAt,at);
});

test('autofill uses the latest market spot and current gross value across accounts, independent of cost',()=>{
 const raw={updated_at:at,accounts:[{id:'a'},{id:'b'},{id:'c'}],positions:[
  {account:'a',kind:'equity',sym:'A',qty:20,avg_cost:68.177,price:51.825,price_as_of:'2026-09-29T12:00:00Z'},
  {account:'b',kind:'equity',sym:'A',qty:101,avg_cost:68.29,price:52,price_as_of:at},
  {account:'c',kind:'equity',sym:'A',qty:16,avg_cost:67.64,price:53,price_as_of:'2026-09-29T13:00:00Z'}]};
 const original=structuredClone(raw),build=()=>portfolioBundleDrafts({title:'Market'},raw,{assignments:{A:'Market'}}).bundles[0].construction;
 const construction=build(),metrics=bundleMetrics(construction);
 assert.equal(metrics.referenceSpot,52);assert.equal(metrics.spotConflict,false);assert.equal(metrics.referenceCapital,7136.5);
 assert.deepEqual(construction.legs.map(l=>l.entry),[51.825,52,53]);assert.deepEqual(raw,original);
 for(const p of raw.positions)p.avg_cost=999;
 assert.deepEqual(build(),construction);
 for(const p of raw.positions)p.price=200;
 assert.equal(bundleMetrics(build()).referenceSpot,200);assert.equal(bundleMetrics(build()).referenceCapital,27400);
 raw.positions[2].qty=-16;
 assert.equal(bundleMetrics(build()).referenceCapital,27400);assert.equal(build().legs[2].side,'short');
});

test('missing costs do not block current valuation; missing marks leave capital incomplete',()=>{
 const raw=structuredClone(portfolio);delete raw.positions[0].avg_cost;
 const build=()=>portfolioBundleDrafts({title:'Market'},raw,{assignments:{MU:'Market'}}).bundles[0].construction;
 assert.equal(bundleMetrics(build()).referenceSpot,100);assert.equal(bundleMetrics(build()).referenceCapital,2000);
 delete raw.positions[0].price;
 assert.equal(build().legs[0].entry,'');assert.equal(bundleMetrics(build()).referenceSpot,100);assert.equal(build().candidate.referenceCapital,'');
 delete raw.positions[1].underlying_price;
 assert.equal(bundleMetrics(build()).referenceSpot,null);
});

test('option-only autofill uses current premium separately from underlying spot, without cost fallback',()=>{
 const raw=structuredClone(portfolio);raw.positions=raw.positions.filter(p=>p.kind==='option');
 const build=()=>portfolioBundleDrafts({title:'Market'},raw,{assignments:{MU:'Market'}}).bundles[0].construction;
 assert.equal(build().legs[0].entry,5);assert.equal(bundleMetrics(build()).referenceSpot,100);assert.equal(build().candidate.referenceCapital,1000);
 delete raw.positions[0].underlying_price;
 assert.equal(bundleMetrics(build()).referenceSpot,null);
 delete raw.positions[0].price;
 assert.equal(build().legs[0].entry,'');assert.equal(build().candidate.referenceCapital,'');
});

test('local assignment overrides file and exact option assignment overrides Underlying fallback',()=>{
 const c={title:'local'},policy={assignments:{MU:'file','MU 2026-12-18 110C':'other'}},local={MU:'local'};
 const result=portfolioBundleDrafts(c,portfolio,policy,local);
 assert.equal(result.matchedPositions,1);assert.equal(result.bundles[0].construction.legs[0].type,'stock');
});

test('latest local ATM IV becomes Bundle Reference IV with source metadata',()=>{
 const source=latestReferenceIv({'2026-09-28':{MU:{atm_iv:.35,atm_iv_dte:20}},'2026-09-29':{MU:{atm_iv:.42,atm_iv_dte:20}}});
 const c={title:'memory thesis',sourceLink:{}},result=portfolioBundleDrafts(c,portfolio,{assignments:{MU:'memory thesis'}},{},source),candidate=result.bundles[0].construction.candidate;
 assert.equal(candidate.referenceIv,.42);assert.equal(candidate.referenceIvAt,'2026-09-29');assert.equal(candidate.referenceIvDte,20);assert.equal(bundleMetrics(result.bundles[0].construction).referenceIv,.42);
});

test('Moomoo local reference IV database is normalized without a browser API call',()=>{
 const source=localReferenceIv({updated_at:at,source:'moomoo',tickers:{mu:{reference_iv:.53,observed_at:at,dte:15}}});
 assert.deepEqual(source.MU,{iv:.53,at,dte:15});
});
