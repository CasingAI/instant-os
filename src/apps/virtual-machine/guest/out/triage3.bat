@echo off
echo === [1/2] place FIXED driver (E8 direct-call import dispatch) ===
if not exist C:\Tools\boxvideo.sys (
  echo FAILED: C:\Tools\boxvideo.sys not found - copy it to the VM first
  pause
  goto eof
)
sc stop vidmini >nul 2>&1
sc delete vidmini >nul 2>&1
copy /y C:\Tools\boxvideo.sys C:\Windows\system32\drivers\boxvideo.sys
dir /b C:\Windows\system32\drivers\boxvideo.sys
echo === [2/2] load FIXED driver - expect markers on host log, NO BSOD ===
sc create vidmini type= kernel start= demand error= ignore binPath= C:\Windows\system32\drivers\boxvideo.sys
sc start vidmini
echo === reached end of script with NO blue screen ===
pause
:eof
