/**
 * GASPAD Core Gas Dynamics Solver (JavaScript Port)
 * Ported from backend/app/solver/
 */

export const PI = Math.PI;

/**
 * Gas properties container (from gas.py)
 */
export class GasProperties {
  constructor(gamma = 1.4, R = 287.0) {
    this.gamma = gamma;
    this.R = R;
    this.cp = (gamma * R) / (gamma - 1);
    this.cv = R / (gamma - 1);
  }

  speedOfSound(T) {
    return Math.sqrt(this.gamma * this.R * T);
  }

  density(P, T) {
    if (T < 1e-6) return 0.0;
    return P / (this.R * T);
  }

  areaFromDiameter(d) {
    return (PI / 4) * Math.pow(d, 2);
  }

  diameterFromArea(A) {
    return Math.sqrt((4 * A) / PI);
  }
}

/**
 * Isentropic Relations (from isentropic.py)
 */
export const Isentropic = {
  temperatureRatio: (M, gamma) => {
    return Math.pow(1.0 + ((gamma - 1.0) / 2.0) * Math.pow(M, 2), -1.0);
  },

  pressureRatio: (M, gamma) => {
    return Math.pow(1.0 + ((gamma - 1.0) / 2.0) * Math.pow(M, 2), -gamma / (gamma - 1.0));
  },

  densityRatio: (M, gamma) => {
    return Math.pow(1.0 + ((gamma - 1.0) / 2.0) * Math.pow(M, 2), -1.0 / (gamma - 1.0));
  },

  areaMachRatio: (M, gamma) => {
    if (Math.abs(M) < 1e-12) return Infinity;
    const gp1 = gamma + 1.0;
    const gm1 = gamma - 1.0;
    const term = (2.0 / gp1) * (1.0 + (gm1 / 2.0) * Math.pow(M, 2));
    const exponent = gp1 / (2.0 * gm1);
    return (1.0 / M) * Math.pow(term, exponent);
  },

  // Numerical solver for Mach from Area Ratio (Brent's method equivalent)
  machFromAreaRatio: (A_ratio, gamma, subsonic = true) => {
    if (A_ratio < 1.0 - 1e-9) throw new Error(`Area ratio A/A* must be >= 1.0, got ${A_ratio}`);
    if (Math.abs(A_ratio - 1.0) < 1e-9) return 1.0;

    const f = (M) => Isentropic.areaMachRatio(M, gamma) - A_ratio;
    
    // Simple Bisection for porting (stable and precise)
    let low = subsonic ? 1e-12 : 1.0 + 1e-10;
    let high = subsonic ? 1.0 - 1e-10 : 25.0; // 25 is safe upper bound for most M
    
    if (!subsonic) {
        while (f(high) < 0 && high < 100) high *= 2;
    }

    for (let i = 0; i < 100; i++) {
      let mid = (low + high) / 2;
      if (f(mid) > 0) {
        subsonic ? (low = mid) : (high = mid);
      } else {
        subsonic ? (high = mid) : (low = mid);
      }
      if (Math.abs(high - low) < 1e-12) return mid;
    }
    return (low + high) / 2;
  },

  staticFromStagnation: (M, P0, T0, gamma, R) => {
    const T = T0 * Isentropic.temperatureRatio(M, gamma);
    const P = P0 * Isentropic.pressureRatio(M, gamma);
    const rho = T > 0 ? P / (R * T) : 0.0;
    const a = T > 0 ? Math.sqrt(gamma * R * T) : 0.0;
    const V = M * a;
    return { T, P, rho, a, V };
  }
};

/**
 * Fanno Flow Relations (from fanno.py)
 */
