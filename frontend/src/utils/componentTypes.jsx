import React from 'react';

export const COMPONENT_TYPES = {
  convergent: {
    label: "Convergent Nozzle",
    color: "var(--comp-convergent)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 5l20 4v6l-20 4V5z" />
        <path d="M12 8.5v7" opacity="0.3" />
      </svg>
    ),
    defaultParams: { d_in: 0.1, d_out: 0.05, length: 0.2 }
  },
  divergent: {
    label: "Divergent Nozzle",
    color: "var(--comp-divergent)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 9l20-4v14l-20-4V9z" />
        <path d="M12 7.5v9" opacity="0.3" />
      </svg>
    ),
    defaultParams: { d_in: 0.05, d_out: 0.15, length: 0.4 }
  },
  fanno: {
    label: "Fanno Duct (Friction)",
    color: "var(--comp-fanno)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="10" rx="1" />
        <path d="M6 7v10M10 7v10M14 7v10M18 7v10" opacity="0.4" />
      </svg>
    ),
    defaultParams: { d_h: 0.05, length: 1.0, f: 0.005 }
  },
  rayleigh: {
    label: "Rayleigh Duct (Heat)",
    color: "var(--comp-rayleigh)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="10" rx="1" />
        <path d="M6 12h12" />
        <path d="M9 10c0-2 2-2 2 0s2 2 2 0 2-2 2 0" stroke="orange" strokeWidth="1.5" />
      </svg>
    ),
    defaultParams: { d_h: 0.05, length: 0.5, q: 50000 }
  },
  solid_grain: {
    label: "Solid Grain (Combustor)",
    color: "var(--comp-solid-grain)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M9 18v-4c0-1 1-2 3-2s3 1 3 2v4" stroke="#ff6d00" strokeWidth="1.8" />
        <circle cx="12" cy="9" r="1.5" fill="#ff6d00" stroke="none" />
        <path d="M10 8c0-2 4-2 4 0" stroke="#ff6d00" strokeWidth="1" opacity="0.6" />
      </svg>
    ),
    defaultParams: { length: 0.5, d_h: 0.1, rho_b: 1800, A_b: 0.01, n: 0.4, a_coeff: 0.005, T_b: 300, only_mass_addition: 0, target_mass_flow: 2.0 }
  }
};

const generateId = () => `comp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const createComponent = (type, prevDOut = null) => {
  const params = { ...COMPONENT_TYPES[type].defaultParams };
  
  if (prevDOut !== null) {
    if (type === 'convergent' || type === 'divergent') {
      params.d_in = prevDOut;
      if (type === 'convergent') params.d_out = prevDOut / 2;
      if (type === 'divergent') params.d_out = prevDOut * 2;
    } else {
      params.d_h = prevDOut;
    }
  }
  
  return {
    id: generateId(),
    type,
    params
  };
};
