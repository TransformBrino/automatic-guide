# 识途知识库 — 向量检索改造（第 1/3 批：基础设施层）

## 你的角色

你是一位资深全栈工程师，精通 Node.js（Express）、MySQL 8.0、向量检索（Embedding + 余弦相似度）。

## 背景

知识库搜索现用 MySQL FULLTEXT INDEX（ngram 分词）+ LIKE 做关键词匹配，中文语义理解差。本次改造引入向量检索（Embedding + 余弦相似度），用语义相似度替代关键词匹配，同时保留 FULLTEXT + LIKE 作为降级通道。

**技术约束**：不更换数据库品牌（继续用 MySQL 8.0），允许新增表结构。向量数据存 MySQL 新表，启动时加载到内存 Map 做快速检索。条目量级 < 10 万。

## 自动探测策略（无需人工确认）

Embedding 的端点、模型、维度由 `embedding.js` 在首次调用时自动探测：

1. **端点 URL**：从 `AI_API_URL` 推导，将 `/chat/completions` 替换为 `/embeddings`；支持可选 `EMBEDDING_API_URL` 环境变量覆盖
2. **模型名称**：按优先级尝试候选列表 → `EMBEDDING_MODEL` 环境变量 → `AI_MODEL` 环境变量 → 已知模型列表（`deepseek-embedding`, `text-embedding-3-small`），取第一个返回 200 的
3. **向量维度**：从 API 响应中动态读取 `embedding.length`，永不硬编码

## 执行前必读

在开始任何修改之前，请先阅读以下现有文件：

```
kb-server/config.js              ← 了解 ai 配置结构
kb-server/.env.example           ← 了解环境变量命名规范
kb-server/server.js              ← 了解启动流程和中间件挂载顺序
kb-server/db/schema.sql          ← 了解现有表结构和命名规范
kb-server/package.json           ← 了解现有 scripts 和依赖
```

## 执行方式

按以下步骤**逐步执行**。每完成一个步骤，输出完整代码和验证方式，等待我确认后再继续下一步。

## 禁止事项

- **禁止修改** `middleware/`、`utils/`、`prompts/`、`routes/`、`public/` 目录下的任何文件（本批次不涉及）
- **禁止删除**现有 FULLTEXT + LIKE 搜索逻辑
- **禁止修改**与向量检索无关的现有代码逻辑
- **禁止盲替代码**：修改前必须先读取目标文件确认实际代码

---

## 步骤 1：数据库迁移 — 新增 `kb_entry_embeddings` 表

**新建文件**：`kb-server/db/migration_vector.sql`

```sql
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
```

**验证**：执行 `mysql -u root -p kb_db < db/migration_vector.sql`，然后 `SHOW TABLES LIKE 'kb_entry_embeddings'` 返回该表。

---

## 步骤 2：更新 `db/schema.sql`

**修改文件**：`kb-server/db/schema.sql`

在文件末尾追加步骤 1 的建表语句，确保全新部署时自动创建该表。

**验证**：文件末尾包含 `kb_entry_embeddings` 完整建表语句。

---

## 步骤 3：新增 Embedding 配置

**修改文件**：`kb-server/config.js`

在 `config.ai` 对象中新增（均为可选，不配置时自动探测）：

```javascript
// Embedding API 端点（可选），不配置时从 apiUrl 自动推导
embeddingApiUrl: process.env.EMBEDDING_API_URL || '',
// Embedding 模型（可选），不配置时按候选列表自动探测
embeddingModel: process.env.EMBEDDING_MODEL || '',
// 候选模型列表（启动探测用，可通过逗号分隔的环境变量覆盖）
embeddingModelCandidates: (process.env.EMBEDDING_MODEL_CANDIDATES || 'deepseek-embedding,text-embedding-3-small').split(','),
```

**修改文件**：`kb-server/.env.example`

在 `AI_MODEL=gpt-4o` 行下方新增：

```
# Embedding 配置（以下均为可选，不配置时自动探测）
# EMBEDDING_API_URL=           # Embedding 端点，不配置时从 AI_API_URL 自动推导
# EMBEDDING_MODEL=             # Embedding 模型名，不配置时自动探测
# EMBEDDING_MODEL_CANDIDATES=deepseek-embedding,text-embedding-3-small  # 候选模型列表
```

**验证**：启动服务确认 `config.ai.embeddingModel` 和 `config.ai.embeddingApiUrl` 均为可选字段，默认空字符串。

