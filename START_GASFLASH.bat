@echo off
setlocal EnableDelayedExpansion

:: GASFLASH PRO (beta) - Universal Smart Launcher V2.1
:: Numerical Core: Numba-Accelerated Roe/MUSCL
title GASFLASH PRO Launcher

echo ===================================================
echo     GASFLASH PRO: ADVANCED INSTALLATION
echo     Numerical Core: Numba-Accelerated Roe/MUSCL
echo ===================================================
echo.

:: --- PREREQUISITI ---
where python >nul 2>&1 || ( echo [ERRORE] Python non trovato nel PATH. & pause & exit /b 1 )
where npm    >nul 2>&1 || ( echo [ERRORE] Node.js/npm non trovato nel PATH. & pause & exit /b 1 )

:: --- CONFIGURAZIONE ---
set "REPO_NAME=Iterative-1D-Gasdynamic-Solver"
set "REPO_URL=https://github.com/Matteobeo/%REPO_NAME%"
set "API_URL=https://api.github.com/repos/Matteobeo/%REPO_NAME%/commits/main"
set "NEEDS_FULL_REBUILD=0"
set "ROOT=%~dp0"

echo [1/5] Verifica aggiornamenti sistema...

git --version >nul 2>&1
if !ERRORLEVEL! EQU 0 ( goto GIT_MODE ) else ( goto ZIP_MODE )

:GIT_MODE
echo [INFO] Modalita' Git rilevata.
git -C "%ROOT%." fetch origin >nul 2>&1
if !ERRORLEVEL! NEQ 0 ( echo [INFO] GitHub non raggiungibile. & goto SETUP_BACKEND )

for /f "tokens=*" %%i in ('git -C "%ROOT%." rev-list HEAD..origin/main --count 2^>nul') do set "BEHIND_COUNT=%%i"
if not defined BEHIND_COUNT set "BEHIND_COUNT=0"

if !BEHIND_COUNT! GTR 0 (
    echo [INFO] Aggiornamento Git rilevato (!BEHIND_COUNT! commit).
    git -C "%ROOT%." reset --hard origin/main >nul 2>&1
    git -C "%ROOT%." clean -fd >nul 2>&1
    set "NEEDS_FULL_REBUILD=1"
) else (
    echo [INFO] Sistema aggiornato (Git).
)
goto SETUP_BACKEND

:ZIP_MODE
echo [INFO] Modalita' ZIP (Smart Update).
set "LOCAL_SHA=none"
if exist "%ROOT%.last_commit" set /p LOCAL_SHA=<"%ROOT%.last_commit"

for /f "usebackq tokens=* delims=" %%a in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Invoke-RestMethod -Uri '%API_URL%').sha.Trim()" 2^>nul`) do set "REMOTE_SHA=%%a"

if not defined REMOTE_SHA ( echo [INFO] Verifica online fallita (offline). & goto SETUP_BACKEND )

if /I "!REMOTE_SHA!"=="!LOCAL_SHA!" ( echo [INFO] Sistema gia' aggiornato. & goto SETUP_BACKEND )

echo [INFO] Nuova versione rilevata su GitHub. Download in corso...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -Uri '%REPO_URL%/archive/refs/heads/main.zip' -OutFile 'update.zip';" ^
  "Expand-Archive -Path 'update.zip' -DestinationPath 'temp_update' -Force;" ^
  "Copy-Item -Path 'temp_update\%REPO_NAME%-main\*' -Destination '.' -Recurse -Force;" ^
  "Remove-Item 'update.zip';" ^
  "Remove-Item 'temp_update' -Recurse -Force"

if !ERRORLEVEL! EQU 0 (
    >"%ROOT%.last_commit" echo !REMOTE_SHA!
    echo [INFO] Aggiornamento completato con successo.
    set "NEEDS_FULL_REBUILD=1"
) else (
    echo [ERRORE] Aggiornamento fallito.
    pause
    exit /b 1
)

:SETUP_BACKEND
echo [2/5] Configurazione ambiente Python...
pushd "%ROOT%backend"
if "!NEEDS_FULL_REBUILD!"=="1" (
    python -m pip install --upgrade -r requirements.txt
) else (
    python -m pip install -r requirements.txt
)
popd

echo [3/5] Configurazione ambiente Interfaccia...
pushd "%ROOT%frontend"
set "FRONTEND_BROKEN=0"
if not exist "node_modules\.bin\vite.cmd" set "FRONTEND_BROKEN=1"
if "!NEEDS_FULL_REBUILD!"=="1" set "FRONTEND_BROKEN=1"

if "!FRONTEND_BROKEN!"=="1" (
    echo [INFO] Ricostruzione moduli interfaccia...
    if exist node_modules rd /s /q node_modules
    call npm install
) else (
    if exist package-lock.json ( call npm ci ) else ( call npm install )
)
popd

echo.
echo ===================================================
echo     AVVIO GASDYNAMICS SIMULATOR
echo ===================================================
echo [4/5] Avvio backend e frontend in finestre separate...

:: --- CHIUSURA PROCESSI PENDENTI ---
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1

start "GASFLASH Backend"  cmd /k "cd /d ""%ROOT%backend"" && uvicorn app.main:app --host 127.0.0.1 --port 8000"
start "GASFLASH Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm run dev"

echo [5/5] Attesa sincronizzazione server...
set "TRIES=0"
:WAIT_LOOP
set /a TRIES+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 1) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if !ERRORLEVEL! EQU 0 goto OPEN_BROWSER
if !TRIES! GEQ 30 ( echo [WARN] Timeout attesa, provo ad aprire il browser... & goto OPEN_BROWSER )
timeout /t 1 /nobreak >nul
goto WAIT_LOOP

:OPEN_BROWSER
start "" http://localhost:5173

echo.
echo ===================================================
echo     PRONTO. Mantieni aperte le altre finestre.
echo     Chiudi questa finestra principale per terminare.
echo ===================================================
pause
endlocal
