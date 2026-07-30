/**
 * services/vector-store.js — 向量缓存管理
 * 职责：MySQL 持久化 + 内存 Map 缓存，启动时全量加载，运行时增量更新。
 */

const pool = require('../db/connection');

// 内存向量缓存
const vectors = new Map();

/**
 * 从 MySQL 全量加载有效条目向量到内存（含重试机制）
 * @param {number} retries - 剩余重试次数，默认 3
 * @param {number} delayMs - 重试间隔（毫秒），默认 2000
 */
async function loadFromDb(retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // 先测试连接是否可用
      await pool.execute('SELECT 1');
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
      return; // 成功则返回
    } catch (err) {
      if (attempt < retries) {
        console.warn(`[vector-store] 加载向量第 ${attempt}/${retries} 次尝试失败: ${err.message}，${delayMs}ms 后重试`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        console.error(`[vector-store] 加载向量失败（已重试 ${retries} 次）:`, err.message);
        // 不崩溃，从空 Map 开始（搜索将降级到 FULLTEXT）
      }
    }
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

module.exports = {
  loadFromDb,
  setVector,
  deleteVector,
  getVector,
  getAllVectors,
  getVectorCount,
  syncFromDb,
  startVectorStore,
};
