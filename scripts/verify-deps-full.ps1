param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".." )).Path,
  [int]$Port = 3100,
  [int]$ServerStartTimeoutSeconds = 180,
  [switch]$SkipInvariants
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

function Get-ListeningProcessIdForPort {
  param(
    [int]$Port
  )

  try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      return [int]$listener.OwningProcess
    }
  } catch {
    return $null
  }

  return $null
}

function Stop-StaleStandaloneServerForPort {
  param(
    [int]$Port,
    [string]$StandaloneServerPath
  )

  $listenerProcessId = Get-ListeningProcessIdForPort -Port $Port
  if (-not $listenerProcessId) {
    return $false
  }

  $process = $null
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerProcessId" | Select-Object -First 1
  } catch {
    return $false
  }

  $commandLine = [string]$process.CommandLine
  if ([string]::IsNullOrWhiteSpace($commandLine) -or $commandLine -notlike "*$StandaloneServerPath*") {
    return $false
  }

  try {
    Stop-Process -Id $listenerProcessId -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $listenerProcessId -Timeout 5 -ErrorAction SilentlyContinue
  } catch {
    return $false
  }

  return -not (Test-PortInUse -HostName "127.0.0.1" -Port $Port)
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

function Get-DotEnvVariable {
  param(
    [string]$FilePath,
    [string]$Name
  )

  if (-not (Test-Path $FilePath)) {
    return $null
  }

  $pattern = "^\s*" + [Regex]::Escape($Name) + "\s*=\s*(.+?)\s*$"
  foreach ($line in Get-Content -Path $FilePath) {
    if ($line -match '^\s*#') {
      continue
    }

    if ($line -match $pattern) {
      $value = $matches[1].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }

  return $null
}

function Resolve-EnvValue {
  param(
    [string]$RepoRootPath,
    [string]$Name
  )

  $fromEnv = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
    return $fromEnv
  }

  $paths = @(
    (Join-Path $RepoRootPath "apps\web\.env.local"),
    (Join-Path $RepoRootPath ".env.local")
  )

  foreach ($path in $paths) {
    $value = Get-DotEnvVariable -FilePath $path -Name $Name
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }

  return $null
}

Set-Location $RepoRoot

$baseUrl = "http://127.0.0.1:$Port"
$serverProcess = $null
$standaloneServerPath = Join-Path $RepoRoot "apps\web\.next\standalone\apps\web\server.js"
$scriptFailed = $false

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
      if (-not (Stop-StaleStandaloneServerForPort -Port $Port -StandaloneServerPath $standaloneServerPath)) {
        throw "Port $Port is already in use. Stop the existing listener before running verify:deps:full."
      }
    }

    if (-not (Test-Path $standaloneServerPath)) {
      throw "Standalone server was not found at $standaloneServerPath. Run the production build before verify:deps:full."
    }

    $nodeCmd = (Get-Command node -ErrorAction SilentlyContinue)
    if (-not $nodeCmd) {
      throw "node executable was not found."
    }

    $databaseUrl = Resolve-EnvValue -RepoRootPath $RepoRoot -Name "DATABASE_URL"
    if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
      throw "DATABASE_URL is not configured. Set it in the environment or apps/web/.env.local before running verify:deps:full."
    }
    # Verify MySQL is accepting TCP connections before starting the server.
    # This prevents the MariaDB pool from permanently exhausting (active=0 idle=0)
    # when the Docker container is briefly unavailable during a restart/recreate window.
    $dbHost = "127.0.0.1"
    $dbPort = 3307
    if ($databaseUrl -match '@([^:]+):(\d+)/') {
      $dbHost = $matches[1]
      $dbPort = [int]$matches[2]
    }
    Write-Host "Checking MySQL connectivity at ${dbHost}:${dbPort} ..." -ForegroundColor Cyan
    $dbReady = $false
    $dbStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $dbTimeoutMs = 15000
    while ($dbStopwatch.ElapsedMilliseconds -lt $dbTimeoutMs) {
      try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect($dbHost, $dbPort, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne(2000, $false)) {
          $tcp.EndConnect($iar)
          $tcp.Close()
          $dbReady = $true
          break
        }
        $tcp.Close()
      } catch {
        # Retry.
      }
      Start-Sleep -Milliseconds 500
    }
    $dbStopwatch.Stop()
    if (-not $dbReady) {
      throw "MySQL is not accepting TCP connections at ${dbHost}:${dbPort} after $([math]::Round($dbStopwatch.Elapsed.TotalSeconds, 1))s. Ensure the Docker db container is running and healthy."
    }
    Write-Host "MySQL connectivity confirmed at ${dbHost}:${dbPort}" -ForegroundColor Green

    $authJwtSecret = Resolve-EnvValue -RepoRootPath $RepoRoot -Name "AUTH_JWT_SECRET"
    if ([string]::IsNullOrWhiteSpace($authJwtSecret) -or $authJwtSecret.Length -lt 32) {
      throw "AUTH_JWT_SECRET must be configured (32+ chars) in the environment or apps/web/.env.local before running verify:deps:full."
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodeCmd.Source
    $startInfo.WorkingDirectory = (Split-Path $standaloneServerPath -Parent)
    $startInfo.Arguments = $standaloneServerPath
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $false
    $startInfo.RedirectStandardError = $false
    $startInfo.Environment["NEXT_PUBLIC_DISABLE_DESKTOP_INTRO"] = "1"
    $startInfo.Environment["NODE_ENV"] = "production"
    $startInfo.Environment["HOSTNAME"] = "127.0.0.1"
    $startInfo.Environment["PORT"] = [string]$Port
    $startInfo.Environment["DATABASE_URL"] = $databaseUrl
    $startInfo.Environment["AUTH_JWT_SECRET"] = $authJwtSecret
    $startInfo.Environment["MEMORY_PRESSURE_GUARD_DISABLED"] = "1"

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
} catch {
  $scriptFailed = $true
  Write-Error $_
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    try {
      Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
      $serverProcess.WaitForExit(5000) | Out-Null
    } catch {
      # Best-effort cleanup.
    }
  }

  if (Test-PortInUse -HostName "127.0.0.1" -Port $Port) {
    try {
      [void](Stop-StaleStandaloneServerForPort -Port $Port -StandaloneServerPath $standaloneServerPath)
    } catch {
      # Best-effort cleanup.
    }
  }
}

if ($scriptFailed) {
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
  exit 1
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}