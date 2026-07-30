/**
 * services/chat-processor.js — 核心对话处理流程（P10-CQ-16）
 * 职责：抽取 POST / 和 POST /stream 共享的步骤 2-6 逻辑，
 *       包括会话加载、Prompt 构建、搜索注入、SQL 处理和副作用。
 *       两个端点只负责不同输入/输出格式。
 */

const session = require('./session');
const promptBuilder = require('./prompt-builder');
const sqlExecutor = require('./sql-executor');
const searchService = require('./search');
const pool = require('../db/connection');
const config = require('../config');
const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('chat-processor');

// 引用 chat.js 中的辅助函数（延迟 require 避免循环依赖）
let _helpers = null;
function helpers() {
  if (!_helpers) {
    // eslint-disable-next-line global-require
    _helpers = require('../routes/chat-helpers');
  }
  return _helpers;
}

/**
 * 步骤 2-3：构建完整 messages（含对话历史 + 系统 prompt + 联网搜索注入）
 * @param {string} sessionId
 * @param {string} userMessage
 * @param {boolean} enableWebSearch
 * @returns {Promise<Array>} messages 数组
 */
async function buildContext(sessionId, userMessage, enableWebSearch) {
  const history = session.getHistory(sessionId);
  let messages = promptBuilder.buildMessages(history, userMessage);

  if (config.ai.enableWebSearch && enableWebSearch) {
    const searchResults = await searchService.search(userMessage);
    if (searchResults && !searchResults.startsWith('[联网搜索失败') && !searchResults.startsWith('[联网搜索超时')) {
      const sysMsg = messages.find(m => m.role === 'system');
      if (sysMsg) {
        sysMsg.content += '\n\n【以下是实时联网搜索结果，请结合这些信息回答问题】\n' + searchResults;
      }
    }
  }
  return messages;
}

/**
 * 步骤 5-6：处理 AI 返回的 SQL 结果（两端点共用）
 * @param {Object} params
 * @param {string} params.replyText - AI 回复原始文本
 * @param {string[]} params.sqlStatements - 提取的 SQL 语句
 * @param {string} params.thinking - 思考内容
 * @param {string} params.sessionId
 * @param {string} params.userMessage
 * @param {Object} params.user - { id, username, role }
 * @param {string} params.clientIp
 * @param {Array} params.messages - 完整 messages（autoContinueInsert 需要）
 * @returns {Promise<{responseData: Object, replyText: string, thinking: string}>}
 */
async function processChatResult({
  replyText,
  sqlStatements,
  thinking,
  sessionId,
  userMessage,
  user,
  clientIp,
  messages,
}) {
  const h = helpers();

  // 通用的 thinking 包装函数
  const withThinking = (data) => {
    if (thinking) data.thinking = thinking;
    return data;
  };

  // 分支 A：AI 追问（无 SQL）
  if (!sqlStatements || sqlStatements.length === 0) {
    session.appendMessage(sessionId, 'user', userMessage);
    session.appendMessage(sessionId, 'assistant', replyText);
    return {
      responseData: withThinking({ type: 'follow_up', message: replyText }),
      replyText,
      thinking,
    };
  }

  // 分支 B：AI 返回了 SQL
  const primaryType = h.detectPrimaryType(sqlStatements);

  // 替换占位符 __CREATED_BY__ → 当前登录用户名
  let processedSqls = sqlStatements.map((sql) =>
    sql.replace(/__CREATED_BY__/g, h.escapeSqlString(user.username))
  );

  // 对 INSERT：注入 __ENTRY_CODE__ 占位符
  if (primaryType === 'insert') {
    processedSqls = processedSqls.map((sql) =>
      h.injectEntryCode(sql, '__ENTRY_CODE__', user.username)
    );
  }

  // 对 UPDATE：先 SELECT 旧数据用于 version_history 快照
  let oldEntries = [];
  if (primaryType === 'update') {
    oldEntries = await h.snapshotOldEntriesForUpdate(sqlStatements);
  }

  // 调用 SQL 安全执行器（5 层校验 + 事务执行）
  const result = await sqlExecutor.validateAndExecute(processedSqls, user.id, {
    entryCode: primaryType === 'insert',
  });

  if (!result.success) {
    const errMsg = `操作失败：${result.error}`;
    session.appendMessage(sessionId, 'user', userMessage);
    session.appendMessage(sessionId, 'assistant', errMsg);
    return {
      responseData: withThinking({ type: 'error', message: errMsg }),
      replyText: errMsg,
      thinking,
    };
  }

  // 成功：按操作类型处理副作用并构造响应
  let responseData;
  let autoInsertDone = false;
  let firstReplyText = '';
  switch (primaryType) {
    case 'insert':
      responseData = await h.handleInsertSuccess(result, user, clientIp, replyText);
      break;
    case 'update':
      responseData = await h.handleUpdateSuccess(result, oldEntries, user, clientIp, replyText);
      break;
    case 'delete':
      responseData = await h.handleDeleteSuccess(result, user, clientIp, replyText, sqlStatements);
      break;
    case 'select':
    default:
      responseData = h.handleSelectSuccess(result, replyText);
      // 自动录入：当 SELECT 结果为空时，自动调用 AI 继续执行录入
      if (responseData.results && responseData.results.length === 0) {
        firstReplyText = replyText;
        const autoData = await h.autoContinueInsert(messages, user, clientIp);
        if (autoData) {
          if (autoData.error) {
            replyText = autoData.error;
            responseData.type = 'error';
            responseData.message = autoData.error;
          } else {
            responseData = autoData;
            if (autoData.message) replyText = autoData.message;
            if (autoData.thinking) thinking = autoData.thinking;
            autoInsertDone = true;
          }
        }
      }
      break;
  }

  // 步骤 6：追加对话上下文
  session.appendMessage(sessionId, 'user', userMessage);
  // P9-T26：自动录入成功时，追记第一轮 AI 的查重推理，保留完整对话链
  if (autoInsertDone && firstReplyText) {
    session.appendMessage(sessionId, 'assistant', firstReplyText);
  }
  session.appendMessage(sessionId, 'assistant', replyText);

  return { responseData: withThinking(responseData), replyText, thinking };
}

module.exports = { buildContext, processChatResult };
