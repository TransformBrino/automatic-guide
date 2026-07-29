/**
 * middleware/auth.js — JWT 认证中间件
 * 职责：
 * 1. authRequired：解析 Authorization: Bearer <token> 或 Cookie token，
 *    验证 JWT，将 {id, username, role} 挂载到 req.user；无效返回 401。
 * 2. requireRole(...roles)：角色校验，不在允许列表返回 403。
 *
 * P9-T22：支持从 httpOnly Cookie 中提取 token（优先检测 Authorization Header）
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const pool = require('../db/connection');
const { sendError } = require('../utils/response');
const errors = require('../utils/errors');
const { createModuleLogger } = require('../services/logger');

const logger = createModuleLogger('auth');

/**
 * 从请求中提取 JWT token
 * P9-T22：优先 Authorization Header → 其次 httpOnly Cookie → 都不存在返回 null
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  return null;
}

/**
 * JWT 认证中间件（必须登录）
 * 验证 token 后额外检查用户 is_active 状态，确保被禁用的用户 token 立即失效
 */
async function authRequired(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return sendError(res, errors.AUTH_REQUIRED);
  }
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    // 确保 token 中含必要字段
    if (!decoded.id || !decoded.username || !decoded.role) {
      return sendError(res, errors.AUTH_REQUIRED, 'token 内容无效');
    }

    // 查询用户是否仍处于活跃状态（P8-T24：禁用用户 token 立即失效）
    try {
      const [rows] = await pool.execute(
        'SELECT is_active FROM kb_users WHERE id = ? AND username = ? LIMIT 1',
        [decoded.id, decoded.username]
      );
      if (rows.length === 0 || !rows[0].is_active) {
        return sendError(res, errors.AUTH_REQUIRED, '用户已被禁用，请重新登录');
      }
    } catch (dbErr) {
      // DB 查询失败时降级为仅校验 token（不影响服务可用性）
      logger.error('查询用户活跃状态失败', { error: dbErr.message });
    }

    req.user = { id: decoded.id, username: decoded.username, role: decoded.role };
    next();
  } catch (err) {
    return sendError(res, errors.AUTH_REQUIRED, 'token 无效或已过期');
  }
}

/**
 * 角色校验中间件工厂
 * @param {...string} roles - 允许的角色列表，如 requireRole('reviewer','admin')
 * @returns {function} Express 中间件
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, errors.AUTH_REQUIRED);
    }
    if (!roles.includes(req.user.role)) {
      return sendError(res, errors.FORBIDDEN);
    }
    next();
  };
}

module.exports = { authRequired, requireRole };
