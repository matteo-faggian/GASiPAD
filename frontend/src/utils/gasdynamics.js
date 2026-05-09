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
    if (P_amb >= P0_in - 1e-3) {
      return { success: true, results: components.map(c => ({ M_in: 0, M_out: 0, P_out: P0_in, T_out: T0_in })), warnings: ["No pressure gradient."] };
    }

    // Find choked inlet Mach (bisection)
    let M_lo = 1e-6, M_hi = 1.0;
    for (let i = 0; i < 50; i++) {
      let mid = (M_lo + M_hi) / 2;
      try { Solver.evaluatePipeline(components, mid, P0_in, T0_in, gas); M_lo = mid; } 
      catch (e) { M_hi = mid; }
    }
    const M_in_choked = M_lo;

    // Shooting Method for Subsonic
    const obj = (M) => {
      try {
        const res = Solver.evaluatePipeline(components, M, P0_in, T0_in, gas, false);
        return res[res.length - 1].P_out - P_amb;
      } catch (e) { return -1; }
    };

    const res_max_sub = Solver.evaluatePipeline(components, M_in_choked, P0_in, T0_in, gas, false);
    const P_exit_max_sub = res_max_sub[res_max_sub.length - 1].P_out;

    if (P_amb >= P_exit_max_sub) {
      let low = 1e-8, high = M_in_choked;
      for (let i = 0; i < 50; i++) {
        let mid = (low + high) / 2;
        if (obj(mid) > 0) low = mid; else high = mid;
      }
      return { success: true, results: Solver.evaluatePipeline(components, low, P0_in, T0_in, gas, false), warnings: [] };
    }

    // Choked Flow Logic (Basic implementation for iPad)
    // In a real scenario, we'd add the shock placement here too.
    return { success: true, results: res_max_sub, warnings: ["Flow is choked."] };
  },

  generatePlotData: (components, results, gas, numPoints = 50) => {
    const data = {
      x: [], mach: [], pressure: [], pressure_total: [],
      temperature: [], temperature_total: [], mass_flow: []
    };
    const boundaries = [0];
    const labels = [];
    let currentX = 0;

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const res = results[i];
      const L = comp.params.length || 0;
      labels.push(comp.type.toUpperCase());

      const x_vals = Array.from({ length: numPoints }, (_, idx) => currentX + (L * idx) / (numPoints - 1));

      for (const x of x_vals) {
        const dx = x - currentX;
        let M, P0, T0, A_x;

        if (dx === 0) {
          M = res.M_in; P0 = res.P0_in; T0 = res.T0_in; A_x = res.A_in;
        } else if (dx === L && L > 0) {
          M = res.M_out; P0 = res.P0_out; T0 = res.T0_out; A_x = res.A_out;
        } else {
          // Linear interpolation for intermediate points in simple ducts
          const frac = dx / L;
          if (comp.type === "fanno") {
            const f_res = Solver.evaluateComponent({ type: "fanno", params: { ...comp.params, length: dx } }, res.M_in, res.P0_in, res.T0_in, gas);
            M = f_res.M_out; P0 = f_res.P0_out; T0 = f_res.T0_out;
          } else if (comp.type === "rayleigh") {
            const r_res = Solver.evaluateComponent({ type: "rayleigh", params: { ...comp.params, q: comp.params.q * frac } }, res.M_in, res.P0_in, res.T0_in, gas);
            M = r_res.M_out; P0 = r_res.P0_out; T0 = r_res.T0_out;
          } else if (comp.type === "convergent" || comp.type === "divergent") {
            const d_x = comp.params.d_in + (comp.params.d_out - comp.params.d_in) * frac;
            A_x = gas.areaFromDiameter(d_x);
            const A_in = gas.areaFromDiameter(comp.params.d_in);
            const A_star = A_in / Isentropic.areaMachRatio(res.M_in, gas.gamma);
            const A_ratio = A_x / A_star;
            const subsonic = !(M > 1.0 || (comp.type === "divergent" && res.M_out > 1.0));
            M = Isentropic.machFromAreaRatio(Math.max(A_ratio, 1.0), gas.gamma, subsonic);
            P0 = res.P0_in; T0 = res.T0_in;
          } else {
            M = res.M_in + (res.M_out - res.M_in) * frac;
            P0 = res.P0_in + (res.P0_out - res.P0_in) * frac;
            T0 = res.T0_in + (res.T0_out - res.T0_in) * frac;
          }
        }

        const stats = Isentropic.staticFromStagnation(M, P0, T0, gas.gamma, gas.R);
        data.x.push(x);
        data.mach.push(M);
        data.pressure.push(stats.P);
        data.pressure_total.push(P0);
        data.temperature.push(stats.T);
        data.temperature_total.push(T0);
        
        const mdot = stats.rho * stats.V * (A_x || 1.0);
        data.mass_flow.push(mdot);
      }
      currentX += L;
      boundaries.push(currentX);
    }
    return { data, boundaries, labels };
  },

  computeSummary: (config, components, data) => {
    const lastIdx = data.x.length - 1;
    const P_e = data.pressure[lastIdx];
    const T_e = data.temperature[lastIdx];
    const M_e = data.mach[lastIdx];
    const mdot = data.mass_flow[lastIdx];
    
    const a_e = Math.sqrt(config.gamma * config.R * Math.max(0, T_e));
    const V_e = M_e * a_e;
    
    // Find exit area
    let A_e = 1.0;
    const lastComp = components[components.length - 1];
    if (lastComp.type === "convergent" || lastComp.type === "divergent") A_e = (new GasProperties()).areaFromDiameter(lastComp.params.d_out);
    else if (lastComp.type === "fanno" || lastComp.type === "rayleigh") A_e = (new GasProperties()).areaFromDiameter(lastComp.params.d_h);

    const thrust = mdot * V_e + (P_e - config.P_amb) * A_e;

    return {
      "Thrust": { value: thrust, unit: "N" },
      "Exit Velocity": { value: V_e, unit: "m/s" },
      "Exit Static P.": { value: P_e, unit: "Pa" },
      "Mass Flow": { value: mdot, unit: "kg/s" }
    };
  }
};


