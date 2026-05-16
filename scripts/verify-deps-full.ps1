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

function Get-HttpStatusCode {
  param(
    [string]$Url
  )

  try {
    $resp = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck
    return [int]$resp.StatusCode
  } catch {
    return $null
  }
}

function Test-PortInUse {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$TimeoutMs = 1000
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    $connected = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
    if (-not $connected) {
      return $false
    }

    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
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

function Invoke-NodeScript {
  param(
    [string]$ScriptPath,
    [string[]]$ScriptArgs = @()
  )

  if (-not (Test-Path $ScriptPath)) {
    throw "Node script not found: $ScriptPath"
  }

  & node $ScriptPath @ScriptArgs
  if ($LASTEXITCODE -ne 0) {
    throw "node $ScriptPath $($ScriptArgs -join ' ') failed with exit code $LASTEXITCODE"
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
    $statusCode = Get-HttpStatusCode -Url "$baseUrl/api/status"
    if ($null -ne $statusCode) {
      if ($statusCode -ge 200 -and $statusCode -lt 300) {
        Write-Host "[start:test-server] reusing existing healthy server at $baseUrl (status=$statusCode)" -ForegroundColor Yellow
        return
      }

      throw "Port $Port already serves $baseUrl/api/status with status $statusCode. Refusing to start another dev server on the same port."
    }

    if (Test-PortInUse -HostName "127.0.0.1" -Port $Port) {
      throw "Port $Port is already in use by a non-HTTP or unresponsive process. Refusing to start another dev server."
    }

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
    Invoke-NodeScript -ScriptPath "scripts/verify-core-experience-api-smoke.js" -ScriptArgs @("--base-url=$baseUrl")
    Invoke-NodeScript -ScriptPath "scripts/verify-playlists-api-smoke.js" -ScriptArgs @("--base-url=$baseUrl")
    Invoke-NodeScript -ScriptPath "scripts/verify-categories-invariants.js" -ScriptArgs @("--check-api", "--base-url=$baseUrl")
    Invoke-NodeScript -ScriptPath "scripts/verify-auth-api-smoke.js" -ScriptArgs @("--base-url=$baseUrl")
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