---

## 步骤 4：新建 `services/embedding.js` — Embedding API 封装（含自动探测）

**新建文件**：`kb-server/services/embedding.js`

**自动探测流程**（首次调用 `getEmbedding` 时触发，全局只执行一次）：

```
1. 确定端点 URL：
   - 优先使用 config.ai.embeddingApiUrl（用户显式配置）
   - 否则从 config.ai.apiUrl 推导：将 /chat/completions 替换为 /embeddings

2. 构建候选模型列表（去重，过滤空值）：
   - config.ai.embeddingModel（用户显式配置）
   - config.ai.model（复用 Chat 模型名，如 deepseek-v4-pro）
   - config.ai.embeddingModelCandidates（候选列表）

3. 逐个尝试调用 Embeddings API：
   - 请求体 { model, input: 'test' }，超时 10 秒
   - 返回 200 且 data[0].embedding 为有效数组 → 探测成功，记录 model 和 dimension

4. 全部失败 → 抛出错误，列出尝试过的候选模型和端点 URL
```

**实现代码**：

```javascript
/**
 * services/embedding.js — Embedding API 封装（含自动探测）
 * 职责：调用 AI API 的 Embedding 端点，将文本转为浮点数向量数组。
 *       启动时自动探测可用的 Embedding 模型和端点。
 */

const config = require('../config');

// 探测结果缓存
let detectedConfig = null;

/**
 * 将文本转换为向量（首次调用时自动探测模型）
 * @param {string} text - 待向量化的文本
 * @returns {Promise<number[]>} 向量数组
 */
async function getEmbedding(text) {
  await ensureDetected();

  // 文本过长时按 \n\n 分段，逐段生成向量后取逐维平均值
  const chunks = splitText(text, 8000);
  if (chunks.length === 1) {
    return await callEmbeddingAPI(detectedConfig.apiUrl, detectedConfig.model, chunks[0]);
  }

  const allVectors = await Promise.all(
    chunks.map(chunk => callEmbeddingAPI(detectedConfig.apiUrl, detectedConfig.model, chunk))
  );
  return averageVectors(allVectors);
}

/**
 * 单次调用 Embedding API
 */
async function callEmbeddingAPI(url, model, input) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Embedding API 返回 HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Embedding API 返回无效向量');
  }
  return embedding;
}

/**
 * 自动探测可用的 Embedding 配置（全局只执行一次）
 */
async function ensureDetected() {
  if (detectedConfig) return;

  // 1. 确定端点 URL
  const apiUrl = config.ai.embeddingApiUrl
    || config.ai.apiUrl.replace(/\/chat\/completions$/, '/embeddings');

  // 2. 构建候选模型列表（去重，过滤空值）
  const candidates = [...new Set([
    config.ai.embeddingModel,
    config.ai.model,
    ...config.ai.embeddingModelCandidates,
  ].filter(Boolean))];

  // 3. 逐个尝试
  for (const model of candidates) {
    try {
      console.log(`[embedding] 尝试模型: ${model} (端点: ${apiUrl})`);
      const embedding = await callEmbeddingAPI(apiUrl, model, 'test');
      detectedConfig = { apiUrl, model, dimension: embedding.length };
      console.log(`[embedding] 探测成功: model=${model}, dimension=${detectedConfig.dimension}`);
      return;
    } catch (e) {
      console.warn(`[embedding] 模型 ${model} 不可用: ${e.message}`);
    }
  }

  throw new Error(
    `Embedding 自动探测失败：所有候选模型 [${candidates.join(', ')}] 均不可用。` +
    `请检查 AI_API_URL 和 AI_API_KEY 配置，或手动设置 EMBEDDING_API_URL 和 EMBEDDING_MODEL。`
  );
}

/**
 * 获取当前使用的 Embedding 配置（供外部查询维度等信息）
 */
function getEmbeddingConfig() {
  return detectedConfig ? { ...detectedConfig } : null;
}

/**
 * 按分隔符分段文本
 */
function splitText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const parts = text.split('\n\n');
  const chunks = [];
  let current = '';
  for (const part of parts) {
    if (current.length + part.length > maxLen && current.length > 0) {
      chunks.push(current);
      current = part;
    } else {
      current = current ? current + '\n\n' + part : part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * 取多个向量的逐维平均值
 */
function averageVectors(vectors) {
  const dim = vectors[0].length;
  const result = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      result[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    result[i] /= vectors.length;
  }
  return result;
}

module.exports = { getEmbedding, getEmbeddingConfig };
```

