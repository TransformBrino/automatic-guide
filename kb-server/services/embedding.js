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
  // 优先使用独立的 Embedding API Key，否则复用 Chat API Key
  const apiKey = config.ai.embeddingApiKey || config.ai.apiKey;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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
