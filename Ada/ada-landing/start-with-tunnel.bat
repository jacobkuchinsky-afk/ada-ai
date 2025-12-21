@echo off
echo ========================================
echo    Ada AI - Local Server + Public URL
echo ========================================
echo.
echo This starts the Python backend and creates a public tunnel URL.
echo Use this when you want Vercel frontend to connect to your local server.
echo.
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Starting Python Backend Server...
start "Ada Backend" cmd /k "cd AI_server_python && pip install -r requirements.txt -q && echo Backend running on http://localhost:5000 && python main.py"

echo Waiting for backend to initialize...
timeout /t 5 /nobreak >nul

echo [2/2] Starting localtunnel...
echo.
echo ========================================
echo PUBLIC URL: https://ada-dev.loca.lt
echo.
echo Set NEXT_PUBLIC_API_URL in Vercel to this URL!
echo.
echo NOTE: First-time visitors must click "Click to Continue"
echo on the localtunnel page to access the API.
echo ========================================
echo.

lt --port 5000 --subdomain ada-dev

