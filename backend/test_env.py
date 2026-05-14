"""
测试环境变量配置
"""

import os
from dotenv import load_dotenv

# 加载 .env 文件
load_dotenv()

print("=" * 50)
print("环境变量配置检查")
print("=" * 50)

# 检查 AI 配置
ai_api_key = os.getenv("AI_API_KEY")
ai_provider = os.getenv("AI_PROVIDER")
ai_model = os.getenv("AI_MODEL")

print(f"AI_API_KEY: {'[OK] 已配置' if ai_api_key else '[FAIL] 未配置'}")
if ai_api_key:
    print(f"  密钥前缀: {ai_api_key[:10]}...")

print(f"AI_PROVIDER: {ai_provider or '[FAIL] 未配置'}")
print(f"AI_MODEL: {ai_model or '[FAIL] 未配置'}")

print("=" * 50)

# 测试 AI 连接
if ai_api_key and ai_provider:
    print("\n测试 AI 连接...")
    try:
        from ai_analyzer import AIAnalyzer

        analyzer = AIAnalyzer(api_key=ai_api_key, provider=ai_provider)
        print(f"[OK] AI 分析器初始化成功")
        print(f"  提供商: {analyzer.provider}")
        print(f"  模型: {analyzer.model}")

    except Exception as e:
        print(f"[FAIL] AI 分析器初始化失败: {e}")
else:
    print("\n[WARN]  跳过 AI 连接测试（配置不完整）")

print("=" * 50)
