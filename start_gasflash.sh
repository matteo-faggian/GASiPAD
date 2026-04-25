#!/bin/bash
# GASFLASH PRO (beta version) - Launcher for Mac/Linux

echo "==================================================="
echo "    GASFLASH PRO: ADVANCED INSTALLATION"
echo "    Numerical Core: Numba-Accelerated Roe/MUSCL"
echo "==================================================="
echo ""

# --- AGGIORNAMENTO DA GITHUB ---
echo "[1/5] Controllo aggiornamenti da GitHub..."
git fetch origin > /dev/null 2>&1

BEHIND_COUNT=$(git rev-list HEAD..origin/main --count)

if [ "$BEHIND_COUNT" -gt 0 ]; then
    echo "[INFO] Rilevato aggiornamento ($BEHIND_COUNT nuovi commit)."
    echo "[INFO] Esecuzione \"FORCE CLEAN UPDATE\": sincronizzazione completa..."
    
    git reset --hard origin/main
    git clean -fd
    
    NEEDS_FULL_REBUILD=1
else
    echo "[INFO] Il codice è già aggiornato all'ultima versione di GitHub."
    NEEDS_FULL_REBUILD=0
fi

# --- SEZIONE BACKEND ---
cd backend
if [ "$NEEDS_FULL_REBUILD" -eq 1 ]; then
    echo "[2/5] REINSTALLAZIONE dipendenze Python..."
    python3 -m pip install --upgrade --force-reinstall -r requirements.txt
else
    echo "[2/5] Controllo dipendenze Python..."
    python3 -m pip install -r requirements.txt
fi
cd ..

# --- SEZIONE FRONTEND ---
cd frontend
if [ "$NEEDS_FULL_REBUILD" -eq 1 ]; then
    echo "[3/5] REINSTALLAZIONE moduli Node.js (Clean Install)..."
    if [ -d "node_modules" ]; then
        echo "[INFO] Eliminazione vecchi moduli frontend..."
        rm -rf node_modules
    fi
    npm install
else
    echo "[3/5] Controllo moduli Node.js..."
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
fi
cd ..

echo ""
echo "==================================================="
echo "    AVVIO DEI SERVIZI"
echo "==================================================="
echo ""

# --- AVVIO SERVER ---
echo "[4/5] Lancio dei server in background..."
(cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000) &
(cd frontend && npm run dev) &

# --- ATTESA E BROWSER ---
echo "[5/5] In attesa che i server siano pronti..."
sleep 8

echo "Apertura del simulatore..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://localhost:5173
else
    xdg-open http://localhost:5173 || echo "Apri manualmente: http://localhost:5173"
fi

echo ""
echo "==================================================="
echo "    SYSTEM READY!" 
echo "    High-Performance CFD Core is now active."
echo "==================================================="
echo ""

# Keep script running to show logs if needed, or just wait
wait
