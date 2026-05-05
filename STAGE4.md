# BrowseMind - 第四阶段完成 ✅

## 项目进度

- ✅ 第一阶段：插件基础架构和数据采集
- ✅ 第二阶段：数据处理和智能分类
- ✅ 第三阶段：图表可视化
- ✅ 第四阶段：后端服务
- ⏳ 第五阶段：AI分析
- ⏳ 第六阶段：高级功能

## 第四阶段新增功能

### 1. FastAPI 后端服务

**核心功能**
- ✅ RESTful API 接口
- ✅ SQLite 数据库存储
- ✅ 批量数据上传
- ✅ 浏览数据分析
- ✅ 分类统计
- ✅ 热门网站排行
- ✅ CORS 跨域支持
- ✅ 自动 API 文档（Swagger UI）

**技术栈**
- FastAPI 0.104.1
- Uvicorn（ASGI 服务器）
- SQLAlchemy（ORM）
- Pydantic（数据验证）
- SQLite（数据库）

### 2. 数据库设计

**browsing_records 表**
```sql
CREATE TABLE browsing_records (
    id INTEGER PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    domain VARCHAR(255),
    category VARCHAR(50),
    visit_time DATETIME NOT NULL,
    duration INTEGER DEFAULT 0,
    date VARCHAR(10),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引优化
CREATE INDEX idx_user_id ON browsing_records(user_id);
CREATE INDEX idx_date ON browsing_records(date);
CREATE INDEX idx_category ON browsing_records(category);
```

**analysis_reports 表**
```sql
CREATE TABLE analysis_reports (
    id INTEGER PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    report_date VARCHAR(10) NOT NULL,
    report_type VARCHAR(50) DEFAULT 'daily',
    total_visits INTEGER DEFAULT 0,
    total_duration INTEGER DEFAULT 0,
    unique_domains INTEGER DEFAULT 0,
    category_stats TEXT,
    ai_summary TEXT,
    ai_issues TEXT,
    ai_suggestions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3. API 接口

#### POST /api/upload
上传浏览数据（批量）

**请求**:
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

#### GET /api/records/{user_id}
获取用户浏览记录

**参数**:
- `user_id`: 用户ID
- `days`: 最近N天（默认7）

#### GET /api/analysis/{user_id}
获取分析结果

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

#### GET /api/stats/{user_id}
获取统计概览

#### DELETE /api/records/{user_id}
删除用户记录

### 4. 数据同步模块

**dataSync.js**
- ✅ 自动生成用户ID
- ✅ 上传本地数据到服务器
- ✅ 从服务器获取分析
- ✅ 检查服务器连接
- ✅ 错误处理

**核心方法**:
```javascript
class DataSync {
  async initUserId()           // 初始化用户ID
  async uploadData(records)    // 上传数据
  async getAnalysis(days)      // 获取分析
  async getStats()             // 获取统计
  async syncLocalData()        // 同步本地数据
  async checkConnection()      // 检查连接
}
```

### 5. 插件集成

**新增功能**
- ✅ "同步到云端"按钮
- ✅ 一键上传本地数据
- ✅ 连接状态检测
- ✅ 同步进度提示
- ✅ 错误提示

**使用流程**:
1. 用户点击"同步到云端"按钮
2. 检查服务器连接
3. 上传本地浏览数据
4. 显示同步结果

### 6. 测试工具

**test_api.py**
- ✅ 自动生成测试数据
- ✅ 测试所有 API 接口
- ✅ 验证响应格式
- ✅ 输出测试报告

**测试覆盖**:
- 根路径测试
- 数据上传测试
- 记录查询测试
- 分析统计测试
- 概览统计测试

## 安装和使用

### 1. 安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2. 启动后端服务

**Windows**:
```bash
start.bat
```

**Linux/Mac**:
```bash
bash start.sh
```

**或直接运行**:
```bash
python main.py
```

服务启动在 `http://localhost:8000`

### 3. 查看 API 文档

浏览器访问：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### 4. 测试 API

```bash
python test_api.py
```

### 5. 使用插件同步

1. 确保后端服务已启动
2. 打开 Chrome 插件
3. 点击"同步到云端"按钮
4. 等待同步完成

## 项目结构

