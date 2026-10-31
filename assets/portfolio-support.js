import {dashboardStorage as localStorage} from './dashboard-data.mjs?v=20261028-manual-versions';
import {accountDisplayName} from './account-display.mjs';
import { workflowArchiveHTML } from './attribution-journal.js?v=20261028-manual-versions';
/* Portfolio / Workflow 共用的账户风险、组合稳健性和历史 Thesis。无页面自启动。 */
import { $, esc, loadJSON, loadFreshJSON, getPat, setPat, ghHeaders, REPO } from "./shared.js?v=20261028-manual-versions";
import { mountLegacyRiskControl } from "./risk-control.js?v=20261029-clean-notes";
import { estimatePositionRisk } from "./risk-budget.mjs";
import {nebulaRiskModels} from './workflow-risk-bridge.mjs?v=20261028-manual-versions';
import {freshnessSummary,marketPricesFromResearch,thesisFreshness} from './workflow-freshness.mjs?v=20261028-deadline';
import {readWorkflowAssignmentCases,workflowOwnershipCases,workflowOwnershipIndex,workflowHasBudgetUnderlying} from './workflow-ownership.mjs?v=20261028-manual-versions';
import {savePortfolioWorkflowOwner} from './workflow-ownership-client.js?v=20261028-manual-versions';
import {mergeAccountPositions} from './portfolio-position-groups.mjs';
import {accountRiskPlan,heatmapBearRisk,heatmapMarketValue,isHeatmapPosition} from './account-risk-plan.mjs?v=20261028-risk-only';
const LWC = window.LightweightCharts;

/* 账户风险控制 · 仓位计算器 + thesis 管理(UI 称 Thesis;历史数据键沿用 bundles/default_bundle
   以兼容已存 config/localStorage)。读/写 config/risk_policy.json(日后 agentic 读同一份)。
   每个 thesis = 单笔风险% + ATR倍数 + 仓位上限%;止损决定仓位 shares=净值×risk%÷(entry−stop)。 */
// 两个入口(theses / assignments)都写同一个 risk_policy.json。为避免互相覆盖 + sha 冲突(409):
// 每次都先拉「最新内容+sha」,只改自己那块(mutate),再 PUT;409(sha 过期)自动重取重试一次。
async function putPolicy(mutate) {
  const pat = getPat();
  if (!pat) return { ok: false, msg: "需 fine-grained PAT(与采集面板共用,存本机);未写仓库" };
  const url = `https://api.github.com/repos/${PRIV_REPO}/contents/risk_policy.json`;   // 私有库(本地专用,公开站不含)
  async function once() {
    let sha, latest = {};
    try {
      const c = await fetch(url + "?ref=main&t=" + Date.now(), { headers: ghHeaders(pat), cache: "no-store" });
      if (c.ok) { const j = await c.json(); sha = j.sha; latest = JSON.parse(decodeURIComponent(escape(atob((j.content || "").replace(/\s/g, ""))))); }
    } catch { /* 新建或解析失败 → 从空开始 */ }
    mutate(latest);
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(latest, null, 2) + "\n")));
    return fetch(url, { method: "PUT", headers: ghHeaders(pat),
      body: JSON.stringify({ message: "chore: update risk_policy via strategy UI", content, sha, branch: "main" }) });
  }
  try {
    let r = await once();
    if (r.status === 409) r = await once();   // sha 过期 → 重取最新再试一次
    const hint = r.status === 404 ? "(PAT 无 stock-dashboard-private 写权限?)" : r.status === 401 ? "(PAT 无效/过期)" : r.status === 403 ? "(PAT 权限不足/限流)" : "";
    return r.ok ? { ok: true } : { ok: false, msg: "PUT " + r.status + " " + hint };
  } catch (e) { return { ok: false, msg: String(e) }; }
}

/* 风险策略手动批量同步:任何改动先落本机 localStorage(即时、免 PAT、离线不丢),
   只标记为待同步;用户点击按钮时才把整份 policy(theses + assignments + max-heat + equity)
   一次提交到私有库,避免每次编辑都产生 Git commit。 */
const RISK_POLICY_DIRTY_KEY = "riskPolicyDirty";
const ARCHIVE_KEY = "completedTheses";
const THESIS_EVENTS_KEY = "thesisEvents";
const positiveNum = (v) => v != null && v !== "" && Number.isFinite(+v) && +v > 0;
const missingCoreFields = (bundles) => Object.entries(bundles || {}).flatMap(([name, b]) => {
  const missing = [];
  if (!positiveNum(b && b.risk_pct)) missing.push("单笔风险%");
  if (!positiveNum(b && b.total_risk_pct)) missing.push("总风险%");
  if (!positiveNum(b && b.atr_mult)) missing.push("ATR倍数");
  return missing.length ? [`${name}: ${missing.join("、")}`] : [];
});
function rpStatus(txt, cls = "muted", title = "") { const el = document.getElementById("rk-sync"); if (el) el.innerHTML = `<span class="${cls}"${title ? ` title="${esc(title)}"` : ""}>${txt}</span>`; }
async function rpSyncNow() {
  if (!getPat()) { rpStatus("⚠ 未设 PAT · 点此设置", "down"); return {ok:false,msg:"未设置 PAT"}; }
  if (!rLS(RISK_POLICY_DIRTY_KEY, false)) { rpStatus("✓ 无待同步改动"); return {ok:true}; }
  rpStatus("syncing…");
  const LP = rLS("riskPolicy", {}), groups = rLS("riskGroups", {}), mh = rLS("riskMaxHeat", null);
  const invalid = missingCoreFields(LP.bundles);
  if (invalid.length) {
    rpStatus(`✗ 补齐必填项 · ${invalid.join("；")}`, "down", "单笔风险%、总风险%、ATR倍数均须大于 0");
    return {ok:false,msg:invalid.join("；")};
  }
  const riskBefore=JSON.stringify([LP,groups,mh]);
  const r = await putPolicy((L) => {
    if (LP.bundles) L.bundles = LP.bundles;
    if (LP.default_bundle) L.default_bundle = LP.default_bundle;
    if (LP.account_equity != null) L.account_equity = LP.account_equity;
    L.assignments = ASSIGN ? { ...ASSIGN } : { ...(L.assignments || {}), ...groups };
    if (mh != null && !Number.isNaN(+mh)) L.portfolio = { ...(L.portfolio || {}), max_total_heat_pct: +mh };
  });
  if (r.ok && riskBefore===JSON.stringify([rLS("riskPolicy",{}),rLS("riskGroups",{}),rLS("riskMaxHeat",null)])) rLSset(RISK_POLICY_DIRTY_KEY, false);
  rpStatus(r.ok ? `✓ 已同步 ${new Date().toTimeString().slice(0, 5)}` : `✗ 同步失败 · 点重试`, r.ok ? "muted" : "down", r.ok ? "" : (r.msg || ""));
  return r;
}
export async function syncLegacyWorkflowData(){
 const risk=await rpSyncNow();if(!risk?.ok)throw Error(risk?.msg||"风险设置同步失败");
 for(const [path,key] of [["completed_theses.json",ARCHIVE_KEY],["thesis_events.json",THESIS_EVENTS_KEY]]){const r=await syncPrivateJSON(path,key,"chore: sync workflow legacy history");if(!r.ok)throw Error(path+"："+r.msg);}
}
function rpSchedule() {
  rLSset(RISK_POLICY_DIRTY_KEY, true);
  rpStatus(getPat() ? "↑ 有未同步改动 · 点击同步" : "⚠ 有未同步改动 · 需 PAT", getPat() ? "" : "down");
}
function mergeImmutableRecords(authoritative, incoming) {
  const out = [], seen = new Set();
  for (const row of [...(authoritative || []), ...(incoming || [])]) {
    if (!row || typeof row !== "object") continue;
    const key = row.id || JSON.stringify(row);
    if (seen.has(key)) continue;                  // 已存在 ID 永远保留 authoritative 版本，不允许改写
    seen.add(key); out.push(row);
  }
  return out.sort((a, b) => String(b.completed_at || b.ts || "").localeCompare(String(a.completed_at || a.ts || "")));
}
async function syncPrivateJSON(path, key, msg) {
  if (!getPat()) return { ok: false, msg: "未设 PAT；已仅保存在本机" };
  return appendPrivateRecords(path, rLS(key, []), msg);
}

