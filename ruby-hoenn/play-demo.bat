@echo off
REM Double-click to play the Emberleaf demo.
cd /d "%~dp0"
start "" python "..\server.py" 8000
timeout /t 2 /nobreak >nul
start "" http://localhost:8000/
