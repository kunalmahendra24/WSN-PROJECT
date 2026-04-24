# WSN Simulator — Project Presentation

## What is a Wireless Sensor Network (WSN)?

A **Wireless Sensor Network** is a group of small battery-powered devices (called **sensor nodes**) placed in an area to monitor something — temperature, humidity, motion, etc. Each node senses data and sends it wirelessly to a base station or its neighbors.

**The core challenges are:**
1. **Coverage** — Do the sensors actually cover the entire area? No blind spots?
2. **Connectivity** — Can every node communicate with at least one other node to relay data?
3. **Battery Life** — Nodes are battery-powered. How long before they die?
4. **Placement** — Where should we physically put the nodes so all three goals are met optimally?

This simulator solves all four challenges together.

---

## What Does This Simulator Do?

The user inputs:
- Number of sensor nodes
- Area size (width × height, in meters)
- Environment type (Indoor or Outdoor)
- Sensor type (Temperature / Humidity / Motion)
- Battery type (Li-ion / AA / Coin cell)
- Transmission interval (how often each node sends data, in seconds)
- (Optional) Manual node positions (Optimize tab)

The simulator then:
1. Places the nodes optimally using an iterative algorithm
2. Builds a communication network between them
3. Calculates how much of the area is covered
4. Checks if all nodes can reach each other
5. Simulates 400 days of battery drain
6. Shows all results visually with charts and recommendations
7. (Optional) Lets the user manually place nodes and optimize them (before/after comparison)

---

## The Core Problem: Why Can't We Just Place Nodes Randomly?

If you place nodes randomly, some areas get 3–4 nodes very close together (wasted battery, overlapping coverage) while other areas get no nodes at all (blind spots). Random placement is **inefficient**.

We need an algorithm that spreads nodes **evenly** across the area so:
- No two nodes are wastefully close
- No area is left uncovered
- All nodes remain connected to the network

This is exactly what **Lloyd's Relaxation** achieves.

---

## Algorithm 1: Discrete Lloyd's Relaxation (Node Placement)

**What it does:** Starts with random node positions and iteratively moves every node to the "center of its territory" until the layout is optimal.

**Simple explanation:**

Think of the area as a city with `N` post offices. Each house (grid cell) goes to its nearest post office. After all houses are assigned, each post office relocates to the geographic center of all the houses it serves. Repeat this 20 times — the post offices spread out perfectly with no overlap.

**How it works in code:**

```
Step 1: Place all N nodes randomly in the area.

Step 2 (repeat 20 times):
  a. Divide the area into a fine grid of small cells.
  b. For each grid cell, find the nearest node — that node "owns" this cell.
  c. For each node, compute the centroid (average position) of all cells it owns.
  d. Move each node 60% of the way toward its centroid (smooth movement).

Step 3: After each iteration, measure coverage and connectivity.
Step 4: Pick the best iteration as the final result.
```

**Why Discrete (grid-based) and not Voronoi circumcenters?**

The classic Lloyd's algorithm uses Voronoi circumcenters to find centroids. But circumcenters can fall outside the area boundary, pulling nodes to wrong positions. The grid-based (Discrete) approach guarantees all centroids are always inside the valid area.

**Why 60% lerp (not 100% jump)?**
Jumping 100% to the centroid causes nodes to oscillate back and forth between iterations. Moving 60% gives smooth, stable convergence.

---

## Manual Placement → Optimization (Before/After)

In addition to the main simulation flow, the simulator includes an **Optimize** workflow:

1. **Manual placement**: the user clicks to place nodes (and can drag/right-click to adjust).
2. **Optimization**: the app sends the manual layout to the backend endpoint:

```
POST /api/optimize
```

3. **Result**: the backend returns **before** (manual) and **after** (optimized) results, and the UI renders them side-by-side with metric deltas (coverage, connectivity, battery life, spacing, path loss).

---

## Algorithm 2: Delaunay Triangulation (Network Topology)

**What it does:** Connects all nodes into a triangulated mesh that represents which nodes are neighbors in the network.

**Simple explanation:**

Given N points, Delaunay Triangulation draws triangles between them such that no point falls inside any triangle's circumscribed circle. This produces the "most equilateral" possible triangles — long thin triangles (which imply stretched, unreliable links) are avoided.

In the WSN context: the edges of the triangulation = the communication links between nodes.

