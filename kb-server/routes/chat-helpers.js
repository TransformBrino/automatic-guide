/**
 * routes/chat-helpers.js — chat 辅助函数（P10-CQ-16）
 * 职责：可独立测试的纯函数和副作用处理函数，从 chat.js 中抽取。
 */

const pool = require('../db/connection');
const ai = require('../services/ai');
const sqlExecutor = require('../services/sql-executor');
const { createModuleLogger } = require('../services/logger');

const logger = createModuleLogger('chat-helpers');

// ============================================================
// SQL 类型检测与处理
// ============================================================

/**
 * 检测 SQL 语句数组的主要操作类型
 * 规则：取第一条非 SELECT 的写操作类型；若全是 SELECT，则为 select
 * @param {string[]} sqlStatements
 * @returns {'insert'|'update'|'delete'|'select'}
 */
function detectPrimaryType(sqlStatements) {
  for (const sql of sqlStatements) {
    const m = sql.trim().match(/^(SELECT|INSERT|UPDATE|DELETE)\b/i);
    if (m) {
      const t = m[1].toLowerCase();
      if (t !== 'select') return t;
    }
  }
  return 'select';
}

/**
 * SQL 字符串转义（用于占位符替换时确保安全）
 * @param {string} str
 * @returns {string}
 */
function escapeSqlString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * 将 entry_code 注入到 SQL 语句中
 * 两种情况：
 *   1. SQL 含 __ENTRY_CODE__ 占位符 → 直接替换
 *   2. SQL 是 INSERT INTO kb_entries 但不含占位符 → 自动注入字段和值
 * @param {string} sql - 原始 SQL
 * @param {string} entryCode - entry_code 值或占位符 '__ENTRY_CODE__'
 * @param {string} username - 用户名（未使用，保留接口兼容）
 * @returns {string} 处理后的 SQL
 */
function injectEntryCode(sql, entryCode, username) {
  if (sql.includes('__ENTRY_CODE__')) {
    return sql.replace(/__ENTRY_CODE__/g, escapeSqlString(entryCode));
  }

  if (!/^INSERT\s+INTO\s+kb_entries\b/i.test(sql.trim())) {
    return sql;
  }

  if (/\bentry_code\b/i.test(sql)) {
    return sql;
  }

  const escapedCode = escapeSqlString(entryCode);
  let result = sql.replace(
    /^(INSERT\s+INTO\s+kb_entries\s*\()\s*/i,
    '$1entry_code, '
  );
  result = result.replace(
    /(\)\s*VALUES\s*\()\s*/i,
    `$1'${escapedCode}', `
  );
  return result;
}

// ============================================================
// 版本快照
// ============================================================

/**
 * 对 UPDATE 语句，先查询旧数据用于版本历史快照
 * @param {string[]} sqlStatements
 * @returns {Promise<Array>}
 */
async function snapshotOldEntriesForUpdate(sqlStatements) {
  const oldEntries = [];
  for (const sql of sqlStatements) {
    if (!/^UPDATE\b/i.test(sql.trim())) continue;

    let whereMatch = sql.match(/WHERE\s+id\s*=\s*(\d+)/i);
    if (whereMatch) {
      const id = parseInt(whereMatch[1], 10);
      try {
        const [rows] = await pool.execute(
          'SELECT id, entry_code, title, full_content, version_label FROM kb_entries WHERE id = ?',
          [id]
        );
        if (rows.length > 0) oldEntries.push(rows[0]);
      } catch (e) {
        logger.error('快照旧数据失败', { error: e.message });
      }
      continue;
    }

    whereMatch = sql.match(/WHERE\s+entry_code\s*=\s*'([^']+)'/i);
    if (whereMatch) {
      const code = whereMatch[1];
      try {
        const [rows] = await pool.execute(
          'SELECT id, entry_code, title, full_content, version_label FROM kb_entries WHERE entry_code = ?',
          [code]
        );
        if (rows.length > 0) oldEntries.push(rows[0]);
      } catch (e) {
        logger.error('快照旧数据失败', { error: e.message });
      }
    }
  }
  return oldEntries;
}

// ============================================================
// 副作用处理（audit_log / version_history）
// ============================================================

/**
 * 处理 INSERT 成功：写 audit_log(create)，返回 entry_created
 */
async function handleInsertSuccess(result, user, ip, replyText) {
  const types = result.parsedTypes || [];
  const insertIdx = types.findIndex((t) => t === 'insert');
  if (insertIdx === -1) {
    return { type: 'entry_created', entry: null, message: replyText };
  }

  const insertResult = result.results[insertIdx];
  const insertId = insertResult?.insertId;
  let entry = null;

  if (insertId) {
    try {
      await pool.execute(
        "UPDATE kb_entries SET status = 'pending_review' WHERE id = ? AND status = 'draft'",
        [insertId]
      );
    } catch (e) {
      logger.error('更新条目状态为 pending_review 失败', { error: e.message });
    }

    try {
      await pool.execute(
        'INSERT INTO kb_audit_log (entry_id, action, operator, detail, ip_address) VALUES (?, ?, ?, ?, ?)',
        [insertId, 'create', user.username, 'AI 辅助录入（待审核）', ip]
      );
    } catch (e) {
      logger.error('写 audit_log(create) 失败', { error: e.message });
    }

    try {
      const [rows] = await pool.execute(
        'SELECT id, entry_code, title, status FROM kb_entries WHERE id = ?',
        [insertId]
      );
      if (rows.length > 0) entry = rows[0];
    } catch (e) {
      logger.error('查询新插入条目失败', { error: e.message });
    }
  }

  return { type: 'entry_created', entry, message: replyText };
}

