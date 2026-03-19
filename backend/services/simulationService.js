/**
 * WSN Simulation Engine
 * 
 * Core algorithms:
 * - Bowyer-Watson Delaunay Triangulation
 * - Voronoi Diagram (dual of Delaunay)
 * - Log-distance path loss model (indoor)
 * - Free-space path loss model (outdoor)
 * - Standard WSN energy consumption model
 */

// ──────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────
const SENSORS = {
  Temperature: { range: 15, powerFactor: 1.0 },
  Humidity: { range: 12, powerFactor: 1.1 },
  Motion: { range: 8, powerFactor: 1.3 },
};

const BATTERIES = {
  'Li-ion': { voltage: 3.7, defaultCapacity: 3000 },
  'AA': { voltage: 1.5, defaultCapacity: 2500 },
  'Coin': { voltage: 3.0, defaultCapacity: 220 },
};

// Energy constants (academic standard values)
const ENERGY = {
  E_elec: 50e-9,       // 50 nJ/bit — transmitter/receiver electronics
  E_amp: 100e-12,      // 100 pJ/bit/m² — amplifier
  E_rx: 50e-9,         // 50 nJ/bit — receiving
  E_idle: 10e-9,       // idle power per second
  packetSize: 4000,    // 4000 bits per packet
};

// ──────────────────────────────────────────
// DELAUNAY TRIANGULATION (Bowyer-Watson)
// ──────────────────────────────────────────
function delaunayTriangulation(points) {
  if (points.length < 3) return { triangles: [], edges: [] };

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs) - 1;
  const minY = Math.min(...ys) - 1;
  const maxX = Math.max(...xs) + 1;
  const maxY = Math.max(...ys) + 1;
  const dmax = Math.max(maxX - minX, maxY - minY) * 10;

  // Super-triangle that encloses all points
  const superTriangle = [
    { x: minX - dmax, y: minY - dmax, _super: true },
    { x: minX + 2 * dmax, y: minY - dmax, _super: true },
    { x: minX, y: minY + 2 * dmax, _super: true },
  ];

  let triangles = [superTriangle];

  // Insert each point one at a time
  for (const point of points) {
    // Find all triangles whose circumcircle contains this point
    const badTriangles = triangles.filter(tri => isPointInCircumcircle(point, tri));

    // Find boundary polygon (edges not shared by two bad triangles)
    const polygon = [];
    for (const tri of badTriangles) {
      for (let i = 0; i < 3; i++) {
        const edge = [tri[i], tri[(i + 1) % 3]];
        let shared = false;
        for (const other of badTriangles) {
          if (other === tri) continue;
          for (let j = 0; j < 3; j++) {
            const otherEdge = [other[j], other[(j + 1) % 3]];
            if ((edge[0] === otherEdge[0] && edge[1] === otherEdge[1]) ||
                (edge[0] === otherEdge[1] && edge[1] === otherEdge[0])) {
              shared = true;
              break;
            }
          }
          if (shared) break;
        }
        if (!shared) polygon.push(edge);
      }
    }

    // Remove bad triangles
    triangles = triangles.filter(t => !badTriangles.includes(t));

    // Create new triangles from polygon edges to the inserted point
    for (const edge of polygon) {
      triangles.push([edge[0], edge[1], point]);
    }
  }

  // Remove triangles that share vertices with super-triangle
  triangles = triangles.filter(tri => !tri.some(v => v._super));

  // Extract unique edges
  const edgeSet = new Set();
  const edges = [];
  for (const tri of triangles) {
    for (let i = 0; i < 3; i++) {
      const a = points.indexOf(tri[i]);
      const b = points.indexOf(tri[(i + 1) % 3]);
      if (a < 0 || b < 0) continue;
      const key = Math.min(a, b) + '-' + Math.max(a, b);
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([a, b]);
      }
    }
  }

  return { triangles, edges };
}

