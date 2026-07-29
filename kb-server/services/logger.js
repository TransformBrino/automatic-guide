/**
 * services/logger.js — 结构化日志（P9-T11：Winston）
 * 职责：
 *   - 开发环境 → 控制台彩色输出
 *   - 生产环境 → JSON 格式输出到 logs/app.log + 控制台
 *   - 支持 logger.info / warn / error 三级别
 *   - 所有调用点统一带 module 标签标识来源
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 确保 logs 目录存在（try-catch 防止权限不足等异常导致进程崩溃）
const logsDir = path.join(__dirname, '..', 'logs');
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (err) {
  console.error('创建 logs 目录失败（日志将仅输出到控制台）:', err.message);
}

const isProduction = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    isProduction
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, module, message, stack, ...meta }) => {
            const mod = module ? `[${module}]` : '';
            const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
            return `${timestamp} ${level} ${mod} ${message}${metaStr}`;
          }),
        ),
  ),
  transports: [
    // 控制台（所有环境）
    new winston.transports.Console(),
  ],
});

// 生产环境追加文件输出
if (isProduction) {
  logger.add(
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    }),
  );
}

/**
 * 创建带 module 标签的子 logger
 * @param {string} moduleName - 模块名（如 'chat', 'admin', 'auth'）
 * @returns {winston.Logger} 带 module 元数据的子 logger
 */
function createModuleLogger(moduleName) {
  return logger.child({ module: moduleName });
}

module.exports = { logger, createModuleLogger };