**Algorithm used:** Bowyer-Watson incremental algorithm.

```
Start with one giant triangle that covers all nodes.
For each node, one by one:
  1. Find all triangles whose circumcircle contains this new node.
  2. Remove those triangles → this creates a polygonal hole.
  3. Connect the new node to every edge of the hole → new triangles.
Remove any triangles that share a vertex with the original supertriangle.
```

**Why Delaunay specifically?**
- Maximizes the minimum angle in all triangles → avoids poor-quality links
- Proven to be the "most natural" neighborhood graph for a set of points
- Its dual is the Voronoi diagram (used for coverage)

---

## Algorithm 3: Voronoi Diagram (Coverage Regions)

**What it does:** Divides the area into regions where each region belongs to exactly one node — the node closest to every point in that region.

**Simple explanation:**

Place 5 cities on a map. Draw boundaries so every house goes to the nearest city. The resulting regions are called Voronoi cells. Every point inside a cell is closer to its node than to any other node.

In the WSN context: the Voronoi cell of a node = the area that node is "responsible for" covering.

**Relationship to Delaunay:**

Voronoi and Delaunay are mathematical duals of each other. The Voronoi diagram is computed by finding the circumcenters of all Delaunay triangles and connecting them. So once we have Delaunay triangulation, we get Voronoi for free.

**Visualization:** Voronoi cells are drawn on the canvas so you can see exactly which part of the area each node covers.

---

## Communication Range Check

A Delaunay edge represents a potential link between two nodes. But just because two nodes are neighbors in the graph does not mean they can physically communicate — they might be too far apart.

**Communication range = 2 × sensor range**

Every edge is tagged:
- **In-range** (distance ≤ commRange) → drawn as a solid purple line → valid link
- **Out-of-range** (distance > commRange) → drawn as a red dashed line with "✗" → link cannot be used

The **BFS connectivity check** only uses in-range edges. This prevents the simulator from falsely reporting "Connected ✓" when nodes are geometrically connected in the graph but physically too far for RF communication.

---

## Coverage Calculation

**Wrong approach (what most naive simulators do):**

```
Coverage % = (N × π × r²) / Total Area × 100
```

This is wrong because it double-counts areas where sensor circles overlap. With 10 nodes all clustered together, this formula would report 200%+ coverage.

**Correct approach (Grid Sampling):**

```
Divide the area into a fine grid of small cells.
For each cell, check if ANY node's sensor circle covers it.
Coverage % = (cells covered by at least one node) / (total cells) × 100
```

This correctly handles all overlap — a cell covered by 3 nodes still counts as 1 covered cell. This is essentially computing the **union area** of all sensor circles.

---

## Path Loss Model

Radio signals weaken with distance. This simulator models that weakening using two standard models:

**Indoor (Log-Distance Path Loss):**
```
PL(d) = 40 + 10 × n × log₁₀(d) + W  dB
```
- `n` = path loss exponent (2.0 for open space, 3.5 for office)
- `W` = wall attenuation factor (dB per wall)

**Outdoor (Free-Space Path Loss):**
```
PL(d) = 20 × log₁₀(d) + 20 × log₁₀(f) − 27.55  dB
```
- `f` = 2400 MHz (2.4 GHz, standard WSN frequency)

Path loss tells us how weak the signal is at the receiver — higher dB = weaker signal = potential communication failure. This value is shown in the metrics panel.

---

## Energy Model

Based on the standard academic first-order radio model used in WSN research (Heinzelman et al., 2000).

**Energy to transmit one packet:**
```
E_tx = packet_size × E_elec + packet_size × E_amp × d²
     = 4000 × 50nJ + 4000 × 100pJ × d²
```

The `d²` term means energy cost grows with the square of distance — a node twice as far costs 4× the energy to reach.

**Energy to receive one packet:**
```
E_rx = packet_size × E_rx = 4000 × 50nJ
```

**Energy per round (one full tx + rx + idle cycle):**
```
E_round = E_tx + E_rx + E_idle
```

**Constants:**
| Symbol | Value | Meaning |
|--------|-------|---------|
| E_elec | 50 nJ/bit | Electronics energy per bit |
| E_amp | 100 pJ/bit/m² | Amplifier energy (distance-dependent) |
| E_rx | 50 nJ/bit | Receive energy per bit |
| E_idle | 10 nJ/bit | Idle listening energy |
| Packet size | 4000 bits | Standard WSN packet |

