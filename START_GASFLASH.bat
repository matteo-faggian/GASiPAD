@echo off
TITLE GASFLASH PRO (beta version) - High-Performance CFD Suite
COLOR 0B

:: Posizionamento nella cartella dello script
cd /d "%~dp0"

echo ===================================================
echo     GASFLASH PRO: ADVANCED INSTALLATION
echo     Numerical Core: Numba-Accelerated Roe/MUSCL
echo ===================================================
echo.

:: --- CONTROLLO GIT ---
git --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ATTENZIONE] Git non rilevato. Saltando aggiornamenti...
    set NEEDS_FULL_REBUILD=0
    goto SKIP_GIT
)

:: --- AGGIORNAMENTO DA GITHUB ---
echo [1/5] Controllo aggiornamenti da GitHub...
git fetch origin > nul 2>&1

set BEHIND_COUNT=0
for /f "tokens=*" %%i in ('git rev-list HEAD..origin/main --count 2^>nul') do set BEHIND_COUNT=%%i

if %BEHIND_COUNT% GTR 0 (
    echo [INFO] Rilevato aggiornamento (%BEHIND_COUNT% nuovi commit).
    echo [INFO] Esecuzione "FORCE CLEAN UPDATE": sincronizzazione completa...
    git reset --hard origin/main
    git clean -fd
    set NEEDS_FULL_REBUILD=1
) else (
    echo [INFO] Il codice e' gia' aggiornato all'ultima versione di GitHub.
    set NEEDS_FULL_REBUILD=0
)

:SKIP_GIT

:: --- SEZIONE BACKEND ---
echo [2/5] Gestione dipendenze Python...
cd /d "%~dp0backend"
if "%NEEDS_FULL_REBUILD%"=="1" (
    echo [INFO] Reinstallazione forzata...
    python -m pip install --upgrade --force-reinstall -r requirements.txt
) else (
    python -m pip install -r requirements.txt
)
if %ERRORLEVEL% NEQ 0 echo [!] Errore durante l'installazione Python.
cd /d "%~dp0"

:: --- SEZIONE FRONTEND ---
echo [3/5] Gestione moduli Node.js...
cd /d "%~dp0frontend"
if "%NEEDS_FULL_REBUILD%"=="1" (
    echo [INFO] Pulizia e reinstallazione moduli...
    if exist node_modules rd /s /q node_modules
    call npm install
) else (
    if exist package-lock.json (
        call npm ci
    ) else (
        call npm install
    )
)
if %ERRORLEVEL% NEQ 0 echo [!] Errore durante l'installazione Node.js.
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
echo [5/5] In attesa che i server siano pronti...
timeout /t 8 /nobreak > nul

echo Apertura del simulatore...
start http://localhost:5173

echo.
echo ===================================================
echo     SYSTEM READY! 
echo     Close this window only after your session.
echo ===================================================
echo.
pause
