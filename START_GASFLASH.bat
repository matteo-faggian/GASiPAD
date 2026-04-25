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

:: --- AGGIORNAMENTO DA GITHUB ---
echo [1/5] Controllo aggiornamenti da GitHub...
git fetch origin > nul 2>&1

:: Conta di quanti commit siamo indietro
set BEHIND_COUNT=0
for /f %%i in ('git rev-list HEAD..origin/main --count') do set BEHIND_COUNT=%%i

if %BEHIND_COUNT% GTR 0 (
    echo [INFO] Rilevato aggiornamento (%BEHIND_COUNT% nuovi commit).
    echo [INFO] Esecuzione "FORCE CLEAN UPDATE": sincronizzazione completa...
    
    :: Forza il reset alla versione di GitHub
    git reset --hard origin/main
    :: Rimuove file non tracciati (pulisce il workspace)
    git clean -fd
    
    set NEEDS_FULL_REBUILD=1
) else (
    echo [INFO] Il codice e' gia' aggiornato all'ultima versione di GitHub.
    set NEEDS_FULL_REBUILD=0
)

:: --- SEZIONE BACKEND ---
if %NEEDS_FULL_REBUILD% EQU 1 (
    echo [2/5] REINSTALLAZIONE dipendenze Python...
    cd /d "%~dp0backend"
    python -m pip install --upgrade --force-reinstall -r requirements.txt
) else (
    echo [2/5] Controllo dipendenze Python...
    cd /d "%~dp0backend"
    python -m pip install -r requirements.txt
)
if %ERRORLEVEL% NEQ 0 (
    echo [ATTENZIONE] Errore durante l'installazione Python. 
)
cd /d "%~dp0"

:: --- SEZIONE FRONTEND ---
if %NEEDS_FULL_REBUILD% EQU 1 (
    echo [3/5] REINSTALLAZIONE moduli Node.js (Clean Install)...
    cd /d "%~dp0frontend"
    :: Rimuoviamo node_modules per una pulizia totale come richiesto
    if exist node_modules (
        echo [INFO] Eliminazione vecchi moduli frontend...
        rd /s /q node_modules
    )
    call npm install
) else (
    echo [3/5] Controllo moduli Node.js...
    cd /d "%~dp0frontend"
    if exist package-lock.json (
        call npm ci
    ) else (
        call npm install
    )
)
if %ERRORLEVEL% NEQ 0 (
    echo [ATTENZIONE] Errore durante l'installazione Node.js.
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
echo [5/5] In attesa che i server siano pronti...
timeout /t 8 /nobreak > nul

echo Apertura del simulatore...
start http://localhost:5173

echo.
echo ===================================================
echo     SYSTEM READY! 
echo     High-Performance CFD Core is now active.
echo     Close this window only after your session.
echo ===================================================
echo.
pause
