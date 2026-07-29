/**
 * routes/chat.js — 核心对话路由（系统最核心接口）
 * 职责：实现 POST /api/chat，严格按框架文档第六章 6.1 六步流程。
 *   步骤1 接收请求 → 步骤2 获取上下文 → 步骤3 构建 Prompt
 *   → 步骤4 调用 AI → 步骤5 分支处理 → 步骤6 清理
 *
 * 分支处理（步骤5）：
 *   A. 无 SQL（AI 追问）→ 返回 follow_up
 *   B. 有 SQL → 替换占位符 → 安全执行 → 按 INSERT/UPDATE/DELETE/SELECT 分支处理副作用：
 *      - INSERT：写 audit_log(create)，返回 entry_created
 *      - UPDATE：写 version_history + audit_log(update)，返回 entry_updated
 *      - DELETE：写 audit_log(delete)，返回 entry_deleted
 *      - SELECT：返回 query_result
 */

const express = require('express');
const router = express.Router();

const session = require('../services/session');
const ai = require('../services/ai');
const promptBuilder = require('../services/prompt-builder');
const sqlExecutor = require('../services/sql-executor');
const searchService = require('../services/search');
const pool = require('../db/connection');
const config = require('../config');
const { sendSuccess, sendError, safeErrorMsg } = require('../utils/response');
const errors = require('../utils/errors');
const { authRequired } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rate-limiter');
const { createModuleLogger } = require('../services/logger');

const logger = createModuleLogger('chat');

// 所有 /api/chat 接口都需要登录 + 限流
router.use(authRequired);
router.use(chatLimiter); // P9-T1：对话限流 20 次/分钟/用户

/**
 * POST /api/chat — 核心对话接口
 */
