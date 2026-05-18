import warnings
import numpy as np
from numba import njit, prange
from typing import List, Dict, Tuple, Any
from app.models import ComponentConfig
from app.solver.gas import GasProperties

# ============================================================
# Configurazione Griglia Multi-Zona
# ============================================================
_REFINEMENT = {
    "convergent":   0.4,
    "divergent":    0.4,
    "rayleigh":     0.5,
    "solid_grain":  0.6,
    "fanno":        1.0,
    "normal_shock": 0.2,
}

def generate_multizone_mesh(components: List[ComponentConfig], nx_base: int = 1000) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    total_L = sum(c.params.get("length", 0.0) for c in components if c.type != "normal_shock")
    if total_L < 1e-12: raise ValueError("Pipeline length zero")
    dx_base = total_L / nx_base
    segments, current_x = [], 0.0
    for comp in components:
        if comp.type == "normal_shock": continue
        L = comp.params.get("length", 0.0)
        if L < 1e-12: continue
        factor = _REFINEMENT.get(comp.type, 1.0)
        n_cells = max(4, round(L / (dx_base * factor)))
        seg_int = np.linspace(current_x, current_x + L, n_cells + 1)
        segments.append(seg_int)
        current_x += L
    x_int = np.concatenate([seg if i == 0 else seg[1:] for i, seg in enumerate(segments)])
    x = 0.5 * (x_int[:-1] + x_int[1:])
    dx_arr = x_int[1:] - x_int[:-1]
    return x, x_int, dx_arr

# ============================================================
# Solutore Gas Ideale (Roe/MUSCL)
# ============================================================

@njit(inline='always')
def minmod(a, b):
    if a * b <= 0: return 0.0
    return a if abs(a) < abs(b) else b

@njit(fastmath=True)
def roe_flux_numba_fixed(rhoL, uL, pL, rhoR, uR, pR, A_int, gamma):
    HL = (gamma * pL / ((gamma - 1) * rhoL)) + 0.5 * uL**2
    HR = (gamma * pR / ((gamma - 1) * rhoR)) + 0.5 * uR**2
    
    sqL, sqR = np.sqrt(rhoL), np.sqrt(rhoR)
    u_roe = (sqL * uL + sqR * uR) / (sqL + sqR)
    H_roe = (sqL * HL + sqR * HR) / (sqL + sqR)
    a_roe = np.sqrt(max((gamma - 1) * (H_roe - 0.5 * u_roe**2), 1e-12))
    
    f1L, f2L, f3L = rhoL * uL, rhoL * uL**2 + pL, rhoL * uL * HL
    f1R, f2R, f3R = rhoR * uR, rhoR * uR**2 + pR, rhoR * uR * HR
    
    l1, l2, l3 = u_roe, u_roe + a_roe, u_roe - a_roe
    delta = 0.15 * a_roe
    al1 = abs(l1) if abs(l1) > delta else (l1**2 + delta**2) / (2 * delta)
    al2 = abs(l2) if abs(l2) > delta else (l2**2 + delta**2) / (2 * delta)
    al3 = abs(l3) if abs(l3) > delta else (l3**2 + delta**2) / (2 * delta)
    
    du, dp, drho = uR - uL, pR - pL, rhoR - rhoL
    rho_roe = sqL * sqR
    
    alpha1 = drho - dp / a_roe**2
    alpha2 = (dp + rho_roe * a_roe * du) / (2 * a_roe**2)
    alpha3 = (dp - rho_roe * a_roe * du) / (2 * a_roe**2)
    
    d1, d2, d3 = al1 * alpha1, al2 * alpha2, al3 * alpha3
    
    diss1 = d1 + d2 + d3
    diss2 = d1 * u_roe + d2 * (u_roe + a_roe) + d3 * (u_roe - a_roe)
    diss3 = d1 * 0.5 * u_roe**2 + d2 * (H_roe + u_roe * a_roe) + d3 * (H_roe - u_roe * a_roe)
    
    return (0.5 * (f1L + f1R) - 0.5 * diss1) * A_int, \
           (0.5 * (f2L + f2R) - 0.5 * diss2) * A_int, \
           (0.5 * (f3L + f3R) - 0.5 * diss3) * A_int

