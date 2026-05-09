/**
 * GASPAD Core Gas Dynamics Solver (JavaScript Port)
 * High-Fidelity Port from the Original Python Backend
 */

export const PI = Math.PI;

// ===========================================================================
// Gas Properties
// ===========================================================================
export class GasProperties {
  constructor(gamma = 1.4, R = 287.05) {
    this.gamma = gamma;
    this.R = R;
    this.cp = (gamma * R) / (gamma - 1);
    this.cv = R / (gamma - 1);
  }
  speedOfSound(T) { return Math.sqrt(this.gamma * this.R * Math.max(0, T)); }
  density(P, T) { return T < 1e-6 ? 0 : P / (this.R * T); }
  areaFromDiameter(d) { return (PI / 4) * Math.pow(d, 2); }
}

// ===========================================================================
// Physics Relations (1:1 with Python)
// ===========================================================================

export const Isentropic = {
  temperatureRatio: (M, gamma) => 1.0 / (1.0 + (gamma - 1.0) / 2.0 * M * M),
  pressureRatio: (M, gamma) => Math.pow(1.0 + (gamma - 1.0) / 2.0 * M * M, -gamma / (gamma - 1.0)),
  areaMachRatio: (M, gamma) => {
    if (M < 1e-12) return Infinity;
    const gp1 = gamma + 1.0;
    const gm1 = gamma - 1.0;
    return (1.0 / M) * Math.pow((2.0 / gp1) * (1.0 + (gm1 / 2.0) * M * M), gp1 / (2.0 * gm1));
  },
  machFromAreaRatio: (A_ratio, gamma, subsonic = true) => {
    const AR = Math.max(1.0, A_ratio);
    if (Math.abs(AR - 1.0) < 1e-10) return 1.0;
    const f = (M) => Isentropic.areaMachRatio(M, gamma) - AR;
    let low = subsonic ? 1e-12 : 1.0, high = subsonic ? 1.0 : 50.0;
    for (let i = 0; i < 100; i++) {
      let mid = (low + high) / 2;
      if (f(mid) > 0) subsonic ? (low = mid) : (high = mid);
      else subsonic ? (high = mid) : (low = mid);
    }
    return (low + high) / 2;
  }
};

export const NormalShock = {
  machPostShock: (M1, gamma) => Math.sqrt((1.0 + (gamma - 1) / 2 * M1 * M1) / (gamma * M1 * M1 - (gamma - 1) / 2)),
  pressureRatio: (M1, gamma) => 1.0 + (2.0 * gamma / (gamma + 1.0)) * (M1 * M1 - 1.0),
  stagnationPressureRatio: (M1, gamma) => {
    const gp1 = gamma + 1.0; const gm1 = gamma - 1.0;
    const term1 = Math.pow((gp1 * M1 * M1 / 2.0) / (1.0 + gm1 / 2.0 * M1 * M1), gamma / gm1);
    const term2 = Math.pow((gp1 / (2.0 * gamma * M1 * M1 - gm1)), 1.0 / gm1);
    return term1 * term2;
  }
};

export const Fanno = {
  parameter: (M, gamma) => {
    if (M < 1e-12) return Infinity;
    const gp1 = gamma + 1.0;
    const M2 = M * M;
    return (1.0 - M2) / (gamma * M2) + (gp1 / (2.0 * gamma)) * Math.log((gp1 * M2) / (2.0 + (gamma - 1) * M2));
  },
  totalPressureRatio: (M, gamma) => (1.0 / M) * Math.pow((2.0 / (gamma + 1)) * (1.0 + (gamma - 1) / 2 * M * M), (gamma + 1) / (2 * (gamma - 1))),
  machFromParameter: (fLstar_D, gamma, subsonic = true) => {
    const f = (M) => Fanno.parameter(M, gamma) - fLstar_D;
    let low = subsonic ? 1e-12 : 1.0, high = subsonic ? 1.0 : 100.0;
    for (let i = 0; i < 100; i++) {
      let mid = (low + high) / 2;
      if (f(mid) > 0) subsonic ? (low = mid) : (high = mid); else subsonic ? (high = mid) : (low = mid);
    }
    return (low + high) / 2;
  }
};