router.post('/', async (req, res) => {
  // ---------- 步骤 1：接收请求 ----------
  const { message, sessionId, enableWebSearch, enableThinking } = req.body;
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return sendError(res, errors.VALIDATION_ERROR, 'message 不能为空');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return sendError(res, errors.VALIDATION_ERROR, 'sessionId 不能为空');
  }

  const user = req.user; // { id, username, role }
  const userMessage = message.trim();
  const clientIp = req.ip || req.connection?.remoteAddress || null;

  try {
    // ---------- 步骤 2：获取对话上下文 ----------
    const history = session.getHistory(sessionId);

    // ---------- 步骤 3：构建 Prompt ----------
    let messages = promptBuilder.buildMessages(history, userMessage);

    // ---------- 步骤 3.5：联网搜索（若开启，需全局配置和请求参数同时允许） ----------
    let searchResults = '';
    if (config.ai.enableWebSearch && enableWebSearch) {
      searchResults = await searchService.search(userMessage);
      if (searchResults && !searchResults.startsWith('[联网搜索失败') && !searchResults.startsWith('[联网搜索超时')) {
        // 将搜索结果注入到系统 prompt 中
        const sysMsg = messages.find(m => m.role === 'system');
        if (sysMsg) {
          sysMsg.content += '\n\n【以下是实时联网搜索结果，请结合这些信息回答问题】\n' + searchResults;
        }
      }
    }

    // ---------- 步骤 4：调用 AI ----------
    let { replyText, sqlStatements, thinking } = await ai.callAI(messages, { enableWebSearch, enableThinking });

    // ---------- 步骤 5：分支处理 ----------

    // 通用的 thinking 包装函数
    const withThinking = (data) => {
      if (thinking) data.thinking = thinking;
      return data;
    };

    // 分支 A：AI 追问（无 SQL）
    if (!sqlStatements || sqlStatements.length === 0) {
      session.appendMessage(sessionId, 'user', userMessage);
      session.appendMessage(sessionId, 'assistant', replyText);
      return sendSuccess(res, withThinking({
        type: 'follow_up',
        message: replyText,
        sessionId,
      }));
    }

    // 分支 B：AI 返回了 SQL
    const primaryType = detectPrimaryType(sqlStatements);

    // 替换占位符 __CREATED_BY__ → 当前登录用户名
    let processedSqls = sqlStatements.map((sql) =>
      sql.replace(/__CREATED_BY__/g, escapeSqlString(user.username))
    );

    // 对 INSERT：注入 __ENTRY_CODE__ 占位符，实际编码在 sql-executor 事务内原子生成
    if (primaryType === 'insert') {
      processedSqls = processedSqls.map((sql) =>
        injectEntryCode(sql, '__ENTRY_CODE__', user.username)
      );
    }

    // 对 UPDATE：先 SELECT 旧数据用于 version_history 快照
    let oldEntries = [];
    if (primaryType === 'update') {
      oldEntries = await snapshotOldEntriesForUpdate(sqlStatements);
    }

    // 调用 SQL 安全执行器（5 层校验 + 事务执行）
    const result = await sqlExecutor.validateAndExecute(processedSqls, user.id, {
      entryCode: primaryType === 'insert'
    });

    if (!result.success) {
      // SQL 校验或执行失败
      const errMsg = `操作失败：${result.error}`;
      session.appendMessage(sessionId, 'user', userMessage);
      session.appendMessage(sessionId, 'assistant', errMsg);
      return sendSuccess(res, withThinking({
        type: 'error',
        message: errMsg,
        sessionId,
      }));
    }

    // 成功：按操作类型处理副作用（audit_log / version_history）并构造响应
    let responseData;
    switch (primaryType) {
      case 'insert':
        responseData = await handleInsertSuccess(result, user, clientIp, replyText);
        break;
      case 'update':
        responseData = await handleUpdateSuccess(result, oldEntries, user, clientIp, replyText);
        break;
      case 'delete':
        responseData = await handleDeleteSuccess(result, user, clientIp, replyText);
        break;
      case 'select':
      default:
        responseData = handleSelectSuccess(result, replyText);
        // 自动录入：当 SELECT 结果为空时，自动调用 AI 继续执行录入（无需人工确认）
        if (responseData.results && responseData.results.length === 0) {
          // P9-T26：保存第一轮 AI 响应，后续写入 session
          const firstReplyText = replyText;
          const autoData = await autoContinueInsert(messages, user, clientIp);
          if (autoData) {
            responseData = autoData;
            if (autoData.message) replyText = autoData.message;
            if (autoData.thinking) thinking = autoData.thinking;
            // 标记自动录入已完成，步骤 6 将追记第一轮查重推理
            res.locals._autoInsertDone = true;
            res.locals._firstReplyText = firstReplyText;
          }
        }
        break;
    }

    // ---------- 步骤 6：清理（追加对话上下文，session 自动截断） ----------
    session.appendMessage(sessionId, 'user', userMessage);
    // P9-T26：自动录入成功后，追记第一轮 AI 的查重推理，保留完整对话链
    if (res.locals._autoInsertDone && res.locals._firstReplyText) {
      session.appendMessage(sessionId, 'assistant', res.locals._firstReplyText);
    }
    session.appendMessage(sessionId, 'assistant', replyText);

    return sendSuccess(res, withThinking({ ...responseData, sessionId }));
  } catch (err) {
    // P9-T19：熔断器打开时的友好提示
    if (err.isCircuitOpen) {
      return sendError(res, errors.AI_API_ERROR, 'AI 服务暂时不可用，请稍后再试');
    }
    // AI 调用失败（超时 / HTTP 错误）
    if (err.isTimeout || err.httpStatus) {
      logger.error('AI 调用失败', { error: err.message });
      return sendError(res, errors.AI_API_ERROR, safeErrorMsg('AI 调用失败', err));
    }
    logger.error('未预期错误', { error: err.message });
    return sendError(res, errors.INTERNAL_ERROR, safeErrorMsg('服务器内部错误', err));
  }
});

