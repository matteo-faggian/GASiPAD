/**
 * GASPAD Core Gas Dynamics Solver (JavaScript Port) - High Fidelity Version
 */

export const PI = Math.PI;

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
    let low = subsonic ? 1e-12 : 1.0, high = subsonic ? 1.0 : 40.0;
    for (let i = 0; i < 80; i++) {
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
    return (1.0 - M * M) / (gamma * M * M) + (gp1 / (2.0 * gamma)) * Math.log((gp1 * M * M) / (2.0 + (gamma - 1) * M * M));
  },
  totalPressureRatio: (M, gamma) => (1.0 / M) * Math.pow((2.0 / (gamma + 1)) * (1.0 + (gamma - 1) / 2 * M * M), (gamma + 1) / (2 * (gamma - 1))),
  machFromParameter: (fLstar_D, gamma, subsonic = true) => {
    const f = (M) => Fanno.parameter(M, gamma) - fLstar_D;
    let low = subsonic ? 1e-12 : 1.0, high = subsonic ? 1.0 : 40.0;
    for (let i = 0; i < 80; i++) {
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
    let low = subsonic ? 1e-12 : 1.0, high = subsonic ? 1.0 : 40.0;
    for (let i = 0; i < 80; i++) {
      let mid = (low + high) / 2;
      if (f(mid) > 0) subsonic ? (high = mid) : (low = mid); else subsonic ? (low = mid) : (high = mid);
    }
    return (low + high) / 2;
  }
};

