/**
 * utils/response.js — 统一响应工具
 * 职责：封装框架文档第八章 8.1 的统一响应结构。
 * 成功：{success: true, data, message}
 * 失败：{success: false, error, code}
 */

const { getErrorInfo } = require('./errors');

/**
 * 发送成功响应
 * @param {object} res - Express response 对象
 * @param {object} data - 响应数据
 * @param {string} message - 可选提示信息
 */
function sendSuccess(res, data = {}, message = '') {
  return res.json({
    success: true,
    data,
    message,
  });
}

/**
 * 发送错误响应
 * @param {object} res - Express response 对象
 * @param {string} code - 错误码（见 utils/errors.js）
 * @param {string} customMessage - 自定义错误描述（可选，覆盖默认）
 * @param {number} httpStatus - 可选，覆盖默认 HTTP 状态码
 */
function sendError(res, code, customMessage, httpStatus) {
  const info = getErrorInfo(code, customMessage);
  return res.status(httpStatus || info.httpStatus).json({
    success: false,
    error: info.message,
    code: info.code,
  });
}

/**
 * P9-T3：生产环境屏蔽内部错误细节
 * 在 catch 块中包装原始 err.message，生产环境返回通用描述，开发环境保留详情
 * @param {string} prefix - 错误前缀（如 '查询知识条目失败'）
 * @param {Error|string} err - 原始错误对象或消息
 * @returns {string} 安全处理后的错误消息
 */
function safeErrorMsg(prefix, err) {
  if (process.env.NODE_ENV === 'production') {
    return prefix;
  }
  const detail = typeof err === 'string' ? err : (err?.message || '');
  return detail ? `${prefix}: ${detail}` : prefix;
}

module.exports = { sendSuccess, sendError, safeErrorMsg };
