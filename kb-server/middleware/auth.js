/**
 * middleware/auth.js — JWT 认证中间件
 * 职责：
 * 1. authRequired：解析 Authorization: Bearer <token>，验证 JWT，
 *    将 {id, username, role} 挂载到 req.user；无效返回 401。
 * 2. requireRole(...roles)：角色校验，不在允许列表返回 403。
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { sendError } = require('../utils/response');
const errors = require('../utils/errors');

/**
 * JWT 认证中间件（必须登录）
 */
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, errors.AUTH_REQUIRED);
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    // 确保 token 中含必要字段
    if (!decoded.id || !decoded.username || !decoded.role) {
      return sendError(res, errors.AUTH_REQUIRED, 'token 内容无效');
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
