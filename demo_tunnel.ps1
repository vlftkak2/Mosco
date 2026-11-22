# 시연용 Cloudflare quick tunnel 실행 (계정 불필요, 실행할 때마다 주소가 새로 발급됨)
#  - ERP(4173), 홈페이지(4174) 각각 https://xxxx.trycloudflare.com 주소 발급
#  - 홈페이지의 "ERP 로그인" 버튼이 ERP 터널 주소로 가도록 public-site-react\dist\erp-url.json 작성
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$cf = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path -LiteralPath $cf)) {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cmd) { throw 'cloudflared 를 찾을 수 없습니다.' }
    $cf = $cmd.Source
}

$logDir = Join-Path $env:TEMP 'mosco_demo'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Start-Tunnel([string]$name, [int]$port) {
    $log = Join-Path $logDir "$name.log"
    Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
    Start-Process -FilePath $cf -WindowStyle Minimized -ArgumentList @(
        'tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$port", '--logfile', "`"$log`""
    ) | Out-Null
    return $log
}

function Wait-TunnelUrl([string]$log, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $log) {
            $text = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
            $m = [regex]::Match([string]$text, 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com')
            if ($m.Success) { return $m.Value }
        }
        Start-Sleep -Milliseconds 700
    }
    return $null
}

Write-Host '  로컬 서버 준비 대기...'
foreach ($p in 8000, 4173, 4174) {
    $url = if ($p -eq 8000) { 'openapi.json' } else { '' }
    $ok = $false
    $deadline = (Get-Date).AddSeconds(60)
    while (-not $ok -and (Get-Date) -lt $deadline) {
        try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$p/$url" -TimeoutSec 3 | Out-Null; $ok = $true }
        catch { Start-Sleep -Milliseconds 700 }
    }
    if (-not $ok) { Write-Host "  [경고] 포트 $p 가 응답하지 않습니다. 해당 서버 창을 확인하세요." -ForegroundColor Yellow }
}

Write-Host '  Cloudflare 터널 생성 중...'
$erpLog = Start-Tunnel 'erp' 4173
$siteLog = Start-Tunnel 'site' 4174
$erpUrl = Wait-TunnelUrl $erpLog 60
$siteUrl = Wait-TunnelUrl $siteLog 60

if (-not $erpUrl -or -not $siteUrl) {
    Write-Host "  [오류] 터널 주소를 받지 못했습니다. 로그: $logDir" -ForegroundColor Red
    Write-Host '  demo_stop.bat 실행 후 demo_start.bat 을 다시 실행해 보세요.' -ForegroundColor Red
    exit 1
}

# 홈페이지 "ERP 로그인" 버튼 → ERP 터널 주소
$json = '{"url":"' + $erpUrl + '/"}'
# dist: 지금 바로 반영 / public: 홈페이지를 다시 빌드해도 유지 (git 제외됨)
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($d in 'public-site-react\dist', 'public-site-react\public') {
    [System.IO.File]::WriteAllText((Join-Path (Join-Path $root $d) 'erp-url.json'), $json, $utf8)
}

# 새 주소가 외부에서 열릴 때까지 확인 (DNS 반영에 몇 초 걸림)
Write-Host '  외부 접속 확인 중...'
foreach ($u in $erpUrl, $siteUrl) {
    $ok = $false
    $deadline = (Get-Date).AddSeconds(45)
    while (-not $ok -and (Get-Date) -lt $deadline) {
        try { Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 8 | Out-Null; $ok = $true }
        catch { Start-Sleep -Seconds 2 }
    }
    $state = if ($ok) { 'OK' } else { '확인 안 됨(잠시 후 다시 열어보세요)' }
    Write-Host "   - $u : $state"
}

$lines = @(
    "홈페이지 : $siteUrl",
    "ERP      : $erpUrl"
)
$lines | Set-Content -LiteralPath (Join-Path $logDir 'urls.txt') -Encoding UTF8
try { ($lines -join "`r`n") | Set-Clipboard } catch {}

Write-Host ''
Write-Host '================================================' -ForegroundColor Green
Write-Host '  외부 접속 주소 (어디서든 접속 가능, 클립보드에 복사됨)' -ForegroundColor Green
Write-Host '================================================' -ForegroundColor Green
$lines | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }
Write-Host '================================================' -ForegroundColor Green
Write-Host '  ※ 터널 주소는 demo_start.bat 을 실행할 때마다 바뀝니다.'
