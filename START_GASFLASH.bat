@echo off
setlocal EnableDelayedExpansion

:: GASFLASH PRO (beta) - Turbo Launcher V3.0
:: Numerical Core: Numba-Accelerated Roe/MUSCL
title GASFLASH PRO Launcher

echo ===================================================
echo     GASFLASH PRO: TURBO LAUNCHER
echo ===================================================
echo.

:: --- CONFIGURAZIONE ---
set "ROOT=%~dp0"
set "REPO_NAME=Iterative-1D-Gasdynamic-Solver"
set "REPO_URL=https://github.com/matteo-faggian/%REPO_NAME%"
set "API_URL=https://api.github.com/repos/matteo-faggian/%REPO_NAME%/commits/main"
set "NEEDS_REBUILD=0"

:: --- 1. CONTROLLO AGGIORNAMENTI ---
echo [1/2] Verifica aggiornamenti...

git --version >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    git -C "%ROOT%." fetch origin >nul 2>&1
    for /f "tokens=*" %%i in ('git -C "%ROOT%." rev-list HEAD..origin/main --count 2^>nul') do set "BEHIND_COUNT=%%i"
    if "!BEHIND_COUNT!" GTR "0" (
        echo [INFO] Aggiornamento rilevato. Sincronizzazione...
        git -C "%ROOT%." reset --hard origin/main >nul 2>&1
        git -C "%ROOT%." clean -fd >nul 2>&1
        set "NEEDS_REBUILD=1"
    )
) else (
    set "LOCAL_SHA=none"
    if exist "%ROOT%.last_commit" set /p LOCAL_SHA=<"%ROOT%.last_commit"
    for /f "usebackq tokens=* delims=" %%a in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Invoke-RestMethod -Uri '%API_URL%').sha.Trim()" 2^>nul`) do set "REMOTE_SHA=%%a"
    if defined REMOTE_SHA if /I "!REMOTE_SHA!" NEQ "!LOCAL_SHA!" (
        echo [INFO] Nuova versione ZIP disponibile. Download...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%REPO_URL%/archive/refs/heads/main.zip' -OutFile 'update.zip'; Expand-Archive -Path 'update.zip' -DestinationPath 'temp_update' -Force; Copy-Item -Path 'temp_update\%REPO_NAME%-main\*' -Destination '.' -Recurse -Force; Remove-Item 'update.zip'; Remove-Item 'temp_update' -Recurse -Force"
        if !ERRORLEVEL! EQU 0 (
            echo !REMOTE_SHA! > "%ROOT%.last_commit"
            set "NEEDS_REBUILD=1"
        )
    )
)

:: --- 2. MANUTENZIONE (Solo se necessario) ---
if "!NEEDS_REBUILD!"=="1" (
    echo [INFO] Aggiornamento dipendenze in corso...
    cd /d "%ROOT%backend" && python -m pip install -r requirements.txt >nul
    cd /d "%ROOT%frontend" && call npm install >nul
    cd /d "%ROOT%"
)

:: --- 3. AVVIO APPLICAZIONE ---
echo [2/2] Avvio Gasdynamics Simulator...

:: Pulizia rapida processi
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1

start "GASFLASH_BACKEND" /min cmd /c "cd /d "%ROOT%backend" && uvicorn app.main:app --host 127.0.0.1 --port 8000"
start "GASFLASH_FRONTEND" /min cmd /c "cd /d "%ROOT%frontend" && npm run dev"

:: Attesa intelligente (polling)
set "TRIES=0"
:WAIT_LOOP
set /a TRIES+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
if !ERRORLEVEL! EQU 0 goto OPEN_BROWSER
if !TRIES! GEQ 15 ( goto OPEN_BROWSER )
timeout /t 1 /nobreak >nul
goto WAIT_LOOP

:OPEN_BROWSER
start http://localhost:5173
echo [OK] Sistema avviato correttamente.
timeout /t 3 >nul
exit
