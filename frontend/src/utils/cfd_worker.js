/**
 * GASPAD CFD Web Worker
 * High-performance 1D Euler Solver (Roe/MUSCL)
 */

function minmod(a, b) {
    if (a * b <= 0) return 0.0;
    return Math.abs(a) < Math.abs(b) ? a : b;
}

function roeFluxFixed(rhoL, uL, pL, rhoR, uR, pR, A_int, gamma) {
    const HL = (gamma * pL / ((gamma - 1) * rhoL)) + 0.5 * uL * uL;
    const HR = (gamma * pR / ((gamma - 1) * rhoR)) + 0.5 * uR * uR;

    const sqL = Math.sqrt(rhoL);
    const sqR = Math.sqrt(rhoR);
    const u_roe = (sqL * uL + sqR * uR) / (sqL + sqR);
    const H_roe = (sqL * HL + sqR * HR) / (sqL + sqR);
    const a_roe = Math.sqrt(Math.max((gamma - 1) * (H_roe - 0.5 * u_roe * u_roe), 1e-12));

    const f1L = rhoL * uL;
    const f2L = rhoL * uL * uL + pL;
    const f3L = rhoL * uL * HL;

    const f1R = rhoR * uR;
    const f2R = rhoR * uR * uR + pR;
    const f3R = rhoR * uR * HR;

    const l1 = u_roe;
    const l2 = u_roe + a_roe;
    const l3 = u_roe - a_roe;
    const delta = 0.15 * a_roe;

    const al1 = Math.abs(l1) > delta ? Math.abs(l1) : (l1 * l1 + delta * delta) / (2 * delta);
    const al2 = Math.abs(l2) > delta ? Math.abs(l2) : (l2 * l2 + delta * delta) / (2 * delta);
    const al3 = Math.abs(l3) > delta ? Math.abs(l3) : (l3 * l3 + delta * delta) / (2 * delta);

    const du = uR - uL;
    const dp = pR - pL;
    const drho = rhoR - rhoL;
    const rho_roe = sqL * sqR;

    const alpha1 = drho - dp / (a_roe * a_roe);
    const alpha2 = (dp + rho_roe * a_roe * du) / (2 * a_roe * a_roe);
    const alpha3 = (dp - rho_roe * a_roe * du) / (2 * a_roe * a_roe);

    const d1 = al1 * alpha1;
    const d2 = al2 * alpha2;
    const d3 = al3 * alpha3;

    const diss1 = d1 + d2 + d3;
    const diss2 = d1 * u_roe + d2 * (u_roe + a_roe) + d3 * (u_roe - a_roe);
    const diss3 = d1 * 0.5 * u_roe * u_roe + d2 * (H_roe + u_roe * a_roe) + d3 * (H_roe - u_roe * a_roe);

    return [
        (0.5 * (f1L + f1R) - 0.5 * diss1) * A_int,
        (0.5 * (f2L + f2R) - 0.5 * diss2) * A_int,
        (0.5 * (f3L + f3R) - 0.5 * diss3) * A_int
    ];
}

