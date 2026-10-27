/* Palette, application state and configuration
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ================= palette ================= */
const USE_COL = {
  corridor:'#C9C7BE', stairs:'#C8A26B', elevator:'#7E9C8B', restroom:'#B08098',
  mech:'#A3A39B', retail:'#D98A3D', apartment:'#8C7FA8', office:'#6E8CA8',
  amenity:'#6FA39B', hotel:'#B2706B', restaurant:'#C07A55', clinic:'#8FA8BC',
  coworking:'#9A93B8', studio:'#C2A98A', parking:'#9B9B93', entrance:'#E2521D',
};
const USE_HEX = {};
for (const k in USE_COL) USE_HEX[k] = parseInt(USE_COL[k].slice(1),16);
const USES = ['apartment','studio','office','coworking','retail','restaurant',
              'amenity','clinic','hotel','parking'];
const CORE_LABEL = { corridor:'Circulation', stairs:'Stairs', elevator:'Lifts',
                     restroom:'Restrooms', mech:'Services' };
const SHORT = { corridor:'Corr', stairs:'St', elevator:'Lift', restroom:'WC', mech:'Plant',
                retail:'Retail', apartment:'Apt', office:'Office', amenity:'Amen', hotel:'Room' };
const COMPASS = ['N','NE','E','SE','S','SW','W','NW'];
const $ = id => document.getElementById(id);

const DEFAULT_PLOT = () => ({
  pts:[{x:0,y:0},{x:130,y:0},{x:130,y:170},{x:0,y:170}], setbacks:[25,15,20,15] });
const DEFAULT_MIX = () => ([
  { id:'u1', name:'Shop unit',   use:'retail',    unitArea:900,  perFloor:2 },
  { id:'u2', name:'Cafe',        use:'restaurant',unitArea:1200, perFloor:1 },
  { id:'u3', name:'Studio',      use:'studio',    unitArea:420,  perFloor:2 },
  { id:'u4', name:'1-bed apt',   use:'apartment', unitArea:620,  perFloor:3 },
  { id:'u5', name:'2-bed apt',   use:'apartment', unitArea:950,  perFloor:2 },
  { id:'u6', name:'3-bed apt',   use:'apartment', unitArea:1350, perFloor:1 },
  { id:'u7', name:'Office suite',use:'office',    unitArea:1100, perFloor:2 },
  { id:'u8', name:'Gym',         use:'amenity',   unitArea:1600, perFloor:1 },
]);
const RATIOS = [1,2,3,4,5,6,8,10];
const USE_LABEL = { apartment:'Residential', studio:'Studios', office:'Office',
  coworking:'Co-working', retail:'Retail', restaurant:'Food & drink',
  amenity:'Amenity', clinic:'Clinic', hotel:'Hotel', parking:'Parking' };

const state = {
  site: DEFAULT_PLOT(), mix: DEFAULT_MIX(), vg:null, pg:null, options:[], pick:0,
  floor:-1, cfg:null, reveal:1, view:'site', tool:'select',
  ratio:4, stack:['retail','apartment'], paint:'apartment', painting:false, size:null,
  style:'curtain', material:'concrete', massing:'taper', entrances:[], entHoverPt:null, dimHits:[], dimEdit:-1,
  img:null, imgOp:0.55, cal:null, loc:'',
  edits:{}, _eff:null, mLvl:0, mTool:'sel', mRoom:null, mHot:null, mPaint:false,
  mSegs:[], mAreas:{}, mEdited:false,
  drawing:false, draft:[], drag:null, hotEdge:-1, vw:null, cursor:null, uid:9,
  plan:null, feas:null, projectId:null, projectName:'Untitled scheme',
  vgStale:true, fitPending:true, sprinklered:true, park:null, parking:null, phase:null,
};

