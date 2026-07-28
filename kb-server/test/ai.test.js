/**
 * test/ai.test.js — AI 服务测试套件
 * 职责：验证 ai.js 中 SQL 提取逻辑的正确性
 * 重点：验证 extractSqlStatements 多次调用时不会因 lastIndex 残留导致漏匹配
 * 使用：node test/ai.test.js
 */

const { extractSqlStatements } = require('../services/ai');

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}  -- ${detail}`);
  }
}

// 测试 1：单次调用提取多个 SQL 块
console.log('测试 1：单次调用提取多个 SQL 块');
{
  const text = `AI 回复内容：\n\`\`\`sql\nSELECT * FROM kb_users;\n\`\`\`\n中间文字\n\`\`\`sql\nINSERT INTO kb_articles (title) VALUES ('test');\n\`\`\`\n结尾`;
  const result = extractSqlStatements(text);
  assert('应提取出 2 条 SQL', result.length === 2, `期望 2 条，实际 ${result.length} 条`);
  if (result.length >= 2) {
    assert('第 1 条为 SELECT', result[0].includes('SELECT'), `内容: ${result[0]}`);
    assert('第 2 条为 INSERT', result[1].includes('INSERT'), `内容: ${result[1]}`);
  }
}

// 测试 2：连续多次调用（验证 lastIndex 不残留）
console.log('\n测试 2：连续多次调用相同输入（验证 lastIndex 无残留）');
{
  const text = `\`\`\`sql\nSELECT 1;\n\`\`\`\n\`\`\`sql\nSELECT 2;\n\`\`\`\n\`\`\`sql\nSELECT 3;\n\`\`\``;
  const firstCall = extractSqlStatements(text);
  const secondCall = extractSqlStatements(text);
  const thirdCall = extractSqlStatements(text);

  assert('首次调用应提取 3 条', firstCall.length === 3, `实际 ${firstCall.length}`);
  assert('第二次调用应提取 3 条', secondCall.length === 3, `实际 ${secondCall.length}`);
  assert('第三次调用应提取 3 条', thirdCall.length === 3, `实际 ${thirdCall.length}`);

  // 三次调用结果应完全一致
  const allMatch =
    firstCall.length === secondCall.length &&
    secondCall.length === thirdCall.length &&
    firstCall.every((s, i) => s === secondCall[i] && s === thirdCall[i]);
  assert('三次调用结果完全一致', allMatch, '结果存在差异，lastIndex 可能残留');
}

// 测试 3：提取混合 SQL（多种语句类型）
console.log('\n测试 3：混合 SQL 提取');
{
  const text = `根据用户需求，我建议执行以下操作：\n\n\`\`\`sql\nSELECT * FROM kb_knowledge WHERE id = 1;\n\`\`\`\n\n然后更新状态：\n\n\`\`\`sql\nUPDATE kb_knowledge SET status = 'reviewed' WHERE id = 1;\n\`\`\`\n\n同时添加日志：\n\n\`\`\`sql\nINSERT INTO kb_logs (action, target) VALUES ('review', 'kb_knowledge:1');\n\`\`\``;
  const result = extractSqlStatements(text);
  assert('混合 SQL 应提取 3 条', result.length === 3, `实际 ${result.length}`);
  assert('第 1 条为 SELECT', result[0].startsWith('SELECT'), result[0]);
  assert('第 2 条为 UPDATE', result[1].startsWith('UPDATE'), result[1]);
  assert('第 3 条为 INSERT', result[2].startsWith('INSERT'), result[2]);
}

// 测试 4：空输入与边界情况
console.log('\n测试 4：边界情况');
{
  assert('空字符串返回空数组', extractSqlStatements('').length === 0, '');
  assert('无 SQL 代码块返回空数组', extractSqlStatements('普通文字').length === 0, '');
  assert('只有起始标记无结束标记返回空数组', extractSqlStatements('```sql\nSELECT 1;').length === 0, '');
  // 仅有一对 SQL 块
  const single = extractSqlStatements('```sql\nSELECT 1;\n```');
  assert('单个 SQL 块正常提取', single.length === 1 && single[0] === 'SELECT 1;', `结果: ${JSON.stringify(single)}`);
}

// 测试 5：验证原问题（使用全局 g 标志的正则在循环中调用会失败）
console.log('\n测试 5：模拟原问题验证（对照测试）');
{
  // 原问题：模块级带 g 标志的正则被跨多次调用复用
  const BAD_REGEX = /```sql\s*([\s\S]*?)```/gi;
  const text1 = '```sql\nSELECT 1;\n```';
  const text2 = '```sql\nSELECT 2;\n```\n```sql\nSELECT 3;\n```';

  // 第一次调用处理 text1（单个 SQL 块）
  const first = [];
  let m;
  while ((m = BAD_REGEX.exec(text1)) !== null) {
    first.push(m[1].trim());
  }

  // 第二次调用处理 text2（两个 SQL 块）——但 lastIndex 已前进
  const second = [];
  while ((m = BAD_REGEX.exec(text2)) !== null) {
    second.push(m[1].trim());
  }

  console.log(`  ℹ️  原问题验证：text1 提取 ${first.length} 条，text2 提取 ${second.length} 条（期望 2 条）`);

  // 新实现应该每次都正确
  const newFirst = extractSqlStatements(text1);
  const newSecond = extractSqlStatements(text2);
  assert('新实现 text1 提取 1 条', newFirst.length === 1, `实际 ${newFirst.length}`);
  assert('新实现 text2 提取 2 条', newSecond.length === 2, `实际 ${newSecond.length}`);
  assert('新实现正确处理了多次调用', newFirst.length === 1 && newSecond.length === 2, '');
}

// 汇总
console.log(`\n${'='.repeat(50)}`);
console.log(`测试汇总：${passed} 通过 / ${failed} 失败`);
if (failures.length > 0) {
  console.log('失败用例：');
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  process.exit(1);
} else {
  console.log('所有测试通过！');
  process.exit(0);
}
