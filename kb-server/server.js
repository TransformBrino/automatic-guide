/**
 * server.js — 应用入口
 * 职责：加载配置、创建 Express 实例、注册中间件、挂载路由、启动服务。
 * 对应框架文档第三章 3.2 server.js 职责说明。
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const config = require('./config');
const pool = require('./db/connection');
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

// 安全响应头（P9-T4：Helmet）
// 内网部署，放宽 CSP 以兼容 marked.js CDN
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // 允许加载 CDN 资源
}));

// HTTP 请求日志（P9-T9：Morgan）
// 生产环境输出到文件，开发环境输出到控制台
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const accessLogStream = fs.createWriteStream(
  path.join(logsDir, 'access.log'),
  { flags: 'a' }
);
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined', { stream: accessLogStream }));
} else {
  app.use(morgan('dev'));
}

app.use(express.json({ limit: '1mb' })); // 解析 JSON 请求体
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // P9-T22：JWT httpOnly Cookie 支持

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

// 健康检查（P9-T6 增强：验证 DB + AI API 连通性）
app.get('/api/health', async (req, res) => {
  const result = { db: 'pending', ai: 'pending' };
  let healthy = true;

  // DB 连通性探测（3 秒超时）
  try {
    const dbPromise = pool.execute('SELECT 1');
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 3000)
    );
    await Promise.race([dbPromise, timeout]);
    result.db = 'ok';
  } catch (e) {
    result.db = 'error';
    healthy = false;
  }

  // AI API 连通性探测（3 秒超时，失败不影响全局 healthy）
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const aiResp = await fetch(config.ai.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    result.ai = aiResp.ok ? 'ok' : 'error';
  } catch (e) {
    result.ai = 'error';
    // AI 不可用不改变 overall healthy（AI 是可选依赖）
  }

  const statusCode = healthy ? 200 : 503;
  res.status(statusCode).json({
    success: true,
    data: { status: healthy ? 'ok' : 'degraded', time: new Date().toISOString(), components: result },
    message: '',
  });
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
  // P9-T3：生产环境隐藏内部错误细节
  const msg = process.env.NODE_ENV === 'production'
    ? '服务器内部错误'
    : (err.message || '服务器内部错误');
  sendError(res, errors.INTERNAL_ERROR, msg);
});

// ---------- 启动服务 ----------
const server = app.listen(config.port, () => {
  console.log(`[kb-server] 服务已启动，监听端口 ${config.port}`);
  console.log(`[kb-server] 前端访问: http://localhost:${config.port}`);
  console.log(`[kb-server] 健康检查: http://localhost:${config.port}/api/health`);
});

// ---------- 优雅关闭（P9-T15：Graceful Shutdown） ----------
let shuttingDown = false;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[kb-server] 收到 ${signal} 信号，开始优雅关闭...`);

  // 1. 停止接收新请求
  server.close(() => {
    console.log('[kb-server] HTTP 服务已关闭');
  });

  // 2. 设置强制退出超时（10 秒后仍未完成则强制退出）
  const forceExit = setTimeout(() => {
    console.error('[kb-server] 优雅关闭超时，强制退出');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  // 3. 释放数据库连接池
  pool.end()
    .then(() => {
      console.log('[kb-server] 数据库连接池已释放');
      clearTimeout(forceExit);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[kb-server] 关闭连接池失败:', err.message);
      clearTimeout(forceExit);
      process.exit(1);
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
