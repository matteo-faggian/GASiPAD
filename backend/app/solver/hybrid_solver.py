"""
Iterative 1D Gasdynamic Solver - Hybrid Edition HYBRID SOLVER
================================================

Architecture:
  - solve_full_pipeline(): API-compatible entry point. Internally delegates
    to the GeneralSolver1D (Roe + MUSCL CFD core), then post-processes the
    high-resolution field into a list of per-component result dictionaries
    that match the legacy format expected by the frontend.

  - generate_plot_data(): Returns the high-resolution spatial profiles
    directly from the CFD solution, plus boundary markers between components.

Backwards Compatibility:
  All public function signatures (solve_full_pipeline, generate_plot_data)
  and return shapes are preserved so the existing FastAPI/React frontend
  works without modification.
"""

import numpy as np
import copy
from typing import List, Dict, Tuple, Any, Optional

from app.models import ComponentConfig
from app.solver.gas import GasProperties
from app.solver.general_solver import GeneralSolver1D
from app.solver.isentropic import (
    pressure_ratio, temperature_ratio
)


# ===========================================================================
# Exception (kept for backwards compatibility with callers)
# ===========================================================================

class ChokedError(Exception):
    """Raised when a component chokes the flow (legacy compatibility)."""
    pass


# ===========================================================================
# Helpers: map CFD field back onto component segments
# ===========================================================================

def _component_boundaries(components: List[ComponentConfig]) -> List[float]:
    """Compute cumulative x-positions at each component interface."""
    boundaries = [0.0]
    cx = 0.0
    for comp in components:
        L = comp.params.get("length", 1.0) if comp.type not in ["normal_shock"] else 0.0
        cx += L
        boundaries.append(cx)
    return boundaries


def _slice_field_at(x_arr: np.ndarray, field: np.ndarray, x_target: float) -> float:
    """Linear interpolation of a field at a target x-coordinate."""
    if x_target <= x_arr[0]:
        return float(field[0])
    if x_target >= x_arr[-1]:
        return float(field[-1])
    return float(np.interp(x_target, x_arr, field))


def _build_component_results(
    components: List[ComponentConfig],
    cfd_data: Dict[str, Any],
    gas: GasProperties
) -> List[Dict[str, Any]]:
    """
    Convert the high-resolution CFD field into a list of per-component
    dictionaries matching the legacy format produced by evaluate_pipeline().
    """
    x = np.asarray(cfd_data["x"])
    M = np.asarray(cfd_data["mach"])
    P = np.asarray(cfd_data["pressure"])
    T = np.asarray(cfd_data["temperature"])
    P0 = np.asarray(cfd_data["pressure_total"])
    T0 = np.asarray(cfd_data["temperature_total"])

    boundaries = _component_boundaries(components)
    results = []

    for i, comp in enumerate(components):
        x_in, x_out = boundaries[i], boundaries[i + 1]

        # Sample CFD field at component interfaces
        M_in  = _slice_field_at(x, M,  x_in)
        M_out = _slice_field_at(x, M,  x_out)
        P_in_static  = _slice_field_at(x, P, x_in)
        P_out_static = _slice_field_at(x, P, x_out)
        T_in_static  = _slice_field_at(x, T, x_in)
        T_out_static = _slice_field_at(x, T, x_out)
        P0_in  = _slice_field_at(x, P0, x_in)
        P0_out = _slice_field_at(x, P0, x_out)
        T0_in  = _slice_field_at(x, T0, x_in)
        T0_out = _slice_field_at(x, T0, x_out)

        # Areas
        if comp.type in ["convergent", "divergent"]:
            A_in  = gas.area_from_diameter(comp.params["d_in"])
            A_out = gas.area_from_diameter(comp.params["d_out"])
        elif comp.type in ["fanno", "rayleigh"]:
            A_in  = gas.area_from_diameter(comp.params["d_h"])
            A_out = A_in
        else:  # normal_shock, solid_grain, or unknown
            A_in = A_out = 1.0

        # Detect "choked inside": Mach crosses 1 within this segment
        mask = (x >= x_in) & (x <= x_out)
        choked_inside = bool(np.any(np.abs(M[mask]) >= 0.99)) if np.any(mask) else False

        results.append({
            "M_in": M_in,
            "M_out": M_out,
            "P0_in": P0_in,
            "P0_out": P0_out,
            "T0_in": T0_in,
            "T0_out": T0_out,
            "P_out": P_out_static,
            "T_out": T_out_static,
            "A_in": A_in,
            "A_out": A_out,
            "choked_inside": choked_inside,
        })

    return results


