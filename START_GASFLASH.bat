@echo off
setlocal EnableDelayedExpansion

:: GASFLASH PRO (beta version) - Universal Smart Launcher V2
:: Numerical Core: Numba-Accelerated Roe/MUSCL

echo ===================================================
echo     GASFLASH PRO: ADVANCED INSTALLATION
echo     Numerical Core: Numba-Accelerated Roe/MUSCL
echo ===================================================
echo.

:: --- CHIUSURA PROCESSI PENDENTI ---
echo [0/5] Pulizia processi in background...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1

:: --- CONFIGURAZIONE ---
set "REPO_NAME=Iterative-1D-Gasdynamic-Solver"
set "REPO_URL=https://github.com/Matteobeo/%REPO_NAME%"
set "API_URL=https://api.github.com/repos/Matteobeo/%REPO_NAME%/commits/main"
set "NEEDS_FULL_REBUILD=0"

:: --- CONTROLLO AGGIORNAMENTI ---
echo [1/5] Verifica aggiornamenti sistema...

git --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Modalita' Git rilevata.
    git fetch origin >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        for /f "tokens=*" %%i in ('git rev-list HEAD..origin/main --count 2^>nul') do set BEHIND_COUNT=%%i
        if "!BEHIND_COUNT!"=="" set BEHIND_COUNT=0
        
        if !BEHIND_COUNT! GTR 0 (
            echo [INFO] Scaricamento aggiornamenti (!BEHIND_COUNT! commit)...
            git reset --hard origin/main >nul 2>&1
            git clean -fd >nul 2>&1
            set NEEDS_FULL_REBUILD=1
        ) else (
            echo [INFO] Sistema aggiornato.
        )
    ) else (
        echo [INFO] Server GitHub non raggiungibile. Avvio in modalita' locale.
    )
) else (
    echo [INFO] Modalita' ZIP (Smart Update)...
    
    set LOCAL_SHA=none
    if exist .last_commit set /p LOCAL_SHA=<.last_commit

    :: Recupero SHA remoto via PowerShell (con bypass policy)
    set "GET_SHA_CMD=(Invoke-RestMethod -Uri '%API_URL%').sha"
    for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "%GET_SHA_CMD%" 2^>nul`) do set REMOTE_SHA=%%a

    if "!REMOTE_SHA!"=="" (
        echo [INFO] Impossibile verificare aggiornamenti online.
    ) else if NOT "!REMOTE_SHA!"=="!LOCAL_SHA!" (
        echo [INFO] Nuova versione disponibile. Download in corso...
        set "DL_CMD=Invoke-WebRequest -Uri '%REPO_URL%/archive/refs/heads/main.zip' -OutFile 'update.zip'; Expand-Archive -Path 'update.zip' -DestinationPath 'temp_update' -Force; Copy-Item -Path 'temp_update\%REPO_NAME%-main\*' -Destination '.' -Recurse -Force; Remove-Item 'update.zip'; Remove-Item 'temp_update' -Recurse"
        powershell -NoProfile -ExecutionPolicy Bypass -Command "!DL_CMD!"
        
        if !ERRORLEVEL! EQU 0 (
            echo !REMOTE_SHA! > .last_commit
            echo [INFO] Aggiornamento completato con successo.
            set NEEDS_FULL_REBUILD=1
        ) else (
            echo [ERRORE] Aggiornamento fallito. Controlla la connessione.
            pause
        )
    ) else (
        echo [INFO] Sistema gia' aggiornato all'ultima versione.
    )
)

:: --- SEZIONE BACKEND ---
echo [2/5] Configurazione ambiente Python...
cd /d "%~dp0backend"
if "!NEEDS_FULL_REBUILD!"=="1" (
    echo [INFO] Aggiornamento forzato dei pacchetti backend...
    python -m pip install --upgrade --force-reinstall -r requirements.txt
) else (
    python -m pip install -r requirements.txt
)
cd /d "%~dp0"

:: --- SEZIONE FRONTEND ---
echo [3/5] Configurazione ambiente Interfaccia...
cd /d "%~dp0frontend"
set FRONTEND_BROKEN=0
if not exist node_modules\.bin\vite set FRONTEND_BROKEN=1
if "!NEEDS_FULL_REBUILD!"=="1" set FRONTEND_BROKEN=1

if "!FRONTEND_BROKEN!"=="1" (
    echo [INFO] Ricostruzione moduli interfaccia (attendere)...
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
echo     AVVIO GASDYNAMICS SIMULATOR
echo ===================================================
echo.

:: --- AVVIO SERVER ---
echo [4/5] Lancio motori di calcolo e interfaccia...
start /b cmd /c "cd /d "%~dp0backend" && uvicorn app.main:app --host 127.0.0.1 --port 8000"
start /b cmd /c "cd /d "%~dp0frontend" && npm run dev"

:: --- ATTESA E BROWSER ---
echo [5/5] Finalizzazione avvio (8 secondi)...
timeout /t 8 /nobreak >nul
start http://localhost:5173

echo.
echo ===================================================
echo     PRONTO! (Mantieni questa finestra aperta)
echo ===================================================
echo.
pause
