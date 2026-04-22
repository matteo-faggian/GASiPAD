@echo off
TITLE GASFLASH Launcher
COLOR 0B

:: Ensure we are in the script's directory
cd /d "%~dp0"

echo ===================================================
echo        GASFLASH: 1D GAS DYNAMICS SOLVER
echo ===================================================
echo.

:: Check if gasdynamics-sim directory exists
if not exist "gasdynamics-sim" (
    echo [ERRORE] Cartella 'gasdynamics-sim' non trovata!
    echo Assicurati che questo file .bat sia nella stessa cartella di 'gasdynamics-sim'.
    echo.
    pause
    exit /b
)

echo [1/3] Avvio del Backend (FastAPI)...
start /b cmd /c "cd gasdynamics-sim\backend && uvicorn app.main:app --host 127.0.0.1 --port 8000"

echo [2/3] Avvio del Frontend (Vite/React)...
start /b cmd /c "cd gasdynamics-sim\frontend && npm run dev"

echo.
echo [3/3] In attesa che i server siano pronti...
timeout /t 5 /nobreak > nul

echo.
echo Apertura del simulatore nel browser...
start http://localhost:5173

echo.
echo ===================================================
echo     SIMULATORE ATTIVO! Chiudi questa finestra
echo     solo quando hai finito la sessione.
echo ===================================================
echo.
pause
