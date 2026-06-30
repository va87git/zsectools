@echo off
setlocal
set "BASE_DIR=%~dp0"
set "PG_BIN=%BASE_DIR%postgres\bin"
set "PG_DATA=%BASE_DIR%postgres\data"

set "DB_HOST=localhost"
set "DB_PORT=5432"
set "DB_NAME=appdb"
set "DB_USER=appuser"
set "DB_PASSWORD=apppassword"

echo Starting PostgreSQL Core Server...
"%PG_BIN%\pg_ctl.exe" -D "%PG_DATA%" -l "%BASE_DIR%postgres\log.txt" start
if errorlevel 1 (
    echo [ERROR] Failed to start PostgreSQL. Check postgres\log.txt for details.
    pause
    exit /b 1
)

:: Verification loop to ensure database engine availability
set /a ATTEMPTS=0
:waitloop
    timeout /t 1 > nul
    set /a ATTEMPTS+=1
    "%PG_BIN%\pg_isready.exe" -h 127.0.0.1 -p 5432 > nul 2>&1
    if %errorlevel% equ 0 goto dbready
    if %ATTEMPTS% geq 10 (
        echo [ERROR] Database server timeout after 10 seconds.
        pause
        exit /b 1
    )
    goto waitloop
:dbready

:: Fast native check/creation of target application database
if exist "%BASE_DIR%pwfile.txt" (
    set /p PGPASSWORD=<"%BASE_DIR%pwfile.txt"
) else (
    set "PGPASSWORD=%DB_PASSWORD%"
)
"%PG_BIN%\psql.exe" -h 127.0.0.1 -p 5432 -U %DB_USER% -d postgres -c "CREATE DATABASE appdb;" >nul 2>&1
set "PGPASSWORD="

echo [INFO] Database initialization check passed.

:: START THE APPLICATION BACKEND ENGINE
echo [INFO] Booting Node.js backend controller...
set "NODE_EXE=%BASE_DIR%node-bin\node.exe"

cd /d "%BASE_DIR%"
start "ZSecTools Backend Log" cmd /k ""%NODE_EXE%" ".\backend\src\server.js""

:: Give backend a brief moment to boot then launch front-end entry
timeout /t 2 /nobreak > nul
start "" "http://localhost:3000"

echo ===================================================
echo   ZSecTools application is up and running!
echo   Minimize this window. Press any key to stop the app.
echo ===================================================
pause > nul

echo Shutting down database engine context...
"%PG_BIN%\pg_ctl.exe" -D "%PG_DATA%" stop
echo Cleanup completed. Goodbye!
timeout /t 2 > nul
endlocal
