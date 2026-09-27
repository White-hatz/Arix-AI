@echo off
setlocal
cd /d "%~dp0\.."
if exist .venv\Scripts\python.exe (
  .venv\Scripts\python scripts\switch.py %*
) else (
  python scripts\switch.py %*
)
endlocal