/* ================= config ================= */
function baseCfg(){
  return { floorH:+$('sFh').value, bay:+$('sBay').value, upperSetback:+$('sUp').value,
    farRatio: state.ratio, heightLimit:+$('sHl').value,
    gridAngle: +$('sAng').value, massing: state.massing, twistDeg: +$('sTwist').value };
}
// The ratio sets the permissible area; the storey count falls out of it.
function sizeNow(){
  const b = baseCfg();
  const z = sizeBuilding({pts:state.site.pts, setbacks:state.site.setbacks}, b);
  state.size = z;
  return z;
}
function readCfg(){
  const b = baseCfg(), z = state.size || sizeNow();
  return { ...b, stories:z.storeys, allowed:z.allowed,
    stack: resolveStack(state.stack, z.storeys), mix: state.mix,
    iters:+$('sIter').value, nOpts:+$('sOpts').value,
    core:{ corridorPct:+$('sCor').value,
      stairCount:Math.max(1,+$('cStairN').value||1), stairEach:+$('cStairs').value||0,
      liftCount:Math.max(1,+$('cLiftN').value||1),  liftEach:+$('cLifts').value||0,
      lifts:(Math.max(1,+$('cLiftN').value||1))*(+$('cLifts').value||0),
      restrooms:+$('cWc').value||0, services:+$('cSvc').value||0 },
  };
}
function syncLabels(){
  const b = baseCfg();
  $('vFh').textContent=b.floorH+' ft'; $('vBay').textContent=b.bay+' ft';
  $('vUp').textContent=b.upperSetback+' ft'; $('vHl').textContent=b.heightLimit+' ft';
  $('vAng').textContent=b.gridAngle+'\u00b0';
  $('vTwist').textContent=$('sTwist').value+'\u00b0';
  $('vCor').textContent=$('sCor').value+'%';
  $('vIter').textContent=$('sIter').value; $('vOpts').textContent=$('sOpts').value;
  $('mixCount').textContent = state.mix.length+' type'+(state.mix.length===1?'':'s');
}
const MASSINGS = [['extrude','Extruded'],['taper','Tapered'],['step','Stepped'],
                  ['crown','Crowned'],['notch','Notched'],['twist','Twisted']];
function paintMassing(){
  $('massPick').innerHTML = MASSINGS.map(([k,l])=>
    `<button data-k="${k}" class="${k===state.massing?'on':''}">${l}</button>`).join('');
  $('massPick').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    state.massing=b.dataset.k; paintMassing(); resize2(); invalidate();
  });
  $('twistCtl').style.display = state.massing==='twist' ? '' : 'none';
}
function paintRatios(){
  $('ratios').innerHTML = RATIOS.map(r=>
    `<button data-r="${r}" class="${r===state.ratio?'on':''}">1:${r}</button>`).join('');
  $('ratios').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    state.ratio=+b.dataset.r; paintRatios(); resize2(); invalidate();
  });
}
// recompute the derived building and everything that depends on it
function resize2(){
  state.fitPending = true;
  const z = sizeNow();
  const bindTxt = z.bind==='far'
    ? 'The ratio is the binding constraint.'
    : z.bind==='height'
      ? `<span class="bind">Height limit binds first &mdash; only ${fmt(z.built)} sq ft of the allowance can be built.</span>`
      : `<span class="bind">The plot runs out before the ratio does.</span>`;
  $('allowNote').innerHTML =
    `Permissible covered area <b>${fmt(z.allowed)} sq ft</b>
     &nbsp;=&nbsp; ${fmt(z.plotArea)} &times; ${state.ratio}.<br>
     Fills <b>${z.storeys} storeys</b> at ${baseCfg().floorH} ft &mdash; <b>${z.height} ft</b> tall${
       z.trimTop>0 ? ', the top one trimmed back to use the last of the allowance' : ''}.<br>${bindTxt}`;
  $('stackNote').textContent = z.storeys+' levels';
  paintStack(); paintMix(); syncLabels(); plotNote();
  if (state.view==='site') paintSite();
}

