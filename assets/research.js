/* Research 页 — 多 topic 研究台。Topic 1:熊市预测(v1 熊侧)。
   模型在浏览器里跑(approach A):L2 正则 logistic(IRLS)+ leave-one-bear-out。
   数据 data/research_bearbull.json(topic/方向/实体三层可扩展)。 */
import { $, esc, loadJSON, loadFreshJSON, getPat, ghHeaders, REPO } from "./shared.js?v=20261028-manual-versions";
import { loadRetailData } from "./retail-data.mjs";
import { buildSnapshot } from "./macd-research.mjs";
import { decomposeFiveFactor } from "./five-factor.mjs?v=20261031-original-warning";
import { REGIME_DIMENSIONS, defaultRegimeValues, isRegimeFriday, latestRegimeSnapshotBefore, mergeRegimeStores, radarPoint, radarValueFromPoint, regimeFriday, saveRegimeSnapshot } from "./regime.mjs?v=20261018-anchor";
import { initScorecards } from "./trading.js?v=20261103-english-ui";   // 个股分析 tab 复用交易台的 Scorecards 渲染(trading.js 自启动已守卫)

const floatingTableHeaders = new Map();
function installFloatingTableHeader(wrap, tableSelector, key) {
  const table = wrap?.querySelector(tableSelector);
  if (!wrap || !table?.tHead) return;
  const old = floatingTableHeaders.get(key);
  if (old) { old.controller.abort(); old.observer?.disconnect(); old.shell.remove(); }

  const controller = new AbortController();
  const shell = document.createElement("div");
  shell.className = "floating-table-head";
  shell.setAttribute("aria-hidden", "true");
  const headTable = table.cloneNode(false);
  headTable.removeAttribute("id");
  headTable.append(table.tHead.cloneNode(true));
  shell.append(headTable);
  document.body.append(shell);
  shell.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ff-sort], [data-sc-sort]");
    if (!button) return;
    const attr = button.hasAttribute("data-ff-sort") ? "data-ff-sort" : "data-sc-sort";
    table.querySelector(`[${attr}="${button.getAttribute(attr)}"]`)?.click();
  }, { signal: controller.signal });

  const sync = () => {
    if (!document.body.contains(table) || table.offsetParent === null) { shell.hidden = true; return; }
    const navBottom = document.querySelector(".pagenav")?.getBoundingClientRect().bottom || 0;
    const wrapRect = wrap.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const sourceCells = [...table.tHead.rows[0].cells];
    const cloneCells = [...headTable.tHead.rows[0].cells];
    sourceCells.forEach((cell, index) => {
      const width = cell.getBoundingClientRect().width;
      if (cloneCells[index]) cloneCells[index].style.width = cloneCells[index].style.minWidth = `${width}px`;
    });
    headTable.style.width = `${tableRect.width}px`;
    headTable.style.marginLeft = `${-wrap.scrollLeft}px`;
    if (cloneCells[0]) cloneCells[0].style.transform = `translateX(${wrap.scrollLeft}px)`;
    shell.style.top = `${Math.max(0, navBottom)}px`;
    shell.style.left = `${wrapRect.left}px`;
    shell.style.width = `${wrapRect.width}px`;
    shell.hidden = !(tableRect.top < navBottom && tableRect.bottom > navBottom + table.tHead.getBoundingClientRect().height);
  };
  window.addEventListener("scroll", sync, { passive: true, signal: controller.signal });
  window.addEventListener("resize", sync, { passive: true, signal: controller.signal });
  wrap.addEventListener("scroll", sync, { passive: true, signal: controller.signal });
  const observer = window.ResizeObserver ? new ResizeObserver(sync) : null;
  observer?.observe(wrap);
  floatingTableHeaders.set(key, { controller, observer, shell, sync });
  requestAnimationFrame(sync);
}

const LAM = 10;            // L2 强度(与 factorlab/model.py 默认一致)
/* 按"驱动机制"分簇(比 内生/政策/外生 更贴数据、名实相符):
   imbalance=信用扩张过度/估值泡沫/曲线倒挂酝酿的顶 → 模型稳健可预警;
   shock=外生(COVID)或政策 regime 突变(1980 Volcker、2022 通胀加息)→ leading 信号看不到甚至反向。
   成因先验判定(不是拿 AUC 结果倒推),再由 LOBO 验证该簇可不可预测。 */
const DRIVER = {
  1966: "imbalance", 1968: "imbalance", 1972: "imbalance", 1980: "shock", 1987: "imbalance",
  1990: "imbalance", 1998: "imbalance", 2000: "imbalance", 2007: "imbalance", 2020: "shock", 2021: "shock",
};
const DRIVER_COLOR = { imbalance: "#f87171", shock: "#8b96ad" };
const DRIVER_LABEL = { imbalance: "Credit/Valuation", shock: "Shock" };
const DRIVER_NOTE = {
  1966: "Credit crunch", 1968: "High valuations + emerging stagflation", 1972: "Nifty Fifty valuation bubble + tightening",
  1980: "Volcker rate shock (monetary regime shift)", 1987: "Rate spike + structural crash under stretched valuations",
  1990: "S&L credit crisis + Gulf oil shock", 1998: "LTCM / Russian debt liquidity squeeze", 2000: "Dot-com valuation bubble burst",
  2007: "Subprime / housing credit crisis", 2020: "Exogenous COVID shock", 2021: "Inflation surge + Fed tightening regime shift",
};
const driverOf = (e) => DRIVER[+e.peak.slice(0, 4)] || "shock";

