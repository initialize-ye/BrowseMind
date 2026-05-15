"""
BrowseMind 后端服务 - 主应用
"""

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List
import csv
import io
import json
import os

from database import init_db, get_db, SessionLocal, BrowsingRecord, AnalysisReport, UserGoal, UserToken, UserSettings, UserClassificationRule, LeaderboardEntry
from schemas import (
    BrowsingRecordBatch,
    BrowsingRecordResponse,
    AnalysisResponse,
    CategoryStat,
    SuccessResponse,
    AIAnalysisResponse,
    UserGoalCreate,
    UserGoalUpdate,
    UserGoalResponse
)
from ai_analyzer import AIAnalyzer
from advanced_analyzer import AdvancedAnalyzer

# 创建 FastAPI 应用
app = FastAPI(
    title="BrowseMind API",
    description="浏览行为分析后端服务",
    version="1.0.0"
)

# 配置 CORS（Chrome 扩展 + 本地开发）
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*|http://localhost:\d+|http://127\.0\.0\.1:\d+",
    allow_origins=[],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

# 不需要认证的路径
AUTH_SKIP_PATHS = ['/', '/docs', '/openapi.json', '/redoc']


class AuthMiddleware(BaseHTTPMiddleware):
    """写操作 Token 认证中间件"""
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # 跳过不需要认证的路径和 OPTIONS 请求
        if request.method == 'OPTIONS' or path in AUTH_SKIP_PATHS or path.startswith('/docs') or path.startswith('/openapi') or path.startswith('/redoc'):
            return await call_next(request)

        # GET 请求不强制认证（向后兼容）
        if request.method == 'GET':
            return await call_next(request)

        # 写操作需要验证 token
        token = request.headers.get('X-Auth-Token')
        if not token:
            return StreamingResponse(
                iter([json.dumps({"detail": "缺少认证 token（X-Auth-Token header）"})]),
                status_code=401,
                media_type="application/json"
            )

        # 验证 token 是否已注册，或尝试自动注册
        db = SessionLocal()
        token_valid = False
        try:
            existing = db.query(UserToken).filter(UserToken.token == token).first()
            if existing:
                existing.last_used_at = datetime.utcnow()
                db.commit()
                token_valid = True
            else:
                # 首次使用：尝试自动注册 token（绑定到 user_id）
                user_id = None
                parts = path.strip('/').split('/')
                # 端点中 user_id 直接在路径中的情况
                user_id_path_keywords = ('upload', 'ai-analysis', 'export', 'leaderboard',
                                         'records', 'settings', 'classification-rules')
                for i, part in enumerate(parts):
                    if part in user_id_path_keywords and i + 1 < len(parts):
                        user_id = parts[i + 1]
                        break
                    # /api/goals/{user_id} 的 POST/GET 有 user_id
                    # /api/goals/{goal_id} 的 PUT/DELETE 是 goal_id
                    if part == 'goals' and i + 1 < len(parts):
                        # /api/goals/{user_id}/update-progress 有 user_id
                        if i + 2 < len(parts) and parts[i + 2] == 'update-progress':
                            user_id = parts[i + 1]
                            break
                        # POST /api/goals/{user_id} 有 user_id
                        if request.method == 'POST':
                            user_id = parts[i + 1]
                            break
                        # PUT/DELETE /api/goals/{goal_id} 需要查库获取 user_id
                        if request.method in ('PUT', 'DELETE'):
                            goal_id = parts[i + 1]
                            try:
                                goal = db.query(UserGoal).filter(UserGoal.id == int(goal_id)).first()
                                if goal:
                                    user_id = goal.user_id
                            except (ValueError, Exception):
                                pass
                            break
                if not user_id:
                    body = await request.body()
                    try:
                        data = json.loads(body)
                        user_id = data.get('user_id')
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass
                    async def receive():
                        return {"type": "http.request", "body": body}
                    request._receive = receive

                if user_id:
                    try:
                        new_token = UserToken(token=token, user_id=user_id)
                        db.add(new_token)
                        db.commit()
                        token_valid = True
                        print(f"注册新 token: {token[:8]}... -> {user_id}")
                    except Exception:
                        db.rollback()
                        # 并发注册时可能因 unique 约束失败，再查一次
                        existing = db.query(UserToken).filter(UserToken.token == token).first()
                        if existing:
                            existing.last_used_at = datetime.utcnow()
                            db.commit()
                            token_valid = True
        finally:
            db.close()

        if not token_valid:
            return StreamingResponse(
                iter([json.dumps({"detail": "无效的认证 token"})]),
                status_code=401,
                media_type="application/json"
            )

        return await call_next(request)


app.add_middleware(AuthMiddleware)


@app.on_event("startup")
async def startup_event():
    """启动时初始化数据库、清理过期数据、启动定时报告调度器"""
    init_db()
    cleanup_expired_data()
    start_report_scheduler()
    print("BrowseMind 后端服务已启动")


# 数据保留天数（与前端 dataRetentionDays 默认值对齐）
DATA_RETENTION_DAYS = int(os.environ.get('DATA_RETENTION_DAYS', '30'))

