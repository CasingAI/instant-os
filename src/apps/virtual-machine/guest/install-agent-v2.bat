@echo off
rem install-agent-v2.bat -- install the Instant VM guest agent stack on XP:
rem   ivm-agent.exe          (all-in-one guest agent: COM1 remote control +
rem                          resolution auto-align as a service; OLE clipboard/
rem                          file bridge in the logon session; /mouse-install)
rem   ivm-shm.sys            (shared-memory mailbox kernel driver)
rem   vmmouse.sys            (VMware absolute-pointer filter driver)
rem Run as Administrator. Place this file next to the exe/sys files (guest/out/ has all).
rem
rem Steps:
rem   1. kill running instances (old interactive processes / old services,
rem      including the pre-merge res-agent.exe + clipboard-bridge.exe pair)
rem   2. delete old services if present
rem   3. remove legacy HKCU Run autorun keys
rem   4. copy files: exe to C:\Tools\, drivers to C:\Windows\System32\drivers\
rem   5. create + start the mailbox kernel driver (loads before the agent)
rem   6. create + start the agent service
rem   7. register HKCU Run autostart (the logon instance runs the clipboard
rem      bridge; a service cannot touch the interactive clipboard) and start it
rem   8. mouse driver: register the vmmouse service and attach it as an upper
rem      filter on the PS/2 mouse device (`ivm-agent.exe /mouse-install`)
rem   9. verify with sc query
rem
rem A reboot is required afterwards: the mailbox driver loads in its normal
rem boot-time slot, and the vmmouse filter attaches when the mouse device
rem re-enumerates. After the reboot the absolute-pointer mode is active.

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

echo [1/9] stopping existing instances...
taskkill /IM ivm-agent.exe /F >nul 2>&1
taskkill /IM res-agent.exe /F >nul 2>&1
taskkill /IM clipboard-bridge.exe /F >nul 2>&1
sc stop InstantVmAgent >nul 2>&1
sc stop InstantVmResAgent >nul 2>&1
sc stop InstantVmShm >nul 2>&1

echo [2/9] removing old services...
sc delete InstantVmAgent >nul 2>&1
sc delete InstantVmResAgent >nul 2>&1
sc delete InstantVmShm >nul 2>&1
sc delete vmmouse >nul 2>&1

rem sc delete marks the record for deletion; a same-name `sc create` right
rem after can fail with 1072 (marked for delete). Wait until the services
rem are really gone (sc query errors = gone), capped at ~15s.
echo [2b/9] waiting for old service records to disappear...
set /a waited=0
:wait_services
sc query InstantVmShm >nul 2>&1
if not errorlevel 1 goto svc_still_there
sc query InstantVmAgent >nul 2>&1
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

echo [3/9] removing legacy HKCU Run autorun keys...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ResAgent /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v InstantVmResAgent /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v InstantVmClipboardBridge /f >nul 2>&1

echo [4/9] copying files...
if not exist "C:\Tools" mkdir "C:\Tools"
copy /Y "%~dp0ivm-agent.exe" "C:\Tools\ivm-agent.exe" >nul
if errorlevel 1 (
  echo ERROR: copy ivm-agent.exe failed.
  pause
  exit /b 1
)
copy /Y "%~dp0ivm-shm.sys" "C:\Windows\System32\drivers\ivm-shm.sys" >nul
if errorlevel 1 (
  echo ERROR: copy ivm-shm.sys failed.
  pause
  exit /b 1
)
copy /Y "%~dp0vmmouse.sys" "C:\Windows\System32\drivers\vmmouse.sys" >nul
if errorlevel 1 (
  echo ERROR: copy vmmouse.sys failed.
  pause
  exit /b 1
)

echo [5/9] creating and starting the mailbox driver...
set SVCNAME=InstantVmShm
set SVCTYPE=kernel
set SVCSTART=system
set SVCBIN=C:\Windows\System32\drivers\ivm-shm.sys
call :create_service
sc description InstantVmShm "Instant VM shared-memory mailbox (host DMA channel)" >nul
sc start InstantVmShm >nul
if errorlevel 1 echo WARNING: sc start InstantVmShm failed (code %errorlevel%).

echo [6/9] creating and starting the agent service...
set SVCNAME=InstantVmAgent
set SVCTYPE=own
set SVCSTART=auto
set SVCBIN=C:\Tools\ivm-agent.exe
call :create_service
sc description InstantVmAgent "Instant VM guest agent (resolution + remote control)" >nul
sc start InstantVmAgent >nul
if errorlevel 1 echo WARNING: sc start InstantVmAgent failed (code %errorlevel%).

echo [7/9] registering autostart (logon instance runs the clipboard bridge)...
rem The agent runs both as a service (boot: COM1 remote control) and via
rem HKCU Run (logon: clipboard bridge + COM1 if the service has not started
rem yet). The COM1 ownership is arbitrated by a global mutex; the clipboard
rem bridge must live in the logon session, so the logon instance always
rem keeps that part instead of exiting like the pre-merge build did.
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v InstantVmAgent /t REG_SZ /d "\"C:\Tools\ivm-agent.exe\" /autostart" /f >nul
start "" "C:\Tools\ivm-agent.exe" /autostart

echo [8/9] installing the VMware absolute-pointer mouse driver...
start "ivm-mouse-install" /wait "C:\Tools\ivm-agent.exe" /mouse-install
if errorlevel 2 (
  echo WARNING: vmmouse service/filter registration failed (code %errorlevel%).
) else if errorlevel 1 (
  echo WARNING: no PS/2 mouse device found in the registry; vmmouse not attached.
) else (
  echo   vmmouse registered and attached to the PS/2 mouse device.
)

echo [9/9] verifying...
sc query InstantVmShm
sc query InstantVmAgent
sc query vmmouse
tasklist /FI "IMAGENAME eq ivm-agent.exe" | find /I "ivm-agent.exe" >nul
if errorlevel 1 echo WARNING: ivm-agent.exe is NOT running. Run: sc query InstantVmAgent

echo.
echo Done. Reboot once: the mailbox driver then loads in its boot-time slot
echo and the vmmouse filter attaches (absolute pointer becomes active).
echo Double-click ivm-agent.exe to see its version/build date.
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
