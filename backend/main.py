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

from database import init_db, get_db, BrowsingRecord, AnalysisReport, UserGoal, UserToken, UserSettings, UserClassificationRule
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

# 写操作路径前缀（需要认证）
WRITE_PATHS = ['/api/upload', '/api/goals', '/api/ai-analysis', '/api/export']
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

        # 首次使用时自动注册 token（绑定到 user_id）
        # 从请求体或路径中提取 user_id
        db = SessionLocal()
        try:
            existing = db.query(UserToken).filter(UserToken.token == token).first()
            if not existing:
                # 尝试从 URL 路径提取 user_id
                user_id = None
                parts = path.strip('/').split('/')
                for i, part in enumerate(parts):
                    if part in ('upload', 'goals', 'ai-analysis', 'export') and i > 0:
                        user_id = parts[i + 1] if i + 1 < len(parts) else None
                        break
                if not user_id:
                    # 从请求体提取（需要消费 body）
                    body = await request.body()
                    try:
                        data = json.loads(body)
                        user_id = data.get('user_id')
                    except:
                        pass
                    # 重建 request body（已被消费）
                    async def receive():
                        return {"type": "http.request", "body": body}
                    request._receive = receive

                if user_id:
                    new_token = UserToken(token=token, user_id=user_id)
                    db.add(new_token)
                    db.commit()
                    print(f"注册新 token: {token[:8]}... -> {user_id}")
        finally:
            db.close()

        return await call_next(request)


app.add_middleware(AuthMiddleware)


@app.on_event("startup")
async def startup_event():
    """启动时初始化数据库并清理过期数据"""
    init_db()
    cleanup_expired_data()
    print("BrowseMind 后端服务已启动")


# 数据保留天数（与前端 dataRetentionDays 默认值对齐）
DATA_RETENTION_DAYS = int(os.environ.get('DATA_RETENTION_DAYS', '30'))


def cleanup_expired_data():
    """清理超过保留期的浏览记录和报告"""
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

        db.commit()
        if deleted_records or deleted_reports or deleted_goals:
            print(f"TTL 清理：记录 {deleted_records} 条，报告 {deleted_reports} 条，目标 {deleted_goals} 条")
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
            existing = db.query(BrowsingRecord).filter(
                BrowsingRecord.user_id == batch.user_id,
                BrowsingRecord.url == record_data.url,
                BrowsingRecord.visit_time == datetime.fromtimestamp(record_data.visit_time / 1000)
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
                db.commit()
                continue

            # 创建新记录
            record = BrowsingRecord(
                user_id=batch.user_id,
                url=record_data.url,
                title=record_data.title,
                domain=record_data.domain,
                category=record_data.category,
                visit_time=datetime.fromtimestamp(record_data.visit_time / 1000),
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
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@app.get("/api/records/{user_id}", response_model=List[BrowsingRecordResponse])
async def get_user_records(
    user_id: str,
    days: int = 7,
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
        raise HTTPException(status_code=500, detail=f"AI 分析失败: {str(e)}")


@app.get("/api/reports/{user_id}")
async def get_user_reports(
    user_id: str,
    limit: int = 10,
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
    days: int = 7,
    blackhole_threshold: int = 30,
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
    is_active: int = None,
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
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    if settings:
        settings.settings_json = json.dumps(body, ensure_ascii=False)
        settings.updated_at = datetime.utcnow()
    else:
        settings = UserSettings(user_id=user_id, settings_json=json.dumps(body, ensure_ascii=False))
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
    rules = db.query(UserClassificationRule).filter(UserClassificationRule.user_id == user_id).first()
    if rules:
        rules.rules_json = json.dumps(body, ensure_ascii=False)
        rules.updated_at = datetime.utcnow()
    else:
        rules = UserClassificationRule(user_id=user_id, rules_json=json.dumps(body, ensure_ascii=False))
        db.add(rules)
    db.commit()
    return {"success": True, "updated_at": rules.updated_at.isoformat()}


# ==================== 数据导出 ====================

@app.get("/api/export/{user_id}")
def export_user_data(
    user_id: str,
    format: str = Query("json", regex="^(json|csv)$"),
    days: int = Query(0, ge=0, description="导出天数，0=全部"),
    db: Session = Depends(get_db)
):
    """导出用户全部数据（JSON 或 CSV）"""
    query = db.query(BrowsingRecord).filter(BrowsingRecord.user_id == user_id)
    if days > 0:
        cutoff = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
