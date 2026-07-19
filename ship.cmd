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

:run_ship
set "SHIP_FLAGS="

if "%SHIP_PASSWORD%"=="" goto invoke_ship

REM ── Gate 0: clean worktree before any testing or side-effect work ──
REM This must happen first — before verify:deps:full, npm audit, or
REM any other expensive operation that would waste time on a dirty tree.
git status --porcelain >nul 2>&1
if errorlevel 1 (
    echo ERROR: Unable to determine git worktree status.
    endlocal & exit /b 1
)
for /f "delims=" %%i in ('git status --porcelain 2^>nul ^| findstr "^."') do set "HAS_CHANGES=1"
if defined HAS_CHANGES (
    echo ERROR: Working tree is not clean. Commit or stash your changes before running ship.
    echo.
    echo Pending changes:
    git status --porcelain
    endlocal & exit /b 1
)
for /f "delims=" %%i in ('git clean -nd 2^>nul ^| findstr "^."') do set "HAS_UNTARCKED=1"
if defined HAS_UNTARCKED (
    echo ERROR: Working tree has untracked files or empty directories not in .gitignore.
    echo These would be included in the Docker build context and may corrupt the image.
    echo Remove them ^(or add to .gitignore^) before running ship:
    echo.
    git clean -nd
    endlocal & exit /b 1
)
echo [✓] Working tree is clean — proceeding with ship checks...
echo.

if /I "%SHIP_MODE%"=="fast" (
	set "SHIP_FLAGS=-SkipAutoDependencyMaintenance -SkipMigrationValidation -SkipLocalCleanup -SkipDockerPrune -SkipVerifyGate"
) else if /I "%SHIP_MODE%"=="regular" (
	pushd "%~dp0"
	echo [regular] running npm audit
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
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\ship-local.ps1" -ShipPassword "%SHIP_PASSWORD%" %SHIP_FLAGS%
set "SHIP_EXIT=%ERRORLEVEL%"
endlocal & exit /b %SHIP_EXIT%