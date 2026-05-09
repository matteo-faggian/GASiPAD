import { useState } from 'react';
import { GasProperties, Solver } from '../utils/gasdynamics';

export function useSimulation() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const simulate = async (config, components) => {
    setLoading(true);
    setError(null);
    
    try {
      // 1. Prepare Gas Properties
      const gas = new GasProperties(parseFloat(config.gamma), parseFloat(config.R));
      
      // 2. Format components for the solver
      const formattedComponents = components.map(c => ({
        type: c.type,
        params: Object.fromEntries(
          Object.entries(c.params).map(([k, v]) => [k, parseFloat(v)])
        )
      }));

      // 3. Run the Local Solver (Client-side)
      const simulation = Solver.solveFullPipeline(
        formattedComponents,
        parseFloat(config.P0),
        parseFloat(config.T0),
        parseFloat(config.P_amb),
        gas
      );

      // 4. Generate high-res plot data
      const { data, boundaries, labels } = Solver.generatePlotData(formattedComponents, simulation.results, gas);
      
      // 5. Compute summary
      const summary = Solver.computeSummary(config, formattedComponents, data, gas);

      const finalResponse = {
        success: true,
        data: data,
        component_boundaries: boundaries,
        component_labels: labels,
        summary: summary,
        warnings: simulation.warnings
      };

      setResults(finalResponse);
      
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { simulate, results, loading, error, clearResults: () => setResults(null) };
}

