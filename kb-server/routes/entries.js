/**
 * routes/entries.js — 知识库查询路由
 * 职责：对 kb_entries 表提供分页查询、详情、历史版本查询接口。
 * 对应框架文档第八章 8.2 接口清单第 2-4 项。
 */

const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { sendSuccess, sendError, safeErrorMsg } = require('../utils/response');
const errors = require('../utils/errors');
const { authRequired } = require('../middleware/auth');
const { validatePagination } = require('../utils/pagination'); // P9-T31
const { createModuleLogger } = require('../services/logger');

const logger = createModuleLogger('entries');

router.use(authRequired);

// ============================================================
// GET /api/entries — 分页 + 多维筛选
// ============================================================
router.get('/', async (req, res) => {
  try {
    const {
      q, knowledge_type, architecture_layer, scene, status, created_by,
      created_after, created_before,
      page = 1, limit = 20,
      sort = 'created_at', order = 'DESC',
    } = req.query;

    // P9-T31：分页参数安全校验
    let pageNum, limitNum, offset;
    try {
      ({ pageNum, limitNum, offset } = validatePagination(page, limit));
    } catch (e) {
      return sendError(res, errors.VALIDATION_ERROR, e.message);
    }

    // 构建 WHERE 子句
    const conditions = [];
    const params = [];

    if (q && typeof q === 'string' && q.trim() !== '') {
      conditions.push('(MATCH(title, summary, full_content) AGAINST(? IN NATURAL LANGUAGE MODE) OR title LIKE ? OR summary LIKE ?)');
      const likePattern = `%${q.trim()}%`;
      params.push(q.trim(), likePattern, likePattern);
    }

    const hasSearch = !!(q && typeof q === 'string' && q.trim() !== '');

    if (knowledge_type) {
      conditions.push('knowledge_type = ?');
      params.push(knowledge_type);
    }

    if (architecture_layer) {
      conditions.push('architecture_layer = ?');
      params.push(architecture_layer);
    }

    if (scene) {
      conditions.push('scene = ?');
      params.push(scene);
    }

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (created_by && typeof created_by === 'string' && created_by.trim() !== '') {
      conditions.push('created_by = ?');
      params.push(created_by.trim());
    }

    if (created_after) {
      conditions.push('created_at >= ?');
      params.push(created_after);
    }

    if (created_before) {
      conditions.push('created_at <= ?');
      params.push(created_before + ' 23:59:59');
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // 校验排序字段（白名单防止 SQL 注入）
    const allowedSortFields = ['created_at', 'updated_at', 'reviewed_at', 'score_total', 'title'];
    const sortField = allowedSortFields.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    // 查询总数
    const countSql = `SELECT COUNT(*) AS total FROM kb_entries ${whereClause}`;
    const [countRows] = await pool.execute(countSql, params);
    const total = countRows[0].total;

    // 当有搜索词时，添加 MATCH 相关性评分字段（P9-T13：ngram 分词）
    const relevanceSelect = hasSearch
      ? ', MATCH(title, summary, full_content) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance'
      : '';

    const listSql = `
      SELECT id, entry_code, title, knowledge_type, architecture_layer, scene,
             severity, summary, status, score_total, version_label,
             created_by, reviewer_id, created_at, updated_at, reviewed_at${relevanceSelect}
      FROM kb_entries
      ${whereClause}
      ORDER BY ${hasSearch ? 'relevance DESC, ' : ''}${sortField} ${sortOrder}
      LIMIT ${limitNum} OFFSET ${offset}
    `;

    // 搜索词参数需在 listSql 中再次传递（用于 relevance 计算）
    const listParams = hasSearch ? [q.trim(), ...params] : params;
    const [rows] = await pool.execute(listSql, listParams);

    // 格式化输出（去除 full_content 等大字段，列表不需要）
    const entries = rows.map((row) => ({
      id: row.id,
      entryCode: row.entry_code,
      title: row.title,
      knowledgeType: row.knowledge_type,
      architectureLayer: row.architecture_layer,
      scene: row.scene,
      severity: row.severity,
      summary: row.summary,
      status: row.status,
      scoreTotal: row.score_total,
      versionLabel: row.version_label,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reviewedAt: row.reviewed_at,
    }));

    return sendSuccess(res, {
      entries,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    logger.error('列表查询失败', { error: err.message });
    return sendError(res, errors.DB_ERROR, safeErrorMsg('查询知识条目失败', err));
  }
});

// ============================================================
// GET /api/entries/:id — 详情（含 tags 和 versions）
// ============================================================
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) {
      return sendError(res, errors.VALIDATION_ERROR, '无效的条目 ID');
    }

    // 查询主条目
    const [entryRows] = await pool.execute(
      `SELECT id, entry_code, title, knowledge_type, architecture_layer, scene,
              severity, summary, full_content, raw_input,
              score_completeness, score_accuracy, score_timeliness,
              score_operability, score_reusability, score_traceability, score_total,
              major_version, minor_version, patch_version, version_label,
              status, reviewer_id, reviewed_at, review_comment,
              next_review_date, review_cycle,
              created_by, updated_by, created_at, updated_at
       FROM kb_entries WHERE id = ? LIMIT 1`,
      [id]
    );

    if (entryRows.length === 0) {
      return sendError(res, errors.NOT_FOUND, '知识条目不存在');
    }

    const row = entryRows[0];
    const entry = {
      id: row.id,
      entryCode: row.entry_code,
      title: row.title,
      knowledgeType: row.knowledge_type,
      architectureLayer: row.architecture_layer,
      scene: row.scene,
      severity: row.severity,
      summary: row.summary,
      fullContent: row.full_content,
      rawInput: row.raw_input,
      scores: {
        completeness: row.score_completeness,
        accuracy: row.score_accuracy,
        timeliness: row.score_timeliness,
        operability: row.score_operability,
        reusability: row.score_reusability,
        traceability: row.score_traceability,
        total: row.score_total,
      },
      version: {
        major: row.major_version,
        minor: row.minor_version,
        patch: row.patch_version,
        label: row.version_label,
      },
      status: row.status,
      reviewerId: row.reviewer_id,
      reviewedAt: row.reviewed_at,
      reviewComment: row.review_comment,
      nextReviewDate: row.next_review_date,
      reviewCycle: row.review_cycle,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    // 查询标签
    const [tagRows] = await pool.execute(
      'SELECT id, tag_name, tag_type FROM kb_tags WHERE entry_id = ? ORDER BY tag_type, tag_name',
      [id]
    );
    const tags = tagRows.map((t) => ({ id: t.id, name: t.tag_name, type: t.tag_type }));

    // 查询版本历史（最新 5 条）
    const [versionRows] = await pool.execute(
      'SELECT id, version_label, change_summary, changed_by, created_at FROM kb_version_history WHERE entry_id = ? ORDER BY created_at DESC LIMIT 5',
      [id]
    );
    const versions = versionRows.map((v) => ({
      id: v.id,
      versionLabel: v.version_label,
      changeSummary: v.change_summary,
      changedBy: v.changed_by,
      createdAt: v.created_at,
    }));

    return sendSuccess(res, { entry, tags, versions });
  } catch (err) {
    logger.error('详情查询失败', { error: err.message });
    return sendError(res, errors.DB_ERROR, safeErrorMsg('查询条目详情失败', err));
  }
});

