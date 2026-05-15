@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
	echo Node.js is required but was not found in PATH.
	pause
	exit /b 1
)

if not exist node_modules\playwright-core (
	echo Installing dependencies...
	call npm.cmd install
	if errorlevel 1 (
		echo Dependency installation failed.
		pause
		exit /b 1
	)
)

start "" "http://127.0.0.1:7355"
call npm.cmd start