**验证**：写临时脚本调 `getEmbedding('测试文本')`，日志应输出 `[embedding] 探测成功: model=xxx, dimension=xxx`，返回正确的浮点数数组。

---

## 步骤 5：新建 `services/vector-store.js` — 向量缓存管理

**新建文件**：`kb-server/services/vector-store.js`

**职责**：MySQL 持久化 + 内存 Map 缓存，启动时从 MySQL 加载，运行时同步更新。

**内存结构**：`Map<entryId, { embedding: number[], dimension: number, model: string }>`

**实现代码**：

```javascript
/**
 * services/vector-store.js — 向量缓存管理
 * 职责：MySQL 持久化 + 内存 Map 缓存，启动时全量加载，运行时增量更新。
 */

const pool = require('../db/connection');

// 内存向量缓存
const vectors = new Map();

/**
 * 从 MySQL 全量加载有效条目向量到内存
 */
async function loadFromDb() {
  try {
    const [rows] = await pool.execute(
      `SELECT e.entry_id, e.embedding, e.dimension, e.model
       FROM kb_entry_embeddings e
       JOIN kb_entries k ON e.entry_id = k.id
       WHERE k.status NOT IN ('archived', 'rejected')`
    );
    for (const row of rows) {
      const embedding = typeof row.embedding === 'string'
        ? JSON.parse(row.embedding)
        : row.embedding; // mysql2 3.x 自动解析 JSON 列
      if (!Array.isArray(embedding)) continue;
      vectors.set(row.entry_id, {
        embedding,
        dimension: row.dimension,
        model: row.model,
      });
    }
    console.log(`[vector-store] 从 MySQL 加载 ${vectors.size} 个向量`);
  } catch (err) {
    console.error('[vector-store] 加载向量失败:', err.message);
    // 不崩溃，从空 Map 开始（搜索将降级到 FULLTEXT）
  }
}

/**
 * 写入向量（MySQL + 内存 Map）
 */
async function setVector(entryId, embedding, dimension, model) {
  try {
    await pool.execute(
      `INSERT INTO kb_entry_embeddings (entry_id, embedding, dimension, model)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE embedding = VALUES(embedding), dimension = VALUES(dimension), model = VALUES(model)`,
      [entryId, JSON.stringify(embedding), dimension, model]
    );
    vectors.set(entryId, { embedding, dimension, model });
  } catch (err) {
    console.error('[vector-store] 写入向量失败 (entryId=%d):', entryId, err.message);
    throw err;
  }
}

/**
 * 删除向量（MySQL + 内存 Map）
 */
async function deleteVector(entryId) {
  try {
    await pool.execute('DELETE FROM kb_entry_embeddings WHERE entry_id = ?', [entryId]);
    vectors.delete(entryId);
  } catch (err) {
    console.error('[vector-store] 删除向量失败 (entryId=%d):', entryId, err.message);
  }
}

/**
 * 从内存 Map 获取向量
 */
function getVector(entryId) {
  return vectors.get(entryId);
}

/**
 * 返回内存 Map 的 entries() 迭代器，供搜索遍历
 */
function getAllVectors() {
  return vectors.entries();
}

/**
 * 返回当前内存 Map 大小
 */
function getVectorCount() {
  return vectors.size;
}

/**
 * 定时同步：对比 MySQL 有效条目，清理过期向量
 */
async function syncFromDb() {
  try {
    const [rows] = await pool.execute(
      "SELECT id FROM kb_entries WHERE status NOT IN ('archived', 'rejected')"
    );
    const validIds = new Set(rows.map(r => r.id));
    let purged = 0;
    for (const id of vectors.keys()) {
      if (!validIds.has(id)) {
        vectors.delete(id);
        purged++;
      }
    }
    if (purged > 0) {
      console.log(`[vector-store] 同步清理 ${purged} 个过期向量，当前: ${vectors.size}`);
    }
  } catch (err) {
    console.error('[vector-store] 同步失败:', err.message);
  }
}

/**
 * 启动向量存储：加载向量 + 启动定时同步（每 30 分钟）
 */
async function startVectorStore() {
  await loadFromDb();
  setInterval(syncFromDb, 30 * 60 * 1000);
  console.log('[vector-store] 向量存储已启动，定时同步间隔 30 分钟');
}