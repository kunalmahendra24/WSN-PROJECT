# WSN Simulator — CLAUDE.md

## Project Overview

**Full-stack Wireless Sensor Network (WSN) Simulator** using a Voronoi–Delaunay Hybrid Model.
Simulates sensor node placement, network coverage, energy consumption, and battery lifetime.

- **Frontend:** React 18 + Vite 5 (`frontend/`)
- **Backend:** Node.js + Express + MongoDB (`backend/`)
- **Dev server:** `npm run dev` from root (runs both via `concurrently`)
  - Frontend: http://localhost:5173
  - Backend: http://localhost:5001

## Architecture Diagram

- **File:** `WSN_project_F2.excalidraw` (root of repo)
- **Live link:** https://excalidraw.com/#json=ec4u2RbomCSYBDHVpfPSb,7d0OHGC1cLK9N19O3ERJbw
- Covers: Frontend flow, Backend API routes, MongoDB collections, Energy Model, all 4 algorithms

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/services/simulationService.js` | Core simulation engine — algorithms for API route (`/api/simulate`) |
| `frontend/src/App.jsx` | Main React component — state, canvas render, simulation logic, UI |
| `frontend/src/utils/algorithms.js` | Reusable algorithm library (Delaunay, Voronoi, constants) |
| `backend/routes/simulation.js` | API routes for simulation |
| `backend/routes/auth.js` | JWT auth routes |
| `frontend/vite.config.js` | Vite config — proxies `/api` → `http://localhost:5001` |
| `backend/image/` | Reference screenshots (1.png–7.png) |
| `WSN_project_F2.excalidraw` | Architecture & algorithm flow diagram |

> `indoorRenderer.js` and `outdoorRenderer.js` are no longer used. All rendering is done directly in `App.jsx` via a single `draw()` function on `canvasRef`.

---

## Architecture

### Modes
- **Indoor:** Canvas-based, pixel coordinates, log-distance path loss
- **Outdoor:** Same canvas (no tile map), free-space path loss — only propagation constant differs

### Algorithms
1. **Delaunay Triangulation** (Bowyer-Watson) — network connectivity topology
2. **Voronoi Diagram** (dual of Delaunay) — coverage region visualization
3. **Discrete Lloyd's Relaxation** — Hybrid node placement: each grid cell assigned to nearest node, node moves to centroid of its territory (20 iterations)
4. **BFS Connectivity Check** — verifies all nodes reachable via in-range edges only
5. **Grid-Sampling Coverage** — `calcCov()` samples a grid to compute union of sensor circles (avoids double-counting overlaps)
6. **Energy Model** — E_tx + E_rx + E_idle per round (academic standard values)
7. **Battery Simulation** — 400-day simulation with per-node variance

### Node Placement
- **Hybrid only** — Random/Grid/Manual have been removed. Only Hybrid placement exists.
- `const [placement] = useState("Hybrid")` — no setter, fixed value.

**Two Hybrid implementations (diverged — see Known Issues):**

| Location | Algorithm | Iterations |
|---|---|---|
| `App.jsx` (frontend) | Discrete Lloyd's Relaxation — grid centroid, 60% lerp | 20 iters, stores `iterHistory` |
| `simulationService.js` (backend API) | Repulsion-based forces — push nodes apart by `minD` | 80 iters, no history |

- Frontend default display: best iteration (highest coverage). Slider lets user scrub through all iterations.
- Backend `minD = sqrt(W×H / N) × 0.65` — target minimum spacing between nodes.
- Nodes clamped to `[5%, 95%]` of area in both implementations.

### Visualization Overlay Options (`ov` state)
- `voronoi` — Voronoi cells only
- `delaunay` — Delaunay edges only
- `hybrid` — Voronoi + Delaunay + Coverage together
- `coverage` — sensor range circles only

### Canvas Rendering (`draw()`)
- Single `canvasRef` used for both Indoor and Outdoor (no tile map).
- Purple solid lines = in-range Delaunay edges (`dist ≤ commRange`)
- Red dashed lines + "✗" label = out-of-range edges
- Dashed blue `strokeRect` = area boundary with "W×H" label top-left
- Env label top-right: "Indoor" or "Outdoor"

---

## Edge Format

All edges are objects `{ a, b, dist, inRange }` — NOT `[a, b]` arrays.

```js
const ed = allEd.map(([a, b]) => {
  const d = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
  return { a, b, dist: d, inRange: d <= commRange };
});
```

Always use `e.a` / `e.b` — never destructure as `[a, b]`. BFS connectivity only traverses `e.inRange === true` edges.

---

## Communication Range

`commRange = sR * 2` (2× sensor range). Computed in `finalize()` and passed into `recompute()`.

Edges beyond `commRange` are drawn as red dashed lines and excluded from BFS. This prevents "Connected ✓" being shown when nodes are physically too far for RF.

---

## Key State