/* ---------- 线性代数 / 模型 ---------- */
function solve(A, b) {                       // 高斯消元 + 部分主元
  const n = b.length, M = A.map((r, i) => r.concat(b[i]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (M[i][i] || 1e-12));
}

function ridgeLogistic(X, y, lam, iters = 60) {   // IRLS;截距不罚
  const n = X.length, p = X[0].length, dim = p + 1;
  const Xb = X.map((r) => [1, ...r]);
  let w = new Array(dim).fill(0);
  for (let it = 0; it < iters; it++) {
    const A = Array.from({ length: dim }, () => new Array(dim).fill(0));
    const bb = new Array(dim).fill(0);
    for (let i = 0; i < n; i++) {
      const eta = Xb[i].reduce((s, v, j) => s + v * w[j], 0);
      const mu = Math.min(1 - 1e-6, Math.max(1e-6, 1 / (1 + Math.exp(-eta))));
      const wd = mu * (1 - mu), z = eta + (y[i] - mu) / wd, row = Xb[i];
      for (let a = 0; a < dim; a++) {
        const ra = row[a] * wd;
        bb[a] += ra * z;
        for (let c = a; c < dim; c++) A[a][c] += ra * row[c];
      }
    }
    for (let a = 0; a < dim; a++) for (let c = 0; c < a; c++) A[a][c] = A[c][a];
    for (let a = 1; a < dim; a++) A[a][a] += lam;
    const wn = solve(A, bb);
    let d = 0;
    for (let a = 0; a < dim; a++) d = Math.max(d, Math.abs(wn[a] - w[a]));
    w = wn;
    if (d < 1e-8) break;
  }
  return w;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

function auc(scores, labels) {                 // Mann-Whitney rank AUC
  const pairs = scores.map((s, i) => [s, labels[i]]).filter((p) => p[0] != null);
  const npos = pairs.filter((p) => p[1] === 1).length, nneg = pairs.length - npos;
  if (!npos || !nneg) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  let rank = 0, rsum = 0;
  for (let i = 0; i < pairs.length;) {          // 处理并列:平均秩
    let j = i; while (j < pairs.length && pairs[j][0] === pairs[i][0]) j++;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (pairs[k][1] === 1) rsum += avg;
    i = j;
  }
  return (rsum - npos * (npos + 1) / 2) / (npos * nneg);
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
function std(a) { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1; }

/* 从 json 组装:特征矩阵 X(行=月,列=特征,允许 null)、target/标注 */
function assembleFeats(J, featList, direction = "bear", entity = "market") {
  const ent = J.directions[direction].entities[entity];
  const feats = featList.filter((f) => J.data[f]);
  const X = J.dates.map((_, i) => feats.map((f) => J.data[f][i]));
  const t = ent.targets;
  return { feats, X, ent, y: t.y_bear12, nb: t.next_bear_id, ib: t.in_bear_id };
}
function assemble(J, direction = "bear", entity = "market") {
  const ent = J.directions[direction].entities[entity];
  return assembleFeats(J, [...J.macro_features, ...ent.tech_features], direction, entity);
}
// 3 变量领先基准(曲线+信用+估值):文献支持、极简、抗过拟合
const LEADING3 = ["term_10y3m", "gz_spread", "bm"];

function fitStd(X, idx, nf) {
  return Array.from({ length: nf }, (_, j) => {
    const vals = idx.map((i) => X[i][j]).filter((v) => v != null);
    return [mean(vals), std(vals)];
  });
}
const applyStd = (X, idx, prm) => idx.map((i) => prm.map(([m, s], j) => { const v = X[i][j]; return v == null ? 0 : (v - m) / s; }));
const predict = (rows, w) => rows.map((r) => sigmoid([1, ...r].reduce((s, v, j) => s + v * w[j], 0)));

/* 核心:LOBO(purged + embargoed)+ 终模型。与 factorlab/model.py 一致:
   ① 每个 calm 月按"离哪次熊市峰最近"唯一归属某折,只在那折当负样本,绝不同时进训练;
   ② embargo:留出第 k 段时,把它 [预警窗起-E, 谷底+E] 内所有月从训练删掉(隔断自相关泄漏)。
   面板为连续月频 → 用行号距离当月份距离(1 行=1 月)。 */
function runModel(A, lam = LAM, embargo = 12) {
  const { feats, X, y, nb, ib } = A;
  const N = X.length, nf = feats.length;
  const calm = (i) => nb[i] === 0 && ib[i] === 0;
  const bears = [...new Set(nb.filter((v) => v > 0))].sort((a, b) => a - b);
  const idxAll = [...Array(N).keys()];
  // 每次熊市:峰(=预警窗最后一月行号)、跨度(预警窗起→谷底)
  const peakIdx = {}, spanStart = {}, spanEnd = {};
  for (const k of bears) {
    const warnRows = idxAll.filter((i) => nb[i] === k);
    const inbRows = idxAll.filter((i) => ib[i] === k);
    peakIdx[k] = Math.max(...warnRows);
    spanStart[k] = Math.min(...warnRows);
    spanEnd[k] = inbRows.length ? Math.max(...inbRows) : peakIdx[k];
  }
  // calm 月唯一归属最近的熊市峰
  const owner = {};
  for (const i of idxAll) if (calm(i)) {
    let best = bears[0], bd = Infinity;
    for (const k of bears) { const d = Math.abs(i - peakIdx[k]); if (d < bd) { bd = d; best = k; } }
    owner[i] = best;
  }
  const aucByBear = {};
  for (const k of bears) {
    const lo = spanStart[k] - embargo, hi = spanEnd[k] + embargo;
    const embargoed = (i) => i >= lo && i <= hi;
    const testCalm = (i) => calm(i) && owner[i] === k;
    const others = bears.filter((b) => b !== k);
    const tr = idxAll.filter((i) => !embargoed(i) && (others.includes(nb[i]) || (calm(i) && !testCalm(i))) && y[i] != null);
    const sc = idxAll.filter((i) => nb[i] === k || testCalm(i));
    const prm = fitStd(X, tr, nf);
    const w = ridgeLogistic(applyStd(X, tr, prm), tr.map((i) => y[i]), lam);
    const prob = predict(applyStd(X, sc, prm), w);
    const lab = sc.map((i) => (nb[i] === k ? 1 : 0));
    const a = auc(prob, lab);
    if (a != null) aucByBear[k] = a;
  }
  const full = idxAll.filter((i) => (nb[i] > 0 || calm(i)) && y[i] != null);
  const prm = fitStd(X, full, nf);
  const w = ridgeLogistic(applyStd(X, full, prm), full.map((i) => y[i]), lam);
  const probAll = predict(applyStd(X, idxAll, prm), w);
  const coef = feats.map((f, j) => [f, w[j + 1]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return { aucByBear, probAll, coef, bears };
}

/* ---------- 渲染 ---------- */

/* 预警概率 vs 历史熊市 —— 交互式(lightweight-charts,与「国债 vs 股市」同款):
   左轴=预警概率%,右轴=大盘指数(对数,起点100),半透明直方图=历史熊市阴影(按驱动着色)。
   可点图例开关曲线、鼠标悬停读数、缩放/平移。series:[{name,prob,color,w,dash}]。 */
function probBearsChart(host, J, dir, series, benchmarks) {
  if (!host) return;
  const LWC = window.LightweightCharts;
  if (!LWC) { host.innerHTML = '<span class="muted small">Chart library failed to load</span>'; return; }
  const dates = J.dates, eps = (J.directions[dir].entities.market.episodes) || [];
  const cssVar = (c) => c && c.startsWith("var(")
    ? (getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1).trim()).trim() || "#60a5fa") : c;
  const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

  host.innerHTML = "";
  const leg = document.createElement("div"); leg.className = "rt-legend";
  const wrap = document.createElement("div"); wrap.className = "chart-wrap";
  const chartEl = document.createElement("div"); chartEl.style.height = "340px";
  const hov = document.createElement("div"); hov.className = "chart-hover"; hov.style.display = "none";
  wrap.append(chartEl, hov);
  const cap = document.createElement("div"); cap.className = "muted small"; cap.style.marginTop = "8px";
  cap.innerHTML = "Left axis = in-sample bear-market warning probability; right axis = broad-market index (log scale, rebased to 100); shading = historical bear markets. "
    + "The 3-variable benchmark uses the yield curve (10Y−3M), credit (GZ spread), and valuation (B/M); the 23-feature model uses all signals. Click the legend to toggle a line; hover for monthly values; zoom or pan as needed.";
  host.append(leg, wrap, cap);

  const LOG = (LWC.PriceScaleMode && LWC.PriceScaleMode.Logarithmic) ?? 1;
  const chart = LWC.createChart(chartEl, {
    autoSize: true, height: 340,
    layout: { background: { color: "transparent" }, textColor: "#8b96ad" },
    grid: { vertLines: { color: "#1e2941" }, horzLines: { color: "#1e2941" } },
    leftPriceScale: { visible: true, borderColor: "#2a3550" },
    rightPriceScale: { visible: true, borderColor: "#2a3550", mode: LOG },
    timeScale: { borderColor: "#2a3550" },
    crosshair: { mode: LWC.CrosshairMode.Normal },
  });

  // 熊市阴影:直方图(每月 value=1、按驱动着色),先建 → 置于线下层。峰早于数据起点则从头裁剪。
  const monthIdx = {}; dates.forEach((d, i) => (monthIdx[d.slice(0, 7)] = i));
  const bearInfo = new Array(dates.length).fill(null);
  for (const e of eps) {
    let lo = monthIdx[e.peak.slice(0, 7)], hi = monthIdx[e.trough.slice(0, 7)];
    if (lo == null && hi == null) continue;
    if (lo == null) lo = 0;
    if (hi == null) hi = dates.length - 1;
    const drv = driverOf(e);
    for (let i = Math.min(lo, hi); i <= Math.max(lo, hi); i++)
      bearInfo[i] = { driver: drv, id: e.id, dd: e.dd };
  }
  const bearSeries = chart.addHistogramSeries({ priceScaleId: "bear", base: 0, priceLineVisible: false, lastValueVisible: false });
  bearSeries.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
  bearSeries.setData(dates.map((d, i) => bearInfo[i]
    ? { time: d, value: 1, color: hexA(DRIVER_COLOR[bearInfo[i].driver], 0.16) } : { time: d }));

  const S = [];   // {label,color,series,visible,latest,fmt}
  for (const s of series) {                                  // 概率线(左轴,%)
    const col = cssVar(s.color);
    const ser = chart.addLineSeries({ color: col, lineWidth: s.w || 1.8,
      lineStyle: s.dash ? LWC.LineStyle.Dashed : LWC.LineStyle.Solid,
      priceScaleId: "left", priceLineVisible: false, lastValueVisible: false });
    ser.setData(dates.map((d, i) => s.prob[i] == null ? { time: d } : { time: d, value: s.prob[i] * 100 }));
    const last = [...s.prob].reverse().find((v) => v != null);
    S.push({ label: s.name, color: col, series: ser, visible: true,
      latest: last == null ? "—" : (last * 100).toFixed(0) + "%", fmt: (v) => v.toFixed(0) + "%" });
  }
  for (const m of [{ key: "sp500", label: "S&P 500", color: "#94a3b8" }, { key: "nasdaq", label: "Nasdaq", color: "#2dd4bf" }]) {
    const arr = benchmarks[m.key]; if (!arr || !arr.length) continue;   // 基准指数(右轴,对数,归一 100)
    const base = arr.find((v) => v != null && v > 0) || 1;
    const ser = chart.addLineSeries({ color: m.color, lineWidth: 1, priceScaleId: "right", priceLineVisible: false, lastValueVisible: false });
    ser.setData(arr.map((v, i) => (v == null || v <= 0) ? { time: dates[i] } : { time: dates[i], value: v / base * 100 }));
    const last = [...arr].reverse().find((v) => v != null && v > 0), chg = (last / base - 1) * 100;
    S.push({ label: m.label, color: m.color, series: ser, visible: true,
      latest: (chg >= 0 ? "+" : "") + chg.toFixed(0) + "%", fmt: (v) => (v >= 100 ? "+" : "") + (v - 100).toFixed(0) + "%" });
  }
  chart.timeScale().fitContent();

  S.forEach((s) => {                                         // 可点图例:开关曲线
    const chip = document.createElement("span"); chip.className = "rt-leg";
    chip.innerHTML = `<span class="rt-sw" style="background:${s.color}"></span>${esc(s.label)} <b>${s.latest}</b>`;
    chip.onclick = () => { s.visible = !s.visible; s.series.applyOptions({ visible: s.visible }); chip.classList.toggle("off", !s.visible); };
    leg.appendChild(chip);
  });
  const shadeChip = document.createElement("span"); shadeChip.className = "rt-leg"; shadeChip.style.cursor = "default";
  shadeChip.innerHTML = `Shading = historical bear markets (<span style="color:${DRIVER_COLOR.imbalance}">Credit/Valuation</span> / <span style="color:${DRIVER_COLOR.shock}">Shock</span>)`;
  leg.appendChild(shadeChip);

  chart.subscribeCrosshairMove((param) => {                 // 悬停:当月各可见曲线值 + 是否处于历史熊市
    if (!param.point || !param.time) { hov.style.display = "none"; return; }
    const rows = [];
    for (const s of S) {
      if (!s.visible) continue;
      const d = param.seriesData.get(s.series);
      if (!d || d.value == null) continue;
      rows.push(`<span style="color:${s.color}">● ${esc(s.label)} ${s.fmt(d.value)}</span>`);
    }
    const bi = bearInfo[monthIdx[String(param.time).slice(0, 7)] ?? -1];
    if (bi) rows.push(`<span style="color:${DRIVER_COLOR[bi.driver]}">▮ Bear market #${bi.id} ${DRIVER_LABEL[bi.driver]} (${(bi.dd * 100).toFixed(0)}%)</span>`);
    if (!rows.length) { hov.style.display = "none"; return; }
    hov.innerHTML = `<div class="muted" style="margin-bottom:2px">${param.time}</div>` + rows.join("<br>");
    hov.style.display = "block";
  });
}

function scorecard(J, dir, res) {
  const eps = J.directions[dir].entities.market.episodes;
  const rows = eps.map((e) => {
    const a = res.aucByBear[e.id];
    const av = a == null ? "—" : a.toFixed(3);
    const cls = a == null ? "" : (a > 0.5 ? "up" : "down");
    const dv = driverOf(e), yr = +e.peak.slice(0, 4);
    return `<tr><td>#${e.id}</td><td>${e.peak.slice(0, 7)}→${e.trough.slice(0, 7)}</td>
      <td>${(e.dd * 100).toFixed(0)}%</td>
      <td><span style="color:${DRIVER_COLOR[dv]}" title="${esc(DRIVER_NOTE[yr] || "")}">${DRIVER_LABEL[dv]}</span></td>
      <td class="${cls}">${av}</td></tr>`;
  }).join("");
  const sub = (pred) => {
    const vals = eps.filter((e) => res.aucByBear[e.id] != null && pred(driverOf(e))).map((e) => res.aucByBear[e.id]);
    if (!vals.length) return "—";
    const hit = vals.filter((v) => v > 0.5).length;
    return `mean ${mean(vals).toFixed(3)} · min ${Math.min(...vals).toFixed(3)} · hit ${hit}/${vals.length}`;
  };
  return `<table class="bt-table"><tr><th>#</th><th>Bear Market (Peak→Trough)</th><th>Drawdown</th><th>Driver</th><th>LOBO AUC</th></tr>${rows}</table>
    <div class="opt-grid" style="margin-top:10px">
      ${tile("All Evaluable", sub(() => true), "A single average across nine episodes can mislead")}
      ${tile("Credit/Valuation Driven", sub((d) => d === "imbalance"), "Endogenous financial imbalances — more forecastable")}
      ${tile("Shock (Exogenous/Policy)", sub((d) => d === "shock"), "Regime shifts — inherently difficult to forecast")}
    </div>
    <div class="muted small">Episodes are grouped by <b>driver</b>. <span style="color:${DRIVER_COLOR.imbalance}">Credit/valuation</span> episodes reflect excess credit, valuation bubbles, or curve inversion and are generally more forecastable. <span style="color:${DRIVER_COLOR.shock}">Shock</span> episodes are exogenous or policy regime shifts that leading indicators may miss. LOBO uses an embargo and clean baseline: hold out one bear market, train on the rest, and test whether the model identifies it; AUC &gt; 0.5 is informative. Hover over the driver for the episode rationale.</div>`;
}

function tile(k, v, sub = "") {
  return `<div class="opt-tile"><div class="opt-k">${esc(k)}</div><div class="opt-v" style="font-size:13px">${esc(v)}</div>${sub ? `<div class="opt-sub">${esc(sub)}</div>` : ""}</div>`;
}

// 系数(特征)中文释义:16 宏观 + 7 市场技术,附在系数名后帮助解读
const COEF_CN = {
  term_10y3m: "10Y−3M term spread (inversion = recession warning)",
  term_10y3m_long: "10Y−3M term spread (long-window smoothed)",
  term_10y2y: "10Y−2Y term spread",
  credit_baa_aaa: "Baa−Aaa credit spread (corporate risk premium)",
  nfci: "NFCI financial conditions (>0 = tighter)",
  vix: "VIX volatility (risk aversion)",
  unrate: "Unemployment rate",
  sahm: "Sahm recession indicator",
  cfnai: "CFNAI activity index (<0 = below trend)",
  claims: "Initial jobless claims",
  cpi_yoy: "CPI inflation, year over year",
  bm: "Book-to-market (high = cheaper)",
  ntis: "Net equity issuance (high = excess supply)",
  gz_spread: "GZ corporate excess bond premium",
  ebp: "Excess bond premium (higher = risk-off)",
  est_prob: "Baseline prior probability",
  mkt_dd: "Market drawdown from peak",
  mkt_ret_1m: "Trailing 1-month return",
  mkt_mom_12m: "12-month momentum",
  mkt_dist_10ma: "Distance from 10-month moving average",
  mkt_rvol_3m: "Trailing 3-month realized volatility",
  def_minus_cyc_12m: "Defensive minus cyclical 12-month relative strength",
  breadth_pct_above_10ma: "Market breadth: share above 10-month average",
};

function coefBars(res) {
  const top = res.coef.slice(0, 14);
  const mx = Math.max(...top.map((c) => Math.abs(c[1]))) || 1;
  const rows = top.map(([f, c]) => {
    const w = Math.abs(c) / mx * 46, col = c >= 0 ? "var(--down)" : "var(--up)";
    const bar = c >= 0
      ? `<span style="display:inline-block;width:50%;text-align:right"></span><span style="display:inline-block;width:${w}%;height:10px;background:${col}"></span>`
      : `<span style="display:inline-block;width:${50 - w}%"></span><span style="display:inline-block;width:${w}%;height:10px;background:${col};float:right"></span>`;
    return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
      <span style="width:210px;text-align:right;font-size:12px;line-height:1.25" class="muted"><span style="font-weight:600">${esc(f)}</span>${COEF_CN[f] ? `<br><span style="font-size:10px;opacity:.8">${esc(COEF_CN[f])}</span>` : ""}</span>
      <span style="flex:1">${bar}</span>
      <span style="width:52px;font-size:11px" class="${c >= 0 ? "down" : "up"}">${c >= 0 ? "+" : ""}${c.toFixed(2)}</span></div>`;
  }).join("");
  return `${rows}<div class="muted small" style="margin-top:6px">Standardized coefficients: <span class="down">red raises</span> the warning probability; <span class="up">green lowers</span> it. ⚠️ Correlated features can flip individual signs, so do not interpret a coefficient in isolation.</div>`;
}

/* ---------- Topic 1:熊市预测 ---------- */
async function renderBearbull() {
  const J = await loadJSON("data/research_bearbull.json");
  if (!J) { $("bb-status").textContent = "Missing data/research_bearbull.json (run export_web.py in factor-research)"; return; }
  $("bb-status").textContent = `Topic: Bear Market Forecast · bear side · ${J.dates[0]}→${J.dates[J.dates.length - 1]} · ${J.dates.length} months · calculated live in the browser (L2-logistic, λ=${LAM})`;
  const A = assemble(J, "bear", "market");
  const res = runModel(A, LAM);
  const res3 = runModel(assembleFeats(J, LEADING3, "bear", "market"), LAM);   // 3 变量领先基准
  const series = [
    { name: "Warning Probability · 23 Features", prob: res.probAll, color: "#f472b6", w: 1.8 },
    { name: "Warning Probability · 3 Variables", prob: res3.probAll, color: "#c084fc", w: 1.5, dash: "5 3" },
  ];
  probBearsChart($("bb-chart"), J, "bear", series, J.benchmarks || {});
  $("bb-score").innerHTML = scorecard(J, "bear", res);
  $("bb-coef").innerHTML = coefBars(res);
}

/* ---------- Topic 2:散户订单流 ---------- */
const fmtIC = (v) => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(3);
const latest = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
const sgncls = (v) => v == null ? "" : (v > 0 ? "up" : "down");

// Frozen point-in-time research: daily cross-sectional IC and quantile cohorts.
function renderRetailResearch(R, set) {
  if (!R) {
    set("rf-scatter", "PIT research data has not been generated. Run the latest retailflow workflow.");
    set("rf-ic", "—");
    return;
  }
  const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(2)}%`;
  const priceErrors = Object.keys(R.price_errors || {});
  const rows = [];
  for (const [field, label] of [["signal", "PIT Composite"], ["netbuy", "Net-Buying Baseline"]]) {
    for (const h of [1, 5]) {
      const v = R.results[field][String(h)].summary;
      rows.push(`<tr><td>${label}</td><td>${h}D</td><td>${v.n_days}</td><td>${fmtIC(v.mean_ic)}</td><td>${fmtIC(v.ic_std)}</td><td>${fmtIC(v.icir)}</td><td>${pct(v.positive_ic_rate)}</td><td>${v.status === "insufficient" ? "Insufficient sample" : "Descriptive"}</td></tr>`);
    }
  }
  set("rf-ic", `<div class="muted small">${R.snapshot_count} entry-date snapshots are frozen. Cross-sectional Spearman IC is computed each trading day and then equally averaged across dates; each day requires at least ${R.min_names} stocks. ICIR = mean(IC) / sample std(IC), not annualized. 5D windows overlap.</div>
    <div style="overflow-x:auto"><table class="bt-table"><tr><th>Signal</th><th>Horizon</th><th>Valid IC Days</th><th>Mean IC</th><th>IC std</th><th>ICIR</th><th>Positive IC Rate</th><th>Status</th></tr>${rows.join("")}</table></div>`);
  let html = priceErrors.length ? `<p class="down">Forward-price collection failed for ${priceErrors.map(esc).join(", ")}. Related returns are missing; see coverage.</p>` : "";
  html += `<div class="muted small">Actual freeze time t → first XNYS open after t → close of trading day 1/5. Historical observations do not receive fabricated PIT signals. The primary signal is z(sentiment) × z(activity), standardized on up to 20 prior trading days with at least five valid observations. Search interest is display-only.</div>`;
  for (const [field, label] of [["signal", "PIT Composite"], ["netbuy", "Net-Buying Baseline"]]) {
    for (const h of [1, 5]) {
      const r = R.results[field][String(h)], v = r.summary;
      html += `<h3>${label} · ${h}D Quintile Long/Short</h3><div class="muted small">Q5−Q1, equal weight, 100% long + 100% short. ${v.ls_days} valid batches · average gross return ${pct(v.mean_ls_gross)} · net ${pct(v.mean_ls_net)} (${R.cost_bps_per_side}bp per side per leg; ${4 * R.cost_bps_per_side}bp round trip). ${h === 5 ? "5D batches overlap; these are not daily strategy returns and are not compounded." : "Enter at the open and exit at the close."}</div>`;
      if (!r.daily.length) {
        html += `<p class="muted small">No matured strict-PIT samples yet; waiting for post-freeze trading windows to complete.</p>`;
      } else {
        html += `<details><summary>Daily IC, coverage, and quantile returns (latest 60 batches)</summary><div style="overflow-x:auto"><table class="bt-table"><tr><th>Actual Freeze UTC</th><th>Entry</th><th>Exit</th><th>Return Coverage</th><th>IC</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Q5</th><th>L/S Gross</th><th>L/S Net</th></tr>${r.daily.slice(-60).reverse().map(d => `<tr><td>${esc(d.formed_at)}</td><td>${d.entry_date}</td><td>${d.exit_date}</td><td>${d.n_returns}/${d.n_universe}</td><td>${fmtIC(d.ic)}</td>${[0,1,2,3,4].map(i => `<td>${pct(d.quantile_returns?.[i])}</td>`).join("")}<td>${pct(d.long_short_gross)}</td><td>${pct(d.long_short_net)}</td></tr>`).join("")}</table></div></details>`;
      }
    }
  }
  const caveats = [
    "No PIT history is fabricated for older observations; strict results accumulate only after the first actual signal freeze.",
    "The primary signal is z(netbuy) × z(intensity), standardized only on the prior 20 trading days with at least five valid observations; Google Trends is excluded.",
    "The universe is the set of tickers with an actual signal at each freeze and is not selected using future returns. Missing returns reduce coverage; a long/short batch is excluded if any constituent return is missing.",
    "1D runs from the next tradable open to that day's close; 5D runs from the same open to the fifth trading day's close.",
    `Quintiles are equal-weighted Q5−Q1, 100% long + 100% short. Costs are ${R.cost_bps_per_side}bp per side per leg; borrow fees and availability constraints are excluded.`,
    "Daily 5D entry windows overlap. Batch means are shown without compounding; ICIR is not annualized and is not a significance test.",
    "Returns use split-adjusted prices and exclude cash dividends. The fixed tracking universe creates selection bias, so results do not generalize to the full market.",
    "Fewer than 60 valid IC dates is marked insufficient; even larger samples are descriptive evidence only.",
  ];
  html += `<details><summary>Methodology and Limitations</summary><ul>${caveats.map(c => `<li>${esc(c)}</li>`).join("")}</ul></details>`;
  set("rf-scatter", html);
}

// 散户净买入热力图(票 × 日)
function netbuyHeatmap(J) {
  const d = J.dates, tks = J.tickers, D = J.data;
  const cell = (v) => {
    if (v == null) return `<td style="padding:0;width:13px"></td>`;
    const a = Math.min(1, Math.abs(v) / 0.3), c = v > 0 ? `rgba(52,211,153,${a})` : `rgba(248,113,113,${a})`;
    return `<td style="padding:0;width:13px;background:${c}" title="${(v > 0 ? "+" : "") + v.toFixed(3)}"></td>`;
  };
  const head = `<tr><th></th>${d.map((x) => `<th style="font-size:8px;font-weight:400;color:var(--muted)">${x.slice(5).replace("-", "/")}</th>`).join("")}</tr>`;
  const rows = tks.map((tk) => `<tr><td style="font-size:11px">${esc(tk)}</td>${d.map((_, i) => cell(D[tk].netbuy[i])).join("")}</tr>`).join("");
  return `<div style="overflow-x:auto"><table class="bt-table" style="border-spacing:1px">${head}${rows}</table></div>
    <div class="muted small" style="margin-top:6px">Each cell is a ticker's daily retail net buying (<span class="up">green = net buy</span>/<span class="down">red = net sell</span>); intensity scales with absolute value and saturates at 0.3.</div>`;
}

/* 散户流跑批标的多选器:写回 config/retail_syms.json(独立于交易台 ticker 状态)。下次跑批生效。 */
async function saveRetailSyms(symbols) {
  const pat = getPat();
  if (!pat) return { ok: false, msg: "A fine-grained PAT is required (Contents read/write; enter it in Trading's collection panel and store it locally)" };
  const url = `https://api.github.com/repos/${REPO}/contents/config/retail_syms.json`;
  let sha;
  try {
    // 现取最新 sha:cache:no-store + 时间戳,防浏览器缓存旧 sha 导致第二次保存 409(不匹配)
    const cur = await fetch(`${url}?ref=main&t=${Date.now()}`, { headers: ghHeaders(pat), cache: "no-store" });
    if (cur.ok) sha = (await cur.json()).sha;
    else if (cur.status !== 404) {
      const j = await cur.json().catch(() => ({}));
      return { ok: false, msg: `Read SHA ${cur.status}: ${j.message || "(PAT requires Contents read/write)"}` };
    }
  } catch (e) { return { ok: false, msg: "Read SHA error: " + e }; }
  const body = { _note: "Tickers processed by the retail-order-flow engine (independent of Trading ticker state; edited from the Research multi-select). Tick-level processing costs ~2–15 min per ticker.", symbols };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(body, null, 2) + "\n")));
  try {
    const r = await fetch(url, { method: "PUT", headers: ghHeaders(pat),
      body: JSON.stringify({ message: "chore: update retail_syms via research UI", content, sha, branch: "main" }) });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));       // 把 GitHub 的真实报错带出来(权限/sha/校验)
    return { ok: false, msg: `PUT ${r.status}: ${j.message || ""}` };
  } catch (e) { return { ok: false, msg: String(e) }; }
}

