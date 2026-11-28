<#
.SYNOPSIS
  복원 리허설: 최신 백업(.dump)을 임시 DB(기본 Mosco_restore_check)에 복원하고,
  테이블 수 · 행 수를 확인한 뒤 임시 DB를 삭제한다. 운영 DB는 읽기만 한다(행 수 비교용).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\db_restore_test.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\db_restore_test.ps1 -DumpFile C:\MoscoBackup\Mosco_20261128_023000.dump -KeepDb

  - 결과는 <BackupDir>\restore_test.log 에 한 줄 기록. 실패하면 종료코드 1.
  - 임시 DB 이름에는 반드시 'restore' 가 들어가야 하고, 운영 DB 이름과 같으면 거부한다.
#>
param(
    [string]$BackupDir = 'C:\MoscoBackup',
    [string]$DumpFile = '',
    [string]$ScratchDb = 'Mosco_restore_check',
    [string]$EnvFile = '',
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
    [switch]$KeepDb
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'MoscoDbEnv.ps1')
if (-not $EnvFile) { $EnvFile = Join-Path (Split-Path -Parent $scriptDir) 'backend\.env' }

$started = Get-Date
$logFile = Join-Path $BackupDir 'restore_test.log'
$previousPgPassword = $env:PGPASSWORD
$previousPgEncoding = $env:PGCLIENTENCODING
$createdScratch = $false

function Write-RestoreLog([string]$status, [string]$message) {
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $status, $message
    Write-Host $line
    try {
        if (Test-Path -LiteralPath $BackupDir) { Add-Content -LiteralPath $script:logFile -Value $line -Encoding UTF8 }
    } catch {}
}

