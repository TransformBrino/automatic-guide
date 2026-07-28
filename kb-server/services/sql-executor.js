/**
 * services/sql-executor.js — SQL 安全执行器（系统安全核心）
 * 职责：对 AI 生成的 SQL 进行多层安全校验，通过后在一个事务中执行。
 * 对应框架文档第五章 5.1-5.4。
 *
 * 设计原则：AI 生成的 SQL 是不可信输入，必须经 5 层校验后才能执行。
 * 校验失败返回 {success:false, error, results:[]}，不抛异常（由调用方决定响应）。
 */

const { Parser } = require('node-sql-parser');
const pool = require('../db/connection');

const parser = new Parser();

// 允许的操作类型
const ALLOWED_OP_TYPES = new Set(['select', 'insert', 'update', 'delete']);

// 禁止的 DDL 首关键字集合（校验 3 的二次防线）
// 仅检查语句的第一个关键字，避免误拦截查询条件中的文本
const DDL_FIRST_WORDS = new Set(['DROP', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'CREATE']);

/**
 * 校验 1：操作类型白名单
 * 只允许 SELECT / INSERT / UPDATE / DELETE
 */
function checkOperationType(ast) {
  // ast 可能是数组（多语句），每个元素有 type
  const statements = Array.isArray(ast) ? ast : [ast];
  for (const stmt of statements) {
    if (!stmt || !stmt.type || !ALLOWED_OP_TYPES.has(stmt.type.toLowerCase())) {
      return {
        ok: false,
        error: `非法操作类型: ${stmt?.type || '未知'}，仅允许 SELECT/INSERT/UPDATE/DELETE`,
      };
    }
  }
  return { ok: true };
}

/**
 * 校验 2：表名白名单
 * 所有涉及的表必须以 kb_ 开头
 * 用 node-sql-parser 的 tableList 提取表名
 */
function checkTableNames(sql) {
  let tableList;
  try {
    // node-sql-parser 的 tableList 接收 SQL 字符串（非 AST）
    tableList = parser.tableList(sql);
  } catch (e) {
    return { ok: false, error: '无法解析 SQL 表名: ' + e.message };
  }

  // tableList 格式: ['select::null::kb_entries', 'insert::null::kb_tags', ...]
  // 第三段是表名
  for (const item of tableList) {
    const parts = item.split('::');
    const tableName = parts[2];
    if (!tableName || !tableName.toLowerCase().startsWith('kb_')) {
      return {
        ok: false,
        error: `非法表名: ${tableName}，仅允许操作 kb_ 开头的表`,
      };
    }
  }
  return { ok: true };
}

/**
 * 校验 3：禁止 DDL 关键字（二次防线）
 * 即使 node-sql-parser 解析通过，仍用正则二次检查
 */
function checkDDL(sql) {
  const firstWord = sql.trim().split(/\s+/)[0].toUpperCase();
  if (DDL_FIRST_WORDS.has(firstWord)) {
    return {
      ok: false,
      error: 'SQL 包含禁止的 DDL 关键字 (DROP/ALTER/TRUNCATE/GRANT/REVOKE/CREATE)',
    };
  }
  return { ok: true };
}

/**
 * 校验 4：禁止多语句
 * 去除末尾单个分号后，若仍含分号则拒绝
 * （node-sql-parser 的 astify 若返回数组说明是多语句，也一并拒绝）
 */
function checkMultiStatement(sql, ast) {
  // 去除末尾空白和单个分号
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';')) {
    return {
      ok: false,
      error: 'SQL 包含多语句（分号分隔），已被拒绝',
    };
  }
  // node-sql-parser 解析出多条语句
  if (Array.isArray(ast) && ast.length > 1) {
    return {
      ok: false,
      error: 'SQL 解析为多条语句，已被拒绝',
    };
  }
  return { ok: true };
}

/**
 * 解析单条 SQL，返回 ast 或抛错
 */
function parseSQL(sql) {
  // astify 对单条语句返回对象，对多条返回数组
  return parser.astify(sql);
}