async function renderPicker() {
  const el = $("rf-picker"); if (!el) return;
  // retail_syms 走 GitHub API 取 main 最新(带 PAT / cache-bust),否则保存后 Pages 未重部署会显示旧值 = 看着「没保存上」
  const [cfg, rs] = await Promise.all([loadJSON("config/tickers.json"), loadFreshJSON("config/retail_syms.json")]);
  const wl = (cfg && cfg.watchlist) || [];
  const sel = new Set(((rs && rs.symbols) || []).map((s) => s.toUpperCase()));
  const label = (arr) => `Batch universe: ${arr.length ? arr.join(", ") : "None"} (${arr.length}) — open to select`;
  const chips = wl.map((t) => `<label class="rf-chip" style="display:inline-flex;align-items:center;gap:4px;font-size:12px">
      <input type="checkbox" value="${esc(t)}"${sel.has(t.toUpperCase()) ? " checked" : ""}> ${esc(t)}</label>`).join("");
  el.innerHTML = `<details>
    <summary id="rf-pick-sum" style="cursor:pointer;font-weight:600">${esc(label([...sel]))}</summary>
    <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px 14px">${chips}</div>
    <div style="margin-top:10px;display:flex;align-items:center;gap:10px">
      <button id="rf-save" class="tab">Save to config/retail_syms.json</button>
      <span id="rf-save-msg" class="muted small"></span>
    </div>
    <div class="muted small" style="margin-top:6px">Changes are written to the repository config and take effect on the <b>next daily cron or manual batch</b>; collected history is unchanged. Tick-level processing takes ~2–15 min per ticker, so keep the list focused. A fine-grained PAT with Contents read/write is required.</div>
  </details>`;
  const checked = () => [...el.querySelectorAll("input:checked")].map((i) => i.value.toUpperCase());
  el.querySelectorAll("input[type=checkbox]").forEach((cb) => cb.addEventListener("change",
    () => { $("rf-pick-sum").textContent = label(checked()); }));
  $("rf-save").addEventListener("click", async () => {
    const msg = $("rf-save-msg"); msg.textContent = "Saving…";
    const r = await saveRetailSyms(checked());
    msg.textContent = r.ok ? "✓ Saved; effective on the next batch" : "✗ " + r.msg;
    if (r.ok) setTimeout(renderPicker, 800);          // 重读 main 最新,确认真的写进去了
  });
}

