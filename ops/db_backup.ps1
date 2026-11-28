<#
.SYNOPSIS
  Mosco PostgreSQL 백업 (pg_dump -Fc). 매일 예약 작업으로 실행하는 용도.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\db_backup.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\db_backup.ps1 -BackupDir D:\Backup -RetentionDays 14 -SecondaryPath \\NAS\mosco

  - 접속 정보: backend/.env 의 DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (host.docker.internal 은 localhost 로 바꿔 접속)
  - 파일: <BackupDir>\<DB이름>_yyyyMMdd_HHmmss.dump (작성 중에는 .partial, 완료·검증 후 이름 변경)
  - 보관: RetentionDays 일보다 오래된 <DB이름>_*.dump 는 삭제 (보조 경로도 동일)
  - 로그: <BackupDir>\backup.log 에 한 줄씩 기록. 실패하면 종료코드 1.
#>
param(
    [string]$BackupDir = 'C:\MoscoBackup',
    [int]$RetentionDays = 30,
    [string]$SecondaryPath = '',
    [string]$EnvFile = '',
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
    [string]$DbName = ''
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'MoscoDbEnv.ps1')
if (-not $EnvFile) { $EnvFile = Join-Path (Split-Path -Parent $scriptDir) 'backend\.env' }

$started = Get-Date
$logFile = $null
$previousPgPassword = $env:PGPASSWORD

function Write-BackupLog([string]$status, [string]$message) {
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $status, $message
    Write-Host $line
    if ($script:logFile) {
        try { Add-Content -LiteralPath $script:logFile -Value $line -Encoding UTF8 } catch {}
    }
}

function Remove-OldBackups([string]$dir, [string]$prefix, [int]$days) {
    if ($days -le 0 -or -not (Test-Path -LiteralPath $dir)) { return 0 }
    $limit = (Get-Date).AddDays(-$days)
    $old = Get-ChildItem -LiteralPath $dir -File -Filter "$($prefix)_*.dump" |
        Where-Object { $_.LastWriteTime -lt $limit }
    foreach ($f in $old) { Remove-Item -LiteralPath $f.FullName -Force }
    # 실패로 남은 작성 중 파일 정리
    Get-ChildItem -LiteralPath $dir -File -Filter "$($prefix)_*.dump.partial" |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    return @($old).Count
}

try {
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $logFile = Join-Path $BackupDir 'backup.log'

    $db = Get-MoscoDbSettings $EnvFile
    if ($DbName) { $db.Name = $DbName }
    $pgDump = Find-PgTool $PgBin 'pg_dump'
    $pgRestore = Find-PgTool $PgBin 'pg_restore'

    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $safeName = ($db.Name -replace '[^A-Za-z0-9_\-]', '_')
    $target = Join-Path $BackupDir "$($safeName)_$stamp.dump"
    $partial = "$target.partial"

    $env:PGPASSWORD = $db.Password
    $result = Invoke-Native $pgDump @(
        '-h', $db.Host, '-p', $db.Port, '-U', $db.User, '-d', $db.Name,
        '-Fc', '--no-password', '-f', $partial
    )
    if ($result.ExitCode -ne 0) {
        throw ("pg_dump 실패 (종료코드 $($result.ExitCode)): " + ($result.Output -join ' | '))
    }
    if (-not (Test-Path -LiteralPath $partial) -or (Get-Item -LiteralPath $partial).Length -eq 0) {
        throw 'pg_dump 결과 파일이 비어 있습니다.'
    }

    # 덤프 목차를 읽어 파일이 손상되지 않았는지 확인
    $check = Invoke-Native $pgRestore @('--list', $partial)
    if ($check.ExitCode -ne 0) {
        throw ("백업 파일 검증(pg_restore --list) 실패: " + ($check.Output -join ' | '))
    }

    Move-Item -LiteralPath $partial -Destination $target -Force
    $sizeMb = [math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1)

    $copied = ''
    if ($SecondaryPath) {
        New-Item -ItemType Directory -Force -Path $SecondaryPath | Out-Null
        Copy-Item -LiteralPath $target -Destination $SecondaryPath -Force
        $copied = " / 보조 복사: $SecondaryPath"
    }

    $removed = Remove-OldBackups $BackupDir $safeName $RetentionDays
    if ($SecondaryPath) { $removed += Remove-OldBackups $SecondaryPath $safeName $RetentionDays }

    $seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    Write-BackupLog 'OK' "$($db.Name)@$($db.Host) -> $target ($sizeMb MB, $seconds s, 오래된 백업 $removed 개 삭제)$copied"
    exit 0
}
catch {
    if ($partial -and (Test-Path -LiteralPath $partial)) {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }
    Write-BackupLog 'FAIL' $_.Exception.Message
    exit 1
}
finally {
    $env:PGPASSWORD = $previousPgPassword
}
