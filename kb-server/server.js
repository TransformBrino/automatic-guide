/**
 * server.js — 应用入口
 * 职责：加载配置、创建 Express 实例、注册中间件、挂载路由、启动服务。
 * 对应框架文档第三章 3.2 server.js 职责说明。
 */

const express = require('express');
const path = require('path');
const config = require('./config');
const { sendError } = require('./utils/response');
const errors = require('./utils/errors');

const { authRequired } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const entriesRoutes = require('./routes/entries');
const reviewRoutes = require('./routes/review');
const adminRoutes = require('./routes/admin');
const statsRoutes = require('./routes/stats');

// 启动会话清理定时器（P4-T1）
const { startCleanupTimer } = require('./services/session');
startCleanupTimer();

const app = express();

// ---------- 全局中间件 ----------
app.use(express.json({ limit: '1mb' })); // 解析 JSON 请求体
app.use(express.urlencoded({ extended: true }));

// CORS（内网部署，允许所有来源；生产可按域名白名单收紧）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// 静态文件托管（前端单页应用）
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 路由挂载 ----------

// 健康检查（无需鉴权，供运维探测）
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() }, message: '' });
});

// 登录接口（无需鉴权）
app.use('/api/auth', authRoutes);

// 核心对话接口（需鉴权，chat 路由内部已挂 authRequired）
app.use('/api/chat', chatRoutes);

// P5 查询与审核路由（路由内部已挂 authRequired + 角色校验）
app.use('/api/entries', entriesRoutes);
app.use('/api/review', reviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stats', statsRoutes);

// 兜底：未匹配的 /api/* 路由返回 404
app.use('/api/*', (req, res) => {
  sendError(res, errors.NOT_FOUND, '接口不存在');
});

// 前端 SPA 兜底：非 /api 路由返回 index.html（供前端路由使用）
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) {
      sendError(res, errors.NOT_FOUND, '资源不存在');
    }
  });
});

// ---------- 全局错误处理 ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  if (err.type === 'entity.parse.failed') {
    return sendError(res, errors.VALIDATION_ERROR, '请求体 JSON 格式错误');
  }
  sendError(res, errors.INTERNAL_ERROR, err.message || '服务器内部错误');
});

// ---------- 启动服务 ----------
app.listen(config.port, () => {
  console.log(`[kb-server] 服务已启动，监听端口 ${config.port}`);
  console.log(`[kb-server] 前端访问: http://localhost:${config.port}`);
  console.log(`[kb-server] 健康检查: http://localhost:${config.port}/api/health`);
});

module.exports = app;
