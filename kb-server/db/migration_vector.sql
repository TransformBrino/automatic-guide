-- ============================================================
-- 向量检索改造 — 新增条目向量表
-- 运行方式：mysql -u root -p kb_db < db/migration_vector.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS kb_entry_embeddings (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  entry_id    INT NOT NULL,
  embedding   JSON NOT NULL COMMENT '向量数组，如 [0.0123, -0.0456, 0.0789, ...]',
  dimension   SMALLINT NOT NULL DEFAULT 0 COMMENT '向量维度（由 Embedding 模型决定）',
  model       VARCHAR(50) NOT NULL COMMENT 'Embedding 模型名',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_entry_id (entry_id),
  FOREIGN KEY (entry_id) REFERENCES kb_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='条目向量表';