async function renderRetailflow() {
  renderPicker();
  const { data: J, source } = await loadRetailData(loadJSON);
  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  if (!J) {
    $("rf-status").textContent = "Topic: Retail Order Flow · missing data/retailflow.json (run the retailflow workflow in Actions)";
    ["rf-now", "rf-scatter", "rf-ic", "rf-series"].forEach((id) => set(id, `<span class="muted small">No data. Run fetch_tick_flow + build_retailflow in Actions to generate data/retailflow.json.</span>`));
    return;
  }
  const d = J.dates, tks = J.tickers, D = J.data;
  $("rf-status").textContent = `Topic: Retail Order Flow · ${d[0]}→${d[d.length - 1]} · ${tks.length} tickers × ${d.length} days (${J.window_days || 30}d rolling) · updated ${(J.updated || "").slice(0, 16)}${source ? ` · ${source}` : ""}`;

  // ① 当前信号表(可在日历日间任选;默认最新)。只列有数据的日子。
  const validIdx = d.map((_, i) => i).filter((i) => tks.some((tk) => D[tk].netbuy[i] != null));
  let nowIdx = validIdx.length ? validIdx[validIdx.length - 1] : d.length - 1;
  let nowSortKey = null, nowSortDir = -1;
  const histStat = (series, idx) => {
    const vals = (series || []).slice(Math.max(0, idx - 20), idx).filter((v) => v != null);
    if (vals.length < 5) return { mean: null, z: null };
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1);
    const value = series?.[idx], sd = Math.sqrt(variance);
    return { mean, z: value != null && sd > 0 ? (value - mean) / sd : null };
  };
  const rowsAt = (idx) => {
    const rows = tks.map((tk) => {
      const o = D[tk];
      const nbHist = histStat(o.netbuy, idx), itHist = histStat(o.intensity, idx);
      return {
        tk,
        nb: o.netbuy[idx],
        nbMean: nbHist.mean,
        nbZ: nbHist.z,
        it: o.intensity[idx],
        itMean: itHist.mean,
        itZ: itHist.z,
        at: o.attention ? o.attention[idx] : null,
        sg: o.signal[idx],
      };
    });
    if (nowSortKey) rows.sort((a, b) => {
      const av = a[nowSortKey], bv = b[nowSortKey];
      if (av == null && bv == null) return a.tk.localeCompare(b.tk);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * nowSortDir || a.tk.localeCompare(b.tk);
    });
    return rows.map(({ tk, nb, nbMean, nbZ, it, itMean, itZ, at, sg }) => {
      return `<tr><td>${esc(tk)}</td>
        <td class="${sgncls(nb)}">${nb == null ? "—" : (nb > 0 ? "+" : "") + (nb * 100).toFixed(1) + "%"}</td>
        <td class="${sgncls(nbMean)}">${nbMean == null ? "—" : (nbMean > 0 ? "+" : "") + (nbMean * 100).toFixed(1) + "%"}</td>
        <td class="${sgncls(nbZ)}">${nbZ == null ? "—" : (nbZ > 0 ? "+" : "") + nbZ.toFixed(2)}</td>
        <td>${it == null ? "—" : (it * 100).toFixed(1) + "%"}</td>
        <td>${itMean == null ? "—" : (itMean * 100).toFixed(1) + "%"}</td>
        <td class="${sgncls(itZ)}">${itZ == null ? "—" : (itZ > 0 ? "+" : "") + itZ.toFixed(2)}</td>
        <td>${at == null ? "—" : at.toFixed(0)}</td>
        <td class="${sgncls(sg)}">${sg == null ? "—" : (sg > 0 ? "+" : "") + sg.toFixed(2)}</td></tr>`;
    }).join("");
  };
  const sortButton = (key, label) => {
    const mark = nowSortKey === key ? (nowSortDir < 0 ? "↓" : "↑") : "↕";
    return `<button class="rf-sort-btn" data-rf-sort="${key}" title="Click to toggle sort direction">${label}<span>${mark}</span></button>`;
  };
  const sortHead = (key, label) => `<th>${sortButton(key, label)}</th>`;
  // 日历选择:范围从 2026-01 起(便于日后 backfill),只有有数据的日子可点,其余(周末/未回填)灰不可选。
  const idxByDate = {};
  validIdx.forEach((i) => { idxByDate[d[i]] = i; });
  const pad2 = (n) => String(n).padStart(2, "0");
  const latestI = validIdx.length ? validIdx[validIdx.length - 1] : d.length - 1;
  const [maxY, maxM] = (d[latestI] || "2026-01-01").split("-").map(Number);
  let calY = maxY, calM = maxM;                     // 当前显示的月
  const canPrev = () => calY > 2026 || calM > 1;
  const canNext = () => calY < maxY || (calY === maxY && calM < maxM);

  const drawNow = () => {
    const lead = new Date(calY, calM - 1, 1).getDay();      // 首日星期(0=周日)
    const dim = new Date(calY, calM, 0).getDate();          // 当月天数
    const wk = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      .map((w) => `<div style="text-align:center;color:#8b96ad;font-size:11px;padding:2px">${w}</div>`).join("");
    let cells = "";
    for (let k = 0; k < lead; k++) cells += "<div></div>";
    for (let day = 1; day <= dim; day++) {
      const ds = `${calY}-${pad2(calM)}-${pad2(day)}`, has = ds in idxByDate, seld = idxByDate[ds] === nowIdx;
      const base = "text-align:center;padding:5px 0;border-radius:5px;font-size:12px";
      cells += has
        ? `<div class="rf-cal-d" data-idx="${idxByDate[ds]}" style="${base};cursor:pointer;${seld ? "background:#2563eb;color:#fff;font-weight:600" : "background:var(--card-hover);color:var(--text)"}">${day}</div>`
        : `<div style="${base};color:#3a4560">${day}</div>`;
    }
    const selSt = "background:var(--card-hover);border:1px solid var(--border);border-radius:5px;padding:2px 6px;color:var(--text);font-size:12px";
    let yOpts = "", mOpts = "";
    for (let y = 2026; y <= maxY; y++) yOpts += `<option value="${y}"${y === calY ? " selected" : ""}>${y}</option>`;
    for (let m = 1; m <= 12; m++) mOpts += `<option value="${m}"${m === calM ? " selected" : ""}>${new Date(2000, m - 1, 1).toLocaleString("en", { month: "short" })}</option>`;
    set("rf-now", `<div style="max-width:280px;margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <button id="rf-cal-prev" class="tab" style="padding:1px 9px"${canPrev() ? "" : " disabled"}>‹</button>
          <span style="display:flex;gap:4px"><select id="rf-cal-y" style="${selSt}">${yOpts}</select><select id="rf-cal-m" style="${selSt}">${mOpts}</select></span>
          <button id="rf-cal-next" class="tab" style="padding:1px 9px"${canNext() ? "" : " disabled"}>›</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">${wk}${cells}</div>
      </div>
      <div class="muted small" style="margin-bottom:6px">Selected: <b>${d[nowIdx] || "—"}</b>${nowIdx === latestI ? " (latest)" : ""} · gray = no data (weekend/not backfilled)</div>
      <div class="rf-now-table-wrap"><table class="bt-table rf-now-table"><thead>
        <tr><th rowspan="2">Ticker</th><th colspan="3">sentiment</th><th colspan="3">activity</th>
          <th rowspan="2">${sortButton("at", "Google Trends")}</th><th rowspan="2">${sortButton("sg", "Frozen PIT Composite")}</th></tr>
        <tr>${sortHead("nb", "Current")}${sortHead("nbMean", "Prior-20D Mean")}${sortHead("nbZ", "z-score")}
          ${sortHead("it", "Current")}${sortHead("itMean", "Prior-20D Mean")}${sortHead("itZ", "z-score")}</tr>
      </thead><tbody>${rowsAt(nowIdx)}</tbody></table></div>
      <div class="muted small">Selected raw-data date. sentiment estimates retail buy/sell imbalance (quote rule + tick rule); activity estimates retail volume / total volume. Prior-20D means and z-scores use only up to 20 trading days before the current date for that ticker, with at least five valid observations and sample standard deviation. Google Trends is display-only. The composite column shows the product of the two actually frozen z-scores; unfrozen history is shown as —. See the research below for the tradable timestamp.</div>`);
    const prev = $("rf-cal-prev"), next = $("rf-cal-next");
    if (prev) prev.onclick = () => { if (canPrev()) { if (--calM < 1) { calM = 12; calY--; } drawNow(); } };
    if (next) next.onclick = () => { if (canNext()) { if (++calM > 12) { calM = 1; calY++; } drawNow(); } };
    const ysel = $("rf-cal-y"), msel = $("rf-cal-m");
    const jump = () => {   // 下拉跳转,夹到 [2026-01, 最新数据月]
      let y = +ysel.value, m = +msel.value;
      if (y > maxY || (y === maxY && m > maxM)) { y = maxY; m = maxM; }
      if (y < 2026) { y = 2026; m = 1; }
      calY = y; calM = m; drawNow();
    };
    if (ysel) ysel.onchange = jump;
    if (msel) msel.onchange = jump;
    document.querySelectorAll("#rf-now [data-rf-sort]").forEach((el) =>
      el.addEventListener("click", () => {
        const key = el.dataset.rfSort;
        if (nowSortKey === key) nowSortDir *= -1;
        else { nowSortKey = key; nowSortDir = -1; }
        drawNow();
      }));
    document.querySelectorAll("#rf-now .rf-cal-d").forEach((el) =>
      el.addEventListener("click", () => { nowIdx = +el.dataset.idx; drawNow(); }));
  };
  drawNow();

  renderRetailResearch(J.research, set);

  // ④ 净买入热力图
  set("rf-series", netbuyHeatmap(J));

  // ⑤ 采样验证:全量 vs naive vs 精确
  set("rf-valid", renderRetailValidation(J));
}

/* 采样验证面板:每日轮一票同时跑「全量(真值)/ naive / 精确」。
   散点:x=全量净买入,y=采样估计(精确=绿、naive=灰),越贴对角线越准;下方汇总平均绝对误差 + 明细表。 */
function renderRetailValidation(J) {
  const V = J.validation || {};
  const days = Object.keys(V).sort();
  if (!days.length) {
    return `<span class="muted small">No validation records yet. Sampling mode rotates one ticker each night through a full-data run for comparison with naive and precise estimates; ${J.sampled ? "" : "the current dataset is full-data mode with sampling disabled. "}After several days, scatter and error tables will appear here.</span>`;
  }
  const rows = days.map((d) => ({ d, ...V[d] })).filter((r) => r.full && r.precise);
  const absErr = (a, b) => (a == null || b == null) ? null : Math.abs(a - b);
  const pe = rows.map((r) => absErr(r.precise.netbuy, r.full.netbuy)).filter((x) => x != null);
  const ne = rows.map((r) => absErr(r.naive && r.naive.netbuy, r.full.netbuy)).filter((x) => x != null);
  const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const inCI = rows.filter((r) => r.precise.ci && r.full.netbuy >= r.precise.ci[0] && r.full.netbuy <= r.precise.ci[1]).length;
  const nCI = rows.filter((r) => r.precise.ci).length;

  // 散点(自绘 SVG,netbuy∈[-1,1] 双轴 + y=x 对角线)
  const S = 240, pad = 28, X = (v) => pad + (v + 1) / 2 * (S - 2 * pad), Y = (v) => S - pad - (v + 1) / 2 * (S - 2 * pad);
  const pts = (sel, color) => rows.map((r) => {
    const y = sel(r); if (y == null) return "";
    return `<circle cx="${X(r.full.netbuy).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="3" fill="${color}" fill-opacity="0.8"><title>${esc(r.ticker)} ${r.d}\nFull ${r.full.netbuy.toFixed(3)} → ${(color === "#34d399" ? "Precise" : "naive")} ${y.toFixed(3)}</title></circle>`;
  }).join("");
  const svg = `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" style="background:#0d1526;border:1px solid #1e2941;border-radius:6px">
    <line x1="${X(-1)}" y1="${Y(-1)}" x2="${X(1)}" y2="${Y(1)}" stroke="#3a4560" stroke-dasharray="4 3"/>
    <line x1="${X(0)}" y1="${pad}" x2="${X(0)}" y2="${S - pad}" stroke="#1e2941"/>
    <line x1="${pad}" y1="${Y(0)}" x2="${S - pad}" y2="${Y(0)}" stroke="#1e2941"/>
    ${pts((r) => r.naive && r.naive.netbuy, "#8b96ad")}${pts((r) => r.precise.netbuy, "#34d399")}
    <text x="${S / 2}" y="${S - 6}" fill="#8b96ad" font-size="10" text-anchor="middle">Full netbuy (truth)</text>
    <text x="10" y="${S / 2}" fill="#8b96ad" font-size="10" text-anchor="middle" transform="rotate(-90 10 ${S / 2})">Sample estimate</text></svg>`;

  const fmt = (x) => x == null ? "—" : (x > 0 ? "+" : "") + x.toFixed(3);
  const recent = rows.slice(-14).reverse();
  const tbl = recent.map((r) => {
    const pce = absErr(r.precise.netbuy, r.full.netbuy), nce = absErr(r.naive && r.naive.netbuy, r.full.netbuy);
    const ci = r.precise.ci ? `[${r.precise.ci[0].toFixed(2)},${r.precise.ci[1].toFixed(2)}]` : "—";
    return `<tr><td>${r.d.slice(5)}</td><td>${esc(r.ticker)}</td>
      <td class="sc-num">${fmt(r.full.netbuy)}</td>
      <td class="sc-num">${fmt(r.naive && r.naive.netbuy)}</td>
      <td class="sc-num">${fmt(r.precise.netbuy)}</td>
      <td class="muted small">${ci}</td>
      <td class="sc-num ${nce != null && pce != null && pce <= nce ? "up" : ""}">${pce == null ? "—" : pce.toFixed(3)}</td>
      <td class="sc-num">${nce == null ? "—" : nce.toFixed(3)}</td></tr>`;
  }).join("");

  return `<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">
      <div>${svg}<div class="muted small" style="text-align:center"><span style="color:#34d399">●</span> precise <span style="color:#8b96ad">●</span> naive · closer to the diagonal is better</div></div>
      <div class="opt-grid" style="flex:1;min-width:220px">
        ${tile("Mean Absolute Error · Precise", pe.length ? mean(pe).toFixed(3) : "—", `n=${pe.length}`)}
        ${tile("Mean Absolute Error · Naive", ne.length ? mean(ne).toFixed(3) : "—", "Larger values imply a greater need for precise sampling correction")}
        ${tile("Full Value Inside Precise CI", nCI ? `${inCI}/${nCI}` : "—", "About 95% indicates a well-calibrated CI")}
        ${tile("Validation Samples", String(rows.length), `One rotation per ticker; ${J.tickers ? J.tickers.length : "?"} tickers total`)}
      </div>
    </div>
    <table class="bt-table" style="margin-top:10px"><tr><th>Date</th><th>Ticker</th><th>Full</th><th>Naive</th><th>Precise</th><th>Precise CI</th><th>|Precise−Full|</th><th>|Naive−Full|</th></tr>${tbl}</table>
    <div class="muted small">Each day, one ticker receives an extra full-data run as truth, compared with naive pooling and a precise stratified-ratio estimate. Precise absolute error should be lower than naive and closer to the diagonal; full values should fall inside the CI about 95% of the time. Green means precise error ≤ naive.</div>`;
}

/* Topic 3:国债 vs 股市 — 左轴=SPY/QQQ/IWM 归一100,右轴(虚线)=US 2/10/30Y 收益率%。
   研究国债收益率对股市的影响(自 strategy 页迁移)。lightweight-charts(与 trading K 线同框架):
   点击图例开关任意曲线;悬停显示该日所有已展示曲线的值。 */