---

## Battery Simulation (400 Days)

After node placement is finalized, the simulator runs a **400-day day-by-day simulation**:

```
For each day (0 to 400):
  1. Count how many nodes are still alive.
  2. Record: alive count, average battery %, coverage %, energy consumed.
  3. Calculate energy drained per node today:
       drain = E_round × transmissions_per_day × sensor_power_factor
       (with ±20% random variance — models real-world battery inconsistency)
  4. For each node: subtract drain from battery.
     If battery reaches 0 → node dies (alive = false).
  5. If all nodes dead → stop simulation.
```

**Outputs:**
- **Battery Life** — day when the first node dies
- **Charts** — 4 time-series graphs showing how the network degrades over 400 days

---

## Charts (4 Graphs)

All charts show the network's health over 400 days:

| Chart | Y-axis | What it tells you |
|-------|--------|-------------------|
| Battery % vs Time | Average battery % of alive nodes | How fast energy depletes |
| Alive Nodes vs Time | Count of alive nodes | When nodes start dying |
| Coverage % vs Time | Estimated coverage % | How coverage shrinks as nodes die |
| Energy Consumed | mAh consumed | Total energy expenditure |

---

## Iteration Visualization

The simulator doesn't just show the final result — it saves every iteration of Lloyd's relaxation and lets you:

- **Scrub through** iterations using a slider
- **Play/pause** the animation to watch nodes gradually spread out
- **See per-iteration metrics** (coverage %, connected or not) in a mini bar chart
- The **best iteration** (highest coverage, connected preferred) is selected automatically

This makes the optimization process transparent and educational.

---

## Recommendations Panel

After simulation, the system generates automated recommendations based on the results:

**Network Health Score (0–100):**
| Component | Max Points | Condition |
|-----------|-----------|-----------|
| Coverage | 40 pts | `(covPct / 100) × 40` |
| Connectivity | 30 pts | Connected = 30, Disconnected = 0 |
| Battery Life | 20 pts | `min(battLife / 400, 1) × 20` |
| Node Spacing | 10 pts | Good spacing = 10, sparse = 5, overcrowded = 0 |

**6 recommendation categories:**
1. **Coverage** — Is the area well covered? How many nodes to add?
2. **Connectivity** — Are all nodes reachable? Any isolated nodes?
3. **Battery** — Expected lifetime. Which battery type to use?
4. **Placement** — Are nodes spaced correctly? Too close or too sparse?
5. **RF Signal** — Path loss in dB. Is the signal strong enough?
6. **Nodes** — Are there enough nodes for the given area?

---

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + Vite | Fast UI, component-based, canvas rendering |
| Canvas Rendering | HTML5 Canvas 2D API | Custom drawing: nodes, Voronoi, Delaunay, circles |
| Charts | Custom canvas charts | No external library needed, full control |
| Backend | Node.js + Express | Lightweight REST API |
| Database | MongoDB | Stores simulation history per user |
| Auth | JWT (JSON Web Tokens) | Stateless authentication |

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND (React)                  │
│                                                     │
│  User Input                                         │
│  (nodes, area, sensor, battery, TX interval)        │
│           │                                         │
│           ▼                                         │
│  runSim()                                           │
│  ├── Random initial placement                       │
│  ├── Lloyd's Relaxation × 20 iterations             │
│  │     ├── recompute() → Delaunay + Voronoi         │
│  │     ├── calcCov() → grid-sampling coverage       │
│  │     ├── calcConn() → BFS on in-range edges       │
│  │     └── store in iterHistory[]                   │
│  └── finalize(bestIteration)                        │
│        ├── Path loss calculation                    │
│        └── 400-day battery simulation → tsd[]       │
│                                                     │
│  Canvas (draw())                                    │
│  ├── Voronoi cells (coverage regions)               │
│  ├── Delaunay edges (communication links)           │
│  ├── Sensor range circles                           │
│  └── Node dots with battery indicators             │
│                                                     │
│  Charts  →  tsd[] data                             │
│  Recs    →  met{} state                            │
└─────────────────────────────────────────────────────┘
           │ API calls (save/load history)
           ▼
