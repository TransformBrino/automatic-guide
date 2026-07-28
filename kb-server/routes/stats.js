/**
 * routes/stats.js — 统计接口
 * 职责：提供知识库分类聚合统计数据。
 * 对应框架文档第八章 8.2 接口清单第 11 项。
 */

const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { sendSuccess, sendError, safeErrorMsg } = require('../utils/response');
const errors = require('../utils/errors');
const { authRequired } = require('../middleware/auth');

router.use(authRequired);

// ============================================================
// GET /api/stats — 统计数据（无需鉴权除外的特殊处理，已挂 authRequired）
// ============================================================
router.get('/', async (req, res) => {
  try {
    // 1. 总数
    const [totalRow] = await pool.execute(
      'SELECT COUNT(*) AS total FROM kb_entries WHERE status != "archived"'
    );
    const totalEntries = totalRow[0].total;

    // 2. 按 knowledge_type 分组
    const [typeRows] = await pool.execute(
      `SELECT knowledge_type, COUNT(*) AS count
       FROM kb_entries
       WHERE status != 'archived'
       GROUP BY knowledge_type`
    );
    const byType = {};
    for (const row of typeRows) {
      byType[row.knowledge_type] = row.count;
    }

    // 确保 6 种类型都有值
    const ALL_TYPES = ['fault_case', 'sop', 'experience_rule', 'scene_portrait', 'tool_script', 'ai_template'];
    for (const t of ALL_TYPES) {
      if (byType[t] === undefined) byType[t] = 0;
    }

    // 3. 按 scene 分组（Top 10）
    const [sceneRows] = await pool.execute(
      `SELECT scene, COUNT(*) AS count
       FROM kb_entries
       WHERE status != 'archived'
       GROUP BY scene
       ORDER BY count DESC
       LIMIT 10`
    );
    const byScene = {};
    for (const row of sceneRows) {
      byScene[row.scene] = row.count;
    }

    // 4. 按 status 分组
    const [statusRows] = await pool.execute(
      `SELECT status, COUNT(*) AS count
       FROM kb_entries
       GROUP BY status`
    );
    const byStatus = {};
    for (const row of statusRows) {
      byStatus[row.status] = row.count;
    }

    // 确保 5 种状态都有值
    const ALL_STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'archived'];
    for (const s of ALL_STATUSES) {
      if (byStatus[s] === undefined) byStatus[s] = 0;
    }

    return sendSuccess(res, {
      totalEntries,
      byType,
      byScene,
      byStatus,
    });
  } catch (err) {
    console.error('[stats] 统计查询失败:', err);
    return sendError(res, errors.DB_ERROR, safeErrorMsg('统计查询失败', err));
  }
});

module.exports = router;
