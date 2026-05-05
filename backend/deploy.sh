#!/bin/bash

# BrowseMind 一键部署脚本（Ubuntu）
# 使用方法: bash deploy.sh

set -e

echo "🧠 BrowseMind 后端服务部署脚本"
echo "================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}请使用 sudo 运行此脚本${NC}"
    exit 1
fi

# 1. 更新系统
echo -e "${GREEN}[1/10] 更新系统...${NC}"
apt update && apt upgrade -y

# 2. 安装 Python
echo -e "${GREEN}[2/10] 安装 Python 3.10...${NC}"
apt install python3.10 python3.10-venv python3-pip -y

# 3. 创建项目目录
echo -e "${GREEN}[3/10] 创建项目目录...${NC}"
mkdir -p /var/www/browsemind/backend
cd /var/www/browsemind/backend

# 4. 询问部署方式
echo -e "${YELLOW}请选择代码部署方式:${NC}"
echo "1) 从本地上传（需要先用 scp 上传代码）"
echo "2) 从 Git 仓库克隆"
echo "3) 手动创建文件"
read -p "请输入选项 (1-3): " deploy_method

if [ "$deploy_method" == "2" ]; then
    read -p "请输入 Git 仓库地址: " git_repo
    git clone $git_repo .
elif [ "$deploy_method" == "3" ]; then
    echo -e "${YELLOW}请手动创建以下文件:${NC}"
    echo "  - main.py"
    echo "  - database.py"
    echo "  - schemas.py"
    echo "  - requirements.txt"
    read -p "文件创建完成后按回车继续..."
fi

# 5. 创建虚拟环境
echo -e "${GREEN}[4/10] 创建虚拟环境...${NC}"
python3 -m venv venv
source venv/bin/activate

# 6. 安装依赖
echo -e "${GREEN}[5/10] 安装 Python 依赖...${NC}"
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn

# 7. 测试运行
echo -e "${GREEN}[6/10] 测试运行...${NC}"
timeout 5 python main.py || true
echo -e "${GREEN}测试完成${NC}"

# 8. 创建 Systemd 服务
echo -e "${GREEN}[7/10] 创建 Systemd 服务...${NC}"
cat > /etc/systemd/system/browsemind.service << EOF
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
EOF

# 设置权限
chown -R www-data:www-data /var/www/browsemind

# 启动服务
systemctl daemon-reload
systemctl start browsemind
systemctl enable browsemind

# 9. 配置防火墙
echo -e "${GREEN}[8/10] 配置防火墙...${NC}"
ufw allow 8000
ufw --force enable

# 10. 安装和配置 Nginx
echo -e "${YELLOW}是否安装 Nginx 反向代理? (y/n)${NC}"
read -p "> " install_nginx

if [ "$install_nginx" == "y" ]; then
    echo -e "${GREEN}[9/10] 安装 Nginx...${NC}"
    apt install nginx -y

    read -p "请输入域名（或直接回车使用 IP）: " domain_name
    if [ -z "$domain_name" ]; then
        domain_name="_"
    fi

    cat > /etc/nginx/sites-available/browsemind << EOF
server {
    listen 80;
    server_name $domain_name;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

    ln -sf /etc/nginx/sites-available/browsemind /etc/nginx/sites-enabled/
    nginx -t
    systemctl restart nginx
    systemctl enable nginx

    # 配置 HTTPS
    if [ "$domain_name" != "_" ]; then
        echo -e "${YELLOW}是否配置 HTTPS (Let's Encrypt)? (y/n)${NC}"
        read -p "> " install_ssl

        if [ "$install_ssl" == "y" ]; then
            echo -e "${GREEN}[10/10] 配置 HTTPS...${NC}"
            apt install certbot python3-certbot-nginx -y
            certbot --nginx -d $domain_name --non-interactive --agree-tos --register-unsafely-without-email
        fi
    fi
else
    echo -e "${YELLOW}跳过 Nginx 安装${NC}"
fi

# 完成
echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}🎉 部署完成！${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "服务状态:"
systemctl status browsemind --no-pager

echo ""
echo "访问地址:"
if [ "$install_nginx" == "y" ] && [ "$domain_name" != "_" ]; then
    if [ "$install_ssl" == "y" ]; then
        echo -e "  ${GREEN}https://$domain_name${NC}"
    else
        echo -e "  ${GREEN}http://$domain_name${NC}"
    fi
else
    SERVER_IP=$(curl -s ifconfig.me)
    echo -e "  ${GREEN}http://$SERVER_IP:8000${NC}"
fi

echo ""
echo "API 文档:"
if [ "$install_nginx" == "y" ] && [ "$domain_name" != "_" ]; then
    if [ "$install_ssl" == "y" ]; then
        echo -e "  ${GREEN}https://$domain_name/docs${NC}"
    else
        echo -e "  ${GREEN}http://$domain_name/docs${NC}"
    fi
else
    echo -e "  ${GREEN}http://$SERVER_IP:8000/docs${NC}"
fi

echo ""
echo "管理命令:"
echo "  启动服务: sudo systemctl start browsemind"
echo "  停止服务: sudo systemctl stop browsemind"
echo "  重启服务: sudo systemctl restart browsemind"
echo "  查看状态: sudo systemctl status browsemind"
echo "  查看日志: sudo journalctl -u browsemind -f"

echo ""
echo -e "${YELLOW}下一步:${NC}"
echo "1. 修改插件中的 API 地址"
echo "2. 重新加载 Chrome 插件"
echo "3. 测试数据同步功能"
