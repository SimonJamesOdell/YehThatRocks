param(
  [string]$TaskName = "YehThatRocks Dependency Maintenance",
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".." )).Path
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $RepoRoot "scripts\maintain-dependencies.ps1"
$pwsh = (Get-Command pwsh).Source
$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 3:17am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Scheduled task '$TaskName' registered for $scriptPath" -ForegroundColor Green