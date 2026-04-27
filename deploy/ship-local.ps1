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
  # Force full local cleanup by stopping dev server first (includes .next/logs).
  # By default, if dev server is running, ship keeps it alive and runs safe cleanup.
  [switch]$ForceFullCleanupStopDevServer,
  # Skip Docker cache pruning after shipping.
  [switch]$SkipDockerPrune
  ,
  # Resume a previously failed ship run from persisted checkpoint state.
  [switch]$Resume
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

function ExecNativeWithRetry(
  [string]$Program,
  [string[]]$CommandArgs,
  [int]$MaxAttempts = 5,
  [int]$InitialDelaySeconds = 4
) {
  $display = "$Program " + ($CommandArgs -join " ")
  $delaySeconds = [Math]::Max(1, $InitialDelaySeconds)
  $attempt = 1

  while ($attempt -le $MaxAttempts) {
    Write-Host "> $display" -ForegroundColor Cyan
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Program
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    foreach ($arg in $CommandArgs) {
      [void]$psi.ArgumentList.Add($arg)
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi

    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    $exitCode = $process.ExitCode
    $output = (($stdout, $stderr) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join [Environment]::NewLine
    $process.Dispose()

    if (-not [string]::IsNullOrWhiteSpace($output)) {
      Write-Host $output.TrimEnd()
    }

    if ($exitCode -eq 0) {
      return
    }

    $retryable =
      ($output -match "Exceeded MaxStartups") -or
      ($output -match "Connection closed by .* port 22") -or
      ($output -match "kex_exchange_identification") -or
      ($output -match "Connection reset") -or
      ($output -match "Connection timed out")

    if (-not $retryable -or $attempt -ge $MaxAttempts) {
      throw ("Command failed with exit code {0}; command {1}" -f $exitCode, $display)
    }

    Write-Warning ("Transient SSH/SCP failure detected. Retrying in {0}s (attempt {1}/{2})..." -f $delaySeconds, $attempt, $MaxAttempts)
    Start-Sleep -Seconds $delaySeconds
    $delaySeconds = [Math]::Min(30, $delaySeconds * 2)
    $attempt += 1
  }
}

function Invoke-RemoteShellScript(
  [string]$VpsHost,
  [string[]]$Lines,
  [string]$RemoteScriptNamePrefix
) {
  $tempDir = [System.IO.Path]::GetTempPath()
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $localScriptPath = Join-Path $tempDir ("{0}-{1}.sh" -f $RemoteScriptNamePrefix, $timestamp)
  $remoteScriptPath = "/tmp/{0}-{1}.sh" -f $RemoteScriptNamePrefix, $timestamp

  try {
    $script = ($Lines -join "`n") + "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($localScriptPath, $script, $utf8NoBom)
    ExecNativeWithRetry -Program "scp" -CommandArgs @($localScriptPath, "${VpsHost}:${remoteScriptPath}")
    ExecNativeWithRetry -Program "ssh" -CommandArgs @($VpsHost, "sh $remoteScriptPath")
  } finally {
    if (Test-Path -LiteralPath $localScriptPath) {
      Remove-Item -LiteralPath $localScriptPath -Force -ErrorAction SilentlyContinue
    }

    & ssh $VpsHost "rm -f '$remoteScriptPath'" *> $null
  }
}

function Get-ShipStatePaths([string]$RepoRoot) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($RepoRoot)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $hasher.ComputeHash($bytes)
  } finally {
    $hasher.Dispose()
  }

  $hashHex = ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
  $repoKey = $hashHex.Substring(0, 12)
  $baseDir = Join-Path $env:LOCALAPPDATA ("YTR\ship-state\{0}" -f $repoKey)

  return @{
    BaseDir = $baseDir
    StateFile = (Join-Path $baseDir "state.json")
    TarFile = (Join-Path $baseDir "image.tar")
  }
}

function Ensure-Directory([string]$DirPath) {
  if (-not (Test-Path -LiteralPath $DirPath)) {
    New-Item -ItemType Directory -Path $DirPath -Force | Out-Null
  }
}

function Read-ShipState([string]$StateFilePath) {
  if (-not (Test-Path -LiteralPath $StateFilePath)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $StateFilePath -Raw | ConvertFrom-Json
  } catch {
    throw "Ship state file is unreadable or invalid JSON: $StateFilePath"
  }
}

