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
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & '$RepoDir\\ship.cmd' @Args
}
function fast {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & '$RepoDir\\fast.cmd' @Args
}
"@

$shipCmdPath = Join-Path $TargetCmdDir "ship.cmd"
$fastCmdPath = Join-Path $TargetCmdDir "fast.cmd"

if (-not (Test-Path $TargetCmdDir)) {
  New-Item -ItemType Directory -Path $TargetCmdDir -Force | Out-Null
}

@"
@echo off
setlocal
call "$RepoDir\ship.cmd" %*
endlocal
"@ | Set-Content -Path $shipCmdPath -Encoding ASCII

@"
@echo off
setlocal
call "$RepoDir\fast.cmd" %*
endlocal
"@ | Set-Content -Path $fastCmdPath -Encoding ASCII

Write-Host "Installed PATH command at $shipCmdPath" -ForegroundColor Green
Write-Host "Installed PATH command at $fastCmdPath" -ForegroundColor Green

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
    Write-Host "Added 'ship' and 'fast' functions to $profilePath" -ForegroundColor Green
  } else {
    if ($existing -notmatch "function\s+fast\s*\{") {
      Add-Content -Path $profilePath -Value "`r`nfunction fast {`r`n  param([Parameter(ValueFromRemainingArguments = \$true)][string[]]\$Args)`r`n  & '$RepoDir\\fast.cmd' @Args`r`n}`r`n"
      Write-Host "Added 'fast' function to $profilePath" -ForegroundColor Green
    } else {
      Write-Host "'ship' and 'fast' functions already exist in $profilePath" -ForegroundColor Yellow
    }
  }
}

[Environment]::SetEnvironmentVariable("YTR_VPS_HOST", $VpsHost, "User")
$env:YTR_VPS_HOST = $VpsHost
Write-Host "Saved YTR_VPS_HOST=$VpsHost" -ForegroundColor Green

Write-Host "Open a new PowerShell window, then run: ship or fast" -ForegroundColor Cyan
