## Underlying Greek Bundles · 第一阶段（2026-09-28）

Portfolio Construction 的最小风险单元改为 **Underlying Greek Bundle**。每个 Bundle 只属于一个 Underlying，但内部允许用户直接编辑任意数量的 Stock / Call / Put 交易腿、Long / Short 方向和 Ratio / Quantity。Starter Structure 只负责生成初始交易腿；保存后所有腿的固定比例共同定义一个可整体缩放的 Bundle。

每条期权腿可手工填写 Reference Mark、Reference Spot、Expiry、Strike、Delta、Gamma、Vega、Theta、IV 与观察时间；正股自动按每股 Delta 1、其余 Greeks 0 处理。Portfolio Construction 按方向、数量和期权 100 倍乘数聚合 Net Delta / Gamma / Vega / Theta。用户单独填写 Reference Capital，作为后续情景收益率与 Kelly 缩放的分母；它不等于账户 Kelly Bankroll。主表显示 Underlying、Reference Spot、四项 Net Greeks 与 Reference Capital，点击 Underlying 行展开或收起腿编辑器。

旧 Candidate Position 数据继续按原有 legs 读取，不重写历史快照。当前 Workflow 已用 Scenario Underwriting 替换旧 Expected Return，并用 Kelly Allocation 替换旧 Risk Budget；ATR mandatory re-underwrite 留给后续阶段。

### Scenario Underwriting → Kelly Allocation

Scenario Underwriting 为整个 thesis 定义一组联合 Bull / Base / Bear 状态。系统先用每个 Bundle 的 Net Delta、Gamma、Vega、Theta、Reference Spot 与 Reference Capital 计算情景收益，再由 Kelly Allocation 同时求解所有 Bundle 的非负资本比例：`max Σ pᵢ log(1 + Σ fⱼrᵢⱼ)`。约束为 `Σfⱼ ≤ 1` 且每个情景中的剩余财富均大于 0。

Kelly Bankroll 只负责把最优比例换算为 Target Capital。每个 Bundle 的 `Scale vs Reference = Target Capital / Reference Capital`；Stock 与 Option 交易腿按这个倍数整体缩放，保留用户在 Portfolio Construction 中定义的内部比例。结果可冻结为 In Action Kelly Allocation，保存当时的比例、目标资本、缩放倍数、目标 Greeks 与各情景组合损益。

### Uncertainty-aware Kelly · 第二阶段（2026-09-29）

每个 Scenario 的 Probability，以及每个 Underlying Bundle 的 Price Move 和可选 IV Change，都可以填写中心值与 `±` 区间。区间表示主观参数范围，不新增单独的 confidence 分数。系统使用固定种子的 500 次均匀 Monte Carlo 采样；每次将采样后的 Bull / Base / Bear 概率重新归一化，再计算 Greek 情景收益和多变量 Kelly。

每个 Bundle 最终保留 Point Full Kelly、Q25、Q50 与 Q100 分布统计。用户在 Kelly Allocation 中选择 Target Quantile；Target Capital、Scale、目标 Greeks、组合情景 P&L 和 In Action snapshot 都使用同一个所选分位向量。目标向量再次投影到 `Σf ≤ 1` 的资本单纯形，避免逐 Bundle 分位数合并后超过总资本。

## Candidate Positions 与共享风险优化（2026-09-26 · 历史实现）

Portfolio Construction 当前管理 **Candidate Positions（候选仓位）**，不再管理带固定数量的互斥方案。每个 Position 的最小输入只有独立的 `Underlying` 与 `Instrument`；新增 Position 不继承 Nebula/Thesis 的参考标的。Instrument 支持 Long/Short Stock、Long Call/Put、Bull/Bear Call Spread、Bull/Bear Put Spread、Long Straddle/Strangle、Covered Call 与 Long Stock + Bull Put Spread。名称由 `Underlying · Instrument` 自动生成。

结构选择规则收在可选的高级区，包括 Target DTE、Long/Short Leg Delta 与 Planned Entry Override。这里不录入数量、权重、真实成交价或持仓成本。Reference Market Snapshot 是只读的标准化行情输出；没有行情时 Position 仍可保存，但 Risk Budget 明确显示 `Incomplete`，不会猜测报价。Planned Entry 是计划口径，未来 Position Management 的 Actual Fill / Cost Basis 属于实际持仓口径，不能覆盖计划值或参考行情。

