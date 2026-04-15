import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS & MODELS
// ═══════════════════════════════════════════════════════════════
const SENSORS = {
  Temperature: { range: 15, power: 1.0 },
  Humidity: { range: 12, power: 1.1 },
  Motion: { range: 8, power: 1.3 },
};
const BATTS = {
  "Li-ion": { v: 3.7, cap: 3000 },
  AA: { v: 1.5, cap: 2500 },
  Coin: { v: 3.0, cap: 220 },
};
const EN = { elec: 50e-9, amp: 100e-12, rx: 50e-9, idle: 10e-9, pkt: 4000 };

function mAhToJ(mAh, v) { return (mAh / 1000) * v * 3600; }
function ePR(d) {
  const tx = EN.pkt * EN.elec + EN.pkt * EN.amp * d * d;
  return { tx, rx: EN.pkt * EN.rx, idle: EN.idle * 1000, total: tx + EN.pkt * EN.rx + EN.idle * 1000 };
}
function plIndoor(d, n, w) { return d <= 0 ? 0 : 40 + 10 * n * Math.log10(d) + w; }
function plFSPL(d) { return d <= 0 ? 0 : 20 * Math.log10(d) + 20 * Math.log10(2400) - 27.55; }

// ═══════════════════════════════════════════════════════════════
// DELAUNAY (Bowyer-Watson)
// ═══════════════════════════════════════════════════════════════
function delaunay(pts) {
  if (pts.length < 3) return { tris: [], edges: [] };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const mX = Math.min(...xs) - 1, mY = Math.min(...ys) - 1;
  const MX = Math.max(...xs) + 1, MY = Math.max(...ys) + 1;
  const dm = Math.max(MX - mX, MY - mY) * 10;
  const S = [{ x: mX - dm, y: mY - dm, _s: 1 }, { x: mX + 2 * dm, y: mY - dm, _s: 1 }, { x: mX, y: mY + 2 * dm, _s: 1 }];
  let tris = [S];
  for (const p of pts) {
    const bad = tris.filter(t => inCC(p, t));
    const poly = [];
    for (const t of bad) for (let i = 0; i < 3; i++) {
      const e = [t[i], t[(i + 1) % 3]];
      let sh = false;
      for (const o of bad) { if (o === t) continue; for (let j = 0; j < 3; j++) if ((e[0] === o[j] && e[1] === o[(j + 1) % 3]) || (e[0] === o[(j + 1) % 3] && e[1] === o[j])) { sh = true; break; } if (sh) break; }
      if (!sh) poly.push(e);
    }
    tris = tris.filter(t => !bad.includes(t));
    for (const e of poly) tris.push([e[0], e[1], p]);
  }
  tris = tris.filter(t => !t.some(v => v._s));
  const es = new Set(), el = [];
  for (const t of tris) for (let i = 0; i < 3; i++) {
    const a = pts.indexOf(t[i]), b = pts.indexOf(t[(i + 1) % 3]);
    if (a < 0 || b < 0) continue;
    const k = Math.min(a, b) + "-" + Math.max(a, b);
    if (!es.has(k)) { es.add(k); el.push([a, b]); }
  }
  return { tris, edges: el };
}
function inCC(p, t) {
  const [a, b, c] = t;
  const ax = a.x - p.x, ay = a.y - p.y, bx = b.x - p.x, by = b.y - p.y, cx = c.x - p.x, cy = c.y - p.y;
  return (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay) > 0;
}

// ═══════════════════════════════════════════════════════════════
// VORONOI (dual of Delaunay)
// ═══════════════════════════════════════════════════════════════
function voronoiFn(pts, tris) {
  const cells = pts.map(() => []);
  for (const t of tris) {
    const cc = ccenter(t[0], t[1], t[2]);
    if (!cc) continue;
    for (const v of t) { const i = pts.indexOf(v); if (i >= 0) cells[i].push(cc); }
  }
  return cells.map((vs, i) => {
    if (vs.length < 2) return vs;
    const c = pts[i];
    return vs.sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  });
}
function ccenter(a, b, c) {
  const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(D) < 1e-10) return null;
  return { x: ((a.x * a.x + a.y * a.y) * (b.y - c.y) + (b.x * b.x + b.y * b.y) * (c.y - a.y) + (c.x * c.x + c.y * c.y) * (a.y - b.y)) / D, y: ((a.x * a.x + a.y * a.y) * (c.x - b.x) + (b.x * b.x + b.y * b.y) * (a.x - c.x) + (c.x * c.x + c.y * c.y) * (b.x - a.x)) / D };
}
function polyArea(vs) {
  if (vs.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < vs.length; i++) { const j = (i + 1) % vs.length; a += vs[i].x * vs[j].y - vs[j].x * vs[i].y; }
  return Math.abs(a) / 2;
}


// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [af, setAf] = useState({ name: "", email: "", password: "" });
  const [authErr, setAuthErr] = useState("");
  const [users, setUsers] = useState([{ name: "Demo", email: "demo@test.com", password: "123", id: 1 }]);

  const [env, setEnv] = useState("Indoor");
  const [numNodes, setNumNodes] = useState(15);
  const [aW, setAW] = useState(120);
  const [aH, setAH] = useState(90);
  const [sensor, setSensor] = useState("Temperature");
  const [placement] = useState("Hybrid");
  const [battType, setBattType] = useState("Li-ion");
  const [capacity, setCapacity] = useState(3000);
  const [txInt, setTxInt] = useState(30);
  const [ple, setPle] = useState(4.0);
  const [wallAtt, setWallAtt] = useState(5);

  const [nodes, setNodes] = useState([]);
  const [edgesArr, setEdgesArr] = useState([]);
  const [cellsArr, setCellsArr] = useState([]);
  const [met, setMet] = useState(null);
  const [ts, setTs] = useState([]);
  const [done, setDone] = useState(false);
  const [ov, setOv] = useState("hybrid");
  const [tab, setTab] = useState("viz");
  const [iterHistory, setIterHistory] = useState([]);
  const [iterIdx, setIterIdx] = useState(0);
  const [iterPlaying, setIterPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const iterPlayRef = useRef(null);

  const canvasRef = useRef(null);
  const dragRef = useRef(-1);
  const bestIterRef = useRef(0); // stores bestIdx synchronously before state update
  const chartRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  const doAuth = () => {
    setAuthErr("");
    if (authMode === "register") {
      if (!af.name || !af.email || !af.password) return setAuthErr("All fields required");
      if (users.find(u => u.email === af.email)) return setAuthErr("Email exists");
      const u = { ...af, id: Date.now() };
      setUsers(p => [...p, u]);
      setUser(u);
    } else {
      const u = users.find(u => u.email === af.email && u.password === af.password);
      if (!u) return setAuthErr("Invalid credentials");
      setUser(u);
    }
  };

  const recompute = useCallback((pts, commRange = Infinity) => {
    if (pts.length < 3) return { edges: [], cells: [], minDist: 0 };
    const { tris, edges: allEd } = delaunay(pts);
    const cl = voronoiFn(pts, tris);

    // Tag each edge: inRange = within communication range, outRange = too far
    const ed = allEd.map(([a, b]) => {
      const d = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
      return { a, b, dist: d, inRange: d <= commRange };
    });

    let gMin = Infinity;
    pts.forEach((p, i) => {
      const nb = [];
      for (const e of ed) {
        if (e.a === i) nb.push(e.b);
        else if (e.b === i) nb.push(e.a);
      }
      let md = Infinity;
      for (const n of nb) { const d = Math.hypot(pts[n].x - p.x, pts[n].y - p.y); if (d < md) md = d; if (d < gMin) gMin = d; }
      p.minN = md === Infinity ? 0 : md;
      p.area = polyArea(cl[i] || []);
      p.nb = nb;
    });
    return { edges: ed, cells: cl, minDist: gMin === Infinity ? 0 : gMin };
  }, []);

  // Shared helpers used inside runSim
  const calcCov = useCallback((ps, sR) => {
    const gs = Math.max(1, Math.min(aW, aH) / 60);
    let cc = 0, tc = 0;
    for (let gx = 0; gx < aW; gx += gs) for (let gy = 0; gy < aH; gy += gs) { tc++; if (ps.some(p => Math.hypot(p.x - gx, p.y - gy) <= sR)) cc++; }
    return Math.round((cc / tc) * 1000) / 10;
  }, [aW, aH]);

  const calcConn = useCallback((ps, ed) => {
    if (ps.length === 0) return false;
    // Only use in-range edges for connectivity check
    const inRangeEd = ed.filter ? ed.filter(e => e.inRange) : ed;
    const vis = new Set([0]), q = [0];
    while (q.length) { const c = q.shift(); for (const e of inRangeEd) { const a = e.a ?? e[0], b = e.b ?? e[1]; const n = a === c ? b : b === c ? a : -1; if (n >= 0 && !vis.has(n)) { vis.add(n); q.push(n); } } }
    return vis.size === ps.length;
  }, []);

  const finalize = useCallback((pts, sR, sP, bV) => {
    const commRange = sR * 2;
    const { edges: ed, cells: cl, minDist } = recompute(pts, commRange);
    let td = 0, dc = 0;
    // ed is now [{a, b, dist, inRange}] — use e.a / e.b not [a,b] destructuring
    for (const e of ed) { td += Math.hypot(pts[e.a].x - pts[e.b].x, pts[e.a].y - pts[e.b].y); dc++; }
    const avgD = dc > 0 ? td / dc : 0;
    const covPct = calcCov(pts, sR);
    const pl = env === "Indoor" ? plIndoor(avgD, ple, wallAtt) : plFSPL(avgD);
    const conn = calcConn(pts, ed);
    const rpd = (24 * 3600) / txInt, epr = ePR(avgD), bJ = mAhToJ(capacity, bV);
    const ns = pts.map(() => ({ b: bJ, a: true }));
    const tsd = [];
    for (let d = 0; d <= 400; d++) {
      const ac = ns.filter(n => n.a).length;
      if (ac === 0 && d > 0) break;
      const ab = ns.reduce((s, n) => s + (n.a ? n.b / bJ * 100 : 0), 0) / Math.max(1, ac || 1);
      tsd.push({ day: d, alive: ac, batt: +ab.toFixed(1), cov: +((ac / pts.length) * covPct).toFixed(1), energy: +((1 - ab / 100) * capacity).toFixed(1) });
      const de = epr.total * rpd * sP;
      for (const n of ns) { if (!n.a) continue; n.b -= de * (0.8 + Math.random() * 0.4); if (n.b <= 0) { n.b = 0; n.a = false; } }
    }
    const fd = tsd.find(t => t.alive < pts.length)?.day || tsd[tsd.length - 1]?.day || 0;
    return { ed, cl, minDist, avgD, covPct, pl, conn, tsd, fd };
  }, [aW, aH, env, ple, wallAtt, txInt, capacity, calcCov, calcConn, recompute]);

  const runSim = useCallback(() => {
    setLoading(true);
    // setTimeout 0 lets React render the loading state before heavy computation starts
    setTimeout(() => {
    const sR = SENSORS[sensor].range, sP = SENSORS[sensor].power, bV = BATTS[battType].v;
    let pts;

    {
      // ── HYBRID ITERATIVE OPTIMIZATION ──
      // Step 1: Random initial placement
      pts = Array.from({ length: numNodes }, (_, i) => ({
        id: i, x: Math.random() * aW * 0.85 + aW * 0.075,
        y: Math.random() * aH * 0.85 + aH * 0.075, alive: true, batt: 1
      }));

      const history = [];
      const commRange = sR * 2;
      // Grid resolution — finer = more accurate territory assignment
      const gs = Math.max(1.5, Math.min(aW, aH) / 30);

      for (let iter = 0; iter <= 20; iter++) {
        // Step 2: Evaluate current placement
        const { edges: ed, cells: cl, minDist: mD } = recompute(pts, commRange);
        const cov = calcCov(pts, sR);
        const conn = calcConn(pts, ed);
        history.push({ iter, pts: pts.map(p => ({ ...p })), edges: ed, cells: cl, coverage: cov, connected: conn, minDist: mD });

        if (cov >= 90 && conn) break;

        // Step 4: Discrete Lloyd's relaxation
        // Each node "owns" the grid cells nearest to it — move to centroid of owned cells
        // This guarantees no overlap (territories never overlap by definition)
        const sumX = new Float64Array(pts.length);
        const sumY = new Float64Array(pts.length);
        const cnt  = new Int32Array(pts.length);

        for (let gx = gs / 2; gx < aW; gx += gs) {
          for (let gy = gs / 2; gy < aH; gy += gs) {
            // Find which node is nearest to this grid cell
            let nearest = 0, nearDist = Infinity;
            for (let j = 0; j < pts.length; j++) {
              const d = Math.hypot(pts[j].x - gx, pts[j].y - gy);
              if (d < nearDist) { nearDist = d; nearest = j; }
            }
            sumX[nearest] += gx;
            sumY[nearest] += gy;
            cnt[nearest]++;
          }
        }

        // Move each node to centroid of its territory (bounded within area)
        pts = pts.map((p, i) => {
          if (cnt[i] === 0) return p;
          const cx = sumX[i] / cnt[i];
          const cy = sumY[i] / cnt[i];
          // Lerp toward centroid (0.6 = smooth movement, not teleport)
          return {
            ...p,
            x: Math.max(aW * 0.03, Math.min(aW * 0.97, p.x + (cx - p.x) * 0.6)),
            y: Math.max(aH * 0.03, Math.min(aH * 0.97, p.y + (cy - p.y) * 0.6)),
          };
        });
      }

      // Pick best iteration: connected preferred, then highest coverage
      const bestIdx = history.reduce((bi, it, i) => {
        const prev = history[bi];
        if (it.connected && !prev.connected) return i;
        if (!it.connected && prev.connected) return bi;
        return it.coverage > prev.coverage ? i : bi;
      }, 0);

      // Store bestIdx in ref BEFORE state updates (synchronous, no stale closure issue)
      bestIterRef.current = bestIdx;

      const bIt = history[bestIdx];
      pts = bIt.pts;
      const { avgD, tsd, fd } = finalize(pts, sR, sP, bV);

      // setIterHistory triggers a useEffect that applies best iteration to canvas
      setIterHistory(history);
      setIterIdx(bestIdx);
      setTs(tsd);
      setMet({ n: pts.length, minDist: bIt.minDist, avgD, covPct: bIt.coverage, pl: env === "Indoor" ? plIndoor(avgD, ple, wallAtt) : plFSPL(avgD), conn: bIt.connected, W: aW, H: aH, sR, battLife: tsd[tsd.length - 1]?.day || 0, firstDeath: fd, totalArea: aW * aH });
      setDone(true); setTab("viz"); setLoading(false);
    }
    }, 0); // end setTimeout
  }, [numNodes, aW, aH, sensor, placement, battType, capacity, txInt, ple, wallAtt, env, recompute, calcCov, calcConn, finalize]);

  // Jump to any iteration from the slider
  const goToIter = useCallback((idx) => {
    if (!iterHistory[idx]) return;
    const it = iterHistory[idx];
    setIterIdx(idx);
    setNodes(it.pts);
    setEdgesArr(it.edges);
    setCellsArr(it.cells);
    setMet(prev => prev ? { ...prev, covPct: it.coverage, conn: it.connected, minDist: it.minDist } : prev);
  }, [iterHistory]);

  // Play through all iterations like an animation
  const playIters = useCallback(() => {
    if (iterHistory.length === 0) return;
    setIterPlaying(true);
    let i = 0;
    goToIter(0);
    iterPlayRef.current = setInterval(() => {
      i++;
      if (i >= iterHistory.length) {
        clearInterval(iterPlayRef.current);
        setIterPlaying(false);
        return;
      }
      goToIter(i);
    }, 600);
  }, [iterHistory, goToIter]);

  const stopPlay = useCallback(() => {
    clearInterval(iterPlayRef.current);
    setIterPlaying(false);
  }, []);

  // When a new Hybrid simulation finishes, apply best iteration to canvas
  // (useEffect ensures iterHistory state is fully updated before applying)
  useEffect(() => {
    if (iterHistory.length === 0) return;
    const it = iterHistory[bestIterRef.current];
    if (!it) return;
    setNodes([...it.pts]);
    setEdgesArr([...it.edges]);
    setCellsArr([...it.cells]);
  }, [iterHistory]); // only fires when new simulation runs, not on slider moves

  // ─── CANVAS (Indoor + Outdoor — same rendering, only propagation differs) ───
  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !met) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cw = c.parentElement?.clientWidth || 700;
    const ch = Math.round(cw * (met.H / met.W));
    c.style.width = cw + "px"; c.style.height = ch + "px";
    c.width = cw * dpr; c.height = ch * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = cw / met.W, sy = ch / met.H;

    ctx.fillStyle = "#060a14"; ctx.fillRect(0, 0, cw, ch);
    // Grid
    ctx.strokeStyle = "rgba(59,158,255,0.05)"; ctx.lineWidth = 0.5;
    const gs = Math.max(5, Math.round(met.W / 20));
    for (let x = 0; x <= met.W; x += gs) { ctx.beginPath(); ctx.moveTo(x * sx, 0); ctx.lineTo(x * sx, ch); ctx.stroke(); }
    for (let y = 0; y <= met.H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y * sy); ctx.lineTo(cw, y * sy); ctx.stroke(); }
    ctx.fillStyle = "rgba(90,122,154,0.35)"; ctx.font = "9px monospace";
    for (let x = 0; x <= met.W; x += gs * 2) ctx.fillText(x + "m", x * sx + 2, ch - 4);

    // Env label top-right
    ctx.fillStyle = env === "Outdoor" ? "rgba(34,211,238,0.6)" : "rgba(59,158,255,0.6)";
    ctx.font = "bold 10px monospace"; ctx.textAlign = "right";
    ctx.fillText((env === "Outdoor" ? "🌍 Outdoor" : "🏢 Indoor") + " · Free-space PL" , cw - 8, 14);
    ctx.textAlign = "start";

    // Area boundary
    ctx.strokeStyle = "rgba(59,158,255,0.55)"; ctx.lineWidth = 2; ctx.setLineDash([8, 4]);
    ctx.strokeRect(1, 1, cw - 2, ch - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(59,158,255,0.35)"; ctx.font = "bold 10px monospace";
    ctx.fillText(met.W + "m × " + met.H + "m", 6, 14);

    if (ov === "coverage" || ov === "hybrid") {
      for (const n of nodes) { if (!n.alive) continue; const g = ctx.createRadialGradient(n.x*sx,n.y*sy,0,n.x*sx,n.y*sy,met.sR*sx); g.addColorStop(0,"rgba(16,185,129,0.13)"); g.addColorStop(1,"rgba(16,185,129,0)"); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(n.x*sx,n.y*sy,met.sR*sx,0,Math.PI*2); ctx.fill(); ctx.strokeStyle="rgba(16,185,129,0.18)"; ctx.lineWidth=1; ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]); }
    }
    if (ov === "voronoi" || ov === "hybrid") {
      const cols = ["rgba(59,158,255,0.08)","rgba(167,139,250,0.08)","rgba(34,211,238,0.08)","rgba(245,158,11,0.07)","rgba(236,72,153,0.07)","rgba(16,185,129,0.07)"];
      cellsArr.forEach((cell, i) => {
        if (cell.length < 3) return;
        ctx.beginPath(); ctx.moveTo(cell[0].x*sx,cell[0].y*sy);
        for (let j=1;j<cell.length;j++) ctx.lineTo(cell[j].x*sx,cell[j].y*sy);
        ctx.closePath(); ctx.fillStyle=cols[i%cols.length]; ctx.fill();
        ctx.strokeStyle="rgba(59,158,255,0.22)"; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
        const cx2=cell.reduce((s,v)=>s+v.x,0)/cell.length, cy2=cell.reduce((s,v)=>s+v.y,0)/cell.length;
        if (nodes[i]?.area > 0) { ctx.fillStyle="rgba(90,122,154,0.45)"; ctx.font="9px monospace"; ctx.textAlign="center"; ctx.fillText(nodes[i].area.toFixed(0)+"m²",cx2*sx,cy2*sy+3); ctx.textAlign="start"; }
      });
    }
    if (ov === "delaunay" || ov === "hybrid") {
      for (const e of edgesArr) {
        const a = e.a ?? e[0], b = e.b ?? e[1], inR = e.inRange !== false;
        const na=nodes[a],nb=nodes[b];
        ctx.beginPath(); ctx.moveTo(na.x*sx,na.y*sy); ctx.lineTo(nb.x*sx,nb.y*sy);
        // Green = in range (can communicate), Red = out of range (too far)
        ctx.strokeStyle = inR ? (na.alive&&nb.alive?"rgba(167,139,250,0.55)":"rgba(239,68,68,0.25)") : "rgba(239,68,68,0.35)";
        ctx.lineWidth = inR ? 1.4 : 1;
        if (!inR) ctx.setLineDash([4, 4]);
        ctx.stroke(); ctx.setLineDash([]);
        const d=Math.hypot(na.x-nb.x,na.y-nb.y);
        ctx.fillStyle = inR ? "rgba(167,139,250,0.5)" : "rgba(239,68,68,0.6)";
        ctx.font="8px monospace"; ctx.textAlign="center";
        ctx.fillText(d.toFixed(1)+"m"+(inR?"":" ✗"),(na.x+nb.x)/2*sx,(na.y+nb.y)/2*sy-5); ctx.textAlign="start";
      }
    }
    // Min dist
    if (met.minDist > 0) {
      let bA=-1,bB=-1,bD=Infinity;
      for (const e of edgesArr) { const a=e.a??e[0],b=e.b??e[1]; const d=Math.hypot(nodes[a].x-nodes[b].x,nodes[a].y-nodes[b].y); if(d<bD){bD=d;bA=a;bB=b;} }
      if (bA >= 0) {
        ctx.beginPath(); ctx.moveTo(nodes[bA].x*sx,nodes[bA].y*sy); ctx.lineTo(nodes[bB].x*sx,nodes[bB].y*sy);
        ctx.strokeStyle="#f59e0b"; ctx.lineWidth=2.5; ctx.setLineDash([6,3]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle="#f59e0b"; ctx.font="bold 11px monospace"; ctx.textAlign="center";
        ctx.fillText("MIN: "+bD.toFixed(2)+"m",(nodes[bA].x+nodes[bB].x)/2*sx,(nodes[bA].y+nodes[bB].y)/2*sy-10); ctx.textAlign="start";
      }
    }
    for (const n of nodes) {
      const nx=n.x*sx,ny=n.y*sy;
      if (n.alive) { const g=ctx.createRadialGradient(nx,ny,0,nx,ny,16); g.addColorStop(0,"rgba(59,158,255,0.3)"); g.addColorStop(1,"rgba(59,158,255,0)"); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(nx,ny,16,0,Math.PI*2); ctx.fill(); }
      ctx.beginPath(); ctx.arc(nx,ny,7,0,Math.PI*2); ctx.fillStyle=n.alive?"#3b9eff":"#ef4444"; ctx.fill();
      ctx.strokeStyle=n.alive?"#7ec8ff":"#fca5a5"; ctx.lineWidth=1.5; ctx.stroke();
      ctx.fillStyle="#d6e4f0"; ctx.font="bold 9px monospace"; ctx.textAlign="center"; ctx.fillText(n.id,nx,ny-13); ctx.textAlign="start";
    }
  }, [nodes, edgesArr, cellsArr, met, ov, env]);

  useEffect(() => {
    if (!done) return;
    draw();
  }, [done, draw, ov, env]);

  // ─── CHARTS ───
  const drawChart = useCallback((ref, data, yKey, color, fill, unit) => {
    const c = ref.current; if (!c || !data.length) return;
    const ctx = c.getContext("2d"); const dpr = window.devicePixelRatio||1;
    const w = c.parentElement?.clientWidth || 300; const h = 170;
    c.style.width=w+"px"; c.style.height=h+"px"; c.width=w*dpr; c.height=h*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const p={t:8,r:8,b:24,l:40},pw=w-p.l-p.r,ph=h-p.t-p.b;
    const maxY=Math.max(...data.map(d=>d[yKey]),1), maxX=Math.max(...data.map(d=>d.day),1);
    ctx.fillStyle="#060a14"; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="rgba(59,158,255,0.06)"; ctx.lineWidth=0.5;
    for(let i=0;i<=4;i++){const y2=p.t+(i/4)*ph;ctx.beginPath();ctx.moveTo(p.l,y2);ctx.lineTo(w-p.r,y2);ctx.stroke();ctx.fillStyle="rgba(90,122,154,0.5)";ctx.font="8px monospace";ctx.textAlign="right";ctx.fillText((maxY*(1-i/4)).toFixed(0)+(unit||""),p.l-3,y2+3);}
    ctx.textAlign="center";const xS2=Math.max(1,Math.floor(data.length/5));
    for(let i=0;i<data.length;i+=xS2){ctx.fillStyle="rgba(90,122,154,0.35)";ctx.fillText("D"+data[i].day,p.l+(data[i].day/maxX)*pw,h-5);}
    ctx.beginPath();ctx.moveTo(p.l,p.t+ph);
    for(const d of data)ctx.lineTo(p.l+(d.day/maxX)*pw,p.t+(1-d[yKey]/maxY)*ph);
    ctx.lineTo(p.l+(data[data.length-1].day/maxX)*pw,p.t+ph);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
    ctx.beginPath();data.forEach((d,i)=>{const x=p.l+(d.day/maxX)*pw,y2=p.t+(1-d[yKey]/maxY)*ph;i===0?ctx.moveTo(x,y2):ctx.lineTo(x,y2);});
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
  }, []);

  useEffect(() => {
    if (!done || tab !== "charts") return;
    setTimeout(() => {
      drawChart(chartRefs[0], ts, "batt", "#3b9eff", "rgba(59,158,255,0.1)", "%");
      drawChart(chartRefs[1], ts, "alive", "#10b981", "rgba(16,185,129,0.1)", "");
      drawChart(chartRefs[2], ts, "cov", "#a78bfa", "rgba(167,139,250,0.1)", "%");
      drawChart(chartRefs[3], ts, "energy", "#f59e0b", "rgba(245,158,11,0.1)", "");
    }, 50);
  }, [done, tab, ts, drawChart]);

  // ─── MOUSE HANDLERS (Indoor) ───
  const iDown = (e) => {
    if (!met) return;
    const r=canvasRef.current.getBoundingClientRect();
    const mx=(e.clientX-r.left)/r.width*met.W, my=(e.clientY-r.top)/r.height*met.H;
    if (e.button===2) return;
    let cl2=-1,cd=10/(r.width/met.W);
    nodes.forEach((n,i)=>{const d=Math.hypot(n.x-mx,n.y-my);if(d<cd){cd=d;cl2=i;}});
    if(cl2>=0){dragRef.current=cl2;}
  };
  const iMove = (e) => {
    if(dragRef.current<0||!met) return;
    const r=canvasRef.current.getBoundingClientRect();
    const mx=Math.max(0,Math.min(met.W,(e.clientX-r.left)/r.width*met.W));
    const my=Math.max(0,Math.min(met.H,(e.clientY-r.top)/r.height*met.H));
    const nn=[...nodes];nn[dragRef.current]={...nn[dragRef.current],x:mx,y:my};
    const sR=SENSORS[sensor].range;
    const{edges:ne,cells:nc,minDist}=recompute(nn,sR*2);
    const newCov=calcCov(nn,sR);
    const newConn=calcConn(nn,ne);
    setNodes(nn);setEdgesArr(ne);setCellsArr(nc);
    setMet(m=>({...m,minDist,covPct:newCov,conn:newConn}));
  };
  const iUp = () => { dragRef.current = -1; };
  const iCtx = (e) => {
    e.preventDefault(); if(!met) return;
    const r=canvasRef.current.getBoundingClientRect();
    const mx=(e.clientX-r.left)/r.width*met.W, my=(e.clientY-r.top)/r.height*met.H;
    let cl2=-1,cd=12/(r.width/met.W);
    nodes.forEach((n,i)=>{const d=Math.hypot(n.x-mx,n.y-my);if(d<cd){cd=d;cl2=i;}});
    if(cl2>=0){const nn=[...nodes];nn[cl2]={...nn[cl2],alive:!nn[cl2].alive};setNodes(nn);}
  };


  // ─── RECOMMENDATIONS ───
  const recs = [];
  let healthScore = 0;
  if (met) {
    const { n, sR, covPct, conn, battLife, firstDeath, avgD, minDist, pl, totalArea } = met;
    const commRange = sR * 2;
    const req = Math.ceil(totalArea / (Math.PI * sR * sR * 0.8));
    const optSpacing = +(sR * Math.sqrt(3)).toFixed(1);
    const tooClose = minDist < sR * 0.5;
    const tooSparse = avgD > sR * 3;

    // Health score: Coverage 40pts + Connectivity 30pts + Battery 20pts + Spacing 10pts
    healthScore = Math.round(
      Math.min(40, (covPct / 100) * 40) +
      (conn ? 30 : 0) +
      Math.min(20, (battLife / 400) * 20) +
      (tooClose ? 0 : tooSparse ? 5 : 10)
    );

    // Coverage
    if (covPct >= 95)
      recs.push({ t: "ok", cat: "Coverage", text: `Excellent — ${covPct.toFixed(1)}% area covered` });
    else if (covPct >= 80)
      recs.push({ t: "warn", cat: "Coverage", text: `Coverage ${covPct.toFixed(1)}% — add ${Math.max(0, req - n)} node(s) to reach 95%+` });
    else
      recs.push({ t: "err", cat: "Coverage", text: `Low coverage ${covPct.toFixed(1)}% — need ${req - n} more nodes (recommended: ${req})` });

    // Connectivity
    if (conn)
      recs.push({ t: "ok", cat: "Connectivity", text: `Fully connected — all ${n} nodes reachable via Delaunay mesh` });
    else
      recs.push({ t: "err", cat: "Connectivity", text: `DISCONNECTED — isolated nodes detected. Add relay nodes or keep distances < ${commRange.toFixed(0)}m` });

    // Battery
    if (battLife >= 200)
      recs.push({ t: "ok", cat: "Battery", text: `Long lifetime: ${battLife} days · First node death: day ${firstDeath}` });
    else if (battLife >= 60)
      recs.push({ t: "warn", cat: "Battery", text: `Moderate lifetime: ${battLife} days · Try higher-capacity battery or longer TX interval` });
    else
      recs.push({ t: "err", cat: "Battery", text: `Short lifetime: ${battLife} days · Use Li-ion 3000mAh and reduce TX frequency` });

    // Placement / spacing
    if (tooClose)
      recs.push({ t: "warn", cat: "Placement", text: `Nodes too close — min dist ${minDist.toFixed(1)}m (threshold: ${(sR * 0.5).toFixed(1)}m). Redundant overlap.` });
    else if (tooSparse)
      recs.push({ t: "warn", cat: "Placement", text: `Nodes too spread — avg dist ${avgD.toFixed(1)}m. Coverage gaps likely. Optimal spacing: ${optSpacing}m` });
    else
      recs.push({ t: "ok", cat: "Placement", text: `Good spacing — min ${minDist.toFixed(1)}m, avg ${avgD.toFixed(1)}m (optimal: ${optSpacing}m)` });

    // RF signal
    recs.push({ t: pl < 70 ? "ok" : "info", cat: "RF Signal", text: `Path loss ${pl.toFixed(1)} dB at avg dist ${avgD.toFixed(1)}m · Comm range: ${commRange.toFixed(0)}m (${env} model)` });

    // Node count
    recs.push({ t: n >= req ? "info" : "warn", cat: "Nodes", text: `${n} deployed · ${req} recommended for 80% efficiency · Sensor range: ${sR}m` });
  }

  // ══════════════ AUTH ══════════════
  if (!user) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(145deg,#05080f,#0a1020)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ width: 380, padding: 36, borderRadius: 16, background: "#0b1120", border: "1px solid rgba(100,180,255,0.12)", boxShadow: "0 0 60px rgba(59,158,255,0.06)" }}>
        <div style={{ fontSize: 26, fontWeight: 800, textAlign: "center", background: "linear-gradient(135deg,#3b9eff,#22d3ee)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 4 }}>WSN Simulator</div>
        <div style={{ textAlign: "center", fontSize: 12, color: "#3a5570", marginBottom: 24 }}>Voronoi–Delaunay Hybrid Model</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
          {["login", "register"].map(m => <button key={m} onClick={() => { setAuthMode(m); setAuthErr(""); }} style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, background: authMode === m ? "linear-gradient(135deg,#3b9eff,#22d3ee)" : "#111a2e", color: authMode === m ? "#fff" : "#5a7a9a", fontFamily: "'DM Sans',sans-serif" }}>{m === "login" ? "Sign In" : "Register"}</button>)}
        </div>
        {authMode === "register" && <input style={inpS} placeholder="Name" value={af.name} onChange={e => setAf(f => ({ ...f, name: e.target.value }))} />}
        <input style={inpS} placeholder="Email" value={af.email} onChange={e => setAf(f => ({ ...f, email: e.target.value }))} />
        <input style={inpS} placeholder="Password" type="password" value={af.password} onChange={e => setAf(f => ({ ...f, password: e.target.value }))} onKeyDown={e => e.key === "Enter" && doAuth()} />
        {authErr && <div style={{ color: "#ef4444", fontSize: 12, margin: "4px 0" }}>{authErr}</div>}
        <button onClick={doAuth} style={{ width: "100%", padding: 14, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, background: "linear-gradient(135deg,#3b9eff,#22d3ee)", color: "#fff", marginTop: 6, boxShadow: "0 4px 20px rgba(59,158,255,0.2)", fontFamily: "'DM Sans',sans-serif" }}>{authMode === "login" ? "Sign In" : "Create Account"}</button>
        <div style={{ marginTop: 12, fontSize: 11, color: "#3a5570", textAlign: "center" }}>Demo: demo@test.com / 123</div>
      </div>
    </div>
  );

  // ══════════════ APP ══════════════
  const gBtn = (active) => ({ padding: "5px 14px", borderRadius: 6, border: "1px solid " + (active ? "#3b9eff" : "rgba(100,180,255,0.1)"), background: active ? "rgba(59,158,255,0.15)" : "rgba(100,180,255,0.06)", color: active ? "#3b9eff" : "#5a7a9a", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" });

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(145deg,#05080f,#0a1020)", color: "#d6e4f0", fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column" }}>
      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", borderBottom: "1px solid rgba(100,180,255,0.1)", background: "rgba(5,8,15,0.95)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20, fontWeight: 800, background: "linear-gradient(135deg,#3b9eff,#22d3ee)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>⬡ WSN Simulator</span>
          <span style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.5, background: "rgba(59,158,255,0.12)", color: "#3b9eff", padding: "3px 10px", borderRadius: 20 }}>HYBRID</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "#5a7a9a" }}>Hi, <b style={{ color: "#22d3ee" }}>{user.name || user.email}</b></span>
          <button style={gBtn(false)} onClick={() => setUser(null)}>Logout</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* SIDEBAR */}
        <div style={{ width: 300, flexShrink: 0, overflowY: "auto", padding: 14, borderRight: "1px solid rgba(100,180,255,0.1)", background: "rgba(8,12,22,0.5)" }}>
          <ST>Environment</ST>
          <div style={{ display: "flex", gap: 4 }}>
            {["Indoor", "Outdoor"].map(e => <button key={e} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid " + (env === e ? "#3b9eff" : "rgba(100,180,255,0.1)"), background: env === e ? "rgba(59,158,255,0.12)" : "transparent", color: env === e ? "#3b9eff" : "#5a7a9a", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans'" }} onClick={() => setEnv(e)}>{e === "Indoor" ? "🏢" : "🌍"} {e}</button>)}
          </div>
          <ST>Network</ST>
          <FLab>Nodes</FLab><FIn type="number" value={numNodes} onChange={e => setNumNodes(+e.target.value || 3)} />
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1 }}><FLab>W (m)</FLab><FIn type="number" value={aW} onChange={e => setAW(+e.target.value || 10)} /></div>
            <div style={{ flex: 1 }}><FLab>H (m)</FLab><FIn type="number" value={aH} onChange={e => setAH(+e.target.value || 10)} /></div>
          </div>
          <FLab>Sensor</FLab>
          <FSel value={sensor} onChange={e => setSensor(e.target.value)}>{Object.entries(SENSORS).map(([k, v]) => <option key={k} value={k}>{k} ({v.range}m)</option>)}</FSel>
          <FLab>Placement</FLab>
          <div style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #3b9eff", background: "rgba(59,158,255,0.12)", color: "#3b9eff", fontSize: 10, fontWeight: 600, fontFamily: "'DM Sans'", textAlign: "center" }}>Hybrid (Voronoi–Delaunay)</div>
          <ST>Energy</ST>
          <FLab>Battery</FLab>
          <FSel value={battType} onChange={e => { setBattType(e.target.value); setCapacity(BATTS[e.target.value].cap); }}>{Object.entries(BATTS).map(([k, v]) => <option key={k} value={k}>{k} ({v.v}V)</option>)}</FSel>
          <FLab>Capacity (mAh)</FLab><FIn type="number" value={capacity} onChange={e => setCapacity(+e.target.value || 100)} />
          <FLab>TX Interval (s)</FLab><FIn type="number" value={txInt} onChange={e => setTxInt(+e.target.value || 1)} />
          {env === "Indoor" && <><ST>Propagation</ST><FLab>PL Exponent: {ple}</FLab><input type="range" min={2} max={5} step={0.1} value={ple} onChange={e => setPle(+e.target.value)} style={{ width: "100%", accentColor: "#3b9eff" }} /><FLab>Wall Atten: {wallAtt} dB</FLab><input type="range" min={0} max={25} step={1} value={wallAtt} onChange={e => setWallAtt(+e.target.value)} style={{ width: "100%", accentColor: "#3b9eff" }} /></>}
          {env === "Outdoor" && <><ST>Propagation</ST><FLab>PL Exponent: {ple}</FLab><input type="range" min={2} max={5} step={0.1} value={ple} onChange={e => setPle(+e.target.value)} style={{ width: "100%", accentColor: "#3b9eff" }} /></>}
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "rgba(59,158,255,0.04)", border: "1px solid rgba(100,180,255,0.1)", fontSize: 9, lineHeight: 1.6, color: "#5a7a9a", fontFamily: "monospace" }}><b style={{ color: "#3b9eff" }}>Assumptions:</b> E_tx=50nJ/bit · Amp=100pJ/bit/m² · E_rx=50nJ/bit · Pkt=4000b</div>
          <button onClick={runSim} disabled={loading} style={{ width: "100%", marginTop: 12, padding: 14, borderRadius: 10, border: "none", cursor: loading ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, background: loading ? "rgba(59,158,255,0.3)" : "linear-gradient(135deg,#3b9eff,#1d7cd6,#22d3ee)", color: "#fff", boxShadow: "0 4px 20px rgba(59,158,255,0.2)", fontFamily: "'DM Sans'", transition: "all 0.2s" }}>
            {loading ? "⏳ Computing..." : "▶ Run Simulation"}
          </button>
        </div>

        {/* CONTENT */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {!done ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12, opacity: 0.4 }}><div style={{ fontSize: 50 }}>⬡</div><div style={{ color: "#5a7a9a" }}>Configure and run simulation</div></div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Toolbar */}
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                <div style={{ display: "flex", gap: 4 }}>{["voronoi", "delaunay", "hybrid", "coverage"].map(o => <button key={o} onClick={() => setOv(o)} style={gBtn(ov === o)}>{o[0].toUpperCase() + o.slice(1)}</button>)}</div>
                <div style={{ display: "flex", gap: 4 }}>{[["viz", "Map"], ["charts", "Charts"], ["table", "Nodes"]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ ...gBtn(tab === k), ...(tab === k ? { borderColor: "#22d3ee", color: "#22d3ee", background: "rgba(34,211,238,0.1)" } : {}) }}>{l}</button>)}</div>
              </div>
              {/* Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6 }}>
                {[["Nodes", met.n, "#3b9eff"], ["Coverage", met.covPct.toFixed(1) + "%", "#22d3ee"], ["Min Dist", met.minDist.toFixed(2) + "m", "#f59e0b"], ["Avg Dist", met.avgD.toFixed(2) + "m", "#a78bfa"], ["PL", met.pl.toFixed(1) + "dB", "#ec4899"], ["Battery", met.battLife + "d", "#10b981"], ["1st Death", "D" + met.firstDeath, "#ef4444"], ["Connected", met.conn ? "✓" : "✗", met.conn ? "#10b981" : "#ef4444"]].map(([l, v, c]) => (
                  <div key={l} style={{ padding: "10px 12px", borderRadius: 10, background: "#0b1120", border: "1px solid rgba(100,180,255,0.1)" }}>
                    <div style={{ fontSize: 8, color: "#5a7a9a", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 3 }}>{l}</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: c, fontFamily: "monospace", letterSpacing: -0.5 }}>{v}</div>
                  </div>
                ))}
              </div>
              {/* VIZ */}
              {tab === "viz" && <div style={{ background: "#0b1120", border: "1px solid rgba(100,180,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ fontSize: 10, color: "#3a5570", padding: "6px 12px", borderBottom: "1px solid rgba(100,180,255,0.06)", fontFamily: "monospace" }}>{"Drag=move · Right-click=kill/revive · Click=place (Manual)"}</div>
                <canvas ref={canvasRef} style={{ display: "block", width: "100%", cursor: "crosshair" }} onMouseDown={iDown} onMouseMove={iMove} onMouseUp={iUp} onMouseLeave={iUp} onContextMenu={iCtx} />
                {/* ITERATION PANEL — only for Hybrid */}
                {iterHistory.length > 0 && (
                  <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(100,180,255,0.08)", background: "rgba(6,10,20,0.6)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: "#3b9eff" }}>Iterations</span>
                      <button onClick={iterPlaying ? stopPlay : playIters} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(59,158,255,0.3)", background: iterPlaying ? "rgba(239,68,68,0.1)" : "rgba(59,158,255,0.1)", color: iterPlaying ? "#ef4444" : "#3b9eff", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "'DM Sans'" }}>
                        {iterPlaying ? "■ Stop" : "▶ Play"}
                      </button>
                      <span style={{ fontSize: 10, color: "#5a7a9a", fontFamily: "monospace" }}>
                        {iterIdx + 1} / {iterHistory.length} &nbsp;|&nbsp;
                        Coverage: <b style={{ color: "#22d3ee" }}>{iterHistory[iterIdx]?.coverage}%</b> &nbsp;|&nbsp;
                        {iterHistory[iterIdx]?.connected ? <span style={{ color: "#10b981" }}>Connected ✓</span> : <span style={{ color: "#ef4444" }}>Disconnected ✗</span>}
                        {iterIdx === iterHistory.reduce((bi, it, i) => (it.coverage > iterHistory[bi].coverage ? i : bi), 0) && <span style={{ marginLeft: 8, color: "#f59e0b", fontWeight: 700 }}>★ Best</span>}
                      </span>
                    </div>
                    <input type="range" min={0} max={iterHistory.length - 1} value={iterIdx}
                      onChange={e => goToIter(+e.target.value)}
                      style={{ width: "100%", accentColor: "#3b9eff", cursor: "pointer" }} />
                    {/* Mini coverage chart per iteration */}
                    <div style={{ display: "flex", gap: 3, marginTop: 8, alignItems: "flex-end", height: 36 }}>
                      {iterHistory.map((it, i) => (
                        <div key={i} onClick={() => goToIter(i)} title={`Iter ${i + 1}: ${it.coverage}%`}
                          style={{ flex: 1, height: (it.coverage / 100) * 36 + "px", minHeight: 3, borderRadius: 2, cursor: "pointer", transition: "opacity 0.2s",
                            background: i === iterIdx ? "#3b9eff" : it.connected ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.4)",
                            outline: i === iterIdx ? "1px solid #3b9eff" : "none" }} />
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#3a5570", fontFamily: "monospace", marginTop: 2 }}>
                      <span>Iter 1 (Random)</span><span>→ Optimization →</span><span>Iter {iterHistory.length} (Final)</span>
                    </div>
                  </div>
                )}
              </div>}
              {/* CHARTS */}
              {tab === "charts" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[["Battery % vs Time", 0], ["Alive Nodes vs Time", 1], ["Coverage % vs Time", 2], ["Energy Consumed", 3]].map(([t, i]) => (
                  <div key={t} style={{ background: "#0b1120", border: "1px solid rgba(100,180,255,0.1)", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#5a7a9a", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{t}</div>
                    <canvas ref={chartRefs[i]} style={{ width: "100%", height: 170 }} />
                  </div>
                ))}
              </div>}
              {/* TABLE */}
              {tab === "table" && <div style={{ background: "#0b1120", border: "1px solid rgba(100,180,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ maxHeight: 400, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                    <thead><tr>{["ID", "Status", "X(m)", "Y(m)", "V.Area", "MinN", "Action"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 8, textTransform: "uppercase", letterSpacing: 1, color: "#3a5570", borderBottom: "1px solid rgba(100,180,255,0.08)", fontWeight: 600 }}>{h}</th>)}</tr></thead>
                    <tbody>{nodes.map(nd => {
                      return <tr key={nd.id} style={{ borderBottom: "1px solid rgba(100,180,255,0.04)" }}>
                        <td style={tdS}><b style={{ color: "#3b9eff" }}>#{nd.id}</b></td>
                        <td style={tdS}><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: nd.alive ? "#10b981" : "#ef4444", marginRight: 4, boxShadow: "0 0 4px " + (nd.alive ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)") }} />{nd.alive ? "Alive" : "Dead"}</td>
                        <td style={tdS}>{nd.x.toFixed(1)}</td>
                        <td style={tdS}>{nd.y.toFixed(1)}</td>
                        <td style={tdS}>{(nd.area || 0).toFixed(1)}m²</td>
                        <td style={tdS}>{(nd.minN || 0).toFixed(1)}m</td>
                        <td style={tdS}><button style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid " + (nd.alive ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"), background: "transparent", color: nd.alive ? "#ef4444" : "#10b981", cursor: "pointer", fontSize: 9, fontWeight: 600, fontFamily: "'DM Sans'" }} onClick={() => { const nn = [...nodes]; nn[nd.id] = { ...nn[nd.id], alive: !nn[nd.id].alive }; setNodes(nn); }}>{nd.alive ? "Kill" : "Revive"}</button></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </div>}
              {/* RECS */}
              <div style={{ background: "#0b1120", border: "1px solid rgba(100,180,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(100,180,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: "#3b9eff" }}>Recommendations</span>
                  {met && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 80, height: 5, borderRadius: 3, background: "rgba(100,180,255,0.1)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: healthScore + "%", borderRadius: 3, background: healthScore >= 80 ? "#10b981" : healthScore >= 50 ? "#f59e0b" : "#ef4444", transition: "width 0.4s" }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: healthScore >= 80 ? "#10b981" : healthScore >= 50 ? "#f59e0b" : "#ef4444" }}>
                        {healthScore}/100
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                  {!met && <div style={{ padding: "16px 12px", textAlign: "center", color: "#3a5570", fontSize: 12 }}>Run a simulation to see recommendations</div>}
                  {recs.map((r, i) => {
                    const colors = {
                      ok:   { bg: "rgba(16,185,129,0.06)",  border: "rgba(16,185,129,0.2)",  text: "#6ee7b7", icon: "✓" },
                      warn: { bg: "rgba(245,158,11,0.06)",  border: "rgba(245,158,11,0.2)",  text: "#fcd34d", icon: "⚡" },
                      err:  { bg: "rgba(239,68,68,0.06)",   border: "rgba(239,68,68,0.2)",   text: "#fca5a5", icon: "⚠" },
                      info: { bg: "rgba(59,158,255,0.05)",  border: "rgba(59,158,255,0.15)", text: "#7ec8ff", icon: "·" },
                    };
                    const c = colors[r.t] || colors.info;
                    return (
                      <div key={i} style={{ padding: "7px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.5, background: c.bg, border: "1px solid " + c.border, color: c.text, display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ flexShrink: 0, fontSize: 11, marginTop: 1 }}>{c.icon}</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, opacity: 0.6, marginRight: 6 }}>{r.cat}</span>
                          {r.text}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Tiny helpers
function ST({ children }) { return <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: "#3b9eff", margin: "14px 0 5px", paddingBottom: 4, borderBottom: "1px solid rgba(100,180,255,0.1)" }}>{children}</div>; }
function FLab({ children }) { return <div style={{ fontSize: 10, color: "#5a7a9a", margin: "5px 0 2px", fontFamily: "monospace" }}>{children}</div>; }
function FIn(props) { return <input {...props} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, fontSize: 12, fontFamily: "monospace", background: "#111a2e", color: "#d6e4f0", border: "1px solid rgba(100,180,255,0.1)", outline: "none", boxSizing: "border-box" }} />; }
function FSel({ children, ...p }) { return <select {...p} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, fontSize: 12, fontFamily: "monospace", background: "#111a2e", color: "#d6e4f0", border: "1px solid rgba(100,180,255,0.1)", outline: "none" }}>{children}</select>; }
const inpS = { width: "100%", padding: "11px 14px", borderRadius: 8, marginBottom: 10, background: "#111a2e", border: "1px solid rgba(100,180,255,0.12)", color: "#d6e4f0", fontSize: 13, fontFamily: "'DM Sans',sans-serif", outline: "none", boxSizing: "border-box" };
const tdS = { padding: "6px 10px", color: "#5a7a9a" };
