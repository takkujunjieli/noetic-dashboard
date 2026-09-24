// Shared risk-control component: legacy Portfolio editor and Workflow instance adapter.
import { esc, loadJSON, getPat, setPat } from "./shared.js";
import { positiveNum, calculateSizing } from "./risk-budget.mjs";

export async function mountLegacyRiskControl(host, services) {
  if (!host) return;
  const {rLS, rLSset, rpStatus, rpSchedule, rpSyncNow, loadLocalArray, archiveCurrentThesis, renderRiskExposure, getAssignments, ARCHIVE_KEY, THESIS_EVENTS_KEY, RISK_POLICY_DIRTY_KEY} = services;
  const $ = id => host.querySelector(`[id="${id}"]`);
  host._riskCleanup?.();
  const controller = new AbortController();
  host._riskCleanup = () => controller.abort();
  const frozen = services.snapshot;
  let POLICY = frozen ? structuredClone(frozen.policy) : (await loadJSON("config/risk_policy.json")) || {};
  if (controller.signal.aborted) return;
  if (!POLICY.bundles || !Object.keys(POLICY.bundles).length) {
    POLICY = { account_equity: 100000, atr_period: 14, default_bundle: "常规",
      bundles: { "常规": { risk_pct: 0.75, atr_mult: 2.0, max_position_pct: 20 } },
      stop_bases: (POLICY && POLICY.stop_bases) || [] };
  }
  // 本机 localStorage 覆盖(thesis 编辑即时本地持久化,免 PAT;刷新不丢);"保存到 config" 再发布给 agent
  const loc = frozen ? null : rLS("riskPolicy", null);
  if (loc && loc.bundles && Object.keys(loc.bundles).length) {
    POLICY.bundles = loc.bundles;
    if (loc.default_bundle) POLICY.default_bundle = loc.default_bundle;
    if (loc.account_equity != null) POLICY.account_equity = loc.account_equity;
  }
  if (loc?.account_equity != null) POLICY.account_equity = loc.account_equity;
  const atrP = POLICY.atr_period ?? 14;
  let cur = (POLICY.default_bundle && POLICY.bundles[POLICY.default_bundle]) ? POLICY.default_bundle : Object.keys(POLICY.bundles)[0];
  if (!services.readonly && services.initialBundle && Object.hasOwn(POLICY.bundles, services.initialBundle)) cur = services.initialBundle;
  const g = (id) => +$(id).value;
  const persistLocal = () => rLSset("riskPolicy", { ...rLS("riskPolicy", {}), bundles: POLICY.bundles, default_bundle: cur, account_equity: g("rk-eq") });
  const T = (k, v, sb = "", cls = "") => `<div class="opt-tile"><div class="opt-k">${k}</div><div class="opt-v ${cls}">${v}${sb ? ` <span class="opt-sub">${sb}</span>` : ""}</div></div>`;
  const bundleOpts = () => Object.keys(POLICY.bundles).map((k) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(k)}</option>`).join("");

  const gt = (id) => { const v = $(id).value; return v === "" ? null : +v; };  // 数值,空→null
  host.innerHTML = `
    <div class="risk-bundles">
      <label>Thesis<span id="rk-sel-wrap"><select id="rk-bundle">${bundleOpts()}</select></span></label>
      <input id="rk-newname" type="text" placeholder="新 thesis 名" style="width:130px">
      <button id="rk-new" class="mini-btn">＋ 新建</button>
      <span class="rk-menu-wrap"><button id="rk-menu-btn" class="mini-btn" title="当前 thesis 操作:重命名 / 完成 / 删除">⋯</button>
        <div id="rk-menu" class="rk-menu" hidden>
          <button class="rk-menu-item" data-act="rename">✏️ 重命名</button>
          <button class="rk-menu-item" data-act="complete">✅ 完成并归档</button>
          <button class="rk-menu-item rk-danger" data-act="delete">🗑 删除</button>
        </div></span>
      <input id="rk-pat" type="password" value="${esc(services.readonly ? "" : getPat() || "")}" placeholder="粘贴 fine-grained PAT(含私有库写权限)" hidden style="width:230px;background:var(--card-hover);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:12px">
      <button id="rk-sync" class="mini-btn" style="margin-left:auto" title="把本机累计的风险策略改动一次提交到私有库">同步到远端</button>
      <span id="rk-msg" class="muted small"></span>
    </div>
    <div class="risk-form" style="margin-top:10px">
      <label>单笔风险 %<input id="rk-risk" type="number" min="0.01" required step="0.05" style="width:88px" title="必填:用于按 ATR 反推默认单笔仓位上限"></label>
      <label>总风险 %<input id="rk-totrisk" type="number" min="0.01" required step="0.5" style="width:88px" title="必填:该 thesis 所有持仓在险之和上限"></label>
      <label>ATR 倍数<input id="rk-mult" type="number" min="0.01" required step="0.1" style="width:76px"></label>
      <label>单笔仓位上限 %<input id="rk-cap" class="rk-auto-placeholder" type="number" min="0.01" step="1" style="width:112px" placeholder="自动(待持仓/ATR)" title="可选覆盖;留空时按 单笔风险% ÷ (ATR倍数×ATR/现价) 自动反推"></label>
      <label>总仓位上限 %<input id="rk-totcap" class="rk-auto-placeholder" type="number" min="0.01" step="1" style="width:118px" placeholder="自动(待持仓/ATR)" title="可选覆盖;留空时按 典型单笔仓位上限 × 总风险/单笔风险 反推"></label>
      <label>Target Profit %<input id="rk-goal" type="number" step="1" style="width:96px" placeholder="optional"></label>
      <label>Shelf life<input id="rk-shelf" type="date" style="width:150px" title="thesis 有效期(可选);过期未走出=复盘/离场"></label>
    </div>
    <div class="risk-form" style="margin-top:6px">
      <label style="flex:1;min-width:260px">Edge (optional)<input id="rk-edge" style="width:100%" placeholder="为什么这个 thesis 成立…"></label>
      <label style="flex:1;min-width:260px">Invalidation (optional)<input id="rk-invalid" style="width:100%" placeholder="什么情况证明 thesis 被推翻=离场,非亏X%…"></label>
    </div>
    <div class="risk-form" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
      <label>账户净值 $<input id="rk-eq" type="number" step="1000" value="${esc(POLICY.account_equity ?? 100000)}"></label>
      <label>买入价 $<input id="rk-entry" type="number" step="0.01" value="100"></label>
      <label>止损法<select id="rk-mode"><option value="manual">手动止损价</option><option value="atr">ATR 法</option></select></label>
      <label id="rk-stop-wrap">止损价 $<input id="rk-stop" type="number" step="0.01" value="94"></label>
      <label id="rk-atr-wrap" style="display:none">ATR${atrP} $<input id="rk-atr" type="number" step="0.01" value="3"></label>
    </div>
    <div id="rk-out" class="wb-statbar" style="margin-top:12px"></div>
    <div id="rk-note" class="muted small" style="margin-top:6px"></div>
    <div id="rk-done" class="muted small" style="margin-top:10px"></div>
    <div class="muted small" style="margin-top:10px"><b>止损放在 thesis 被证伪处</b>(不是"亏 X% 就卖"):${(POLICY.stop_bases || []).map(esc).join(" · ")}。<br>单笔风险%、总风险%、ATR倍数为必填。默认单笔仓位上限 = 单笔风险% ÷ (ATR倍数×ATR/现价)；默认总仓位上限 = 典型单笔上限 × 总风险/单笔风险。两个仓位上限均可手工覆盖。Target Profit/Shelf life/Edge/Invalidation 可选。改动即时保存在本机；完成一批编辑后点右上「同步到远端」。</div>`;

  const loadBundle = () => { const b = POLICY.bundles[cur] || {};   // 必填项缺失时保持空白，交由用户明确填写
    $("rk-risk").value = b.risk_pct ?? ""; $("rk-mult").value = b.atr_mult ?? ""; $("rk-cap").value = b.max_position_pct ?? "";
    $("rk-totrisk").value = b.total_risk_pct ?? ""; $("rk-totcap").value = b.total_position_pct ?? ""; $("rk-goal").value = b.target_profit_pct ?? "";
    $("rk-shelf").value = b.shelf || ""; $("rk-edge").value = b.edge || ""; $("rk-invalid").value = b.invalid || ""; };
  const syncBundle = () => { const b = POLICY.bundles[cur] || (POLICY.bundles[cur] = {});
    b.risk_pct = gt("rk-risk"); b.atr_mult = gt("rk-mult"); b.max_position_pct = gt("rk-cap");
    b.total_risk_pct = gt("rk-totrisk"); b.total_position_pct = gt("rk-totcap"); b.target_profit_pct = gt("rk-goal");
    b.shelf = $("rk-shelf").value || null; b.edge = $("rk-edge").value.trim(); b.invalid = $("rk-invalid").value.trim(); };

  function compute() {
    const b = POLICY.bundles[cur] || {};
    const eq = g("rk-eq"), entry = g("rk-entry");
    const riskPct = positiveNum(b.risk_pct) ? +b.risk_pct : null;
    const mult = positiveNum(b.atr_mult) ? +b.atr_mult : null;
    const manualMaxPos = positiveNum(b.max_position_pct) ? +b.max_position_pct : null;
    const mode = $("rk-mode").value;
    $("rk-stop-wrap").style.display = mode === "manual" ? "" : "none";
    $("rk-atr-wrap").style.display = mode === "atr" ? "" : "none";
    const stop = mode === "manual" ? g("rk-stop") : (mult != null ? entry - mult * g("rk-atr") : NaN);
    const budget = riskPct != null ? eq * riskPct / 100 : NaN, perShare = entry - stop;
    const out = $("rk-out"), note = $("rk-note");
    if (riskPct == null || mult == null || !positiveNum(b.total_risk_pct)) {
      out.innerHTML = T("提示", "—", "先填写单笔风险%、总风险%、ATR倍数");
      note.textContent = "三个核心风险参数均为必填且须大于 0。";
      return;
    }
    if (!(eq > 0) || !(entry > 0) || !(perShare > 0)) {
      out.innerHTML = T("提示", "—", "止损须在买入价下方");
      note.textContent = mode === "atr" && entry > 0 ? `ATR 止损 = ${entry} − ${mult}×${g("rk-atr")} = ${stop.toFixed(2)}` : "";
      return;
    }
    const result = calculateSizing({ ...b, equity: eq, entry, stop: gt("rk-stop"), atr: gt("rk-atr"), mode });
    if (result.error) { out.innerHTML = T("提示", "—", result.error); note.textContent = ""; return; }
    const {derivedMaxPos, maxPos, shares, posDollar, posPct, capped, actualRisk} = result;
    out.innerHTML = [
      T("风险预算", "$" + budget.toFixed(0), `${riskPct}% × 净值`, "down"),
      T("止损价", "$" + stop.toFixed(2), `每股风险 $${perShare.toFixed(2)}`),
      T("仓位股数", shares.toLocaleString(), capped ? `压到手工 ${maxPos}% 上限` : `自动上限 ${derivedMaxPos.toFixed(1)}%`, "up"),
      T("仓位金额", "$" + posDollar.toFixed(0), `${posPct.toFixed(1)}% 净值`),
      T("实际风险", "$" + actualRisk.toFixed(0), `${(actualRisk / eq * 100).toFixed(2)}% 净值`, "down"),
    ].join("");
    note.innerHTML = `${shares.toLocaleString()} 股 = 预算 $${budget.toFixed(0)} ÷ 每股风险 $${perShare.toFixed(2)}`
      + (capped ? ` · <span class="down">触发 ${maxPos}% 仓位上限 → 压低股数</span>` : "")
      + (mode === "atr" ? ` · ATR 止损 = ${entry} − ${mult}×${g("rk-atr")} = ${stop.toFixed(2)}` : "");
  }

  if (!services.readonly) {
    await loadLocalArray(ARCHIVE_KEY, "data/completed_theses.json");
    await loadLocalArray(THESIS_EVENTS_KEY, "data/thesis_events.json");
  }

  if (controller.signal.aborted) return;
  const renderDone = () => { const done = frozen ? frozen.done || [] : rLS(ARCHIVE_KEY, []);
    $("rk-done").innerHTML = done.length
      ? `<b>已完成 ${done.length}</b>(存档,不计入活跃):` + done.map((d) => `<span class="sc-dir muted" style="margin:2px 3px;display:inline-block">${esc(d.name)}${d.thesis?.target_profit_pct != null ? ` · Target ${d.thesis.target_profit_pct}%` : ""} <span class="muted">${(d.completed_at || "").slice(0, 10)}</span></span>`).join("")
      : ""; };

  host._riskRead = () => ({policy: {...structuredClone(POLICY), default_bundle: cur, account_equity: g("rk-eq")}, calculator: Object.fromEntries(["entry", "mode", "stop", "atr"].map(k => [k, $("rk-" + k).value])), done: structuredClone(frozen ? frozen.done || [] : rLS(ARCHIVE_KEY, []))});
  if (services.readonly) {
    loadBundle();
    for (const key of ["entry", "mode", "stop", "atr"]) if (frozen?.calculator?.[key] != null) $("rk-" + key).value = frozen.calculator[key];
    compute(); renderDone();
    host.querySelectorAll("input, select, button").forEach(el => el.disabled = true);
    $("rk-sync").textContent = "历史快照 · 只读";
    return;
  }
  const rebuildSel = () => { $("rk-sel-wrap").innerHTML = `<select id="rk-bundle">${bundleOpts()}</select>`; };
  // ---- 字段编辑:即时落本机并标记待同步;热力图在 change(失焦/回车)时刷新 ----
  const onEdit = (recompute) => () => { syncBundle(); if (recompute) compute(); persistLocal(); rpSchedule(); };
  ["rk-risk", "rk-mult", "rk-cap"].forEach((id) => { const el = $(id); el.addEventListener("input", onEdit(true)); el.addEventListener("change", () => { renderRiskExposure(); rpSchedule(true); }); });
  ["rk-totrisk", "rk-totcap", "rk-goal"].forEach((id) => { const el = $(id); el.addEventListener("input", onEdit(true)); el.addEventListener("change", () => { renderRiskExposure(); rpSchedule(true); }); });
  ["rk-shelf", "rk-edge", "rk-invalid"].forEach((id) => { const el = $(id); el.addEventListener("input", onEdit(false)); el.addEventListener("change", () => rpSchedule(true)); });
  ["rk-eq", "rk-entry", "rk-stop", "rk-atr"].forEach((id) => $(id).addEventListener("input", compute));
  $("rk-eq").addEventListener("input", () => { persistLocal(); rpSchedule(); });
  $("rk-eq").addEventListener("change", () => rpSchedule(true));
  $("rk-mode").addEventListener("change", compute);
  // ---- thesis 选择(委托,重建 select 后仍有效)+ 内联重命名 ----
  const startRename = () => { $("rk-sel-wrap").innerHTML = `<input id="rk-ren" value="${esc(cur)}" style="width:150px"><button id="rk-ren-ok" class="mini-btn">✓</button><button id="rk-ren-x" class="mini-btn">✕</button>`; const inp = $("rk-ren"); inp.focus(); inp.select(); };
  const applyRename = () => {
    const name = ($("rk-ren") ? $("rk-ren").value : "").trim();
    if (!name || name === cur) return void rebuildSel();
    if (POLICY.bundles[name]) return void ($("rk-msg").textContent = "同名已存在");
    const old = cur;
    const nb = {}; for (const [k, v] of Object.entries(POLICY.bundles)) nb[k === old ? name : k] = v;  // 保序换键
    POLICY.bundles = nb;
    if (POLICY.default_bundle === old) POLICY.default_bundle = name;
    cur = name;
    if (getAssignments()) for (const s of Object.keys(getAssignments())) if (getAssignments()[s] === old) getAssignments()[s] = name;   // 内存分组跟随
    const rg = rLS("riskGroups", {}); let ch = false;
    for (const s of Object.keys(rg)) if (rg[s] === old) { rg[s] = name; ch = true; }             // 本机分组跟随
    if (ch) rLSset("riskGroups", rg);
    rebuildSel(); loadBundle(); compute(); persistLocal(); renderRiskExposure(); rpSchedule(true);
    $("rk-msg").textContent = `已重命名「${old}」→「${name}」`;
  };
  $("rk-sel-wrap").addEventListener("change", (e) => { if (e.target.id === "rk-bundle") { cur = e.target.value; loadBundle(); compute(); persistLocal(); renderRiskExposure(); rpSchedule(true); } });
  $("rk-sel-wrap").addEventListener("click", (e) => { if (e.target.id === "rk-ren-ok") applyRename(); else if (e.target.id === "rk-ren-x") rebuildSel(); });
  $("rk-sel-wrap").addEventListener("keydown", (e) => { if (e.target.id === "rk-ren") { if (e.key === "Enter") applyRename(); else if (e.key === "Escape") rebuildSel(); } });
  // ---- 新建 ----
  $("rk-new").addEventListener("click", () => {
    const name = ($("rk-newname").value || "").trim();
    if (!name) return void ($("rk-msg").textContent = "先填 thesis 名");
    if (POLICY.bundles[name]) return void ($("rk-msg").textContent = "同名已存在");
    POLICY.bundles[name] = { risk_pct: null, atr_mult: null, max_position_pct: null, total_risk_pct: null, total_position_pct: null, target_profit_pct: null, shelf: null, edge: "", invalid: "" };
    cur = name; rebuildSel(); $("rk-newname").value = "";
    loadBundle(); compute(); persistLocal(); rpSchedule(true); $("rk-msg").textContent = `已建「${name}」`;
  });
  // ---- ⋯ 菜单:重命名 / 完成(单确认)/ 删除(两步红色 arm)----
  const menu = $("rk-menu");
  const resetMenu = () => { const c = menu.querySelector('[data-act="complete"]'), d = menu.querySelector('[data-act="delete"]'); if (c) { c.textContent = "✅ 完成并归档"; c.classList.remove("rk-armed"); } if (d) { d.textContent = "🗑 删除"; d.classList.remove("rk-armed"); } };
  const closeMenu = () => { menu.hidden = true; resetMenu(); };
  const doDelete = () => {
    if (Object.keys(POLICY.bundles).length <= 1) return void ($("rk-msg").textContent = "至少保留 1 个 thesis");
    delete POLICY.bundles[cur]; cur = Object.keys(POLICY.bundles)[0];
    rebuildSel(); loadBundle(); compute(); persistLocal(); renderRiskExposure(); rpSchedule(true); $("rk-msg").textContent = "🗑 已删除";
  };
  const doComplete = async () => {
    if (Object.keys(POLICY.bundles).length <= 1) return void ($("rk-msg").textContent = "至少保留 1 个活跃 thesis");
    syncBundle();
    const name = cur;
    const archivedTickers = await archiveCurrentThesis(name, POLICY);
    delete POLICY.bundles[cur]; cur = Object.keys(POLICY.bundles)[0];
    if (getAssignments()) for (const sym of archivedTickers) delete getAssignments()[sym];
    const rg = rLS("riskGroups", {});
    for (const sym of archivedTickers) delete rg[sym];
    rLSset("riskGroups", rg);
    rebuildSel(); loadBundle(); compute(); persistLocal(); renderDone(); renderRiskExposure();
    rpSchedule();   // 活跃列表留待手动同步;归档与事件已写 completed_theses/thesis_events
    $("rk-msg").textContent = `✅ 已完成「${name}」并归档`;
  };
  $("rk-menu-btn").addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; if (menu.hidden) resetMenu(); });
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest(".rk-menu-item"); if (!btn) return;
    const act = btn.dataset.act;
    if (act === "rename") { closeMenu(); startRename(); return; }
    if (!btn.classList.contains("rk-armed")) {   // 第一次点 = 武装确认(4s 自动解除)
      resetMenu(); btn.classList.add("rk-armed");
      btn.textContent = act === "delete" ? `确认删除「${cur}」?` : `确认完成「${cur}」?`;
      setTimeout(() => { if (btn.classList.contains("rk-armed")) resetMenu(); }, 4000);
      return;
    }
    closeMenu(); act === "delete" ? doDelete() : doComplete();
  });
  document.addEventListener("click", (e) => { if (!menu.hidden && !e.target.closest(".rk-menu-wrap")) closeMenu(); }, { signal: controller.signal });
  // ---- 同步状态 / PAT ----
  $("rk-sync").addEventListener("click", () => { if (!getPat()) { const p = $("rk-pat"); p.hidden = false; p.focus(); } else rpSyncNow(); });
  $("rk-pat").addEventListener("change", () => { const v = $("rk-pat").value.trim(); setPat(v); $("rk-pat").hidden = true; if (v) rpStatus(rLS(RISK_POLICY_DIRTY_KEY, false) ? "↑ 有未同步改动 · 点击同步" : "✓ 无待同步改动"); else rpStatus("⚠ 未设 PAT · 点此设置", "down"); });

  window.addEventListener("storage", e => {
    if (["riskPolicy", "riskMaxHeat"].includes(e.key)) { mountLegacyRiskControl(host, services); renderRiskExposure(); }
  }, { signal: controller.signal });
  loadBundle(); compute(); renderDone();
  const dirty = rLS(RISK_POLICY_DIRTY_KEY, false);
  rpStatus(dirty ? (getPat() ? "↑ 有未同步改动 · 点击同步" : "⚠ 有未同步改动 · 需 PAT") : (getPat() ? "✓ 无待同步改动" : "⚠ 未设 PAT · 点此设置"), dirty && !getPat() ? "down" : "muted");
}

// Workflow adapter: account settings are shared; sizing fields are owned by one instance.
// Never creates/renames a legacy bundle or writes broker/remote data.
import { emptySizing, mergePolicy, readStored, saveAccountField, accountContext,
  candidateRisk, allocationIssues, accountFingerprint } from "./risk-budget.mjs";

export async function loadRiskEnvironment(storage = localStorage) {
  const [file, portfolio, atr] = await Promise.all([
    loadJSON('config/risk_policy.json'), loadJSON('data/portfolio.json'), loadJSON('data/atr.json')
  ]);
  const policy = mergePolicy(file || {}, readStored(storage, 'riskPolicy', {}));
  const context = accountContext({ policy, portfolio, atr: { ...(atr?.atr14 || {}), __updated_at: atr?.updated_at || '' },
    groups: readStored(storage, 'riskGroups', {}), stops: readStored(storage, 'riskStops', {}),
    maxHeat: readStored(storage, 'riskMaxHeat', file?.portfolio?.max_total_heat_pct ?? null) });
  return { policy, context };
}
const escapeAttr = v => esc(String(v ?? '')).replace(/"/g, '&quot;');
const cash = v => v == null || !Number.isFinite(v) ? '未知' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
export async function mountWorkflowRiskControl(host, { data, entry, legs, readonly = false, onChange, onAccountChange }) {
  host.innerHTML = '<p class="hint">正在读取共享风险参数与本地持仓快照…</p>';
  let env;
  try { env = readonly ? { policy: {}, context: data.accountSnapshot || null } : await loadRiskEnvironment(); }
  catch (e) { if (host.isConnected) host.innerHTML = `<p class="gate">无法读取共享风控：${esc(e.message)}</p>`; return null; }
  if (!host.isConnected) return null;
  let sizing = { ...emptySizing(), entry: entry ?? '', ...(data.sizing || {}) };
  const context = () => env.context;
  const numberField = (key, title, value, scope = 'sizing') => `<label>${title}<input type="number" step="any" data-${scope}="${key}" value="${escapeAttr(value)}"></label>`;
  host.innerHTML = `<h3>账户风险控制 · 仓位</h3>
    <p class="hint">账户净值与总在险上限和 Portfolio 共用；下面的风险%、止损与仓位参数仅属于当前 Workflow 实例。</p>
    <fieldset ${readonly ? 'disabled' : ''}>
    <div class="fields">${numberField('equity', '共享账户净值 ($) · 原计算器手填口径', context()?.equity, 'account')}${numberField('maxHeat', '账户总在险上限 (%) · 原热力图设置', context()?.maxHeat, 'account')}</div>
    <p class="hint">账户字段失焦后立即保存到本机，影响所有 thesis。远端同步仍使用 Portfolio 原有按钮。当前为原系统全局口径，未按券商账户拆分。</p>
    ${readonly ? '' : `<label>从 Portfolio thesis 复制参数（可选，仅复制一次）<select id="rc-template"><option value="">选择已有参数模板</option>${Object.keys(env.policy.bundles || {}).map(k => `<option value="${escapeAttr(k)}">${esc(k)}</option>`).join('')}</select></label>`}
    <div class="fields rc-parameters">
      ${[['risk_pct','单笔风险 %'],['total_risk_pct','本实例总风险 %'],['atr_mult','ATR 倍数'],['max_position_pct','单笔仓位上限 % · 可选覆盖'],['total_position_pct','总仓位上限 % · 可选覆盖']].map(([k,l])=>numberField(k,l,sizing[k])).join('')}
      <label>方向<select data-sizing="side"><option value="long">Long</option><option value="short">Short</option></select></label>
      ${numberField('entry','参考买入 / 卖空价 ($)',sizing.entry)}
      <label>止损法<select data-sizing="mode"><option value="manual">手动止损价</option><option value="atr">ATR 法</option></select></label>
      ${numberField('stop','止损价 ($) · 手动法',sizing.stop)}${numberField('atr','ATR ($) · ATR 法',sizing.atr)}
    </div>
    ${legs.some(l=>l.type!=='stock') ? numberField('optionRisk','候选期权组合管理情景损失 ($) · 手工估计',sizing.optionRisk) : ''}
    </fieldset>
    <p class="hint rc-template-note"></p><div class="rc-results"></div><p class="rc-status hint" role="status"></p>
    <p class="hint">此处是增量候选方案：账户现有持仓风险 + 整个候选方案风险。未做持仓归属/替换抵扣；已有仓位或 roll 不能视为自动扣除。</p>
    <p class="hint">股票按止损距离估计；现有期权沿用原热力图的市值代理，不代表最大损失。未计跳空、滑点和指派；总风险不是精确保证。</p>`;
  host.querySelector('[data-sizing="side"]').value = sizing.side;
  host.querySelector('[data-sizing="mode"]').value = sizing.mode;
  const read = () => { const next = { ...sizing }; host.querySelectorAll('[data-sizing]').forEach(el => {next[el.dataset.sizing] = el.type === 'number' && el.value !== '' ? +el.value : el.value;}); return next; };
  const paint = () => {
    const c = context(), s = read(), calc = calculateSizing({ ...s, equity: c?.equity }), candidate = candidateRisk({ ...s, equity: c?.equity }, legs);
    const issues = allocationIssues(s, c, legs), remaining = c?.budget != null && c.used != null ? c.budget - c.used : null;
    host.querySelector('.rc-template-note').textContent = s.template ? `参数来源：${s.template}（副本，后续编辑互不影响）` : '实例参数保存时随 Risk Budget 写入快照。';
    host.querySelector('.rc-results').innerHTML = `${c ? `<p class="hint">${esc(c.scope)} · 源时间：${esc(c.sourceAt || '未提供')}<br>构建时间：${esc(c.builtAt || '未提供')} · ${c.count} 个持仓 · ${c.unknown} 个风险缺失 · ${c.optionProxies} 个期权市值代理</p>` : '<p class="gate">此历史版本尚无账户评估快照。</p>'}
      <div class="metrics">${[['账户已用风险',cash(c?.used)],['账户剩余预算',cash(remaining)],['候选新增止损风险',cash(candidate.risk)]].map(([k,v])=>`<div class="metric"><small>${k}</small><strong>${v}</strong></div>`).join('')}</div>
      <p class="hint">账户总预算 ${cash(c?.budget)} · 加入后剩余 ${cash(remaining != null && candidate.risk != null ? remaining-candidate.risk : null)}</p>
      ${calc.error ? `<p class="gate">${esc(calc.error)}</p>` : `<div class="metrics">${[['风险预算',cash(calc.budget)],['参考股数（非期权张数）',calc.shares],['估计止损损失',cash(calc.actualRisk)]].map(([k,v])=>`<div class="metric"><small>${k}</small><strong>${v}</strong></div>`).join('')}</div><p class="hint">止损 ${cash(calc.stop)} · 每股风险 ${cash(calc.perShare)} · 仓位 ${cash(calc.posDollar)} (${calc.posPct.toFixed(2)}%)<br>总仓位上限 ${calc.totalPositionPct.toFixed(2)}% · ${calc.capped?'已应用手工仓位上限':'按止损风险反推股数'}</p>`}
      <div class="callout">${issues.length ? issues.map(esc).join('<br>') : '止损口径预算检查满足。仍需完成下方到期损失、Delta 与账户人工检查。'}</div>`;
  };
  host.addEventListener('input', e => { if (e.target.dataset.sizing) {sizing=read();paint();onChange?.(read());} });
  host.querySelector('#rc-template')?.addEventListener('change', e => {
    const b = env.policy.bundles[e.target.value]; if (!b) return;
    for (const key of ['risk_pct','total_risk_pct','atr_mult','max_position_pct','total_position_pct']) { sizing[key] = b[key] ?? ''; host.querySelector(`[data-sizing="${key}"]`).value=sizing[key]; }
    sizing.template=e.target.value;paint();onChange?.(read());
  });
  host.addEventListener('change', async e => {
    if (!e.target.dataset.account) return;
    const status = host.querySelector('.rc-status');
    try {
      saveAccountField(localStorage,e.target.dataset.account,e.target.value);
      status.textContent='已保存共享账户参数，正在更新风险评估…';
      env=await loadRiskEnvironment(); if(!host.isConnected)return;paint();
      onAccountChange?.(context());status.textContent='账户参数已共享到 Portfolio；此前评估需重新保存并检查。';
    } catch(err) {status.textContent='未完成更新：'+err.message;}
  });
  paint();
  return { read, context, fingerprint: () => accountFingerprint(context()), refresh: async () => {
    if (readonly) return;
    env = await loadRiskEnvironment();if(!host.isConnected)return;
    host.querySelectorAll('[data-account]').forEach(el=>{el.value=context()[el.dataset.account]??'';});paint();
  } };
}
