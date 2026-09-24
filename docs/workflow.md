## 关联现有数据（2026-09-23）

Workflow 顶部「关联现有数据」读取 risk_policy（含浏览器覆盖和 riskGroups）及 portfolio 快照，预览现有活跃 Thesis。逐项关联，仅写 Workflow 本地存储；按来源名称防止重复导入。原页面无布局或流程修改。

Edge → Hypothesis 论点依据，Invalidation → 证伪条件，Shelf life → 目标日期。多标的分组保留 linkedSymbols，匹配持仓经成本、源时间、现有归属检查后整仓关联；跳过项保留提示。Risk Budget 打开对应来源 Thesis，但打开动作不更改共享默认值。导入风险参数保留快照；论点不是双向同步，后续人工编辑不会被源数据覆盖。Position Management 沿用刷新机制；Attribution 沿用完整合约归属对账。既有归档保留在原页面，尚未导入；不从现有持仓推断方案、收益预测或实际净收益。

## Risk Budget：直接复用账户风险控制（2026-09-23）

Risk Budget 使用 Portfolio 的同一组件、字段、仓位计算及 Thesis 管理操作，共用 riskPolicy 本地设置和原有手动远端同步。移除该节点额外的方案选择器、Delta/损失预算字段及情景表，不要求先创建交易方案。账户设置不再按候选方案隔离。

「保存节点快照」将组件参数和计算器输入保存在实例 accountRiskSnapshot 中，并记录事件；与候选方案切换无关。历史及归档只读，不读取当前账户设置替代旧值；没有记录过此快照的旧版本显示缺失说明。快照不包含 PAT。pending/running 保持原有手动流转。

## Expected Return: chart-based workspace

Each candidate plan has compact manual fields for expected net P&L, allocated capital, an optional expected completion date (defaults to structure evaluation date), and optional average net loss for the matrix. Expected return is expected net P&L / positive allocated capital; zeros are valid profits while missing data remains unknown. No probability or expectancy is inferred from Greeks.

1. Payoff small multiples group all stock and option legs by normalized underlying ticker. Curves show one unit combination's gross terminal dollar P&L, with correctly signed stock/option quantities and the standard 100 option multiplier. Each group includes zero-P&L and available reference-price lines, exact piecewise-linear breakevens including zero intervals, tooltips and optional individual-leg overlays. Each group's options must expire on the evaluation date; otherwise that group displays a pricing-model requirement. Other supported groups still render. No IV/time value, fees, dividends, borrow or early exercise are fabricated. A purchase price is never labeled a current quote.
2. The shared scatter uses return percentage on X and completion/expected completion date increasing upward on Y. Background dots are archived actual outcomes, plus at most one translucent prediction for the currently inspected candidate. Archived current theses show their original captured forecast and highlighted actual outcome, connected by a line. Demo cases are separated from real cases. Missing capital/profit omits the actual dot with a count, rather than implying zero. During snapshot replay, the shared history is reconstructed only through that snapshot's time.
3. The matrix uses win rates 30–90% in 10-point steps and average profit/loss ratios 0.5, 1, 1.5, 2, 3, 4. Without average loss it shows R multiples. With average net loss, it shows dollar expectancy or return percentage and highlights cells meeting the manually entered target. It uses E = L[pb − (1 − p)], not maximum profit / maximum loss, and makes no claim that displayed win rates are measured strategy probabilities.

The first eligible In Action forecast automatically captures `returnBasis`: plan identity, expected net P&L, allocated capital, rate, optional forecast date and timestamp. It may be captured when selecting In Action or when saving the first complete inputs for an already-active plan. Subsequent edits remain working predictions and do not rewrite that original denominator. On archive, `performance` snapshots the basis, Attribution's manual actual net P&L, and completion timestamp. Actual return uses the captured capital, never net premium or a subsequently changed budget. Attribution also shows these rates. No new freeze button, broker call or Position Management backward refresh was introduced. Existing historical snapshots remain unchanged; old archives without a captured capital basis stay explicitly unplotted.

Validation: 38 unit tests and six isolated browser suites, including grouping stock + spread legs, mixed expiry rejection, breakevens, a single live prediction, actual-history filtering, manual-input persistence and validation, matrix arithmetic, fixed-denominator archive returns and mobile layout.

## Plan-table interaction

