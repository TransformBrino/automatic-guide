/**
 * config.js — 配置管理模块
 * 职责：从 process.env 读取环境变量，导出配置对象；
 *       对缺失的必填变量抛出明确错误。
 */

require('dotenv').config();

// 必填环境变量清单
const REQUIRED_VARS = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'AI_API_URL',
  'AI_API_KEY',
  'AI_MODEL',
  'JWT_SECRET',
];

// 校验必填变量，缺失则抛出明确错误
const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(
    `缺少必填环境变量: ${missing.join(', ')}。请检查 .env 文件是否配置完整（参考 .env.example）。`
  );
}

const config = {
  // 数据库
  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  // AI API
  ai: {
    apiUrl: process.env.AI_API_URL,
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
    timeoutMs: 30000, // 30 秒超时
    maxRetries: 1, // 最多重试 1 次
    enableWebSearch: process.env.ENABLE_WEB_SEARCH === 'true' || false,
    enableThinking: process.env.ENABLE_THINKING === 'true' || false,
    // Embedding API 端点（可选），不配置时从 apiUrl 自动推导
    embeddingApiUrl: process.env.EMBEDDING_API_URL || '',
    // Embedding API Key（可选），不配置时复用 apiKey
    embeddingApiKey: process.env.EMBEDDING_API_KEY || '',
    // Embedding 模型（可选），不配置时按候选列表自动探测
    embeddingModel: process.env.EMBEDDING_MODEL || '',
    // 候选模型列表（启动探测用，可通过逗号分隔的环境变量覆盖）
    embeddingModelCandidates: (process.env.EMBEDDING_MODEL_CANDIDATES || 'deepseek-embedding,text-embedding-3-small').split(','),
  },
  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '8h',
  },
  // 服务
  port: parseInt(process.env.PORT, 10) || 3000,
  sessionTimeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) || 30,
};

module.exports = config;
