# GitHub Actions 自动部署指南

使用 GitHub Actions 实现代码推送后自动部署到 Ubuntu 服务器。

## 配置步骤

### 1. 在服务器上初始化 Git 仓库

```bash
# SSH 连接到服务器
ssh root@your_server_ip

# 创建项目目录
sudo mkdir -p /var/www/browsemind
cd /var/www/browsemind

# 初始化 Git 仓库
git init
git remote add origin https://github.com/your-username/browsemind.git

# 拉取代码
git pull origin main

# 首次部署（运行部署脚本）
cd backend
chmod +x deploy.sh
sudo bash deploy.sh
```

### 2. 生成 SSH 密钥对

在**本地电脑**执行：

```bash
# 生成新的 SSH 密钥对（不要覆盖现有的）
ssh-keygen -t rsa -b 4096 -C "github-actions" -f ~/.ssh/github_actions_key

# 查看私钥（稍后添加到 GitHub Secrets）
cat ~/.ssh/github_actions_key

# 查看公钥（稍后添加到服务器）
cat ~/.ssh/github_actions_key.pub
```

### 3. 将公钥添加到服务器

```bash
# SSH 连接到服务器
ssh root@your_server_ip

# 添加公钥到 authorized_keys
echo "your_public_key_content" >> ~/.ssh/authorized_keys

# 设置权限
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh
```

### 4. 配置 GitHub Secrets

在 GitHub 仓库页面：

1. 点击 **Settings** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**
3. 添加以下 Secrets：

| Name | Value | 说明 |
|------|-------|------|
| `SERVER_HOST` | `123.45.67.89` | 服务器 IP 地址 |
| `SERVER_USER` | `root` | SSH 用户名 |
| `SSH_PRIVATE_KEY` | `-----BEGIN RSA PRIVATE KEY-----...` | SSH 私钥（完整内容） |
| `SERVER_PORT` | `22` | SSH 端口（可选，默认 22） |

**添加 SSH_PRIVATE_KEY 的注意事项**：
- 复制完整的私钥内容，包括 `-----BEGIN RSA PRIVATE KEY-----` 和 `-----END RSA PRIVATE KEY-----`
- 保持原有的换行格式
- 不要添加额外的空格或字符

### 5. 推送代码到 GitHub

```bash
# 在本地项目目录
cd D:\cy\Desktop\Code\BrowseMind

# 初始化 Git（如果还没有）
git init

# 添加远程仓库
git remote add origin https://github.com/your-username/browsemind.git

# 添加所有文件
git add .

# 提交
git commit -m "Initial commit with GitHub Actions"

# 推送到 main 分支
git push -u origin main
```

### 6. 触发部署

**自动触发**：
- 推送代码到 `main` 分支
- 修改 `backend/` 目录下的文件

**手动触发**：
1. 进入 GitHub 仓库
2. 点击 **Actions** 标签
3. 选择 **Deploy to Ubuntu Server** workflow
4. 点击 **Run workflow**

### 7. 查看部署状态

1. 进入 GitHub 仓库的 **Actions** 标签
2. 查看最新的 workflow 运行
3. 点击查看详细日志

## Workflow 说明

### 触发条件

```yaml
on:
  push:
    branches:
      - main              # 推送到 main 分支
    paths:
      - 'backend/**'      # 只有 backend 目录变化
  workflow_dispatch:      # 允许手动触发
```

### 部署流程

1. **Checkout code** - 检出代码
2. **Deploy to Server** - SSH 连接服务器并执行部署
   - 备份当前版本
   - 拉取最新代码
   - 更新依赖
   - 重启服务
3. **Health Check** - 健康检查
4. **Notify** - 通知部署结果

### 自动备份

每次部署前会自动备份：
```bash
backend_backup_20260505_143022/
```

## 高级配置

### 1. 添加通知（可选）

**Slack 通知**：

```yaml
- name: Notify Slack
  if: always()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: 'BrowseMind 部署 ${{ job.status }}'
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

**邮件通知**：

```yaml
- name: Send Email
  if: failure()
  uses: dawidd6/action-send-mail@v3
  with:
    server_address: smtp.gmail.com
    server_port: 465
    username: ${{ secrets.EMAIL_USERNAME }}
    password: ${{ secrets.EMAIL_PASSWORD }}
    subject: BrowseMind 部署失败
    to: your-email@example.com
    from: GitHub Actions
    body: 部署失败，请检查日志
