# 识途知识库系统（Scene Knowledge Base）— Code Wiki

> **版本**：v1.0 | **生成日期**：2026-07-29 | **目标读者**：开发者、运维人员、代码审查者

---

## 目录

1. [项目概览](#1-项目概览)
2. [系统架构](#2-系统架构)
3. [目录结构与模块划分](#3-目录结构与模块划分)
4. [入口文件：server.js](#4-入口文件serverjs)
5. [配置管理：config.js](#5-配置管理configjs)
6. [数据库层（db/）](#6-数据库层db)
7. [中间件层（middleware/）](#7-中间件层middleware)
8. [服务层（services/）](#8-服务层services)
9. [路由层（routes/）](#9-路由层routes)
10. [工具层（utils/）](#10-工具层utils)
11. [Prompt 资产（prompts/）](#11-prompt-资产prompts)
12. [前端（public/index.html）](#12-前端publicindexhtml)
13. [脚本与测试（scripts/ & test/）](#13-脚本与测试scripts--test)
14. [部署（deploy/）](#14-部署deploy)
15. [依赖关系图](#15-依赖关系图)
16. [项目运行方式](#16-项目运行方式)

---

## 1. 项目概览

### 1.1 项目定位

**识途知识库系统**是一个基于 AI 自然语言交互的企业内部知识库管理平台。员工通过对话方式录入、查询和管理知识，AI 充当"数据库管理员"的角色，将自然语言转化为 MySQL 操作。

### 1.2 技术栈

| 层级 | 技术 | 版本要求 |
|------|------|---------|
| 前端 | 原生 HTML5 / CSS3 / JavaScript（无框架） | - |
| 后端 | Node.js + Express 4.x | Node ≥ 18 |
| 数据库 | MySQL（mysql2/promise 驱动） | 8.0+ |
| AI API | OpenAI 兼容 Chat Completions | DeepSeek / GPT / Qwen |
| 认证 | JWT（jsonwebtoken） | 8h 过期 |
| SQL 解析 | node-sql-parser | 4.x |
| 安全 | helmet + bcrypt + 5 层 SQL 白名单 | - |
| 部署 | Nginx + PM2 | Nginx 1.31+ / PM2 7+ |

### 1.3 核心设计哲学

- **AI 不直连数据库**：AI 生成 SQL 文本，后端做安全校验后再执行
- **5 层 SQL 安全校验**：操作类型白名单 → 表名白名单 → 禁止 DDL → 禁止多语句 → 事务包装
- **单文件前端**：一个 HTML 文件包含所有功能，零依赖
- **全流程审计**：所有写操作写入 `kb_audit_log`

---

## 2. 系统架构

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────┐
│                  浏览器 (index.html)                     │
│            [对话] [知识库] [审核] [管理] [设置]              │
└──────────────┬──────────────────────────────────────────┘
               │ HTTP (REST JSON)
               ▼
┌─────────────────────────────────────────────────────────┐
│              Nginx (反向代理 + 静态文件)                    │
│                :80 → :3000 (API)                         │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│              Express 应用 (server.js)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │middleware│ │ routes/  │ │services/ │ │  utils/  │   │
│  │ auth.js  │ │ auth.js  │ │  ai.js   │ │errors.js │   │
│  │rate-limit│ │ chat.js  │ │session.js│ │response  │   │
│  │ helmet   │ │entries.js│ │prompt-bld│ │password  │   │
│  │  morgan  │ │review.js │ │sql-exec  │ │pagination│   │
│  │          │ │ admin.js │ │ search.js│ │          │   │
│  │          │ │ stats.js │ │          │ │          │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                         │                               │
│                    db/connection.js                      │
│                   (mysql2 pool)                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                    MySQL 8.0                              │
│  kb_entries │ kb_tags │ kb_version_history                │
│  kb_audit_log │ kb_users │ kb_code_sequence               │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│          AI API (OpenAI 兼容 Chat Completions)            │
│        DeepSeek / GPT-4o / 通义千问 / Claude              │
└─────────────────────────────────────────────────────────┘
```

### 2.2 核心数据流：AI 对话录入知识

```
用户输入 → POST /api/chat → 加载会话上下文
  → prompt-builder 构建 System Prompt + 历史 + 当前消息
  → callAI() 调用 AI API → 解析 ```sql``` 代码块
  → 分支A：无SQL → 追问文本 → 返回前端
  → 分支B：有SQL → 替换占位符 → 5层安全校验
  → 事务内：原子生成 entry_code → 执行所有SQL
  → 副作用：audit_log / version_history
  → 返回 entry_created / entry_updated / query_result
```

### 2.3 数据模型（6 张表）

| 表名 | 用途 | 关键关系 |
|------|------|---------|
| `kb_entries` | 知识条目主表 | 核心表，存储所有知识 |
| `kb_tags` | 标签管理 | 1:N 到 kb_entries，CASCADE |
| `kb_version_history` | 版本快照 | 1:N 到 kb_entries，CASCADE |
| `kb_audit_log` | 操作审计 | 1:N 到 kb_entries，SET NULL |
| `kb_users` | 用户管理 | 独立表 |
| `kb_code_sequence` | 编码序列 | 原子递增，用于 entry_code 生成 |

---

## 3. 目录结构与模块划分

```
kb-server/
├── server.js                  # 应用入口，Express 实例化、中间件注册、路由挂载
├── config.js                  # 环境变量读取与校验，导出配置对象
├── package.json               # 依赖声明与 npm scripts
├── .env.example               # 环境变量模板
├── .gitignore                 # Git 忽略规则
│
├── db/                        # 数据库层
│   ├── connection.js          # mysql2 连接池创建与导出
│   ├── schema.sql             # 完整建表 DDL
│   └── migration_*.sql        # 增量迁移脚本
│
├── middleware/                 # 中间件层
│   ├── auth.js                # JWT 认证 + 角色校验
│   └── rate-limiter.js        # 滑动窗口限流器
│
├── routes/                    # 路由层（接口层）
│   ├── auth.js                # 登录、修改密码、登出
│   ├── chat.js                # 核心对话（AI 交互 + SQL 执行）
│   ├── entries.js             # 知识库查询（分页、详情、历史、关联推荐）
│   ├── review.js              # 审核（待审核列表、六维评分）
│   ├── admin.js               # 管理（条目删除/归档、用户管理、CSV 导出、审计日志）
│   └── stats.js               # 统计（4 维聚合，带缓存）
│
├── services/                  # 服务层（核心业务逻辑）
│   ├── ai.js                  # AI API 调用 + SQL 代码块提取
│   ├── sql-executor.js        # 5 层安全校验 + 事务执行
│   ├── session.js             # 会话管理（内存 Map + 文件持久化）
│   ├── prompt-builder.js      # System Prompt 构建
│   └── search.js              # 联网搜索（DuckDuckGo API）
│
├── utils/                     # 工具层
│   ├── errors.js              # 错误码常量定义
│   ├── response.js            # 统一响应格式（sendSuccess/sendError）
│   ├── password.js            # 密码复杂度校验
│   └── pagination.js          # 分页参数安全校验
│
├── prompts/                   # AI Prompt 资产
│   ├── system-base.txt        # System Prompt 模板（角色/规则/防幻觉/输出格式）
│   └── sql-schema.md          # 数据库 Schema 说明（注入到 Prompt）
│
├── public/                    # 前端静态文件
│   └── index.html             # 单页应用（5 Tab 全功能）
│
├── deploy/                    # 部署配置
│   ├── ecosystem.config.js    # PM2 进程守护配置
│   └── nginx.conf             # Nginx 反向代理配置
│
├── scripts/                   # 工具脚本
│   ├── init-admin.js          # 管理员账号初始化
│   ├── test-ai-connection.js  # AI API 连通性测试
│   └── debug-chat.js          # 对话调试
│
└── test/                      # 测试文件
    ├── ai.test.js             # AI 模块单元测试
    ├── sql-executor.test.js   # SQL 执行器测试
    ├── p5-integration.test.js # P5 集成测试
    ├── debug-p5.js            # P5 调试脚本
    └── setup-test-data.js     # 测试数据初始化
```

---

## 4. 入口文件：server.js

**文件路径**：[server.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/server.js)

### 4.1 职责

- 加载配置、创建 Express 实例
- 注册全局中间件（helmet、morgan、CORS、cookie-parser、JSON 解析）
- 挂载所有路由模块
- 启动 HTTP 服务 + 优雅关闭

### 4.2 中间件注册顺序

```javascript
// 1. helmet（安全响应头，CSP 允许 marked.js CDN）
// 2. morgan（HTTP 请求日志，生产环境写文件）
// 3. express.json（1MB 限制）
// 4. express.urlencoded
// 5. cookie-parser
// 6. CORS（允许所有来源，内网部署）
// 7. express.static（前端静态文件）
```

### 4.3 路由挂载

| 挂载路径 | 路由模块 | 鉴权 |
|---------|---------|------|
| `/api/health` | 内联（健康检查：DB + AI API 连通性） | 无 |
| `/api/auth` | auth.js | 部分无（login 公开） |
| `/api/chat` | chat.js | authRequired + chatLimiter |
| `/api/entries` | entries.js | authRequired |
| `/api/review` | review.js | authRequired + requireRole |
| `/api/admin` | admin.js | authRequired + requireRole('admin') |
| `/api/stats` | stats.js | authRequired |

### 4.4 关键函数

- `gracefulShutdown(signal)` — 优雅关闭：停止 HTTP 服务 → 释放数据库连接池 → 10 秒超时强制退出

---

## 5. 配置管理：config.js

**文件路径**：[config.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/config.js)

### 5.1 职责

从 `process.env` 读取环境变量，校验必填项，导出结构化配置对象。

### 5.2 导出结构

```javascript
config = {
  db: { host, port, user, password, database },
  ai: { apiUrl, apiKey, model, timeoutMs: 30000, maxRetries: 1, enableWebSearch, enableThinking },
  jwt: { secret, expiresIn: '8h' },
  port: 3000,
  sessionTimeoutMinutes: 30,
}
```

### 5.3 必填环境变量

`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `AI_API_URL`, `AI_API_KEY`, `AI_MODEL`, `JWT_SECRET`

缺失任一必填变量，启动时直接抛错终止。

---

## 6. 数据库层（db/）

### 6.1 connection.js

**文件路径**：[connection.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/db/connection.js)

**职责**：使用 `mysql2/promise` 创建连接池并导出。

**关键配置**：
- `connectionLimit: 10`
- `waitForConnections: true`
- `charset: 'utf8mb4'`
- `enableKeepAlive: true`（30s 探测，防止长空闲断连）

**导出**：`pool` 对象，供全局使用 `pool.execute()` 执行参数化查询。

### 6.2 schema.sql

**文件路径**：[schema.sql](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/db/schema.sql)

包含 6 张表的完整 DDL（详见下文 2.3 数据模型）。关键设计：

- `kb_entries.version_label`：MySQL 计算列 `CONCAT(major_version,'.',minor_version,'.',patch_version) STORED`
- `kb_entries` 使用 `FULLTEXT INDEX` 配合 `ngram` 解析器，支持中文全文检索
- `kb_code_sequence`：使用 `ON DUPLICATE KEY UPDATE` 实现原子递增，保证并发安全

---

## 7. 中间件层（middleware/）

### 7.1 auth.js

**文件路径**：[auth.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/middleware/auth.js)

#### 导出函数

| 函数 | 签名 | 职责 |
|------|------|------|
| `authRequired` | `(req, res, next)` | JWT 验证 + 用户活跃状态检查 |
| `requireRole` | `(...roles) => (req, res, next)` | 角色校验工厂 |

#### 关键逻辑

1. **Token 提取**：优先 `Authorization: Bearer <token>` → 其次 httpOnly Cookie `token`
2. **JWT 验证**：`jwt.verify(token, secret)`，失败返回 401
3. **活跃状态检查**：查询 `kb_users.is_active`，被禁用用户 token 立即失效
4. **DB 降级**：查询用户状态失败时不阻塞请求（仅打印日志），保证服务可用性
5. **结果挂载**：`req.user = { id, username, role }`

### 7.2 rate-limiter.js

**文件路径**：[rate-limiter.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/middleware/rate-limiter.js)

#### 设计

基于内存 `Map` 的滑动窗口限流，60 秒定时清理过期记录。

#### 工厂函数

| 函数 | 基于 | 用途 |
|------|------|------|
| `createIpLimiter({windowMs, max, message})` | IP 地址 | 登录限流、通用 API 限流 |
| `createUserLimiter({windowMs, max, message})` | 用户 ID | 对话限流 |

#### 预置限流器

| 限流器 | 规则 | 挂载位置 |
|--------|------|---------|
| `loginLimiter` | 1 分钟 5 次/IP | login 路由 |
| `chatLimiter` | 1 分钟 20 次/用户 | chat 路由 |
| `generalLimiter` | 1 分钟 100 次/IP | 通用 |

---

## 8. 服务层（services/）

### 8.1 ai.js

**文件路径**：[ai.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/services/ai.js)

#### 导出函数

| 函数 | 签名 | 职责 |
|------|------|------|
| `callAI` | `(messages, options?) => {replyText, sqlStatements, thinking}` | 调用 AI API，带超时和重试 |
| `extractSqlStatements` | `(text) => string[]` | 从 AI 回复中提取 SQL 代码块 |

#### 关键设计

- **超时与重试**：30 秒超时，仅对超时/5xx 错误重试 1 次
- **正则 lastIndex 修复**：`SQL_BLOCK_PATTERN` 存储为纯字符串，每次调用时创建新 `RegExp` 实例，避免 `g` 标志的 `lastIndex` 状态残留导致跳过匹配
- **推理内容处理**：DeepSeek 的 `reasoning_content` 以 Markdown 代码块格式附加到 `replyText` 前，且在 SQL 提取之后执行
- **联网搜索/深度思考**：需全局配置和请求参数同时为 `true` 才启用

#### SQL 提取逻辑

```javascript
function extractSqlStatements(text) {
  const regex = new RegExp('```sql\\s*([\\s\\S]*?)```', 'gi');
  // 每次创建新实例，避免 lastIndex 残留
}
```

### 8.2 sql-executor.js

**文件路径**：[sql-executor.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/services/sql-executor.js)

系统安全核心，对 AI 生成的 SQL 进行 5 层校验。

#### 导出函数

| 函数 | 签名 | 职责 |
|------|------|------|
| `validateAndExecute` | `(sqlStatements, userId, options?) => {success, results, error?, parsedTypes?, entryCode?}` | 5 层校验 + 事务执行 |

#### 5 层校验

| 校验层 | 函数 | 规则 |
|--------|------|------|
| 1 | `checkOperationType(ast)` | 基于 `node-sql-parser` AST，仅允许 `SELECT/INSERT/UPDATE/DELETE` |
| 2 | `checkTableNames(sql)` | 使用 `parser.tableList()` 提取表名，必须以 `kb_` 开头 |
| 3 | `checkDDL(sql)` | 正则检查首关键字，禁止 `DROP/ALTER/TRUNCATE/GRANT/REVOKE/CREATE` |
| 4 | `checkMultiStatement(sql, ast)` | 去除末尾分号后仍含分号则拒绝；AST 数组长度 > 1 则拒绝 |
| 5 | 事务包装 | 在 `BEGIN TRANSACTION` 中执行所有 SQL，失败全部回滚 |

#### entry_code 原子生成

当 `options.entryCode = true` 时，在事务内执行：

```sql
INSERT INTO kb_code_sequence (date_key, seq) VALUES ('20260729', 1)
ON DUPLICATE KEY UPDATE seq = seq + 1;
```

然后 `SELECT seq` 读取当前值，拼装 `KB-YYYYMMDD-NNN`，替换 SQL 中的 `__ENTRY_CODE__` 占位符。三层并发安全：原子递增 + 事务内生成 + UNIQUE 索引兜底。

#### 安全限制

- 单次最多执行 10 条 SQL（防止 AI 生成过多语句）
- 校验 3（DDL 正则）仅检查首关键字，避免查询条件中的文本（如 `'%create%'`）被误拦截

### 8.3 session.js

**文件路径**：[session.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/services/session.js)

#### 存储方案

- 内存 `Map<sessionId, {messages: [], lastActivity: timestamp}>`
- 文件持久化到 `data/sessions.json`，服务重启后恢复未过期会话

#### 导出函数

| 函数 | 职责 |
|------|------|
| `getSession(sessionId)` | 获取或创建会话 |
| `appendMessage(sessionId, role, content)` | 追加消息，超限从头部截断（最多 40 条 = 20 轮） |
| `clearSession(sessionId)` | 清空消息，保留会话 |
| `getHistory(sessionId)` | 返回历史消息只读副本 |
| `startCleanupTimer()` | 启动定时器：5 分钟清理过期会话 + 5 秒检查脏数据持久化 + 300ms 防抖写入 |

### 8.4 prompt-builder.js

**文件路径**：[prompt-builder.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/services/prompt-builder.js)

#### 导出函数

| 函数 | 签名 | 职责 |
|------|------|------|
| `buildMessages` | `(history, newMessage) => messages[]` | 构建 OpenAI 格式 messages 数组 |
| `getSystemContent` | `() => string` | 读取并缓存 `system-base.txt + sql-schema.md` |
| `clearCache` | `() => void` | 清除缓存（热更新 prompt 时使用） |

#### 输出结构

```javascript
[
  { role: 'system', content: '角色定义 + 规则 + Schema...' },
  ...history.slice(-40),  // 最多保留 20 轮
  { role: 'user', content: '当前用户消息' },
]
```

### 8.5 search.js

**文件路径**：[search.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/services/search.js)

#### 导出函数

| 函数 | 签名 | 职责 |
|------|------|------|
| `search` | `(query) => Promise<string>` | 执行联网搜索，返回格式化结果文本 |

#### 实现

- 使用 DuckDuckGo Instant Answer API（免费，无需 API Key）
- 8 秒超时
- 最多返回 5 条相关结果
- 失败时返回带 `[联网搜索失败]` 前缀的错误信息

---

## 9. 路由层（routes/）

### 9.1 auth.js

**文件路径**：[auth.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/routes/auth.js)

#### 接口

| 方法 | 路径 | 鉴权 | 功能 |
|------|------|------|------|
| `POST` | `/api/auth/login` | loginLimiter | 用户名密码登录，返回 JWT + httpOnly Cookie |
| `POST` | `/api/auth/change-password` | authRequired | 修改密码（需旧密码校验 + 复杂度校验） |
| `POST` | `/api/auth/logout` | 无 | 清除 httpOnly Cookie |
| `GET` | `/api/auth/me` | authRequired | 获取当前用户信息（页面刷新恢复登录状态） |

#### 防暴力破解（P9-T2）

- 连续 5 次登录失败 → 锁定 15 分钟
- 登录成功 → 重置失败计数
- `locked_until` 字段在每次登录时检查，锁定期间拒绝登录

### 9.2 chat.js

**文件路径**：[chat.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/routes/chat.js)

系统最核心接口，实现 6 步对话流程。

#### 接口

| 方法 | 路径 | 鉴权 |
|------|------|------|
| `POST` | `/api/chat` | authRequired + chatLimiter |

#### 请求体

```json
{
  "message": "用户输入",
  "sessionId": "uuid",
  "enableWebSearch": false,
  "enableThinking": false
}
```

#### 响应类型

| type | 触发条件 | 关键字段 |
|------|---------|---------|
| `follow_up` | AI 无 SQL 返回 | `message`（追问文本） |
| `entry_created` | INSERT 成功 | `entry: {id, entry_code, title, status}` |
| `entry_updated` | UPDATE 成功 | `entries: [{id, entry_code, title}]` |
| `entry_deleted` | DELETE 成功 | `message` |
| `query_result` | SELECT 成功 | `results: [...]` |
| `error` | 执行失败 | `message` |

#### 核心辅助函数

| 函数 | 职责 |
|------|------|
| `detectPrimaryType(sqlStatements)` | 检测 SQL 主要操作类型（取第一条非 SELECT 的写操作） |
| `snapshotOldEntriesForUpdate(sqlStatements)` | UPDATE 前查询旧数据用于版本历史快照 |
| `handleInsertSuccess(result, user, ip, replyText)` | INSERT 后：更新状态为 pending_review + 写 audit_log |
| `handleUpdateSuccess(result, oldEntries, user, ip, replyText)` | UPDATE 后：写 version_history + audit_log |
| `handleDeleteSuccess(result, user, ip, replyText)` | DELETE 后：写 audit_log |
| `handleSelectSuccess(result, replyText)` | SELECT 后：合并所有 SELECT 结果 |
| `escapeSqlString(str)` | SQL 字符串转义（占位符替换安全） |
| `injectEntryCode(sql, entryCode, username)` | 将 entry_code 注入 INSERT 语句 |
| `autoContinueInsert(messages, user, clientIp)` | 自动录入：查重通过后自动调用 AI 执行 INSERT |

#### 自动录入机制（P9-T26）

当 AI 返回空 SELECT 结果（查重通过）时，自动再调 AI 执行 INSERT，消除用户手动确认环节，实现"一次发送模板即完成录入"。

### 9.3 entries.js

**文件路径**：[entries.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/routes/entries.js)

#### 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/entries` | 分页查询，支持多维筛选（q/knowledge_type/architecture_layer/scene/status/created_by/日期范围）+ 排序 |
| `GET` | `/api/entries/:id` | 条目详情（含 tags 和 versions） |
| `GET` | `/api/entries/:id/history` | 版本历史列表（分页，不含大字段） |
| `GET` | `/api/entries/:id/history/:versionId` | 版本详情（含 full_content_snapshot） |
| `GET` | `/api/entries/:id/related` | 相关条目推荐（同 scene 优先，同 knowledge_type 次之，排除自身，取 5 条） |

#### 搜索实现

- 优先使用 MySQL `FULLTEXT MATCH ... AGAINST`（ngram 分词）
- 同时使用 `LIKE '%keyword%'` 作为兜底
- 搜索时添加 `MATCH()` 相关性评分字段，按相关性降序排列

### 9.4 review.js

**文件路径**：[review.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/routes/review.js)

#### 接口

| 方法 | 路径 | 鉴权 | 功能 |
|------|------|------|------|
| `GET` | `/api/review/pending` | reviewer, admin | 待审核列表（分页，支持按 knowledge_type/scene 筛选） |
| `POST` | `/api/review/:id` | reviewer, admin | 提交审核决定（approve/reject） |

#### 审核逻辑

- **approve**：必须提供 6 维评分（每维 1-5），自动计算 `score_total`，根据 `review_cycle` 动态计算 `next_review_date`
- **reject**：必须提供审核意见（comment），状态改为 `rejected`
- 使用 `SELECT ... FOR UPDATE` 行锁 + 事务，防止并发审核冲突
- 审核后自动写入 `kb_audit_log`

### 9.5 admin.js

**文件路径**：[admin.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/routes/admin.js)

#### 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| `DELETE` | `/api/admin/entries/:id` | 软删除条目（status 改为 archived） |
| `POST` | `/api/admin/entries/:id/archive` | 归档条目 |
| `GET` | `/api/admin/users` | 用户列表（分页，支持按 role 筛选） |
| `POST` | `/api/admin/users` | 创建用户（密码 bcrypt 加密 + 复杂度校验） |
| `GET` | `/api/admin/entries/export` | 导出 CSV（UTF-8 BOM，兼容 Excel） |
| `GET` | `/api/admin/audit-logs` | 操作日志列表（分页，支持按 action/entry_id 筛选，LEFT JOIN 条目信息） |

### 9.6 stats.js

**文件路径**：[stats.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/routes/stats.js)

#### 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/stats` | 统计（总条目数、按 knowledge_type 分组、按 scene 分组 Top 10、按 status 分组） |

#### 缓存策略

- 60 秒内存缓存，`?refresh=1` 强制刷新
- 确保所有枚举值都有默认值 0（包含 6 种 knowledge_type 和 5 种 status）

---

## 10. 工具层（utils/）

### 10.1 errors.js

**文件路径**：[errors.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/utils/errors.js)

定义 8 个错误码及其 HTTP 状态码：

| 错误码 | HTTP 状态 | 默认消息 |
|--------|-----------|---------|
| `AUTH_REQUIRED` | 401 | 未登录或 token 过期 |
| `FORBIDDEN` | 403 | 权限不足 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `VALIDATION_ERROR` | 400 | 请求参数无效 |
| `SQL_VALIDATION_ERROR` | 400 | AI 生成的 SQL 未通过安全校验 |
| `AI_API_ERROR` | 502 | AI API 调用失败 |
| `DB_ERROR` | 500 | 数据库操作失败 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

导出 `getErrorInfo(code, customMessage)` 辅助函数，支持错误码字符串和错误对象两种传参。

### 10.2 response.js

**文件路径**：[response.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/utils/response.js)

| 函数 | 签名 | 输出格式 |
|------|------|---------|
| `sendSuccess` | `(res, data, message)` | `{success: true, data, message}` |
| `sendError` | `(res, code, customMessage, httpStatus)` | `{success: false, error, code}` |
| `safeErrorMsg` | `(prefix, err)` | 生产环境只返回前缀，开发环境附加详情 |

### 10.3 password.js

**文件路径**：[password.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/utils/password.js)

**导出**：`validatePassword(password) => {valid, message}`

**规则**：至少 8 位，必须包含大写字母、小写字母、数字。

### 10.4 pagination.js

**文件路径**：[pagination.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/utils/pagination.js)

**导出**：`validatePagination(page, limit, maxLimit=100, defaultLimit=20) => {pageNum, limitNum, offset}`

**安全**：确保 page/limit/offset 均为非负整数，防止注入模板字符串。

---

## 11. Prompt 资产（prompts/）

### 11.1 system-base.txt

**文件路径**：[system-base.txt](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/prompts/system-base.txt)

包含 6 个章节：

1. **角色定义**：AI 是知识库唯一管理员，负责理解意图、判断类型、检查完整性、生成 SQL
2. **数据库 Schema**：引用 sql-schema.md
3. **操作规则**：意图分类、完整性检查（7 个必填字段）、结构化追问模板（按 knowledge_type 分 5 种）、自动生成字段规则、知识类型判断、查重规则、UPDATE 规则
4. **防幻觉规则**：最高优先级，绝不编造用户未提供的信息
5. **输出格式**：SQL 用 ` ```sql ``` ` 包裹，追问用自然中文
6. **约束总结**：7 条核心约束

### 11.2 sql-schema.md

**文件路径**：[sql-schema.md](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/prompts/sql-schema.md)

包含完整建表 DDL 和字段语义说明，供 AI 生成 SQL 时参考。明确定义 AI 可操作/不可操作的表。

---

## 12. 前端（public/index.html）

**文件路径**：[index.html](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/public/index.html)

单文件应用，包含 HTML 结构 + CSS 样式 + JavaScript 逻辑，无框架依赖。

### 12.1 5 个 Tab

| Tab | 图标 | 功能 | 可见角色 |
|-----|------|------|---------|
| 对话 | 聊天 | AI 自然语言交互（录入/查询/更新）+ 语音输入 | 全部 |
| 知识库 | 书籍 | 浏览、搜索、筛选、分页、条目详情 | 全部 |
| 审核 | 勾选 | 待审核条目六维评分与审批 | reviewer, admin |
| 管理 | 齿轮 | 用户管理、条目管理、审计日志、CSV 导出 | admin |
| 设置 | 用户 | 修改密码、退出登录 | 全部 |

### 12.2 技术特点

- 语音输入：Web Speech API（Chrome/Edge）
- 登录状态：httpOnly Cookie + localStorage 双通道
- API 调用：原生 `fetch`，统一错误处理
- 消息渲染：Markdown 支持（引入 marked.js CDN）

---

## 13. 脚本与测试（scripts/ & test/）

### 13.1 scripts/

| 文件 | 用途 | 运行方式 |
|------|------|---------|
| [init-admin.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/scripts/init-admin.js) | 初始化管理员账号（幂等） | `npm run init-admin` |
| [test-ai-connection.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/scripts/test-ai-connection.js) | 测试 AI API 连通性 | `npm run test-ai` |
| [debug-chat.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/scripts/debug-chat.js) | 对话调试工具 | `node scripts/debug-chat.js` |

### 13.2 test/

| 文件 | 覆盖范围 |
|------|---------|
| [ai.test.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/test/ai.test.js) | SQL 提取逻辑（18 个测试用例）、正则 lastIndex 修复验证 |
| [sql-executor.test.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/test/sql-executor.test.js) | 5 层安全校验（14 个安全测试） |
| [p5-integration.test.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/test/p5-integration.test.js) | P5 阶段 4 个路由模块集成测试（66/66 通过） |

---

## 14. 部署（deploy/）

### 14.1 ecosystem.config.js

**文件路径**：[ecosystem.config.js](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/deploy/ecosystem.config.js)

PM2 配置：
- 进程名：`kb-server`
- 入口：`server.js`
- 单实例
- 自动重启
- 内存限制：500MB
- 环境变量：`NODE_ENV=production`

### 14.2 nginx.conf

**文件路径**：[nginx.conf](file:///c:/Users/wangt/Documents/trae_projects/Transform_Ai/kb-server/deploy/nginx.conf)

Nginx 配置：
- 80 端口监听
- `/` 路径：前端静态文件（try_files 到 index.html）
- `/api/` 路径：反向代理到 `127.0.0.1:3000`
- `proxy_read_timeout: 60s`（适配 AI 调用延迟）

---

## 15. 依赖关系图

### 15.1 npm 依赖

```
express (^4.19.2)          # Web 框架
mysql2 (^3.11.0)           # MySQL 驱动（Promise 模式）
jsonwebtoken (^9.0.2)      # JWT 签发与验证
bcrypt (^5.1.1)            # 密码哈希
dotenv (^16.4.5)           # 环境变量加载
helmet (^8.3.0)            # 安全响应头
morgan (^1.11.0)           # HTTP 请求日志
cookie-parser (^1.4.7)     # Cookie 解析
node-sql-parser (^4.18.0)  # SQL AST 解析（安全校验核心）
uuid (^9.0.1)              # UUID 生成
```

### 15.2 模块间依赖（导入关系）

```
server.js
  ├── config.js
  ├── db/connection.js
  ├── middleware/auth.js
  ├── middleware/rate-limiter.js
  ├── services/session.js
  ├── utils/response.js
  ├── utils/errors.js
  └── routes/*
        ├── middleware/auth.js
        ├── middleware/rate-limiter.js
        ├── db/connection.js
        ├── utils/response.js
        ├── utils/errors.js
        ├── utils/password.js
        ├── utils/pagination.js
        ├── services/ai.js → config.js
        ├── services/session.js → config.js
        ├── services/prompt-builder.js → prompts/
        ├── services/sql-executor.js → db/connection.js, node-sql-parser
        └── services/search.js → config.js
```

### 15.3 数据流依赖

```
用户请求 → (rate-limiter) → auth.js → routes/*.js
  → prompt-builder → prompts/* (System Prompt)
  → ai.js → AI API (外部)
  → sql-executor (5层校验) → connection.js → MySQL
  → response.js → 用户
```

---

## 16. 项目运行方式

### 16.1 环境要求

- Node.js ≥ 18.x
- MySQL ≥ 8.0
- AI API Key（DeepSeek / OpenAI 兼容）

### 16.2 开发环境启动

```bash
# 1. 安装依赖
cd kb-server
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入数据库连接信息和 AI API Key

# 3. 初始化数据库
mysql -u root -p < db/schema.sql
mysql -u root -p < db/migration_ngram.sql  # 若需中文全文检索

# 4. 创建管理员账号
npm run init-admin
# 默认: admin / admin123

# 5. 启动开发服务器
npm run dev
# 访问 http://localhost:3000
```

### 16.3 生产环境部署

```bash
# 1. 安装 PM2
npm install -g pm2

# 2. 启动服务
pm2 start deploy/ecosystem.config.js

# 3. 配置 Nginx
# 将 deploy/nginx.conf 中的路径替换为实际路径
# 复制到 Nginx 配置目录并 reload

# 4. 设置开机自启
pm2 save
pm2 startup
```

### 16.4 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 开发模式启动（nodemon 热重载） |
| `npm start` | 生产模式启动 |
| `npm run init-admin` | 初始化管理员账号 |
| `npm run test-ai` | 测试 AI API 连通性 |
| `npm run test-sql` | 运行 SQL 执行器测试 |
| `pm2 status` | 查看 PM2 进程状态 |
| `pm2 logs kb-server` | 查看服务日志 |

### 16.5 健康检查

```bash
curl http://localhost:3000/api/health
# 返回 DB 和 AI API 的连通性状态
```

---

> **文档维护**：本文件由 AI 基于项目源码自动生成，随代码变更同步更新。