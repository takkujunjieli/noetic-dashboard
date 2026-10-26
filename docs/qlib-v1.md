# Qlib 量化研究入口

## 历史动量与波动（不做预测）

确定股票池后，可展开「动量与波动 · 过去60 / 20 / 5个交易日」，查看全部筛选股票的实际区间涨跌幅和年化已实现波动率，并按任一指标升降序排序。动量为 `close(t)/close(t-n)-1`；波动率为过去 n 个日简单收益的样本标准差（ddof=1）乘 `sqrt(252)`。使用拆股调整价格、不含分红。

保存配置后点击独立的「更新行情」。它调用 `POST /api/qlib/observations/refresh`，只运行相邻研究仓库的 `run_market_observations.py`，不训练模型、不预测、不创建或追加预测账本。数据写入 `data/market_observations.json`，行情缓存独立存放于 `factor-research/data/market-observations/`。修改股票池后旧快照会提示需更新。

本轮预览为 `http://127.0.0.1:8644/strategy.html`，保留原有服务。下文研究流程仍用于用户明确点击「刷新研究」时的预测分析。

页面：`strategy.html`，导航名称为 Qlib；旧 `qlib.html` 地址自动跳转到此页。数据：`data/qlib_research.json`，仅公开行情与模型研究结果，不含账户持仓。

新增可保存的股票池编辑器：29个研究分类（细分行业和主题）、手动Include/Exclude、基础池开关、当前股价/市值/平均成交额门槛。只显示筛选后的名单；历史IC/ICIR基于当前名单。配置API：`GET /api/qlib/universe` 与同源JSON `PUT /api/qlib/universe`，带revision防止过期页面覆盖配置。保存后再刷新研究。当前默认Include含PURR；分类目录不是全市场完整成分库。

本页仅负责选股 / 择时信号与 IC / ICIR。组合方式由现有 Kelly / Risk Allocation 负责，不生成 Top-K 组合、目标权重或净值。选股采用每日横截面 IC；择时采用单票63日窗口 IC；ICIR 均为均值 / 样本标准差，不年化。未来收益标签重叠，ICIR 不是显著性检验。

研究代码位于相邻的 `factor-research/`，完整运行说明见该仓库 `docs/qlib-v1.md`。默认命令：

```bash
cd ../factor-research
.venv-qlib/bin/python run_qlib.py --fetch yahoo
```

有 Alpaca 凭据时用 `--fetch alpaca`。本地工作台服务重启后，页面「刷新研究」可后台执行同样流程。有凭据选 Alpaca，无凭据选 Yahoo；无混合数据回退。刷新日志保存在研究目录 `data/qlib-v1/refresh.log`。

API 仅在既有 loopback 服务中开放：`GET /api/qlib/status` 与 `POST /api/qlib/refresh`。POST 必须使用同源 JSON `{}`，不接受命令、路径、凭据或股票列表。公开静态页面只显示结果，不显示刷新按钮。

历史数据、实验与 SQLite 完整预测账本保存在 `factor-research/data/qlib-v1/`，不发布。Dashboard 导出只包含近期记录及累计汇总，不能替代账本备份。本版未开启定时任务、未连接实盘执行、未将分数接入 Kelly。
