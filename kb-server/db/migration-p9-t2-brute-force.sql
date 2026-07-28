-- ============================================================
-- P9-T2：防暴力破解 - 登录保护
-- 为 kb_users 表增加登录失败计数和锁定时间字段
-- ============================================================

ALTER TABLE kb_users
  ADD COLUMN login_attempts INT NOT NULL DEFAULT 0 COMMENT '连续登录失败次数',
  ADD COLUMN locked_until DATETIME NULL COMMENT '账户锁定截止时间';

-- 为 is_active 添加索引以加速登录查询
-- ALTER TABLE kb_users ADD INDEX idx_is_active (is_active);