async function renderRates() {
  const el = $("rates-chart"); if (!el) return;
  const LWC = window.LightweightCharts;
  if (!LWC) { el.innerHTML = '<span class="muted small">Chart library failed to load</span>'; return; }
  const r = await loadJSON("data/rates.json");
  if (!r || !r.series) { el.innerHTML = '<span class="muted small">Missing data/rates.json</span>'; return; }
  const meta = r.meta || {};
  el.innerHTML = "";
  const chart = LWC.createChart(el, {
    layout: { background: { color: "transparent" }, textColor: "#8b96ad" },
    grid: { vertLines: { color: "#1e2941" }, horzLines: { color: "#1e2941" } },
    leftPriceScale: { visible: true, borderColor: "#2a3550" },
    rightPriceScale: { visible: true, borderColor: "#2a3550" },
    timeScale: { borderColor: "#2a3550" },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    height: 380,
  });
  const toLine = (arr) => {
    const seen = new Set(), out = [];
    for (const [d, v] of arr) if (!seen.has(d)) { seen.add(d); out.push({ time: d, value: v }); }
    return out;
  };
  const S = [];                                     // 每条曲线:{label,color,isYield,series,visible,latest,fmt}
  for (const [key, arr] of Object.entries(r.series)) {
    if (!arr || !arr.length) continue;
    const m = meta[key] || {}, isYield = m.axis === "yield";
    const color = m.color || "#60a5fa", label = m.label || key;
    let data, latest, fmt;
    if (isYield) {
      data = toLine(arr);
      latest = arr[arr.length - 1][1].toFixed(2) + "%";
      fmt = (v) => v.toFixed(2) + "%";
    } else {
      const base = arr[0][1] || 1;
      data = toLine(arr.map(([d, v]) => [d, v / base * 100]));   // 归一到 100
      const chg = (arr[arr.length - 1][1] / base - 1) * 100;
      latest = (chg >= 0 ? "+" : "") + chg.toFixed(0) + "%";
      fmt = (v) => (v >= 100 ? "+" : "") + (v - 100).toFixed(0) + "%";   // 归一值→自起点涨跌%
    }
    const series = chart.addLineSeries({
      color, lineWidth: 2,
      lineStyle: isYield ? LWC.LineStyle.Dashed : LWC.LineStyle.Solid,
      priceScaleId: isYield ? "right" : "left",
      priceLineVisible: false, lastValueVisible: false,
    });
    series.setData(data);
    S.push({ label, color, isYield, series, visible: true, latest, fmt });
  }
  chart.timeScale().fitContent();

  // 可点图例:点 label 开关曲线
  const leg = $("rates-legend");
  if (leg) {
    leg.innerHTML = "";
    S.forEach((s) => {
      const chip = document.createElement("span");
      chip.className = "rt-leg";
      chip.innerHTML = `<span class="rt-sw" style="background:${s.color}"></span>${esc(s.label)} <b>${s.latest}</b>`;
      chip.onclick = () => {
        s.visible = !s.visible;
        s.series.applyOptions({ visible: s.visible });
        chip.classList.toggle("off", !s.visible);
      };
      leg.appendChild(chip);
    });
  }

  // 悬停浮层:该日所有"已展示"曲线的值
  const hov = $("rates-hover");
  if (hov) {
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time) { hov.style.display = "none"; return; }
      const rows = [];
      for (const s of S) {
        if (!s.visible) continue;
        const d = param.seriesData.get(s.series);
        if (!d || d.value == null) continue;
        rows.push(`<span style="color:${s.color}">● ${esc(s.label)} ${s.fmt(d.value)}</span>`);
      }
      if (!rows.length) { hov.style.display = "none"; return; }
      hov.innerHTML = `<div class="muted" style="margin-bottom:2px">${param.time}</div>` + rows.join("<br>");
      hov.style.display = "block";
    });
  }
  renderRatesCorr(r);
}

function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const x = xs[i], y = ys[i]; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
  const cov = sxy - sx * sy / n, vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
  return (vx > 0 && vy > 0) ? cov / Math.sqrt(vx * vy) : null;
}

/* 收益率×股市 当日相关性:只算 |Δ收益率|≥阈值(bps)的交易日,同期 Pearson(不做预测)。
   负=收益率↑当日股市↓(压制);正=同向。每对独立在共同交易日上算日度变化。 */
function renderRatesCorr(r, bps) {
  const host = $("rates-corr"); if (!host) return;
  if (!r || !r.series) { host.innerHTML = '<span class="muted small">Missing data/rates.json</span>'; return; }
  const meta = r.meta || {}, S = r.series;
  const yks = ["DGS2", "DGS10", "DGS30"].filter((k) => S[k]);
  const eks = ["SPY", "QQQ", "IWM"].filter((k) => S[k]);
  if (bps == null) { const el = $("rc-thr"); bps = el ? +el.value : 5; }
  const thr = (bps || 0) / 100;                    // bps → 收益率百分点
  const map = {};
  for (const k of [...yks, ...eks]) { const m = {}; for (const [d, v] of S[k]) if (v != null) m[d] = v; map[k] = m; }
  const cell = (yk, ek) => {
    const ds = Object.keys(map[yk]).filter((d) => map[ek][d] != null).sort();
    const dy = [], re = [];
    for (let i = 1; i < ds.length; i++) {
      const d1 = map[yk][ds[i]] - map[yk][ds[i - 1]];
      if (Math.abs(d1) < thr) continue;            // 只留 |Δ收益率|≥阈值 的日
      dy.push(d1); re.push(map[ek][ds[i]] / map[ek][ds[i - 1]] - 1);
    }
    return { c: pearson(dy, re), n: dy.length };
  };
  const heat = (c) => { if (c == null) return ""; const m = Math.min(Math.abs(c), 1); const hue = c >= 0 ? 142 : 0; return `background:hsl(${hue} 65% 45% / ${(0.08 + m * 0.5).toFixed(2)})`; };
  const lab = (k) => (meta[k] && meta[k].label) || k;
  const thead = `<tr><th></th>${eks.map((e) => `<th>${esc(lab(e))}</th>`).join("")}<th class="muted">n</th></tr>`;
  const rows = yks.map((y) => {
    let nrow = 0;
    const tds = eks.map((e) => { const { c, n } = cell(y, e); nrow = Math.max(nrow, n); return `<td class="sc-num" style="${heat(c)}">${c == null ? "—" : c.toFixed(2)}</td>`; }).join("");
    return `<tr><td class="sc-tk"><b>${esc(lab(y))}</b></td>${tds}<td class="muted">${nrow}</td></tr>`;
  }).join("");
  host.innerHTML =
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
       <label class="muted small">|ΔYield| threshold <input id="rc-thr" type="number" step="1" min="0" value="${bps}" style="width:60px;background:var(--card-hover);border:1px solid var(--border);border-radius:6px;padding:3px 6px;color:var(--text)"> bps/day</label>
       <span class="muted small">Same-day Pearson correlation; n = qualifying trading days</span>
     </div>
     <div class="sc-wrap"><table class="bt-table sc-table">${thead}${rows}</table></div>
     <div class="muted small" style="margin-top:8px"><span class="down">Negative (red)</span> = yields up / equities down on the same day, or vice versa; <span class="up">positive (green)</span> = same direction. This is <b>same-day correlation, not a forecast</b>. A higher threshold keeps only larger yield moves and reduces the sample.</div>`;
  const el = $("rc-thr"); if (el) el.addEventListener("change", () => renderRatesCorr(r, +el.value || 0));
}

/* Topic 4:净 GEX → 次日已实现波动(自 strategy 页迁入)。读 data/strategy_bt.json 的 study 字段。
   纯预测力研究(无持仓/成本)→ 属 research。 */
async function renderGexVol() {
  const host = $("gx-study"); if (!host) return;
  const d = await loadJSON("data/strategy_bt.json");
  const s = d && d.study;
  if (!s || s.insufficient) { host.innerHTML = '<span class="muted small">No research data (study field in data/strategy_bt.json)</span>'; return; }
  const sub = $("gx-sub"); if (sub) sub.textContent = `${s.n} days · ${s.start}→${s.end}`;
  const T = (k, v, sb = "", cls = "") =>
    `<div class="opt-tile"><div class="opt-k">${esc(k)}</div><div class="opt-v ${cls}">${esc(v)}${sb ? ` <span class="opt-sub">${esc(sb)}</span>` : ""}</div></div>`;
  const num = (v, dg = 2) => (v == null ? "—" : (+v).toFixed(dg));
  const rg = s.regime || {}, ic = s.incr || {};
  const q = s.quintiles_pct || [], qmax = Math.max(...q, 0.001);
  const bars = q.map((v, i) =>
    `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
       <div style="font-size:10px;color:var(--muted)">${v}%</div>
       <div style="width:34px;height:${Math.round(v / qmax * 90)}px;background:var(--accent);border-radius:3px 3px 0 0"></div>
       <div style="font-size:10px;color:var(--muted)">Q${i + 1}</div>
     </div>`).join("");
  host.innerHTML =
    `<div class="wb-statbar">${[
      T("Next-Day Vol: GEX<0 vs >0", (rg.ratio ?? "—") + "×", `${rg.neg_mean_pct}% / ${rg.pos_mean_pct}%`, "down"),
      T("Spearman", num(s.spearman, 3), `CI [${(s.spearman_ci || []).join(", ")}]`, "down"),
      T("Incremental ΔR²", "+" + num((ic.delta_r2 ?? 0) * 100, 2) + "%", "after controlling for |r_t|", "up"),
      T("Subperiods", (s.subperiods || []).map((p) => `${p.label} ${p.spearman}`).join(" · ")),
    ].join("")}</div>
     <div style="display:flex;gap:14px;align-items:flex-end;margin:14px 0 4px;height:120px">${bars}</div>
     <div class="muted small">${esc(s.label || "Net GEX → Next-Day Realized Volatility")}: next-day |r| grouped by GEX quintile. Low GEX (Q1) maps to higher volatility; high GEX (Q5) maps to lower volatility, consistent with dealer-gamma amplification/suppression. This is a pure predictive-power study with no positions or costs.</div>`;
}

/* Topic 5:仓位情报(免费版 JPM Positioning Intelligence)。COT-TFF 两大 cohort(HF/CTA 杠杆基金、
   资管/共同基金)分位 + z-score + real−fast 背离(资管 z−杠杆 z)+ COT 拥挤度$,CTA 定位读自 DBMF
   复制器每日披露持仓(真实多空),折入散户(retailflow)。数据 data/positioning.json。
   (Dealer 已弃:对手方/对冲残差,≈ -(am+lev) 镜像;CTA 触发表已弃:免费世界拿不到,改真实持仓。) */
const POS_COH = [["lev", "#f87171"], ["am", "#60a5fa"]];
const POS_DIV_COLOR = "#fbbf24";                    // real−fast 背离(第三条线)
const fmtZ = (v) => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2);
const fmtPct = (v) => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";
const POS_MLABEL = { SP500: "S&P 500", NDX100: "Nasdaq 100" };
const POS_COHORT_LABEL = { lev: "Leveraged Funds (HF/CTA)", am: "Asset Managers / Mutual Funds" };
const posCohortLabel = (key, fallback) => POS_COHORT_LABEL[key] || fallback || key;
const fmtNum = (v) => v == null ? "—" : Math.round(v).toLocaleString();
const fmtB = (v) => {
  if (v == null) return "—";
  const a = Math.abs(v);
  return a >= 1e9 ? (v / 1e9).toFixed(1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(0) + "M" : Math.round(v).toLocaleString();
};
const fmtUsd = (v) => v == null ? "—" : (v < 0 ? "-$" : "$") + fmtB(Math.abs(v));
let POS_J = null, POS_MKT = null, POS_ETF = null;   // POS_ETF: QQQ/SOXX/IGV 周K,drawPosMarket 叠加用

async function renderPositioning() {
  const J = await loadJSON("data/positioning.json");
  POS_ETF = await loadJSON("data/etf_weekly.json");   // QQQ/SOXX/IGV 周K,叠加到 cohort z 图(可开关)
  if (!J || !J.markets || !Object.keys(J.markets).length) {
    $("pos-gauge").innerHTML = '<span class="muted small">Missing data/positioning.json (run scripts/fetch_cot.py + scripts/build_positioning.py)</span>';
    return;
  }
  POS_J = J;
  const mkeys = Object.keys(J.markets);
  if (!POS_MKT || !J.markets[POS_MKT]) POS_MKT = mkeys[0];

  // 市场下拉(切换图表 + 潜在买卖盘)
  const sel = $("pos-mkt");
  sel.innerHTML = mkeys.map((k) => `<option value="${k}"${k === POS_MKT ? " selected" : ""}>${POS_MLABEL[k] || k}</option>`).join("");
  sel.onchange = () => { POS_MKT = sel.value; drawPosMarket(); };

  // ① 复合 TPM + 各市场各 cohort 分位 tiles
  const comp = J.composite_pctile;
  const gt = [tile("Composite Percentile TPM", comp == null ? "—" : comp + " pct",
    comp == null ? "" : (comp >= 70 ? "Overall crowded long" : comp <= 30 ? "Overall light/short" : "Neutral"))];
  for (const mk of mkeys) {
    for (const [ck] of POS_COH) {
      const c = J.markets[mk].cohorts[ck];
      if (!c) continue;
      gt.push(tile(`${POS_MLABEL[mk] || mk} · ${posCohortLabel(ck, c.label)}`,
        c.pctile == null ? "—" : c.pctile + " pct",
        `z${c.z} · weekly Δ ${(c.weekly_chg || 0) > 0 ? "+" : ""}${fmtNum(c.weekly_chg)}`));
    }
    const dv = J.markets[mk].divergence;
    if (dv && dv.latest != null) {
      gt.push(tile(`${POS_MLABEL[mk] || mk} · real−fast Divergence`, fmtZ(dv.latest) + "σ",
        dv.latest > 0.5 ? "Real money is more crowded long" : dv.latest < -0.5 ? "Fast money is more crowded long" : "Both cohorts are aligned"));
    }
  }
  const yrs = Math.round((J.window_wk || 156) / 52);
  const rf = J.retail;
  $("pos-gauge").innerHTML = `<div class="opt-grid">${gt.join("")}</div>
    <div class="muted small" style="margin-top:6px">Percentile = the cohort's net position rank over the past ${yrs} years (high = relatively crowded long); z = standardized within the same window. Retail: ${rf && rf.avg_netbuy != null ? `recent average net buying ${(rf.avg_netbuy * 100).toFixed(1)}% across ${rf.n} tickers` : "retailflow unavailable"}.</div>`;
  $("pos-caveat").innerHTML = "⚠ COT positioning is delayed and reflects futures cohorts, not the full cash-equity market. DBMF is a public CTA proxy, not a complete industry aggregate.";
  renderCta(J);          // CTA(DBMF)市场无关,渲染一次
  drawPosMarket();
}