export const Fanno = {
  parameter: (M, gamma) => {
    if (Math.abs(M) < 1e-12) return Infinity;
    if (Math.abs(M - 1.0) < 1e-12) return 0.0;
    const gp1 = gamma + 1.0;
    const gm1 = gamma - 1.0;
    const M2 = Math.pow(M, 2);
    const term1 = (1.0 - M2) / (gamma * M2);
    const term2 = (gp1 / (2.0 * gamma)) * Math.log((gp1 * M2) / (2.0 + gm1 * M2));
    return term1 + term2;
  },

  temperatureRatio: (M, gamma) => {
    return (gamma + 1.0) / (2.0 * (1.0 + ((gamma - 1.0) / 2.0) * Math.pow(M, 2)));
  },

  pressureRatio: (M, gamma) => {
    if (Math.abs(M) < 1e-12) return Infinity;
    return (1.0 / M) * Math.sqrt((gamma + 1.0) / (2.0 * (1.0 + ((gamma - 1.0) / 2.0) * Math.pow(M, 2))));
  },

  totalPressureRatio: (M, gamma) => {
    if (Math.abs(M) < 1e-12) return Infinity;
    const gp1 = gamma + 1.0;
    const gm1 = gamma - 1.0;
    const term = (2.0 / gp1) * (1.0 + (gm1 / 2.0) * Math.pow(M, 2));
    const exponent = gp1 / (2.0 * gm1);
    return (1.0 / M) * Math.pow(term, exponent);
  },

  machFromParameter: (fLstar_D, gamma, subsonic = true) => {
    if (fLstar_D < -1e-9) throw new Error(`4fL*/D must be >= 0, got ${fLstar_D}`);
    if (Math.abs(fLstar_D) < 1e-9) return 1.0;

    const f = (M) => Fanno.parameter(M, gamma) - fLstar_D;
    let low = subsonic ? 1e-12 : 1.0 + 1e-12;
    let high = subsonic ? 1.0 - 1e-12 : 50.0;

    if (!subsonic) {
        while (f(high) < 0 && high < 100) high *= 2;
    }

    for (let i = 0; i < 100; i++) {
      let mid = (low + high) / 2;
      if (f(mid) > 0) {
        subsonic ? (low = mid) : (high = mid);
      } else {
        subsonic ? (high = mid) : (low = mid);
      }
      if (Math.abs(high - low) < 1e-12) return mid;
    }
    return (low + high) / 2;
  }
};

/**
 * Rayleigh Flow Relations (from rayleigh.py)
 */
export const Rayleigh = {
  totalTemperatureRatio: (M, gamma) => {
    const gp1 = gamma + 1.0;
    const gm1 = gamma - 1.0;
    const M2 = Math.pow(M, 2);
    return (2.0 * gp1 * M2) / Math.pow(1.0 + gamma * M2, 2) * (1.0 + (gm1 / 2.0) * M2);
  },

  temperatureRatio: (M, gamma) => {
    return Math.pow((M * (gamma + 1.0)) / (1.0 + gamma * Math.pow(M, 2)), 2);
  },

  pressureRatio: (M, gamma) => {
    return (gamma + 1.0) / (1.0 + gamma * Math.pow(M, 2));
  },

  totalPressureRatio: (M, gamma) => {
    const gp1 = gamma + 1.0;
    const gm1 = gamma - 1.0;
    const M2 = Math.pow(M, 2);
    const term1 = gp1 / (1.0 + gamma * M2);
    const term2 = (2.0 / gp1) * (1.0 + (gm1 / 2.0) * M2);
    return term1 * Math.pow(term2, gamma / gm1);
  },

  machFromT0Ratio: (T0_ratio, gamma, subsonic = true) => {
    if (T0_ratio > 1.0 + 1e-9) throw new Error(`T0/T0* must be <= 1.0, got ${T0_ratio}`);
    const tau = Math.max(0.0, Math.min(T0_ratio, 1.0));
    if (tau < 1e-9) return 0.0;
    if (Math.abs(tau - 1.0) < 1e-9) return 1.0;

    const A = (Math.pow(gamma, 2) - 1.0) - tau * Math.pow(gamma, 2);
    const B = 2.0 * (gamma + 1.0 - tau * gamma);
    const C = -tau;

    let roots = [];
    if (Math.abs(A) < 1e-12) {
      roots.push(Math.sqrt(Math.max(0.0, -C / B)));
    } else {
      const Delta = Math.pow(B, 2) - 4.0 * A * C;
      if (Delta >= 0) {
        const M2_1 = (-B + Math.sqrt(Delta)) / (2.0 * A);
        const M2_2 = (-B - Math.sqrt(Delta)) / (2.0 * A);
        if (M2_1 > 0) roots.push(Math.sqrt(M2_1));
        if (M2_2 > 0) roots.push(Math.sqrt(M2_2));
      }
    }

    if (roots.length === 0) return 1.0;
    if (subsonic) {
      const valid = roots.filter(r => r <= 1.0 + 1e-6);
      return valid.length > 0 ? Math.min(...valid) : Math.min(...roots);
    } else {
      const valid = roots.filter(r => r >= 1.0 - 1e-6);
      return valid.length > 0 ? Math.max(...valid) : Math.max(...roots);
    }
  }
};