def safe_timestamp_to_datetime(ts_ms):
    """安全地将毫秒时间戳转换为 datetime，防止无效时间戳导致崩溃"""
    try:
        ts_sec = ts_ms / 1000
        # 限制在合理范围内：2000-01-01 到 2100-01-01
        if ts_sec < 946684800 or ts_sec > 4102444800:
            return datetime.utcnow()
        return datetime.fromtimestamp(ts_sec)
    except (OSError, ValueError, OverflowError):
        return datetime.utcnow()


def cleanup_expired_data():
    """清理超过保留期的浏览记录、报告、排行榜条目和过期 token"""
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(days=DATA_RETENTION_DAYS)
        cutoff_str = cutoff.strftime('%Y-%m-%d')

        # 清理旧浏览记录
        deleted_records = db.query(BrowsingRecord).filter(
            BrowsingRecord.date < cutoff_str
        ).delete(synchronize_session=False)

        # 清理旧报告
        deleted_reports = db.query(AnalysisReport).filter(
            AnalysisReport.report_date < cutoff_str
        ).delete(synchronize_session=False)

        # 清理旧目标
        deleted_goals = db.query(UserGoal).filter(
            UserGoal.date < cutoff_str
        ).delete(synchronize_session=False)

        # 清理旧排行榜条目
        deleted_lb = db.query(LeaderboardEntry).filter(
            LeaderboardEntry.week_start < cutoff_str
        ).delete(synchronize_session=False)

        # 清理长期未使用的 token（超过 2 倍保留期）
        token_cutoff = datetime.utcnow() - timedelta(days=DATA_RETENTION_DAYS * 2)
        deleted_tokens = db.query(UserToken).filter(
            UserToken.last_used_at < token_cutoff
        ).delete(synchronize_session=False)

        db.commit()
        if deleted_records or deleted_reports or deleted_goals or deleted_lb or deleted_tokens:
            print(f"TTL 清理：记录 {deleted_records}，报告 {deleted_reports}，目标 {deleted_goals}，排行榜 {deleted_lb}，token {deleted_tokens}")
    except Exception as e:
        db.rollback()
        print(f"TTL 清理失败: {e}")
    finally:
        db.close()


@app.get("/")
async def root():
    """根路径"""
    return {
        "service": "BrowseMind API",
        "version": "1.0.0",
        "status": "running"
    }


@app.post("/api/upload", response_model=SuccessResponse)
async def upload_browsing_data(
    batch: BrowsingRecordBatch,
    db: Session = Depends(get_db)
):
    """
    上传浏览数据（批量）

    - user_id: 用户唯一标识
    - records: 浏览记录列表
    """
    try:
        saved_count = 0

        for record_data in batch.records:
            # 检查是否已存在（避免重复，用 url + visit_time 去重）
            visit_dt = safe_timestamp_to_datetime(record_data.visit_time)
            existing = db.query(BrowsingRecord).filter(
                BrowsingRecord.user_id == batch.user_id,
                BrowsingRecord.url == record_data.url,
                BrowsingRecord.visit_time == visit_dt
            ).first()

            if existing:
                # 更新停留时间（取最大值，因为同一次访问不应出现更短的记录）
                if record_data.duration > existing.duration:
                    existing.duration = record_data.duration
                # 刷新分类（用户可能在本地修正了分类）
                if record_data.category and record_data.category != existing.category:
                    existing.category = record_data.category
                # 补充缺失的标题和域名
                if record_data.title and not existing.title:
                    existing.title = record_data.title
                if record_data.domain and not existing.domain:
                    existing.domain = record_data.domain
                continue

            # 创建新记录
            record = BrowsingRecord(
                user_id=batch.user_id,
                url=record_data.url,
                title=record_data.title,
                domain=record_data.domain,
                category=record_data.category,
                visit_time=visit_dt,
                duration=record_data.duration,
                date=record_data.date
            )

            db.add(record)
            saved_count += 1

        db.commit()

        return SuccessResponse(
            success=True,
            message=f"成功上传 {saved_count} 条记录",
            data={"saved_count": saved_count, "total_count": len(batch.records)}
        )

    except Exception as e:
        db.rollback()
        print(f"上传失败: {e}")
        raise HTTPException(status_code=500, detail="上传失败，请稍后重试")


@app.get("/api/records/{user_id}", response_model=List[BrowsingRecordResponse])
async def get_user_records(
    user_id: str,
    days: int = Query(7, ge=1, le=365),
    db: Session = Depends(get_db)
):
    """
    获取用户的浏览记录

    - user_id: 用户ID
    - days: 获取最近N天的数据（默认7天）
    """
    start_date = datetime.now() - timedelta(days=days)

    records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.visit_time >= start_date
    ).order_by(BrowsingRecord.visit_time.desc()).all()

    return [BrowsingRecordResponse(
        id=r.id,
        user_id=r.user_id,
        url=r.url,
        title=r.title,
        domain=r.domain,
        category=r.category,
        visit_time=r.visit_time.isoformat(),
        duration=r.duration,
        date=r.date,
        created_at=r.created_at.isoformat()
    ) for r in records]


