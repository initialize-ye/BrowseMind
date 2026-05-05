# BrowseMind 云服务器部署指南

## 部署到 Ubuntu 服务器

本指南将帮助你将 BrowseMind 后端部署到 Ubuntu 云服务器（阿里云、腾讯云、AWS 等）。

## 前置要求

- Ubuntu 18.04+ 服务器
- 公网 IP 地址
- SSH 访问权限
- 域名（可选，推荐）

## 部署步骤

### 1. 连接到服务器

```bash
ssh root@your_server_ip
# 或
ssh username@your_server_ip
```

### 2. 更新系统

```bash
sudo apt update
sudo apt upgrade -y
```

### 3. 安装 Python 3.8+

```bash
# 检查 Python 版本
python3 --version

# 如果版本低于 3.8，安装新版本
sudo apt install python3.10 python3.10-venv python3-pip -y
```

### 4. 创建项目目录

```bash
# 创建应用目录
sudo mkdir -p /var/www/browsemind
cd /var/www/browsemind

# 设置权限
sudo chown -R $USER:$USER /var/www/browsemind
```

### 5. 上传代码

**方式1：使用 Git（推荐）**

```bash
# 如果代码在 GitHub
git clone https://github.com/your-username/browsemind.git .

# 或者只上传 backend 目录
mkdir backend
cd backend
```

**方式2：使用 SCP 上传**

在本地电脑执行：

```bash
# 上传整个 backend 目录
scp -r D:\cy\Desktop\Code\BrowseMind\backend username@your_server_ip:/var/www/browsemind/
```

**方式3：手动创建文件**

```bash
# 在服务器上创建文件
cd /var/www/browsemind/backend
nano main.py
# 粘贴代码内容，Ctrl+X 保存
```

### 6. 创建虚拟环境

```bash
cd /var/www/browsemind/backend

# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 7. 测试运行

```bash
# 测试启动
python main.py

# 如果成功，按 Ctrl+C 停止
```

### 8. 配置 Gunicorn（生产环境）

```bash
# 安装 Gunicorn
pip install gunicorn

# 测试 Gunicorn
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000

# 如果成功，按 Ctrl+C 停止
```

### 9. 创建 Systemd 服务

```bash
# 创建服务文件
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

保存并启动服务：

```bash
# 重载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start browsemind

# 设置开机自启
sudo systemctl enable browsemind

# 查看状态
sudo systemctl status browsemind

# 查看日志
sudo journalctl -u browsemind -f
```

### 10. 配置防火墙

```bash
# 允许 8000 端口
sudo ufw allow 8000

# 或者只允许特定 IP
sudo ufw allow from your_ip_address to any port 8000

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

### 11. 配置 Nginx（推荐）

```bash
# 安装 Nginx
sudo apt install nginx -y

# 创建配置文件
sudo nano /etc/nginx/sites-available/browsemind
```

粘贴以下内容：

```nginx
server {
    listen 80;
    server_name your_domain.com;  # 替换为你的域名或 IP

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/browsemind /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx

# 设置开机自启
sudo systemctl enable nginx
```

### 12. 配置 HTTPS（推荐）

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx -y

# 获取 SSL 证书
sudo certbot --nginx -d your_domain.com

# 自动续期
sudo certbot renew --dry-run
```

### 13. 修改插件配置

编辑 `dataSync.js`：

```javascript
// 修改 API 地址
let dataSync = new DataSync('http://your_server_ip:8000');

// 如果配置了域名和 HTTPS
let dataSync = new DataSync('https://your_domain.com');
```

重新加载 Chrome 插件。

## 管理命令

### 启动/停止服务

```bash
# 启动
sudo systemctl start browsemind

# 停止
sudo systemctl stop browsemind

# 重启
sudo systemctl restart browsemind

# 查看状态
sudo systemctl status browsemind

# 查看日志
sudo journalctl -u browsemind -f
```

### 更新代码

```bash
cd /var/www/browsemind/backend

# 拉取最新代码
git pull

# 重启服务
sudo systemctl restart browsemind
```

### 备份数据库

```bash
# 备份数据库
cp /var/www/browsemind/backend/browsemind.db /var/www/browsemind/backup/browsemind_$(date +%Y%m%d).db

# 设置定时备份
crontab -e

# 添加每天凌晨 2 点备份
0 2 * * * cp /var/www/browsemind/backend/browsemind.db /var/www/browsemind/backup/browsemind_$(date +\%Y\%m\%d).db
```

## 性能优化

### 1. 增加 Worker 数量

编辑 `/etc/systemd/system/browsemind.service`：

```ini
# 根据 CPU 核心数调整 -w 参数
ExecStart=/var/www/browsemind/backend/venv/bin/gunicorn main:app -w 8 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

### 2. 配置数据库连接池

编辑 `database.py`：

```python
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_size=10,
    max_overflow=20
)
```

### 3. 启用 Gzip 压缩

编辑 Nginx 配置：

```nginx
gzip on;
gzip_types application/json;
gzip_min_length 1000;
```

## 安全加固

### 1. 限制 CORS

编辑 `main.py`：

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://your-extension-id",
        "https://your-domain.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 2. 添加 API 密钥认证

```python
from fastapi import Header, HTTPException

API_KEY = "your-secret-api-key"

async def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API Key")

@app.post("/api/upload", dependencies=[Depends(verify_api_key)])
async def upload_browsing_data(...):
    ...
```

### 3. 限制请求频率

```bash
# 安装
pip install slowapi

# 在 main.py 中添加
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(429, _rate_limit_exceeded_handler)

@app.post("/api/upload")
@limiter.limit("10/minute")
async def upload_browsing_data(...):
    ...
```

## 监控和日志

### 1. 查看实时日志

```bash
# 查看服务日志
sudo journalctl -u browsemind -f

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 2. 配置日志轮转

```bash
sudo nano /etc/logrotate.d/browsemind
```

```
/var/log/browsemind/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
}
```

## 故障排查

### 服务无法启动

```bash
# 查看详细错误
sudo journalctl -u browsemind -n 50

# 检查端口占用
sudo netstat -tulpn | grep 8000

# 检查权限
ls -la /var/www/browsemind/backend
```

### 无法访问 API

```bash
# 检查防火墙
sudo ufw status

# 检查 Nginx 状态
sudo systemctl status nginx

# 测试本地连接
curl http://localhost:8000
```

### 数据库错误

```bash
# 检查数据库文件权限
ls -la /var/www/browsemind/backend/browsemind.db

# 修复权限
sudo chown www-data:www-data /var/www/browsemind/backend/browsemind.db
```

## 成本估算

- **基础配置**：1核2G，约 ¥50-100/月
- **推荐配置**：2核4G，约 ¥100-200/月
- **域名**：约 ¥50-100/年
- **SSL 证书**：Let's Encrypt 免费

## 常见问题

**Q: 需要什么配置的服务器？**

A: 最低 1核1G，推荐 1核2G 或以上。

**Q: 必须要域名吗？**

A: 不是必须的，可以直接使用 IP 地址，但推荐使用域名。

**Q: 如何更换数据库为 MySQL/PostgreSQL？**

A: 修改 `database.py` 中的 `DATABASE_URL`，安装对应驱动。

**Q: 如何实现多用户隔离？**

A: 已通过 `user_id` 实现，每个用户的数据独立存储。

**Q: 数据库会不会太大？**

A: SQLite 单文件最大支持 140TB，足够使用。如需更大容量，可迁移到 PostgreSQL。

## 下一步

部署完成后，你可以：
1. 修改插件中的 API 地址为服务器地址
2. 测试数据同步功能
3. 继续第五阶段：AI 分析功能
