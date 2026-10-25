$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $repoRoot

$branch = (git branch --show-current).Trim()
if ($branch -ne 'mosco') {
    throw "현재 브랜치가 '$branch'입니다. 배포 브랜치 'mosco'로 전환한 뒤 다시 실행하세요."
}

if (-not (Test-Path -LiteralPath 'backend/.env')) {
    throw 'backend/.env가 없습니다. 먼저 backend/.env.example을 복사해 DB 접속 정보와 비밀값을 설정하세요.'
}

git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'GitHub에서 소스를 가져오지 못했습니다.' }

docker compose up --build --detach --remove-orphans
if ($LASTEXITCODE -ne 0) { throw 'Docker 컨테이너를 빌드하거나 시작하지 못했습니다.' }

docker compose ps