/**
 * Normal Shock Relations (from normal_shock.py)
 */
export const NormalShock = {
    machPostShock: (M1, gamma) => {
        const gm1 = gamma - 1.0;
        const gp1 = gamma + 1.0;
        const num = 1.0 + (gm1 / 2.0) * Math.pow(M1, 2);
        const den = gamma * Math.pow(M1, 2) - (gm1 / 2.0);
        return Math.sqrt(num / den);
    },
    
    pressureRatio: (M1, gamma) => {
        return 1.0 + (2.0 * gamma / (gamma + 1.0)) * (Math.pow(M1, 2) - 1.0);
    },
    
    temperatureRatio: (M1, gamma) => {
        const gp1 = gamma + 1.0;
        const gm1 = gamma - 1.0;
        const term1 = (1.0 + (2.0 * gamma / gp1) * (Math.pow(M1, 2) - 1.0));
        const term2 = (2.0 + gm1 * Math.pow(M1, 2)) / (gp1 * Math.pow(M1, 2));
        return term1 * term2;
    },
    
    stagnationPressureRatio: (M1, gamma) => {
        const gp1 = gamma + 1.0;
        const gm1 = gamma - 1.0;
        const term1 = Math.pow((gp1 * Math.pow(M1, 2) / 2.0) / (1.0 + gm1 / 2.0 * Math.pow(M1, 2)), gamma / gm1);
        const term2 = Math.pow((gp1 / (2.0 * gamma * Math.pow(M1, 2) - gm1)), 1.0 / gm1);
        return term1 * term2;
    }
};

/**
 * Main Iterative Solver (Ported from iterative_solver.py)
 */