/* ---------- entrance ---------- */
// The front is taken to be the edge carrying the deepest setback, which is
// how most bye-laws describe it. The entrance sits in a ground-floor bay whose
// open face looks that way.
function frontEdge(){
  normalizeSite();
  const e = edgeData(state.site.pts), sb = state.site.setbacks;
  let best = 0;
  for (let i=1;i<e.length;i++) if ((sb[i]||0) > (sb[best]||0)) best = i;
  return { i:best, e:e[best] };
}
const DIRS = [[0,-1],[1,0],[0,1],[-1,0]];
function openFaces(vg, id){
  const v = vg.voxels[id], out = [];
  DIRS.forEach(([dx,dy],k)=>{
    if (vg.index.get(`${v.s},${v.ix+dx},${v.iy+dy}`) === undefined) out.push(k);
  });
  return out;
}
// The bay grid lives in the building's own turned frame, so a point picked on
// the canvas has to be brought into that frame before it can match a bay. This
// is why clicking used to do nothing once the grid was rotated.
function toGrid(p){
  const vg = state.vg;
  return (vg && vg.angle) ? rotPt(p, -vg.angle, vg.pivot) : p;
}
function fromGrid(p){
  const vg = state.vg;
  return (vg && vg.angle) ? rotPt(p, vg.angle, vg.pivot) : p;
}
// the ground bays with an outside wall: the ones that can hold a door
function doorBays(){
  const vg = state.vg; if (!vg) return [];
  return (vg.byStory[0] || []).filter(id => openFaces(vg, id).length > 0);
}
function bayAtPoint(px, py){
  const vg = state.vg; if (!vg || !state.vw) return -1;
  const f = toGrid(toFt(state.vw, px, py));
  for (const id of (vg.byStory[0] || [])){
    const v = vg.voxels[id];
    if (f.x>=v.x && f.x<=v.x+v.w && f.y>=v.y && f.y<=v.y+v.d) return id;
  }
  return -1;
}
// which wall the door sits in: outward, and facing the street
function faceOfBay(id){
  const vg = state.vg;
  const faces = openFaces(vg, id);
  if (!faces.length) return -1;
  const { e } = frontEdge();
  const ang = vg.angle || 0;
  const c = Math.cos(-ang), si = Math.sin(-ang);
  const ox = (-e.nx)*c - (-e.ny)*si, oy = (-e.nx)*si + (-e.ny)*c;
  let bestK = faces[0], bestD = -2;
  for (const k of faces){
    const d = DIRS[k][0]*ox + DIRS[k][1]*oy;
    if (d > bestD){ bestD = d; bestK = k; }
  }
  return bestK;
}
// the doors on the building: the ones placed by hand, or one chosen for you
/* ---------------------------------------------------------------------------
   Entrances live in site coordinates, not bay indices.

   They used to be stored as {ix,iy} on the solved structural grid, which meant
   an entrance could not exist until after a scheme had been generated -- the
   wrong way round, since where a building is entered from is a decision about
   the street, taken before anything is laid out. Storing the point on the plot
   instead means it can be placed straight after the boundary, survives the
   plot being reshaped, and simply re-resolves to whichever bay it falls in
   each time the scheme is solved.
--------------------------------------------------------------------------- */

/* Nearest point on the plot boundary, and how far the click was from it. */
function snapToBoundary(p){
  const pts = state.site.pts; let best = null;
  for (let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i+1) % pts.length];
    const vx = b.x-a.x, vy = b.y-a.y, L2 = vx*vx + vy*vy;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x-a.x)*vx + (p.y-a.y)*vy) / L2)) : 0;
    const q = { x:a.x + vx*t, y:a.y + vy*t };
    const d = Math.hypot(p.x-q.x, p.y-q.y);
    if (!best || d < best.d) best = { x:q.x, y:q.y, d, edge:i };
  }
  return best;
}

/* The bay an entrance point resolves to: the nearest ground-floor bay that has
   an outer face. Returns -1 while there is no usable grid. */
function bayForEntrance(pt){
  const vg = state.vg; if (!vg || state.vgStale) return -1;
  const live = doorBays(); if (!live.length) return -1;
  const f = toGrid(pt);
  let best = -1, bd = Infinity;
  for (const id of live){
    const v = vg.voxels[id];
    const cx = Math.max(v.x, Math.min(f.x, v.x+v.w));
    const cy = Math.max(v.y, Math.min(f.y, v.y+v.d));
    const d = Math.hypot(f.x-cx, f.y-cy);
    if (d < bd){ bd = d; best = id; }
  }
  return best;
}

