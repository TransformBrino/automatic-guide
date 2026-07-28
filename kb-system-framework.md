# 传化具身智能 —— 员工知识库系统框架描述

> **目标读者**：负责编写本项目代码的 AI。
> **使用方式**：本文档是系统实现的唯一事实来源。请严格按照本文档的架构、数据模型、API 契约和逻辑流程来实现代码。不要在未对照本文档的情况下自行设计架构或数据模型。

---

## 一、系统概述

### 1.1 项目目标

构建一个**完全自主可控的企业内部知识库系统**，不依赖任何第三方 SaaS 平台。系统由三个核心部分组成：

| 组件 | 职责 | 形态 |
|------|------|------|
| 前端 | 员工与 AI 交互的聊天界面 + 知识库浏览 | 单个 HTML 文件，内网 Nginx 托管 |
| 后端 | 接收前端请求、调度 AI、安全执行 SQL | Node.js + Express 服务 |
| 数据库 | 持久化所有知识条目、用户、日志 | MySQL 8.0 |

### 1.2 核心机制：AI 作为数据库管理员

本系统的核心创新在于：**AI 是知识库的唯一管理员**。员工不直接操作数据库，而是通过自然语言与 AI 对话。AI 负责理解意图、判断知识类型、追问缺失信息、生成 SQL、执行 SQL。

整个流程链路如下：

```
员工打字/语音 → 前端 POST /api/chat → 后端拼装 System Prompt + 上下文
→ 调用 AI API → AI 返回结果（含 SQL 块） → 后端解析 SQL
→ 安全校验（白名单/禁止 DDL/事务包装） → 执行 SQL → 返回结果给前端
```

### 1.3 用户角色与权限

| 角色 | 标识 | 权限边界 |
|------|------|---------|
| 录入员 | `contributor` | 录入新知识、回答 AI 追问、搜索/浏览知识库 |
| 审核员 | `reviewer` | 录入员全部权限 + 审核条目、六维评分、批准/驳回 |
| 管理员 | `admin` | 审核员全部权限 + 删除条目、管理用户、归档条目 |

---

## 二、技术栈与约束

### 2.1 技术选型

| 层级 | 技术 | 版本要求 | 选型理由 |
|------|------|---------|---------|
| 前端 | 原生 HTML/CSS/JS | 无框架依赖 | 单文件即可运行，零安装，兼容所有浏览器 |
| 后端 | Node.js + Express | Node 18+, Express 4.x | 轻量、异步友好、mysql2 生态成熟 |
| 数据库 | MySQL | 8.0+ | 企业级关系型数据库，事务支持，公司 IT 认可 |
| AI 接口 | OpenAI-compatible Chat Completions API | - | 兼容 GPT-4o / DeepSeek / 通义千问等，后端统一调用 |
| 数据库驱动 | mysql2 | 3.x | 支持 Promise、prepared statements |
| 前端部署 | Nginx | 任意稳定版 | 内网静态文件服务 + 反向代理 |

### 2.2 硬约束（必须遵守）

- 不使用任何第三方 SaaS 平台（飞书、Notion、语雀等）
- 所有数据存储在自有 MySQL 数据库
- 前端为单个 HTML 文件，不引入 React/Vue 等框架
- AI 生成的 SQL 必须经过后端安全校验后才能执行
- 所有 `kb_` 开头的表名是 AI 唯一可以操作的表

---

## 三、目录结构与文件职责

### 3.1 完整目录树

```
kb-server/
├── server.js                 # 入口：Express 启动、中间件注册、路由挂载
├── package.json              # 依赖声明
├── .env                      # 环境变量（不提交版本控制）
├── config.js                 # 读取 .env，导出配置对象
├── db/
│   ├── connection.js         # MySQL 连接池创建与导出
│   └── schema.sql            # 完整建表 SQL（开发环境一键初始化）
├── routes/
│   ├── chat.js               # POST /api/chat —— 核心对话接口
│   ├── entries.js            # GET /api/entries —— 知识库查询
│   ├── review.js             # POST /api/review/:id —— 审核评分
│   ├── auth.js               # POST /api/auth/login —— 用户登录
│   └── admin.js              # 管理员专用接口
├── services/
│   ├── ai.js                 # 封装 AI API 调用
│   ├── sql-executor.js       # AI 生成 SQL 的安全执行器
│   └── prompt-builder.js     # 动态构建 System Prompt
├── prompts/
│   ├── system-base.txt       # System Prompt 模板
│   └── sql-schema.md         # 数据库表结构（注入到 Prompt 中）
├── middleware/
│   └── auth.js               # JWT 认证中间件
└── public/
    └── index.html            # 前端单页面应用
```

