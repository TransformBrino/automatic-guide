# 识途知识库 — 向量检索改造实施提示词

## 你的角色

你是一位资深全栈工程师，精通 Node.js（Express/Koa）、MySQL 8.0、向量检索（Embedding + 余弦相似度）。你将按照以下技术规范，在现有项目中实施向量检索改造。

## 输入：你需要先阅读以下文件

在开始任何修改之前，请先阅读并理解以下现有代码：

```
kb-server/config.js              ← 了解 ai 配置结构
kb-server/.env.example           ← 了解环境变量命名规范
kb-server/server.js              ← 了解启动流程和中间件挂载顺序
kb-server/routes/entries.js      ← 了解当前搜索逻辑（FULLTEXT + LIKE）
kb-server/routes/chat.js         ← 了解 INSERT/UPDATE/DELETE 的副作用处理函数
kb-server/routes/admin.js        ← 了解管理操作的软删除/归档流程
kb-server/db/schema.sql          ← 了解现有表结构和命名规范
kb-server/package.json           ← 了解现有 scripts 和依赖
```

## 输出格式

对每个步骤，请按以下格式输出：

```
### 步骤 N：步骤名称

**涉及文件**：`path/to/file.js`

**操作**：[新建 / 修改]

**代码**：
[完整代码块，标注语言类型]

**验证方式**：[如何确认此步骤正确完成]
```

## 执行方式

- 按第六章"实施步骤"表格中的顺序，**逐步执行**。
- 每完成一个步骤，输出该步骤的完整代码和验证方式，然后等待我确认后再继续下一步。
- 不要一次性输出所有步骤的代码。

## 禁止事项

- **禁止修改** `middleware/`、`utils/`、`prompts/` 目录下的任何文件。
- **禁止修改** `public/index.html` 前端代码（接口保持兼容，无需前端改动）。
- **禁止跳过**验证步骤。每个步骤必须执行验证。
- **禁止修改**与向量检索无关的现有代码逻辑。
- **禁止删除**现有的 FULLTEXT + LIKE 搜索逻辑（保留为降级通道）。
- **禁止输出**空泛的建议或评价（如"代码质量不错"），只输出具体的代码和实施操作。
- **禁止盲替代码**：在执行任何"原代码 → 替换为"操作之前，必须先读取目标文件，确认实际代码与文档中标注的"原代码"一致。如果实际代码不匹配，**停止操作并报告差异**，不要猜测式修改。
- **禁止假设文件位置**：在修改任何文件之前，必须先确认文件存在。如果文档中引用的行号或位置（如"在 XX 行下方"）与实际不符，以实际代码结构为准，并报告位置偏差。
- **禁止实施"建议"类内容**：文档中标注为"建议"、"可考虑"、"后续"的内容（如第 7 节第 12 条"相关条目推荐改造建议"），**不在本次改造范围内**，不得实施。

---

> **约束条件**：不更换数据库品牌（继续使用 MySQL 8.0），允许在现有 MySQL 中新增表结构。向量数据存储在 MySQL 新表中，启动时加载到内存做快速检索。
>
> **适用场景**：本项目为内网团队工具，条目量级 < 10 万。如果条目量超过 10 万，需考虑引入独立向量数据库（如 Milvus Lite / LanceDB），届时再评估。
>
> **自动探测策略（无需人工确认）**：
> 以下三个信息由 `embedding.js` 在启动时自动探测，用户无需手动配置：
> - **端点 URL**：从 `AI_API_URL` 自动推导，将 `/chat/completions` 替换为 `/embeddings`。同时支持可选环境变量 `EMBEDDING_API_URL` 覆盖。
> - **模型名称**：按优先级尝试候选列表 — `EMBEDDING_MODEL` 环境变量 → `AI_MODEL` 环境变量 → 已知模型名列表（`deepseek-embedding`、`text-embedding-3-small` 等），取第一个返回 200 的。
> - **向量维度**：从 API 响应中动态读取 `embedding.length`，永不硬编码。
>
> 详细实现见 4.1 节 `embedding.js`。

---

## 一、背景与目标

### 当前问题

知识库搜索使用 MySQL FULLTEXT INDEX（ngram 分词）+ LIKE 做关键词匹配，存在两个语义盲区：

1. **中文语义理解差**：搜"机器人卡住了"搜不到"机械臂运动异常"
2. **问答式查询不匹配**：搜"怎么处理急停故障"无法命中 `sop` 类型的紧急停机操作流程

### 改造目标

引入向量检索（Embedding + 余弦相似度），用语义相似度替代关键词匹配，同时保留 FULLTEXT + LIKE 作为降级通道。

### 为什么用 MySQL 做向量存储