function entranceList(){
  const vg = state.vg; if (!vg || state.vgStale) return [];
  const live = doorBays(); if (!live.length) return [];
  const out = [], seen = new Set();
  for (const m of (state.entrances || [])){
    const id = bayForEntrance(m);
    if (id < 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, face: faceOfBay(id), manual: true, at: m });
  }
  if (out.length) return out;

  /* Nothing placed: put one on the longest street frontage. */
  const { e } = frontEdge();
  const midG = toGrid({ x:(e.a.x+e.b.x)/2, y:(e.a.y+e.b.y)/2 });
  const ang = vg.angle || 0;
  const c = Math.cos(-ang), si = Math.sin(-ang);
  const ox = (-e.nx)*c - (-e.ny)*si, oy = (-e.nx)*si + (-e.ny)*c;
  let best = -1, bd = Infinity;
  for (const id of live){
    const k = faceOfBay(id);
    if (k === -1) continue;
    if (DIRS[k][0]*ox + DIRS[k][1]*oy < 0.4) continue;
    const v = vg.voxels[id];
    const d = Math.hypot(v.x+v.w/2-midG.x, v.y+v.d/2-midG.y);
    if (d < bd){ bd = d; best = id; }
  }
  if (best < 0) return [];
  return [{ id: best, face: faceOfBay(best), manual: false, at: null }];
}
function entranceInfo(){ const l = entranceList(); return l.length ? l[0] : null; }

/* ---------- facade pickers ---------- */
function paintStyles(){
  $('styles').innerHTML = Object.entries(STYLES).map(([k,v])=>
    `<button data-k="${k}" class="${k===state.style?'on':''}">${v.label}</button>`).join('');
  $('styles').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    state.style=b.dataset.k;
    state.material = STYLE_MAT[state.style] || state.material;
    paintStyles(); paintMats();
    $('styleNote').textContent = STYLES[state.style].label;
    if (state.view==='render') buildRender(); else showView('render');
  });
  $('styleNote').textContent = STYLES[state.style].label;
}
function paintMats(){
  const clad = STYLES[state.style].clad;
  $('mats').innerHTML = Object.entries(MATERIALS).map(([k,v])=>
    `<button data-k="${k}" class="${k===state.material?'on':''}">
       <i style="background:#${v.c.toString(16).padStart(6,'0')}"></i>${v.label}</button>`).join('');
  $('mats').style.opacity = clad ? '' : '.5';
  $('mats').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    state.material=b.dataset.k; paintMats();
    if (state.view==='render') buildRender(); else showView('render');
  });
}

/* ---------- stacking plan ---------- */
function paintUsePicker(){
  $('usePick').innerHTML = USES.map(u=>
    `<button data-u="${u}" class="${u===state.paint?'on':''}">
       <i style="background:${USE_COL[u]}"></i>${USE_LABEL[u]}</button>`).join('');
  $('usePick').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    state.paint=b.dataset.u; paintUsePicker();
  });
}
function paintStack(){
  const n = (state.size||sizeNow()).storeys;
  const use = resolveStack(state.stack, n);
  state.stack = use.slice();
  $('stack').innerHTML = use.map((u,i)=>
    `<div class="lv" data-i="${i}" style="background:${USE_COL[u]}">
       <b>L${i+1}</b><span>${USE_LABEL[u]}</span></div>`).join('');
  const apply=i=>{ state.stack[i]=state.paint; paintStack(); invalidate(); };
  $('stack').querySelectorAll('.lv').forEach(el=>{
    el.onpointerdown=e=>{ e.preventDefault(); state.painting=true; apply(+el.dataset.i); };
    el.onpointerenter=()=>{ if(state.painting) apply(+el.dataset.i); };
  });
}
window.addEventListener('pointerup',()=>{ state.painting=false; });
const fmt = n => Math.round(n).toLocaleString();