export const Rayleigh = {
  totalTemperatureRatio: (M, gamma) => {
    const M2 = M * M;
    return (2.0 * (gamma + 1) * M2) / Math.pow(1.0 + gamma * M2, 2) * (1.0 + (gamma - 1) / 2 * M2);
  },
  totalPressureRatio: (M, gamma) => ((gamma + 1) / (1.0 + gamma * M * M)) * Math.pow((2.0 / (gamma + 1)) * (1.0 + (gamma - 1) / 2 * M * M), gamma / (gamma - 1)),
  machFromT0Ratio: (T0_ratio, gamma, subsonic = true) => {
    const f = (M) => Rayleigh.totalTemperatureRatio(M, gamma) - T0_ratio;
    let low = subsonic ? 1e-12 : 1.0, high = subsonic ? 1.0 : 100.0;
    for (let i = 0; i < 100; i++) {
      let mid = (low + high) / 2;
      if (f(mid) > 0) subsonic ? (high = mid) : (low = mid); else subsonic ? (low = mid) : (high = mid);
    }
    return (low + high) / 2;
  }
};

// ===========================================================================
// Core Solver Engine
// ===========================================================================

export const Solver = {
  evaluateComponent: (comp, M_in, P0_in, T0_in, gas, forceSup = false) => {
    const out = { M_in, P0_in, T0_in, type: comp.type };
    const k = gas.gamma;

    if (comp.type === "convergent") {
      const A_in = gas.areaFromDiameter(comp.params.d_in);
      const A_out = gas.areaFromDiameter(comp.params.d_out);
      const A_star = A_in / Isentropic.areaMachRatio(Math.max(M_in, 1e-12), k);
      const A_out_ratio = A_out / Math.max(A_star, 1e-18);
      if (A_out_ratio < 1.0 - 1e-10) throw new Error("CHOKED");
      out.M_out = Isentropic.machFromAreaRatio(A_out_ratio, k, true);
      out.P0_out = P0_in; out.T0_out = T0_in;
    } 
    else if (comp.type === "divergent") {
      const A_in = gas.areaFromDiameter(comp.params.d_in);
      const A_out = gas.areaFromDiameter(comp.params.d_out);
      const A_star = A_in / Isentropic.areaMachRatio(Math.max(M_in, 1e-12), k);
      out.M_out = Isentropic.machFromAreaRatio(A_out / A_star, k, !(forceSup || M_in > 1.0));
      out.P0_out = P0_in; out.T0_out = T0_in;
    } 
    else if (comp.type === "fanno") {
      const fLD = (4 * comp.params.f * comp.params.length) / comp.params.d_h;
      const fLstar_in = Fanno.parameter(M_in, k);
      const fLstar_out = fLstar_in - fLD;
      if (fLstar_out < -1e-10) throw new Error("CHOKED");
      out.M_out = Fanno.machFromParameter(fLstar_out, k, M_in < 1.0);
      out.P0_out = P0_in * (Fanno.totalPressureRatio(out.M_out, k) / Fanno.totalPressureRatio(M_in, k));
      out.T0_out = T0_in;
    } 
    else if (comp.type === "rayleigh") {
      const T0_out = T0_in + comp.params.q / gas.cp;
      const t0_star_ratio_in = Rayleigh.totalTemperatureRatio(M_in, k);
      const T0_star = T0_in / Math.max(t0_star_ratio_in, 1e-12);
      const T0_out_ratio = T0_out / T0_star;
      if (T0_out_ratio > 1.0 + 1e-10) throw new Error("CHOKED");
      out.M_out = Rayleigh.machFromT0Ratio(T0_out_ratio, k, M_in < 1.0);
      out.P0_out = P0_in * (Rayleigh.totalPressureRatio(out.M_out, k) / Rayleigh.totalPressureRatio(M_in, k));
      out.T0_out = T0_out;
    } 
    else if (comp.type === "normal_shock") {
      out.M_out = NormalShock.machPostShock(M_in, k);
      out.P0_out = P0_in * NormalShock.stagnationPressureRatio(M_in, k);
      out.T0_out = T0_in;
    }
    else if (comp.type === "solid_grain") {
      const rho_b = comp.params.rho_b || 0, A_b = comp.params.A_b || 0, n = comp.params.n || 0, a_coeff = comp.params.a_coeff || 0;
      const P_ref = P0_in * Isentropic.pressureRatio(M_in, k);
      const grain_mdot = A_b * rho_b * a_coeff * Math.pow(P_ref / 1e6, n);
      out.M_out = M_in; out.P0_out = P0_in; out.T0_out = T0_in;
      out.grain_mdot = grain_mdot;
    }

    out.P_out = out.P0_out * Isentropic.pressureRatio(out.M_out, k);
    out.T_out = out.T0_out * Isentropic.temperatureRatio(out.M_out, k);
    return out;
  },

  evaluatePipeline: (components, M_in, P0_in, T0_in, gas, forceSup = false) => {
    let results = [], curM = M_in, curP0 = P0_in, curT0 = T0_in;
    for (const comp of components) {
      const res = Solver.evaluateComponent(comp, curM, curP0, curT0, gas, forceSup && curM > 0.98);
      results.push(res);
      curM = res.M_out; curP0 = res.P0_out; curT0 = res.T0_out;
    }
    return results;
  },

  solveFullPipeline: (components, P0_in, T0_in, P_amb, gas) => {
    let warnings = [], k = gas.gamma;
    
    // 1. Zero flow case
    if (P_amb >= P0_in - 1e-6) {
      warnings.push("Inlet and outlet pressures are equal - no flow.");
      return { success: true, results: components.map(() => ({ M_in: 0, M_out: 0, P0_in, P0_out: P0_in, T0_in, T0_out: T0_in, P_out: P0_in, T_out: T0_in })), warnings, components };
    }

    // 2. Find Choked Inlet Mach
    let M_lo = 1e-8, M_hi = 1.0;
    for (let i = 0; i < 60; i++) {
      let mid = (M_lo + M_hi) / 2;
      try { Solver.evaluatePipeline(components, mid, P0_in, T0_in, gas); M_lo = mid; } catch (e) { M_hi = mid; }
    }
    const M_choked = M_lo;
    const res_choked_sub = Solver.evaluatePipeline(components, M_choked, P0_in, T0_in, gas, false);
    const P_exit_choked_sub = res_choked_sub[res_choked_sub.length-1].P_out;

    // 3. CASE A: SUBSONIC
    if (P_amb >= P_exit_choked_sub) {
      const obj = (M) => Solver.evaluatePipeline(components, M, P0_in, T0_in, gas, false)[components.length-1].P_out - P_amb;
      let lo = 1e-8, hi = M_choked;
      for (let i = 0; i < 60; i++) {
        let mid = (lo + hi) / 2;
        if (obj(mid) > 0) lo = mid; else hi = mid;
      }
      return { success: true, results: Solver.evaluatePipeline(components, lo, P0_in, T0_in, gas, false), warnings, components };
    }

    // 4. CASE B: CHOKED
    warnings.push("Flow is choked.");
    let res_choked_sup;
    try { res_choked_sup = Solver.evaluatePipeline(components, M_choked, P0_in, T0_in, gas, true); }
    catch (e) { return { success: true, results: res_choked_sub, warnings, components }; }
    
    const last = res_choked_sup[res_choked_sup.length-1];
    const P_exit_sup = last.P_out;
    const P_exit_post_shock = last.M_out > 1.0 ? last.P_out * NormalShock.pressureRatio(last.M_out, k) : last.P_out;

    if (P_amb <= P_exit_sup) {
      warnings.push("Underexpanded / Ideally expanded flow.");
      return { success: true, results: res_choked_sup, warnings, components };
    }
    if (P_amb < P_exit_post_shock) {
      warnings.push("Overexpanded (Oblique shocks outside).");
      return { success: true, results: res_choked_sup, warnings, components };
    }

    // 5. CASE B3: SHOCK INSIDE
    warnings.push("Normal shock detected inside.");
    let totalL = components.reduce((s, c) => s + (c.params.length || 0), 0);
    const obj_shock = (x) => {
      const split = Solver.splitPipelineAtX(components, x);
      const res = Solver.evaluatePipeline(split, M_choked, P0_in, T0_in, gas, true);
      return res[res.length-1].P_out - P_amb;
    };

    // B3 Search: EXIT to THROAT
    let curX = totalL;
    for (let i = components.length - 1; i >= 0; i--) {
        const comp = components[i];
        const res = res_choked_sup[i];
        const L = comp.params.length || 0;
        if (L > 0 && res.M_out > 1.0) {
            let x_lo = curX - L + 1e-6, x_hi = curX - 1e-6;
            // Simple Bisection inside component
            for (let j = 0; j < 40; j++) {
                let x_mid = (x_lo + x_hi) / 2;
                if (obj_shock(x_mid) < 0) x_hi = x_mid; else x_lo = x_mid;
            }
            const finalSplit = Solver.splitPipelineAtX(components, x_lo);
            return { success: true, results: Solver.evaluatePipeline(finalSplit, M_choked, P0_in, T0_in, gas, true), warnings, components: finalSplit };
        }
        curX -= L;
    }

    return { success: true, results: res_choked_sup, warnings, components };
  },

  splitPipelineAtX: (components, x_shock) => {
    let newComps = [], curX = 0;
    for (const comp of components) {
      const L = comp.params.length || 0;
      if (curX <= x_shock && x_shock < curX + L && L > 0) {
        const dx = x_shock - curX;
        const c1 = { ...comp, params: { ...comp.params, length: dx } };
        if (comp.type === "convergent" || comp.type === "divergent") {
          c1.params.d_out = comp.params.d_in + (comp.params.d_out - comp.params.d_in) * (dx / L);
        }
        newComps.push(c1);
        newComps.push({ type: "normal_shock", params: { length: 0 } });
        const c2 = { ...comp, params: { ...comp.params, length: L - dx } };
        if (comp.type === "convergent" || comp.type === "divergent") {
          c2.params.d_in = c1.params.d_out;
        }
        newComps.push(c2);
      } else {
        newComps.push({ ...comp });
      }
      curX += L;
    }
    return newComps;
  },

  generatePlotData: (components, results, gas, numPoints = 150) => {
    const data = { x: [], mach: [], pressure: [], pressure_total: [], temperature: [], temperature_total: [], mass_flow: [] };
    let curX = 0, boundaries = [0], labels = [], k = gas.gamma;
    
    // Compute total mass flow from choked throat if available
    let mdot_global = 1.0;
    for(let res of results) if(Math.abs(res.M_out - 1.0) < 0.05) {
        // approx mdot at sonic point
        const A = gas.areaFromDiameter(res.A_out || 0.1); // this is area, typo in my previous version
    }

    for (let i = 0; i < components.length; i++) {
      const comp = components[i], res = results[i], L = comp.params.length || 0;
      labels.push(comp.type.toUpperCase());
      if (L === 0) {
        data.x.push(curX); data.mach.push(res.M_out); data.pressure.push(res.P_out);
        data.pressure_total.push(res.P0_out); data.temperature.push(res.T_out);
        data.temperature_total.push(res.T0_out); data.mass_flow.push(data.mass_flow[data.mass_flow.length-1] || 0);
        continue;
      }
      const step = L / (numPoints - 1);
      for (let j = 0; j < numPoints; j++) {
        const x_rel = j * step, frac = x_rel / L;
        let M, P0 = res.P0_in, T0 = res.T0_in, A_x;
        if (comp.type === "convergent" || comp.type === "divergent") {
          const d_x = comp.params.d_in + (comp.params.d_out - comp.params.d_in) * frac;
          A_x = gas.areaFromDiameter(d_x);
          const A_in = gas.areaFromDiameter(comp.params.d_in);
          const A_star = A_in / Isentropic.areaMachRatio(res.M_in, k);
          M = Isentropic.machFromAreaRatio(A_x / A_star, k, res.M_out <= 1.01);
        } else {
          M = res.M_in + (res.M_out - res.M_in) * frac;
          P0 = res.P0_in + (res.P0_out - res.P0_in) * frac;
          T0 = res.T0_in + (res.T0_out - res.T0_in) * frac;
          A_x = (comp.params.d_h) ? gas.areaFromDiameter(comp.params.d_h) : 1.0;
        }
        const T = T0 * Isentropic.temperatureRatio(M, k);
        const P = P0 * Isentropic.pressureRatio(M, k);
        data.x.push(curX + x_rel); data.mach.push(M); data.pressure.push(P); data.pressure_total.push(P0);
        data.temperature.push(T); data.temperature_total.push(T0);
        data.mass_flow.push(gas.density(P, T) * M * gas.speedOfSound(T) * A_x);
      }
      curX += L; boundaries.push(curX);
    }
    return { data, boundaries, labels };
  },

  computeSummary: (config, components, data, gas) => {
    const last = data.x.length - 1, P_e = data.pressure[last], M_e = data.mach[last], T_e = data.temperature[last], mdot = data.mass_flow[last];
    const V_e = M_e * gas.speedOfSound(T_e);
    let A_e = 0.01; const lc = components[components.length-1];
    if (lc.type === "convergent" || lc.type === "divergent") A_e = gas.areaFromDiameter(lc.params.d_out);
    return {
      "Thrust": { value: mdot * V_e + (P_e - config.P_amb) * A_e, unit: "N" },
      "Mass Flow": { value: mdot, unit: "kg/s" },
      "Exit Velocity": { value: V_e, unit: "m/s" }
    };
  }
};
