import {loadJSON} from './shared.js';
import {portfolioBundleDrafts} from './portfolio-autofill.mjs?v=20260929-1';

function localAssignments(){
 const raw=localStorage.getItem('riskGroups');
 if(!raw)return {};
 try{const value=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
 catch{throw Error('本地 Portfolio thesis 归属不可读，请先在 Portfolio 页面重新保存归属');}
}

export async function loadPortfolioBundleDrafts(c){
 const [portfolio,policy]=await Promise.all([loadJSON('data/portfolio.json'),loadJSON('config/risk_policy.json')]);
 if(!portfolio)throw Error('未找到本地 Portfolio 数据，请先刷新持仓');
 return portfolioBundleDrafts(c,portfolio,policy||{},localAssignments());
}
