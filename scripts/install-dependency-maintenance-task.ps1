param(
  [string]$TaskName = "YehThatRocks Dependency Maintenance",
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $RepoRoot "scripts\maintain-dependencies.ps1"
$pwsh = (Get-Command pwsh).Source

$dryRunFlag = if ($DryRun) { "-DryRun" } else { "" }

$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $dryRunFlag"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 3:17am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Scheduled task '$TaskName' registered." -ForegroundColor Green
Write-Host "  Script : $scriptPath" -ForegroundColor Green
if ($DryRun) {
  Write-Host "  Mode   : DRY RUN (no commits, no push)" -ForegroundColor Yellow
} else {
  Write-Host "  Mode   : LIVE (commits + push on success)" -ForegroundColor Green
}
Write-Host ""
Write-Host "The task runs every Monday at 3:17am."
Write-Host "For daily updates, open Task Scheduler and change the trigger to Daily."
Write-Host ""
Write-Host "GitHub Actions also runs this pipeline daily at 03:17 UTC."
Write-Host "See: .github/workflows/auto-update-deps.yml"
