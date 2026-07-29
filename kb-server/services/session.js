/**
 * services/session.js — 会话管理服务
 * 职责：基于 session-store 抽象层管理会话，定时清理过期会话。
 * 对应框架文档第十章。
 */

const path = require('path');
const config = require('../config');
const { createModuleLogger } = require('./logger');
const { createSessionStore } = require('./session-store');

const logger = createModuleLogger('session');

// 会话存储实例（惰性初始化）
let store = null;

// 每个会话最多保留的消息数（20 轮 = 40 条）
const MAX_MESSAGES = 40;

// 持久化文件路径
const SESSIONS_FILE = path.join(__dirname, '..', 'data', 'sessions.json');

// 持久化定时器（每 5 秒检查脏数据，减少 IO；P9-T8：从 30s 降至 5s）
let saveTimer = null;
let dirty = false;
let debounceTimer = null; // P9-T8：防抖写入，appendMessage 后 300ms 立即落盘

// ============================================================
// 初始化存储实例
// ============================================================

/**
 * 惰性初始化存储实例
 * @returns {Promise<import('./session-store').MemoryFileStore|import('./session-store').RedisStore>}
 */
async function initStore() {
  if (!store) {
    store = await createSessionStore(SESSIONS_FILE);
  }
  return store;
}

// ============================================================
// 文件持久化
// ============================================================

/**
 * 将会话数据保存到磁盘（委托给存储实例）
 */
async function saveToFile() {
  if (!store) return;
  await store.saveToDisk();
  dirty = false;
}

/**
 * 标记为脏数据，启动延迟保存
 * P9-T8：标记脏数据后启动 300ms 防抖写入，确保消息快速落盘
 */
function markDirty() {
  dirty = true;
  // 防抖写入：每次 markDirty 重置 300ms 计时器
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (dirty) {
      saveToFile();
    }
  }, 300);
  debounceTimer.unref(); // 不阻止进程退出
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
  if (!store.has(sessionId)) {
    const newSession = { messages: [], lastActivity: Date.now() };
    store.set(sessionId, newSession);
    markDirty();
    return newSession;
  }
  return store.get(sessionId);
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
  // 写回存储（因 store.get() 返回副本，修改后需显式写回）
  store.set(sessionId, session);
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
  // 写回存储（因 store.get() 返回副本，修改后需显式写回）
  store.set(sessionId, session);
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
 * 每 5 分钟扫描清理 + 每 5 秒持久化（仅脏数据时写文件）
 */
async function startCleanupTimer() {
  const INTERVAL = 5 * 60 * 1000; // 5 分钟
  const TIMEOUT = config.sessionTimeoutMinutes * 60 * 1000;

  // 初始化存储实例
  await initStore();

  // 启动时从文件恢复
  await store.loadFromDisk();

  // 定时清理过期会话
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [sid, session] of store.getAll().entries()) {
      if (now - session.lastActivity > TIMEOUT) {
        store.del(sid);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      markDirty();
      logger.info('清理过期会话', { cleaned, active: store.size });
    }
  }, INTERVAL);

  // 定时持久化（每 5 秒检查脏数据，P9-T8：从 30s 降至 5s）
  saveTimer = setInterval(() => {
    if (dirty) {
      saveToFile();
    }
  }, 5 * 1000);

  // 进程退出时保存
  process.on('exit', () => {
    if (dirty && store) store.saveToDisk();
  });
  process.on('SIGINT', () => {
    if (dirty && store) store.saveToDisk().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    if (dirty && store) store.saveToDisk().then(() => process.exit(0));
  });

  logger.info('会话清理定时器已启动', { scanIntervalMin: 5, timeoutMin: config.sessionTimeoutMinutes });
  logger.info('持久化已启用', { file: SESSIONS_FILE });
}

module.exports = {
  getSession,
  appendMessage,
  clearSession,
  getHistory,
  startCleanupTimer,
};
