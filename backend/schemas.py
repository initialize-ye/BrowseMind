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


class AIAnalysisResponse(BaseModel):
    """AI分析响应"""
    summary: str
    issues: List[str]
    suggestions: List[str]


class SuccessResponse(BaseModel):
    """成功响应"""
    success: bool
    message: str
    data: Optional[dict] = None
