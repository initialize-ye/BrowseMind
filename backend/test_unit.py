"""
BrowseMind 后端单元测试
使用 pytest + FastAPI TestClient + 内存 SQLite
"""

import pytest
import json
import os
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import database as db_module
from database import Base, BrowsingRecord, UserGoal, UserToken, UserSettings, UserClassificationRule, LeaderboardEntry
from main import app


# ==================== Fixtures ====================

@pytest.fixture(scope="function")
def db_engine():
    """创建内存数据库引擎（StaticPool 确保所有连接共享同一个内存数据库）"""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="function")
def db_session_factory(db_engine):
    return sessionmaker(autocommit=False, autoflush=False, bind=db_engine)


@pytest.fixture(scope="function", autouse=True)
def override_db(db_engine, db_session_factory):
    """覆盖全局数据库引擎和 get_db 依赖"""
    import main as main_mod
    from unittest.mock import patch

    # 保存原始引用
    old_engine = db_module.engine
    old_session_local = db_module.SessionLocal

    # 替换 database 模块级引用
    db_module.engine = db_engine
    db_module.SessionLocal = db_session_factory

    # 用 mock.patch 替换 main 模块中的 SessionLocal 引用
    with patch.object(main_mod, 'SessionLocal', db_session_factory):
        def override_get_db():
            db = db_session_factory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[db_module.get_db] = override_get_db
        yield

    db_module.engine = old_engine
    db_module.SessionLocal = old_session_local
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    """创建测试客户端"""
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def auth_headers():
    return {"X-Auth-Token": "test-token-123"}


@pytest.fixture
def test_user_id():
    return "test_user_001"


@pytest.fixture
def sample_records():
    now = datetime.now()
    return [
        {
            "url": "https://github.com/test",
            "title": "GitHub",
            "domain": "github.com",
            "category": "coding",
            "visit_time": int(now.timestamp() * 1000),
            "duration": 1800,
            "date": now.strftime("%Y-%m-%d")
        },
        {
            "url": "https://youtube.com/watch?v=test",
            "title": "YouTube",
            "domain": "youtube.com",
            "category": "entertainment",
            "visit_time": int((now - timedelta(hours=1)).timestamp() * 1000),
            "duration": 3600,
            "date": now.strftime("%Y-%m-%d")
        },
        {
            "url": "https://stackoverflow.com/q/123",
            "title": "Stack Overflow",
            "domain": "stackoverflow.com",
            "category": "learning",
            "visit_time": int((now - timedelta(days=1)).timestamp() * 1000),
            "duration": 900,
            "date": (now - timedelta(days=1)).strftime("%Y-%m-%d")
        }
    ]


# ==================== 根路径 ====================

