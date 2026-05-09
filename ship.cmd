@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -Command "$pw = if ($args.Count -gt 0) { [string]$args[0] } else { '' }; $rest = if ($args.Count -gt 1) { $args[1..($args.Count-1)] } else { @() }; & '%~dp0deploy\ship-local.ps1' -ShipPassword $pw @rest" -- %*
endlocal
