import numpy as np
from numba import njit, prange
from typing import List, Dict, Tuple, Any
from app.models import ComponentConfig
from app.solver.gas import GasProperties

# Funzioni accelerate con Numba JIT
@njit(fastmath=True)
def roe_flux_numba_fixed(rhoL, uL, pL, rhoR, uR, pR, A_int, gamma):
    HL = (gamma * pL / ((gamma - 1) * rhoL)) + 0.5 * uL**2
    HR = (gamma * pR / ((gamma - 1) * rhoR)) + 0.5 * uR**2
    
    sqL, sqR = np.sqrt(rhoL), np.sqrt(rhoR)
    u_roe = (sqL * uL + sqR * uR) / (sqL + sqR)
    H_roe = (sqL * HL + sqR * HR) / (sqL + sqR)
    a_roe = np.sqrt(max((gamma - 1) * (H_roe - 0.5 * u_roe**2), 1e-12))
    
    FL = np.array([rhoL * uL, rhoL * uL**2 + pL, rhoL * uL * HL]) * A_int
    FR = np.array([rhoR * uR, rhoR * uR**2 + pR, rhoR * uR * HR]) * A_int
    
    lambdas = np.array([u_roe, u_roe + a_roe, u_roe - a_roe])
    delta = 0.4 * a_roe
    abs_lambdas = np.zeros(3)
    for i in range(3):
        if abs(lambdas[i]) < delta:
            abs_lambdas[i] = (lambdas[i]**2 + delta**2) / (2 * delta)
        else:
            abs_lambdas[i] = abs(lambdas[i])
            
    du, dp, drho = uR - uL, pR - pL, rhoR - rhoL
    rho_roe = sqL * sqR
    alpha = np.array([
        drho - dp / a_roe**2,
        (dp + rho_roe * a_roe * du) / (2 * a_roe**2),
        (dp - rho_roe * a_roe * du) / (2 * a_roe**2)
    ])
    
    diss = np.zeros(3)
    # Wave 1
    diss[0] += abs_lambdas[0] * alpha[0]
    diss[1] += abs_lambdas[0] * alpha[0] * u_roe
    diss[2] += abs_lambdas[0] * alpha[0] * (0.5 * u_roe**2)
    # Wave 2
    diss[0] += abs_lambdas[1] * alpha[1]
    diss[1] += abs_lambdas[1] * alpha[1] * (u_roe + a_roe)
    diss[2] += abs_lambdas[1] * alpha[1] * (H_roe + u_roe * a_roe)
    # Wave 3
    diss[0] += abs_lambdas[2] * alpha[2]
    diss[1] += abs_lambdas[2] * alpha[2] * (u_roe - a_roe)
    diss[2] += abs_lambdas[2] * alpha[2] * (H_roe - u_roe * a_roe)
    
    return (0.5 * (FL + FR) - 0.5 * diss * A_int)

@njit(parallel=True, fastmath=True)
def cfd_core_loop(U, A, A_int, f_fanning, q_heat, delta_h0, q_mode_total, D, dx, nx, gamma, R, max_iter, tol, P0_in, T0_in, P_amb):
    U_curr = U.copy()
    U_new = U.copy()
    
    rho = np.zeros(nx)
    u = np.zeros(nx)
    p = np.zeros(nx)
    a = np.zeros(nx)
    F_int = np.zeros((3, nx + 1))
    
    for it in range(max_iter):
        for i in prange(nx):
            rho[i] = U_curr[0, i] / A[i]
            if rho[i] < 1e-6:
                rho[i] = 1e-6
                U_curr[0, i] = rho[i] * A[i]
            
            u[i] = U_curr[1, i] / U_curr[0, i]
            
            p[i] = (gamma - 1) * (U_curr[2, i] / A[i] - 0.5 * rho[i] * u[i]**2)
            if p[i] < 1e-5:
                p[i] = 1e-5
                U_curr[2, i] = (p[i] / (gamma - 1) + 0.5 * rho[i] * u[i]**2) * A[i]
                
            a[i] = np.sqrt(gamma * p[i] / rho[i])
        
        # BC Inlet
        u_in = max(u[0], 1e-6)
        Cp = gamma * R / (gamma - 1.0)
        T_in = T0_in - 0.5 * u_in**2 / Cp
        if T_in < 1.0: 
            T_in = 1.0
        tau_in = T0_in / T_in
        rho_in = P0_in / (R * T0_in) * (tau_in)**(-1.0/(gamma-1.0))
        p_in = P0_in * (tau_in)**(-gamma/(gamma-1.0))
        F_int[:, 0] = roe_flux_numba_fixed(rho_in, u_in, p_in, rho[0], u[0], p[0], A_int[0], gamma)
        
        # BC Outlet
        p_out = P_amb if u[nx-1] < a[nx-1] else p[nx-1]
        F_int[:, nx] = roe_flux_numba_fixed(rho[nx-1], u[nx-1], p[nx-1], rho[nx-1], u[nx-1], p_out, A_int[nx], gamma)
        
        # Internal Fluxes
        for i in prange(1, nx):
            F_int[:, i] = roe_flux_numba_fixed(rho[i-1], u[i-1], p[i-1], rho[i], u[i], p[i], A_int[i], gamma)
            
        # Time step
        max_ws = 1e-6
        for i in range(nx):
            ws = abs(u[i]) + a[i]
            if ws > max_ws: max_ws = ws
        dt = 0.4 * dx / max_ws
        
        # Update
        for i in prange(nx):
            s2 = p[i] * (A_int[i+1] - A_int[i]) / dx - 2.0 * f_fanning[i] * rho[i] * abs(u[i]) * u[i] * A[i] / D[i]
            s3 = rho[i] * abs(u[i]) * (delta_h0[i] if q_mode_total[i] else q_heat[i]) * A[i]
                
            U_new[0, i] = U_curr[0, i] - (dt/dx) * (F_int[0, i+1] - F_int[0, i])
            U_new[1, i] = U_curr[1, i] - (dt/dx) * (F_int[1, i+1] - F_int[1, i]) + dt * s2
            U_new[2, i] = U_curr[2, i] - (dt/dx) * (F_int[2, i+1] - F_int[2, i]) + dt * s3
            
        # Convergence Check (Sistemato per Numba)
        if it % 1000 == 0:
            err = 0.0
            norm = 0.0
            for i in range(nx):
                err += abs(U_new[0, i] - U_curr[0, i])
                norm += abs(U_curr[0, i])
            if err / (norm + 1e-12) < tol:
                break
                
        U_curr[:] = U_new[:]
        
    return U_curr

