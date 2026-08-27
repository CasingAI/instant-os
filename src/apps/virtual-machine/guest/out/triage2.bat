@echo off
echo === [1/3] place probe drivers ===
if not exist C:\Tools\boxvideo-min2.sys (
  echo FAILED: C:\Tools\boxvideo-min2.sys not found - copy both files first
  pause
  goto eof
)
copy /y C:\Tools\boxvideo-min2.sys C:\Windows\system32\drivers\boxvideo-min2.sys
copy /y C:\Tools\boxvideo.sys C:\Windows\system32\drivers\boxvideo.sys
dir /b C:\Windows\system32\drivers\boxvideo*.sys
echo === [2/3] load ZERO-IMPORT probe driver - expect clean failure, NO BSOD ===
sc delete vidmini2 >nul 2>&1
sc create vidmini2 type= kernel start= demand error= ignore binPath= C:\Windows\system32\drivers\boxvideo-min2.sys
sc start vidmini2
echo (if you can read this line, the zero-import probe did NOT blue-screen)
echo === [3/3] load FULL driver - BSOD may happen NOW ===
sc start vidmini
echo === reached end of script with NO blue screen ===
pause
:eof