async function loadLocalArray(key, path) {
  const local = rLS(key, null);
  const file = (await loadJSON(path)) || [];
  // 归档与事件都是 append-only 审计记录：文件记录优先，同 ID 的 localStorage 不得覆盖。
  const v = mergeImmutableRecords(Array.isArray(file) ? file : [], Array.isArray(local) ? local : []);
  rLSset(key, v);
  return v;
}

async function fetchPrivateRecords(path) {
  const pat = getPat();
  if (!pat) return { ok: false, records: [], msg: "未设 PAT" };
  const url = `https://api.github.com/repos/${PRIV_REPO}/contents/${path}`;
  try {
    const r = await fetch(url + "?ref=main&t=" + Date.now(), { headers: ghHeaders(pat), cache: "no-store" });
    if (!r.ok) return { ok: false, records: [], msg: `GET ${r.status}` };
    const j = await r.json();
    const parsed = JSON.parse(decodeURIComponent(escape(atob((j.content || "").replace(/\s/g, "")))));
    return Array.isArray(parsed)
      ? { ok: true, records: parsed }
      : { ok: false, records: [], msg: "远端记录不是数组" };
  } catch (e) {
    return { ok: false, records: [], msg: String(e) };
  }
}

function posSnapshotFor(sym, pf) {
  const rows = ((pf && pf.positions) || []).filter((p) => p.sym === sym);
  return rows.map((p) => ({
    account: p.account || null, kind: p.kind || "equity", sym: p.sym,
    qty: p.qty ?? null, price: p.price ?? null, avg_cost: p.avg_cost ?? null,
    mkt_value: p.mkt_value ?? null, pnl: p.pnl ?? null, pnl_pct: p.pnl_pct ?? null,
  }));
}

async function archiveCurrentThesis(name, policy) {
  const pf = await loadJSON("data/portfolio.json");
  const at = new Date().toISOString();
  const assignments = ASSIGN || { ...((policy && policy.assignments) || {}), ...rLS("riskGroups", {}) };
  const tickers = Object.keys(assignments).filter((sym) => assignments[sym] === name).sort();
  const archive = await loadLocalArray(ARCHIVE_KEY, "data/completed_theses.json");
  archive.unshift({
    id: `${Date.now()}-${name}`,
    immutable: true,
    record_version: 1,
    name,
    completed_at: at,
    thesis: JSON.parse(JSON.stringify((policy.bundles && policy.bundles[name]) || {})),
    account_equity: policy.account_equity ?? null,
    atr_period: policy.atr_period ?? null,
    portfolio: policy.portfolio || null,
    stop_bases: policy.stop_bases || [],
    tickers: tickers.map((sym) => ({ sym, positions: posSnapshotFor(sym, pf) })),
    notes: "",
  });
  rLSset(ARCHIVE_KEY, archive);
  syncPrivateJSON("completed_theses.json", ARCHIVE_KEY, "chore: completed theses via UI");
  const events = await loadLocalArray(THESIS_EVENTS_KEY, "data/thesis_events.json");
  for (const sym of tickers) {
    events.unshift({ id: `${Date.now()}-${sym}-archive-exit`, ts: at, type: "exit", reason: "thesis_archived", thesis: name, sym, positions: posSnapshotFor(sym, pf) });
  }
  rLSset(THESIS_EVENTS_KEY, events);
  syncPrivateJSON("thesis_events.json", THESIS_EVENTS_KEY, "chore: thesis assignment events via UI");
  return tickers;
}

async function ensureThesisBaselines(assignments, pf) {
  const currentSyms = new Set(((pf && pf.positions) || []).map((p) => p.sym));
  const cached = await loadLocalArray(THESIS_EVENTS_KEY, "data/thesis_events.json");
  // baseline 是一次性审计事件。必须先成功读取远端历史；否则新设备的空缓存会重建整套 baseline。
  const remote = await fetchPrivateRecords("thesis_events.json");
  if (!remote.ok) return;
  const events = mergeImmutableRecords(remote.records, cached);
  rLSset(THESIS_EVENTS_KEY, events);
  const seen = new Set(events.filter((e) => e.type === "enter").map((e) => `${e.sym}|${e.thesis}`));
  const at = new Date().toISOString();
  let changed = false;
  for (const [sym, thesis] of Object.entries(assignments || {})) {
    if (!currentSyms.has(sym) || !thesis || seen.has(`${sym}|${thesis}`)) continue;
    // 确定性 ID 让并发设备即使同时初始化，也会在 append-only 合并时去重成同一条。
    const id = `baseline:${encodeURIComponent(sym)}:${encodeURIComponent(thesis)}`;
    events.unshift({ id, ts: at, type: "enter", reason: "baseline_existing_assignment", thesis, sym, positions: posSnapshotFor(sym, pf) });
    seen.add(`${sym}|${thesis}`);
    changed = true;
  }
  if (changed) {
    rLSset(THESIS_EVENTS_KEY, events);
    syncPrivateJSON("thesis_events.json", THESIS_EVENTS_KEY, "chore: thesis assignment events via UI");
  }
}

export async function renderRiskControl(host = $("risk-control"), options = {}) {
  return mountLegacyRiskControl(host, {
    ...options,
    rLS, rLSset, rpStatus, rpSchedule, rpSyncNow, loadLocalArray, archiveCurrentThesis,
    renderRiskExposure, getAssignments: () => ASSIGN,
    ARCHIVE_KEY, THESIS_EVENTS_KEY, RISK_POLICY_DIRTY_KEY,
  });
}

