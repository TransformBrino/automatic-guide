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
