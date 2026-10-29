import test from 'node:test';
import assert from 'node:assert/strict';
import {accountDisplayName} from '../assets/account-display.mjs';
import {normalizePortfolio,positionKey} from '../assets/position-link.mjs';

test('the renamed account renders consistently without changing position identity',()=>{
 const raw={updated_at:'2026-10-20T12:00:00Z',accounts:[{id:'rh-7159',label:'rh-7159'}],positions:[{account:'rh-7159',broker:'rh',kind:'equity',sym:'A',qty:5,price:100,avg_cost:90}]};
 const source=normalizePortfolio(raw),row=source.rows[0];
 assert.equal(source.accounts[0].label,'hui-rh-7159');assert.equal(row.accountLabel,'hui-rh-7159');
 assert.equal(source.accounts[0].id,'rh-7159');assert.equal(row.account,'rh-7159');
 assert.equal(row.key,positionKey({...row,account:'rh-7159'}));
 assert.equal(accountDisplayName('rh-7159'),'hui-rh-7159');
 assert.equal(accountDisplayName('hui-rh-7159'),'hui-rh-7159');
 assert.equal(accountDisplayName('takku-rh-2566'),'takku-rh-2566');
 assert.equal(accountDisplayName('another','My account'),'My account');
});
