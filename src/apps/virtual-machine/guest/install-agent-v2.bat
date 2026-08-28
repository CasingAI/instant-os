@echo off
rem install-agent-v2.bat -- install the Instant VM guest agent stack on XP:
rem   res-agent.exe          (COM1 remote-control agent, XP service)
rem   ivm-shm.sys            (shared-memory mailbox kernel driver)
rem   clipboard-bridge.exe   (clipboard sync between XP clipboard and the mailbox)
rem Run as Administrator. Place this file next to the exe/sys files (guest/out/ has all).
rem
rem Steps:
rem   1. kill running instances (old interactive processes / old services)
rem   2. delete old services if present
rem   3. remove legacy HKCU Run autorun key (old install method)
rem   4. copy files: exes to C:\Tools\, driver to C:\Windows\System32\drivers\
rem   5. create + start the kernel driver service (loads before the agent)
rem   6. create + start the res-agent service
rem   7. register clipboard-bridge in HKCU Run (clipboard lives in the
rem      interactive session; a service cannot touch it) and start it now
rem   8. verify with sc query
rem
rem A reboot is recommended afterwards so the driver loads in its normal
rem boot-time slot (start= system).

setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: run this script as Administrator.
  pause
  exit /b 1
)

echo [1/8] stopping existing instances...
taskkill /IM res-agent.exe /F >nul 2>&1
taskkill /IM clipboard-bridge.exe /F >nul 2>&1
sc stop InstantVmResAgent >nul 2>&1
sc stop InstantVmShm >nul 2>&1

echo [2/8] removing old services...
sc delete InstantVmResAgent >nul 2>&1
sc delete InstantVmShm >nul 2>&1

echo [3/8] removing legacy HKCU Run autorun (old agent install)...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ResAgent /f >nul 2>&1

echo [4/8] copying files...
if not exist "C:\Tools" mkdir "C:\Tools"
copy /Y "%~dp0res-agent.exe" "C:\Tools\res-agent.exe" >nul
if errorlevel 1 (
  echo ERROR: copy res-agent.exe failed.
  pause
  exit /b 1
)
copy /Y "%~dp0clipboard-bridge.exe" "C:\Tools\clipboard-bridge.exe" >nul
if errorlevel 1 (
  echo ERROR: copy clipboard-bridge.exe failed.
  pause
  exit /b 1
)
copy /Y "%~dp0ivm-shm.sys" "C:\Windows\System32\drivers\ivm-shm.sys" >nul
if errorlevel 1 (
  echo ERROR: copy ivm-shm.sys failed.
  pause
  exit /b 1
)

echo [5/8] creating and starting the mailbox driver...
sc create InstantVmShm type= kernel start= system binPath= "C:\Windows\System32\drivers\ivm-shm.sys"
sc description InstantVmShm "Instant VM shared-memory mailbox (host DMA channel)"
sc start InstantVmShm

echo [6/8] creating and starting the agent service...
sc create InstantVmResAgent type= own start= auto binPath= "C:\Tools\res-agent.exe"
sc description InstantVmResAgent "Instant VM guest agent (resolution + remote control)"
sc start InstantVmResAgent

echo [7/8] registering clipboard-bridge autostart...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v InstantVmClipboardBridge /t REG_SZ /d "C:\Tools\clipboard-bridge.exe" /f >nul
start "" "C:\Tools\clipboard-bridge.exe"

echo [8/8] verifying...
sc query InstantVmShm
sc query InstantVmResAgent
tasklist /FI "IMAGENAME eq clipboard-bridge.exe"

echo.
echo Done. Reboot once so the driver loads in its boot-time slot.
echo Double-click res-agent.exe to see its version/build date.
pause
