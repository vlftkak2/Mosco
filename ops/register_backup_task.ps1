<#
.SYNOPSIS
  매일 02:30 에 ops\db_backup.ps1 을 실행하는 Windows 예약 작업을 등록한다. (관리자 PowerShell 에서 실행)

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\register_backup_task.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\register_backup_task.ps1 -BackupDir D:\MoscoBackup -SecondaryPath \\NAS\mosco -RetentionDays 30
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\register_backup_task.ps1 -Unregister

  - SYSTEM 계정으로 실행되므로 로그인하지 않아도 동작한다.
    (보조 경로가 네트워크 공유(\\NAS\...)이면 SYSTEM 은 접근 권한이 없을 수 있다 → -RunAsUser 로 사용자 계정 지정)
  - 결과 확인: <BackupDir>\backup.log, 작업 스케줄러의 '마지막 실행 결과'(0 = 성공)
  - 등록 직후 시험 실행: Start-ScheduledTask -TaskName 'Mosco DB Backup'
#>
param(
    [string]$TaskName = 'Mosco DB Backup',
    [string]$At = '02:30',
    [string]$BackupDir = 'C:\MoscoBackup',
    [int]$RetentionDays = 30,
    [string]$SecondaryPath = '',
    [string]$RunAsUser = '',
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw '관리자 권한 PowerShell 에서 실행하세요.' }

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "예약 작업 삭제: $TaskName"
    exit 0
}

$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'db_backup.ps1'
if (-not (Test-Path -LiteralPath $script)) { throw "db_backup.ps1 이 없습니다: $script" }

$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`" -BackupDir `"$BackupDir`" -RetentionDays $RetentionDays"
if ($SecondaryPath) { $arguments += " -SecondaryPath `"$SecondaryPath`"" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew

if ($RunAsUser) {
    $credential = Get-Credential -UserName $RunAsUser -Message '예약 작업을 실행할 계정의 비밀번호'
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
        -User $credential.UserName -Password $credential.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
} else {
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
        -Principal $principal -Force | Out-Null
}

Write-Host "예약 작업 등록: '$TaskName' 매일 $At -> $script"
Write-Host "시험 실행: Start-ScheduledTask -TaskName '$TaskName'  /  로그: $BackupDir\backup.log"
