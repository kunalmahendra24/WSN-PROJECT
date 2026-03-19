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
// TILE MAP UTILS (OpenStreetMap)
// ═══════════════════════════════════════════════════════════════
function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}
function tileToLatLng(tx, ty, zoom) {
  const n = Math.pow(2, zoom);
  const lng = (tx / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
  return { lat: (latRad * 180) / Math.PI, lng };
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
  const [placement, setPlacement] = useState("Random");
  const [battType, setBattType] = useState("Li-ion");
  const [capacity, setCapacity] = useState(3000);
  const [txInt, setTxInt] = useState(30);
  const [ple, setPle] = useState(4.0);
  const [wallAtt, setWallAtt] = useState(5);
  const [cLat, setCLat] = useState(23.0225);
  const [cLng, setCLng] = useState(72.5714);

  const [nodes, setNodes] = useState([]);
  const [edgesArr, setEdgesArr] = useState([]);
  const [cellsArr, setCellsArr] = useState([]);
  const [met, setMet] = useState(null);
  const [ts, setTs] = useState([]);
  const [done, setDone] = useState(false);
  const [ov, setOv] = useState("hybrid");
  const [tab, setTab] = useState("viz");

  const indoorRef = useRef(null);
  const outdoorRef = useRef(null);
  const dragRef = useRef(-1);
  const tileCache = useRef({});
  const mZoom = useRef(16);
  const mDragS = useRef(null);
  const mOff = useRef({ x: 0, y: 0 });
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

  const recompute = useCallback((pts) => {
    if (pts.length < 3) return { edges: [], cells: [], minDist: 0 };
    const { tris, edges: ed } = delaunay(pts);
    const cl = voronoiFn(pts, tris);
    let gMin = Infinity;
    pts.forEach((p, i) => {
      const nb = [];
      for (const [a, b] of ed) { if (a === i) nb.push(b); else if (b === i) nb.push(a); }
      let md = Infinity;
      for (const n of nb) { const d = Math.hypot(pts[n].x - p.x, pts[n].y - p.y); if (d < md) md = d; if (d < gMin) gMin = d; }
      p.minN = md === Infinity ? 0 : md;
      p.area = polyArea(cl[i] || []);
      p.nb = nb;
    });
    return { edges: ed, cells: cl, minDist: gMin === Infinity ? 0 : gMin };
  }, []);

  const runSim = useCallback(() => {
    const sR = SENSORS[sensor].range, sP = SENSORS[sensor].power, bV = BATTS[battType].v;
    let pts;
    if (placement === "Grid") {
      const cols = Math.ceil(Math.sqrt(numNodes * aW / aH));
      const rows = Math.ceil(numNodes / cols);
      pts = Array.from({ length: numNodes }, (_, i) => ({ id: i, x: ((i % cols) + 1) * aW / (cols + 1), y: (Math.floor(i / cols) + 1) * aH / (rows + 1), alive: true, batt: 1 }));
    } else {
      pts = Array.from({ length: numNodes }, (_, i) => ({ id: i, x: Math.random() * aW * 0.85 + aW * 0.075, y: Math.random() * aH * 0.85 + aH * 0.075, alive: true, batt: 1 }));
    }
    const { edges: ed, cells: cl, minDist } = recompute(pts);
    let td = 0, dc = 0;
    for (const [a, b] of ed) { td += Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y); dc++; }
    const avgD = dc > 0 ? td / dc : 0;
    const covPct = Math.min(100, (pts.length * Math.PI * sR * sR) / (aW * aH) * 100);
    const pl = env === "Indoor" ? plIndoor(avgD, ple, wallAtt) : plFSPL(avgD);
    const vis = new Set([0]), q = [0];
    while (q.length) { const c = q.shift(); for (const [a, b] of ed) { const n = a === c ? b : b === c ? a : -1; if (n >= 0 && !vis.has(n)) { vis.add(n); q.push(n); } } }
    const conn = vis.size === pts.length;
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
    setNodes(pts); setEdgesArr(ed); setCellsArr(cl); setTs(tsd);
    setMet({ n: pts.length, minDist, avgD, covPct, pl, conn, W: aW, H: aH, sR, battLife: tsd[tsd.length - 1]?.day || 0, firstDeath: fd, totalArea: aW * aH });
    setDone(true); setTab("viz");
  }, [numNodes, aW, aH, sensor, placement, battType, capacity, txInt, ple, wallAtt, env, recompute]);

  // ─── INDOOR CANVAS ───
  const drawIndoor = useCallback(() => {
    const c = indoorRef.current;
    if (!c || !met || env !== "Indoor") return;
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
      for (const [a,b] of edgesArr) {
        const na=nodes[a],nb=nodes[b];
        ctx.beginPath(); ctx.moveTo(na.x*sx,na.y*sy); ctx.lineTo(nb.x*sx,nb.y*sy);
        ctx.strokeStyle=na.alive&&nb.alive?"rgba(167,139,250,0.4)":"rgba(239,68,68,0.25)"; ctx.lineWidth=1.2; ctx.stroke();
        const d=Math.hypot(na.x-nb.x,na.y-nb.y);
        ctx.fillStyle="rgba(167,139,250,0.4)"; ctx.font="8px monospace"; ctx.textAlign="center";
        ctx.fillText(d.toFixed(1)+"m",(na.x+nb.x)/2*sx,(na.y+nb.y)/2*sy-5); ctx.textAlign="start";
      }
    }
    // Min dist
    if (met.minDist > 0) {
      let bA=-1,bB=-1,bD=Infinity;
      for (const [a,b] of edgesArr) { const d=Math.hypot(nodes[a].x-nodes[b].x,nodes[a].y-nodes[b].y); if(d<bD){bD=d;bA=a;bB=b;} }
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

  // ─── OUTDOOR CANVAS (Tile Map) ───
  const drawOutdoor = useCallback(() => {
    const c = outdoorRef.current;
    if (!c || !met || env !== "Outdoor") return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cw = c.parentElement?.clientWidth || 700;
    const ch = 500;
    c.style.width = cw+"px"; c.style.height = ch+"px";
    c.width = cw*dpr; c.height = ch*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const z = mZoom.current;
    const ct = latLngToTile(cLat, cLng, z);
    const ox = ct.x - (cw/256)/2 + mOff.current.x/256;
    const oy = ct.y - (ch/256)/2 + mOff.current.y/256;

    ctx.fillStyle="#0a0f1a"; ctx.fillRect(0,0,cw,ch);
    const stx=Math.floor(ox), sty=Math.floor(oy), etx=Math.ceil(ox+cw/256), ety=Math.ceil(oy+ch/256);
    const n2z = Math.pow(2,z);
    for (let tx=stx;tx<=etx;tx++) for (let ty=sty;ty<=ety;ty++) {
      const px=(tx-ox)*256, py=(ty-oy)*256;
      const wtx = ((tx % n2z) + n2z) % n2z;
      const key=z+"/"+wtx+"/"+ty;
      if (tileCache.current[key]) { ctx.drawImage(tileCache.current[key],px,py,256,256); }
      else {
        ctx.fillStyle="#0d1520"; ctx.fillRect(px,py,256,256);
        ctx.strokeStyle="rgba(59,158,255,0.06)"; ctx.strokeRect(px,py,256,256);
        const img = new Image(); img.crossOrigin="anonymous";
        img.src = "https://tile.openstreetmap.org/"+z+"/"+wtx+"/"+ty+".png";
        const k2=key;
        img.onload = () => { tileCache.current[k2]=img; drawOutdoor(); };
      }
    }
    ctx.fillStyle="rgba(5,8,15,0.4)"; ctx.fillRect(0,0,cw,ch);

    const toP = (nd) => {
      const nLat = cLat + (nd.y - met.H/2)/111320;
      const nLng = cLng + (nd.x - met.W/2)/(111320*Math.cos(cLat*Math.PI/180));
      const t = latLngToTile(nLat,nLng,z);
      return { px:(t.x-ox)*256, py:(t.y-oy)*256 };
    };

    // Area boundary
    const corners=[{x:0,y:0},{x:met.W,y:0},{x:met.W,y:met.H},{x:0,y:met.H}].map(toP);
    ctx.beginPath(); ctx.moveTo(corners[0].px,corners[0].py); corners.forEach(c2=>ctx.lineTo(c2.px,c2.py)); ctx.closePath();
    ctx.strokeStyle="rgba(59,158,255,0.5)"; ctx.lineWidth=2; ctx.setLineDash([8,4]); ctx.stroke(); ctx.setLineDash([]);

    if (ov==="coverage"||ov==="hybrid") {
      for (const nd of nodes) { if(!nd.alive) continue; const p=toP(nd); const rn=toP({x:nd.x+met.sR,y:nd.y}); const rPx=Math.abs(rn.px-p.px);
        const g=ctx.createRadialGradient(p.px,p.py,0,p.px,p.py,rPx); g.addColorStop(0,"rgba(16,185,129,0.15)"); g.addColorStop(1,"rgba(16,185,129,0)");
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.px,p.py,rPx,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle="rgba(16,185,129,0.2)"; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (ov==="voronoi"||ov==="hybrid") {
      const cols2=["rgba(59,158,255,0.1)","rgba(167,139,250,0.1)","rgba(34,211,238,0.1)","rgba(245,158,11,0.08)"];
      cellsArr.forEach((cell,i)=>{ if(cell.length<3) return; const pv=cell.map(toP);
        ctx.beginPath(); ctx.moveTo(pv[0].px,pv[0].py); for(let j=1;j<pv.length;j++) ctx.lineTo(pv[j].px,pv[j].py); ctx.closePath();
        ctx.fillStyle=cols2[i%cols2.length]; ctx.fill(); ctx.strokeStyle="rgba(59,158,255,0.25)"; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      });
    }
    if (ov==="delaunay"||ov==="hybrid") {
      for (const [a,b] of edgesArr) { const pa=toP(nodes[a]),pb=toP(nodes[b]);
        ctx.beginPath(); ctx.moveTo(pa.px,pa.py); ctx.lineTo(pb.px,pb.py); ctx.strokeStyle="rgba(167,139,250,0.45)"; ctx.lineWidth=1.5; ctx.stroke();
        const d=Math.hypot(nodes[a].x-nodes[b].x,nodes[a].y-nodes[b].y);
        ctx.fillStyle="rgba(167,139,250,0.5)"; ctx.font="bold 9px monospace"; ctx.textAlign="center";
        ctx.fillText(d.toFixed(1)+"m",(pa.px+pb.px)/2,(pa.py+pb.py)/2-6); ctx.textAlign="start";
      }
    }
    for (const nd of nodes) { const p=toP(nd);
      if(nd.alive){const g=ctx.createRadialGradient(p.px,p.py,0,p.px,p.py,14);g.addColorStop(0,"rgba(59,158,255,0.4)");g.addColorStop(1,"rgba(59,158,255,0)");ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.px,p.py,14,0,Math.PI*2);ctx.fill();}
      ctx.beginPath();ctx.arc(p.px,p.py,8,0,Math.PI*2);ctx.fillStyle=nd.alive?"#3b9eff":"#ef4444";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle="#fff";ctx.font="bold 9px monospace";ctx.textAlign="center";ctx.fillText(nd.id,p.px,p.py-14);
      const nLat=(cLat+(nd.y-met.H/2)/111320).toFixed(4), nLn=(cLng+(nd.x-met.W/2)/(111320*Math.cos(cLat*Math.PI/180))).toFixed(4);
      ctx.fillStyle="rgba(255,255,255,0.35)";ctx.font="7px monospace";ctx.fillText(nLat+","+nLn,p.px,p.py+18);ctx.textAlign="start";
    }
    ctx.fillStyle="rgba(200,200,200,0.35)";ctx.font="9px sans-serif";ctx.textAlign="right";ctx.fillText("© OpenStreetMap",cw-6,ch-6);ctx.textAlign="start";
    ctx.fillStyle="rgba(59,158,255,0.55)";ctx.font="10px monospace";ctx.fillText("Zoom:"+z+" | Scroll=zoom · Drag=pan · Click=place",10,16);
  }, [nodes, edgesArr, cellsArr, met, ov, env, cLat, cLng]);

  useEffect(() => {
    if (!done) return;
    if (env === "Indoor") drawIndoor(); else drawOutdoor();
  }, [done, drawIndoor, drawOutdoor, ov, env]);

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
    const r=indoorRef.current.getBoundingClientRect();
    const mx=(e.clientX-r.left)/r.width*met.W, my=(e.clientY-r.top)/r.height*met.H;
    if (e.button===2) return;
    let cl2=-1,cd=10/(r.width/met.W);
    nodes.forEach((n,i)=>{const d=Math.hypot(n.x-mx,n.y-my);if(d<cd){cd=d;cl2=i;}});
    if(cl2>=0){dragRef.current=cl2;} else if(placement==="Manual"){
      const nn=[...nodes,{id:nodes.length,x:mx,y:my,alive:true,batt:1,minN:0,area:0,nb:[]}];
      const{edges:ne,cells:nc}=recompute(nn);setNodes([...nn]);setEdgesArr(ne);setCellsArr(nc);
    }
  };
  const iMove = (e) => {
    if(dragRef.current<0||!met) return;
    const r=indoorRef.current.getBoundingClientRect();
    const mx=Math.max(0,Math.min(met.W,(e.clientX-r.left)/r.width*met.W));
    const my=Math.max(0,Math.min(met.H,(e.clientY-r.top)/r.height*met.H));
    const nn=[...nodes];nn[dragRef.current]={...nn[dragRef.current],x:mx,y:my};
    const{edges:ne,cells:nc,minDist}=recompute(nn);setNodes(nn);setEdgesArr(ne);setCellsArr(nc);setMet(m=>({...m,minDist}));
  };
  const iUp = () => { dragRef.current = -1; };
  const iCtx = (e) => {
    e.preventDefault(); if(!met) return;
    const r=indoorRef.current.getBoundingClientRect();
    const mx=(e.clientX-r.left)/r.width*met.W, my=(e.clientY-r.top)/r.height*met.H;
    let cl2=-1,cd=12/(r.width/met.W);
    nodes.forEach((n,i)=>{const d=Math.hypot(n.x-mx,n.y-my);if(d<cd){cd=d;cl2=i;}});
    if(cl2>=0){const nn=[...nodes];nn[cl2]={...nn[cl2],alive:!nn[cl2].alive};setNodes(nn);}
  };

  // ─── MOUSE HANDLERS (Outdoor) ───
  const oConsts = () => {
    const c=outdoorRef.current; if(!c||!met) return null;
    const cw2=c.parentElement?.clientWidth||700,ch2=500,z=mZoom.current;
    const ct2=latLngToTile(cLat,cLng,z);
    return{cw:cw2,ch:ch2,z,ox:ct2.x-(cw2/256)/2+mOff.current.x/256,oy:ct2.y-(ch2/256)/2+mOff.current.y/256};
  };
  const pxToNode = (px,py) => {
    const mc=oConsts(); if(!mc) return null;
    const ll=tileToLatLng(mc.ox+px/256,mc.oy+py/256,mc.z);
    return{x:(ll.lng-cLng)*111320*Math.cos(cLat*Math.PI/180)+met.W/2, y:(ll.lat-cLat)*111320+met.H/2};
  };
  const nodeToPx = (nd) => {
    const mc=oConsts(); if(!mc) return{px:0,py:0};
    const nLat=cLat+(nd.y-met.H/2)/111320, nLng2=cLng+(nd.x-met.W/2)/(111320*Math.cos(cLat*Math.PI/180));
    const t=latLngToTile(nLat,nLng2,mc.z);
    return{px:(t.x-mc.ox)*256,py:(t.y-mc.oy)*256};
  };
  const oDown = (e) => {
    if(!met) return;
    const r=outdoorRef.current.getBoundingClientRect();
    const px=e.clientX-r.left,py=e.clientY-r.top;
    let cl2=-1,cd=15;
    nodes.forEach((n,i)=>{const p=nodeToPx(n);const d=Math.hypot(p.px-px,p.py-py);if(d<cd){cd=d;cl2=i;}});
    if(cl2>=0){dragRef.current=cl2;} else {mDragS.current={x:px,y:py,ox:mOff.current.x,oy:mOff.current.y};}
  };
  const oMove = (e) => {
    if(!met) return;
    const r=outdoorRef.current.getBoundingClientRect();
    const px=e.clientX-r.left,py=e.clientY-r.top;
    if(dragRef.current>=0){
      const np=pxToNode(px,py); if(np){
        const nn=[...nodes];nn[dragRef.current]={...nn[dragRef.current],x:np.x,y:np.y};
        const{edges:ne,cells:nc,minDist}=recompute(nn);setNodes(nn);setEdgesArr(ne);setCellsArr(nc);setMet(m=>({...m,minDist}));
      }
    } else if(mDragS.current){
      mOff.current={x:mDragS.current.ox-(px-mDragS.current.x),y:mDragS.current.oy-(py-mDragS.current.y)};
      drawOutdoor();
    }
  };
  const oUp = (e) => {
    if(dragRef.current>=0){dragRef.current=-1;return;}
    if(mDragS.current){
      const r=outdoorRef.current.getBoundingClientRect();
      const px=e.clientX-r.left,py=e.clientY-r.top;
      if(Math.abs(px-mDragS.current.x)<3&&Math.abs(py-mDragS.current.y)<3&&placement==="Manual"){
        const np=pxToNode(px,py);
        if(np){const nn=[...nodes,{id:nodes.length,x:np.x,y:np.y,alive:true,batt:1,minN:0,area:0,nb:[]}];const{edges:ne,cells:nc}=recompute(nn);setNodes([...nn]);setEdgesArr(ne);setCellsArr(nc);}
      }
      mDragS.current=null;
    }
  };
  const oWheel = (e) => {
    e.preventDefault();
    const nz=Math.max(10,Math.min(19,mZoom.current+(e.deltaY<0?1:-1)));
    if(nz!==mZoom.current){mZoom.current=nz;mOff.current={x:0,y:0};drawOutdoor();}
  };
  const oCtx = (e) => {
    e.preventDefault(); if(!met) return;
    const r=outdoorRef.current.getBoundingClientRect(); const px=e.clientX-r.left,py=e.clientY-r.top;
    let cl2=-1,cd=15;
    nodes.forEach((n,i)=>{const p=nodeToPx(n);const d=Math.hypot(p.px-px,p.py-py);if(d<cd){cd=d;cl2=i;}});
    if(cl2>=0){const nn=[...nodes];nn[cl2]={...nn[cl2],alive:!nn[cl2].alive};setNodes(nn);}
  };

  // Recs
  const recs = [];
  if (met) {
    const opt = met.sR * 1.5, req = Math.ceil(met.totalArea / (Math.PI * met.sR * met.sR * 0.8));
    recs.push({ t: "info", text: "Optimal spacing: " + opt.toFixed(1) + "m · Recommended: " + req + " nodes" });
    if (met.n < req) recs.push({ t: "warn", text: "Add " + (req - met.n) + " more nodes for full coverage" });
    if (!met.conn) recs.push({ t: "err", text: "Network disconnected! Reposition or add relay nodes." });
    if (met.covPct < 80) recs.push({ t: "warn", text: "Coverage only " + met.covPct.toFixed(1) + "%" });
    if (met.battLife < 30) recs.push({ t: "warn", text: "Battery < 30 days. Use Li-ion or increase TX interval." });
    recs.push({ t: "info", text: "Min dist: " + met.minDist.toFixed(2) + "m · Avg: " + met.avgD.toFixed(2) + "m · PL: " + met.pl.toFixed(1) + " dB" });
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
          <div style={{ display: "flex", gap: 4 }}>{["Random", "Grid", "Manual"].map(p => <button key={p} style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: "1px solid " + (placement === p ? "#3b9eff" : "rgba(100,180,255,0.1)"), background: placement === p ? "rgba(59,158,255,0.12)" : "transparent", color: placement === p ? "#3b9eff" : "#5a7a9a", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'DM Sans'" }} onClick={() => setPlacement(p)}>{p}</button>)}</div>
          <ST>Energy</ST>
          <FLab>Battery</FLab>
          <FSel value={battType} onChange={e => { setBattType(e.target.value); setCapacity(BATTS[e.target.value].cap); }}>{Object.entries(BATTS).map(([k, v]) => <option key={k} value={k}>{k} ({v.v}V)</option>)}</FSel>
          <FLab>Capacity (mAh)</FLab><FIn type="number" value={capacity} onChange={e => setCapacity(+e.target.value || 100)} />
          <FLab>TX Interval (s)</FLab><FIn type="number" value={txInt} onChange={e => setTxInt(+e.target.value || 1)} />
          {env === "Indoor" && <><ST>Propagation</ST><FLab>PL Exponent: {ple}</FLab><input type="range" min={2} max={5} step={0.1} value={ple} onChange={e => setPle(+e.target.value)} style={{ width: "100%", accentColor: "#3b9eff" }} /><FLab>Wall Atten: {wallAtt} dB</FLab><input type="range" min={0} max={25} step={1} value={wallAtt} onChange={e => setWallAtt(+e.target.value)} style={{ width: "100%", accentColor: "#3b9eff" }} /></>}
          {env === "Outdoor" && <><ST>Location</ST><FLab>Lat</FLab><FIn type="number" step={0.0001} value={cLat} onChange={e => setCLat(+e.target.value)} /><FLab>Lng</FLab><FIn type="number" step={0.0001} value={cLng} onChange={e => setCLng(+e.target.value)} /><div style={{ fontSize: 9, color: "#3a5570", marginTop: 4 }}>Scroll=zoom · Drag=pan · Click=place (Manual)</div></>}
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "rgba(59,158,255,0.04)", border: "1px solid rgba(100,180,255,0.1)", fontSize: 9, lineHeight: 1.6, color: "#5a7a9a", fontFamily: "monospace" }}><b style={{ color: "#3b9eff" }}>Assumptions:</b> E_tx=50nJ/bit · Amp=100pJ/bit/m² · E_rx=50nJ/bit · Pkt=4000b</div>
          <button onClick={runSim} style={{ width: "100%", marginTop: 12, padding: 14, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, background: "linear-gradient(135deg,#3b9eff,#1d7cd6,#22d3ee)", color: "#fff", boxShadow: "0 4px 20px rgba(59,158,255,0.2)", fontFamily: "'DM Sans'" }}>▶ Run Simulation</button>
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
                <div style={{ fontSize: 10, color: "#3a5570", padding: "6px 12px", borderBottom: "1px solid rgba(100,180,255,0.06)", fontFamily: "monospace" }}>{env === "Indoor" ? "Drag=move · Right-click=kill/revive · Click=place (Manual)" : "Drag node=move · Scroll=zoom · Drag bg=pan · Click=place (Manual) · Right-click=kill"}</div>
                {env === "Indoor" && <canvas ref={indoorRef} style={{ display: "block", width: "100%", cursor: "crosshair" }} onMouseDown={iDown} onMouseMove={iMove} onMouseUp={iUp} onMouseLeave={iUp} onContextMenu={iCtx} />}
                {env === "Outdoor" && <canvas ref={outdoorRef} style={{ display: "block", width: "100%", height: 500, cursor: "grab" }} onMouseDown={oDown} onMouseMove={oMove} onMouseUp={oUp} onMouseLeave={() => { dragRef.current = -1; mDragS.current = null; }} onWheel={oWheel} onContextMenu={oCtx} />}
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
                    <thead><tr>{["ID", "Status", "X(m)", "Y(m)", env === "Outdoor" ? "Lat,Lng" : "V.Area", "MinN", "Action"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 8, textTransform: "uppercase", letterSpacing: 1, color: "#3a5570", borderBottom: "1px solid rgba(100,180,255,0.08)", fontWeight: 600 }}>{h}</th>)}</tr></thead>
                    <tbody>{nodes.map(nd => {
                      const nLat2 = (cLat + (nd.y - (met?.H || aH) / 2) / 111320).toFixed(5);
                      const nLng2 = (cLng + (nd.x - (met?.W || aW) / 2) / (111320 * Math.cos(cLat * Math.PI / 180))).toFixed(5);
                      return <tr key={nd.id} style={{ borderBottom: "1px solid rgba(100,180,255,0.04)" }}>
                        <td style={tdS}><b style={{ color: "#3b9eff" }}>#{nd.id}</b></td>
                        <td style={tdS}><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: nd.alive ? "#10b981" : "#ef4444", marginRight: 4, boxShadow: "0 0 4px " + (nd.alive ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)") }} />{nd.alive ? "Alive" : "Dead"}</td>
                        <td style={tdS}>{nd.x.toFixed(1)}</td>
                        <td style={tdS}>{nd.y.toFixed(1)}</td>
                        <td style={tdS}>{env === "Outdoor" ? nLat2 + "," + nLng2 : (nd.area || 0).toFixed(1) + "m²"}</td>
                        <td style={tdS}>{(nd.minN || 0).toFixed(1)}m</td>
                        <td style={tdS}><button style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid " + (nd.alive ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"), background: "transparent", color: nd.alive ? "#ef4444" : "#10b981", cursor: "pointer", fontSize: 9, fontWeight: 600, fontFamily: "'DM Sans'" }} onClick={() => { const nn = [...nodes]; nn[nd.id] = { ...nn[nd.id], alive: !nn[nd.id].alive }; setNodes(nn); }}>{nd.alive ? "Kill" : "Revive"}</button></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </div>}
              {/* RECS */}
              <div style={{ background: "#0b1120", border: "1px solid rgba(100,180,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(100,180,255,0.06)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: "#3b9eff" }}>Recommendations</div>
                <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                  {recs.map((r, i) => <div key={i} style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5, background: r.t === "err" ? "rgba(239,68,68,0.06)" : r.t === "warn" ? "rgba(245,158,11,0.06)" : "rgba(59,158,255,0.05)", border: "1px solid " + (r.t === "err" ? "rgba(239,68,68,0.15)" : r.t === "warn" ? "rgba(245,158,11,0.15)" : "rgba(59,158,255,0.12)"), color: r.t === "err" ? "#fca5a5" : r.t === "warn" ? "#fcd34d" : "#7ec8ff" }}>{r.t === "err" ? "⚠ " : r.t === "warn" ? "⚡ " : "💡 "}{r.text}</div>)}
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
