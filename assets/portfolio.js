/* Portfolio 页:汇集 券商持仓 + 打分(from trading.js)与 仓位试算/敞口/组合稳健性(from portfolio-support.js)。
   这些都是本地私有面板(读 gitignored 数据);公开站上相应容器为空。纯拼装,逻辑复用原模块。
   注:trading.js 的自启动已有容器守卫；portfolio-support.js 只导出共用功能。 */
import { initPortfolioPanel } from "./trading.js?v=20261029-clean-notes";
import { renderRiskExposure, renderRobust } from "./portfolio-support.js?v=20261029-simple-headers";
import { mountPortfolioSizingCalculator } from "./risk-control.js?v=20261029-clean-notes";

const ACTIVE_NEBULAE_KEY = "research-desk.workflow.active-nebulae.v1";

export const portfolioReady=(async function main() {
  window.addEventListener("portfolio-account-change", () => renderRiskExposure());
  window.addEventListener("storage", e => { if (e.key===null||["riskPolicy", "riskMaxHeat", "portfolioExitRules", "research-desk.workflow.v1", ACTIVE_NEBULAE_KEY].includes(e.key)) renderRiskExposure(); });
  await initPortfolioPanel();   // 💼 持仓 + 打分 + 盈亏诊断
  await mountPortfolioSizingCalculator(document.getElementById("position-sizing-calculator"));
  await renderRiskExposure();    // 🌡️ 风险敞口热力图
  await renderRobust();          // 📉 组合稳健性 M2M + β/α
})();
