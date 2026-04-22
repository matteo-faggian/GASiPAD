import React from 'react';
import { COMPONENT_TYPES } from '../../utils/constants';

const PARAM_LABELS = {
  d_in: 'd_in [m]',
  d_out: 'd_out [m]',
  length: 'Length [m]',
  d_h: 'D_h [m]',
  f: 'f (Fanning)',
  q: 'q [J/kg]',
};

export function Sidebar({ config, setConfig, onAddComponent, onSimulate, loading }) {

  const handleConfigChange = (k, v) => setConfig({ ...config, [k]: v });

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>⚡ Gas Dynamics Pro</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '2px' }}>
          1D Steady-State Flow Simulator
        </p>
      </div>

      <div className="sidebar-content">

        {/* Boundary Conditions */}
        <div>
          <h2 className="section-title">
            <span>🔵</span> Boundary Conditions
          </h2>
          <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              { key: 'P0', label: 'Stagnation Pressure (P₀)', unit: 'Pa', step: 1000 },
              { key: 'T0', label: 'Stagnation Temperature (T₀)', unit: 'K', step: 1 },
              { key: 'P_amb', label: 'Ambient Pressure (Pₐ)', unit: 'Pa', step: 100 },
            ].map(({ key, label, unit, step }) => (
              <div key={key} className="input-group">
                <label>{label}</label>
                <div className="input-row">
                  <input
                    type="number"
                    step={step}
                    className="input-field"
                    value={config[key]}
                    onChange={e => handleConfigChange(key, e.target.value)}
                  />
                  <span style={{ minWidth: '32px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Gas Properties */}
        <div>
          <h2 className="section-title">
            <span>🌬️</span> Gas Properties
          </h2>
          <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="input-group">
              <label>Specific Heat Ratio (γ)</label>
              <input
                type="number"
                step="0.01"
                className="input-field"
                value={config.gamma}
                onChange={e => handleConfigChange('gamma', e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Gas Constant (R)</label>
              <div className="input-row">
                <input
                  type="number"
                  className="input-field"
                  value={config.R}
                  onChange={e => handleConfigChange('R', e.target.value)}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>J/kgK</span>
              </div>
            </div>
          </div>
        </div>

        {/* Solver Selection */}
        <div>
          <h2 className="section-title">
            <span>⚙️</span> Solver Engine
          </h2>
          <div className="glass-card" style={{ padding: '0.5rem', display: 'flex', gap: '0.5rem' }}>
            <button
              className={`solver-toggle ${config.solver_type === 'analytical' ? 'active' : ''}`}
              onClick={() => handleConfigChange('solver_type', 'analytical')}
              style={{ flex: 1, padding: '0.5rem', fontSize: '0.75rem' }}
            >
              Analytical
            </button>
            <button
              className={`solver-toggle ${config.solver_type === 'euler' ? 'active' : ''}`}
              onClick={() => handleConfigChange('solver_type', 'euler')}
              style={{ flex: 1, padding: '0.5rem', fontSize: '0.75rem' }}
            >
              Real gas(BETA)
            </button>
          </div>
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.5rem', padding: '0 0.5rem' }}>
            Use for real gas simulations above 1000 degrees.
          </p>
        </div>

        {/* Component Palette */}
        <div>
          <h2 className="section-title">
            <span>🧩</span> Component Palette
          </h2>
          <div className="palette-grid">
            {Object.entries(COMPONENT_TYPES).map(([type, def]) => (
              <div
                key={type}
                className="palette-item"
                onClick={() => onAddComponent(type)}
                title={`Add ${def.label}`}
              >
                <span style={{
                  color: def.color,
                  backgroundColor: `${def.color}20`,
                  padding: '5px 8px',
                  borderRadius: '6px',
                  fontSize: '1rem',
                }}>
                  {def.icon}
                </span>
                <span style={{ flex: 1 }}>{def.label}</span>
                <span style={{
                  color: def.color,
                  fontSize: '1.2rem',
                  fontWeight: 700,
                }}>+</span>
              </div>
            ))}
          </div>
          <p style={{
            marginTop: '0.75rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            lineHeight: 1.4,
          }}>
            💡 Tip: Drag blocks to reorder. Edit parameters inline.
          </p>
        </div>

      </div>

      {/* Simulate button */}
      <div className="sidebar-footer">
        <button
          className="btn-primary"
          onClick={onSimulate}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
        >
          {loading ? (
            <>
              <span className="spinner" />
              Simulating…
            </>
          ) : (
            '▶  Simulate'
          )}
        </button>
      </div>
    </div>
  );
}
