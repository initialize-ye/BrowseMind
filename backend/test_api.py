"""
BrowseMind 后端 API 测试脚本
"""

import requests
import json
from datetime import datetime, timedelta
import random

BASE_URL = "http://localhost:8000"
TEST_USER_ID = "test_user_001"


def test_root():
    """测试根路径"""
    print("\n=== 测试根路径 ===")
    response = requests.get(f"{BASE_URL}/")
    print(f"状态码: {response.status_code}")
    print(f"响应: {response.json()}")
    return response.status_code == 200


def generate_test_data():
    """生成测试数据"""
    test_sites = [
        {"domain": "github.com", "title": "GitHub", "category": "coding"},
        {"domain": "stackoverflow.com", "title": "Stack Overflow", "category": "learning"},
        {"domain": "youtube.com", "title": "YouTube", "category": "entertainment"},
        {"domain": "twitter.com", "title": "Twitter", "category": "social"},
        {"domain": "google.com", "title": "Google", "category": "tools"},
    ]

    records = []
    now = datetime.now()

    for i in range(50):
        site = random.choice(test_sites)
        visit_time = now - timedelta(days=random.randint(0, 6), hours=random.randint(0, 23))

        records.append({
            "url": f"https://{site['domain']}/page{i}",
            "title": site['title'],
            "domain": site['domain'],
            "category": site['category'],
            "visit_time": int(visit_time.timestamp() * 1000),
            "duration": random.randint(30, 600),
            "date": visit_time.strftime("%Y-%m-%d")
        })

    return records


def test_upload():
    """测试上传数据"""
    print("\n=== 测试上传数据 ===")

    records = generate_test_data()

    data = {
        "user_id": TEST_USER_ID,
        "records": records
    }

    response = requests.post(f"{BASE_URL}/api/upload", json=data)
    print(f"状态码: {response.status_code}")
    print(f"响应: {response.json()}")
    return response.status_code == 200


def test_get_records():
    """测试获取记录"""
    print("\n=== 测试获取记录 ===")

    response = requests.get(f"{BASE_URL}/api/records/{TEST_USER_ID}?days=7")
    print(f"状态码: {response.status_code}")

    if response.status_code == 200:
        records = response.json()
        print(f"记录数量: {len(records)}")
        if records:
            print(f"第一条记录: {records[0]}")
        return True
    else:
        print(f"错误: {response.text}")
        return False


def test_get_analysis():
    """测试获取分析"""
    print("\n=== 测试获取分析 ===")

    response = requests.get(f"{BASE_URL}/api/analysis/{TEST_USER_ID}?days=7")
    print(f"状态码: {response.status_code}")

    if response.status_code == 200:
        analysis = response.json()
        print(f"总访问: {analysis['total_visits']}")
        print(f"总时长: {analysis['total_duration']}秒")
        print(f"独立网站: {analysis['unique_domains']}")
        print(f"\n分类统计:")
        for stat in analysis['category_stats']:
            print(f"  {stat['category']}: {stat['percentage']}% ({stat['total_duration']}秒)")
        print(f"\n热门网站:")
        for domain in analysis['top_domains'][:5]:
            print(f"  {domain['domain']}: {domain['visits']}次访问")
        return True
    else:
        print(f"错误: {response.text}")
        return False


def test_get_stats():
    """测试获取统计概览"""
    print("\n=== 测试获取统计概览 ===")

    response = requests.get(f"{BASE_URL}/api/stats/{TEST_USER_ID}")
    print(f"状态码: {response.status_code}")

    if response.status_code == 200:
        stats = response.json()
        print(f"今日访问: {stats['today']['visits']}次")
        print(f"今日时长: {stats['today']['duration']}秒")
        print(f"7天访问: {stats['week']['visits']}次")
        print(f"7天时长: {stats['week']['duration']}秒")
        print(f"总记录数: {stats['total']['records']}")
        return True
    else:
        print(f"错误: {response.text}")
        return False


def run_all_tests():
    """运行所有测试"""
    print("🧠 BrowseMind 后端 API 测试")
    print("=" * 50)

    tests = [
        ("根路径", test_root),
        ("上传数据", test_upload),
        ("获取记录", test_get_records),
        ("获取分析", test_get_analysis),
        ("获取统计", test_get_stats),
    ]

    results = []
    for name, test_func in tests:
        try:
            success = test_func()
            results.append((name, success))
        except Exception as e:
            print(f"❌ 测试失败: {e}")
            results.append((name, False))

    # 输出测试结果
    print("\n" + "=" * 50)
    print("测试结果汇总:")
    for name, success in results:
        status = "✅ 通过" if success else "❌ 失败"
        print(f"  {name}: {status}")

    passed = sum(1 for _, success in results if success)
    total = len(results)
    print(f"\n总计: {passed}/{total} 通过")


if __name__ == "__main__":
    try:
        run_all_tests()
    except requests.exceptions.ConnectionError:
        print("\n❌ 无法连接到后端服务")
        print("请确保后端服务已启动: python backend/main.py")
        print("或运行: cd backend && python main.py")
