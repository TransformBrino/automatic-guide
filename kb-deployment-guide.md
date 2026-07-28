# 传化具身智能 —— 员工知识库系统：部署与 AI 控库指南

> **目标读者**：负责部署本系统的运维人员 / 技术负责人。
> **前置阅读**：请先阅读 [kb-system-framework.md](kb-system-framework.md) 了解系统架构。

---

## 一、AI 如何控制数据库：核心机制详解

这是整个系统最关键的设计决策。很多人在第一次接触时会困惑："AI 怎么能操作数据库？" 下面把整个链路彻底讲清楚。

### 1.1 一句话总结

**AI 不直接连接数据库。AI 只负责"想"——根据用户的话生成 SQL 语句文本。后端（Node.js）负责"做"——校验 SQL 安全性，然后执行。**

### 1.2 完整链路拆解

```
┌─────────────────────────────────────────────────────────────────────┐
│  第1步：员工说话                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 员工在聊天框输入："四足机器人从A点走到B点后断联了，                        │ │
│  │ 过了一会又自动恢复了，查了是导航主机内存占用过高导致保护性重启"               │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  第2步：前端发送请求                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ POST /api/chat                                                   │ │
│  │ Body: {                                                          │ │
│  │   "message": "四足机器人从A点走到B点后断联了...",                      │ │
│  │   "sessionId": "sess-abc123"                                     │ │
│  │ }                                                                │ │
│  │ Header: Authorization: Bearer eyJhbGci...                        │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  第3步：后端拼装 Prompt（prompt-builder.js 做这件事）                     │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 后端把以下内容拼成一个 messages 数组：                                 │ │
│  │                                                                   │ │
│  │ [                                                                 │ │
│  │   { role: "system", content: "                                  │ │
│  │     你是传化具身智能知识库的唯一数据库管理员。                              │ │
│  │     你的数据库 Schema 如下：                                        │ │
│  │     CREATE TABLE kb_entries (                                    │ │
│  │       id INT AUTO_INCREMENT PRIMARY KEY,                         │ │
│  │       title VARCHAR(200) NOT NULL,                               │ │
│  │       ...（完整建表语句）                                            │ │
│  │     );                                                           │ │
│  │     操作规则：                                                      │ │
│  │     1. 判断用户意图（录入/查询/更新/删除）                               │ │
│  │     2. 检查信息完整性，缺失则追问                                      │ │
│  │     3. 生成 SQL 用 ```sql ``` 包裹                                │ │
│  │     4. 绝不编造用户没说的信息                                         │ │
│  │   " },                                                           │ │
│  │   { role: "user", content: "四足机器人从A点走到B点后断联了..." },       │ │
│  │   { role: "assistant", content: "请补充：故障发生的具体时间？..." },    │ │
│  │   { role: "user", content: "昨天下午3点左右" }                       │ │
│  │ ]                                                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  第4步：调用 AI API（services/ai.js 做这件事）                           │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ POST https://api.openai.com/v1/chat/completions                  │ │
│  │ （或 DeepSeek / 通义千问 / 任何 OpenAI-compatible API）              │ │
│  │                                                                   │ │
│  │ Header: Authorization: Bearer sk-xxxx（AI API Key）               │ │
│  │ Body: { model: "gpt-4o", messages: [...上面的数组...] }            │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  第5步：AI 返回结果（纯文本）                                            │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ AI 的回复内容：                                                     │ │
│  │                                                                   │ │
│  │ 已为您录入故障案例。                                                  │ │
│  │                                                                   │ │
│  │ ```sql                                                            │ │
│  │ INSERT INTO kb_entries (entry_code, title, knowledge_type,       │ │
│  │   architecture_layer, scene, severity, summary, full_content,     │ │
│  │   raw_input, created_by)                                         │ │
│  │ VALUES ('KB-20260727-001', '导航主机内存过高导致机器人断连',          │ │
│  │   'fault_case', 'fault', '物流仓储', 'P2-一般',                    │ │
│  │   '四足机器人在巡检过程中因导航主机内存占用过高导致保护性重启，          │ │
│  │    随后自动恢复',                                                   │ │
│  │   '## 故障现象\n...', '四足机器人从A点走到B点后断联了...', '张三');     │ │
│  │                                                                   │ │
│  │ INSERT INTO kb_tags (entry_id, tag_name, tag_type)               │ │
│  │ VALUES (LAST_INSERT_ID(), '四足机器人', 'device'),                │ │
│  │        (LAST_INSERT_ID(), '内存溢出', 'fault_type'),              │ │
│  │        (LAST_INSERT_ID(), '导航主机', 'device');                  │ │
│  │ ```                                                               │ │
│  │                                                                   │ │
│  │ 条目编号 KB-20260727-001，状态为 draft，待审核员审核。                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  第6步：后端解析 SQL（services/ai.js 的 parseSQL 函数）                  │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 用正则从 AI 回复中提取 ```sql ... ``` 代码块：                       │ │
│  │                                                                   │ │
│  │ const sqlRegex = /```sql\s*([\s\S]*?)```/g;                     │ │
│  │ const sqlStatements = [];                                         │ │
│  │ let match;                                                        │ │
│  │ while ((match = sqlRegex.exec(aiReply)) !== null) {              │ │
│  │   sqlStatements.push(match[1].trim());                           │ │
│  │ }                                                                 │ │
│  │                                                                   │ │
│  │ // 结果：sqlStatements = [                                        │ │
│  │ //   "INSERT INTO kb_entries ...",                               │ │
│  │ //   "INSERT INTO kb_tags ..."                                   │ │
│  │ // ]                                                              │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  第7步：安全校验（services/sql-executor.js 做这件事）                     │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 对每条 SQL 执行 4 层校验：                                          │ │
│  │                                                                   │ │
│  │ 校验1：操作类型白名单                                                │ │
│  │   → "INSERT INTO ..." 以 INSERT 开头 ✓ 通过                        │ │
│  │                                                                   │ │
│  │ 校验2：表名白名单                                                    │ │
│  │   → 正则提取表名：kb_entries ✓ 通过                                 │ │
│  │   → 正则提取表名：kb_tags ✓ 通过                                    │ │
│  │                                                                   │ │
│  │ 校验3：禁止 DDL                                                     │ │
│  │   → 检查是否包含 DROP/ALTER/TRUNCATE/GRANT/REVOKE/CREATE           │ │
│  │   → 未找到 ✓ 通过                                                  │ │
│  │                                                                   │ │
│  │ 校验4：禁止多语句                                                    │ │
│  │   → 检查是否包含分号分隔的多条语句                                      │ │
│  │   → 未找到 ✓ 通过                                                  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  第8步：在事务中执行 SQL                                                │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ const connection = await pool.getConnection();                   │ │
│  │ await connection.beginTransaction();  // 开启事务                  │ │
│  │ try {                                                            │ │
│  │   await connection.execute(sqlStatements[0]); // INSERT kb_entries│ │
│  │   await connection.execute(sqlStatements[1]); // INSERT kb_tags  │ │
│  │   await connection.commit();  // 提交事务                          │ │
│  │ } catch (err) {                                                  │ │
│  │   await connection.rollback();  // 任何一条失败，全部回滚             │ │
│  │   throw err;                                                     │ │
│  │ } finally {                                                      │ │
│  │   connection.release();                                          │ │
│  │ }                                                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  第9步：写入审计日志 + 返回结果给前端                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ // 写入操作日志                                                     │ │
│  │ INSERT INTO kb_audit_log (entry_id, action, operator, ip_address) │ │
│  │ VALUES (1, 'create', '张三', '192.168.1.100');                    │ │
│  │                                                                   │ │
│  │ // 返回给前端                                                       │ │
│  │ {                                                                 │ │
│  │   "type": "entry_created",                                       │ │
│  │   "message": "条目 KB-20260727-001 已创建，状态为 draft，待审核。",    │ │
│  │   "entry": {                                                      │ │
│  │     "id": 1,                                                     │ │
│  │     "entry_code": "KB-20260727-001",                             │ │
│  │     "title": "导航主机内存过高导致机器人断连",                          │ │
│  │     "status": "draft"                                            │ │
│  │   }                                                              │ │
│  │ }                                                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 关键设计点

**AI 不直接连数据库。** AI 的角色是"翻译官"——把员工的中文描述翻译成 SQL 语句。真正执行 SQL 的是 Node.js 后端。

**AI 看到的只是文本。** AI 的 System Prompt 中包含完整的数据库建表语句（CREATE TABLE），这样 AI 就知道有哪些表、哪些字段、什么类型。AI 据此生成正确的 SQL。

**安全靠后端校验。** AI 可能生成不安全的 SQL（比如 DROP TABLE），所以后端在每条 SQL 执行前都要做白名单校验。这是最后一道防线。

**所有操作在事务中。** 如果 AI 生成了多条 SQL（比如同时 INSERT 主表和标签表），它们在一个事务中执行。任何一条失败，全部回滚。

### 1.4 为什么不用 ORM 而让 AI 生成原始 SQL

ORM（如 Sequelize、TypeORM）需要预定义所有操作。但 AI 对话的灵活性意味着员工可能说出任何形式的请求（"帮我把所有物流仓储场景的 P1 故障找出来，按时间排序，只要最近一个月的"），预定义的 ORM 方法无法覆盖所有可能的查询组合。

让 AI 直接生成 SQL，相当于给系统一个"万能查询接口"——AI 理解自然语言，然后生成对应的 SQL。后端只负责安全校验和执行。

---

## 二、部署环境准备

### 2.1 服务器要求

| 项目 | 最低配置 | 建议配置 |
|------|---------|---------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 20 GB | 50 GB SSD |
| 操作系统 | Ubuntu 20.04+ / Windows Server 2019+ | Ubuntu 22.04 LTS |
| 网络 | 内网可达 | 内网静态 IP |

### 2.2 需要安装的软件

| 软件 | 版本 | 用途 |
|------|------|------|
| Node.js | 18.x LTS 或 20.x LTS | 运行后端服务 |
| MySQL | 8.0+ | 数据存储 |
| Nginx | 1.18+ | 前端静态文件 + 反向代理 |
| PM2 | 最新版 | Node.js 进程守护（生产环境必备） |
| Git | 2.x | 代码版本管理（可选） |

### 2.3 安装命令（Ubuntu 示例）

```bash
# 1. 安装 Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 安装 MySQL 8.0
sudo apt-get install -y mysql-server