def _classify_warnings(diagnostics: Dict[str, Any]) -> List[str]:
    """Translate CFD diagnostics into human-readable warnings (legacy style)."""
    warnings = []

    if diagnostics.get("choked", False):
        warnings.append("Flow is choked.")

    n_shocks = diagnostics.get("num_normal_shocks", 0)
    if n_shocks > 0:
        locs = diagnostics.get("sup_to_sub_transitions_x", [])
        loc_str = ", ".join(f"x={x:.4f} m" for x in locs)
        warnings.append(f"Normal shock(s) detected inside the pipeline at: {loc_str}")

    n_sonic = diagnostics.get("num_sonic_passages", 0)
    if n_sonic > 1:
        warnings.append(
            f"Multiple sonic passages detected ({n_sonic}). "
            "Possible thermal/friction throat downstream of physical throat."
        )

    regime = diagnostics.get("nozzle_regime", "")
    if regime == "supersonic_exit":
        warnings.append("Supersonic exit detected (under/correctly expanded).")
    elif regime == "shock_in_diverging":
        warnings.append("Overexpanded nozzle: normal shock inside divergent.")

    if not diagnostics.get("mass_flow_conserved", True):
        var = diagnostics.get("mass_flow_variation_pct", 0.0)
        warnings.append(
            f"Mass flow conservation residual: {var:.2f}%. "
            "Solution may need finer grid or more iterations."
        )

    P0_loss = diagnostics.get("P0_loss_percent", 0.0)
    if P0_loss > 50.0:
        warnings.append(f"Large stagnation pressure loss: {P0_loss:.1f}%.")

    return warnings


# ===========================================================================
# Main solver driver (API-compatible wrapper around GeneralSolver1D)
# ===========================================================================

def solve_full_pipeline(
    components: List[ComponentConfig],
    P0_in: float,
    T0_in: float,
    P_amb: float,
    gas: GasProperties,
    request_hash: str,
    nx: int = 400,
    max_iter: int = 150000,
    tol: float = 1e-7,
) -> Tuple[List[Dict[str, Any]], List[str], List[ComponentConfig]]:
    """
    Solve the 1D flow pipeline using the Roe+MUSCL CFD core.

    Maintains the legacy (results, warnings, final_components) return shape
    so the FastAPI endpoint and React frontend keep working unchanged.
    """
    warnings = []

    # 1. Sanity checks (preserve legacy behaviour)
    if T0_in <= 1e-6:
        warnings.append("Stagnation temperature near absolute zero. Returning stagnant flow.")
        return _zero_flow_results(components, P0_in, T0_in, gas), warnings, components

    if P_amb >= P0_in - 1e-3:
        warnings.append("Inlet and outlet pressures are equal - no flow.")
        return _zero_flow_results(components, P0_in, T0_in, gas), warnings, components

    # 2. Run CFD core (Roe/MUSCL solver)
    # The GeneralSolver1D builds the governing equations dynamically from the
    # component pipeline: area profiles for nozzles, friction for Fanno,
    # heat source for Rayleigh, mass source for solid grain.
    solver = GeneralSolver1D(gas, nx=nx)
    try:
        cfd_data = solver.solve(
            components=components,
            P0_in=P0_in,
            T0_in=T0_in,
            P_amb=P_amb,
            max_iter=max_iter,
            tol=tol,
        )
    except Exception as e:
        warnings.append(f"CFD solver failure: {str(e)}. Returning stagnant fallback.")
        return _zero_flow_results(components, P0_in, T0_in, gas), warnings, components


    # 3. Map CFD field back into per-component summaries
    results = _build_component_results(components, cfd_data, gas)

    # 4. Translate CFD diagnostics into legacy-style warnings
    warnings.extend(_classify_warnings(cfd_data["diagnostics"]))
    
    # Explain why the ideal analytical choking pressure in the UI doesn't perfectly match the CFD behavior
    if not cfd_data["diagnostics"].get("choked", False):
        warnings.append(
            "Note: The Computational solver experiences numerical dissipation (simulating real viscous losses). "
            "This naturally lowers the actual required choking backpressure compared to the Ideal Analytical limit shown."
        )

    # Memory management: Clear cache if it grows too large to prevent leaks
    if len(_PLOT_CACHE) > 50:
        _PLOT_CACHE.clear()

    # Stash the raw CFD data so generate_plot_data can reuse it without
    # re-running the solver. We attach it to a module-level cache keyed by
    # a unique hash to avoid Python id() memory reuse collisions.
    _PLOT_CACHE[request_hash] = cfd_data

    return results, warnings, components


# ===========================================================================
# Plot data generation (returns the CFD field directly)
# ===========================================================================

    # Cache keyed by uuid to avoid consecutive calls re-running CFD.
_PLOT_CACHE: Dict[str, Dict[str, Any]] = {}

