/**
 * test/p5-integration.test.js — P5 阶段集成测试
 * 职责：验证 P5-T1 ~ P5-T4 所有接口功能
 * 使用：node test/p5-integration.test.js
 */

const BASE_URL = 'http://localhost:3000/api';

// 动态加载数据库连接（兼容 ESM 检测）
let _pool = null;
async function getPool() {
  if (!_pool) {
    _pool = (await import('../db/connection.js')).default;
  }
  return _pool;
}

let passed = 0;
let failed = 0;
const failures = [];

// 辅助：发送请求
async function req(method, path, body = null, token = null) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const resp = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

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

// ============================================================
// 步骤 0：登录获取 token
// ============================================================
console.log('\n=== 步骤 0：登录 ===');
let adminToken = null;
let adminUser = null;
{
  const { status, data } = await req('POST', '/auth/login', {
    username: 'admin',
    password: 'admin123',
  });
  assert('管理员登录成功', status === 200 && data.success, `status=${status}, ${JSON.stringify(data)}`);
  if (data.success) {
    adminToken = data.data.token;
    adminUser = data.data.user;
    console.log(`  ℹ️  管理员用户: ${adminUser.username}, 角色: ${adminUser.role}`);
  } else {
    console.log('  ⚠️  登录失败，终止测试');
    process.exit(1);
  }
}

// ============================================================
// P5-T1: entries 查询路由
// ============================================================
console.log('\n=== P5-T1: entries 查询路由 ===');

// GET /api/entries — 空参数分页
{
  const { status, data } = await req('GET', '/entries', null, adminToken);
  assert('GET /api/entries 返回 200', status === 200, `status=${status}`);
  assert('响应含 entries 数组', data.success && Array.isArray(data.data.entries), JSON.stringify(data));
  assert('响应含 total', data.success && typeof data.data.total === 'number', `total=${data.data.total}`);
  assert('响应含 page/limit', data.success && data.data.page && data.data.limit, '');
  console.log(`  ℹ️  当前共 ${data.data.total} 条知识条目`);
}

// GET /api/entries?page=1&limit=5
{
  const { status, data } = await req('GET', '/entries?page=1&limit=5', null, adminToken);
  assert('分页查询成功', status === 200 && data.success, `status=${status}`);
  if (data.success) {
    assert('分页 limit=5 生效', data.data.entries.length <= 5, `返回 ${data.data.entries.length} 条`);
    assert('page=1 返回 page=1', data.data.page === 1, `page=${data.data.page}`);
  }
}

// GET /api/entries/:id — 详情
{
  // 先获取一个有效 ID
  const { data: listData } = await req('GET', '/entries?limit=1', null, adminToken);
  if (listData.success && listData.data.entries.length > 0) {
    const testId = listData.data.entries[0].id;
    const { status, data } = await req('GET', `/entries/${testId}`, null, adminToken);
    assert('GET /entries/:id 返回 200', status === 200, `status=${status}`);
    assert('响应含 entry', data.success && data.data.entry, '');
    assert('响应含 tags 数组', data.success && Array.isArray(data.data.tags), '');
    assert('响应含 versions 数组', data.success && Array.isArray(data.data.versions), '');

    // 详情字段验证
    if (data.success && data.data.entry) {
      const e = data.data.entry;
      assert('条目含 id', e.id !== undefined, '');
      assert('条目含 entryCode', e.entryCode !== undefined, '');
      assert('条目含 title', !!e.title, '');
      assert('条目含 fullContent', e.fullContent !== undefined, '');
      assert('条目含 scores 对象', e.scores !== undefined, '');
      assert('条目含 version 对象', e.version !== undefined, '');
    }

    // GET /api/entries/:id/history
    const { status: hStatus, data: hData } = await req('GET', `/entries/${testId}/history`, null, adminToken);
    assert('GET /entries/:id/history 返回 200', hStatus === 200, `status=${hStatus}`);
    assert('history 响应含 history 数组', hData.success && Array.isArray(hData.data.history), '');
  } else {
    console.log('  ⚠️  数据库中无条目，跳过详情测试');
  }
}

