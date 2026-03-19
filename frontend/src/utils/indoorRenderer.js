/**
 * Renders the indoor WSN visualization on a canvas.
 * Draws grid, coverage circles, Voronoi cells, Delaunay edges,
 * min-distance highlight, and node markers.
 */
export function drawIndoorCanvas(canvas, nodes, edges, cells, metrics, overlay) {
  if (!canvas || !metrics) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.parentElement?.clientWidth || 700;
  const ch = Math.round(cw * (metrics.H / metrics.W));
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sx = cw / metrics.W;
  const sy = ch / metrics.H;

  // Background
  ctx.fillStyle = '#060a14';
  ctx.fillRect(0, 0, cw, ch);

  // Grid
  ctx.strokeStyle = 'rgba(59,158,255,0.05)';
  ctx.lineWidth = 0.5;
  const gs = Math.max(5, Math.round(metrics.W / 20));
  for (let x = 0; x <= metrics.W; x += gs) {
    ctx.beginPath(); ctx.moveTo(x * sx, 0); ctx.lineTo(x * sx, ch); ctx.stroke();
  }
  for (let y = 0; y <= metrics.H; y += gs) {
    ctx.beginPath(); ctx.moveTo(0, y * sy); ctx.lineTo(cw, y * sy); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(90,122,154,0.35)';
  ctx.font = '9px monospace';
  for (let x = 0; x <= metrics.W; x += gs * 2) {
    ctx.fillText(x + 'm', x * sx + 2, ch - 4);
  }

  // Coverage circles
  if (overlay === 'coverage' || overlay === 'hybrid') {
    for (const n of nodes) {
      if (!n.alive) continue;
      const g = ctx.createRadialGradient(n.x * sx, n.y * sy, 0, n.x * sx, n.y * sy, metrics.sR * sx);
      g.addColorStop(0, 'rgba(16,185,129,0.13)');
      g.addColorStop(1, 'rgba(16,185,129,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x * sx, n.y * sy, metrics.sR * sx, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(16,185,129,0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Voronoi cells
  if (overlay === 'voronoi' || overlay === 'hybrid') {
    const colors = [
      'rgba(59,158,255,0.08)', 'rgba(167,139,250,0.08)',
      'rgba(34,211,238,0.08)', 'rgba(245,158,11,0.07)',
      'rgba(236,72,153,0.07)', 'rgba(16,185,129,0.07)',
    ];
    cells.forEach((cell, i) => {
      if (cell.length < 3) return;
      ctx.beginPath();
      ctx.moveTo(cell[0].x * sx, cell[0].y * sy);
      for (let j = 1; j < cell.length; j++) ctx.lineTo(cell[j].x * sx, cell[j].y * sy);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(59,158,255,0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Cell area label
      const cx = cell.reduce((s, v) => s + v.x, 0) / cell.length;
      const cy = cell.reduce((s, v) => s + v.y, 0) / cell.length;
      if (nodes[i]?.area > 0) {
        ctx.fillStyle = 'rgba(90,122,154,0.45)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(nodes[i].area.toFixed(0) + 'm²', cx * sx, cy * sy + 3);
        ctx.textAlign = 'start';
      }
    });
  }

  // Delaunay edges with distance labels
  if (overlay === 'delaunay' || overlay === 'hybrid') {
    for (const [a, b] of edges) {
      const na = nodes[a], nb = nodes[b];
      ctx.beginPath();
      ctx.moveTo(na.x * sx, na.y * sy);
      ctx.lineTo(nb.x * sx, nb.y * sy);
      ctx.strokeStyle = na.alive && nb.alive
        ? 'rgba(167,139,250,0.4)' : 'rgba(239,68,68,0.25)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const d = Math.hypot(na.x - nb.x, na.y - nb.y);
      ctx.fillStyle = 'rgba(167,139,250,0.4)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.toFixed(1) + 'm', (na.x + nb.x) / 2 * sx, (na.y + nb.y) / 2 * sy - 5);
      ctx.textAlign = 'start';
    }
  }

  // Min distance highlight (amber)
  if (metrics.minDist > 0) {
    let bA = -1, bB = -1, bD = Infinity;
    for (const [a, b] of edges) {
      const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
      if (d < bD) { bD = d; bA = a; bB = b; }
    }
    if (bA >= 0) {
      ctx.beginPath();
      ctx.moveTo(nodes[bA].x * sx, nodes[bA].y * sy);
      ctx.lineTo(nodes[bB].x * sx, nodes[bB].y * sy);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        'MIN: ' + bD.toFixed(2) + 'm',
        (nodes[bA].x + nodes[bB].x) / 2 * sx,
        (nodes[bA].y + nodes[bB].y) / 2 * sy - 10
      );
      ctx.textAlign = 'start';
    }
  }

  // Node markers
  for (const n of nodes) {
    const nx = n.x * sx, ny = n.y * sy;
    if (n.alive) {
      const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, 16);
      g.addColorStop(0, 'rgba(59,158,255,0.3)');
      g.addColorStop(1, 'rgba(59,158,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(nx, ny, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(nx, ny, 7, 0, Math.PI * 2);
    ctx.fillStyle = n.alive ? '#3b9eff' : '#ef4444';
    ctx.fill();
    ctx.strokeStyle = n.alive ? '#7ec8ff' : '#fca5a5';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#d6e4f0';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(n.id, nx, ny - 13);
    ctx.textAlign = 'start';
  }
}
