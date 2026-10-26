import {privateDashboard} from './dashboard-mode.mjs';
const local = privateDashboard(location, document.querySelector('meta[name="dashboard-mode"]')?.content);
if (local) {
  await import('./workflow.js');
  const {mountPublicExport} = await import('./public-export.js');
  mountPublicExport();
} else {
  const {mountPublicWorkflow} = await import('./public-dashboard.js');
  await mountPublicWorkflow();
}