@njit(parallel=True, fastmath=True)
def cfd_core_loop(U_curr, A, A_int, f_fanning, q_heat, delta_h0, q_mode_total, D,
                  grain_a, grain_n, grain_S_m_factor, grain_h_st,
                  dx_arr, nx, gamma, R, max_iter, tol, P0_in, T0_in, P_amb, grain_relax):
    
    U_new = np.empty_like(U_curr)
    F = np.zeros((3, nx + 1))
    rho, u, p, a = np.zeros(nx), np.zeros(nx), np.zeros(nx), np.zeros(nx)
    S_m_curr = np.zeros(nx) # Temporal smoothing array

    for it in range(max_iter):
        for i in prange(nx):
            rho_val = max(U_curr[0, i] / A[i], 1e-6)
            rho[i] = rho_val
            u[i]   = U_curr[1, i] / max(U_curr[0, i], 1e-10)
            p[i]   = max((gamma - 1) * (U_curr[2, i] / A[i] - 0.5 * rho_val * u[i]**2), 1e-5)
            a[i]   = np.sqrt(gamma * p[i] / rho_val)

        for i in prange(nx + 1):
            if i == 0:
                u_ghost = u[0]
                T_in = T0_in / (1 + 0.5 * (gamma - 1) * (u_ghost/a[0])**2)
                p_in = P0_in * (T_in / T0_in)**(gamma/(gamma-1))
                rho_in = p_in / (R * T_in)
                rL, uL, pL = rho_in, u_ghost, p_in
                rR, uR, pR = rho[0], u[0], p[0]
            elif i == nx:
                rL, uL, pL = rho[nx-1], u[nx-1], p[nx-1]
                pR = P_amb if u[nx-1] < a[nx-1] else p[nx-1]
                rR, uR = rho[nx-1], u[nx-1]
            else:
                imm = max(0, i-2)
                rL = rho[i-1] + 0.5 * minmod(rho[i-1]-rho[imm], rho[i]-rho[i-1])
                uL = u[i-1]   + 0.5 * minmod(u[i-1]-u[imm],     u[i]-u[i-1])
                pL = p[i-1]   + 0.5 * minmod(p[i-1]-p[imm],     p[i]-p[i-1])
                ipp = min(nx-1, i+1)
                rR = rho[i] - 0.5 * minmod(rho[ipp]-rho[i], rho[i]-rho[i-1])
                uR = u[i]   - 0.5 * minmod(u[ipp]-u[i],     u[i]-u[i-1])
                pR = p[i]   - 0.5 * minmod(p[ipp]-p[i],     p[i]-p[i-1])

            F[0,i], F[1,i], F[2,i] = roe_flux_numba_fixed(rL, uL, pL, rR, uR, pR, A_int[i], gamma)

        dt_local = np.empty(nx)
        for i in prange(nx):
            dt_local[i] = 0.2 * dx_arr[i] / (abs(u[i]) + a[i] + 1e-6)

        for i in prange(nx):
            dt = dt_local[i]
            U_star_0 = U_curr[0, i] - (dt/dx_arr[i]) * (F[0, i+1] - F[0, i])
            U_star_1 = U_curr[1, i] - (dt/dx_arr[i]) * (F[1, i+1] - F[1, i])
            U_star_2 = U_curr[2, i] - (dt/dx_arr[i]) * (F[2, i+1] - F[2, i])
            
            dA_dx = (A_int[i+1] - A_int[i]) / dx_arr[i]
            source_p = p[i] * dA_dx
            K_f = 0.5 * f_fanning[i] * abs(u[i]) * (np.pi * D[i]) / A[i]
            q_val = delta_h0[i] if q_mode_total[i] else q_heat[i]
            source_q = rho[i] * abs(u[i]) * q_val * A[i]

            # --- Solid Grain Physics (Vieille's Law with Spatial & Temporal Smoothing) ---
            i_prev, i_next = max(0, i-1), min(nx-1, i+1)
            p_smooth = 0.25 * p[i_prev] + 0.5 * p[i] + 0.25 * p[i_next]
            # S_m = mass added per unit time and unit length [kg/(s*m)]
            S_m_target = grain_S_m_factor[i] * grain_a[i] * (p_smooth/1e6)**grain_n[i] 
            
            if it == 0: S_m_curr[i] = S_m_target
            else: S_m_curr[i] = grain_relax * S_m_target + (1.0 - grain_relax) * S_m_curr[i]
            S_m = S_m_curr[i]

            U_new[0, i] = max(U_star_0 + dt * S_m, 1e-6 * A[i])
            U_new[1, i] = (U_star_1 + dt * source_p) / (1.0 + dt * K_f)
            U_new[2, i] = max(U_star_2 + dt * source_q + dt * S_m * grain_h_st[i], 1e-5)

        if it > 5000 and it % 500 == 0:
            if np.max(np.abs(U_new[0] - U_curr[0])) / (np.max(np.abs(U_curr[0])) + 1e-10) < tol:
                break

        U_curr[:] = U_new[:]

    return U_curr, F