@app.get("/api/analysis/{user_id}", response_model=AnalysisResponse)
async def get_analysis(
    user_id: str,
    days: int = 7,
    db: Session = Depends(get_db)
):
    """
    获取用户的浏览分析

    - user_id: 用户ID
    - days: 分析最近N天的数据（默认7天）
    """
    start_date = datetime.now() - timedelta(days=days)

    # 获取记录
    records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.visit_time >= start_date
    ).all()

    if not records:
        raise HTTPException(status_code=404, detail="未找到浏览数据")

    # 统计分析
    total_visits = len(records)
    total_duration = sum(r.duration for r in records)
    unique_domains = len(set(r.domain for r in records if r.domain))

    # 按分类统计
    category_stats_dict = {}
    for record in records:
        category = record.category or 'other'
        if category not in category_stats_dict:
            category_stats_dict[category] = {
                'visits': 0,
                'total_duration': 0,
                'domains': set()
            }
        category_stats_dict[category]['visits'] += 1
        category_stats_dict[category]['total_duration'] += record.duration
        if record.domain:
            category_stats_dict[category]['domains'].add(record.domain)

    # 转换为列表
    category_stats = []
    for category, stats in category_stats_dict.items():
        percentage = (stats['total_duration'] / total_duration * 100) if total_duration > 0 else 0
        category_stats.append(CategoryStat(
            category=category,
            visits=stats['visits'],
            total_duration=stats['total_duration'],
            percentage=round(percentage, 1),
            unique_domains=len(stats['domains'])
        ))

    # 按时长排序
    category_stats.sort(key=lambda x: x.total_duration, reverse=True)

    # 统计热门域名
    domain_stats = {}
    for record in records:
        if record.domain:
            if record.domain not in domain_stats:
                domain_stats[record.domain] = {
                    'domain': record.domain,
                    'visits': 0,
                    'total_duration': 0
                }
            domain_stats[record.domain]['visits'] += 1
            domain_stats[record.domain]['total_duration'] += record.duration

    top_domains = sorted(
        domain_stats.values(),
        key=lambda x: x['total_duration'],
        reverse=True
    )[:10]

    return AnalysisResponse(
        user_id=user_id,
        date_range=f"{days}天",
        total_visits=total_visits,
        total_duration=total_duration,
        unique_domains=unique_domains,
        category_stats=category_stats,
        top_domains=top_domains
    )


@app.get("/api/analysis/{user_id}/compare")
async def compare_periods(
    user_id: str,
    period1: int = Query(7, ge=1, description="近期天数"),
    period2: int = Query(14, ge=1, description="对比天数（period2 应 > period1）"),
    db: Session = Depends(get_db)
):
    """对比两个时间段的浏览数据"""
    now = datetime.now()
    # Period 1: 最近 period1 天
    p1_start = now - timedelta(days=period1)
    # Period 2: period1 天前到 period1+period2 天前
    p2_start = now - timedelta(days=period1 + period2)
    p2_end = p1_start

    p1_records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.visit_time >= p1_start
    ).all()

    p2_records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.visit_time >= p2_start,
        BrowsingRecord.visit_time < p2_end
    ).all()

    def summarize(records):
        total_duration = sum(r.duration for r in records)
        unique_domains = set(r.domain for r in records if r.domain)
        cat_stats = {}
        for r in records:
            cat = r.category or 'other'
            if cat not in cat_stats:
                cat_stats[cat] = {'visits': 0, 'duration': 0, 'domains': set()}
            cat_stats[cat]['visits'] += 1
            cat_stats[cat]['duration'] += r.duration
            if r.domain:
                cat_stats[cat]['domains'].add(r.domain)
        return {
            'total_visits': len(records),
            'total_duration': total_duration,
            'unique_domains': len(unique_domains),
            'domains': unique_domains,
            'category_stats': {k: {'visits': v['visits'], 'duration': v['duration'], 'unique_domains': len(v['domains'])} for k, v in cat_stats.items()},
        }

    s1 = summarize(p1_records)
    s2 = summarize(p2_records)

    # 分类占比变化
    def pct_map(stats):
        total = stats['total_duration'] or 1
        return {k: round(v['duration'] / total * 100, 1) for k, v in stats['category_stats'].items()}

    p1_pct = pct_map(s1)
    p2_pct = pct_map(s2)
    all_cats = set(list(p1_pct.keys()) + list(p2_pct.keys()))
    category_changes = {}
    for cat in all_cats:
        category_changes[cat] = {
            'period1_pct': p1_pct.get(cat, 0),
            'period2_pct': p2_pct.get(cat, 0),
            'delta': round(p1_pct.get(cat, 0) - p2_pct.get(cat, 0), 1)
        }

    # 域名变化
    new_domains = sorted(s1['domains'] - s2['domains'])
    disappeared_domains = sorted(s2['domains'] - s1['domains'])

    # 时长变化率
    duration_change_pct = round((s1['total_duration'] - s2['total_duration']) / (s2['total_duration'] or 1) * 100, 1)

    return {
        'period1': {'days': period1, **s1, 'domains': None},
        'period2': {'days': period2, **s2, 'domains': None},
        'duration_change_pct': duration_change_pct,
        'category_changes': category_changes,
        'new_domains': new_domains[:20],
        'disappeared_domains': disappeared_domains[:20],
    }