```
BrowseMind/
├── backend/                    ⭐ 新增
│   ├── main.py                # FastAPI 主应用
│   ├── database.py            # 数据库模型
│   ├── schemas.py             # Pydantic 模型
│   ├── requirements.txt       # Python 依赖
│   ├── start.sh              # 启动脚本（Linux/Mac）
│   ├── start.bat             # 启动脚本（Windows）
│   ├── test_api.py           # API 测试
│   ├── browsemind.db         # SQLite 数据库（自动生成）
│   └── README.md             # 后端文档
├── manifest.json
├── background.js
├── dataProcessor.js
├── dataSync.js               ⭐ 新增
├── popup.html                # 已更新（添加同步按钮）
├── popup.js                  # 已更新（添加同步功能）
├── test.html
├── icons/
└── README.md
```

## 技术实现

### 1. 数据上传流程

```
插件端                     后端
  ↓                         ↓
获取本地数据              接收请求
  ↓                         ↓
转换格式                  验证数据
  ↓                         ↓
POST /api/upload          检查重复
  ↓                         ↓
等待响应                  保存到数据库
  ↓                         ↓
显示结果                  返回结果
```

### 2. 用户ID生成

```javascript
// 首次使用时生成
userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
// 示例: user_1714896000000_k3j2h9x4p

// 存储到 chrome.storage.local
await chrome.storage.local.set({ userId });
```

### 3. 数据去重策略

```python
# 检查是否已存在
existing = db.query(BrowsingRecord).filter(
    BrowsingRecord.user_id == user_id,
    BrowsingRecord.url == url,
    BrowsingRecord.date == date
).first()

if existing:
    # 更新停留时间（取最大值）
    if duration > existing.duration:
        existing.duration = duration
```

### 4. 分类统计算法

```python
# 按分类聚合
category_stats = {}
for record in records:
    category = record.category or 'other'
    if category not in category_stats:
        category_stats[category] = {
            'visits': 0,
            'total_duration': 0,
            'domains': set()
        }
    category_stats[category]['visits'] += 1
    category_stats[category]['total_duration'] += record.duration
    category_stats[category]['domains'].add(record.domain)

# 计算占比
for category, stats in category_stats.items():
    percentage = (stats['total_duration'] / total_duration * 100)
```

## 性能优化

### 1. 数据库索引

```python
# 在常用查询字段上创建索引
user_id = Column(String(100), index=True)
date = Column(String(10), index=True)
category = Column(String(50), index=True)
visit_time = Column(DateTime, index=True)
```

### 2. 批量插入

```python
# 一次性插入多条记录
db.add_all(records)
db.commit()
```

### 3. 连接检查

```javascript
// 5秒超时
const response = await fetch(url, { timeout: 5000 });
```

## 安全考虑

### 1. CORS 配置

```python
# 生产环境应限制具体域名
allow_origins=["chrome-extension://your-extension-id"]
```

### 2. 数据验证

```python
# 使用 Pydantic 自动验证
class BrowsingRecordCreate(BaseModel):
    url: str
    duration: int = 0
    # 自动验证类型和必填项
```

### 3. SQL 注入防护

```python
# 使用 SQLAlchemy ORM，自动防止 SQL 注入
db.query(BrowsingRecord).filter(
    BrowsingRecord.user_id == user_id  # 参数化查询
)
```

## 常见问题

**Q: 同步失败，提示无法连接服务器？**

A: 确保后端服务已启动，检查端口 8000 是否被占用。

**Q: 数据上传成功但查询不到？**

A: 检查 user_id 是否一致，查看 `chrome.storage.local` 中的 userId。

**Q: 如何查看数据库内容？**

A: 使用 SQLite 客户端打开 `backend/browsemind.db`。

**Q: 如何重置数据？**

A: 删除 `browsemind.db` 文件，重启服务会自动创建新数据库。

**Q: 可以部署到云服务器吗？**

A: 可以，修改插件中的 API 地址为服务器地址即可。

## API 文档截图

访问 http://localhost:8000/docs 可以看到：

- 所有 API 接口列表
- 请求参数说明
- 响应格式示例
- 在线测试功能

## 下一步计划

第五阶段将实现：
- AI 分析接口
- 调用 OpenAI/DeepSeek API
- 生成行为总结
- 识别问题行为
- 提供优化建议
- 生成每日/每周报告

## 技术亮点

1. **RESTful 设计**：标准的 REST API 接口
2. **自动文档**：FastAPI 自动生成 Swagger UI
3. **类型安全**：Pydantic 数据验证
4. **ORM 映射**：SQLAlchemy 简化数据库操作
5. **异步支持**：FastAPI 原生支持异步
6. **跨域支持**：CORS 中间件配置
7. **错误处理**：统一的异常处理机制

## 文件大小

- `main.py`: ~8KB
- `database.py`: ~4KB
- `schemas.py`: ~2KB
- `dataSync.js`: ~3KB
- `browsemind.db`: 动态增长

总计：~17KB（不含数据库）