class GeneralSolver1D:
    def __init__(self, gas: GasProperties, nx: int = 1000):
        self.gas = gas
        self.nx = nx
        self.gamma = gas.gamma
        self.R = gas.R

    def solve(self, components, P0_in, T0_in, P_amb, max_iter=100000, tol=1e-8):
        total_L = sum(c.params.get("length", 1.0) for c in components if c.type != "normal_shock")
        dx = total_L / self.nx
        x = np.linspace(dx/2, total_L - dx/2, self.nx)
        x_int = np.linspace(0, total_L, self.nx + 1)
        A_int = np.zeros(self.nx + 1)
        A, f_fanning, q_heat, delta_h0 = np.zeros(self.nx), np.zeros(self.nx), np.zeros(self.nx), np.zeros(self.nx)
        q_mode_total = np.zeros(self.nx, dtype=np.bool_)

        curr_x = 0.0
        for comp in components:
            if comp.type == "normal_shock":
                continue
            L = max(comp.params.get("length", 1.0), 1e-5)
            eps = dx * 1e-3
            mask_c = (x >= curr_x - eps) & (x <= curr_x + L + eps)
            mask_i = (x_int >= curr_x - eps) & (x_int <= curr_x + L + eps)
            if comp.type in ["convergent", "divergent"]:
                d_in, d_out = comp.params["d_in"], comp.params["d_out"]
                A[mask_c] = np.pi/4 * (d_in + (d_out-d_in)*(x[mask_c]-curr_x)/L)**2
                A_int[mask_i] = np.pi/4 * (d_in + (d_out-d_in)*(x_int[mask_i]-curr_x)/L)**2
            else:
                d_h = comp.params["d_h"]
                A[mask_c], A_int[mask_i] = np.pi/4*d_h**2, np.pi/4*d_h**2
                if comp.type == "fanno":
                    f_fanning[mask_c] = comp.params["f"] / 4.0
                elif comp.type == "rayleigh":
                    if comp.params.get("heat_mode") == "total_specific":
                        delta_h0[mask_c] = comp.params["q"] / L
                        q_mode_total[mask_c] = True
                    else:
                        q_heat[mask_c] = comp.params["q"] / L
            curr_x += L
        D = np.sqrt(4*A/np.pi)

        U = np.zeros((3, self.nx))
        rho_init = P0_in / (self.R * T0_in)
        u_init = 10.0
        U[0, :] = rho_init * A
        U[1, :] = rho_init * u_init * A 
        U[2, :] = (P0_in / (self.gamma - 1) + 0.5 * rho_init * u_init**2) * A

        U_final = cfd_core_loop(U, A, A_int, f_fanning, q_heat, delta_h0, q_mode_total, D, dx, self.nx, self.gamma, self.R, max_iter, tol, P0_in, T0_in, P_amb)

        rho = U_final[0, :] / A
        u = U_final[1, :] / U_final[0, :]
        p = (self.gamma - 1) * (U_final[2, :] / A - 0.5 * rho * u**2)
        M = u / np.sqrt(self.gamma * p / rho)
        T = p / (rho * self.R)
        T0 = T * (1 + 0.5*(self.gamma-1)*M**2)
        P0 = p * (T0/T)**(self.gamma/(self.gamma-1))

        def s(arr):
            return np.nan_to_num(arr, nan=0.0).tolist()

        return {
            "x": x.tolist(), "mach": s(M), "pressure": s(p),
            "pressure_total": s(P0), "temperature": s(T),
            "temperature_total": s(T0), "mass_flow": s(rho*u*A),
            "diagnostics": {"choked": bool(np.max(np.abs(M)) > 0.99), "num_normal_shocks": 0}
        }
