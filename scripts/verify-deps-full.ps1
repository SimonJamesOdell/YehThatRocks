param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".." )).Path,
  [int]$Port = 3100,
  [int]$ServerStartTimeoutSeconds = 180,
  [switch]$SkipInvariants
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
trap {
  Write-Error $_
  exit 1
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

function Wait-ForHttp {
  param(
    [string]$Url,
    [int]$TimeoutSeconds
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return
      }
    } catch {
      # Server is still starting.
    }

    Start-Sleep -Milliseconds 700
  }

  throw "Timed out waiting for server at $Url after $TimeoutSeconds seconds."
}

function Invoke-Npm {
  param(
    [string[]]$NpmArgs,
    [hashtable]$ExtraEnv = @{}
  )

  if (-not $NpmArgs -or $NpmArgs.Count -eq 0) {
    throw "Invoke-Npm requires at least one npm argument."
  }

  $snapshot = @{}
  foreach ($key in $ExtraEnv.Keys) {
    $snapshot[$key] = [Environment]::GetEnvironmentVariable($key)
    [Environment]::SetEnvironmentVariable($key, [string]$ExtraEnv[$key])
  }

  try {
    & npm @NpmArgs
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($NpmArgs -join ' ') failed with exit code $LASTEXITCODE"
    }
  } finally {
    foreach ($key in $ExtraEnv.Keys) {
      [Environment]::SetEnvironmentVariable($key, $snapshot[$key])
    }
  }
}

Set-Location $RepoRoot

$baseUrl = "http://127.0.0.1:$Port"
$devProcess = $null

try {
  if (-not $SkipInvariants) {
    Invoke-Step -Name "verify:invariants" -Action {
      Invoke-Npm -NpmArgs @("run", "verify:invariants")
    }
  }

  Invoke-Step -Name "test:smoke:install" -Action {
    Invoke-Npm -NpmArgs @("run", "test:smoke:install")
  }

  Invoke-Step -Name "start:test-server" -Action {
    $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
    if (-not $npmCmd) {
      $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue)
    }

    if (-not $npmCmd) {
      throw "npm executable was not found."
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $npmCmd.Source
    $startInfo.WorkingDirectory = $RepoRoot
    $startInfo.Arguments = "-w web run dev -- --port $Port"
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $false
    $startInfo.RedirectStandardError = $false
    $startInfo.Environment["NEXT_PUBLIC_DISABLE_DESKTOP_INTRO"] = "1"

    $devProcess = [System.Diagnostics.Process]::Start($startInfo)
    if (-not $devProcess) {
      throw "Failed to start test server process."
    }

    Wait-ForHttp -Url "$baseUrl/api/status" -TimeoutSeconds $ServerStartTimeoutSeconds
  }

  Invoke-Step -Name "verify:invariants:api" -Action {
    Invoke-Npm -NpmArgs @("run", "verify:core-experience:api", "--", "--base-url=$baseUrl")
    Invoke-Npm -NpmArgs @("run", "verify:playlists:api", "--", "--base-url=$baseUrl")
    Invoke-Npm -NpmArgs @("run", "verify:categories:api", "--", "--base-url=$baseUrl")
    Invoke-Npm -NpmArgs @("run", "verify:auth:api", "--", "--base-url=$baseUrl")
  }

  Invoke-Step -Name "test:smoke:full" -Action {
    Invoke-Npm -NpmArgs @("run", "test:smoke:full") -ExtraEnv @{ PLAYWRIGHT_BASE_URL = $baseUrl }
  }
} finally {
  if ($devProcess -and -not $devProcess.HasExited) {
    try {
      Stop-Process -Id $devProcess.Id -Force -ErrorAction SilentlyContinue
    } catch {
      # Best-effort cleanup.
    }
  }
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
