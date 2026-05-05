# BrowseMind 后端服务

基于 FastAPI 的浏览行为分析后端服务。

## 功能特性

- ✅ RESTful API 接口
- ✅ SQLite 数据库存储
- ✅ 批量数据上传
- ✅ 浏览数据分析
- ✅ 分类统计
- ✅ 热门网站排行
- ✅ CORS 跨域支持
- ✅ 自动 API 文档

## 技术栈

- **框架**: FastAPI 0.104.1
- **服务器**: Uvicorn
- **数据库**: SQLite + SQLAlchemy
- **数据验证**: Pydantic

## 安装步骤

### 1. 创建虚拟环境（推荐）

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# Linux/Mac
python3 -m venv venv
source venv/bin/activate
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 启动服务

**方式1：使用启动脚本**

```bash
# Windows
start.bat

# Linux/Mac
bash start.sh
```

**方式2：直接运行**

```bash
python main.py
```

服务将在 `http://localhost:8000` 启动。

## API 文档

启动服务后访问：

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## API 接口

### 1. 根路径

```
GET /
```

返回服务状态。

### 2. 上传浏览数据

```
POST /api/upload
```

**请求体**:
```json
{
  "user_id": "user_123",
  "records": [
    {
      "url": "https://github.com",
      "title": "GitHub",
      "domain": "github.com",
      "category": "coding",
      "visit_time": 1714896000000,
      "duration": 300,
      "date": "2026-05-05"
    }
  ]
}
```

**响应**:
```json
{
  "success": true,
  "message": "成功上传 1 条记录",
  "data": {
    "saved_count": 1,
    "total_count": 1
  }
}
```

### 3. 获取浏览记录

```
GET /api/records/{user_id}?days=7
```

**参数**:
- `user_id`: 用户ID
- `days`: 获取最近N天的数据（默认7天）

**响应**:
```json
[
  {
    "id": 1,
    "user_id": "user_123",
    "url": "https://github.com",
    "title": "GitHub",
    "domain": "github.com",
    "category": "coding",
    "visit_time": "2026-05-05T10:30:00",
    "duration": 300,
    "date": "2026-05-05",
    "created_at": "2026-05-05T10:35:00"
  }
]
```

### 4. 获取分析结果

```
GET /api/analysis/{user_id}?days=7
```

**参数**:
- `user_id`: 用户ID
- `days`: 分析最近N天的数据（默认7天）

**响应**:
```json
{
  "user_id": "user_123",
  "date_range": "7天",
  "total_visits": 150,
  "total_duration": 18000,
  "unique_domains": 25,
  "category_stats": [
    {
      "category": "coding",
      "visits": 50,
      "total_duration": 6000,
      "percentage": 33.3,
      "unique_domains": 5
    }
  ],
  "top_domains": [
    {
      "domain": "github.com",
      "visits": 30,
      "total_duration": 3600
    }
  ]
}
```

### 5. 获取统计概览

```
GET /api/stats/{user_id}
```

**响应**:
```json
{
  "user_id": "user_123",
  "today": {
    "visits": 20,
    "duration": 2400
  },
  "week": {
    "visits": 150,
    "duration": 18000,
    "unique_domains": 25
  },
  "total": {
    "records": 500
  }
}
```

### 6. 删除浏览记录

```
DELETE /api/records/{user_id}?days=30
```

**参数**:
- `user_id`: 用户ID
- `days`: 删除N天前的数据（不传则删除全部）

**响应**:
```json
{
  "success": true,
  "message": "成功删除 100 条记录",
  "data": {
    "deleted_count": 100
  }
}
```

## 数据库结构

### browsing_records 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer | 主键 |
| user_id | String(100) | 用户ID |
| url | Text | 完整URL |
| title | Text | 页面标题 |
| domain | String(255) | 域名 |
| category | String(50) | 分类 |
| visit_time | DateTime | 访问时间 |
| duration | Integer | 停留时间（秒） |
| date | String(10) | 日期 YYYY-MM-DD |
| created_at | DateTime | 创建时间 |

### analysis_reports 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer | 主键 |
| user_id | String(100) | 用户ID |
| report_date | String(10) | 报告日期 |
| report_type | String(50) | 报告类型 |
| total_visits | Integer | 总访问次数 |
| total_duration | Integer | 总时长（秒） |
| unique_domains | Integer | 独立网站数 |
| category_stats | Text | 分类统计（JSON） |
| ai_summary | Text | AI总结 |
| ai_issues | Text | AI问题 |
| ai_suggestions | Text | AI建议 |
| created_at | DateTime | 创建时间 |

## 测试

运行测试脚本：

```bash
python test_api.py
```

测试内容：
- ✅ 服务连接
- ✅ 数据上传
- ✅ 记录查询
- ✅ 分析统计
- ✅ 概览统计

## 项目结构

```
backend/
├── main.py              # 主应用
├── database.py          # 数据库模型
├── schemas.py           # Pydantic 模型
├── requirements.txt     # 依赖列表
├── start.sh            # 启动脚本（Linux/Mac）
├── start.bat           # 启动脚本（Windows）
├── test_api.py         # API 测试脚本
├── browsemind.db       # SQLite 数据库（自动生成）
└── README.md           # 说明文档
```

## 配置

### 修改端口

编辑 `main.py` 最后一行：

```python
uvicorn.run(app, host="0.0.0.0", port=8000)  # 修改 port 参数
```

### 修改数据库

编辑 `database.py`：

```python
DATABASE_URL = "sqlite:///./browsemind.db"  # 修改数据库路径
```

### CORS 配置

编辑 `main.py` 的 CORS 中间件：

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## 常见问题

**Q: 启动失败，提示端口被占用？**

A: 修改端口或关闭占用 8000 端口的程序。

**Q: 数据库文件在哪里？**

A: 在 `backend/browsemind.db`，使用 SQLite 客户端可以查看。

**Q: 如何重置数据库？**

A: 删除 `browsemind.db` 文件，重启服务会自动创建新数据库。

**Q: 如何部署到生产环境？**

A: 使用 Gunicorn + Nginx，配置 HTTPS，限制 CORS 域名。

## 性能优化

- 使用索引加速查询（user_id, date, category）
- 批量插入数据
- 定期清理旧数据
- 使用连接池

## 安全建议

- 添加用户认证（JWT）
- 限制 CORS 域名
- 使用 HTTPS
- 添加请求频率限制
- 验证输入数据

## 下一步

第五阶段将实现：
- AI 分析接口
- 调用 OpenAI/DeepSeek API
- 生成行为报告
- 优化建议
