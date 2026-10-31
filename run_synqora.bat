@echo off
TITLE Synqora Protocol 2026 - Master Unified Boot Engine
COLOR 0B

echo ================================================================
echo       SYNQORA 2026 -- MASTER DUAL-STACK ORCHESTRATOR
echo ================================================================
echo.

:: Change directory to script location
cd /d "%~dp0"

:: 1. Launch Node.js Core Backend
echo [1/2] Starting Synqora Node.js Core Backend on Port 5000...
start "Synqora Node.js Core (Port 5000)" cmd /k "cd /d "%~dp0backend" && node server.js"

timeout /t 2 /nobreak >nul

:: 2. Launch FastAPI Python AI Engine
echo [2/2] Starting Synqora Python AI Assessment Engine on Port 8000...
start "Synqora Python FastAPI AI Engine (Port 8000)" cmd /k "cd /d "%~dp0backend" && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

echo.
echo ================================================================
echo  All microservices dispatched!
echo  - Node.js Core API:       http://localhost:5000/api
echo  - Python AI Engine API:   http://localhost:8000/api/questions
echo  - Landing Page:           %~dp0frontend\index.html
echo ================================================================
echo.
echo Close this window or press any key to exit the launcher.
pause >nul