@app.delete("/api/records/{user_id}")
async def delete_user_records(
    user_id: str,
    days: int = -1,
    db: Session = Depends(get_db)
):
    """
    删除用户的浏览记录

    - user_id: 用户ID
    - days: 删除N天前的数据（传-1或省略则删除全部）
    """
    query = db.query(BrowsingRecord).filter(BrowsingRecord.user_id == user_id)

    if days > 0:
        cutoff_date = datetime.now() - timedelta(days=days)
        query = query.filter(BrowsingRecord.visit_time < cutoff_date)
    elif days == 0:
        raise HTTPException(status_code=400, detail="days 参数必须大于0，传-1以删除全部记录")

    deleted_count = query.delete()
    db.commit()

    return SuccessResponse(
        success=True,
        message=f"成功删除 {deleted_count} 条记录",
        data={"deleted_count": deleted_count}
    )


@app.get("/api/stats/{user_id}")
async def get_user_stats(
    user_id: str,
    db: Session = Depends(get_db)
):
    """
    获取用户统计概览

    - user_id: 用户ID
    """
    # 今日统计
    today = datetime.now().date().isoformat()
    today_records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.date == today
    ).all()

    # 7天统计
    seven_days_ago = datetime.now() - timedelta(days=7)
    week_records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.visit_time >= seven_days_ago
    ).all()

    # 总统计
    total_records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id
    ).count()

    return {
        "user_id": user_id,
        "today": {
            "visits": len(today_records),
            "duration": sum(r.duration for r in today_records)
        },
        "week": {
            "visits": len(week_records),
            "duration": sum(r.duration for r in week_records),
            "unique_domains": len(set(r.domain for r in week_records if r.domain))
        },
        "total": {
            "records": total_records
        }
    }


@app.post("/api/ai-analysis/{user_id}", response_model=AIAnalysisResponse)
async def get_ai_analysis(
    user_id: str,
    days: int = 7,
    db: Session = Depends(get_db)
):
    """
    获取 AI 智能分析

    - user_id: 用户ID
    - days: 分析最近N天的数据（默认7天）
    """
    # 检查 API 密钥
    api_key = os.getenv("AI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="AI API 密钥未配置，请设置环境变量 AI_API_KEY"
        )

    # 获取分析数据
    start_date = datetime.now() - timedelta(days=days)
    records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.visit_time >= start_date
    ).all()

    if not records:
        raise HTTPException(status_code=404, detail="未找到浏览数据")

    # 统计分析
    total_duration = sum(r.duration for r in records)

    # 按分类统计
    category_stats_dict = {}
    for record in records:
        category = record.category or 'other'
        if category not in category_stats_dict:
            category_stats_dict[category] = {
                'visits': 0,
                'total_duration': 0,
                'domains': set()
            }
        category_stats_dict[category]['visits'] += 1
        category_stats_dict[category]['total_duration'] += record.duration
        if record.domain:
            category_stats_dict[category]['domains'].add(record.domain)

    # 转换为列表
    category_stats = []
    for category, stats in category_stats_dict.items():
        percentage = (stats['total_duration'] / total_duration * 100) if total_duration > 0 else 0
        category_stats.append({
            'category': category,
            'visits': stats['visits'],
            'total_duration': stats['total_duration'],
            'percentage': round(percentage, 1),
            'unique_domains': len(stats['domains'])
        })

    category_stats.sort(key=lambda x: x['total_duration'], reverse=True)

    # 统计热门域名
    domain_stats = {}
    for record in records:
        if record.domain:
            if record.domain not in domain_stats:
                domain_stats[record.domain] = {
                    'domain': record.domain,
                    'visits': 0,
                    'total_duration': 0
                }
            domain_stats[record.domain]['visits'] += 1
            domain_stats[record.domain]['total_duration'] += record.duration

    top_domains = sorted(
        domain_stats.values(),
        key=lambda x: x['total_duration'],
        reverse=True
    )[:10]

    # 调用 AI 分析
    try:
        provider = os.getenv("AI_PROVIDER", "deepseek")
        analyzer = AIAnalyzer(api_key=api_key, provider=provider)

        result = analyzer.analyze_browsing_behavior(
            category_stats=category_stats,
            total_duration=total_duration,
            top_domains=top_domains,
            date_range=f"{days}天"
        )

        # 保存分析报告到数据库
        report = AnalysisReport(
            user_id=user_id,
            report_date=datetime.now().date().isoformat(),
            report_type=f'ai_{days}d',
            total_visits=len(records),
            total_duration=total_duration,
            unique_domains=len(set(r.domain for r in records if r.domain)),
            category_stats=json.dumps(category_stats, ensure_ascii=False),
            ai_summary=result['summary'],
            ai_issues=json.dumps(result['issues'], ensure_ascii=False),
            ai_suggestions=json.dumps(result['suggestions'], ensure_ascii=False),
            top_domains=json.dumps(top_domains, ensure_ascii=False)
        )

        db.add(report)
        db.commit()

        return AIAnalysisResponse(
            summary=result['summary'],
            issues=result['issues'],
            suggestions=result['suggestions'],
            category_stats=[CategoryStat(**s) for s in category_stats],
            top_domains=top_domains
        )

    except Exception as e:
        print(f"AI 分析失败: {e}")
        raise HTTPException(status_code=500, detail="AI 分析失败，请稍后重试")


