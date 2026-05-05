"""
BrowseMind 后端服务 - 数据库模型
"""

from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

Base = declarative_base()


class BrowsingRecord(Base):
    """浏览记录模型"""
    __tablename__ = 'browsing_records'

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

    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        """转换为字典"""
        import json
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
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


# 数据库引擎和会话
DATABASE_URL = "sqlite:///./browsemind.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """初始化数据库"""
    Base.metadata.create_all(bind=engine)
    print("数据库初始化完成")


def get_db():
    """获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
