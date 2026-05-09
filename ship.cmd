@echo off
setlocal
set "SHIP_PASSWORD=%~1"
if not "%~1"=="" shift
set "SHIP_ARGS="
:collect_args
if "%~1"=="" goto run_ship
set "SHIP_ARGS=%SHIP_ARGS% "%~1""
shift
goto collect_args

:run_ship
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\ship-local.ps1" -ShipPassword "%SHIP_PASSWORD%" %SHIP_ARGS%
endlocal
