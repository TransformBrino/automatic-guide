-- ============================================================
-- 传化具身智能 · 员工知识库系统 - 数据库建表脚本
-- 对应框架文档第四章，5 张表
-- 使用方式：mysql -u root -p < db/schema.sql
-- 注意：本脚本含 DROP DATABASE，仅用于开发环境初始化
-- ============================================================

DROP DATABASE IF EXISTS kb_db;
CREATE DATABASE kb_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kb_db;

-- ------------------------------------------------------------
-- 表 1：kb_entries（知识条目主表）
-- 系统核心表，所有知识条目存储于此
-- ------------------------------------------------------------
CREATE TABLE kb_entries (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  entry_code      VARCHAR(20) NOT NULL UNIQUE COMMENT '自动生成，格式 KB-YYYYMMDD-NNN',
  title           VARCHAR(200) NOT NULL COMMENT '标题',
  knowledge_type  ENUM('fault_case','sop','experience_rule','scene_portrait','tool_script','ai_template') NOT NULL COMMENT '知识类型',
  architecture_layer ENUM('scene','fault','solution','tool','standard') NOT NULL COMMENT '架构层',
  scene           VARCHAR(50) NOT NULL DEFAULT '其他' COMMENT '场景',
  severity        ENUM('P0-致命','P1-严重','P2-一般','P3-轻微') DEFAULT 'P2-一般' COMMENT '严重程度',
  summary         TEXT NOT NULL COMMENT '摘要 1-2 句话',
  full_content    MEDIUMTEXT NOT NULL COMMENT '完整 Markdown 正文',
  raw_input       TEXT COMMENT '员工原始口述文本，用于追溯',
  score_completeness  TINYINT DEFAULT 0 COMMENT '完整性评分 1-5，0=未评',
  score_accuracy      TINYINT DEFAULT 0 COMMENT '准确性评分 1-5',
  score_timeliness    TINYINT DEFAULT 0 COMMENT '时效性评分 1-5',
  score_operability   TINYINT DEFAULT 0 COMMENT '可操作性评分 1-5',
  score_reusability   TINYINT DEFAULT 0 COMMENT '可复用性评分 1-5',
  score_traceability  TINYINT DEFAULT 0 COMMENT '可追溯性评分 1-5',
  score_total         TINYINT DEFAULT 0 COMMENT '六维总分',
  major_version   INT DEFAULT 1 COMMENT '主版本',
  minor_version   INT DEFAULT 0 COMMENT '次版本',
  patch_version   INT DEFAULT 0 COMMENT '修订版本',
  version_label   VARCHAR(20) AS (CONCAT(major_version,'.',minor_version,'.',patch_version)) STORED COMMENT '版本标签 计算列',
  status          ENUM('draft','pending_review','approved','rejected','archived') DEFAULT 'draft' COMMENT '状态',
  reviewer_id     INT COMMENT '审核员 ID',
  reviewed_at     DATETIME COMMENT '审核时间',
  review_comment  TEXT COMMENT '审核意见',
  next_review_date DATE COMMENT '下次复审日期',
  review_cycle    ENUM('weekly','monthly','quarterly','semi_annual') DEFAULT 'monthly' COMMENT '复审周期',
  created_by      VARCHAR(50) NOT NULL COMMENT '录入人',
  updated_by      VARCHAR(50) COMMENT '最后更新人',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_knowledge_type (knowledge_type),
  INDEX idx_scene (scene),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_score_total (score_total),
  FULLTEXT idx_fulltext (title, summary, full_content)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识条目主表';

-- ------------------------------------------------------------
-- 表 2：kb_tags（标签表）
-- 与 kb_entries 1:N，ON DELETE CASCADE
-- ------------------------------------------------------------
CREATE TABLE kb_tags (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  entry_id  INT NOT NULL,
  tag_name  VARCHAR(50) NOT NULL,
  tag_type  ENUM('scene','device','fault_type','tech_stack','custom') DEFAULT 'custom',
  FOREIGN KEY (entry_id) REFERENCES kb_entries(id) ON DELETE CASCADE,
  INDEX idx_entry_id (entry_id),
  INDEX idx_tag_name (tag_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签表';

-- ------------------------------------------------------------
-- 表 3：kb_version_history（版本历史表）
-- 每次更新前将当前内容快照写入此表，1:N，ON DELETE CASCADE
-- ------------------------------------------------------------
CREATE TABLE kb_version_history (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  entry_id      INT NOT NULL,
  version_label VARCHAR(20) NOT NULL COMMENT '快照时的版本标签',
  change_summary VARCHAR(500) NOT NULL COMMENT '变更摘要',
  changed_by    VARCHAR(50) NOT NULL,
  full_content_snapshot MEDIUMTEXT NOT NULL COMMENT '完整内容快照',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES kb_entries(id) ON DELETE CASCADE,
  INDEX idx_entry_id (entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='版本历史表';

-- ------------------------------------------------------------
-- 表 4：kb_audit_log（操作日志表）
-- 记录所有对知识库的变更操作，用于审计追溯
-- entry_id 外键 ON DELETE SET NULL（条目删除后日志保留）
-- ------------------------------------------------------------
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表';

-- ------------------------------------------------------------
-- 表 5：kb_users（用户表）
-- password_hash 使用 bcrypt 加密
-- ------------------------------------------------------------
CREATE TABLE kb_users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  username    VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(50) NOT NULL,
  role        ENUM('contributor','reviewer','admin') DEFAULT 'contributor',
  password_hash VARCHAR(255) NOT NULL,
  is_active   TINYINT(1) DEFAULT 1,
  login_attempts INT NOT NULL DEFAULT 0 COMMENT '连续登录失败次数（P9-T2）',
  locked_until DATETIME NULL COMMENT '账户锁定截止时间（P9-T2）',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- ------------------------------------------------------------
-- 表 6：kb_code_sequence（编码序列表，用于并发安全的 entry_code 生成）
-- date_key: 日期键 YYYYMMDD
-- seq: 当日已使用的最大序号（原子递增，由 ON DUPLICATE KEY UPDATE 保证）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_code_sequence (
  date_key VARCHAR(8) PRIMARY KEY,
  seq      INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='编码序列表';
