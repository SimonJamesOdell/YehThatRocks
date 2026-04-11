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
try {
  if (-not $SkipLocalCleanup) {
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
  Pop-Location
}
