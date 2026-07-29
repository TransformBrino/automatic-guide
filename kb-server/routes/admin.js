/**
 * routes/admin.js — 管理路由
 * 职责：提供条目删除/归档、用户管理等管理员专属操作。
 * 对应框架文档第八章 8.2 接口清单第 7-10 项。
 */

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db/connection');
const { sendSuccess, sendError, safeErrorMsg } = require('../utils/response');
const errors = require('../utils/errors');
const { authRequired, requireRole } = require('../middleware/auth');
const { validatePassword } = require('../utils/password'); // P9-T16

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

    // 写 audit_log
    await conn.execute(
      'INSERT INTO kb_audit_log (entry_id, action, operator, detail, ip_address) VALUES (?, ?, ?, ?, ?)',
      [id, 'delete', user.username, `删除条目: ${entry.title} (${entry.entry_code})`, clientIp]
    );

    // 软删除：改为 archived 状态（不物理删除，保留数据和关联关系）
    await conn.execute(
      "UPDATE kb_entries SET status = 'archived', updated_at = NOW() WHERE id = ?",
      [id]
    );

    await conn.commit();

    return sendSuccess(res, {
      deleted: true,
      archived: true,
      id,
      entryCode: entry.entry_code,
      title: entry.title,
    }, '条目已归档（软删除）');
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    console.error('[admin] 删除条目失败:', err);
    return sendError(res, errors.DB_ERROR, safeErrorMsg('删除条目失败', err));
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
    return sendError(res, errors.DB_ERROR, safeErrorMsg('归档条目失败', err));
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

    // limitNum/offset 已通过 parseInt 严格校验为整数，且 mysql2 execute() 不支持 LIMIT/OFFSET 参数化
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
    return sendError(res, errors.DB_ERROR, safeErrorMsg('查询用户列表失败', err));
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
    // P9-T16：密码复杂度校验（至少 8 位 + 大小写 + 数字）
    if (!password || typeof password !== 'string') {
      return sendError(res, errors.VALIDATION_ERROR, '密码不能为空');
    }
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return sendError(res, errors.VALIDATION_ERROR, pwCheck.message);
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
    return sendError(res, errors.DB_ERROR, safeErrorMsg('创建用户失败', err));
  } finally {
    if (conn) conn.release();
  }
});

// ============================================================
// GET /api/admin/entries/export — 导出 CSV
// P9-T18：支持按知识类型/场景/状态筛选导出，UTF-8 BOM 兼容 Excel
// ============================================================
router.get('/entries/export', async (req, res) => {
  try {
    const { knowledge_type, scene, status } = req.query;

    const conditions = [];
    const params = [];

    if (knowledge_type) {
      conditions.push('knowledge_type = ?');
      params.push(knowledge_type);
    }
    if (scene) {
      conditions.push('scene = ?');
      params.push(scene);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const [rows] = await pool.execute(
      `SELECT entry_code, title, knowledge_type, scene, status, score_total, created_by, created_at
       FROM kb_entries ${whereClause}
       ORDER BY created_at DESC`,
      params
    );

    // 构建 CSV（UTF-8 BOM 确保 Excel 正确识别中文）
    const headers = ['编号', '标题', '知识类型', '场景', '状态', '评分', '创建者', '创建时间'];
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push([
        `"${(row.entry_code || '').replace(/"/g, '""')}"`,
        `"${(row.title || '').replace(/"/g, '""')}"`,
        `"${(row.knowledge_type || '')}"`,
        `"${(row.scene || '')}"`,
        `"${(row.status || '')}"`,
        row.score_total ?? '',
        `"${(row.created_by || '')}"`,
        `"${row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : ''}"`,
      ].join(','));
    }

    const bom = '\uFEFF';
    const csvContent = bom + csvLines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kb-export-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    console.error('[admin] CSV 导出失败:', err);
    return sendError(res, errors.DB_ERROR, safeErrorMsg('CSV 导出失败', err));
  }
});

// ============================================================
// GET /api/admin/audit-logs — 操作日志列表
// ============================================================
router.get('/audit-logs', async (req, res) => {
  try {
    const { action, entry_id, page = 1, limit = 50 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const params = [];

    if (action) {
      conditions.push('log.action = ?');
      params.push(action);
    }

    if (entry_id) {
      const eid = parseInt(entry_id, 10);
      if (eid > 0) {
        conditions.push('log.entry_id = ?');
        params.push(eid);
      }
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM kb_audit_log log ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    // limitNum/offset 已通过 parseInt 严格校验为整数，且 mysql2 execute() 不支持 LIMIT/OFFSET 参数化
    const [rows] = await pool.execute(
      `SELECT log.id, log.entry_id, log.action, log.operator, log.detail, log.ip_address, log.created_at,
              e.title AS entry_title, e.entry_code
       FROM kb_audit_log log
       LEFT JOIN kb_entries e ON log.entry_id = e.id
       ${whereClause}
       ORDER BY log.created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    const logs = rows.map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      action: row.action,
      operator: row.operator,
      detail: row.detail,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
      entryTitle: row.entry_title,
      entryCode: row.entry_code,
    }));

    return sendSuccess(res, { logs, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('[admin] 查询操作日志失败:', err);
    return sendError(res, errors.DB_ERROR, safeErrorMsg('查询操作日志失败', err));
  }
});

module.exports = router;
