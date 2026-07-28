/**
 * middleware/rate-limiter.js — 接口频率限制中间件（P9-T1）
 * 职责：基于内存的滑动窗口限流，防止暴力破解和 API 滥用。
 *
 * 使用方式：
 *   const { loginLimiter, chatLimiter } = require('./rate-limiter');
 *   app.use('/api/auth/login', loginLimiter);  // 在 auth 路由前挂载
 *   app.use('/api/chat', authRequired, chatLimiter);  // 在 auth 之后挂载（需要 req.user）
 */

/**
 * 创建基于 IP 的限流中间件
 * @param {object} options
 * @param {number} options.windowMs - 时间窗口（毫秒）
 * @param {number} options.max - 窗口内最大请求数
 * @param {string} options.message - 超限提示
 * @returns {function} Express 中间件
 */
function createIpLimiter({ windowMs, max, message }) {
  const hits = new Map();

  // 每 60 秒清理过期记录
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) {
        hits.delete(key);
      }
    }
  }, 60000).unref();

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);

    if (!entry || now - entry.start > windowMs) {
      // 新窗口
      hits.set(ip, { start: now, count: 1 });
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: message,
        code: 'RATE_LIMITED',
      });
    }

    next();
  };
}

/**
 * 创建基于用户 ID 的限流中间件
 * 必须在 authRequired 之后使用（需要 req.user）
 * @param {object} options - 同 createIpLimiter
 * @returns {function} Express 中间件
 */
function createUserLimiter({ windowMs, max, message }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) {
        hits.delete(key);
      }
    }
  }, 60000).unref();

  return (req, res, next) => {
    const userId = req.user?.id || 'anonymous';
    const now = Date.now();
    const entry = hits.get(userId);

    if (!entry || now - entry.start > windowMs) {
      hits.set(userId, { start: now, count: 1 });
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: message,
        code: 'RATE_LIMITED',
      });
    }

    next();
  };
}

// 预置限流器

/** 登录接口：同一 IP 每分钟最多 5 次 */
const loginLimiter = createIpLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: '登录请求过于频繁，请 1 分钟后再试',
});

/** 对话接口：同一用户每分钟最多 20 次 */
const chatLimiter = createUserLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: '对话请求过于频繁，请稍后再试',
});

/** 通用 API：同一 IP 每分钟最多 100 次 */
const generalLimiter = createIpLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: '请求过于频繁，请稍后再试',
});

module.exports = { createIpLimiter, createUserLimiter, loginLimiter, chatLimiter, generalLimiter };
