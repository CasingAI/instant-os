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

rem Admin probe: try to write into %SystemRoot% (Users cannot, Administrators
rem can). `net session` was unreliable here: it also fails when the Server
rem service is not running, which reads as "not admin" on stripped XP images.
del "%SystemRoot%\__ivm_admin_probe.tmp" >nul 2>&1
echo probe > "%SystemRoot%\__ivm_admin_probe.tmp" 2>nul
if not exist "%SystemRoot%\__ivm_admin_probe.tmp" (
  echo ERROR: run this script as Administrator.
  pause
  exit /b 1
)
del "%SystemRoot%\__ivm_admin_probe.tmp" >nul 2>&1

echo [1/8] stopping existing instances...
taskkill /IM res-agent.exe /F >nul 2>&1
taskkill /IM clipboard-bridge.exe /F >nul 2>&1
sc stop InstantVmResAgent >nul 2>&1
sc stop InstantVmShm >nul 2>&1

echo [2/8] removing old services...
sc delete InstantVmResAgent >nul 2>&1
sc delete InstantVmShm >nul 2>&1

rem sc delete marks the record for deletion; a same-name `sc create` right
rem after can fail with 1072 (marked for delete). Wait until both services
rem are really gone (sc query errors = gone), capped at ~15s.
echo [2b/8] waiting for old service records to disappear...
set /a waited=0
:wait_services
sc query InstantVmShm >nul 2>&1
if not errorlevel 1 goto svc_still_there
sc query InstantVmResAgent >nul 2>&1
if not errorlevel 1 goto svc_still_there
goto services_gone
:svc_still_there
if %waited% geq 15 (
  echo WARNING: old services still present after 15s; continuing anyway.
  goto services_gone
)
ping -n 2 127.0.0.1 >nul
set /a waited+=1
goto wait_services
:services_gone

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
set SVCNAME=InstantVmShm
set SVCTYPE=kernel
set SVCSTART=system
set SVCBIN=C:\Windows\System32\drivers\ivm-shm.sys
call :create_service
sc description InstantVmShm "Instant VM shared-memory mailbox (host DMA channel)" >nul
sc start InstantVmShm >nul
if errorlevel 1 echo WARNING: sc start InstantVmShm failed (code %errorlevel%).

echo [6/8] creating and starting the agent service...
set SVCNAME=InstantVmResAgent
set SVCTYPE=own
set SVCSTART=auto
set SVCBIN=C:\Tools\res-agent.exe
call :create_service
sc description InstantVmResAgent "Instant VM guest agent (resolution + remote control)" >nul
sc start InstantVmResAgent >nul
if errorlevel 1 echo WARNING: sc start InstantVmResAgent failed (code %errorlevel%).

echo [7/8] registering autostart (clipboard bridge + agent fallback)...
rem The agent runs both as a service (boot) and via HKCU Run (logon, fast).
rem Whichever grabs the global single-instance mutex first wins; the loser
rem (/autostart flag) exits silently. Service may lag minutes on this VM,
rem so the logon copy is what usually ends up running.
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v InstantVmClipboardBridge /t REG_SZ /d "C:\Tools\clipboard-bridge.exe" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v InstantVmResAgent /t REG_SZ /d "\"C:\Tools\res-agent.exe\" /autostart" /f >nul
start "" "C:\Tools\clipboard-bridge.exe"

echo [8/8] verifying...
sc query InstantVmShm
sc query InstantVmResAgent
tasklist /FI "IMAGENAME eq clipboard-bridge.exe"
tasklist /FI "IMAGENAME eq res-agent.exe" | find /I "res-agent.exe" >nul
if errorlevel 1 echo WARNING: res-agent.exe is NOT running. Run: sc query InstantVmResAgent

echo.
echo Done. Reboot once so the driver loads in its boot-time slot.
echo Double-click res-agent.exe to see its version/build date.
pause
exit /b 0

rem ---- create with retry: after `sc delete`, the old service record can take
rem ---- a few seconds to really disappear (1072 marked-for-delete), and a
rem ---- same-name `sc create` right after fails. Wait 2s per retry, up to 5.
:create_service
set /a svc_tries=0
:create_retry
sc create %SVCNAME% type= %SVCTYPE% start= %SVCSTART% binPath= "%SVCBIN%" >nul
if not errorlevel 1 goto create_ok
set /a svc_tries+=1
if %svc_tries% geq 5 (
  echo ERROR: sc create %SVCNAME% failed repeatedly. Old record may be stuck.
  goto create_done
)
echo   sc create %SVCNAME% failed, retrying (%svc_tries%/5)...
ping -n 3 127.0.0.1 >nul
goto create_retry
:create_ok
echo   service %SVCNAME% created.
:create_done
goto :eof
