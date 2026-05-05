# 🧠 BrowseMind

一个智能的 Chrome 浏览行为分析插件，帮助你了解时间都花在哪里了。

![Version](https://img.shields.io/badge/version-1.0.0-blue)
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

```bash
cd backend
pip install -r requirements.txt
python main.py
```

访问 API 文档：http://localhost:8000/docs

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

### 后端
- FastAPI 0.104.1
- SQLAlchemy + SQLite
- Pydantic 数据验证

### 部署
- Ubuntu Server
- Nginx + Gunicorn
- GitHub Actions CI/CD

## 📖 文档

- [项目总结](PROJECT_SUMMARY.md)
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
- ⏳ 第五阶段：AI 分析
- ⏳ 第六阶段：高级功能

## 🎯 下一步计划

- [ ] AI 行为分析
- [ ] 生成优化建议
- [ ] 时间黑洞检测
- [ ] 用户目标设置
- [ ] 数据导出功能

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
