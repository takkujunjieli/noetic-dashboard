# 📈 短线研究台

> **文档导航(3 类)** · 详见 [docs/](docs/)
> 1. [系统构建 · todo/debug](docs/1-系统构建.md) — 架构、构建/运维待办、已知问题
> 2. [交易策略 · 思考](docs/2-交易策略.md) — 操作周期、指标解读、信号验证(pilot)
> 3. [数据与存储](docs/3-数据与存储.md) — 数据源、采集节奏、调用量、文件布局、累积器
>
> 跨类基础:[CONTEXT.md](CONTEXT.md)(领域术语)· [TODO.md](TODO.md)(完整 backlog)

短线研究系统,静态托管零服务器成本。五个分页:

| 分页 | 内容 | 数据源 |
|---|---|---|
| 🏠 主页 | ticker set 切换 + 行情 + EPS + 分析师评级 | Finnhub |
| 📈 个股 | 1/5/15 分钟 K 线(OHLCV) | Alpaca 延迟 SIP(Yahoo 回退) |
| 🎯 期权 | C/P Premium、成交量、OI 及变化、ATM IV、盘中 GEX | Massive(未配置回退雅虎) |
| 📰 新闻 | 财报日历、宏观/市场 RSS、公司新闻 | Finnhub + RSS |
| 💬 社区 | Reddit(按热度)、X/雪球(RSSHub)、YouTube | RSS |

**运行方式**: GitHub Actions 定时/手动抓取 → JSON 存进仓库 → GitHub Pages 托管页面。
盘中采集(K线/期权/GEX)在期权页选好 开始/结束/间隔 一键启动。

**标的范围**: 深度数据(K线/指标/期权链/GEX)覆盖 [config/watchlist.yml](config/watchlist.yml)
里的全部标的,与信息页一致。

**Massive key(可选但推荐)**: 注册 <https://massive.com> 免费拿 key,然后
`gh secret set MASSIVE_API_KEY`。免费版限速 5 次/分钟、K 线为盘后数据;
Stocks Starter($29/月)起为盘中 15 分钟延迟;期权链快照需 Options Starter,
未开通时期权指标自动回退雅虎期权链(免费)。

**Alpaca key(正股 K 线)**: 免费注册后把 key/secret 配置为 GitHub Actions secrets：

```bash
gh secret set ALPACA_API_KEY
gh secret set ALPACA_API_SECRET
```

采集使用延迟 30 分钟的 SIP 全市场数据，每 30 分钟批量更新全部 ticker；请求失败或未配置
凭据时自动回退 Yahoo。脚本也兼容 Alpaca 标准环境变量 `APCA_API_KEY_ID` 和
`APCA_API_SECRET_KEY`。

## 快速开始

### 1. 注册 Finnhub 免费 key

打开 <https://finnhub.io/register> 注册,复制 API key(免费,无需信用卡)。

### 2. 推到 GitHub 并配置

```bash
gh repo create ai-dashboard --private --source . --push
gh secret set FINNHUB_API_KEY   # 粘贴你的 key
```

然后在仓库 **Settings → Pages** 里,Source 选 `Deploy from a branch`,分支选 `main` / `(root)`。

### 3. 手动触发一次验证

仓库 **Actions → 每日更新数据 → Run workflow**,跑完后访问
`https://<你的用户名>.github.io/ai-dashboard/`。

> 私有仓库的 Pages 需要 GitHub Pro;免费账号可以把仓库设为 public,或改用本地运行。

之后 Actions 会在每个交易日盘前(UTC 13:00)和每天盘后(UTC 22:30)自动更新。

## 可选: Reddit 热度排序

Reddit 已封锁匿名 JSON API,想让社区热帖按 **热度(点赞 + 2×评论)** 排序而非时间序,需要免费的 OAuth 凭证(2 分钟):

1. 打开 <https://www.reddit.com/prefs/apps> → **create app** → 类型选 **script**,name/redirect uri 随便填
2. 创建后拿到 client id(app 名字下方的一串字符)和 secret
3. 配置到 GitHub:

```bash
gh secret set REDDIT_CLIENT_ID
gh secret set REDDIT_CLIENT_SECRET
```

不配置也能正常运行:Reddit 源自动回退到 RSS,只是没有热度数据(Reddit 不公开浏览数,所以热度用点赞数代替)。

## 可选: 盘中动态 GEX(期权 Gamma Exposure)

「⚡ GEX」分页显示期权做市商的 gamma 敞口:按行权价的正负分布、净 GEX、gamma flip 点位,
以及当日盘中净 GEX 走势。数据来自雅虎期权链(yfinance,**无需注册任何账号**,约 15 分钟延迟),
gamma 由 IV 用 Black-Scholes 现算。

**配置(一次性,只需一个 PAT 用于页面上的启动按钮):**

创建 fine-grained PAT: GitHub → Settings → Developer settings → Fine-grained tokens → Generate:

- Repository access: **Only select repositories** → 只选本仓库
- Permissions → Repository permissions → **Actions: Read and write**

PAT 粘贴在 GEX 分页的输入框里,只保存在你自己浏览器的 localStorage,不会上传。
(在仓库 Actions 页手动 Run workflow 也可以,不需要 PAT。)

**使用:** 在 GEX 分页选开始/结束时间(本地时区)和间隔(5~60 分钟) → ▶ 启动采集。
workflow 会循环采集到结束时间(超过 Actions 单次 6h 上限会自动续跑);⏹ 停止随时取消;
🔄 刷新数据直接从仓库拉最新快照,不用等 Pages 部署。
关注哪些标的改 [config/options_watchlist.yml](config/options_watchlist.yml)(建议 ≤5 只)。

## 自定义

- **关注的股票**: 编辑 [config/watchlist.yml](config/watchlist.yml)
- **大V / 新闻源**: 编辑 [config/sources.yml](config/sources.yml),里面有 YouTube、Reddit、X(RSSHub)、雪球(RSSHub)的配置示例
  - X/Twitter 官方 API 收费,配置里用 RSSHub 桥接;公共实例 `rsshub.app` 可能限流,重度使用建议[自建 RSSHub](https://docs.rsshub.app/deploy/)(可免费部署在 Vercel)
- **更新时间**: 编辑 [.github/workflows/update.yml](.github/workflows/update.yml) 的 cron

## 本地运行

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export FINNHUB_API_KEY=你的key
python scripts/fetch_market.py   # → data/market.json
python scripts/fetch_feeds.py    # → data/feeds.json

python3 scripts/serve_dashboard.py --port 8642  # 打开 http://localhost:8642
```

本地 Workflow 必须使用上述服务启动。不要使用 `python3 -m http.server` 或直接双击 HTML；纯静态服务不提供 thesis 交易文件的读取、保存和删除 API。

## 目录结构

```
config/          watchlist.yml(股票) + sources.yml(信息源)
scripts/         fetch_market.py(Finnhub) + fetch_feeds.py(RSS)
data/            抓取生成的 JSON(由 Actions 自动提交)
index.html       dashboard 页面(纯静态,无需构建)
assets/          样式和渲染逻辑
```

## Workflow 风险系统：第一阶段

`Expected Return` Star 已改为 thesis 级的 `Scenario Underwriting`。Bull / Base / Bear 共用一张联合情景表；每个情景填写主观概率、各 Underlying Greek Bundle 的价格变化，并可为含期权的 Bundle 填写 IV Change。三种情景的概率必须合计为 100%。

系统用组合 Greeks 估算每个 Bundle 的情景损益：

```text
P&L ≈ Delta × ΔS + 1/2 × Gamma × ΔS² + Vega × ΔIV + Theta × Days Forward
```

结果矩阵同时显示各 Bundle 的 P&L、相对 Reference Capital 的 Return，以及按三种情景概率加权的组合 Expected P&L / Expected Return。含期权的 Bundle 未填写 IV Change 时按 `ΔIV = 0` 计算，并标记为 `Price-only Greek Estimate`。

旧的 Expected Net、Average Loss、Win Rate × Payoff Ratio 输入和图表已从当前界面移除。历史 snapshot 仍保留旧数据的读取兼容性。

`Risk Budget` Star 读取同一张联合情景矩阵，求解多变量 Full Kelly：

```text
maximize Σ pᵢ log(1 + Σ fⱼrᵢⱼ)
subject to fⱼ ≥ 0, Σfⱼ ≤ 1, 1 + Σfⱼrᵢⱼ > 0
```

Full Kelly 的绝对仓位不会直接执行；系统只将正 Kelly 解归一化为 Bundle 之间的相对权重。用户填写 `Thesis At-Risk Limit` 与一个 `ATR Stop Multiple`：ATR Stop Risk 对每个 Bundle 分别计算现价上下一个 ATR 距离中的较差损失，再按 Kelly 权重相加；Scenario Risk 保留用户定义的 Bull / Base / Bear 联合相对走势，在每个联合情景内聚合后取最坏损失。两者较大值决定整个 Nebula 的账户仓位比例。

Workflow 不输入账户 Capital Base，只冻结各 Bundle 的目标账户比例为 `In Action Risk Budget`。Portfolio 选择账户后再将比例换算为目标美元和数量。当前阶段不包含 Tail Risk 或跨 Nebula Risk Governor。

### Uncertainty-aware Kelly 权重

Scenario Underwriting 的 Probability、Price Move 和期权 IV Change 均支持可选的 `±` 不确定区间。存在任一不确定区间时，系统执行 500 次固定种子的均匀采样，将所有采样得到的 Bull / Base / Bear 状态合并为一个联合分布，再求解一次多变量 Kelly。这样得到一组内部一致的 Bundle 相对权重，避免分别取各 Bundle 分位数后拼成一个并不存在的组合。