Click a plan row or its keyboard-focusable name to open its leg editor. The last column has a blank heading and contains only a ⋯ button. Its native popover contains Set/Unset In Action and Delete Plan; menu clicks do not open the editor. Native popover behavior supports Escape and outside-click dismissal and avoids clipping in the scrollable table. There is no adoption column. Current UI and new event labels use “In Action”; historical “In Action Policy” event records remain compatible and are displayed with the shortened label. The selected policy retains red row text.

## Current candidate-plan manager (supersedes baseline freezing below)

Portfolio Construction is a table of named candidate plans. Each row stores its own construction, Expected Return and Risk Budget data. Adding/editing opens the leg panel; opening the node or saving a plan leaves it collapsed. Renaming preserves its stable ID and associated parameters. Deleting removes all three live configurations but preserves workflow event snapshots.

`design.selectedId` is the plan being inspected across the three design nodes; `design.activeId` is the single optional In Action Policy, shown in red. Switching inspection never changes the policy. Deleting the active plan clears policy rather than silently promoting another candidate. Deleting the last plan leaves an empty manager and disabled returns/risk editors. Account-wide settings remain shared; per-plan risk inputs and captured account snapshots remain isolated.

The old freeze/new-version buttons have been removed. Existing single-plan data migrates once into a named plan, including its returns and risk data; an old frozen baseline becomes the active policy. Old snapshots are not rewritten. Backups validate plan IDs, names, selected/active references, per-plan data and consistency between the selected plan and node projections. Archived instances and snapshot replay remain read-only. Attribution uses the first recorded policy selection as a comparison baseline; actual-position Delta comparison uses the active policy rather than the candidate being inspected.

Validation: 31 unit tests and five isolated browser suites. Candidate browser coverage includes three named strategies, collapsed editor, red policy, rename, independent return/risk fields, synchronized deletion, replay of deleted plans, persistence and mobile overflow checks.

## Current node fields and progress (supersedes the earlier state-machine descriptions below)

- Hypothesis has four optional text areas in this order: 市场结果预期假设 (`expectation`), 论点依据 (`rationale`), 验证条件 (`verification`), 证伪条件 (`invalidation`). There is no direction selector or numeric target field.
- Every node starts `pending` and supports `pending ↔ running`. Both labels are manual progress markers, not approval or completion. Transitions require no reason or domain prerequisites. Edits and account refreshes do not change these labels. Domain calculations, financial-data validation and position-allocation checks remain intact.
- Archiving is a separate Attribution action at the instance level, retains read-only replay/export, and requires no open recorded positions or live allocation rules. It does not introduce a third node label.
- Legacy data is validated before migration. Current instances gain `stateVersion: 2` and a single migration event; historical snapshots are unchanged. Initial legacy states map to pending and other states to running. Legacy numerical targets become expectation text, prior rationale/invalidation stay intact, and the removed direction remains available in the original snapshot/export. Historical UI presents the simplified fields and labels. Existing archived instances stay archived. Migration is idempotent and persisted with the existing cross-tab write check.
- Validation: `node --test tests/*.test.mjs` and the Workflow progress, risk, position and Attribution browser fixtures.

# Workflow — thesis workspace

Open `workflow.html` via the same local HTTP server as the dashboard. Risk Budget shares the Portfolio risk-control component and account settings. Trading, Research and Strategy remain separate. Position Management now links read-only actual-position allocations from the same local Portfolio snapshot.

## First version

- Four layers / seven nodes: Alpha Research (Hypothesis, Signal), Portfolio Design & Risk Allocation (Expected Return, Portfolio Construction, Risk Budget), Position Lifecycle Management, Performance Attribution.
- Independent instances, active/archive library, editable node panels, explicit guarded state transitions, reasons, revision history, read-only snapshots and archive.
- Every saved edit and transition captures the entire instance (node states, fields, portfolio legs and manual position snapshot). Events are append-only through the UI. Snapshots are not cryptographically tamper-proof audit records.
- Leg edits invalidate the previous return/risk assessment and confirmed design. Hypothesis and signal edits require reconfirmation. Existing actual positions can be entered without approving a pre-trade plan.
- Actual positions can be entered manually or explicitly linked to Portfolio quantities. This page does not directly call broker MCP tools: the existing broker refresh/build pipeline updates the private Portfolio snapshot, which both pages read. Risk Budget reads the same local policy/position/ATR sources without writing them.

