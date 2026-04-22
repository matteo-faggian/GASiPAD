@echo off
TITLE GASFLASH - Setup Completo e Avvio
COLOR 0B

:: Posizionamento nella cartella dello script
cd /d "%~dp0"

echo ===================================================
echo     GASFLASH: INSTALLAZIONE DIPENDENZE
echo ===================================================
echo.

:: Verifica se la cartella del progetto esiste
if not exist "gasdynamics-sim" (
    echo [ERRORE] Cartella 'gasdynamics-sim' non trovata!
    pause
    exit /b
)

:: --- SEZIONE BACKEND ---
echo [1/4] Installazione dipendenze Python (Backend)...
cd /d "gasdynamics-sim\backend"
python -m pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [ATTENZIONE] Errore durante l'installazione Python. 
    echo Assicurati di avere Python installato e nel PATH.
)
cd /d "%~dp0"

:: --- SEZIONE FRONTEND ---
echo [2/4] Installazione moduli Node.js (Frontend)...
cd /d "gasdynamics-sim\frontend"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ATTENZIONE] Errore durante l'installazione Node.js.
    echo Assicurati di avere Node.js installato e nel PATH.
)
cd /d "%~dp0"

echo.
echo ===================================================
echo     AVVIO DEI SERVIZI
echo ===================================================
echo.

:: --- AVVIO SERVER ---
echo [3/4] Lancio dei server in background...
start /b cmd /c "cd gasdynamics-sim\backend && uvicorn app.main:app --host 127.0.0.1 --port 8000"
start /b cmd /c "cd gasdynamics-sim\frontend && npm run dev"

:: --- ATTESA E BROWSER ---
echo [4/4] In attesa che i server siano pronti...
timeout /t 8 /nobreak > nul

echo Apertura del simulatore...
start http://localhost:5173

echo.
echo ===================================================
echo     SISTEMA PRONTO! 
echo     Puoi chiudere questa finestra a fine sessione.
echo ===================================================
echo.
pause