// ============================================================
// POST /api/chat/stream — 流式对话接口（P9-T7：SSE 逐 token 输出）
// ============================================================
router.post('/stream', async (req, res) => {
  const { message, sessionId, enableWebSearch, enableThinking } = req.body;
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return sendError(res, errors.VALIDATION_ERROR, 'message 不能为空');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return sendError(res, errors.VALIDATION_ERROR, 'sessionId 不能为空');
  }

  const user = req.user;
  const userMessage = message.trim();
  const clientIp = req.ip || req.connection?.remoteAddress || null;

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // 禁用 nginx 缓冲
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const endStream = () => {
    if (!res.writableEnded) res.end();
  };

  try {
    // 步骤 2：获取对话上下文
    const history = session.getHistory(sessionId);

    // 步骤 3：构建 Prompt
    let messages = promptBuilder.buildMessages(history, userMessage);

    // 步骤 3.5：联网搜索
    let searchResults = '';
    if (config.ai.enableWebSearch && enableWebSearch) {
      searchResults = await searchService.search(userMessage);
      if (searchResults && !searchResults.startsWith('[联网搜索失败') && !searchResults.startsWith('[联网搜索超时')) {
        const sysMsg = messages.find(m => m.role === 'system');
        if (sysMsg) {
          sysMsg.content += '\n\n【以下是实时联网搜索结果，请结合这些信息回答问题】\n' + searchResults;
        }
      }
    }

    // 步骤 4：流式调用 AI
    let fullContent = '';
    let fullThinking = '';

    for await (const chunk of ai.callAIStream(messages, { enableWebSearch, enableThinking })) {
      if (chunk.done) break;

      if (chunk.thinking) {
        fullThinking += chunk.thinking;
        sendEvent('thinking', { token: chunk.thinking });
      }
      if (chunk.content) {
        fullContent += chunk.content;
        sendEvent('token', { token: chunk.content });
      }
    }
    logger.info('AI 流式响应完成', { contentLength: fullContent.length, thinkingLength: fullThinking.length });

    // SQL 提取（在完整文本上执行，避免半截代码块）
    const sqlStatements = ai.extractSqlStatements(fullContent);

    // 思考内容包装
    let replyText = fullContent;
    if (fullThinking) {
      replyText = `🧠 深度思考\n\`\`\`\n${fullThinking}\n\`\`\`\n\n---\n\n${fullContent}`;
    }

    // 步骤 5：分支处理
    const withThinking = (data) => {
      if (fullThinking) data.thinking = fullThinking;
      return data;
    };

    // 分支 A：AI 追问（无 SQL）
    if (!sqlStatements || sqlStatements.length === 0) {
      session.appendMessage(sessionId, 'user', userMessage);
      session.appendMessage(sessionId, 'assistant', replyText);
      sendEvent('result', withThinking({
        type: 'follow_up',
        message: replyText,
        sessionId,
      }));
      return endStream();
    }

    // 分支 B：有 SQL
    const primaryType = detectPrimaryType(sqlStatements);

    let processedSqls = sqlStatements.map((sql) =>
      sql.replace(/__CREATED_BY__/g, escapeSqlString(user.username))
    );

    if (primaryType === 'insert') {
      processedSqls = processedSqls.map((sql) =>
        injectEntryCode(sql, '__ENTRY_CODE__', user.username)
      );
    }

    let oldEntries = [];
    if (primaryType === 'update') {
      oldEntries = await snapshotOldEntriesForUpdate(sqlStatements);
    }

    const result = await sqlExecutor.validateAndExecute(processedSqls, user.id, {
      entryCode: primaryType === 'insert'
    });

    if (!result.success) {
      const errMsg = `操作失败：${result.error}`;
      session.appendMessage(sessionId, 'user', userMessage);
      session.appendMessage(sessionId, 'assistant', errMsg);
      sendEvent('result', withThinking({
        type: 'error',
        message: errMsg,
        sessionId,
      }));
      return endStream();
    }

    let responseData;
    switch (primaryType) {
      case 'insert':
        responseData = await handleInsertSuccess(result, user, clientIp, replyText);
        break;
      case 'update':
        responseData = await handleUpdateSuccess(result, oldEntries, user, clientIp, replyText);
        break;
      case 'delete':
        responseData = await handleDeleteSuccess(result, user, clientIp, replyText);
        break;
      case 'select':
      default:
        responseData = handleSelectSuccess(result, replyText);
        if (responseData.results && responseData.results.length === 0) {
          const firstReplyText = replyText;
          const autoData = await autoContinueInsert(messages, user, clientIp);
          if (autoData) {
            responseData = autoData;
            if (autoData.message) replyText = autoData.message;
            if (autoData.thinking) fullThinking = autoData.thinking;
            res.locals._autoInsertDone = true;
            res.locals._firstReplyText = firstReplyText;
          }
        }
        break;
    }

    // 步骤 6：追加对话上下文
    session.appendMessage(sessionId, 'user', userMessage);
    if (res.locals._autoInsertDone && res.locals._firstReplyText) {
      session.appendMessage(sessionId, 'assistant', res.locals._firstReplyText);
    }
    session.appendMessage(sessionId, 'assistant', replyText);

    sendEvent('result', withThinking({ ...responseData, sessionId }));
    return endStream();
  } catch (err) {
    // P9-T19：熔断器打开时的友好提示
    if (err.isCircuitOpen) {
      sendEvent('error', { message: 'AI 服务暂时不可用，请稍后再试' });
      return endStream();
    }
    if (err.isTimeout || err.httpStatus) {
      logger.error('AI 流式调用失败', { error: err.message });
      sendEvent('error', { message: safeErrorMsg('AI 调用失败', err) });
      return endStream();
    }
    logger.error('流式未预期错误', { error: err.message });
    sendEvent('error', { message: safeErrorMsg('服务器内部错误', err) });
    return endStream();
  }
});