```

### 2. 多环境部署

创建 `.github/workflows/deploy-staging.yml`：

```yaml
name: Deploy to Staging

on:
  push:
    branches:
      - develop

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - name: Deploy to Staging Server
      uses: appleboy/ssh-action@master
      with:
        host: ${{ secrets.STAGING_SERVER_HOST }}
        username: ${{ secrets.STAGING_SERVER_USER }}
        key: ${{ secrets.SSH_PRIVATE_KEY }}
        script: |
          cd /var/www/browsemind-staging
          git pull origin develop
          cd backend
          source venv/bin/activate
          pip install -r requirements.txt
          sudo systemctl restart browsemind-staging
```

### 3. 数据库迁移

在部署脚本中添加：

```yaml
script: |
  cd /var/www/browsemind/backend
  source venv/bin/activate
  
  # 备份数据库
  cp browsemind.db browsemind_backup_$(date +%Y%m%d).db
  
  # 运行迁移（如果有）
  # alembic upgrade head
  
  pip install -r requirements.txt
  sudo systemctl restart browsemind
```

### 4. 回滚功能

创建 `.github/workflows/rollback.yml`：

```yaml
name: Rollback

on:
  workflow_dispatch:
    inputs:
      backup_name:
        description: '备份目录名称'
        required: true

jobs:
  rollback:
    runs-on: ubuntu-latest
    steps:
    - name: Rollback to Previous Version
      uses: appleboy/ssh-action@master
      with:
        host: ${{ secrets.SERVER_HOST }}
        username: ${{ secrets.SERVER_USER }}
        key: ${{ secrets.SSH_PRIVATE_KEY }}
        script: |
          cd /var/www/browsemind
          
          # 停止服务
          sudo systemctl stop browsemind
          
          # 恢复备份
          rm -rf backend
          cp -r ${{ github.event.inputs.backup_name }} backend
          
          # 启动服务
          sudo systemctl start browsemind
          
          echo "✅ 回滚完成"
```

## 故障排查

### SSH 连接失败

```bash
# 在服务器上检查 SSH 配置
sudo nano /etc/ssh/sshd_config

# 确保以下配置启用
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

# 重启 SSH 服务
sudo systemctl restart sshd
```

### 权限问题

```bash
# 确保 GitHub Actions 用户有权限
sudo usermod -aG sudo github-actions-user

# 或者配置 sudoers
sudo visudo

# 添加
github-actions-user ALL=(ALL) NOPASSWD: /bin/systemctl restart browsemind
```

### Git 拉取失败

```bash
# 在服务器上配置 Git 凭据
cd /var/www/browsemind

# 使用 Personal Access Token
git remote set-url origin https://username:token@github.com/username/browsemind.git

# 或使用 SSH
git remote set-url origin git@github.com:username/browsemind.git
```

## 安全建议

1. **使用专用的部署密钥**，不要使用个人 SSH 密钥
2. **限制 SSH 密钥权限**，只允许访问特定目录
3. **定期轮换密钥**
4. **使用 GitHub Environments** 添加审批流程
5. **不要在日志中输出敏感信息**

## 监控和日志

### 查看部署日志

```bash
# 在服务器上查看服务日志
sudo journalctl -u browsemind -f

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/access.log
```

### 设置告警

使用 GitHub Actions 的 status checks 配置告警。

## 成本

- **GitHub Actions**: 免费（公开仓库无限制，私有仓库每月 2000 分钟）
- **服务器**: 约 ¥60-100/月

## 完整工作流程

```
开发者推送代码
    ↓
GitHub Actions 触发
    ↓
SSH 连接到服务器
    ↓
备份当前版本
    ↓
拉取最新代码
    ↓
安装/更新依赖
    ↓
重启服务
    ↓
健康检查
    ↓
通知部署结果
```

## 下一步

配置完成后：
1. ✅ 推送代码自动部署
2. ✅ 查看 Actions 日志
3. ✅ 测试自动部署
4. ✅ 继续第五阶段开发