const num = (v, d = 2) => (v == null ? "—" : (+v).toFixed(d));

/* 风险敞口热力图(本地专用)。读 data/portfolio.json + data/atr.json + risk_policy 的 thesis。
   在险按 Workflow Bear 情景计算；止损优先手填覆盖，否则使用 In Action 冻结止损。
   多列绿→红:在险% / 在险÷预算 / 仓位%vs上限 / 距止损% / 浮盈%。+ 组合总在险 heat + 分 thesis 小计。
   Thesis 与新成交关联共用 Workflow In Action 归属；止损覆盖存本机 localStorage。 */
const rLS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const rLSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const EXIT_RULES_KEY='portfolioExitRules';
const EXIT_RULES=[['','—'],['expected-return-based','Expected-return-based'],['target-based','Target-based'],['trailing-based','trailing-based']];
const heatBg = (lvl) => { const l = Math.max(0, Math.min(1, lvl || 0)); return `background:hsl(${Math.round(142 * (1 - l))} 65% 45% / ${(0.08 + l * 0.42).toFixed(2)})`; };
let ASSIGN = null;   // {sym: thesis} 由 Workflow In Action 唯一归属派生，只读
let MAXHEAT = null;  // 组合总在险上限%(内存态;本机 localStorage 即时持久化,「保存到 config」再推给 agent)
let SORT = { key: "riskPct", dir: -1 };   // 热力表排序(点表头切换;文本默认升序、数值默认降序;null 永远排最后)
let PRICE_OVERRIDE = null, PRICE_SYNCED_AT = null;   // 「同步现价」按钮从 K线快照拉到的最新价

function sortRows(rows) {
  const { key, dir } = SORT, strK = key === "sym" || key === "bundleName";
  return rows.slice().sort((a, b) => {
    const va = a[key], vb = b[key];
    if (strK) return dir * String(va || "").localeCompare(String(vb || ""));
    if (va == null && vb == null) return 0;
    if (va == null) return 1; if (vb == null) return -1;   // 缺值排最后
    return dir * (va - vb);
  });
}