// GET /api/entries/:id — 不存在的 id → 404
{
  const { status, data } = await req('GET', '/entries/999999', null, adminToken);
  assert('不存在的 id 返回 404', status === 404, `status=${status}`);
  assert('错误码为 NOT_FOUND', !data.success && data.code === 'NOT_FOUND', `code=${data.code}`);
}

// GET /api/entries?knowledge_type=xxx&status=xxx — 筛选
{
  const { status, data } = await req('GET', '/entries?status=approved', null, adminToken);
  assert('按 status 筛选成功', status === 200 && data.success, `status=${status}`);
  if (data.success && data.data.entries.length > 0) {
    assert('筛选结果 status 正确', data.data.entries.every((e) => e.status === 'approved'),
      `结果中有非 approved 状态`);
  }
}

// ============================================================
// P5-T2: review 审核路由
// ============================================================
console.log('\n=== P5-T2: review 审核路由 ===');

// GET /api/review/pending — 待审核列表
{
  const { status, data } = await req('GET', '/review/pending', null, adminToken);
  assert('GET /review/pending 返回 200', status === 200, `status=${status}`);
  assert('响应含 entries 数组', data.success && Array.isArray(data.data.entries), '');
  console.log(`  ℹ️  待审核条目: ${data.data.total || 0} 条`);
}

// POST /api/review/:id — 参数校验
{
  const listResp = await req('GET', '/entries?limit=1', null, adminToken);
  if (listResp.data.success && listResp.data.data.entries.length > 0) {
    const testId = listResp.data.data.entries[0].id;

    // 无效 action
    const { status, data } = await req('POST', `/review/${testId}`, { action: 'invalid' }, adminToken);
    assert('无效 action → 400', status === 400, `status=${status}`);

    // reject 无 comment
    const r2 = await req('POST', `/review/${testId}`, { action: 'reject' }, adminToken);
    assert('reject 无 comment → 400', r2.status === 400, `status=${r2.status}`);

    // approve 无 scores
    const r3 = await req('POST', `/review/${testId}`, { action: 'approve' }, adminToken);
    assert('approve 无 scores → 400', r3.status === 400, `status=${r3.status}`);

    // 评分超出 1-5
    const r4 = await req('POST', `/review/${testId}`, {
      action: 'approve',
      scores: { completeness: 6, accuracy: 3, timeliness: 3, operability: 3, reusability: 3, traceability: 3 },
    }, adminToken);
    assert('评分超出范围 → 400', r4.status === 400, `status=${r4.status}`);
  }
}

// POST /api/review/:id — 审核通过
{
  // 找一个 pending_review 状态的条目
  const pendingResp = await req('GET', '/review/pending', null, adminToken);
  if (pendingResp.data.success && pendingResp.data.data.entries.length > 0) {
    const testId = pendingResp.data.data.entries[0].id;
    const { status, data } = await req('POST', `/review/${testId}`, {
      action: 'approve',
      scores: {
        completeness: 4, accuracy: 5, timeliness: 4,
        operability: 3, reusability: 4, traceability: 5,
      },
      comment: '审核通过，内容完整',
    }, adminToken);
    assert('审核通过返回 200', status === 200, `status=${status}`);
    if (data.success) {
      assert('条目状态更新为 approved', data.data.entry.status === 'approved',
        `status=${data.data.entry.status}`);
      assert('score_total = 25', data.data.entry.score_total === 25,
        `score_total=${data.data.entry.score_total}`);
    }
    console.log(`  ℹ️  条目 ${testId} 审核通过`);
  } else {
    console.log('  ℹ️  无待审核条目，跳过审核通过测试');
  }
}

// POST /api/review/:id — 审核驳回
{
  const pendingResp = await req('GET', '/review/pending', null, adminToken);
  if (pendingResp.data.success && pendingResp.data.data.entries.length > 0) {
    const testId = pendingResp.data.data.entries[0].id;
    const { status, data } = await req('POST', `/review/${testId}`, {
      action: 'reject',
      comment: '内容不完整，需要补充',
    }, adminToken);
    assert('审核驳回返回 200', status === 200, `status=${status}`);
    if (data.success) {
      assert('条目状态更新为 rejected', data.data.entry.status === 'rejected',
        `status=${data.data.entry.status}`);
    }
    console.log(`  ℹ️  条目 ${testId} 审核驳回`);
  } else {
    console.log('  ℹ️  无待审核条目，跳过审核驳回测试');
  }
}

