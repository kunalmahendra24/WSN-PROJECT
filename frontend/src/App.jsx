import { useState, useEffect, useCallback, useRef } from "react";

// ── PHYSICS ──────────────────────────────────────────────────────
const BATTS = { "Li-ion": { v: 3.7, cap: 3000 }, "AA": { v: 1.5, cap: 2500 }, "Coin": { v: 3.0, cap: 220 } };
const EN = { elec: 50e-9, amp: 100e-12, rx: 50e-9, idle: 10e-9, pkt: 4000 };
function mAhToJ(mAh, v) { return (mAh / 1000) * v * 3600; }
function ePR(d) { const tx = EN.pkt * EN.elec + EN.pkt * EN.amp * d * d; return { total: tx + EN.pkt * EN.rx + EN.idle * 1000 }; }
function plIndoor(d, n, w) { return d <= 0 ? 0 : 40 + 10 * n * Math.log10(d) + w; }
function plFSPL(d) { return d <= 0 ? 0 : 20 * Math.log10(d) + 20 * Math.log10(2400) - 27.55; }

// ── DELAUNAY ─────────────────────────────────────────────────────
function delaunay(pts) {
  if (pts.length < 3) return { tris: [], edges: [] };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const mX = Math.min(...xs)-1, mY = Math.min(...ys)-1, MX = Math.max(...xs)+1, MY = Math.max(...ys)+1;
  const dm = Math.max(MX-mX, MY-mY)*10;
  const S = [{x:mX-dm,y:mY-dm,_s:1},{x:mX+2*dm,y:mY-dm,_s:1},{x:mX,y:mY+2*dm,_s:1}];
  let tris = [S];
  for (const p of pts) {
    const bad = tris.filter(t => inCC(p,t));
    const poly = [];
    for (const t of bad) for (let i=0;i<3;i++) {
      const e=[t[i],t[(i+1)%3]]; let sh=false;
      for (const o of bad){if(o===t)continue;for(let j=0;j<3;j++)if((e[0]===o[j]&&e[1]===o[(j+1)%3])||(e[0]===o[(j+1)%3]&&e[1]===o[j])){sh=true;break;}if(sh)break;}
      if(!sh)poly.push(e);
    }
    tris=tris.filter(t=>!bad.includes(t));
    for(const e of poly)tris.push([e[0],e[1],p]);
  }
  tris=tris.filter(t=>!t.some(v=>v._s));
  const es=new Set(),el=[];
  for(const t of tris)for(let i=0;i<3;i++){
    const a=pts.indexOf(t[i]),b=pts.indexOf(t[(i+1)%3]);
    if(a<0||b<0)continue;
    const k=Math.min(a,b)+"-"+Math.max(a,b);
    if(!es.has(k)){es.add(k);el.push([a,b]);}
  }
  return{tris,edges:el};
}
function inCC(p,t){
  const[a,b,c]=t,ax=a.x-p.x,ay=a.y-p.y,bx=b.x-p.x,by=b.y-p.y,cx=c.x-p.x,cy=c.y-p.y;
  return(ax*ax+ay*ay)*(bx*cy-cx*by)-(bx*bx+by*by)*(ax*cy-cx*ay)+(cx*cx+cy*cy)*(ax*by-bx*ay)>0;
}

// ── VORONOI ──────────────────────────────────────────────────────
function voronoiFn(pts,tris){
  const cells=pts.map(()=>[]);
  for(const t of tris){const cc=ccenter(t[0],t[1],t[2]);if(!cc)continue;for(const v of t){const i=pts.indexOf(v);if(i>=0)cells[i].push(cc);}}
  return cells.map((vs,i)=>{if(vs.length<2)return vs;const c=pts[i];return vs.sort((a,b)=>Math.atan2(a.y-c.y,a.x-c.x)-Math.atan2(b.y-c.y,b.x-c.x));});
}
function ccenter(a,b,c){
  const D=2*(a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y));
  if(Math.abs(D)<1e-10)return null;
  return{x:((a.x*a.x+a.y*a.y)*(b.y-c.y)+(b.x*b.x+b.y*b.y)*(c.y-a.y)+(c.x*c.x+c.y*c.y)*(a.y-b.y))/D,y:((a.x*a.x+a.y*a.y)*(c.x-b.x)+(b.x*b.x+b.y*b.y)*(a.x-c.x)+(c.x*c.x+c.y*c.y)*(b.x-a.x))/D};
}
function polyArea(vs){if(vs.length<3)return 0;let a=0;for(let i=0;i<vs.length;i++){const j=(i+1)%vs.length;a+=vs[i].x*vs[j].y-vs[j].x*vs[i].y;}return Math.abs(a)/2;}

// ── PALETTE ──────────────────────────────────────────────────────
const C={
  bg:"#0b0d13",sidebar:"#0e1019",card:"#13161f",border:"rgba(255,255,255,0.06)",
  accent:"#f97316",accentDim:"rgba(249,115,22,0.15)",
  teal:"#2dd4bf",tealDim:"rgba(45,212,191,0.12)",
  green:"#22c55e",red:"#ef4444",amber:"#f59e0b",purple:"#a855f7",
  text:"#e2e8f0",muted:"#64748b",dim:"#1e2433",
};

