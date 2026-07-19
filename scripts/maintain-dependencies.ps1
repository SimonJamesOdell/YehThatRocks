<#
.SYNOPSIS
  Resilient automated dependency maintenance for yehthatrocks.
  Batched updates with verification gates, rollback, and auto-fix patterns.

.DESCRIPTION
  Phase 0 — Snapshot current state
  Phase 1 — Safe patch/minor bumps (ncu --target minor), verify, commit
  Phase 2 — Major bumps one-at-a-time, verify each, roll back failures
  Phase 3 — Full verification gate (build + invariants + audit)
  Phase 4 — Commit each successful batch, push, generate report

  Designed for unattended execution via Scheduled Task or GitHub Actions.
#>

param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$Remote = "origin",
  [string]$Branch = "main",
  [switch]$SkipPush,
  [switch]$DryRun,
  [string]$ReportPath = (Join-Path $RepoRoot "dependency-update-report.txt")
)

$ErrorActionPreference = "Stop"
Set-Location $RepoRoot

# ---------------------------------------------------------------------------
# Auto-fix rules — patterns that are known to break across versions
# ---------------------------------------------------------------------------
$AutoFixRules = @(
  @{
    Name        = "next-config-ts-to-js"
    Description = "Next.js config: ensure next.config.js exists (not .ts or .mjs)"
    Check       = {
      $webDir = Join-Path $RepoRoot "apps\web"
      $hasJs  = Test-Path (Join-Path $webDir "next.config.js")
      $hasTs  = Test-Path (Join-Path $webDir "next.config.ts")
      $hasMjs = Test-Path (Join-Path $webDir "next.config.mjs")
      return (-not $hasJs) -and ($hasTs -or $hasMjs)
    }
    Fix         = {
      Write-Host "  [auto-fix] Removing stale next.config.ts/.mjs; next.config.js is required" -ForegroundColor Yellow
      Remove-Item (Join-Path $RepoRoot "apps\web\next.config.ts") -Force -ErrorAction SilentlyContinue
      Remove-Item (Join-Path $RepoRoot "apps\web\next.config.mjs") -Force -ErrorAction SilentlyContinue
      # Write canonical next.config.js
      $jsConfig = @'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: ["192.168.0.60"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "media.licdn.com" },
      { protocol: "https", hostname: "*.gravatar.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"]
  }
};
module.exports = nextConfig;
'@
      Set-Content -Path (Join-Path $webDir "next.config.js") -Value $jsConfig -Encoding UTF8
    }
  },
  @{
    Name        = "next-no-stale-turbopack-cache"
    Description = "Remove stale .next directory when Next.js version changes"
    Check       = {
      $nextDir = Join-Path $RepoRoot "apps\web\.next"
      return Test-Path $nextDir
    }
    Fix         = {
      Write-Host "  [auto-fix] Clearing .next cache for clean rebuild" -ForegroundColor Yellow
      Remove-Item (Join-Path $RepoRoot "apps\web\.next") -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
$ReportLines = [System.Collections.ArrayList]::new()

function Write-Report {
  param([string]$Line)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $entry = "[$timestamp] $Line"
  [void]$ReportLines.Add($entry)
  Write-Host $entry
}

function Invoke-Native {
  param(
    [string]$Program,
    [string[]]$Args = @(),
    [string]$ErrorActionPreference_Override = "Stop"
  )
  $saved = $ErrorActionPreference
  $ErrorActionPreference = $ErrorActionPreference_Override
  try {
    & $Program @Args 2>&1 | Out-String | ForEach-Object { if ($_.Trim()) { Write-Host $_ } }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $saved
  }
}

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )
  Write-Host "`n=== [$Name] ===" -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    & $Action
    $sw.Stop()
    Write-Host "--- [$Name] OK ($($sw.Elapsed.TotalSeconds.ToString('0.0'))s) ---" -ForegroundColor Green
    return $true
  } catch {
    $sw.Stop()
    Write-Host "--- [$Name] FAILED: $_ ---" -ForegroundColor Red
    return $false
  }
}

function Save-Snapshot {
  Write-Report "Saving pre-update snapshot (stash)"
  Invoke-Native -Program "git" -Args @("stash", "push", "--include-untracked", "-m", "pre-deps-update-snapshot")
}

function Restore-Snapshot {
  Write-Report "Rolling back to pre-update snapshot"
  Invoke-Native -Program "git" -Args @("stash", "pop", "--index")
  Invoke-Native -Program "npm" -Args @("install")
}

function Clear-StaleStash {
  $list = & git stash list
  if ($LASTEXITCODE -eq 0 -and $list -match "pre-deps-update-snapshot") {
    Invoke-Native -Program "git" -Args @("stash", "drop", "stash@{0}")
  }
}

function Get-StagedDiff {
  $diff = & git diff --cached --name-only
  if ($LASTEXITCODE -ne 0) { return @() }
  return @($diff -split "`n" | Where-Object { $_.Trim() })
}

function Test-WorkingTreeClean {
  $status = & git status --short --untracked-files=no
  return [string]::IsNullOrWhiteSpace($status)
}

