"""
BrowseMind 后端服务 - Pydantic 模型
"""

from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class BrowsingRecordCreate(BaseModel):
    """创建浏览记录的请求模型"""
    url: str
    title: Optional[str] = None
    domain: Optional[str] = None
    category: Optional[str] = None
    visit_time: int  # 时间戳（毫秒）
    duration: int = 0
    date: str  # YYYY-MM-DD


class BrowsingRecordBatch(BaseModel):
    """批量上传浏览记录"""
    user_id: str = Field(..., description="用户唯一标识")
    records: List[BrowsingRecordCreate]


class BrowsingRecordResponse(BaseModel):
    """浏览记录响应模型"""
    id: int
    user_id: str
    url: str
    title: Optional[str]
    domain: Optional[str]
    category: Optional[str]
    visit_time: str
    duration: int
    date: str
    created_at: str

    class Config:
        from_attributes = True


class CategoryStat(BaseModel):
    """分类统计"""
    category: str
    visits: int
    total_duration: int
    percentage: float
    unique_domains: int


class AnalysisResponse(BaseModel):
    """分析结果响应"""
    user_id: str
    date_range: str
    total_visits: int
    total_duration: int
    unique_domains: int
    category_stats: List[CategoryStat]
    top_domains: List[dict]


class AIAnalysisRequest(BaseModel):
    """AI分析请求"""
    user_id: str
    date: str  # YYYY-MM-DD
    category_stats: List[CategoryStat]
    total_duration: int
    top_domains: List[dict]


class AIAnalysisResponse(BaseModel):
    """AI分析响应"""
    summary: str
    issues: List[str]
    suggestions: List[str]
    category_stats: Optional[List[CategoryStat]] = None
    top_domains: Optional[List[dict]] = None


class SuccessResponse(BaseModel):
    """成功响应"""
    success: bool
    message: str
    data: Optional[dict] = None


class UserGoalCreate(BaseModel):
    """创建用户目标"""
    goal_type: str = Field(..., description="目标类型：daily_learning, daily_entertainment等")
    category: str = Field(..., description="关联分类：learning, entertainment等")
    target_duration: int = Field(..., description="目标时长（秒）", gt=0)
    date: str = Field(..., description="日期 YYYY-MM-DD")


class UserGoalUpdate(BaseModel):
    """更新用户目标"""
    target_duration: Optional[int] = Field(None, description="目标时长（秒）", gt=0)
    current_progress: Optional[int] = Field(None, description="当前进度（秒）", ge=0)
    is_active: Optional[int] = Field(None, description="是否激活")
    notified: Optional[int] = Field(None, description="是否已通知")


class UserGoalResponse(BaseModel):
    """用户目标响应"""
    id: int
    user_id: str
    goal_type: str
    category: str
    target_duration: int
    current_progress: int
    date: str
    is_active: int
    notified: int
    progress_percentage: float
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True