function Write-ShipState([string]$StateFilePath, [hashtable]$State) {
  $parent = Split-Path -Parent $StateFilePath
  Ensure-Directory -DirPath $parent
  $json = $State | ConvertTo-Json -Depth 12
  Set-Content -LiteralPath $StateFilePath -Value $json -Encoding UTF8
}

function Clear-ShipState([string]$StateFilePath) {
  if (Test-Path -LiteralPath $StateFilePath) {
    Remove-Item -LiteralPath $StateFilePath -Force -ErrorAction SilentlyContinue
  }
}

function Get-ShipStageRank([string]$Stage) {
  switch ($Stage) {
    "init" { return 0 }
    "image-built" { return 1 }
    "tar-saved" { return 2 }
    "tar-uploaded" { return 3 }
    "image-loaded" { return 4 }
    "deployed" { return 5 }
    default { return -1 }
  }
}

function Test-LocalDockerImage([string]$ImageTag) {
  & docker image inspect $ImageTag *> $null
  return ($LASTEXITCODE -eq 0)
}

function Ensure-ImagePresentFromTar([string]$ImageTag, [string]$LocalTarPath) {
  if (Test-LocalDockerImage -ImageTag $ImageTag) {
    return
  }

  if (-not (Test-Path -LiteralPath $LocalTarPath)) {
    throw "Local image '$ImageTag' is missing and no resume tar is available at '$LocalTarPath'. Run ship without -Resume."
  }

  Write-Host "Rehydrating local Docker image from resume tar..." -ForegroundColor Yellow
  ExecNative -Program "docker" -CommandArgs @("load", "-i", $LocalTarPath)
}