# ============================================================
# Solutore Gas Reale (Van der Waals + Rusanov Flux)
# ============================================================

@njit(inline='always')
def vdw_state(rho, e_spec, R, cv, a_vdw, b_vdw):
    T = max((e_spec + a_vdw * rho) / cv, 1e-5)
    denom = 1.0 - rho * b_vdw
    if denom < 1e-10: denom = 1e-10
    
    p = (rho * R * T) / denom - a_vdw * rho**2
    gamma_eff = (cv + R) / cv
    a2 = (gamma_eff * R * T) / (denom**2) - 2.0 * a_vdw * rho
    a = np.sqrt(max(a2, 1e-12))
    return p, T, a

@njit(fastmath=True)
def rusanov_flux_real_gas(rhoL, uL, pL, EL, rhoR, uR, pR, ER, aL, aR, A_int):
    f1L, f2L, f3L = rhoL * uL, rhoL * uL**2 + pL, (EL + pL) * uL
    f1R, f2R, f3R = rhoR * uR, rhoR * uR**2 + pR, (ER + pR) * uR
    s_max = max(abs(uL) + aL, abs(uR) + aR)
    
    return (0.5 * (f1L + f1R) - 0.5 * s_max * (rhoR - rhoL)) * A_int, \
           (0.5 * (f2L + f2R) - 0.5 * s_max * (rhoR * uR - rhoL * uL)) * A_int, \
           (0.5 * (f3L + f3R) - 0.5 * s_max * (ER - EL)) * A_int

