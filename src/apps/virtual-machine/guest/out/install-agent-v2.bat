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
rem   8. drivers: register the vmmouse service and attach it as an upper
rem      filter on the PS/2 mouse device (`ivm-agent.exe /mouse-install`),
rem      then bind the XP built-in SB16 audio driver (`/audio-install`;
rem      failures print a loud ERROR with the real exit code instead of a
rem      scroll-by WARNING; logs: C:\Tools\mouse-install.log +
rem      C:\Tools\audio-install.log)
rem   9. verify with sc query + `/mouse-check` + `/audio-check` (report
rem      windows)
rem
rem A reboot is required afterwards: the mailbox driver loads in its normal
rem boot-time slot, the vmmouse filter attaches when the mouse device
rem re-enumerates, and the SB16 audio driver starts when the audio device
rem re-enumerates. After the reboot the absolute-pointer mode is active and
rem sound works (volume icon in the tray).
rem Re-verify any time with check-mouse.bat. NOTE: even when everything is
rem installed, Device Manager keeps showing the Microsoft PS/2 driver --
rem vmmouse is an upper filter, not a replacement (check via check-mouse.bat
rem or the driver's Driver Files list instead).

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
rem are really gone (sc query errors = gone), capped at ~15s. vmmouse MUST
rem be waited on too: /mouse-install recreates it in step 8, and a 1072 race
rem there leaves UpperFilters=vmmouse attached with no service -- the PS/2
rem mouse device then fails to start after the reboot (frozen cursor in
rem every pointer mode; happened for real 2026-08-30).
echo [2b/9] waiting for old service records to disappear...
set /a waited=0
:wait_services
sc query InstantVmShm >nul 2>&1
if not errorlevel 1 goto svc_still_there
sc query InstantVmAgent >nul 2>&1
if not errorlevel 1 goto svc_still_there
sc query InstantVmResAgent >nul 2>&1
if not errorlevel 1 goto svc_still_there
sc query vmmouse >nul 2>&1
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
rem Offline escape hatch for stripped XP images (no Driver Cache, no CD-ROM):
rem if ctlsb16.sys is placed next to this script, stage it where /audio-install
rem looks as its last-resort source.
if exist "%~dp0ctlsb16.sys" copy /Y "%~dp0ctlsb16.sys" "C:\Tools\ctlsb16.sys" >nul

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
set mouse_rc=%errorlevel%
if "%mouse_rc%"=="0" (
  echo   vmmouse registered and attached to the PS/2 mouse device.
) else (
  echo ERROR: /mouse-install failed with exit code %mouse_rc%.
  echo        2 = service/registry problem or vmmouse.sys missing,
  echo        1 = no PS/2 mouse device found in the registry.
  echo        Details: C:\Tools\mouse-install.log - the filter is NOT installed.
)

echo       binding the XP built-in SB16 audio driver (ctlsb16)...
start "ivm-audio-install" /wait "C:\Tools\ivm-agent.exe" /audio-install
set audio_rc=%errorlevel%
if "%audio_rc%"=="0" (
  echo   SB16 audio driver bound to the audio device ^(starts after a reboot^).
) else if "%audio_rc%"=="1" (
  echo NOTE: /audio-install found no SB16 audio device instance and could
  echo        not create one. See C:\Tools\audio-install.log for the IDs seen.
  echo        Roll back anytime with: ivm-agent.exe /audio-uninstall
) else (
  echo ERROR: /audio-install failed with exit code %audio_rc%.
  echo        2 = ctlsb16.sys could not be extracted. Mount the XP CD-ROM
  echo            ^(I386\CTLSB16.SY_^) and reboot, or place ctlsb16.sys next
  echo            to this script / at C:\Tools\ctlsb16.sys and re-run.
  echo        Details: C:\Tools\audio-install.log - sound is NOT installed.
  echo        Roll back anytime with: ivm-agent.exe /audio-uninstall
)

echo [9/9] verifying...
sc query InstantVmShm
sc query InstantVmAgent
sc query vmmouse
tasklist /FI "IMAGENAME eq ivm-agent.exe" | find /I "ivm-agent.exe" >nul
if errorlevel 1 echo WARNING: ivm-agent.exe is NOT running. Run: sc query InstantVmAgent
echo mouse check (also shown in a popup window):
start "ivm-mouse-check" /wait "C:\Tools\ivm-agent.exe" /mouse-check
if not "%errorlevel%"=="0" echo WARNING: /mouse-check says vmmouse is NOT attached (code %errorlevel%). See C:\Tools\mouse-install.log
echo audio check (also shown in a popup window):
start "ivm-audio-check" /wait "C:\Tools\ivm-agent.exe" /audio-check
if not "%errorlevel%"=="0" echo WARNING: /audio-check says the SB16 driver is NOT installed (code %errorlevel%). See C:\Tools\audio-install.log

echo.
echo Done. Reboot once: the mailbox driver then loads in its boot-time slot,
echo the vmmouse filter attaches (absolute pointer becomes active), and the
echo SB16 audio driver starts (sound works, volume icon in the tray).
echo After the reboot, re-verify with check-mouse.bat. Note: Device Manager
echo keeps showing the Microsoft PS/2 driver even when vmmouse is installed
echo (it is an upper filter, not a replacement).
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
