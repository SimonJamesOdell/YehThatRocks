param(
    [int] $Port = 3100,
    [switch] $SkipBuild,
    [switch] $RunAll,
    [int] $TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir/.."
$serverJs = "$repoRoot/apps/web/.next/standalone/apps/web/server.js"
$envFile = "$repoRoot/apps/web/.env.local"

$passCount = 0
$failCount = 0
$results = @()

function Write-Step($label) {
    Write-Host "[$label] starting"
}

function Write-StepDone($label) {
    Write-Host "[$label] done"
}

function Write-StepFail($label, $reason) {
    Write-Host "[$label] FAILED: $reason"
}

# --- Phase 1: Build ---
if (-not $SkipBuild) {
    if (-not (Test-Path $serverJs)) {
        Write-Step "build"
        $buildResult = & npm run build 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-StepFail "build" "npm run build exited with code $LASTEXITCODE"
            Write-Host $buildResult
            exit 1
        }
        Write-StepDone "build"
    }
}

if (-not (Test-Path $serverJs)) {
    Write-Host "ERROR: standalone server not found at $serverJs"
    Write-Host "Run 'npm run build' first or remove -SkipBuild."
    exit 1
}

# --- Resolve DATABASE_URL and AUTH_JWT_SECRET ---
function Parse-Dotenv($path) {
    $vars = @{}
    if (-not (Test-Path $path)) { return $vars }
    Get-Content $path | ForEach-Object {
        $line = $_.Trim()
        if ($line -match '^\s*#' -or $line -eq '') { return }
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$') {
            $key = $Matches[1]
            $raw = $Matches[2].Trim()
            # Strip surrounding double or single quotes
            if ($raw.Length -ge 2) {
                $first = $raw[0]
                $last = $raw[$raw.Length - 1]
                if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                    $raw = $raw.Substring(1, $raw.Length - 2)
                }
            }
            $vars[$key] = $raw
        }
    }
    return $vars
}

$envFromFile = Parse-Dotenv $envFile

$dbUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
if (-not $dbUrl) { $dbUrl = $envFromFile["DATABASE_URL"] }

$jwtSecret = [Environment]::GetEnvironmentVariable("AUTH_JWT_SECRET", "Process")
if (-not $jwtSecret) { $jwtSecret = $envFromFile["AUTH_JWT_SECRET"] }

if (-not $dbUrl) {
    Write-Host "ERROR: DATABASE_URL is not set. Add it to apps/web/.env.local or your shell."
    exit 1
}
if (-not $jwtSecret) {
    Write-Host "ERROR: AUTH_JWT_SECRET is not set. Add it to apps/web/.env.local or your shell."
    exit 1
}

# --- Phase 2: Start server (or use existing) ---
$baseUrl = "http://127.0.0.1:$Port"
$serverAlreadyRunning = $false
$serverPid = $null

$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Write-Host "Server already running on port $Port (PID $($existing.OwningProcess)); using existing."
    $serverAlreadyRunning = $true
    $serverPid = $existing.OwningProcess
} else {
    Write-Step "start:test-server"

    $env:NODE_ENV = "production"
    $env:HOSTNAME = "127.0.0.1"
    $env:PORT = "$Port"
    $env:DATABASE_URL = $dbUrl
    $env:AUTH_JWT_SECRET = $jwtSecret
    $env:NEXT_PUBLIC_DISABLE_DESKTOP_INTRO = "1"

    $proc = Start-Process node -ArgumentList $serverJs -PassThru -NoNewWindow -RedirectStandardError "$repoRoot/test-api-server-stderr.log" -RedirectStandardOutput "$repoRoot/test-api-server-stdout.log"
    $serverPid = $proc.Id
    Write-Host "Server PID: $serverPid"

    # --- Phase 3: Wait for readiness ---
    Write-Host "Waiting for $baseUrl ..."
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    $lastError = ""

    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        try {
            $response = Invoke-WebRequest -Uri "$baseUrl/api/status" -UseBasicParsing -TimeoutSec 15
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                $ready = $true
                break
            }
            $lastError = "HTTP $($response.StatusCode)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 500
    }
    $sw.Stop()

    if (-not $ready) {
        Write-StepFail "start:test-server" "Server did not become ready within ${TimeoutSeconds}s. Last error: $lastError"
        Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
        exit 1
    }

    Write-Host "API ready after $([math]::Round($sw.Elapsed.TotalSeconds, 1))s"
    Write-StepDone "start:test-server"
}

# --- Phase 4: Run API tests ---
$tests = @(
    @{ Name = "verify-core-experience-api-smoke.js";     Script = "$scriptDir/verify-core-experience-api-smoke.js" },
    @{ Name = "verify-new-videos-api-smoke.js";          Script = "$scriptDir/verify-new-videos-api-smoke.js" },
    @{ Name = "verify-playlists-api-smoke.js";           Script = "$scriptDir/verify-playlists-api-smoke.js" },
    @{ Name = "verify-auth-api-smoke.js";                Script = "$scriptDir/verify-auth-api-smoke.js" },
    @{ Name = "verify-categories-invariants.js";         Script = "$scriptDir/verify-categories-invariants.js";       ExtraArgs = @("--check-api") }
)

$allPassed = $true

foreach ($test in $tests) {
    $stepLabel = "test:$($test.Name -replace '\.js$','' -replace 'verify-','')"
    Write-Step $stepLabel

    $args = @("--base-url=$baseUrl", "--timeout-ms=15000")
    if ($test.ExtraArgs) { $args += $test.ExtraArgs }

    $testResult = & node $test.Script @args 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0) {
        Write-StepDone $stepLabel
        $passCount++
        $results += @{ Name = $test.Name; Passed = $true }
    } else {
        Write-StepFail $stepLabel "exit code $exitCode"
        Write-Host $testResult
        $failCount++
        $results += @{ Name = $test.Name; Passed = $false }
        $allPassed = $false

        if (-not $RunAll) {
            Write-Host "Stopping on first failure. Use -RunAll to run every test."
            break
        }
    }
}

# --- Phase 5: Stop server and report ---
if (-not $serverAlreadyRunning) {
    Write-Step "stop:test-server"
    Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
    Write-Host "Server process $serverPid stopped."
} else {
    Write-Host "Server was already running — leaving it."
}

# Clean up log files
Remove-Item "$repoRoot/test-api-server-stderr.log", "$repoRoot/test-api-server-stdout.log" -ErrorAction SilentlyContinue

Write-Host "=== Results ==="
foreach ($r in $results) {
    $status = if ($r.Passed) { "Pass" } else { "FAIL" }
    Write-Host "  $status`: $($r.Name)"
}

if ($allPassed) {
    Write-Host "All $passCount tests passed."
    exit 0
} else {
    Write-Host "$passCount passed, $failCount failed."
    exit 1
}
