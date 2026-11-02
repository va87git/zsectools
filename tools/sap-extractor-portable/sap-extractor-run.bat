@echo off
cd /d "%~dp0"
echo Starting zsectools portable SAP extractor...
rem Debug (SNC/SSO): uncomment the next two lines to enable the NW RFC trace
rem (creates *.trc files and dev_rfc.log in this folder - useful when an
rem SAP_SSO logon fails and you need the low-level connection details)
rem set "RFC_TRACE=1"
rem set "RFC_TRACE_DIR=%~dp0"
rem The SAP GUI OCX controls are 32-bit: use the 32-bit Windows Script Host
set "CSCRIPT=%SystemRoot%\SysWOW64\cscript.exe"
if not exist "%CSCRIPT%" set "CSCRIPT=%SystemRoot%\System32\cscript.exe"
rem The script restarts itself when needed (memory hygiene): no manual relaunch
"%CSCRIPT%" //nologo "%~dp0sap-extractor.vbs"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo The extractor ended with exit code %RC% - see the messages above and sap-extractor.log
pause
exit /b %RC%
