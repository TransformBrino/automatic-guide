-- P9-T13: 将 FULLTEXT 索引从默认分词器迁移到 ngram 分词器
-- ngram 分词器支持中文按字符切分，解决搜索"通讯故障"无法匹配"通讯模块故障"的问题
-- 适用：MySQL 5.7+ / 8.0+，ngram_token_size 默认 2

ALTER TABLE kb_entries DROP INDEX idx_fulltext;
ALTER TABLE kb_entries ADD FULLTEXT INDEX idx_fulltext (title, summary, full_content) WITH PARSER ngram;
