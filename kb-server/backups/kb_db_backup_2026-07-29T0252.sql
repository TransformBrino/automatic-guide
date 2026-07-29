-- MySQL dump 10.13  Distrib 8.4.7, for Win64 (x86_64)
--
-- Host: localhost    Database: kb_db
-- ------------------------------------------------------
-- Server version	8.4.7

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `kb_audit_log`
--

DROP TABLE IF EXISTS `kb_audit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_audit_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entry_id` int DEFAULT NULL,
  `action` enum('create','update','delete','review_approve','review_reject','archive') NOT NULL,
  `operator` varchar(50) NOT NULL,
  `detail` text,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_entry_id` (`entry_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `kb_audit_log_ibfk_1` FOREIGN KEY (`entry_id`) REFERENCES `kb_entries` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='操作日志表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kb_audit_log`
--

LOCK TABLES `kb_audit_log` WRITE;
/*!40000 ALTER TABLE `kb_audit_log` DISABLE KEYS */;
INSERT INTO `kb_audit_log` VALUES (1,NULL,'create','admin','AI 辅助录入','::1','2026-07-28 01:41:25'),(2,NULL,'archive','admin','归档条目: AGV-007 无法启动','::1','2026-07-28 09:10:32'),(3,NULL,'delete','admin','删除条目: AGV-007 无法启动 (KB-20260728-001)','::1','2026-07-28 09:17:07'),(4,NULL,'archive','admin','归档条目: 归档测试条目','::1','2026-07-28 09:23:18'),(5,NULL,'delete','admin','删除条目: 归档测试条目 (KB-TEST-798007)','::1','2026-07-28 09:23:18'),(6,NULL,'review_approve','admin','审核通过，评分 25/30','::1','2026-07-28 09:29:48'),(7,21,'review_reject','admin','审核驳回：内容不完整，需要补充','::1','2026-07-28 09:29:48'),(8,NULL,'archive','admin','归档条目: 引擎异响故障排查','::1','2026-07-28 09:29:48'),(9,NULL,'delete','admin','删除条目: 引擎异响故障排查 (KB-20250101-001)','::1','2026-07-28 09:29:48'),(10,NULL,'archive','admin','归档条目: 设备日常巡检SOP','::1','2026-07-28 09:33:22'),(11,NULL,'delete','admin','删除条目: 设备日常巡检SOP (KB-20250101-002)','::1','2026-07-28 09:33:22'),(12,25,'create','admin','AI 辅助录入','::ffff:127.0.0.1','2026-07-28 14:40:14'),(13,26,'create','admin','AI 辅助录入','::ffff:127.0.0.1','2026-07-28 15:04:21'),(14,NULL,'create','admin','AI 辅助录入','::1','2026-07-28 15:11:21'),(15,NULL,'delete','admin','删除条目: AGV-Tms4bhiflnpyh 系统异常故障 (KB-20260728-003)','::1','2026-07-28 15:13:08'),(16,28,'create','admin','AI 辅助录入','::1','2026-07-28 15:13:17'),(17,29,'create','admin','AI 辅助录入','::ffff:127.0.0.1','2026-07-28 15:19:29'),(18,30,'create','admin','AI 辅助录入','::ffff:127.0.0.1','2026-07-28 15:19:44'),(19,18,'review_approve','admin','审核通过，评分 22/30','::1','2026-07-28 15:25:02'),(20,25,'review_approve','admin','审核通过，评分 21/30','::ffff:127.0.0.1','2026-07-28 15:26:05'),(21,26,'review_approve','admin','审核通过，评分 8/30','::ffff:127.0.0.1','2026-07-28 15:26:21'),(22,28,'review_approve','admin','审核通过，评分 25/30','::1','2026-07-28 23:11:44'),(23,29,'review_reject','admin','审核驳回：内容不完整，需要补充','::1','2026-07-28 23:11:44'),(24,30,'archive','admin','归档条目: 堆垛机-03 自动取货定位偏移','::1','2026-07-28 23:11:44'),(25,30,'delete','admin','删除条目: 堆垛机-03 自动取货定位偏移 (KB-20260728-005)','::1','2026-07-28 23:11:44'),(26,29,'archive','admin','归档条目: 设备故障排查标准引导话术','::1','2026-07-28 23:28:08'),(27,30,'delete','admin','删除条目: 堆垛机-03 自动取货定位偏移 (KB-20260728-005)','::1','2026-07-28 23:28:08'),(28,28,'archive','admin','归档条目: AGV-ms4bjzti3wos92 Z轴驱动器过载故障','::1','2026-07-28 23:52:00'),(29,30,'delete','admin','删除条目: 堆垛机-03 自动取货定位偏移 (KB-20260728-005)','::1','2026-07-28 23:52:00'),(30,26,'archive','admin','归档条目: AGV-007 启动时无法启动（BMS短路导致保险丝熔断）','::1','2026-07-29 09:00:24'),(31,30,'delete','admin','删除条目: 堆垛机-03 自动取货定位偏移 (KB-20260728-005)','::1','2026-07-29 09:00:24'),(32,25,'archive','admin','归档条目: PLC与106主机通信时断时续','::1','2026-07-29 09:04:29'),(33,30,'delete','admin','删除条目: 堆垛机-03 自动取货定位偏移 (KB-20260728-005)','::1','2026-07-29 09:04:29'),(34,18,'archive','admin','归档条目: 客户沟通经验','::1','2026-07-29 09:04:48'),(35,30,'delete','admin','删除条目: 堆垛机-03 自动取货定位偏移 (KB-20260728-005)','::1','2026-07-29 09:04:48'),(36,20,'archive','admin','归档条目: 数据处理工具脚本','::1','2026-07-29 09:09:12'),(37,30,'delete','admin','删除条目: 堆垛机-03 自动取货定位偏移 (KB-20260728-005)','::1','2026-07-29 09:09:12');
/*!40000 ALTER TABLE `kb_audit_log` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kb_code_sequence`
--

DROP TABLE IF EXISTS `kb_code_sequence`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_code_sequence` (
  `date_key` varchar(8) NOT NULL,
  `seq` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`date_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='编码序列表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kb_code_sequence`
--

LOCK TABLES `kb_code_sequence` WRITE;
/*!40000 ALTER TABLE `kb_code_sequence` DISABLE KEYS */;
/*!40000 ALTER TABLE `kb_code_sequence` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kb_entries`
--

DROP TABLE IF EXISTS `kb_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entry_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '自动生成，格式 KB-YYYYMMDD-NNN',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `knowledge_type` enum('fault_case','sop','experience_rule','scene_portrait','tool_script','ai_template') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '知识类型',
  `architecture_layer` enum('scene','fault','solution','tool','standard') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '架构层',
  `scene` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '其他' COMMENT '场景',
  `severity` enum('P0-致命','P1-严重','P2-一般','P3-轻微') COLLATE utf8mb4_unicode_ci DEFAULT 'P2-一般' COMMENT '严重程度',
  `summary` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '摘要 1-2 句话',
  `full_content` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '完整 Markdown 正文',
  `raw_input` text COLLATE utf8mb4_unicode_ci COMMENT '员工原始口述文本，用于追溯',
  `score_completeness` tinyint DEFAULT '0' COMMENT '完整性评分 1-5，0=未评',
  `score_accuracy` tinyint DEFAULT '0' COMMENT '准确性评分 1-5',
  `score_timeliness` tinyint DEFAULT '0' COMMENT '时效性评分 1-5',
  `score_operability` tinyint DEFAULT '0' COMMENT '可操作性评分 1-5',
  `score_reusability` tinyint DEFAULT '0' COMMENT '可复用性评分 1-5',
  `score_traceability` tinyint DEFAULT '0' COMMENT '可追溯性评分 1-5',
  `score_total` tinyint DEFAULT '0' COMMENT '六维总分',
  `major_version` int DEFAULT '1' COMMENT '主版本',
  `minor_version` int DEFAULT '0' COMMENT '次版本',
  `patch_version` int DEFAULT '0' COMMENT '修订版本',
  `version_label` varchar(20) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (concat(`major_version`,_utf8mb4'.',`minor_version`,_utf8mb4'.',`patch_version`)) STORED COMMENT '版本标签 计算列',
  `status` enum('draft','pending_review','approved','rejected','archived') COLLATE utf8mb4_unicode_ci DEFAULT 'draft' COMMENT '状态',
  `reviewer_id` int DEFAULT NULL COMMENT '审核员 ID',
  `reviewed_at` datetime DEFAULT NULL COMMENT '审核时间',
  `review_comment` text COLLATE utf8mb4_unicode_ci COMMENT '审核意见',
  `next_review_date` date DEFAULT NULL COMMENT '下次复审日期',
  `review_cycle` enum('weekly','monthly','quarterly','semi_annual') COLLATE utf8mb4_unicode_ci DEFAULT 'monthly' COMMENT '复审周期',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '录入人',
  `updated_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最后更新人',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `entry_code` (`entry_code`),
  KEY `idx_knowledge_type` (`knowledge_type`),
  KEY `idx_scene` (`scene`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_score_total` (`score_total`),
  FULLTEXT KEY `idx_fulltext` (`title`,`summary`,`full_content`) /*!50100 WITH PARSER `ngram` */ 
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识条目主表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kb_entries`
--

LOCK TABLES `kb_entries` WRITE;
/*!40000 ALTER TABLE `kb_entries` DISABLE KEYS */;
INSERT INTO `kb_entries` (`id`, `entry_code`, `title`, `knowledge_type`, `architecture_layer`, `scene`, `severity`, `summary`, `full_content`, `raw_input`, `score_completeness`, `score_accuracy`, `score_timeliness`, `score_operability`, `score_reusability`, `score_traceability`, `score_total`, `major_version`, `minor_version`, `patch_version`, `status`, `reviewer_id`, `reviewed_at`, `review_comment`, `next_review_date`, `review_cycle`, `created_by`, `updated_by`, `created_at`, `updated_at`) VALUES (18,'KB-20250101-003','客户沟通经验','experience_rule','solution','客户沟通','P2-一般','客户沟通经验规则','与客户沟通时应注意倾听、记录要点、及时反馈。',NULL,4,4,3,4,3,4,22,0,1,0,'archived',1,'2026-07-28 15:25:03','内容完整，审核通过','2026-08-27','monthly','admin',NULL,'2026-07-28 09:29:40','2026-07-29 09:04:48'),(19,'KB-20250101-004','新产品上线场景画像','scene_portrait','scene','新产品上线','P2-一般','新产品上线场景画像','新产品上线时需要考虑的各方面因素。',NULL,0,0,0,0,0,0,0,1,0,0,'archived',NULL,NULL,NULL,NULL,'monthly','admin',NULL,'2026-07-28 09:29:40','2026-07-28 09:29:40'),(20,'KB-20250101-005','数据处理工具脚本','tool_script','tool','数据处理','P3-轻微','数据处理工具脚本','用于批量数据处理的Python脚本。',NULL,0,0,0,0,0,0,0,1,0,0,'archived',1,'2026-07-28 09:29:41','内容不够详细，请补充',NULL,'monthly','admin',NULL,'2026-07-28 09:29:40','2026-07-29 09:09:12'),(21,'KB-20250101-006','智能客服AI模板','ai_template','tool','客服自动化','P2-一般','智能客服AI应答模板','基于大模型的智能客服应答模板，支持多轮对话。',NULL,7,8,9,7,6,8,7,1,0,0,'rejected',1,'2026-07-28 09:29:49','内容不完整，需要补充',NULL,'monthly','admin',NULL,'2026-07-28 09:29:40','2026-07-28 09:29:48'),(25,'KB-20260728-001','PLC与106主机通信时断时续','fault_case','fault','古贤大坝导流洞隧道','P2-一般','古贤大坝导流洞隧道内，PLC与106主机通信时断时续，导致平台下发任务失败。经ping测试排查，确认为软件逻辑问题，已交由研发解决。','# PLC与106主机通信时断时续\n\n## 故障现象\nPLC与106主机通信时断时续，导致平台下发任务失败。\n\n## 排查过程\n1. 使用ping测试网络连通性\n2. 最终确认为软件逻辑问题\n\n## 根因\n软件逻辑问题（具体细节待研发确认）\n\n## 解决方案\n已交由研发解决，待反馈具体方案及时间。\n\n## 责任人\n赵永祥','项目现场问题汇总及协调事项——一、通信问题：1.PLC与106主机通信时断时续，导致平台下发任务失败；现场使用业主提供的华三AP，多倍通厂家建议更换为多倍通自有AP；需补发多倍通终端外接天线。请赵总联系售后，确认AP及天线的具体发货时间。',1,4,5,5,1,5,21,1,0,0,'archived',1,'2026-07-28 15:26:05',NULL,'2026-08-27','monthly','admin',NULL,'2026-07-28 14:40:14','2026-07-29 09:04:29'),(26,'KB-20260728-002','AGV-007 启动时无法启动（BMS短路导致保险丝熔断）','fault_case','fault','仓库A','P2-一般','AGV-007在仓库A启动时因BMS短路导致保险丝熔断，更换50A保险丝并重置BMS后充电恢复正常。','# 故障现象\n按下启动按钮后无任何响应，控制面板黑屏，急停按钮已复位。\n\n# 排查过程\n1. 测量电池电压为 0V\n2. 检查充电器输出正常\n3. 拆开电池仓发现保险丝熔断\n\n# 根因\n电池管理系统(BMS)短路导致保险丝熔断\n\n# 解决方案\n更换 50A 保险丝，重置 BMS 后充电 2 小时恢复正常。','录入故障案例：场景为[仓库A]，[AGV-007]在[启动操作]时出现[无法启动]故障。现象：按下启动按钮后无任何响应，控制面板黑屏，急停按钮已复位。排查过程：1.测量电池电压为 0V  2.检查充电器输出正常  3.拆开电池仓发现保险丝熔断。根因：电池管理系统(BMS)短路导致保险丝熔断。解决方案：更换 50A 保险丝，重置 BMS 后充电 2 小时恢复正常。架构层：L1',1,1,1,1,2,2,8,1,0,0,'archived',1,'2026-07-28 15:26:22',NULL,'2026-08-27','monthly','admin',NULL,'2026-07-28 15:04:21','2026-07-29 09:00:24'),(28,'KB-20260728-003','AGV-ms4bjzti3wos92 Z轴驱动器过载故障','fault_case','fault','自动化立体库-Zms4bjzti3wos92','P2-一般','AGV在码垛作业时出现Z轴驱动器过载报警（E-402），原因为托盘定位偏移导致Z轴与托盘干涉，清除导轨异物并调整定位机构后故障消除。','# 故障现象\n机器人码垛过程中Z轴突然停止，示教器显示\"驱动器过载\"报警代码E-402。\n\n# 排查过程\n1. 检查Z轴机械结构，发现导轨有异物卡滞；\n2. 清除异物后手动盘车正常；\n3. 重新上电后故障消除。\n\n# 根因\n码垛位托盘定位偏移导致Z轴与托盘干涉，触发驱动器过载保护。\n\n# 解决方案\n调整托盘定位机构，增加防偏传感器，修改码垛程序增加防碰撞检测。','录入故障案例：场景为[自动化立体库-Zms4bjzti3wos92]，[AGV-ms4bjzti3wos92 Z轴驱动器过载故障]在[码垛作业]时出现[Z轴驱动器过载报警]故障。现象：机器人码垛过程中Z轴突然停止，示教器显示\"驱动器过载\"报警代码E-402。排查过程：1)检查Z轴机械结构，发现导轨有异物卡滞；2)清除异物后手动盘车正常；3)重新上电后故障消除。根因：码垛位托盘定位偏移导致Z轴与托盘干涉，触发驱动器过载保护。解决方案：调整托盘定位机构，增加防偏传感器，修改码垛程序增加防碰撞检测。架构层：L2',4,5,4,3,4,5,25,1,0,0,'archived',1,'2026-07-28 23:11:44','审核通过，内容完整','2026-08-27','monthly','admin',NULL,'2026-07-28 15:13:17','2026-07-28 23:52:00'),(29,'KB-20260728-004','设备故障排查标准引导话术','ai_template','standard','其他','P2-一般','AI 助手引导员工描述设备故障时的标准提问模板，按设备标识、故障现象、排查过程、根因方案的顺序引导，每次最多3个问题。','# 设备故障排查标准引导话术\n\n## 适用场景\nAI 助手引导员工描述设备故障时的标准提问模板。\n\n## 模板内容\n当识别到录入意图为故障案例时，AI 按以下顺序引导：\n1. 先问设备标识（设备编号、位置、所属产线）\n2. 再问故障现象（具体表现、是否有报警代码、频率）\n3. 然后问排查过程（已做了哪些检查、检查结果）\n4. 最后问根因和解决方案（如果已知）\n\n每次最多 3 个问题，避免一次性信息过载。','录入AI模板：\n标题：设备故障排查标准引导话术\n适用场景：AI 助手引导员工描述设备故障时的标准提问模板\n模板内容：当识别到录入意图为故障案例时，AI 按以下顺序引导：\n1. 先问设备标识（设备编号、位置、所属产线）\n2. 再问故障现象（具体表现、是否有报警代码、频率）\n3. 然后问排查过程（已做了哪些检查、检查结果）\n4. 最后问根因和解决方案（如果已知）\n每次最多 3 个问题，避免一次性信息过载\n架构层：L4',0,0,0,0,0,0,0,1,0,0,'archived',1,'2026-07-28 23:11:44','内容不完整，需要补充',NULL,'monthly','admin',NULL,'2026-07-28 15:19:29','2026-07-28 23:28:08'),(30,'KB-20260728-005','堆垛机-03 自动取货定位偏移','fault_case','fault','立体仓库B区','P2-一般','堆垛机-03 在自动取货时出现定位偏移，货叉伸出位置偏差约 5cm。根因为地基沉降导致轨道接头不平，调整轨道接头垫片并重新校准后恢复。','# 堆垛机-03 自动取货定位偏移\n\n## 故障现象\n堆垛机到达目标货位后，货叉伸出位置偏差约 5cm，导致无法取货。\n\n## 排查过程\n1. 查看编码器读数正常\n2. 检查行走轮磨损情况\n3. 发现轨道接头处有 3mm 沉降\n\n## 根因\n地基沉降导致轨道接头不平，堆垛机行驶到该位置时累积误差超限。\n\n## 解决方案\n调整轨道接头垫片，重新校准原点位置，每月检查轨道水平度。','录入故障案例：场景为[立体仓库B区]，[堆垛机-03]在[自动取货]时出现[定位偏移]故障。\n现象：堆垛机到达目标货位后，货叉伸出位置偏差约 5cm，导致无法取货\n排查过程：1.查看编码器读数正常  2.检查行走轮磨损情况  3.发现轨道接头处有 3mm 沉降\n根因：地基沉降导致轨道接头不平，堆垛机行驶到该位置时累积误差超限\n解决方案：调整轨道接头垫片，重新校准原点位置，每月检查轨道水平度\n架构层：L1',0,0,0,0,0,0,0,1,0,0,'archived',NULL,NULL,NULL,NULL,'monthly','admin',NULL,'2026-07-28 15:19:44','2026-07-29 09:09:12');
/*!40000 ALTER TABLE `kb_entries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kb_tags`
--

DROP TABLE IF EXISTS `kb_tags`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entry_id` int NOT NULL,
  `tag_name` varchar(50) NOT NULL,
  `tag_type` enum('scene','device','fault_type','tech_stack','custom') DEFAULT 'custom',
  PRIMARY KEY (`id`),
  KEY `idx_entry_id` (`entry_id`),
  KEY `idx_tag_name` (`tag_name`),
  CONSTRAINT `kb_tags_ibfk_1` FOREIGN KEY (`entry_id`) REFERENCES `kb_entries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='标签表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kb_tags`
