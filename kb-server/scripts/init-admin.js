/**
 * scripts/init-admin.js — 初始管理员账号初始化
 * 职责：创建默认 admin 账号（幂等，重复执行不报错）
 * 使用：npm run init-admin
 * 默认账号：admin / admin123（首次登录后请修改密码）
 */

const bcrypt = require('bcrypt');
const pool = require('../db/connection');

const DEFAULT_USERNAME = 'admin';
const DEFAULT_DISPLAY_NAME = '系统管理员';
const DEFAULT_PASSWORD = 'admin123';
const DEFAULT_ROLE = 'admin';

async function initAdmin() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // 幂等插入：使用 INSERT ... ON DUPLICATE KEY UPDATE
  // 若 username 已存在，更新 display_name/role/password_hash/is_active，避免重复执行报错
  const [result] = await pool.execute(
    `INSERT INTO kb_users (username, display_name, role, password_hash, is_active)
     VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       role = VALUES(role),
       password_hash = VALUES(password_hash),
       is_active = 1`,
    [DEFAULT_USERNAME, DEFAULT_DISPLAY_NAME, DEFAULT_ROLE, passwordHash]
  );

  if (result.affectedRows === 1) {
    console.log('✓ 初始管理员账号创建成功');
  } else {
    console.log('✓ 管理员账号已存在，已重置为默认值');
  }
  console.log(`  用户名: ${DEFAULT_USERNAME}`);
  console.log(`  密码: ${DEFAULT_PASSWORD}`);
  console.log(`  角色: ${DEFAULT_ROLE}`);
  console.log('  ⚠ 请尽快登录并修改默认密码');
}

initAdmin()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('✗ 初始化失败:', err.message);
    process.exit(1);
  });
