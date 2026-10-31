import {privateDashboard} from './dashboard-mode.mjs';
const local = privateDashboard(location, document.querySelector('meta[name="dashboard-mode"]')?.content);
if (local) {
  const {initializeWorkflowDatabase}=await import('./dashboard-data.mjs?v=20261028-manual-versions');
  try{await initializeWorkflowDatabase();}catch(error){document.body.innerHTML='<p role="alert">Workflow 数据库连接失败。原数据保留，请检查本地服务。</p>';throw error;}
  await import('./workflow.js?v=20261029-exit-labels');
  const {mountPublicExport} = await import('./public-export.js?v=20261029-english-buttons');
  mountPublicExport({english:true});
} else {
  const {mountPublicWorkflow} = await import('./public-dashboard.js?v=20261028-manual-versions');
  await mountPublicWorkflow();
}
