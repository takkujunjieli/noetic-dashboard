# Dashboard 说明文字档案

将原本拟移入 tooltip / 折叠说明的内容集中保存在此文档；页面不新增 tooltip。仅调整说明文字，不修改计算规则。动态时间、错误、数据缺失与样本不足提示继续保留。

## Portfolio

### P2 · Portfolio Robustness

Local · Trade-history reconstruction (equities only) · Cumulative P&L (including unrealized) · Beta/Alpha vs SPY

### P3 · Position Sizing Calculator

Net Liquidation Value × Risk per Trade ÷ (Entry Price − Stop Price)

### P6 · Exit Labels

Exit 可选空白、Expected-return-based、Target-based、trailing-based；按 underlying ticker 保存到本机 portfolioExitRules，不带账户 ID。同一标的在不同账户与 ALL 视图共用选择，切换账户、排序和刷新不会清除；标签仅记录退出标准，不改变风险或目标仓位计算。同步备份包含标签，公开快照仅保留 Takku 持仓标的的有效标签。

热力图列名使用完整单词：Shares、Cost Basis、Take Profit、Stop Loss、Position %、Profit / Loss %、Stop Loss %、Take Profit %、Bear Risk %、Shares to Target。

### P6 · Bear Risk 与持仓表口径

Bear Risk = current position market value × max(0, −frozen Bear return). Nebula Actual Risk sums the visible rows; equity positions of ±1 share or less are omitted. Manual stops override frozen stops. Equity take-profit prices use the frozen In Action Reference Spot and Bull Price Move. Shares to Target uses Account Target and current prices; unavailable risk data leaves it blank.

### P6 · 账户风险汇总口径

Actual Risk sums the Bear Risk shown below. Account Risk Used = Nebula Actual Risk + risk reserved for other positions. Target Risk uses the greater of frozen Stop Risk and Scenario Risk. Other equities reserve risk using manual stops or 2.5 ATR; other options without a risk model block target checks. These estimates are not maximum-loss guarantees. Individual accounts and ALL are alternative views.

### P7 · 正股仓位计算器

Manual sizing for long equity positions. This does not change the selected Thesis risk parameters. Net Liquidation Value is saved to shared risk settings. Manage options and multi-leg structures in Workflow.

### P8 · Monthly Returns

Realized P&L: broker-reported. P&L: change in month-end Net Liq minus net cash flows. P&L % assumes beginning-of-month cash flows: (closing − opening − flows) / (opening + flows). Log P&L = ln(1 + P&L %).

## Trading

### T4 · Collection 自动采集说明

(auto rolling collection on trading days ET 9:30-16:00; manual trigger here)

### T6 · 行情来源

Candles/indicators: Alpaca delayed SIP (Yahoo fallback) · Options/GEX: paused while Massive is unavailable collected snapshot — personal research only

### T5 · Options Premium

Premium = activity (not buy/sell) — read direction with OI change + Real(sampled) GEX.

## Research

### 采样验证

每日轮一票额外跑全量,对比 全量 / naive / 精确 —— 看采样是否可信

### 国债 vs 股市

左轴:SPY/QQQ/IWM 归一100 · 右轴(虚线):US 10/30Y 收益率% · 点击图例开关曲线

### 收益率 × 股市 · 当日相关性

(只算 |Δ收益率|≥阈值 的交易日;负相关=收益率↑股市↓=压制)

### 期权流 → 方向

逐票期权变量的横截面 rank-IC · entry_lag=1 无前视 · 用秩不拟合

### IC 表

预测变量 × horizon(1/5/21 交易日)· 绿正红负 · ★=block-bootstrap CI 不含 0

### net_flow 分 dealer gamma 状态

空γ 追涨→动量 / 多γ 抑制;两组差异=免费聚合数据给不了的信号

### 扣成本 L/S 五档回测

net_flow · H=1 日频全换手 · 展示「可预测≠可盈利」

### 仓位情报

免费版 JPM Positioning Intelligence · 各 cohort 分位 + 潜在买卖盘(COT/CTA/散户)

### 各 cohort 定位(z 分数,周频)

点击图例开关曲线

### 潜在买卖盘

COT 拥挤度$(回中位)

### CTA 定位(DBMF 复制器)

