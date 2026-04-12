param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$Port = 3000,
  [int]$MinFreeGBForCleanup = 25
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-DevServerPid {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return $null
}

function Get-FreeSpaceGB {
  try {
    $drive = New-Object System.IO.DriveInfo "C"
    return [math]::Floor($drive.AvailableFreeSpace / 1GB)
  } catch {
    return $null
  }
}

function Try-PruneDockerOnLowDisk {
  param([int]$MinFreeGB)

  $freeGb = Get-FreeSpaceGB
  if ($null -eq $freeGb) {
    return
  }

  if ($freeGb -ge $MinFreeGB) {
    return
  }

  $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCmd) {
    return
  }

  $dockerInfo = & docker info 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Output "Low disk detected (${freeGb}GB free), but Docker daemon is unavailable."
    return
  }

  Write-Output "Low disk detected (${freeGb}GB free). Pruning Docker cache older than 7 days..."
  & docker builder prune -af --filter "until=168h" | Out-Null
  & docker image prune -af --filter "until=168h" | Out-Null
  & docker container prune -f | Out-Null

  $afterFreeGb = Get-FreeSpaceGB
  if ($null -ne $afterFreeGb) {
    Write-Output "Docker cleanup complete. Free space: ${afterFreeGb}GB"
  }
}

try {
  $existingPid = Get-DevServerPid
  if ($existingPid) {
    Write-Output "Dev server already listening on port $Port (PID $existingPid)."
    exit 0
  }

  Try-PruneDockerOnLowDisk -MinFreeGB $MinFreeGBForCleanup

  if (-not (Test-Path -LiteralPath $RepoDir)) {
    throw "Repo directory not found: $RepoDir"
  }

  $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
  if (-not $npmCmd) {
    $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue)
  }

  if (-not $npmCmd) {
    throw "npm executable was not found."
  }

  $logsDir = Join-Path $RepoDir "logs"
  if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  }

  $stdoutLog = Join-Path $logsDir "dev-autostart.out.log"
  $stderrLog = Join-Path $logsDir "dev-autostart.err.log"

  $devProcess = Start-Process -FilePath $npmCmd.Source -ArgumentList @("run", "dev") -WorkingDirectory $RepoDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

  Write-Output "Dev autostart launched npm run dev (PID $($devProcess.Id))."
  exit 0
} catch {
  Write-Error $_
  exit 1
}