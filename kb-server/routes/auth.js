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
const { sendSuccess, sendError, safeErrorMsg } = require('../utils/response');
const errors = require('../utils/errors');
const { authRequired } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limiter');
const { validatePassword } = require('../utils/password'); // P9-T16

/**
 * POST /api/auth/login
 * 请求体：{ username, password }
 * 响应 data：{ token, user: { id, username, displayName, role } }
 *
 * P9-T2：防暴力破解 — 连续 5 次失败锁定 15 分钟，成功后重置计数
 */
router.post('/login', loginLimiter, async (req, res, next) => { // P9-T1：登录限流 5 次/分钟/IP
  try {
    const { username, password } = req.body || {};

    // 参数校验
    if (!username || !password) {
      return sendError(res, errors.VALIDATION_ERROR, '用户名和密码不能为空');
    }

    // 查询用户（含防暴力破解字段）
    const [rows] = await pool.execute(
      'SELECT id, username, display_name, role, password_hash, is_active, login_attempts, locked_until FROM kb_users WHERE username = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0) {
      return sendError(res, errors.AUTH_REQUIRED, '用户名或密码错误');
    }

    const user = rows[0];
    if (!user.is_active) {
      return sendError(res, errors.AUTH_REQUIRED, '账号已被停用');
    }

    // P9-T2：检查是否被锁定
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutes = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      return sendError(res, errors.AUTH_REQUIRED,
        `账户已临时锁定，请 ${minutes} 分钟后重试`);
    }

    // bcrypt 比对密码
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      // P9-T2：增加失败计数，达到阈值后锁定 15 分钟
      const newAttempts = (user.login_attempts || 0) + 1;
      if (newAttempts >= 5) {
        await pool.execute(
          'UPDATE kb_users SET login_attempts = ?, locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id = ?',
          [newAttempts, user.id]
        );
        return sendError(res, errors.AUTH_REQUIRED,
          '密码连续错误 5 次，账户已锁定 15 分钟');
      }
      await pool.execute(
        'UPDATE kb_users SET login_attempts = ? WHERE id = ?',
        [newAttempts, user.id]
      );
      return sendError(res, errors.AUTH_REQUIRED, '用户名或密码错误');
    }

    // P9-T2：登录成功，重置失败计数和锁定
    if (user.login_attempts > 0 || user.locked_until) {
      await pool.execute(
        'UPDATE kb_users SET login_attempts = 0, locked_until = NULL WHERE id = ?',
        [user.id]
      );
    }

    // 签发 JWT（含 id/username/role，8 小时过期）
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    // P9-T22：以 httpOnly cookie 方式设置 JWT，防止 XSS 窃取
    // 同时保留 body 中的 token 字段（向后兼容）
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 小时
    });

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
    return sendError(res, errors.DB_ERROR, safeErrorMsg('登录失败', err));
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
    // P9-T16：密码复杂度校验（至少 8 位 + 大小写 + 数字）
    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      return sendError(res, errors.VALIDATION_ERROR, pwCheck.message);
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
    return sendError(res, errors.DB_ERROR, safeErrorMsg('密码修改失败', err));
  }
});

/**
 * POST /api/auth/logout
 * P9-T22：清除 httpOnly cookie，实现安全退出
 */
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  return sendSuccess(res, {}, '已退出登录');
});

/**
 * GET /api/auth/me
 * P9-T22：通过 cookie 中的 JWT 返回当前登录用户信息（用于页面刷新恢复登录状态）
 */
router.get('/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, display_name, role FROM kb_users WHERE id = ? AND is_active = 1 LIMIT 1',
      [req.user.id]
    );
    if (rows.length === 0) {
      return sendError(res, errors.AUTH_REQUIRED, '用户不存在或已禁用');
    }
    const user = rows[0];
    return sendSuccess(res, {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    });
  } catch (err) {
    return sendError(res, errors.DB_ERROR, safeErrorMsg('获取用户信息失败', err));
  }
});

module.exports = router;
