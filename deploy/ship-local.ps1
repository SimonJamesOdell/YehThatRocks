param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$Branch = "main",
  [string]$VpsHost = $(if ($env:YTR_VPS_HOST) { $env:YTR_VPS_HOST } else { "root@206.189.122.114" }),
  [string]$VpsRepoDir = "/srv/yehthatrocks",
  [string]$ImageBase = "yehthatrocks-web",
  [switch]$SkipGitPush,
  # Dump the local Docker DB and restore it on the VPS before deploying.
  [switch]$RestoreDb,
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
  if ($LASTEXITCODE -ne 0) {
    throw ("Command failed with exit code {0}; command {1}" -f $LASTEXITCODE, $Command)
  }
}

function ExecNative([string]$Program, [string[]]$CommandArgs) {
  $display = "$Program " + ($CommandArgs -join " ")
  Write-Host "> $display" -ForegroundColor Cyan
  & $Program @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw ("Command failed with exit code {0}; command {1}" -f $LASTEXITCODE, $display)
  }
}

function Ensure-DockerDaemon {
  $dockerInfoOutput = & docker info 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) {
    return
  }

  if ($dockerInfoOutput -match "dockerDesktopLinuxEngine" -or
      $dockerInfoOutput -match "The system cannot find the file specified" -or
      $dockerInfoOutput -match "error during connect" -or
      $dockerInfoOutput -match "Cannot connect to the Docker daemon") {
    throw @"
Docker daemon is not reachable.

On Windows this usually means Docker Desktop is not running (or has not finished starting).
1) Start Docker Desktop
2) Wait until it shows "Engine running"
3) Retry this command

Raw docker info error:
$dockerInfoOutput
"@
  }

  throw ("Docker daemon check failed.`n`nRaw docker info error:`n{0}" -f $dockerInfoOutput)
}

function Ensure-CleanGitWorktree {
  $statusOutput = (& git status --porcelain) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to determine git worktree status."
  }

  if (-not [string]::IsNullOrWhiteSpace($statusOutput)) {
    throw @"
Working tree is not clean. Commit or stash your changes before running ship.

Pending changes:
$statusOutput
"@
  }
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
  # Wait up to 5s for the port to free
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

  $devProcess = Start-Process -FilePath $npmCmd.Source -ArgumentList @(
    "-w", "web", "run", "dev"
  ) -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru

  # Wait briefly and confirm something is listening on 3000.
  $started = $false
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 200
    if (Get-DevServerPid) {
      $started = $true
      break
    }
  }

  if (-not $started) {
    Write-Warning "Dev server did not come back on port 3000 after ship."
  } elseif ($devProcess) {
    Write-Host "Dev server restart requested (PID $($devProcess.Id))." -ForegroundColor DarkGreen
  }
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

function Transfer-ImageToVps([string]$ImageTag, [string]$VpsHost) {
  $tempDir = [System.IO.Path]::GetTempPath()
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $safeTag = ($ImageTag -replace "[^a-zA-Z0-9_.-]", "_")
  $localTarPath = Join-Path $tempDir ("ytr-{0}-{1}.tar" -f $safeTag, $timestamp)
  $remoteTarPath = "/tmp/yehthatrocks-image-{0}.tar" -f $timestamp

  try {
    Write-Host "Saving local image tar archive..." -ForegroundColor Yellow
    ExecNative -Program "docker" -CommandArgs @("save", "-o", $localTarPath, $ImageTag)

    Write-Host "Uploading image archive to VPS..." -ForegroundColor Yellow
    ExecNative -Program "scp" -CommandArgs @($localTarPath, "$VpsHost`:$remoteTarPath")

    Write-Host "Loading uploaded image on VPS..." -ForegroundColor Yellow
    $remoteLoad = "set -e; trap 'rm -f $remoteTarPath' EXIT; docker load -i $remoteTarPath"
    ExecNative -Program "ssh" -CommandArgs @($VpsHost, $remoteLoad)
  } finally {
    if (Test-Path $localTarPath) {
      Remove-Item -Force $localTarPath -ErrorAction SilentlyContinue
    }
  }
}

if ([string]::IsNullOrWhiteSpace($VpsHost)) {
  $VpsHost = (Read-Host "Enter VPS SSH host (example: root@ubuntu-s-1vcpu-1gb-lon1-01)").Trim()
  if ([string]::IsNullOrWhiteSpace($VpsHost)) {
    throw "VpsHost is required. Set YTR_VPS_HOST or pass -VpsHost."
  }

  if ($VpsHost -notmatch "@") {
    $VpsHost = "root@$VpsHost"
  }

  # Persist for future no-flag runs.
  & setx YTR_VPS_HOST $VpsHost | Out-Null
  $env:YTR_VPS_HOST = $VpsHost
  Write-Host "Saved YTR_VPS_HOST for future runs: $VpsHost" -ForegroundColor Green
}

if ($VpsHost -notmatch "@") {
  $VpsHost = "root@$VpsHost"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI not found. Install Docker Desktop (WSL2 backend) to use local build+ship flow."
}

Ensure-DockerDaemon

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw "ssh command not found. Install OpenSSH client."
}

if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
  throw "scp command not found. Install OpenSSH client with scp support."
}