function Test-RemoteFileExists([string]$VpsHost, [string]$RemotePath) {
  & ssh $VpsHost "test -s '$RemotePath'" *> $null
  return ($LASTEXITCODE -eq 0)
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

  # git status --porcelain does not report untracked empty directories.
  # These can still end up in the Docker build context and break things (e.g.
  # an empty Prisma migration directory causes Prisma P3015 on deploy).
  # Use `git clean -nd` to detect anything that would be swept by a clean.
  $cleanOutput = (& git clean -nd) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to run git clean dry-run check."
  }

  if (-not [string]::IsNullOrWhiteSpace($cleanOutput)) {
    throw @"
Working tree has untracked files or empty directories that are not in .gitignore.
These would be included in the Docker build context and may corrupt the image.
Remove them (or add to .gitignore) before running ship:

$cleanOutput
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

function Clean-RepoTransientCaches([string]$RepoRoot, [switch]$SafeMode) {
  $targets = if ($SafeMode) {
    @(
      ".turbo\cache",
      "apps\web\.cache",
      "playwright-report",
      "test-results"
    )
  } else {
    @(
      ".turbo\cache",
      ".next",
      "apps\web\.next",
      "apps\web\.cache",
      "playwright-report",
      "test-results",
      "logs"
    )
  }

  foreach ($target in $targets) {
    Remove-PathIfPresent (Join-Path $RepoRoot $target)
  }
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

  Write-Host "Pruning all unused local Docker build/image cache..." -ForegroundColor DarkYellow
  & docker builder prune -af | Out-Null
  & docker image prune -af | Out-Null
  & docker container prune -f | Out-Null
}

function Transfer-ImageToVps(
  [string]$ImageTag,
  [string]$VpsHost,
  [hashtable]$ShipState,
  [string]$ShipStatePath
) {
  $currentStageRank = Get-ShipStageRank -Stage ([string]$ShipState.Stage)

  if ($currentStageRank -lt (Get-ShipStageRank -Stage "tar-saved")) {
    Write-Host "Saving local image tar archive..." -ForegroundColor Yellow
    Ensure-Directory -DirPath (Split-Path -Parent $ShipState.LocalTarPath)
    ExecNative -Program "docker" -CommandArgs @("save", "-o", $ShipState.LocalTarPath, $ImageTag)
    $ShipState.Stage = "tar-saved"
    Write-ShipState -StateFilePath $ShipStatePath -State $ShipState
    $currentStageRank = Get-ShipStageRank -Stage ([string]$ShipState.Stage)
  }

  if ($currentStageRank -lt (Get-ShipStageRank -Stage "tar-uploaded")) {
    Write-Host "Uploading image archive to VPS..." -ForegroundColor Yellow
    ExecNativeWithRetry -Program "scp" -CommandArgs @($ShipState.LocalTarPath, "$VpsHost`:$($ShipState.RemoteTarPath)")
    $ShipState.Stage = "tar-uploaded"
    Write-ShipState -StateFilePath $ShipStatePath -State $ShipState
    $currentStageRank = Get-ShipStageRank -Stage ([string]$ShipState.Stage)
  }

  if ($currentStageRank -lt (Get-ShipStageRank -Stage "image-loaded")) {
    if (-not (Test-RemoteFileExists -VpsHost $VpsHost -RemotePath $ShipState.RemoteTarPath)) {
      Write-Warning "Resume checkpoint expected remote tar, but it is missing. Re-uploading tar..."
      ExecNativeWithRetry -Program "scp" -CommandArgs @($ShipState.LocalTarPath, "$VpsHost`:$($ShipState.RemoteTarPath)")
      $ShipState.Stage = "tar-uploaded"
      Write-ShipState -StateFilePath $ShipStatePath -State $ShipState
    }

    Write-Host "Loading uploaded image on VPS..." -ForegroundColor Yellow
    $remoteLoad = "set -e; trap 'rm -f $($ShipState.RemoteTarPath)' EXIT; docker load -i $($ShipState.RemoteTarPath)"
    ExecNativeWithRetry -Program "ssh" -CommandArgs @($VpsHost, $remoteLoad)
    $ShipState.Stage = "image-loaded"
    Write-ShipState -StateFilePath $ShipStatePath -State $ShipState
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
$shipStatePaths = Get-ShipStatePaths -RepoRoot $RepoDir
$shipStatePath = [string]$shipStatePaths.StateFile
$shipTarPath = [string]$shipStatePaths.TarFile
try {
  if (-not $SkipLocalCleanup) {
    $initialDevPid = Get-DevServerPid
    $devServerWasRunning = [bool]$initialDevPid

    if ($devServerWasRunning -and -not $ForceFullCleanupStopDevServer) {
      Write-Host "Dev server detected on port 3000 (PID $initialDevPid). Keeping it online and running safe cache cleanup..." -ForegroundColor DarkYellow
      Clean-RepoTransientCaches -RepoRoot $RepoDir -SafeMode
    } else {
      if ($devServerWasRunning -and $ForceFullCleanupStopDevServer) {
        Write-Host "Force full cleanup requested; stopping dev server before cleanup..." -ForegroundColor DarkYellow
      }
      $devServerWasRunning = Stop-DevServer
      Clean-RepoTransientCaches -RepoRoot $RepoDir
    }
  }

  Ensure-CleanGitWorktree

  Exec "git fetch origin $Branch"
  Exec "git checkout $Branch"

  if (-not $SkipGitPush) {
    Exec "git push origin $Branch"
  }

  $currentSha = (git rev-parse --short HEAD).Trim()
  if ([string]::IsNullOrWhiteSpace($currentSha)) {
    throw "Could not determine git commit SHA"
  }

  $shipState = $null
  if ($Resume) {
    $loadedState = Read-ShipState -StateFilePath $shipStatePath
    if (-not $loadedState) {
      throw "-Resume requested but no ship checkpoint state was found at $shipStatePath"
    }

    $resumeBranch = [string]$loadedState.Branch
    $resumeSha = [string]$loadedState.CommitSha

    if ($resumeBranch -ne $Branch) {
      throw "Checkpoint branch '$resumeBranch' does not match requested branch '$Branch'."
    }

    if ($resumeSha -ne $currentSha) {
      throw "Checkpoint commit '$resumeSha' does not match current HEAD '$currentSha'. Run fresh ship without -Resume."
    }

    $shipState = @{
      SchemaVersion = [int]$loadedState.SchemaVersion
      Branch = $resumeBranch
      CommitSha = $resumeSha
      ImageTag = [string]$loadedState.ImageTag
      LatestTag = [string]$loadedState.LatestTag
      LocalTarPath = [string]$loadedState.LocalTarPath
      RemoteTarPath = [string]$loadedState.RemoteTarPath
      Stage = [string]$loadedState.Stage
      CreatedAt = [string]$loadedState.CreatedAt
      UpdatedAt = (Get-Date).ToString("o")
    }

    Ensure-ImagePresentFromTar -ImageTag $shipState.ImageTag -LocalTarPath $shipState.LocalTarPath
    Write-Host ("Resuming ship from stage '{0}' for {1}" -f $shipState.Stage, $shipState.ImageTag) -ForegroundColor Yellow
  } else {
    if (Test-Path -LiteralPath $shipStatePath) {
      Write-Warning "Found stale ship checkpoint state. Starting fresh run and replacing it."
      Clear-ShipState -StateFilePath $shipStatePath
    }

    $imageTag = "$ImageBase`:$currentSha"
    $latestTag = "$ImageBase`:latest"
    $remoteTarPath = "/tmp/yehthatrocks-image-$currentSha.tar"

    $shipState = @{
      SchemaVersion = 1
      Branch = $Branch
      CommitSha = $currentSha
      ImageTag = $imageTag
      LatestTag = $latestTag
      LocalTarPath = $shipTarPath
      RemoteTarPath = $remoteTarPath
      Stage = "init"
      CreatedAt = (Get-Date).ToString("o")
      UpdatedAt = (Get-Date).ToString("o")
    }
    Write-ShipState -StateFilePath $shipStatePath -State $shipState
  }

  if ((Get-ShipStageRank -Stage ([string]$shipState.Stage)) -lt (Get-ShipStageRank -Stage "image-built")) {
    Write-Host "Building image locally with full progress output..." -ForegroundColor Yellow
    Exec "docker build --progress=plain -t $($shipState.ImageTag) -t $($shipState.LatestTag) ."
    $shipState.Stage = "image-built"
    $shipState.UpdatedAt = (Get-Date).ToString("o")
    Write-ShipState -StateFilePath $shipStatePath -State $shipState
  }

  Write-Host "Transferring image to VPS (no registry)..." -ForegroundColor Yellow
  Transfer-ImageToVps -ImageTag $shipState.ImageTag -VpsHost $VpsHost -ShipState $shipState -ShipStatePath $shipStatePath

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
      ExecNativeWithRetry -Program "scp" -CommandArgs @($localDumpPath, "${VpsHost}:${remoteDumpPath}")

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

  if ((Get-ShipStageRank -Stage ([string]$shipState.Stage)) -lt (Get-ShipStageRank -Stage "deployed")) {
    Write-Host "Triggering VPS hot-swap deploy..." -ForegroundColor Yellow
    Invoke-RemoteShellScript -VpsHost $VpsHost -RemoteScriptNamePrefix "ytr-deploy" -Lines @(
      "#!/bin/sh",
      "set -e",
      "cd $VpsRepoDir",
      'if [ -n "$(git status --porcelain)" ]; then',
      '  echo "[ship-local] WARNING: VPS repo has local changes; auto-stashing before deploy"',
      '  git stash push --include-untracked -m "ship-local-auto-stash $(date -Iseconds)" >/dev/null',
      'fi',
      "WEB_IMAGE=$($shipState.ImageTag) SKIP_PULL=1 ./deploy/deploy-prod-hot-swap.sh"
    )
    $shipState.Stage = "deployed"
    $shipState.UpdatedAt = (Get-Date).ToString("o")
    Write-ShipState -StateFilePath $shipStatePath -State $shipState
  }

  if (Test-Path -LiteralPath $shipState.LocalTarPath) {
    Remove-Item -LiteralPath $shipState.LocalTarPath -Force -ErrorAction SilentlyContinue
  }
  Clear-ShipState -StateFilePath $shipStatePath

  Write-Host "Deploy complete: $($shipState.ImageTag)" -ForegroundColor Green

  if ((-not $SkipLocalCleanup) -and (-not $SkipDockerPrune)) {
    Try-PruneDockerCaches
  }
} finally {
  if ($devServerWasRunning -and $ForceFullCleanupStopDevServer) {
    Start-DevServer -RepoRoot $RepoDir
  }
  Pop-Location
}
