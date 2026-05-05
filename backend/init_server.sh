#!/bin/bash

# BrowseMind 服务器初始化脚本
# 用于首次部署或修复服务配置

set -e

echo "=========================================="
echo "BrowseMind 服务器初始化"
echo "=========================================="

# 检查是否在正确的目录
if [ ! -f "main.py" ]; then
    echo "❌ 错误：请在 backend 目录下运行此脚本"
    exit 1
fi

# 1. 创建虚拟环境
echo ""
echo "1️⃣  创建 Python 虚拟环境..."
if [ -d "venv" ]; then
    echo "   虚拟环境已存在，跳过"
else
    python3 -m venv venv
    echo "   ✅ 虚拟环境创建成功"
fi

# 2. 激活虚拟环境并安装依赖
echo ""
echo "2️⃣  安装 Python 依赖..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
echo "   ✅ 依赖安装完成"

# 3. 检查 .env 文件
echo ""
echo "3️⃣  检查环境变量配置..."
if [ -f ".env" ]; then
    echo "   ✅ .env 文件已存在"
    if grep -q "AI_API_KEY=your-" .env; then
        echo "   ⚠️  警告：请修改 .env 文件中的 API 密钥"
    fi
else
    echo "   ⚠️  .env 文件不存在，从示例创建..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "   ✅ 已创建 .env 文件，请编辑并填入真实的 API 密钥"
    else
        echo "   ❌ .env.example 不存在，请手动创建 .env 文件"
    fi
fi

# 4. 创建 systemd 服务
echo ""
echo "4️⃣  配置 systemd 服务..."

SERVICE_FILE="/etc/systemd/system/browsemind.service"

if [ -f "$SERVICE_FILE" ]; then
    echo "   服务文件已存在，是否覆盖？(y/n)"
    read -r response
    if [ "$response" != "y" ]; then
        echo "   跳过服务配置"
    else
        sudo bash -c "cat > $SERVICE_FILE" << EOF
[Unit]
Description=BrowseMind Backend Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
Environment="PATH=$(pwd)/venv/bin"
ExecStart=$(pwd)/venv/bin/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
        sudo systemctl daemon-reload
        sudo systemctl enable browsemind
        echo "   ✅ systemd 服务配置完成"
    fi
else
    sudo bash -c "cat > $SERVICE_FILE" << EOF
[Unit]
Description=BrowseMind Backend Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
Environment="PATH=$(pwd)/venv/bin"
ExecStart=$(pwd)/venv/bin/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable browsemind
    echo "   ✅ systemd 服务配置完成"
fi

# 5. 启动服务
echo ""
echo "5️⃣  启动服务..."
sudo systemctl restart browsemind
sleep 3

# 6. 检查服务状态
echo ""
echo "6️⃣  检查服务状态..."
if sudo systemctl is-active --quiet browsemind; then
    echo "   ✅ 服务运行正常"
    sudo systemctl status browsemind --no-pager -l
else
    echo "   ❌ 服务启动失败，查看日志："
    sudo journalctl -u browsemind -n 20 --no-pager
    exit 1
fi

# 7. 测试 API
echo ""
echo "7️⃣  测试 API 连接..."
sleep 2
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/ || echo "000")
if [ "$response" = "200" ]; then
    echo "   ✅ API 响应正常"
else
    echo "   ⚠️  API 响应异常，状态码: $response"
fi

echo ""
echo "=========================================="
echo "✅ 初始化完成！"
echo "=========================================="
echo ""
echo "后续操作："
echo "  - 编辑 .env 文件配置 API 密钥"
echo "  - 查看日志: sudo journalctl -u browsemind -f"
echo "  - 重启服务: sudo systemctl restart browsemind"
echo "  - 停止服务: sudo systemctl stop browsemind"
echo ""