/**
 * Check if point lies inside the circumcircle of a triangle
 */
function isPointInCircumcircle(point, triangle) {
  const [a, b, c] = triangle;
  const ax = a.x - point.x, ay = a.y - point.y;
  const bx = b.x - point.x, by = b.y - point.y;
  const cx = c.x - point.x, cy = c.y - point.y;
  const det = (ax * ax + ay * ay) * (bx * cy - cx * by)
            - (bx * bx + by * by) * (ax * cy - cx * ay)
            + (cx * cx + cy * cy) * (ax * by - bx * ay);
  return det > 0;
}

// ──────────────────────────────────────────
// VORONOI DIAGRAM (dual of Delaunay)
// ──────────────────────────────────────────
function computeVoronoi(points, triangles) {
  const cells = points.map(() => []);

  for (const tri of triangles) {
    const cc = circumcenter(tri[0], tri[1], tri[2]);
    if (!cc) continue;
    for (const vertex of tri) {
      const idx = points.indexOf(vertex);
      if (idx >= 0) cells[idx].push(cc);
    }
  }

  // Sort each cell's vertices by angle for proper polygon rendering
  return cells.map((vertices, i) => {
    if (vertices.length < 2) return vertices;
    const center = points[i];
    return vertices.sort((a, b) =>
      Math.atan2(a.y - center.y, a.x - center.x) -
      Math.atan2(b.y - center.y, b.x - center.x)
    );
  });
}

/**
 * Compute circumcenter of a triangle
 */
function circumcenter(a, b, c) {
  const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(D) < 1e-10) return null;
  return {
    x: ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
        (b.x * b.x + b.y * b.y) * (c.y - a.y) +
        (c.x * c.x + c.y * c.y) * (a.y - b.y)) / D,
    y: ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
        (b.x * b.x + b.y * b.y) * (a.x - c.x) +
        (c.x * c.x + c.y * c.y) * (b.x - a.x)) / D,
  };
}

/**
 * Calculate area of a polygon using Shoelace formula
 */
