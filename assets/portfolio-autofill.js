import {loadJSON} from './shared.js';
import {localReferenceIv,portfolioBundleDrafts} from './portfolio-autofill.mjs?v=20261019-actual-cost';
import {readWorkflowOwnershipCases,workflowOwnershipIndex} from './workflow-ownership.mjs?v=20261017-portfolio-assignment';

export async function loadPortfolioBundleDrafts(c){
 const [portfolio,referenceIv]=await Promise.all([loadJSON('data/portfolio.json'),loadJSON('data/reference_iv.json')]);
 if(!portfolio)throw Error('未找到本地 Portfolio 数据，请先刷新持仓');
 const ownership=workflowOwnershipIndex(readWorkflowOwnershipCases());
 const assignments=Object.fromEntries([...ownership].filter(([,owners])=>owners.length===1&&owners[0].id===c.id).map(([symbol])=>[symbol,c.title]));
 return portfolioBundleDrafts(c,portfolio,{assignments},{},localReferenceIv(referenceIv||{}));
}
