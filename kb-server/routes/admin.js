/**
 * routes/admin.js — 管理路由
 * 职责：提供条目删除/归档、用户管理等管理员专属操作。
 * 对应框架文档第八章 8.2 接口清单第 7-10 项。
 */

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const errors = require('../utils/errors');
const { authRequired, requireRole } = require('../middleware/auth');

router.use(authRequired, requireRole('admin'));

// ============================================================
// DELETE /api/admin/entries/:id — 删除条目
// ============================================================
router.delete('/entries/:id', async (req, res) => {
  let conn;
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) {
      return sendError(res, errors.VALIDATION_ERROR, '无效的条目 ID');
    }

    const user = req.user;
    const clientIp = req.ip || req.connection?.remoteAddress || null;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 查询条目确认存在
    const [rows] = await conn.execute(
      'SELECT id, entry_code, title FROM kb_entries WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return sendError(res, errors.NOT_FOUND, '知识条目不存在');
    }

    const entry = rows[0];

    // 写 audit_log（删除日志在删除前记录，因为外键 CASCADE 会清除关联数据）
    await conn.execute(
      'INSERT INTO kb_audit_log (entry_id, action, operator, detail, ip_address) VALUES (?, ?, ?, ?, ?)',
      [id, 'delete', user.username, `删除条目: ${entry.title} (${entry.entry_code})`, clientIp]
    );

    // 硬删除（外键 CASCADE 会自动清除 kb_tags 和 kb_version_history）
    await conn.execute('DELETE FROM kb_entries WHERE id = ?', [id]);

    await conn.commit();

    return sendSuccess(res, {
      deleted: true,
      id,
      entryCode: entry.entry_code,
      title: entry.title,
    }, '条目已删除');
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    console.error('[admin] 删除条目失败:', err);
    return sendError(res, errors.DB_ERROR, '删除条目失败: ' + err.message);
  } finally {
    if (conn) conn.release();
  }
});

// ============================================================
// POST /api/admin/entries/:id/archive — 归档条目
// ============================================================
router.post('/entries/:id/archive', async (req, res) => {
  let conn;
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) {
      return sendError(res, errors.VALIDATION_ERROR, '无效的条目 ID');
    }

    const user = req.user;
    const clientIp = req.ip || req.connection?.remoteAddress || null;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 查询条目
    const [rows] = await conn.execute(
      'SELECT id, status, title FROM kb_entries WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return sendError(res, errors.NOT_FOUND, '知识条目不存在');
    }

    const entry = rows[0];
    if (entry.status === 'archived') {
      await conn.rollback();
      return sendError(res, errors.VALIDATION_ERROR, '条目已归档');
    }

    // 状态改为 archived
    await conn.execute(
      "UPDATE kb_entries SET status = 'archived', updated_at = NOW() WHERE id = ?",
      [id]
    );

    // 写 audit_log
    await conn.execute(
      'INSERT INTO kb_audit_log (entry_id, action, operator, detail, ip_address) VALUES (?, ?, ?, ?, ?)',
      [id, 'archive', user.username, `归档条目: ${entry.title}`, clientIp]
    );

    await conn.commit();

    return sendSuccess(res, {
      archived: true,
      id,
      status: 'archived',
    }, '条目已归档');
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    console.error('[admin] 归档条目失败:', err);
    return sendError(res, errors.DB_ERROR, '归档条目失败: ' + err.message);
  } finally {
    if (conn) conn.release();
  }
});

// ============================================================
// GET /api/admin/users — 用户列表
// ============================================================
router.get('/users', async (req, res) => {
  try {
    const { role, page = 1, limit = 50 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const params = [];

    if (role) {
      conditions.push('role = ?');
      params.push(role);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM kb_users ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await pool.execute(
      `SELECT id, username, display_name, role, is_active, created_at
       FROM kb_users
       ${whereClause}
       ORDER BY id ASC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    const users = rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      isActive: !!row.is_active,
      createdAt: row.created_at,
    }));

    return sendSuccess(res, { users, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('[admin] 查询用户列表失败:', err);
    return sendError(res, errors.DB_ERROR, '查询用户列表失败: ' + err.message);
  }
});

// ============================================================
// POST /api/admin/users — 创建用户
// ============================================================
router.post('/users', async (req, res) => {
  let conn;
  try {
    const { username, password, displayName, role } = req.body || {};
    const operator = req.user;

    // ---- 参数校验 ----
    if (!username || typeof username !== 'string' || username.trim() === '') {
      return sendError(res, errors.VALIDATION_ERROR, '用户名不能为空');
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return sendError(res, errors.VALIDATION_ERROR, '密码长度至少 6 位');
    }
    if (!displayName || typeof displayName !== 'string') {
      return sendError(res, errors.VALIDATION_ERROR, '显示名不能为空');
    }

    const validRoles = ['contributor', 'reviewer', 'admin'];
    const userRole = validRoles.includes(role) ? role : 'contributor';

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 检查用户名唯一性
    const [existing] = await conn.execute(
      'SELECT id FROM kb_users WHERE username = ? LIMIT 1',
      [username.trim()]
    );
    if (existing.length > 0) {
      await conn.rollback();
      return sendError(res, errors.VALIDATION_ERROR, '用户名已存在');
    }

    // bcrypt 加密密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 创建用户
    const [result] = await conn.execute(
      'INSERT INTO kb_users (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)',
      [username.trim(), displayName.trim(), userRole, passwordHash]
    );

    await conn.commit();

    return sendSuccess(res, {
      id: result.insertId,
      username: username.trim(),
      displayName: displayName.trim(),
      role: userRole,
    }, '用户创建成功');
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    console.error('[admin] 创建用户失败:', err);
    return sendError(res, errors.DB_ERROR, '创建用户失败: ' + err.message);
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
