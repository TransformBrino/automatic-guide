/**
 * test/debug-p5.js — 快速调试 P5 路由问题
 */
const pool = require('../db/connection');

async function main() {
  // 测试 1: 简单查询
  console.log('测试 1: 查询存在的条目 (id=1)');
  try {
    const [rows] = await pool.execute('SELECT id, entry_code, title FROM kb_entries WHERE id = ? LIMIT 1', [1]);
    console.log('  结果:', rows.length, '行');
    if (rows.length > 0) console.log('  ', rows[0]);
  } catch (e) {
    console.log('  错误:', e.message);
  }

  // 测试 2: 查询不存在的条目
  console.log('\n测试 2: 查询不存在的条目 (id=999999)');
  try {
    const [rows] = await pool.execute('SELECT id, entry_code, title FROM kb_entries WHERE id = ? LIMIT 1', [999999]);
    console.log('  结果:', rows.length, '行');
  } catch (e) {
    console.log('  错误:', e.message);
  }

  // 测试 3: 完整详情查询（同 entries.js）
  console.log('\n测试 3: 完整详情查询');
  try {
    const [rows] = await pool.execute(
      `SELECT id, entry_code, title, knowledge_type, architecture_layer, scene,
              severity, summary, full_content, raw_input,
              score_completeness, score_accuracy, score_timeliness,
              score_operability, score_reusability, score_traceability, score_total,
              major_version, minor_version, patch_version, version_label,
              status, reviewer_id, reviewed_at, review_comment,
              next_review_date, review_cycle,
              created_by, updated_by, created_at, updated_at
       FROM kb_entries WHERE id = ? LIMIT 1`,
      [999999]
    );
    console.log('  结果:', rows.length, '行');
  } catch (e) {
    console.log('  错误:', e.message);
    console.log('  堆栈:', e.stack?.split('\n').slice(0, 3).join('\n    '));
  }

  // 测试 4: 列表查询（同 entries.js）
  console.log('\n测试 4: 列表查询');
  try {
    const [countRows] = await pool.execute('SELECT COUNT(*) AS total FROM kb_entries');
    console.log('  总数:', countRows[0].total);

    const [rows] = await pool.execute(
      `SELECT id, entry_code, title, knowledge_type, architecture_layer, scene,
              severity, summary, status, score_total, version_label,
              created_by, reviewer_id, created_at, updated_at, reviewed_at
       FROM kb_entries
       ORDER BY created_at DESC
       LIMIT 20 OFFSET 0`
    );
    console.log('  列表:', rows.length, '行');
  } catch (e) {
    console.log('  错误:', e.message);
    console.log('  堆栈:', e.stack?.split('\n').slice(0, 3).join('\n    '));
  }

  // 测试 5: 审核路由 - 检查条目状态
  console.log('\n测试 5: 审核路由查询');
  try {
    const [rows] = await pool.execute(
      `SELECT id, entry_code, title, knowledge_type, scene, summary, created_by, updated_at
       FROM kb_entries
       WHERE status = 'pending_review'
       ORDER BY updated_at DESC
       LIMIT 20 OFFSET 0`
    );
    console.log('  待审核:', rows.length, '行');
  } catch (e) {
    console.log('  错误:', e.message);
  }

  // 测试 6: 按 status 筛选
  console.log('\n测试 6: 按 status 筛选');
  try {
    const [rows] = await pool.execute(
      `SELECT id, entry_code, title, status FROM kb_entries WHERE status = ? LIMIT 20`,
      ['approved']
    );
    console.log('  approved:', rows.length, '行');
  } catch (e) {
    console.log('  错误:', e.message);
  }

  // 测试 7: MATCH AGAINST 查询
  console.log('\n测试 7: MATCH AGAINST 全文搜索');
  try {
    const [rows] = await pool.execute(
      `SELECT id, title FROM kb_entries WHERE MATCH(title, summary, full_content) AGAINST(? IN NATURAL LANGUAGE MODE) LIMIT 10`,
      ['AGV']
    );
    console.log('  结果:', rows.length, '行');
  } catch (e) {
    console.log('  错误:', e.message);
  }

  pool.end();
}

main().catch(console.error);
