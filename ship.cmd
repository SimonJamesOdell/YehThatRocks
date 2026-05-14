@echo off
setlocal
set "SHIP_MODE=regular"
if /I "%~1"=="fast" (
	set "SHIP_MODE=fast"
	shift
) else if /I "%~1"=="slow" (
	set "SHIP_MODE=slow"
	shift
)

set "SHIP_PASSWORD=%~1"
if not "%~1"=="" shift
set "SHIP_ARGS="
:collect_args
if "%~1"=="" goto run_ship
set "SHIP_ARGS=%SHIP_ARGS% "%~1""
shift
goto collect_args

:run_ship
set "SHIP_FLAGS="

if "%SHIP_PASSWORD%"=="" goto invoke_ship

if /I "%SHIP_MODE%"=="fast" (
	set "SHIP_FLAGS=-SkipAutoDependencyMaintenance -SkipMigrationValidation -SkipLocalCleanup -SkipDockerPrune"
) else if /I "%SHIP_MODE%"=="regular" (
	pushd "%~dp0"
	echo [regular] running checks: verify:deps:full and audit
	call npm run verify:deps:full
	if errorlevel 1 (
		set "SHIP_EXIT=%ERRORLEVEL%"
		popd
		endlocal & exit /b %SHIP_EXIT%
	)

	call npm audit --audit-level=high
	if errorlevel 1 (
		set "SHIP_EXIT=%ERRORLEVEL%"
		popd
		endlocal & exit /b %SHIP_EXIT%
	)
	popd

	set "SHIP_FLAGS=-SkipAutoDependencyMaintenance"
)

:invoke_ship
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\ship-local.ps1" -ShipPassword "%SHIP_PASSWORD%" %SHIP_FLAGS% %SHIP_ARGS%
set "SHIP_EXIT=%ERRORLEVEL%"
endlocal & exit /b %SHIP_EXIT%
