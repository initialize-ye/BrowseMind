#!/bin/bash

# BrowseMind 后端服务启动脚本

echo "🧠 BrowseMind 后端服务启动中..."

# 检查 Python 环境
if ! command -v python &> /dev/null; then
    echo "❌ 未找到 Python，请先安装 Python 3.8+"
    exit 1
fi

# 检查是否在虚拟环境中
if [ -z "$VIRTUAL_ENV" ]; then
    echo "⚠️  建议在虚拟环境中运行"
    echo "创建虚拟环境: python -m venv venv"
    echo "激活虚拟环境: source venv/bin/activate (Linux/Mac) 或 venv\\Scripts\\activate (Windows)"
    echo ""
fi

# 安装依赖
echo "📦 检查依赖..."
pip install -r requirements.txt

# 启动服务
echo "🚀 启动 FastAPI 服务..."
echo "访问地址: http://localhost:8000"
echo "API 文档: http://localhost:8000/docs"
echo ""

python main.py