// ============================================================
// P5-T3: admin 管理路由
// ============================================================
console.log('\n=== P5-T3: admin 管理路由 ===');

// GET /api/admin/users — 用户列表
{
  const { status, data } = await req('GET', '/admin/users', null, adminToken);
  assert('GET /admin/users 返回 200', status === 200, `status=${status}`);
  assert('响应含 users 数组', data.success && Array.isArray(data.data.users), '');
  if (data.success) {
    assert('至少有 1 个用户', data.data.users.length >= 1, `共 ${data.data.users.length} 个`);
    // 验证不含 password_hash
    const hasPasswordHash = data.data.users.some((u) => u.passwordHash || u.password_hash);
    assert('用户列表不含 password_hash', !hasPasswordHash, '');
    console.log(`  ℹ️  用户数: ${data.data.users.length}`);
  }
}

// POST /api/admin/users — 创建用户
{
  const testUsername = `test_user_${Date.now()}`;
  const { status, data } = await req('POST', '/admin/users', {
    username: testUsername,
    password: 'TestPass123',
    displayName: '测试用户',
    role: 'contributor',
  }, adminToken);
  assert('创建用户返回 200', status === 200, `status=${status}`);
  if (data.success) {
    assert('新用户 ID 返回', data.data.id !== undefined, '');
    assert('新用户角色正确', data.data.role === 'contributor', `role=${data.data.role}`);
    console.log(`  ℹ️  已创建用户: ${testUsername} (ID: ${data.data.id})`);

    // 验证可以用新用户登录
    const loginResp = await req('POST', '/auth/login', {
      username: testUsername,
      password: 'TestPass123',
    });
    assert('新用户可登录', loginResp.status === 200 && loginResp.data.success, '');
  }

  // 重复用户名 → 400
  const dupResp = await req('POST', '/admin/users', {
    username: testUsername,
    password: 'TestPass123',
    displayName: '重复用户',
    role: 'contributor',
  }, adminToken);
  assert('重复用户名 → 400', dupResp.status === 400, `status=${dupResp.status}`);
}

// POST /api/admin/entries/:id/archive — 归档
{
  let listResp = await req('GET', '/entries?limit=10', null, adminToken);
  let testId = null;
  if (listResp.data.success && listResp.data.data.entries.length > 0) {
    const entry = listResp.data.data.entries.find((e) => e.status !== 'archived');
    if (entry) {
      testId = entry.id;
    }
  }

  // 没有非 archived 的条目时，直接通过 SQL 创建一个
  if (!testId) {
    const pool = await getPool();
    const ts = Date.now().toString().slice(-6);
    const [result] = await pool.execute(
      `INSERT INTO kb_entries (entry_code, title, knowledge_type, architecture_layer, scene, summary, full_content, status, created_by)
       VALUES (?, ?, 'fault_case', 'fault', '测试场景', '归档测试摘要', '归档测试内容', 'draft', 'test_admin')`,
      [`KB-TEST-${ts}`, '归档测试条目']
    );
    testId = result.insertId;
  }

  if (testId) {
    const { status, data } = await req('POST', `/admin/entries/${testId}/archive`, null, adminToken);
    assert('归档条目返回 200', status === 200, `status=${status}, ${JSON.stringify(data)}`);
    if (data.success) {
      assert('状态为 archived', data.data.status === 'archived', `status=${data.data.status}`);
      console.log(`  ℹ️  条目 ${testId} 已归档`);
    }
  }
}

// DELETE /api/admin/entries/:id — 删除
{
  // 获取一个条目来测试删除
  let listResp = await req('GET', '/entries?limit=10', null, adminToken);
  if (listResp.data.success && listResp.data.data.entries.length > 0) {
    let testId = listResp.data.data.entries[0].id;

    // 如果条目还未归档，先归档
    if (listResp.data.data.entries[0].status !== 'archived') {
      await req('POST', `/admin/entries/${testId}/archive`, null, adminToken);
    }

    const { status, data } = await req('DELETE', `/admin/entries/${testId}`, null, adminToken);
    assert('删除条目返回 200', status === 200, `status=${status}`);
    if (data.success) {
      assert('deleted 为 true', data.data.deleted === true, '');
      console.log(`  ℹ️  条目 ${testId} 已删除`);

      // 验证删除后查不到
      const detailResp = await req('GET', `/entries/${testId}`, null, adminToken);
      assert('删除后查不到 → 404', detailResp.status === 404, `status=${detailResp.status}`);
    }
  }
}

