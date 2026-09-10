@echo off
rem ============================================================
rem clip-dav-probe.bat - phase-1 real-machine probe for the
rem "DAV clipboard paste" plan (dav_clipboard_paste).
rem
rem Measures, on this real XP guest:
rem   [1] environment: InstantVM SharedFolder registry, existing
rem       network mappings, NIC/DNS/gateway
rem   [2] WebClient (WebDAV mini-redirector) service state
rem   [3] raw HTTP/DAV reachability (hostname + gateway IP):
rem       root GET, OPTIONS, PROPFIND depth 0/1
rem   [4] per candidate source path (UNC / mapped drive):
rem       exists? listable? can a small tree be copied back to
rem       C:\clip-dav-dest?  plus http://-as-local-path (must fail)
rem   [5] clipboard paste probe via clip-dav-hdrop.exe
rem
rem Everything is APPENDED to C:\Tools\clip-dav-probe.log
rem (step 5 also produces C:\Tools\clip-dav-hdrop.log).
rem
rem IMPORTANT: run this BEFORE copying anything from the host
rem Files app, or the clipboard bridge will own the clipboard
rem with its empty placeholder and the probe is void.
rem
rem Send back afterwards:
rem   C:\Tools\clip-dav-probe.log
rem   C:\Tools\clip-dav-hdrop.log
rem   host browser console WebDAV lines (same time window)
rem ============================================================
setlocal
set LOG=C:\Tools\clip-dav-probe.log
set DEST=C:\clip-dav-dest
set HERE=%~dp0

if not exist C:\Tools mkdir C:\Tools
> "%LOG%" echo ==== clip-dav-probe start %date% %time% ====
ver >> "%LOG%"
chcp >> "%LOG%"
echo user=%USERNAME% machine=%COMPUTERNAME% >> "%LOG%"
echo Probe log: %LOG%
echo.

echo ---- [1] environment >> "%LOG%"
echo [1/5] environment ...
reg query "HKLM\SOFTWARE\InstantVM\SharedFolder" /s >> "%LOG%" 2>&1
echo reg exit=%errorlevel% (InstantVM SharedFolder) >> "%LOG%"
reg query "HKCU\Network" /s >> "%LOG%" 2>&1
echo reg exit=%errorlevel% (HKCU Network mappings) >> "%LOG%"
net use >> "%LOG%" 2>&1
echo net use exit=%errorlevel% >> "%LOG%"
ipconfig /all >> "%LOG%" 2>&1

echo ---- [2] WebClient service >> "%LOG%"
echo [2/5] WebClient service ...
sc query WebClient >> "%LOG%" 2>&1
echo sc query exit=%errorlevel% >> "%LOG%"
sc qc WebClient >> "%LOG%" 2>&1
net start WebClient >> "%LOG%" 2>&1
echo net start exit=%errorlevel% (2 = already running or invalid name) >> "%LOG%"
sc query WebClient >> "%LOG%" 2>&1

echo ---- [3] HTTP probes >> "%LOG%"
echo [3/5] HTTP probes ...
set VBS=%HERE%clip-dav-http.vbs
if not exist "%VBS%" echo missing %VBS%, HTTP section skipped >> "%LOG%"
if not exist "%VBS%" goto :http_done
call :http GET "http://instant-vm-files.local/"
call :http GET "http://192.168.87.1/"
call :http OPTIONS "http://instant-vm-files.local/"
call :http OPTIONS "http://192.168.87.1/"
call :http PROPFIND "http://instant-vm-files.local/" 0
call :http PROPFIND "http://instant-vm-files.local/DavWWWRoot/" 0
call :http PROPFIND "http://instant-vm-files.local/DavWWWRoot/" 1
call :http PROPFIND "http://192.168.87.1/DavWWWRoot/" 1
:http_done

echo ---- [4] path candidates >> "%LOG%"
echo [4/5] path candidates ...
set WINNER=
set COPY_N=0
if not exist "%DEST%" mkdir "%DEST%"
call :source "\\instant-vm-files.local\DavWWWRoot"
call :source "\\192.168.87.1\DavWWWRoot"
call :source "\\instant-vm-files.local"
call :source "\\192.168.87.1"
call :drive Z
call :drive Y
call :drive X
call :drive W
call :drive V

