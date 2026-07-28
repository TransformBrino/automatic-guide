<!-- 传化具身智能 · 员工知识库系统 — 数据库 Schema 说明 -->
<!-- 本文件由 prompt-builder.js 注入到 System Prompt 中，供 AI 生成 SQL 时参考 -->
<!-- 对应框架文档第四章 4.2-4.6 -->

# 数据库表结构说明

共 5 张表，全部以 `kb_` 开头。AI 只能操作这些表。

---

## 表 1：kb_entries（知识条目主表）

系统核心表，所有知识条目存储于此。

```sql
CREATE TABLE kb_entries (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  entry_code      VARCHAR(20) NOT NULL UNIQUE,              -- 自动生成，格式 KB-YYYYMMDD-NNN（后端生成，AI 不填）
  title           VARCHAR(200) NOT NULL,                     -- 标题（必填）
  knowledge_type  ENUM('fault_case','sop','experience_rule','scene_portrait','tool_script','ai_template') NOT NULL,  -- 知识类型（必填）
  architecture_layer ENUM('scene','fault','solution','tool','standard') NOT NULL,  -- 架构层（必填，与 knowledge_type 对应）
  scene           VARCHAR(50) NOT NULL DEFAULT '其他',       -- 场景（必填，默认"其他"）
  severity        ENUM('P0-致命','P1-严重','P2-一般','P3-轻微') DEFAULT 'P2-一般',  -- 严重程度
  summary         TEXT NOT NULL,                             -- 摘要 1-2 句话（必填）
  full_content    MEDIUMTEXT NOT NULL,                       -- 完整 Markdown 正文（必填）
  raw_input       TEXT,                                      -- 员工原始口述文本（可选，用于追溯）
  score_completeness  TINYINT DEFAULT 0,                     -- 完整性评分 1-5，0=未评（审核时填）
  score_accuracy      TINYINT DEFAULT 0,                     -- 准确性评分 1-5
  score_timeliness    TINYINT DEFAULT 0,                     -- 时效性评分 1-5
  score_operability   TINYINT DEFAULT 0,                     -- 可操作性评分 1-5
  score_reusability   TINYINT DEFAULT 0,                     -- 可复用性评分 1-5
  score_traceability  TINYINT DEFAULT 0,                     -- 可追溯性评分 1-5
  score_total         TINYINT DEFAULT 0,                     -- 六维总分（审核时由后端计算）
  major_version   INT DEFAULT 1,                             -- 主版本（后端管理）
  minor_version   INT DEFAULT 0,                             -- 次版本（后端管理）
  patch_version   INT DEFAULT 0,                             -- 修订版本（后端管理）
  version_label   VARCHAR(20) AS (CONCAT(major_version,'.',minor_version,'.',patch_version)) STORED,  -- 计算列，自动生成
  status          ENUM('draft','pending_review','approved','rejected','archived') DEFAULT 'draft',  -- 状态
  reviewer_id     INT,                                       -- 审核员 ID
  reviewed_at     DATETIME,                                  -- 审核时间
  review_comment  TEXT,                                      -- 审核意见
  next_review_date DATE,                                     -- 下次复审日期
  review_cycle    ENUM('weekly','monthly','quarterly','semi_annual') DEFAULT 'monthly',  -- 复审周期
  created_by      VARCHAR(50) NOT NULL,                      -- 录入人（必填，后端注入）
  updated_by      VARCHAR(50),                               -- 最后更新人
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

### 字段语义说明

**knowledge_type 枚举值含义**：
| 值 | 含义 | 典型描述 |
|----|------|---------|
| `fault_case` | 故障案例 | 具体故障现象、排查过程、根因 |
| `sop` | 标准作业流程 | 步骤化操作流程 |
| `experience_rule` | 经验规则 | 通用规律、经验教训 |
| `scene_portrait` | 场景画像 | 环境、设备布局、拓扑 |
| `tool_script` | 工具脚本 | 脚本、命令、代码片段 |
| `ai_template` | AI 提示词模板 | AI 提示词模板、使用模式 |

**architecture_layer 枚举值含义**（与 knowledge_type 对应）：
| 值 | 含义 | 对应 knowledge_type |
|----|------|---------------------|
| `scene` | 场景层 | scene_portrait |
| `fault` | 故障层 | fault_case |
| `solution` | 方案层 | sop, experience_rule |
| `tool` | 工具层 | tool_script |
| `standard` | 标准层 | ai_template |

**status 状态流转**：
- `draft`（草稿）→ 录入后默认状态
- `pending_review`（待审核）→ 提交审核后
- `approved`（已审核）→ 审核通过后
- `rejected`（已驳回）→ 审核驳回后
- `archived`（已归档）→ 管理员归档后

**score_* 评分规则**：取值 0-5，0 表示未评分（入库默认），审核时由审核员填 1-5 分。

---

## 表 2：kb_tags（标签表）

与 kb_entries 为 1:N 关系，外键 ON DELETE CASCADE。

```sql
CREATE TABLE kb_tags (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  entry_id  INT NOT NULL,                                   -- 关联 kb_entries.id
  tag_name  VARCHAR(50) NOT NULL,                           -- 标签名
  tag_type  ENUM('scene','device','fault_type','tech_stack','custom') DEFAULT 'custom',  -- 标签类型
  FOREIGN KEY (entry_id) REFERENCES kb_entries(id) ON DELETE CASCADE,
  INDEX idx_entry_id (entry_id),
  INDEX idx_tag_name (tag_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**tag_type 枚举值含义**：
| 值 | 含义 |
|----|------|
| `scene` | 场景标签（如"仓库A"、"化工车间"） |
| `device` | 设备标签（如"AGV-007"、"机械臂"） |
| `fault_type` | 故障类型标签（如"通讯故障"、"驱动异常"） |
| `tech_stack` | 技术栈标签（如"ROS"、"Linux"） |
| `custom` | 自定义标签 |

---

## 表 3：kb_version_history（版本历史表）

每次更新条目前，后端自动将当前内容快照写入此表。AI 不直接操作此表。

```sql
CREATE TABLE kb_version_history (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  entry_id      INT NOT NULL,
  version_label VARCHAR(20) NOT NULL,                       -- 快照时的版本标签
  change_summary VARCHAR(500) NOT NULL,                     -- 变更摘要
  changed_by    VARCHAR(50) NOT NULL,
  full_content_snapshot MEDIUMTEXT NOT NULL,                -- 完整内容快照
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES kb_entries(id) ON DELETE CASCADE,
  INDEX idx_entry_id (entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 表 4：kb_audit_log（操作日志表）

记录所有对知识库的变更操作，用于审计追溯。AI 不直接操作此表（由后端在执行 SQL 后自动写入）。

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

**action 枚举值含义**：
| 值 | 含义 | 触发场景 |
|----|------|---------|
| `create` | 创建 | INSERT 新条目后 |
| `update` | 更新 | UPDATE 条目后 |
| `delete` | 删除 | 管理员删除条目 |
| `review_approve` | 审核通过 | 审核员通过条目 |
| `review_reject` | 审核驳回 | 审核员驳回条目 |
| `archive` | 归档 | 管理员归档条目 |

---

## 表 5：kb_users（用户表）

存储系统用户。AI 不直接操作此表（鉴权由后端处理）。

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

**role 枚举值含义**：
| 值 | 含义 | 权限 |
|----|------|------|
| `contributor` | 录入员 | 录入新知识、回答追问、搜索浏览 |
| `reviewer` | 审核员 | 录入员全部权限 + 审核、六维评分、批准/驳回 |
| `admin` | 管理员 | 审核员全部权限 + 删除、管理用户、归档 |

---

## AI 操作约束总结

1. **可操作的表**：kb_entries（INSERT/UPDATE/SELECT）、kb_tags（INSERT/SELECT）
2. **不直接操作的表**：kb_version_history、kb_audit_log（后端自动维护）、kb_users（鉴权系统维护）
3. **AI 生成的 SQL 必须经过后端安全校验**：操作类型白名单、表名 `kb_` 前缀、禁止 DDL、禁止多语句、事务包装
4. **entry_code 由后端生成**：AI 在 INSERT 中不要填写 entry_code 字段（或留 NULL，后端会补填）
5. **created_by 由后端注入**：AI 在 INSERT 中可写 `__CREATED_BY__` 占位符，后端替换为当前登录用户名
