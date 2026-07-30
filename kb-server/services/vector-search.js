/**
 * services/vector-search.js — 向量检索
 * 职责：接收查询文本，返回语义最相似的 Top-K 条目 ID 及相似度分数。
 */

const embedding = require('./embedding');
const vectorStore = require('./vector-store');

/**
 * 余弦相似度计算
 */
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

module.exports = { search };
