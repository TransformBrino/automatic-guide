/**
 * scripts/debug-chat.js — 调试 AI 回复内容
 * 用途：查看 AI 生成的完整回复（含 SQL），诊断占位符使用情况
 * 运行：node scripts/debug-chat.js
 */

const promptBuilder = require('../services/prompt-builder');
const ai = require('../services/ai');

async function main() {
  const history = [];
  // 模拟第一轮追问后的上下文
  history.push({ role: 'user', content: '昨天 AGV-007 在仓库 A 报故障，无法启动' });
  history.push({
    role: 'assistant',
    content:
      '我需要了解更多信息才能录入这条知识：\n1. 故障的具体现象是什么？\n2. 排查过程用了哪些方法或命令？\n3. 最终的根因是什么？',
  });

  const newMessage =
    '场景是仓库A，严重程度一般。故障现象：AGV-007 上电后指示灯红灯常亮，按启动按钮无响应。排查过程：检查电池电压48V正常，检查急停按钮已释放，用诊断工具读取控制器日志发现通讯模块报错。根因：通讯模块固件损坏，重新刷写固件后恢复。';

  const messages = promptBuilder.buildMessages(history, newMessage);

  console.log('=== 调用 AI ===');
  const { replyText, sqlStatements } = await ai.callAI(messages);

  console.log('\n=== AI 完整回复 ===');
  console.log(replyText);

  console.log('\n=== 提取的 SQL 语句 ===');
  console.log('数量:', sqlStatements.length);
  for (let i = 0; i < sqlStatements.length; i++) {
    console.log(`\n--- SQL #${i + 1} ---`);
    console.log(sqlStatements[i]);
  }

  console.log('\n=== 占位符检查 ===');
  for (let i = 0; i < sqlStatements.length; i++) {
    const sql = sqlStatements[i];
    console.log(`SQL #${i + 1}:`);
    console.log('  含 __ENTRY_CODE__:', sql.includes('__ENTRY_CODE__'));
    console.log('  含 __CREATED_BY__:', sql.includes('__CREATED_BY__'));
    console.log('  含 entry_code 字段:', /entry_code/i.test(sql));
  }
}

main().catch((err) => {
  console.error('调试失败:', err.message);
  process.exit(1);
});