### 3.2 每个文件的详细职责

**`server.js`** — 入口文件
- 加载 `.env` 配置
- 创建 Express 实例
- 注册中间件：`express.json()`、CORS、JWT 认证中间件（除 `/api/auth/login` 外）
- 挂载路由模块
- 启动 HTTP 服务，监听 `config.port`

**`config.js`** — 配置管理
- 从 `process.env` 读取以下变量，导出为对象：
  - `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`
  - `AI_API_KEY`、`AI_API_URL`、`AI_MODEL`
  - `JWT_SECRET`、`PORT`
  - `SESSION_TIMEOUT_MINUTES`（默认 30）
- 对缺失的必填变量抛出明确错误

**`db/connection.js`** — 数据库连接
- 使用 `mysql2/promise` 创建连接池
- 配置：`connectionLimit: 10`、`waitForConnections: true`
- 导出 `pool` 对象，供所有 service 和 route 使用

**`db/schema.sql`** — 建表语句
- 包含 5 张表的完整 `CREATE TABLE` 语句
- 表结构见第四章

**`routes/chat.js`** — 核心对话路由
- 这是系统最重要的路由，逻辑流程见第六章

**`routes/entries.js`** — 知识库查询路由
- `GET /api/entries`：分页查询，支持多维筛选
- `GET /api/entries/:id`：查询单条详情
- `GET /api/entries/:id/history`：查询版本历史

**`routes/review.js`** — 审核路由
- `GET /api/review/pending`：获取待审核列表
- `POST /api/review/:id`：提交审核结果（六维评分 + 通过/驳回）

**`routes/auth.js`** — 认证路由
- `POST /api/auth/login`：用户名密码登录，返回 JWT token

**`routes/admin.js`** — 管理路由
- `DELETE /api/admin/entries/:id`：删除条目
- `POST /api/admin/entries/:id/archive`：归档条目
- `GET /api/admin/users`：用户列表
- `POST /api/admin/users`：创建用户

**`services/ai.js`** — AI API 调用
- 函数签名：`async function callAI(messages) -> { replyText, sqlStatements }`
- 封装 `fetch` 调用 OpenAI-compatible Chat Completions API
- 处理超时（30 秒）、重试（最多 1 次）、错误
- 解析 AI 回复中的 ` ```sql ``` ` 代码块，提取 SQL 语句数组
- 返回 `{ replyText: string, sqlStatements: string[] }`

**`services/sql-executor.js`** — SQL 安全执行器
- 这是系统安全的核心，逻辑见第五章

**`services/prompt-builder.js`** — Prompt 构建
- 函数签名：`function buildMessages(systemPrompt, history, newMessage) -> messages[]`
- 读取 `prompts/system-base.txt` 和 `prompts/sql-schema.md`
- 拼接完整的 `messages` 数组，格式为 OpenAI Chat Completions 格式
- 限制历史消息数量（最多保留最近 20 轮），防止 token 超限

**`middleware/auth.js`** — JWT 认证中间件
- 从请求头 `Authorization: Bearer <token>` 提取 JWT
- 验证 token 有效性
- 将解码后的用户信息（id、username、role）挂载到 `req.user`
- 无效 token 返回 401

**`public/index.html`** — 前端应用
- 单文件，包含 HTML 结构 + CSS 样式 + JavaScript 逻辑
- 结构见第七章

---

## 四、MySQL 数据库设计

### 4.1 表关系总览

```
kb_users ──┐
           │ (reviewer_id 外键)
           ▼
kb_entries ────< kb_tags              (1:N)
    │
    ├────< kb_version_history         (1:N)
    │
    └────< kb_audit_log               (1:N)
```

### 4.2 kb_entries（知识条目主表）

这是系统的核心表，所有知识条目都存储在这里。

