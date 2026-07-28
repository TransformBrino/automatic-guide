/**
 * db/connection.js — MySQL 连接池
 * 职责：使用 mysql2/promise 创建连接池，导出 pool 对象。
 * 配置：connectionLimit 10、waitForConnections true、charset utf8mb4。
 */

const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

// 自测：仅在直接运行本文件时执行连通性检查
if (require.main === module) {
  (async () => {
    try {
      const [rows] = await pool.execute('SELECT 1 AS result');
      console.log('DB connection OK:', rows[0]);
      process.exit(0);
    } catch (err) {
      console.error('DB connection FAILED:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = pool;