趋势跟随者每日披露的真实多空持仓

### MACD return

Trading Desk 全部 ticker · 日线收盘价 · MACD(12,26,9)

### Five-Factor Equity Return Decomposition

Trading Desk 全部 ticker · SEC TTM fundamentals · split-adjusted price

### R2 · Regime 周快照

每个周五对应一份周快照。选择未保存的周五可从默认值 5 开始回填；已保存的周只读，需直接修改 snapshot 数据才能更正。

### R3 · 国债与股市

研究国债收益率对股市的影响:利率(10/30Y)上行区间,成长(QQQ)相对小盘(IWM)/大盘(SPY)的相对表现。点击图例开关任意曲线;鼠标悬停显示该日所有已展示曲线的值。数据 FRED + Yahoo,近 5 年。

### R6 · MACD return

页面展示上次同步后保存的快照，打开页面或切换区间不会重新计算；只有点击「同步所有 tickers」才读取当时的 Trading Desk 清单与行情，重算四个区间并更新计算日期。Histogram slope：柱体一阶差分由负转正买入、由正转负卖出；zero-line：MACD 主线上穿零轴买入、下穿卖出；crossover：主线上穿 signal 买入、下穿卖出。仅统计所选区间内完整闭合的做多交易对，信号日收盘成交；Total return 为逐笔简单收益之和，不复利、不年化，未计成本与滑点。

### R7 · Five-Factor 数据与解释

财务原始值来自 [SEC Company Facts](https://data.sec.gov/api/xbrl/companyfacts/)； 价格为 Yahoo Finance 拆股调整收盘价的静态快照。每格粗体为因子比例，下方为“之前 TTM → 最新 TTM”原始值。 负营业利润或负净利润仍保留代数结果并标注 ⚠，但不应按常规扩张或估值倍数解释。ETF 与历史不足的标的保留在表内并说明原因。

## Qlib

### 股票池分类

勾选分类可扩展名单，取消基础名单可收窄到所选方向。下列为可扩展的研究分类目录，不是全市场行业成分数据库。

### 筛选门槛与 Include / Exclude

门槛统一使用当前快照；历史 IC / ICIR 基于当前筛出的名单。Include 仍需满足门槛，Exclude 优先。

### 历史动量与波动率

仅展示实际历史表现。动量为区间涨跌幅；波动率为区间内日收益的样本标准差 × √252（年化）。使用拆股调整价格，不含分红。更新本板块不训练模型，也不生成预测。

### 横截面 IC / ICIR

每天在合格股票间计算预测分数与未来价格收益的相关性。IC 为 Pearson，Rank IC 为 Spearman；ICIR = IC 序列均值 ÷ 样本标准差（ddof=1），不年化。标签区间为 t+1 开盘至 t+h 收盘，仅用于定义预测目标。

### 每日候选排名

按预测分数排序，默认仅预览前10行；全部合格股票均记录。排序与列表截断不代表持仓选择或权重。组合构建由现有 Kelly / Risk Allocation 负责。

### 单票择时 IC / ICIR

对每只股票，在互不重叠的63个信号交易日窗口内计算 IC（至少20个有效观测），再跨窗口计算 ICIR。这里评估同票跨时间的预测力；尚未定义机械入场或退出规则。

### 前向记录与模型版本

历史样本外预测不回填为前向记录；同一股票池、信号日只用参考区间开始前登记的最新模型版本评分，保留所有旧版审计记录。未来收益重叠，ICIR 只描述稳定性，不是显著性检验。

## Portfolio 补充口径

### 风险目标与数量

Targets use the frozen In Action budget. Share quantities are estimates; option quantities are not rounded automatically.

### Robustness 与 Long / Short Attribution

Long / Short Attribution: Annualized return [95% CI] · Beta · n. Short-leg Beta should be negative; wide CIs indicate imprecision.

Returns/Beta/Alpha/Sharpe use daily P&L / prior-day Net Liq (excluding margin/buying power). Chart: cumulative M2M dollar P&L, including unrealized P&L; equities only; excludes options/dividends; rebased to zero. An Alpha 95% CI spanning zero (≈0) does not establish stock-picking skill; Net / Gross ≈ 1 indicates net-long exposure. Wide CIs from small samples indicate limited evidence.