// ── CANVAS RENDERER ───────────────────────────────────────────────
function drawCanvas(canvas, nodes, edges, cells, W, H, sR, mode) {
  if(!canvas||!nodes.length)return;
  const ctx=canvas.getContext("2d"),dpr=window.devicePixelRatio||1;
  const cw=canvas.parentElement?.clientWidth||600,ch=Math.round(cw*(H/W));
  canvas.style.width=cw+"px";canvas.style.height=ch+"px";
  canvas.width=cw*dpr;canvas.height=ch*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const sx=cw/W,sy=ch/H;

  ctx.fillStyle="#07090f";ctx.fillRect(0,0,cw,ch);
  ctx.strokeStyle="rgba(255,255,255,0.025)";ctx.lineWidth=0.5;
  const gs=Math.max(4,Math.round(W/18));
  for(let x=0;x<=W;x+=gs){ctx.beginPath();ctx.moveTo(x*sx,0);ctx.lineTo(x*sx,ch);ctx.stroke();}
  for(let y=0;y<=H;y+=gs){ctx.beginPath();ctx.moveTo(0,y*sy);ctx.lineTo(cw,y*sy);ctx.stroke();}
  ctx.strokeStyle="rgba(249,115,22,0.28)";ctx.lineWidth=1.5;ctx.setLineDash([7,4]);
  ctx.strokeRect(2,2,cw-4,ch-4);ctx.setLineDash([]);
  ctx.fillStyle="rgba(249,115,22,0.45)";ctx.font="bold 10px monospace";ctx.textAlign="left";
  ctx.fillText(`${W}m × ${H}m`,8,16);

  // Coverage circles
  if(mode==="coverage"||mode==="hybrid"){
    for(const n of nodes){
      const g=ctx.createRadialGradient(n.x*sx,n.y*sy,0,n.x*sx,n.y*sy,sR*sx);
      g.addColorStop(0,"rgba(45,212,191,0.13)");g.addColorStop(1,"rgba(45,212,191,0)");
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(n.x*sx,n.y*sy,sR*sx,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="rgba(45,212,191,0.2)";ctx.lineWidth=0.9;ctx.setLineDash([3,4]);
      ctx.beginPath();ctx.arc(n.x*sx,n.y*sy,sR*sx,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
  }

  // Voronoi cells
  if(mode==="hybrid"&&cells.length){
    const pal=["rgba(249,115,22,0.07)","rgba(168,85,247,0.07)","rgba(45,212,191,0.06)","rgba(245,158,11,0.07)","rgba(236,72,153,0.06)","rgba(34,197,94,0.06)"];
    cells.forEach((cell,i)=>{
      if(cell.length<3)return;
      ctx.beginPath();ctx.moveTo(cell[0].x*sx,cell[0].y*sy);
      for(let j=1;j<cell.length;j++)ctx.lineTo(cell[j].x*sx,cell[j].y*sy);
      ctx.closePath();ctx.fillStyle=pal[i%pal.length];ctx.fill();
      ctx.strokeStyle="rgba(249,115,22,0.16)";ctx.lineWidth=0.7;ctx.setLineDash([2,4]);ctx.stroke();ctx.setLineDash([]);
    });
  }

  // Edges — find shortest first
  if(edges.length){
    let minE=null,minD=Infinity;
    for(const e of edges){const a=e.a??e[0],b=e.b??e[1];const d=Math.hypot(nodes[a].x-nodes[b].x,nodes[a].y-nodes[b].y);if(d<minD){minD=d;minE=e;}}
    for(const e of edges){
      const a=e.a??e[0],b=e.b??e[1],na=nodes[a],nb=nodes[b];if(!na||!nb)continue;
      const isMin=e===minE;
      ctx.beginPath();ctx.moveTo(na.x*sx,na.y*sy);ctx.lineTo(nb.x*sx,nb.y*sy);
      if(isMin){
        ctx.strokeStyle="#f59e0b";ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle="#f59e0b";ctx.font="bold 9px monospace";ctx.textAlign="center";
        ctx.fillText("MIN: "+minD.toFixed(1)+"m",(na.x+nb.x)/2*sx,(na.y+nb.y)/2*sy-8);ctx.textAlign="left";
      } else {
        ctx.strokeStyle=mode==="coverage"?"rgba(45,212,191,0.3)":"rgba(249,115,22,0.38)";ctx.lineWidth=1.2;ctx.stroke();
        const d=Math.hypot(na.x-nb.x,na.y-nb.y);
        ctx.fillStyle="rgba(148,163,184,0.35)";ctx.font="8px monospace";ctx.textAlign="center";
        ctx.fillText(d.toFixed(1)+"m",(na.x+nb.x)/2*sx,(na.y+nb.y)/2*sy-4);ctx.textAlign="left";
      }
    }
  }

  // Nodes
  for(const n of nodes){
    const nx=n.x*sx,ny=n.y*sy,alive=n.alive!==false;
    const g=ctx.createRadialGradient(nx,ny,0,nx,ny,18);
    g.addColorStop(0,alive?"rgba(249,115,22,0.3)":"rgba(239,68,68,0.2)");g.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(nx,ny,18,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(nx,ny,7,0,Math.PI*2);
    ctx.fillStyle=alive?C.accent:C.red;ctx.fill();
    ctx.strokeStyle=alive?"#fed7aa":"#fca5a5";ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle="rgba(254,215,170,0.75)";ctx.font="bold 8px monospace";ctx.textAlign="center";
    ctx.fillText(n.id,nx,ny-13);ctx.textAlign="left";
  }
}

// ── MAIN ─────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]=useState(null);
  const [authMode,setAuthMode]=useState("login");
  const [af,setAf]=useState({name:"",email:"",password:""});
  const [authErr,setAuthErr]=useState("");
  const [users,setUsers]=useState([{name:"Demo",email:"demo@test.com",password:"123",id:1}]);

  const [env,setEnv]=useState("Outdoor");
  const [numNodes,setNumNodes]=useState(15);
  const [aW,setAW]=useState(120);
  const [aH,setAH]=useState(90);
  const [sensorRange,setSensorRange]=useState(15);
  const [sensorPower,setSensorPower]=useState(1.0);
  const [battType,setBattType]=useState("Li-ion");
  const [capacity,setCapacity]=useState(3000);
  const [txInt,setTxInt]=useState(30);
  const [ple,setPle]=useState(3.4);
  const [wallAtt,setWallAtt]=useState(5);

  const [tab,setTab]=useState("hybrid");
  const [nodes,setNodes]=useState([]);
  const [edges,setEdges]=useState([]);
  const [cells,setCells]=useState([]);
  const [met,setMet]=useState(null);
  const [ts,setTs]=useState([]);
  const [done,setDone]=useState(false);
  const [loading,setLoading]=useState(false);

  // Optimize sub-state
  const [optPhase,setOptPhase]=useState("place");
  const [userNodes,setUserNodes]=useState([]);
  const [optResult,setOptResult]=useState(null);
  const [optLoading,setOptLoading]=useState(false);

  const canvasRef=useRef(null);
  const placeRef=useRef(null);
  const beforeRef=useRef(null);
  const afterRef=useRef(null);
  const dragRef=useRef(-1);
  const placeDragRef=useRef(-1);
  const chartR=[useRef(null),useRef(null),useRef(null),useRef(null)];

  // ── Math helpers ──
  const calcCov=useCallback((ps,sR)=>{
    const gs=Math.max(1,Math.min(aW,aH)/60);let cc=0,tc=0;
    for(let gx=0;gx<aW;gx+=gs)for(let gy=0;gy<aH;gy+=gs){tc++;if(ps.some(p=>Math.hypot(p.x-gx,p.y-gy)<=sR))cc++;}
    return Math.round((cc/tc)*1000)/10;
  },[aW,aH]);

  const calcConn=useCallback((ps,ed)=>{
    if(!ps.length)return false;
    const vis=new Set([0]),q=[0];
    while(q.length){const c=q.shift();for(const e of ed){const a=e.a??e[0],b=e.b??e[1];const n=a===c?b:b===c?a:-1;if(n>=0&&!vis.has(n)){vis.add(n);q.push(n);}}}
    return vis.size===ps.length;
  },[]);

  const buildGraph=useCallback((pts)=>{
    if(pts.length<3)return{edges:[],cells:[],minDist:0,avgD:0};
    const{tris,edges:allEd}=delaunay(pts);
    const cl=voronoiFn(pts,tris);
    const ed=allEd.map(([a,b])=>({a,b}));
    let td=0,dc=0,gMin=Infinity;
    pts.forEach((p,i)=>{
      const nb=ed.filter(e=>e.a===i||e.b===i).map(e=>e.a===i?e.b:e.a);
      let md=Infinity;
      for(const n of nb){const d=Math.hypot(pts[n].x-p.x,pts[n].y-p.y);if(d<md)md=d;if(d<gMin)gMin=d;}
      p.minN=md===Infinity?0:md;p.area=polyArea(cl[i]||[]);
    });
    for(const e of ed){td+=Math.hypot(pts[e.a].x-pts[e.b].x,pts[e.a].y-pts[e.b].y);dc++;}
    return{edges:ed,cells:cl,minDist:gMin===Infinity?0:gMin,avgD:dc>0?td/dc:0};
  },[]);

  const simBatt=useCallback((pts,sP,bV)=>{
    const{avgD}=buildGraph(pts);
    const rpd=(24*3600)/txInt,epr=ePR(avgD),bJ=mAhToJ(capacity,bV);
    const ns=pts.map(()=>({b:bJ,a:true}));const tsd=[];
    for(let d=0;d<=400;d++){
      const ac=ns.filter(n=>n.a).length;if(ac===0&&d>0)break;
      const ab=ns.reduce((s,n)=>s+(n.a?n.b/bJ*100:0),0)/Math.max(1,ac);
      tsd.push({day:d,alive:ac,batt:+ab.toFixed(1),cov:+((ac/pts.length)*calcCov(pts,sensorRange)).toFixed(1)});
      const de=epr.total*rpd*sP;
      for(const n of ns){if(!n.a)continue;n.b-=de*(0.8+Math.random()*0.4);if(n.b<=0){n.b=0;n.a=false;}}
    }
    const fd=tsd.find(t=>t.alive<pts.length)?.day||tsd[tsd.length-1]?.day||0;
    return{tsd,battLife:tsd[tsd.length-1]?.day||0,firstDeath:fd};
  },[txInt,capacity,buildGraph,calcCov,sensorRange]);

  const lloydOpt=useCallback((initPts)=>{
    let pts=initPts.map((p,i)=>({...p,id:i}));
    const gs=Math.max(1.5,Math.min(aW,aH)/30);
    let best=null,bestCov=-1;
    for(let iter=0;iter<=25;iter++){
      const{edges:ed}=buildGraph(pts);
      const cov=calcCov(pts,sensorRange),conn=calcConn(pts,ed);
      if(cov>bestCov||(conn&&!best?.conn)){best={pts:pts.map(p=>({...p})),cov,conn};bestCov=cov;}
      if(cov>=95&&conn)break;
      const sumX=new Float64Array(pts.length),sumY=new Float64Array(pts.length),cnt=new Int32Array(pts.length);
      for(let gx=gs/2;gx<aW;gx+=gs)for(let gy=gs/2;gy<aH;gy+=gs){
        let near=0,nearD=Infinity;
        for(let j=0;j<pts.length;j++){const d=Math.hypot(pts[j].x-gx,pts[j].y-gy);if(d<nearD){nearD=d;near=j;}}
        sumX[near]+=gx;sumY[near]+=gy;cnt[near]++;
      }
      pts=pts.map((p,i)=>cnt[i]===0?p:{...p,x:Math.max(aW*.03,Math.min(aW*.97,p.x+(sumX[i]/cnt[i]-p.x)*.6)),y:Math.max(aH*.03,Math.min(aH*.97,p.y+(sumY[i]/cnt[i]-p.y)*.6))});
    }
    return best?.pts||pts;
  },[aW,aH,sensorRange,buildGraph,calcCov,calcConn]);

  const runSim=useCallback(()=>{
    setLoading(true);
    setTimeout(()=>{
      const bV=BATTS[battType].v;
      let pts=Array.from({length:numNodes},(_,i)=>({id:i,x:Math.random()*aW*.85+aW*.075,y:Math.random()*aH*.85+aH*.075,alive:true}));
      pts=lloydOpt(pts);
      const{edges:ed,cells:cl,minDist,avgD}=buildGraph(pts);
      const covPct=calcCov(pts,sensorRange),conn=calcConn(pts,ed);
      const pl=env==="Indoor"?plIndoor(avgD,ple,wallAtt):plFSPL(avgD);
      const{tsd,battLife,firstDeath}=simBatt(pts,sensorPower,bV);
      setNodes(pts);setEdges(ed);setCells(cl);
      setMet({n:pts.length,minDist,avgD,covPct,pl,conn,W:aW,H:aH,sR:sensorRange,battLife,firstDeath});
      setTs(tsd);setDone(true);setLoading(false);
    },0);
  },[numNodes,aW,aH,sensorRange,sensorPower,battType,env,ple,wallAtt,lloydOpt,buildGraph,calcCov,calcConn,simBatt]);

  // ── Main canvas draw ──
  const redraw=useCallback(()=>{
    if(!done||!met||!canvasRef.current)return;
    drawCanvas(canvasRef.current,nodes,edges,cells,met.W,met.H,met.sR,tab==="optimize"?"hybrid":tab);
  },[done,met,nodes,edges,cells,tab]);
  useEffect(()=>{if(done)redraw();},[done,redraw]);

  // ── Drag handlers (main canvas) ──
  const mDown=e=>{if(!met)return;const r=canvasRef.current.getBoundingClientRect();const mx=(e.clientX-r.left)/r.width*met.W,my=(e.clientY-r.top)/r.height*met.H;let cl=-1,cd=12/(r.width/met.W);nodes.forEach((n,i)=>{const d=Math.hypot(n.x-mx,n.y-my);if(d<cd){cd=d;cl=i;}});if(cl>=0)dragRef.current=cl;};
  const mMove=e=>{if(dragRef.current<0||!met)return;const r=canvasRef.current.getBoundingClientRect();const mx=Math.max(0,Math.min(met.W,(e.clientX-r.left)/r.width*met.W)),my=Math.max(0,Math.min(met.H,(e.clientY-r.top)/r.height*met.H));const nn=[...nodes];nn[dragRef.current]={...nn[dragRef.current],x:mx,y:my};const{edges:ne,cells:nc,minDist,avgD}=buildGraph(nn);setNodes(nn);setEdges(ne);setCells(nc);setMet(m=>({...m,minDist,avgD,covPct:calcCov(nn,sensorRange),conn:calcConn(nn,ne)}));};
  const mUp=()=>{dragRef.current=-1;};
  const mCtx=e=>{e.preventDefault();if(!met)return;const r=canvasRef.current.getBoundingClientRect();const mx=(e.clientX-r.left)/r.width*met.W,my=(e.clientY-r.top)/r.height*met.H;let cl=-1,cd=12/(r.width/met.W);nodes.forEach((n,i)=>{const d=Math.hypot(n.x-mx,n.y-my);if(d<cd){cd=d;cl=i;}});if(cl>=0){const nn=[...nodes];nn[cl]={...nn[cl],alive:!nn[cl].alive};setNodes(nn);}};

  // ── Charts ──
  const drawChart=useCallback((ref,data,yKey,color,unit)=>{
    const c=ref.current;if(!c||!data.length)return;
    const ctx=c.getContext("2d"),dpr=window.devicePixelRatio||1;
    const w=c.parentElement?.clientWidth||260,h=130;
    c.style.width=w+"px";c.style.height=h+"px";c.width=w*dpr;c.height=h*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const p={t:6,r:6,b:20,l:34},pw=w-p.l-p.r,ph=h-p.t-p.b;
    const maxY=Math.max(...data.map(d=>d[yKey]),1),maxX=Math.max(...data.map(d=>d.day),1);
    ctx.fillStyle="#0b0d13";ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="rgba(255,255,255,0.04)";ctx.lineWidth=0.5;
    for(let i=0;i<=4;i++){const y=p.t+(i/4)*ph;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();ctx.fillStyle="rgba(148,163,184,0.35)";ctx.font="8px monospace";ctx.textAlign="right";ctx.fillText((maxY*(1-i/4)).toFixed(0)+(unit||""),p.l-2,y+3);}
    ctx.textAlign="center";const xS=Math.max(1,Math.floor(data.length/5));
    for(let i=0;i<data.length;i+=xS){ctx.fillStyle="rgba(148,163,184,0.25)";ctx.fillText("D"+data[i].day,p.l+(data[i].day/maxX)*pw,h-3);}
    ctx.beginPath();ctx.moveTo(p.l,p.t+ph);
    for(const d of data)ctx.lineTo(p.l+(d.day/maxX)*pw,p.t+(1-d[yKey]/maxY)*ph);
    ctx.lineTo(p.l+(data[data.length-1].day/maxX)*pw,p.t+ph);ctx.closePath();
    ctx.fillStyle=color.replace("rgb(","rgba(").replace(")",",0.1)");ctx.fill();
    ctx.beginPath();data.forEach((d,i)=>{const x=p.l+(d.day/maxX)*pw,y=p.t+(1-d[yKey]/maxY)*ph;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
    ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.stroke();
  },[]);

  useEffect(()=>{
    if(!done||tab!=="coverage")return;
    setTimeout(()=>{
      drawChart(chartR[0],ts,"batt","rgb(249,115,22)","%");
      drawChart(chartR[1],ts,"alive","rgb(34,197,94)","");
      drawChart(chartR[2],ts,"cov","rgb(45,212,191)","%");
      drawChart(chartR[3],ts,"day","rgb(168,85,247)","");
    },50);
  },[done,tab,ts,drawChart]);

  // ── Place canvas ──
  const drawPlace=useCallback(()=>{
    const canvas=placeRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d"),dpr=window.devicePixelRatio||1;
    const cw=canvas.parentElement?.clientWidth||500,ch=Math.round(cw*(aH/aW));
    canvas.style.width=cw+"px";canvas.style.height=ch+"px";canvas.width=cw*dpr;canvas.height=ch*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const sx=cw/aW,sy=ch/aH;
    ctx.fillStyle="#07090f";ctx.fillRect(0,0,cw,ch);
    ctx.strokeStyle="rgba(255,255,255,0.025)";ctx.lineWidth=0.5;
    const gs=Math.max(4,Math.round(aW/18));
    for(let x=0;x<=aW;x+=gs){ctx.beginPath();ctx.moveTo(x*sx,0);ctx.lineTo(x*sx,ch);ctx.stroke();}
    for(let y=0;y<=aH;y+=gs){ctx.beginPath();ctx.moveTo(0,y*sy);ctx.lineTo(cw,y*sy);ctx.stroke();}
    ctx.strokeStyle="rgba(249,115,22,0.28)";ctx.lineWidth=1.5;ctx.setLineDash([7,4]);
    ctx.strokeRect(2,2,cw-4,ch-4);ctx.setLineDash([]);
    if(userNodes.length===0){
      ctx.fillStyle="rgba(249,115,22,0.14)";ctx.font="13px monospace";ctx.textAlign="center";
      ctx.fillText("Click to place sensor nodes",cw/2,ch/2-8);
      ctx.fillStyle="rgba(249,115,22,0.07)";ctx.font="10px monospace";
      ctx.fillText(`${aW}m × ${aH}m  ·  target: ${numNodes} nodes`,cw/2,ch/2+12);
      ctx.textAlign="left";
    }
    for(const n of userNodes){
      const g=ctx.createRadialGradient(n.x*sx,n.y*sy,0,n.x*sx,n.y*sy,sensorRange*sx);
      g.addColorStop(0,"rgba(45,212,191,0.12)");g.addColorStop(1,"rgba(45,212,191,0)");
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(n.x*sx,n.y*sy,sensorRange*sx,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="rgba(45,212,191,0.19)";ctx.lineWidth=0.8;ctx.setLineDash([3,4]);
      ctx.beginPath();ctx.arc(n.x*sx,n.y*sy,sensorRange*sx,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
    if(userNodes.length>=3){
      const{edges:ed}=buildGraph(userNodes);
      for(const e of ed){const a=e.a??e[0],b=e.b??e[1];ctx.beginPath();ctx.moveTo(userNodes[a].x*sx,userNodes[a].y*sy);ctx.lineTo(userNodes[b].x*sx,userNodes[b].y*sy);ctx.strokeStyle="rgba(249,115,22,0.28)";ctx.lineWidth=1;ctx.stroke();}
    }
    for(const n of userNodes){
      const nx=n.x*sx,ny=n.y*sy;
      const g=ctx.createRadialGradient(nx,ny,0,nx,ny,16);g.addColorStop(0,"rgba(249,115,22,0.32)");g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(nx,ny,16,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(nx,ny,7,0,Math.PI*2);ctx.fillStyle=C.accent;ctx.fill();
      ctx.strokeStyle="#fed7aa";ctx.lineWidth=1.5;ctx.stroke();
      ctx.fillStyle="rgba(254,215,170,0.7)";ctx.font="bold 8px monospace";ctx.textAlign="center";
      ctx.fillText(n.id,nx,ny-13);ctx.textAlign="left";
    }
    if(userNodes.length>0){
      const cov=calcCov(userNodes,sensorRange);
      ctx.fillStyle="rgba(249,115,22,0.65)";ctx.font="bold 10px monospace";ctx.textAlign="right";
      ctx.fillText(`${cov}% coverage · ${userNodes.length}/${numNodes}`,cw-8,16);ctx.textAlign="left";
    }
  },[userNodes,aW,aH,sensorRange,numNodes,buildGraph,calcCov]);

  useEffect(()=>{if(tab==="optimize"&&optPhase==="place")drawPlace();},[tab,optPhase,drawPlace]);

  useEffect(()=>{
    if(!optResult)return;
    setTimeout(()=>{
      if(beforeRef.current)drawCanvas(beforeRef.current,optResult.before.pts,optResult.before.edges,optResult.before.cells,aW,aH,sensorRange,"hybrid");
      if(afterRef.current)drawCanvas(afterRef.current,optResult.after.pts,optResult.after.edges,optResult.after.cells,aW,aH,sensorRange,"hybrid");
    },50);
  },[optResult,aW,aH,sensorRange]);

  // ── Place interactions ──
  const pClick=e=>{if(placeDragRef.current!==-1)return;const canvas=placeRef.current;if(!canvas)return;const r=canvas.getBoundingClientRect();const x=(e.clientX-r.left)/r.width*aW,y=(e.clientY-r.top)/r.height*aH;let near=-1,cd=10/(r.width/aW);userNodes.forEach((n,i)=>{const d=Math.hypot(n.x-x,n.y-y);if(d<cd){cd=d;near=i;}});if(near>=0||userNodes.length>=numNodes)return;setUserNodes(prev=>[...prev,{id:prev.length,x,y}]);};
  const pDown=e=>{const canvas=placeRef.current;if(!canvas)return;const r=canvas.getBoundingClientRect();const x=(e.clientX-r.left)/r.width*aW,y=(e.clientY-r.top)/r.height*aH;let near=-1,cd=12/(r.width/aW);userNodes.forEach((n,i)=>{const d=Math.hypot(n.x-x,n.y-y);if(d<cd){cd=d;near=i;}});if(near>=0)placeDragRef.current=near;};
  const pMove=e=>{if(placeDragRef.current<0)return;const canvas=placeRef.current;if(!canvas)return;const r=canvas.getBoundingClientRect();const x=Math.max(0,Math.min(aW,(e.clientX-r.left)/r.width*aW)),y=Math.max(0,Math.min(aH,(e.clientY-r.top)/r.height*aH));setUserNodes(prev=>{const nn=[...prev];nn[placeDragRef.current]={...nn[placeDragRef.current],x,y};return nn;});};
  const pUp=()=>{placeDragRef.current=-1;};
  const pCtx=e=>{e.preventDefault();const canvas=placeRef.current;if(!canvas)return;const r=canvas.getBoundingClientRect();const x=(e.clientX-r.left)/r.width*aW,y=(e.clientY-r.top)/r.height*aH;let near=-1,cd=12/(r.width/aW);userNodes.forEach((n,i)=>{const d=Math.hypot(n.x-x,n.y-y);if(d<cd){cd=d;near=i;}});if(near>=0)setUserNodes(prev=>prev.filter((_,i)=>i!==near).map((n,i)=>({...n,id:i})));};

  const runOptimize=useCallback(()=>{
    setOptLoading(true);
    (async()=>{
      try{
        const payload={
          numNodes,
          envType:env,
          areaWidth:aW,
          areaHeight:aH,
          sensorType:"Temperature",
          batteryType:battType,
          batteryCapacity:capacity,
          txInterval:txInt,
          placement:"Manual",
          nodes:userNodes.map(n=>({x:n.x,y:n.y})),
          pathLossExponent:ple,
          wallAttenuation:wallAtt,
        };
        const r=await fetch("/api/optimize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        if(!r.ok){const t=await r.text();throw new Error(t||"Optimize failed");}
        const data=await r.json();

        const mapRes=(res)=>({
          pts:(res.nodes||[]).map(n=>({id:n.id,x:n.x,y:n.y,alive:n.alive})),
          edges:(res.edges||[]).map(([a,b])=>({a,b})),
          cells:[],
          covPct:res.metrics?.coveragePct??0,
          conn:!!res.metrics?.isConnected,
          avgD:res.metrics?.avgDist??0,
          minDist:res.metrics?.minDist??0,
          battLife:res.metrics?.batteryLifeDays??0,
          pl:res.metrics?.pathLoss??0,
          tsd:res.timeSeries?.map(t=>({day:t.day,batt:t.avgBattery,alive:t.aliveNodes,cov:t.coverage}))||[],
        });

        const before=mapRes(data.before);
        const after=mapRes(data.after);

        // Build Voronoi/cells client-side for visualization consistency.
        const bg=buildGraph(before.pts);
        before.edges=bg.edges; before.cells=bg.cells;
        const ag=buildGraph(after.pts);
        after.edges=ag.edges; after.cells=ag.cells;

        setOptResult({before,after});
        setOptPhase("result");
      }catch(e){
        console.error(e);
        // Fallback to local optimizer if API fails
        const bV=BATTS[battType].v;
        const initPts=userNodes.map((n,i)=>({...n,id:i}));
        const bg=buildGraph(initPts);
        const bRes={pts:initPts,edges:bg.edges,cells:bg.cells,covPct:calcCov(initPts,sensorRange),conn:calcConn(initPts,bg.edges),avgD:bg.avgD,minDist:bg.minDist,battLife:simBatt(initPts,sensorPower,bV).battLife,pl:env==="Indoor"?plIndoor(bg.avgD,ple,wallAtt):plFSPL(bg.avgD)};
        const optPts=lloydOpt(initPts);
        const ag=buildGraph(optPts);
        const aRes={pts:optPts,edges:ag.edges,cells:ag.cells,covPct:calcCov(optPts,sensorRange),conn:calcConn(optPts,ag.edges),avgD:ag.avgD,minDist:ag.minDist,battLife:simBatt(optPts,sensorPower,bV).battLife,pl:env==="Indoor"?plIndoor(ag.avgD,ple,wallAtt):plFSPL(ag.avgD)};
        setOptResult({before:bRes,after:aRes});
        setOptPhase("result");
      }finally{
        setOptLoading(false);
      }
    })();
  },[numNodes,env,aW,aH,battType,capacity,txInt,userNodes,ple,wallAtt,buildGraph,calcCov,calcConn,simBatt,lloydOpt,sensorRange,sensorPower]);

  const healthOf=r=>Math.round(Math.min(40,(r.covPct/100)*40)+(r.conn?30:0)+Math.min(20,(r.battLife/400)*20)+(r.minDist>0?10:0));

  // ── Recommendations ──
  const recs=[]; let health=0;
  if(met){
    const{covPct,conn,battLife,firstDeath,avgD,minDist,pl,sR,n}=met;
    const req=Math.ceil((aW*aH)/(Math.PI*sR*sR*0.8));
    health=Math.round(Math.min(40,(covPct/100)*40)+(conn?30:0)+Math.min(20,(battLife/400)*20)+(minDist>sR*.5?10:0));
    if(covPct>=95)recs.push({t:"ok",cat:"Coverage",txt:`Excellent — ${covPct.toFixed(1)}% covered`});
    else if(covPct>=75)recs.push({t:"warn",cat:"Coverage",txt:`${covPct.toFixed(1)}% — add ${Math.max(0,req-n)} more nodes for 95%+`});
    else recs.push({t:"err",cat:"Coverage",txt:`Low ${covPct.toFixed(1)}% — need ~${req} nodes total`});
    if(conn)recs.push({t:"ok",cat:"Connectivity",txt:`All ${n} nodes reachable via mesh`});
    else recs.push({t:"err",cat:"Connectivity",txt:`Disconnected — reduce spacing or add relay nodes`});
    if(battLife>=200)recs.push({t:"ok",cat:"Battery",txt:`${battLife}d lifetime · First death: day ${firstDeath}`});
    else if(battLife>=60)recs.push({t:"warn",cat:"Battery",txt:`${battLife}d — try larger battery or longer TX interval`});
    else recs.push({t:"err",cat:"Battery",txt:`Only ${battLife}d — use Li-ion & reduce TX frequency`});
    if(minDist<sR*.5)recs.push({t:"warn",cat:"Spacing",txt:`Min ${minDist.toFixed(1)}m — nodes too close, wasteful overlap`});
    else if(avgD>sR*3)recs.push({t:"warn",cat:"Spacing",txt:`Avg ${avgD.toFixed(1)}m — coverage gaps likely`});
    else recs.push({t:"ok",cat:"Spacing",txt:`Good spacing — min ${minDist.toFixed(1)}m avg ${avgD.toFixed(1)}m`});
    recs.push({t:"info",cat:"RF",txt:`Path loss ${pl.toFixed(1)}dB at avg ${avgD.toFixed(1)}m (${env})`});
  }

  // ── AUTH PAGE ──
  const doAuth=()=>{setAuthErr("");if(authMode==="register"){if(!af.name||!af.email||!af.password)return setAuthErr("All fields required");if(users.find(u=>u.email===af.email))return setAuthErr("Email exists");const u={...af,id:Date.now()};setUsers(p=>[...p,u]);setUser(u);}else{const u=users.find(u=>u.email===af.email&&u.password===af.password);if(!u)return setAuthErr("Invalid credentials");setUser(u);}};
  if(!user)return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{width:360,padding:32,borderRadius:14,background:C.card,border:"1px solid "+C.border,boxShadow:"0 0 80px rgba(249,115,22,0.07)"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:24,fontWeight:800,fontFamily:"monospace",background:"linear-gradient(135deg,#f97316,#2dd4bf)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>⬡ WSN Simulator</div>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>Voronoi–Delaunay Hybrid Model</div>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:14}}>
          {["login","register"].map(m=><button key={m} onClick={()=>{setAuthMode(m);setAuthErr("");}} style={{flex:1,padding:9,borderRadius:7,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,background:authMode===m?"linear-gradient(135deg,#f97316,#ea580c)":"#1a1d28",color:authMode===m?"#fff":C.muted,fontFamily:"'DM Sans'"}}>{m==="login"?"Sign In":"Register"}</button>)}
        </div>
        {authMode==="register"&&<input style={INP} placeholder="Name" value={af.name} onChange={e=>setAf(f=>({...f,name:e.target.value}))}/>}
        <input style={INP} placeholder="Email" value={af.email} onChange={e=>setAf(f=>({...f,email:e.target.value}))}/>
        <input style={INP} type="password" placeholder="Password" value={af.password} onChange={e=>setAf(f=>({...f,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&doAuth()}/>
        {authErr&&<div style={{color:C.red,fontSize:11,marginBottom:8}}>{authErr}</div>}
        <button onClick={doAuth} style={{width:"100%",padding:13,borderRadius:9,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,background:"linear-gradient(135deg,#f97316,#ea580c)",color:"#fff",fontFamily:"'DM Sans'"}}>
          {authMode==="login"?"Sign In":"Create Account"}
        </button>
        <div style={{marginTop:10,fontSize:10,color:C.muted,textAlign:"center"}}>Demo: demo@test.com / 123</div>
      </div>
    </div>
  );

  // ── METRIC CARDS TOP BAR ──
  const metrics=met?[
    ["NODES",met.n,C.text],["COVERAGE",met.covPct.toFixed(1)+"%",C.teal],
    ["MIN DIST",met.minDist.toFixed(2)+"m",C.amber],["AVG DIST",met.avgD.toFixed(2)+"m","#94a3b8"],
    ["PL",met.pl.toFixed(1)+"dB",C.purple],["BATTERY",met.battLife+"d",C.green],
    ["1ST DEATH","D"+met.firstDeath,C.red],["CONNECTED",met.conn?"✓":"✗",met.conn?C.green:C.red],
  ]:[];

  const TABS=[["hybrid","⬡ Hybrid"],["coverage","◎ Coverage"],["optimize","⚡ Optimize"]];
  const RC={ok:{bg:"rgba(34,197,94,0.05)",border:"rgba(34,197,94,0.18)",col:"#86efac",icon:"✓"},warn:{bg:"rgba(245,158,11,0.05)",border:"rgba(245,158,11,0.18)",col:"#fcd34d",icon:"⚡"},err:{bg:"rgba(239,68,68,0.05)",border:"rgba(239,68,68,0.18)",col:"#fca5a5",icon:"⚠"},info:{bg:"rgba(249,115,22,0.05)",border:"rgba(249,115,22,0.12)",col:"#fdba74",icon:"·"}};

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'DM Sans',sans-serif",display:"flex",flexDirection:"column",fontSize:13}}>
      {/* ── HEADER ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 18px",borderBottom:"1px solid "+C.border,background:"rgba(11,13,19,0.98)",flexShrink:0}}>
        <span style={{fontSize:17,fontWeight:800,fontFamily:"monospace",background:"linear-gradient(135deg,#f97316,#2dd4bf)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>⬡ WSN Simulator</span>
        <span style={{fontSize:8,fontWeight:700,letterSpacing:2,padding:"3px 9px",borderRadius:20,background:"rgba(249,115,22,0.1)",color:C.accent,border:"1px solid rgba(249,115,22,0.2)",textTransform:"uppercase"}}>HYBRID</span>
        <div style={{flex:1}}/>
        <span style={{fontSize:12,color:C.muted}}>Hi, <b style={{color:C.teal}}>{user.name||user.email}</b></span>
        <button onClick={()=>setUser(null)} style={{padding:"5px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.muted,cursor:"pointer",fontSize:11}}>Logout</button>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* ── SIDEBAR ── */}
        <div style={{width:258,flexShrink:0,overflowY:"auto",background:C.sidebar,borderRight:"1px solid "+C.border,padding:14}}>
          <SL>Environment</SL>
          <div style={{display:"flex",gap:4}}>
            {["Indoor","Outdoor"].map(e=><button key={e} onClick={()=>setEnv(e)} style={{flex:1,padding:"7px 0",borderRadius:6,border:"1px solid "+(env===e?"rgba(249,115,22,0.45)":C.border),background:env===e?"rgba(249,115,22,0.1)":"transparent",color:env===e?C.accent:C.muted,cursor:"pointer",fontSize:10,fontWeight:700}}>{e==="Indoor"?"🏢":"🌍"} {e}</button>)}
          </div>

          <SL>Network</SL>
          <LB>Nodes</LB><SlR min={3} max={30} val={numNodes} set={setNumNodes} color={C.accent}/>
          <div style={{display:"flex",gap:6,marginTop:4}}>
            <div style={{flex:1}}><LB>Width (m)</LB><NI type="number" value={aW} onChange={e=>setAW(+e.target.value||10)}/></div>
            <div style={{flex:1}}><LB>Height (m)</LB><NI type="number" value={aH} onChange={e=>setAH(+e.target.value||10)}/></div>
          </div>

          <SL>Sensor</SL>
          <LB>Detection range (m)</LB>
          <SlR min={3} max={50} val={sensorRange} set={setSensorRange} color={C.teal}/>
          <LB>Power draw</LB>
          <SlR min={0.5} max={3} step={0.1} val={sensorPower} set={setSensorPower} color={C.amber} fmt={v=>v.toFixed(1)+"×"}/>

          <SL>Energy</SL>
          <LB>Battery type</LB>
          <SEL value={battType} onChange={e=>{setBattType(e.target.value);setCapacity(BATTS[e.target.value].cap);}}>
            {Object.entries(BATTS).map(([k,v])=><option key={k} value={k}>{k} — {v.v}V / {v.cap}mAh</option>)}
          </SEL>
          <LB>Capacity (mAh)</LB>
          <SlR min={100} max={5000} step={50} val={capacity} set={setCapacity} color={C.accent}/>
          <LB>TX interval (s)</LB>
          <SlR min={5} max={300} step={5} val={txInt} set={setTxInt} color={C.purple}/>

          <SL>Propagation</SL>
          <LB>Path loss exponent</LB>
          <SlR min={2} max={5} step={0.1} val={ple} set={setPle} color={C.accent} fmt={v=>v.toFixed(1)}/>
          {env==="Indoor"&&<><LB>Wall attenuation (dB)</LB><SlR min={0} max={25} val={wallAtt} set={setWallAtt} color={C.accent}/></>}

          <div style={{marginTop:10,padding:"8px 10px",borderRadius:6,background:"rgba(249,115,22,0.04)",border:"1px solid rgba(249,115,22,0.08)",fontSize:9,lineHeight:1.7,color:C.muted,fontFamily:"monospace"}}>
            <b style={{color:"rgba(249,115,22,0.6)"}}>Energy model</b><br/>E_tx=50nJ/b · Amp=100pJ·d² · E_rx=50nJ/b
          </div>

          <button onClick={runSim} disabled={loading} style={{width:"100%",marginTop:12,padding:13,borderRadius:9,border:"none",cursor:loading?"not-allowed":"pointer",fontSize:13,fontWeight:700,background:loading?"rgba(249,115,22,0.3)":"linear-gradient(135deg,#f97316,#ea580c)",color:"#fff",boxShadow:"0 4px 24px rgba(249,115,22,0.2)",fontFamily:"'DM Sans'",transition:"all 0.2s"}}>
            {loading?"⏳ Computing...":"▶ Run Simulation"}
          </button>
        </div>

        {/* ── MAIN ── */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {!done?(
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14,opacity:0.35}}>
              <div style={{fontSize:52,lineHeight:1}}>⬡</div>
              <div style={{color:C.muted,fontSize:13,fontFamily:"monospace"}}>Configure and run simulation</div>
            </div>
          ):(
            <>
              {/* ── TAB BAR + METRICS ── */}
              <div style={{borderBottom:"1px solid "+C.border,background:"rgba(14,16,25,0.95)",flexShrink:0}}>
                {/* Tabs row */}
                <div style={{display:"flex",alignItems:"center",padding:"8px 14px 0",gap:4}}>
                  {TABS.map(([t,l])=>(
                    <button key={t} onClick={()=>setTab(t)} style={{padding:"7px 20px",borderRadius:"7px 7px 0 0",border:"1px solid "+(tab===t?"rgba(249,115,22,0.4)":C.border),borderBottom:tab===t?"1px solid #0e1019":"1px solid "+C.border,background:tab===t?"rgba(249,115,22,0.1)":C.sidebar,color:tab===t?C.accent:C.muted,cursor:"pointer",fontSize:11,fontWeight:700,letterSpacing:0.4,transition:"all 0.15s",marginBottom:tab===t?-1:0}}>
                      {l}
                    </button>
                  ))}
                </div>
                {/* Metrics strip */}
                <div style={{display:"flex",gap:6,padding:"6px 14px 8px",overflowX:"auto"}}>
                  {metrics.map(([l,v,c])=>(
                    <div key={l} style={{padding:"5px 12px",borderRadius:7,background:C.card,border:"1px solid "+C.border,flexShrink:0,textAlign:"center"}}>
                      <div style={{fontSize:7,color:C.muted,textTransform:"uppercase",letterSpacing:1.3,fontWeight:700,marginBottom:1}}>{l}</div>
                      <div style={{fontSize:14,fontWeight:800,color:c,fontFamily:"monospace"}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── TAB BODIES ── */}
              <div style={{flex:1,overflowY:"auto",padding:14}}>

                {/* ── HYBRID ── */}
                {tab==="hybrid"&&(
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{fontSize:10,color:C.muted,fontFamily:"monospace",padding:"4px 10px",borderRadius:6,background:C.card,border:"1px solid "+C.border}}>
                      Drag = move · Right-click = kill/revive · Shows Voronoi territories + Delaunay mesh
                    </div>
                    <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,overflow:"hidden"}}>
                      <canvas ref={canvasRef} style={{display:"block",width:"100%",cursor:"crosshair"}} onMouseDown={mDown} onMouseMove={mMove} onMouseUp={mUp} onMouseLeave={mUp} onContextMenu={mCtx}/>
                    </div>
                    <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,overflow:"hidden"}}>
                      <div style={{padding:"7px 14px",borderBottom:"1px solid "+C.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:2,color:C.accent}}>Recommendations</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{width:72,height:4,borderRadius:2,background:"rgba(255,255,255,0.05)",overflow:"hidden"}}>
                            <div style={{height:"100%",width:health+"%",borderRadius:2,background:health>=80?C.green:health>=50?C.amber:C.red,transition:"width 0.4s"}}/>
                          </div>
                          <span style={{fontSize:11,fontWeight:800,fontFamily:"monospace",color:health>=80?C.green:health>=50?C.amber:C.red}}>{health}/100</span>
                        </div>
                      </div>
                      <div style={{padding:10,display:"flex",flexDirection:"column",gap:5}}>
                        {recs.map((r,i)=>{const c=RC[r.t]||RC.info;return(
                          <div key={i} style={{padding:"6px 10px",borderRadius:7,fontSize:12,lineHeight:1.5,background:c.bg,border:"1px solid "+c.border,color:c.col,display:"flex",gap:8,alignItems:"flex-start"}}>
                            <span style={{fontSize:10,flexShrink:0,marginTop:1}}>{c.icon}</span>
                            <div><span style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:1,opacity:0.55,marginRight:5}}>{r.cat}</span>{r.txt}</div>
                          </div>
                        );})}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── COVERAGE ── */}
                {tab==="coverage"&&(
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,overflow:"hidden"}}>
                      <canvas ref={canvasRef} style={{display:"block",width:"100%",cursor:"crosshair"}} onMouseDown={mDown} onMouseMove={mMove} onMouseUp={mUp} onMouseLeave={mUp} onContextMenu={mCtx}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      {[["Battery % over time",0,"batt","%"],["Alive nodes",1,"alive",""],["Coverage %",2,"cov","%"],["Energy (day idx)",3,"day",""]].map(([title,idx])=>(
                        <div key={title} style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:12}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:C.muted,marginBottom:8}}>{title}</div>
                          <canvas ref={chartR[idx]} style={{width:"100%",height:130}}/>
                        </div>
                      ))}
                    </div>
                    {/* Node table */}
                    <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,overflow:"hidden"}}>
                      <div style={{padding:"7px 14px",borderBottom:"1px solid "+C.border,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:2,color:C.accent}}>Node table</div>
                      <div style={{maxHeight:260,overflowY:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
                          <thead><tr>{["ID","Status","X","Y","V.Area","MinN","Toggle"].map(h=><th key={h} style={{padding:"5px 10px",textAlign:"left",fontSize:8,textTransform:"uppercase",letterSpacing:1,color:C.muted,borderBottom:"1px solid "+C.border,fontWeight:700,background:C.card}}>{h}</th>)}</tr></thead>
                          <tbody>{nodes.map(nd=>(
                            <tr key={nd.id} style={{borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                              <td style={TD}><b style={{color:C.accent}}>#{nd.id}</b></td>
                              <td style={TD}><span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:nd.alive!==false?C.green:C.red,marginRight:5,boxShadow:"0 0 4px "+(nd.alive!==false?"rgba(34,197,94,0.5)":"rgba(239,68,68,0.5)")}}/>{nd.alive!==false?"Alive":"Dead"}</td>
                              <td style={TD}>{nd.x.toFixed(1)}</td><td style={TD}>{nd.y.toFixed(1)}</td>
                              <td style={TD}>{(nd.area||0).toFixed(1)}m²</td>
                              <td style={TD}>{(nd.minN||0).toFixed(1)}m</td>
                              <td style={TD}><button onClick={()=>{const nn=[...nodes];nn[nd.id]={...nn[nd.id],alive:!nn[nd.id].alive};setNodes(nn);}} style={{padding:"2px 8px",borderRadius:4,border:"1px solid "+(nd.alive!==false?"rgba(239,68,68,0.2)":"rgba(34,197,94,0.2)"),background:"transparent",color:nd.alive!==false?C.red:C.green,cursor:"pointer",fontSize:9,fontWeight:700}}>{nd.alive!==false?"Kill":"Revive"}</button></td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── OPTIMIZE ── */}
                {tab==="optimize"&&(
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    {optPhase==="place"&&(<>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                        <div>
                          <div style={{fontSize:15,fontWeight:700,color:C.accent,fontFamily:"monospace",marginBottom:3}}>Place your nodes manually</div>
                          <div style={{fontSize:11,color:C.muted}}>Click to add · Drag to reposition · Right-click to remove</div>
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          <button onClick={()=>setUserNodes(Array.from({length:numNodes},(_,i)=>({id:i,x:Math.random()*aW*.85+aW*.075,y:Math.random()*aH*.85+aH*.075})))} style={GBTN}>⚡ Auto-fill</button>
                          <button onClick={()=>setUserNodes([])} style={{...GBTN,borderColor:"rgba(239,68,68,0.2)",color:C.red}}>✕ Clear</button>
                          <button onClick={runOptimize} disabled={userNodes.length<3||optLoading} style={{padding:"7px 18px",borderRadius:7,border:"none",background:userNodes.length<3||optLoading?"rgba(249,115,22,0.3)":"linear-gradient(135deg,#f97316,#ea580c)",color:"#fff",cursor:userNodes.length<3||optLoading?"not-allowed":"pointer",fontSize:11,fontWeight:700,opacity:userNodes.length<3?0.6:1}}>
                            {optLoading?"⏳ Optimizing...":"▶ Optimize"}
                          </button>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div style={{height:3,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.min(100,(userNodes.length/numNodes)*100)}%`,background:"linear-gradient(90deg,#f97316,#2dd4bf)",borderRadius:2,transition:"width 0.3s"}}/>
                      </div>
                      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,overflow:"hidden"}}>
                        <canvas ref={placeRef} style={{display:"block",width:"100%",cursor:"crosshair"}} onClick={pClick} onMouseDown={pDown} onMouseMove={pMove} onMouseUp={pUp} onMouseLeave={pUp} onContextMenu={pCtx}/>
                      </div>
                      {userNodes.length>0&&(
                        <div style={{display:"flex",gap:8}}>
                          {[["Placed",`${userNodes.length}/${numNodes}`,C.accent],["Coverage",calcCov(userNodes,sensorRange).toFixed(1)+"%",C.teal],["Status",userNodes.length>=3?(calcConn(userNodes,buildGraph(userNodes).edges)?"Connected ✓":"Disconnected ✗"):"Need 3+ nodes",userNodes.length>=3&&calcConn(userNodes,buildGraph(userNodes).edges)?C.green:C.amber]].map(([l,v,c])=>(
                            <div key={l} style={{flex:1,background:C.card,border:"1px solid "+C.border,borderRadius:8,padding:"10px 12px"}}>
                              <div style={{fontSize:8,color:C.muted,textTransform:"uppercase",letterSpacing:1.5,fontWeight:700,marginBottom:3}}>{l}</div>
                              <div style={{fontSize:16,fontWeight:800,color:c,fontFamily:"monospace"}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>)}

                    {optPhase==="result"&&optResult&&(()=>{
                      const bSc=healthOf(optResult.before),aSc=healthOf(optResult.after);
                      const imps=[
                        {label:"Coverage",b:optResult.before.covPct.toFixed(1)+"%",a:optResult.after.covPct.toFixed(1)+"%",delta:+(optResult.after.covPct-optResult.before.covPct).toFixed(1),unit:"%"},
                        {label:"Battery",b:optResult.before.battLife+"d",a:optResult.after.battLife+"d",delta:optResult.after.battLife-optResult.before.battLife,unit:"d"},
                        {label:"Avg dist",b:optResult.before.avgD.toFixed(1)+"m",a:optResult.after.avgD.toFixed(1)+"m",delta:+(optResult.before.avgD-optResult.after.avgD).toFixed(1),unit:"m",loBetter:true},
                        {label:"Min dist",b:optResult.before.minDist.toFixed(1)+"m",a:optResult.after.minDist.toFixed(1)+"m",delta:+(optResult.after.minDist-optResult.before.minDist).toFixed(1),unit:"m"},
                        {label:"Path loss",b:optResult.before.pl.toFixed(1)+"dB",a:optResult.after.pl.toFixed(1)+"dB",delta:+(optResult.before.pl-optResult.after.pl).toFixed(1),unit:"dB",loBetter:true},
                        {label:"Connected",b:optResult.before.conn?"Yes":"No",a:optResult.after.conn?"Yes":"No",delta:optResult.after.conn===optResult.before.conn?0:optResult.after.conn?1:-1,isConn:true},
                      ];
                      return(<>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <div>
                            <div style={{fontSize:15,fontWeight:700,color:C.accent,fontFamily:"monospace",marginBottom:3}}>Optimization complete</div>
                            <div style={{fontSize:11,color:C.muted}}>Lloyd's relaxation · 25 Voronoi-guided iterations</div>
                          </div>
                          <button onClick={()=>{setOptPhase("place");setOptResult(null);}} style={GBTN}>← Redo placement</button>
                        </div>

                        {/* Score bar */}
                        <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:"14px 18px",display:"flex",alignItems:"center",gap:20}}>
                          {[["Your placement",bSc,"#64748b"],["→",null,C.dim],["Optimized",aSc,C.accent]].map(([l,sc,c],idx)=>sc===null?(
                            <div key={idx} style={{fontSize:20,color:C.accent,opacity:0.4}}>→</div>
                          ):(
                            <div key={idx} style={{flex:1}}>
                              <div style={{fontSize:8,color:c===C.accent?C.accent:C.muted,textTransform:"uppercase",letterSpacing:2,fontWeight:700,marginBottom:6}}>{l}</div>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <div style={{fontSize:28,fontWeight:900,fontFamily:"monospace",color:sc>=70?C.green:sc>=45?C.amber:C.red}}>{sc}</div>
                                <div style={{flex:1}}>
                                  <div style={{height:5,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:sc+"%",background:sc>=70?C.green:sc>=45?C.amber:C.red,borderRadius:3}}/></div>
                                  <div style={{fontSize:8,color:C.muted,marginTop:2}}>out of 100</div>
                                </div>
                              </div>
                            </div>
                          ))}
                          <div style={{padding:"10px 16px",borderRadius:8,background:aSc>bSc?"rgba(34,197,94,0.08)":"rgba(239,68,68,0.08)",border:"1px solid "+(aSc>bSc?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)"),textAlign:"center",flexShrink:0}}>
                            <div style={{fontSize:8,color:C.muted,marginBottom:2}}>change</div>
                            <div style={{fontSize:22,fontWeight:900,fontFamily:"monospace",color:aSc>bSc?C.green:C.red}}>{aSc>bSc?"+":""}{aSc-bSc}</div>
                          </div>
                        </div>

                        {/* Metric diff grid */}
                        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                          {imps.map(imp=>{
                            const improved=imp.isConn?imp.delta>0:imp.delta>0;
                            const same=imp.delta===0;
                            const col=same?C.muted:improved?C.green:C.amber;
                            const bdr=same?C.border:improved?"rgba(34,197,94,0.2)":"rgba(245,158,11,0.2)";
                            const bg=same?C.card:improved?"rgba(34,197,94,0.04)":"rgba(245,158,11,0.04)";
                            return(
                              <div key={imp.label} style={{background:bg,border:"1px solid "+bdr,borderRadius:8,padding:"10px 12px"}}>
                                <div style={{fontSize:8,color:C.muted,textTransform:"uppercase",letterSpacing:1.5,fontWeight:700,marginBottom:5}}>{imp.label}</div>
                                <div style={{display:"flex",alignItems:"baseline",gap:5,marginBottom:4}}>
                                  <span style={{fontSize:10,color:C.dim,fontFamily:"monospace",textDecoration:"line-through"}}>{imp.b}</span>
                                  <span style={{fontSize:8,color:C.accent}}>→</span>
                                  <span style={{fontSize:14,fontWeight:800,color:C.text,fontFamily:"monospace"}}>{imp.a}</span>
                                </div>
                                <div style={{fontSize:10,fontWeight:700,fontFamily:"monospace",color:col}}>{same?"—":imp.isConn?(imp.delta>0?"✓ connected":"✗ lost"):`${improved?"+":""}${imp.delta}${imp.unit} ${improved?"▲":"▼"}`}</div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Side by side maps */}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                          {[["Your placement",beforeRef,bSc,"rgba(100,116,139,0.25)"],["Optimized",afterRef,aSc,"rgba(249,115,22,0.3)"]].map(([lbl,ref,sc,bdr])=>(
                            <div key={lbl}>
                              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,color:C.muted,marginBottom:5}}>
                                {lbl} <span style={{color:sc>=70?C.green:sc>=45?C.amber:C.red,marginLeft:4}}>score {sc}/100</span>
                              </div>
                              <div style={{background:C.card,border:"1px solid "+bdr,borderRadius:10,overflow:"hidden"}}>
                                <canvas ref={ref} style={{display:"block",width:"100%"}}/>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Explanation panel */}
                        <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:"14px 16px"}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:2,color:C.accent,marginBottom:10}}>What the optimizer changed</div>
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            {[
                              ["Voronoi tessellation","Each node was assigned the region of space closest to it — its territory."],
                              ["Lloyd's relaxation","Each node moved 60% toward its territory centroid, repeated 25 times, forcing even distribution."],
                              ["Coverage result",`${optResult.before.covPct.toFixed(1)}% → ${optResult.after.covPct.toFixed(1)}% (${aW}×${aH}m area, ${sensorRange}m sensor range)`],
                              ["Connectivity",optResult.after.conn?"All nodes can reach each other via Delaunay mesh (comm range = 2× sensor range).":"Some nodes remain isolated — try adding more or reducing area size."],
                            ].map(([title,desc])=>(
                              <div key={title} style={{display:"flex",gap:10,padding:"8px 10px",borderRadius:7,background:"rgba(249,115,22,0.04)",border:"1px solid rgba(249,115,22,0.08)"}}>
                                <div style={{width:3,borderRadius:2,background:"linear-gradient(180deg,#f97316,#2dd4bf)",flexShrink:0}}/>
                                <div>
                                  <div style={{fontSize:10,fontWeight:700,color:C.accent,fontFamily:"monospace",marginBottom:2}}>{title}</div>
                                  <div style={{fontSize:11,color:C.muted,lineHeight:1.55}}>{desc}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Battery mini chart */}
                        <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:"14px 16px"}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:2,color:C.accent,marginBottom:10}}>Battery lifetime comparison</div>
                          <div style={{display:"flex",gap:24,marginBottom:10}}>
                            {[["Your placement",optResult.before.battLife,"#475569"],["Optimized",optResult.after.battLife,C.accent]].map(([l,v,c])=>(
                              <div key={l}><div style={{fontSize:8,color:C.muted,textTransform:"uppercase",letterSpacing:1,fontWeight:700,marginBottom:2}}>{l}</div><div style={{fontSize:20,fontWeight:900,fontFamily:"monospace",color:c}}>{v} days</div></div>
                            ))}
                          </div>
                          <div style={{position:"relative",height:64,background:"rgba(255,255,255,0.02)",borderRadius:6,overflow:"hidden"}}>
                            {["before","after"].map((w,wi)=>{
                              const data=optResult[w].tsd;if(!data?.length)return null;
                              const maxDay=Math.max(...["before","after"].flatMap(k=>optResult[k].tsd.map(d=>d.day)),1);
                              const pts2=data.map(d=>`${(d.day/maxDay)*100},${100-d.batt}`).join(" ");
                              return <svg key={w} viewBox="0 0 100 100" preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
                                <polyline points={pts2} fill="none" stroke={wi===0?"rgba(71,85,105,0.5)":"#f97316"} strokeWidth={wi===0?"0.8":"1.5"} vectorEffect="non-scaling-stroke"/>
                              </svg>;
                            })}
                            <div style={{position:"absolute",bottom:2,left:0,right:0,display:"flex",justifyContent:"space-between",padding:"0 6px",fontSize:8,color:C.muted,fontFamily:"monospace"}}>
                              <span>Day 0</span><span>Day {Math.max(optResult.before.battLife,optResult.after.battLife)}</span>
                            </div>
                          </div>
                          <div style={{display:"flex",gap:16,marginTop:7,fontSize:9,color:C.muted}}>
                            <span><span style={{color:"rgba(71,85,105,0.8)"}}>—</span> Your placement</span>
                            <span><span style={{color:C.accent}}>—</span> Optimized</span>
                          </div>
                        </div>
                      </>);
                    })()}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── UI helpers ────────────────────────────────────────────────────
const C_={accent:"#f97316",border:"rgba(255,255,255,0.06)",muted:"#64748b"};
function SL({children}){return <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:2.5,color:C_.accent,margin:"14px 0 6px",paddingBottom:3,borderBottom:"1px solid rgba(249,115,22,0.1)"}}>{children}</div>;}
function LB({children}){return <div style={{fontSize:10,color:C_.muted,marginBottom:2,marginTop:5,fontFamily:"monospace"}}>{children}</div>;}
function SlR({min,max,step=1,val,set,color,fmt}){
  return <div style={{display:"flex",alignItems:"center",gap:8}}>
    <input type="range" min={min} max={max} step={step} value={val} onChange={e=>set(step<1?+parseFloat(e.target.value).toFixed(2):+e.target.value)} style={{flex:1,accentColor:color,cursor:"pointer"}}/>
    <span style={{fontSize:11,fontFamily:"monospace",color:color||C_.accent,minWidth:38,textAlign:"right"}}>{fmt?fmt(val):val}</span>
  </div>;
}
function NI(props){return <input {...props} style={{width:"100%",padding:"6px 8px",borderRadius:6,fontSize:12,fontFamily:"monospace",background:"#0d1117",color:"#e2e8f0",border:"1px solid rgba(255,255,255,0.07)",outline:"none",boxSizing:"border-box"}}/>;}
function SEL({children,...p}){return <select {...p} style={{width:"100%",padding:"6px 8px",borderRadius:6,fontSize:11,fontFamily:"monospace",background:"#0d1117",color:"#e2e8f0",border:"1px solid rgba(255,255,255,0.07)",outline:"none"}}>{children}</select>;}
const INP={width:"100%",padding:"10px 12px",borderRadius:7,marginBottom:10,background:"#0d1117",border:"1px solid rgba(255,255,255,0.07)",color:"#e2e8f0",fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:"none",boxSizing:"border-box"};
const TD={padding:"5px 10px",color:"#64748b"};
const GBTN={padding:"7px 14px",borderRadius:7,border:"1px solid rgba(249,115,22,0.25)",background:"rgba(249,115,22,0.07)",color:"#f97316",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'DM Sans'"};