# 3. 安装 Nginx
sudo apt-get install -y nginx

# 4. 安装 PM2（全局）
sudo npm install -g pm2

# 5. 验证安装
node --version    # 应显示 v18.x.x
mysql --version   # 应显示 8.0.x
nginx -v          # 应显示 1.18.x 或更高
pm2 --version     # 应显示版本号
```

### 2.4 安装命令（Windows Server 示例）

```powershell
# 1. 下载 Node.js 18.x LTS 安装包
# https://nodejs.org/dist/v18.x.x/node-v18.x.x-x64.msi
# 双击安装，勾选"Add to PATH"

# 2. 下载 MySQL 8.0 安装包
# https://dev.mysql.com/downloads/installer/
# 选择 MySQL Server 8.0，按向导安装

# 3. 下载 Nginx for Windows
# https://nginx.org/en/download.html
# 解压到 C:\nginx

# 4. 安装 PM2
npm install -g pm2
```

---

## 三、数据库初始化

### 3.1 创建数据库和用户

```bash
# 登录 MySQL
mysql -u root -p

# 在 MySQL 中执行：
```

```sql
-- 创建数据库
CREATE DATABASE kb_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 创建专用用户（不要用 root 跑应用）
CREATE USER 'kb_app'@'localhost' IDENTIFIED BY '你的强密码';
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_db.* TO 'kb_app'@'localhost';
FLUSH PRIVILEGES;

