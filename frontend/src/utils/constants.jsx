import React from 'react';
import { v4 as uuidv4 } from 'uuid';

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
  }
};

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
    id: uuidv4(),
    type,
    params
  };
};
