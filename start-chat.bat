@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo Starting Codebase Chat...
echo.

:: Allocate port using helper script
for /f "tokens=1" %%a in ('node "%~dp0scripts\get-port.mjs" 3002') do (
    set CHAT_PORT=%%a
)
echo [PORTS] Chat: %CHAT_PORT%

cd code_knowledge
start "" "http://localhost:%CHAT_PORT%"
npx codebase-knowledge-extractor chat --port %CHAT_PORT% --data-dir ../data