// ============================================================
// GET /api/entries/:id/history — 版本历史列表（P9-T27：分页 + 不含大字段）
// ============================================================
router.get('/:id/history', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) {
      return sendError(res, errors.VALIDATION_ERROR, '无效的条目 ID');
    }

    // P9-T31：分页参数安全校验（版本历史最大 50 条/页）
    let pageNum, limitNum, offset;
    try {
      ({ pageNum, limitNum, offset } = validatePagination(req.query.page, req.query.limit, 50, 20));
    } catch (e) {
      return sendError(res, errors.VALIDATION_ERROR, e.message);
    }

    // 确认条目存在
    const [check] = await pool.execute('SELECT id FROM kb_entries WHERE id = ? LIMIT 1', [id]);
    if (check.length === 0) {
      return sendError(res, errors.NOT_FOUND, '知识条目不存在');
    }

    // 总数
    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM kb_version_history WHERE entry_id = ?',
      [id]
    );
    const total = countRows[0].total;

    // 分页查询（不含 full_content_snapshot 大字段）
    // P9-T31：limitNum/offset 已通过 validatePagination 严格校验，且 mysql2 execute() 不支持 LIMIT/OFFSET 参数化
    const [rows] = await pool.execute(
      `SELECT id, version_label, change_summary, changed_by, created_at
       FROM kb_version_history
       WHERE entry_id = ?
       ORDER BY created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      [id]
    );

    const history = rows.map((row) => ({
      id: row.id,
      versionLabel: row.version_label,
      changeSummary: row.change_summary,
      changedBy: row.changed_by,
      createdAt: row.created_at,
    }));

    return sendSuccess(res, { entryId: id, history, total, page: pageNum, limit: limitNum });
  } catch (err) {
    logger.error('历史查询失败', { error: err.message });
    return sendError(res, errors.DB_ERROR, safeErrorMsg('查询版本历史失败', err));
  }
});

// ============================================================
// GET /api/entries/:id/history/:versionId — 版本详情（含 full_content_snapshot）
// ============================================================
router.get('/:id/history/:versionId', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const versionId = parseInt(req.params.versionId, 10);
    if (!id || id <= 0 || !versionId || versionId <= 0) {
      return sendError(res, errors.VALIDATION_ERROR, '无效的 ID');
    }

    const [rows] = await pool.execute(
      `SELECT id, version_label, change_summary, changed_by, full_content_snapshot, created_at
       FROM kb_version_history
       WHERE id = ? AND entry_id = ?
       LIMIT 1`,
      [versionId, id]
    );

    if (rows.length === 0) {
      return sendError(res, errors.NOT_FOUND, '版本记录不存在');
    }

    const row = rows[0];
    return sendSuccess(res, {
      version: {
        id: row.id,
        versionLabel: row.version_label,
        changeSummary: row.change_summary,
        changedBy: row.changed_by,
        fullContentSnapshot: row.full_content_snapshot,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    logger.error('版本详情查询失败', { error: err.message });
    return sendError(res, errors.DB_ERROR, safeErrorMsg('查询版本详情失败', err));
  }
});

// ============================================================
// GET /api/entries/:id/related — 相关条目推荐
// 规则：同 scene 优先，同 knowledge_type 次之，排除自身，取 5 条
// ============================================================
router.get('/:id/related', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) {
      return sendError(res, errors.VALIDATION_ERROR, '无效的条目 ID');
    }

    const [[entry]] = await pool.execute(
      'SELECT scene, knowledge_type FROM kb_entries WHERE id = ? LIMIT 1',
      [id]
    );
    if (!entry) {
      return sendError(res, errors.NOT_FOUND, '知识条目不存在');
    }

    const [rows] = await pool.execute(
      `SELECT id, entry_code, title, knowledge_type, scene, summary, score_total, status, created_at
       FROM kb_entries
       WHERE id != ? AND status NOT IN ('archived','rejected')
         AND (scene = ? OR knowledge_type = ?)
       ORDER BY (CASE WHEN scene = ? THEN 0 ELSE 1 END),
                score_total DESC,
                created_at DESC
       LIMIT 5`,
      [id, entry.scene, entry.knowledge_type, entry.scene]
    );

    const related = rows.map((row) => ({
      id: row.id,
      entryCode: row.entry_code,
      title: row.title,
      knowledgeType: row.knowledge_type,
      scene: row.scene,
      summary: row.summary,
      scoreTotal: row.score_total,
      status: row.status,
      createdAt: row.created_at,
    }));

    return sendSuccess(res, { related });
  } catch (err) {
    logger.error('相关推荐查询失败', { error: err.message });
    return sendError(res, errors.DB_ERROR, safeErrorMsg('查询相关条目失败', err));
  }
});

module.exports = router;
