# Portfolio / Workflow 公开快照

公开站使用 `data/public-dashboard.json`，本地真实数据仍在原私有文件与浏览器存储中。

公开内容：以元素符号（如 Fe、Ne、Si）作稳定的标的化名，以真实星云名称作 Thesis 化名，另有匿名账户、持仓工具与方向、Nebula / Bundle 结构、节点状态、历史节点状态。
原始标题、正文、来源 URL、原始 ID、成交明细及时间、完整历史快照不导出。数量、价格、成本、市值、持仓比例、Greeks、盈亏、收益率、风险金额、情景收益及账户 P&L 全部设为 null，由页面显示 `…`。

化名对照表只保存在相邻私有目录 `stock-dashboard-private/public_aliases.json`，权限 0600。禁止复制到公开库或部署产物。不要删除该文件，否则化名会重新生成。

## 更新

本地页面的「更新公开快照」使用当前浏览器 Workflow 和本地 Portfolio，调用仅绑定 loopback、校验同源的本地接口生成文件，不改写真实 Workflow。
若使用私有库中已保存的 Workflow，可执行：

```sh
python3 scripts/export_public_dashboard.py
```

这个命令不读取浏览器尚未同步的修改；有本地修改时应使用页面按钮。

通过「预览公开版」核对后，只将匿名快照及相关代码提交到公开仓库，按原 Pages 流程部署。任何刷新都不应提交真实源文件或化名映射。

## 部署与验证

所有 Pages workflows 都调用 `scripts/build_public_site.py`，只上传 `_site`。该目录排除私有数据、符号链接、脚本和工作文档；快照必须通过严格 schema / null 财务值校验，其他 JSON 若包含账户、持仓或成交结构则停止构建。
构建产物在 HTML 中强制公开模式。在 localhost 查看部署产物也不会进入私有视图。公开模式不读取原有 localStorage、不请求券商或私有库；本地开发可用 `?view=public` 预览。

```sh
python3 -m unittest discover -s tests -p test_public_dashboard.py
node --test tests/public-dashboard.test.mjs
python3 scripts/build_public_site.py
```

清除当前文档中的账号不等于改写 Git 历史；本次不进行历史重写。