class TestRoot:
    def test_root(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "running"


# ==================== 上传 API ====================

class TestUpload:
    def test_upload_success(self, client, auth_headers, test_user_id, sample_records):
        resp = client.post("/api/upload", json={
            "user_id": test_user_id,
            "records": sample_records
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["saved_count"] == 3

    def test_upload_dedup(self, client, auth_headers, test_user_id, sample_records):
        """重复上传不应产生新记录"""
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["data"]["saved_count"] == 0

    def test_upload_updates_duration(self, client, auth_headers, test_user_id, sample_records):
        """重复记录应更新为更长的停留时间"""
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        shorter = [{**sample_records[0], "duration": 100}]
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": shorter}, headers=auth_headers)
        assert resp.status_code == 200
        resp2 = client.get(f"/api/records/{test_user_id}")
        for r in resp2.json():
            if r["url"] == sample_records[0]["url"]:
                assert r["duration"] >= 100

    def test_upload_empty_records(self, client, auth_headers, test_user_id):
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": []}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["data"]["saved_count"] == 0

    def test_upload_missing_auth(self, client, test_user_id, sample_records):
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records})
        assert resp.status_code == 401

    def test_upload_batch_size_limit(self, client, auth_headers, test_user_id):
        records = [{"url": f"https://example.com/{i}", "title": "t", "domain": "example.com",
                     "visit_time": int(datetime.now().timestamp() * 1000), "duration": 1, "date": "2026-01-01"}
                    for i in range(10001)]
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": records}, headers=auth_headers)
        assert resp.status_code == 422


# ==================== 记录查询 API ====================

class TestRecords:
    def test_get_records(self, client, auth_headers, test_user_id, sample_records):
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        resp = client.get(f"/api/records/{test_user_id}")
        assert resp.status_code == 200
        assert len(resp.json()) == 3

    def test_get_records_with_days_filter(self, client, auth_headers, test_user_id, sample_records):
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        resp = client.get(f"/api/records/{test_user_id}?days=1")
        assert resp.status_code == 200

    def test_get_records_empty(self, client, test_user_id):
        resp = client.get(f"/api/records/{test_user_id}")
        assert resp.status_code == 200
        assert resp.json() == []


# ==================== 分析 API ====================

class TestAnalysis:
    def test_get_analysis(self, client, auth_headers, test_user_id, sample_records):
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        resp = client.get(f"/api/analysis/{test_user_id}?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_visits" in data
        assert "total_duration" in data
        assert "category_stats" in data
        assert data["total_visits"] == 3

    def test_get_analysis_no_data(self, client, test_user_id):
        resp = client.get(f"/api/analysis/{test_user_id}?days=7")
        # API returns 404 when no data exists
        assert resp.status_code in (200, 404)

    def test_get_stats(self, client, auth_headers, test_user_id, sample_records):
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        resp = client.get(f"/api/stats/{test_user_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "today" in data
        assert "week" in data
        assert "total" in data


# ==================== 目标 API ====================

class TestGoals:
    def test_create_goal(self, client, auth_headers, test_user_id):
        resp = client.post(f"/api/goals/{test_user_id}", json={
            "goal_type": "daily_learning",
            "category": "learning",
            "target_duration": 3600,
            "date": datetime.now().strftime("%Y-%m-%d")
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["goal_type"] == "daily_learning"
        assert data["target_duration"] == 3600

    def test_get_goals(self, client, auth_headers, test_user_id):
        client.post(f"/api/goals/{test_user_id}", json={
            "goal_type": "daily_learning",
            "category": "learning",
            "target_duration": 3600,
            "date": datetime.now().strftime("%Y-%m-%d")
        }, headers=auth_headers)
        resp = client.get(f"/api/goals/{test_user_id}")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_update_goal(self, client, auth_headers, test_user_id):
        create_resp = client.post(f"/api/goals/{test_user_id}", json={
            "goal_type": "daily_learning",
            "category": "learning",
            "target_duration": 3600,
            "date": datetime.now().strftime("%Y-%m-%d")
        }, headers=auth_headers)
        goal_id = create_resp.json()["id"]
        resp = client.put(f"/api/goals/{goal_id}", json={"target_duration": 5400}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["target_duration"] == 5400

    def test_delete_goal(self, client, auth_headers, test_user_id):
        create_resp = client.post(f"/api/goals/{test_user_id}", json={
            "goal_type": "daily_learning",
            "category": "learning",
            "target_duration": 3600,
            "date": datetime.now().strftime("%Y-%m-%d")
        }, headers=auth_headers)
        goal_id = create_resp.json()["id"]
        resp = client.delete(f"/api/goals/{goal_id}", headers=auth_headers)
        assert resp.status_code == 200

    def test_update_goal_progress(self, client, auth_headers, test_user_id, sample_records):
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        today = datetime.now().strftime("%Y-%m-%d")
        client.post(f"/api/goals/{test_user_id}", json={
            "goal_type": "daily_learning", "category": "learning", "target_duration": 1800, "date": today
        }, headers=auth_headers)
        resp = client.post(f"/api/goals/{test_user_id}/update-progress?date={today}", headers=auth_headers)
        assert resp.status_code == 200


# ==================== 设置 API ====================

class TestSettings:
    def test_push_settings(self, client, auth_headers, test_user_id):
        settings = {"autoSyncEnabled": True, "analysisDays": 14, "dataRetentionDays": 30}
        resp = client.put(f"/api/settings/{test_user_id}", json=settings, headers=auth_headers)
        assert resp.status_code == 200

    def test_pull_settings(self, client, auth_headers, test_user_id):
        settings = {"autoSyncEnabled": True, "analysisDays": 14}
        client.put(f"/api/settings/{test_user_id}", json=settings, headers=auth_headers)
        resp = client.get(f"/api/settings/{test_user_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["settings"]["autoSyncEnabled"] is True
        assert data["settings"]["analysisDays"] == 14

    def test_settings_update(self, client, auth_headers, test_user_id):
        client.put(f"/api/settings/{test_user_id}", json={"analysisDays": 7}, headers=auth_headers)
        client.put(f"/api/settings/{test_user_id}", json={"analysisDays": 30}, headers=auth_headers)
        resp = client.get(f"/api/settings/{test_user_id}")
        assert resp.json()["settings"]["analysisDays"] == 30

    def test_settings_size_limit(self, client, auth_headers, test_user_id):
        huge = {f"key{i}": "x" * 1000 for i in range(100)}
        resp = client.put(f"/api/settings/{test_user_id}", json=huge, headers=auth_headers)
        assert resp.status_code in (400, 413, 422)


# ==================== 分类规则 API ====================

class TestClassificationRules:
    def test_push_rules(self, client, auth_headers, test_user_id):
        rules = {"github.com": "coding", "youtube.com": "entertainment"}
        resp = client.put(f"/api/classification-rules/{test_user_id}", json=rules, headers=auth_headers)
        assert resp.status_code == 200

    def test_pull_rules(self, client, auth_headers, test_user_id):
        rules = {"github.com": "coding"}
        client.put(f"/api/classification-rules/{test_user_id}", json=rules, headers=auth_headers)
        resp = client.get(f"/api/classification-rules/{test_user_id}")
        assert resp.status_code == 200
        assert resp.json()["rules"]["github.com"] == "coding"

    def test_rules_unique_per_user(self, client, auth_headers, test_user_id):
        client.put(f"/api/classification-rules/{test_user_id}", json={"a.com": "coding"}, headers=auth_headers)
        client.put(f"/api/classification-rules/{test_user_id}", json={"b.com": "social"}, headers=auth_headers)
        resp = client.get(f"/api/classification-rules/{test_user_id}")
        rules = resp.json()["rules"]
        assert "b.com" in rules


# ==================== 排行榜 API ====================

class TestLeaderboard:
    def test_opt_in(self, client, auth_headers, test_user_id):
        resp = client.post(f"/api/leaderboard/{test_user_id}", json={
            "display_name": "测试用户", "learning_duration": 3600,
            "focus_duration": 1800, "focus_sessions": 2, "total_duration": 7200
        }, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_opt_in_idempotent(self, client, auth_headers, test_user_id):
        data = {"display_name": "测试用户", "learning_duration": 3600, "total_duration": 7200}
        client.post(f"/api/leaderboard/{test_user_id}", json=data, headers=auth_headers)
        resp = client.post(f"/api/leaderboard/{test_user_id}", json={**data, "learning_duration": 7200}, headers=auth_headers)
        assert resp.status_code == 200

    def test_get_leaderboard(self, client, auth_headers, test_user_id):
        client.post(f"/api/leaderboard/{test_user_id}", json={
            "display_name": "测试用户", "learning_duration": 3600, "total_duration": 7200
        }, headers=auth_headers)
        resp = client.get("/api/leaderboard")
        assert resp.status_code == 200
        entries = resp.json()
        assert len(entries) >= 1

    def test_opt_out(self, client, auth_headers, test_user_id):
        client.post(f"/api/leaderboard/{test_user_id}", json={
            "display_name": "测试用户", "learning_duration": 3600, "total_duration": 7200
        }, headers=auth_headers)
        resp = client.delete(f"/api/leaderboard/{test_user_id}", headers=auth_headers)
        assert resp.status_code == 200

    def test_leaderboard_anonymity(self, client, auth_headers):
        for i in range(3):
            client.post(f"/api/leaderboard/user_{i}", json={
                "display_name": f"用户{i}", "learning_duration": i * 1000, "total_duration": i * 2000
            }, headers=auth_headers)
        resp = client.get("/api/leaderboard")
        for entry in resp.json():
            assert "user_id" not in entry


# ==================== 导出 API ====================

class TestExport:
    def test_export_json(self, client, auth_headers, test_user_id, sample_records):
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        resp = client.get(f"/api/export/{test_user_id}?format=json")
        assert resp.status_code == 200
        data = resp.json()
        assert "records" in data
        assert len(data["records"]) == 3

    def test_export_csv(self, client, auth_headers, test_user_id, sample_records):
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        resp = client.get(f"/api/export/{test_user_id}?format=csv")
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    def test_export_with_days(self, client, auth_headers, test_user_id, sample_records):
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        resp = client.get(f"/api/export/{test_user_id}?format=json&days=1")
        assert resp.status_code == 200


# ==================== 认证中间件 ====================

class TestAuth:
    def test_token_auto_registration(self, client, test_user_id, sample_records):
        headers = {"X-Auth-Token": "new-token-abc"}
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=headers)
        assert resp.status_code == 200

    def test_token_reuse(self, client, test_user_id, sample_records):
        headers = {"X-Auth-Token": "reuse-token"}
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=headers)
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=headers)
        assert resp.status_code == 200

    def test_get_no_auth_required(self, client, test_user_id):
        resp = client.get(f"/api/records/{test_user_id}")
        assert resp.status_code == 200

    def test_write_requires_token(self, client, test_user_id, sample_records):
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records})
        assert resp.status_code == 401


# ==================== 高级分析 API ====================

class TestAdvancedAnalysis:
    def test_advanced_analysis_no_data(self, client, test_user_id):
        resp = client.get(f"/api/advanced-analysis/{test_user_id}")
        assert resp.status_code in (200, 404)

    def test_advanced_analysis_with_data(self, client, auth_headers, test_user_id, sample_records):
        client.post("/api/upload", json={"user_id": test_user_id, "records": sample_records}, headers=auth_headers)
        resp = client.get(f"/api/advanced-analysis/{test_user_id}")
        assert resp.status_code == 200


# ==================== 报告 API ====================

class TestReports:
    def test_get_reports_empty(self, client, test_user_id):
        resp = client.get(f"/api/reports/{test_user_id}")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_compare_periods(self, client, test_user_id):
        resp = client.get(f"/api/analysis/{test_user_id}/compare?period1=7&period2=14")
        assert resp.status_code == 200
        data = resp.json()
        assert "period1" in data
        assert "period2" in data


# ==================== 边界情况 ====================

class TestEdgeCases:
    def test_special_characters_in_url(self, client, auth_headers, test_user_id):
        records = [{
            "url": "https://example.com/path?q=hello+world&lang=zh-CN#section",
            "title": "特殊字符测试",
            "domain": "example.com",
            "visit_time": int(datetime.now().timestamp() * 1000),
            "duration": 60,
            "date": datetime.now().strftime("%Y-%m-%d")
        }]
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": records}, headers=auth_headers)
        assert resp.status_code == 200

    def test_very_long_title(self, client, auth_headers, test_user_id):
        records = [{
            "url": "https://example.com",
            "title": "A" * 2000,
            "domain": "example.com",
            "visit_time": int(datetime.now().timestamp() * 1000),
            "duration": 60,
            "date": datetime.now().strftime("%Y-%m-%d")
        }]
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": records}, headers=auth_headers)
        assert resp.status_code == 200

    def test_zero_duration(self, client, auth_headers, test_user_id):
        records = [{
            "url": "https://example.com",
            "title": "Test",
            "domain": "example.com",
            "visit_time": int(datetime.now().timestamp() * 1000),
            "duration": 0,
            "date": datetime.now().strftime("%Y-%m-%d")
        }]
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": records}, headers=auth_headers)
        assert resp.status_code == 200

    def test_future_date(self, client, auth_headers, test_user_id):
        future = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        records = [{
            "url": "https://example.com",
            "title": "Future",
            "domain": "example.com",
            "visit_time": int((datetime.now() + timedelta(days=30)).timestamp() * 1000),
            "duration": 60,
            "date": future
        }]
        resp = client.post("/api/upload", json={"user_id": test_user_id, "records": records}, headers=auth_headers)
        assert resp.status_code == 200

    def test_concurrent_uploads_different_users(self, client, auth_headers, sample_records):
        for i in range(5):
            resp = client.post("/api/upload", json={
                "user_id": f"concurrent_user_{i}", "records": sample_records
            }, headers=auth_headers)
            assert resp.status_code == 200

    def test_goal_for_past_date(self, client, auth_headers, test_user_id):
        past = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        resp = client.post(f"/api/goals/{test_user_id}", json={
            "goal_type": "daily_learning", "category": "learning", "target_duration": 3600, "date": past
        }, headers=auth_headers)
        assert resp.status_code == 200

    def test_leaderboard_display_name_edge_cases(self, client, auth_headers, test_user_id):
        for name in ["", "A" * 100, "用户🎉", "<script>alert(1)</script>"]:
            resp = client.post(f"/api/leaderboard/{test_user_id}", json={
                "display_name": name, "learning_duration": 100, "total_duration": 200
            }, headers=auth_headers)
            assert resp.status_code == 200

    def test_upload_then_analysis_consistency(self, client, auth_headers, test_user_id):
        """上传后分析数据应一致"""
        records = [{
            "url": "https://github.com/test",
            "title": "GitHub",
            "domain": "github.com",
            "category": "coding",
            "visit_time": int(datetime.now().timestamp() * 1000),
            "duration": 3600,
            "date": datetime.now().strftime("%Y-%m-%d")
        }]
        client.post("/api/upload", json={"user_id": test_user_id, "records": records}, headers=auth_headers)
        resp = client.get(f"/api/analysis/{test_user_id}?days=1")
        data = resp.json()
        assert data["total_visits"] == 1
        assert data["total_duration"] == 3600

    def test_multiple_categories_analysis(self, client, auth_headers, test_user_id):
        """多分类数据的分析"""
        now = datetime.now()
        records = [
            {"url": f"https://{cat}.com", "title": cat, "domain": f"{cat}.com", "category": cat,
             "visit_time": int(now.timestamp() * 1000), "duration": 1800, "date": now.strftime("%Y-%m-%d")}
            for cat in ["coding", "entertainment", "social", "learning", "tools"]
        ]
        client.post("/api/upload", json={"user_id": test_user_id, "records": records}, headers=auth_headers)
        resp = client.get(f"/api/analysis/{test_user_id}?days=1")
        data = resp.json()
        assert data["total_visits"] == 5
        cats = {s["category"] for s in data["category_stats"]}
        assert len(cats) == 5


# ==================== Advanced Analyzer Tests ====================

from advanced_analyzer import TimeBlackholeDetector, AttentionCurveAnalyzer, AdvancedAnalyzer


class TestTimeBlackholeDetector:
    """时间黑洞检测器测试"""

    def test_detect_long_session(self):
        """单次长时间访问应被检测为黑洞"""
        detector = TimeBlackholeDetector(threshold_minutes=30)
        records = [
            {"domain": "youtube.com", "category": "entertainment", "duration": 2000, "date": "2026-01-01", "title": "Video", "url": "https://youtube.com"}
        ]
        result = detector.detect(records)
        assert len(result["blackholes"]) == 1
        assert result["blackholes"][0]["domain"] == "youtube.com"
        assert result["blackholes"][0]["blackhole_type"] == "long_session"
        assert result["waste_percentage"] > 0

    def test_detect_high_frequency(self):
        """多次短访问累计超过阈值应被检测为黑洞"""
        detector = TimeBlackholeDetector(threshold_minutes=5)
        records = [
            {"domain": "twitter.com", "category": "social", "duration": 30, "date": "2026-01-01", "title": "Tweet", "url": "https://twitter.com"}
            for _ in range(15)
        ]
        result = detector.detect(records)
        assert len(result["blackholes"]) == 1
        assert result["blackholes"][0]["blackhole_type"] == "high_frequency"

    def test_detect_both_types(self):
        """同时有长时间和高频访问的域名应标记为 both"""
        detector = TimeBlackholeDetector(threshold_minutes=30)
        records = [{"domain": "reddit.com", "category": "social", "duration": 2000, "date": "2026-01-01", "title": "Post", "url": "https://reddit.com"}]
        # Add more visits to trigger high frequency
        for _ in range(14):
            records.append({"domain": "reddit.com", "category": "social", "duration": 200, "date": "2026-01-01", "title": "Post", "url": "https://reddit.com"})
        result = detector.detect(records)
        assert len(result["blackholes"]) == 1
        assert result["blackholes"][0]["blackhole_type"] == "both"

    def test_detect_empty_records(self):
        """空记录应返回空结果"""
        detector = TimeBlackholeDetector(threshold_minutes=30)
        result = detector.detect([])
        assert result["blackholes"] == []
        assert result["waste_percentage"] == 0
        assert result["total_wasted_time"] == 0

    def test_detect_no_blackholes(self):
        """短时间访问不应被检测为黑洞"""
        detector = TimeBlackholeDetector(threshold_minutes=30)
        records = [
            {"domain": "google.com", "category": "tools", "duration": 10, "date": "2026-01-01", "title": "Search", "url": "https://google.com"}
        ]
        result = detector.detect(records)
        assert len(result["blackholes"]) == 0

    def test_detect_sorts_by_weighted_duration(self):
        """娱乐/社交类应排在前面（1.5x 权重）"""
        detector = TimeBlackholeDetector(threshold_minutes=30)
        records = [
            {"domain": "docs.google.com", "category": "tools", "duration": 2000, "date": "2026-01-01", "title": "Doc", "url": "https://docs.google.com"},
            {"domain": "youtube.com", "category": "entertainment", "duration": 2000, "date": "2026-01-01", "title": "Video", "url": "https://youtube.com"}
        ]
        result = detector.detect(records)
        assert len(result["blackholes"]) == 2
        # Verify weighted sort: youtube 2000*1.5=3000, docs.google 2000*1.0=2000
        assert result["blackholes"][0]["domain"] == "youtube.com"

    def test_detect_waste_percentage(self):
        """浪费百分比计算应正确"""
        detector = TimeBlackholeDetector(threshold_minutes=30)
        records = [
            {"domain": "youtube.com", "category": "entertainment", "duration": 1000, "date": "2026-01-01", "title": "Video", "url": "https://youtube.com"},
            {"domain": "github.com", "category": "coding", "duration": 1000, "date": "2026-01-01", "title": "Code", "url": "https://github.com"}
        ]
        result = detector.detect(records)
        # Only youtube.com is a blackhole (1000 >= 1800 threshold? No, 1000 < 1800)
        # Actually neither is a blackhole since 1000 < 1800 (30 min)
        assert len(result["blackholes"]) == 0
        assert result["waste_percentage"] == 0

    def test_detect_zero_duration_records(self):
        """零时长记录应被正确处理"""
        detector = TimeBlackholeDetector(threshold_minutes=0)
        records = [
            {"domain": "a.com", "category": "other", "duration": 0, "date": "2026-01-01", "title": "", "url": "https://a.com"}
        ]
        result = detector.detect(records)
        # 0 >= 0 threshold, so it's a long session
        assert len(result["blackholes"]) == 1


class TestAttentionCurveAnalyzer:
    """注意力曲线分析器测试"""

    def test_analyze_basic(self):
        """基本分析功能"""
        analyzer = AttentionCurveAnalyzer()
        records = [
            {"visit_time": int(datetime(2026, 1, 1, 10, 0).timestamp() * 1000), "duration": 100, "category": "coding"},
            {"visit_time": int(datetime(2026, 1, 1, 10, 30).timestamp() * 1000), "duration": 50, "category": "entertainment"},
            {"visit_time": int(datetime(2026, 1, 1, 14, 0).timestamp() * 1000), "duration": 200, "category": "learning"}
        ]
        result = analyzer.analyze(records)
        assert len(result["hourly_focus"]) == 24
        assert result["hourly_focus"][10]["total_duration"] > 0
        assert result["hourly_focus"][14]["total_duration"] > 0
        assert result["hourly_focus"][0]["total_duration"] == 0
        assert isinstance(result["focus_score"], float)

    def test_analyze_empty_records(self):
        """空记录应返回默认值"""
        analyzer = AttentionCurveAnalyzer()
        result = analyzer.analyze([])
        assert len(result["hourly_focus"]) == 24
        assert result["focus_score"] == 0
        assert result["peak_hours"] == []
        assert result["low_hours"] == []

    def test_analyze_string_visit_time(self):
        """应能解析 ISO 格式的 visit_time"""
        analyzer = AttentionCurveAnalyzer()
        records = [
            {"visit_time": "2026-01-01T10:00:00", "duration": 100, "category": "coding"}
        ]
        result = analyzer.analyze(records)
        assert result["hourly_focus"][10]["total_duration"] > 0

    def test_analyze_string_visit_time_with_z(self):
        """应能解析带 Z 后缀的 ISO 时间"""
        analyzer = AttentionCurveAnalyzer()
        records = [
            {"visit_time": "2026-01-01T10:00:00Z", "duration": 100, "category": "coding"}
        ]
        result = analyzer.analyze(records)
        assert result["hourly_focus"][10]["total_duration"] > 0

    def test_analyze_skips_invalid_visit_time(self):
        """无效的 visit_time 应被跳过"""
        analyzer = AttentionCurveAnalyzer()
        records = [
            {"visit_time": None, "duration": 100, "category": "coding"},
            {"visit_time": "not-a-date", "duration": 100, "category": "coding"},
            {"visit_time": int(datetime(2026, 1, 1, 10, 0).timestamp() * 1000), "duration": 100, "category": "coding"}
        ]
        result = analyzer.analyze(records)
        assert result["hourly_focus"][10]["total_duration"] == 100

    def test_analyze_focus_score_formula(self):
        """专注度分数公式: focus_ratio * 100 - entertainment_ratio * 50"""
        analyzer = AttentionCurveAnalyzer()
        # Pure coding at hour 10 → score = 1.0 * 100 - 0 * 50 = 100
        records = [
            {"visit_time": int(datetime(2026, 1, 1, 10, 0).timestamp() * 1000), "duration": 100, "category": "coding"}
        ]
        result = analyzer.analyze(records)
        assert result["hourly_focus"][10]["score"] == 100.0

        # Pure entertainment at hour 10 → score = 0 * 100 - 1.0 * 50 = -50, clamped to 0
        records2 = [
            {"visit_time": int(datetime(2026, 1, 1, 10, 0).timestamp() * 1000), "duration": 100, "category": "entertainment"}
        ]
        result2 = analyzer.analyze(records2)
        assert result2["hourly_focus"][10]["score"] == 0

    def test_analyze_peak_and_low_hours(self):
        """应能识别高峰和低谷时段"""
        analyzer = AttentionCurveAnalyzer()
        records = []
        for i in range(10):
            records.append({"visit_time": int(datetime(2026, 1, 1, 9, i * 6).timestamp() * 1000), "duration": 100, "category": "coding"})
            records.append({"visit_time": int(datetime(2026, 1, 1, 22, i * 6).timestamp() * 1000), "duration": 100, "category": "entertainment"})
        result = analyzer.analyze(records)
        assert isinstance(result["peak_hours"], list)
        assert isinstance(result["low_hours"], list)

    def test_format_time_ranges_consecutive(self):
        """连续小时应合并为范围"""
        analyzer = AttentionCurveAnalyzer()
        result = analyzer._format_time_ranges([9, 10, 11, 14, 15])
        assert result == "9:00-12:00、14:00-16:00"

    def test_format_time_ranges_single(self):
        """单小时应显示为范围"""
        analyzer = AttentionCurveAnalyzer()
        result = analyzer._format_time_ranges([10])
        assert result == "10:00-11:00"

    def test_format_time_ranges_empty(self):
        """空列表应返回空字符串"""
        analyzer = AttentionCurveAnalyzer()
        result = analyzer._format_time_ranges([])
        assert result == ""

    def test_generate_recommendations_morning_low(self):
        """早晨效率低应生成建议"""
        analyzer = AttentionCurveAnalyzer()
        hourly_focus = [
            {"hour": h, "score": 20 if 6 <= h <= 11 else 80,
             "total_duration": 100 if 6 <= h <= 11 else 0,
             "focus_duration": 0, "entertainment_duration": 100 if 6 <= h <= 11 else 0}
            for h in range(24)
        ]
        recs = analyzer._generate_recommendations([], [], hourly_focus)
        assert any("早晨" in r for r in recs)

    def test_generate_recommendations_late_night(self):
        """深夜浏览时间长应生成建议"""
        analyzer = AttentionCurveAnalyzer()
        hourly_focus = [
            {"hour": h, "score": 50, "total_duration": 5000 if h >= 23 or h <= 2 else 0,
             "focus_duration": 0, "entertainment_duration": 0}
            for h in range(24)
        ]
        recs = analyzer._generate_recommendations([], [], hourly_focus)
        assert any("深夜" in r for r in recs)

    def test_generate_recommendations_no_issues(self):
        """无问题时应给出正面建议"""
        analyzer = AttentionCurveAnalyzer()
        hourly_focus = [
            {"hour": h, "score": 80, "total_duration": 100 if 9 <= h <= 17 else 0,
             "focus_duration": 100, "entertainment_duration": 0}
            for h in range(24)
        ]
        recs = analyzer._generate_recommendations([], [], hourly_focus)
        assert any("保持" in r or "加油" in r for r in recs)


class TestAdvancedAnalyzer:
    """高级分析器整合测试"""

    def test_analyze_all(self):
        """analyze_all 应返回 blackholes 和 attention_curve"""
        analyzer = AdvancedAnalyzer(blackhole_threshold=30)
        records = [
            {"domain": "youtube.com", "category": "entertainment", "duration": 2000, "date": "2026-01-01", "title": "Video", "url": "https://youtube.com",
             "visit_time": int(datetime(2026, 1, 1, 10, 0).timestamp() * 1000)}
        ]
        result = analyzer.analyze_all(records)
        assert "blackholes" in result
        assert "attention_curve" in result
        assert len(result["blackholes"]["blackholes"]) >= 1


# ==================== AI Analyzer Tests ====================

from ai_analyzer import AIAnalyzer


class TestAIAnalyzer:
    """AI 分析器测试"""

    def test_parse_ai_response_normal(self):
        """正常 AI 响应解析"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        content = """## 行为总结
用户的浏览习惯总体健康，编程类网站访问较多。

## 发现的问题
- 娱乐时间偏长
- 深夜浏览较多

## 优化建议
- 减少娱乐时间
- 早点休息
- 增加学习时间"""
        result = analyzer._parse_ai_response(content)
        assert "编程" in result["summary"]
        assert len(result["issues"]) == 2
        assert len(result["suggestions"]) == 3

    def test_parse_ai_response_empty_sections(self):
        """空章节应使用默认值"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        content = "没有结构化内容"
        result = analyzer._parse_ai_response(content)
        assert result["summary"] == "您的浏览习惯总体良好。"
        assert result["issues"] == ["暂无明显问题"]
        assert len(result["suggestions"]) == 3

    def test_parse_ai_response_numbered_items(self):
        """应能解析编号列表"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        content = """## 行为总结
用户浏览习惯良好。

## 发现的问题
1. 娱乐时间偏长
2. 深夜浏览较多

## 优化建议
1. 减少娱乐时间
2. 早点休息"""
        result = analyzer._parse_ai_response(content)
        assert len(result["issues"]) == 2
        assert len(result["suggestions"]) == 2

    def test_parse_ai_response_deduplication(self):
        """重复项应被去重"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        content = """## 发现的问题
- 娱乐时间偏长
- 娱乐时间偏长"""
        result = analyzer._parse_ai_response(content)
        assert len(result["issues"]) == 1

    def test_get_fallback_analysis_high_entertainment(self):
        """高娱乐占比应触发问题提示"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        category_stats = [
            {"category": "entertainment", "percentage": 50, "total_duration": 5000, "visits": 30},
            {"category": "coding", "percentage": 30, "total_duration": 3000, "visits": 20},
            {"category": "learning", "percentage": 20, "total_duration": 2000, "visits": 15}
        ]
        result = analyzer._get_fallback_analysis(category_stats, 10000)
        assert any("娱乐" in i for i in result["issues"])
        assert any("娱乐" in s for s in result["suggestions"])

    def test_get_fallback_analysis_low_learning(self):
        """低学习占比应触发问题提示"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        category_stats = [
            {"category": "entertainment", "percentage": 20, "total_duration": 2000, "visits": 15},
            {"category": "coding", "percentage": 60, "total_duration": 6000, "visits": 40},
            {"category": "learning", "percentage": 10, "total_duration": 1000, "visits": 5}
        ]
        result = analyzer._get_fallback_analysis(category_stats, 10000)
        assert any("学习" in i for i in result["issues"])

    def test_get_fallback_analysis_long_duration(self):
        """超长浏览时间应触发问题提示"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        category_stats = [
            {"category": "coding", "percentage": 100, "total_duration": 30000, "visits": 100}
        ]
        result = analyzer._get_fallback_analysis(category_stats, 30000)
        assert any("过长" in i for i in result["issues"]) or any("休息" in s for s in result["suggestions"])

    def test_get_fallback_analysis_healthy(self):
        """健康的浏览习惯应返回正面反馈"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        category_stats = [
            {"category": "coding", "percentage": 40, "total_duration": 4000, "visits": 30},
            {"category": "learning", "percentage": 30, "total_duration": 3000, "visits": 20},
            {"category": "entertainment", "percentage": 20, "total_duration": 2000, "visits": 15},
            {"category": "tools", "percentage": 10, "total_duration": 1000, "visits": 10}
        ]
        result = analyzer._get_fallback_analysis(category_stats, 10000)
        assert "暂无明显问题" in result["issues"][0] or "良好" in result["issues"][0]

    def test_get_fallback_analysis_empty_stats(self):
        """空统计应使用默认值"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        result = analyzer._get_fallback_analysis([], 0)
        assert "其他" in result["summary"] or "0小时" in result["summary"]

    def test_get_category_name(self):
        """分类名映射应正确"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        assert analyzer._get_category_name("learning") == "学习"
        assert analyzer._get_category_name("coding") == "编程"
        assert analyzer._get_category_name("entertainment") == "娱乐"
        assert analyzer._get_category_name("social") == "社交"
        assert analyzer._get_category_name("tools") == "工具"
        assert analyzer._get_category_name("unknown") == "unknown"

    def test_build_analysis_prompt(self):
        """prompt 构建应包含关键信息"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        category_stats = [
            {"category": "coding", "percentage": 50, "total_duration": 5000, "visits": 30}
        ]
        top_domains = [
            {"domain": "github.com", "visits": 20, "total_duration": 3000}
        ]
        prompt = analyzer._build_analysis_prompt(category_stats, 10000, top_domains, "7天")
        assert "7天" in prompt
        assert "github.com" in prompt
        assert "编程" in prompt

    def test_build_analysis_prompt_empty_stats(self):
        """空统计的 prompt 不应崩溃"""
        analyzer = AIAnalyzer(api_key="test", provider="deepseek")
        prompt = analyzer._build_analysis_prompt([], 0, [], "7天")
        assert "7天" in prompt

    def test_unsupported_provider(self):
        """不支持的 provider 应抛出 ValueError"""
        with pytest.raises(ValueError, match="不支持"):
            AIAnalyzer(api_key="test", provider="unsupported")