function drawPosMarket() {
  const J = POS_J, mk = J.markets[POS_MKT];
  if (!mk) return;

  // ② 各 cohort 净持仓时序(lightweight-charts,与国债页同框架)
  const el = $("pos-chart"), LWC = window.LightweightCharts;
  if (LWC && el) {
    el.innerHTML = "";
    const chart = LWC.createChart(el, {
      layout: { background: { color: "transparent" }, textColor: "#8b96ad" },
      grid: { vertLines: { color: "#1e2941" }, horzLines: { color: "#1e2941" } },
      rightPriceScale: { borderColor: "#2a3550" },
      timeScale: { borderColor: "#2a3550" },
      crosshair: { mode: LWC.CrosshairMode.Normal },
      height: 340,
    });
    const S = [];
    const addLine = (label, color, data, opts = {}) => {
      if (!data || !data.length) return;
      const series = chart.addLineSeries({ color, lineWidth: opts.w || 2, lineStyle: opts.dash ? LWC.LineStyle.Dashed : LWC.LineStyle.Solid, priceLineVisible: false, lastValueVisible: false });
      series.setData(data.map(([d, v]) => ({ time: d, value: v })));
      S.push({ label, color, series, visible: true });
    };
    for (const [ck, color] of POS_COH) {
      const c = mk.cohorts[ck];
      if (c) addLine(posCohortLabel(ck, c.label) + " (z)", color, c.series_z);
    }
    if (mk.divergence) addLine("real−fast Divergence (Asset Managers−Leveraged Funds)", POS_DIV_COLOR, mk.divergence.series_z, { w: 2 });
    if (S.length) S[0].series.createPriceLine({ price: 0, color: "#3a4560", lineStyle: LWC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });   // 0=3年均值基线
    // ETF 周K 叠加(QQQ/SOXX/IGV):各自独立隐藏价格轴 → 各自铺满、形态可比,不与 z 轴混;默认关,点图例开
    const ETF_COLORS = { QQQ: "#60a5fa", SOXX: "#fbbf24", IGV: "#c084fc" };
    const etfSeries = [];
    for (const sym of ["QQQ", "SOXX", "IGV"]) {
      const bars = POS_ETF && POS_ETF.series && POS_ETF.series[sym];
      if (!bars || !bars.length) continue;
      const sid = "etf_" + sym;
      const cs = chart.addCandlestickSeries({ priceScaleId: sid, upColor: "#34d399", downColor: "#f87171", borderVisible: false, wickUpColor: "#34d399", wickDownColor: "#f87171", priceLineVisible: false, lastValueVisible: false, visible: false });
      chart.priceScale(sid).applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 }, visible: false });
      cs.setData(bars.map(([d, o, h, l, c]) => ({ time: d, open: o, high: h, low: l, close: c })));
      etfSeries.push({ sym, series: cs, color: ETF_COLORS[sym], visible: false });
    }
    chart.timeScale().fitContent();
    const leg = $("pos-legend");
    if (leg) {
      leg.innerHTML = "";
      S.forEach((s) => {
        const chip = document.createElement("span");
        chip.className = "rt-leg";
        chip.innerHTML = `<span class="rt-sw" style="background:${s.color}"></span>${esc(s.label)}`;
        chip.onclick = () => { s.visible = !s.visible; s.series.applyOptions({ visible: s.visible }); chip.classList.toggle("off", !s.visible); };
        leg.appendChild(chip);
      });
      etfSeries.forEach((e) => {   // ETF 周K 开关(默认关)
        const chip = document.createElement("span");
        chip.className = "rt-leg off";
        chip.innerHTML = `<span class="rt-sw" style="background:${e.color}"></span>${e.sym} Weekly`;
        chip.onclick = () => { e.visible = !e.visible; e.series.applyOptions({ visible: e.visible }); chip.classList.toggle("off", !e.visible); };
        leg.appendChild(chip);
      });
    }
    const hov = $("pos-hover");
    if (hov) chart.subscribeCrosshairMove((p) => {
      if (!p.point || !p.time) { hov.style.display = "none"; return; }
      const rows = [];
      for (const s of S) {
        if (!s.visible) continue;
        const d = p.seriesData.get(s.series);
        if (!d || d.value == null) continue;
        rows.push(`<span style="color:${s.color}">● ${esc(s.label)} ${fmtZ(d.value)}</span>`);
      }
      for (const e of etfSeries) {   // 可见的 ETF 周K → 显示收盘
        if (!e.visible) continue;
        const d = p.seriesData.get(e.series);
        if (!d || d.close == null) continue;
        rows.push(`<span style="color:${e.color}">● ${e.sym} $${d.close.toFixed(2)}</span>`);
      }
      if (!rows.length) { hov.style.display = "none"; return; }
      hov.innerHTML = `<div class="muted" style="margin-bottom:2px">${p.time}</div>` + rows.join("<br>");
      hov.style.display = "block";
    });
  }

  // ③ 潜在买卖盘:COT 拥挤度$(回中位)
  const rows = POS_COH.map(([ck]) => {
    const c = mk.cohorts[ck];
    if (!c) return "";
    const s = c.crowd_usd, cls = s > 0 ? "up" : s < 0 ? "down" : "";
    return `<tr><td>${esc(posCohortLabel(ck, c.label))}</td><td class="sc-num">${c.pctile == null ? "—" : c.pctile}</td>
      <td class="sc-num ${cls}">${fmtUsd(s)}</td>
      <td class="muted small">${s > 0 ? "Potential buy (light/short)" : s < 0 ? "Potential sell (crowded long)" : "—"}</td></tr>`;
  }).join("");
  $("pos-pressure").innerHTML = `<table class="bt-table"><tr><th>Cohort</th><th>Percentile</th><th>Crowding $ (to Median)</th><th>Interpretation</th></tr>${rows}</table>
    <div class="muted small" style="margin-top:6px">Crowding $ = (current net − median net) × contract multiplier × index. It is the notional required to return to the historical median; positive indicates potential buying and negative indicates potential selling.</div>`;
}

/* CTA 定位:DBMF 复制器每日披露持仓(真实多空,非假设)。市场无关,renderPositioning 调一次。 */
function renderCta(J) {
  const el = $("pos-cta"); if (!el) return;
  const c = J.cta;
  if (!c || !c.buckets) { el.innerHTML = '<span class="muted small">Missing DBMF holdings (run scripts/fetch_dbmf.py)</span>'; return; }
  const b = c.buckets;
  const ROWS = [
    ["Equities · S&P 500", b.sp500, ""],
    ["Equities · International (EAFE/EM)", b.intl, ""],
    ["Rates (2Y/10Y/Long Bonds)", b.rates, b.rates < 0 ? "Short duration" : "Long duration"],
    ["FX (JPY/EUR…)", b.fx, b.fx < 0 ? "Short foreign currency ≈ long USD" : "Long foreign currency ≈ short USD"],
    ["Commodities (Oil/Gold)", b.commodity, ""],
  ];
  const tr = ROWS.map(([k, v, note]) => {
    if (v == null) return "";
    const cls = v > 0 ? "up" : v < 0 ? "down" : "";
    return `<tr><td>${esc(k)}</td><td class="sc-num ${cls}">${fmtPct(v)}</td>
      <td class="muted small">${v > 0 ? "Net long" : v < 0 ? "Net short" : "—"}${note ? " · " + esc(note) : ""}</td></tr>`;
  }).join("");
  const eq = b.equity, eqCls = eq > 0 ? "up" : eq < 0 ? "down" : "";
  el.innerHTML = `<div class="muted small" style="margin-bottom:6px">Daily disclosed holdings from <b>${esc(c.source || "DBMF")}</b> · as of ${c.asof || "—"} · total net equity exposure <b class="${eqCls}">${fmtPct(eq)}</b></div>
    <table class="bt-table"><tr><th>Asset</th><th>DBMF Net Exposure (% NAV)</th><th>Direction</th></tr>${tr}</table>
    <div class="muted small" style="margin-top:6px">Percentages are notional weights as a share of NAV; signs indicate long or short based on disclosed share quantities. This is the current <b>reported</b> positioning of a trend-following SG CTA Index replicator (0.88 correlation), not a hypothetical trigger-price model. DBMF's equity sleeve combines S&P 500 and international exposure, with no separate Nasdaq sleeve.</div>`;
}

/* ---------- Tab 调度 ---------- */
/* ---------- Topic 6:MACD return ---------- */
const MACD_SNAPSHOT_PATH = "data/macd_returns.json", MACD_SNAPSHOT_KEY = "macdReturnsSnapshot";
let macdPeriod = "all", macdSort = { key: "ticker", direction: 1 }, macdSnapshot = null;

function validMacdSnapshot(value) {
  return value && value.version === 1 && value.periods && ["3m", "6m", "1y", "all"].every((period) => Array.isArray(value.periods[period]));
}

async function loadMacdSnapshot() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(MACD_SNAPSHOT_KEY) || "null"); } catch { /* ignore corrupt local cache */ }
  const remote = await loadFreshJSON(MACD_SNAPSHOT_PATH);
  const choices = [local, remote].filter(validMacdSnapshot).sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)));
  return choices[0] || null;
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