Expected Return 按 Position 保存单位结构的 Expected P&L、预计完成日期与可选平均亏损。Risk Budget 对所有 Position 使用同一套 Thesis Risk Budget、Capital Limit、Maximum Dollar Delta、共同价格压力和单一 Position 风险贡献上限，比较 Unit Capital、理论最大损失、Stress Loss、Risk Charge 与 Return/Risk，并输出整数 Optimized Quantity。股票以一股为一个单位，期权组合以一组标准结构为一个单位。点击 `设为 In Action Allocation` 后冻结本次数量、风险、资本与组合预期收益，形成 Attribution 使用的收益基准；后续编辑或删除 Candidate Position 会清除旧 Allocation。

Cost 的三个口径分开保存：Reference Mark 属于行情快照；Planned Entry Override 属于计划；Actual Fill / Cost Basis 留给未来 Position Management。当前静态站点尚未接入可调用的期权行情 MCP，因此新 Position 默认等待 Reference Market Snapshot。纯计算与测试使用标准化快照，不生成伪行情。

## Galaxy / Nebula 标签层级（2026-09-26）

Galaxy Overview 只显示 Nebula 名称。无论通过滚轮、触控或界面按钮放大到多近，Star 名称都保持隐藏。点击一个 Nebula 进入 Nebula 层后，只显示该 Nebula 内的 Star 名称；其他 Nebula 仍只显示自己的 Nebula 名称。点击 `返回 Galaxy` 恢复 Overview 规则。

## Nebula 列表与实例管理（2026-09-25）

点击 Galaxy 顶部的 Existing 或 Archive 会从星图左侧边缘展开当前筛选范围的 Nebula 管理抽屉；再次点击当前按钮会收起，点击另一筛选按钮会直接切换列表。Existing 表示所有尚未归档的 Nebula。每行固定包含 Nebula 名称、创建时间、最后修改时间和三点设置键；名称用于定位该 Nebula，三点菜单提供激活/离线、存档与永久删除。每个 Nebula 可独立设为 Active Thesis；Active Thesis 名称显示金色。存档会自动离线，沿用 Attribution 的实例归档逻辑并转为只读；删除在确认后移除实例及全部本地快照。移动端保留四列并允许列表内部横向滚动。

抽屉右边缘提供水平调整柄，可用鼠标或触控拖动，也可聚焦后使用左右方向键、Home 和 End。宽度限制会为桌面星图保留最小空间，并在移动端限制于视口内；最终宽度保存在本机 `research-desk.nebula-drawer-width`，后续打开继续沿用。

Node 保存、状态切换、Nebula 重命名和 Active Thesis 切换成功后不会显示底部成功提示。尚未同步到私有库的 Nebula 在名称前显示一个发光小圆点；金色只表示 Active Thesis。错误提示继续保留。

## Position Management 留空与热力图手动归属（2026-09-25）

Portfolio 风险敞口热力图的每一行重新提供 Thesis 下拉选择。选择结果写入本机 `riskGroups`，立即参与该表的风险聚合并标记共享风险数据待同步；Workflow 的 `linkedSymbols` 只保留来源标的元数据，不再自动决定持仓归属。

Workflow 的 Position Management 现在是保留星点。面板不含输入字段、持仓列表、Portfolio/MCP 读取、绑定、刷新或保存操作，只保留 `pending ↔ running` 的手动状态。`positionNodeVersion: 1` 迁移会把所有当前实例和事件快照中的 Position Management 数据清成 `{}`；新版快照状态归为 `pending`，旧版快照使用其版本可识别的空初始状态。迁移会写入一次清理事件且可重复加载。创建新实例、关联旧 Thesis、归档和导入都不能再向此节点写入持仓字段。

旧的 `position-link.mjs` 与 `position-control.js` 暂留为未挂载适配器，方便未来重新设计时参考；当前 Workflow 不导入或执行它们。Attribution 已保存的对账证据继续保留，新的对账预览因没有账户/合约绑定会明确提示无法自动筛选，实际净损益仍可手工填写。

## Galaxy 状态、重命名与同步提示（2026-09-24）

