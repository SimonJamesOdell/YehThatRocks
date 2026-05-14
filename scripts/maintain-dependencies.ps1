param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".." )).Path,
  [string]$Remote = "origin",
  [string]$Branch = "main",
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

Set-Location $RepoRoot

function Invoke-Native {
  param(
    [string]$Program,
    [string[]]$InvocationArguments = @()
  )

  & $Program @InvocationArguments
  if ($LASTEXITCODE -ne 0) {
    $display = "$Program " + ($InvocationArguments -join " ")
    throw "$display failed with exit code $LASTEXITCODE"
  }
}

function Get-GitStatusTracked {
  $output = & git status --short --untracked-files=no
  if ($LASTEXITCODE -ne 0) {
    throw "git status --short --untracked-files=no failed with exit code $LASTEXITCODE"
  }
  return $output
}

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )

  Write-Host "[$Name] starting" -ForegroundColor Cyan
  & $Action
  Write-Host "[$Name] done" -ForegroundColor Green
}

Invoke-Step -Name "refresh" -Action {
  Invoke-Native -Program "npx" -InvocationArguments @("--yes", "--package", "npm-check-updates", "ncu", "-u")
  Invoke-Native -Program "npx" -InvocationArguments @("--yes", "--package", "npm-check-updates", "ncu", "-u", "--packageFile", "apps/web/package.json")
  Invoke-Native -Program "npm" -InvocationArguments @("install")
}

Invoke-Step -Name "verify" -Action {
  Invoke-Native -Program "npm" -InvocationArguments @("run", "verify:deps:full")
}

Invoke-Step -Name "audit" -Action {
  Invoke-Native -Program "npm" -InvocationArguments @("audit", "--audit-level=high")
}

$status = Get-GitStatusTracked
if (-not $status) {
  Write-Host "No dependency changes to commit." -ForegroundColor Yellow
  exit 0
}

Invoke-Step -Name "commit" -Action {
  Invoke-Native -Program "git" -InvocationArguments @("add", "-A")
  $staged = & git diff --cached --name-only
  if ($LASTEXITCODE -ne 0) {
    throw "git diff --cached --name-only failed with exit code $LASTEXITCODE"
  }
  $staged | Out-Host
  Invoke-Native -Program "git" -InvocationArguments @("commit", "-m", "chore(deps): refresh dependencies")
}

if (-not $SkipPush) {
  Invoke-Step -Name "push" -Action {
    Invoke-Native -Program "git" -InvocationArguments @("push", $Remote, $Branch)
  }
}