- 同库存储：向量与条目在同一数据库中，备份恢复流程与现有体系一致，无需额外运维
- 运维简单：不需要额外部署向量数据库
- 内存加速：启动时一次性加载到内存 Map，运行时纯内存计算，不依赖 MySQL 做向量运算
- 条目量可控：1000 条 * [Embedding 维度] 维向量 ≈ [根据实际维度计算] MB 内存，10 万条 ≈ [根据实际维度计算] GB，仍在单机可承受范围（以 1536 维为例：1000 条 ≈ 12MB，10 万条 ≈ 1.2GB）

---

## 二、技术架构

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  entries.js  │────▶│ vector-search.js │────▶│  embedding.js   │
│  搜索请求     │     │  余弦相似度 Top-K  │     │  AI Embedding API│
└──────────────┘     └────────┬─────────┘     └─────────────────┘
                              │
                     ┌────────▼─────────┐
                     │  vector-store.js │
                     │  内存 Map 缓存    │
                     └────────┬─────────┘
                              │ 读写
                     ┌────────▼─────────┐
                     │     MySQL 8.0    │
                     │ kb_entry_        │
                     │ embeddings 表     │
                     └──────────────────┘
```

- **持久化存储**：MySQL 新增 `kb_entry_embeddings` 表，JSON 类型存储向量数组
- **内存缓存**：启动时从 MySQL 全量加载到内存 `Map<entryId, float[]>`，搜索时纯内存计算
- **向量生成**：调用 AI API 的 Embedding 端点（端点 URL 和模型名称需用户确认，与 Chat Completions 共用 API Key）
- **搜索方式**：查询文本 → 生成查询向量 → 遍历内存 Map 中所有向量计算余弦相似度 → 返回 Top-K
- **性能估测**：以下为基于 V8 引擎单线程计算的理论估算，实际受 CPU 主频、内存带宽和向量维度影响。以 1536 维为例：1000 条向量遍历 + 余弦计算 < 5ms，1 万条 < 30ms，10 万条 < 300ms。**建议在目标机器上实测后再确定 topK 取值和扩容阈值**。

---

## 三、数据库变更

### 3.1 新增表 `kb_entry_embeddings`

**新增迁移脚本**：`db/migration_vector.sql`

```sql
-- ============================================================
-- 向量检索改造 — 新增条目向量表
-- 运行方式：mysql -u root -p kb_db < db/migration_vector.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS kb_entry_embeddings (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  entry_id    INT NOT NULL,
  embedding   JSON NOT NULL COMMENT '向量数组，如 [0.0123, -0.0456, 0.0789, ...]',
  dimension   SMALLINT NOT NULL DEFAULT 0 COMMENT '向量维度（由实际 Embedding 模型决定，如 OpenAI text-embedding-3-small 为 1536）',
  model       VARCHAR(50) NOT NULL COMMENT 'Embedding 模型名（由用户确认，如 text-embedding-3-small）',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_entry_id (entry_id),
  FOREIGN KEY (entry_id) REFERENCES kb_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='条目向量表';
```

**设计说明**：
- `entry_id` 设 UNIQUE 约束，一条目一个向量（更新时覆盖）
- `embedding` 使用 JSON 类型，MySQL 8.0 原生支持，存储 N 个 float 值约 [N × 8] 字节（JSON 字符串表示，实际大小取决于维度数）
- `ON DELETE CASCADE`：条目被硬删除时自动清理向量
- 不需要额外索引：向量表只用于全量加载，不执行 WHERE 查询

### 3.2 更新 `db/schema.sql`

在 `schema.sql` 末尾追加上述建表语句，确保全新部署时自动创建该表。

---

## 四、新增文件（4 个，另含 1 个迁移脚本见第三节）

### 4.1 `services/embedding.js` — Embedding API 封装（含自动探测）

**职责**：调用 AI API 的 Embedding 端点，将文本转为浮点数向量数组。启动时自动探测可用的 Embedding 模型和端点。

**自动探测流程**（在模块首次调用 `getEmbedding` 时触发，全局只执行一次）：

```
1. 确定端点 URL：
   - 优先使用 config.ai.embeddingApiUrl（用户显式配置）
   - 否则从 config.ai.apiUrl 推导：将 /chat/completions 替换为 /embeddings

2. 构建候选模型列表（去重）：
   - config.ai.embeddingModel（用户显式配置）
   - config.ai.model（复用 Chat 模型名，如 deepseek-v4-pro）
   - config.ai.embeddingModelCandidates（候选列表：deepseek-embedding, text-embedding-3-small）

3. 逐个尝试调用 Embeddings API：
   - 请求体 { model, input: 'test' }
   - 超时 10 秒
   - 返回 200 且 data[0].embedding 为有效数组 → 探测成功
   - 记录 model 和 dimension（embedding.length）

4. 全部失败 → 抛出明确错误，服务降级到 FULLTEXT
```

**探测结果缓存**：探测成功后缓存 `{ model, dimension }` 到模块级变量，后续调用直接使用，不再重复探测。

**导出函数**：

```javascript
/**
 * 将文本转换为向量（首次调用时自动探测模型）
 * @param {string} text - 待向量化的文本
 * @returns {Promise<number[]>} 向量数组
 */
async function getEmbedding(text) {
  // 1. 确保已探测 Embedding 配置
  await ensureDetected();
  
  // 2. 构造请求
  const url = detectedConfig.apiUrl;
  const model = detectedConfig.model;
  
  // 3. 文本过长时按 \n\n 分段，逐段生成向量后取逐维平均值
  //    token 上限取决于实际 Embedding 模型，默认以 8000 字符为分段阈值
  const chunks = splitText(text, 8000);
  if (chunks.length === 1) {
    return await callEmbeddingAPI(url, model, chunks[0]);
  }
  
  const allVectors = await Promise.all(chunks.map(chunk => callEmbeddingAPI(url, model, chunk)));
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
```

**错误处理**：API 返回非 200 时抛出明确错误，调用方负责降级到 FULLTEXT。

---

### 4.2 `services/vector-store.js` — 向量缓存管理

**职责**：MySQL 持久化 + 内存 Map 缓存，启动时从 MySQL 加载，运行时同步更新。

**实现要点**：

1. 内存结构：`Map<entryId, { embedding: number[], dimension: number, model: string }>`
2. 启动时调用 `loadFromDb()`：`SELECT e.entry_id, e.embedding, e.dimension, e.model FROM kb_entry_embeddings e JOIN kb_entries k ON e.entry_id = k.id WHERE k.status NOT IN ('archived', 'rejected')`，将所有有效条目向量加载到内存 Map
3. 从 MySQL 读取的 `embedding` 字段是 JSON 类型，mysql2 驱动（版本 3.x）会自动解析为 JavaScript 数组。为兼容性，`loadFromDb` 中同时处理字符串和数组两种类型
4. `setVector(entryId, embedding, dimension, model)`：执行 `INSERT ... ON DUPLICATE KEY UPDATE` 写入 MySQL，同时更新内存 Map
5. `deleteVector(entryId)`：执行 `DELETE FROM kb_entry_embeddings WHERE entry_id = ?`，同时从内存 Map 移除
6. 定时同步（30 分钟）：对比 MySQL 中有效条目 ID 与内存 Map 的 key，清理已被归档/驳回/删除的条目向量（处理非 chat 路径的条目变更，如 admin 直接操作数据库等）

**导出函数**：

```javascript
function loadFromDb()              // 启动时从 MySQL 全量加载，返回 Promise
function setVector(entryId, embedding, dimension, model)  // 写入 MySQL + 更新内存 Map
function deleteVector(entryId)     // 从 MySQL 删除 + 从内存 Map 移除
function getVector(entryId)        // 从内存 Map 获取，返回 { embedding, dimension, model } 或 undefined
function getAllVectors()           // 返回内存 Map 的 entries() 迭代器，供搜索遍历
function getVectorCount()          // 返回当前内存 Map 大小
function syncFromDb()              // 定时同步：对比 MySQL 有效条目，清理过期向量
function startVectorStore()        // 启动：加载向量 + 启动定时同步
```

**`loadFromDb` 实现**：

```javascript
async function loadFromDb() {
  const pool = require('../db/connection');
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
```

**`setVector` 实现**：

```javascript
async function setVector(entryId, embedding, dimension, model) {
  const pool = require('../db/connection');
  try {
    await pool.execute(
      `INSERT INTO kb_entry_embeddings (entry_id, embedding, dimension, model)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE embedding = VALUES(embedding), dimension = VALUES(dimension), model = VALUES(model)`,
      [entryId, JSON.stringify(embedding), dimension, model]
    );
    // 同时更新内存 Map
    vectors.set(entryId, { embedding, dimension, model });
  } catch (err) {
    console.error('[vector-store] 写入向量失败 (entryId=%d):', entryId, err.message);
    throw err;
  }
}
```

**`deleteVector` 实现**：

```javascript
async function deleteVector(entryId) {
  const pool = require('../db/connection');
  try {
    await pool.execute('DELETE FROM kb_entry_embeddings WHERE entry_id = ?', [entryId]);
    vectors.delete(entryId);
  } catch (err) {
    console.error('[vector-store] 删除向量失败 (entryId=%d):', entryId, err.message);
  }
}
```

**`syncFromDb` 实现**（定时清理过期向量）：

```javascript
async function syncFromDb() {
  const pool = require('../db/connection');
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
```

**`startVectorStore` 实现**：

```javascript
async function startVectorStore() {
  await loadFromDb();
  // 每 30 分钟同步一次（处理非 chat 路径的条目变更）
  setInterval(syncFromDb, 30 * 60 * 1000);
  console.log('[vector-store] 向量存储已启动，定时同步间隔 30 分钟');
}
```

---

### 4.3 `services/vector-search.js` — 向量检索

**职责**：接收查询文本，返回语义最相似的 Top-K 条目 ID 及相似度分数。

**实现要点**：

1. 调用 `embedding.getEmbedding(queryText)` 获取查询向量
2. 调用 `vectorStore.getAllVectors()` 遍历内存 Map 中所有条目向量
3. 对每个条目计算余弦相似度：`cos(a, b) = dot(a,b) / (||a|| * ||b||)`
4. 按相似度降序排序，取前 `topK` 个
5. 返回 `[{ entryId: number, score: number }]`，`score` 为 -1 到 1 的浮点数（实际 Embedding 模型归一化后通常返回 0~1 之间的余弦相似度）

**导出函数**：

```javascript
/**
 * 向量相似度检索
 * @param {string} queryText - 查询文本
 * @param {number} topK - 返回数量，默认 20
 * @returns {Promise<Array<{entryId: number, score: number}>>}
 */
async function search(queryText, topK = 20) {
  // 1. 获取查询向量
  const queryVec = await embedding.getEmbedding(queryText);
  // 2. 遍历内存 Map 中所有向量，计算余弦相似度
  const scored = [];
  for (const [entryId, vecData] of vectorStore.getAllVectors()) {
    const score = cosineSimilarity(queryVec, vecData.embedding);
    scored.push({ entryId, score });
  }
  // 3. 排序取 Top-K
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
```

**余弦相似度计算**：

```javascript
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
```

---

### 4.4 `scripts/generate-embeddings.js` — 批量初始化向量

**职责**：遍历所有历史条目，为每条生成向量并写入 `kb_entry_embeddings` 表。

**实现要点**：

1. 从 `kb_entries` 查询所有 `status NOT IN ('archived', 'rejected')` 的条目
2. 对每条组合 `title + '\n\n' + summary + '\n\n' + full_content` 作为文本
3. 调用 `embedding.getEmbedding(text)` 生成向量
4. 写入 `vectorStore.setVector(id, embedding, embedding.length, embedding.getEmbeddingConfig().model)`
5. 限速：每秒最多 5 次请求（`await sleep(200)`），防止 API 限流
6. 每 10 条打印进度日志：`[generate-embeddings] 进度: 50/200 (25%)，成功: 48，失败: 2`
7. 完成后打印汇总：`[generate-embeddings] 完成！成功生成 198 条向量，失败 2 条`
8. 支持断点续传：开始前先查询 `kb_entry_embeddings` 中已存在的 entry_id，跳过已生成向量的条目

**运行方式**：`node scripts/generate-embeddings.js`

---

## 五、修改文件（7 个，另含 1 个 schema.sql 见第三节）

### 5.1 `config.js` — 新增 Embedding 配置

在 `config.ai` 对象中新增字段：

```javascript
// 在 ai 对象内部新增（均为可选，不配置时自动探测）
// Embedding API 端点（可选），不配置时从 apiUrl 自动推导
embeddingApiUrl: process.env.EMBEDDING_API_URL || '',
// Embedding 模型（可选），不配置时按候选列表自动探测
embeddingModel: process.env.EMBEDDING_MODEL || '',
// 候选模型列表（启动探测用，可通过逗号分隔的环境变量覆盖）
embeddingModelCandidates: (process.env.EMBEDDING_MODEL_CANDIDATES || 'deepseek-embedding,text-embedding-3-small').split(','),
```

---

### 5.2 `.env.example` — 新增环境变量

在 `AI_MODEL=gpt-4o` 行下方新增：

```
# Embedding 配置（以下均为可选，不配置时自动探测）
# EMBEDDING_API_URL=           # Embedding 端点，不配置时从 AI_API_URL 自动推导
# EMBEDDING_MODEL=             # Embedding 模型名，不配置时自动探测
# EMBEDDING_MODEL_CANDIDATES=deepseek-embedding,text-embedding-3-small  # 候选模型列表
```

---

### 5.3 `package.json` — 新增 npm script

在 `"scripts"` 中新增：

```json
"generate-embeddings": "node scripts/generate-embeddings.js"
```

---

### 5.4 `server.js` — 向量存储初始化

**改动**：`startVectorStore()` 是异步函数，`server.js` 中需要在启动流程中正确处理。

在 `session.startCleanupTimer()` 调用之后，`app.listen()` 之前新增：

```javascript
// 启动向量存储（从 MySQL 加载向量到内存 + 启动定时同步）
const vectorStore = require('./services/vector-store');
vectorStore.startVectorStore().then(() => {
  console.log('[server] 向量存储初始化完成');
}).catch(err => {
  console.error('[server] 向量存储初始化失败:', err.message);
});
```

启动日志中预期看到：`[vector-store] 从 MySQL 加载 X 个向量`

---

### 5.5 `routes/entries.js` — 搜索逻辑改造（核心改动）

**文件顶部新增 require**：

```javascript
const vectorSearch = require('../services/vector-search');
const vectorStore = require('../services/vector-store'); // 用于判断向量库是否为空
```

**改造 `GET /api/entries` 的搜索逻辑**。

**原代码（L44-L50）**：

```javascript
if (q && typeof q === 'string' && q.trim() !== '') {
  conditions.push('(MATCH(title, summary, full_content) AGAINST(? IN NATURAL LANGUAGE MODE) OR title LIKE ? OR summary LIKE ?)');
  const likePattern = `%${q.trim()}%`;
  params.push(q.trim(), likePattern, likePattern);
}

const hasSearch = !!(q && typeof q === 'string' && q.trim() !== '');
```

**替换为**：

```javascript
const hasSearch = !!(q && typeof q === 'string' && q.trim() !== '');
let vectorIds = null; // 非 null 表示向量检索成功，值为按相似度降序的条目 ID 数组

if (hasSearch) {
  // 向量库为空时（初始部署未执行 generate-embeddings）直接走 FULLTEXT，避免返回空结果
  if (vectorStore.getVectorCount() === 0) {
    conditions.push('(MATCH(title, summary, full_content) AGAINST(? IN NATURAL LANGUAGE MODE) OR title LIKE ? OR summary LIKE ?)');
    const likePattern = `%${q.trim()}%`;
    params.push(q.trim(), likePattern, likePattern);
  } else {
    try {
      const vectorResults = await vectorSearch.search(q.trim(), 50);
      if (vectorResults.length > 0) {
        vectorIds = vectorResults.map(r => r.entryId);
        conditions.push(`id IN (${vectorIds.join(',')})`);
      } else {
        // 向量检索无结果，设置不可能条件避免返回全表
        conditions.push('1=0');
      }
    } catch (e) {
      // 降级：Embedding API 不可用时回退到 FULLTEXT + LIKE
      console.warn('[entries] 向量检索失败，回退全文检索:', e.message);
      conditions.push('(MATCH(title, summary, full_content) AGAINST(? IN NATURAL LANGUAGE MODE) OR title LIKE ? OR summary LIKE ?)');
      const likePattern = `%${q.trim()}%`;
      params.push(q.trim(), likePattern, likePattern);
    }
  }
}
```

**改造 `relevanceSelect` 和 `ORDER BY`（原 L102-L117）**：

**原代码**：

```javascript
const relevanceSelect = hasSearch
  ? ', MATCH(title, summary, full_content) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance'
  : '';

const listSql = `
  SELECT id, entry_code, title, knowledge_type, architecture_layer, scene,
         severity, summary, status, score_total, version_label,
         created_by, reviewer_id, created_at, updated_at, reviewed_at${relevanceSelect}
  FROM kb_entries
  ${whereClause}
  ORDER BY ${hasSearch ? 'relevance DESC, ' : ''}${sortField} ${sortOrder}
  LIMIT ${limitNum} OFFSET ${offset}
`;

const listParams = hasSearch ? [q.trim(), ...params] : params;
```

**替换为**：

```javascript
// 相关性字段：仅在使用 FULLTEXT 时添加 MATCH 评分
// 向量检索（vectorIds !== null）和无搜索（hasSearch=false）时均不需要
const relevanceSelect = (hasSearch && vectorIds === null)
  ? ', MATCH(title, summary, full_content) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance'
  : '';

// 排序策略：
// - 向量检索成功：按 FIELD(id, ...) 保持相似度降序
// - FULLTEXT 降级：按 relevance 降序，再按用户指定排序
// - 无搜索词：按用户指定排序
let orderByClause;
if (vectorIds !== null) {
  orderByClause = `ORDER BY FIELD(id, ${vectorIds.join(',')})`;
} else if (hasSearch) {
  orderByClause = `ORDER BY relevance DESC, ${sortField} ${sortOrder}`;
} else {
  orderByClause = `ORDER BY ${sortField} ${sortOrder}`;
}

const listSql = `
  SELECT id, entry_code, title, knowledge_type, architecture_layer, scene,
         severity, summary, status, score_total, version_label,
         created_by, reviewer_id, created_at, updated_at, reviewed_at${relevanceSelect}
  FROM kb_entries
  ${whereClause}
  ${orderByClause}
  LIMIT ${limitNum} OFFSET ${offset}
`;

// 仅 FULLTEXT 时需要额外传递搜索词参数给 relevance 计算
const listParams = (hasSearch && vectorIds === null) ? [q.trim(), ...params] : params;
```

---

### 5.6 `routes/chat.js` — 条目 CRUD 时同步向量

**文件顶部新增 require**：

```javascript
const embedding = require('../services/embedding');
const vectorStore = require('../services/vector-store');
```

**改造位置 1**：`handleInsertSuccess` 函数（约 L435-L484），在 `return` 语句之前新增异步向量生成：

```javascript
// 异步生成向量（不阻塞主流程响应）
setImmediate(async () => {
  try {
    if (!insertId) return;
    const [rows] = await pool.execute(
      'SELECT id, title, summary, full_content FROM kb_entries WHERE id = ?',
      [insertId]
    );
    if (rows.length > 0) {
      const text = `${rows[0].title}\n\n${rows[0].summary}\n\n${rows[0].full_content}`;
      const vec = await embedding.getEmbedding(text);
      const embConfig = embedding.getEmbeddingConfig();
      await vectorStore.setVector(insertId, vec, vec.length, embConfig.model);
      console.log(`[chat] 向量已生成 (entryId=${insertId})`);
    }
  } catch (e) {
    console.error('[chat] 异步生成向量失败 (entryId=%d):', insertId, e.message);
  }
});
```

**改造位置 2**：`handleUpdateSuccess` 函数（约 L489-L521），在遍历 `oldEntries` 写入 version_history 和 audit_log 的循环中，对每个 `old.id` 追加异步向量更新：

```javascript
// 在 handleUpdateSuccess 的 for 循环内部，audit_log 写入之后追加
setImmediate(async () => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, summary, full_content FROM kb_entries WHERE id = ?',
      [old.id]
    );
    if (rows.length > 0) {
      const text = `${rows[0].title}\n\n${rows[0].summary}\n\n${rows[0].full_content}`;
      const vec = await embedding.getEmbedding(text);
      const embConfig = embedding.getEmbeddingConfig();
      await vectorStore.setVector(old.id, vec, vec.length, embConfig.model);
      console.log(`[chat] 向量已更新 (entryId=${old.id})`);
    }
  } catch (e) {
    console.error('[chat] 异步更新向量失败 (entryId=%d):', old.id, e.message);
  }
});
```

**改造位置 3**：`handleDeleteSuccess` 函数签名与调用处。

当前 `handleDeleteSuccess`（L526）的签名为 `(result, user, ip, replyText)`，无法获取被删除的条目 ID。需要修改：

- 将 L145 的调用改为 `handleDeleteSuccess(result, user, clientIp, replyText, sqlStatements)`
- 将 L326 流式接口中的对应调用也改为 `handleDeleteSuccess(result, user, clientIp, replyText, sqlStatements)`
- 修改函数签名（L526）为 `async function handleDeleteSuccess(result, user, ip, replyText, sqlStatements)`

在 `handleDeleteSuccess` 函数内部，audit_log 写入之后新增：

```javascript
// 从 DELETE 语句中提取被删除条目 ID，清理向量
const deletedIds = [];
for (const sql of (sqlStatements || [])) {
  const idMatch = sql.match(/WHERE\s+id\s*=\s*(\d+)/i);
  if (idMatch) deletedIds.push(parseInt(idMatch[1], 10));
}
for (const id of deletedIds) {
  await vectorStore.deleteVector(id);
}
```

---

### 5.7 `routes/admin.js` — 管理操作同步向量

**文件顶部新增 require**：

```javascript
const vectorStore = require('../services/vector-store');
```

**改造位置 1**：`DELETE /api/admin/entries/:id`（软删除，约 L25-L81），事务提交成功后新增：

```javascript
await vectorStore.deleteVector(id);
```

**改造位置 2**：`POST /api/admin/entries/:id/archive`（归档，约 L86-L144），事务提交成功后新增：

```javascript
await vectorStore.deleteVector(id);
```

---

## 六、实施步骤（按顺序执行）

| 步骤 | 内容 | 涉及文件 | 验证方式 |
|------|------|---------|---------|
| 1 | 执行数据库迁移 | `db/migration_vector.sql` | `SHOW TABLES LIKE 'kb_entry_embeddings'` 返回该表 |
| 2 | 更新 `schema.sql` | `db/schema.sql` | 文件末尾包含 `kb_entry_embeddings` 建表语句 |
| 3 | 新增 `EMBEDDING_MODEL` 配置 | `config.js` + `.env.example` | 启动服务，`config.ai.embeddingModel` 和 `config.ai.embeddingApiUrl` 均为可选字段，默认空字符串 |
| 4 | 新建 `embedding.js` | `services/embedding.js` | 写临时脚本调 `getEmbedding('测试文本')`，日志应输出 `[embedding] 探测成功: model=xxx, dimension=xxx`，返回正确的浮点数数组 |
| 5 | 新建 `vector-store.js` | `services/vector-store.js` | 启动服务，日志输出 `[vector-store] 从 MySQL 加载 0 个向量` |
| 6 | 新建 `vector-search.js` | `services/vector-search.js` | 手动在 `kb_entry_embeddings` 中 INSERT 一条测试数据，调 `search('测试查询')` 确认返回结果 |
| 7 | 修改 `server.js` 初始化向量存储 | `server.js` | 启动日志中看到 `[vector-store] 从 MySQL 加载 X 个向量` |
| 8 | 批量生成历史向量 | `scripts/generate-embeddings.js` + `package.json` | `npm run generate-embeddings`，确认 `kb_entry_embeddings` 表中有数据，日志输出成功/失败统计 |
| 9 | 改造搜索接口 | `routes/entries.js` | 向量库为空时搜索应走 FULLTEXT 降级；向量库有数据后搜索"机器人故障"应返回语义相关结果；搜"xyzabc123"无意义词应返回空 |
| 10 | 改造 CRUD 同步 | `routes/chat.js` | 新增一条条目后，确认 `kb_entry_embeddings` 中新增对应向量，内存 Map 同步更新；更新条目后向量被更新；删除条目后向量被移除 |
| 11 | 改造管理操作同步 | `routes/admin.js` | 管理页面归档一条条目后，确认向量被移除 |
| 12 | 前端验证 | `public/index.html` | 知识库 Tab 搜索，验证结果语义相关性（无需改前端代码，接口兼容） |

---

## 七、注意事项

1. **Embedding 维度**：从 API 响应中动态读取 `embedding.length`，不硬编码。代码中 `dimension` 取实际返回值，切换模型时自动适配。
2. **MySQL JSON 列**：MySQL 8.0 的 JSON 类型存储向量数组。mysql2 驱动（3.x）会自动将 JSON 列解析为 JavaScript 数组，无需手动 `JSON.parse`。但为兼容性，`loadFromDb` 中同时处理字符串和数组两种类型。
3. **内存占用**：参见第一节"为什么用 MySQL 做向量存储"中的估算。启动时全量加载，运行时只做增量更新。
4. **搜索性能**：参见第二节性能估测。性能数据为理论估算值，建议在目标机器上实测后确定 topK 取值和扩容阈值。如果条目量超过 10 万，需评估引入向量数据库或分片策略。
5. **降级策略**：Embedding API 不可用时，搜索自动回退到 FULLTEXT + LIKE。向量库为空时（初始部署未执行 `generate-embeddings`），也直接走 FULLTEXT 降级，不会返回空结果。
6. **并发安全**：Node.js 单线程模型下，内存 Map 读写无并发问题。MySQL 写入使用 `ON DUPLICATE KEY UPDATE` 保证原子性。
7. **数据一致性**：向量写入在 `setImmediate` 中异步执行，不与主事务绑定。如果向量写入失败，不影响条目创建/更新成功。向量缺失的条目在搜索时不会被命中，由定时同步（`syncFromDb`）兜底检测 ID 级别的缺失。注意：非 chat 路径（admin 直接操作、review 审核通过等）的条目变更不会触发即时向量同步，依赖 `syncFromDb` 每 30 分钟清理，存在最大 30 分钟的向量不一致窗口。
8. **API 限流**：`generate-embeddings.js` 内置 200ms 间隔，每秒最多 5 次请求。如果条目量很大（> 5000），建议在夜间执行批量脚本。
9. **ON DELETE CASCADE**：`kb_entry_embeddings` 的外键设了 `ON DELETE CASCADE`，当条目被硬删除时向量自动清理。但本项目使用软删除（status='archived'），CASCADE 只在极少数硬删除场景生效，日常依赖 `syncFromDb` 和 `deleteVector` 手动清理。
10. **向量检索 + 分页的边界限制**：搜索接口先取 Top-50 向量结果，再交由 MySQL 分页。当用户翻页较深（如第 3 页，offset=40）且其他筛选条件（knowledge_type、scene 等）过滤后剩余条目不足时，后续页可能返回空结果。建议在条目量增长后，将 `topK` 从 50 提高到 100-200，或后续引入向量数据库的分页能力。
11. **syncFromDb 的局限性**：`syncFromDb` 仅对比条目 ID 是否存在于有效集合中，无法检测向量内容是否过期（如条目内容更新后异步向量写入失败）。内容级别的向量不一致需要依赖条目下次更新时重新触发向量生成来修复。
12. **相关条目推荐改造建议**：当前 `GET /api/entries/:id/related` 基于 scene + knowledge_type 规则匹配，后续可考虑改为向量相似度推荐（用当前条目的向量与所有条目向量计算余弦相似度），提升推荐质量。此项不在本次改造范围内，但架构已为此预留扩展能力。

---

## 八、文件变更总览

```
新增文件（5 个）：
  kb-server/db/migration_vector.sql          ← 新增 kb_entry_embeddings 表
  kb-server/services/embedding.js            ← Embedding API 封装
  kb-server/services/vector-store.js         ← MySQL 持久化 + 内存 Map 缓存
  kb-server/services/vector-search.js        ← 余弦相似度检索引擎
  kb-server/scripts/generate-embeddings.js   ← 历史数据批量向量化脚本

修改文件（8 个）：
  kb-server/db/schema.sql          ← 末尾追加 kb_entry_embeddings 建表语句
  kb-server/config.js              ← 新增 embeddingModel 配置项
  kb-server/.env.example           ← 新增 EMBEDDING_MODEL 环境变量
  kb-server/package.json           ← 新增 generate-embeddings 脚本
  kb-server/server.js              ← 新增 vectorStore.startVectorStore() 初始化
  kb-server/routes/entries.js      ← 搜索逻辑改造（向量优先 + FULLTEXT 降级 + 空库兜底）
  kb-server/routes/chat.js         ← INSERT/UPDATE/DELETE 时同步向量
  kb-server/routes/admin.js        ← 归档/删除时清理向量

不修改（零变更）：
  kb-server/middleware/            ← 认证、限流不变
  kb-server/utils/                 ← 工具函数不变
  kb-server/prompts/               ← AI Prompt 不变
  kb-server/public/index.html      ← 前端接口兼容，无强制改动需要
```

---

## 九、验收标准

1. 向量库为空时（初始部署），搜索任意关键词应走 FULLTEXT 降级，返回正常搜索结果
2. 向量库有数据后，搜索"机器人故障处理"返回的 Top 3 结果中至少包含 1 条与故障处理相关的条目（即使标题不含"故障"二字）
3. 搜索无意义字符串"xyzabc123"返回空结果
4. 故意停掉 AI API 后，搜索仍能正常工作（回退到 FULLTEXT + LIKE）
5. 新增一条条目后，30 秒内 `kb_entry_embeddings` 表中出现对应向量，再次搜索能命中该条目
6. 归档一条条目后，30 分钟内再次搜索不返回该条目（定时同步兜底）
7. `npm run generate-embeddings` 执行成功，日志显示成功/失败统计，失败数 < 总数 5%
8. 启动服务时日志包含 `[vector-store] 从 MySQL 加载 X 个向量`，X 与 `kb_entry_embeddings` 表中有效条目数一致
9. 重启服务后，内存向量缓存正确恢复，搜索功能正常

---

## 十、防幻觉指令（必须遵守）

以下指令优先级高于前述所有技术规范。当技术规范与以下指令冲突时，以下指令为准。

### 不确定时必须标注

- 如果你不确定某个信息（如 DeepSeek Embeddings API 端点路径），**必须实现自动探测**而非猜测填充。遵循 4.1 节的自动探测流程：从现有 `AI_API_URL` 推导端点，按候选列表逐个尝试模型，从 API 响应动态获取维度。
- 如果自动探测全部失败，**必须输出明确的错误信息**，列出尝试过的候选模型和端点 URL，让用户据此排查，而不是猜测一个值继续执行。

### 所有建议必须基于文档明确写出的内容

- 所有代码修改必须基于本提示词中明确写出的改造方案。**不得凭空推断**额外的优化或重构。
- 如果发现本提示词中信息不足以完成某个步骤，**列出需要补充的信息**，而不是自行假设后继续。

### 不引用未验证的外部知识

- 如果你在实现中引用了外部知识（如 API 文档、npm 包特性），必须在代码注释中标注信息来源。
- 示例：「// mysql2 3.x 自动解析 JSON 列，参考: https://github.com/sidorares/node-mysql2」

### 处理不匹配的代码

- 如果执行"原代码 → 替换为"时，发现实际代码与文档中的"原代码"不一致：
  1. **立即停止**该步骤
  2. **报告差异**：列出文档中的代码 vs 实际代码
  3. **等待确认**：不要猜测式修改
- 如果文件路径不存在，**报告缺失的文件路径**，不要自行创建或猜测替代路径。

### 正则表达式边界处理

- 第 5.6 节中用于提取 DELETE 条目 ID 的正则表达式 `WHERE\s+id\s*=\s*(\d+)` 仅匹配 `WHERE id = N` 格式。如果实际 SQL 使用其他格式（如 `WHERE id IN (...)`、`WHERE entry_code = '...'`），**必须报告无法解析**，并展示实际的 SQL 语句供用户确认。

### 性能数据引用

- 本提示词中的性能数据（5ms/30ms/300ms）均为理论估算值，**不得在代码注释、日志输出或文档中作为实测数据引用**。如需标注，必须写明"理论估算值，未经实测"。