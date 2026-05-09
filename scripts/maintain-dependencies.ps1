param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".." )).Path,
  [string]$Remote = "origin",
  [string]$Branch = "main",
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

Set-Location $RepoRoot

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
  npx --yes npm-check-updates -u
  npm install
}

Invoke-Step -Name "verify" -Action {
  npm run verify:invariants
}

Invoke-Step -Name "audit" -Action {
  npm audit --audit-level=high
}

$status = git status --short --untracked-files=no
if (-not $status) {
  Write-Host "No dependency changes to commit." -ForegroundColor Yellow
  exit 0
}

Invoke-Step -Name "commit" -Action {
  git add -A
  git diff --cached --name-only | Out-Host
  git commit -m "chore(deps): refresh dependencies"
}

if (-not $SkipPush) {
  Invoke-Step -Name "push" -Action {
    git push $Remote $Branch
  }
}
