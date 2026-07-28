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

module.exports = { sendSuccess, sendError };