export async function renderRiskExposure() {
  const host = $("risk-expo"), heatEl = $("risk-heat"); if (!host) return;
  const [pf, atrJ, P, researchJ] = await Promise.all([
    loadJSON("data/portfolio.json"), loadJSON("data/atr.json"), loadJSON("config/risk_policy.json"),
    loadJSON("data/research.json")]);
  const snap = (researchJ && researchJ.snapshots) || {};   // 每票 K线快照:{price,chg,...}
  if (!pf || !Array.isArray(pf.positions)) {
    if (heatEl) heatEl.innerHTML = '<span class="muted small">Position data unavailable. Refresh broker positions to continue.</span>';
    host.innerHTML = ""; return;
  }
  const ATR = (atrJ && atrJ.atr14) || {},assignmentCases=readWorkflowAssignmentCases(),activeCases=workflowOwnershipCases(assignmentCases),ownership=workflowOwnershipIndex(assignmentCases);
  const LP = rLS("riskPolicy", {});   // thesis 编辑器的本机即时态,优先于 config 文件,让改动立刻反映到热力表
  const bundles = LP.bundles || (P && P.bundles) || { "常规": { risk_pct: 0.75, atr_mult: 2.0, max_position_pct: 20 } };
  const bnames = activeCases.map(c=>c.title);
  MAXHEAT = +rLS("riskMaxHeat", (P && P.portfolio && P.portfolio.max_total_heat_pct) ?? 6);
  const maxHeat = MAXHEAT;
  ASSIGN=Object.fromEntries([...ownership].filter(([,owners])=>owners.length===1).map(([symbol,[owner]])=>[symbol,owner.title]));
  const stops = rLS("riskStops", {});
  const exitRules = rLS(EXIT_RULES_KEY, {});
  const targets = rLS("riskTargets", {});   // 每仓止盈目标价(本机,可空)
  // Net Liquidation Value直接从 portfolio.json 读:按账户(All/各账户)汇总持仓市值
  const accounts = pf.accounts || [];
  // 风险热力图与 Portfolio 顶部账户选择保持一致,不再维护独立账户状态。
  const portfolioAccount = $("pf-acct")?.value || null;
  const acctSel = portfolioAccount || "ALL";
  const positions = acctSel === "ALL" ? mergeAccountPositions(pf.positions) : pf.positions.filter(p=>p.account===acctSel);
  // 净值:每账户优先用 portfolio.json 的 net liq(build_portfolio 从 MCP get_portfolio 带出),缺则回退该账户Total Position Market Value
  const acctMV = {};
  for (const p of pf.positions) acctMV[p.account] = (acctMV[p.account] || 0) + (p.mkt_value || 0);
  const acctEq = (a) => (a && a.equity != null) ? a.equity : (acctMV[a && a.id] || 0);
  let equity, eqSrc;
  if (acctSel === "ALL") {
    equity = accounts.reduce((s, a) => s + acctEq(a), 0);
    eqSrc = accounts.length && accounts.every((a) => a.equity != null) ? "net liq" : "Net Liq / Market Value (mixed)";
  } else {
    const a = accounts.find((x) => x.id === acctSel);
    equity = acctEq(a); eqSrc = (a && a.equity != null) ? "net liq" : "Total Position Market Value";
  }
  const equityReliable=acctSel==='ALL'?accounts.length>0&&accounts.every(a=>positiveNum(a.equity)):positiveNum(accounts.find(a=>a.id===acctSel)?.equity);
  if (!(equity > 0)) { equity = positions.reduce((s, p) => s + Math.abs(p.mkt_value || 0), 0) || 1; eqSrc = "Total Position Market Value · Risk budget check unavailable"; }

  const budgetPositions=positions.map(p=>{const override=p.kind==='equity'&&PRICE_OVERRIDE?.[p.sym]!=null;return {...p,price:override?PRICE_OVERRIDE[p.sym]:p.price,mkt_value:override?Number(p.qty)*PRICE_OVERRIDE[p.sym]:p.mkt_value};});
  const accountPlan=accountRiskPlan({equity,maxRiskPct:maxHeat,cases:activeCases,positions:budgetPositions,atr:ATR,stops,equityReliable});
  const accountTargets=new Map(accountPlan.rows.flatMap(row=>row.models.map(m=>[`${m.caseId}\u0000${m.bundleId}`,m])));

  const livePrices=marketPricesFromResearch(researchJ);for(const p of positions)if(p.kind==='equity'&&Number(p.price)>0)livePrices[String(p.sym).toUpperCase()]=Number(p.price);
  const workflowModels=new Map(),targetByBundle={},sumNullable=(a,b)=>a==null&&b==null?null:(a??0)+(b??0),freshnessRank={none:0,fresh:0,review:1,stale:2,expired:3};
  for(const c of activeCases){const thesisState=freshnessSummary(thesisFreshness(c,{atr:ATR,prices:livePrices}));for(const model of nebulaRiskModels(c,equity,ATR)){
    const adjusted=accountTargets.get(`${model.caseId}\u0000${model.bundleId}`);
    model.nebulaTargetFraction=model.targetFraction;model.targetFraction=adjusted?.accountFraction??null;model.targetCapital=adjusted?.accountCapital??null;
    const relevantIssues=thesisState.issues.filter(value=>!value.bundleId||value.bundleId===model.bundleId),bundleState=thesisState.bundles[model.bundleId]?.status||'fresh',relevantStatus=relevantIssues.reduce((status,value)=>freshnessRank[value.status]>freshnessRank[status]?value.status:status,bundleState);
    model.freshnessStatus=relevantStatus;model.freshnessIssues=relevantIssues.map(value=>value.message);
    const key=`${c.id}\u0000${model.underlying}`,previous=workflowModels.get(key),excludedReasons=[...(previous?.excludedReasons||[]),...(model.excluded&&model.exclusionReason?[model.exclusionReason]:[])];
    const preferred=previous&&!previous.excluded?previous:model;
    const freshnessStatus=previous&&freshnessRank[previous.freshnessStatus]>freshnessRank[model.freshnessStatus]?previous.freshnessStatus:model.freshnessStatus;
    workflowModels.set(key,{...preferred,targetFraction:sumNullable(previous?.targetFraction,model.targetFraction),targetCapital:sumNullable(previous?.targetCapital,model.targetCapital),excluded:previous?previous.excluded&&model.excluded:model.excluded,partiallyExcluded:previous?previous.partiallyExcluded||previous.excluded!==model.excluded:false,excludedReasons:[...new Set(excludedReasons)],freshnessStatus,freshnessIssues:[...new Set([...(previous?.freshnessIssues||[]),...model.freshnessIssues])]});
    if(ownership.get(model.underlying)?.length===1&&model.targetCapital!=null)targetByBundle[c.title]=(targetByBundle[c.title]||0)+model.targetCapital;
  }}

  // All Accounts先合并同标的同方向持仓，再用总净值计算每列；
  // 成本直接读取券商持仓均价，All Accounts按绝对数量加权。
  const rows = []; let totalHeat = 0;
  const heatByBundle = {}, posByBundle = {};
  for (const p of positions) {
    const sym = p.sym,underlying=p.kind==='equity'?sym:String(sym||'').split(/\s+/)[0], qty = p.qty || 0; if (!isHeatmapPosition(p)) continue;
    const isOpt = p.kind !== "equity", long = qty > 0;
    // 现价:默认用 portfolio.json(MCP 刷新价),不自动同步 K线快照;须手动点「同步现价(K线)」才用 PRICE_OVERRIDE
    const price = (!isOpt && PRICE_OVERRIDE && PRICE_OVERRIDE[sym] != null) ? PRICE_OVERRIDE[sym] : p.price;
    const cost=p.avg_cost!==''&&p.avg_cost!=null&&Number.isFinite(Number(p.avg_cost))?Number(p.avg_cost):null;
    const marketValue=heatmapMarketValue({...p,price,mkt_value:!isOpt&&PRICE_OVERRIDE&&PRICE_OVERRIDE[sym]!=null?qty*price:p.mkt_value});
    const owners=ownership.get(underlying)||[],owner=owners.length===1?owners[0]:null;
    const bundleName = owner?.title||'',b=bundles[bundleName]||{},model=owner?workflowModels.get(`${owner.id}\u0000${underlying}`):null,atr=ATR[underlying];
    const manualStop=stops[underlying],hasManualStop=manualStop!==''&&manualStop!=null&&Number.isFinite(+manualStop);
    const stopOverride=hasManualStop?+manualStop:(!isOpt?model?.stopPrice:null);
    const estimate = estimatePositionRisk({position: p, atr, bundle:{...b,atr_mult:null}, stop: stopOverride, price});
    const stop = estimate.stop;
    const perShare = (stop != null && price != null) ? (long ? price - stop : stop - price) : null;
    const openRisk = heatmapBearRisk(marketValue,model?.bearReturn);
    const posPct = marketValue==null?null:marketValue / equity * 100;
    const riskPct = openRisk != null ? openRisk / equity * 100 : null;
    const distPct = (perShare != null && price) ? perShare / price * 100 : null;
    if (openRisk != null) { totalHeat += openRisk; heatByBundle[bundleName] = (heatByBundle[bundleName] || 0) + openRisk; }
    if(marketValue!=null)posByBundle[bundleName] = (posByBundle[bundleName] || 0) + marketValue;
    // 浮盈%:股票用现价算,做空取反(价跌为盈);期权回退 portfolio.json 的 pnl_pct
    const pnlPct = (!isOpt && cost>0 && price != null)
      ? (long ? (price / cost - 1) : (1 - price / cost)) * 100
      : (p.pnl_pct != null ? p.pnl_pct * 100 : null);
    rows.push({ sym,underlying,isOpt, long, qty, price, cost,owner,owners,sourcePositions:p.source_positions,
                stop, atr, bundleName, model,
                perShare,mktValue:marketValue,stopAuto:!isOpt&&!hasManualStop&&model?.stopPrice!=null,
                openRisk,riskPct,posPct,distPct,pnlPct,toTarget:null,targetCapital:null,targetDistPct:null });
  }
  const capitalBySymbol={};for(const r of rows)capitalBySymbol[r.underlying]=(capitalBySymbol[r.underlying]||0)+r.mktValue;
  for(const r of rows){
   const total=capitalBySymbol[r.underlying]||0,share=total>0?r.mktValue/total:1;
   r.targetCapital=r.model?.targetCapital==null?null:r.model.targetCapital*share;
   // Target capital is current market value; convert to shares at the current price.
   if(!r.isOpt&&r.price>0&&r.targetCapital!=null&&accountPlan.rows.find(row=>row.id===r.owner?.id)?.actualRisk!=null)r.toTarget=r.targetCapital/r.price-Math.abs(r.qty);
  }
  const sorted = sortRows(rows);
  const disp = [...sorted.filter((r) => !r.isOpt), ...sorted.filter((r) => r.isOpt)];   // 期权统一排到最下方(各组内仍按当前排序)

  const cell = (txt, lvl) => `<td class="sc-num"${lvl == null ? "" : ` style="${heatBg(lvl)}"`}>${txt}</td>`;
  const pnlCell = (v) => { if (v == null) return "<td>—</td>"; const l = Math.min(Math.abs(v) / 40, 1), hue = v >= 0 ? 142 : 0; return `<td class="sc-num" style="background:hsl(${hue} 65% 45% / ${(0.06 + l * 0.34).toFixed(2)})">${v >= 0 ? "+" : ""}${v.toFixed(0)}%</td>`; };
  const thesisCell = r=>{
    if(r.owners.length>1)return `<span class="down" title="${esc(r.owners.map(c=>c.title).join(' / '))}；Resolve duplicate ownership in Workflow">Ownership Conflict</span>`;
    const link=r.owner?`workflow.html?node=construction#${encodeURIComponent(r.owner.id)}`:'';
    if(r.owner&&workflowHasBudgetUnderlying(r.owner,r.underlying))return `<a href="${link}" title="Defined by the Workflow In Action allocation">${esc(r.owner.title)}</a>`;
    return `<select class="rk-grpsel" data-sym="${esc(r.underlying)}" aria-label="${esc(r.sym)} Thesis Assignment" title="Select a Thesis, then use Auto-fill in its Portfolio Construction"${assignmentCases.length?'':' disabled'}><option value="">${assignmentCases.length?'— Select Thesis —':'No Active Thesis'}</option>${assignmentCases.map(c=>`<option value="${esc(c.id)}"${r.owner?.id===c.id?' selected':''}>${esc(c.title)}</option>`).join('')}</select>${r.owner?` <a href="${link}" title="Open Portfolio Construction Auto-fill" aria-label="Open ${esc(r.owner.title)}">↗</a>`:''}`;
  };
  const exitSelect=r=>{
    const symbol=String(r.underlying).trim().toUpperCase(),saved=exitRules?.[symbol],value=EXIT_RULES.some(([key])=>key===saved)?saved:'';
    return `<select class="rk-exit" data-sym="${esc(symbol)}" aria-label="${esc(r.sym)} Exit">${EXIT_RULES.map(([key,label])=>`<option value="${key}"${value===key?' selected':''}>${label}</option>`).join('')}</select>`;
  };
  const stopIn = (r) => `<input class="rk-stopin" data-sym="${esc(r.sym)}" type="number" step="0.01" value="${r.stop != null ? r.stop.toFixed(2) : ""}"${r.stopAuto?` data-auto="1" title="Frozen stop from ${esc(r.bundleName)} In Action Risk Budget${r.model?.stopAt?` · ${(r.model.stopAt||'').slice(0,10)}`:''}; Manual override allowed"`:''} placeholder="${r.isOpt ? "Option" : (r.atr != null ? "ATR" : "Manual")}" style="width:70px${r.stopAuto?";color:#8b96ad":""}">`;
  // 止盈价:手填(riskTargets)覆盖优先;否则正股按 Workflow Bull Case 的 Underlying Price Move 从 In Action 冻结 Reference Spot 推导。
  const autoTp = (r) => {
    if (targets[r.sym] != null) return { v: +targets[r.sym], auto: false };
    if (!r.isOpt && r.model?.bullPriceMove != null && r.model.referencePrice>0)
      return { v: +(r.model.referencePrice * (1 + r.model.bullPriceMove / 100)).toFixed(2), auto: true };
    return { v: null, auto: false };
  };
  const tpIn = (r) => { const t = autoTp(r);
    return `<input class="rk-tpin" data-sym="${esc(r.sym)}" type="number" step="0.01" value="${t.v != null ? t.v : ""}"${t.auto ? ` data-auto="1" title="From ${esc(r.bundleName)} Bull Case ${r.model.bullPriceMove>=0?'+':''}${r.model.bullPriceMove}%，Calculated from In Action Reference Spot; manual override allowed"` : ""} placeholder="Take Profit" style="width:70px${t.auto ? ";color:#8b96ad" : ""}">`; };
  const targetDistance=r=>{const target=autoTp(r).v;if(target==null||!(r.price>0))return null;return (r.long?target-r.price:r.price-target)/r.price*100;};
  const tgtCell = (r) => {   // 符号=交易方向(+买/-卖或做空);颜色=敞口变化(绿增仓/红减仓)
    if (r.toTarget == null || !isFinite(r.toTarget)) return "<td>—</td>";
    const tradeQty = r.long ? r.toTarget : -r.toTarget;
    if (Math.abs(tradeQty) < 0.05) return `<td class="sc-num" title="At target position">0.0</td>`;
    const increasing = r.toTarget > 0;
    const signed = `${tradeQty > 0 ? "+" : "−"}${Math.abs(tradeQty).toFixed(2)}`;
    const action = tradeQty > 0 ? (r.long ? "Buy" : "Buy to Cover") : (r.long ? "Sell" : "Sell Short");
    return `<td class="sc-num ${increasing ? "up" : "down"}" title="${action} ${Math.abs(tradeQty).toFixed(2)} shares; green = increase exposure, red = reduce exposure">${signed}</td>`;
  };
  const arrow = (k) => SORT.key === k ? (SORT.dir < 0 ? " ↓" : " ↑") : "";
  const sth = (k, label, driven = false) => `<th class="rk-sort${driven ? " rk-thesis-driven" : ""}" data-k="${k}" style="cursor:pointer;user-select:none;white-space:nowrap">${label}${arrow(k)}</th>`;
  const eligibilityBadge=r=>{if(!r.model?.excluded&&!r.model?.partiallyExcluded)return '';const label=r.model.excluded?'Excluded':'Partially Excluded',reason=(r.model.excludedReasons||[r.model.exclusionReason]).filter(Boolean).join('; ')||'One or more Bundles are excluded from risk allocation';return ` <span class="ff-warning" title="${esc(reason)}">⚠ ${label}</span>`;};
  const freshnessBadge=r=>{const status=r.model?.freshnessStatus;if(!['review','stale','expired'].includes(status))return '';const label={review:'Review',stale:'Stale',expired:'Expired'}[status],reason=(r.model.freshnessIssues||[]).join('; ')||'Thesis parameters require review';return ` <span class="ff-warning freshness-${status}" title="${esc(reason)}">⚠ ${label}</span>`;};
  const body = disp.map((r) => `<tr>
    <td class="sc-tk"><b>${esc(r.sym)}</b>${eligibilityBadge(r)}${freshnessBadge(r)} <span class="sc-dir ${r.long ? "up" : "down"}">${r.isOpt ? "Option" : r.long ? "Long" : "Short"}</span></td>
    <td>${exitSelect(r)}</td><td>${thesisCell(r)}</td><td${r.sourcePositions?` title="${esc(r.sourcePositions.map(p=>`${accountDisplayName(p.account)}: ${num(p.qty)}`).join(' · '))}"`:''}>${num(r.qty)}</td><td>$${r.price != null ? r.price.toFixed(2) : "—"}</td>
    <td class="muted" title="${r.cost!=null?`Actual Broker Cost Basis · ${r.isOpt?'Per contract':'Per share'}${r.sourcePositions?' · Weighted by absolute quantity':''}`:'Cost basis unavailable; refresh broker positions'}">${r.cost != null ? '$'+r.cost.toFixed(2) : "—"}</td>
    <td>${tpIn(r)}</td><td>${stopIn(r)}</td>
    ${cell(r.posPct==null?'—':r.posPct.toFixed(1) + "%", r.targetCapital>0&&r.mktValue!=null ? Math.min(r.mktValue/r.targetCapital,1) : null)}
    ${pnlCell(r.pnlPct)}
    ${cell(r.distPct!=null?r.distPct.toFixed(1)+"%":"—",r.distPct==null?null:Math.max(0,Math.min(1,1-r.distPct/15)))}
    ${cell(targetDistance(r)!=null?targetDistance(r).toFixed(1)+"%":"—",null)}
    ${cell(r.riskPct != null ? r.riskPct.toFixed(2) + "%" : "—", r.riskPct == null ? null : Math.min(r.riskPct / 2, 1))}
    ${tgtCell(r)}</tr>`).join("");

  host.innerHTML = `<div class="sc-wrap"><table class="sc-table">
    <tr>${sth("sym", "Ticker")}<th>Exit</th>${sth("bundleName", "Thesis")}<th>Shares</th><th>Price</th><th>Cost Basis</th><th class="rk-thesis-driven">Take Profit</th><th class="rk-thesis-driven">Stop Loss</th>${sth("posPct", "Position %")} ${sth("pnlPct", "Profit / Loss %")}
        ${sth("distPct", "Stop Loss %", true)}<th class="rk-thesis-driven">Take Profit %</th>
        ${sth("riskPct", "Bear Risk %", true)}${sth("toTarget", "Shares to Target", true)}</tr>${body}</table></div><p id="rk-assignment-status" class="down small" role="status"></p>
    `;

  const accountLabel = acctSel === "ALL" ? "All Accounts" : accountDisplayName(acctSel,accounts.find((a) => a.id === acctSel)?.label);
  const percent=value=>value==null?'—':`${(value*100).toFixed(2)}%`;
  const money=value=>value==null?'—':`$${Math.round(value).toLocaleString()}`;
  const riskText=value=>value==null?'—':`${money(value)} · ${equityReliable?percent(value/equity):'Net Liq unavailable'}`;
  const tile=(label,value,note='')=>`<div class="opt-tile"><div class="opt-k">${label}</div><div class="opt-v">${value}</div><div class="opt-sub">${note}</div></div>`;
  const planRows=accountPlan.rows.map(row=>`<tr data-budget-case="${esc(row.id)}"><td><a href="workflow.html?node=risk#${encodeURIComponent(row.id)}">${esc(row.title)}</a></td><td>${riskText(row.actualRisk)}</td><td>${riskText(row.targetRisk)}</td><td>${riskText(row.actualCapital)}</td><td>${percent(row.nebulaFraction)}</td><td>${percent(row.accountFraction)}</td></tr>`).join('');
  heatEl.innerHTML = `<div class="wb-statbar">
    ${tile('Account Scope',esc(accountLabel),'Follows the selected account; ALL uses the combined account budget')}
    ${tile('Net Liquidation Value',equityReliable?money(equity):'—',esc(eqSrc))}
    ${tile('Account Risk Limit',`<input id="rk-maxheat" aria-label="Account Risk Limit (%)" type="number" min="0.01" step="0.5" value="${maxHeat}" style="width:70px">%`,`${money(accountPlan.totalBudget)} · Selected Net Liq × shared risk limit`)}
    ${tile('Kelly Fraction','0.5×','Fixed globally; independent of Kelly Tilt')}
    </div><div class="wb-statbar" style="margin-top:12px">
    ${tile('Actual Positions · Risk Used',riskText(accountPlan.actualRisk),accountPlan.actualIssues.length?'Incomplete data; risk is not zero':`Includes other positions ${riskText(accountPlan.otherRisk)}`)}
    ${tile('Actual Positions · Remaining / Excess Risk Budget',riskText(accountPlan.actualRemaining),accountPlan.actualRemaining<0?'Current positions exceed the risk budget':'Actual positions do not change automatically with targets')}
    ${tile('Target Plan · Unconstrained Risk',riskText(accountPlan.proposedRisk))}
    ${tile('Target Plan · Constrained Risk',riskText(accountPlan.targetRisk),`Target Scale ${percent(accountPlan.scale)} · Target Market Value ${percent(accountPlan.targetCapitalFraction)} · Cash ${percent(accountPlan.cashFraction)}`)}
    </div>
    ${accountPlan.issues.length?`<p class="down" role="status">Risk budget check unavailable: ${accountPlan.issues.map(esc).join('; ')}</p>`:''}
    ${accountPlan.actualIssues.length?`<p class="down small">Actual Risk requires review: ${accountPlan.actualIssues.map(esc).join('; ')}. Known Risk ${riskText(accountPlan.knownActualRisk)}.</p>`:''}
    <div class="sc-wrap"><table class="sc-table" id="account-budget-table"><thead><tr><th>Nebula</th><th>Actual Risk (Bear)</th><th>Target Risk</th><th>Actual Position</th><th>Nebula Target</th><th>Account Target</th></tr></thead><tbody>${planRows}<tr><td>Other Positions (Retained)</td><td>${riskText(accountPlan.otherRisk)}</td><td>${riskText(accountPlan.otherRisk)}</td><td>${riskText(accountPlan.otherCapital)}</td><td>—</td><td>${percent(accountPlan.otherCapital/equity)}</td></tr></tbody></table></div>

    <p class="muted small">Position Source: ${esc(pf.source_updated_at||pf.updated_at||'Unknown')} · ATR: ${esc(atrJ?.updated||'Unknown')}</p>
    <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button id="rk-syncpx" class="mini-btn">🔄 Refresh Market Prices</button>
      <span class="muted small">Price Source: ${PRICE_OVERRIDE ? `Market snapshot @ ${(PRICE_SYNCED_AT || "").slice(5, 16).replace("T", " ")}` : "Broker snapshot; use Refresh Market Prices to update"}</span>
    </div>
    `;
  const mh = $("rk-maxheat"); if (mh) mh.addEventListener("change", () => { if(!positiveNum(mh.value)){mh.setCustomValidity('Account Risk Limit must be greater than zero');mh.reportValidity();return;}mh.setCustomValidity('');MAXHEAT = +mh.value; rLSset("riskMaxHeat", MAXHEAT); renderRiskExposure(); rpSchedule(); });
  host.querySelectorAll(".rk-sort").forEach((th) => th.addEventListener("click", () => {   // 点表头排序:同列切方向,换列文本升/数值降
    const k = th.dataset.k;
    SORT = SORT.key === k ? { key: k, dir: -SORT.dir } : { key: k, dir: (k === "sym" || k === "bundleName") ? 1 : -1 };
    renderRiskExposure();
  }));
  host.querySelectorAll('.rk-exit').forEach(el=>el.addEventListener('change',()=>{
    const status=$('rk-assignment-status');
    try{
      if(!EXIT_RULES.some(([key])=>key===el.value))throw Error('Invalid exit rule');
      const saved=rLS(EXIT_RULES_KEY,{}),rules=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{},symbol=el.dataset.sym;
      if(el.value)rules[symbol]=el.value;else delete rules[symbol];
      localStorage.setItem(EXIT_RULES_KEY,JSON.stringify(rules));
      host.querySelectorAll('.rk-exit').forEach(other=>{if(other.dataset.sym===symbol)other.value=el.value;});
      if(status)status.textContent='';
    }catch(error){if(status)status.textContent='Exit save failed: '+error.message;}
  }));
  host.querySelectorAll(".rk-stopin").forEach((el) => el.addEventListener("change", () => { const s = rLS("riskStops", {}), v = el.value.trim(); if (v === "") delete s[el.dataset.sym]; else s[el.dataset.sym] = +v; rLSset("riskStops", s); renderRiskExposure(); }));
  host.querySelectorAll(".rk-tpin").forEach((el) => el.addEventListener("change", () => { const t = rLS("riskTargets", {}), v = el.value.trim(); if (v === "") delete t[el.dataset.sym]; else t[el.dataset.sym] = +v; rLSset("riskTargets", t); renderRiskExposure(); }));   // 止盈价:空=删除→留白
  host.querySelectorAll('.rk-grpsel').forEach(el=>el.addEventListener('change',async()=>{
    try{await savePortfolioWorkflowOwner(el.dataset.sym,el.value);await renderRiskExposure();}
    catch(error){await renderRiskExposure();const status=$('rk-assignment-status');if(status)status.textContent='Assignment save failed: '+error.message;}
  }));
  const sp = $("rk-syncpx"); if (sp) sp.addEventListener("click", async () => {
    sp.textContent = "Refreshing…";
    const r = await loadFreshJSON("data/research.json");   // 从 data 分支拉最新 K线快照(比本地文件新)
    const s = (r && r.snapshots) || {};
    if (Object.keys(s).length) {
      PRICE_OVERRIDE = {};
      for (const k in s) if (s[k] && s[k].price != null) PRICE_OVERRIDE[k] = s[k].price;
      PRICE_SYNCED_AT = r.updated_at || new Date().toISOString();
    }
    renderRiskExposure();
  });
}

