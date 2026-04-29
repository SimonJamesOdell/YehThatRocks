param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$envFile = "C:\Users\simon\yeh2\apps\web\.env.local"
if (-not (Test-Path $envFile)) {
  Write-Error "Cannot find env file: $envFile"
  exit 1
}

$dbUrlLine = Get-Content -Path $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $dbUrlLine) {
  Write-Error "DATABASE_URL not found in $envFile"
  exit 1
}

$dbUrl = ($dbUrlLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
$pattern = '^mysql://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)'
if ($dbUrl -notmatch $pattern) {
  Write-Error "Unsupported DATABASE_URL format: $dbUrl"
  exit 1
}

$user = [System.Uri]::UnescapeDataString($matches[1])
$pass = [System.Uri]::UnescapeDataString($matches[2])
$host = $matches[3]
$port = if ($matches[4]) { $matches[4] } else { '3306' }
$db = $matches[5]

$mysqlArgs = @('-h', $host, '-P', $port, '-u', $user)
if ($pass) {
  $mysqlArgs += "-p$pass"
}
$mysqlArgs += $db
if ($CliArgs) {
  $mysqlArgs += $CliArgs
}

& mysql @mysqlArgs
exit $LASTEXITCODE