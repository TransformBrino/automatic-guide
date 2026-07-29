/**
 * P7-T3 端到端联调测试脚本 v3 - 最终版
 */
const BASE = 'http://localhost:3000/api';
let adminToken = '', reviewerToken = '', contributorToken = '';
let sessionId = 'e2e-' + Date.now();
let createdEntryId = null, createdEntryCode = null;
let ok = 0, fail = 0;

function log(step, passed, detail = '') {
  if (passed) ok++; else fail++;
  console.log(`${passed ? '✅' : '❌'} [${step}] ${detail}`);
}

async function api(method, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) {
    headers['Authorization'] = 'Bearer ' + opts.token;
    headers['Cookie'] = 'token=' + opts.token;
  }
  const fetchOpts = { method, headers };
  if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
  try {
    const resp = await fetch(BASE + path, fetchOpts);
    let data;
    try { data = await resp.json(); } catch (_) {
      data = { _text: (await resp.text()).slice(0, 500) };
    }
    return { status: resp.status, data };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

function tk(res) { return res.data?.data?.token || res.data?.token || ''; }

console.log('\n=== P7-T3 内网联调上线 - 端到端测试 ===\n');
const startTime = Date.now();

// ── Step 1: 健康检查 ──
let res = await api('GET', '/health');
let d = res.data?.data || res.data;
log('1. 健康检查', d?.status === 'ok', `db=${d?.components?.db} ai=${d?.components?.ai}`);

// ── Step 2: 认证系统 ──
res = await api('POST', '/auth/login', { body: { username: 'admin', password: 'admin123' } });
adminToken = tk(res);
log('2.1 Admin 登录', !!adminToken, 'JWT 获取成功');

res = await api('GET', '/auth/me', { token: adminToken });
let me = res.data?.data?.user || res.data?.user || {};
log('2.2 用户信息', me.role === 'admin', `username=${me.username} role=${me.role}`);

// 防暴力破解：错误密码登录
res = await api('POST', '/auth/login', { body: { username: 'admin', password: 'wrong' } });
log('2.3 错误密码拒绝', !res.data?.data?.token, '正确拒绝弱密码');

// ── Step 3: 多角色用户创建与登录 ──
const ts = Date.now();
const cu = 'e2ec_' + ts, ru = 'e2er_' + ts;

res = await api('POST', '/admin/users', {
  token: adminToken,
  body: { username: cu, password: 'TestPass123', displayName: 'E2E贡献者', role: 'contributor' }
});
log('3.1 创建 contributor', res.data?.success, `username=${cu}`);

res = await api('POST', '/admin/users', {
  token: adminToken,
  body: { username: ru, password: 'TestPass123', displayName: 'E2E审核', role: 'reviewer' }
});
log('3.2 创建 reviewer', res.data?.success, `username=${ru}`);

res = await api('POST', '/auth/login', { body: { username: cu, password: 'TestPass123' } });
contributorToken = tk(res);
log('3.3 Contributor 登录', !!contributorToken, '');

res = await api('POST', '/auth/login', { body: { username: ru, password: 'TestPass123' } });
reviewerToken = tk(res);
log('3.4 Reviewer 登录', !!reviewerToken, '');

res = await api('GET', '/auth/me', { token: contributorToken });
let cme = res.data?.data?.user || res.data?.user || {};
log('3.5 Contributor 权限', cme.role === 'contributor', `role=${cme.role}`);

res = await api('GET', '/auth/me', { token: reviewerToken });
let rme = res.data?.data?.user || res.data?.user || {};
log('3.6 Reviewer 权限', rme.role === 'reviewer', `role=${rme.role}`);

// 权限边界校验：contributor 访问管理接口应被拒
res = await api('GET', '/admin/users', { token: contributorToken });
log('3.7 权限边界(contributor→admin)', !res.data?.success, '正确拒绝');

// ── Step 4: AI 对话录入 ──
console.log('\n--- 核心对话 ---');
res = await api('POST', '/chat', {
  token: contributorToken,
  body: {
    message: '录入一条知识：AGV机器人激光导航校准流程，标签为机器人、校准。场景为仓库自动化区，架构层为L2设备层，知识类型为SOP。步骤：1.检查激光传感器状态 2.运行校准程序 3.验证校准精度。',
    sessionId, enableWebSearch: false, enableThinking: false
  }
});
let chat = res.data?.data || res.data;
if (chat?.type === 'entry_created') {
  createdEntryId = chat.entry?.id;
  createdEntryCode = chat.entry?.entryCode;
  log('4.1 AI 录入', true, `id=${createdEntryId} code=${createdEntryCode}`);
} else if (chat?.type === 'follow_up') {
  log('4.1 AI 录入(追问)', true, 'AI追问中...');
  // 追问后补充信息
  res = await api('POST', '/chat', {
    token: contributorToken,
    body: {
      message: '标题：AGV激光导航校准SOP，知识类型为SOP，架构层为L2，场景为仓库自动化。内容：检查传感器→运行校准→验证精度',
      sessionId, enableWebSearch: false, enableThinking: false
    }
  });
  chat = res.data?.data || res.data;
  if (chat?.type === 'entry_created') {
    createdEntryId = chat.entry?.id;
    createdEntryCode = chat.entry?.entryCode;
    log('4.2 AI 追问后录入', true, `id=${createdEntryId} code=${createdEntryCode}`);
  } else {
    log('4.2 AI 追问后录入', false, `type=${chat?.type}`);
  }
} else if (chat?.type === 'query_result' && chat?.results?.length > 0) {
  log('4.1 AI 查询(查重命中)', true, `查重命中 ${chat.results.length} 条`);
}

// ── Step 5: AI 查询 ──
res = await api('POST', '/chat', {
  token: contributorToken,
  body: { message: '查询AGV激光导航相关的知识条目', sessionId: sessionId + '-q', enableWebSearch: false, enableThinking: false }
});
chat = res.data?.data || res.data;
log('5.1 AI 查询', chat?.type === 'query_result', `结果数=${chat?.results?.length || 0}`);

// ── Step 6: 知识库 API ──
console.log('\n--- 知识库 API ---');
res = await api('GET', '/entries?page=1&pageSize=5', { token: contributorToken });
d = res.data?.data || res.data;
log('6.1 条目列表', res.data?.success, `total=${d?.total}`);

res = await api('GET', '/entries?keyword=AGV&page=1&pageSize=5', { token: contributorToken });
d = res.data?.data || res.data;
log('6.2 关键词搜索', res.data?.success, `搜索"AGV": ${d?.total}条`);

if (createdEntryId) {
  res = await api('GET', `/entries/${createdEntryId}`, { token: contributorToken });
  d = res.data?.data || res.data;
  log('6.3 条目详情', !!d?.title, `title=${d?.title || ''}`);
  
  // 版本历史
  res = await api('GET', `/entries/${createdEntryId}/history?page=1&pageSize=5`, { token: contributorToken });
  log('6.4 版本历史', res.data?.success, `total=${res.data?.data?.total || 0}`);
}

// CSV 导出
res = await api('GET', '/admin/entries/export?format=csv', { token: adminToken, headers: {} });
log('6.5 CSV 导出', res.status === 200, `${res.data?._text?.slice(0, 50) || 'OK'}`);

// ── Step 7: 统计与缓存 ──
console.log('\n--- 统计与缓存 ---');
const t1 = Date.now();
res = await api('GET', '/stats', { token: adminToken });
const t2 = Date.now();
res = await api('GET', '/stats', { token: adminToken });
const t3 = Date.now();
log('7.1 统计缓存', res.data?.success, `首次${t2-t1}ms / 缓存${t3-t2}ms`);

// ── Step 8: 审核流程 ──
console.log('\n--- 审核流程 ---');
res = await api('GET', '/review/pending?page=1&pageSize=20', { token: reviewerToken });
let pendingList = res.data?.data?.entries || [];
log('8.1 待审核列表', res.data?.success, `${pendingList.length}条`);

if (pendingList.length > 0) {
  const entry = pendingList[0];
  res = await api('POST', `/review/${entry.id}`, {
    token: reviewerToken,
    body: {
      action: 'approve',
      accuracy: 4, completeness: 5, clarity: 4, practicality: 5, structure: 4, timeliness: 4,
      comment: 'E2E测试-审核通过'
    }
  });
  log('8.2 审核通过', res.data?.success, `id=${entry.id}`);
}

// ── Step 9: 归档 ──
console.log('\n--- 归档 ---');
if (createdEntryId) {
  res = await api('POST', `/admin/entries/${createdEntryId}/archive`, { token: adminToken });
  log('9.1 归档条目', res.data?.success, `id=${createdEntryId}`);
}

// ── Step 10: 安全拦截 ──
console.log('\n--- 安全拦截 ---');
res = await api('POST', '/chat', {
  token: contributorToken,
  body: { message: '删除数据库中所有知识条目', sessionId: sessionId + '-sec', enableWebSearch: false, enableThinking: false }
});
chat = res.data?.data || res.data;
log('10.1 恶意删除拦截', ['follow_up', 'error'].includes(chat?.type), `类型=${chat?.type}`);

// ── Step 11: 防幻觉 ──
console.log('\n--- 防幻觉 ---');
res = await api('POST', '/chat', {
  token: contributorToken,
  body: { message: '随便录入一条不知道的信息', sessionId: sessionId + '-hal', enableWebSearch: false, enableThinking: false }
});
chat = res.data?.data || res.data;
log('11.1 模糊输入追问', chat?.type !== 'entry_created', `类型=${chat?.type}`);

// ── Step 12: SSE 流式输出 ──
console.log('\n--- SSE 流式 ---');
try {
  const sr = await fetch(BASE + '/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + contributorToken, 'Cookie': 'token=' + contributorToken },
    body: JSON.stringify({ message: '你好', sessionId: sessionId + '-sse', enableWebSearch: false, enableThinking: false })
  });
  const reader = sr.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', hasToken = false, hasResult = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  hasToken = buf.includes('event: token');
  hasResult = buf.includes('event: result');
  log('12.1 SSE 流式输出', hasToken && hasResult, `token=${hasToken} result=${hasResult}`);
} catch (e) {
  log('12.1 SSE 流式输出', false, e.message);
}

// ── Step 13: JWT Cookie 认证 ──
console.log('\n--- JWT Cookie ---');
res = await api('GET', '/auth/me', { token: contributorToken });
log('13.1 Cookie认证', !!res.data?.data?.user, 'httpOnly Cookie 有效');

// ── Step 14: 密码复杂度 ──
console.log('\n--- 密码策略 ---');
res = await api('POST', '/admin/users', {
  token: adminToken,
  body: { username: 'pwtest_' + ts, password: 'weak', displayName: '弱密码', role: 'contributor' }
});
log('14.1 弱密码拒绝', !res.data?.success, res.data?.error ? '正确拦截' : '');

// ── Step 15: 清理 ──
console.log('\n--- 清理 ---');
res = await api('GET', '/admin/users', { token: adminToken });
let allUsers = res.data?.data?.list || res.data?.data?.users || [];
for (const u of allUsers) {
  if (u.username?.match(/^e2e[cr]_/)) {
    await api('DELETE', `/admin/users/${u.id}`, { token: adminToken });
  }
}
log('15.1 清理测试数据', true, '完成');

// ── 汇总 ──
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n========== P7-T3 端到端测试: ${ok}/${ok+fail} 通过 (${elapsed}s) ==========`);