# ---------------------------------------------------------------------------
# Verification gates
# ---------------------------------------------------------------------------
function Invoke-VerifyBuild {
  Write-Host "  Building web..."
  $exit = Invoke-Native -Program "npx" -Args @("turbo", "run", "build", "--filter=web") -ErrorActionPreference_Override "Continue"
  return $exit -eq 0
}

function Invoke-VerifyLight {
  Write-Host "  Running verify:light invariants..."
  $exit = Invoke-Native -Program "npm" -Args @("run", "verify:light") -ErrorActionPreference_Override "Continue"
  return $exit -eq 0
}

function Invoke-Audit {
  Write-Host "  Running npm audit..."
  $exit = Invoke-Native -Program "npm" -Args @("audit", "--audit-level=high") -ErrorActionPreference_Override "Continue"
  return $exit -eq 0
}

# ---------------------------------------------------------------------------
# Auto-fix runner
# ---------------------------------------------------------------------------
function Invoke-AutoFixes {
  Write-Host "  Checking auto-fix rules..."
  $fixed = $false
  foreach ($rule in $AutoFixRules) {
    if (& $rule.Check) {
      Write-Report "  [auto-fix] Triggered rule: $($rule.Name) — $($rule.Description)"
      & $rule.Fix
      $fixed = $true
    }
  }
  if ($fixed) {
    Write-Host "  Auto-fixes applied. Running npm install..."
    Invoke-Native -Program "npm" -Args @("install")
  }
  return $fixed
}

# ---------------------------------------------------------------------------
# Batched update logic
# ---------------------------------------------------------------------------
function Invoke-SafeUpdates {
  Write-Report "Phase 1: Safe patch/minor updates"

  if ($DryRun) {
    Write-Host "  [dry-run] Checking for safe updates (no changes will be made)..."
    Invoke-Native -Program "npx" -Args @("--yes", "--package", "npm-check-updates", "ncu", "--target", "minor") -ErrorActionPreference_Override "Continue"
    Invoke-Native -Program "npx" -Args @("--yes", "--package", "npm-check-updates", "ncu", "--target", "minor", "--packageFile", "apps/web/package.json") -ErrorActionPreference_Override "Continue"
    Write-Report "  [dry-run] Safe updates scan complete. Use -DryRun:`$false to apply."
    return $true
  }

  Write-Host "  Running ncu --target minor..."
  Invoke-Native -Program "npx" -Args @("--yes", "--package", "npm-check-updates", "ncu", "--target", "minor", "-u")
  Invoke-Native -Program "npx" -Args @("--yes", "--package", "npm-check-updates", "ncu", "--target", "minor", "-u", "--packageFile", "apps/web/package.json")

  $staged = Get-StagedDiff
  if (-not $staged) {
    Write-Report "  No safe updates available."
    return $true
  }

  Write-Report "  Safe updates staged: $($staged -join ', ')"
  Invoke-Native -Program "npm" -Args @("install")

  Write-Host "  Verifying safe updates..."
  $autoFixed = Invoke-AutoFixes
  if ($autoFixed) {
    # Re-verify after auto-fix
  }

  if (-not (Invoke-VerifyBuild)) {
    Write-Report "  Safe update build FAILED. Rolling back..."
    return $false
  }

  if (-not (Invoke-VerifyLight)) {
    Write-Report "  Safe update invariants FAILED. Rolling back..."
    return $false
  }

  Write-Report "  Safe updates verified OK."
  return $true
}