```js
const [iterHistory, setIterHistory] = useState([]);  // [{iter, pts, edges, cells, coverage, connected, minDist}]
const [iterIdx, setIterIdx]         = useState(0);
const [iterPlaying, setIterPlaying] = useState(false);
const [loading, setLoading]         = useState(false);
const [placement]                   = useState("Hybrid"); // fixed, no setter
const bestIterRef                   = useRef(0);          // sync ref for best iteration index
```

Removed state: `cLat`, `cLng`, `outdoorRef`, `tileCache`, `mZoom`, `mDragS`, `mOff`

---

## Iteration Playback Flow

```
runSim → Discrete Lloyd's 20 iterations → history[] with metrics per iter
       → finalize(bestPts) → tsd (400-day battery sim)
       → setIterHistory(history) → useEffect triggers goToIter(bestIterRef.current)
       → canvas shows best iteration by default
```

`goToIter(idx)` updates `nodes`, `edgesArr`, `cellsArr` from `iterHistory[idx]`.
`playIters()` / `stopPlay()` animate through iterations at 600ms/frame via `setInterval`.

---

## Charts (4 graphs, tab="charts")

All data comes from `ts` state = `tsd` array built in `finalize()`:

```js
tsd.push({ day, alive, batt, cov, energy });
```

- `batt` — average battery % across alive nodes (real)
- `alive` — count of alive nodes (real)
- `cov` — `(alive/total) * covPct` (approximation: scales coverage by alive ratio)
- `energy` — `(1 - batt/100) * capacity` mAh consumed (real)

Charts drawn on `<canvas>` via custom `drawChart()` using canvas 2D API (no chart library).

---

## Recommendations Panel

Computed in `recs` array + `healthScore` from `met` state after simulation.

**Health Score (0–100):**
- Coverage: up to 40 pts → `(covPct/100) × 40`
- Connectivity: 30 pts → `conn ? 30 : 0`
- Battery: up to 20 pts → `min(battLife/400, 1) × 20`
- Spacing: 10 pts → ok=10, too-sparse=5, too-close=0

**6 categories with severity (ok/warn/err):**

| Category | ok | warn | err |
|---|---|---|---|
| Coverage | ≥95% | 80–95% | <80% |
| Connectivity | BFS connected | — | disconnected |
| Battery | ≥200 days | 60–200 days | <60 days |
| Placement | spacing in range | too close or too sparse | — |
| RF Signal | PL < 70 dB | PL ≥ 70 dB | — |
| Nodes | n ≥ req | n < req | — |

`req = ceil(totalArea / (π × sR² × 0.8))` — standard coverage formula.

---

## Drag Behavior

`iMove` (mousemove handler) recalculates `covPct` and `conn` on every drag step so metrics update live as nodes are repositioned.

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Register user |
| POST | `/api/auth/login` | No | Login, returns JWT |
| POST | `/api/simulate` | No | Run simulation |
| POST | `/api/save` | Yes | Save simulation result |
| GET | `/api/results/:id` | Yes | Load saved simulation |
| GET | `/api/history` | Yes | User's simulation history |

---

## Constants (Energy Model)

```
E_elec  = 50 nJ/bit      (electronics)
E_amp   = 100 pJ/bit/m²  (amplifier)
E_rx    = 50 nJ/bit      (receiving)
E_idle  = 10 nJ/bit      (idle)
packetSize = 4000 bits
```

## Sensors

| Type | Range | Power Factor |
|------|-------|-------------|
| Temperature | 15m | 1.0× |
| Humidity | 12m | 1.1× |
| Motion | 8m | 1.3× |

## Batteries

| Type | Voltage | Default Capacity |
|------|---------|-----------------|
| Li-ion | 3.7V | 3000 mAh |
| AA | 1.5V | 2500 mAh |
| Coin | 3.0V | 220 mAh |

---

## Data Flow

```
User configures → Run Simulation
  → random initial placement
  → Discrete Lloyd's (20 iters): each iter → recompute(pts, commRange) → store in history[]
  → pick best iter (highest coverage) → finalize(bestPts) → 400-day battery sim → tsd[]
  → setIterHistory / setTs / setMet → useEffect → goToIter(bestIdx) → draw()
```

---

## Known Issues

### Medium — Non-Deterministic RNG
- No seeded RNG — same config produces different layouts each run
- Fix: Implement Mulberry32 seeded RNG

### Medium — Hybrid Algorithm Divergence
- `simulationService.js` uses repulsion-based Hybrid (80 iters); `App.jsx` uses Discrete Lloyd's (20 iters)
- Results from the API endpoint differ from the frontend-rendered simulation
- Fix: Unify to one algorithm in `utils/algorithms.js`, import in both

### Low — Code Duplication
- Delaunay/Voronoi logic duplicated in `simulationService.js` and `App.jsx`
- Fix: Consolidate to `utils/algorithms.js` only

### Low — Coverage Approximation in Charts
- `cov` in `tsd` uses `(alive/total) * covPct` — not exact (dead node Voronoi cells still exist)
- Acceptable for academic use; exact fix requires re-running `calcCov` with alive-only nodes per day

### Low — `outdoorRenderer.js` still present but unused
- Safe to delete; all rendering moved to `draw()` in `App.jsx`
