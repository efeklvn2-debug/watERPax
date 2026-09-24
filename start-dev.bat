@echo off
echo Starting WatERPax servers...
echo.

:: PostgreSQL (no-op if already running)
echo Ensuring PostgreSQL is running...
"C:\Program Files\PostgreSQL\15\bin\pg_ctl.exe" start -D "C:\Program Files\PostgreSQL\15\data" -w -t 30 2>nul
echo.

:: Backend
echo Starting backend on port 3001...
start "WatERPax Backend" cmd /c "cd /d %~dp0apps\backend && set DATABASE_URL=postgresql://postgres:Fireflies@127.0.0.1:5432/waterpax?schema=public&& set JWT_SECRET=test-jwt-secret-key-for-local-testing-waterpax&& set ADMIN_PASSWORD=admin123&& set CORS_ORIGIN=http://localhost:5173&& set PORT=3001&& set NODE_ENV=development&& set LOG_LEVEL=info&& npx tsx src/index.ts"

:: Frontend
echo Starting frontend on port 5173...
start "WatERPax Frontend" cmd /c "cd /d %~dp0apps\frontend && npx vite --port 5173"

echo.
echo WatERPax dev servers starting:
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo.
echo Login: superadmin / admin123
echo.
echo Close this window or press Ctrl+C to stop.
pause
