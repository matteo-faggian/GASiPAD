import React, { useState } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Canvas } from './components/Canvas/Canvas';
import { ResultsDashboard } from './components/Charts/ResultsDashboard';
import { useSimulation } from './hooks/useSimulation';
import { createComponent } from './utils/componentTypes.jsx';

function App() {
  const [config, setConfig] = useState({
    P0: 500000,
    T0: 600,
    P_amb: 101325,
    gamma: 1.4,
    R: 287.0,
    a: 0.0,
    b: 0.0,
    is_real: false,
    solver_type: 'general' // 'analytical' or 'general' (BETA)
  });

  const [components, setComponents] = useState([]);
  const { simulate, results, loading, error, clearResults } = useSimulation();

  const handleAddComponent = (type) => {
    try {
      // Feedback aptico protetto da try-catch per evitare crash su dispositivi con implementazioni buggate (es. Oppo/ColorOS)
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate([50, 30, 50]);
        } catch (vErr) {
          console.warn("Vibration failed, but app will continue:", vErr);
        }
      }

      let lastDOut = null;
      if (components.length > 0) {
        const last = components[components.length - 1];
        lastDOut = last.params ? (last.params.d_out || last.params.d_h) : null;
      }
      
      const newComp = createComponent(type, lastDOut);
      if (newComp) {
        setComponents(prev => [...prev, newComp]);
        clearResults();
      }
    } catch (err) {
      console.error("Critical error adding component:", err);
      alert("Error adding component. Please try again.");
    }
  };

  const handleSimulate = () => {
    if (components.length === 0) {
      alert('Add at least one component to the pipeline before simulating.');
      return;
    }
    simulate(config, components);
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <Sidebar
          config={config}
          setConfig={(c) => { setConfig(c); clearResults(); }}
          onAddComponent={handleAddComponent}
          onSimulate={handleSimulate}
          loading={loading}
        />
      </div>

      <div className="main-content">
        <Canvas
          components={components}
          setComponents={(c) => { setComponents(c); clearResults(); }}
          config={config}
          results={results}
        />

        {error && (
          <div style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239,68,68,0.5)',
            color: '#fca5a5',
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            maxWidth: '420px',
            backdropFilter: 'blur(8px)',
          }}>
            <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>🚨</span>
            <div>
              <p style={{ fontWeight: 700, margin: 0, marginBottom: '0.25rem' }}>Simulation Error</p>
              <p style={{ fontSize: '0.85rem', margin: 0, opacity: 0.85 }}>{error}</p>
            </div>
          </div>
        )}

        {results && results.data && (
          <ResultsDashboard 
            results={results} 
          />
        )}
        <footer className="footer-text">
          GASPAD Standalone v4.0 - Engine Active (No Cache)
        </footer>
      </div>
    </div>
  );
}

export default App;
