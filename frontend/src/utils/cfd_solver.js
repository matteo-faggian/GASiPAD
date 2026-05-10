/**
 * GASPAD CFD Solver Orchestrator
 * Handles mesh generation and coordinates the Web Worker.
 */

export class CFDSolver {
    constructor(gas, nx = 500) {
        this.gas = gas;
        this.nx_base = nx;
        this.gamma = gas.gamma;
        this.R = gas.R;
    }

    generateMesh(components) {
        const _REFINEMENT = {
            "convergent": 0.4,
            "divergent": 0.4,
            "rayleigh": 0.5,
            "solid_grain": 0.6,
            "fanno": 1.0,
            "normal_shock": 0.2,
        };

        const total_L = components.reduce((sum, c) => sum + (c.type !== "normal_shock" ? (c.params.length || 0) : 0), 0);
        if (total_L < 1e-12) throw new Error("Pipeline length zero");

        const dx_base = total_L / this.nx_base;
        let current_x = 0;
        const segments = [];

        for (const comp of components) {
            if (comp.type === "normal_shock") continue;
            const L = comp.params.length || 0;
            if (L < 1e-12) continue;
            const factor = _REFINEMENT[comp.type] || 1.0;
            const n_cells = Math.max(4, Math.round(L / (dx_base * factor)));
            
            const seg = new Float64Array(n_cells + 1);
            for (let i = 0; i <= n_cells; i++) {
                seg[i] = current_x + (L * i) / n_cells;
            }
            segments.push(seg);
            current_x += L;
        }

        // Concatenate segments
        let total_nodes = segments.reduce((sum, s, i) => sum + (i === 0 ? s.length : s.length - 1), 0);
        const x_int = new Float64Array(total_nodes);
        let offset = 0;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const start = i === 0 ? 0 : 1;
            x_int.set(seg.subarray(start), offset);
            offset += (seg.length - start);
        }

        const nx = x_int.length - 1;
        const x = new Float64Array(nx);
        const dx_arr = new Float64Array(nx);
        for (let i = 0; i < nx; i++) {
            x[i] = 0.5 * (x_int[i] + x_int[i+1]);
            dx_arr[i] = x_int[i+1] - x_int[i];
        }