@app.get("/api/reports/{user_id}")
async def get_user_reports(
    user_id: str,
    limit: int = Query(10, ge=1, le=100),
    report_type: str = None,
    db: Session = Depends(get_db)
):
    """
    获取用户的历史分析报告

    - user_id: 用户ID
    - limit: 返回数量（默认10条）
    - report_type: 可选筛选报告类型（如 ai_7d, ai_30d）
    """
    query = db.query(AnalysisReport).filter(AnalysisReport.user_id == user_id)
    if report_type:
        query = query.filter(AnalysisReport.report_type == report_type)
    reports = query.order_by(AnalysisReport.created_at.desc()).limit(limit).all()

    return [report.to_dict() for report in reports]


@app.get("/api/advanced-analysis/{user_id}")
async def get_advanced_analysis(
    user_id: str,
    days: int = Query(7, ge=1, le=90),
    blackhole_threshold: int = Query(30, ge=1, le=480),
    db: Session = Depends(get_db)
):
    """
    获取高级分析（时间黑洞 + 注意力曲线）

    - user_id: 用户ID
    - days: 分析最近N天的数据（默认7天）
    - blackhole_threshold: 时间黑洞阈值（分钟，默认30）
    """
    start_date = datetime.now() - timedelta(days=days)

    # 获取记录
    records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.visit_time >= start_date
    ).all()

    if not records:
        raise HTTPException(status_code=404, detail="未找到浏览数据")

    # 转换为字典格式
    records_data = [{
        'url': r.url,
        'title': r.title,
        'domain': r.domain,
        'category': r.category,
        'visit_time': r.visit_time.isoformat(),
        'duration': r.duration,
        'date': r.date
    } for r in records]

    # 执行高级分析
    analyzer = AdvancedAnalyzer(blackhole_threshold=blackhole_threshold)
    result = analyzer.analyze_all(records_data)

    return {
        'user_id': user_id,
        'date_range': f'{days}天',
        'blackhole_threshold': blackhole_threshold,
        'blackholes': result['blackholes'],
        'attention_curve': result['attention_curve']
    }


@app.post("/api/goals/{user_id}", response_model=UserGoalResponse)
async def create_goal(
    user_id: str,
    goal: UserGoalCreate,
    db: Session = Depends(get_db)
):
    """
    创建用户目标

    - user_id: 用户ID
    - goal: 目标信息
    """
    # 检查是否已存在相同日期和类型的目标
    existing = db.query(UserGoal).filter(
        UserGoal.user_id == user_id,
        UserGoal.goal_type == goal.goal_type,
        UserGoal.date == goal.date,
        UserGoal.is_active == 1
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="该日期已存在相同类型的目标")

    # 创建新目标
    new_goal = UserGoal(
        user_id=user_id,
        goal_type=goal.goal_type,
        category=goal.category,
        target_duration=goal.target_duration,
        date=goal.date
    )

    db.add(new_goal)
    db.commit()
    db.refresh(new_goal)

    return UserGoalResponse(**new_goal.to_dict())


@app.get("/api/goals/{user_id}", response_model=List[UserGoalResponse])
async def get_user_goals(
    user_id: str,
    date: str = None,
    is_active: int = Query(None, ge=0, le=1),
    db: Session = Depends(get_db)
):
    """
    获取用户目标列表

    - user_id: 用户ID
    - date: 日期过滤（可选）
    - is_active: 是否激活过滤（可选）
    """
    query = db.query(UserGoal).filter(UserGoal.user_id == user_id)

    if date:
        query = query.filter(UserGoal.date == date)
    if is_active is not None:
        query = query.filter(UserGoal.is_active == is_active)

    goals = query.order_by(UserGoal.created_at.desc()).all()

    return [UserGoalResponse(**g.to_dict()) for g in goals]


@app.put("/api/goals/{goal_id}", response_model=UserGoalResponse)
async def update_goal(
    goal_id: int,
    goal_update: UserGoalUpdate,
    db: Session = Depends(get_db)
):
    """
    更新用户目标

    - goal_id: 目标ID
    - goal_update: 更新信息
    """
    goal = db.query(UserGoal).filter(UserGoal.id == goal_id).first()

    if not goal:
        raise HTTPException(status_code=404, detail="目标不存在")

    # 更新字段
    if goal_update.target_duration is not None:
        goal.target_duration = goal_update.target_duration
    if goal_update.current_progress is not None:
        goal.current_progress = goal_update.current_progress
    if goal_update.is_active is not None:
        goal.is_active = goal_update.is_active
    if goal_update.notified is not None:
        goal.notified = goal_update.notified

    goal.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(goal)

    return UserGoalResponse(**goal.to_dict())


@app.delete("/api/goals/{goal_id}")
async def delete_goal(
    goal_id: int,
    db: Session = Depends(get_db)
):
    """
    删除用户目标

    - goal_id: 目标ID
    """
    goal = db.query(UserGoal).filter(UserGoal.id == goal_id).first()

    if not goal:
        raise HTTPException(status_code=404, detail="目标不存在")

    db.delete(goal)
    db.commit()

    return SuccessResponse(
        success=True,
        message="目标已删除",
        data={"goal_id": goal_id}
    )


