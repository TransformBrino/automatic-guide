/**
 * test/sql-executor.test.js — SQL 安全执行器测试套件（系统安全红线）
 * 职责：验证 sql-executor.js 的 5 层安全校验，覆盖 P3-T5 全部 14 个验收用例。
 * 使用：npm run test-sql
 *
 * 测试分类：
 *   正向用例（应成功）：SELECT / INSERT / UPDATE / DELETE / JOIN 多表
 *   负向用例（应拒绝）：DDL / 非 kb_ 表 / 多语句 / GRANT / 事务回滚
 */

const { validateAndExecute } = require('../services/sql-executor');
const pool = require('../db/connection');

// 测试结果统计
let passed = 0;
let failed = 0;
const failures = [];

/**
 * 执行单个测试用例
 * @param {string} name - 用例名
 * @param {function} fn - 测试函数，返回 {expected: 'success'|'reject', actual, error?}
 */
async function test(name, fn) {
  try {
    const result = await fn();
    if (result.pass) {
      passed++;
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      failures.push({ name, detail: result.detail });
      console.log(`  ✗ ${name}  -- ${result.detail}`);
    }
  } catch (err) {
    failed++;
    failures.push({ name, detail: '异常: ' + err.message });
    console.log(`  ✗ ${name}  -- 异常: ${err.message}`);
  }
}

/**
 * 期望 SQL 执行成功
 */
async function expectSuccess(sqlStatements, userId = 1) {
  const r = await validateAndExecute(sqlStatements, userId);
  return {
    pass: r.success === true,
    detail: r.success ? '' : `期望成功但失败: ${r.error}`,
  };
}

/**
 * 期望 SQL 被拒绝
 */
async function expectReject(sqlStatements, userId = 1) {
  const r = await validateAndExecute(sqlStatements, userId);
  return {
    pass: r.success === false,
    detail: r.success ? '期望被拒绝但执行成功了' : `已拒绝: ${r.error}`,
  };
}

/**
 * 清理测试数据
 */
async function cleanup() {
  await pool.execute("DELETE FROM kb_entries WHERE entry_code LIKE 'KB-TEST-%'");
}

async function runTests() {
  console.log('=== SQL 安全执行器测试套件（14 个用例）===');
  console.log('');

  await cleanup();

  // ---------- 正向用例 ----------
  console.log('[正向用例 - 应成功]');

  // 用例 1：SELECT
  await test('1. SELECT * FROM kb_entries', () =>
    expectSuccess(['SELECT * FROM kb_entries LIMIT 1'])
  );

  // 用例 2：INSERT
  await test('2. INSERT INTO kb_entries', () =>
    expectSuccess([
      `INSERT INTO kb_entries (entry_code, title, knowledge_type, architecture_layer, summary, full_content, created_by)
       VALUES ('KB-TEST-001', '测试条目', 'fault_case', 'fault', '测试摘要', '# 测试内容', 'tester')`,
    ])
  );

  // 用例 3：UPDATE
  await test('3. UPDATE kb_entries', () =>
    expectSuccess([
      `UPDATE kb_entries SET title='测试条目-已更新' WHERE entry_code='KB-TEST-001'`,
    ])
  );

  // 用例 4：DELETE
  await test('4. DELETE FROM kb_entries', () =>
    expectSuccess([
      `DELETE FROM kb_entries WHERE entry_code='KB-TEST-001'`,
    ])
  );

  // 用例 14：JOIN 多张 kb_ 表
  await test('14. SELECT JOIN kb_entries + kb_tags', () =>
    expectSuccess([
      `SELECT a.id, a.title, b.tag_name FROM kb_entries a JOIN kb_tags b ON a.id=b.entry_id LIMIT 1`,
    ])
  );

  // ---------- 负向用例 ----------
  console.log('');
  console.log('[负向用例 - 应拒绝]');

  // 用例 5：DROP
  await test('5. DROP TABLE kb_entries', () =>
    expectReject(['DROP TABLE kb_entries'])
  );

  // 用例 6：ALTER
  await test('6. ALTER TABLE kb_entries ADD COLUMN x INT', () =>
    expectReject(['ALTER TABLE kb_entries ADD COLUMN x INT'])
  );

  // 用例 7：TRUNCATE
  await test('7. TRUNCATE TABLE kb_entries', () =>
    expectReject(['TRUNCATE TABLE kb_entries'])
  );

  // 用例 8：CREATE
  await test('8. CREATE TABLE kb_xxx', () =>
    expectReject(['CREATE TABLE kb_xxx (id INT)'])
  );

  // 用例 9：非 kb_ 表
  await test('9. SELECT * FROM mysql.user', () =>
    expectReject(['SELECT * FROM mysql.user'])
  );

  // 用例 10：多语句（分号分隔，含 DROP）
  await test('10. SELECT; DROP TABLE（多语句）', () =>
    expectReject(['SELECT * FROM kb_entries; DROP TABLE kb_users'])
  );

  // 用例 11：多语句（两条 INSERT）
  await test('11. INSERT; INSERT（多语句）', () =>
    expectReject([
      `INSERT INTO kb_entries (entry_code, title, knowledge_type, architecture_layer, summary, full_content, created_by) VALUES ('KB-TEST-002','t','fault_case','fault','s','c','u'); INSERT INTO kb_users (username, display_name, password_hash) VALUES ('hacker','h','x')`,
    ])
  );

  // 用例 12：GRANT
  await test('12. GRANT ALL ON *.*', () =>
    expectReject(["GRANT ALL ON *.* TO 'hacker'@'%'"])
  );

  // 用例 13：事务回滚（第一条合法，第二条失败）
  await test('13. 事务回滚（第二条 SQL 失败，第一条回滚）', async () => {
    // 第一条：合法 INSERT
    // 第二条：INSERT 重复 entry_code（违反 UNIQUE 约束）→ 失败 → 第一条应回滚
    const r = await validateAndExecute(
      [
        `INSERT INTO kb_entries (entry_code, title, knowledge_type, architecture_layer, summary, full_content, created_by)
         VALUES ('KB-TEST-013', '回滚测试', 'fault_case', 'fault', '摘要', '内容', 'tester')`,
        `INSERT INTO kb_entries (entry_code, title, knowledge_type, architecture_layer, summary, full_content, created_by)
         VALUES ('KB-TEST-013', '重复', 'fault_case', 'fault', '摘要', '内容', 'tester')`,
      ],
      1
    );
    if (r.success) {
      return { pass: false, detail: '期望失败但两条 SQL 都成功了' };
    }
    // 验证第一条也被回滚：查询 KB-TEST-013 不应存在
    const [rows] = await pool.execute(
      "SELECT id FROM kb_entries WHERE entry_code='KB-TEST-013'"
    );
    return {
      pass: rows.length === 0,
      detail:
        rows.length === 0
          ? '已回滚，KB-TEST-013 不存在'
          : `回滚失败，KB-TEST-013 仍存在 (${rows.length} 条)`,
    };
  });

  // ---------- 清理与汇总 ----------
  await cleanup();

  console.log('');
  console.log('=== 测试汇总 ===');
  console.log(`通过: ${passed} / ${passed + failed}`);
  console.log(`失败: ${failed} / ${passed + failed}`);
  if (failures.length > 0) {
    console.log('');
    console.log('失败用例:');
    failures.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  }
  console.log('');
  if (failed > 0) {
    console.log('✗ 测试未全部通过，存在安全风险！');
    process.exit(1);
  } else {
    console.log('✓ 全部测试通过，SQL 安全执行器校验有效。');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
