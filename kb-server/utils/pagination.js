/**
 * utils/pagination.js — 分页参数校验
 * P9-T31：防止 LIMIT/OFFSET 非整数或负数注入模板字符串
 */

/**
 * 校验并规范分页参数
 * @param {*} page - 页码（来自 req.query.page）
 * @param {*} limit - 每页条数（来自 req.query.limit）
 * @param {number} [maxLimit=100] - 单页最大条数
 * @param {number} [defaultLimit=20] - 默认每页条数
 * @returns {{ pageNum: number, limitNum: number, offset: number }}
 */
function validatePagination(page, limit, maxLimit = 100, defaultLimit = 20) {
  // 先解析原始值
  const rawPage = parseInt(page, 10);
  const rawLimit = parseInt(limit, 10);

  // 如果传了值但解析后不是有效正整数，直接拒绝
  if (page !== undefined && page !== null && page !== '' && (!Number.isInteger(rawPage) || rawPage < 1)) {
    throw new Error('页码必须为正整数');
  }
  if (limit !== undefined && limit !== null && limit !== '' && (!Number.isInteger(rawLimit) || rawLimit < 1)) {
    throw new Error('每页条数必须为正整数');
  }

  const pageNum = Math.max(1, rawPage || 1);
  const limitNum = Math.min(maxLimit, Math.max(1, rawLimit || defaultLimit));
  const offset = (pageNum - 1) * limitNum;

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('偏移量必须为非负整数');
  }

  return { pageNum, limitNum, offset };
}

module.exports = { validatePagination };
