/**
 * services/ai.js — AI API 调用服务
 * 职责：封装 OpenAI 兼容 Chat Completions API 调用，
 *       提取回复文本与 SQL 语句，处理超时与重试。
 * 对应框架文档第三章 3.2、第九章 9.3。
 */

const config = require('../config');

// SQL 代码块匹配模式（不含 g 标志，每次调用时创建新正则避免 lastIndex 残留）
const SQL_BLOCK_PATTERN = '```sql\\s*([\\s\\S]*?)```';

/**
 * 从 AI 回复文本中提取 SQL 语句
 * @param {string} text - AI 回复原文
 * @returns {string[]} SQL 语句数组（已清理首尾空白，末尾分号保留由执行器处理）
 */
function extractSqlStatements(text) {
  const statements = [];
  let match;
  // 每次创建新正则实例，避免全局 g 标志导致的 lastIndex 状态残留
  const regex = new RegExp(SQL_BLOCK_PATTERN, 'gi');
  while ((match = regex.exec(text)) !== null) {
    const sql = match[1].trim();
    if (sql) {
      statements.push(sql);
    }
  }
  return statements;
}

/**
 * 调用 AI API（带超时与重试）
 * @param {Array<{role:string, content:string}>} messages - OpenAI 格式 messages
 * @param {Object} [options] - 可选参数
 * @param {boolean} [options.enableWebSearch] - 启用联网搜索
 * @param {boolean} [options.enableThinking] - 启用深度思考
 * @returns {Promise<{replyText:string, sqlStatements:string[]}>}
 */
async function callAI(messages, options = {}) {
  const body = {
    model: config.ai.model,
    messages,
    temperature: 0.3,
  };

  // 联网搜索参数（需全局配置和请求参数同时允许）
  if (options.enableWebSearch && config.ai.enableWebSearch) {
    body.enable_web_search = true;
  }

  // 深度思考参数（需全局配置和请求参数同时允许）
  if (options.enableThinking && config.ai.enableThinking) {
    body.enable_thinking = true;
  }

  let lastError = null;
  const maxAttempts = config.ai.maxRetries + 1; // 1 次重试 = 最多 2 次尝试

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await callAIOnce(body, attempt);
      return result;
    } catch (err) {
      lastError = err;
      // 仅对超时或 5xx 重试
      const isRetryable = err.isTimeout || (err.httpStatus && err.httpStatus >= 500);
      if (attempt < maxAttempts && isRetryable) {
        // 等待 1 秒后重试
        await sleep(1000);
        continue;
      }
      throw err;
    }
  }
  // 理论上不会到达
  throw lastError || new Error('AI 调用失败');
}

/**
 * 单次调用 AI API
 */
async function callAIOnce(body, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);

  try {
    const resp = await fetch(config.ai.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(`AI API 返回 HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      err.httpStatus = resp.status;
      err.isTimeout = false;
      throw err;
    }

    const data = await resp.json();
    const message = data?.choices?.[0]?.message || {};
    let replyText = message.content || '';
    // 提取深度思考内容（DeepSeek reasoning_content）
    const thinkingContent = message.reasoning_content || message.thinking || '';

    // ⚠️ 必须在修改 replyText 之前提取 SQL，否则思考内容中的 ```sql 会被误提取
    const sqlStatements = extractSqlStatements(replyText);

    // 将思考内容附加到 replyText 前（仅用于展示，不影响 SQL 提取）
    if (thinkingContent) {
      replyText = `🧠 深度思考\n\`\`\`\n${thinkingContent}\n\`\`\`\n\n---\n\n${replyText}`;
    }

    if (!replyText) {
      const err = new Error('AI API 返回内容为空');
      err.isTimeout = false;
      throw err;
    }

    return { replyText, sqlStatements, thinking: thinkingContent };
  } catch (err) {
    // AbortError 视为超时
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`AI API 调用超时 (${config.ai.timeoutMs}ms)，第 ${attempt} 次尝试`);
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * sleep 工具
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { callAI, extractSqlStatements };
