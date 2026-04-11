param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$Port = 3000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-DevServerPid {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return $null
}

try {
  $existingPid = Get-DevServerPid
  if ($existingPid) {
    Write-Output "Dev server already listening on port $Port (PID $existingPid)."
    exit 0
  }

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