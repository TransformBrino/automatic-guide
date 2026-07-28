/**
 * services/session.js — 会话管理服务
 * 职责：内存 Map + 文件持久化存储对话上下文，定时清理过期会话。
 * 对应框架文档第十章。
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

// 内存会话存储：Map<sessionId, {messages: [], lastActivity: timestamp}>
const sessions = new Map();

// 每个会话最多保留的消息数（20 轮 = 40 条）
const MAX_MESSAGES = 40;

// 持久化文件路径
const DATA_DIR = path.join(__dirname, '..', 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// 持久化定时器（每 30 秒写一次文件，减少 IO）
let saveTimer = null;
let dirty = false;

// ============================================================
// 文件持久化
// ============================================================

/**
 * 确保 data 目录存在
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 从文件加载会话数据
 */
function loadFromFile() {
  try {
    ensureDataDir();
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (typeof data === 'object' && data !== null) {
        for (const [sid, session] of Object.entries(data)) {
          // 仅加载未过期的会话
          if (Date.now() - session.lastActivity < config.sessionTimeoutMinutes * 60 * 1000) {
            sessions.set(sid, session);
          }
        }
      }
      console.log(`[session] 从文件恢复 ${sessions.size} 个会话`);
    }
  } catch (err) {
    console.error('[session] 加载会话文件失败:', err.message);
  }
}

/**
 * 将会话数据保存到文件
 */
function saveToFile() {
  try {
    ensureDataDir();
    const data = {};
    for (const [sid, session] of sessions.entries()) {
      data[sid] = session;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data), 'utf-8');
    dirty = false;
  } catch (err) {
    console.error('[session] 保存会话文件失败:', err.message);
  }
}

/**
 * 标记为脏数据，启动延迟保存
 */
function markDirty() {
  dirty = true;
}

// ============================================================
// Session API
// ============================================================

/**
 * 获取会话，不存在则创建
 * @param {string} sessionId
 * @returns {{messages: Array<{role:string, content:string}>, lastActivity: number}}
 */
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], lastActivity: Date.now() });
    markDirty();
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
  markDirty();
}

/**
 * 清空会话（保留 sessionId，清空消息）
 * @param {string} sessionId
 */
function clearSession(sessionId) {
  const session = getSession(sessionId);
  session.messages = [];
  session.lastActivity = Date.now();
  markDirty();
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
 * 启动定时清理过期会话 + 持久化定时器
 * 每 5 分钟扫描清理 + 每 30 秒持久化（仅脏数据时写文件）
 */
function startCleanupTimer() {
  const INTERVAL = 5 * 60 * 1000; // 5 分钟
  const TIMEOUT = config.sessionTimeoutMinutes * 60 * 1000;

  // 启动时从文件恢复
  loadFromFile();

  // 定时清理过期会话
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
      markDirty();
      console.log(`[session] 清理 ${cleaned} 个过期会话，当前活跃: ${sessions.size}`);
    }
  }, INTERVAL);

  // 定时持久化（每 30 秒检查脏数据）
  saveTimer = setInterval(() => {
    if (dirty) {
      saveToFile();
    }
  }, 30 * 1000);

  // 进程退出时保存
  process.on('exit', () => {
    if (dirty) saveToFile();
  });
  process.on('SIGINT', () => {
    if (dirty) saveToFile();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    if (dirty) saveToFile();
    process.exit(0);
  });

  console.log(`[session] 会话清理定时器已启动（每 5 分钟扫描，超时 ${config.sessionTimeoutMinutes} 分钟）`);
  console.log(`[session] 持久化已启用 → ${SESSIONS_FILE}`);
}

module.exports = {
  getSession,
  appendMessage,
  clearSession,
  getHistory,
  startCleanupTimer,
};
