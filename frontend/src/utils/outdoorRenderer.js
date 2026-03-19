import { latLngToTile, tileToLatLng } from './algorithms';

/**
 * Renders the outdoor WSN visualization on a canvas using OSM tiles.
 * Draws real map tiles, Voronoi/Delaunay overlays, node markers with lat/lng.
 */
export function drawOutdoorCanvas(canvas, nodes, edges, cells, metrics, overlay, cLat, cLng, zoom, offset, tileCache) {
  if (!canvas || !metrics) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.parentElement?.clientWidth || 700;
  const ch = 500;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const z = zoom;
  const ct = latLngToTile(cLat, cLng, z);
  const ox = ct.x - (cw / 256) / 2 + offset.x / 256;
  const oy = ct.y - (ch / 256) / 2 + offset.y / 256;
  const n2z = Math.pow(2, z);

  // Background
  ctx.fillStyle = '#0a0f1a';
  ctx.fillRect(0, 0, cw, ch);

  // Tiles
  const stx = Math.floor(ox), sty = Math.floor(oy);
  const etx = Math.ceil(ox + cw / 256), ety = Math.ceil(oy + ch / 256);
  for (let tx = stx; tx <= etx; tx++) {
    for (let ty = sty; ty <= ety; ty++) {
      const px = (tx - ox) * 256, py = (ty - oy) * 256;
      const wtx = ((tx % n2z) + n2z) % n2z;
      const key = z + '/' + wtx + '/' + ty;
      if (tileCache[key]) {
        ctx.drawImage(tileCache[key], px, py, 256, 256);
      } else {
        ctx.fillStyle = '#0d1520';
        ctx.fillRect(px, py, 256, 256);
        ctx.strokeStyle = 'rgba(59,158,255,0.06)';
        ctx.strokeRect(px, py, 256, 256);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `https://tile.openstreetmap.org/${z}/${wtx}/${ty}.png`;
        const k2 = key;
        img.onload = () => {
          tileCache[k2] = img;
          drawOutdoorCanvas(canvas, nodes, edges, cells, metrics, overlay, cLat, cLng, zoom, offset, tileCache);
        };
      }
    }
  }

  // Dark overlay
  ctx.fillStyle = 'rgba(5,8,15,0.4)';
  ctx.fillRect(0, 0, cw, ch);

  const toP = (nd) => {
    const nLat = cLat + (nd.y - metrics.H / 2) / 111320;
    const nLng = cLng + (nd.x - metrics.W / 2) / (111320 * Math.cos(cLat * Math.PI / 180));
    const t = latLngToTile(nLat, nLng, z);
    return { px: (t.x - ox) * 256, py: (t.y - oy) * 256 };
  };

  // Area boundary
  const corners = [
    { x: 0, y: 0 }, { x: metrics.W, y: 0 },
    { x: metrics.W, y: metrics.H }, { x: 0, y: metrics.H },
  ].map(toP);
  ctx.beginPath();
  ctx.moveTo(corners[0].px, corners[0].py);
  corners.forEach(c => ctx.lineTo(c.px, c.py));
  ctx.closePath();
  ctx.strokeStyle = 'rgba(59,158,255,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Coverage
  if (overlay === 'coverage' || overlay === 'hybrid') {
    for (const nd of nodes) {
      if (!nd.alive) continue;
      const p = toP(nd);
      const rn = toP({ x: nd.x + metrics.sR, y: nd.y });
      const rPx = Math.abs(rn.px - p.px);
      const g = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, rPx);
      g.addColorStop(0, 'rgba(16,185,129,0.15)');
      g.addColorStop(1, 'rgba(16,185,129,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.px, p.py, rPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(16,185,129,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Voronoi
  if (overlay === 'voronoi' || overlay === 'hybrid') {
    const cols = ['rgba(59,158,255,0.1)', 'rgba(167,139,250,0.1)', 'rgba(34,211,238,0.1)', 'rgba(245,158,11,0.08)'];
    cells.forEach((cell, i) => {
      if (cell.length < 3) return;
      const pv = cell.map(toP);
      ctx.beginPath();
      ctx.moveTo(pv[0].px, pv[0].py);
      for (let j = 1; j < pv.length; j++) ctx.lineTo(pv[j].px, pv[j].py);
      ctx.closePath();
      ctx.fillStyle = cols[i % cols.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(59,158,255,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // Delaunay
  if (overlay === 'delaunay' || overlay === 'hybrid') {
    for (const [a, b] of edges) {
      const pa = toP(nodes[a]), pb = toP(nodes[b]);
      ctx.beginPath();
      ctx.moveTo(pa.px, pa.py);
      ctx.lineTo(pb.px, pb.py);
      ctx.strokeStyle = 'rgba(167,139,250,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
      ctx.fillStyle = 'rgba(167,139,250,0.5)';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.toFixed(1) + 'm', (pa.px + pb.px) / 2, (pa.py + pb.py) / 2 - 6);
      ctx.textAlign = 'start';
    }
  }

  // Nodes
  for (const nd of nodes) {
    const p = toP(nd);
    if (nd.alive) {
      const g = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, 14);
      g.addColorStop(0, 'rgba(59,158,255,0.4)');
      g.addColorStop(1, 'rgba(59,158,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.px, p.py, 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(p.px, p.py, 8, 0, Math.PI * 2);
    ctx.fillStyle = nd.alive ? '#3b9eff' : '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(nd.id, p.px, p.py - 14);
    const nLat = (cLat + (nd.y - metrics.H / 2) / 111320).toFixed(4);
    const nLng2 = (cLng + (nd.x - metrics.W / 2) / (111320 * Math.cos(cLat * Math.PI / 180))).toFixed(4);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '7px monospace';
    ctx.fillText(nLat + ',' + nLng2, p.px, p.py + 18);
    ctx.textAlign = 'start';
  }

  // Attribution
  ctx.fillStyle = 'rgba(200,200,200,0.35)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('© OpenStreetMap contributors', cw - 6, ch - 6);
  ctx.textAlign = 'start';

  // Zoom info
  ctx.fillStyle = 'rgba(59,158,255,0.55)';
  ctx.font = '10px monospace';
  ctx.fillText(`Zoom:${z} | ${cLat.toFixed(4)}°N ${cLng.toFixed(4)}°E`, 10, 16);
}