// ============================================================
// P5-T4: stats 统计接口
// ============================================================
console.log('\n=== P5-T4: stats 统计接口 ===');

{
  const { status, data } = await req('GET', '/stats', null, adminToken);
  assert('GET /api/stats 返回 200', status === 200, `status=${status}`);
  if (data.success) {
    assert('响应含 totalEntries', data.data.totalEntries !== undefined, '');
    assert('响应含 byType', data.data.byType !== undefined, '');
    assert('响应含 byScene', data.data.byScene !== undefined, '');
    assert('响应含 byStatus', data.data.byStatus !== undefined, '');

    // byType 必须包含 6 种类型
    const allTypes = ['fault_case', 'sop', 'experience_rule', 'scene_portrait', 'tool_script', 'ai_template'];
    for (const t of allTypes) {
      assert(`byType 含 ${t}`, data.data.byType[t] !== undefined, `${t} 缺失`);
    }

    // byStatus 必须包含 5 种状态
    const allStatus = ['draft', 'pending_review', 'approved', 'rejected', 'archived'];
    for (const s of allStatus) {
      assert(`byStatus 含 ${s}`, data.data.byStatus[s] !== undefined, `${s} 缺失`);
    }

    // 各分类计数之和应 ≥ totalEntries（因为 archived 不计入 totalEntries 但计入 byStatus）
    const typeSum = Object.values(data.data.byType).reduce((a, b) => a + b, 0);
    const statusSum = Object.values(data.data.byStatus).reduce((a, b) => a + b, 0);
    console.log(`  ℹ️  totalEntries: ${data.data.totalEntries}, byType 合计: ${typeSum}, byStatus 合计: ${statusSum}`);
  }
}

// ============================================================
// 权限测试：非管理员访问 admin 路由
// ============================================================
console.log('\n=== 权限测试 ===');

{
  // 先创建一个 contributor 用户（使用时间戳避免重复）
  const permUsername = `perm_test_${Date.now()}`;
  const createResp = await req('POST', '/admin/users', {
    username: permUsername,
    password: 'TestPass123',
    displayName: '权限测试用户',
    role: 'contributor',
  }, adminToken);

  if (createResp.data.success) {
    // 用 contributor 登录
    const loginResp = await req('POST', '/auth/login', {
      username: permUsername,
      password: 'TestPass123',
    });
    if (loginResp.data.success) {
      const contribToken = loginResp.data.data.token;

      // contributor 访问 admin → 403
      const { status: s1 } = await req('GET', '/admin/users', null, contribToken);
      assert('contributor GET /admin/users → 403', s1 === 403, `status=${s1}`);

      // contributor 访问 review → 403
      const { status: s2 } = await req('GET', '/review/pending', null, contribToken);
      assert('contributor GET /review/pending → 403', s2 === 403, `status=${s2}`);

      // contributor 可以访问 entries 查询
      const { status: s3 } = await req('GET', '/entries', null, contribToken);
      assert('contributor GET /entries → 200', s3 === 200, `status=${s3}`);

      // contributor 可以访问 stats
      const { status: s4 } = await req('GET', '/stats', null, contribToken);
      assert('contributor GET /stats → 200', s4 === 200, `status=${s4}`);
    }
  }

  // 无 token 访问 → 401
  const { status: s5 } = await req('GET', '/entries', null, null);
  assert('无 token GET /entries → 401', s5 === 401, `status=${s5}`);

  const { status: s6 } = await req('GET', '/stats', null, null);
  assert('无 token GET /stats → 401', s6 === 401, `status=${s6}`);
}

// ============================================================
// 汇总
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`P5 集成测试汇总：${passed} 通过 / ${failed} 失败`);

// 清理：关闭数据库连接
try {
  const pool = await getPool();
  await pool.end();
} catch (_) {}

if (failures.length > 0) {
  console.log('失败用例：');
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  process.exit(1);
} else {
  console.log('🎉 所有 P5 集成测试通过！');
  process.exit(0);
}