// ============================================================
// 辅助函数
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
      if (t !== 'select') return t; // 优先返回写操作
    }
  }
  return 'select';
}

/**
 * 对 UPDATE 语句，先查询旧数据用于版本历史快照
 * 解析 WHERE id = N 或 WHERE entry_code = 'KB-...' 提取条件
 * @param {string[]} sqlStatements
 * @returns {Promise<Array<{id, entry_code, title, full_content, version_label}>>}
 */
async function snapshotOldEntriesForUpdate(sqlStatements) {
  const oldEntries = [];
  for (const sql of sqlStatements) {
    if (!/^UPDATE\b/i.test(sql.trim())) continue;

    // 尝试解析 WHERE id = N
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

    // 尝试解析 WHERE entry_code = '...'
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
    // 更新状态为 pending_review（进入审核流程），否则审核功能永远看不到新条目
    try {
      await pool.execute(
        "UPDATE kb_entries SET status = 'pending_review' WHERE id = ? AND status = 'draft'",
        [insertId]
      );
    } catch (e) {
      logger.error('更新条目状态为 pending_review 失败', { error: e.message });
    }

    // 写 audit_log
    try {
      await pool.execute(
        'INSERT INTO kb_audit_log (entry_id, action, operator, detail, ip_address) VALUES (?, ?, ?, ?, ?)',
        [insertId, 'create', user.username, 'AI 辅助录入（待审核）', ip]
      );
    } catch (e) {
      logger.error('写 audit_log(create) 失败', { error: e.message });
    }

    // 查询刚插入的条目摘要
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

  return {
    type: 'entry_created',
    entry,
    message: replyText,
  };
}

/**
 * 处理 UPDATE 成功：写 version_history + audit_log(update)，返回 entry_updated
 */
async function handleUpdateSuccess(result, oldEntries, user, ip, replyText) {
  for (const old of oldEntries) {
    // 写 version_history（旧版本快照）
    try {
      await pool.execute(
        'INSERT INTO kb_version_history (entry_id, version_label, change_summary, changed_by, full_content_snapshot) VALUES (?, ?, ?, ?, ?)',
        [old.id, old.version_label, 'AI 辅助更新', user.username, old.full_content]
      );
    } catch (e) {
      logger.error('写 version_history 失败', { error: e.message });
    }

    // 写 audit_log
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
      id: e.id,
      entry_code: e.entry_code,
      title: e.title,
    })),
    message: replyText,
  };
}

/**
 * 处理 DELETE 成功：写 audit_log(delete)，返回 entry_deleted
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
  return {
    type: 'entry_deleted',
    message: replyText,
  };
}

/**
 * 处理 SELECT 成功：合并所有 SELECT 结果，返回 query_result
 */
function handleSelectSuccess(result, replyText) {
  const types = result.parsedTypes || [];
  const allRows = [];
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'select') {
      const rows = result.results[i];
      if (Array.isArray(rows)) {
        allRows.push(...rows);
      }
    }
  }
  return {
    type: 'query_result',
    results: allRows,
    message: replyText,
  };
}

/**
 * SQL 字符串转义（用于占位符替换时确保安全）
 * 占位符替换后，SQL 仍会经过 sql-executor 的 5 层安全校验
 * @param {string} str
 * @returns {string}
 */