# 각 테이블의 실제 행 수 (count(*)), "테이블|행수" 형식
$rowCountSql = @"
SELECT table_name || '|' || (xpath('/row/c/text()',
       query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
"@

function Get-RowCounts([string]$psql, $db, [string]$database) {
    $r = Invoke-Native $psql @('-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '--no-password',
        '-h', $db.Host, '-p', $db.Port, '-U', $db.User, '-d', $database, '-c', $rowCountSql)
    if ($r.ExitCode -ne 0) { throw "행 수 조회 실패 ($database): " + ($r.Output -join ' | ') }
    $counts = [ordered]@{}
    foreach ($line in $r.Output) {
        $parts = $line.Split('|')
        if ($parts.Count -eq 2) { $counts[$parts[0]] = [long]$parts[1] }
    }
    return $counts
}

try {
    $db = Get-MoscoDbSettings $EnvFile
    if ($ScratchDb -notmatch 'restore') { throw "임시 DB 이름에는 'restore' 가 들어가야 합니다: $ScratchDb" }
    if ($ScratchDb -eq $db.Name) { throw "임시 DB 이름이 운영 DB($($db.Name))와 같습니다." }
    if ($ScratchDb -notmatch '^[A-Za-z0-9_]+$') { throw "임시 DB 이름은 영문/숫자/밑줄만 사용하세요: $ScratchDb" }

    if (-not $DumpFile) {
        $latest = Get-ChildItem -LiteralPath $BackupDir -File -Filter '*.dump' -ErrorAction Stop |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $latest) { throw "백업 파일(*.dump)이 없습니다: $BackupDir" }
        $DumpFile = $latest.FullName
    }
    if (-not (Test-Path -LiteralPath $DumpFile)) { throw "백업 파일이 없습니다: $DumpFile" }

    $psql = Find-PgTool $PgBin 'psql'
    $createdb = Find-PgTool $PgBin 'createdb'
    $dropdb = Find-PgTool $PgBin 'dropdb'
    $pgRestore = Find-PgTool $PgBin 'pg_restore'

    $env:PGPASSWORD = $db.Password
    $env:PGCLIENTENCODING = 'UTF8'
    $conn = @('-h', $db.Host, '-p', $db.Port, '-U', $db.User, '--no-password')

    Write-Host "복원 리허설: $DumpFile -> $ScratchDb"
    $r = Invoke-Native $dropdb ($conn + @('--if-exists', $ScratchDb))
    if ($r.ExitCode -ne 0) { throw '이전 임시 DB 삭제 실패: ' + ($r.Output -join ' | ') }
    $r = Invoke-Native $createdb ($conn + @('-T', 'template0', '-E', 'UTF8', $ScratchDb))
    if ($r.ExitCode -ne 0) { throw '임시 DB 생성 실패: ' + ($r.Output -join ' | ') }
    $createdScratch = $true

    $jobs = [Math]::Max(1, [Math]::Min(4, [Environment]::ProcessorCount))
    $r = Invoke-Native $pgRestore ($conn + @('--no-owner', '--no-privileges', '--exit-on-error', '-j', "$jobs", '-d', $ScratchDb, $DumpFile))
    if ($r.ExitCode -ne 0) { throw "pg_restore 실패 (종료코드 $($r.ExitCode)): " + ($r.Output -join ' | ') }

    # 확인 1: 테이블 수 · 행 수
    $restored = Get-RowCounts $psql $db $ScratchDb
    if ($restored.Count -eq 0) { throw '복원된 DB에 테이블이 없습니다.' }
    $totalRows = ($restored.Values | Measure-Object -Sum).Sum

    # 확인 2: 현재 운영 DB와 비교 (백업 이후 변경분만큼 차이는 정상 → 경고만)
    $warnings = @()
    try {
        $live = Get-RowCounts $psql $db $db.Name
        $missing = @($live.Keys | Where-Object { -not $restored.Contains($_) })
        if ($missing.Count -gt 0) { $warnings += "복원본에 없는 테이블: $($missing -join ', ')" }
        foreach ($t in $restored.Keys) {
            if ($live.Contains($t) -and $live[$t] -ne $restored[$t]) {
                $warnings += "$t 행 수 차이 (백업 $($restored[$t]) / 현재 $($live[$t]))"
            }
        }
    } catch {
        $warnings += "운영 DB 비교 생략: $($_.Exception.Message)"
    }

    # 확인 3: 함수 · 트리거 · 인덱스가 복원되었는지 (개수 표시)
    $objSql = "SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') || '|' || " +
              "(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) || '|' || " +
              "(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public')"
    $r = Invoke-Native $psql @('-X', '-q', '-At', '--no-password', '-h', $db.Host, '-p', $db.Port, '-U', $db.User, '-d', $ScratchDb, '-c', $objSql)
    $objects = if ($r.ExitCode -eq 0) { ($r.Output -join '').Split('|') } else { @('?', '?', '?') }

    Write-Host ''
    Write-Host '행 수가 많은 테이블 (복원본):'
    $restored.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 10 |
        ForEach-Object { Write-Host ('  {0,-40} {1,12:N0}' -f $_.Key, $_.Value) }
    foreach ($w in $warnings) { Write-Host "  [참고] $w" -ForegroundColor Yellow }
    Write-Host ''

    $seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    $summary = "$([IO.Path]::GetFileName($DumpFile)) -> $ScratchDb : 테이블 $($restored.Count)개, 행 $totalRows, 함수 $($objects[0]), 트리거 $($objects[1]), 인덱스 $($objects[2]), 차이 $($warnings.Count)건, $seconds s"
    Write-RestoreLog 'OK' $summary
    $exitCode = 0
}
catch {
    Write-RestoreLog 'FAIL' $_.Exception.Message
    $exitCode = 1
}
finally {
    if ($createdScratch -and -not $KeepDb) {
        $r = Invoke-Native $dropdb ($conn + @('--if-exists', $ScratchDb))
        if ($r.ExitCode -ne 0) { Write-Host "임시 DB 삭제 실패: $ScratchDb (직접 삭제하세요)" -ForegroundColor Yellow }
        else { Write-Host "임시 DB 삭제: $ScratchDb" }
    } elseif ($createdScratch) {
        Write-Host "임시 DB 유지(-KeepDb): $ScratchDb  (확인 후 dropdb 로 삭제)"
    }
    $env:PGPASSWORD = $previousPgPassword
    $env:PGCLIENTENCODING = $previousPgEncoding
}
exit $exitCode
