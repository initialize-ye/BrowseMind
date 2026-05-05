"""
BrowseMind AI 分析功能端到端测试
"""

import requests
import json
from datetime import datetime, timedelta

# 配置
API_BASE_URL = "http://localhost:8000"  # 本地测试
# API_BASE_URL = "http://119.29.55.112:8000"  # 服务器测试

USER_ID = "test_user_001"


def test_api_health():
    """测试 API 健康状态"""
    print("\n" + "=" * 50)
    print("1️⃣  测试 API 健康状态")
    print("=" * 50)

    try:
        response = requests.get(f"{API_BASE_URL}/")
        print(f"状态码: {response.status_code}")
        print(f"响应: {response.json()}")
        assert response.status_code == 200
        print("✅ API 健康检查通过")
        return True
    except Exception as e:
        print(f"❌ API 健康检查失败: {e}")
        return False


def test_upload_data():
    """测试上传浏览数据"""
    print("\n" + "=" * 50)
    print("2️⃣  测试上传浏览数据")
    print("=" * 50)

    # 构造测试数据
    today = datetime.now().date().isoformat()
    yesterday = (datetime.now() - timedelta(days=1)).date().isoformat()

    test_records = [
        {
            "url": "https://github.com/anthropics/claude-code",
            "title": "Claude Code - GitHub",
            "domain": "github.com",
            "category": "coding",
            "visit_time": int(datetime.now().timestamp() * 1000),
            "duration": 1800,  # 30分钟
            "date": today
        },
        {
            "url": "https://www.youtube.com/watch?v=test",
            "title": "YouTube Video",
            "domain": "youtube.com",
            "category": "entertainment",
            "visit_time": int(datetime.now().timestamp() * 1000),
            "duration": 3600,  # 1小时
            "date": today
        },
        {
            "url": "https://stackoverflow.com/questions/12345",
            "title": "Stack Overflow Question",
            "domain": "stackoverflow.com",
            "category": "coding",
            "visit_time": int((datetime.now() - timedelta(hours=2)).timestamp() * 1000),
            "duration": 900,  # 15分钟
            "date": today
        },
        {
            "url": "https://twitter.com/home",
            "title": "Twitter",
            "domain": "twitter.com",
            "category": "social",
            "visit_time": int((datetime.now() - timedelta(days=1)).timestamp() * 1000),
            "duration": 2400,  # 40分钟
            "date": yesterday
        }
    ]

    payload = {
        "user_id": USER_ID,
        "records": test_records
    }

    try:
        response = requests.post(f"{API_BASE_URL}/api/upload", json=payload)
        print(f"状态码: {response.status_code}")
        result = response.json()
        print(f"响应: {json.dumps(result, ensure_ascii=False, indent=2)}")
        assert response.status_code == 200
        print(f"✅ 成功上传 {len(test_records)} 条记录")
        return True
    except Exception as e:
        print(f"❌ 上传数据失败: {e}")
        return False


def test_get_analysis():
    """测试获取分析数据"""
    print("\n" + "=" * 50)
    print("3️⃣  测试获取分析数据")
    print("=" * 50)

    try:
        response = requests.get(f"{API_BASE_URL}/api/analysis/{USER_ID}?days=7")
        print(f"状态码: {response.status_code}")
        result = response.json()
        print(f"总访问: {result['total_visits']}")
        print(f"总时长: {result['total_duration']}秒")
        print(f"独立网站: {result['unique_domains']}")
        print(f"\n分类统计:")
        for stat in result['category_stats']:
            print(f"  - {stat['category']}: {stat['percentage']}% ({stat['total_duration']}秒)")
        assert response.status_code == 200
        print("✅ 分析数据获取成功")
        return True
    except Exception as e:
        print(f"❌ 获取分析数据失败: {e}")
        return False


def test_ai_analysis():
    """测试 AI 智能分析"""
    print("\n" + "=" * 50)
    print("4️⃣  测试 AI 智能分析")
    print("=" * 50)

    try:
        response = requests.post(f"{API_BASE_URL}/api/ai-analysis/{USER_ID}?days=7")
        print(f"状态码: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            print(f"\n📝 行为总结:")
            print(f"  {result['summary']}")
            print(f"\n⚠️  发现的问题:")
            for issue in result['issues']:
                print(f"  • {issue}")
            print(f"\n💡 优化建议:")
            for suggestion in result['suggestions']:
                print(f"  ✓ {suggestion}")
            print("\n✅ AI 分析成功")
            return True
        else:
            error = response.json()
            print(f"❌ AI 分析失败: {error.get('detail', '未知错误')}")
            return False

    except Exception as e:
        print(f"❌ AI 分析失败: {e}")
        return False


def test_get_reports():
    """测试获取历史报告"""
    print("\n" + "=" * 50)
    print("5️⃣  测试获取历史报告")
    print("=" * 50)

    try:
        response = requests.get(f"{API_BASE_URL}/api/reports/{USER_ID}?limit=5")
        print(f"状态码: {response.status_code}")
        reports = response.json()
        print(f"历史报告数量: {len(reports)}")

        if reports:
            latest = reports[0]
            print(f"\n最新报告:")
            print(f"  日期: {latest['report_date']}")
            print(f"  总访问: {latest['total_visits']}")
            print(f"  总时长: {latest['total_duration']}秒")
            print(f"  AI 总结: {latest['ai_summary'][:100]}...")

        assert response.status_code == 200
        print("✅ 历史报告获取成功")
        return True
    except Exception as e:
        print(f"❌ 获取历史报告失败: {e}")
        return False


def main():
    """运行所有测试"""
    print("\n" + "=" * 50)
    print("🧪 BrowseMind AI 分析功能测试")
    print("=" * 50)
    print(f"API 地址: {API_BASE_URL}")
    print(f"测试用户: {USER_ID}")

    results = []

    # 运行测试
    results.append(("API 健康检查", test_api_health()))
    results.append(("上传浏览数据", test_upload_data()))
    results.append(("获取分析数据", test_get_analysis()))
    results.append(("AI 智能分析", test_ai_analysis()))
    results.append(("获取历史报告", test_get_reports()))

    # 汇总结果
    print("\n" + "=" * 50)
    print("📊 测试结果汇总")
    print("=" * 50)

    for name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        print(f"{name}: {status}")

    passed = sum(1 for _, r in results if r)
    total = len(results)

    print(f"\n总计: {passed}/{total} 通过")

    if passed == total:
        print("\n🎉 所有测试通过！")
    else:
        print(f"\n⚠️  {total - passed} 个测试失败")


if __name__ == "__main__":
    main()
