/**
 * routes/chat.js — 核心对话路由（系统最核心接口）
 * 职责：实现 POST /api/chat 和 POST /api/chat/stream，
 *       按框架文档第六章 6.1 六步流程。
 *   P10-CQ-16：步骤 2-6 共享逻辑已抽取至 services/chat-processor.js，
 *   两端点仅负责输入/输出格式差异。
 */

const express = require('express');
const router = express.Router();

const ai = require('../services/ai');
const config = require('../config');
const { sendSuccess, sendError, safeErrorMsg } = require('../utils/response');
const errors = require('../utils/errors');
const { authRequired } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rate-limiter');
const { createModuleLogger } = require('../services/logger');
const { buildContext, processChatResult } = require('../services/chat-processor');

const logger = createModuleLogger('chat');

// 所有 /api/chat 接口都需要登录 + 限流
router.use(authRequired);
router.use(chatLimiter);

// ============================================================
// POST /api/chat — 核心对话接口（同步 JSON）
// ============================================================
router.post('/', async (req, res) => {
  // ---------- 步骤 1：接收请求 ----------
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

  try {
    // ---------- 步骤 2-3：构建上下文（含对话历史 + Prompt + 搜索注入） ----------
    const messages = await buildContext(sessionId, userMessage, enableWebSearch);

    // ---------- 步骤 4：调用 AI ----------
    let { replyText, sqlStatements, thinking } = await ai.callAI(messages, { enableWebSearch, enableThinking });

    // ---------- 步骤 5-6：共享处理流程（SQL 校验/执行/副作用/会话记录） ----------
    const result = await processChatResult({
      replyText, sqlStatements, thinking,
      sessionId, userMessage, user, clientIp, messages,
    });

    return sendSuccess(res, {
      ...result.responseData,
      sessionId,
    });
  } catch (err) {
    if (err.isCircuitOpen) {
      return sendError(res, errors.AI_API_ERROR, 'AI 服务暂时不可用，请稍后再试');
    }
    if (err.isTimeout || err.httpStatus) {
      logger.error('AI 调用失败', { error: err.message });
      return sendError(res, errors.AI_API_ERROR, safeErrorMsg('AI 调用失败', err));
    }
    logger.error('未预期错误', { error: err.message });
    return sendError(res, errors.INTERNAL_ERROR, safeErrorMsg('服务器内部错误', err));
  }
});

// ============================================================
// POST /api/chat/stream — 流式对话接口（SSE 逐 token 输出）
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
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const endStream = () => {
    if (!res.writableEnded) res.end();
  };

  try {
    // ---------- 步骤 2-3：构建上下文 ----------
    const messages = await buildContext(sessionId, userMessage, enableWebSearch);

    // ---------- 步骤 4：流式调用 AI ----------
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

    // SQL 提取 + 思考内容包装
    const sqlStatements = ai.extractSqlStatements(fullContent);

    let replyText = fullContent;
    if (fullThinking) {
      replyText = `🧠 深度思考\n\`\`\`\n${fullThinking}\n\`\`\`\n\n---\n\n${fullContent}`;
    }

    // ---------- 步骤 5-6：共享处理流程 ----------
    const result = await processChatResult({
      replyText, sqlStatements, thinking: fullThinking,
      sessionId, userMessage, user, clientIp, messages,
    });

    sendEvent('result', { ...result.responseData, sessionId });
    return endStream();
  } catch (err) {
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

module.exports = router;
