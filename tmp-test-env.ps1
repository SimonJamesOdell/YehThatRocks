$RepoRoot = "C:\Users\simon\yeh2"
$Port = 3107
$standaloneServerPath = Join-Path $RepoRoot "apps\web\.next\standalone\apps\web\server.js"
$nodeCmd = Get-Command node -ErrorAction Stop

Write-Host "Starting server with ProcessStartInfo, checking if it stays alive..."
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $nodeCmd.Source
$psi.WorkingDirectory = (Join-Path $RepoRoot "apps\web")
$psi.Arguments = $standaloneServerPath
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.Environment["DATABASE_URL"] = "mysql://root:yehthatrocks@127.0.0.1:3307/yeh"
$psi.Environment["NODE_ENV"] = "production"
$psi.Environment["HOSTNAME"] = "127.0.0.1"
$psi.Environment["PORT"] = [string]$Port
$psi.Environment["AUTH_JWT_SECRET"] = "test-secret-for-testing-minimum-32-chars"
$psi.Environment["MEMORY_PRESSURE_GUARD_DISABLED"] = "1"
$psi.Environment["NEXT_PUBLIC_DISABLE_DESKTOP_INTRO"] = "1"
$p = [System.Diagnostics.Process]::Start($psi)

# Check every second for 15 seconds
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep 1
    $exited = $p.HasExited
    $listening = netstat -ano 2>$null | Select-String "LISTENING.*$Port"
    Write-Host "t+${i}s: HasExited=$exited, Listening=$($listening -ne $null)"
    if ($exited) {
        Write-Host "EXIT CODE: $($p.ExitCode)"
        break
    }
}
if (-not $p.HasExited) { $p.Kill() }
Write-Host "STDOUT: $($p.StandardOutput.ReadToEnd())"
Write-Host "STDERR: $($p.StandardError.ReadToEnd())"