@app.post("/api/goals/{user_id}/update-progress")
async def update_goals_progress(
    user_id: str,
    date: str,
    db: Session = Depends(get_db)
):
    """
    更新用户当日所有目标的进度

    - user_id: 用户ID
    - date: 日期 YYYY-MM-DD
    """
    # 获取当日所有激活的目标
    goals = db.query(UserGoal).filter(
        UserGoal.user_id == user_id,
        UserGoal.date == date,
        UserGoal.is_active == 1
    ).all()

    if not goals:
        return SuccessResponse(
            success=True,
            message="当日无激活目标",
            data={"updated_count": 0}
        )

    # 获取当日浏览记录
    records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.date == date
    ).all()

    # 按分类统计时长
    category_durations = {}
    for record in records:
        category = record.category or 'other'
        category_durations[category] = category_durations.get(category, 0) + record.duration

    # 更新每个目标的进度
    updated_count = 0
    notifications = []

    for goal in goals:
        old_progress = goal.current_progress
        new_progress = category_durations.get(goal.category, 0)
        goal.current_progress = new_progress
        goal.updated_at = datetime.utcnow()

        # 检查是否需要通知
        if not goal.notified:
            progress_percentage = (new_progress / goal.target_duration * 100) if goal.target_duration > 0 else 0

            # 达成目标
            if new_progress >= goal.target_duration and old_progress < goal.target_duration:
                notifications.append({
                    'goal_id': goal.id,
                    'type': 'achieved',
                    'message': f'恭喜！你已完成今日 {goal.category} 目标'
                })
                goal.notified = 1

            # 超标警告（娱乐类）
            elif goal.goal_type.startswith('daily_entertainment') and progress_percentage >= 80:
                if old_progress < goal.target_duration * 0.8:
                    notifications.append({
                        'goal_id': goal.id,
                        'type': 'warning',
                        'message': f'注意！{goal.category} 时间已达 {int(progress_percentage)}%'
                    })

        updated_count += 1

    db.commit()

    return SuccessResponse(
        success=True,
        message=f"已更新 {updated_count} 个目标进度",
        data={
            "updated_count": updated_count,
            "notifications": notifications
        }
    )


# ==================== 设置同步 ====================

@app.get("/api/settings/{user_id}")
def get_settings(user_id: str, db: Session = Depends(get_db)):
    """获取用户设置"""
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    if not settings:
        return {"settings": {}, "updated_at": None}
    return {
        "settings": json.loads(settings.settings_json),
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else None
    }


@app.put("/api/settings/{user_id}")
def update_settings(user_id: str, body: dict, db: Session = Depends(get_db)):
    """更新用户设置（全量覆盖）"""
    # 限制 body 大小（64KB）
    body_str = json.dumps(body, ensure_ascii=False)
    if len(body_str) > 65536:
        raise HTTPException(status_code=413, detail="设置数据过大（最大 64KB）")
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    if settings:
        settings.settings_json = body_str
        settings.updated_at = datetime.utcnow()
    else:
        settings = UserSettings(user_id=user_id, settings_json=body_str)
        db.add(settings)
    db.commit()
    return {"success": True, "updated_at": settings.updated_at.isoformat()}


@app.get("/api/classification-rules/{user_id}")
def get_classification_rules(user_id: str, db: Session = Depends(get_db)):
    """获取用户分类规则"""
    rules = db.query(UserClassificationRule).filter(UserClassificationRule.user_id == user_id).first()
    if not rules:
        return {"rules": {}, "updated_at": None}
    return {
        "rules": json.loads(rules.rules_json),
        "updated_at": rules.updated_at.isoformat() if rules.updated_at else None
    }


@app.put("/api/classification-rules/{user_id}")
def update_classification_rules(user_id: str, body: dict, db: Session = Depends(get_db)):
    """更新用户分类规则（全量覆盖）"""
    body_str = json.dumps(body, ensure_ascii=False)
    if len(body_str) > 65536:
        raise HTTPException(status_code=413, detail="规则数据过大（最大 64KB）")
    rules = db.query(UserClassificationRule).filter(UserClassificationRule.user_id == user_id).first()
    if rules:
        rules.rules_json = body_str
        rules.updated_at = datetime.utcnow()
    else:
        rules = UserClassificationRule(user_id=user_id, rules_json=body_str)
        db.add(rules)
    db.commit()
    return {"success": True, "updated_at": rules.updated_at.isoformat()}


# ==================== 数据导出 ====================

