# Dive Computer Simulator

A browser-based simulator that mimics a single-tank recreational dive computer. The left side of the interface visualizes real-time telemetry (depth, dive time, NDL, TTS, PO₂, gas remaining, etc.), while the right side provides controls to manipulate the dive environment and diver parameters.

## Getting started

```bash
# from the project root
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser to interact with the simulator.

## Features

- **Dynamic dive profile** – set a target depth (default 5 m) and ascent/descent rate; the simulated diver transitions toward the target while accumulating statistics once below 5 m.
- **Bühlmann-based tissue loading** – 16 nitrogen compartments update every simulation tick and derive a simplified no-decompression limit (NDL) using the selected gradient-factor high value.
- **Gas consumption model** – configure cylinder size, fill pressure, and O₂ fraction before the dive. Once the diver crosses 5 m, these controls lock, and remaining pressure updates automatically from surface SAC and workload.
- **Safety insights** – live PO₂, tank pressure gauge, ascent time (with optional safety-stop credit), and status banner for approaching limits.
- **Time control** – play/pause/reset buttons with 1× or 5× time scaling for quick scenarios.

## Key controls

| Group | Controls | Notes |
| --- | --- | --- |
| Environment | Target depth slider, ascent/descent rate, water temperature | Depth drives most calculations; temperature is informational for future hooks. |
| Gas & Cylinder | Cylinder size, fill pressure, O₂ fraction | Locked once the dive becomes active (depth ≥ 5 m). |
| Diver | Surface SAC, workload multiplier, gradient factors | Workload scales gas consumption; gradient factor high adjusts the conservative NDL estimate. |
| Simulation | Play/Pause/Reset, time scale | Reset returns to surface, refills the tank, and reinitializes tissue compartments. |

## Notes

- The Bühlmann implementation is intentionally simplified for educational visualization and should not be used for real dive planning.
- Future enhancements could include configurable depth scripting, logging/replay, and export functionality.