echo ---- [4b] http:// treated as a local path (expected to FAIL) >> "%LOG%"
dir /a "http://instant-vm-files.local/DavWWWRoot" >> "%LOG%" 2>&1
echo dir exit=%errorlevel% (expect nonzero) >> "%LOG%"

echo ---- winner: [%WINNER%] >> "%LOG%"
echo Winner source: [%WINNER%]

if not defined WINNER goto :no_winner
echo ---- [5] clipboard paste probe >> "%LOG%"
echo [5/5] clipboard paste probe
set CLIP_SRC=%WINNER%
if exist "%WINNER%\clip-dav-probe-src\hello.txt" set CLIP_SRC=%WINNER%\clip-dav-probe-src
echo clipboard source: %CLIP_SRC% >> "%LOG%"
echo.
echo  ============================================================
echo   Now, inside the VM:
echo   1. RIGHT-CLICK empty desktop (open the menu only,
echo      do NOT click Paste yet)
echo   2. click Paste (or press Ctrl+V)
echo   3. watch: do files appear? which progress window shows up
echo      (the system one or the bridge's own)?
echo.
echo   Clipboard holds: %CLIP_SRC%
echo   The helper auto-exits after ~4 minutes and logs to
echo   C:\Tools\clip-dav-hdrop.log
echo.
echo   Do NOT copy anything from the host Files app during the
echo   probe - the bridge would steal the clipboard.
echo  ============================================================
echo Press any key to arm the clipboard and start the helper...
pause > nul
"%HERE%clip-dav-hdrop.exe" "%CLIP_SRC%" /copy
echo helper exit=%errorlevel% >> "%LOG%"
echo helper exit=%errorlevel%
echo The helper flushed the paths onto the plain clipboard before
echo exiting - you may try pasting once more with no helper running
echo (that behaviour is also a data point; note the time).
goto :tail

:no_winner
echo [5/5] SKIPPED - no candidate path could list files.
echo no listing candidate - clipboard probe skipped >> "%LOG%"
echo Send back the probe log anyway: the HTTP section tells why.

:tail
echo.
echo ==== done %date% %time% ==== >> "%LOG%"
echo ==== done - send back these three ====
echo   1) %LOG%
echo   2) C:\Tools\clip-dav-hdrop.log
echo   3) host browser console WebDAV lines (same time window)
echo Press any key to close.
pause > nul
endlocal
exit /b 0

rem ---- subroutines ----

:http
echo ---- http %1 %2 depth=%3 >> "%LOG%"
cscript //nologo "%VBS%" %1 %2 %3 >> "%LOG%" 2>&1
echo cscript exit=%errorlevel% >> "%LOG%"
goto :eof

:drive
if exist %1:\ call :source %1:\
if exist %1:\DavWWWRoot call :source %1:\DavWWWRoot
goto :eof

:source
echo ---- [S] dir %1 >> "%LOG%"
dir /a %1 >> "%LOG%" 2>&1
if errorlevel 1 (
  echo dir failed exit=%errorlevel% >> "%LOG%"
  goto :eof
)
if not defined WINNER set WINNER=%~1
call :copytest %1
goto :eof

:copytest
rem create a small tree on the source, copy it back, log the result
echo ---- [C] copy test on %1 >> "%LOG%"
mkdir %1\clip-dav-probe-src >> "%LOG%" 2>&1
echo clip-dav probe hello > %1\clip-dav-probe-src\hello.txt 2>> "%LOG%"
mkdir %1\clip-dav-probe-src\sub >> "%LOG%" 2>&1
echo nested line > %1\clip-dav-probe-src\sub\nested.txt 2>> "%LOG%"
if not exist %1\clip-dav-probe-src\hello.txt (
  echo write test FAILED - cannot create probe tree, copy-back skipped >> "%LOG%"
  goto :eof
)
echo write test ok >> "%LOG%"
set /a COPY_N=COPY_N+1
xcopy /e /i /y %1\clip-dav-probe-src "%DEST%\dav-back-%COPY_N%" >> "%LOG%" 2>&1
echo xcopy exit=%errorlevel% (0 = ok) >> "%LOG%"
if errorlevel 1 goto :eof
dir /s /b "%DEST%\dav-back-%COPY_N%" >> "%LOG%" 2>&1
rem probe tree is only removed after a proven copy-back
rd /s /q %1\clip-dav-probe-src >> "%LOG%" 2>&1
echo rd cleanup exit=%errorlevel% >> "%LOG%"
goto :eof