Star 不再在名称下显示 pending/running 字样：pending 使用暗淡核心和弱光晕，running 使用明亮核心和强光晕；选中环与邻居高亮继续表达图关系，不替代业务状态。Hypothesis 面板顶部的 Nebula 名可双击进入行内编辑，Enter 或失焦保存，Escape 取消；历史快照与归档保持只读。

新建 Nebula 或保存任意 Node、状态流转、方案、快照、Active Thesis 切换及 Nebula 重命名后，该 Nebula 名称前显示发光小圆点，并将未同步标记保存在本机。只有「同步全部」中的 Workflow 快照与旧版风险/归档数据均成功后，才清除已上传且同步期间未再变化的 Nebula 圆点；失败或同步过程中产生的新版本继续保留圆点。该标记不写入远端 workflow.json。Nebula 名称的金色仅由 Active Thesis 状态控制。

## Risk Budget 精简与 Portfolio 仓位试算（2026-09-24）

Workflow 的 Risk Budget 不再显示 Edge 和 Invalidation；这两项研究内容分别归属 Hypothesis 的论点依据与证伪条件。旧数据仍保留在历史记录中，隐藏字段不会被新界面清空或覆盖。Risk Budget 保留 Thesis 风险参数、仓位上限、止盈和 Shelf life 等管理能力。

Portfolio 新增独立的「仓位计算器」板块，用账户净值、单笔风险、买入价、止损价和可选仓位上限计算正股多头的股数、仓位金额与实际风险。可选择一个 Risk Budget Thesis 带入风险百分比和仓位上限；在计算器内修改这两项只用于试算，不回写 Thesis。账户净值继续作为共享设置，修改后会标记待同步。期权和组合结构仍在 Workflow 中管理。

## 统一手动同步（2026-09-24）

顶部「同步全部」位于「历史 Thesis」左侧，替代 Risk Budget 的局部同步入口。workflow.json 写入完整 Workflow store（全部实例、节点和历史快照），以及白名单内的本地风控、分组、止损/目标和旧版归档/事件；不包含 PAT 或清理备份。沿用原私有库和 PAT，并更新原风险配置及 append-only 归档文件。未保存的表单先提示保存，不自动提交草稿。失败区分完整快照与旧版文件的部分完成情况。远端 Workflow 与本机上次已知 SHA 不一致时拒绝覆盖；读取失败不会按空文件覆盖。同步过程中新增编辑不会标为全部已同步。

## Portfolio 风控入口移除（2026-09-24）

Portfolio 只移除「账户风险控制 · 仓位」区块及初始化调用，风险敞口热力图与交易复盘保留。Workflow Risk Budget 继续使用原组件与原 riskPolicy/config 数据，未复制或删除设置。Workflow 顶部「历史 Thesis」复用完整 renderJournal：文件与本地归档合并、归档参数、Edge/Invalidation、进入/退出持仓事件、Note、JSON 导出均保留；历史记录作为只读资料访问，并未伪造成新的 Workflow 星云。Portfolio 仍监听共享风险参数变化刷新热力图。

## 三维恒星星团皮肤（2026-09-24）

星云名称替代 NEBULA 字样，沿用小号淡紫灰字样。每个实例使用 ID 固定随机种子生成 420 个三维恒星光点，从中选取 7 个间隔足够的点作为业务 Star；刷新、状态变化保持位置。节点颜色为自然恒星红、暖黄、白及冷白色，与业务层级无关。左键或单指拖动平移，右键拖动旋转，滚轮或双指缩放平移。聚焦一个 Nebula 或其中的 Star 后，只显示该 Nebula 的业务 Star 标签；远方星云仅保留 Nebula 名称和星团光点，返回 Galaxy Overview 后恢复全部标签。关系数据和节点编辑逻辑保持原样。

Nebula 中心不再使用近似二维的黄金角平面螺旋，而是用 Halton 低差异方向和随实例数扩张的半径分布在三维体积中，Z 轴深度与 X/Y 同量级。背景不再从长方体均匀采样：远景层使用包围场景的球壳分布，银河带层使用倾斜的大圆带、局部密度峰和稀疏区；两层采用不同点尺寸、透明度和自然恒星色，从任何旋转方向都不会暴露方形边界。

深空球壳需要超过 Three.js 默认远裁剪距离。场景把相机 Far Clipping Plane 扩展至 60,000，并让背景层跟随相机位置、保持固定天球方向；恒星使用屏幕空间尺寸，避免远距离衰减成不可见亚像素。普通远星、银河带和少量高亮主星分别渲染，平移、聚焦和缩放后都会保留背景。

