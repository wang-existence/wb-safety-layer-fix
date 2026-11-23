@echo off
rem One-click GitHub upload for wb-safety-layer-fix (ASCII only on purpose).
rem Double-click this file, or run it from a terminal. Extra arguments are
rem forwarded to scripts\push-to-github.ps1 (e.g. -Private -Owner someone).
chcp 65001 >nul
setlocal
set "PS1=%~dp0scripts\push-to-github.ps1"
if not exist "%PS1%" set "PS1=%~dp0push-to-github.ps1"
if not exist "%PS1%" (
    echo [x] push-to-github.ps1 not found next to this file.
    echo     Run this from the repository root, or re-extract the package.
    pause
    exit /b 1
)
echo.
echo  wb-safety-layer-fix - one-click upload to GitHub
echo  ------------------------------------------------
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
    echo [x] upload did not finish ^(exit %RC%^). Read the message above.
) else (
    echo [ok] finished.
)
pause
exit /b %RC%
