import {privateDashboard} from './dashboard-mode.mjs';
const local = privateDashboard(location, document.querySelector('meta[name="dashboard-mode"]')?.content);
if (local) {
  const {initializeWorkflowDatabase}=await import('./dashboard-data.mjs?v=20261028-manual-versions');
  try{await initializeWorkflowDatabase();}catch(error){document.body.innerHTML='<p role="alert">Workflow 数据库连接失败。原数据保留，请检查本地服务。</p>';throw error;}
  await import('./portfolio.js?v=20261029-simple-headers');
  const {mountPublicExport} = await import('./public-export.js?v=20261031-footer-controls');
  mountPublicExport({placement:'footer'});
} else {
  const {mountPublicPortfolio} = await import('./public-dashboard.js?v=20261029-simple-headers');
  await mountPublicPortfolio();
}
