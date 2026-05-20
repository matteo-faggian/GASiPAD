/**
 * GASPAD Core Gas Dynamics Solver (JavaScript Port)
 * High-Fidelity Version with RK4 Spatial Integration and Influence Coefficients
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
    const gp1 = gamma + 1.0; const gm1 = gamma - 1.0;
    return (1.0 / M) * Math.pow((2.0 / gp1) * (1.0 + (gm1 / 2.0) * M * M), gp1 / (2.0 * gm1));
  },
  machFromAreaRatio: (A_ratio, gamma, subsonic = true) => {
    const AR = Math.max(1.0, A_ratio);
    if (Math.abs(AR - 1.0) < 1e-10) return 1.0;
    const f = (M) => Isentropic.areaMachRatio(M, gamma) - AR;
    let low = subsonic ? 1e-12 : 1.0, high = subsonic ? 1.0 : 40.0;
    for (let i = 0; i < 80; i++) {
      let mid = (low + high) / 2;
      if (f(mid) > 0) subsonic ? (low = mid) : (high = mid); else subsonic ? (high = mid) : (low = mid);
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

export const Solver = {
  getCoeffs: (M2, k) => {
    let denom = 1.0 - M2;
    if (Math.abs(denom) < 1e-8) denom = 1e-8 * Math.sign(denom);
    return {
      cM: { A: -(2*(1+(k-1)/2*M2))/denom, Q: (1+k*M2)/denom, f: (k*M2*(1+(k-1)/2*M2))/denom, w: (2*(1+k*M2)*(1+(k-1)/2*M2))/denom },
      cP: { A: (k*M2)/denom, Q: -k*M2/denom, f: -(k*M2*(1+(k-1)*M2))/(2*denom), w: -(2*k*M2*(1+(k-1)/2*M2))/denom },
      cT: { A: ((k-1)*M2)/denom, Q: (1-k*M2)/denom, f: -(k*(k-1)*M2*M2)/(2*denom), w: -((k-1)*M2*(1+k*M2))/denom }
    };
  },

  getForcings: (x, comp, y, gas) => {
    const [M2, P, T, mdot] = y;
    const L = Math.max(comp.params.length || 1, 1e-6);
    const forcing = { A: 0, Q: 0, f: 0, w: 0 };
    if (comp.type === 'convergent' || comp.type === 'divergent') {
      const dx = (comp.params.d_out - comp.params.d_in) / L;
      const d_curr = comp.params.d_in + dx * x;
      forcing.A = (2.0 / d_curr) * dx;
    } else if (comp.type === 'fanno') {
      forcing.f = (4.0 * comp.params.f) / comp.params.d_h;
    } else if (comp.type === 'rayleigh') {
      forcing.Q = (comp.params.q / L) / (gas.cp * T);
    } else if (comp.type === 'solid_grain') {
      const grain_mdot_dx = (comp.params.A_b * comp.params.rho_b * comp.params.a_coeff * Math.pow(Math.max(P, 1e4)/1e6, comp.params.n)) / L;
      forcing.w = grain_mdot_dx / Math.max(mdot, 1e-10);
      const T0 = T * (1 + (gas.gamma - 1) / 2 * M2);
      forcing.Q = forcing.w * (gas.cp * ((comp.params.T_b || 3000) - T0)) / (gas.cp * T);
    }
    return forcing;
  },

  rk4Step: (deriv, x, y, h) => {
    const k1 = deriv(x, y);
    const k2 = deriv(x + h/2, y.map((v, i) => v + h/2 * k1[i]));
    const k3 = deriv(x + h/2, y.map((v, i) => v + h/2 * k2[i]));
    const k4 = deriv(x + h, y.map((v, i) => v + h * k3[i]));
    return y.map((v, i) => v + (h/6) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]));
  },

  evaluateComponentAnalytical: (comp, M_in, P0_in, T0_in, gas, forceSup = false) => {
    const out = { M_in, P0_in, T0_in, type: comp.type };
    const k = gas.gamma;
    if (comp.type === "convergent") {
      const A_in = gas.areaFromDiameter(comp.params.d_in), A_out = gas.areaFromDiameter(comp.params.d_out);
      const A_star = A_in / Isentropic.areaMachRatio(Math.max(M_in, 1e-12), k);
      out.M_out = Isentropic.machFromAreaRatio(A_out / A_star, k, true);
      out.P0_out = P0_in; out.T0_out = T0_in;
    } else if (comp.type === "divergent") {
      const A_in = gas.areaFromDiameter(comp.params.d_in), A_out = gas.areaFromDiameter(comp.params.d_out);
      const A_star = A_in / Isentropic.areaMachRatio(Math.max(M_in, 1e-12), k);
      out.M_out = Isentropic.machFromAreaRatio(A_out / A_star, k, !(forceSup || M_in > 1.0));
      out.P0_out = P0_in; out.T0_out = T0_in;
    } else if (comp.type === "fanno" || comp.type === "rayleigh") {
        out.M_out = M_in; out.P0_out = P0_in; out.T0_out = T0_in; // Fallback to RK4 for these
    } else if (comp.type === "normal_shock") {
      out.M_out = NormalShock.machPostShock(M_in, k);
      out.P0_out = P0_in * NormalShock.stagnationPressureRatio(M_in, k);
      out.T0_out = T0_in;
    } else if (comp.type === "solid_grain") {
        out.M_out = M_in; out.P0_out = P0_in; out.T0_out = T0_in;
    }
    out.P_out = out.P0_out * Isentropic.pressureRatio(out.M_out, k);
    out.T_out = out.T0_out * Isentropic.temperatureRatio(out.M_out, k);
    return out;
  },

  solveFullPipeline: (components, P0_in, T0_in, P_amb, gas) => {
    let warnings = [], k = gas.gamma;
    let M_lo = 1e-6, M_hi = 1.0;
    const evaluate = (M) => {
        let results = [], curM = M, curP0 = P0_in, curT0 = T0_in;
        for (const comp of components) {
            const res = Solver.evaluateComponentAnalytical(comp, curM, curP0, curT0, gas, false);
            results.push(res); curM = res.M_out; curP0 = res.P0_out; curT0 = res.T0_out;
        }
        return results;
    };
    for (let i = 0; i < 40; i++) {
        let mid = (M_lo + M_hi) / 2;
        try { evaluate(mid); M_lo = mid; } catch (e) { M_hi = mid; }
    }
    const res_choked = evaluate(M_lo);
    if (P_amb >= res_choked[res_choked.length-1].P_out) {
        let lo = 1e-8, hi = M_lo;
        for (let i = 0; i < 40; i++) {
            let mid = (lo + hi) / 2;
            if (evaluate(mid)[components.length-1].P_out > P_amb) lo = mid; else hi = mid;
        }
        return { success: true, results: evaluate(lo), warnings, components };
    }
    warnings.push("Flow is choked.");
    return { success: true, results: res_choked, warnings, components };
  },

  generatePlotData: (components, results, gas, numPoints = 150) => {
    const data = { x: [], mach: [], pressure: [], pressure_total: [], pressure_critical: [], temperature: [], temperature_total: [], mass_flow: [] };
    let curX_global = 0, boundaries = [0], labels = [], k = gas.gamma;
    const p_star_ratio = Math.pow(2 / (k + 1), k / (k - 1));

    let M_in = results[0].M_in;
    let T_in = results[0].T0_in * Isentropic.temperatureRatio(M_in, k);
    let P_in = results[0].P0_in * Isentropic.pressureRatio(M_in, k);
    let A_in = (components[0].type === 'convergent' || components[0].type === 'divergent') ? gas.areaFromDiameter(components[0].params.d_in) : gas.areaFromDiameter(components[0].params.d_h || 0.1);
    let mdot_in = gas.density(P_in, T_in) * M_in * gas.speedOfSound(T_in) * A_in;
    
    let state = [M_in * M_in, P_in, T_in, mdot_in];

    for (let i = 0; i < components.length; i++) {
      const comp = components[i], L = Math.max(comp.params.length || 0, 0);
      labels.push(comp.type.toUpperCase());
      if (L === 0) {
        if (comp.type === 'normal_shock') {
            const M_u = Math.sqrt(state[0]);
            const rel = NormalShock.machPostShock(M_u, k);
            const P_ratio = NormalShock.pressureRatio(M_u, k);
            const T_ratio = (1 + (k-1)/2*M_u*M_u) / (1 + (k-1)/2*rel*rel); // T2/T1 from T0 const
            state = [rel*rel, state[1]*P_ratio, state[2]*T_ratio, state[3]];
        }
        const M_val = Math.sqrt(state[0]);
        const P0_val = state[1] / Isentropic.pressureRatio(M_val, k);
        data.x.push(curX_global); data.mach.push(M_val); data.pressure.push(state[1]);
        data.pressure_total.push(P0_val); data.pressure_critical.push(P0_val * p_star_ratio);
        data.temperature.push(state[2]); data.temperature_total.push(state[2] / Isentropic.temperatureRatio(M_val, k));
        data.mass_flow.push(state[3]);
        continue;
      }

      const h = L / (numPoints - 1);
      const deriv = (x, y) => {
        const [M2, P, T, mdot] = y;
        const { cM, cP, cT } = Solver.getCoeffs(M2, k);
        const f = Solver.getForcings(x, comp, y, gas);
        return [
          M2 * (cM.A*f.A + cM.Q*f.Q + cM.f*f.f + cM.w*f.w),
          P  * (cP.A*f.A + cP.Q*f.Q + cP.f*f.f + cP.w*f.w),
          T  * (cT.A*f.A + cT.Q*f.Q + cT.f*f.f + cT.w*f.w),
          mdot * f.w
        ];
      };

      for (let j = 0; j < numPoints; j++) {
        const M = Math.sqrt(Math.max(1e-12, state[0]));
        const T0 = state[2] / Isentropic.temperatureRatio(M, k);
        const P0 = state[1] / Isentropic.pressureRatio(M, k);
        data.x.push(curX_global + j * h); data.mach.push(M); data.pressure.push(state[1]);
        data.pressure_total.push(P0); data.pressure_critical.push(P0 * p_star_ratio);
        data.temperature.push(state[2]);
        data.temperature_total.push(T0); data.mass_flow.push(state[3]);
        if (j < numPoints - 1) state = Solver.rk4Step(deriv, j * h, state, h);
      }
      curX_global += L; boundaries.push(curX_global);
    }
    return { data, boundaries, labels };
  },

  computeSummary: (config, components, data, gas) => {
    const last = data.x.length - 1, P_e = data.pressure[last], M_e = data.mach[last], T_e = data.temperature[last], mdot = data.mass_flow[last];
    const V_e = M_e * gas.speedOfSound(T_e);
    let A_e = 0.01; const lc = components[components.length-1];
    if (lc.type === "convergent" || lc.type === "divergent") A_e = gas.areaFromDiameter(lc.params.d_out);
    return { "Thrust": { value: mdot * V_e + (P_e - config.P_amb) * A_e, unit: "N" }, "Mass Flow": { value: mdot, unit: "kg/s" }, "Exit Velocity": { value: V_e, unit: "m/s" } };
  }
};
