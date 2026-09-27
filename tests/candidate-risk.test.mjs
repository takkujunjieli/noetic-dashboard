import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateMetrics,optimizeCandidates} from '../assets/candidate-risk.mjs';
import {newStructureLeg} from '../assets/trade-structure.mjs';

const stock={id:'stock',name:'NVDA · Long Stock',construction:{structureVersion:1,template:'stock',evaluationDate:'2030-01-01',candidate:{version:1,underlying:'NVDA',instrument:'stock',targetDte:30,longDelta:50,shortDelta:25,plannedEntry:''},legs:[{...newStructureLeg(),underlying:'NVDA',entry:100,underlyingPrice:100}]},returns:{expectedNet:5}};
const spread={id:'spread',name:'NVDA · Bull Call Spread',construction:{structureVersion:1,template:'bullCall',evaluationDate:'2030-01-01',candidate:{version:1,underlying:'NVDA',instrument:'bullCall',targetDte:30,longDelta:50,shortDelta:25,plannedEntry:''},legs:[{...newStructureLeg('call'),underlying:'NVDA',entry:6,strike:100,expiry:'2030-01-01',underlyingPrice:100,delta:.55,gamma:.02,theta:-.08,vega:.12},{...newStructureLeg('call','short'),underlying:'NVDA',entry:2,strike:120,expiry:'2030-01-01',underlyingPrice:100,delta:.25,gamma:.01,theta:-.04,vega:.07}]},returns:{expectedNet:300}};

test('candidate risk compares unit structures under one common shock without inventing missing quotes',()=>{
 const policy={riskBudget:1000,capitalLimit:10000,maxDollarDelta:100000,priceShock:10,positionRiskCapPct:60},s=candidateMetrics(stock,policy),v=candidateMetrics(spread,policy),missing=structuredClone(spread);missing.construction.legs.forEach(l=>l.entry='');
 assert.equal(s.capital,100);assert.equal(s.commonStressLoss,10);assert.equal(s.riskCharge,10);
 assert.equal(v.capital,400);assert.equal(v.theoreticalMaxLoss,400);assert.equal(v.riskCharge,400);assert.ok(Math.abs(v.dollarDelta-3000)<1e-8);
 assert.match(candidateMetrics(missing,policy).errors.join(),/Reference Mark|参考价格/);
});

test('optimizer produces integer quantities and caps each candidate risk contribution',()=>{
 const result=optimizeCandidates([stock,spread],{riskBudget:1000,capitalLimit:10000,maxDollarDelta:100000,priceShock:10,positionRiskCapPct:60}),byId=Object.fromEntries(result.allocations.map(x=>[x.positionId,x]));
 assert.equal(byId.spread.quantity,1);assert.equal(byId.stock.quantity,60);assert.equal(result.usedRisk,1000);assert.equal(result.usedCapital,6400);assert.equal(result.expected,600);
});
