@echo off
rem install-agent-v2.bat -- install res-agent as an XP service (replaces HKCU Run autorun).
rem Run as Administrator. Place this file next to res-agent.exe (guest/out/ contains both).
rem
rem Steps:
rem   1. kill any running instance (old interactive process or old service)
rem   2. delete old service if present
rem   3. remove legacy HKCU Run autorun key (old install method)
rem   4. copy res-agent.exe to C:\Tools\
rem   5. create + start service InstantVmResAgent
rem   6. verify with sc query

setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: run this script as Administrator.
  pause
  exit /b 1
)

echo [1/6] stopping existing instance...
taskkill /IM res-agent.exe /F >nul 2>&1
sc stop InstantVmResAgent >nul 2>&1

echo [2/6] removing old service...
sc delete InstantVmResAgent >nul 2>&1

echo [3/6] removing legacy HKCU Run autorun...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ResAgent /f >nul 2>&1

echo [4/6] copying exe to C:\Tools\...
if not exist "C:\Tools" mkdir "C:\Tools"
copy /Y "%~dp0res-agent.exe" "C:\Tools\res-agent.exe" >nul
if errorlevel 1 (
  echo ERROR: copy failed.
  pause
  exit /b 1
)

echo [5/6] creating and starting service...
sc create InstantVmResAgent type= own start= auto binPath= "C:\Tools\res-agent.exe"
sc description InstantVmResAgent "Instant VM guest agent (resolution + remote control)"
sc start InstantVmResAgent

echo [6/6] verifying...
sc query InstantVmResAgent

echo.
echo Done. Double-click res-agent.exe again to see its version/build date.
pause