```sql
CREATE TABLE kb_entries (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  entry_code      VARCHAR(20) NOT NULL UNIQUE,
  title           VARCHAR(200) NOT NULL,
  knowledge_type  ENUM('fault_case','sop','experience_rule','scene_portrait','tool_script','ai_template') NOT NULL,
  architecture_layer ENUM('scene','fault','solution','tool','standard') NOT NULL,
  scene           VARCHAR(50) NOT NULL DEFAULT '其他',
  severity        ENUM('P0-致命','P1-严重','P2-一般','P3-轻微') DEFAULT 'P2-一般',
  summary         TEXT NOT NULL,
  full_content    MEDIUMTEXT NOT NULL,
  raw_input       TEXT,
  score_completeness  TINYINT DEFAULT 0,
  score_accuracy      TINYINT DEFAULT 0,
  score_timeliness    TINYINT DEFAULT 0,
  score_operability   TINYINT DEFAULT 0,
  score_reusability   TINYINT DEFAULT 0,
  score_traceability  TINYINT DEFAULT 0,
  score_total         TINYINT DEFAULT 0,
  major_version   INT DEFAULT 1,
  minor_version   INT DEFAULT 0,
  patch_version   INT DEFAULT 0,
  version_label   VARCHAR(20) AS (CONCAT(major_version,'.',minor_version,'.',patch_version)) STORED,
  status          ENUM('draft','pending_review','approved','rejected','archived') DEFAULT 'draft',
  reviewer_id     INT,
  reviewed_at     DATETIME,
  review_comment  TEXT,
  next_review_date DATE,
  review_cycle    ENUM('weekly','monthly','quarterly','semi_annual') DEFAULT 'monthly',
  created_by      VARCHAR(50) NOT NULL,
  updated_by      VARCHAR(50),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_knowledge_type (knowledge_type),
  INDEX idx_scene (scene),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_score_total (score_total),
  FULLTEXT idx_fulltext (title, summary, full_content)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**字段说明**：
- `entry_code`：自动生成，格式 `KB-YYYYMMDD-NNN`，NNN 为当日序号（001 开始）
- `knowledge_type`：6 种知识类型之一，AI 根据用户描述自动判断
- `architecture_layer`：5 层架构之一，与 knowledge_type 有对应关系
- `full_content`：Markdown 格式的结构化正文，包含完整的故障排查/经验/流程描述
- `raw_input`：员工原始口述文本，用于追溯
- `score_*`：六维质量评分，每维 1-5 分，入库时默认为 0，审核时由审核员填写
- `version_label`：由 MySQL 计算列自动生成，格式 `主版本.次版本.修订版本`

### 4.3 kb_tags（标签表）

```sql
CREATE TABLE kb_tags (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  entry_id  INT NOT NULL,
  tag_name  VARCHAR(50) NOT NULL,
  tag_type  ENUM('scene','device','fault_type','tech_stack','custom') DEFAULT 'custom',
  FOREIGN KEY (entry_id) REFERENCES kb_entries(id) ON DELETE CASCADE,
  INDEX idx_entry_id (entry_id),
  INDEX idx_tag_name (tag_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.4 kb_version_history（版本历史表）

```sql
CREATE TABLE kb_version_history (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  entry_id      INT NOT NULL,
  version_label VARCHAR(20) NOT NULL,
  change_summary VARCHAR(500) NOT NULL,
  changed_by    VARCHAR(50) NOT NULL,
  full_content_snapshot MEDIUMTEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES kb_entries(id) ON DELETE CASCADE,
  INDEX idx_entry_id (entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**用途**：每次更新条目时，在更新前将当前版本的内容快照写入此表。

### 4.5 kb_audit_log（操作日志表）

```sql
CREATE TABLE kb_audit_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  entry_id    INT,
  action      ENUM('create','update','delete','review_approve','review_reject','archive') NOT NULL,
  operator    VARCHAR(50) NOT NULL,
  detail      TEXT,
  ip_address  VARCHAR(45),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES kb_entries(id) ON DELETE SET NULL,
  INDEX idx_entry_id (entry_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**用途**：记录所有对知识库的变更操作，用于审计追溯。

### 4.6 kb_users（用户表）

```sql
CREATE TABLE kb_users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  username    VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(50) NOT NULL,
  role        ENUM('contributor','reviewer','admin') DEFAULT 'contributor',
  password_hash VARCHAR(255) NOT NULL,
  is_active   TINYINT(1) DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**注意**：`password_hash` 使用 bcrypt 加密，初始管理员账号在数据库初始化时手动插入。

---

## 五、SQL 安全执行器（系统安全核心）

### 5.1 设计原则

AI 生成的 SQL 是**不可信输入**，必须在执行前经过多层安全校验。安全执行器是系统中最重要的安全组件。

### 5.2 校验规则（按执行顺序）

**校验 1 — 操作类型白名单**：只允许 `INSERT`、`UPDATE`、`DELETE`、`SELECT`。任何其他操作类型直接拒绝。

**校验 2 — 表名白名单**：只允许操作以 `kb_` 开头的表。解析 SQL 中的 `FROM`/`INTO`/`UPDATE` 后的表名，检查是否以 `kb_` 开头。

**校验 3 — 禁止 DDL**：禁止 `DROP`、`ALTER`、`TRUNCATE`、`GRANT`、`REVOKE`、`CREATE` 关键字。使用正则 `/\b(DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE)\b/i` 匹配。

**校验 4 — 禁止多语句**：SQL 中不能包含分号分隔的多条语句（单个末尾分号除外）。这是防止 SQL 注入拼接的关键措施。

**校验 5 — 事务包装**：通过校验后，所有 SQL 在同一个数据库事务中执行。任何一条失败则全部回滚。

### 5.3 函数签名

```javascript
// services/sql-executor.js
async function validateAndExecute(sqlStatements: string[], userId: number): Promise<{ success: boolean, results: any[], error?: string }>
```

### 5.4 调用时机

此函数在以下场景被调用：
- `routes/chat.js` 中，AI 返回了包含 SQL 的回复
- `routes/review.js` 中，审核操作需要更新条目状态和评分
- `routes/admin.js` 中，管理员删除或归档条目

---

## 六、核心业务流程

### 6.1 POST /api/chat 完整流程

这是系统最核心的接口，处理所有员工与 AI 的交互。

**步骤 1 — 接收请求**
```
请求体：{ message: string, sessionId: string }
请求头：Authorization: Bearer <jwt_token>
中间件 auth.js 已解析用户信息到 req.user
```

**步骤 2 — 获取对话上下文**
- 使用 `sessionId` 从内存 Map 中获取历史对话
- 如果没有历史对话，创建新的空数组
- 如果 session 已过期（超过 30 分钟无活动），清空旧上下文

**步骤 3 — 构建 Prompt**
- 调用 `prompt-builder.js` 的 `buildMessages()` 函数
- 返回的 messages 数组结构：
  ```
  [
    { role: "system", content: "你是一个知识库管理员..." },  // 从 prompts/ 目录读取
    { role: "user", content: "..." },   // 历史消息 1
    { role: "assistant", content: "..." }, // 历史消息 2
    ...  // 最多保留最近 20 轮对话
    { role: "user", content: "当前用户消息" }
  ]
  ```

**步骤 4 — 调用 AI**
- 调用 `services/ai.js` 的 `callAI(messages)`
- 返回 `{ replyText: "AI 的自然语言回复", sqlStatements: ["INSERT INTO ...", ...] }`

**步骤 5 — 分支处理**

**分支 A：AI 返回追问（sqlStatements 为空）**
```
返回给前端：{ type: "follow_up", message: "<AI 追问内容>", sessionId }
更新对话上下文缓存
```

**分支 B：AI 返回了 SQL 语句**
```
调用 sql-executor.js 的 validateAndExecute(sqlStatements, req.user.id)
  ├── 成功 → 判断操作类型：
  │   ├── INSERT → 写入 audit_log (action='create')
  │   ├── UPDATE → 写入 version_history（先快照旧版本）→ 写入 audit_log
  │   └── DELETE → 写入 audit_log
  │   └── 返回给前端：{ type: "entry_created"/"entry_updated"/"query_result", ... }
  └── 失败 → 返回给前端：{ type: "error", message: "操作失败：" + error }
更新对话上下文缓存
```

**步骤 6 — 清理**
- 确保对话上下文不超过 20 轮
- 更新 session 的最后活动时间

### 6.2 AI 的知识类型判断逻辑

AI 根据用户描述的内容特征来判断 `knowledge_type`：

| 用户描述特征 | 判断为 knowledge_type | 对应 architecture_layer |
|-------------|----------------------|------------------------|
| 描述了具体故障现象、排查过程、根因 | `fault_case` | `fault` |
| 描述了步骤化的操作流程 | `sop` | `solution` |
| 描述了通用规律、经验教训 | `experience_rule` | `solution` |
| 描述了环境、设备布局、拓扑 | `scene_portrait` | `scene` |
| 描述了脚本、命令、代码片段 | `tool_script` | `tool` |
| 描述了 AI 提示词模板、使用模式 | `ai_template` | `standard` |

### 6.3 AI 的完整性检查逻辑

AI 在生成 INSERT 语句之前，必须检查以下必填字段是否齐全：
- `title`（标题）
- `knowledge_type`（知识类型）
- `architecture_layer`（架构层）
- `scene`（场景）
- `summary`（摘要，1-2 句话）
- `full_content`（完整 Markdown 内容）
- `created_by`（录入人）

如果任何必填字段缺失，AI 必须追问，**每次最多追问 3 个问题**，问题要具体明确。

### 6.4 AI 的查重逻辑

AI 在生成 INSERT 之前，必须先执行 SELECT 查询检查是否已有类似条目：
```sql
SELECT id, title FROM kb_entries WHERE title LIKE '%关键词%' OR summary LIKE '%关键词%' LIMIT 5;
```
如果发现相似条目，AI 应告知用户并询问是否要更新现有条目而非新建。

---

## 七、前端页面结构

### 7.1 页面布局

单页面应用，包含以下 UI 区域（从上到下）：

```
┌──────────────────────────────────────┐
│  顶部导航栏                            │
│  [对话] [知识库] [审核] [设置]   [用户名]│
├──────────────────────────────────────┤
│                                      │
│  当前 Tab 的内容区域                    │
│  （根据选中的 Tab 动态切换显示）          │
│                                      │
└──────────────────────────────────────┘
```

### 7.2 Tab 1：对话（默认 Tab）

**功能**：员工与 AI 对话，录入/查询/修改知识。

**UI 组件**：
- 消息列表（聊天区域）：显示用户和 AI 的消息气泡
  - 用户消息：右对齐，浅色背景
  - AI 追问消息：左对齐，深色背景，纯文本
  - AI 操作结果：左对齐，带颜色边框的卡片（绿色=成功，红色=失败，蓝色=查询结果）
  - 查询结果卡片内显示条目标题、摘要、链接
- 输入区域（底部固定）：
  - 文本输入框（多行，自动调整高度）
  - 语音输入按钮（调用浏览器 Web Speech API）
  - 发送按钮
  - 新建对话按钮

**状态管理**：
- `sessionId`：当前对话的会话 ID，页面加载时生成 UUID
- `messages`：消息数组，每条消息包含 `{ role, content, type, timestamp }`
- `isGenerating`：AI 是否正在生成回复

### 7.3 Tab 2：知识库

**功能**：浏览、搜索、筛选所有知识条目。

**UI 组件**：
- 搜索栏：关键词输入框 + 搜索按钮
- 筛选栏：知识类型下拉、架构层下拉、场景下拉、状态下拉、评分范围
- 结果列表：每条显示标题、摘要、类型标签、评分、状态、日期
- 分页：上一页/下一页按钮 + 页码显示
- 点击条目 → 展开详情面板（或跳转到详情页）

**API 调用**：`GET /api/entries?q=xxx&knowledge_type=xxx&page=1&limit=20`

### 7.4 Tab 3：审核（仅审核员和管理员可见）

**功能**：审核待审核的知识条目。

**UI 组件**：
- 待审核条目列表（按提交时间排序）
- 点击条目 → 展开审核面板：
  - 条目完整内容展示
  - 六维评分表单（每维 1-5 分，下拉选择）
  - 审核意见文本框
  - "通过"按钮（绿色）和"驳回"按钮（红色）
  - 驳回时必须填写驳回理由

**API 调用**：
- 获取待审核列表：`GET /api/review/pending`
- 提交审核：`POST /api/review/:id`，body: `{ action: "approve"|"reject", scores: {...}, comment: "..." }`

### 7.5 Tab 4：设置

**功能**：个人设置和系统信息。

**UI 组件**：
- 当前用户信息显示
- 修改密码表单
- 关于系统（版本号、构建时间）

---

## 八、API 契约完整定义

### 8.1 通用约定

- 所有 API 路径以 `/api/` 开头
- 除 `/api/auth/login` 外，所有接口需要 `Authorization: Bearer <token>` 请求头
- 请求体格式为 `application/json`
- 响应体格式为 `application/json`，统一结构：
  ```json
  { "success": true, "data": { ... }, "message": "..." }
  ```
  或错误时：
  ```json
  { "success": false, "error": "错误描述", "code": "ERROR_CODE" }
  ```

### 8.2 接口清单

| 方法 | 路径 | 请求体/参数 | 响应 data | 权限 |
|------|------|-----------|----------|------|
| POST | `/api/auth/login` | `{ username, password }` | `{ token, user: { id, username, displayName, role } }` | 公开 |
| POST | `/api/chat` | `{ message, sessionId }` | `{ type, message, entry?, results?, sessionId }` | 登录用户 |
| GET | `/api/entries` | `?q=&knowledge_type=&scene=&status=&page=&limit=&sort=` | `{ entries: [...], total, page, limit }` | 登录用户 |
| GET | `/api/entries/:id` | - | `{ entry: {...}, tags: [...], versions: [...] }` | 登录用户 |
| GET | `/api/review/pending` | `?page=&limit=` | `{ entries: [...], total }` | 审核员+ |
| POST | `/api/review/:id` | `{ action, scores: { completeness, accuracy, timeliness, operability, reusability, traceability }, comment }` | `{ entry: {...} }` | 审核员+ |
| DELETE | `/api/admin/entries/:id` | - | `{ deleted: true }` | 管理员 |
| POST | `/api/admin/entries/:id/archive` | - | `{ entry: {...} }` | 管理员 |
| GET | `/api/admin/users` | - | `{ users: [...] }` | 管理员 |
| POST | `/api/admin/users` | `{ username, displayName, password, role }` | `{ user: {...} }` | 管理员 |
| GET | `/api/stats` | - | `{ totalEntries, byType: {...}, byScene: {...}, byStatus: {...} }` | 登录用户 |

### 8.3 POST /api/chat 响应类型

此接口根据 AI 的处理结果返回不同的 `type`：

| type | 含义 | 额外字段 |
|------|------|---------|
| `follow_up` | AI 需要追问更多信息 | `message`（追问文本） |
| `entry_created` | 新知识条目已创建 | `entry: { id, entry_code, title, status }` |
| `entry_updated` | 知识条目已更新 | `entry: { id, entry_code, title }` |
| `query_result` | 查询结果 | `results: [{ id, entry_code, title, summary, knowledge_type, status }]` |
| `error` | 操作失败 | `message`（错误描述） |

---

## 九、System Prompt 结构

### 9.1 Prompt 组成

System Prompt 由 `prompt-builder.js` 从以下文件动态拼接：

```
[prompts/system-base.txt]  → 角色定义 + 操作规则 + 防幻觉规则 + 输出格式
[prompts/sql-schema.md]    → 完整数据库表结构（注入到 Prompt 中）
```

### 9.2 System Prompt 必须包含的章节

1. **角色定义**："你是传化具身智能知识库的唯一数据库管理员..."
2. **数据库 Schema**：完整的 CREATE TABLE 语句
3. **操作规则**：意图分类、完整性检查、自动生成字段规则、知识类型判断、架构层判断、查重规则
4. **防幻觉规则**：只使用用户明确提供的信息，不编造任何技术细节
5. **输出格式**：SQL 语句用 ` ```sql ``` ` 包裹，追问用自然中文

### 9.3 输出格式约束

AI 的回复中，SQL 语句必须用以下格式包裹：
```
```sql
INSERT INTO kb_entries (...) VALUES (...);
```
```

后端通过正则 `/```sql\s*([\s\S]*?)```/g` 提取 SQL 语句。

### 9.4 防幻觉核心规则

```
- 你只知道用户明确告诉你的信息，不知道任何其他信息
- 绝不编造：命令、工具、IP、路径、端口号、MAC 地址、用户未提及的任何数字
- 如果用户没有提供某个信息，该字段填写"待补充"或留 NULL
- 绝不填写推测性的根因。用户说"内存占用高"，你就只写"内存占用高"
- full_content 中的所有技术细节必须能追溯到用户原话
```

---

## 十、会话管理

### 10.1 会话存储

- 使用内存 `Map` 存储：`Map<sessionId, { messages: [], lastActivity: timestamp }>`
- 不在数据库中持久化会话（重启后会话丢失，可接受）

### 10.2 会话生命周期

- 创建：前端页面加载时生成 UUID 作为 sessionId
- 更新：每次 `/api/chat` 请求后追加消息到会话
- 过期：30 分钟无活动后自动清理（定时器每 5 分钟检查一次）
- 销毁：用户点击"新建对话"或 session 过期

### 10.3 消息限制

- 每个会话最多保留最近 20 轮对话（40 条消息：20 条用户 + 20 条 AI）
- 超过限制时，删除最早的消息对

---

## 十一、错误处理规范

### 11.1 后端错误码

| 错误码 | HTTP 状态码 | 含义 |
|--------|-----------|------|
| `AUTH_REQUIRED` | 401 | 未登录或 token 过期 |
| `FORBIDDEN` | 403 | 权限不足 |
| `NOT_FOUND` | 404 | 条目不存在 |
| `VALIDATION_ERROR` | 400 | 请求参数无效 |
| `SQL_VALIDATION_ERROR` | 400 | AI 生成的 SQL 未通过安全校验 |
| `AI_API_ERROR` | 502 | AI API 调用失败 |
| `DB_ERROR` | 500 | 数据库操作失败 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

### 11.2 前端错误处理

- 网络错误：显示"网络连接失败，请重试"提示
- 401 错误：跳转到登录页
- 500 错误：显示"服务器错误，请联系管理员"
- AI 生成超时（30 秒）：显示"AI 响应超时，请简化描述后重试"

---

## 十二、实现顺序建议

建议按以下顺序实现，每步完成后可独立测试：

### 阶段 1：基础设施
1. 创建 `package.json`，安装依赖（express、mysql2、bcrypt、jsonwebtoken、dotenv、uuid）
2. 实现 `config.js` 和 `.env`
3. 实现 `db/connection.js`，测试数据库连接
4. 编写 `db/schema.sql`，在 MySQL 中创建所有表
5. 插入初始管理员账号

### 阶段 2：认证系统
6. 实现 `middleware/auth.js`（JWT 中间件）
7. 实现 `routes/auth.js`（登录接口）
8. 测试登录流程

### 阶段 3：AI 集成
9. 编写 `prompts/system-base.txt` 和 `prompts/sql-schema.md`
10. 实现 `services/ai.js`（AI API 调用 + SQL 解析）
11. 实现 `services/sql-executor.js`（安全执行器）
12. 实现 `services/prompt-builder.js`

### 阶段 4：核心对话
13. 实现 `routes/chat.js`（核心对话接口）
14. 测试完整对话流程：用户输入 → AI 追问 → 信息补全 → SQL 入库

### 阶段 5：查询与审核
15. 实现 `routes/entries.js`（查询接口）
16. 实现 `routes/review.js`（审核接口）
17. 实现 `routes/admin.js`（管理接口）

### 阶段 6：前端
18. 实现 `public/index.html` 的 HTML 结构
19. 实现 CSS 样式（响应式，移动端适配）
20. 实现 JavaScript 逻辑（Tab 切换、聊天、搜索、审核）
21. 实现语音输入功能

### 阶段 7：部署
22. 配置 Nginx 反向代理
23. 使用 PM2 守护 Node.js 进程
24. 内网测试与上线

---

## 十三、关键技术决策与理由

| 决策 | 理由 |
|------|------|
| 前端不使用框架 | 单文件 HTML 即可满足需求，降低维护成本，员工浏览器直接打开 |
| 会话不持久化 | 知识库本身已持久化，对话上下文是临时辅助，重启丢失可接受 |
| AI 生成 SQL 而非 ORM | AI 需要灵活操作数据库，预定义 ORM 方法无法覆盖所有自然语言意图 |
| SQL 白名单校验 | AI 生成的 SQL 不可信，必须在后端做多层安全校验 |
| 版本历史用快照而非 diff | 内容变更频率低，全量快照实现简单，恢复方便 |
| 不使用 Redis | 减少部署依赖，单机内存 Map 足够满足内网团队使用 |