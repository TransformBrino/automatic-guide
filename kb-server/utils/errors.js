/**
 * utils/errors.js — 错误码常量定义
 * 职责：定义框架文档第十一章 11.1 的 8 个错误码及其对应 HTTP 状态码。
 * 所有接口的错误响应必须使用这些常量，保证一致性。
 */

// 错误码 -> HTTP 状态码 映射
const ERROR_CODES = {
  AUTH_REQUIRED: { httpStatus: 401, message: '未登录或 token 过期' },
  FORBIDDEN: { httpStatus: 403, message: '权限不足' },
  NOT_FOUND: { httpStatus: 404, message: '资源不存在' },
  VALIDATION_ERROR: { httpStatus: 400, message: '请求参数无效' },
  SQL_VALIDATION_ERROR: { httpStatus: 400, message: 'AI 生成的 SQL 未通过安全校验' },
  AI_API_ERROR: { httpStatus: 502, message: 'AI API 调用失败' },
  DB_ERROR: { httpStatus: 500, message: '数据库操作失败' },
  INTERNAL_ERROR: { httpStatus: 500, message: '服务器内部错误' },
};

// 导出错误码常量（便于直接引用，如 errors.AUTH_REQUIRED）
module.exports = ERROR_CODES;

/**
 * 根据错误码获取 {code, httpStatus, message}
 * 支持两种调用方式：
 *   1. 传字符串键：getErrorInfo('NOT_FOUND', '自定义消息')
 *   2. 传错误对象：getErrorInfo(errors.NOT_FOUND, '自定义消息')
 *      即 { httpStatus: 404, message: '资源不存在' }
 */
function getErrorInfo(code, customMessage) {
  // 情况 1：code 已经是错误对象（调用方直接传 errors.NOT_FOUND）
  if (code && typeof code === 'object' && code.httpStatus) {
    // 反向查找 code 名称（遍历 ERROR_CODES 找到匹配的键）
    const codeName = Object.keys(ERROR_CODES).find(
      (k) => ERROR_CODES[k].httpStatus === code.httpStatus && ERROR_CODES[k].message === code.message
    );
    return {
      code: codeName || 'INTERNAL_ERROR',
      httpStatus: code.httpStatus,
      message: customMessage || code.message,
    };
  }

  // 情况 2：code 是字符串键
  const info = ERROR_CODES[code];
  if (!info) {
    return { code: 'INTERNAL_ERROR', httpStatus: 500, message: customMessage || '未知错误' };
  }
  return { code, httpStatus: info.httpStatus, message: customMessage || info.message };
}

module.exports.getErrorInfo = getErrorInfo;