@njit(parallel=True, fastmath=True)
def cfd_core_loop_real_gas(U_curr, A, A_int, f_fanning, q_heat, delta_h0, q_mode_total, D,
                           grain_a, grain_n, grain_S_m_factor, grain_h_st,
                           dx_arr, nx, R, cv, a_vdw, b_vdw, max_iter, tol, P0_in, T0_in, P_amb, grain_relax):
    U_new = np.empty_like(U_curr)
    F = np.zeros((3, nx + 1))
    rho, u, p, a, T = np.zeros(nx), np.zeros(nx), np.zeros(nx), np.zeros(nx), np.zeros(nx)
    S_m_curr = np.zeros(nx) # Temporal smoothing array
    gamma_eff = (cv + R) / cv

    for it in range(max_iter):
        for i in prange(nx):
            rho_val = max(U_curr[0, i] / A[i], 1e-6)
            rho[i] = rho_val
            u[i]   = U_curr[1, i] / max(U_curr[0, i], 1e-6)
            e_spec = (U_curr[2, i] / A[i] - 0.5 * rho_val * u[i]**2) / rho_val
            p[i], T[i], a[i] = vdw_state(rho_val, e_spec, R, cv, a_vdw, b_vdw)
            p[i] = max(p[i], 1e-5)

        for i in prange(nx + 1):
            if i == 0:
                u_ghost = u[0]
                T_in = T0_in / (1.0 + 0.5 * (gamma_eff - 1.0) * (u_ghost / max(a[0], 1e-5))**2)
                p_in = P0_in * (T_in / T0_in)**(gamma_eff / (gamma_eff - 1.0))
                
                # Safer rho_in for VDW (from p = rho*R*T/(1-rho*b))
                # rho = p / (R*T + p*b)
                rho_in = max(p_in / (R * T_in + p_in * b_vdw), 1e-6)
                
                rL, uL, pL = rho_in, u_ghost, p_in
                EL = rL * (cv * T_in - a_vdw * rL) + 0.5 * rL * uL**2
                rR, uR, pR = rho[0], u[0], p[0]
                ER = U_curr[2, 0] / A[0]
                aL, aR = a[0], a[0]
                
            elif i == nx:
                rL, uL, pL = rho[nx-1], u[nx-1], p[nx-1]
                EL = U_curr[2, nx-1] / A[nx-1]
                aL = a[nx-1]
                uR = u[nx-1]
                pR = P_amb if uR < a[nx-1] else pL
                rR = max(rL, 1e-6)
                TR = max((pR + a_vdw * rR**2) * (1.0 - rR * b_vdw) / (rR * R), 1e-5)
                ER = rR * (cv * TR - a_vdw * rR) + 0.5 * rR * uR**2
                aR = a[nx-1]
                
            else:
                imm = max(0, i-2)
                ipp = min(nx-1, i+1)
                
                rL = rho[i-1] + 0.5 * minmod(rho[i-1]-rho[imm], rho[i]-rho[i-1])
                uL = u[i-1]   + 0.5 * minmod(u[i-1]-u[imm],     u[i]-u[i-1])
                pL = p[i-1]   + 0.5 * minmod(p[i-1]-p[imm],     p[i]-p[i-1])
                
                rR = rho[i] - 0.5 * minmod(rho[ipp]-rho[i], rho[i]-rho[i-1])
                uR = u[i]   - 0.5 * minmod(u[ipp]-u[i],     u[i]-u[i-1])
                pR = p[i]   - 0.5 * minmod(p[ipp]-p[i],     p[i]-p[i-1])

                rL, rR = max(rL, 1e-6), max(rR, 1e-6)
                pL, pR = max(pL, 1e-5), max(pR, 1e-5)

                TL = max((pL + a_vdw * rL**2) * (1.0 - rL * b_vdw) / (rL * R), 1e-5)
                TR = max((pR + a_vdw * rR**2) * (1.0 - rR * b_vdw) / (rR * R), 1e-5)
                
                EL = rL * (cv * TL - a_vdw * rL) + 0.5 * rL * uL**2
                ER = rR * (cv * TR - a_vdw * rR) + 0.5 * rR * uR**2
                
                aL = np.sqrt(max((gamma_eff * R * TL) / (1.0 - rL * b_vdw)**2 - 2.0 * a_vdw * rL, 1e-12))
                aR = np.sqrt(max((gamma_eff * R * TR) / (1.0 - rR * b_vdw)**2 - 2.0 * a_vdw * rR, 1e-12))

            F[0,i], F[1,i], F[2,i] = rusanov_flux_real_gas(rL, uL, pL, EL, rR, uR, pR, ER, aL, aR, A_int[i])

        dt_local = np.empty(nx)
        for i in prange(nx):
            dt_local[i] = 0.2 * dx_arr[i] / (abs(u[i]) + a[i] + 1e-6)

        for i in prange(nx):
            dt = dt_local[i]
            U_star_0 = U_curr[0, i] - (dt/dx_arr[i]) * (F[0, i+1] - F[0, i])
            U_star_1 = U_curr[1, i] - (dt/dx_arr[i]) * (F[1, i+1] - F[1, i])
            U_star_2 = U_curr[2, i] - (dt/dx_arr[i]) * (F[2, i+1] - F[2, i])
            
            dA_dx = (A_int[i+1] - A_int[i]) / dx_arr[i]
            source_p = p[i] * dA_dx
            K_f = 0.5 * f_fanning[i] * abs(u[i]) * (np.pi * D[i]) / A[i]
            q_val = delta_h0[i] if q_mode_total[i] else q_heat[i]
            source_q = rho[i] * abs(u[i]) * q_val * A[i]

            # --- Solid Grain Physics (Vieille's Law with Spatial & Temporal Smoothing) ---
            i_prev, i_next = max(0, i-1), min(nx-1, i+1)
            p_smooth = 0.25 * p[i_prev] + 0.5 * p[i] + 0.25 * p[i_next]
            S_m_target = grain_S_m_factor[i] * grain_a[i] * (p_smooth/1e6)**grain_n[i]
            
            if it == 0: S_m_curr[i] = S_m_target
            else: S_m_curr[i] = grain_relax * S_m_target + (1.0 - grain_relax) * S_m_curr[i]
            S_m = S_m_curr[i]

            U_new[0, i] = max(U_star_0 + dt * S_m, 1e-6 * A[i])
            U_new[1, i] = (U_star_1 + dt * source_p) / (1.0 + dt * K_f)
            U_new[2, i] = max(U_star_2 + dt * source_q + dt * S_m * grain_h_st[i], 1e-5)

        if it > 5000 and it % 500 == 0:
            if np.max(np.abs(U_new[0] - U_curr[0])) / (np.max(np.abs(U_curr[0])) + 1e-10) < tol:
                break
        U_curr[:] = U_new[:]

    return U_curr, F

