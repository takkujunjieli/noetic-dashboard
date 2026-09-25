/* Portfolio 页:汇集 券商持仓 + 打分(from trading.js)与 仓位试算/敞口/组合稳健性(from strategy.js)。
   这些都是本地私有面板(读 gitignored 数据);公开站上相应容器为空。纯拼装,逻辑复用原模块。
   注:import trading.js / strategy.js 会执行其模块顶层,但两者的自启动都已守卫(无本页专有容器时不跑)。 */
import { initPortfolioPanel } from "./trading.js";
import { renderRiskExposure, renderRobust } from "./strategy.js";
import { mountPortfolioSizingCalculator } from "./risk-control.js";

(async function main() {
  window.addEventListener("portfolio-account-change", () => renderRiskExposure());
  window.addEventListener("storage", e => { if (["riskPolicy", "riskMaxHeat"].includes(e.key)) renderRiskExposure(); });
  await initPortfolioPanel();   // 💼 持仓 + 打分 + 盈亏诊断
  await mountPortfolioSizingCalculator(document.getElementById("position-sizing-calculator"));
  await renderRiskExposure();    // 🌡️ 风险敞口热力图
  await renderRobust();          // 📉 组合稳健性 M2M + β/α
})();
