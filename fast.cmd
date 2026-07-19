@echo off
setlocal
set "SHIP_PASSWORD=%~1"
if not "%~1"=="" shift

:run_fast
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\ship-local.ps1" -ShipPassword "%SHIP_PASSWORD%" -SkipAutoDependencyMaintenance -SkipMigrationValidation -SkipLocalCleanup -SkipDockerPrune -SkipVerifyGate
set "FAST_EXIT=%ERRORLEVEL%"
endlocal & exit /b %FAST_EXIT%
