@echo off
echo ========================================
echo    Delved AI - Local Development Server
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Python dependencies...
pip install -r requirements.txt -q

echo [2/3] Starting Flask server on port 5000...
echo.
echo Server running at: http://localhost:5000
echo Health check: http://localhost:5000/api/health
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

python main.py






