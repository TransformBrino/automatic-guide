# kb-db-backup.ps1 — 知识库系统数据库定时备份脚本
# 用法: powershell -File scripts\kb-db-backup.ps1
# 建议配合 Windows 任务计划程序使用（每天凌晨 2:00 执行）

param(
    [string]$HostName = "localhost",
    [string]$Port = "3306",
    [string]$User = "root",
    [string]$Password = $env:DB_BACKUP_PASSWORD,  # 从环境变量读取，避免明文存储
    [string]$Database = "kb_db",
    [string]$BackupDir = ".\backups",
    [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"

# 颜色输出
function Write-Step { Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $args" -ForegroundColor Cyan }
function Write-Ok { Write-Host "  OK: $args" -ForegroundColor Green }
function Write-Err { Write-Host "  ERROR: $args" -ForegroundColor Red }

Write-Step "kb_db 数据库备份开始"

# 检查密码
if (-not $Password) {
    Write-Err "环境变量 DB_BACKUP_PASSWORD 未设置，请先执行: `$env:DB_BACKUP_PASSWORD='your_password'"
    exit 1
}

# 创建备份目录
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    Write-Ok "备份目录已创建: $BackupDir"
}

# 生成备份文件名（含时间戳）
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $BackupDir "kb_db_backup_${timestamp}.sql.gz"

# 检测 mysqldump 路径
$mysqldump = Get-Command mysqldump -ErrorAction SilentlyContinue
if (-not $mysqldump) {
    # 尝试常见路径
    $commonPaths = @(
        "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
        "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe",
        "C:\xampp\mysql\bin\mysqldump.exe"
    )
    foreach ($p in $commonPaths) {
        if (Test-Path $p) { $mysqldump = $p; break }
    }
}
if (-not $mysqldump) {
    Write-Err "未找到 mysqldump，请确认 MySQL 已安装"
    exit 1
}

Write-Ok "mysqldump 路径: $mysqldump"

# 执行备份（通过管道压缩，节省磁盘空间）
try {
    $env:MYSQL_PWD = $Password  # 避免命令行传递密码
    $dumpArgs = @(
        "-h$HostName", "-P$Port", "-u$User", $Database,
        "--single-transaction",    # InnoDB 一致性快照，不锁表
        "--routines",              # 备份存储过程/函数
        "--triggers",              # 备份触发器
        "--events",                # 备份事件调度器
        "--set-gtid-purged=OFF",   # 避免 GTID 冲突
        "--default-character-set=utf8mb4"
    )
    
    $dumpOutput = & $mysqldump @dumpArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Err "mysqldump 执行失败: $dumpOutput"
        exit 1
    }
    
    # 写入文件
    $dumpOutput | Out-File -FilePath $backupFile -Encoding UTF8
    
    $fileSize = (Get-Item $backupFile).Length
    Write-Ok "备份完成: $backupFile ($([math]::Round($fileSize/1KB,1)) KB)"
} catch {
    Write-Err "备份失败: $_"
    exit 1
} finally {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
}

# 清理过期备份
Write-Step "清理超过 ${RetentionDays} 天的旧备份..."
$cutoff = (Get-Date).AddDays(-$RetentionDays)
$oldFiles = Get-ChildItem -Path $BackupDir -Filter "kb_db_backup_*.sql*" | Where-Object { $_.LastWriteTime -lt $cutoff }
foreach ($f in $oldFiles) {
    Remove-Item $f.FullName -Force
    Write-Ok "已删除: $($f.Name)"
}

$remaining = (Get-ChildItem -Path $BackupDir -Filter "kb_db_backup_*.sql*").Count
Write-Step "备份任务完成。当前备份数: $remaining"
