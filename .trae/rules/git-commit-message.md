---
alwaysApply: true
scene: git_message
---

# Git Commit Message Convention

## Format

```
<type>: <subject>

[optional body]
```

## Types

| type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure without behavior change |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `style` | Formatting, semicolons, etc. (no logic change) |
| `test` | Adding or updating tests |
| `chore` | Build, dependencies, tooling |
| `db` | Database schema change (migration, new table/column) |

## Rules

1. Subject in Chinese, type prefix in English (e.g., `feat: 新增向量检索`)
2. Subject max 50 chars, no trailing period
3. Start subject with a verb describing the action (新增, 修复, 重构, 移除, 升级)
4. For multi-module changes, summarize scope in the subject
5. Group related changes into a single commit; do not over-split
6. Use body for multi-file changes: list key files/modules with bullet points

## Examples

```
feat: 新增向量检索功能，替换 FULLTEXT 关键词匹配

- 新增 kb_entry_embeddings 表存储条目向量
- 新增 embedding.js / vector-store.js / vector-search.js 服务
- 改造 entries.js 搜索接口，向量优先 + FULLTEXT 降级
- 异步同步 chat.js 和 admin.js 的条目 CRUD 向量
```

```
fix: 修复 entry_code 并发生成时的唯一索引冲突

改用 ON DUPLICATE KEY UPDATE 原子递增，事务内完成生成与 INSERT。
```

```
refactor: 将 Express 中间件改为原生 Koa 实现

移除 koa-connect 包装层，解决 ctx 泄漏问题。
```

```
db: 新增 kb_entry_embeddings 表，支持向量存储
```

```
chore: 升级 mysql2 依赖至 3.x，启用 JSON 列自动解析
```

## Anti-patterns

- Do NOT use vague subjects like "更新代码", "修改文件", "优化"
- Do NOT use "WIP", "临时提交", or other placeholder messages
- Do NOT write the subject in English (type prefix is the only exception)