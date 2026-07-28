/**
 * services/entry-code.js — entry_code 生成器
 * 职责：生成格式为 KB-YYYYMMDD-NNN 的条目编码。
 * 对应框架文档第四章 4.2 entry_code 字段说明。
 *
 * 注意：应在事务内调用，传入事务连接 conn，避免并发冲突。
 * 唯一索引作为兜底，若并发冲突 INSERT 会失败。
 */

/**
 * 生成 entry_code
 * @param {object} conn - mysql2 连接对象（事务连接）
 * @returns {Promise<string>} 格式 KB-YYYYMMDD-NNN
 */
async function generateEntryCode(conn) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;
  const prefix = `KB-${dateStr}-`;

  // 查询当天已有的条目数
  const [rows] = await conn.execute(
    "SELECT COUNT(*) AS cnt FROM kb_entries WHERE entry_code LIKE ?",
    [`${prefix}%`]
  );
  const count = rows[0].cnt;
  const seq = String(count + 1).padStart(3, '0');

  return `${prefix}${seq}`;
}

module.exports = { generateEntryCode };
