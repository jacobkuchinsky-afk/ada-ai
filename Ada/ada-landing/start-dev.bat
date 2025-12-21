@echo off
title Ada AI Development Server
color 0A

echo.
echo ========================================
echo     ADA AI - Development Server
echo ========================================
echo.

:: Check if ngrok is installed
where ngrok >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] ngrok is not installed!
    echo.
    echo Please install ngrok:
    echo   1. Download from: https://ngrok.com/download
    echo   2. Or run: winget install ngrok
    echo.
    pause
    exit /b 1
)

:: Navigate to Python server directory
cd /d "%~dp0AI_server_python"

:: Check if .env file exists
if not exist ".env" (
    echo [WARNING] .env file not found!
    echo.
    echo Creating .env from template...
    if exist ".env.example" (
        copy .env.example .env >nul
        echo [INFO] Created .env file. Please edit it with your API keys!
        echo.
        echo Opening .env file for editing...
        notepad .env
        echo.
        echo After saving your API keys, press any key to continue...
        pause >nul
    ) else (
        echo [ERROR] .env.example not found. Please create .env manually.
        pause
        exit /b 1
    )
)

:: Check if Python dependencies are installed
echo [1/3] Checking Python dependencies...
pip show flask >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Installing dependencies...
    pip install -r requirements.txt
)

echo.
echo [2/3] Starting Flask server on port 5000...
echo.

:: Start Flask server in background
start "Ada Flask Server" cmd /k "python main.py"

:: Wait a moment for server to start
timeout /t 3 /nobreak >nul

echo [3/3] Starting ngrok tunnel...
echo.
echo ========================================
echo   Your PUBLIC URL will appear below
echo   Copy it to Vercel: NEXT_PUBLIC_API_URL
echo ========================================
echo.

:: Start ngrok (this will show the public URL)
ngrok http 5000

:: When ngrok is closed, also close the Flask server
taskkill /FI "WINDOWTITLE eq Ada Flask Server*" /F >nul 2>nul

echo.
echo Server stopped.
pause

