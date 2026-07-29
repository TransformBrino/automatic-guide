/**
 * services/session-store.js — 会话存储抽象层（P9-T20）
 * 职责：
 *   - 定义会话存储接口（get/set/del/keys/has）
 *   - MemoryFileStore：当前实现（内存 Map + JSON 文件持久化）
 *   - RedisStore：可选择 Redis 共享存储，支持多实例部署
 *   - 通过环境变量 SESSION_STORE=redis 切换
 */

const path = require('path');
const fs = require('fs');
const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('session-store');

/**
 * 会话存储接口定义（仅作文档说明，JS 无接口关键字）
 *
 * class SessionStore {
 *   get(sessionId)           → object | undefined
 *   set(sessionId, data)      → void
 *   del(sessionId)            → void
 *   has(sessionId)            → boolean
 *   keys()                    → string[]
 *   size                      → number
 *   getAll()                  → Map<string, object>
 *   saveToDisk()              → Promise<void>  (仅 file 模式)
 *   loadFromDisk()            → Promise<void>  (仅 file 模式)
 * }
 */

class MemoryFileStore {
  constructor(filePath) {
    this._store = new Map();
    this._filePath = filePath;
    logger.info('会话存储模式: MemoryFile', { file: filePath });
  }

  get(sessionId) {
    const data = this._store.get(sessionId);
    if (!data) return undefined;
    return { ...data, messages: [...(data.messages || [])] };
  }

  set(sessionId, data) {
    this._store.set(sessionId, { ...data, messages: [...(data.messages || [])] });
  }

  del(sessionId) {
    this._store.delete(sessionId);
  }

  has(sessionId) {
    return this._store.has(sessionId);
  }

  keys() {
    return Array.from(this._store.keys());
  }

  get size() {
    return this._store.size;
  }

  getAll() {
    return new Map(this._store);
  }

  async saveToDisk() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj = {};
      for (const [k, v] of this._store) {
        obj[k] = v;
      }
      fs.writeFileSync(this._filePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      logger.error('会话持久化失败', { error: err.message });
    }
  }

  async loadFromDisk() {
    try {
      if (!fs.existsSync(this._filePath)) return;
      const raw = fs.readFileSync(this._filePath, 'utf-8');
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) {
        this._store.set(k, v);
      }
      logger.info('从文件恢复会话', { count: this._store.size });
    } catch (err) {
      logger.warn('会话文件读取失败，使用空存储', { error: err.message });
    }
  }
}

class RedisStore {
  constructor(redisClient) {
    this._redis = redisClient;
    this._prefix = 'kb:session:';
    logger.info('会话存储模式: Redis');
  }

  async get(sessionId) {
    const raw = await this._redis.get(this._prefix + sessionId);
    if (!raw) return undefined;
    try {
      const data = JSON.parse(raw);
      return { ...data, messages: [...(data.messages || [])] };
    } catch (e) {
      return undefined;
    }
  }

  async set(sessionId, data) {
    const toSave = { ...data, messages: [...(data.messages || [])] };
    await this._redis.set(this._prefix + sessionId, JSON.stringify(toSave));
    // Redis 模式无自动过期，需外部清理定时器
  }

  async del(sessionId) {
    await this._redis.del(this._prefix + sessionId);
  }

  async has(sessionId) {
    const exists = await this._redis.exists(this._prefix + sessionId);
    return exists === 1;
  }

  /**
   * 使用 SCAN 命令迭代所有会话键（非阻塞，替代 KEYS）
   * SCAN 每次返回一批键 + 游标，直至游标为 '0' 时完成
   * @returns {Promise<string[]>} 会话 ID 数组（不含前缀）
   */
  async keys() {
    const sessionIds = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this._redis.scan(
        cursor, 'MATCH', this._prefix + '*', 'COUNT', 100
      );
      cursor = nextCursor;
      for (const k of keys) {
        sessionIds.push(k.slice(this._prefix.length));
      }
    } while (cursor !== '0');
    return sessionIds;
  }

  /**
   * 会话总数（基于 SCAN 迭代计数）
   * 注：生产环境若需高频获取，可改为维护独立计数器键
   * @returns {Promise<number>}
   */
  async size() {
    let count = 0;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this._redis.scan(
        cursor, 'MATCH', this._prefix + '*', 'COUNT', 100
      );
      cursor = nextCursor;
      count += keys.length;
    } while (cursor !== '0');
    return count;
  }

  /**
   * 获取所有会话数据（SCAN + pipeline GET，避免 KEYS + N 次 GET）
   * @returns {Promise<Map<string, object>>}
   */
  async getAll() {
    const map = new Map();
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this._redis.scan(
        cursor, 'MATCH', this._prefix + '*', 'COUNT', 100
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        // 使用 pipeline 批量获取，减少网络往返
        const pipeline = this._redis.pipeline();
        for (const k of keys) {
          pipeline.get(k);
        }
        const results = await pipeline.exec();
        for (let i = 0; i < keys.length; i++) {
          const raw = results[i] && results[i][1];
          if (raw) {
            try {
              const data = JSON.parse(raw);
              const sessionId = keys[i].slice(this._prefix.length);
              map.set(sessionId, { ...data, messages: [...(data.messages || [])] });
            } catch (_) { /* 忽略解析失败的会话 */ }
          }
        }
      }
    } while (cursor !== '0');
    return map;
  }

  async saveToDisk() {
    // Redis 自动持久化，无需手动操作
  }

  async loadFromDisk() {
    // Redis 自动恢复，无需手动操作
  }
}

/**
 * 创建会话存储实例
 * @param {string} filePath - 文件持久化路径（MemoryFile 模式使用）
 * @returns {Promise<MemoryFileStore|RedisStore>}
 */
async function createSessionStore(filePath) {
  const storeType = process.env.SESSION_STORE || 'file';

  if (storeType === 'redis') {
    try {
      // 动态加载 ioredis，避免 file 模式下的依赖
      const Redis = require('ioredis');
      const redis = new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB, 10) || 0,
        lazyConnect: true,
        retryStrategy: (times) => {
          if (times > 3) {
            logger.error('Redis 连接失败超过 3 次，回退到 MemoryFile 模式');
            return null; // 停止重试
          }
          return Math.min(times * 200, 2000);
        },
      });

      await redis.connect();
      logger.info('Redis 连接成功', { host: redis.options.host, port: redis.options.port });
      return new RedisStore(redis);
    } catch (err) {
      logger.error('Redis 连接失败，回退到 MemoryFile 模式', { error: err.message });
    }
  }

  return new MemoryFileStore(filePath);
}

module.exports = { MemoryFileStore, RedisStore, createSessionStore };
