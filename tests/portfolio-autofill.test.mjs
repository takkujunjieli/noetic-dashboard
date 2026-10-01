import test from 'node:test';
import assert from 'node:assert/strict';
import {portfolioBundleDrafts} from '../assets/portfolio-autofill.mjs';
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
 assert.equal(construction.legs.length,2);assert.equal(construction.greekScale,10000);assert.equal(construction.legs[1].entry,5);assert.equal(construction.legs[1].delta,5500);assert.equal(construction.legs[1].iv,.4);
 assert.equal(construction.legs[1].quoteAt,at);
});

test('local assignment overrides file and exact option assignment overrides Underlying fallback',()=>{
 const c={title:'local'},policy={assignments:{MU:'file','MU 2026-12-18 110C':'other'}},local={MU:'local'};
 const result=portfolioBundleDrafts(c,portfolio,policy,local);
 assert.equal(result.matchedPositions,1);assert.equal(result.bundles[0].construction.legs[0].type,'stock');
});
