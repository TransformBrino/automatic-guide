/**
 * scripts/test-ai-connection.js — AI API 连通性验证脚本
 * 职责：向 AI API 发送最小请求，验证连通性与凭据有效性。
 * 使用：npm run test-ai
 */

const config = require('../config');
const { callAI } = require('../services/ai');

async function testAIConnection() {
  console.log('=== AI API 连通性测试 ===');
  console.log(`API URL: ${config.ai.apiUrl}`);
  console.log(`Model:   ${config.ai.model}`);
  console.log(`Timeout: ${config.ai.timeoutMs}ms`);
  console.log('');

  const messages = [
    { role: 'system', content: '你是一个测试助手，只回复"pong"两个字。' },
    { role: 'user', content: 'ping' },
  ];

  console.log('发送请求中...');
  const start = Date.now();
  const { replyText, sqlStatements } = await callAI(messages);
  const elapsed = Date.now() - start;

  console.log('');
  console.log('✓ AI API 连通成功');
  console.log(`  耗时: ${elapsed}ms`);
  console.log(`  回复: ${replyText}`);
  console.log(`  SQL 语句数: ${sqlStatements.length}`);
  console.log('');
  console.log('=== 测试通过 ===');
}

testAIConnection()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('');
    console.error('✗ AI API 连通失败:', err.message);
    if (err.httpStatus) {
      console.error('  HTTP 状态:', err.httpStatus);
    }
    console.error('');
    console.error('=== 测试失败 ===');
    process.exit(1);
  });