function cfdCoreLoop(params) {
    const { U_curr_0, U_curr_1, U_curr_2, A, A_int, f_fanning, q_heat, delta_h0, q_mode_total, D,
            grain_a, grain_n, grain_S_m_factor, grain_h_st, dx_arr, nx, gamma, R, max_iter, tol,
            P0_in, T0_in, P_amb } = params;

    const U_new_0 = new Float64Array(nx);
    const U_new_1 = new Float64Array(nx);
    const U_new_2 = new Float64Array(nx);
    
    const F_0 = new Float64Array(nx + 1);
    const F_1 = new Float64Array(nx + 1);
    const F_2 = new Float64Array(nx + 1);

    const rho = new Float64Array(nx);
    const u = new Float64Array(nx);
    const p = new Float64Array(nx);
    const a = new Float64Array(nx);
    const S_m_curr = new Float64Array(nx);
    const dt_local = new Float64Array(nx);

    for (let it = 0; it < max_iter; it++) {
        for (let i = 0; i < nx; i++) {
            rho[i] = Math.max(U_curr_0[i] / A[i], 1e-6);
            u[i]   = U_curr_1[i] / Math.max(U_curr_0[i], 1e-10);
            p[i]   = Math.max((gamma - 1) * (U_curr_2[i] / A[i] - 0.5 * rho[i] * u[i] * u[i]), 1e-5);
            a[i]   = Math.sqrt(gamma * p[i] / rho[i]);
        }

        for (let i = 0; i <= nx; i++) {
            let rL, uL, pL, rR, uR, pR;
            if (i === 0) {
                const u_ghost = u[0];
                const T_in = T0_in / (1 + 0.5 * (gamma - 1) * Math.pow(u_ghost / a[0], 2));
                const p_in = P0_in * Math.pow(T_in / T0_in, gamma / (gamma - 1));
                const rho_in = p_in / (R * T_in);
                rL = rho_in; uL = u_ghost; pL = p_in;
                rR = rho[0]; uR = u[0]; pR = p[0];
            } else if (i === nx) {
                rL = rho[nx - 1]; uL = u[nx - 1]; pL = p[nx - 1];
                pR = u[nx - 1] < a[nx - 1] ? P_amb : p[nx - 1];
                rR = rho[nx - 1]; uR = u[nx - 1];
            } else {
                const imm = Math.max(0, i - 2);
                rL = rho[i - 1] + 0.5 * minmod(rho[i - 1] - rho[imm], rho[i] - rho[i - 1]);
                uL = u[i - 1]   + 0.5 * minmod(u[i - 1] - u[imm], u[i] - u[i - 1]);
                pL = p[i - 1]   + 0.5 * minmod(p[i - 1] - p[imm], p[i] - p[i - 1]);
                
                const ipp = Math.min(nx - 1, i + 1);
                rR = rho[i] - 0.5 * minmod(rho[ipp] - rho[i], rho[i] - rho[i - 1]);
                uR = u[i]   - 0.5 * minmod(u[ipp] - u[i], u[i] - u[i - 1]);
                pR = p[i]   - 0.5 * minmod(p[ipp] - p[i], p[i] - p[i - 1]);
            }

            const flux = roeFluxFixed(rL, uL, pL, rR, uR, pR, A_int[i], gamma);
            F_0[i] = flux[0]; F_1[i] = flux[1]; F_2[i] = flux[2];
        }

        for (let i = 0; i < nx; i++) {
            dt_local[i] = 0.2 * dx_arr[i] / (Math.abs(u[i]) + a[i] + 1e-6);
        }

        let max_diff = 0.0;
        let max_u0 = 0.0;

        for (let i = 0; i < nx; i++) {
            const dt = dt_local[i];
            const dx = dx_arr[i];
            
            const U_star_0 = U_curr_0[i] - (dt / dx) * (F_0[i + 1] - F_0[i]);
            const U_star_1 = U_curr_1[i] - (dt / dx) * (F_1[i + 1] - F_1[i]);
            const U_star_2 = U_curr_2[i] - (dt / dx) * (F_2[i + 1] - F_2[i]);
            
            const dA_dx = (A_int[i + 1] - A_int[i]) / dx;
            const source_p = p[i] * dA_dx;
            const K_f = 0.5 * f_fanning[i] * Math.abs(u[i]) * (Math.PI * D[i]) / A[i];
            const q_val = q_mode_total[i] ? delta_h0[i] : q_heat[i];
            const source_q = rho[i] * Math.abs(u[i]) * q_val * A[i];

            const i_prev = Math.max(0, i - 1);
            const i_next = Math.min(nx - 1, i + 1);
            const p_smooth = 0.25 * p[i_prev] + 0.5 * p[i] + 0.25 * p[i_next];
            
            const S_m_target = grain_S_m_factor[i] * grain_a[i] * Math.pow(p_smooth / 1000000, grain_n[i]);
            
            if (it === 0) S_m_curr[i] = S_m_target;
            else S_m_curr[i] = 0.1 * S_m_target + 0.9 * S_m_curr[i];
            
            const S_m = S_m_curr[i];
            
            U_new_0[i] = Math.max(U_star_0 + dt * S_m, 1e-6 * A[i]);
            U_new_1[i] = (U_star_1 + dt * source_p) / (1.0 + dt * K_f);
            U_new_2[i] = Math.max(U_star_2 + dt * source_q + dt * S_m * grain_h_st[i], 1e-5);

            const diff = Math.abs(U_new_0[i] - U_curr_0[i]);
            if (diff > max_diff) max_diff = diff;
            if (Math.abs(U_curr_0[i]) > max_u0) max_u0 = Math.abs(U_curr_0[i]);
            
            U_curr_0[i] = U_new_0[i];
            U_curr_1[i] = U_new_1[i];
            U_curr_2[i] = U_new_2[i];
        }

        if (it > 5000 && it % 500 === 0) {
            if (max_diff / (max_u0 + 1e-10) < tol) {
                break;
            }
        }
    }
    
    return { U_curr_0, U_curr_1, U_curr_2, F_0, F_1, F_2 };
}

self.addEventListener('message', function(e) {
    try {
        const results = cfdCoreLoop(e.data);
        self.postMessage(results);
    } catch (err) {
        console.error("CFD Worker Error:", err);
    }
});