--

LOCK TABLES `kb_tags` WRITE;
/*!40000 ALTER TABLE `kb_tags` DISABLE KEYS */;
/*!40000 ALTER TABLE `kb_tags` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kb_users`
--

DROP TABLE IF EXISTS `kb_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `display_name` varchar(50) NOT NULL,
  `role` enum('contributor','reviewer','admin') DEFAULT 'contributor',
  `password_hash` varchar(255) NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `login_attempts` int NOT NULL DEFAULT '0' COMMENT '连续登录失败次数',
  `locked_until` datetime DEFAULT NULL COMMENT '账户锁定截止时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kb_users`
--

LOCK TABLES `kb_users` WRITE;
/*!40000 ALTER TABLE `kb_users` DISABLE KEYS */;
INSERT INTO `kb_users` VALUES (1,'admin','系统管理员','admin','$2b$10$BoxbY.15IRuGMeo4GW.oTuyMeAnJjKspqcemAoRg5OYOMblCGB55S',1,'2026-07-28 01:29:50',1,NULL),(2,'test_user_1785201031970','测试用户','contributor','$2b$10$p3PQEzrKSqoD9q5DD07gD.UNUbYlUwTx0fK9F7uas5d8fnUOtG6oK',1,'2026-07-28 09:10:32',0,NULL),(3,'test_user_1785201427667','测试用户','contributor','$2b$10$LdxIOMQ33/inAL9Tvjn8pOX4yvHXkWvtd1BtUCCu/QpTfGUkCcLgC',1,'2026-07-28 09:17:07',0,NULL),(4,'perm_test_user','权限测试用户','contributor','$2b$10$GCykLB/luMSNgFlEJ6oi9O7pmiooilC/XhG1fY99tdJqV9VcXkUHC',1,'2026-07-28 09:17:07',0,NULL),(5,'test_user_1785201766034','测试用户','contributor','$2b$10$SfCU2t2UV4Vuk7CwSUW9J.rpGFPA1PPFzUa9blTTp1P1RA/NMB0N6',1,'2026-07-28 09:22:46',0,NULL),(6,'test_user_1785201797725','测试用户','contributor','$2b$10$/hf9G5I8gLHipZYO/VGyO.f.EPzTWxNEppOfeWwteexf100.9zW96',1,'2026-07-28 09:23:17',0,NULL),(7,'perm_test_1785201798064','权限测试用户','contributor','$2b$10$3Zw5ZIsTtovXgyfWiN9t4.qQ98O7UDXmmWyjfMhOBoSlBO6/.bfWi',1,'2026-07-28 09:23:18',0,NULL),(8,'test_user_1785202188750','测试用户','contributor','$2b$10$redHGXyDcMby68HlJezhi.UrOhgCpL2xgpvHDWjPsO4YP92S9kal6',1,'2026-07-28 09:29:48',0,NULL),(9,'perm_test_1785202188891','权限测试用户','contributor','$2b$10$jrAzr/tf2oaL0fXxk9PZaO2Gj8xQUEWYvvyXqoHOjXVod9QSQoaPC',1,'2026-07-28 09:29:48',0,NULL),(10,'test_user_1785202401977','测试用户','contributor','$2b$10$.bkBKbicXUDFG0BkH6i6queNUQNsnFHcmN8MB8AcY6k/Z2RDn7nim',1,'2026-07-28 09:33:22',0,NULL),(11,'perm_test_1785202402116','权限测试用户','contributor','$2b$10$PPoVubeQB2iWKbFsPlVBVuvwPEVi8X7JvuGOiEN0PLg5itekqHMTG',1,'2026-07-28 09:33:22',0,NULL),(12,'test_user_1785251504061','测试用户','contributor','$2b$10$rxTUeFRTJFmcVAMIPCm61u66E/dFHd.WCUA4sNGW/64iBij0jBVGW',1,'2026-07-28 23:11:44',0,NULL),(13,'perm_test_1785251504229','权限测试用户','contributor','$2b$10$RrrLTyoQJ1bL/.eaH9YrKu1GKWbmnuqKNoIaJ62AN4jWVbg2Uhx0y',1,'2026-07-28 23:11:44',0,NULL),(14,'test_user_1785252488807','测试用户','contributor','$2b$10$QejNJ30LzL0.8//cy5hy8OYhBtr5Synbbk5vptzD4ESXD6hZ5lJWG',1,'2026-07-28 23:28:08',0,NULL),(15,'perm_test_1785252488963','权限测试用户','contributor','$2b$10$D/2GqwpML95Fqt2yLJ/y8eP.3fiPVi.cfEqHQJoLiVhEvCpIn7oCa',1,'2026-07-28 23:28:09',0,NULL),(16,'test_user_1785253919913','测试用户','contributor','$2b$10$.0qSkrr7pVM3wnwCB6irA.I56whVLtmA7js8GlY7Hel5xwuqZDlgq',1,'2026-07-28 23:51:59',0,NULL),(17,'perm_test_1785253920063','权限测试用户','contributor','$2b$10$nGAH/ryS6K79NYxgsAlRkOR4MXrUB0Olc8Vu9MyHFHoNdXjznDNRa',1,'2026-07-28 23:52:00',0,NULL),(18,'test_user_1785286824747','测试用户','contributor','$2b$10$331I89wiLaEuIaBYZ/poPeb6puUjNJCV2gEAFEItTWA/cgoVb9206',1,'2026-07-29 09:00:24',0,NULL),(19,'perm_test_1785286824917','权限测试用户','contributor','$2b$10$cWgQoUFd8jCljvl8fOzxkOpd.qoi7SObH7t8bEW5LkI2lyE.xIZ8C',1,'2026-07-29 09:00:24',0,NULL),(20,'test_strong1','Strong','contributor','$2b$10$.pswlS0if3XmcSWajndI9OKlVWaFvPFxmxJquAF1xvaq.ySk7MPfy',1,'2026-07-29 09:04:21',0,NULL),(21,'test_user_1785287088324','测试用户','contributor','$2b$10$5waDZu/.MbTDPHjYGt5bNuJcvwKJL8ZlcJ534Ec3SjR0dg2IaXANG',1,'2026-07-29 09:04:48',0,NULL),(22,'perm_test_1785287088464','权限测试用户','contributor','$2b$10$QHqqoGzBc2E93nzXArZC0eW2BOaFSfOqIqhJ4ZbRBnvx9rXu4k4QW',1,'2026-07-29 09:04:48',0,NULL),(23,'test_user_1785287351968','测试用户','contributor','$2b$10$rvIgJB/1xSu95C8AjxuQ7eyaPezGuIBeZ8jlxJTy0xBDNbLXk9E1m',1,'2026-07-29 09:09:12',0,NULL),(24,'perm_test_1785287352135','权限测试用户','contributor','$2b$10$kYsvBBnWMyuXFZ026rFcUOIX1f0fllh5uaeeuE6946V9j0KEDIeMS',1,'2026-07-29 09:09:12',0,NULL),(25,'e2ec_1785293230083','E2E贡献者','contributor','$2b$10$Dm6iGEk6nctBnI2S2e4sFeJjMJmFEksQEcZKfTSWqsV1qK6Mv3M/m',1,'2026-07-29 10:47:10',0,NULL),(26,'e2er_1785293230083','E2E审核员','reviewer','$2b$10$VKyb7TT1vvA0oeOqet8cNORdn/6EThUywVDrQHvAAptXLtcs546bi',1,'2026-07-29 10:47:10',0,NULL),(27,'e2er_1785293323409','E2E审核','reviewer','$2b$10$Curng3ZMZUzXisXnP0FOT.heEQSzmfnrYwilB2H4If8U0FvY5Ay.m',1,'2026-07-29 10:48:43',0,NULL),(28,'e2ec_1785293393389','E2E贡献者','contributor','$2b$10$QHHOzLQlo.tuFlqconHe6uFJtQm61.2Om20FjZgm5EPXIF1/bibUm',1,'2026-07-29 10:49:53',0,NULL),(29,'e2er_1785293393389','E2E审核','reviewer','$2b$10$b3wKgc2ncuP5kEmEcqkJre6eJ51W/tUTPVwY0iKFQBNZUT2vmG7ay',1,'2026-07-29 10:49:53',0,NULL);
/*!40000 ALTER TABLE `kb_users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kb_version_history`
--

DROP TABLE IF EXISTS `kb_version_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_version_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entry_id` int NOT NULL,
  `version_label` varchar(20) NOT NULL COMMENT '快照时的版本标签',
  `change_summary` varchar(500) NOT NULL COMMENT '变更摘要',
  `changed_by` varchar(50) NOT NULL,
  `full_content_snapshot` mediumtext NOT NULL COMMENT '完整内容快照',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_entry_id` (`entry_id`),
  CONSTRAINT `kb_version_history_ibfk_1` FOREIGN KEY (`entry_id`) REFERENCES `kb_entries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='版本历史表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kb_version_history`
--

LOCK TABLES `kb_version_history` WRITE;
/*!40000 ALTER TABLE `kb_version_history` DISABLE KEYS */;
/*!40000 ALTER TABLE `kb_version_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping events for database 'kb_db'
--

--
-- Dumping routines for database 'kb_db'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-29 10:52:09