-- 验证
EXIT;
mysql -u kb_app -p kb_db
SHOW TABLES;
```

### 3.2 导入建表语句

```bash
# 将项目中的 db/schema.sql 导入数据库
mysql -u kb_app -p kb_db < /path/to/kb-server/db/schema.sql
```

### 3.3 创建初始管理员账号

```bash
# 使用 Node.js 脚本生成 bcrypt 哈希
node -e "
const bcrypt = require('bcrypt');
const hash = bcrypt.hashSync('admin123', 10);
console.log(hash);
"
```

记录输出的哈希值，然后插入数据库：

```sql
INSERT INTO kb_users (username, display_name, role, password_hash)
VALUES ('admin', '系统管理员', 'admin', '刚才生成的哈希值');
```

**注意**：部署后请立即修改默认密码。

---

## 四、后端部署

### 4.1 获取代码

```bash
# 将 kb-server 目录复制到服务器
# 建议放在 /opt/kb-server 或 C:\kb-server
sudo mkdir -p /opt/kb-server
sudo chown -R $USER:$USER /opt/kb-server
# 将代码文件复制到此目录
```

### 4.2 配置环境变量

在项目根目录创建 `.env` 文件：

```bash
# /opt/kb-server/.env

# === 数据库配置 ===
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=kb_app
DB_PASSWORD=你的数据库密码
DB_NAME=kb_db

