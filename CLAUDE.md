# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指引。

## 常用命令

### Chrome 扩展开发
- 在 `chrome://extensions/` 中将仓库根目录作为“已解压的扩展程序”加载。
- 修改 `popup`、`background`、`manifest` 等扩展文件后，需要在扩展管理页重新加载插件。
- 本地验证弹窗交互时，直接使用扩展弹窗。
- 验证仪表盘时，通过扩展入口打开 `dashboard.html`，或直接作为扩展页面访问。

### 后端开发
```bash
cd backend
pip install -r requirements.txt
python main.py
```

本地启动后，API 文档地址：
- `http://localhost:8000/docs`

### AI 配置
```bash
cd backend
cp .env.example .env
# 然后在 .env 中填写 AI 提供商的密钥
```

### 部署
- 后端通过 GitHub Actions 在 `.github/workflows/deploy.yml` 中部署。
- 工作流仅在 `backend/**` 发生变化时自动触发，也支持手动触发。
- 部署流程会 SSH 到 Ubuntu 服务器，拉取 `main`，确保 `backend/venv` 存在，强制重装 `requirements.txt`，在存在 `systemd` 服务时重启 `browsemind`，最后对 `8000` 端口执行健康检查。

## 高层架构

BrowseMind 由 Chrome 扩展前端和 FastAPI 后端两部分组成。

### 扩展端
- `manifest.json` 定义了 Manifest V3 扩展，使用 service worker 形式的后台脚本，声明 popup UI、storage/history/tab/alarms/notifications 权限，并通过严格 CSP 仅允许本地脚本。
- `background.js` 是数据采集核心。它监听标签切换、标签更新、窗口焦点变化，统计当前标签停留时间，将浏览记录写入 `chrome.storage.local`，安装时导入最近历史记录，并定时调用后端更新目标进度。
- `popup.html` + `popup.js` 是主扩展界面。弹窗从本地存储读取浏览数据，在前端完成分类与聚合，渲染图表，触发同步与 AI 分析，加载目标数据，并展示来自后端的高级分析结果。
- `dashboard.html` + `dashboard.js` 是更大的分析与操作界面。仪表盘仍以本地数据展示为主，同时提供同步、AI 分析、目标管理、导出/清空数据、后端地址配置等操作。
- `dataSync.js` 是前后端通信桥梁。它负责创建或复用 `userId`，把本地记录转换为后端需要的结构，上传浏览数据，拉取服务端分析/统计，并检测后端连通性。
- `dataProcessor.js` 以及 popup/dashboard 使用的分类与统计辅助逻辑，负责在渲染前完成本地数据清洗、分类和聚合。
- `chart.min.js` 为本地内置资源，因为扩展 CSP 不允许从 CDN 加载 Chart.js。

### 后端
- `backend/main.py` 是 FastAPI 入口，暴露上传、记录查询、聚合分析、AI 分析、高级分析、用户目标 CRUD、目标进度更新等接口。
- `backend/database.py` 定义了基于 SQLite 的 SQLAlchemy 模型：
  - `BrowsingRecord`：上传后的浏览事件
  - `AnalysisReport`：保存的 AI 分析结果
  - `UserGoal`：每日目标与通知状态
- `backend/schemas.py` 定义上传、分析、AI、目标相关接口共用的 Pydantic 请求/响应结构。
- `backend/ai_analyzer.py` 负责基于 LLM 的行为总结与建议生成。
- `backend/advanced_analyzer.py` 负责规则型高级分析，如时间黑洞检测和注意力曲线分析。
- 后端数据默认保存在 `backend/browsemind.db`（SQLite）。

## 数据流
- 浏览行为先由 `background.js` 采集并保存到 `chrome.storage.local`。
- popup 与 dashboard 的统计展示主要基于本地存储计算，因此即使不连后端也能完成本地可视化。
- 用户触发同步后，`dataSync.js` 会把标准化后的记录上传到 `/api/upload`。
- AI 分析、高级分析、云端目标进度、提醒等服务端功能依赖当前 `userId` 已同步到后端的数据。

## 项目实现注意事项
- 默认后端地址是 Ubuntu 云服务器 `http://119.29.55.112:8000`，但 popup、dashboard、background 都允许通过 `chrome.storage.local.apiBaseUrl` 覆盖。
- 目标进度更新接口使用 query 参数，不是 JSON body：`/api/goals/{user_id}/update-progress?date=YYYY-MM-DD`。
- 当当前 `userId` 在后端还没有同步数据时，高级分析接口返回 404 是正常情况；前端应将其视为空状态，而不是致命错误。
- 由于使用 Manifest V3 CSP，不要在扩展页面中引入内联事件处理器或 CDN 脚本。
- 如果修改会影响 popup 或 dashboard 的 UI/交互，需要同时验证本地数据路径和已连接后端路径。