## Storage and privacy

Records are stored in `localStorage` under `research-desk.workflow.v1`, scoped to browser profile and origin (scheme, host and port). No instance data is included in the public repo or sent over the network. This is not encrypted storage or an account sync service. Clearing site data removes it; use JSON export for durable backups. Changing `localhost` to `127.0.0.1` or changing ports creates a different storage scope.

Import validates format, states, history and snapshots before writing; existing IDs are skipped, never overwritten. Exported backups contain private thesis/position information and should be stored privately. Storage errors are surfaced instead of silently discarding writes. A concurrent tab update blocks a stale write; export unsaved workspace history and refresh before continuing. Form edits must be saved before export to include them.

The archive is read-only. To express a new trade after a closed lifecycle, create a new thesis instance. Creation fixes the instance title, symbol and target date in this version. Future metadata editing should be versioned and invalidate dependent design assessments.

## Calculation boundaries

Candidate values are manually supplied and denominated in USD. Account stop-risk evaluation reads local position/ATR snapshots; it does not fetch live broker prices. Stock quantities are shares; standard option quantities are integer contracts with a fixed multiplier of 100. Adjusted contracts and other multipliers are unsupported.

- Scenario P&L = sum of signed quantity × multiplier × (target-date value − entry value), minus the manually entered total transaction costs.
- Stocks use scenario price. Options use expiration intrinsic value. All options must share the thesis target date. Different expiries / pre-expiry valuation require a pricing model and are explicitly blocked, rather than treating intrinsic value as market value.
- Expected P&L is shown only for three nonnegative probabilities summing to 100%. Probability basis is required before marking that evaluation complete. No probabilities are supplied by default.
- Theoretical expiration maximum loss is calculated at zero and each strike, plus the high-price slope to detect unbounded short exposure. It is not a broker margin requirement, stop-loss estimate, or a bound during legging, early exercise or assignment.
- Delta, Gamma, Theta and Vega are signed and quantity-weighted. Option inputs are long-unit Greeks; short direction is applied by the model. Missing option Greeks stay unknown. Vega uses dollar change per one volatility percentage point, theta per day.
- Risk gating checks theoretical loss against the thesis loss budget and combined same-underlying Delta against its limit. Other-underlying correlation, concentration, liquidity, buying power and Greeks limits are manual account-context review in this version; not a complete account risk engine.
- Attribution is a documented review, not automatic causal P&L decomposition.

## Files and checks

- `assets/workflow-model.mjs`: pure domain model, state guards, scenario/exposure calculations, validation.
- `assets/workflow.js`: independent persistence, rendering and interaction.
- `assets/workflow.css`: independent styles.
- `node --test tests/workflow.test.mjs`: payoff, missing inputs, state invalidation, lifecycle, archive and import validation tests.

Future broker sync should provide a separate normalized snapshot adapter with source identity and observation timestamps, keeping sync status separate from position lifecycle state. It should neither modify existing Portfolio files nor pretend manual snapshots came from MCP.

## Shared Risk Budget integration

- `risk-control.js` owns the original Portfolio editor (mounted through a compatibility wrapper in `strategy.js`) and the Workflow adapter. `risk-budget.mjs` provides the same stock sizing and current-position risk formulas to both entry points.
- Shared account fields: `riskPolicy.account_equity` (existing manually entered global calculator equity) and `riskMaxHeat` (existing account heat ceiling). Writes preserve other policy fields and bundles, set `riskPolicyDirty`, and do not synchronize remotely. The Portfolio manual sync button remains the only policy publishing action.
- Portfolio heatmap still uses broker net liquidation value for its percentage denominator. Workflow explicitly uses the existing calculator's manual equity for sizing and budget dollars. These denominators are labeled separately rather than silently mixing them. This step does not introduce per-broker-account budgets.
- Workflow reads `config/risk_policy.json`, `data/portfolio.json`, and `data/atr.json`; uses `riskGroups` / `riskStops` overrides; estimates open stock stop risk and the existing option market-value proxy. Missing coverage stays unknown. Source timestamps and build timestamps are separate. Account range is all available accounts, excluding Agentic and using the existing small-stock filter. The Portfolio account selector does not change this Workflow scope.
- Instance sizing parameters live only under `nodes.risk.data.sizing`. Copying an existing Portfolio thesis is an explicit one-time template action, not a live association. It cannot rename or overwrite a Portfolio thesis. Target/edge/invalidation remain in Workflow's research nodes.
- `nodes.risk.data.accountSnapshot` captures the aggregate account context at save time. No underlying account position rows are copied into the thesis. Historical replay uses this saved snapshot without fetching current account data.
- Cross-tab shared-account edits refresh the component, preserve unsaved instance input, and invalidate approved risk/design states. Before risk approval or establishing a baseline, the latest context is re-read and compared to the saved snapshot. Archived instances are never changed. There is no polling monitor in this step.
- Stop-risk checks and expiration maximum-loss checks remain independent. Candidate option management-scenario loss is explicitly supplied by the user; expiration max loss is not substituted for it. This is an **incremental** candidate model: current account risk plus the entire candidate. Position replacement, roll netting, and actual-position attribution are not implemented in step one.
- Shared account parameters are not restored globally when importing a Workflow backup. The backup contains historical evaluation snapshots; new approvals require a fresh assessment against this browser's current shared settings.

