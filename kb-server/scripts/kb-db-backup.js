/**
 * kb-db-backup.js — 知识库数据库定时备份脚本
 * 用法: node scripts/kb-db-backup.js
 * 建议配合 cron / Windows Task Scheduler 定时执行
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'kb_db';

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);

function log(msg) { console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}`); }

log('=== kb_db 数据库备份开始 ===');

// 创建备份目录
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// 生成备份文件名
const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const backupFile = path.join(BACKUP_DIR, `kb_db_backup_${timestamp}.sql`);

// 查找 mysqldump
let mysqldump = 'mysqldump';
try { execSync(`"${mysqldump}" --version`, { stdio: 'ignore' }); } catch (_) {
  mysqldump = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe';
  try { execSync(`"${mysqldump}" --version`, { stdio: 'ignore' }); } catch (_2) {
    mysqldump = 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe';
  }
}

// 执行备份
try {
  const env = { ...process.env, MYSQL_PWD: DB_PASSWORD };
  const cmd = `"${mysqldump}" -h ${DB_HOST} -P ${DB_PORT} -u ${DB_USER} ` +
    `--single-transaction --routines --triggers --events ` +
    `--set-gtid-purged=OFF --default-character-set=utf8mb4 ` +
    `--result-file="${backupFile}" ${DB_NAME}`;
  
  log(`执行: mysqldump ${DB_NAME} → ${path.basename(backupFile)}`);
  execSync(cmd, { env, stdio: 'pipe', timeout: 60000 });
  
  const stats = fs.statSync(backupFile);
  log(`备份完成: ${path.basename(backupFile)} (${(stats.size / 1024).toFixed(1)} KB)`);
} catch (e) {
  log(`备份失败: ${e.message}`);
  process.exit(1);
}

// 清理过期备份
log(`清理超过 ${RETENTION_DAYS} 天的旧备份...`);
const cutoff = Date.now() - RETENTION_DAYS * 86400000;
const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('kb_db_backup_') && f.endsWith('.sql'));
let cleaned = 0;
for (const f of files) {
  const fp = path.join(BACKUP_DIR, f);
  if (fs.statSync(fp).mtimeMs < cutoff) {
    fs.unlinkSync(fp);
    cleaned++;
  }
}

const remaining = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('kb_db_backup_')).length;
log(`清理完成: 删除 ${cleaned} 个, 保留 ${remaining} 个`);
log('=== 备份任务完成 ===');
