/**
 * services/ai.js — AI API 调用服务
 * 职责：封装 OpenAI 兼容 Chat Completions API 调用，
 *       提取回复文本与 SQL 语句，处理超时与重试。
 * 对应框架文档第三章 3.2、第九章 9.3。
 */

const config = require('../config');
const { createModuleLogger } = require('./logger'); // P9-T11

const logger = createModuleLogger('ai');

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
 * 三态熔断器（P9-T19：AI 调用熔断保护）
 * - Closed → 正常调用，记录失败次数
 * - Open → 连续 5 次失败后打开，直接拒绝请求
 * - HalfOpen → 30 秒后试探 1 次，成功恢复 / 失败重新打开
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.timeoutMs = options.timeoutMs || 30000;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'closed'; // closed | open | half-open
  }

  get isOpen() {
    if (this.state === 'closed') return false;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.timeoutMs) {
        this.state = 'half-open';
        logger.info('熔断器进入半开状态，允许试探请求');
        return false;
      }
      return true;
    }
    // half-open: 允许通过 1 次试探
    return false;
  }

  recordSuccess() {
    if (this.state === 'half-open') {
      logger.info('试探请求成功，熔断器关闭');
    }
    this.failureCount = 0;
    this.state = 'closed';
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      if (this.state !== 'open') {
        logger.warn('熔断器打开', { failureCount: this.failureCount, state: this.state });
      }
      this.state = 'open';
    }
  }

  reset() {
    this.failureCount = 0;
    this.state = 'closed';
    this.lastFailureTime = 0;
  }
}

const circuitBreaker = new CircuitBreaker();

/**
 * 调用 AI API（带超时与重试）
 * @param {Array<{role:string, content:string}>} messages - OpenAI 格式 messages
 * @param {Object} [options] - 可选参数
 * @param {boolean} [options.enableWebSearch] - 启用联网搜索
 * @param {boolean} [options.enableThinking] - 启用深度思考
 * @returns {Promise<{replyText:string, sqlStatements:string[]}>}
 */
async function callAI(messages, options = {}) {
  // P9-T19：熔断器检查
  if (circuitBreaker.isOpen) {
    const err = new Error('AI 服务暂时不可用（已熔断），请稍后再试');
    err.isCircuitOpen = true;
    throw err;
  }

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
      // P9-T19：成功则重置熔断器
      circuitBreaker.recordSuccess();
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
      // P9-T19：失败记录到熔断器
      circuitBreaker.recordFailure();
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
 * 流式调用 AI API（P9-T7：SSE 逐 token 输出）
 * @param {Array<{role:string, content:string}>} messages
 * @param {Object} [options]
 * @param {boolean} [options.enableWebSearch]
 * @param {boolean} [options.enableThinking]
 * @returns {AsyncGenerator<{content:string, thinking:string, done:boolean}>}
 */
async function* callAIStream(messages, options = {}) {
  // P9-T19：熔断器检查
  if (circuitBreaker.isOpen) {
    const err = new Error('AI 服务暂时不可用（已熔断），请稍后再试');
    err.isCircuitOpen = true;
    throw err;
  }

  const body = {
    model: config.ai.model,
    messages,
    temperature: 0.3,
    stream: true,
  };

  if (options.enableWebSearch && config.ai.enableWebSearch) {
    body.enable_web_search = true;
  }
  if (options.enableThinking && config.ai.enableThinking) {
    body.enable_thinking = true;
  }

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

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let hasYielded = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按行解析 SSE 数据
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 最后一个不完整行留在 buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const jsonStr = trimmed.slice(6); // 去掉 "data: "
        if (jsonStr === '[DONE]') {
          // P9-T19：流正常结束，标记成功
          circuitBreaker.recordSuccess();
          yield { content: '', thinking: '', done: true };
          return;
        }

        try {
          const data = JSON.parse(jsonStr);
          const delta = data?.choices?.[0]?.delta || {};
          const content = delta.content || '';
          const thinking = delta.reasoning_content || delta.thinking || '';

          if (content || thinking) {
            // P9-T19：首次收到 token，标记 API 正常工作
            if (!hasYielded) {
              circuitBreaker.recordSuccess();
              hasYielded = true;
            }
            yield { content, thinking, done: false };
          }
        } catch (_) {
          // 忽略解析失败的行
        }
      }
    }

    // 处理剩余 buffer
    if (buffer.trim() && buffer.trim().startsWith('data: ')) {
      const jsonStr = buffer.trim().slice(6);
      if (jsonStr !== '[DONE]') {
        try {
          const data = JSON.parse(jsonStr);
          const delta = data?.choices?.[0]?.delta || {};
          const content = delta.content || '';
          const thinking = delta.reasoning_content || delta.thinking || '';
          if (content || thinking) {
            yield { content, thinking, done: false };
          }
        } catch (_) {}
      }
    }

    // P9-T19：仅当流式调用完整成功时才标记成功（yield 可能因消费者断开而抛异常）
    let hasCompleted = false;

    circuitBreaker.recordSuccess();
    hasCompleted = true;
    yield { content: '', thinking: '', done: true };
  } catch (err) {
    // P9-T19：仅当流未正常完成时才记录失败（防止 yield 抛异常时重复计数）
    if (!hasCompleted && err.name !== 'AbortError') {
      circuitBreaker.recordFailure();
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

module.exports = { callAI, callAIStream, extractSqlStatements };
