# 识途知识库系统（Scene Knowledge Base）

> 企业内部知识库管理系统 · 基于 AI 自然语言交互的智能知识管理平台

---

## 目录

- [项目概览](#项目概览)
- [系统架构](#系统架构)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [用户手册](#用户手册)
- [API 参考](#api-参考)
- [部署指南](#部署指南)
- [开发计划](#开发计划)

---

## 项目概览


![系统概览](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=An%20professional%20enterprise%20knowledge%20base%20management%20system%20dashboard%20UI%20with%20AI%20chat%20interface%2C%20showing%20a%20modern%20web%20application%20with%20sidebar%20navigation%2C%20message%20bubbles%2C%20and%20knowledge%20cards%20in%20a%20clean%20corporate%20blue%20theme%2C%20flat%20design%20style&image_size=landscape_16_9)

**识途知识库系统**是一个基于 AI 自然语言交互的企业内部知识库管理平台。员工通过对话方式录入、查询和管理知识，无需学习复杂的数据库操作。

### 核心特性

- **AI 驱动交互**：员工用自然语言与 AI 对话，AI 自动提取结构化知识
- **六维评分体系**：内容完整性、逻辑正确性、操作可行性、安全等级、效率、规范性
- **三级角色权限**：录入员（contributor）、审核员（reviewer）、管理员（admin）
- **全流程审计**：所有操作记录审计日志，支持追溯
- **单文件前端**：零依赖，一个 HTML 文件即可运行

### 适用场景

| 场景 | 说明 |
|------|------|
| 故障案例库 | 记录设备故障现象、根因、解决方案 |
| 标准作业流程 | 录入 SOP 文档，支持版本管理 |
| 经验规则沉淀 | 将员工经验转化为可查询的结构化知识 |
| AI 模板库 | 存储和管理 AI 对话模板 |

---

## 系统架构

![系统架构图](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=System%20architecture%20diagram%20of%20a%20web%20application%20with%20Browser%2C%20Nginx%20reverse%20proxy%2C%20Node.js%20backend%2C%20MySQL%20database%2C%20and%20AI%20API%20service%2C%20showing%20data%20flow%20arrows%20between%20layers%2C%20clean%20professional%20technical%20diagram&image_size=landscape_16_9)

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                       浏览器                             │
│              (index.html 单页应用)                        │
└──────────────┬──────────────────────────────────────────┘
               │ HTTP / WebSocket
               ▼
┌─────────────────────────────────────────────────────────┐
│                    Nginx (反向代理)                        │
│              localhost:80 → localhost:3000                │
└──────────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│                 Node.js + Express                         │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐     │
│  │ 认证模块 │ │ AI 模块  │ │ SQL执行器│ │ 查询审核 │     │
│  │ JWT鉴权 │ │ Prompt  │ │ 安全校验 │ │ 权限控制 │     │
│  └─────────┘ └─────────┘ └──────────┘ └──────────┘     │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                    MySQL 8.0                              │
│  kb_entries │ kb_tags │ kb_version_history                │
│  kb_audit_log │ kb_users                                  │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              AI API (DeepSeek / OpenAI 兼容)               │
└─────────────────────────────────────────────────────────┘
```

### 核心流程：录入知识

```
员工输入 → AI 分析意图 → 检查完整性 → 追问补全
  → 生成 SQL → 安全校验 → 事务执行 → 写入数据库
  → 生成 entry_code → 记录审计日志 → 返回结果
```

### 数据模型

系统使用 5 张核心表：

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `kb_entries` | 知识条目主表 | title, knowledge_type, status, score_*, full_content |
| `kb_tags` | 标签管理 | entry_id, tag, tag_type |
| `kb_version_history` | 版本历史（更新前快照） | entry_id, full_content_snapshot, change_summary |
| `kb_audit_log` | 操作审计日志 | entry_id, action, operator, detail |
| `kb_users` | 用户管理 | username, password_hash, role, is_active |

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端 | 原生 HTML5 / CSS3 / JavaScript | - |
| 后端 | Node.js + Express | Node ≥ 18 |
| 数据库 | MySQL | 8.0+ |
| AI API | OpenAI 兼容接口 | DeepSeek / GPT / Qwen |
| 认证 | JWT (jsonwebtoken) | 8h 过期 |
| 安全 | node-sql-parser + 正则校验 | 5 层白名单 |
| 部署 | Nginx + PM2 | Nginx 1.31+ / PM2 7+ |

---

## 快速开始

### 环境要求

- Node.js ≥ 18.x
- MySQL ≥ 8.0
- AI API Key（DeepSeek / OpenAI 兼容）

### 1. 克隆项目

```bash
git clone git@github.com:TransformBrino/automatic-guide.git
cd automatic-guide
```

### 2. 配置环境变量

```bash
cd kb-server
cp .env.example .env
```

编辑 `.env`，填入数据库连接信息和 AI API Key：

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=kb_db
AI_API_KEY=sk-your-api-key
AI_API_URL=https://api.deepseek.com/v1/chat/completions
AI_MODEL=deepseek-chat
JWT_SECRET=your_random_secret
PORT=3000
```

### 3. 初始化数据库

```bash
# 建库建表
mysql -u root -p < db/schema.sql

# 创建管理员账号
npm run init-admin
# 默认账号: admin / admin123
```

### 4. 启动服务

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:3000` 即可使用。

### 5. PM2 生产启动

```bash
npm install -g pm2
pm2 start deploy/ecosystem.config.js
pm2 save
```

---

## 用户手册

### 登录

![登录界面](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=A%20modern%20login%20page%20of%20an%20enterprise%20knowledge%20base%20system%20with%20username%20and%20password%20fields%2C%20corporate%20blue%20theme%2C%20clean%20and%20professional%20design%2C%20web%20application%20style&image_size=landscape_4_3)

打开浏览器访问系统，输入用户名和密码登录。

默认管理员账号：`admin` / `admin123`

### 主界面

登录后进入主界面，顶部导航栏包含 5 个功能 Tab：

| Tab | 图标 | 功能 | 可见角色 |
|-----|------|------|---------|
| 对话 | 💬 | AI 自然语言交互（录入/查询/更新） | 全部 |
| 知识库 | 📖 | 浏览、搜索、筛选知识条目 | 全部 |
| 审核 | ✅ | 待审核条目六维评分与审批 | reviewer, admin |
| 管理 | ⚙️ | 用户管理、条目管理 | admin |
| 设置 | 🔧 | 个人信息、修改密码、退出登录 | 全部 |

### 对话功能（Tab1）

![AI对话界面](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=A%20chat%20interface%20of%20an%20AI%20knowledge%20base%20system%20showing%20conversation%20between%20user%20and%20AI%20assistant%2C%20message%20bubbles%20on%20alternating%20sides%2C%20blue%20theme%2C%20modern%20web%20UI%20design&image_size=landscape_16_9)

通过自然语言与 AI 交互，实现知识录入、查询和更新。

**录入知识示例：**

```
用户：昨天 AGV-007 在仓库 A 报故障，无法启动
AI：  请问具体的故障现象是什么？排查过程是怎样的？根因是什么？
用户：现象是无法启动，排查发现电池亏电，根因是充电器故障
AI：  ✅ 条目创建成功 (KB-20260728-001)
```

**查询知识示例：**

```
用户：查一下 AGV 相关的故障案例
AI：  🔍 查询到 3 条结果：
      · AGV-007 无法启动 (故障案例)
      · AGV 充电器维护规程 (SOP)
      · 仓库 A 路径异常处理 (经验规则)
```

**界面布局：**
- 左侧：AI 消息气泡（白色背景）
- 右侧：用户消息气泡（蓝色背景）
- 底部固定：输入框 + 发送按钮 + 语音输入按钮

### 知识库浏览（Tab2）

条目展示与多维筛选：

- **搜索框**：关键词搜索（支持全文检索）
- **筛选条件**：知识类型、状态、架构层
- **排序方式**：创建时间、评分、更新时间
- **条目卡片**：标题 + 摘要 + 类型标签 + 状态标签 + 评分
- **点击展开**：查看完整内容、标签、版本历史

### 审核工作台（Tab3）

审核员对提交的条目进行六维评分：

- **待审核列表**：显示所有状态为"待审核"的条目
- **审核面板**：展示条目完整内容
- **六维评分**：每维 1-5 分下拉选择
  - 内容完整性
  - 逻辑正确性
  - 操作可行性
  - 安全等级
  - 效率
  - 规范性
- **操作按钮**：通过（绿色）/ 驳回（红色）
- **驳回需要填写审核意见**

### 管理页面（Tab4）

管理员功能：

- **用户管理**：创建新用户、查看用户列表（用户名、角色、状态）
- **条目管理**：查看所有条目、归档、删除
- **新建用户**：设置用户名、显示名、密码、角色

### 设置页面（Tab5）

- **个人信息**：当前用户名、显示名、角色
- **修改密码**：旧密码 + 新密码 + 确认新密码
- **退出登录**：清除登录状态，返回登录页

### 语音输入

需要 Chrome/Edge 浏览器，点击输入框旁的麦克风按钮即可开始语音识别，识别结果自动填入输入框。

---

## API 参考

所有 API 响应遵循统一格式：

```json
// 成功
{ "success": true, "data": {...}, "message": "操作成功" }

// 失败
{ "success": false, "error": "错误描述", "code": "ERROR_CODE" }
```

### 认证接口

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/api/auth/login` | 登录，返回 JWT Token | 否 |
| POST | `/api/auth/change-password` | 修改密码 | 是 |

### 对话接口

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/api/chat` | AI 对话（录入/查询/更新） | 是 |

### 知识库接口

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/api/entries` | 分页查询（支持筛选/排序/搜索） | 否 |
| GET | `/api/entries/:id` | 条目详情（含标签、版本历史） | 否 |
| GET | `/api/entries/:id/history` | 版本历史列表 | 否 |
| GET | `/api/stats` | 统计数据（按类型/状态/场景聚合） | 否 |

### 审核接口

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/api/review/pending` | 待审核列表 | reviewer, admin |
| POST | `/api/review/:id` | 审核操作（通过/驳回） | reviewer, admin |

### 管理接口

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| DELETE | `/api/admin/entries/:id` | 删除条目 | admin |
| POST | `/api/admin/entries/:id/archive` | 归档条目 | admin |
| GET | `/api/admin/users` | 用户列表 | admin |
| POST | `/api/admin/users` | 创建用户 | admin |

### 错误码

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| AUTH_REQUIRED | 401 | 未登录或 Token 无效 |
| FORBIDDEN | 403 | 无权限 |
| NOT_FOUND | 404 | 资源不存在 |
| VALIDATION_ERROR | 400 | 参数校验失败 |
| DB_ERROR | 500 | 数据库异常 |
| AI_API_ERROR | 502 | AI API 调用异常 |

---

## 部署指南

### Nginx 配置

```nginx
server {
    listen 80;
    server_name kb.internal.company.com;

    location / {
        root /path/to/kb-server/public;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }
}
```

### PM2 进程守护

```javascript
module.exports = {
  apps: [{
    name: 'kb-server',
    script: 'server.js',
    cwd: '/path/to/kb-server',
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production' }
  }]
};
```

### 数据库备份

```bash
# 定时备份（每天凌晨 2 点）
0 2 * * * mysqldump -u root -p kb_db > /backup/kb_$(date +\%Y\%m\%d).sql
```

---

## 开发计划

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 | 环境准备 | ✅ |
| P1 | 基础设施（数据库 Schema + 配置） | ✅ |
| P2 | 认证系统（JWT 登录 + 鉴权中间件） | ✅ |
| P3 | AI 集成层（Prompt + SQL 安全执行器） | ✅ |
| P4 | 核心对话（录入→追问→入库→查询闭环） | ✅ |
| P5 | 查询与审核（entries/review/admin/stats） | ✅ |
| P6 | 前端单页应用（5 Tab 全功能） | ✅ |
| P7 | 部署上线（Nginx + PM2） | ✅ |

---

## 安全说明

- **SQL 安全执行器**：5 层校验（操作类型白名单、表名白名单、禁止 DDL、禁止多语句、事务包装）
- **JWT 鉴权**：8 小时过期，所有 API（除登录外）均需验证
- **密码加密**：bcrypt 加密存储，响应中不含 `password_hash`
- **审计日志**：所有写操作记录 `kb_audit_log`，可追溯
- **防 AI 幻觉**：System Prompt 严格约束 AI 不编造信息

---

## 许可证

内部项目 · 仅供授权人员使用

---

*文档版本：v2.0 · 最后更新：2026-07-28*