/* 组合稳健性:累计 $P&L(M2M,含未实现)曲线 + 对 SPY 的 β/α。读 data/robustness.json(本地/私有)。
   时间范围切换:曲线从窗口起点归零重画、统计只算该窗口。 */
let ROBUST = null;
const ROBUST_COL = { _all: "#60a5fa", "rh-7159": "#34d399", "takku-rh-2566": "#fbbf24" };

export async function renderRobust() {
  const el = $("robust-chart"); if (!el) return;
  const sec = $("sec-robust");
  ROBUST = await loadFreshJSON("data/robustness.json");
  if (!ROBUST || !ROBUST.accounts) { if (sec) sec.style.display = "none"; return; }
  const rg = $("robust-range");
  if (rg) rg.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    [...rg.children].forEach((x) => x.classList.toggle("active", x === b));
    drawRobust(b.dataset.w);
  });
  drawRobust("ytd");   // 默认 YTD
}

function drawRobust(win) {
  const r = ROBUST, el = $("robust-chart"); if (!r || !el) return;
  const start = (r.window_starts && r.window_starts[win]) || "1900-01-01";
  el.innerHTML = "";   // 重画
  const chart = LWC.createChart(el, {
    layout: { background: { color: "transparent" }, textColor: "#8b96ad" },
    grid: { vertLines: { color: "#1e2941" }, horzLines: { color: "#1e2941" } },
    rightPriceScale: { borderColor: "#2a3550" }, timeScale: { borderColor: "#2a3550" }, height: 320,
  });
  const order = ["_all", ...Object.keys(r.accounts).filter((k) => k !== "_all")];
  const legend = [];
  order.forEach((k, i) => {   // 曲线:各账户 总累计$P&L(curve[*][1]),窗口起点归零
    const o = r.accounts[k]; if (!o || !o.curve || !o.curve.length) return;
    const sliced = o.curve.filter((row) => row[0] >= start);
    if (!sliced.length) return;
    const base = sliced[0][1];
    const col = ROBUST_COL[k] || `hsl(${i * 70} 60% 60%)`;
    const seen = new Set(), data = [];
    for (const row of sliced) if (!seen.has(row[0])) { seen.add(row[0]); data.push({ time: row[0], value: row[1] - base }); }
    chart.addLineSeries({ color: col, lineWidth: k === "_all" ? 2 : 1, priceLineVisible: false, lastValueVisible: false }).setData(data);
    const last = sliced[sliced.length - 1][1] - base;
    legend.push(`<span class="rt-leg"><span class="rt-sw" style="background:${col}"></span>${esc(accountDisplayName(k,o.label))} <b class="${last >= 0 ? "up" : "down"}">${last >= 0 ? "+" : "−"}$${Math.abs(Math.round(last)).toLocaleString()}</b></span>`);
  });
  chart.timeScale().fitContent();
  $("robust-legend").innerHTML = legend.join("");
  // ── 统计:总收益 β/α/Sharpe + bootstrap CI + 显著性;Long / Short Attribution ──
  const c = (v, s = "") => (v == null ? "—" : v + s);
  const a = (v) => `class="${(v ?? 0) >= 0 ? "up" : "down"}"`;
  const ciS = (ci) => (ci ? ` <span class="muted" style="font-size:10px">[${ci[0]},${ci[1]}]</span>` : "");
  const trs = order.map((k) => {
    const o = r.accounts[k], w = (o.windows && o.windows[win]) || {}, ci = w.ci || {};
    const sig = w.alpha_annual_pct == null ? "" : (ci.alpha_sig
      ? ' <span class="up" style="font-size:10px">✓ Significant</span>'
      : ' <span class="muted" style="font-size:10px">≈0</span>');
    return `<tr><td><b>${esc(accountDisplayName(k,o.label))}</b></td><td>${c(w.beta)}${ciS(ci.beta)}</td>`
      + `<td ${a(w.alpha_annual_pct)}>${c(w.alpha_annual_pct, "%")}${ciS(ci.alpha)}${sig}</td>`
      + `<td ${a(w.sharpe)}>${c(w.sharpe)}${ciS(ci.sharpe)}</td>`
      + `<td ${a(w.ret_annual_pct)}>${c(w.ret_annual_pct, "%")}</td><td>${c(w.avg_net_gross)}</td><td>${c(w.n)}</td></tr>`;
  }).join("");
  const legCell = (x) => (x && x.ret_annual_pct != null
    ? `<span class="${x.ret_annual_pct >= 0 ? "up" : "down"}">${x.ret_annual_pct}%</span>${ciS(x.ret_ci)} <span class="muted" style="font-size:10px">β${c(x.beta)}·n${c(x.n)}</span>`
    : "—");
  const legRows = order.map((k) => {
    const w = (r.accounts[k].windows && r.accounts[k].windows[win]) || {};
    return `<tr><td><b>${esc(accountDisplayName(k,r.accounts[k].label))}</b></td><td>${legCell(w.long)}</td><td>${legCell(w.short)}</td></tr>`;
  }).join("");
  $("robust-stats").innerHTML =
    `<div class="sc-wrap"><table class="bt-table"><tr><th>Account</th><th>Beta</th><th>Annualized Alpha (95% CI)</th><th>Sharpe</th><th>Annualized Return</th><th>Net / Gross</th><th>n</th></tr>${trs}</table></div>`
    + `<h3>Long / Short Attribution</h3>`
    + `<div class="sc-wrap"><table class="bt-table"><tr><th>Account</th><th>Long Leg</th><th>Short Leg</th></tr>${legRows}</table></div>`;
}

