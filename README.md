# 🧠 BrowseMind

一个智能的 Chrome 浏览行为分析插件，帮助你了解时间都花在哪里了。

![Version](https://img.shields.io/badge/version-1.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Chrome](https://img.shields.io/badge/chrome-extension-orange)

## ✨ 功能特性

### 📊 数据采集
- 自动记录浏览历史
- 实时追踪页面停留时间
- 智能过滤系统页面
- 本地安全存储

### 🎯 智能分类
- **📚 学习**：教育、文档、知识类网站
- **💻 编程**：GitHub、LeetCode、技术博客
- **🎮 娱乐**：视频、游戏、音乐平台
- **💬 社交**：社交网络、聊天工具
- **🔧 工具**：搜索、邮件、办公软件

### 📈 数据可视化
- 饼图：分类占比一目了然
- 柱状图：24小时活跃度分布
- 折线图：7天浏览趋势
- 交互式图表切换

### 🤖 AI 智能分析
- 基于 AI 的浏览行为分析
- 个性化问题识别
- 智能优化建议
- 支持 OpenAI 和 DeepSeek
- 历史分析报告存储

### ⏰ 高级分析功能（新）
- **时间黑洞检测**：识别不知不觉浪费大量时间的网站
- **注意力曲线**：分析一天中的专注度变化，识别高效时段
- **用户目标设置**：设定每日浏览目标并追踪进度
- **娱乐时间提醒**：当娱乐时间过长时自动提醒

### ☁️ 云端同步
- 数据上传到云端
- 跨设备数据同步
- 自动备份
- RESTful API 支持

## 🚀 快速开始

### 安装插件

1. 下载或克隆本仓库
```bash
git clone https://github.com/your-username/browsemind.git
```

2. 打开 Chrome 浏览器，访问 `chrome://extensions/`

3. 开启右上角的"开发者模式"

4. 点击"加载已解压的扩展程序"

5. 选择 `BrowseMind` 文件夹

6. 完成！点击工具栏的 🧠 图标开始使用

### 启动后端（可选）

**本地开发：**
```bash
cd backend
pip install -r requirements.txt

# 配置 AI 分析（可选）
cp .env.example .env
# 编辑 .env 文件，填入你的 DeepSeek API Key

python main.py
```

访问 API 文档：http://localhost:8000/docs

**AI 分析配置：**
详见 [AI_SETUP.md](AI_SETUP.md)

## 💡 使用指南

### 📦 安装步骤

#### 1. 安装 Chrome 插件

1. 下载或克隆本仓库
```bash
git clone https://github.com/initialize-ye/BrowseMind.git
```

2. 打开 Chrome 浏览器，访问 `chrome://extensions/`

3. 开启右上角的"开发者模式"

4. 点击"加载已解压的扩展程序"

5. 选择 `BrowseMind` 文件夹

6. 完成！点击工具栏的 🧠 图标开始使用

#### 2. 启动后端服务（可选，用于云端同步和 AI 分析）

**本地开发：**
```bash
cd backend
pip install -r requirements.txt

# 配置 AI 分析（可选）
cp .env.example .env
# 编辑 .env 文件，填入你的 DeepSeek API Key

python main.py
```

访问 API 文档：http://localhost:8000/docs

**AI 分析配置：**
详见 [AI_SETUP.md](AI_SETUP.md)

### 🎮 基础使用

#### 查看浏览统计

1. 点击浏览器工具栏的 🧠 图标
2. 查看今日统计：
   - 访问次数
   - 浏览时长
3. 查看 7 天统计：
   - 总访问次数
   - 独立网站数量

#### 切换可视化图表

点击"📈 可视化分析"下的标签切换：
- **分类占比**：饼图展示各分类时长占比
- **时间分布**：柱状图展示 24 小时活跃度
- **每日趋势**：折线图展示 7 天浏览趋势

#### 查看分类详情

- **今日分类**：查看今天各分类的访问情况
- **7天分类占比**：查看一周内各分类的时长占比和访问次数

### ☁️ 云端同步

#### 首次同步

1. 确保后端服务已启动（本地或远程）
2. 点击"☁️ 同步到云端"按钮
3. 系统会自动生成用户 ID 并上传数据
4. 同步成功后会显示提示信息

#### 自动同步

- 插件会在后台自动记录浏览数据
- 每次点击"同步到云端"会上传最新数据
- 数据保存在云端数据库，支持跨设备访问

### 🤖 AI 智能分析

#### 使用 AI 分析

1. **前置条件**：
   - 后端服务已启动
   - 已配置 AI API Key（DeepSeek 或 OpenAI）
   - 已同步数据到云端

2. **开始分析**：
   - 点击"🤖 AI 分析"按钮
   - 等待 AI 分析（约 5-10 秒）

3. **查看报告**：
   - **📝 行为总结**：AI 概括你的浏览习惯
   - **⚠️ 发现的问题**：识别时间浪费和不良习惯
   - **💡 优化建议**：提供个性化改进方案

#### AI 分析示例

```
📝 行为总结
你在过去7天主要浏览编程和学习类网站，占总时长的65%。
娱乐类网站占比30%，主要集中在晚上8点后。

⚠️ 发现的问题
• 娱乐时间过长，每天平均2.5小时
• 深夜浏览频繁，影响睡眠质量
• 社交网站访问过于分散，影响专注度

💡 优化建议
• 设置娱乐时间限制，每天不超过1.5小时
• 晚上10点后减少屏幕时间
• 使用番茄工作法，集中处理社交消息
```

### ⏰ 高级分析功能

#### 时间黑洞检测

1. 点击"📊 高级分析"按钮
2. 查看"⏰ 时间黑洞"卡片
3. 显示内容：
   - 浪费时间占比
   - 总浪费时间
   - 前 3 个时间黑洞网站及停留时长

**什么是时间黑洞？**
单次访问超过 30 分钟的网站，通常是不知不觉浪费大量时间的地方。

#### 注意力曲线分析

1. 点击"📊 高级分析"按钮
2. 查看"📈 注意力曲线"卡片
3. 显示内容：
   - 专注度分数（0-100）
   - 高效时段数量
   - 个性化建议
   - 24 小时注意力曲线图

**专注度计算方式：**
- 专注度 = 工作/学习类网站占比 × 100 - 娱乐类网站占比 × 50
- 分数越高表示越专注

#### 用户目标设置

1. 在主界面找到"🎯 今日目标"卡片
2. 点击"➕ 添加目标"按钮
3. 选择目标类型：
   - **每日学习时长**：设定学习目标（如 2 小时）
   - **每日娱乐时长限制**：限制娱乐时间（如 1 小时）
   - **每日编程时长**：设定编程目标
   - **每日社交时长限制**：限制社交时间
4. 输入目标时长（分钟）
5. 点击"保存目标"

**目标追踪：**
- 实时显示当前进度
- 进度条可视化
- 状态标签：
  - 🟢 进行中（0-79%）
  - 🟡 即将超标（80-99%）
  - 🟢 已完成（≥100%）

#### 娱乐时间提醒

**自动提醒：**
- 系统每 5 分钟自动检查目标进度
- 当达到目标时，弹出通知：
  - 🎉 **目标达成**：完成学习/编程目标
  - ⚠️ **时间提醒**：娱乐时间达到 80% 或超标

**通知示例：**
```
🎉 目标达成
恭喜！你已完成今日 learning 目标

⚠️ 时间提醒
注意！entertainment 时间已达 85%
```

**管理目标：**
- 点击目标卡片右上角的 × 删除目标
- 目标每日自动重置
- 可同时设置多个目标

### 🔄 数据刷新

点击"🔄 刷新数据"按钮可以：
- 重新加载本地数据
- 更新统计信息
- 刷新图表显示
- 更新目标进度

### 📊 数据说明

#### 数据存储
- **本地存储**：Chrome Storage API，保存最近 7 天数据
- **云端存储**：SQLite 数据库，永久保存
- **数据隐私**：所有数据仅存储在你的设备和服务器上

#### 数据采集规则
- 自动记录所有网页访问
- 忽略 chrome:// 系统页面
- 忽略停留时间少于 3 秒的访问
- 每小时自动清理 7 天前的本地数据

#### 分类规则
基于域名和关键词自动分类：
- **学习**：wikipedia.org, coursera.org, 教育类网站
- **编程**：github.com, stackoverflow.com, 技术博客
- **娱乐**：youtube.com, bilibili.com, 视频/游戏平台
- **社交**：twitter.com, weibo.com, 社交网络
- **工具**：google.com, gmail.com, 搜索/办公工具
- **其他**：未匹配的网站

## 📸 截图

### 主界面
- 今日统计
- 分类占比
- 可视化图表
- 最近访问

### 图表展示
- 饼图：分类时长占比
- 柱状图：时间分布
- 折线图：每日趋势

## 🛠️ 技术栈

### 前端
- HTML5 + CSS3 + JavaScript
- Chart.js 4.4.0
- Chrome Extension APIs
  - chrome.storage
  - chrome.tabs
  - chrome.history
  - chrome.alarms
  - chrome.notifications

### 后端
- FastAPI 0.104.1
- SQLAlchemy + SQLite
- Pydantic 数据验证
- OpenAI API / DeepSeek API（AI 分析）

### 部署
- Ubuntu Server
- Nginx + Gunicorn
- GitHub Actions CI/CD

## ❓ 常见问题

### Q1: 插件无法加载？
**A:** 确保：
1. Chrome 版本 ≥ 88
2. 已开启"开发者模式"
3. 选择的是正确的文件夹（包含 manifest.json）

### Q2: 数据不显示？
**A:** 可能原因：
1. 刚安装插件，还没有浏览数据
2. 浏览时间太短（<3秒）被过滤
3. 访问的是系统页面（chrome://）

**解决方法：**
- 正常浏览几个网页后刷新插件
- 点击"🔄 刷新数据"按钮

### Q3: 同步失败？
**A:** 检查：
1. 后端服务是否启动（http://localhost:8000）
2. 网络连接是否正常
3. 查看浏览器控制台错误信息

**解决方法：**
```bash
# 检查后端服务
curl http://localhost:8000

# 重启后端
cd backend
python main.py
```

### Q4: AI 分析失败？
**A:** 可能原因：
1. 未配置 AI API Key
2. API Key 无效或余额不足
3. 网络连接问题

**解决方法：**
1. 检查 `.env` 文件配置
2. 验证 API Key 是否有效
3. 查看后端日志：`tail -f backend/logs/app.log`

### Q5: 通知不显示？
**A:** 确保：
1. Chrome 通知权限已开启
2. 系统通知未被禁用
3. 已设置目标并同步数据

**检查通知权限：**
- Chrome 设置 → 隐私和安全 → 网站设置 → 通知

### Q6: 目标进度不更新？
**A:** 可能原因：
1. 未同步数据到云端
2. 后端服务未启动
3. 目标日期不是今天

**解决方法：**
1. 点击"☁️ 同步到云端"
2. 确保后端服务运行中
3. 删除旧目标，创建新目标

### Q7: 时间统计不准确？
**A:** 说明：
- 插件只能追踪标签页激活时的时间
- 切换到其他应用时不会计时
- 浏览器最小化时不会计时
- 这是 Chrome Extension 的限制

### Q8: 如何清除数据？
**A:** 
```javascript
// 在浏览器控制台执行
chrome.storage.local.clear()
```

或者：
- Chrome 设置 → 扩展程序 → BrowseMind → 删除扩展数据

## 🐛 故障排除

### 插件崩溃
1. 打开 `chrome://extensions/`
2. 找到 BrowseMind，点击"错误"查看日志
3. 点击"重新加载"重启插件

### 后端服务无法启动
```bash
# 检查端口占用
lsof -i :8000

# 杀死占用进程
kill -9 <PID>

# 重新启动
python main.py
```

### 数据库错误
```bash
# 删除数据库重新初始化
rm backend/browsemind.db
python backend/main.py
```

### GitHub Actions 部署失败
1. 检查 GitHub Secrets 配置
2. 查看 Actions 日志
3. 确保服务器 SSH 连接正常

## 📝 开发指南

### 本地开发

1. **前端开发**
```bash
# 修改代码后
# 1. 打开 chrome://extensions/
# 2. 点击 BrowseMind 的"重新加载"按钮
# 3. 刷新插件弹窗测试
```

2. **后端开发**
```bash
cd backend

# 安装依赖
pip install -r requirements.txt

# 启动开发服务器（自动重载）
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 访问 API 文档
open http://localhost:8000/docs
```

3. **测试 AI 功能**
```bash
cd backend
python test_ai_analysis.py
```

### 调试技巧

1. **查看插件日志**
```javascript
// background.js 日志
chrome://extensions/ → BrowseMind → 背景页 → 控制台

// popup.js 日志
右键插件图标 → 检查弹出内容 → 控制台
```

2. **查看存储数据**
```javascript
// 在控制台执行
chrome.storage.local.get(null, (data) => console.log(data))
```

3. **手动触发同步**
```javascript
// 在 popup 控制台执行
syncToCloud()
```

### 代码结构

```
BrowseMind/
├── manifest.json          # 插件配置
├── background.js          # 后台服务（数据采集）
├── popup.html            # 弹窗界面
├── popup.js              # 弹窗逻辑
├── dataProcessor.js      # 数据处理
├── dataSync.js           # 云端同步
├── icons/                # 图标资源
└── backend/              # 后端服务
    ├── main.py           # FastAPI 主应用
    ├── database.py       # 数据库模型
    ├── schemas.py        # 数据验证
    ├── ai_analyzer.py    # AI 分析
    ├── advanced_analyzer.py  # 高级分析
    └── requirements.txt  # Python 依赖
```

## 📖 文档

- [项目总结](PROJECT_SUMMARY.md)
- [AI 配置指南](AI_SETUP.md)
- [部署指南](DEPLOY_QUICK.md)
- [GitHub Actions](GITHUB_ACTIONS_QUICK.md)
- [后端 API](backend/README.md)

## 🌐 云端部署

### 一键部署到服务器

```bash
cd backend
sudo bash deploy.sh
```

### 使用 GitHub Actions 自动部署

1. 配置 GitHub Secrets
2. 推送代码到 main 分支
3. 自动部署到服务器

详见：[GitHub Actions 快速指南](GITHUB_ACTIONS_QUICK.md)

## 📊 项目进度

- ✅ 第一阶段：插件基础架构
- ✅ 第二阶段：数据处理和分类
- ✅ 第三阶段：图表可视化
- ✅ 第四阶段：后端服务 + 云端部署
- ✅ 第五阶段：AI 智能分析
- ✅ 第六阶段：高级功能
  - ✅ Phase 6.1：时间黑洞检测 + 注意力曲线
  - ✅ Phase 6.2：用户目标设置 + 娱乐时间提醒
  - ⏳ Phase 6.3：数据导出 + 同步增强

## 🎯 功能清单

### 已完成功能
- [x] 自动记录浏览历史
- [x] 实时追踪停留时间
- [x] 智能网站分类
- [x] 数据可视化（饼图/柱状图/折线图）
- [x] 云端数据同步
- [x] AI 行为分析
- [x] 生成优化建议
- [x] 时间黑洞检测
- [x] 注意力曲线分析
- [x] 用户目标设置
- [x] 娱乐时间提醒
- [x] Chrome 通知集成

### 计划中功能
- [ ] 数据导出（CSV/JSON/PDF）
- [ ] 自动同步增强
- [ ] 目标模板系统
- [ ] 周报/月报生成
- [ ] 多语言支持

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 👨‍💻 作者

开发者：cy

## 🙏 致谢

- Chrome Extension APIs
- FastAPI 框架
- Chart.js 图表库

---

**如果这个项目对你有帮助，请给个 ⭐️ Star！**