# === AI API 配置 ===
# 方案A：使用 OpenAI 官方 API
AI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_MODEL=gpt-4o

# 方案B：使用 DeepSeek（国内推荐，便宜好用）
# AI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# AI_API_URL=https://api.deepseek.com/v1/chat/completions
# AI_MODEL=deepseek-chat

# 方案C：使用阿里通义千问
# AI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# AI_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
# AI_MODEL=qwen-plus

# === JWT 配置 ===
# 生成方式：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=生成一个随机字符串

# === 服务配置 ===
PORT=3000
SESSION_TIMEOUT_MINUTES=30
```

### 4.3 安装依赖并启动

```bash
cd /opt/kb-server

# 安装依赖
npm install

# 测试运行（前台）
node server.js

# 看到 "Server running on port 3000" 说明启动成功
# Ctrl+C 停止
```

### 4.4 使用 PM2 守护进程（生产环境）

```bash
# 启动
pm2 start server.js --name kb-server

# 设置开机自启
pm2 startup
pm2 save

# 常用管理命令
pm2 status          # 查看状态
pm2 logs kb-server  # 查看日志
pm2 restart kb-server  # 重启
pm2 stop kb-server     # 停止
```

### 4.5 验证后端

```bash
# 测试登录接口
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# 应该返回：
# {"success":true,"data":{"token":"eyJhbG...","user":{"id":1,...}}}
```

---

## 五、前端部署（Nginx）

### 5.1 Nginx 配置

```nginx
# /etc/nginx/sites-available/kb-server
# （Windows 下对应 C:\nginx\conf\nginx.conf 中的 server 块）

