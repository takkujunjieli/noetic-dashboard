import {privateDashboard} from './dashboard-mode.mjs';
if(privateDashboard(location,document.querySelector('meta[name="dashboard-mode"]')?.content)){const {initializeWorkflowDatabase}=await import('./dashboard-data.mjs?v=20261028-manual-versions');await initializeWorkflowDatabase();}
await import('./trading.js?v=20261029-clean-notes');