/**
 * 安全校验并执行 SQL 语句数组
 * @param {string[]} sqlStatements - AI 生成的 SQL 语句数组
 * @param {number} userId - 当前用户 ID（用于日志）
 * @param {Object} [options] - 可选选项
 * @param {boolean} [options.entryCode] - 是否在事务内生成 entry_code（替换 __ENTRY_CODE__ 占位符）
 * @returns {Promise<{success:boolean, results:any[], error?:string, parsedTypes?:string[], entryCode?:string}>}
 */
async function validateAndExecute(sqlStatements, userId, options = {}) {
  if (!Array.isArray(sqlStatements) || sqlStatements.length === 0) {
    return { success: false, results: [], error: 'SQL 语句数组为空' };
  }

  // 限制单次执行数量（防止 AI 生成过多语句）
  if (sqlStatements.length > 10) {
    return {
      success: false,
      results: [],
      error: '单次执行的 SQL 语句数量超过上限 (10)',
    };
  }

  // 逐条校验
  const parsedList = [];
  for (const sql of sqlStatements) {
    // 解析 SQL
    let ast;
    try {
      ast = parseSQL(sql);
    } catch (e) {
      return {
        success: false,
        results: [],
        error: 'SQL 语法解析失败: ' + e.message,
      };
    }

    // 校验 4：多语句检测
    const multiCheck = checkMultiStatement(sql, ast);
    if (!multiCheck.ok) {
      return { success: false, results: [], error: multiCheck.error };
    }

    // 校验 1：操作类型白名单（基于 AST，先于 DDL 正则校验）
    const opCheck = checkOperationType(ast);
    if (!opCheck.ok) {
      return { success: false, results: [], error: opCheck.error };
    }

    // 校验 2：表名白名单
    const tableCheck = checkTableNames(sql);
    if (!tableCheck.ok) {
      return { success: false, results: [], error: tableCheck.error };
    }

    // 校验 3：DDL 关键字正则（二次防线，在 AST 确认操作类型后执行，
    // 避免查询文本中包含 DDL 关键字（如 '%create%'）被误拦截）
    const ddlCheck = checkDDL(sql);
    if (!ddlCheck.ok) {
      return { success: false, results: [], error: ddlCheck.error };
    }

    parsedList.push({ sql, ast });
  }

  // 校验 5：事务包装执行
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // === 事务内生成 entry_code（原子递增，并发安全）===
    let generatedEntryCode = null;
    if (options.entryCode) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}${mm}${dd}`;

      // 原子递增：INSERT ... ON DUPLICATE KEY UPDATE 是 MySQL 原子操作
      // 即使并发请求同时执行，也不会产生相同序号
      await conn.execute(
        'INSERT INTO kb_code_sequence (date_key, seq) VALUES (?, 1) ON DUPLICATE KEY UPDATE seq = seq + 1',
        [dateStr]
      );
      const [seqRows] = await conn.execute(
        'SELECT seq FROM kb_code_sequence WHERE date_key = ?',
        [dateStr]
      );
      const seq = String(seqRows[0].seq).padStart(3, '0');
      generatedEntryCode = `KB-${dateStr}-${seq}`;

      // 替换 SQL 中的 __ENTRY_CODE__ 占位符
      for (let i = 0; i < sqlStatements.length; i++) {
        if (sqlStatements[i].includes('__ENTRY_CODE__')) {
          // 转义单引号防止 SQL 注入（占位符替换时）
          const escaped = generatedEntryCode.replace(/'/g, "''");
          sqlStatements[i] = sqlStatements[i].replace(/__ENTRY_CODE__/g, escaped);
        }
      }
    }

    const results = [];
    const parsedTypes = [];
    for (const { sql, ast } of parsedList) {
      const stmtArr = Array.isArray(ast) ? ast : [ast];
      parsedTypes.push(stmtArr[0]?.type?.toLowerCase());
      const [rows] = await conn.query(sql);
      results.push(rows);
    }

    await conn.commit();
    return { success: true, results, parsedTypes, entryCode: generatedEntryCode };
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rbErr) {
        // 回滚失败也记录，但主要错误是执行错误
      }
    }
    return {
      success: false,
      results: [],
      error: 'SQL 执行失败（已回滚）: ' + err.message,
    };
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

module.exports = { validateAndExecute };