/* 交易复盘:计划(事前登记 edge+计划价+thesis)→ 归因。归档是 append-only 不可变审计记录：
   可读取/导出，不可在 UI 编辑；跨机器同步只追加新 ID，绝不覆盖已有 ID。 */
const PRIV_REPO = "takkujunjieli/stock-dashboard-private";   // 私有库:持仓/复盘/止损等本地数据(换机器 clone 即在)
async function appendPrivateRecords(path, incoming, msg) {   // 远端为权威；只追加未见 ID，409 后重新合并
  const pat = getPat();
  if (!pat) return { ok: false, msg: "需 PAT(含私有库写权限)" };
  const url = `https://api.github.com/repos/${PRIV_REPO}/contents/${path}`;
  async function once() {
    let sha, remote = [];
    try {
      const c = await fetch(url + "?ref=main&t=" + Date.now(), { headers: ghHeaders(pat), cache: "no-store" });
      if (c.ok) {
        const j = await c.json(); sha = j.sha;
        remote = JSON.parse(decodeURIComponent(escape(atob((j.content || "").replace(/\s/g, "")))));
      } else if (c.status !== 404) return { direct: { ok: false, msg: "GET " + c.status } };
    } catch (e) { return { direct: { ok: false, msg: "GET " + String(e) } }; }
    const merged = mergeImmutableRecords(Array.isArray(remote) ? remote : [], incoming);
    if (merged.length === (Array.isArray(remote) ? remote.length : 0)) return { direct: { ok: true, unchanged: true } };
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(merged, null, 2) + "\n")));
    return fetch(url, { method: "PUT", headers: ghHeaders(pat), body: JSON.stringify({ message: msg, content, sha, branch: "main" }) });
  }
  try {
    let r = await once(); if (r.direct) return r.direct;
    if (r.status === 409) { r = await once(); if (r.direct) return r.direct; }
    return r.ok ? { ok: true } : { ok: false, msg: "PUT " + r.status };
  }
  catch (e) { return { ok: false, msg: String(e) }; }
}