async function saveMacdSnapshot(snapshot) {
  localStorage.setItem(MACD_SNAPSHOT_KEY, JSON.stringify(snapshot));
  const pat = getPat();
  if (!pat) return false;
  const url = `https://api.github.com/repos/${REPO}/contents/${MACD_SNAPSHOT_PATH}`;
  const meta = await fetch(`${url}?ref=data`, { headers: ghHeaders(pat) });
  if (!meta.ok && meta.status !== 404) throw new Error(`Failed to read remote snapshot (${meta.status})`);
  const previous = meta.ok ? await meta.json() : null;
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(pat), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `data: sync MACD returns ${snapshot.generated_at.slice(0, 10)}`,
      content: encodeBase64(JSON.stringify(snapshot, null, 2) + "\n"),
      branch: "data",
      ...(previous && previous.sha ? { sha: previous.sha } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Failed to save remote snapshot (${response.status})`);
  return true;
}

function macdValue(row, key) {
  if (key === "ticker") return row.ticker;
  if (!row.result) return null;
  const [signal, field] = key.split(".");
  return row.result[signal] ? row.result[signal][field] : null;
}

function drawMacdTable() {
  if (!macdSnapshot) {
    $("macd-table").innerHTML = '<span class="muted small">No saved results. Click “Sync All Tickers” to generate the first snapshot.</span>';
    $("macd-status").textContent = "Not yet calculated";
    return;
  }
  const rows = macdSnapshot.periods[macdPeriod];
  const sorted = rows.slice().sort((a, b) => {
    const av = macdValue(a, macdSort.key), bv = macdValue(b, macdSort.key);
    if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return cmp * macdSort.direction || a.ticker.localeCompare(b.ticker);
  });
  const button = (key, label) => {
    const mark = macdSort.key === key ? (macdSort.direction > 0 ? "↑" : "↓") : "↕";
    return `<button class="rf-sort-btn" data-macd-sort="${key}" title="Click to toggle sort direction">${label}<span>${mark}</span></button>`;
  };
  const pct = (value) => value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
  const cell = (result, signal) => {
    if (!result) return `<td class="muted">—</td><td class="muted">—</td>`;
    const item = result[signal], cls = item.totalReturn > 0 ? "up" : item.totalReturn < 0 ? "down" : "";
    return `<td class="${cls}">${pct(item.totalReturn)}</td><td>${item.trades}</td>`;
  };
  const body = sorted.map((row) => `<tr><td><b>${esc(row.ticker)}</b></td>${cell(row.result, "histogramSlope")}${cell(row.result, "zeroLine")}${cell(row.result, "crossover")}</tr>`).join("");
  $("macd-table").innerHTML = `<div class="rf-now-table-wrap"><table class="bt-table rf-now-table"><thead>
    <tr><th rowspan="2">${button("ticker", "Ticker")}</th><th colspan="2">MACD histogram slope</th><th colspan="2">Zero-line</th><th colspan="2">Crossover</th></tr>
    <tr><th>${button("histogramSlope.totalReturn", "Total Return")}</th><th>${button("histogramSlope.trades", "Trades")}</th><th>${button("zeroLine.totalReturn", "Total Return")}</th><th>${button("zeroLine.trades", "Trades")}</th><th>${button("crossover.totalReturn", "Total Return")}</th><th>${button("crossover.trades", "Trades")}</th></tr>
    </thead><tbody>${body}</tbody></table></div>`;
  const available = rows.filter((row) => row.result), missing = rows.filter((row) => !row.result).map((row) => row.ticker);
  const starts = available.map((row) => row.result.validFrom).sort();
  const rangeStarts = available.map((row) => row.result.rangeFrom).sort();
  const latest = available.map((row) => row.result.latest).sort().at(-1) || "—";
  const calculated = macdSnapshot.generated_at ? new Date(macdSnapshot.generated_at).toLocaleString("zh-CN", { hour12: false, timeZone: "America/New_York" }) + " ET" : "—";
  const periodLabel = { "3m": "3M", "6m": "6M", "1y": "1Y", all: "ALL" }[macdPeriod];
  $("macd-status").innerHTML = `Last calculated: <b>${calculated}</b> · ${periodLabel} backtest range <b>${rangeStarts[0] || "—"} → ${latest}</b> · earliest valid MACD ${starts[0] || "—"} · ${available.length}/${rows.length} tickers calculable${missing.length ? ` · no data: ${missing.map(esc).join(", ")}` : ""}`;
  document.querySelectorAll("[data-macd-sort]").forEach((el) => { el.onclick = () => {
    const key = el.dataset.macdSort;
    macdSort = macdSort.key === key ? { key, direction: -macdSort.direction } : { key, direction: key === "ticker" ? 1 : -1 };
    drawMacdTable();
  }; });
}

async function syncMacd() {
  const sync = $("macd-sync");
  sync.disabled = true; sync.textContent = "Syncing…";
  try {
    const [config, research] = await Promise.all([loadFreshJSON("config/tickers.json"), loadFreshJSON("data/research.json")]);
    if (!config || !Array.isArray(config.watchlist) || !research || !research.tickers) throw new Error("Failed to read the ticker list or market data");
    macdSnapshot = buildSnapshot(config.watchlist, research);
    const remote = await saveMacdSnapshot(macdSnapshot);
    drawMacdTable();
    sync.textContent = remote ? "Sync Complete" : "Saved Locally";
  } catch (error) {
    console.error(error);
    sync.textContent = "Sync Failed · Retry";
    $("macd-status").textContent = `Sync failed: ${error.message}`;
  } finally {
    sync.disabled = false;
  }
}

async function renderMacd() {
  if (!macdSnapshot) macdSnapshot = await loadMacdSnapshot();
  drawMacdTable();
  document.querySelectorAll("[data-macd-period]").forEach((el) => { el.onclick = () => {
    macdPeriod = el.dataset.macdPeriod;
    document.querySelectorAll("[data-macd-period]").forEach((button) => button.classList.toggle("active", button === el));
    drawMacdTable();
  }; });
  const sync = $("macd-sync");
  if (sync) sync.onclick = syncMacd;
}

/* ---------- Topic 4.5:期权流 → 方向(逐票 rank-IC,读 data/flow_ic.json) ---------- */
async function renderFlowDir() {
  const d = await loadJSON("data/flow_ic.json");
  if (!d || d.error || !d.predictors) {
    $("fd-caveat").innerHTML = `<span class="muted small">No data. Run <code>scripts/analyze_flow_ic.py</code> locally to generate <code>data/flow_ic.json</code> from gex_daily.</span>`;
    return;
  }
  const heat = (v) => v == null ? "" : `background:hsl(${v >= 0 ? 142 : 0} 65% 45% / ${(0.1 + Math.min(Math.abs(v) / 0.2, 1) * 0.4).toFixed(2)})`;
  const icCell = (s) => {
    if (!s || s.status !== "ok") return `<td class="muted small" title="n_eff ${s ? s.n_eff : "?"} (too few effective observations after overlap)">Insufficient sample</td>`;
    const v = s.mean_ic;
    return `<td style="${heat(v)}" title="IR ${s.ir} · 95%CI [${(s.ci || []).join(", ")}] · n=${s.n_days} (eff ${s.n_eff})">${v >= 0 ? "+" : ""}${v.toFixed(3)}${s.sig ? " ★" : ""}</td>`;
  };
  const H = d.horizons.map((h) => `${h}d`);
  // ① IC 表
  const SIGN = { "1": "expected + (bullish flow → gain)", "-1": "" };
  const flowDescriptions = {
    net_flow: "Signed net options flow / |dealer gamma| (direction)",
    vrp: "Variance risk premium, IV−RV (expensive protection → mean reversion)",
    skew_rr: "Risk reversal, call−put IV (bullish pricing)",
  };
  const rows = Object.entries(d.predictors).map(([p, pd]) => {
    const exp = pd.expected_sign > 0 ? "＋" : "－";
    return `<tr><td class="fd-name"><b>${esc(p)}</b> <span class="muted small">${esc(flowDescriptions[p] || pd.desc)} · expected ${exp}</span></td>`
      + d.horizons.map((h) => icCell(pd.ic[String(h)])).join("") + "</tr>";
  }).join("");
  $("fd-ic").innerHTML = `<div class="sc-wrap"><table class="bt-table fd-tbl"><thead><tr><th>Predictor (Cross-Sectional Rank)</th>${H.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`
    + `<div class="muted small" style="margin-top:6px">IC is the daily Spearman correlation between predictor rank and subsequent-return rank, averaged across days. ★ means the block-bootstrap CI excludes zero; the small sample still requires caution.</div>`;
  // ② gamma 分层(net_flow)
  const gs = d.predictors.net_flow.gamma_split || {};
  const gRow = (label, reg) => `<tr><td class="fd-name"><b>${label}</b></td>${d.horizons.map((h) => icCell((gs[reg] || {})[String(h)])).join("")}</tr>`;
  $("fd-gamma").innerHTML = `<div class="sc-wrap"><table class="bt-table fd-tbl"><thead><tr><th>net_flow IC · by Dealer Gamma</th>${H.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>`
    + gRow("Short gamma (dealer short, net_nom<0)", "short") + gRow("Long gamma (dealer long, net_nom≥0)", "long")
    + `</tbody></table></div><div class="muted small" style="margin-top:6px">Mechanism: under short gamma, dealers hedge with the move, amplifying it, so flow may predict the <b>same direction</b> (momentum). Under long gamma, hedging suppresses the move and flow should weaken. A clear IC difference between regimes would be the edge unique to paid tick data.</div>`;
  // ③ L/S 扣成本回测
  const ls = d.predictors.net_flow.ls_quintile_h1;
  if (ls && ls.status === "ok") {
    const cur = (arr) => (arr && arr.ann_pct >= 0 ? "up" : "down");
    const spark = (() => {
      const c = ls.curve_net_pct || []; if (c.length < 2) return "";
      const W = 680, Hh = 130, pl = 40, pr = 10, pt = 10, pb = 16;
      const ys = c.map((x) => x[1]), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
      const X = (i) => pl + i / (c.length - 1) * (W - pl - pr);
      const Y = (v) => pt + (1 - (v - lo) / ((hi - lo) || 1)) * (Hh - pt - pb);
      const pts = c.map((x, i) => `${X(i).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(" ");
      return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="max-width:${W}px;margin-top:8px"><line x1="${pl}" y1="${Y(0).toFixed(1)}" x2="${W - pr}" y2="${Y(0).toFixed(1)}" stroke="var(--border)"/><polyline points="${pts}" fill="none" stroke="#f87171" stroke-width="1.5"/><text x="${pl - 4}" y="${(Y(hi) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${hi.toFixed(0)}%</text><text x="${pl - 4}" y="${(Y(lo) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${lo.toFixed(0)}%</text></svg>`;
    })();
    $("fd-ls").innerHTML = `<div class="opt-grid">`
      + tile("Long/Short Buckets", `Top/bottom ${ls.quintile} tickers each`, `${ls.n} days`)
      + tile("Gross Annualized", `${ls.gross.ann_pct}%`, `Sharpe ${ls.gross.sharpe}`, cur(ls.gross))
      + tile("Net Annualized", `${ls.net.ann_pct}%`, `${ls.cost_bps}bp/side · Sharpe ${ls.net.sharpe}`, cur(ls.net))
      + `</div>${spark}<div class="muted small" style="margin-top:6px">Long the top net_flow bucket and short the bottom bucket, H=1 with daily full turnover. net_flow IC is currently <b>negative/weak</b>, and daily turnover costs are heavy, so direct trading is not viable. This is an honest result, not a failure.</div>`;
  } else {
    $("fd-ls").innerHTML = `<span class="muted small">Insufficient backtest sample.</span>`;
  }
  // caveat
  const note = [
    "Daily IC observations for H>1 overlap heavily. Confidence intervals use a block bootstrap rather than a naive bootstrap; n_eff = n_days / H is only a rough effective sample size.",
    "entry_lag=1 prevents look-ahead because signals are known only after the close and positions enter the next day. The L/S test turns over daily, so high costs are an intentional part of the result.",
  ].map((n) => `<li>${esc(n)}</li>`).join("");
  $("fd-caveat").innerHTML = `<b>⚠️ The sample is extremely small. Focus on the engine and mechanism, not the absolute values.</b> · ${d.n_dates} trading days (${(d.date_range || []).join("→")})`
    + `<ul class="muted small" style="margin:6px 0 0;padding-left:18px">${note}</ul>`;
}

/* ---------- Topic 8:Five-Factor Equity Return Decomposition ---------- */
let fiveFactorPeriod = "1y", fiveFactorSnapshot = null;
let fiveFactorSort = { key: null, direction: "desc" };

function ffNumber(value, kind, currency = "USD") {
  if (!Number.isFinite(value)) return "—";
  if (kind === "pct") return `${(value * 100).toFixed(1)}%`;
  if (kind === "pe") return `${value.toFixed(1)}×`;
  const symbol = currency === "KRW" ? "₩" : "$";
  const abs = Math.abs(value), sign = value < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}${symbol}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${symbol}${abs.toFixed(0)}`;
}

function ffShares(value) {
  if (!Number.isFinite(value)) return "—";
  return value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value.toLocaleString();
}

function ffCell(result, key, formatter, warning) {
  const factor = result.factors[key], raw = result.raw[key];
  if (!Number.isFinite(factor)) return `<td title="Denominator is zero or data is unavailable">
    <div class="ff-factor ff-warning">⚠</div>
    <div class="ff-raw">${formatter(raw.prior)} → ${formatter(raw.current)}</div>
  </td>`;
  const cls = factor > 1 ? "up" : factor > 0 && factor < 1 ? "down" : "ff-warning";
  return `<td${warning ? ` title="${esc(warning)}"` : ""}>
    <div class="ff-factor ${cls}">${factor.toFixed(2)}×${warning ? ' <span class="ff-warning">⚠</span>' : ""}</div>
    <div class="ff-raw">${formatter(raw.prior)} → ${formatter(raw.current)}</div>
  </td>`;
}

function ffSortHeader(label, formula, key) {
  const active = fiveFactorSort.key === key;
  const arrow = active ? (fiveFactorSort.direction === "desc" ? "↓" : "↑") : "↕";
  return `<button class="ff-sort-btn" data-ff-sort="${key}">${label}<br><span class="muted">${formula}</span><i>${arrow}</i></button>`;
}

function ffSortValue(row, key) {
  const result = decomposeFiveFactor(row);
  if (!result) return null;
  return key === "price" ? result.priceRatio : result.factors[key];
}

function drawFiveFactorTable() {
  if (!fiveFactorSnapshot) return;
  const sourceRows = fiveFactorSnapshot.periods?.[fiveFactorPeriod] || [];
  const rows = [...sourceRows];
  if (fiveFactorSort.key) rows.sort((a, b) => {
    const av = ffSortValue(a, fiveFactorSort.key), bv = ffSortValue(b, fiveFactorSort.key);
    if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
    if (!Number.isFinite(bv)) return -1;
    return (av - bv) * (fiveFactorSort.direction === "asc" ? 1 : -1);
  });
  const complete = rows.filter((row) => row.status === "ok").length;
  const body = rows.map((row) => {
    if (row.status !== "ok") return `<tr><td><b>${esc(row.ticker)}</b></td><td colspan="6" class="ff-missing">${esc(row.reason || "Insufficient data")}</td></tr>`;
    const result = decomposeFiveFactor(row);
    if (!result) return `<tr><td><b>${esc(row.ticker)}</b></td><td colspan="6" class="ff-missing">Unable to calculate</td></tr>`;
    const warning = result.unstable.join("；");
    const priceClass = result.priceRatio > 1 ? "up" : result.priceRatio > 0 && result.priceRatio < 1 ? "down" : "ff-warning";
    const source = row.source_url || (row.cik ? `https://data.sec.gov/api/xbrl/companyfacts/CIK${row.cik}.json` : null);
    const ticker = source ? `<a href="${source}" target="_blank" rel="noopener"><b>${esc(row.ticker)}</b></a>` : `<b>${esc(row.ticker)}</b>`;
    const priceSymbol = row.currency === "KRW" ? "₩" : "$";
    return `<tr>
      <td>${ticker}${warning ? ` <span class="ff-warning" title="${esc(warning)}">⚠</span>` : ""}
        <div class="ff-price">TTM ${row.prior.ttm_end} → ${row.current.ttm_end}</div>
      </td>
      <td><div class="ff-factor ${priceClass}">${result.priceRatio.toFixed(2)}×</div>
        <div class="ff-raw">${priceSymbol}${row.prior.price.toFixed(2)} → ${priceSymbol}${row.current.price.toFixed(2)}</div></td>
      ${ffCell(result, "revenue", (value) => ffNumber(value, "money", row.currency), null)}
      ${ffCell(result, "margin", (value) => ffNumber(value, "pct"), row.current.operating_income <= 0 || row.prior.operating_income <= 0 ? warning : null)}
      ${ffCell(result, "conversion", (value) => ffNumber(value, "pct"), warning || null)}
      ${ffCell(result, "buyback", ffShares, null)}
      ${ffCell(result, "multiple", (value) => ffNumber(value, "pe"), row.current.net_income <= 0 || row.prior.net_income <= 0 ? warning : null)}
    </tr>`;
  }).join("");
  $("ff-table").innerHTML = `<div class="ff-table-wrap"><table class="bt-table ff-table"><thead><tr>
    <th>Ticker</th><th>${ffSortHeader("Price Return", "P₁/P₀", "price")}</th>
    <th>${ffSortHeader("Revenue Growth", "R₁/R₀", "revenue")}</th>
    <th>${ffSortHeader("Margin Expansion", "OM₁/OM₀", "margin")}</th>
    <th>${ffSortHeader("Earnings Conversion", "(NI/OI)₁/(NI/OI)₀", "conversion")}</th>
    <th>${ffSortHeader("Buyback / Dilution", "Shares₀/Shares₁", "buyback")}</th>
    <th>${ffSortHeader("Multiple Re-rating", "PE₁/PE₀", "multiple")}</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
  const generated = fiveFactorSnapshot.generated_at
    ? new Date(fiveFactorSnapshot.generated_at).toLocaleString("zh-CN", { hour12: false, timeZone: "America/New_York" }) + " ET" : "—";
  $("ff-status").textContent = `as of ${fiveFactorSnapshot.as_of} · ${complete}/${rows.length} calculable · static snapshot generated ${generated}`;
  document.querySelectorAll("#ff-table [data-ff-sort]").forEach((button) => { button.onclick = () => {
    const key = button.dataset.ffSort;
    fiveFactorSort = fiveFactorSort.key === key
      ? { key, direction: fiveFactorSort.direction === "desc" ? "asc" : "desc" }
      : { key, direction: "desc" };
    drawFiveFactorTable();
  }; });
  installFloatingTableHeader($("ff-table").querySelector(".ff-table-wrap"), ".ff-table", "fivefactor");
}

async function renderFiveFactor() {
  if (!fiveFactorSnapshot) fiveFactorSnapshot = await loadFreshJSON("data/five_factor.json");
  if (!fiveFactorSnapshot?.periods) {
    $("ff-table").innerHTML = '<span class="muted small">Missing data/five_factor.json.</span>';
    $("ff-status").textContent = "Data unavailable";
    return;
  }
  drawFiveFactorTable();
  document.querySelectorAll("[data-ff-period]").forEach((button) => { button.onclick = () => {
    fiveFactorPeriod = button.dataset.ffPeriod;
    document.querySelectorAll("[data-ff-period]").forEach((item) => item.classList.toggle("active", item === button));
    drawFiveFactorTable();
  }; });
}

async function renderStocks() {
  await initScorecards();
  installFloatingTableHeader(document.querySelector("#scorecards .sc-wrap"), ".sc-table", "scorecards");
}

window.addEventListener("scorecards-rendered", () => {
  installFloatingTableHeader(document.querySelector("#scorecards .sc-wrap"), ".sc-table", "scorecards");
});

/* ---------- Topic 9:Regime 七维手工快照 ---------- */
const REGIME_PATH = "data/regime_snapshots.json", REGIME_LOCAL_KEY = "regimeSnapshotsV1";
let regimeStore = null, regimeValues = defaultRegimeValues(), regimeAnchor = null, regimeDragIndex = null, regimeFrozen = false;

const regimeLatestFriday = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const friday = regimeFriday(today);
  if (friday <= today) return friday;
  const previous = new Date(`${friday}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 7);
  return previous.toISOString().slice(0, 10);
};

function localRegimeStore() {
  try { return JSON.parse(localStorage.getItem(REGIME_LOCAL_KEY) || "null"); }
  catch { return null; }
}

function writeLocalRegimeStore(store) {
  localStorage.setItem(REGIME_LOCAL_KEY, JSON.stringify(store));
}

async function loadRegimeStore() {
  const remote = await loadFreshJSON(REGIME_PATH);
  return mergeRegimeStores(remote, localRegimeStore());
}

async function writeRemoteRegimeStore(store) {
  const pat = getPat();
  if (!pat) return false;
  const url = `https://api.github.com/repos/${REPO}/contents/${REGIME_PATH}`;
  const meta = await fetch(`${url}?ref=data&t=${Date.now()}`, { headers: ghHeaders(pat), cache: "no-store" });
  if (!meta.ok && meta.status !== 404) throw new Error(`Failed to read remote snapshot (${meta.status})`);
  const previous = meta.ok ? await meta.json() : null;
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(pat), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `data: save regime snapshot ${$("regime-date").value}`,
      content: encodeBase64(JSON.stringify(store, null, 2) + "\n"),
      branch: "data",
      ...(previous?.sha ? { sha: previous.sha } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Failed to save remote snapshot (${response.status})`);
  return true;
}

function regimePolygon(values, radius = 180) {
  return REGIME_DIMENSIONS.map((name, index) => {
    const point = radarPoint(index, values[name], 250, radius);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ");
}

function buildRegimeRadar() {
  const rings = [2, 4, 6, 8, 10].map((level) => `<polygon points="${regimePolygon(Object.fromEntries(REGIME_DIMENSIONS.map((name) => [name, level])))}" class="regime-ring"/>`).join("");
  const axes = REGIME_DIMENSIONS.map((name, index) => {
    const end = radarPoint(index, 10), label = radarPoint(index, 11.8);
    const anchor = label.x < 230 ? "end" : label.x > 270 ? "start" : "middle";
    return `<line x1="250" y1="250" x2="${end.x}" y2="${end.y}" class="regime-axis"/><text x="${label.x}" y="${label.y}" text-anchor="${anchor}" class="regime-label">${name}</text>`;
  }).join("");
  const points = REGIME_DIMENSIONS.map((name, index) => `<circle data-regime-point="${index}" r="8" tabindex="0" role="slider" aria-label="${name}" aria-valuemin="1" aria-valuemax="10" class="regime-point"/>`).join("");
  $("regime-chart").innerHTML = `<svg id="regime-svg" viewBox="0 0 500 500" role="img" aria-label="Seven-dimension regime radar chart">${rings}${axes}<polygon id="regime-shape" class="regime-shape"/>${points}</svg>`;
  const svg = $("regime-svg");
  svg.addEventListener("pointerdown", (event) => {
    if (regimeFrozen) return;
    const point = event.target.closest("[data-regime-point]");
    if (!point) return;
    regimeDragIndex = Number(point.dataset.regimePoint);
    svg.setPointerCapture(event.pointerId);
    updateRegimeFromPointer(event);
  });
  svg.addEventListener("pointermove", (event) => { if (regimeDragIndex != null) updateRegimeFromPointer(event); });
  const stop = () => { regimeDragIndex = null; };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
  svg.addEventListener("keydown", (event) => {
    if (regimeFrozen) return;
    const point = event.target.closest("[data-regime-point]");
    if (!point || !["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const index = Number(point.dataset.regimePoint), name = REGIME_DIMENSIONS[index];
    regimeValues[name] = Math.max(1, Math.min(10, regimeValues[name] + (["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1)));
    updateRegimeView();
    $("regime-status").textContent = "Current adjustments are unsaved";
  });
}

function updateRegimeFromPointer(event) {
  const svg = $("regime-svg"), matrix = svg.getScreenCTM();
  if (!matrix) return;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const name = REGIME_DIMENSIONS[regimeDragIndex];
  regimeValues[name] = radarValueFromPoint(regimeDragIndex, point.x, point.y);
  updateRegimeView();
  $("regime-status").textContent = "Current adjustments are unsaved";
}

function updateRegimeView() {
  $("regime-shape").setAttribute("points", regimePolygon(regimeValues));
  REGIME_DIMENSIONS.forEach((name, index) => {
    const point = radarPoint(index, regimeValues[name]);
    const node = document.querySelector(`[data-regime-point="${index}"]`);
    node.setAttribute("cx", point.x); node.setAttribute("cy", point.y);
    node.setAttribute("aria-valuenow", regimeValues[name]);
    node.setAttribute("aria-disabled", String(regimeFrozen));
  });
  $("regime-chart").classList.toggle("is-frozen", regimeFrozen);
  $("regime-values").innerHTML = REGIME_DIMENSIONS.map((name) => `<div><span>${name}</span><b>${regimeValues[name]}</b></div>`).join("");
}

function selectRegimeFriday(date) {
  const snapshot = regimeStore.snapshots[date];
  regimeAnchor = snapshot ? null : latestRegimeSnapshotBefore(regimeStore, date);
  regimeFrozen = Boolean(snapshot);
  regimeValues = snapshot
    ? { ...snapshot.values }
    : regimeAnchor ? { ...regimeAnchor.values } : defaultRegimeValues();
  $("regime-save").disabled = regimeFrozen;
  $("regime-reset").disabled = regimeFrozen;
  updateRegimeView();
  $("regime-status").textContent = snapshot
    ? `${date} · saved, read-only`
    : regimeAnchor ? `${date} · unsaved; anchored to the prior snapshot ${regimeAnchor.date}` : `${date} · unsaved; no historical snapshot, defaulting all values to 5`;
}

async function persistRegime() {
  const date = $("regime-date").value;
  if (!isRegimeFriday(date)) { $("regime-status").textContent = "Select a Friday"; return; }
  if (date > regimeLatestFriday()) { $("regime-status").textContent = "Only completed weeks can be backfilled"; return; }
  if (regimeFrozen) return;
  const button = $("regime-save");
  button.disabled = true; button.textContent = "Saving…";
  try {
    const remote = await loadFreshJSON(REGIME_PATH);
    regimeStore = mergeRegimeStores(remote, regimeStore);
    if (regimeStore.snapshots[date]) {
      writeLocalRegimeStore(regimeStore);
      selectRegimeFriday(date);
      return;
    }
    regimeStore = saveRegimeSnapshot(regimeStore, date, regimeValues);
    writeLocalRegimeStore(regimeStore);
    const synced = await writeRemoteRegimeStore(regimeStore);
    regimeFrozen = true;
    $("regime-save").disabled = true;
    $("regime-reset").disabled = true;
    updateRegimeView();
    $("regime-status").textContent = synced ? `${date} saved and synced · read-only` : `${date} saved locally · read-only`;
  } catch (error) {
    console.error(error);
    $("regime-status").textContent = `Save failed: ${error.message}`;
  } finally {
    button.disabled = regimeFrozen; button.textContent = "Save Snapshot";
  }
}

async function renderRegime() {
  regimeStore = await loadRegimeStore();
  const latestFriday = regimeLatestFriday();
  $("regime-date").max = latestFriday;
  $("regime-date").value = latestFriday;
  buildRegimeRadar(); selectRegimeFriday(latestFriday);
  $("regime-reset").onclick = () => {
    regimeValues = regimeAnchor ? { ...regimeAnchor.values } : defaultRegimeValues();
    updateRegimeView();
    $("regime-status").textContent = regimeAnchor ? `Reset to the ${regimeAnchor.date} snapshot; unsaved` : "No historical snapshot; reset to 5 and unsaved";
  };
  $("regime-save").onclick = persistRegime;
  $("regime-date").onchange = (event) => {
    const date = event.target.value;
    if (!date) return;
    if (!isRegimeFriday(date)) {
      const corrected = regimeFriday(date);
      event.target.value = corrected && corrected <= latestFriday ? corrected : latestFriday;
      selectRegimeFriday(event.target.value);
      return;
    }
    selectRegimeFriday(date);
  };
}

const RENDER = { bearbull: renderBearbull, rates: renderRates, regime: renderRegime, retailflow: renderRetailflow, positioning: renderPositioning, gexvol: renderGexVol, flowdir: renderFlowDir, macd: renderMacd, stocks: renderStocks, fivefactor: renderFiveFactor };
const rendered = {};
async function showTopic(topic) {
  if (!RENDER[topic]) return;
  document.querySelectorAll(".tab[data-topic]").forEach((t) => t.classList.toggle("active", t.dataset.topic === topic));
  document.querySelectorAll("[data-topic-panel]").forEach((s) => { s.hidden = s.dataset.topicPanel !== topic; });
  if (!rendered[topic]) { rendered[topic] = true; try { await RENDER[topic](); } catch (e) { console.error(e); } }
  requestAnimationFrame(() => floatingTableHeaders.forEach((header) => header.sync()));
}
document.querySelectorAll(".tab[data-topic]").forEach((t) => {
  if (!RENDER[t.dataset.topic]) return;             // deadtime 等未实现的保持禁用
  t.style.cursor = "pointer";
  t.addEventListener("click", () => showTopic(t.dataset.topic));
});
showTopic("bearbull");
