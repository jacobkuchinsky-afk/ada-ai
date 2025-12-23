@echo off
echo ========================================
echo    Ada AI - Full Local Development
echo ========================================
echo.
echo This starts BOTH the Python backend AND Next.js frontend locally.
echo No need for Vercel or ngrok - everything runs on your machine!
echo.
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Starting Python Backend Server...
start "Ada Backend" cmd /k "cd AI_server_python && pip install -r requirements.txt -q && echo Backend running on http://localhost:5000 && python main.py"

echo Waiting for backend to initialize...
timeout /t 3 /nobreak >nul

echo [2/2] Starting Next.js Frontend...
start "Ada Frontend" cmd /k "npm run dev"

echo.
echo ========================================
echo    Both servers are starting!
echo ========================================
echo.
echo Backend: http://localhost:5000
echo Frontend: http://localhost:3000 (open this in browser)
echo.
echo Two new terminal windows have opened.
echo Close them to stop the servers.
echo ========================================
pause



