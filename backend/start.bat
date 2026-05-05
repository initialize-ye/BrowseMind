@echo off
REM BrowseMind 后端服务启动脚本 (Windows)

echo 🧠 BrowseMind 后端服务启动中...

REM 检查 Python 环境
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)

REM 检查虚拟环境
if "%VIRTUAL_ENV%"=="" (
    echo ⚠️  建议在虚拟环境中运行
    echo 创建虚拟环境: python -m venv venv
    echo 激活虚拟环境: venv\Scripts\activate
    echo.
)

REM 安装依赖
echo 📦 检查依赖...
pip install -r requirements.txt

REM 启动服务
echo 🚀 启动 FastAPI 服务...
echo 访问地址: http://localhost:8000
echo API 文档: http://localhost:8000/docs
echo.

python main.py
pause
