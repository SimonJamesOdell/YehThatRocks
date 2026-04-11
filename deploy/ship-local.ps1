param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$Branch = "main",
  [string]$VpsHost = $(if ($env:YTR_VPS_HOST) { $env:YTR_VPS_HOST } else { "root@206.189.122.114" }),
  [string]$VpsRepoDir = "/srv/yehthatrocks",
  [string]$ImageBase = "yehthatrocks-web",
  [switch]$SkipGitPush,
  # Dump the local Docker DB and restore it on the VPS before deploying.
  [switch]$RestoreDb
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
try {
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
      # Write restore script to a temp file, upload and run it — avoids quoting hell over SSH.
      $localScriptPath = Join-Path $tempDir "ytr-restore-$timestamp.sh"
      $remoteScriptPath = "/tmp/ytr-restore-$timestamp.sh"
      try {
        $restoreScript = @"
#!/bin/sh
set -eu
cd /srv/yehthatrocks
. .env.production
DB=`${MYSQL_DATABASE:-yeh}
USR=`${MYSQL_USER:-yeh}
PASS=`${MYSQL_PASSWORD}
echo '[db-restore] Stopping web container...'
docker compose --env-file /srv/yehthatrocks/.env.production -f /srv/yehthatrocks/docker-compose.prod.yml stop web 2>/dev/null || true
echo '[db-restore] Dropping and recreating database...'
docker compose --env-file /srv/yehthatrocks/.env.production -f /srv/yehthatrocks/docker-compose.prod.yml exec -T db mysql -u"`$USR" -p"`$PASS" -e "DROP DATABASE IF EXISTS \`\`$DB\`\`; CREATE DATABASE \`\`$DB\`\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo '[db-restore] Importing dump...'
docker compose --env-file /srv/yehthatrocks/.env.production -f /srv/yehthatrocks/docker-compose.prod.yml exec -T db mysql -u"`$USR" -p"`$PASS" "`$DB" < $remoteDumpPath
rm -f $remoteDumpPath $remoteScriptPath
echo '[db-restore] Complete.'
"@
        # Write with LF line endings (Unix)
        [System.IO.File]::WriteAllText($localScriptPath, ($restoreScript -replace "`r`n", "`n"))
        ExecNative -Program "scp" -CommandArgs @($localScriptPath, "${VpsHost}:${remoteScriptPath}")
        ExecNative -Program "ssh" -CommandArgs @($VpsHost, "chmod +x $remoteScriptPath && $remoteScriptPath")
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
} finally {
  Pop-Location
}