/**
 * 处理 UPDATE 成功：写 version_history + audit_log(update)
 */
async function handleUpdateSuccess(result, oldEntries, user, ip, replyText) {
  for (const old of oldEntries) {
    try {
      await pool.execute(
        'INSERT INTO kb_version_history (entry_id, version_label, change_summary, changed_by, full_content_snapshot) VALUES (?, ?, ?, ?, ?)',
        [old.id, old.version_label, 'AI 辅助更新', user.username, old.full_content]
      );
    } catch (e) {
      logger.error('写 version_history 失败', { error: e.message });
    }

    try {
      await pool.execute(
        'INSERT INTO kb_audit_log (entry_id, action, operator, detail, ip_address) VALUES (?, ?, ?, ?, ?)',
        [old.id, 'update', user.username, 'AI 辅助更新', ip]
      );
    } catch (e) {
      logger.error('写 audit_log(update) 失败', { error: e.message });
    }
  }

  return {
    type: 'entry_updated',
    entries: oldEntries.map((e) => ({
      id: e.id, entry_code: e.entry_code, title: e.title,
    })),
    message: replyText,
  };
}

/**
 * 处理 DELETE 成功：写 audit_log(delete)
 */
async function handleDeleteSuccess(result, user, ip, replyText) {
  try {
    await pool.execute(
      'INSERT INTO kb_audit_log (entry_id, action, operator, detail, ip_address) VALUES (?, ?, ?, ?, ?)',
      [null, 'delete', user.username, 'AI 辅助删除', ip]
    );
  } catch (e) {
    logger.error('写 audit_log(delete) 失败', { error: e.message });
  }
  return { type: 'entry_deleted', message: replyText };
}

/**
 * 处理 SELECT 成功：合并所有 SELECT 结果
 */
function handleSelectSuccess(result, replyText) {
  const types = result.parsedTypes || [];
  const allRows = [];
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'select') {
      const rows = result.results[i];
      if (Array.isArray(rows)) allRows.push(...rows);
    }
  }
  return { type: 'query_result', results: allRows, message: replyText };
}

// ============================================================
// 自动录入
// ============================================================

/**
 * 自动续写录入：AI 返回空 SELECT 结果后，自动再调 AI 执行 INSERT
 * @param {Array} messages - 当前完整的 messages 数组
 * @param {Object} user - 当前用户
 * @param {string} clientIp - 客户端 IP
 * @returns {Promise<Object|null>} 成功返回响应数据，失败返回 { error: string }
 */
async function autoContinueInsert(messages, user, clientIp) {
  const followUpPrompt =
    '查重通过，未发现重复条目。请根据用户原始需求直接执行录入操作，输出 INSERT 语句。';
  const followUpMessages = [
    ...messages,
    { role: 'system', content: followUpPrompt },
  ];

  let secondCall;
  try {
    secondCall = await ai.callAI(followUpMessages, {});
  } catch (e) {
    logger.warn('自动录入 AI 调用失败，返回手动提示', { error: e.message });
    return { error: '自动录入失败（AI 调用异常），请手动描述录入内容后重试。' };
  }

  const { replyText: secondReply, sqlStatements: secondSql, thinking: secondThinking } = secondCall;
  const secondType = detectPrimaryType(secondSql || []);

  if (secondType !== 'insert' || !secondSql || secondSql.length === 0) {
    logger.warn('自动录入 AI 未返回 INSERT 语句', { type: secondType });
    return { error: '自动录入失败（AI 未生成有效的录入指令），请手动录入。' };
  }

  let processedSqls = secondSql.map((sql) =>
    sql.replace(/__CREATED_BY__/g, escapeSqlString(user.username))
  );
  processedSqls = processedSqls.map((sql) =>
    injectEntryCode(sql, '__ENTRY_CODE__', user.username)
  );

  const result = await sqlExecutor.validateAndExecute(processedSqls, user.id, {
    entryCode: true,
  });
  if (!result.success) {
    logger.warn('自动录入 SQL 执行失败', { error: result.error });
    return { error: `自动录入失败（${result.error}），请修正后重新提交。` };
  }

  const responseData = await handleInsertSuccess(result, user, clientIp, secondReply);
  if (secondThinking) responseData.thinking = secondThinking;
  return responseData;
}

module.exports = {
  detectPrimaryType,
  escapeSqlString,
  injectEntryCode,
  snapshotOldEntriesForUpdate,
  handleInsertSuccess,
  handleUpdateSuccess,
  handleDeleteSuccess,
  handleSelectSuccess,
  autoContinueInsert,
};
