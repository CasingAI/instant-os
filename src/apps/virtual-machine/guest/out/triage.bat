@echo off
rem ============================================================
rem  boxvnt triage — 每步结果同时打到屏幕和 COM1（[IVM] 前缀，
rem  宿主串口探针会转发给 AI）。放在 C:\Tools\ 下双击运行。
rem ============================================================

echo === [1/5] serial self test ===
echo [IVM]bat-start=1 > com1
echo [IVM]txtest=1 > com1
echo (sent txtest via COM1)

echo.
echo === [2/5] file sizes ===
for %%F in (C:\Tools\boxvideo.sys) do (
  echo C:\Tools\boxvideo.sys = %%~zF bytes
  echo [IVM]tools-size=%%~zF > com1
  if not "%%~zF"=="16128" echo [IVM]tools-size-WARN-expected-16128 > com1
)

echo.
echo === [3/5] place file into system32\drivers ===
copy /y C:\Tools\boxvideo.sys C:\Windows\system32\drivers\boxvideo.sys >nul
for %%F in (C:\Windows\system32\drivers\boxvideo.sys) do (
  echo system32\drivers\boxvideo.sys = %%~zF bytes
  echo [IVM]sys32-size=%%~zF > com1
)

echo.
echo === [4/5] ensure vidmini service ===
sc query vidmini >nul 2>&1
if errorlevel 1 (
  echo service absent, creating...
  echo [IVM]service=absent > com1
  sc create vidmini type= kernel start= demand error= ignore binPath= C:\Windows\system32\drivers\boxvideo.sys
) else (
  echo service present
  echo [IVM]service=present > com1
)

echo.
echo === [5/5] DIRECT LOAD — if a BSOD happens, it happens NOW ===
echo [IVM]sc-start-begin > com1
sc start vidmini
echo [IVM]sc-start-rc=%errorlevel% > com1
echo.
echo ============================================================
echo  done. rc=1056 means "already running" (also fine).
echo  photograph this window and report to the AI.
echo ============================================================
pause
