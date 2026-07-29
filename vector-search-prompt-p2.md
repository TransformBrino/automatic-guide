# 识途知识库 — 向量检索改造（第 2/3 批：业务改造层）

## 你的角色

你是一位资深全栈工程师，精通 Node.js（Express）、MySQL 8.0、向量检索。

## 前置条件

第 1 批（基础设施层）已全部完成：
- `kb_entry_embeddings` 表已创建
- `services/embedding.js`、`services/vector-store.js`、`services/vector-search.js` 已就绪
- `server.js` 启动时自动初始化向量存储
- `config.js` 已新增 `embeddingApiUrl`、`embeddingModel`、`embeddingModelCandidates` 配置项

## 执行前必读

在开始修改之前，请先阅读以下文件，确认实际代码结构：

```
kb-server/routes/entries.js      ← 了解当前搜索逻辑（FULLTEXT + LIKE，L44-L117）
kb-server/routes/chat.js         ← 了解 INSERT/UPDATE/DELETE 的副作用处理函数
kb-server/routes/admin.js        ← 了解软删除/归档的处理流程
kb-server/package.json           ← 了解现有 scripts
```

## 执行方式

按以下步骤**逐步执行**。每完成一个步骤，输出完整代码和验证方式，等待我确认后再继续下一步。

## 禁止事项

- **禁止修改** `middleware/`、`utils/`、`prompts/` 目录下的任何文件
- **禁止修改** `public/index.html` 前端代码
- **禁止删除**现有的 FULLTEXT + LIKE 搜索逻辑（保留为降级通道）
- **禁止盲替代码**：修改前必须先读取目标文件，确认实际代码与文档标注一致。不一致则停止并报告差异。

---

## 步骤 8：批量生成历史向量

**新建文件**：`kb-server/scripts/generate-embeddings.js`

**职责**：遍历所有历史条目，为每条生成向量并写入 `kb_entry_embeddings` 表。

**实现要点**：
1. 从 `kb_entries` 查询所有 `status NOT IN ('archived', 'rejected')` 的条目
2. 对每条组合 `title + '\n\n' + summary + '\n\n' + full_content` 作为文本
3. 调用 `embedding.getEmbedding(text)` 生成向量
4. 写入 `vectorStore.setVector(id, embedding, embedding.length, embedding.getEmbeddingConfig().model)`
5. 限速：每秒最多 5 次请求（`await sleep(200)`）
6. 每 10 条打印进度日志
7. 完成后打印汇总：成功/失败统计
8. 支持断点续传：跳过已有向量的条目

**代码**：

```javascript
/**
 * scripts/generate-embeddings.js — 批量初始化向量
 * 职责：遍历所有历史条目，为每条生成向量并写入 kb_entry_embeddings 表。
 * 运行方式：node scripts/generate-embeddings.js
 */

const pool = require('../db/connection');
const embedding = require('../services/embedding');
const vectorStore = require('../services/vector-store');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('[generate-embeddings] 开始批量生成向量...');

  // 1. 查询所有有效条目
  const [entries] = await pool.execute(
    "SELECT id, title, summary, full_content FROM kb_entries WHERE status NOT IN ('archived', 'rejected')"
  );
  console.log(`[generate-embeddings] 共 ${entries.length} 个有效条目`);

  // 2. 查询已存在向量的条目（断点续传）
  const [existing] = await pool.execute('SELECT entry_id FROM kb_entry_embeddings');
  const existingIds = new Set(existing.map(r => r.entry_id));
  const pending = entries.filter(e => !existingIds.has(e.id));
  console.log(`[generate-embeddings] 跳过 ${existingIds.size} 个已有向量，待处理 ${pending.length} 个`);

  // 3. 逐条生成向量
  let success = 0;
  let failed = 0;
  const total = pending.length;

  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    try {
      const text = `${entry.title}\n\n${entry.summary}\n\n${entry.full_content}`;
      const vec = await embedding.getEmbedding(text);
      const embConfig = embedding.getEmbeddingConfig();
      await vectorStore.setVector(entry.id, vec, vec.length, embConfig.model);
      success++;
    } catch (e) {
      failed++;
      console.error(`[generate-embeddings] 条目 ${entry.id} 失败: ${e.message}`);
    }

    if ((i + 1) % 10 === 0) {
      console.log(`[generate-embeddings] 进度: ${i + 1}/${total} (${Math.round((i + 1) / total * 100)}%)，成功: ${success}，失败: ${failed}`);
    }

    // 限速：每秒最多 5 次请求
    await sleep(200);
  }

  console.log(`[generate-embeddings] 完成！成功生成 ${success} 条向量，失败 ${failed} 条`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[generate-embeddings] 执行失败:', err.message);
  process.exit(1);
});
```