def generate_plot_data(
    components: List[ComponentConfig],
    results: List[Dict[str, Any]],
    gas: GasProperties,
    request_hash: str,
    num_points: int = 50,
) -> Tuple[Dict[str, List[float]], List[float], List[str]]:
    """
    Return high-resolution plotting arrays (x, M, P, T, P0, T0, mass_flow)
    plus component boundary x-positions and labels.

    If a CFD solution has already been computed for this components list
    (via solve_full_pipeline), it is reused. Otherwise, a fresh CFD run is
    triggered using stagnation conditions inferred from the first result.
    """
    cfd_data = _PLOT_CACHE.get(request_hash)

    if cfd_data is None:
        # Fallback: run CFD using results[0] as boundary conditions
        if not results:
            return _empty_plot_data(), [0.0]

        P0_in = results[0]["P0_in"]
        T0_in = results[0]["T0_in"]
        P_amb = results[-1]["P_out"]
        solver = GeneralSolver1D(gas, nx=max(500, num_points * len(components)))
        try:
            cfd_data = solver.solve(components, P0_in, T0_in, P_amb)
        except Exception:
            return _empty_plot_data(), _component_boundaries(components)

    boundaries = _component_boundaries(components)

    gamma = gas.gamma
    p_star_ratio = (2 / (gamma + 1)) ** (gamma / (gamma - 1))
    
    data = {
        "x":                cfd_data["x"],
        "mach":             cfd_data["mach"],
        "pressure":         cfd_data["pressure"],
        "pressure_total":   cfd_data["pressure_total"],
        "pressure_critical": [p0 * p_star_ratio for p0 in cfd_data["pressure_total"]],
        "temperature":      cfd_data["temperature"],
        "temperature_total": cfd_data["temperature_total"],
        "mass_flow":        cfd_data["mass_flow"],
    }
    if "real" in cfd_data:
        data["real"] = cfd_data["real"]
        if "pressure_total" in data["real"]:
            data["real"]["pressure_critical"] = [p0 * p_star_ratio for p0 in data["real"]["pressure_total"]]
        
    # Generate human-readable labels for components
    labels = []
    for comp in components:
        label = comp.type.replace("_", " ").title()
        labels.append(label)

    return data, boundaries, labels


# ===========================================================================
# Internal utilities
# ===========================================================================

def _zero_flow_results(
    components: List[ComponentConfig],
    P0_in: float,
    T0_in: float,
    gas: GasProperties,
) -> List[Dict[str, Any]]:
    """Build a stagnant-flow result list (no flow case)."""
    results = []
    for comp in components:
        if comp.type in ["convergent", "divergent"]:
            A_in = gas.area_from_diameter(comp.params["d_in"])
            A_out = gas.area_from_diameter(comp.params["d_out"])
        elif comp.type in ["fanno", "rayleigh"]:
            A_in = gas.area_from_diameter(comp.params["d_h"])
            A_out = A_in
        else:
            A_in = A_out = 1.0

        results.append({
            "M_in": 0.0, "M_out": 0.0,
            "P0_in": P0_in, "P0_out": P0_in,
            "T0_in": T0_in, "T0_out": T0_in,
            "P_out": P0_in, "T_out": T0_in,
            "A_in": A_in, "A_out": A_out,
            "choked_inside": False,
        })
    return results


def _empty_plot_data() -> Dict[str, List[float]]:
    return {
        "x": [], "mach": [], "pressure": [], "pressure_total": [],
        "temperature": [], "temperature_total": [], "mass_flow": [],
        "diagnostics": {"choked": False, "num_normal_shocks": 0}
    }


# ===========================================================================
# Legacy stubs (kept so any old code that imports them still works)
# ===========================================================================

def evaluate_component(*args, **kwargs):
    """Deprecated: use solve_full_pipeline instead."""
    raise NotImplementedError(
        "evaluate_component() is deprecated. "
        "The CFD core handles all components globally via solve_full_pipeline()."
    )


def evaluate_pipeline(*args, **kwargs):
    """Deprecated: use solve_full_pipeline instead."""
    raise NotImplementedError(
        "evaluate_pipeline() is deprecated. Use solve_full_pipeline()."
    )


def find_choked_inlet_mach(*args, **kwargs):
    """Deprecated: choking is detected automatically by the CFD core."""
    raise NotImplementedError(
        "find_choked_inlet_mach() is deprecated. "
        "Choking is now detected via diagnostics['choked'] in the CFD output."
    )


def split_pipeline_at_x(*args, **kwargs):
    """Deprecated: shocks are captured naturally by the CFD core."""
    raise NotImplementedError(
        "split_pipeline_at_x() is deprecated. "
        "Normal shocks are captured automatically by the Roe scheme."
    )
