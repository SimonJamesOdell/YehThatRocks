param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ImageBase = "ghcr.io/simonjamesodell/yehthatrocks-web",
  [string]$Branch = "main",
  [string]$VpsHost = $env:YTR_VPS_HOST,
  [string]$VpsRepoDir = "/srv/yehthatrocks",
  [switch]$PrepareOnly,
  [switch]$SkipGitPush,
  # Skip local transient cache cleanup before/after shipping.
  [switch]$SkipLocalCleanup,
  # Skip Docker cache pruning after shipping.
  [switch]$SkipDockerPrune
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Exec([string]$Command) {
  Write-Host "> $Command" -ForegroundColor Cyan
  Invoke-Expression $Command
}

function Remove-PathIfPresent([string]$TargetPath) {
  if (-not (Test-Path -LiteralPath $TargetPath)) {
    return
  }

  Write-Host "Cleaning local cache path: $TargetPath" -ForegroundColor DarkYellow
  Remove-Item -LiteralPath $TargetPath -Recurse -Force -ErrorAction SilentlyContinue
}

function Clean-RepoTransientCaches([string]$RepoRoot) {
  Remove-PathIfPresent (Join-Path $RepoRoot ".turbo\cache")
  Remove-PathIfPresent (Join-Path $RepoRoot "apps\web\.next")
}

# Returns the PID of the process listening on port 3000, or $null.
function Get-DevServerPid {
  $conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return $null
}

# Kills the process on port 3000 (if any) and returns whether it was running.
function Stop-DevServer {
  $pid3000 = Get-DevServerPid
  if (-not $pid3000) { return $false }

  Write-Host "Stopping local dev server (PID $pid3000) before cache cleanup..." -ForegroundColor DarkYellow
  Stop-Process -Id $pid3000 -Force -ErrorAction SilentlyContinue

  # Wait up to 5s for the port to free.
  $waited = 0
  while ((Get-DevServerPid) -and $waited -lt 5) {
    Start-Sleep -Milliseconds 400
    $waited += 0.4
  }

  return $true
}

# Restarts the dev server in the background from the given repo root.
function Start-DevServer([string]$RepoRoot) {
  Write-Host "Restarting local dev server..." -ForegroundColor DarkYellow
  $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
  if (-not $npmCmd) {
    $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue)
  }

  if (-not $npmCmd) {
    Write-Warning "Could not find npm executable to restart dev server."
    return
  }

  $restartCandidates = @(
    @("run", "dev"),
    @("-w", "web", "run", "dev")
  )

  foreach ($candidate in $restartCandidates) {
    $display = "npm " + ($candidate -join " ")
    Write-Host "Trying dev restart command: $display" -ForegroundColor DarkYellow

    $devProcess = Start-Process -FilePath $npmCmd.Source -ArgumentList $candidate -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru

    $started = $false
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 250
      if (Get-DevServerPid) {
        $started = $true
        break
      }

      if ($devProcess) {
        $devProcess.Refresh()
        if ($devProcess.HasExited) {
          break
        }
      }
    }

    if ($started) {
      Write-Host "Dev server restarted using '$display' (PID $($devProcess.Id))." -ForegroundColor DarkGreen
      return
    }

    if ($devProcess -and -not $devProcess.HasExited) {
      Stop-Process -Id $devProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Warning "Dev server did not come back on port 3000 after ship. Tried: npm run dev, npm -w web run dev"
}

function Try-PruneDockerCaches {
  $dockerInfoOutput = & docker info 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Skipping Docker prune because daemon is unavailable."
    return
  }

  Write-Host "Pruning local Docker build/image cache older than 7 days..." -ForegroundColor DarkYellow
  & docker builder prune -af --filter "until=168h" | Out-Null
  & docker image prune -af --filter "until=168h" | Out-Null
  & docker container prune -f | Out-Null
}

if (-not $PrepareOnly -and [string]::IsNullOrWhiteSpace($VpsHost)) {
  throw "VpsHost is required unless -PrepareOnly is set. Set YTR_VPS_HOST or pass -VpsHost."
}

Push-Location $RepoDir
$devServerWasRunning = $false
try {
  if (-not $SkipLocalCleanup) {
    $devServerWasRunning = Stop-DevServer
    Clean-RepoTransientCaches -RepoRoot $RepoDir
  }

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI not found. Use GitHub Actions build instead: push to main, wait for workflow 'Publish Web Image' to finish, then run 'deploy' on VPS."
  }

  Exec "git fetch origin $Branch"
  Exec "git checkout $Branch"

  if (-not $SkipGitPush) {
    Exec "git push origin $Branch"
  }

  $sha = (git rev-parse --short HEAD).Trim()
  if ([string]::IsNullOrWhiteSpace($sha)) {
    throw "Could not determine git commit SHA"
  }

  $imageTag = "$ImageBase`:$sha"
  $latestTag = "$ImageBase`:latest"

  Exec "docker buildx build --platform linux/amd64 -t $imageTag -t $latestTag --push ."

  if ($PrepareOnly) {
    Write-Host "Image pushed: $imageTag" -ForegroundColor Green
    Write-Host "Run on VPS: WEB_IMAGE=$imageTag deploy" -ForegroundColor Yellow

    if ((-not $SkipLocalCleanup) -and (-not $SkipDockerPrune)) {
      Try-PruneDockerCaches
    }

    exit 0
  }

  $remoteCommand = "cd $VpsRepoDir && WEB_IMAGE=$imageTag ./deploy/deploy-prod-hot-swap.sh"
  Exec "ssh $VpsHost '$remoteCommand'"

  Write-Host "Deploy complete: $imageTag" -ForegroundColor Green

  if ((-not $SkipLocalCleanup) -and (-not $SkipDockerPrune)) {
    Try-PruneDockerCaches
  }
} finally {
  if ($devServerWasRunning) {
    Start-DevServer -RepoRoot $RepoDir
  }
  Pop-Location
}
