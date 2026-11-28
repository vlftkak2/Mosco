<#
.SYNOPSIS
  Mosco 배포 / 롤백 (배포 PC에서 저장소 폴더에서 실행)

.EXAMPLE
  .\deploy.ps1                      # 최신 소스 받기 -> 이미지 빌드(태그 = git 짧은 SHA) -> 마이그레이션 확인 -> 컨테이너 교체
  .\deploy.ps1 -Migrate             # 대기 중인 DB 마이그레이션이 있으면 pg_dump 백업 후 적용하고 배포
  .\deploy.ps1 -Rollback 1a2b3c4    # 빌드 없이 이전 태그 이미지로 컨테이너만 되돌림
  .\deploy.ps1 -ListTags            # 롤백 가능한 태그(배포 기록) 보기

  - 대기 중인 마이그레이션이 있는데 -Migrate 가 없으면 컨테이너를 바꾸지 않고 멈춘다.
  - 롤백은 DB 마이그레이션을 되돌리지 않는다 (필요하면 백업으로 복원: DOCKER.md 참고).
#>
param(
    [string]$Rollback = '',
    [switch]$Migrate,
    [switch]$SkipBackup,
    [switch]$SkipPull,
    [switch]$ListTags,
    [int]$KeepTags = 5,
    [string]$BackupDir = 'C:\MoscoBackup'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $repoRoot

$imageRepos = @('mosco-backend', 'mosco-frontend', 'mosco-proxy')
$historyDir = Join-Path $repoRoot '.deploy'
$historyFile = Join-Path $historyDir 'history.txt'

function Read-DeployHistory {
    if (-not (Test-Path -LiteralPath $historyFile)) { return @() }
    $rows = @()
    foreach ($line in Get-Content -LiteralPath $historyFile -Encoding UTF8) {
        $parts = $line.Split("`t")
        if ($parts.Count -ge 3) { $rows += [pscustomobject]@{ Time = $parts[0]; Tag = $parts[1]; Kind = $parts[2] } }
    }
    return $rows
}

function Add-DeployHistory([string]$tag, [string]$kind) {
    New-Item -ItemType Directory -Force -Path $historyDir | Out-Null
    $line = "{0}`t{1}`t{2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $tag, $kind
    Add-Content -LiteralPath $historyFile -Value $line -Encoding UTF8
}

function Test-ImageExists([string]$reference) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        docker image inspect $reference *> $null
        return ($LASTEXITCODE -eq 0)
    } finally { $ErrorActionPreference = $prev }
}

