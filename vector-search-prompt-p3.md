# 识途知识库 — 向量检索改造（第 3/3 批：验证与收尾）

## 你的角色

你是一位资深全栈工程师和测试工程师，精通 Node.js（Express）、MySQL 8.0、向量检索。

## 前置条件

第 1 批（基础设施层）和第 2 批（业务改造层）已全部完成：
- 向量存储、检索、同步机制已就绪
- `entries.js`、`chat.js`、`admin.js` 已改造完成
- 历史条目向量已批量生成

## 执行方式

按以下步骤**逐步执行**。每完成一个步骤，输出验证结果，等待我确认后再继续下一步。

## 禁止事项

- **禁止修改**任何代码文件（本批次只做验证，不做修改）
- **禁止跳过**验证步骤

---

## 步骤 12：前端验证 — 无需改前端代码

**验证文件**：`kb-server/public/index.html`（只需打开浏览器验证，不要修改）

### 12.1 知识库 Tab 搜索验证

1. 打开知识库 Tab
2. 搜索"机器人故障处理"，观察返回结果
3. **预期**：Top 3 结果中至少包含 1 条与故障处理相关的条目（即使标题不含"故障"二字）
4. 观察搜索响应时间是否在可接受范围内

### 12.2 降级验证

1. 临时停掉 AI API（修改 `.env` 中的 `AI_API_URL` 为无效地址，重启服务）
2. 搜索任意关键词
3. **预期**：搜索仍能正常工作（回退到 FULLTEXT + LIKE），不会报错

### 12.3 新增条目后向量同步验证

1. 通过对话 Tab 新增一条知识条目
2. 等待 30 秒
3. 查询 `kb_entry_embeddings` 表确认新增了对应该条目的向量
4. 在知识库 Tab 搜索该条目相关内容，确认能命中

### 12.4 归档条目后向量清理验证

1. 通过管理 Tab 归档一条条目
2. 查询 `kb_entry_embeddings` 表确认该条目向量已被移除
3. 在知识库 Tab 搜索该条目相关内容，确认不再返回

---

## 验收标准（全部 9 项）

| # | 验收项 | 验证方式 |
|---|--------|---------|
| 1 | 向量库为空时搜索走 FULLTEXT 降级 | 初始部署（未执行 generate-embeddings），搜索任意关键词应返回正常结果 |
| 2 | 语义搜索命中 | 搜索"机器人故障处理"，Top 3 中至少包含 1 条故障处理相关条目 |
| 3 | 无意义搜索返回空 | 搜索"xyzabc123"返回空结果 |
| 4 | AI API 不可用时降级 | 停掉 AI API 后搜索仍能正常工作（FULLTEXT + LIKE） |
| 5 | 新增条目后向量即时生成 | 新增条目后 30 秒内 `kb_entry_embeddings` 出现对应向量，搜索能命中 |
| 6 | 归档条目后向量清理 | 归档条目后，30 分钟内搜索不返回该条目 |
| 7 | 批量生成成功率 | `npm run generate-embeddings` 失败数 < 总数 5% |
| 8 | 启动时向量加载正常 | 日志包含 `[vector-store] 从 MySQL 加载 X 个向量`，X 与表中有效条目数一致 |
| 9 | 重启后缓存恢复 | 重启服务后，内存向量缓存正确恢复，搜索功能正常 |

---

## 收尾检查清单

- [ ] 所有新增文件已创建（4 个服务文件 + 1 个迁移脚本 + 1 个批量生成脚本）
- [ ] 所有修改文件已更新（8 个：schema.sql, config.js, .env.example, package.json, server.js, routes/entries.js, routes/chat.js, routes/admin.js）
- [ ] 无修改的文件保持原样（middleware/, utils/, prompts/, public/index.html）
- [ ] 现有的 FULLTEXT + LIKE 搜索逻辑完好保留
- [ ] 启动服务无报错
- [ ] 9 项验收标准全部通过

---

## 文件变更总览（供参考）

```
新增文件（6 个）：
  kb-server/db/migration_vector.sql          ← 新增 kb_entry_embeddings 表
  kb-server/services/embedding.js            ← Embedding API 封装（含自动探测）
  kb-server/services/vector-store.js         ← MySQL 持久化 + 内存 Map 缓存
  kb-server/services/vector-search.js        ← 余弦相似度检索引擎
  kb-server/scripts/generate-embeddings.js   ← 历史数据批量向量化脚本
  kb-server/vector-search-prompt-p1.md       ← 本批提示词文件

修改文件（8 个）：
  kb-server/db/schema.sql          ← 末尾追加 kb_entry_embeddings 建表语句
  kb-server/config.js              ← 新增 embeddingApiUrl, embeddingModel, embeddingModelCandidates
  kb-server/.env.example           ← 新增 EMBEDDING_API_URL, EMBEDDING_MODEL, EMBEDDING_MODEL_CANDIDATES
  kb-server/package.json           ← 新增 generate-embeddings 脚本
  kb-server/server.js              ← 新增 vectorStore.startVectorStore() 初始化
  kb-server/routes/entries.js      ← 搜索逻辑改造（向量优先 + FULLTEXT 降级）
  kb-server/routes/chat.js         ← INSERT/UPDATE/DELETE 时同步向量
  kb-server/routes/admin.js        ← 归档/删除时清理向量

不修改（零变更）：
  kb-server/middleware/            ← 认证、限流不变
  kb-server/utils/                 ← 工具函数不变
  kb-server/prompts/               ← AI Prompt 不变
  kb-server/public/index.html      ← 前端接口兼容，无强制改动需要
```

---

## 已知注意事项

1. **向量维度**：从 API 响应动态读取，不硬编码
2. **降级策略**：Embedding API 不可用或向量库为空时，自动回退到 FULLTEXT + LIKE
3. **数据一致性**：向量写入在 `setImmediate` 中异步执行，不与主事务绑定。非 chat 路径的变更依赖 `syncFromDb` 每 30 分钟同步，存在最大 30 分钟不一致窗口
4. **搜索性能**：理论估算值，建议在目标机器上实测后确定 topK 取值
5. **ON DELETE CASCADE**：仅对硬删除生效，日常依赖 `syncFromDb` 和 `deleteVector` 手动清理
6. **分页边界**：向量检索先取 Top-50 再交 MySQL 分页，深翻页时可能返回空结果

全部验收通过后，向量检索改造即告完成。