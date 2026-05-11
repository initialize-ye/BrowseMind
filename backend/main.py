"""
BrowseMind 后端服务 - 主应用
"""

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List
import json
import os

from database import init_db, get_db, BrowsingRecord, AnalysisReport, UserGoal
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

# 配置 CORS（允许浏览器插件访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """启动时初始化数据库"""
    init_db()
    print("BrowseMind 后端服务已启动")


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
            # 检查是否已存在（避免重复）
            existing = db.query(BrowsingRecord).filter(
                BrowsingRecord.user_id == batch.user_id,
                BrowsingRecord.url == record_data.url,
                BrowsingRecord.date == record_data.date
            ).first()

            if existing:
                # 更新停留时间（取最大值）
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


@app.delete("/api/records/{user_id}")
async def delete_user_records(
    user_id: str,
    days: int = None,
    db: Session = Depends(get_db)
):
    """
    删除用户的浏览记录

    - user_id: 用户ID
    - days: 删除N天前的数据（不传则删除全部）
    """
    query = db.query(BrowsingRecord).filter(BrowsingRecord.user_id == user_id)

    if days:
        cutoff_date = datetime.now() - timedelta(days=days)
        query = query.filter(BrowsingRecord.visit_time < cutoff_date)

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
            report_type='ai_analysis',
            total_visits=len(records),
            total_duration=total_duration,
            unique_domains=len(set(r.domain for r in records if r.domain)),
            category_stats=json.dumps(category_stats, ensure_ascii=False),
            ai_summary=result['summary'],
            ai_issues=json.dumps(result['issues'], ensure_ascii=False),
            ai_suggestions=json.dumps(result['suggestions'], ensure_ascii=False)
        )

        db.add(report)
        db.commit()

        return AIAnalysisResponse(
            summary=result['summary'],
            issues=result['issues'],
            suggestions=result['suggestions']
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 分析失败: {str(e)}")


@app.get("/api/reports/{user_id}")
async def get_user_reports(
    user_id: str,
    limit: int = 10,
    db: Session = Depends(get_db)
):
    """
    获取用户的历史分析报告

    - user_id: 用户ID
    - limit: 返回数量（默认10条）
    """
    reports = db.query(AnalysisReport).filter(
        AnalysisReport.user_id == user_id
    ).order_by(AnalysisReport.created_at.desc()).limit(limit).all()

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