function escapeSqlString(str) {
  if (typeof str !== 'string') return '';
  // 转义反斜杠和单引号（MySQL 字符串字面量规则）
  return str.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * 将 entry_code 注入到 SQL 语句中
 * 两种情况：
 *   1. SQL 含 __ENTRY_CODE__ 占位符 → 直接替换（AI 按 prompt 规范生成）
 *   2. SQL 是 INSERT INTO kb_entries 但不含占位符 → 自动注入字段和值（兜底）
 * @param {string} sql - 原始 SQL
 * @param {string} entryCode - 生成的 entry_code
 * @param {string} username - 当前用户名（用于 __CREATED_BY__ 替换，已在上游处理，此处仅 entry_code）
 * @returns {string} 处理后的 SQL
 */
function injectEntryCode(sql, entryCode, username) {
  // 情况 1：含占位符，直接替换
  if (sql.includes('__ENTRY_CODE__')) {
    return sql.replace(/__ENTRY_CODE__/g, escapeSqlString(entryCode));
  }

  // 情况 2：INSERT INTO kb_entries 但未含 entry_code 字段 → 注入
  // 仅处理 INSERT 语句
  if (!/^INSERT\s+INTO\s+kb_entries\b/i.test(sql.trim())) {
    return sql; // 非 kb_entries 的 INSERT，不处理
  }

  // 已含 entry_code 字段则不再注入（避免重复）
  if (/\bentry_code\b/i.test(sql)) {
    return sql;
  }

  const escapedCode = escapeSqlString(entryCode);

  // 在字段列表的左括号后注入 entry_code,
  // 匹配 INSERT INTO kb_entries ( 后的位置
  let result = sql.replace(
    /^(INSERT\s+INTO\s+kb_entries\s*\()\s*/i,
    `$1entry_code, `
  );

  // 在 ) VALUES ( 的左括号后注入 'entry_code',
  // 用 [\s\S]* 匹配跨行，但只替换第一次出现
  result = result.replace(
    /(\)\s*VALUES\s*\()\s*/i,
    `$1'${escapedCode}', `
  );

  return result;
}

/**
 * 自动续写录入：AI 返回空 SELECT 结果后，自动再调 AI 执行 INSERT
 * 目的：消除用户手动确认环节，实现"一次发送模板即完成录入"
 * @param {Array} messages - 当前完整的 messages 数组（含搜索注入）
 * @param {Object} user - 当前用户
 * @param {string} clientIp - 客户端 IP
 * @returns {Promise<Object|null>} 录入成功则返回响应数据对象，否则返回 null
 */
async function autoContinueInsert(messages, user, clientIp) {
  // 构造 follow-up prompt，指示 AI 直接执行录入
  const followUpPrompt =
    '查重通过，未发现重复条目。请根据用户原始需求直接执行录入操作，输出 INSERT 语句。';
  const followUpMessages = [
    ...messages,
    { role: 'system', content: followUpPrompt },
  ];

  // 调用 AI（不启用搜索和思考，加速响应）
  let secondCall;
  try {
    secondCall = await ai.callAI(followUpMessages, {});
  } catch (e) {
    logger.error('自动录入 AI 调用失败', { error: e.message });
    return null;
  }

  const { replyText: secondReply, sqlStatements: secondSql, thinking: secondThinking } = secondCall;
  const secondType = detectPrimaryType(secondSql || []);

  // 仅当 AI 返回 INSERT 时才继续
  if (secondType !== 'insert' || !secondSql || secondSql.length === 0) {
    return null;
  }

  // 替换占位符 + 注入 __ENTRY_CODE__ 占位符（编码在 sql-executor 事务内生成）
  let processedSqls = secondSql.map((sql) =>
    sql.replace(/__CREATED_BY__/g, escapeSqlString(user.username))
  );
  processedSqls = processedSqls.map((sql) =>
    injectEntryCode(sql, '__ENTRY_CODE__', user.username)
  );

  // 安全执行（entryCode: true 表示在事务内原子生成 entry_code）
  const result = await sqlExecutor.validateAndExecute(processedSqls, user.id, {
    entryCode: true
  });
  if (!result.success) {
    logger.error('自动录入 SQL 执行失败', { error: result.error });
    return null;
  }

  // 构造响应
  const responseData = await handleInsertSuccess(result, user, clientIp, secondReply);
  if (secondThinking) responseData.thinking = secondThinking;
  return responseData;
}

module.exports = router;