        return { x, x_int, dx_arr, nx };
    }

    async solve(components, P0_in, T0_in, P_amb) {
        const { x, x_int, dx_arr, nx } = this.generateMesh(components);

        const A_int = new Float64Array(nx + 1);
        const A = new Float64Array(nx);
        const f_fanning = new Float64Array(nx);
        const q_heat = new Float64Array(nx);
        const delta_h0 = new Float64Array(nx);
        const q_mode_total = new Uint8Array(nx);
        const D = new Float64Array(nx);

        const grain_a = new Float64Array(nx);
        const grain_n = new Float64Array(nx);
        const grain_S_m_factor = new Float64Array(nx);
        const grain_h_st = new Float64Array(nx);

        let curr_x = 0;
        for (const comp of components) {
            if (comp.type === "normal_shock") continue;
            const L = Math.max(comp.params.length || 1.0, 1e-5);
            const eps = Math.min(...dx_arr) * 1e-3;

            for (let i = 0; i < nx; i++) {
                if (x[i] >= curr_x - eps && x[i] <= curr_x + L + eps) {
                    if (comp.type === "convergent" || comp.type === "divergent") {
                        const d_in = comp.params.d_in;
                        const d_out = comp.params.d_out;
                        const d_x = d_in + (d_out - d_in) * (x[i] - curr_x) / L;
                        A[i] = (Math.PI / 4) * d_x * d_x;
                    } else if (comp.type === "solid_grain") {
                        const d_h = comp.params.d_h || 0.1;
                        A[i] = (Math.PI / 4) * d_h * d_h;
                        
                        const rho_s = comp.params.rho_b || 1800;
                        const A_b = comp.params.A_b || 0.1;
                        const T_f = comp.params.T_b || 3000;
                        
                        let a_coeff, n_exp;
                        if (comp.params.only_mass_addition === 1) {
                            const target_mdot = comp.params.target_mass_flow || 2.0;
                            a_coeff = target_mdot / (rho_s * A_b);
                            n_exp = 0;
                        } else {
                            a_coeff = comp.params.a_coeff || 0.02;
                            n_exp = comp.params.n || 0.5;
                        }
                        
                        grain_a[i] = a_coeff;
                        grain_n[i] = n_exp;
                        grain_S_m_factor[i] = (rho_s * A_b) / L;
                        grain_h_st[i] = (this.gamma * this.R / (this.gamma - 1)) * T_f;
                    } else {
                        const d_h = comp.params.d_h || 0.1;
                        A[i] = (Math.PI / 4) * d_h * d_h;
                        if (comp.type === "fanno") f_fanning[i] = comp.params.f / 4.0;
                        else if (comp.type === "rayleigh") {
                            if (comp.params.heat_mode === "total_specific") {
                                delta_h0[i] = comp.params.q / L;
                                q_mode_total[i] = 1;
                            } else {
                                q_heat[i] = comp.params.q / L;
                            }
                        }
                    }
                }
            }

            for (let i = 0; i <= nx; i++) {
                if (x_int[i] >= curr_x - eps && x_int[i] <= curr_x + L + eps) {
                    if (comp.type === "convergent" || comp.type === "divergent") {
                        const d_in = comp.params.d_in;
                        const d_out = comp.params.d_out;
                        const d_x = d_in + (d_out - d_in) * (x_int[i] - curr_x) / L;
                        A_int[i] = (Math.PI / 4) * d_x * d_x;
                    } else {
                        const d_h = comp.params.d_h || 0.1;
                        A_int[i] = (Math.PI / 4) * d_h * d_h;
                    }
                }
            }
            curr_x += L;
        }

        for (let i = 0; i < nx; i++) D[i] = Math.sqrt(4 * A[i] / Math.PI);

        // Initial Conditions
        const U_curr_0 = new Float64Array(nx);
        const U_curr_1 = new Float64Array(nx);
        const U_curr_2 = new Float64Array(nx);
        const rho_init = P0_in / (this.R * T0_in);
        const u_init = 10.0;
        
        for (let i = 0; i < nx; i++) {
            U_curr_0[i] = rho_init * A[i];
            U_curr_1[i] = rho_init * u_init * A[i];
            U_curr_2[i] = (P0_in / (this.gamma - 1) + 0.5 * rho_init * u_init * u_init) * A[i];
        }

        return new Promise((resolve, reject) => {
            // In Vite, we can use the ?worker suffix for worker imports
            // But for a dynamic creation, we can use URL
            const worker = new Worker(new URL('./cfd_worker.js', import.meta.url));
            
            worker.onmessage = (e) => {
                const { U_curr_0, U_curr_1, U_curr_2, F_0, F_1, F_2 } = e.data;
                
                // Post-process
                const mach = new Float64Array(nx);
                const pressure = new Float64Array(nx);
                const pressure_total = new Float64Array(nx);
                const temperature = new Float64Array(nx);
                const temperature_total = new Float64Array(nx);
                const mass_flow = new Float64Array(nx);
                
                // For smoothing mass flow like in Python
                const mdot_smooth = new Float64Array(nx);
                let mdot_acc = U_curr_1[0]; // Simplified
                
                for (let i = 0; i < nx; i++) {
                    const rho_val = U_curr_0[i] / A[i];
                    const u_val = U_curr_1[i] / U_curr_0[i];
                    const p_val = (this.gamma - 1) * (U_curr_2[i] / A[i] - 0.5 * rho_val * u_val * u_val);
                    const a_val = Math.sqrt(this.gamma * p_val / rho_val);
                    const T_val = p_val / (rho_val * this.R);
                    
                    mach[i] = u_val / a_val;
                    pressure[i] = p_val;
                    temperature[i] = T_val;
                    
                    const M2 = mach[i] * mach[i];
                    temperature_total[i] = T_val * (1 + 0.5 * (this.gamma - 1) * M2);
                    pressure_total[i] = p_val * Math.pow(temperature_total[i] / T_val, this.gamma / (this.gamma - 1));
                    
                    // Smooth mass flow
                    const S_m = grain_S_m_factor[i] * grain_a[i] * Math.pow(p_val / 1000000, grain_n[i]);
                    if (i > 0) mdot_acc += S_m * dx_arr[i];
                    mdot_smooth[i] = mdot_acc;
                }

                worker.terminate();
                resolve({
                    x: Array.from(x),
                    mach: Array.from(mach),
                    pressure: Array.from(pressure),
                    pressure_total: Array.from(pressure_total),
                    temperature: Array.from(temperature),
                    temperature_total: Array.from(temperature_total),
                    mass_flow: Array.from(mdot_smooth),
                    diagnostics: {
                        choked: Math.max(...mach) > 0.98,
                        gas_model: "ideal"
                    }
                });
            };

            worker.onerror = (err) => {
                worker.terminate();
                reject(err);
            };

            worker.postMessage({
                U_curr_0, U_curr_1, U_curr_2, A, A_int, f_fanning, q_heat, delta_h0, q_mode_total, D,
                grain_a, grain_n, grain_S_m_factor, grain_h_st, dx_arr, nx,
                gamma: this.gamma, R: this.R, max_iter: 150000, tol: 1e-7,
                P0_in, T0_in, P_amb
            });
        });
    }
}