export const Solver = {
  evaluateComponent: (comp, M_in, P0_in, T0_in, gas, forceSup = false) => {
    const out = { M_in, P0_in, T0_in, type: comp.type };
    const k = gas.gamma;
    if (comp.type === "convergent") {
      const A_in = gas.areaFromDiameter(comp.params.d_in);
      const A_out = gas.areaFromDiameter(comp.params.d_out);
      const A_star = A_in / Isentropic.areaMachRatio(Math.max(M_in, 1e-12), k);
      out.M_out = Isentropic.machFromAreaRatio(A_out / A_star, k, true);
      out.P0_out = P0_in; out.T0_out = T0_in;
    } else if (comp.type === "divergent") {
      const A_in = gas.areaFromDiameter(comp.params.d_in);
      const A_out = gas.areaFromDiameter(comp.params.d_out);
      const A_star = A_in / Isentropic.areaMachRatio(Math.max(M_in, 1e-12), k);
      out.M_out = Isentropic.machFromAreaRatio(A_out / A_star, k, !(forceSup || M_in > 1.0));
      out.P0_out = P0_in; out.T0_out = T0_in;
    } else if (comp.type === "fanno") {
      const fLD = (4 * comp.params.f * comp.params.length) / comp.params.d_h;
      const fLstar_out = Fanno.parameter(M_in, k) - fLD;
      out.M_out = Fanno.machFromParameter(Math.max(0, fLstar_out), k, M_in < 1.0);
      out.P0_out = P0_in * (Fanno.totalPressureRatio(out.M_out, k) / Fanno.totalPressureRatio(M_in, k));
      out.T0_out = T0_in;
    } else if (comp.type === "rayleigh") {
      const T0_out = T0_in + comp.params.q / gas.cp;
      const T0_ratio_out = (T0_out / T0_in) * Rayleigh.totalTemperatureRatio(M_in, k);
      out.M_out = Rayleigh.machFromT0Ratio(Math.min(1.0, T0_ratio_out), k, M_in < 1.0);
      out.P0_out = P0_in * (Rayleigh.totalPressureRatio(out.M_out, k) / Rayleigh.totalPressureRatio(M_in, k));
      out.T0_out = T0_out;
    } else if (comp.type === "normal_shock") {
      out.M_out = NormalShock.machPostShock(M_in, k);
      out.P0_out = P0_in * NormalShock.stagnationPressureRatio(M_in, k);
      out.T0_out = T0_in;
    }
    out.P_out = out.P0_out * Isentropic.pressureRatio(out.M_out, k);
    out.T_out = out.T0_out * Isentropic.temperatureRatio(out.M_out, k);
    return out;
  },

  evaluatePipeline: (components, M_in, P0_in, T0_in, gas, forceSup = false) => {
    let results = [], curM = M_in, curP0 = P0_in, curT0 = T0_in;
    for (const comp of components) {
      const res = Solver.evaluateComponent(comp, curM, curP0, curT0, gas, forceSup && curM > 0.99);
      results.push(res);
      curM = res.M_out; curP0 = res.P0_out; curT0 = res.T0_out;
    }
    return results;
  },

  solveFullPipeline: (components, P0_in, T0_in, P_amb, gas) => {
    let warnings = [], k = gas.gamma;
    let M_lo = 1e-6, M_hi = 1.0;
    for (let i = 0; i < 40; i++) {
      let mid = (M_lo + M_hi) / 2;
      try { Solver.evaluatePipeline(components, mid, P0_in, T0_in, gas); M_lo = mid; } catch (e) { M_hi = mid; }
    }
    const M_choked = M_lo;
    const res_sub = Solver.evaluatePipeline(components, M_choked, P0_in, T0_in, gas, false);
    if (P_amb >= res_sub[res_sub.length-1].P_out) {
      const obj = (M) => Solver.evaluatePipeline(components, M, P0_in, T0_in, gas, false)[components.length-1].P_out - P_amb;
      let lo = 1e-7, hi = M_choked;
      for (let i = 0; i < 40; i++) {
        let mid = (lo + hi) / 2;
        if (obj(mid) > 0) lo = mid; else hi = mid;
      }
      return { success: true, results: Solver.evaluatePipeline(components, lo, P0_in, T0_in, gas, false), warnings, components };
    }
    warnings.push("Flow is choked.");
    let res_sup;
    try { res_sup = Solver.evaluatePipeline(components, M_choked, P0_in, T0_in, gas, true); }
    catch (e) { return { success: true, results: res_sub, warnings, components }; }
    const last = res_sup[res_sup.length-1];
    const P_shock_exit = last.M_out > 1.0 ? last.P_out * NormalShock.pressureRatio(last.M_out, k) : last.P_out;
    if (P_amb <= P_shock_exit) return { success: true, results: res_sup, warnings, components };
    warnings.push("Normal shock detected inside.");
    let totalL = components.reduce((s, c) => s + (c.params.length || 0), 0);
    const obj_shock = (x) => {
      const split = Solver.splitPipelineAtX(components, x);
      const res = Solver.evaluatePipeline(split, M_choked, P0_in, T0_in, gas, true);
      return res[res.length-1].P_out - P_amb;
    };
    let loX = 0, hiX = totalL;
    for (let i = 0; i < 30; i++) {
      let mid = (loX + hiX) / 2;
      if (obj_shock(mid) < 0) hiX = mid; else loX = mid;
    }
    const finalSplit = Solver.splitPipelineAtX(components, loX);
    return { success: true, results: Solver.evaluatePipeline(finalSplit, M_choked, P0_in, T0_in, gas, true), warnings, components: finalSplit };
  },

  splitPipelineAtX: (components, x_shock) => {
    let newComps = [], curX = 0;
    for (const comp of components) {
      const L = comp.params.length || 0;
      if (curX <= x_shock && x_shock < curX + L && L > 0) {
        const dx = x_shock - curX;
        const c1 = { ...comp, params: { ...comp.params, length: dx } };
        if (comp.type === "convergent" || comp.type === "divergent") c1.params.d_out = comp.params.d_in + (comp.params.d_out - comp.params.d_in) * (dx / L);
        newComps.push(c1); newComps.push({ type: "normal_shock", params: { length: 0 } });
        const c2 = { ...comp, params: { ...comp.params, length: L - dx } };
        if (comp.type === "convergent" || comp.type === "divergent") c2.params.d_in = comp.params.d_in + (comp.params.d_out - comp.params.d_in) * (dx / L);
        newComps.push(c2);
      } else { newComps.push({ ...comp }); }
      curX += L;
    }
    return newComps;
  },

  generatePlotData: (components, results, gas, numPoints = 150) => {
    const data = { x: [], mach: [], pressure: [], pressure_total: [], temperature: [], temperature_total: [], mass_flow: [] };
    let curX = 0, boundaries = [0], labels = [], k = gas.gamma;
    for (let i = 0; i < components.length; i++) {
      const comp = components[i], res = results[i], L = comp.params.length || 0;
      labels.push(comp.type.toUpperCase());
      if (L === 0) {
        data.x.push(curX); data.mach.push(res.M_out); data.pressure.push(res.P_out); data.pressure_total.push(res.P0_out);
        data.temperature.push(res.T_out); data.temperature_total.push(res.T0_out); data.mass_flow.push(data.mass_flow[data.mass_flow.length-1] || 0);
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
          M = Isentropic.machFromAreaRatio(A_x / A_star, k, res.M_out <= 1.0);
        } else {
          M = res.M_in + (res.M_out - res.M_in) * frac;
          P0 = res.P0_in + (res.P0_out - res.P0_in) * frac;
          T0 = res.T0_in + (res.T0_out - res.T0_in) * frac;
          A_x = gas.areaFromDiameter(comp.params.d_h);
        }
        const T = T0 * Isentropic.temperatureRatio(M, k);
        const P = P0 * Isentropic.pressureRatio(M, k);
        const rho = gas.density(P, T);
        const V = M * gas.speedOfSound(T);
        data.x.push(curX + x_rel); data.mach.push(M); data.pressure.push(P); data.pressure_total.push(P0);
        data.temperature.push(T); data.temperature_total.push(T0); data.mass_flow.push(rho * V * A_x);
      }
      curX += L; boundaries.push(curX);
    }
    return { data, boundaries, labels };
  },

  computeSummary: (config, components, data, gas) => {
    const last = data.x.length - 1, P_e = data.pressure[last], M_e = data.mach[last], T_e = data.temperature[last];
    const mdot = data.mass_flow[last], V_e = M_e * gas.speedOfSound(T_e);
    let A_e = 0.01; const lc = components[components.length-1];
    if (lc.type === "convergent" || lc.type === "divergent") A_e = gas.areaFromDiameter(lc.params.d_out);
    else if (lc.params.d_h) A_e = gas.areaFromDiameter(lc.params.d_h);
    return {
      "Thrust": { value: mdot * V_e + (P_e - config.P_amb) * A_e, unit: "N" },
      "Mass Flow": { value: mdot, unit: "kg/s" },
      "Exit Velocity": { value: V_e, unit: "m/s" },
      "Exit Mach": { value: M_e, unit: "-" }
    };
  }
};