Checks: `node --test tests/workflow.test.mjs tests/risk-budget.test.mjs`.
Browser integration (requires installed Playwright + Chrome and local server on 8642): `node tests/risk-control.browser.cjs`. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path and `DASHBOARD_URL` to override the local URL. This test uses isolated browser storage and mocked account data, blocks GitHub writes, and does not touch real holdings.

## Position Management integration (step two)

- `position-link.mjs` is a pure normalizer/allocation/reconciliation layer. `position-control.js` reads the existing `data/portfolio.json` through `loadJSON`; no second holdings database, broker API, orders, or raw-account writes are introduced.
- Eligible accounts are identified by ID and exclude Agentic. The picker lists the thesis underlying's stocks and standard options with full ISO expiry, strike, call/put and direction. Keys include broker, account and canonical instrument/direction, avoiding cross-account or same-ticker contract collisions. Instrument IDs and quote timestamps are now preserved by `build_portfolio.py` on the next normal build; existing files work without them. This change does not rebuild or modify private account files automatically.
- The existing pipeline represents option prices/costs in dollars per contract. Linking divides them by 100 into Workflow's standard per-unit premium. Nonstandard multipliers, incomplete dates, invalid quantities and missing costs are not guessed. Greeks remain unknown. Account-average costs are used for allocated quantities; available transactions have no reliable tax-lot identity, so lot attribution is deliberately not implemented.
- `positions.data.binding.rules` persists explicit ownership. Whole-position tracking is exclusive and follows source increases/decreases. Fixed-quantity allocation can split a position across instances; total quantities are checked against the latest source on confirmation. A subsequent source decrease below the combined assigned quantity requires reconciliation and preserves the previous recorded positions rather than guessing which thesis sold.
- Opening a linked node, clicking refresh, or a 60-second timer while the node is visible reads the local snapshot. No polling occurs while form/allocation edits are pending or while replaying/archived/closed. A changed source generates an event and complete workflow snapshot; rebuild-only changes do not churn the log. Recorded prices, costs, quantities, source time and quote time remain frozen in historical replay.
- A missing source position, missing account, backwards/missing source time or allocation conflict does not clear holdings. It becomes an attention state and blocks lifecycle confirmation. A failed source read preserves stored data and cannot confirm lifecycle changes. Confirming a disappeared position requires a newer account source timestamp and an explicit user reason. Releasing ownership is separately labeled and does not claim an actual sale or realized profit.
- Association saves the current node's management notes/exit rules alongside the snapshot. Once linked, source-controlled leg fields are read-only. Sync does not auto-activate, auto-close, re-open a completed lifecycle, modify the candidate plan or place trades. It invalidates prior risk/design approvals where necessary. Source refresh/roll netting and realized P&L attribution remain separate tasks.
- Workflow backups include binding rules and saved sync state. Exclusive claims are validated across cases on import; fixed claims are rechecked against source quantities when reconciling. Browser storage conflict checks continue to protect concurrent writes.

Checks: `node --test tests/workflow.test.mjs tests/risk-budget.test.mjs tests/position-link.test.mjs` and `node tests/position-control.browser.cjs` (same Playwright/URL environment options as the risk-control browser test). All browser tests use isolated storage and synthetic fixtures, not real positions.