export async function renderJournal(host = document.getElementById("journal")) {
  if (!host) return;
  const $ = id => host.querySelector(`[id="${id}"]`);
  const archives = await loadLocalArray(ARCHIVE_KEY, "data/completed_theses.json");
  const events = await loadLocalArray(THESIS_EVENTS_KEY, "data/thesis_events.json");
  const workflowArchives = workflowArchiveHTML();
  const chosen = localStorage.getItem("reviewThesisId") || (archives[0] && archives[0].id);
  const cur = archives.find((a) => a.id === chosen) || archives[0];
  if (!cur) {
    host.innerHTML = workflowArchives + `<div class="muted small">暂无旧版已归档 thesis。点账户风险控制里的「完成并归档」后,这里会展示完整复盘记录。</div>`;
    return;
  }
  const opts = archives.map((a) => `<option value="${esc(a.id)}"${a.id === cur.id ? " selected" : ""}>${esc(a.name)} · ${(a.completed_at || "").slice(0, 10)}</option>`).join("");
  const b = cur.thesis || {};
  const kv = (k, v) => `<div class="opt-tile"><div class="opt-k">${k}</div><div class="opt-v">${v == null || v === "" ? "—" : esc(String(v))}</div></div>`;
  const rows = (cur.tickers || []).map((t) => {
    const evs = events.filter((e) => e.sym === t.sym && e.thesis === cur.name);
    const enter = evs.find((e) => e.type === "enter");
    const exit = evs.find((e) => e.type === "exit");
    const fmtSnap = (snap) => (snap || []).map((p) => `${esc(accountDisplayName(p.account))} ${esc(p.kind || "")} ${num(p.qty)} @ ${num(p.price)}`).join("<br>") || "—";
    return `<tr><td class="sc-tk"><b>${esc(t.sym)}</b></td>
      <td>${enter ? `<span class="muted small">${(enter.ts || "").slice(0, 16).replace("T", " ")}</span><br>${fmtSnap(enter.positions)}` : "—"}</td>
      <td>${exit ? `<span class="muted small">${(exit.ts || "").slice(0, 16).replace("T", " ")}</span><br>${fmtSnap(exit.positions)}` : fmtSnap(t.positions)}</td></tr>`;
  }).join("");
  host.innerHTML = workflowArchives + `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <label>已归档 Thesis <select id="j-archive">${opts}</select></label>
      <span id="j-msg" class="muted small">只读归档 · 共 ${archives.length} 个 · ${(cur.tickers || []).length} 个 ticker</span>
    </div>
    <div class="wb-statbar">
      ${kv("完成时间", (cur.completed_at || "").slice(0, 19).replace("T", " "))}
      ${kv("单笔风险%", b.risk_pct)}
      ${kv("ATR倍数", b.atr_mult)}
      ${kv("单笔仓位上限%", b.max_position_pct)}
      ${kv("总风险%", b.total_risk_pct)}
      ${kv("总仓位上限%", b.total_position_pct)}
      ${kv("Target Profit%", b.target_profit_pct)}
      ${kv("Shelf life", b.shelf)}
    </div>
    <div class="risk-form" style="margin-top:10px">
      <label style="flex:1;min-width:280px">Edge<input value="${esc(b.edge || "")}" disabled style="width:100%"></label>
      <label style="flex:1;min-width:280px">Invalidation<input value="${esc(b.invalid || "")}" disabled style="width:100%"></label>
    </div>
    <div class="sc-wrap" style="margin-top:12px"><table class="sc-table">
      <tr><th>标的</th><th>进入该 thesis 时</th><th>离开/归档时</th></tr>${rows || `<tr><td colspan="3" class="muted">没有记录到属于该 thesis 的 ticker。</td></tr>`}
    </table></div>
    <label style="display:block;margin-top:12px">Note（归档快照，只读）<textarea readonly style="width:100%;min-height:110px;background:var(--card-hover);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--muted)">${esc(cur.notes || "")}</textarea></label>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
      <button id="j-export" class="mini-btn">导出归档 JSON</button>
    </div>`;
  $("j-archive").addEventListener("change", (ev) => { localStorage.setItem("reviewThesisId", ev.target.value); renderJournal(host); });
  $("j-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(archives, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "completed_theses.json"; a.click();
  });
}
