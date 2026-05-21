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

function Test-CoreApiReady {
  param(
    [string]$BaseUrl
  )

  $statusCode = Get-HttpStatusCode -Url "$BaseUrl/api/status"
  if ($null -eq $statusCode -or $statusCode -lt 200 -or $statusCode -ge 300) {
    return $false
  }

  $topStatusCode = Get-HttpStatusCode -Url "$BaseUrl/api/videos/top?take=1"
  if ($null -eq $topStatusCode -or $topStatusCode -lt 200 -or $topStatusCode -ge 300) {
    return $false
  }

  return $true
}

function Wait-ForCoreApiReady {
  param(
    [string]$BaseUrl,
    [int]$TimeoutSeconds
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    if (Test-CoreApiReady -BaseUrl $BaseUrl) {
      return
    }

    Start-Sleep -Milliseconds 700
  }

  throw "Timed out waiting for healthy API readiness at $BaseUrl after $TimeoutSeconds seconds."
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
$serverProcess = $null
$standaloneServerPath = Join-Path $RepoRoot "apps\web\.next\standalone\apps\web\server.js"

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
    if (Test-PortInUse -HostName "127.0.0.1" -Port $Port) {
      throw "Port $Port is already in use. Stop the existing listener before running verify:deps:full."
    }

    if (-not (Test-Path $standaloneServerPath)) {
      throw "Standalone server was not found at $standaloneServerPath. Run the production build before verify:deps:full."
    }

    $nodeCmd = (Get-Command node -ErrorAction SilentlyContinue)
    if (-not $nodeCmd) {
      throw "node executable was not found."
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodeCmd.Source
    $startInfo.WorkingDirectory = (Join-Path $RepoRoot "apps\web")
    $startInfo.Arguments = $standaloneServerPath
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $false
    $startInfo.RedirectStandardError = $false
    $startInfo.Environment["NEXT_PUBLIC_DISABLE_DESKTOP_INTRO"] = "1"
    $startInfo.Environment["NODE_ENV"] = "production"
    $startInfo.Environment["HOSTNAME"] = "127.0.0.1"
    $startInfo.Environment["PORT"] = [string]$Port

    $serverProcess = [System.Diagnostics.Process]::Start($startInfo)
    if (-not $serverProcess) {
      throw "Failed to start test server process."
    }

    Wait-ForCoreApiReady -BaseUrl $baseUrl -TimeoutSeconds $ServerStartTimeoutSeconds
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
  if ($serverProcess -and -not $serverProcess.HasExited) {
    try {
      Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    } catch {
      # Best-effort cleanup.
    }
  }
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