function Assert-ProductionEnv {
    $envPath = Join-Path $repoRoot 'backend/.env'
    if (-not (Test-Path -LiteralPath $envPath)) {
        throw 'backend/.env가 없습니다. 먼저 backend/.env.example을 복사해 DB 접속 정보와 비밀값을 설정하세요.'
    }
    # backend/config.py 와 같은 방식으로 읽는다 (KEY=VALUE, 따옴표 제거, 처음 나온 값 사용)
    $values = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($envPath, [System.Text.Encoding]::UTF8)) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#') -or -not $t.Contains('=')) { continue }
        $i = $t.IndexOf('=')
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
        if (-not $values.ContainsKey($k)) { $values[$k] = $v }
    }
    $problems = @()
    foreach ($name in 'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD') {
        if (-not $values.ContainsKey($name) -or -not $values[$name]) { $problems += "  - $name 값이 비어 있거나 없습니다." }
    }
    $jwt = ''
    if ($values.ContainsKey('JWT_SECRET_KEY')) { $jwt = [string]$values['JWT_SECRET_KEY'] }
    if ($jwt.Length -lt 32) { $problems += "  - JWT_SECRET_KEY 는 32자 이상이어야 합니다 (현재 $($jwt.Length)자)." }
    if ($problems.Count -gt 0) {
        $message = "backend/.env 설정이 운영 모드(APP_ENV=production) 요구사항을 만족하지 않습니다.`n" +
                   ($problems -join "`n") +
                   "`nbackend/.env 를 수정한 뒤 다시 실행하세요. (JWT 키 예: python -c `"import secrets; print(secrets.token_urlsafe(48))`")"
        throw $message
    }
}

function Invoke-Up([string]$tag) {
    $env:IMAGE_TAG = $tag
    # --wait: 백엔드 healthcheck(/api/health)가 healthy 가 될 때까지 기다림
    # Out-Host: docker 출력이 함수 반환값(성공 여부)에 섞이지 않도록
    docker compose up --detach --no-build --remove-orphans --wait | Out-Host
    return ($LASTEXITCODE -eq 0)
}

function Show-FailureHelp([string]$failedTag) {
    Write-Host ''
    Write-Host '컨테이너가 정상 상태가 되지 않았습니다. 최근 백엔드 로그:' -ForegroundColor Red
    docker compose logs --tail 60 backend | Out-Host
    $previous = Read-DeployHistory | Where-Object { $_.Tag -ne $failedTag } | Select-Object -Last 1
    if ($previous) {
        Write-Host ''
        Write-Host "이전 버전으로 되돌리려면:  .\deploy.ps1 -Rollback $($previous.Tag)" -ForegroundColor Yellow
    }
}

function Remove-OldImageTags([string]$currentTag) {
    if ($KeepTags -lt 1) { return }
    $keep = @{}
    $keep[$currentTag] = $true
    $recent = @(Read-DeployHistory | Where-Object { $_.Kind -eq 'deploy' } | ForEach-Object { $_.Tag })
    [array]::Reverse($recent)
    foreach ($t in $recent) {
        if ($keep.Count -ge $KeepTags) { break }
        $keep[$t] = $true
    }
    foreach ($repo in $imageRepos) {
        $tags = @(docker images $repo --format '{{.Tag}}')
        foreach ($t in $tags) {
            # git SHA 형식의 태그만 정리 (latest 나 손으로 만든 태그는 건드리지 않음)
            if ($t -match '^[0-9a-f]{7,40}$' -and -not $keep.ContainsKey($t)) {
                Write-Host "  오래된 이미지 태그 삭제: ${repo}:$t"
                docker image rm "${repo}:$t" | Out-Null
            }
        }
    }
}

# ---------------------------------------------------------------- 태그 목록
if ($ListTags) {
    $history = Read-DeployHistory
    if (-not $history) { Write-Host '배포 기록이 없습니다.'; exit 0 }
    Write-Host '배포 기록 (최근이 아래):'
    foreach ($h in $history) {
        $state = if (Test-ImageExists "mosco-backend:$($h.Tag)") { '이미지 있음' } else { '이미지 없음' }
        Write-Host ("  {0}  {1,-12} {2,-9} {3}" -f $h.Time, $h.Tag, $h.Kind, $state)
    }
    exit 0
}

$branch = (git branch --show-current).Trim()
if ($branch -ne 'mosco') {
    throw "현재 브랜치가 '$branch'입니다. 배포 브랜치 'mosco'로 전환한 뒤 다시 실행하세요."
}

Assert-ProductionEnv

docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'docker-compose.yml 설정을 해석하지 못했습니다.' }

# ---------------------------------------------------------------- 롤백
if ($Rollback) {
    foreach ($repo in $imageRepos) {
        if (-not (Test-ImageExists "${repo}:$Rollback")) {
            throw "이미지 ${repo}:$Rollback 이 없습니다. '.\deploy.ps1 -ListTags' 로 남아 있는 태그를 확인하세요."
        }
    }
    Write-Host "롤백: 이미지 태그 $Rollback 로 컨테이너를 다시 시작합니다 (빌드 없음, DB 마이그레이션은 되돌리지 않음)."
    if (-not (Invoke-Up $Rollback)) {
        Show-FailureHelp $Rollback
        throw "태그 $Rollback 로 컨테이너를 시작하지 못했습니다."
    }
    foreach ($repo in $imageRepos) { docker tag "${repo}:$Rollback" "${repo}:latest" }
    Add-DeployHistory $Rollback 'rollback'
    docker compose ps
    exit 0
}

# ---------------------------------------------------------------- 배포
if (-not $SkipPull) {
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'GitHub에서 소스를 가져오지 못했습니다.' }
}

$tag = (git rev-parse --short HEAD).Trim()
if (-not $tag) { throw 'git 커밋 해시를 읽지 못했습니다.' }
$dirty = git status --porcelain --untracked-files=no
if ($dirty) { Write-Host "[주의] 커밋되지 않은 변경이 있습니다. 이미지 태그 $tag 는 커밋과 정확히 같지 않습니다." -ForegroundColor Yellow }

$env:IMAGE_TAG = $tag
Write-Host "이미지 빌드: 태그 $tag"
docker compose build
if ($LASTEXITCODE -ne 0) { throw 'Docker 이미지를 빌드하지 못했습니다.' }

# 새 백엔드 이미지로 대기 중인 DB 마이그레이션 확인 (컨테이너 교체 전)
Write-Host 'DB 마이그레이션 확인...'
docker compose run --rm --no-deps -T backend python scripts/migrate.py --check
$checkCode = $LASTEXITCODE
if ($checkCode -eq 3) {
    if (-not $Migrate) {
        throw '대기 중인 DB 마이그레이션이 있습니다. 내용을 확인한 뒤 .\deploy.ps1 -Migrate 로 다시 실행하세요. (현재 컨테이너는 바뀌지 않았습니다.)'
    }
    if (-not $SkipBackup) {
        Write-Host "마이그레이션 전 DB 백업 -> $BackupDir"
        & (Join-Path $repoRoot 'ops\db_backup.ps1') -BackupDir $BackupDir
        if ($LASTEXITCODE -ne 0) { throw 'DB 백업에 실패해 마이그레이션을 중단했습니다. (백업 없이 진행하려면 -SkipBackup)' }
    }
    Write-Host 'DB 마이그레이션 적용...'
    docker compose run --rm --no-deps -T backend python scripts/migrate.py
    if ($LASTEXITCODE -ne 0) { throw 'DB 마이그레이션에 실패했습니다. 컨테이너는 이전 버전 그대로입니다. 위 오류를 확인하세요.' }
} elseif ($checkCode -ne 0) {
    throw 'DB 마이그레이션 상태를 확인하지 못했습니다 (DB 접속 정보를 확인하세요).'
}

Write-Host '컨테이너 교체...'
if (-not (Invoke-Up $tag)) {
    Show-FailureHelp $tag
    throw 'Docker 컨테이너를 시작하지 못했습니다.'
}

foreach ($repo in $imageRepos) { docker tag "${repo}:$tag" "${repo}:latest" }
Add-DeployHistory $tag 'deploy'
Remove-OldImageTags $tag

docker compose ps
Write-Host "배포 완료: $tag"