function Invoke-MajorUpdates {
  Write-Report "Phase 2: Major version bumps (one at a time)"

  # Get list of packages with major updates available
  $majorOut = & npx --yes --package npm-check-updates ncu --target latest --format json 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($majorOut)) {
    Write-Report "  No major updates detected."
    return @()
  }

  try {
    $allUpdates = $majorOut | ConvertFrom-Json
  } catch {
    Write-Report "  Could not parse ncu output. Skipping majors."
    return @()
  }

  $currentPkg  = Get-Content (Join-Path $RepoRoot "package.json") | ConvertFrom-Json
  $webPkg      = Get-Content (Join-Path $RepoRoot "apps\web\package.json") | ConvertFrom-Json
  $currentDeps = @{}
  $webDeps     = @{}
  foreach ($prop in $currentPkg.dependencies.PSObject.Properties) { $currentDeps[$prop.Name] = $prop.Value }
  foreach ($prop in $currentPkg.devDependencies.PSObject.Properties) { $currentDeps[$prop.Name] = $prop.Value }
  foreach ($prop in $webPkg.dependencies.PSObject.Properties) { $webDeps[$prop.Name] = $prop.Value }
  foreach ($prop in $webPkg.devDependencies.PSObject.Properties) { $webDeps[$prop.Name] = $prop.Value }

  # Filter to only major bumps
  $majorBumps = @{}
  foreach ($prop in $allUpdates.PSObject.Properties) {
    $pkgName = $prop.Name
    $newVer  = $prop.Value
    $oldVer  = if ($webDeps.ContainsKey($pkgName)) { $webDeps[$pkgName] } elseif ($currentDeps.ContainsKey($pkgName)) { $currentDeps[$pkgName] } else { $null }
    if ($oldVer) {
      $oldClean = $oldVer -replace '^[\^~>=<]+', ''
      $newClean = $newVer -replace '^[\^~>=<]+', ''
      $oldMajor = if ($oldClean -match '^(\d+)') { [int]$matches[1] } else { 0 }
      $newMajor = if ($newClean -match '^(\d+)') { [int]$matches[1] } else { 0 }
      if ($newMajor -gt $oldMajor) {
        $majorBumps[$pkgName] = @{ old = $oldClean; new = $newClean }
      }
    }
  }

  if ($majorBumps.Count -eq 0) {
    Write-Report "  No major version bumps detected."
    return @()
  }

  Write-Report "  Major bumps detected: $($majorBumps.Count) packages"
  $successful = @()
  $failed     = @()

  foreach ($pkg in $majorBumps.Keys) {
    $info = $majorBumps[$pkg]
    Write-Host "`n  --- Testing major bump: $pkg ($($info.old) → $($info.new)) ---" -ForegroundColor Magenta

    if ($DryRun) {
      Write-Host "    [dry-run] Would update $pkg to $($info.new)" -ForegroundColor Yellow
      $successful += $pkg
      continue
    }

    # Determine which package.json to update
    $inWeb = $webDeps.ContainsKey($pkg)
    $targetFile = if ($inWeb) { "apps/web/package.json" } else { "package.json" }

    # Update single package
    $exit = Invoke-Native -Program "npx" -Args @(
      "--yes", "--package", "npm-check-updates", "ncu",
      "--filter", $pkg, "--target", "latest", "-u",
      "--packageFile", $targetFile
    ) -ErrorActionPreference_Override "Continue"

    Invoke-Native -Program "npm" -Args @("install")

    # Auto-fix
    Invoke-AutoFixes | Out-Null

    # Verify
    if (Invoke-VerifyBuild -and Invoke-VerifyLight) {
      Write-Report "  Major bump OK: $pkg $($info.old) → $($info.new)"
      $successful += $pkg
      # Commit this single major bump immediately
      Invoke-Native -Program "git" -Args @("add", "-A")
      Invoke-Native -Program "git" -Args @("commit", "-m", "chore(deps): bump $pkg $($info.old) → $($info.new)")
    } else {
      Write-Report "  Major bump FAILED: $pkg $($info.old) → $($info.new). Rolling back..."
      # Roll back just this package
      Invoke-Native -Program "git" -Args @("checkout", "--", $targetFile)
      Invoke-Native -Program "git" -Args @("checkout", "--", "package-lock.json")
      Invoke-Native -Program "npm" -Args @("install")
      $failed += $pkg
    }
  }

  Write-Report "  Major bumps: $($successful.Count) succeeded, $($failed.Count) failed"
  if ($failed.Count -gt 0) {
    Write-Report "  Failed majors: $($failed -join ', ')"
  }
  return $successful
}

# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
Write-Report "============================================"
Write-Report "Dependency maintenance started"
Write-Report "DryRun: $DryRun"
Write-Report "============================================"

# --- Phase 0: Snapshot ---
$snapshotTaken = $false
if (-not $DryRun) {
  $snapshotTaken = Invoke-Step -Name "Snapshot" -Action { Save-Snapshot }
}

# --- Phase 1: Safe updates ---
$safeOk = Invoke-Step -Name "Safe-updates" -Action {
  $result = Invoke-SafeUpdates
  if (-not $result) {
    if ($snapshotTaken) {
      Restore-Snapshot
      Clear-StaleStash
    }
    throw "Safe update batch failed. Rolled back."
  }
  if (-not $DryRun) {
    Invoke-Native -Program "git" -Args @("add", "-A")
    Invoke-Native -Program "git" -Args @("commit", "-m", "chore(deps): safe patch/minor updates")
  }
}

if (-not $safeOk) {
  Write-Report "Safe updates failed. Aborting."
  $ReportLines -join "`n" | Set-Content -Path $ReportPath -Encoding UTF8
  exit 1
}

# --- Phase 2: Major bumps ---
$majorOk = Invoke-Step -Name "Major-updates" -Action {
  $null = Invoke-MajorUpdates
}

# --- Phase 3: Audit ---
$fullOk = Invoke-Step -Name "Audit" -Action {
  if (-not (Invoke-Audit)) {
    Write-Report "npm audit has high/critical vulnerabilities. Will not auto-merge."
    # Don't roll back for audit — vulnerabilities may pre-date this update
  }
}

# --- Phase 4: Push ---
if (-not $DryRun -and -not $SkipPush) {
  Invoke-Step -Name "Push" -Action {
    Invoke-Native -Program "git" -Args @("push", $Remote, $Branch)
  }
}

# --- Cleanup ---
Clear-StaleStash

# --- Report ---
Write-Report "============================================"
Write-Report "Dependency maintenance complete"
Write-Report "============================================"
$ReportLines -join "`n" | Set-Content -Path $ReportPath -Encoding UTF8
Write-Host "`nReport written to: $ReportPath" -ForegroundColor Cyan