/**
 * Client-side WSN algorithms for real-time canvas interaction.
 * The backend has the same algorithms for server-side simulation.
 * These run in the browser for instant drag-and-drop topology updates.
 */

// ── DELAUNAY TRIANGULATION (Bowyer-Watson) ──
export function delaunay(pts) {
  if (pts.length < 3) return { tris: [], edges: [] };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const mX = Math.min(...xs) - 1, mY = Math.min(...ys) - 1;
  const MX = Math.max(...xs) + 1, MY = Math.max(...ys) + 1;
  const dm = Math.max(MX - mX, MY - mY) * 10;
  const S = [
    { x: mX - dm, y: mY - dm, _s: 1 },
    { x: mX + 2 * dm, y: mY - dm, _s: 1 },
    { x: mX, y: mY + 2 * dm, _s: 1 },
  ];
  let tris = [S];

  for (const p of pts) {
    const bad = tris.filter(t => inCC(p, t));
    const poly = [];
    for (const t of bad) {
      for (let i = 0; i < 3; i++) {
        const e = [t[i], t[(i + 1) % 3]];
        let sh = false;
        for (const o of bad) {
          if (o === t) continue;
          for (let j = 0; j < 3; j++) {
            if ((e[0] === o[j] && e[1] === o[(j + 1) % 3]) ||
                (e[0] === o[(j + 1) % 3] && e[1] === o[j])) {
              sh = true; break;
            }
          }
          if (sh) break;
        }
        if (!sh) poly.push(e);
      }
    }
    tris = tris.filter(t => !bad.includes(t));
    for (const e of poly) tris.push([e[0], e[1], p]);
  }

  tris = tris.filter(t => !t.some(v => v._s));
  const es = new Set(), el = [];
  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const a = pts.indexOf(t[i]), b = pts.indexOf(t[(i + 1) % 3]);
      if (a < 0 || b < 0) continue;
      const k = Math.min(a, b) + '-' + Math.max(a, b);
      if (!es.has(k)) { es.add(k); el.push([a, b]); }
    }
  }
  return { tris, edges: el };
}

function inCC(p, t) {
  const [a, b, c] = t;
  const ax = a.x - p.x, ay = a.y - p.y;
  const bx = b.x - p.x, by = b.y - p.y;
  const cx = c.x - p.x, cy = c.y - p.y;
  return (ax * ax + ay * ay) * (bx * cy - cx * by) -
         (bx * bx + by * by) * (ax * cy - cx * ay) +
         (cx * cx + cy * cy) * (ax * by - bx * ay) > 0;
}

// ── VORONOI (dual of Delaunay) ──
export function voronoiFn(pts, tris) {
  const cells = pts.map(() => []);
  for (const t of tris) {
    const cc = ccenter(t[0], t[1], t[2]);
    if (!cc) continue;
    for (const v of t) {
      const i = pts.indexOf(v);
      if (i >= 0) cells[i].push(cc);
    }
  }
  return cells.map((vs, i) => {
    if (vs.length < 2) return vs;
    const c = pts[i];
    return vs.sort((a, b) =>
      Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x)
    );
  });
}

function ccenter(a, b, c) {
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

export function polyArea(vs) {
  if (vs.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < vs.length; i++) {
    const j = (i + 1) % vs.length;
    a += vs[i].x * vs[j].y - vs[j].x * vs[i].y;
  }
  return Math.abs(a) / 2;
}

// ── RECOMPUTE TOPOLOGY ──
export function recomputeTopology(nodes) {
  if (nodes.length < 3) return { edges: [], cells: [], minDist: 0 };
  const { tris, edges } = delaunay(nodes);
  const cells = voronoiFn(nodes, tris);
  let gMin = Infinity;

  nodes.forEach((p, i) => {
    const nb = [];
    for (const [a, b] of edges) {
      if (a === i) nb.push(b);
      else if (b === i) nb.push(a);
    }
    let md = Infinity;
    for (const n of nb) {
      const d = Math.hypot(nodes[n].x - p.x, nodes[n].y - p.y);
      if (d < md) md = d;
      if (d < gMin) gMin = d;
    }
    p.minN = md === Infinity ? 0 : md;
    p.area = polyArea(cells[i] || []);
    p.nb = nb;
  });

  return { edges, cells, minDist: gMin === Infinity ? 0 : gMin };
}

// ── MAP TILE UTILITIES ──
export function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function tileToLatLng(tx, ty, zoom) {
  const n = Math.pow(2, zoom);
  const lng = (tx / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
  return { lat: (latRad * 180) / Math.PI, lng };
}

// ── CONSTANTS ──
export const SENSORS = {
  Temperature: { range: 15, power: 1.0 },
  Humidity: { range: 12, power: 1.1 },
  Motion: { range: 8, power: 1.3 },
};

export const BATTERIES = {
  'Li-ion': { v: 3.7, cap: 3000 },
  AA: { v: 1.5, cap: 2500 },
  Coin: { v: 3.0, cap: 220 },
};
