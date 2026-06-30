@echo off
setlocal
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"
cd /d "%BASE_DIR%"

:: Redirect all output (stdout and stderr) to a log file dynamically
call :main > "%BASE_DIR%\installation_log.txt" 2>&1
exit /b %errorlevel%

:main
echo ===================================================
echo   ZSecTools - Background Services Administration
echo ===================================================
echo Current Directory: %CD%

set "PG_BIN=%BASE_DIR%\postgres\bin"
set "PG_DATA=%BASE_DIR%\postgres\data"
set "WINSW_EXE=%BASE_DIR%\bin\ZSecTools_Backend.exe"

:: NATIVE PRIVILEGE CHECK
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [CRITICAL ERROR] Administrative privileges MISSING!
    exit /b 1
)

:: 1. REGISTER POSTGRESQL
echo [INFO] Registering PostgreSQL Core Service...
"%PG_BIN%\pg_ctl.exe" register -N "ZSecTools_Postgres" -D "%PG_DATA%" -w
echo PostgreSQL register exit code: %errorlevel%

:: 2. REGISTER NODE BACKEND VIA WINSW
echo [INFO] Checking WinSW target deployment...
if not exist "%WINSW_EXE%" (
    echo [ERROR] WinSW wrapper executable missing at: "%WINSW_EXE%"
    exit /b 1
)

echo [INFO] Invoking WinSW installation routine...
:: Running WinSW directly
"%WINSW_EXE%" install
echo WinSW install exit code: %errorlevel%

:: 3. RECONFIGURE BOOT STARTUP
echo [INFO] Locking service start states to Automatic...
sc config ZSecTools_Postgres start= auto
sc config ZSecTools_Backend start= auto
echo SC Config Backend exit code: %errorlevel%

:: 4. TRIGGER SERVICE IGNITION
echo [INFO] Booting system services...
net start ZSecTools_Postgres
net start ZSecTools_Backend

echo ===================================================
echo   Script Execution Finished.
echo ===================================================
exit /b 0
