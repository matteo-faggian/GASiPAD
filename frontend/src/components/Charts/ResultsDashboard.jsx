import React from 'react';
import Plotly from 'plotly.js-dist-min';
import PlotlyFactory from 'react-plotly.js/factory.js';

const Plot = typeof PlotlyFactory === 'function' ? PlotlyFactory(Plotly) : PlotlyFactory.default(Plotly);

const layoutDefaults = {
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: { color: '#94a3b8', family: 'Inter' },
  margin: { t: 40, r: 20, b: 40, l: 50 },
  xaxis: { 
    gridcolor: 'rgba(255,255,255,0.05)',
    zerolinecolor: 'rgba(255,255,255,0.1)',
    title: { text: 'Axial Position x [m]', font: { size: 12 } }
  },
  yaxis: {
    gridcolor: 'rgba(255,255,255,0.05)',
    zerolinecolor: 'rgba(255,255,255,0.1)',
  },
  showlegend: true,
  legend: { x: 1, y: 1, xanchor: 'right', bgcolor: 'rgba(15,23,42,0.8)' }
};

export function ResultsDashboard({ results }) {
  if (!results || !results.data) return null;
  
  const d = results.data;
  const boundaries = results.component_boundaries || [];
  
  // Create boundary shapes for vertical lines
  const shapes = boundaries.map(x => ({
    type: 'line',
    x0: x, x1: x,
    y0: 0, y1: 1,
    yref: 'paper',
    line: { color: 'rgba(255,255,255,0.2)', width: 1, dash: 'dot' }
  }));

  const pressureData = [
    { x: d.x, y: d.pressure, type: 'scatter', mode: 'lines', name: 'Static P', line: { color: '#3b82f6', width: 2 } },
    { x: d.x, y: d.pressure_total, type: 'scatter', mode: 'lines', name: 'Total P0', line: { color: '#8b5cf6', width: 2, dash: 'dash' } }
  ];

  const machData = [
    { x: d.x, y: d.mach, type: 'scatter', mode: 'lines', name: 'Mach', line: { color: '#10b981', width: 2 } },
    { x: [Math.min(...d.x), Math.max(...d.x)], y: [1, 1], type: 'scatter', mode: 'lines', name: 'M=1', line: { color: '#ef4444', width: 1, dash: 'dot' } }
  ];

  const tempData = [
    { x: d.x, y: d.temperature, type: 'scatter', mode: 'lines', name: 'Static T', line: { color: '#f59e0b', width: 2 } },
    { x: d.x, y: d.temperature_total, type: 'scatter', mode: 'lines', name: 'Total T0', line: { color: '#ec4899', width: 2, dash: 'dash' } }
  ];

  const massData = [
    { x: d.x, y: d.mass_flow, type: 'scatter', mode: 'lines', name: 'Mass Flow', line: { color: '#06b6d4', width: 2 } }
  ];

  const [isStacked, setIsStacked] = React.useState(false);

  return (
    <div className="results-panel animate-fade-in">
      <div className="results-header">
        <h3 className="comp-title">
          <span>📊 Simulation Results</span>
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button 
            className={`solver-toggle ${isStacked ? 'active' : ''}`}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', height: 'fit-content' }}
            onClick={() => setIsStacked(!isStacked)}
            title={isStacked ? "Switch to Grid View" : "Switch to Stacked View"}
          >
            {isStacked ? '🔲 Grid' : '📜 List'}
          </button>
          <button 
            className="solver-toggle" 
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', height: 'fit-content' }}
            onClick={() => {
              const headers = ['x [m]', 'Mach [-]', 'P_static [Pa]', 'P_total [Pa]', 'T_static [K]', 'T_total [K]', 'Mass_Flux [kg/sm2]'];
              const rows = d.x.map((_, i) => [
                d.x[i], d.mach[i], d.pressure[i], d.pressure_total[i], 
                d.temperature[i], d.temperature_total[i], d.mass_flow[i]
              ]);
              const csvContent = "data:text/csv;charset=utf-8," 
                + headers.join(",") + "\n"
                + rows.map(e => e.join(",")).join("\n");
              const encodedUri = encodeURI(csvContent);
              const link = document.createElement("a");
              link.setAttribute("href", encodedUri);
              link.setAttribute("download", "gasflash_results.csv");
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
          >
            📥 Export CSV
          </button>
          {results.warnings?.map((w, i) => (
            <span key={i} className="status-badge warning">⚠️ {w}</span>
          ))}
          {!results.warnings?.length && <span className="status-badge success">✅ Solved Successfully</span>}
        </div>
      </div>
      <div className={`charts-container ${isStacked ? 'stacked' : ''}`}>
        <div className="chart-wrapper">
          <Plot 
            data={machData} 
            layout={{ ...layoutDefaults, title: 'Mach Number [-]', shapes, yaxis: { ...layoutDefaults.yaxis, title: { text: 'Mach [-]', font: { size: 12 } } } }}
            useResizeHandler={true} style={{ width: '100%', height: '100%' }} config={{ responsive: true }}
          />
        </div>
        <div className="chart-wrapper">
          <Plot 
            data={pressureData} 
            layout={{ ...layoutDefaults, title: 'Pressure [Pa]', shapes, yaxis: { ...layoutDefaults.yaxis, title: { text: 'Pressure [Pa]', font: { size: 12 } }, type: 'log', exponentformat: 'e' } }}
            useResizeHandler={true} style={{ width: '100%', height: '100%' }} config={{ responsive: true }}
          />
        </div>
        <div className="chart-wrapper">
          <Plot 
            data={tempData} 
            layout={{ ...layoutDefaults, title: 'Temperature [K]', shapes, yaxis: { ...layoutDefaults.yaxis, title: { text: 'Temperature [K]', font: { size: 12 } } } }}
            useResizeHandler={true} style={{ width: '100%', height: '100%' }} config={{ responsive: true }}
          />
        </div>
        <div className="chart-wrapper">
          <Plot 
            data={massData} 
            layout={{ ...layoutDefaults, title: 'Mass Flow [kg/s]', shapes, yaxis: { ...layoutDefaults.yaxis, title: { text: 'mdot [kg/s]', font: { size: 12 } } } }}
            useResizeHandler={true} style={{ width: '100%', height: '100%' }} config={{ responsive: true }}
          />
        </div>
      </div>
    </div>
  );
}
