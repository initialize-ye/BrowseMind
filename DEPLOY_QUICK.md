# 快速部署到 Ubuntu 服务器

## 方式一：一键部署脚本（推荐）

### 1. 上传代码到服务器

```bash
# 在本地电脑执行
scp -r backend root@your_server_ip:/root/
```

### 2. 运行部署脚本

```bash
# SSH 连接到服务器
ssh root@your_server_ip

# 进入目录
cd /root/backend

# 赋予执行权限
chmod +x deploy.sh

# 运行部署脚本
sudo bash deploy.sh
```

脚本会自动完成：
- ✅ 安装 Python 3.10
- ✅ 创建虚拟环境
- ✅ 安装依赖
- ✅ 配置 Systemd 服务
- ✅ 配置防火墙
- ✅ 安装 Nginx（可选）
- ✅ 配置 HTTPS（可选）

## 方式二：手动部署

### 1. 连接服务器并安装依赖

```bash
ssh root@your_server_ip

# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Python
sudo apt install python3.10 python3.10-venv python3-pip -y
```

### 2. 创建项目目录

```bash
sudo mkdir -p /var/www/browsemind/backend
cd /var/www/browsemind/backend
```

### 3. 上传代码

**从本地上传**：
```bash
# 在本地电脑执行
scp -r D:\cy\Desktop\Code\BrowseMind\backend\* root@your_server_ip:/var/www/browsemind/backend/
```

### 4. 安装依赖

```bash
cd /var/www/browsemind/backend

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
pip install gunicorn
```

### 5. 创建 Systemd 服务

```bash
sudo nano /etc/systemd/system/browsemind.service
```

粘贴以下内容：

```ini
[Unit]
Description=BrowseMind FastAPI Application
After=network.target

[Service]
Type=notify
User=www-data
Group=www-data
WorkingDirectory=/var/www/browsemind/backend
Environment="PATH=/var/www/browsemind/backend/venv/bin"
ExecStart=/var/www/browsemind/backend/venv/bin/gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
Restart=always

[Install]
WantedBy=multi-user.target
```

### 6. 启动服务

```bash
# 设置权限
sudo chown -R www-data:www-data /var/www/browsemind

# 启动服务
sudo systemctl daemon-reload
sudo systemctl start browsemind
sudo systemctl enable browsemind

# 查看状态
sudo systemctl status browsemind
```

### 7. 配置防火墙

```bash
sudo ufw allow 8000
sudo ufw enable
```

### 8. 测试访问

```bash
# 获取服务器 IP
curl ifconfig.me

# 测试 API
curl http://your_server_ip:8000
```

## 修改插件配置

编辑 `dataSync.js`：

```javascript
// 修改为你的服务器地址
let dataSync = new DataSync('http://your_server_ip:8000');
```

重新加载 Chrome 插件，点击"同步到云端"测试。

## 常用命令

```bash
# 查看服务状态
sudo systemctl status browsemind

# 查看日志
sudo journalctl -u browsemind -f

# 重启服务
sudo systemctl restart browsemind

# 停止服务
sudo systemctl stop browsemind
```

## 配置 HTTPS（可选但推荐）

### 1. 安装 Nginx

```bash
sudo apt install nginx -y
```

### 2. 配置反向代理

```bash
sudo nano /etc/nginx/sites-available/browsemind
```

粘贴：

```nginx
server {
    listen 80;
    server_name your_domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/browsemind /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 3. 配置 SSL 证书

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your_domain.com
```

## 故障排查

### 服务无法启动

```bash
# 查看详细日志
sudo journalctl -u browsemind -n 50

# 检查端口占用
sudo netstat -tulpn | grep 8000
```

### 无法访问

```bash
# 检查防火墙
sudo ufw status

# 检查服务状态
sudo systemctl status browsemind
```

## 成本参考

- **阿里云/腾讯云**：1核2G 约 ¥60-100/月
- **域名**：约 ¥50/年（可选）
- **SSL 证书**：免费（Let's Encrypt）

## 下一步

部署完成后：
1. ✅ 修改插件 API 地址
2. ✅ 测试数据同步
3. ✅ 继续第五阶段：AI 分析
