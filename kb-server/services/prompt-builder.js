/**
 * services/prompt-builder.js — Prompt 构建器
 * 职责：读取 prompts/ 资产，拼接 system content，组装 OpenAI 格式 messages 数组。
 * 对应框架文档第三章 3.2、第九章 9.1。
 */

const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

// 缓存文件内容，避免每次请求 IO
let systemContentCache = null;

/**
 * 读取并缓存 system prompt 内容（system-base.txt + sql-schema.md 拼接）
 * @returns {string} 完整的 system content
 */
function getSystemContent() {
  if (systemContentCache) {
    return systemContentCache;
  }
  const basePath = path.join(PROMPTS_DIR, 'system-base.txt');
  const schemaPath = path.join(PROMPTS_DIR, 'sql-schema.md');

  const base = fs.readFileSync(basePath, 'utf-8');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  systemContentCache = `${base}\n\n---\n\n${schema}`;
  return systemContentCache;
}

/**
 * 构建 OpenAI Chat Completions 格式的 messages 数组
 * @param {Array<{role:string, content:string}>} history - 历史消息数组
 * @param {string} newMessage - 当前用户消息
 * @returns {Array<{role:string, content:string}>} messages 数组
 *   结构：[{role:"system", content}, ...history(最多20轮40条), {role:"user", content:newMessage}]
 */
function buildMessages(history, newMessage) {
  const systemContent = getSystemContent();

  // 历史截断：最多保留最近 20 轮（40 条消息）
  const MAX_HISTORY = 40;
  const trimmedHistory = Array.isArray(history)
    ? history.slice(-MAX_HISTORY)
    : [];

  return [
    { role: 'system', content: systemContent },
    ...trimmedHistory,
    { role: 'user', content: newMessage },
  ];
}

/**
 * 清除缓存（测试或热更新 prompt 时使用）
 */
function clearCache() {
  systemContentCache = null;
}

module.exports = { buildMessages, getSystemContent, clearCache };