## Galaxy 界面（2026-09-24）

Workflow 改为持久 WebGL 场景 + 独立 HTML 节点面板。Galaxy 包含 Nebula（Thesis），每个 Nebula 有 7 个 Star（节点）。缩放和平移仅改变相机，不写业务数据。固定空间布局、显式关系图、直接邻居高亮；背景粒子不承担业务意义。点击 Star 打开/切换面板，再次点击、空白或 Esc 关闭；保留未保存编辑确认。Nebula 标题与搜索定位星云，顶部 Active/Archive 过滤。来源与事件记录在面板底部抽屉，历史只读行为保留。

模块：galaxy-model.mjs（纯图数据）、galaxy-scene.js（Three.js / 3d-force-graph）、galaxy.css（仅 Workflow）。本地固定依赖：3d-force-graph 1.79.0、Three.js 0.180.0，许可证位于 assets/vendor。不依赖运行时 CDN、不迁移存储数据。WebGL 不可用时提供节点导航；减少动态效果设置取消相机动画。保存表单不重建星图，相机位置保留。背景粒子使用固定种子，不持续移动。

## 关联现有数据（2026-09-23）

Workflow 顶部「关联现有数据」读取 risk_policy（含浏览器覆盖和 riskGroups）及 portfolio 快照，预览现有活跃 Thesis。逐项关联，仅写 Workflow 本地存储；按来源名称防止重复导入。原页面无布局或流程修改。

Edge → Hypothesis 论点依据，Invalidation → 证伪条件，Shelf life → 目标日期。多标的分组只保留为 `linkedSymbols` 元数据，不复制或绑定持仓。Risk Budget 打开对应来源 Thesis，但打开动作不更改共享默认值。导入风险参数保留快照；论点不是双向同步，后续人工编辑不会被源数据覆盖。既有归档保留在原页面，尚未导入；不从现有持仓推断方案、收益预测或实际净收益。

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

- Hypothesis has four optional text areas in this order: 市场结果预期假设 (`expectation`), 论点依据 (`rationale`), 验证条件 (`verification`), 证伪条件 (`invalidation`). Each label includes the decision question it answers, and each empty textarea shows a professional semiconductor-trade example as a placeholder. Placeholder text is never persisted as thesis data. There is no direction selector or numeric target field.
- Every node starts `pending` and supports `pending ↔ running`. Both labels are manual progress markers, not approval or completion. Transitions require no reason or domain prerequisites. Edits and account refreshes do not change these labels. Domain calculations, financial-data validation and position-allocation checks remain intact.
- Archiving is a separate Attribution action at the instance level and retains read-only replay/export. Position Management is empty, so archiving has no position-allocation prerequisite. It does not introduce a third node label.
- Legacy data is validated before migration. Current instances gain `stateVersion: 2` and a single migration event; historical snapshots are unchanged. Initial legacy states map to pending and other states to running. Legacy numerical targets become expectation text, prior rationale/invalidation stay intact, and the removed direction remains available in the original snapshot/export. Historical UI presents the simplified fields and labels. Existing archived instances stay archived. Migration is idempotent and persisted with the existing cross-tab write check.
- Validation: `node --test tests/*.test.mjs` and the Workflow progress, risk, position and Attribution browser fixtures.

# Workflow — thesis workspace

Open `workflow.html` via the same local HTTP server as the dashboard. Risk Budget shares the Portfolio risk-control component and account settings. Trading, Research and Strategy remain separate. Position Management is an empty reserved star.

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

## Retired Position Management integration (step two; superseded 2026-09-25)

The integration below is no longer mounted. Current and historical Position Management node data is scrubbed by migration, and Portfolio heatmap assignment is manual. The files remain in the repository only as reference code for a future redesign.

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

- Attribution reads the same `data/pnl.json` used by the dashboard. The user chooses dates and one source window (YTD, 3m, 1m). With Position Management now empty, there are no confirmed account/contract bindings and the preview explicitly reports that it cannot auto-filter rows. Previously saved evidence remains readable. Overlapping windows are never combined; identical realized events inside a window are retained. Option P&L is already dollars and is not multiplied again.
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