┌─────────────────────────────────────────────────────┐
│                  BACKEND (Node.js)                  │
│  POST /api/simulate    → run simulation             │
│  POST /api/optimize    → optimize manual placement  │
│  POST /api/save        → save result (JWT auth)     │
│  GET  /api/history     → user's past simulations    │
└─────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────┐
│   MongoDB        │
│  (simulation     │
│   history)       │
└──────────────────┘
```

---

## What Makes This Different from a Naive Simulator?

| Feature | Naive Approach | This Simulator |
|---------|---------------|----------------|
| Node placement | Random only | Discrete Lloyd's Relaxation (optimal) |
| Coverage calculation | π×r² formula (wrong for overlaps) | Grid-sampling union of circles |
| Connectivity check | Any Delaunay edge = connected | Only edges within RF comm range count |
| Battery simulation | Simple average drain | Per-node variance, day-by-day simulation |
| Optimization visibility | Final result only | All 20 iterations saved, slider + animation |
| Recommendations | None | Health score + 6-category actionable advice |

---

## Algorithm Limitations

### 1. Discrete Lloyd's Relaxation (Node Placement)

| Limitation | Detail |
|---|---|
| Non-deterministic | No seeded RNG — same config gives a different layout every run |
| Local optimum only | 20 iterations may not reach the global optimum; result depends on random initial placement |
| Fixed iteration count | Always runs all 20 iterations even if convergence happens earlier |
| 60% lerp is heuristic | The lerp factor is hand-tuned — no theoretical guarantee of fastest convergence |
| No obstacle awareness | Treats area as a fully open rectangle; walls or obstacles are not considered during placement |
| Boundary bias | Nodes clamped to 5–95% of area — corners and edges may be under-covered |

### 2. Delaunay Triangulation (Bowyer-Watson)

| Limitation | Detail |
|---|---|
| Full recomputation on drag | No incremental update — entire triangulation recomputed from scratch on every node move |
| Degenerate cases | Collinear or nearly collinear nodes can produce very thin triangles with poor link quality |
| No signal strength weighting | All edges treated equally; actual RF quality not factored into topology |

### 3. Voronoi Diagram

| Limitation | Detail |
|---|---|
| Boundary clipping inaccuracy | Cells near area boundary are clipped — their area is underestimated |
| Coverage ≠ Voronoi cell | A node's sensing circle (radius `sR`) and its Voronoi cell are independent — the cell can be larger than actual sensing range |

### 4. Coverage Calculation (Grid Sampling)

| Limitation | Detail |
|---|---|
| Approximation error | Grid step = `min(W,H)/60` — coarse for large areas, introduces ±1–2% error |
| Dead nodes not removed | Chart coverage uses `(alive/total) × covPct` — Voronoi cells of dead nodes are still counted |
| 2D flat plane only | No elevation, floors, or 3D signal propagation modelled |

### 5. Energy & Battery Model

| Limitation | Detail |
|---|---|
| First-order radio model only | `E_amp × d²` assumes free-space propagation — does not capture indoor multipath fading |
| Simplified battery drain | ±20% random variance per node per day — real degradation is non-linear and temperature-dependent |
| No duty cycling | All nodes assumed always-on; sleep/wake scheduling (e.g. S-MAC, TDMA) is not modelled |
| Homogeneous network | All nodes use the same energy constants — heterogeneous hardware not supported |

### 6. BFS Connectivity Check

| Limitation | Detail |
|---|---|
| Binary result only | Returns only connected / disconnected — no partial score or fault-tolerance (k-connectivity) |
| No interference modelling | Two in-range nodes assumed to communicate perfectly — co-channel interference ignored |
| Static snapshot | BFS runs on the current placement; node mobility or dynamic link failure not modelled |

---

## Key Academic References

1. **Bowyer-Watson Algorithm** — Bowyer (1981), Watson (1981) — Delaunay triangulation
2. **Lloyd's Algorithm** — Lloyd (1982) — Voronoi-based optimal quantization / relaxation
3. **First-Order Radio Model** — Heinzelman, Chandrakasan & Balakrishnan (2000) — Energy dissipation model for WSN
4. **Log-Distance Path Loss** — Rappaport (2002), Wireless Communications — Indoor propagation model
5. **Free-Space Path Loss (Friis)** — Friis (1946) — Outdoor propagation model


https://excalidraw.com/#json=ec4u2RbomCSYBDHVpfPSb,7d0OHGC1cLK9N19O3ERJbw