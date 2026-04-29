@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\ship-local.ps1"
endlocal