Push-Location $RepoDir
$devServerWasRunning = $false
try {
  if (-not $SkipLocalCleanup) {
    $devServerWasRunning = Stop-DevServer
    Clean-RepoTransientCaches -RepoRoot $RepoDir
  }

  Ensure-CleanGitWorktree

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

  Write-Host "Building image locally with full progress output..." -ForegroundColor Yellow
  Exec "docker build --progress=plain -t $imageTag -t $latestTag ."

  Write-Host "Transferring image to VPS (no registry)..." -ForegroundColor Yellow
  Transfer-ImageToVps -ImageTag $imageTag -VpsHost $VpsHost

  if ($RestoreDb) {
    Write-Host "=== DB RESTORE: Dumping local database from Docker ===" -ForegroundColor Magenta
    $tempDir = [System.IO.Path]::GetTempPath()
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $localDumpPath = Join-Path $tempDir "ytr-db-$timestamp.sql"
    $remoteDumpPath = "/tmp/ytr-db-$timestamp.sql"

    try {
      # Pipe mysqldump output directly to a local file
      $dumpArgs = @("compose", "exec", "-T", "db",
        "mysqldump", "-uroot", "-pyehthatrocks",
        "--single-transaction", "--no-tablespaces", "--routines", "--triggers", "yeh_live")
      Write-Host "> docker $($dumpArgs -join ' ') > $localDumpPath" -ForegroundColor Cyan
      & docker @dumpArgs | Set-Content -Path $localDumpPath -Encoding UTF8
      if ($LASTEXITCODE -ne 0) { throw "mysqldump failed" }

      $dumpBytes = (Get-Item $localDumpPath).Length
      if ($dumpBytes -lt 10240) {
        throw "Dump is suspiciously small ($dumpBytes bytes) - aborting to protect VPS data."
      }
      Write-Host "Dump size: $([math]::Round($dumpBytes / 1MB, 1)) MB" -ForegroundColor Green

      Write-Host "Uploading dump to VPS..." -ForegroundColor Yellow
      ExecNative -Program "scp" -CommandArgs @($localDumpPath, "${VpsHost}:${remoteDumpPath}")

      Write-Host "Restoring database on VPS..." -ForegroundColor Yellow
      $localScriptPath = Join-Path $tempDir "ytr-restore-$timestamp.sh"
      $remoteScriptPath = "/tmp/ytr-restore-$timestamp.sh"
      try {
        # Build lines individually — concatenated lines use explicit string building
        $L1  = '#!/bin/sh'
        $L2  = 'cd /srv/yehthatrocks'
        $L3  = "echo '[db-restore] Stopping web container...'"
        $L4  = 'docker compose --env-file /srv/yehthatrocks/.env.production -f /srv/yehthatrocks/docker-compose.prod.yml stop web 2>/dev/null || true'
        $L5  = "echo '[db-restore] Getting db container...'"
        $L6  = 'DB_CTR=$(docker compose --env-file /srv/yehthatrocks/.env.production -f /srv/yehthatrocks/docker-compose.prod.yml ps -q db | head -n1)'
        $L7  = 'if [ -z "$DB_CTR" ]; then echo "[db-restore] ERROR: db container not found" >&2; exit 1; fi'
        $L8  = 'echo "[db-restore] Container: $DB_CTR"'
        $L9  = 'DB=$(docker exec "$DB_CTR" sh -c ' + "'" + 'printf "%s" "$MYSQL_DATABASE"' + "')"
        $L10 = 'USR=$(docker exec "$DB_CTR" sh -c ' + "'" + 'printf "%s" "$MYSQL_USER"' + "')"
        $L11 = 'PASS=$(docker exec "$DB_CTR" sh -c ' + "'" + 'printf "%s" "$MYSQL_PASSWORD"' + "')"
        $L12 = 'DB="${DB:-yeh}"'
        $L13 = 'USR="${USR:-yeh}"'
        $L14 = 'echo "[db-restore] Restoring into: $DB"'
        $L15 = 'docker exec "$DB_CTR" mysql -u"$USR" -p"$PASS" -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"'
        $L16 = "echo '[db-restore] Importing dump...'"
        $L17 = "docker exec -i " + '"$DB_CTR"' + " mysql -u" + '"$USR"' + " -p" + '"$PASS"' + " " + '"$DB"' + " < $remoteDumpPath"
        $L18 = "rm -f $remoteDumpPath $remoteScriptPath"
        $L19 = "echo '[db-restore] Complete.'"
        $script = ($L1,$L2,$L3,$L4,$L5,$L6,$L7,$L8,$L9,$L10,$L11,$L12,$L13,$L14,$L15,$L16,$L17,$L18,$L19) -join "`n"
        [System.IO.File]::WriteAllText($localScriptPath, $script + "`n")
        ExecNative -Program "scp" -CommandArgs @($localScriptPath, "${VpsHost}:${remoteScriptPath}")
        ExecNative -Program "ssh" -CommandArgs @($VpsHost, "sh $remoteScriptPath")
      } finally {
        if (Test-Path $localScriptPath) { Remove-Item -Force $localScriptPath -ErrorAction SilentlyContinue }
      }
    } finally {
      if (Test-Path $localDumpPath) { Remove-Item -Force $localDumpPath -ErrorAction SilentlyContinue }
    }
    Write-Host "=== DB RESTORE complete ===" -ForegroundColor Magenta
  }

  $remoteDeploy = "cd $VpsRepoDir && git pull --ff-only origin $Branch && WEB_IMAGE=$imageTag SKIP_PULL=1 ./deploy/deploy-prod-hot-swap.sh"
  Write-Host "Triggering VPS hot-swap deploy..." -ForegroundColor Yellow
  Exec "ssh $VpsHost '$remoteDeploy'"

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
