import {privateDashboard} from './dashboard-mode.mjs';
const local = privateDashboard(location, document.querySelector('meta[name="dashboard-mode"]')?.content);
if (local) {
  await import('./portfolio.js');
  const {mountPublicExport} = await import('./public-export.js');
  mountPublicExport();
} else {
  const {mountPublicPortfolio} = await import('./public-dashboard.js');
  await mountPublicPortfolio();
}