## Attribution integration (step 4; Signal integration intentionally deferred)

- Attribution reads the same `data/pnl.json` used by the dashboard. Confirmed Position Management bindings (including closed/released rules) identify exact accounts and full instrument symbols. The user chooses dates and one source window (YTD, 3m, 1m). Overlapping windows are never combined; identical realized events inside a window are retained. Option P&L is already dollars and is not multiplied again.
- These rows are **account-level reconciliation evidence**, not automatically assigned thesis profit. The source lacks fill IDs, quantities, lot identity, fees and precise timestamps. Fixed allocations and other trades of the same instrument cannot be reliably disentangled. Net realized thesis profit and causal explanation remain manual. The UI labels incomplete coverage, missing accounts and no-match results explicitly.
- Reading previews evidence without altering the thesis. Explicit “保存参考快照到此 thesis” saves the evidence plus current form edits in a workflow event. Failed reads retain previously saved evidence; archive/replay uses saved evidence and does not fetch current P&L. Existing backups remain compatible; new evidence validates on import.
- Attribution compares the first confirmed construction baseline's modeled expected profit with manually confirmed net profit, with no automatic causal inference. Full lifecycle snapshots remain accessible in the existing timeline/export.
- Portfolio's existing Journal adds a read-only list of Workflow archives from the same browser storage, with a deep link directly to that instance's Attribution node. Legacy archives remain intact; no remote writes or automatic legacy-name matching occur. Refresh Portfolio to see newly archived cases.

Checks: `node --test tests/*.test.mjs`; `node tests/attribution-control.browser.cjs` with the same Playwright environment as previous tests. Browser fixtures verify saved evidence, preserving manual net profit, source failure retention, archive reload without live fetch, and Journal deep links.

## Parameterized Portfolio Construction

- `trade-structure.mjs` defines independent leg identities, stock/ETF underlying classification, standard stock/call/put legs, starter templates, partial-draft validation and per-underlying exposure. `trade-structure.js` renders the parameter-only editor; no free-text rationale or modification reason is requested in this node.
- New theses may omit a reference symbol and horizon. New legs always start with a blank ticker; each leg has its own ticker, underlying class, direction, unit-combination quantity and reference price. Options add strike, expiration and optional manual Delta/Gamma/Theta/Vega/IV, matching underlying price and observation timestamp. Standard equity options use a fixed 100 multiplier; adjusted contracts are outside this editor's calculation scope.
- Templates create blank contract skeletons and unit ratios; they do not enforce strategy semantics after editing. Applying a template asks before replacing existing draft legs. Partial structures can be saved and exported. Selecting a baseline requires complete leg identities, prices and an evaluation date; Greeks may remain unknown.
- Net cash flow uses signed unit quantities. Greeks use long-option per-share conventions and sign/100x adjustment. IV is a percentage and is not signed. Different tickers retain separate exposure rows. Changing ticker/type/strike/expiry clears stale manual quote metrics. Unknowns remain unknown.
- No callable broker/option MCP market-data endpoint was available in this session, and the site currently runs as static files. The fetch-indicators button is explicitly disabled/unconnected. No fake quotes, automatically derived win probabilities or credentials were added.
- `选定方案 · 保存基准` records a full workflow event and freezes the three design nodes. `创建方案新版本` unlocks a working copy while preserving the original event. pending/running remain the only node labels. Actual Position Management snapshots cannot rewrite the selected design. Attribution recognizes this explicit baseline event.
- Legacy single-ticker legs are presented with their original ticker when converted, preserving prior snapshot bytes. New construction data is versioned independently under `structureVersion: 1`.
- Other nodes' existing scenario and sizing models still support single-underlying assumptions. Multi-underlying construction is supported for drafting and exposure comparison; incompatible aggregate calculations return unknown/unsupported instead of netting cross-asset Delta or applying one spot price to all instruments. Position Management's association workflow is unchanged in this step.
- Checks: 30 unit tests, `tests/trade-structure.browser.cjs` plus all four existing browser suites. Verified partial saves/reload, stock/ETF selection, independent underlyings, sign/units, model boundaries, frozen design, new versions, immutable replay and mobile layout with synthetic fixtures.

- Simplification: underlying class is no longer an input or required validation field. A ticker plus Stock/Call/Put identifies the leg; legacy assetClass values in snapshots remain readable.
