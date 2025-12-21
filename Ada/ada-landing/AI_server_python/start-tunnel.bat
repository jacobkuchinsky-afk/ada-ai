@echo off
echo ========================================
echo    Ada AI - Public Tunnel (localtunnel)
echo ========================================
echo.
echo This will create a public URL for your local server.
echo Make sure start-dev.bat is running in another terminal!
echo.
echo Your URL will be: https://ada-dev.loca.lt
echo Set this as NEXT_PUBLIC_API_URL in Vercel.
echo.
echo NOTE: First-time visitors must click "Click to Continue"
echo on the localtunnel page to access the API.
echo.
echo ========================================
echo.

lt --port 5000 --subdomain ada-dev

