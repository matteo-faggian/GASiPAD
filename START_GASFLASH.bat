@echo off
setlocal EnableDelayedExpansion

:: GASFLASH PRO (beta version) - Universal Smart Launcher
:: Numerical Core: Numba-Accelerated Roe/MUSCL

echo ===================================================
echo     GASFLASH PRO: ADVANCED INSTALLATION
echo     Numerical Core: Numba-Accelerated Roe/MUSCL
echo ===================================================
echo.

:: Inizializzazione
set NEEDS_FULL_REBUILD=0
set BEHIND_COUNT=0
set REPO_NAME=Iterative-1D-Gasdynamic-Solver
set REPO_URL=https://github.com/Matteobeo/!REPO_NAME!
set API_URL=https://api.github.com/repos/Matteobeo/!REPO_NAME!/commits/main

:: --- CONTROLLO AGGIORNAMENTI (SMART) ---
echo [1/5] Controllo aggiornamenti...

set GIT_AVAILABLE=0
git --version >nul 2>&1
if !ERRORLEVEL! EQU 0 set GIT_AVAILABLE=1

if !GIT_AVAILABLE! EQU 1 (
    echo [INFO] Utilizzo Git per il controllo...
    git fetch origin >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        for /f "tokens=*" %%i in ('git rev-list HEAD..origin/main --count 2^>nul') do set BEHIND_COUNT=%%i
        if "!BEHIND_COUNT!"=="" set BEHIND_COUNT=0
        
        if !BEHIND_COUNT! GTR 0 (
            echo [INFO] Aggiornamento Git rilevato (!BEHIND_COUNT! commit).
            git reset --hard origin/main >nul 2>&1
            git clean -fd >nul 2>&1
            set NEEDS_FULL_REBUILD=1
        ) else (
            echo [INFO] Codice gia' aggiornato (Git).
        )
    ) else (
        echo [INFO] GitHub non raggiungibile. Procedo offline.
    )
) else (
    echo [INFO] Git non trovato. Controllo SMART ZIP...
    
    set LOCAL_SHA=none
    if exist .last_commit set /p LOCAL_SHA=<.last_commit

    :: PowerShell per SHA (Semplificato per evitare errori di escape)
    set "PS_CMD=(Invoke-RestMethod -Uri '!API_URL!').sha"
    for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -Command "!PS_CMD!" 2^>nul`) do set REMOTE_SHA=%%a

    if "!REMOTE_SHA!"=="" (
        echo [INFO] Impossibile verificare aggiornamenti (offline).
    ) else if NOT "!REMOTE_SHA!"=="!LOCAL_SHA!" (
        echo [INFO] Nuova versione rilevata su GitHub.
        set "PS_DL=Invoke-WebRequest -Uri '!REPO_URL!/archive/refs/heads/main.zip' -OutFile 'update.zip'; Expand-Archive -Path 'update.zip' -DestinationPath 'temp_update' -Force; Copy-Item -Path 'temp_update\!REPO_NAME!-main\*' -Destination '.' -Recurse -Force; Remove-Item 'update.zip'; Remove-Item 'temp_update' -Recurse"
        powershell -NoProfile -Command "!PS_DL!"
        
        if !ERRORLEVEL! EQU 0 (
            echo !REMOTE_SHA! > .last_commit
            echo [INFO] Aggiornamento ZIP completato.
            set NEEDS_FULL_REBUILD=1
        )
    ) else (
        echo [INFO] Codice gia' aggiornato (SMART ZIP).
    )
)

:: --- SEZIONE BACKEND ---
echo [2/5] Gestione dipendenze Python...
cd /d "%~dp0backend"
if "!NEEDS_FULL_REBUILD!"=="1" (
    echo [INFO] Reinstallazione forzata pacchetti...
    python -m pip install --upgrade --force-reinstall -r requirements.txt
) else (
    python -m pip install -r requirements.txt
)
cd /d "%~dp0"

:: --- SEZIONE FRONTEND ---
echo [3/5] Gestione moduli Node.js...
cd /d "%~dp0frontend"
set FRONTEND_BROKEN=0
if not exist node_modules\.bin\vite set FRONTEND_BROKEN=1
if "!NEEDS_FULL_REBUILD!"=="1" set FRONTEND_BROKEN=1

if "!FRONTEND_BROKEN!"=="1" (
    echo [INFO] Ripristino moduli...
    if exist node_modules rd /s /q node_modules
    call npm install
) else (
    if exist package-lock.json (
        call npm ci
    ) else (
        call npm install
    )
)
cd /d "%~dp0"

echo.
echo ===================================================
echo     AVVIO DEI SERVIZI
echo ===================================================
echo.

:: --- AVVIO SERVER ---
echo [4/5] Lancio dei server in background...
start /b cmd /c "cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000"
start /b cmd /c "cd frontend && npm run dev"

:: --- ATTESA E BROWSER ---
echo [5/5] In attesa (8s)...
timeout /t 8 /nobreak >nul
start http://localhost:5173

echo.
echo ===================================================
echo     SYSTEM READY! 
echo ===================================================
echo.
pause
