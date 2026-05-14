"""
BrowseMind 后端服务 - 数据库模型
"""

import json

from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, Index, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

Base = declarative_base()


class BrowsingRecord(Base):
    """浏览记录模型"""
    __tablename__ = 'browsing_records'
    __table_args__ = (
        Index('ix_browsing_records_user_time', 'user_id', 'visit_time'),
        Index('ix_browsing_records_user_date', 'user_id', 'date'),
        Index('ix_browsing_records_user_url_time', 'user_id', 'url', 'visit_time'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(100), nullable=False, index=True)  # 用户标识
    url = Column(Text, nullable=False)
    title = Column(Text)
    domain = Column(String(255), index=True)
    category = Column(String(50), index=True)
    visit_time = Column(DateTime, nullable=False, index=True)
    duration = Column(Integer, default=0)  # 停留时间（秒）
    date = Column(String(10), index=True)  # YYYY-MM-DD
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'url': self.url,
            'title': self.title,
            'domain': self.domain,
            'category': self.category,
            'visit_time': self.visit_time.isoformat() if self.visit_time else None,
            'duration': self.duration,
            'date': self.date,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class AnalysisReport(Base):
    """分析报告模型"""
    __tablename__ = 'analysis_reports'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(100), nullable=False, index=True)
    report_date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    report_type = Column(String(50), default='daily')  # daily, weekly, monthly

    # 统计数据
    total_visits = Column(Integer, default=0)
    total_duration = Column(Integer, default=0)  # 秒
    unique_domains = Column(Integer, default=0)

    # 分类统计（JSON格式存储）
    category_stats = Column(Text)  # JSON string

    # AI分析结果
    ai_summary = Column(Text)  # AI生成的总结
    ai_issues = Column(Text)  # AI识别的问题
    ai_suggestions = Column(Text)  # AI建议

    # 热门网站（JSON格式存储）
    top_domains = Column(Text)  # JSON string

    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'report_date': self.report_date,
            'report_type': self.report_type,
            'total_visits': self.total_visits,
            'total_duration': self.total_duration,
            'unique_domains': self.unique_domains,
            'category_stats': json.loads(self.category_stats) if self.category_stats else {},
            'ai_summary': self.ai_summary,
            'ai_issues': self.ai_issues,
            'ai_suggestions': self.ai_suggestions,
            'top_domains': json.loads(self.top_domains) if self.top_domains else [],
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class UserGoal(Base):
    """用户目标模型"""
    __tablename__ = 'user_goals'
    __table_args__ = (
        Index('ix_user_goals_user_date_active', 'user_id', 'date', 'is_active'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(100), nullable=False, index=True)
    goal_type = Column(String(50), nullable=False)  # daily_learning, daily_entertainment, etc.
    category = Column(String(50))  # 关联的分类（learning, entertainment等）
    target_duration = Column(Integer, nullable=False)  # 目标时长（秒）
    current_progress = Column(Integer, default=0)  # 当前进度（秒）
    date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    is_active = Column(Integer, default=1)  # 是否激活（1=是，0=否）
    notified = Column(Integer, default=0)  # 是否已通知（1=是，0=否）
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'goal_type': self.goal_type,
            'category': self.category,
            'target_duration': self.target_duration,
            'current_progress': self.current_progress,
            'date': self.date,
            'is_active': self.is_active,
            'notified': self.notified,
            'progress_percentage': round((self.current_progress / self.target_duration * 100), 1) if self.target_duration > 0 else 0,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class UserToken(Base):
    """用户认证 Token"""
    __tablename__ = 'user_tokens'

    id = Column(Integer, primary_key=True, autoincrement=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(String(100), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, default=datetime.utcnow)


class UserSettings(Base):
    """用户设置（云端同步）"""
    __tablename__ = 'user_settings'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(100), unique=True, nullable=False, index=True)
    settings_json = Column(Text, nullable=False, default='{}')
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# 数据库引擎和会话
DATABASE_URL = "sqlite:///./browsemind.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """初始化数据库"""
    Base.metadata.create_all(bind=engine)

    # 增量迁移：为已有表补上新增列（create_all 不会 ALTER）
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE analysis_reports ADD COLUMN top_domains TEXT"))
            conn.commit()
            print("迁移：已添加 analysis_reports.top_domains 列")
        except Exception as e:
            if "duplicate column" not in str(e).lower():
                print(f"迁移警告: {e}")

    print("数据库初始化完成")


def get_db():
    """获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
