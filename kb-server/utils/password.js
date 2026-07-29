/**
 * utils/password.js — 密码复杂度校验
 * P9-T16：统一密码强度规则，避免 admin.js 与 auth.js 重复校验逻辑。
 *
 * 规则：至少 8 位，必须包含大写字母、小写字母、数字。
 * 返回 { valid: boolean, message: string }
 */

const MIN_LENGTH = 8;
const PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * 校验密码复杂度
 * @param {string} password - 待校验的密码明文
 * @returns {{ valid: boolean, message: string }}
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: '密码不能为空' };
  }

  if (password.length < MIN_LENGTH) {
    return { valid: false, message: `密码长度至少 ${MIN_LENGTH} 位` };
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, message: '密码必须包含小写字母' };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: '密码必须包含大写字母' };
  }

  if (!/\d/.test(password)) {
    return { valid: false, message: '密码必须包含数字' };
  }

  return { valid: true, message: '密码符合复杂度要求' };
}

module.exports = { validatePassword, MIN_LENGTH };