export const Solver = {
  evaluateComponent: (comp, M_in, P0_in, T0_in, gas, forceSupersonic = false) => {
    const out = { M_in, P0_in, T0_in, chokedInside: false, type: comp.type };

    if (comp.type === "convergent") {
      const A_in = gas.areaFromDiameter(comp.params.d_in);
      const A_out = gas.areaFromDiameter(comp.params.d_out);
      const A_star = A_in / Isentropic.areaMachRatio(Math.max(M_in, 1e-12), gas.gamma);
      const A_out_ratio = A_out / Math.max(A_star, 1e-18);

      if (A_out_ratio < 1.0 - 1e-10) throw new Error("Convergent duct choked.");

      out.M_out = Isentropic.machFromAreaRatio(Math.max(A_out_ratio, 1.0), gas.gamma, true);
      out.P0_out = P0_in;
      out.T0_out = T0_in;
      out.A_in = A_in;
      out.A_out = A_out;

    } else if (comp.type === "divergent") {
      const A_in = gas.areaFromDiameter(comp.params.d_in);
      const A_out = gas.areaFromDiameter(comp.params.d_out);
      const A_star = A_in / Isentropic.areaMachRatio(Math.max(M_in, 1e-12), gas.gamma);
      const A_out_ratio = A_out / Math.max(A_star, 1e-18);

      let subsonic = !(forceSupersonic || M_in > 1.0);
      out.M_out = Isentropic.machFromAreaRatio(A_out_ratio, gas.gamma, subsonic);
      out.P0_out = P0_in;
      out.T0_out = T0_in;
      out.A_in = A_in;
      out.A_out = A_out;

    } else if (comp.type === "fanno") {
      const fLD = (4.0 * comp.params.f * comp.params.length) / comp.params.d_h;
      const fLstar_in = Fanno.parameter(M_in, gas.gamma);
      const fLstar_out = fLstar_in - fLD;

      if (fLstar_out < -1e-9) throw new Error("Fanno duct choked.");

      const isSubsonic = M_in < 1.0;
      const M_out = Fanno.machFromParameter(Math.max(fLstar_out, 0.0), gas.gamma, isSubsonic);
      const P0_ratio = Fanno.totalPressureRatio(M_out, gas.gamma) / Fanno.totalPressureRatio(M_in, gas.gamma);

      out.M_out = M_out;
      out.P0_out = P0_in * P0_ratio;
      out.T0_out = T0_in;
      out.A_in = gas.areaFromDiameter(comp.params.d_h);
      out.A_out = out.A_in;

    } else if (comp.type === "rayleigh") {
      const T0_out = T0_in + comp.params.q / gas.cp;
      if (T0_out <= 0) throw new Error("Heat removal too large.");

      const t0_ratio_in = Rayleigh.totalTemperatureRatio(M_in, gas.gamma);
      const T0_star = T0_in / Math.max(t0_ratio_in, 1e-12);
      const T0_out_ratio = T0_out / T0_star;

      if (T0_out_ratio > 1.0 + 1e-9) throw new Error("Rayleigh duct choked.");

      const isSubsonic = M_in < 1.0;
      const M_out = Rayleigh.machFromT0Ratio(Math.min(T0_out_ratio, 1.0), gas.gamma, isSubsonic);
      const P0_ratio = Rayleigh.totalPressureRatio(M_out, gas.gamma) / Rayleigh.totalPressureRatio(M_in, gas.gamma);

      out.M_out = M_out;
      out.P0_out = P0_in * P0_ratio;
      out.T0_out = T0_out;
      out.A_in = gas.areaFromDiameter(comp.params.d_h);
      out.A_out = out.A_in;

    } else if (comp.type === "normal_shock") {
        if (M_in < 1.0) throw new Error("Normal shock in subsonic flow.");
        out.M_out = NormalShock.machPostShock(M_in, gas.gamma);
        out.P0_out = P0_in * NormalShock.stagnationPressureRatio(M_in, gas.gamma);
        out.T0_out = T0_in;
        out.A_in = 1.0;
        out.A_out = 1.0;
    }

    out.P_out = out.P0_out * Isentropic.pressureRatio(out.M_out, gas.gamma);
    out.T_out = out.T0_out * Isentropic.temperatureRatio(out.M_out, gas.gamma);
    return out;
  },

  evaluatePipeline: (components, M_in, P0_in, T0_in, gas, forceSupersonicDivergent = false) => {
    let results = [];
    let curM = M_in;
    let curP0 = P0_in;
    let curT0 = T0_in;
    let hasShocked = false;

    for (const comp of components) {
      if (comp.type === "normal_shock") hasShocked = true;
      let forceSup = forceSupersonicDivergent && comp.type === "divergent" && curM > 0.98;
      
      const res = Solver.evaluateComponent(comp, curM, curP0, curT0, gas, forceSup);
      results.push(res);
      curM = Math.max(res.M_out, 1e-12);
      curP0 = res.P0_out;
      curT0 = res.T0_out;
    }
    return results;
  },

  solveFullPipeline: (components, P0_in, T0_in, P_amb, gas) => {
    let warnings = [];
    
    if (P_amb >= P0_in - 1e-3) {
      warnings.push("No pressure gradient.");
      return { success: true, results: components.map(c => ({ M_in: 0, M_out: 0, P0_in, P0_out: P0_in, T0_in, T0_out: T0_in, P_out: P0_in, T_out: T0_in })), warnings, components };
    }

    // 1. Find choked inlet Mach (bisection)
    let M_lo = 1e-6, M_hi = 1.0;
    for (let i = 0; i < 60; i++) {
      let mid = (M_lo + M_hi) / 2;
      try { Solver.evaluatePipeline(components, mid, P0_in, T0_in, gas); M_lo = mid; } 
      catch (e) { M_hi = mid; }
    }
    const M_in_choked = M_lo;

    // 2. Evaluate at choked M_in (fully subsonic)
    const res_choked_sub = Solver.evaluatePipeline(components, M_in_choked, P0_in, T0_in, gas, false);
    const P_exit_choked_sub = res_choked_sub[res_choked_sub.length - 1].P_out;

    // CASE A: FULLY SUBSONIC
    if (P_amb >= P_exit_choked_sub - 1e-3) {
      const obj_sub = (M) => {
        try {
          const res = Solver.evaluatePipeline(components, M, P0_in, T0_in, gas, false);
          return res[res.length - 1].P_out - P_amb;
        } catch (e) { return -1; }
      };
      
      let low = 1e-8, high = M_in_choked;
      for (let i = 0; i < 60; i++) {
        let mid = (low + high) / 2;
        if (obj_sub(mid) > 0) low = mid; else high = mid;
      }
      return { success: true, results: Solver.evaluatePipeline(components, low, P0_in, T0_in, gas, false), warnings: [], components };
    }

    // CASE B: CHOKED FLOW
    warnings.push("Flow is choked.");

    // B1: Try fully supersonic branch
    let res_choked_sup;
    try {
      res_choked_sup = Solver.evaluatePipeline(components, M_in_choked, P0_in, T0_in, gas, true);
    } catch (e) {
      // Supersonic branch chokes thermally or due to friction
      warnings.push("Complex choking detected. Falling back to subsonic branch.");
      return { success: true, results: res_choked_sub, warnings, components };
    }

    const M_exit_sup = res_choked_sup[res_choked_sup.length - 1].M_out;
    const P_exit_sup = res_choked_sup[res_choked_sup.length - 1].P_out;
    const P_normal_shock_exit = M_exit_sup > 1.0 ? P_exit_sup * NormalShock.pressureRatio(M_exit_sup, gas.gamma) : P_exit_sup;

    // Underexpanded / Overexpanded (Oblique)
    if (P_amb <= P_normal_shock_exit + 1e-3) {
      if (P_amb <= P_exit_sup) warnings.push("Flow is underexpanded.");
      else warnings.push("Flow is overexpanded (oblique shocks outside).");
      return { success: true, results: res_choked_sup, warnings, components };
    }

    // B3: NORMAL SHOCK INSIDE
    warnings.push("Normal shock detected inside.");

    // Function to split pipeline and evaluate with shock at x_shock
    const splitAndEvaluate = (x_shock) => {
      const splitComps = Solver.splitPipelineAtX(components, x_shock);
      return Solver.evaluatePipeline(splitComps, M_in_choked, P0_in, T0_in, gas, true);
    };

    const obj_shock = (x) => {
      try {
        const res = splitAndEvaluate(x);
        return res[res.length - 1].P_out - P_amb;
      } catch (e) { return -1e9; }
    };

    // Find shock location (search components from exit to inlet)
    let totalL = components.reduce((sum, c) => sum + (c.params.length || 0), 0);
    let curX = totalL;
    
    for (let i = components.length - 1; i >= 0; i--) {
      const comp = components[i];
      const L = comp.params.length || 0;
      const x_low = curX - L + 1e-6;
      const x_high = curX - 1e-6;

      if (comp.type === "divergent" || comp.type === "fanno" || comp.type === "rayleigh") {
          try {
              const val_low = obj_shock(x_low);
              const val_high = obj_shock(x_high);
              if (val_low * val_high <= 0) {
                  let low = x_low, high = x_high;
                  for (let j = 0; j < 50; j++) {
                      let mid = (low + high) / 2;
                      if (obj_shock(mid) < 0) high = mid; else low = mid;
                  }
                  const finalComps = Solver.splitPipelineAtX(components, low);
                  return { success: true, results: splitAndEvaluate(low), warnings, components: finalComps };
              }
          } catch (e) {}
      }
      curX -= L;
    }

    return { success: true, results: res_choked_sup, warnings, components };
  },

  splitPipelineAtX: (components, x_shock) => {
    let newComps = [];
    let curX = 0;
    for (const comp of components) {
      const L = comp.params.length || 0;
      if (curX <= x_shock && x_shock < curX + L && comp.type !== "normal_shock") {
        const dx = x_shock - curX;
        if (dx > 1e-6) {
          const c1 = { ...comp, params: { ...comp.params, length: dx } };
          if (comp.type === "convergent" || comp.type === "divergent") {
            c1.params.d_out = comp.params.d_in + (comp.params.d_out - comp.params.d_in) * (dx / L);
          }
          newComps.push(c1);
        }
        newComps.push({ type: "normal_shock", params: { length: 0 } });
        if (L - dx > 1e-6) {
          const c2 = { ...comp, params: { ...comp.params, length: L - dx } };
          if (comp.type === "convergent" || comp.type === "divergent") {
            c2.params.d_in = comp.params.d_in + (comp.params.d_out - comp.params.d_in) * (dx / L);
          }
          newComps.push(c2);
        }
      } else {
        newComps.push({ ...comp });
      }
      curX += L;
    }
    return newComps;
  },

  generatePlotData: (components, results, gas, numPoints = 200) => {
    const data = {
      x: [], mach: [], pressure: [], pressure_total: [],
      temperature: [], temperature_total: [], mass_flow: []
    };
    const boundaries = [0];
    const labels = [];
    let currentX = 0;

    // Influence Coefficients (from influence_solver.py)
    const getCoeffs = (M2, k) => {
      let denom = 1.0 - M2;
      if (Math.abs(denom) < 1e-8) denom = 1e-8 * Math.sign(denom);
      return {
        M: {
          A: -(2 * (1 + (k - 1) / 2 * M2)) / denom,
          Q: (1 + k * M2) / denom,
          f: (k * M2 * (1 + (k - 1) / 2 * M2)) / denom,
          w: (2 * (1 + k * M2) * (1 + (k - 1) / 2 * M2)) / denom
        },
        P: {
          A: (k * M2) / denom,
          Q: -k * M2 / denom,
          f: -(k * M2 * (1 + (k - 1) * M2)) / (2 * denom),
          w: -(2 * k * M2 * (1 + (k - 1) / 2 * M2)) / denom
        },
        T: {
          A: ((k - 1) * M2) / denom,
          Q: (1 - k * M2) / denom,
          f: -(k * (k - 1) * Math.pow(M2, 2)) / (2 * denom),
          w: -((k - 1) * M2 * (1 + k * M2)) / denom
        }
      };
    };

    const getForcings = (x_loc, comp, y, gas) => {
      const [M2, P, T, mdot] = y;
      const L = Math.max(comp.params.length || 1.0, 1e-6);
      const forcing = { A: 0, Q: 0, f: 0, w: 0 };

      if (comp.type === "convergent" || comp.type === "divergent") {
        const d_in = comp.params.d_in;
        const d_out = comp.params.d_out;
        const d_x = d_in + (d_out - d_in) * (x_loc / L);
        const dd_dx = (d_out - d_in) / L;
        forcing.A = (2.0 / d_x) * dd_dx;
      } else if (comp.type === "fanno") {
        forcing.f = (4.0 * comp.params.f) / comp.params.d_h;
      } else if (comp.type === "rayleigh") {
        forcing.Q = (comp.params.q / L) / (gas.cp * T);
      } else if (comp.type === "solid_grain") {
        const rho_b = comp.params.rho_b || 1800;
        const A_b = comp.params.A_b || 0.01;
        const a_c = comp.params.a_coeff || 0.02;
        const n = comp.params.n || 0.5;
        const T_b = comp.params.T_b || 3000;
        
        const mdot_gen_dx = (rho_b * A_b * a_c * Math.pow(Math.max(P, 1e4) / 1e6, n)) / L;
        forcing.w = mdot_gen_dx / Math.max(mdot, 1e-10);
        
        const T0 = T * (1 + (gas.gamma - 1) / 2 * M2);
        forcing.Q = (mdot_gen_dx / Math.max(mdot, 1e-10)) * (gas.cp * (T_b - T0)) / (gas.cp * T);
      }
      return forcing;
    };

    const deriv = (x_loc, y, comp, gas) => {
      const [M2, P, T, mdot] = y;
      const coeffs = getCoeffs(M2, gas.gamma);
      const f = getForcings(x_loc, comp, y, gas);

      const dm2_dx = M2 * (coeffs.M.A * f.A + coeffs.M.Q * f.Q + coeffs.M.f * f.f + coeffs.M.w * f.w);
      const dp_dx = P * (coeffs.P.A * f.A + coeffs.P.Q * f.Q + coeffs.P.f * f.f + coeffs.P.w * f.w);
      const dt_dx = T * (coeffs.T.A * f.A + coeffs.T.Q * f.Q + coeffs.T.f * f.f + coeffs.T.w * f.w);
      const dmdot_dx = mdot * f.w;

      return [dm2_dx, dp_dx, dt_dx, dmdot_dx];
    };

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const res = results[i];
      const L = comp.params.length || 0;
      labels.push(comp.type.toUpperCase());

      if (L === 0) {
        // Discontinuity (Shock)
        data.x.push(currentX);
        data.mach.push(res.M_out);
        data.pressure.push(res.P_out);
        data.pressure_total.push(res.P0_out);
        data.temperature.push(res.T_out);
        data.temperature_total.push(res.T0_out);
        data.mass_flow.push(data.mass_flow[data.mass_flow.length - 1] || 0);
        boundaries.push(currentX);
        continue;
      }

      // Initial state for this component
      let M2_init = Math.pow(res.M_in, 2);
      let T_init = res.T0_in * Isentropic.temperatureRatio(res.M_in, gas.gamma);
      let P_init = res.P0_in * Isentropic.pressureRatio(res.M_in, gas.gamma);
      
      let A_init;
      if (comp.type === "convergent" || comp.type === "divergent") A_init = gas.areaFromDiameter(comp.params.d_in);
      else if (comp.type === "fanno" || comp.type === "rayleigh") A_init = gas.areaFromDiameter(comp.params.d_h);
      else A_init = 0.01; // Fallback

      const A_star = A_init / Isentropic.areaMachRatio(res.M_in, gas.gamma);
      let mdot_init = gas.density(P_init, T_init) * (res.M_in * gas.speedOfSound(T_init)) * A_init;

      let y = [M2_init, P_init, T_init, mdot_init];
      const stepSize = L / (numPoints - 1);

      for (let j = 0; j < numPoints; j++) {
        const x_rel = j * stepSize;
        
        // Record current state
        const M_curr = Math.sqrt(Math.max(y[0], 0));
        const T0_curr = y[2] / Isentropic.temperatureRatio(M_curr, gas.gamma);
        const P0_curr = y[1] / Isentropic.pressureRatio(M_curr, gas.gamma);

        data.x.push(currentX + x_rel);
        data.mach.push(M_curr);
        data.pressure.push(y[1]);
        data.pressure_total.push(P0_curr);
        data.temperature.push(y[2]);
        data.temperature_total.push(T0_curr);
        data.mass_flow.push(y[3]);

        // RK4 Step
        const k1 = deriv(x_rel, y, comp, gas);
        const k2 = deriv(x_rel + stepSize / 2, y.map((v, idx) => v + (stepSize / 2) * k1[idx]), comp, gas);
        const k3 = deriv(x_rel + stepSize / 2, y.map((v, idx) => v + (stepSize / 2) * k2[idx]), comp, gas);
        const k4 = deriv(x_rel + stepSize, y.map((v, idx) => v + stepSize * k3[idx]), comp, gas);

        y = y.map((v, idx) => v + (stepSize / 6) * (k1[idx] + 2 * k2[idx] + 2 * k3[idx] + k4[idx]));
      }

      currentX += L;
      boundaries.push(currentX);
    }
    return { data, boundaries, labels };
  },

  computeSummary: (config, components, data, gas) => {
    const lastIdx = data.x.length - 1;
    const P_e = data.pressure[lastIdx];
    const T_e = data.temperature[lastIdx];
    const M_e = data.mach[lastIdx];
    const mdot = data.mass_flow[lastIdx];
    
    const a_e = Math.sqrt(gas.gamma * gas.R * Math.max(0, T_e));
    const V_e = M_e * a_e;
    
    // Find exit area
    let A_e = 1.0;
    const lastComp = components[components.length - 1];
    if (lastComp.type === "convergent" || lastComp.type === "divergent") A_e = gas.areaFromDiameter(lastComp.params.d_out);
    else if (lastComp.type === "fanno" || lastComp.type === "rayleigh") A_e = gas.areaFromDiameter(lastComp.params.d_h);

    const thrust = mdot * V_e + (P_e - config.P_amb) * A_e;

    return {
      "Thrust": { value: thrust, unit: "N" },
      "Exit Velocity": { value: V_e, unit: "m/s" },
      "Exit Static P.": { value: P_e, unit: "Pa" },
      "Mass Flow": { value: mdot, unit: "kg/s" }
    };
  }
};



