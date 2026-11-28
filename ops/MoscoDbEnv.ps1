# 공통 함수: backend/.env 에서 DB 접속 정보를 읽는다 (db_backup.ps1, db_restore_test.ps1 이 dot-source 로 사용)
# 비밀번호는 화면/로그에 출력하지 않는다.

function Read-MoscoEnvFile([string]$Path) {
    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $values }
    foreach ($line in [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#') -or -not $t.Contains('=')) { continue }
        $idx = $t.IndexOf('=')
        $key = $t.Substring(0, $idx).Trim()
        $val = $t.Substring($idx + 1).Trim().Trim('"').Trim("'")
        if (-not $values.ContainsKey($key)) { $values[$key] = $val }
    }
    return $values
}

function Get-MoscoDbSettings([string]$EnvFile) {
    # backend/config.py 와 같은 규칙: 환경변수 > backend/.env > 개발 기본값
    $fileValues = Read-MoscoEnvFile $EnvFile
    function Pick([string]$name, [string]$default) {
        $fromEnv = [Environment]::GetEnvironmentVariable($name)
        if ($fromEnv) { return $fromEnv }
        if ($fileValues.ContainsKey($name) -and $fileValues[$name]) { return $fileValues[$name] }
        return $default
    }
    $settings = [ordered]@{
        Host     = Pick 'DB_HOST' 'localhost'
        Port     = Pick 'DB_PORT' '5432'
        Name     = Pick 'DB_NAME' 'Mosco'
        User     = Pick 'DB_USER' 'postgres'
        Password = Pick 'DB_PASSWORD' ''
    }
    # 컨테이너용 주소는 배포 PC(호스트)에서는 localhost 로 접속
    if ($settings.Host -eq 'host.docker.internal') { $settings.Host = 'localhost' }
    if (-not $settings.Password) {
        if ($env:PGPASSWORD) { $settings.Password = $env:PGPASSWORD }
        else { $settings.Password = '1234' }   # config.py 개발 기본값과 동일 (운영 .env 에는 반드시 DB_PASSWORD 지정)
    }
    return $settings
}

function Find-PgTool([string]$PgBin, [string]$Name) {
    $p = Join-Path $PgBin "$Name.exe"
    if (Test-Path -LiteralPath $p) { return $p }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "$Name.exe 를 찾을 수 없습니다. -PgBin 으로 PostgreSQL bin 폴더를 지정하세요. (기본: $PgBin)"
}

# 네이티브 명령 실행: 표준오류를 문자열로 모아 돌려준다 (PowerShell 5.1 에서 2>&1 이 예외가 되지 않도록 Continue 로 실행)
function Invoke-Native([string]$Exe, [string[]]$Arguments) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
    return [pscustomobject]@{ ExitCode = $code; Output = @($output) }
}