server {
    listen 80;
    server_name kb-server.internal;  # 改为你的内网域名或 IP

    # 前端静态文件
    location / {
        root /opt/kb-server/public;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 反向代理到后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;

        # 超时设置（AI 调用可能较慢）
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

### 5.2 启用配置

```bash
# Ubuntu
sudo ln -s /etc/nginx/sites-available/kb-server /etc/nginx/sites-enabled/
sudo nginx -t          # 测试配置
sudo systemctl reload nginx  # 重载配置

# Windows
# 编辑 C:\nginx\conf\nginx.conf 后
cd C:\nginx
nginx -s reload
```

### 5.3 验证前端

在浏览器中访问 `http://<服务器IP或域名>`，应看到登录页面。

---

## 六、AI 选型指南

### 6.1 模型对比

| 模型 | 提供商 | 价格（约） | SQL 能力 | 中文能力 | 推荐场景 |
|------|--------|-----------|---------|---------|---------|
| GPT-4o | OpenAI | $2.5/1M input | 极强 | 强 | 预算充足，对准确性要求极高 |
| GPT-4o-mini | OpenAI | $0.15/1M input | 强 | 强 | 日常使用，性价比高 |
| DeepSeek-V3 | DeepSeek | ¥1/1M input | 强 | 极强 | 国内推荐，性价比最高 |
| 通义千问-Plus | 阿里云 | ¥2/1M input | 中等 | 极强 | 阿里云生态用户 |
| Claude 3.5 Sonnet | Anthropic | $3/1M input | 极强 | 强 | 防幻觉要求极高的场景 |

### 6.2 推荐方案

**首选：DeepSeek-V3**
- 价格最低（约 GPT-4o 的 1/50）
- 中文理解和 SQL 生成能力优秀
- 国内访问稳定，无需代理
- 配置方式：`AI_API_URL=https://api.deepseek.com/v1/chat/completions`，`AI_MODEL=deepseek-chat`

**备选：GPT-4o-mini**
- 价格适中
- SQL 生成非常准确
- 需要代理访问（国内）
- 配置方式：`AI_API_URL=https://api.openai.com/v1/chat/completions`，`AI_MODEL=gpt-4o-mini`

### 6.3 获取 API Key

- **DeepSeek**：访问 https://platform.deepseek.com ，注册后获取
- **OpenAI**：访问 https://platform.openai.com ，注册后获取（需要海外手机号验证）
- **阿里云百炼**：访问 https://bailian.console.aliyun.com ，开通后获取

---

## 七、安全加固

### 7.1 MySQL 安全

```sql
-- 1. 删除匿名用户
DELETE FROM mysql.user WHERE User='';

-- 2. 禁止远程 root 登录
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');

-- 3. 删除测试数据库
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';

-- 4. 应用账户只给必要权限
-- （已在初始化时设置，确认 kb_app 用户只有 SELECT, INSERT, UPDATE, DELETE）

FLUSH PRIVILEGES;
```

### 7.2 Node.js 安全

- `.env` 文件权限设为 600（仅所有者可读写）：`chmod 600 .env`
- `.env` 文件不要提交到 Git（在 `.gitignore` 中添加 `.env`）
- JWT Secret 使用至少 32 位的随机字符串
- 生产环境设置 `NODE_ENV=production`

### 7.3 Nginx 安全

```nginx
# 在 server 块中添加安全头
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-XSS-Protection "1; mode=block" always;

# 限制请求体大小（防止大文件上传）
client_max_body_size 10m;
```

### 7.4 防火墙

```bash
# Ubuntu（UFW）
sudo ufw allow 80/tcp    # Nginx
sudo ufw allow 22/tcp    # SSH
sudo ufw deny 3000/tcp   # 禁止直接访问 Node.js 端口
sudo ufw enable

# 只允许内网 IP 访问 80 端口（可选，更安全）
sudo ufw allow from 192.168.0.0/16 to any port 80
```

---

## 八、运维管理

### 8.1 日常检查

```bash
# 检查服务状态
pm2 status
sudo systemctl status nginx
sudo systemctl status mysql

# 检查数据库连接
mysql -u kb_app -p -e "SELECT COUNT(*) FROM kb_db.kb_entries;"

# 检查磁盘空间
df -h

# 检查日志
pm2 logs kb-server --lines 50
tail -f /var/log/nginx/access.log
```

### 8.2 备份策略

```bash
# 每日自动备份数据库（加入 crontab）
# crontab -e
# 0 2 * * * mysqldump -u kb_app -p'密码' kb_db | gzip > /backup/kb_db_$(date +\%Y\%m\%d).sql.gz

# 手动备份
mysqldump -u kb_app -p kb_db | gzip > kb_db_backup_$(date +%Y%m%d_%H%M%S).sql.gz

# 恢复
gunzip < kb_db_backup_20260727_020000.sql.gz | mysql -u kb_app -p kb_db
```

### 8.3 更新部署

```bash
cd /opt/kb-server

# 1. 拉取最新代码
git pull  # 或手动复制新文件

# 2. 安装新依赖（如有）
npm install

# 3. 如果有数据库变更，手动执行
# mysql -u kb_app -p kb_db < db/migrations/xxx.sql

# 4. 重启服务（PM2 零停机）
pm2 reload kb-server

# 5. 验证
pm2 status
```

### 8.4 故障排查

| 问题 | 检查方法 | 常见原因 |
|------|---------|---------|
| 页面打不开 | `curl http://localhost` | Nginx 未启动，防火墙阻挡 |
| 登录失败 | `pm2 logs kb-server` | 数据库连接失败，JWT Secret 配置错误 |
| AI 无响应 | 查看 `/api/chat` 的超时日志 | AI API Key 无效，网络不通，余额不足 |
| SQL 执行失败 | 查看 `SQL_VALIDATION_ERROR` 日志 | AI 生成了不符合规则的 SQL |
| 知识库查询慢 | `EXPLAIN SELECT ...` 分析慢查询 | 缺少索引，数据量太大 |

---

## 九、AI 控库的边界与限制

### 9.1 AI 能做什么

- 根据员工描述生成 INSERT 语句，新建知识条目
- 根据员工要求生成 SELECT 语句，查询知识库
- 根据员工要求生成 UPDATE 语句，修改已有条目
- 根据员工要求生成 DELETE 语句，删除条目（仅管理员）
- 自动判断知识类型、架构层
- 检查信息完整性，主动追问
- 查重，避免重复录入

### 9.2 AI 不能做什么

- 不能直接连接数据库（所有 SQL 通过后端执行）
- 不能执行 DDL 操作（CREATE/DROP/ALTER TABLE 等）
- 不能操作 kb_ 前缀以外的表
- 不能执行多条 SQL 拼接（防止注入）
- 不能绕过审核流程（审核必须由人工审核员完成）
- 不能访问服务器文件系统

### 9.3 如果 AI 生成了错误的 SQL

后端的安全校验会拦截不安全的 SQL 并返回错误。对于语义上正确但逻辑上不对的 SQL（比如 INSERT 了错误的字段值），有以下保护：

- **查重机制**：INSERT 前 AI 会先 SELECT 检查是否有重复
- **审核流程**：所有新建条目 status 为 draft，需要审核员审核通过后才正式入库
- **版本历史**：每次 UPDATE 前保存旧版本快照，可以回滚
- **操作日志**：所有操作记录在 kb_audit_log 中，可追溯

---

## 十、部署检查清单

部署完成后，逐项确认：

- [ ] MySQL 数据库已创建，5 张表已导入
- [ ] 应用数据库用户（kb_app）已创建，权限正确
- [ ] 初始管理员账号已创建，可以登录
- [ ] `.env` 文件已配置，所有必填项已填写
- [ ] `npm install` 成功，无报错
- [ ] `node server.js` 可以启动，监听在配置的端口
- [ ] PM2 已配置，服务已守护
- [ ] Nginx 已配置，可以访问前端页面
- [ ] `/api/auth/login` 接口可以正常返回 JWT token
- [ ] `/api/chat` 接口可以正常调用 AI（发送一条测试消息，验证 AI 能回复）
- [ ] AI 生成的 SQL 可以正常执行（录入一条测试知识，然后在数据库中确认）
- [ ] 审核流程正常（以审核员身份审核刚录入的测试条目）
- [ ] 防火墙已配置，仅开放必要端口
- [ ] 数据库备份脚本已配置
- [ ] 内网中其他电脑可以访问系统