@njit(parallel=True, fastmath=True)
def post_process_real_gas(U, A, R, cv, a_vdw, b_vdw):
    nx = U.shape[1]
    p, T, M = np.zeros(nx), np.zeros(nx), np.zeros(nx)
    for i in prange(nx):
        rho = max(U[0, i] / A[i], 1e-6) 
        u = U[1, i] / max(U[0, i], 1e-6)
        e_spec = (U[2, i] / A[i] - 0.5 * rho * u**2) / rho
        pi, Ti, ai = vdw_state(rho, e_spec, R, cv, a_vdw, b_vdw)
        p[i], T[i], M[i] = pi, Ti, u / ai
    return p, T, M

# ============================================================
# Router Principale Multi-Solutore
# ============================================================

class GeneralSolver1D:
    def __init__(self, gas: GasProperties, nx: int = 1000):
        self.gas = gas
        self.nx = nx
        self.gamma = gas.gamma
        self.R = gas.R
        self.is_real = hasattr(gas, 'a')

    def solve(self, components, P0_in, T0_in, P_amb, max_iter=200000, tol=1e-7):
        x, x_int, dx_arr = generate_multizone_mesh(components, nx_base=self.nx)
        nx = len(x)
        A_int, A, f_fanning, q_heat, delta_h0 = np.zeros(nx+1), np.zeros(nx), np.zeros(nx), np.zeros(nx), np.zeros(nx)
        q_mode_total, curr_x = np.zeros(nx, dtype=np.bool_), 0.0
        
        # Grain arrays
        grain_a, grain_n = np.zeros(nx), np.zeros(nx)
        grain_S_m_factor, grain_h_st = np.zeros(nx), np.zeros(nx)

        for comp in components:
            if comp.type == "normal_shock": continue
            L = max(comp.params.get("length", 1.0), 1e-5)
            eps = np.min(dx_arr) * 1e-3
            mask_c, mask_i = (x >= curr_x-eps) & (x <= curr_x+L+eps), (x_int >= curr_x-eps) & (x_int <= curr_x+L+eps)
            if comp.type in ["convergent", "divergent"]:
                d_in, d_out = comp.params["d_in"], comp.params["d_out"]
                A[mask_c] = np.pi/4 * (d_in + (d_out-d_in)*(x[mask_c]-curr_x)/L)**2
                A_int[mask_i] = np.pi/4 * (d_in + (d_out-d_in)*(x_int[mask_i]-curr_x)/L)**2
            elif comp.type == "solid_grain":
                d_h = comp.params.get("d_h", 0.1)
                A[mask_c], A_int[mask_i] = np.pi/4*d_h**2, np.pi/4*d_h**2

                rho_s = comp.params.get("rho_b", 1800.0)
                A_b   = comp.params.get("A_b", 0.1)
                T_f   = comp.params.get("T_b", 3000.0)

                # Warn if A_b is inconsistent with cylindrical geometry (π·d_h·L)
                A_b_cyl = np.pi * d_h * L
                if A_b_cyl > 1e-12 and abs(A_b - A_b_cyl) / A_b_cyl > 0.5:
                    warnings.warn(
                        f"solid_grain: A_b={A_b:.4f} m^2 differs >50% from cylindrical estimate "
                        f"pi*d_h*L={A_b_cyl:.4f} m^2. Verify grain geometry."
                    )

                only_mass = comp.params.get("only_mass_addition", 0)
                if only_mass == 1:
                    target_mdot = comp.params.get("target_mass_flow", 2.0)
                    a_coeff = target_mdot / (rho_s * A_b) if (rho_s * A_b) > 0 else 0.0
                    n_exp = 0.0
                else:
                    a_coeff = comp.params.get("a_coeff", 0.02)
                    n_exp   = comp.params.get("n", 0.5)
                    if n_exp >= 1.0:
                        raise ValueError(
                            f"solid_grain: pressure exponent n={n_exp} >= 1 causes mesa-burning "
                            f"instability (positive pressure feedback). Use n < 1."
                        )

                grain_a[mask_c] = a_coeff
                grain_n[mask_c] = n_exp
                grain_S_m_factor[mask_c] = (rho_s * A_b) / L
                # h_st = cp·T_f (specific enthalpy of combustion products at flame temperature)
                grain_h_st[mask_c] = (self.gamma * self.R / (self.gamma - 1)) * T_f
            else:
                d_h = comp.params.get("d_h", 0.1)
                A[mask_c], A_int[mask_i] = np.pi/4*d_h**2, np.pi/4*d_h**2
                if comp.type == "fanno": f_fanning[mask_c] = comp.params["f"] / 4.0
                elif comp.type == "rayleigh":
                    if comp.params.get("heat_mode") == "total_specific":
                        delta_h0[mask_c], q_mode_total[mask_c] = comp.params["q"]/L, True
                    else: q_heat[mask_c] = comp.params["q"]/L
            curr_x += L
        
        D = np.sqrt(4*A/np.pi)

        # Adaptive temporal relaxation for grain source: higher n → smaller factor for stability
        max_n = float(np.max(grain_n)) if np.any(grain_n > 0) else 0.0
        if max_n < 0.3:
            grain_relax = 0.3
        elif max_n < 0.7:
            grain_relax = 0.1
        else:
            grain_relax = 0.05

        # --- 1. ESECUZIONE GAS IDEALE (Sempre eseguita) ---
        U_id = np.zeros((3, nx))
        rho_init_id, u_init_id = P0_in / (self.R * T0_in), 10.0
        U_id[0, :] = rho_init_id * A
        U_id[1, :] = rho_init_id * u_init_id * A
        U_id[2, :] = (P0_in / (self.gamma - 1) + 0.5 * rho_init_id * u_init_id**2) * A
        
        U_f_id, F_f_id = cfd_core_loop(U_id, A, A_int, f_fanning, q_heat, delta_h0, q_mode_total, D,
                                        grain_a, grain_n, grain_S_m_factor, grain_h_st,
                                        dx_arr, nx, self.gamma, self.R, max_iter, tol, P0_in, T0_in, P_amb,
                                        grain_relax)
        
        rho_id, u_id = U_f_id[0,:]/A, U_f_id[1,:]/U_f_id[0,:]
        p_id = np.maximum((self.gamma-1)*(U_f_id[2,:]/A - 0.5*rho_id*u_id**2), 1e-5)
        M_id, T_id = u_id/np.sqrt(self.gamma*p_id/rho_id), p_id/(rho_id*self.R)
        T0_id, P0_id = T_id*(1+0.5*(self.gamma-1)*M_id**2), p_id*(T_id*(1+0.5*(self.gamma-1)*M_id**2)/T_id)**(self.gamma/(self.gamma-1))
        mdot_f_id = U_f_id[1, :]
        mass_error = np.std(mdot_f_id) / (np.mean(mdot_f_id) + 1e-10) * 100
        
        # --- Smooth Analytical Mass Flow for Plotting ---
        mdot_smooth_id = np.zeros(nx)
        mdot_in_id = np.median(mdot_f_id[:max(1, nx//10)])
        mdot_smooth_id[0] = mdot_in_id
        for i in range(1, nx):
            i_prev, i_next = max(0, i-1), min(nx-1, i+1)
            p_s = 0.25 * p_id[i_prev] + 0.5 * p_id[i] + 0.25 * p_id[i_next]
            S_m = grain_S_m_factor[i] * grain_a[i] * (p_s/1e6)**grain_n[i]
            mdot_smooth_id[i] = mdot_smooth_id[i-1] + S_m * dx_arr[i]
        
        def s(arr): return np.nan_to_num(arr, nan=0.0).tolist()
        
        # Miglioramento Diagnostica
        num_shocks = 0
        shock_locs = []
        for i in range(1, nx):
            if M_id[i-1] > 1.01 and M_id[i] < 0.99:
                num_shocks += 1
                shock_locs.append(float(x[i]))

        results = {
            "x": x.tolist(), 
            "mach": s(M_id), 
            "pressure": s(p_id), 
            "pressure_total": s(P0_id), 
            "temperature": s(T_id), 
            "temperature_total": s(T0_id), 
            "mass_flow": s(mdot_smooth_id), 
            "diagnostics": {
                "choked": bool(np.max(np.abs(M_id)) > 0.98), 
                "num_normal_shocks": num_shocks,
                "sup_to_sub_transitions_x": shock_locs,
                "mass_flow_conserved": bool(mass_error < 1.0),
                "mass_flow_variation_pct": float(mass_error),
                "gas_model": "ideal"
            }
        }

        # --- 2. ESECUZIONE GAS REALE (Eseguita in parallelo se l'utente la seleziona) ---
        if self.is_real:
            cv = self.gas.cv
            a_vdw = self.gas.a
            b_vdw = self.gas.b

            U_re = np.zeros((3, nx))
            # Use VdW approximation: ρ ≈ P / (RT + P·b) to be consistent with inlet BC
            rho_init_re = max(P0_in / (self.R * T0_in + P0_in * b_vdw), 1e-6)
            E_init_re = rho_init_re * (cv * T0_in - a_vdw * rho_init_re) + 0.5 * rho_init_re * u_init_id**2

            U_re[0, :] = rho_init_re * A
            U_re[1, :] = rho_init_re * u_init_id * A
            U_re[2, :] = E_init_re * A

            # VdW-corrected grain injection enthalpy: h = cv·T - a·ρ_f + RT/(1-ρ_f·b)
            grain_h_st_re = grain_h_st.copy()
            for i in range(nx):
                if grain_S_m_factor[i] > 0.0:
                    T_f_i = grain_h_st[i] / (self.gamma * self.R / (self.gamma - 1))
                    rho_f = max(P0_in / (self.R * T_f_i + P0_in * b_vdw), 1e-6)
                    denom = max(1.0 - rho_f * b_vdw, 1e-10)
                    grain_h_st_re[i] = cv * T_f_i - a_vdw * rho_f + self.R * T_f_i / denom

            U_f_re, F_f_re = cfd_core_loop_real_gas(U_re, A, A_int, f_fanning, q_heat, delta_h0, q_mode_total, D,
                                                   grain_a, grain_n, grain_S_m_factor, grain_h_st_re,
                                                   dx_arr, nx, self.R, cv, a_vdw, b_vdw, max_iter, tol, P0_in, T0_in, P_amb,
                                                   grain_relax)
            p_re, T_re, M_re = post_process_real_gas(U_f_re, A, self.R, cv, a_vdw, b_vdw)
            
            gamma_eff = (cv + self.R) / cv
            T0_re = T_re * (1 + 0.5 * (gamma_eff - 1) * M_re**2)
            P0_re = p_re * (T0_re / T_re)**(gamma_eff / (gamma_eff - 1))
            mdot_f_re = U_f_re[1, :]
            
            # --- Smooth Analytical Mass Flow for Plotting (Real Gas) ---
            mdot_smooth_re = np.zeros(nx)
            mdot_in_re = np.median(mdot_f_re[:max(1, nx//10)])
            mdot_smooth_re[0] = mdot_in_re
            for i in range(1, nx):
                i_prev, i_next = max(0, i-1), min(nx-1, i+1)
                p_s = 0.25 * p_re[i_prev] + 0.5 * p_re[i] + 0.25 * p_re[i_next]
                S_m = grain_S_m_factor[i] * grain_a[i] * (p_s/1e6)**grain_n[i]
                mdot_smooth_re[i] = mdot_smooth_re[i-1] + S_m * dx_arr[i]
            
            results["real"] = {
                "mach": s(M_re),
                "pressure": s(p_re),
                "pressure_total": s(P0_re),
                "temperature": s(T_re),
                "temperature_total": s(T0_re),
                "mass_flow": s(mdot_smooth_re)
            }
            results["diagnostics"]["gas_model"] = "ideal + real (Van der Waals)"

        return results
