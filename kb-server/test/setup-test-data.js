/**
 * test/setup-test-data.js — 为 P5 集成测试准备数据
 * 使用：node test/setup-test-data.js
 */

const pool = require('../db/connection');

async function main() {
  try {
    // 清理旧测试数据
    await pool.execute("DELETE FROM kb_version_history WHERE entry_id IN (SELECT id FROM kb_entries WHERE entry_code LIKE 'KB-20250101-%')");
    await pool.execute("DELETE FROM kb_audit_log WHERE entry_id IN (SELECT id FROM kb_entries WHERE entry_code LIKE 'KB-20250101-%')");
    await pool.execute("DELETE FROM kb_entries WHERE entry_code LIKE 'KB-20250101-%'");

    // 准备数据
    const now = new Date();
    const inserts = [];

    // 1. 待审核条目（有评分）
    inserts.push({
      code: 'KB-20250101-001', title: '引擎异响故障排查',
      type: 'fault_case', layer: 'fault', scene: '引擎异响',
      severity: 'P1-严重', summary: '引擎异响故障排查与处理流程',
      content: '当车辆出现引擎异响时，应按照以下步骤排查：1. 检查机油油位 2. 检查皮带张紧度 3. 检查气门间隙。',
      status: 'pending_review',
      c: 8, a: 7, t: 9, o: 6, r: 7, tr: 8, total: 8,
      mv: 1, mi: 0, pv: 0,
      rid: null, rat: null, rc: null,
    });

    // 2. 已审核条目（有评分+审核信息）
    inserts.push({
      code: 'KB-20250101-002', title: '设备日常巡检SOP',
      type: 'sop', layer: 'standard', scene: '日常巡检',
      severity: 'P3-轻微', summary: '设备日常巡检标准作业流程',
      content: '设备日常巡检包括：1. 外观检查 2. 运行参数记录 3. 异常标记 4. 报告提交。',
      status: 'approved',
      c: 9, a: 8, t: 8, o: 9, r: 8, tr: 7, total: 8,
      mv: 1, mi: 2, pv: 0,
      rid: 1, rat: now, rc: '内容完整，审核通过',
    });

    // 3. 草稿条目（无评分）
    inserts.push({
      code: 'KB-20250101-003', title: '客户沟通经验',
      type: 'experience_rule', layer: 'solution', scene: '客户沟通',
      severity: 'P2-一般', summary: '客户沟通经验规则',
      content: '与客户沟通时应注意倾听、记录要点、及时反馈。',
      status: 'draft',
      c: 0, a: 0, t: 0, o: 0, r: 0, tr: 0, total: 0,
      mv: 0, mi: 1, pv: 0,
      rid: null, rat: null, rc: null,
    });

    // 4. 已归档条目
    inserts.push({
      code: 'KB-20250101-004', title: '新产品上线场景画像',
      type: 'scene_portrait', layer: 'scene', scene: '新产品上线',
      severity: 'P2-一般', summary: '新产品上线场景画像',
      content: '新产品上线时需要考虑的各方面因素。',
      status: 'archived',
      c: 0, a: 0, t: 0, o: 0, r: 0, tr: 0, total: 0,
      mv: 1, mi: 0, pv: 0,
      rid: null, rat: null, rc: null,
    });

    // 5. 已驳回条目
    inserts.push({
      code: 'KB-20250101-005', title: '数据处理工具脚本',
      type: 'tool_script', layer: 'tool', scene: '数据处理',
      severity: 'P3-轻微', summary: '数据处理工具脚本',
      content: '用于批量数据处理的Python脚本。',
      status: 'rejected',
      c: 0, a: 0, t: 0, o: 0, r: 0, tr: 0, total: 0,
      mv: 1, mi: 0, pv: 0,
      rid: 1, rat: now, rc: '内容不够详细，请补充',
    });

    // 6. 待审核AI模板
    inserts.push({
      code: 'KB-20250101-006', title: '智能客服AI模板',
      type: 'ai_template', layer: 'tool', scene: '客服自动化',
      severity: 'P2-一般', summary: '智能客服AI应答模板',
      content: '基于大模型的智能客服应答模板，支持多轮对话。',
      status: 'pending_review',
      c: 7, a: 8, t: 9, o: 7, r: 6, tr: 8, total: 7,
      mv: 1, mi: 0, pv: 0,
      rid: null, rat: null, rc: null,
    });

    const insertSql = `INSERT INTO kb_entries
      (entry_code, title, knowledge_type, architecture_layer, scene, severity,
       summary, full_content, status, created_by,
       score_completeness, score_accuracy, score_timeliness, score_operability, score_reusability, score_traceability, score_total,
       major_version, minor_version, patch_version,
       reviewer_id, reviewed_at, review_comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    for (const e of inserts) {
      const params = [
        e.code, e.title, e.type, e.layer, e.scene, e.severity,
        e.summary, e.content, e.status,
        e.c, e.a, e.t, e.o, e.r, e.tr, e.total,
        e.mv, e.mi, e.pv,
        e.rid, e.rat, e.rc,
      ];
      let insertId;
      try {
        const [result] = await pool.execute(insertSql, params);
        insertId = result.insertId;
        console.log(`  插入 ${e.code} (${e.title}) → ID: ${insertId}`);
      } catch (err) {
        console.error(`  失败 ${e.code}:`, err.message);
        console.error('  params:', JSON.stringify(params));
        throw err;
      }

      // 为已审核条目添加版本历史
      if (e.status === 'approved') {
        console.log(`    为 ${insertId} 添加版本历史...`);
        await pool.execute(
          `INSERT INTO kb_version_history (entry_id, version_label, change_summary, changed_by, full_content_snapshot)
           VALUES (?, ?, '初始版本', 'admin', ?)`,
          [insertId, '1.0.0', '设备日常巡检包括：1. 外观检查...']
        );
        console.log(`    版本1 已添加`);
        await pool.execute(
          `INSERT INTO kb_version_history (entry_id, version_label, change_summary, changed_by, full_content_snapshot)
           VALUES (?, ?, '更新：增加参数记录', 'admin', ?)`,
          [insertId, '1.2.0', '设备日常巡检包括：1. 外观检查 2. 运行参数记录...']
        );
        console.log(`    版本2 已添加`);
        console.log(`    添加版本历史 × 2`);
      }
    }

    console.log('\n所有测试数据已插入！');
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();