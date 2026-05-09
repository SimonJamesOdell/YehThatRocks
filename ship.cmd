@echo off
setlocal
set "SHIP_PASSWORD=%~1"
if not "%~1"=="" shift
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\ship-local.ps1" -ShipPassword "%SHIP_PASSWORD%" %*
endlocal
