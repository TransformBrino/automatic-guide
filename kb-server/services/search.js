/**
 * services/search.js — 联网搜索服务
 * 职责：封装搜索引擎调用，返回结构化搜索结果
 * 当前实现：使用免费的 DuckDuckGo Instant Answer API（无需 API Key）
 * 可替换：配置其他搜索引擎（Bing/Google）时修改 search() 内部实现即可
 */

const config = require('../config');

/**
 * 执行 Web 搜索
 * @param {string} query - 搜索关键词
 * @returns {Promise<string>} 格式化后的搜索结果文本
 */
async function search(query) {
  const searchUrl = config.ai.searchEndpoint || 'https://api.duckduckgo.com';

  try {
    // DuckDuckGo Instant Answer API
    const url = `${searchUrl}/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      throw new Error(`搜索服务返回 HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return formatDuckDuckGoResults(data, query);
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return `[联网搜索超时，无法获取 "${query}" 的搜索结果]`;
    }
    return `[联网搜索失败: ${err.message}]`;
  }
}

/**
 * 格式化 DuckDuckGo 返回结果
 */
function formatDuckDuckGoResults(data, query) {
  const parts = [];

  // Abstract（摘要）
  if (data.AbstractText) {
    parts.push(`摘要：${data.AbstractText}`);
    if (data.AbstractSource) {
      parts.push(`来源：${data.AbstractSource}`);
    }
  }

  // 相关话题（Results）
  if (data.RelatedTopics && data.RelatedTopics.length > 0) {
    parts.push('\n相关结果：');
    let count = 0;
    for (const topic of data.RelatedTopics) {
      if (count >= 5) break; // 最多 5 条
      if (topic.Text) {
        count++;
        parts.push(`${count}. ${topic.Text}`);
        if (topic.FirstURL) {
          parts.push(`   链接: ${topic.FirstURL}`);
        }
      }
      // 处理子主题
      if (topic.Topics) {
        for (const sub of topic.Topics) {
          if (count >= 5) break;
          if (sub.Text) {
            count++;
            parts.push(`${count}. ${sub.Text}`);
          }
        }
      }
    }
  }

  if (parts.length === 0) {
    return `[搜索 "${query}" 未找到相关结果]`;
  }

  return parts.join('\n');
}

module.exports = { search };
