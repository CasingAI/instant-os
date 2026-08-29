@echo off
rem check-mouse.bat -- double-click diagnostic for the vmmouse absolute-pointer
rem filter install. Runs `ivm-agent.exe /mouse-check`: pops a report window
rem (driver file / vmmouse service / UpperFilters of every PS/2 mouse device
rem instance), appends the same text to C:\Tools\mouse-install.log.
rem Exit codes: 0=filter attached, 1=not attached, 2=driver file or service
rem missing. Keep this file next to ivm-agent.exe (guest/out/ has both).
if not exist "%~dp0ivm-agent.exe" (
  echo ERROR: put this file next to ivm-agent.exe. See guest/out/.
  pause
  exit /b 1
)
start "ivm-mouse-check" /wait "%~dp0ivm-agent.exe" /mouse-check
echo The same report was appended to C:\Tools\mouse-install.log
pause
