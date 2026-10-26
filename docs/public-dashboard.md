# Workflow / Takku 100k 公开版

2026-10-26 最新规则：取消化名和全局省略号。公开页面与本地页面使用相同的 Workflow、Portfolio、风险敞口、P&L、月度收益组件。

## Workflow

公开真实标题、ticker、正文、方案、节点状态及完整节点历史。其他账户的账户记录、成交、P&L、持仓绑定及账户资金快照不公开；通用账户净值字段使用 100k。Monitor / Attribution 仅提供 Takku 的成交与 P&L。

旧版自动填写的腿没有账户 ID。导出器根据合约、方向、数量及每单位成本，与当前券商快照进行精确匹配：只保留唯一可确认属于 Takku 的腿；其他账户或来源不明的自动填写腿予以过滤，并重算其 Reference Capital。历史快照执行相同过滤，不把其他账户的财务记录留在事件里。手工研究方案与文字保留。

公开页面只读，不读取访问者在同域名上的私有 localStorage 或凭据。需要改动时使用本地页面。

## Portfolio

只保留内部账户 `takku-rh-2566`。

每次导出均从该账户实际净值计算 `100000 / 实际净值`，使用同一个比例缩放：

- 持仓与成交数量、市值、美元盈亏、手续费；
- 账户 P&L 的美元指标及每笔盈亏；
- 月度已实现盈亏、历史净值、现金流；
- 已有稳健性曲线中的累计美元盈亏与美元门槛。

每股 / 每张价格与成本、收益率、胜率、Sharpe 等无量纲指标不缩放。保留正负号、杠杆、现金及仓位比例，因此总持仓市值可以大于或小于 100k。净值缺失、为零、非有限值或负数时停止导出，禁止用总持仓市值冒充净值。输出不包含原始账户净值或折算系数。

## 更新与发布

`data/public-dashboard.json` 是唯一公开数据产物。原始 portfolio / P&L / Workflow 文件仍是私有来源，不直接上传。

- 本地 Workflow 保存后自动更新本地公开快照；页面的「更新公开快照」可手动重建。
- 「同步全部」继续保存私有备份，并将经过过滤的公开快照上传到公开仓库。
- 公开页面优先匿名读取公开仓库最新快照，失败时回退 Pages 部署时的快照。
- 每次 `scripts/build_portfolio.py` 重建持仓，也会重新折算公开快照。
- CLI 可运行 `python3 scripts/export_public_dashboard.py`。它使用最新保存的私有 Workflow 文件，或最近一次本地保存所捕获的私有 `public_workflow_source.json`。浏览器未保存的输入不属于已保存版本。

捕获的原始 Workflow 只存私有目录，权限 0600；原有 Workflow 文件不被导出器覆盖。`public_aliases.json` 已停用，保留为私有历史文件。

所有 Pages 流程只上传 `scripts/build_public_site.py` 生成的 `_site`，排除原始账户文件、符号链接、脚本及工作文档。

验证使用文件、纯函数、模块和 HTTP 接口检查，不使用浏览器：

```sh
python3 -m unittest discover -s tests -p test_public_dashboard.py
node --test tests/public-dashboard.test.mjs tests/workflow-sync.test.mjs tests/workflow-ownership.test.mjs tests/workflow-risk-bridge.test.mjs
python3 scripts/build_public_site.py
```
