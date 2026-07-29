/**
 * routes/review.js — 审核路由
 * 职责：提供待审核列表查询和审核操作接口。
 * 对应框架文档第八章 8.2 接口清单第 5-6 项。
 */

const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { sendSuccess, sendError, safeErrorMsg } = require('../utils/response');
const errors = require('../utils/errors');
const { authRequired, requireRole } = require('../middleware/auth');
const { validatePagination } = require('../utils/pagination'); // P9-T31
const { createModuleLogger } = require('../services/logger');

const logger = createModuleLogger('review');

router.use(authRequired);

const SCORE_FIELDS = ['completeness', 'accuracy', 'timeliness', 'operability', 'reusability', 'traceability'];

// ============================================================
// GET /api/review/pending — 待审核列表
// ============================================================
router.get('/pending', requireRole('reviewer', 'admin'), async (req, res) => {
  try {
    const {
      knowledge_type, scene, page = 1, limit = 20,
    } = req.query;

    // P9-T31：分页参数安全校验
    let pageNum, limitNum, offset;
    try {
      ({ pageNum, limitNum, offset } = validatePagination(page, limit));
    } catch (e) {
      return sendError(res, errors.VALIDATION_ERROR, e.message);
    }

    const conditions = ["status = 'pending_review'"];
    const params = [];

    if (knowledge_type) {
      conditions.push('knowledge_type = ?');
      params.push(knowledge_type);
    }

    if (scene) {
      conditions.push('scene = ?');
      params.push(scene);
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // 总数
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM kb_entries ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    // 分页查询
    // P9-T31：limitNum/offset 已通过 validatePagination 严格校验，且 mysql2 execute() 不支持 LIMIT/OFFSET 参数化
    const [rows] = await pool.execute(
      `SELECT id, entry_code, title, knowledge_type, scene, summary, full_content, architecture_layer, created_by, updated_at
       FROM kb_entries ${whereClause}
       ORDER BY updated_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    const entries = rows.map((row) => ({
      id: row.id,
      entryCode: row.entry_code,
      title: row.title,
      knowledgeType: row.knowledge_type,
      scene: row.scene,
      summary: row.summary,
      fullContent: row.full_content,
      architectureLayer: row.architecture_layer,
      createdBy: row.created_by,
      updatedAt: row.updated_at,
    }));

    return sendSuccess(res, { entries, total, page: pageNum, limit: limitNum });
  } catch (err) {
    logger.error('查询待审核列表失败', { error: err.message });
    return sendError(res, errors.DB_ERROR, safeErrorMsg('查询待审核列表失败', err));
  }
});

// ============================================================
// POST /api/review/:id — 提交审核决定
// ============================================================
router.post('/:id', requireRole('reviewer', 'admin'), async (req, res) => {
  let conn;
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) {
      return sendError(res, errors.VALIDATION_ERROR, '无效的条目 ID');
    }

    const { action, scores, comment } = req.body || {};
    const user = req.user;
    const clientIp = req.ip || req.connection?.remoteAddress || null;

    // ---- 参数校验 ----
    if (!action || !['approve', 'reject'].includes(action)) {
      return sendError(res, errors.VALIDATION_ERROR, 'action 必须是 "approve" 或 "reject"');
    }

    // reject 必须有 comment
    if (action === 'reject' && (!comment || typeof comment !== 'string' || comment.trim() === '')) {
      return sendError(res, errors.VALIDATION_ERROR, '驳回必须提供审核意见 (comment)');
    }

    // approve 必须有 6 维评分
    let totalScore = 0;
    if (action === 'approve') {
      if (!scores || typeof scores !== 'object') {
        return sendError(res, errors.VALIDATION_ERROR, '审核通过必须提供 6 维评分 (scores)');
      }
      for (const field of SCORE_FIELDS) {
        const val = scores[field];
        if (typeof val !== 'number' || val < 1 || val > 5) {
          return sendError(res, errors.VALIDATION_ERROR,
            `评分项 ${field} 必须是 1-5 的数字，当前值: ${val}`);
        }
        totalScore += val;
      }
    }

    // ---- 事务执行 ----
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 查询条目（同时获取 review_cycle）
    const [entryRows] = await conn.execute(
      'SELECT id, status, review_cycle FROM kb_entries WHERE id = ? LIMIT 1 FOR UPDATE',
      [id]
    );

    if (entryRows.length === 0) {
      await conn.rollback();
      return sendError(res, errors.NOT_FOUND, '知识条目不存在');
    }

    const entry = entryRows[0];
    if (entry.status !== 'pending_review') {
      await conn.rollback();
      return sendError(res, errors.VALIDATION_ERROR,
        `条目当前状态为 "${entry.status}"，无需审核`);
    }

    // 构建 UPDATE 语句
    const now = new Date();
    const updateFields = [];
    const updateParams = [];

    if (action === 'approve') {
      updateFields.push("status = 'approved'");
      for (const field of SCORE_FIELDS) {
        updateFields.push(`score_${field} = ?`);
        updateParams.push(scores[field]);
      }
      updateFields.push('score_total = ?');
      updateParams.push(totalScore);
      // 根据条目的 review_cycle 动态计算下次复审日期（P9-T5 修复）
      const REVIEW_CYCLE_DAYS = {
        weekly: 7,
        monthly: 30,
        quarterly: 90,
        semi_annual: 180,
      };
      const cycleDays = REVIEW_CYCLE_DAYS[entry.review_cycle] || 30;
      updateFields.push(`next_review_date = DATE_ADD(NOW(), INTERVAL ${cycleDays} DAY)`);
    } else {
      updateFields.push("status = 'rejected'");
    }

    updateFields.push('reviewer_id = ?');
    updateParams.push(user.id);
    updateFields.push('reviewed_at = ?');
    updateParams.push(now);
    updateFields.push('review_comment = ?');
    updateParams.push(comment || null);

    updateParams.push(id);

    await conn.execute(
      `UPDATE kb_entries SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // 写 audit_log
    await conn.execute(
      'INSERT INTO kb_audit_log (entry_id, action, operator, detail, ip_address) VALUES (?, ?, ?, ?, ?)',
      [id, action === 'approve' ? 'review_approve' : 'review_reject',
       user.username,
       action === 'approve' ? `审核通过，评分 ${totalScore}/30` : `审核驳回：${comment}`,
       clientIp]
    );

    await conn.commit();

    // 查询更新后的条目返回
    const [updated] = await pool.execute(
      `SELECT id, entry_code, title, status, score_total, reviewer_id, reviewed_at, review_comment
       FROM kb_entries WHERE id = ?`,
      [id]
    );

    return sendSuccess(res, { entry: updated[0] });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    logger.error('审核操作失败', { error: err.message });
    return sendError(res, errors.DB_ERROR, safeErrorMsg('审核操作失败', err));
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
