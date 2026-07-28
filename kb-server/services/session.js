/**
 * services/session.js — 会话管理服务
 * 职责：内存 Map 存储对话上下文，定时清理过期会话。
 * 对应框架文档第十章。
 */

const config = require('../config');

// 内存会话存储：Map<sessionId, {messages: [], lastActivity: timestamp}>
const sessions = new Map();

// 每个会话最多保留的消息数（20 轮 = 40 条）
const MAX_MESSAGES = 40;

/**
 * 获取会话，不存在则创建
 * @param {string} sessionId
 * @returns {{messages: Array<{role:string, content:string}>, lastActivity: number}}
 */
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], lastActivity: Date.now() });
  }
  return sessions.get(sessionId);
}

/**
 * 追加消息到会话，更新最后活动时间，超限截断
 * @param {string} sessionId
 * @param {string} role - 'user' | 'assistant'
 * @param {string} content
 */
function appendMessage(sessionId, role, content) {
  const session = getSession(sessionId);
  session.messages.push({ role, content });
  // 超过上限时，从头部删除最早的消息
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }
  session.lastActivity = Date.now();
}

/**
 * 清空会话（保留 sessionId，清空消息）
 * @param {string} sessionId
 */
function clearSession(sessionId) {
  const session = getSession(sessionId);
  session.messages = [];
  session.lastActivity = Date.now();
}

/**
 * 获取会话历史消息（只读副本）
 * @param {string} sessionId
 * @returns {Array<{role:string, content:string}>}
 */
function getHistory(sessionId) {
  const session = getSession(sessionId);
  return session.messages.slice(); // 返回副本
}

/**
 * 启动定时清理过期会话
 * 每 5 分钟扫描，清理超过 SESSION_TIMEOUT_MINUTES 无活动的会话
 */
function startCleanupTimer() {
  const INTERVAL = 5 * 60 * 1000; // 5 分钟
  const TIMEOUT = config.sessionTimeoutMinutes * 60 * 1000;

  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [sid, session] of sessions.entries()) {
      if (now - session.lastActivity > TIMEOUT) {
        sessions.delete(sid);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[session] 清理 ${cleaned} 个过期会话，当前活跃: ${sessions.size}`);
    }
  }, INTERVAL);

  console.log(`[session] 会话清理定时器已启动（每 5 分钟扫描，超时 ${config.sessionTimeoutMinutes} 分钟）`);
}

module.exports = {
  getSession,
  appendMessage,
  clearSession,
  getHistory,
  startCleanupTimer,
};
