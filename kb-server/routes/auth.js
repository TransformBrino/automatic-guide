/**
 * routes/auth.js — 认证路由
 * 职责：POST /api/auth/login 用户登录，验证密码并签发 JWT。
 * 对应框架文档第八章 8.2 接口清单第 1 项。
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const router = express.Router();

const pool = require('../db/connection');
const config = require('../config');
const { sendSuccess, sendError } = require('../utils/response');
const errors = require('../utils/errors');
const { authRequired } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * 请求体：{ username, password }
 * 响应 data：{ token, user: { id, username, displayName, role } }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    // 参数校验
    if (!username || !password) {
      return sendError(res, errors.VALIDATION_ERROR, '用户名和密码不能为空');
    }

    // 查询用户（仅查激活用户）
    const [rows] = await pool.execute(
      'SELECT id, username, display_name, role, password_hash, is_active FROM kb_users WHERE username = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0) {
      return sendError(res, errors.AUTH_REQUIRED, '用户名或密码错误');
    }

    const user = rows[0];
    if (!user.is_active) {
      return sendError(res, errors.AUTH_REQUIRED, '账号已被停用');
    }

    // bcrypt 比对密码
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return sendError(res, errors.AUTH_REQUIRED, '用户名或密码错误');
    }

    // 签发 JWT（含 id/username/role，8 小时过期）
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    return sendSuccess(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    }, '登录成功');
  } catch (err) {
    return sendError(res, errors.DB_ERROR, '登录失败：' + err.message);
  }
});

/**
 * POST /api/auth/change-password
 * 请求体：{ oldPassword, newPassword }
 * 需鉴权（authRequired）
 */
router.post('/change-password', authRequired, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body || {};

    if (!oldPassword || !newPassword) {
      return sendError(res, errors.VALIDATION_ERROR, '旧密码和新密码不能为空');
    }
    if (newPassword.length < 6) {
      return sendError(res, errors.VALIDATION_ERROR, '新密码长度至少 6 位');
    }

    const [rows] = await pool.execute(
      'SELECT password_hash FROM kb_users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (rows.length === 0) {
      return sendError(res, errors.NOT_FOUND, '用户不存在');
    }

    const match = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!match) {
      return sendError(res, errors.AUTH_REQUIRED, '旧密码不正确');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.execute(
      'UPDATE kb_users SET password_hash = ? WHERE id = ?',
      [newHash, req.user.id]
    );

    return sendSuccess(res, {}, '密码修改成功');
  } catch (err) {
    return sendError(res, errors.DB_ERROR, '密码修改失败：' + err.message);
  }
});

module.exports = router;
