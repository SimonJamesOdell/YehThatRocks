param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$VpsHost = "root@206.189.122.114",
  [string]$TargetCmdDir = "C:\Scripts"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$profilePaths = @(
  $PROFILE.CurrentUserAllHosts,
  $PROFILE.CurrentUserCurrentHost
) | Select-Object -Unique

$functionBlock = @"
function ship {
  param()
  powershell -NoProfile -ExecutionPolicy Bypass -File '$RepoDir\\deploy\\ship-local.ps1'
}
"@

$cmdPath = Join-Path $TargetCmdDir "ship.cmd"

if (-not (Test-Path $TargetCmdDir)) {
  New-Item -ItemType Directory -Path $TargetCmdDir -Force | Out-Null
}

@"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "$RepoDir\deploy\ship-local.ps1"
"@ | Set-Content -Path $cmdPath -Encoding ASCII

Write-Host "Installed PATH command at $cmdPath" -ForegroundColor Green

foreach ($profilePath in $profilePaths) {
  $profileDir = Split-Path -Parent $profilePath

  if (-not (Test-Path $profileDir)) {
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  }

  if (-not (Test-Path $profilePath)) {
    New-Item -ItemType File -Path $profilePath -Force | Out-Null
  }

  $existing = Get-Content -Raw -Path $profilePath
  if ($existing -notmatch "function\s+ship\s*\{") {
    Add-Content -Path $profilePath -Value "`r`n$functionBlock`r`n"
    Write-Host "Added 'ship' function to $profilePath" -ForegroundColor Green
  } else {
    Write-Host "'ship' function already exists in $profilePath" -ForegroundColor Yellow
  }
}

[Environment]::SetEnvironmentVariable("YTR_VPS_HOST", $VpsHost, "User")
$env:YTR_VPS_HOST = $VpsHost
Write-Host "Saved YTR_VPS_HOST=$VpsHost" -ForegroundColor Green

Write-Host "Open a new PowerShell window, then run: ship" -ForegroundColor Cyan
