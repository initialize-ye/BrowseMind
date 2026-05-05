# AI 分析功能配置指南

## 概述

BrowseMind 的 AI 分析功能支持两种 AI 服务提供商：
- **OpenAI** (GPT-4, GPT-3.5-turbo)
- **DeepSeek** (deepseek-chat)

## 配置步骤

### 1. 获取 API 密钥

#### OpenAI
1. 访问 [OpenAI Platform](https://platform.openai.com/)
2. 注册/登录账号
3. 进入 API Keys 页面
4. 创建新的 API Key
5. 复制密钥（格式：`sk-...`）

#### DeepSeek（推荐，性价比高）
1. 访问 [DeepSeek 开放平台](https://platform.deepseek.com/)
2. 注册/登录账号
3. 进入 API Keys 管理
4. 创建新的 API Key
5. 复制密钥

### 2. 配置环境变量

#### 本地开发环境

**Windows (PowerShell):**
```powershell
$env:AI_API_KEY="your-api-key-here"
$env:AI_PROVIDER="deepseek"  # 或 "openai"
```

**Windows (CMD):**
```cmd
set AI_API_KEY=your-api-key-here
set AI_PROVIDER=deepseek
```

**Linux/Mac:**
```bash
export AI_API_KEY="your-api-key-here"
export AI_PROVIDER="deepseek"  # 或 "openai"
```

#### Ubuntu 服务器（生产环境）

**方法 1: 在 Systemd 服务中配置**

编辑服务文件：
```bash
sudo nano /etc/systemd/system/browsemind.service
```

在 `[Service]` 部分添加：
```ini
[Service]
Environment="AI_API_KEY=your-api-key-here"
Environment="AI_PROVIDER=deepseek"
```

重启服务：
```bash
sudo systemctl daemon-reload
sudo systemctl restart browsemind
```

**方法 2: 使用 .env 文件（推荐）**

1. 在后端目录创建 `.env` 文件：
```bash
cd /var/www/browsemind/backend
sudo nano .env
```

2. 添加配置：
```env
AI_API_KEY=your-api-key-here
AI_PROVIDER=deepseek
```

3. 安装 python-dotenv：
```bash
pip install python-dotenv
```

4. 修改 `backend/main.py`，在文件开头添加：
```python
from dotenv import load_dotenv
load_dotenv()
```

5. 重启服务：
```bash
sudo systemctl restart browsemind
```

### 3. 验证配置

#### 检查环境变量
```bash
# Linux/Mac
echo $AI_API_KEY
echo $AI_PROVIDER

# Windows PowerShell
echo $env:AI_API_KEY
echo $env:AI_PROVIDER
```

#### 测试 API 连接

启动后端服务：
```bash
cd backend
python main.py
```

在浏览器插件中点击 "🤖 AI 分析" 按钮，如果配置正确，应该能看到 AI 生成的分析报告。

## 费用说明

### OpenAI 定价（参考）
- GPT-4: $0.03/1K tokens (输入), $0.06/1K tokens (输出)
- GPT-3.5-turbo: $0.0015/1K tokens (输入), $0.002/1K tokens (输出)

### DeepSeek 定价（更便宜）
- DeepSeek-Chat: ¥0.001/1K tokens (输入), ¥0.002/1K tokens (输出)
- 约为 OpenAI 的 1/10 价格

**预估成本：**
- 每次 AI 分析约消耗 500-1000 tokens
- 使用 DeepSeek：每次分析约 ¥0.001-0.003（不到 1 分钱）
- 使用 OpenAI GPT-3.5：每次分析约 $0.001-0.002

## 故障排查

### 错误：AI API 密钥未配置
**原因：** 环境变量 `AI_API_KEY` 未设置

**解决：** 按照上述步骤配置环境变量并重启服务

### 错误：AI 分析失败
**可能原因：**
1. API 密钥无效或过期
2. 网络连接问题（服务器无法访问 AI API）
3. API 配额用尽

**解决方案：**
1. 检查 API 密钥是否正确
2. 测试网络连接：`curl https://api.deepseek.com` 或 `curl https://api.openai.com`
3. 检查 API 账户余额和配额

### 错误：连接超时
**原因：** 服务器网络限制或防火墙阻止

**解决：**
```bash
# 测试 DeepSeek API 连接
curl -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer $AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"test"}]}'

# 测试 OpenAI API 连接
curl -X POST https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"test"}]}'
```

## 安全建议

1. **不要将 API 密钥提交到 Git 仓库**
   - 将 `.env` 添加到 `.gitignore`
   - 使用环境变量或密钥管理服务

2. **定期轮换 API 密钥**
   - 建议每 3-6 个月更换一次

3. **设置 API 使用限额**
   - 在 AI 服务商后台设置每月消费上限
   - 避免意外产生高额费用

4. **监控 API 使用情况**
   - 定期检查 API 调用次数和费用
   - 设置异常告警

## 降级策略

如果 AI API 不可用，系统会自动使用基于规则的分析作为降级方案：
- 根据浏览时长和分类占比生成基础分析
- 提供通用的优化建议
- 不影响插件其他功能的正常使用

## 支持

如有问题，请查看：
- [OpenAI API 文档](https://platform.openai.com/docs)
- [DeepSeek API 文档](https://platform.deepseek.com/docs)
- [项目 GitHub Issues](https://github.com/initialize-ye/BrowseMind/issues)