@app.get("/api/export/{user_id}")
def export_user_data(
    user_id: str,
    format: str = Query("json", pattern="^(json|csv)$"),
    days: int = Query(0, ge=0, description="导出天数，0=全部"),
    db: Session = Depends(get_db)
):
    """导出用户全部数据（JSON 或 CSV）"""
    query = db.query(BrowsingRecord).filter(BrowsingRecord.user_id == user_id)
    if days > 0:
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        query = query.filter(BrowsingRecord.date >= cutoff)
    records = query.order_by(BrowsingRecord.visit_time.desc()).all()

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["url", "title", "domain", "category", "visit_time", "duration", "date"])
        for r in records:
            writer.writerow([
                r.url, r.title or "", r.domain or "", r.category or "",
                r.visit_time.isoformat() if r.visit_time else "",
                r.duration or 0, r.date or ""
        ])
        output.seek(0)
        filename = f"browsemind_{user_id}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )

    # JSON 全量导出
    reports = db.query(AnalysisReport).filter(AnalysisReport.user_id == user_id).all()
    goals = db.query(UserGoal).filter(UserGoal.user_id == user_id).all()

    data = {
        "exported_at": datetime.utcnow().isoformat(),
        "user_id": user_id,
        "records": [r.to_dict() for r in records],
        "reports": [r.to_dict() for r in reports],
        "goals": [g.to_dict() for g in goals],
    }
    filename = f"browsemind_{user_id}_{datetime.utcnow().strftime('%Y%m%d')}.json"
    return StreamingResponse(
        iter([json.dumps(data, ensure_ascii=False, indent=2)]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ==================== 自动定时报告 ====================

def _get_active_user_ids(days=7):
    """获取最近 N 天有数据的用户 ID 列表"""
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(days=days)
        rows = db.query(BrowsingRecord.user_id).filter(
            BrowsingRecord.visit_time >= cutoff
        ).distinct().all()
        return [r[0] for r in rows]
    finally:
        db.close()


def _generate_periodic_report(user_id, days, report_type):
    """为指定用户生成周期性 AI 分析报告"""
    db = SessionLocal()
    try:
        # 检查是否已有该周期的报告（避免重复生成）
        today = datetime.utcnow().date().isoformat()
        existing = db.query(AnalysisReport).filter(
            AnalysisReport.user_id == user_id,
            AnalysisReport.report_type == report_type,
            AnalysisReport.report_date == today
        ).first()
        if existing:
            return

        api_key = os.getenv("AI_API_KEY")
        if not api_key:
            return

        start_date = datetime.utcnow() - timedelta(days=days)
        records = db.query(BrowsingRecord).filter(
            BrowsingRecord.user_id == user_id,
            BrowsingRecord.visit_time >= start_date
        ).all()

        if not records:
            return

        total_duration = sum(r.duration for r in records)
        category_stats_dict = {}
        for record in records:
            category = record.category or 'other'
            if category not in category_stats_dict:
                category_stats_dict[category] = {'visits': 0, 'total_duration': 0, 'domains': set()}
            category_stats_dict[category]['visits'] += 1
            category_stats_dict[category]['total_duration'] += record.duration
            if record.domain:
                category_stats_dict[category]['domains'].add(record.domain)

        category_stats = []
        for category, stats in category_stats_dict.items():
            pct = (stats['total_duration'] / total_duration * 100) if total_duration > 0 else 0
            category_stats.append({
                'category': category,
                'visits': stats['visits'],
                'total_duration': stats['total_duration'],
                'percentage': round(pct, 1),
                'unique_domains': len(stats['domains'])
            })
        category_stats.sort(key=lambda x: x['total_duration'], reverse=True)

        domain_stats = {}
        for record in records:
            if record.domain:
                if record.domain not in domain_stats:
                    domain_stats[record.domain] = {'domain': record.domain, 'visits': 0, 'total_duration': 0}
                domain_stats[record.domain]['visits'] += 1
                domain_stats[record.domain]['total_duration'] += record.duration
        top_domains = sorted(domain_stats.values(), key=lambda x: x['total_duration'], reverse=True)[:10]

        provider = os.getenv("AI_PROVIDER", "deepseek")
        analyzer = AIAnalyzer(api_key=api_key, provider=provider)
        result = analyzer.analyze_browsing_behavior(
            category_stats=category_stats,
            total_duration=total_duration,
            top_domains=top_domains,
            date_range=f"{days}天"
        )

        report = AnalysisReport(
            user_id=user_id,
            report_date=today,
            report_type=report_type,
            total_visits=len(records),
            total_duration=total_duration,
            unique_domains=len(set(r.domain for r in records if r.domain)),
            category_stats=json.dumps(category_stats, ensure_ascii=False),
            ai_summary=result['summary'],
            ai_issues=json.dumps(result['issues'], ensure_ascii=False),
            ai_suggestions=json.dumps(result['suggestions'], ensure_ascii=False),
            top_domains=json.dumps(top_domains, ensure_ascii=False)
        )
        db.add(report)
        db.commit()
        print(f"自动生成 {report_type} 报告: {user_id}")
    except Exception as e:
        db.rollback()
        print(f"自动生成报告失败 ({user_id}, {report_type}): {e}")
    finally:
        db.close()


def _weekly_report_job():
    """每周一生成周报"""
    user_ids = _get_active_user_ids(days=7)
    for uid in user_ids:
        _generate_periodic_report(uid, 7, 'ai_weekly')
    print(f"周报生成完成: {len(user_ids)} 个用户")


def _monthly_report_job():
    """每月 1 日生成月报"""
    user_ids = _get_active_user_ids(days=30)
    for uid in user_ids:
        _generate_periodic_report(uid, 30, 'ai_monthly')
    print(f"月报生成完成: {len(user_ids)} 个用户")


_report_scheduler = None


def start_report_scheduler():
    """启动 APScheduler 定时任务"""
    global _report_scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger

        _report_scheduler = BackgroundScheduler()
        # 每周一早上 9 点生成周报
        _report_scheduler.add_job(_weekly_report_job, CronTrigger(day_of_week='mon', hour=9, minute=0))
        # 每月 1 日早上 9 点生成月报
        _report_scheduler.add_job(_monthly_report_job, CronTrigger(day=1, hour=9, minute=0))
        _report_scheduler.start()
        print("报告调度器已启动（周报: 周一 9:00, 月报: 每月 1 日 9:00）")
    except Exception as e:
        print(f"调度器启动失败（不影响主服务）: {e}")


@app.on_event("shutdown")
async def shutdown_event():
    """关闭时停止调度器"""
    global _report_scheduler
    if _report_scheduler:
        _report_scheduler.shutdown(wait=False)
        _report_scheduler = None


# ==================== 排行榜 ====================

@app.post("/api/leaderboard/{user_id}")
def opt_in_leaderboard(
    user_id: str,
    body: dict = None,
    db: Session = Depends(get_db)
):
    """加入排行榜（opt-in）并提交本周数据"""
    display_name = str((body or {}).get('display_name') or '匿名用户')[:50]

    # 计算本周一
    today = datetime.utcnow().date()
    monday = today - timedelta(days=today.weekday())
    week_start = monday.isoformat()

    # 获取本周数据
    week_start_dt = datetime.combine(monday, datetime.min.time())
    records = db.query(BrowsingRecord).filter(
        BrowsingRecord.user_id == user_id,
        BrowsingRecord.visit_time >= week_start_dt
    ).all()

    learning_duration = sum(r.duration for r in records if r.category in ('learning', 'education', 'work'))
    total_duration = sum(r.duration for r in records)

    # 优先使用前端传入的专注数据，否则从目标中推断（两者都不提供才 fallback）
    focus_duration = (body or {}).get('focus_duration', 0) or 0
    focus_sessions = (body or {}).get('focus_sessions', 0) or 0
    if not focus_duration and not focus_sessions:
        goals = db.query(UserGoal).filter(
            UserGoal.user_id == user_id,
            UserGoal.date >= monday.isoformat(),
            UserGoal.category.in_(['learning', 'work', 'focus'])
        ).all()
        for g in goals:
            focus_duration += g.current_progress
            focus_sessions += 1

    # 更新或创建
    entry = db.query(LeaderboardEntry).filter(
        LeaderboardEntry.user_id == user_id,
        LeaderboardEntry.week_start == week_start
    ).first()

    if entry:
        entry.display_name = display_name
        entry.learning_duration = learning_duration
        entry.focus_duration = focus_duration
        entry.focus_sessions = focus_sessions
        entry.total_duration = total_duration
        entry.updated_at = datetime.utcnow()
    else:
        entry = LeaderboardEntry(
            user_id=user_id,
            display_name=display_name,
            week_start=week_start,
            learning_duration=learning_duration,
            focus_duration=focus_duration,
            focus_sessions=focus_sessions,
            total_duration=total_duration
        )
        db.add(entry)

    try:
        db.commit()
    except Exception:
        db.rollback()
        # 并发插入时可能因 unique 约束失败，改为更新
        entry = db.query(LeaderboardEntry).filter(
            LeaderboardEntry.user_id == user_id,
            LeaderboardEntry.week_start == week_start
        ).first()
        if entry:
            entry.display_name = display_name
            entry.learning_duration = learning_duration
            entry.focus_duration = focus_duration
            entry.focus_sessions = focus_sessions
            entry.total_duration = total_duration
            entry.updated_at = datetime.utcnow()
            db.commit()
        else:
            raise
    return {"success": True, "message": "已加入排行榜", "entry": entry.to_dict()}


@app.delete("/api/leaderboard/{user_id}")
def opt_out_leaderboard(
    user_id: str,
    all_weeks: bool = Query(False, description="是否删除所有周的数据"),
    db: Session = Depends(get_db)
):
    """退出排行榜（默认仅退出本周）"""
    query = db.query(LeaderboardEntry).filter(LeaderboardEntry.user_id == user_id)
    if not all_weeks:
        today = datetime.utcnow().date()
        monday = today - timedelta(days=today.weekday())
        query = query.filter(LeaderboardEntry.week_start == monday.isoformat())
    deleted = query.delete()
    db.commit()
    return {"success": True, "message": "已退出排行榜", "deleted": deleted}


@app.get("/api/leaderboard")
def get_leaderboard(
    week: str = Query(None, description="周起始日期 YYYY-MM-DD，默认本周"),
    sort_by: str = Query("learning_duration", pattern="^(learning_duration|focus_duration|total_duration)$"),
    limit: int = Query(50, ge=1, le=100),
    user_id: str = Query(None, description="当前用户 ID（用于标记自己的排名）"),
    db: Session = Depends(get_db)
):
    """获取排行榜（匿名）"""
    if week:
        week_start = week
    else:
        today = datetime.utcnow().date()
        monday = today - timedelta(days=today.weekday())
        week_start = monday.isoformat()

    entries = db.query(LeaderboardEntry).filter(
        LeaderboardEntry.week_start == week_start
    ).order_by(
        LeaderboardEntry.__table__.c[sort_by].desc()
    ).limit(limit).all()

    # 返回时隐藏 user_id，只返回排名，标记当前用户
    result = []
    for i, e in enumerate(entries):
        d = e.to_dict()
        d['rank'] = i + 1
        if user_id and e.user_id == user_id:
            d['_isYou'] = True
        result.append(d)

    return {
        "week_start": week_start,
        "sort_by": sort_by,
        "entries": result,
        "total": len(result)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