**修改文件**：`kb-server/package.json`

在 `"scripts"` 中新增：

```json
"generate-embeddings": "node scripts/generate-embeddings.js"
```

**验证**：执行 `npm run generate-embeddings`，确认 `kb_entry_embeddings` 表中有数据，日志输出成功/失败统计，失败数 < 总数 5%。

---

## 步骤 9：改造搜索接口 — `routes/entries.js`

**修改文件**：`kb-server/routes/entries.js`

这是核心改动。在文件顶部新增 require：

```javascript
const vectorSearch = require('../services/vector-search');
const vectorStore = require('../services/vector-store');
```

### 9.1 改造搜索条件构建（原 L44-L50）

**原代码**（L44-L50）：
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
      // 向量库为空时直接走 FULLTEXT，避免返回空结果
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

### 9.2 改造 relevanceSelect 和 ORDER BY（原 L102-L117）

**原代码**（L102-L117）：
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

**验证**：
1. 向量库为空时搜索 → 走 FULLTEXT 降级，返回正常结果
2. 向量库有数据后搜索"机器人故障" → 返回语义相关结果
3. 搜索无意义词"xyzabc123" → 返回空结果

---

## 步骤 10：改造 CRUD 同步 — `routes/chat.js`

**修改文件**：`kb-server/routes/chat.js`

在文件顶部新增 require：

```javascript
const embedding = require('../services/embedding');
const vectorStore = require('../services/vector-store');
```

### 10.1 改造 `handleInsertSuccess` — 新增条目后异步生成向量

找到 `handleInsertSuccess` 函数（约 L435-L484），在 `return` 语句之前新增：

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

### 10.2 改造 `handleUpdateSuccess` — 更新条目后异步更新向量

找到 `handleUpdateSuccess` 函数（约 L489-L521），在遍历 `oldEntries` 的 for 循环内部，audit_log 写入之后追加：

```javascript
    // 异步更新向量
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

### 10.3 改造 `handleDeleteSuccess` — 删除条目后清理向量

`handleDeleteSuccess`（约 L526）当前签名为 `(result, user, ip, replyText)`，无法获取被删除的条目 ID。需要两处修改：

**A. 修改调用处**（约 L145 和 L326 流式接口对应处）：
```javascript
// 原调用：handleDeleteSuccess(result, user, clientIp, replyText)
// 改为：
handleDeleteSuccess(result, user, clientIp, replyText, sqlStatements)
```

**B. 修改函数签名**（L526）：
```javascript
// 原：async function handleDeleteSuccess(result, user, ip, replyText)
// 改为：
async function handleDeleteSuccess(result, user, ip, replyText, sqlStatements)
```

**C. 在函数内部，audit_log 写入之后新增**：
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

> **注意**：正则 `WHERE\s+id\s*=\s*(\d+)` 仅匹配 `WHERE id = N` 格式。如果实际 SQL 使用其他格式（如 `WHERE id IN (...)`），**必须停止并报告实际 SQL 语句**，不要猜测修改。

**验证**：
1. 新增一条条目后，确认 `kb_entry_embeddings` 中新增对应向量
2. 更新条目后，向量被更新
3. 删除条目后，向量被移除

---

## 步骤 11：改造管理操作同步 — `routes/admin.js`

**修改文件**：`kb-server/routes/admin.js`

在文件顶部新增 require：

```javascript
const vectorStore = require('../services/vector-store');
```

### 11.1 软删除接口（`DELETE /api/admin/entries/:id`，约 L25-L81）

在事务提交成功后新增：

```javascript
await vectorStore.deleteVector(id);
```

### 11.2 归档接口（`POST /api/admin/entries/:id/archive`，约 L86-L144）

在事务提交成功后新增：

```javascript
await vectorStore.deleteVector(id);
```

**验证**：管理页面归档一条条目后，确认向量被移除。

---

## 第 2 批完成标准

- [ ] `npm run generate-embeddings` 执行成功，历史条目向量已生成
- [ ] 搜索"机器人故障"返回语义相关结果（向量检索优先）
- [ ] 向量库为空或 Embedding API 不可用时，自动降级到 FULLTEXT + LIKE
- [ ] 新增条目后，向量自动生成
- [ ] 更新条目后，向量自动更新
- [ ] 删除/归档条目后，向量自动清理

全部完成后，请告知我进入第 3 批（验证与收尾）。