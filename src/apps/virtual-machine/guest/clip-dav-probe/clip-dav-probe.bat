@echo off
rem clip-dav-probe.bat - phase-1 probe. Lists the host-served
rem read-only fixture at \\host\DavWWWRoot\__clip_probe (small tree).
rem Does NOT write into the user's share. Does NOT put the share root
rem on the clipboard.
setlocal
set LOG=C:\Tools\clip-dav-probe.log
set DEST=C:\clip-dav-dest
set HERE=%~dp0

if not exist C:\Tools mkdir C:\Tools
>> "%LOG%" echo ==== clip-dav-probe start %date% %time% ====
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
call :http GET "http://instant-vm-files.local/__clip_probe/hello.txt"
call :http GET "http://instant-vm-files.local/__clip_probe/tree/a.txt"
call :http GET "http://192.168.87.1/__clip_probe/tree/sub/b.txt"
call :http OPTIONS "http://instant-vm-files.local/"
call :http OPTIONS "http://192.168.87.1/"
call :http PROPFIND "http://instant-vm-files.local/" 0
call :http PROPFIND "http://instant-vm-files.local/__clip_probe/" 1
:http_done

echo ---- [4] path candidates (fixture only, never the share root) >> "%LOG%"
echo [4/5] path candidates ...
set CLIP_SRC=
if not exist "%DEST%" mkdir "%DEST%"
call :try_clip "\\instant-vm-files.local\DavWWWRoot\__clip_probe\tree"
call :try_clip "\\192.168.87.1\DavWWWRoot\__clip_probe\tree"
call :try_clip "O:\__clip_probe\tree"
call :try_clip "Z:\__clip_probe\tree"

echo ---- [4b] http:// treated as a local path (expected to FAIL) >> "%LOG%"
dir /a "http://instant-vm-files.local/__clip_probe/tree" >> "%LOG%" 2>&1
echo dir exit=%errorlevel% (expect nonzero) >> "%LOG%"

echo ---- clipboard source: [%CLIP_SRC%] >> "%LOG%"
echo Winner source: [%CLIP_SRC%]

if not defined CLIP_SRC goto :no_winner
if not exist "%CLIP_SRC%\a.txt" (
  echo fixture tree missing a.txt, refuse to arm >> "%LOG%"
  echo [5/5] SKIPPED - fixture tree not visible as a folder.
  goto :tail
)
echo ---- [5] clipboard paste probe >> "%LOG%"
echo [5/5] clipboard paste probe
echo.
echo  ============================================================
echo   Clipboard holds ONLY the small folder:
echo     %CLIP_SRC%
echo   (a.txt + sub\b.txt). NOT the whole share.
echo.
echo   1. RIGHT-CLICK empty desktop (menu only, do NOT paste yet)
echo   2. click Paste ONCE
echo   3. if the copy dialog looks huge, Cancel immediately
echo  ============================================================
echo Press any key to arm the clipboard...
pause > nul
"%HERE%clip-dav-hdrop.exe" "%CLIP_SRC%" /copy
echo helper exit=%errorlevel% >> "%LOG%"
echo helper exit=%errorlevel%
goto :tail

:no_winner
echo [5/5] SKIPPED - fixture folder could not be listed.
echo no fixture listing - clipboard probe skipped >> "%LOG%"
echo Need a running host that serves /__clip_probe/ and WebClient up.

:tail
echo.
echo ==== done %date% %time% ==== >> "%LOG%"
echo ==== done - send back these three ====
echo   1) %LOG%
echo   2) C:\Tools\clip-dav-hdrop.log
echo   3) host browser console [vm-webdav] lines
echo Press any key to close.
pause > nul
endlocal
exit /b 0

:http
echo ---- http %1 %2 depth=%3 >> "%LOG%"
cscript //nologo "%VBS%" %1 %2 %3 >> "%LOG%" 2>&1
echo cscript exit=%errorlevel% >> "%LOG%"
goto :eof

:try_clip
echo ---- [S] dir %1 >> "%LOG%"
dir /a %1 >> "%LOG%" 2>&1
if errorlevel 1 (
  echo dir failed exit=%errorlevel% >> "%LOG%"
  goto :eof
)
if not defined CLIP_SRC set CLIP_SRC=%~1
echo copy-back from %1 >> "%LOG%"
xcopy /e /i /y %1 "%DEST%\fixture-tree" >> "%LOG%" 2>&1
echo xcopy exit=%errorlevel% (0 = ok) >> "%LOG%"
if exist "%DEST%\fixture-tree\a.txt" echo copy-back saw a.txt >> "%LOG%"
if exist "%DEST%\fixture-tree\sub\b.txt" echo copy-back saw sub\b.txt >> "%LOG%"
goto :eof