function polygonArea(vertices) {
  if (vertices.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

// ──────────────────────────────────────────
// PROPAGATION MODELS
// ──────────────────────────────────────────

/**
 * Indoor: Log-distance path loss model
 * PL(d) = PL(d0) + 10*n*log10(d/d0) + wall_attenuation
 */
function logDistancePathLoss(distance, exponent = 4.0, wallAttenuation = 5) {
  if (distance <= 0) return 0;
  const PL_d0 = 40; // dB at 1m reference distance
  return PL_d0 + 10 * exponent * Math.log10(distance) + wallAttenuation;
}

/**
 * Outdoor: Free-space path loss model
 * FSPL = 20*log10(d) + 20*log10(f) - 27.55
 */
function freeSpacePathLoss(distance, frequency = 2400) {
  if (distance <= 0) return 0;
  return 20 * Math.log10(distance) + 20 * Math.log10(frequency) - 27.55;
}

// ──────────────────────────────────────────
// ENERGY MODEL
// ──────────────────────────────────────────

/**
 * Calculate energy per transmission round
 * E_total = E_tx + E_rx + E_idle
 */
function energyPerRound(distance) {
  const E_tx = ENERGY.packetSize * ENERGY.E_elec +
               ENERGY.packetSize * ENERGY.E_amp * distance * distance;
  const E_rx = ENERGY.packetSize * ENERGY.E_rx;
  const E_idle = ENERGY.E_idle * 1000; // idle for ~1 second
  return { E_tx, E_rx, E_idle, total: E_tx + E_rx + E_idle };
}

/**
 * Convert battery capacity (mAh) to energy (Joules)
 */
function batteryToJoules(mAh, voltage) {
  return (mAh / 1000) * voltage * 3600;
}

// ──────────────────────────────────────────
// DISTANCE CALCULATIONS
// ──────────────────────────────────────────

/** Euclidean distance (indoor) */
function euclidean(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Haversine distance in meters (outdoor lat/lng) */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ──────────────────────────────────────────
// NODE GENERATION
// ──────────────────────────────────────────
function generateNodes(numNodes, width, height, placement) {
  const nodes = [];
  if (placement === 'Grid') {
    const cols = Math.ceil(Math.sqrt(numNodes * width / height));
    const rows = Math.ceil(numNodes / cols);
    for (let i = 0; i < numNodes; i++) {
      nodes.push({
        id: i,
        x: ((i % cols) + 1) * width / (cols + 1),
        y: (Math.floor(i / cols) + 1) * height / (rows + 1),
        alive: true,
      });
    }
  } else {
    // Random placement with margin
    for (let i = 0; i < numNodes; i++) {
      nodes.push({
        id: i,
        x: Math.random() * width * 0.85 + width * 0.075,
        y: Math.random() * height * 0.85 + height * 0.075,
        alive: true,
      });
    }
  }
  return nodes;
}

// ──────────────────────────────────────────
// MAIN SIMULATION FUNCTION
// ──────────────────────────────────────────
export function runSimulation(config) {
  const {
    numNodes, envType, areaWidth, areaHeight,
    sensorType, batteryType, batteryCapacity,
    txInterval, placement,
    pathLossExponent = 4.0, wallAttenuation = 5,
  } = config;

  const sensorInfo = SENSORS[sensorType];
  const batteryInfo = BATTERIES[batteryType] || BATTERIES['Li-ion'];
  const sRange = sensorInfo.range;
  const powerFactor = sensorInfo.powerFactor;
  const voltage = batteryInfo.voltage;

  // Step 1: Generate nodes
  const nodes = config.nodes && config.nodes.length >= 3
    ? config.nodes.map((n, i) => ({ ...n, id: i, alive: true }))
    : generateNodes(numNodes, areaWidth, areaHeight, placement);

  // Step 2: Delaunay triangulation
  const { triangles, edges } = delaunayTriangulation(nodes);

  // Step 3: Voronoi cells
  const voronoiCells = computeVoronoi(nodes, triangles);

  // Step 4: Per-node metrics
  let globalMinDist = Infinity;
  let totalDist = 0;
  let distCount = 0;

  nodes.forEach((node, i) => {
    const neighbors = [];
    for (const [a, b] of edges) {
      if (a === i) neighbors.push(b);
      else if (b === i) neighbors.push(a);
    }
    let minDist = Infinity;
    for (const ni of neighbors) {
      const d = euclidean(nodes[ni], node);
      if (d < minDist) minDist = d;
      if (d < globalMinDist) globalMinDist = d;
    }
    node.minNeighborDist = minDist === Infinity ? 0 : minDist;
    node.voronoiArea = polygonArea(voronoiCells[i] || []);
    node.neighbors = neighbors;
  });

  for (const [a, b] of edges) {
    totalDist += euclidean(nodes[a], nodes[b]);
    distCount++;
  }
  const avgDist = distCount > 0 ? totalDist / distCount : 0;

  // Step 5: Coverage calculation
  const totalArea = areaWidth * areaHeight;
  const coveredArea = nodes.length * Math.PI * sRange * sRange;
  const coveragePct = Math.min(100, (coveredArea / totalArea) * 100);

  // Step 6: Path loss
  const pathLoss = envType === 'Indoor'
    ? logDistancePathLoss(avgDist, pathLossExponent, wallAttenuation)
    : freeSpacePathLoss(avgDist);

  // Step 7: Connectivity check (BFS)
  const visited = new Set([0]);
  const queue = [0];
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const [a, b] of edges) {
      const neighbor = a === curr ? b : (b === curr ? a : -1);
      if (neighbor >= 0 && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  const isConnected = visited.size === nodes.length;

  // Step 8: Energy simulation over time
  const roundsPerDay = (24 * 3600) / txInterval;
  const epr = energyPerRound(avgDist);
  const batteryJ = batteryToJoules(batteryCapacity, voltage);
  const nodeStates = nodes.map(() => ({ battery: batteryJ, alive: true }));
  const timeSeries = [];

  for (let day = 0; day <= 400; day++) {
    const aliveCount = nodeStates.filter(n => n.alive).length;
    if (aliveCount === 0 && day > 0) break;

    const avgBattery = nodeStates.reduce((sum, n) =>
      sum + (n.alive ? (n.battery / batteryJ) * 100 : 0), 0) / Math.max(1, aliveCount || 1);

    const currentCoverage = (aliveCount / nodes.length) * coveragePct;

    timeSeries.push({
      day,
      aliveNodes: aliveCount,
      avgBattery: Math.round(avgBattery * 10) / 10,
      coverage: Math.round(currentCoverage * 10) / 10,
      energyConsumed: Math.round((1 - avgBattery / 100) * batteryCapacity * 10) / 10,
    });

    // Drain energy (with variance per node)
    const dailyEnergy = epr.total * roundsPerDay * powerFactor;
    for (const ns of nodeStates) {
      if (!ns.alive) continue;
      const variance = 0.8 + Math.random() * 0.4;
      ns.battery -= dailyEnergy * variance;
      if (ns.battery <= 0) {
        ns.battery = 0;
        ns.alive = false;
      }
    }
  }

  const batteryLifeDays = timeSeries.length > 0 ? timeSeries[timeSeries.length - 1].day : 0;
  const firstDeathDay = timeSeries.find(t => t.aliveNodes < nodes.length)?.day || batteryLifeDays;

  // Step 9: Recommendations
  const recommendations = [];
  const optimalSpacing = sRange * 1.5;
  const requiredNodes = Math.ceil(totalArea / (Math.PI * sRange * sRange * 0.8));

  recommendations.push({
    type: 'info',
    text: `Optimal node spacing: ${optimalSpacing.toFixed(1)}m based on ${sensorType} sensor range (${sRange}m)`,
  });
  recommendations.push({
    type: 'info',
    text: `Recommended node count for full coverage: ${requiredNodes}`,
  });

  if (numNodes < requiredNodes) {
    recommendations.push({
      type: 'warning',
      text: `Insufficient nodes! Add ${requiredNodes - numNodes} more for complete coverage`,
    });
  }
  if (!isConnected) {
    recommendations.push({
      type: 'error',
      text: 'Network is disconnected! Some nodes are isolated. Reposition or add relay nodes.',
    });
  }
  if (batteryLifeDays < 30) {
    recommendations.push({
      type: 'warning',
      text: 'Battery life < 30 days. Consider Li-ion batteries or longer TX intervals.',
    });
  }
  if (coveragePct < 80) {
    recommendations.push({
      type: 'warning',
      text: `Coverage is only ${coveragePct.toFixed(1)}%. Add more nodes or use sensors with larger range.`,
    });
  }
  if (globalMinDist < sRange * 0.3 && globalMinDist > 0) {
    recommendations.push({
      type: 'warning',
      text: `Nodes ${globalMinDist.toFixed(1)}m apart — too close. Spread them for efficiency.`,
    });
  }

  return {
    nodes: nodes.map(n => ({
      id: n.id, x: n.x, y: n.y, alive: n.alive,
      minNeighborDist: n.minNeighborDist,
      voronoiArea: n.voronoiArea,
    })),
    edges,
    metrics: {
      minDist: globalMinDist === Infinity ? 0 : globalMinDist,
      avgDist,
      coveragePct,
      pathLoss,
      isConnected,
      batteryLifeDays,
      firstDeathDay,
      networkLifetime: batteryLifeDays,
      totalArea,
      sensorRange: sRange,
    },
    timeSeries,
    recommendations,
  };
}

export { SENSORS, BATTERIES, ENERGY };
