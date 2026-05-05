# GitHub Actions 快速配置指南

## 5 分钟快速配置

### 1. 生成 SSH 密钥

```bash
# 在本地电脑执行
ssh-keygen -t rsa -b 4096 -f github_actions_key

# 会生成两个文件：
# github_actions_key      (私钥)
# github_actions_key.pub  (公钥)
```

### 2. 添加公钥到服务器

```bash
# 查看公钥
cat github_actions_key.pub

# SSH 连接到服务器
ssh root@your_server_ip

# 添加公钥
echo "粘贴公钥内容" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3. 配置 GitHub Secrets

进入 GitHub 仓库 → Settings → Secrets and variables → Actions

添加 4 个 Secrets：

| Name | Value | 示例 |
|------|-------|------|
| `SERVER_HOST` | 服务器 IP | `123.45.67.89` |
| `SERVER_USER` | SSH 用户名 | `root` |
| `SSH_PRIVATE_KEY` | 私钥完整内容 | `cat github_actions_key` |
| `SERVER_PORT` | SSH 端口 | `22` |

### 4. 在服务器上准备项目

```bash
# SSH 连接到服务器
ssh root@your_server_ip

# 创建目录
sudo mkdir -p /var/www/browsemind
cd /var/www/browsemind

# 克隆仓库
git clone https://github.com/your-username/browsemind.git .

# 首次部署
cd backend
chmod +x deploy.sh
sudo bash deploy.sh
```

### 5. 推送代码触发部署

```bash
# 在本地项目目录
git add .
git commit -m "Setup GitHub Actions"
git push origin main
```

## 查看部署状态

GitHub 仓库 → Actions → 查看最新的 workflow

## 完成！

现在每次推送代码到 `main` 分支，都会自动部署到服务器。

## 常用命令

```bash
# 手动触发部署
GitHub → Actions → Deploy to Ubuntu Server → Run workflow

# 查看服务器日志
ssh root@your_server_ip
sudo journalctl -u browsemind -f

# 重启服务
sudo systemctl restart browsemind
```

## 故障排查

### SSH 连接失败

```bash
# 测试 SSH 连接
ssh -i github_actions_key root@your_server_ip

# 检查服务器 SSH 配置
sudo nano /etc/ssh/sshd_config
# 确保 PubkeyAuthentication yes
sudo systemctl restart sshd
```

### Git 拉取失败

```bash
# 在服务器上配置 Git
cd /var/www/browsemind
git config --global user.email "you@example.com"
git config --global user.name "Your Name"

# 如果是私有仓库，配置访问令牌
git remote set-url origin https://username:token@github.com/username/browsemind.git
```

### 权限问题

```bash
# 确保目录权限正确
sudo chown -R www-data:www-data /var/www/browsemind

# 允许重启服务
sudo visudo
# 添加: root ALL=(ALL) NOPASSWD: /bin/systemctl restart browsemind
```

## 工作流程

```
本地修改代码
    ↓
git push
    ↓
GitHub Actions 自动触发
    ↓
连接服务器
    ↓
拉取最新代码
    ↓
重启服务
    ↓
完成！
```
