@echo off
setlocal
:: Strip trailing backslash from %~dp0 to avoid escape character issues (\") with quotes
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"

echo ===================================================
echo   ZSecTools - Environment Setup Initialization
echo ===================================================

:: 1. DOWNLOAD AND EXTRACT NODE.JS PORTABLE
if exist "%BASE_DIR%\node-bin\node.exe" (
    echo [OK] Node.js Portable is already configured in node-bin.
) else (
    echo [INFO] Downloading Node.js v24.18.0...
    curl -L "https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip" -o "%BASE_DIR%\node.zip"
    if errorlevel 1 (
        echo [ERROR] Curl failed to download Node.js.
        pause
        exit /b 1
    )
    
    echo [INFO] Extracting Node.js...
    tar -xf "%BASE_DIR%\node.zip" -C "%BASE_DIR%"
    if errorlevel 1 (
        echo [ERROR] Tar failed to extract node.zip.
        pause
        exit /b 1
    )
    
    echo [INFO] Normalizing Node.js directory name...
    if exist "%BASE_DIR%\node-bin" rmdir /s /q "%BASE_DIR%\node-bin"
    
    rename "%BASE_DIR%\node-v24.18.0-win-x64" "node-bin"
    if errorlevel 1 (
        echo [ERROR] Failed to rename node folder to node-bin.
        pause
        exit /b 1
    )
    
    del "%BASE_DIR%\node.zip"
)

:: 2. DOWNLOAD AND EXTRACT POSTGRESQL PORTABLE
if exist "%BASE_DIR%\postgres\bin\pg_ctl.exe" (
    echo [OK] PostgreSQL Portable is already configured in postgres.
) else (
    echo [INFO] Downloading PostgreSQL Portable v16.3...
    curl -L "https://get.enterprisedb.com/postgresql/postgresql-16.3-1-windows-x64-binaries.zip" -o "%BASE_DIR%\postgres.zip"
    if errorlevel 1 (
        echo [ERROR] Curl failed to download PostgreSQL binaries.
        pause
        exit /b 1
    )
    
    echo [INFO] Extracting PostgreSQL...
    tar -xf "%BASE_DIR%\postgres.zip" -C "%BASE_DIR%"
    if errorlevel 1 (
        echo [ERROR] Tar failed to extract postgres.zip.
        pause
        exit /b 1
    )
    
    echo [INFO] Normalizing PostgreSQL directory name...
    if exist "%BASE_DIR%\postgres" rmdir /s /q "%BASE_DIR%\postgres"
    
    if exist "%BASE_DIR%\pgsql" (
        rename "%BASE_DIR%\pgsql" "postgres"
    ) else (
        echo [ERROR] Expected directory 'pgsql' was not found after extraction.
        pause
        exit /b 1
    )
    
    del "%BASE_DIR%\postgres.zip"
)

set "PATH=%PATH%;%BASE_DIR%\node-bin"

:: 3. INSTALL BACKEND DEPENDENCIES
echo [INFO] Installing backend dependencies...
cd /d "%BASE_DIR%\backend"
call "%BASE_DIR%\node-bin\npm" install --ignore-scripts

:: 4. INSTALL FRONTEND DEPENDENCIES AND BUILD
echo [INFO] Installing frontend dependencies and building assets...
cd /d "%BASE_DIR%\frontend"
call "%BASE_DIR%\node-bin\npm" install
call "%BASE_DIR%\node-bin\npm" run build
cd /d "%BASE_DIR%"

:: 5. INITIALIZE POSTGRESQL DATABASE TRACK (DEBUGGED BLOCK)
set "PG_DATA=%BASE_DIR%\postgres\data"
set "PG_BIN=%BASE_DIR%\postgres\bin"

if exist "%PG_DATA%\PG_VERSION" (
    echo [OK] PostgreSQL cluster is already initialized.
) else (
    echo [INFO] Checking Database initialization prerequisites...
    
    :: Automated fallback: If pwfile.txt is missing, we create a temporary one to prevent initdb from crashing
    if not exist "%BASE_DIR%\pwfile.txt" (
        echo [WARN] pwfile.txt was missing! Generating a default one for setup...
        echo apppassword> "%BASE_DIR%\pwfile.txt"
    )
    
    if not exist "%PG_DATA%" mkdir "%PG_DATA%"
    
    echo [INFO] Executing initdb.exe core routine...
    echo Target Path: "%PG_BIN%\initdb.exe"
    
    :: Run initdb dynamically and capture direct errors without closing window
    "%PG_BIN%\initdb.exe" -D "%PG_DATA%" -U appuser -A md5 --pwfile="%BASE_DIR%\pwfile.txt" -E UTF8
    
    if errorlevel 1 (
        echo.
        echo [CRITICAL ERROR] initdb.exe failed with exit code %errorlevel%.
        echo Troubleshooting steps:
        echo 1. Ensure your antivirus or OneDrive is not locking the "%BASE_DIR%\postgres" directory.
        echo 2. Try running this command prompt as Administrator.
        echo.
        pause
        exit /b 1
    )
)

echo ===================================================
echo   Setup completed successfully!
echo ===================================================
pause
endlocal
