/* Voxel graph, program graph and the annealing solver
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

// Massing solver: voxel graph + program graph -> assignment
// Region growing (contiguity by construction) + simulated annealing over seeds.

// Service spaces stack vertically; leasable uses want the facade.
const CORE = new Set(['restroom', 'stairs', 'elevator', 'mech']);
const LEASABLE = new Set(['retail', 'apartment', 'studio', 'office', 'coworking',
  'restaurant', 'amenity', 'clinic', 'hotel', 'parking']);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Site geometry (feet) ----------
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
function ensureCCW(pts) { return polyArea(pts) < 0 ? pts.slice().reverse() : pts.slice(); }

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// inward unit normal per edge, assuming counter-clockwise winding
function edgeData(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    out.push({ a, b, len: L, nx: -dy / L, ny: dx / L });
  }
  return out;
}

// a point is buildable if it is inside the plot AND clear of every
// mandatory open space. `extra` adds the upper-storey daylight setback.
function distToSegment(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((x - a.x) * dx + (y - a.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

// A setback is a clear distance to that stretch of the plot boundary, measured
// to the segment rather than its infinite line -- otherwise a reflex corner on
// an L-shaped plot wipes out buildable area it has no business touching.
function buildable(x, y, pts, edges, setbacks, extra) {
  if (!pointInPoly(x, y, pts)) return false;
  for (let i = 0; i < edges.length; i++) {
    const need = (setbacks[i] || 0) + extra;
    if (need <= 0) continue;
    if (distToSegment(x, y, edges[i].a, edges[i].b) < need) return false;
  }
  return true;
}

// A structural bay is a real rectangle: every corner has to clear the plot line
// and the mandatory open space, or the slab overhangs into the setback.
function bayBuildable(x0, y0, w, d, pts, edges, setbacks, extra) {
  const eps = 0.02;
  const xs = [x0+eps, x0+w-eps], ys = [y0+eps, y0+d-eps];
  for (const x of xs) for (const y of ys)
    if (!buildable(x, y, pts, edges, setbacks, extra)) return false;
  return buildable(x0+w/2, y0+d/2, pts, edges, setbacks, extra);
}

// trace the buildable envelope for a storey, for drawing only
function envelopeOutline(pts, edges, setbacks, extra, step) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cells = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (buildable(x, y, pts, edges, setbacks, extra)) cells.push([x, y]);
    }
  }
  return cells;
}

// ---------- Voxel graph ----------
// Structural bays are laid over the plot bounding box; a bay becomes a voxel
// only where its centre clears the plot line and every bye-law setback.
const BAY_PATTERN = [1.00, 0.86, 1.14, 0.94, 1.08, 0.90];


function byStoryPre(voxels, s) {
  const out = [];
  for (const v of voxels) if (v.s === s && !v.dead) out.push(v.id);
  return out;
}
function killBays(voxels, index, dead) {
  if (!dead.size) return;
  for (const id of dead) index.delete(`${voxels[id].s},${voxels[id].ix},${voxels[id].iy}`);
  for (const v of voxels) {
    if (dead.has(v.id)) continue;
    v.nbrs = v.nbrs.filter(n => !dead.has(n));
    if (dead.has(v.above)) v.above = -1;
    if (dead.has(v.below)) v.below = -1;
  }
  for (const id of dead) { voxels[id].nbrs = []; voxels[id].dead = true; }
}
/* Cut the top storey back to the slack the allowance actually left.

   sizeBuilding takes whole storeys while they fit and then adds one more for
   whatever is left over -- a part storey. The voxel graph went on to build
   that last storey at full plate, so a scheme sized against a 1:4 limit came
   out at 1:4.05 and flagged itself as over the bye-law on first load. The
   overshoot is small, but it is the one compliance test the tool leads with,
   and a tool that reports its own output as illegal is not usable.

   The storey is cut back a whole edge line at a time -- the cheapest of its
   four outside columns and rows -- so what is left is still a rectangle. A
   first attempt took the loosest individual bays instead, which is tighter on
   area but leaves an L; the planner needs a clear rectangle, so the top floor
   came back with no corridor and no stair on it and failed its own means of
   escape check. Losing a few hundred sq ft of allowance is the cheaper
   mistake. If no amount of peeling gets the stack under the allowance, the
   storey should not be there at all and is dropped. */
function trimTopStorey(voxels, index, stories, allowed) {
  if (!(allowed > 0)) return;
  let total = 0;
  for (const v of voxels) if (!v.dead) total += v.area;
  if (total <= allowed + 1) return;

  const top = stories - 1;
  const dead = new Set();
  const liveNow = () => voxels.filter(v => v.s === top && !v.dead && !dead.has(v.id));

  while (total > allowed + 1) {
    const live = liveNow();
    if (!live.length) break;
    const cols = [...new Set(live.map(v => v.ix))].sort((a,b)=>a-b);
    const rows = [...new Set(live.map(v => v.iy))].sort((a,b)=>a-b);

    const lines = [];
    if (cols.length > 1) for (const ix of [cols[0], cols[cols.length-1]])
      lines.push(live.filter(v => v.ix === ix));
    if (rows.length > 1) for (const iy of [rows[0], rows[rows.length-1]])
      lines.push(live.filter(v => v.iy === iy));
    if (!lines.length) break;                 // down to a single bay

    // cheapest line first, so the storey gives up as little as the rule needs
    lines.sort((a,b) =>
      a.reduce((t,v)=>t+v.area,0) - b.reduce((t,v)=>t+v.area,0));
    for (const v of lines[0]) { dead.add(v.id); total -= v.area; }
  }

  if (total > allowed + 1) for (const v of liveNow()) { dead.add(v.id); total -= v.area; }
  killBays(voxels, index, dead);
}

// a detached fragment of plate cannot be part of one building
function dropIslands(voxels, index, stories) {
  const dead = new Set();
  for (let s = 0; s < stories; s++) {
    const bays = byStoryPre(voxels, s);
    if (bays.length < 2) continue;
    const left = new Set(bays), groups = [];
    while (left.size) {
      const first = left.values().next().value;
      const g = [first]; left.delete(first);
      const q = [first];
      while (q.length) {
        const c = q.pop();
        for (const n of voxels[c].nbrs) if (left.has(n)) { left.delete(n); g.push(n); q.push(n); }
      }
      groups.push(g);
    }
    if (groups.length < 2) continue;
    groups.sort((a,b)=> b.reduce((t,i)=>t+voxels[i].area,0) - a.reduce((t,i)=>t+voxels[i].area,0));
    for (let i = 1; i < groups.length; i++) for (const id of groups[i]) dead.add(id);
  }
  killBays(voxels, index, dead);
}
function stillLinked(voxels, on) {
  if (on.size <= 1) return true;
  const first = on.values().next().value;
  const seen = new Set([first]), q = [first];
  while (q.length) {
    const c = q.pop();
    for (const n of voxels[c].nbrs) if (on.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
  }
  return seen.size === on.size;
}

const D2R = Math.PI / 180;
function rotPt(p, ang, piv) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = p.x - piv.x, dy = p.y - piv.y;
  return { x: piv.x + dx*c - dy*s, y: piv.y + dx*s + dy*c };
}
function plotPivot(pts) {
  const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
  return { x:(Math.min(...xs)+Math.max(...xs))/2, y:(Math.min(...ys)+Math.max(...ys))/2 };
}

// The grid is laid out in a frame turned to the building's own angle, so every
// bay stays rectangular. Only the display turns back to true north.
function buildVoxelGraph(site, cfg) {
  const { stories, upperSetback, bay } = cfg;
  const ang = (cfg.gridAngle || 0) * D2R;
  const world = ensureCCW(site.pts);
  const pivot = plotPivot(world);
  const pts = ang ? world.map(p=>rotPt(p, -ang, pivot)) : world;
  const edges = edgeData(pts);
  const setbacks = site.setbacks;

  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const colW = [], rowD = [];
  let acc = 0, k = 0;
  while (acc < maxX - minX) { const w = bay * BAY_PATTERN[k++ % BAY_PATTERN.length]; colW.push(w); acc += w; }
  acc = 0; k = 3;
  while (acc < maxY - minY) { const d = bay * BAY_PATTERN[k++ % BAY_PATTERN.length]; rowD.push(d); acc += d; }
  if (!colW.length) colW.push(bay);
  if (!rowD.length) rowD.push(bay);

  const cx = [], cy = [];
  acc = minX; for (const w of colW) { cx.push(acc); acc += w; }
  acc = minY; for (const d of rowD) { cy.push(acc); acc += d; }

  const voxels = [], index = new Map();
  // how the plate shrinks as the building rises
  // must stay in step with the copy in plateAreas -- see the note there
  const insetAt = st => {
    const u = upperSetback || 0, base = cfg.plotInset || 0;
    switch (cfg.massing) {
      case 'extrude': return base;
      case 'step':    return base + Math.floor(st / 3) * u * 3;
      case 'crown':   return base + u * st * st / Math.max(1, stories - 1);
      default:        return base + u * st;
    }
  };
  for (let s = 0; s < stories; s++) {
    const extra = insetAt(s);
    for (let iy = 0; iy < rowD.length; iy++) {
      for (let ix = 0; ix < colW.length; ix++) {
        if (!bayBuildable(cx[ix], cy[iy], colW[ix], rowD[iy], pts, edges, setbacks, extra)) continue;
        const id = voxels.length;
        voxels.push({
          id, s, ix, iy, x: cx[ix], y: cy[iy], w: colW[ix], d: rowD[iy],
          area: colW[ix] * rowD[iy], nbrs: [], below: -1, above: -1,
        });
        index.set(`${s},${ix},${iy}`, id);
      }
    }
  }
  for (const v of voxels) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = index.get(`${v.s},${v.ix + dx},${v.iy + dy}`);
      if (j !== undefined) v.nbrs.push(j);
    }
    const b = index.get(`${v.s - 1},${v.ix},${v.iy}`); if (b !== undefined) v.below = b;
    const a = index.get(`${v.s + 1},${v.ix},${v.iy}`); if (a !== undefined) v.above = a;
  }
  dropIslands(voxels, index, stories);
  trimTopStorey(voxels, index, stories, cfg.allowed);

  // notched: take a corner off every other floor, which reads as a stack of
  // terraces rather than one extruded block
  if (cfg.massing === 'notch') {
    const dead = new Set();
    for (let s = 1; s < stories; s += 2) {
      const on = new Set(byStoryPre(voxels, s).filter(id => !dead.has(id)));
      if (on.size < 5) continue;
      const cand = [...on].sort((a, b) =>
        voxels[a].nbrs.filter(n => on.has(n)).length -
        voxels[b].nbrs.filter(n => on.has(n)).length);
      for (const id of cand) {
        on.delete(id);
        if (stillLinked(voxels, on)) { dead.add(id); break; }
        on.add(id);
      }
    }
    killBays(voxels, index, dead);
  }

  // The last storey rarely uses a whole plate. Rather than leave holes scattered
  // through the plan, shrink that plate from its most exposed corners until it
  // matches the floor area still allowed, keeping what remains in one piece.
  if (cfg.trimTop > 0 && stories > 0) {
    const topS = stories - 1;
    const on = new Set(byStoryPre(voxels, topS));
    const areaOf = id => voxels[id].area;
    let area = [...on].reduce((a,id)=>a+areaOf(id), 0);
    const nbrsIn = id => voxels[id].nbrs.filter(n=>on.has(n)).length;
    let guard = 0;
    while (area > cfg.trimTop && on.size > 1 && guard++ < 4000) {
      const cand = [...on].sort((a,b)=> nbrsIn(a)-nbrsIn(b) || areaOf(b)-areaOf(a));
      let cut = -1;
      for (const id of cand) {
        on.delete(id);
        if (stillLinked(voxels, on)) { cut = id; break; }
        on.add(id);
      }
      if (cut === -1) break;
      area -= areaOf(cut);
    }
    killBays(voxels, index, new Set(byStoryPre(voxels, topS).filter(id=>!on.has(id))));
  }

  // built last, once every bay that is not part of the building has gone
  const byStory = Array.from({ length: stories }, () => []);
  for (const v of voxels) if (!v.dead) byStory[v.s].push(v.id);

  const nodeX = cx.concat([cx[cx.length-1] + colW[colW.length-1]]);
  const nodeY = cy.concat([cy[cy.length-1] + rowD[rowD.length-1]]);

  return {
    voxels, byStory, index, pts, edges, setbacks,
    colW, rowD, cx, cy, nodeX, nodeY,
    angle: ang, pivot, world,
    minX, minY, maxX, maxY,
    totalW: maxX - minX, totalD: maxY - minY,
    siteArea: Math.abs(polyArea(pts)),
  };
}

// ---------- Sizing the building from the FAR ratio ----------
// Permissible covered area = plot area x ratio. Walk up storey by storey,
// accumulating each plate (which shrinks as the upper-storey setback bites),
// and stop at the storey that consumes the allowance or at the height cap.
function plateAreas(site, cfg, maxStoreys) {
  const ang = (cfg.gridAngle || 0) * D2R;
  const w0 = ensureCCW(site.pts);
  const piv = plotPivot(w0);
  const pts = ang ? w0.map(p=>rotPt(p, -ang, piv)) : w0;
  const edges = edgeData(pts), sb = site.setbacks;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const colW = [], rowD = [];
  let acc = 0, k = 0;
  while (acc < maxX - minX) { const w = cfg.bay * BAY_PATTERN[k++ % BAY_PATTERN.length]; colW.push(w); acc += w; }
  acc = 0; k = 3;
  while (acc < maxY - minY) { const d = cfg.bay * BAY_PATTERN[k++ % BAY_PATTERN.length]; rowD.push(d); acc += d; }
  const cx = [], cy = [];
  acc = minX; for (const w of colW) { cx.push(acc); acc += w; }
  acc = minY; for (const d of rowD) { cy.push(acc); acc += d; }

  const out = [];
  /* plotInset holds the footprint back from the setback line for every storey.
     It is a design choice, not a bye-law: holding it back shrinks the plate, so
     the same FAR allowance has to go up instead of out. That is how a scheme
     becomes a tower rather than a slab, and it is the lever the option schemes
     pull. Both inset functions have to agree or the storey count and the voxel
     graph are sized against different footprints. */
  const insetAt = st => {
    const u = cfg.upperSetback || 0, base = cfg.plotInset || 0;
    switch (cfg.massing) {
      case 'extrude': return base;
      case 'step':    return base + Math.floor(st / 3) * u * 3;
      case 'crown':   return base + u * st * st / Math.max(1, maxStoreys - 1);
      default:        return base + u * st;
    }
  };
  for (let s = 0; s < maxStoreys; s++) {
    const extra = insetAt(s);
    let a = 0;
    for (let iy = 0; iy < rowD.length; iy++) {
      for (let ix = 0; ix < colW.length; ix++) {
        if (bayBuildable(cx[ix], cy[iy], colW[ix], rowD[iy], pts, edges, sb, extra))
          a += colW[ix] * rowD[iy];
      }
    }
    out.push(a);
    if (a === 0) break;
  }
  return out;
}

// How many storeys it takes to use up the allowance, and what actually binds.
function sizeBuilding(site, cfg) {
  const plotArea = Math.abs(polyArea(site.pts));
  const allowed = plotArea * cfg.farRatio;
  const capByHeight = Math.max(1, Math.floor(cfg.heightLimit / cfg.floorH));
  const plates = plateAreas(site, cfg, capByHeight);
  // take whole plates while they fit, then one part storey for what is left
  let cum = 0, storeys = 0;
  for (let i = 0; i < plates.length; i++) {
    if (plates[i] <= 0) break;
    if (cum + plates[i] > allowed) break;
    cum += plates[i]; storeys = i + 1;
  }
  let trimTop = 0;
  const bayArea = cfg.bay * cfg.bay;
  const spare = allowed - cum;
  if (storeys < plates.length && plates[storeys] > 0 && spare >= bayArea) {
    trimTop = spare; cum += spare; storeys += 1;
  }
  storeys = Math.max(1, storeys);
  return {
    allowed, plotArea, storeys, trimTop,
    capacity: cum, built: Math.min(cum, allowed),
    bind: cum >= allowed - bayArea ? 'far' : (storeys >= capByHeight ? 'height' : 'plot'),
    capByHeight, height: storeys * cfg.floorH,
  };
}

// ---------- Stacking plan ----------
// One use per level, painted by the user. Short lists extend upward with
// whatever the top painted level holds.
function resolveStack(stack, storeys) {
  const out = new Array(storeys);
  const last = stack.length ? stack[stack.length - 1] : 'apartment';
  for (let s = 0; s < storeys; s++) out[s] = stack[s] || last;
  return out;
}

// ---------- Program graph ----------
// Built from a unit mix the user types in: each entry says what the unit is,
// how big one is in square feet, how many per floor, and which floors it runs on.
// The corridor is laid first, as one connected run sized to the share the user
// asks for. Every other room is then seeded on a bay that touches it and grows
// outward from there, so each room reaches circulation through its own seed --
// the guarantee comes from how rooms start, not from paving half the floor.
function corridorSpine(vg, s, banned, targetArea) {
  const cells = (vg.byStory[s] || []).filter(id => !vg.voxels[id].dead);
  // on a plate this small a corridor would be a third of the floor, and the
  // stair opens straight onto the rooms anyway
  if (cells.length < 5) return [];
  const pool = cells.filter(id => !banned.has(id));
  if (!pool.length) return [];
  const corr = new Set();
  let area = 0;
  // frontage is what matters: the corridor should touch as many bays as it can
  // for as little floor as possible
  const frontGain = id => {
    let g = 0;
    for (const q of vg.voxels[id].nbrs)
      if (!corr.has(q) && !vg.voxels[q].nbrs.some(z => corr.has(z))) g++;
    return g / Math.max(1, vg.voxels[id].area);
  };
  let seed = pool[0];
  const deg = id => vg.voxels[id].nbrs.length / Math.max(1, vg.voxels[id].area);
  for (const id of pool) if (deg(id) > deg(seed)) seed = id;
  corr.add(seed); area += vg.voxels[seed].area;
  let guard = 0;
  while (area < targetArea && guard++ < 400) {
    const next = pool.filter(id => !corr.has(id) && vg.voxels[id].nbrs.some(q => corr.has(q)));
    if (!next.length) break;
    let best = -1, bk = -1;
    for (const id of next) { const g = frontGain(id); if (g > bk) { bk = g; best = id; } }
    if (best === -1) break;
    if (area + vg.voxels[best].area > targetArea) break;
    corr.add(best); area += vg.voxels[best].area;
  }
  return [...corr];
}

// push the corridor along until it reaches the lift shaft
function reachShaft(vg, s, corr, shaftCells, banned) {
  const set = new Set(corr);
  if (!set.size) return corr;
  const cells = new Set(vg.byStory[s] || []);
  const wanted = [...shaftCells].filter(id => cells.has(id));
  if (!wanted.length) return corr;
  if (wanted.some(id => vg.voxels[id].nbrs.some(q => set.has(q)))) return corr;
  const prev = new Map(), seen = new Set(set);
  let q = [...set], hit = -1;
  while (q.length && hit < 0) {
    const nx = [];
    for (const c of q) {
      for (const n of vg.voxels[c].nbrs) {
        if (seen.has(n) || !cells.has(n)) continue;
        seen.add(n); prev.set(n, c);
        if (wanted.some(w => vg.voxels[w].nbrs.includes(n))) { hit = n; break; }
        if (banned.has(n)) continue;
        nx.push(n);
      }
      if (hit >= 0) break;
    }
    q = nx;
  }
  if (hit < 0) return corr;
  let cur = hit;
  while (cur !== undefined && !set.has(cur)) { set.add(cur); cur = prev.get(cur); }
  return [...set];
}

// One column of bays present on every storey, interior if possible, and never
// one whose removal would split a floor plate in two.
function pickShaft(vg, cfg, stories) {
  const core = cfg.core || {};
  const topCells = (vg.byStory[stories-1] && vg.byStory[stories-1].length)
    ? vg.byStory[stories-1] : (vg.byStory[0] || []);
  const common = [];
  for (const id of topCells) {
    const t = vg.voxels[id];
    let all = true;
    for (let s = 0; s < stories; s++) {
      if (!vg.byStory[s].length) continue;
      if (vg.index.get(`${s},${t.ix},${t.iy}`) === undefined) { all = false; break; }
    }
    if (all) common.push(t);
  }
  if (!common.length) return [];
  let mx = 0, my = 0;
  for (const t of common) { mx += t.x + t.w/2; my += t.y + t.d/2; }
  mx /= common.length; my /= common.length;
  common.sort((a,b)=>{
    const inA = (a.nbrs.length===4) ? 0 : 1, inB = (b.nbrs.length===4) ? 0 : 1;
    if (inA !== inB) return inA - inB;
    return Math.hypot(a.x+a.w/2-mx, a.y+a.d/2-my) - Math.hypot(b.x+b.w/2-mx, b.y+b.d/2-my);
  });
  const platesWhole = t => {
    for (let s2 = 0; s2 < stories; s2++) {
      const cells = vg.byStory[s2];
      if (!cells || cells.length < 3) continue;
      const gone = vg.index.get(`${s2},${t.ix},${t.iy}`);
      const left = new Set(cells.filter(i => i !== gone));
      if (!left.size) continue;
      const first = left.values().next().value;
      const seen = new Set([first]), q = [first];
      while (q.length) {
        const c = q.pop();
        for (const n of vg.voxels[c].nbrs) if (left.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
      }
      if (seen.size !== left.size) return false;
    }
    return true;
  };
  const safe = common.filter(platesWhole);
  const pool = safe.length ? safe : common;
  const bays = Math.max(1, Math.min(4, Math.round((core.lifts || 0) / pool[0].area)));
  const shaft = [pool[0]];
  for (let i = 1; i < pool.length && shaft.length < bays; i++)
    if (pool[i].nbrs.includes(shaft[shaft.length-1].id)) shaft.push(pool[i]);
  return shaft.map(t => ({ ix: t.ix, iy: t.iy, area: t.area }));
}

function buildProgramGraph(vg, cfg) {
  const { stories, mix, core, stack, allowed } = cfg;
  const floorUse = resolveStack(stack || [], stories);
  const rooms = [], edges = [], byStory = Array.from({ length: stories }, () => []);
  const dropped = [], scaled = [];

  const envelopeArea = vg.voxels.reduce((a, v) => a + v.area, 0);
  const budget = Math.min(envelopeArea, allowed);

  // the shaft is settled first: one column of bays present on every storey,
  // never one whose removal would split a floor in two
  const shaft = pickShaft(vg, cfg, stories);
  const shaftCells = new Set();
  for (let s = 0; s < stories; s++)
    for (const t of shaft) {
      const id = vg.index.get(`${s},${t.ix},${t.iy}`);
      if (id !== undefined) shaftCells.add(id);
    }

  // Then the corridor skeleton on each floor. If a bay can only be reached
  // through the lift shaft it can never be served, so it is not floor area at
  // all -- drop it from the plate and lay the skeleton again.
  const skeleton = [], seedPool = [];
  const pct = Math.min(20, Math.max(8, core.corridorPct || 16));
  for (let round = 0; round < 4; round++) {
    const doomed = new Set();
    for (let s = 0; s < stories; s++) {
      const cells = vg.byStory[s] || [];
      const plateArea = cells.reduce((t, i) => t + vg.voxels[i].area, 0);
      skeleton[s] = corridorSpine(vg, s, shaftCells, plateArea * pct / 100);
      skeleton[s] = reachShaft(vg, s, skeleton[s], shaftCells, shaftCells);
      const set = new Set(skeleton[s]);
      if (!set.size) {
        seedPool[s] = cells.filter(id => !shaftCells.has(id));
        for (const id of cells)
          if (!shaftCells.has(id) && vg.voxels[id].nbrs.length &&
              vg.voxels[id].nbrs.every(q => shaftCells.has(q)))
            doomed.add(id);
        continue;
      }
      // a bay is usable if a room can grow to it from the corridor without
      // passing through the shaft
      const ok = new Set(set);
      const q = [...set];
      while (q.length) {
        const c = q.pop();
        for (const n of vg.voxels[c].nbrs) {
          if (ok.has(n) || shaftCells.has(n)) continue;
          ok.add(n); q.push(n);
        }
      }
      for (const id of cells) if (!ok.has(id) && !shaftCells.has(id)) doomed.add(id);
      seedPool[s] = set.size
        ? cells.filter(id => !set.has(id) && !shaftCells.has(id) &&
            vg.voxels[id].nbrs.some(q2 => set.has(q2)))
        : cells.filter(id => !shaftCells.has(id));
    }
    if (!doomed.size) break;
    killBays(vg.voxels, vg.index, doomed);
    for (let s = 0; s < stories; s++)
      vg.byStory[s] = (vg.byStory[s] || []).filter(id => !vg.voxels[id].dead);
  }

  for (let s = 0; s < stories; s++) {
    const cells = vg.byStory[s];
    const capacityCount = cells.length;
    if (!capacityCount) continue;
    const floorArea = cells.reduce((a, i) => a + vg.voxels[i].area, 0);
    const floorBudget = floorArea;   // the plate is already the allowance

    // what this floor would like to contain, in priority order
    const skel = skeleton[s] || [];
    const corrArea = skel.reduce((a, i) => a + vg.voxels[i].area, 0);
    const wish = [];
    const nStair = Math.max(1, core.stairCount || 1);
    for (let k = 0; k < nStair; k++)
      wish.push({ type:'stairs', name: nStair>1 ? `Stair ${k+1}` : 'Stairs',
                  want: core.stairEach, stairIx: k });
    wish.push({ type:'elevator',
                name: (core.liftCount||1) > 1 ? `Lifts \u00d7${core.liftCount}` : 'Lift',
                want: core.lifts });
    wish.push(
      { type: 'restroom', name: 'Restrooms',   want: core.restrooms });
    if (s === 0) wish.push({ type: 'mech', name: 'Services', want: core.services });
    const use = floorUse[s];
    const here = mix.filter(m => m.use === use && m.perFloor > 0);
    if (!here.length) {
      // a level with no matching unit type still needs something leasable on it
      wish.push({ type: use, name: 'Open ' + use, want: floorBudget, unit: true, mixId: 'open-' + use });
    } else {
      // perFloor is the ratio between types; units are then laid in repeating
      // cycles until the plate is used up, so the FAR allowance is consumed
      // rather than left on the table.
      const cycle = [];
      for (const m of here) for (let k = 0; k < m.perFloor; k++) cycle.push(m);
      let left = floorBudget - corrArea - wish.reduce((a, w) => a + w.want, 0);
      let i = 0, guard = 0;
      while (guard++ < 400 && wish.length < capacityCount) {
        const m = cycle[i % cycle.length];
        if (left < m.unitArea) break;
        wish.push({ type: m.use, name: m.name, want: m.unitArea, mixId: m.id, unit: true });
        left -= m.unitArea; i++;
      }
      // always give every named type at least one unit on its own floors
      for (const m of here) {
        if (wish.some(w => w.mixId === m.id)) continue;
        if (wish.length < capacityCount) {
          wish.push({ type: m.use, name: m.name, want: m.unitArea, mixId: m.id, unit: true });
        }
      }
    }

    // a room needs at least one bay, so the floor's bay count caps the programme
    const room4corr = skel.length ? 1 : 0;
    const keep = wish.slice(0, Math.max(1, Math.min(wish.length,
      Math.max(1, capacityCount - room4corr))));
    if (keep.length < wish.length) {
      dropped.push({ story: s + 1, removed: wish.length - keep.length });
    }

    // fit the wish list to what the floor plate can actually hold
    const want = keep.reduce((a, w) => a + w.want, 0);
    const spare = Math.max(1, floorBudget - corrArea);
    const fit = want > 0 ? Math.min(1, spare / want) : 1;
    if (fit < 0.995) scaled.push({ story: s + 1, fit });

    const made = [];
    // the corridor room first, holding exactly the skeleton
    let corridor = null;
    if (skel.length) {
      corridor = { id: rooms.length, type:'corridor', name:'Circulation', s,
        target: corrArea, want: corrArea, mixId: null, unit: false, skeleton: skel.slice() };
      rooms.push(corridor); made.push(corridor); byStory[s].push(corridor.id);
    }
    for (const w of keep) {
      const r = {
        id: rooms.length, type: w.type, name: w.name, s,
        target: w.want * fit, want: w.want, mixId: w.mixId || null, unit: !!w.unit,
        stairIx: w.stairIx,
      };
      rooms.push(r); made.push(r); byStory[s].push(r.id);
    }
    if (!corridor) corridor = made[0];
    for (const r of made) if (r.id !== corridor.id) edges.push([corridor.id, r.id]);
  }

  // ---- the lift room takes the shaft chosen above, and is locked to it ----
  const lockedVoxels = new Set(), pinOf = new Map();
  if (shaft.length) {
    const shaftArea = shaft.reduce((a,t)=>a+t.area,0);
    for (let s = 0; s < stories; s++) {
      const lift = (byStory[s]||[]).map(i=>rooms[i]).find(r=>r.type==='elevator');
      if (!lift) continue;
      lift.fixed = true; lift.target = shaftArea;
      for (const t of shaft) {
        const id = vg.index.get(`${s},${t.ix},${t.iy}`);
        if (id === undefined) continue;
        lockedVoxels.add(id); pinOf.set(id, lift.id);
      }
    }
  }

  // stairs and lifts chain floor to floor
  for (let s = 0; s + 1 < stories; s++) {
    if (!byStory[s].length || !byStory[s + 1].length) continue;
    const below = byStory[s].map(i => rooms[i]);
    const above = byStory[s + 1].map(i => rooms[i]);
    const lo = below.filter(r => r.type === 'stairs');
    const hi = above.filter(r => r.type === 'stairs');
    for (let k = 0; k < Math.min(lo.length, hi.length); k++) edges.push([lo[k].id, hi[k].id]);
    const la = below.find(r => r.type === 'elevator');
    const lb = above.find(r => r.type === 'elevator');
    if (la && lb) edges.push([la.id, lb.id]);
  }
  return { rooms, edges, byStory, dropped, scaled, budget, envelopeArea, floorUse,
    lockedVoxels, pinOf, seedPool };
}

// ---------- Region growing ----------
function requiredNbrs(pg) {
  const req = pg.rooms.map(() => []);
  for (const [a, b] of pg.edges) { req[a].push(b); req[b].push(a); }
  return req;
}

function touchingSet(vg, assign, rid) {
  const t = new Set();
  for (const v of vg.voxels) {
    if (assign[v.id] !== rid) continue;
    for (const n of v.nbrs) if (assign[n] !== -1 && assign[n] !== rid) t.add(assign[n]);
    if (v.above !== -1 && assign[v.above] !== -1 && assign[v.above] !== rid) t.add(assign[v.above]);
    if (v.below !== -1 && assign[v.below] !== -1 && assign[v.below] !== rid) t.add(assign[v.below]);
  }
  return t;
}

// does room rid stay connected if voxel `drop` leaves it?
function staysConnected(vg, assign, rid, drop) {
  const cells = [];
  for (const v of vg.voxels) if (assign[v.id] === rid && v.id !== drop) cells.push(v.id);
  if (cells.length <= 1) return cells.length === 1;
  const want = new Set(cells);
  const seen = new Set([cells[0]]);
  const st = [cells[0]];
  while (st.length) {
    const c = st.pop();
    for (const n of vg.voxels[c].nbrs) {
      if (want.has(n) && !seen.has(n)) { seen.add(n); st.push(n); }
    }
  }
  return seen.size === want.size;
}

// Every room starts on a bay that touches the corridor and grows outward from
// there, one bay at a time, until the floor is used up. A room therefore always
// contains its own frontage bay, so it always opens onto circulation, and no
// bay is ever left over. Nothing afterwards is allowed to take those away.
function grow(vg, pg, seeds, order, req) {
  const { voxels } = vg;
  const assign = new Int32Array(voxels.length).fill(-1);
  const areaOf = new Float64Array(pg.rooms.length);
  const seq = [];
  req = req || requiredNbrs(pg);

  // 1. circulation
  for (const r of pg.rooms) {
    if (!r.skeleton) continue;
    for (const id of r.skeleton) {
      if (assign[id] !== -1) continue;
      assign[id] = r.id; areaOf[r.id] += voxels[id].area; seq.push(id);
    }
  }
  // 2. the lift shaft
  if (pg.pinOf) for (const [vid, rid] of pg.pinOf) {
    if (assign[vid] !== -1) continue;
    assign[vid] = rid; areaOf[rid] += voxels[vid].area; seq.push(vid);
  }
  // 3. one frontage bay per room, as its root
  const roots = new Int32Array(pg.rooms.length).fill(-1);
  for (let s = 0; s < pg.byStory.length; s++) {
    const free = (pg.seedPool && pg.seedPool[s] ? pg.seedPool[s] : [])
      .filter(id => assign[id] === -1);
    const taken = new Set();
    const list = (pg.byStory[s] || []).map(i => pg.rooms[i])
      .filter(r => !r.skeleton && !r.fixed);
    // honour the annealer's choice where it is a free frontage bay
    for (const r of list) {
      const want = seeds[r.id];
      if (want !== undefined && want !== -1 && free.includes(want) && !taken.has(want)) {
        roots[r.id] = want; taken.add(want);
      }
    }
    let k = 0;
    for (const r of list) {
      if (roots[r.id] !== -1) continue;
      while (k < free.length && taken.has(free[k])) k++;
      if (k >= free.length) break;
      roots[r.id] = free[k]; taken.add(free[k]); k++;
    }
    for (const r of list) {
      const id = roots[r.id];
      if (id === -1 || assign[id] !== -1) continue;
      assign[id] = r.id; areaOf[r.id] += voxels[id].area; seq.push(id);
    }
  }
  // 4. share out what is left, the hungriest room first
  const live = pg.rooms.filter(r => !r.skeleton && !r.fixed && roots[r.id] !== -1);
  const front = new Map();                       // room -> free bays it can reach
  for (const r of live) {
    const f = new Set();
    for (const n of voxels[roots[r.id]].nbrs) if (assign[n] === -1) f.add(n);
    front.set(r.id, f);
  }
  const score = (r, n) => {
    let touch = 0;
    for (const m of voxels[n].nbrs) if (assign[m] === r.id) touch++;
    const edge = 4 - voxels[n].nbrs.length;
    let sc = touch * 3;
    if (LEASABLE.has(r.type)) sc += edge * 1.6;
    else if (CORE.has(r.type)) sc -= edge * 2.0;
    return sc;
  };
  let guard = 0;
  while (guard++ < 40000) {
    let pick = null, pk = -Infinity;
    for (const r of live) {
      const f = front.get(r.id);
      if (!f || !f.size) continue;
      const hunger = (r.target - areaOf[r.id]) / Math.max(1, r.target);
      if (hunger > pk) { pk = hunger; pick = r; }
    }
    if (!pick) break;
    const f = front.get(pick.id);
    let best = -1, bs = -Infinity;
    for (const n of f) { const sc = score(pick, n); if (sc > bs) { bs = sc; best = n; } }
    if (best === -1) { f.clear(); continue; }
    assign[best] = pick.id; areaOf[pick.id] += voxels[best].area; seq.push(best);
    for (const [, set] of front) set.delete(best);
    for (const n of voxels[best].nbrs) if (assign[n] === -1) f.add(n);
  }
  return { assign, areaOf, seq };
}

// ---------- Repair: guarantee coverage, then chase missing adjacencies ----------
function repair(vg, pg, state, req) {
  const { assign, areaOf } = state;
  const LK = pg.lockedVoxels || new Set();
  req = req || requiredNbrs(pg);
  const { voxels } = vg;
  let coverageFixes = 0, edgeFixes = 0;

  // 1. every room must own at least one voxel
  for (const r of pg.rooms) {
    if (areaOf[r.id] > 0 || r.fixed) continue;
    const cells = vg.byStory[r.s] || [];
    let take = cells.find(c => assign[c] === -1);
    if (take === undefined) {
      // borrow from the biggest room on this floor that can spare a non-cut cell
      const cand = cells
        .filter(c => assign[c] !== -1)
        .sort((a, b) => areaOf[assign[b]] - areaOf[assign[a]]);
      for (const c of cand) {
        if (LK.has(c) || lastLink(vg, pg, assign, c)) continue;
        const owner = assign[c];
        if (pg.rooms[owner].skeleton) continue;
        if (areaOf[owner] <= voxels[c].area) continue;
        if (!staysConnected(vg, assign, owner, c)) continue;
        areaOf[owner] -= voxels[c].area; take = c; break;
      }
    }
    if (take === undefined) continue;
    assign[take] = r.id;
    areaOf[r.id] += voxels[take].area;
    coverageFixes++;
  }

  // 2. chase unrealised edges by flipping ONE voxel, staying on the correct story
  const tryLink = (a, b) => {
    // a lift shaft is a fixed column of bays; it never takes on more
    if (pg.rooms[a].fixed || pg.rooms[a].skeleton) return false;
    // a room that has already overrun its brief should not keep absorbing bays
    // just because every adjacency in the graph happens to route through it
    if (areaOf[a] > pg.rooms[a].target * 1.35) return false;
    const sa = pg.rooms[a].s;
    const cells = vg.byStory[sa] || [];
    // candidate must sit on room a's story, touch a's region in-plan (so a stays
    // connected), and touch b either in-plan or through the floor slab
    const viable = [];
    for (const c of cells) {
      if (assign[c] === a || LK.has(c)) continue;
      if (assign[c] !== -1 && pg.rooms[assign[c]].skeleton) continue;
      if (lastLink(vg, pg, assign, c)) continue;
      const v = voxels[c];
      let touchesA = false;
      for (const n of v.nbrs) if (assign[n] === a) touchesA = true;
      if (!touchesA) continue;
      let touchesB = false;
      for (const n of v.nbrs) if (assign[n] === b) touchesB = true;
      for (const k of [v.above, v.below]) if (k !== -1 && assign[k] === b) touchesB = true;
      if (!touchesB) continue;
      viable.push(c);
    }
    // prefer an unassigned cell; otherwise borrow from a room that can spare it
    for (const c of viable) {
      if (assign[c] !== -1) continue;
      assign[c] = a; areaOf[a] += voxels[c].area; return true;
    }
    for (const c of viable) {
      const owner = assign[c];
      if (owner === -1 || owner === b) continue;
      if (areaOf[owner] <= voxels[c].area) continue;
      if (!staysConnected(vg, assign, owner, c)) continue;
      areaOf[owner] -= voxels[c].area;
      assign[c] = a; areaOf[a] += voxels[c].area; return true;
    }
    return false;
  };

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const [a, b] of pg.edges) {
      if (touchingSet(vg, assign, a).has(b)) continue;
      // let whichever room is further below its target take the bay
      const [p1, p2] = (areaOf[a] - pg.rooms[a].target) <= (areaOf[b] - pg.rooms[b].target)
        ? [a, b] : [b, a];
      if (tryLink(p1, p2) || tryLink(p2, p1)) { edgeFixes++; changed = true; }
    }
    if (!changed) break;
  }
  return { assign, areaOf, coverageFixes, edgeFixes };
}

// ---------- Scoring ----------
function evaluate(vg, pg, state) {
  const { assign, areaOf } = state;
  const { voxels } = vg;

  // coverage
  let covered = 0;
  for (const r of pg.rooms) if (areaOf[r.id] > 0) covered++;
  const coverage = covered / pg.rooms.length;

  // adjacency realisation
  const adjSet = new Set();
  for (const v of voxels) {
    const a = assign[v.id]; if (a === -1) continue;
    for (const n of v.nbrs) {
      const b = assign[n];
      if (b !== -1 && b !== a) adjSet.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
    const up = v.above;
    if (up !== -1) {
      const b = assign[up];
      if (b !== -1 && b !== a) adjSet.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }
  let realized = 0;
  for (const [a, b] of pg.edges) {
    if (adjSet.has(a < b ? `${a}|${b}` : `${b}|${a}`)) realized++;
  }
  const edgeAcc = pg.edges.length ? realized / pg.edges.length : 1;

  // area fidelity
  let err = 0, tot = 0;
  for (const r of pg.rooms) { err += Math.abs(areaOf[r.id] - r.target); tot += r.target; }
  const areaFit = tot ? Math.max(0, 1 - err / tot) : 1;

  // vertical core alignment
  let coreN = 0, coreOK = 0;
  for (const v of voxels) {
    const a = assign[v.id]; if (a === -1) continue;
    const r = pg.rooms[a]; if (!CORE.has(r.type) || v.s === 0) continue;
    coreN++;
    const bel = v.below;
    if (bel !== -1 && assign[bel] !== -1 && pg.rooms[assign[bel]].type === r.type) coreOK++;
  }
  const coreAlign = coreN ? coreOK / coreN : 1;

  // compactness: exposed in-floor perimeter per room, normalised
  let per = 0, cells = 0;
  for (const v of voxels) {
    const a = assign[v.id]; if (a === -1) continue;
    cells++;
    for (const n of v.nbrs) if (assign[n] !== a) per++;
    per += 4 - v.nbrs.length;
  }
  const compact = cells ? Math.max(0, 1 - (per / cells) / 4) : 0;

  let offN = 0, offLit = 0;
  for (const v of voxels) {
    const a = assign[v.id]; if (a === -1) continue;
    if (!LEASABLE.has(pg.rooms[a].type)) continue;
    offN++; if (v.nbrs.length < 4) offLit++;
  }
  const daylight = offN ? offLit / offN : 1;
  const score = 2.2 * edgeAcc + 1.4 * areaFit + 2.4 * coreAlign
    + 2.6 * compact + 2.0 * coverage + 1.2 * daylight;
  return { score, coverage, edgeAcc, areaFit, coreAlign, compact, daylight, realized, edges: pg.edges.length };
}

// contiguity audit — should always be 1 room = 1 component
function contiguity(vg, pg, assign) {
  const seen = new Uint8Array(vg.voxels.length);
  const comps = new Int32Array(pg.rooms.length);
  for (const v of vg.voxels) {
    const a = assign[v.id];
    if (a === -1 || seen[v.id]) continue;
    comps[a]++;
    const st = [v.id]; seen[v.id] = 1;
    while (st.length) {
      const c = st.pop();
      for (const n of vg.voxels[c].nbrs) {
        if (!seen[n] && assign[n] === a) { seen[n] = 1; st.push(n); }
      }
    }
  }
  let ok = 0, total = 0;
  for (const r of pg.rooms) { if (comps[r.id] > 0) { total++; if (comps[r.id] === 1) ok++; } }
  return total ? ok / total : 1;
}

// ---------- Every space must open onto circulation ----------
// A unit you can only reach through another unit is not a unit. Carve the
// corridor through to anything it cannot see, then repair whatever that split.
function roomBays(vg, assign, s, rid) {
  const out = [];
  for (const id of (vg.byStory[s] || [])) if (assign[id] === rid) out.push(id);
  return out;
}
function componentsOf(vg, assign, s, rid) {
  const mine = new Set(roomBays(vg, assign, s, rid));
  const groups = [];
  while (mine.size) {
    const first = mine.values().next().value;
    const g = [first]; mine.delete(first);
    const q = [first];
    while (q.length) {
      const c = q.pop();
      for (const n of vg.voxels[c].nbrs) if (mine.has(n)) { mine.delete(n); g.push(n); q.push(n); }
    }
    groups.push(g);
  }
  return groups;
}
// any room left in pieces gives its offcuts to a neighbour
function healFragments(vg, pg, state) {
  const { assign, areaOf } = state;
  const LK = pg.lockedVoxels || new Set();
  for (let s = 0; s < pg.byStory.length; s++) {
    for (const rid of (pg.byStory[s] || [])) {
      if (pg.rooms[rid].fixed) continue;
      const groups = componentsOf(vg, assign, s, rid);
      if (groups.length < 2) continue;
      const onCorr = g => g.some(b => vg.voxels[b].nbrs.some(n =>
        assign[n] !== -1 && pg.rooms[assign[n]] && pg.rooms[assign[n]].skeleton)) ? 1 : 0;
      groups.sort((a, b) => onCorr(b) - onCorr(a)
        || b.reduce((t,i)=>t+vg.voxels[i].area,0) - a.reduce((t,i)=>t+vg.voxels[i].area,0));
      for (let g = 1; g < groups.length; g++) {
        for (const id of groups[g]) {
          if (LK.has(id)) continue;
          const share = new Map();
          for (const n of vg.voxels[id].nbrs) {
            const o = assign[n];
            if (o === -1 || o === rid || pg.rooms[o].fixed) continue;
            share.set(o, (share.get(o) || 0) + 1);
          }
          if (!share.size) continue;
          let best = -1, bk = -1;
          for (const [o, t] of share) if (t > bk) { bk = t; best = o; }
          areaOf[rid] -= vg.voxels[id].area;
          assign[id] = best;
          areaOf[best] += vg.voxels[id].area;
        }
      }
    }
  }
  return state;
}
function ensureAccess(vg, pg, state) {
  const { assign, areaOf } = state;
  const LK = pg.lockedVoxels || new Set();
  let carved = 0;
  for (let s = 0; s < pg.byStory.length; s++) {
    const ids = pg.byStory[s] || [];
    const corr = ids.map(i => pg.rooms[i]).find(r => r.type === 'corridor');
    if (!corr) continue;
    const skip = new Set();
    for (let iter = 0; iter < 200; iter++) {
      const corrBays = roomBays(vg, assign, s, corr.id);
      if (!corrBays.length) break;
      const touch = new Set();
      for (const b of corrBays)
        for (const n of vg.voxels[b].nbrs) if (assign[n] !== -1) touch.add(assign[n]);
      let need = -1;
      for (const rid of ids) {
        if (rid === corr.id || touch.has(rid) || skip.has(rid)) continue;
        if (roomBays(vg, assign, s, rid).length) { need = rid; break; }
      }
      if (need === -1) break;
      // shortest route the corridor could take, never through the lift
      const prev = new Map(), seen = new Set(corrBays);
      let q = corrBays.slice(), hit = -1;
      while (q.length && hit < 0) {
        const next = [];
        for (const c of q) {
          for (const n of vg.voxels[c].nbrs) {
            if (seen.has(n) || assign[n] === -1) continue;
            seen.add(n); prev.set(n, c);
            if (assign[n] === need) { hit = n; break; }
            if (LK.has(n) || pg.rooms[assign[n]].fixed) continue;
            next.push(n);
          }
          if (hit >= 0) break;
        }
        q = next;
      }
      let did = false;
      if (hit >= 0) {
        const path = [];
        let cur = prev.get(hit);
        while (cur !== undefined && assign[cur] !== corr.id) { path.push(cur); cur = prev.get(cur); }
        for (const b of path) {
          const owner = assign[b];
          if (LK.has(b) || pg.rooms[owner].fixed) continue;
          areaOf[owner] -= vg.voxels[b].area;
          assign[b] = corr.id;
          areaOf[corr.id] += vg.voxels[b].area;
          carved++; did = true;
        }
      }
      if (did) continue;
      // the corridor cannot get there, so the space cannot stand alone: fold it
      // into a neighbour, preferring one that already opens onto circulation
      const mine = roomBays(vg, assign, s, need);
      const near = new Map(), far = new Map();
      for (const bb of mine)
        for (const n of vg.voxels[bb].nbrs) {
          const o = assign[n];
          if (o === -1 || o === need || pg.rooms[o].fixed) continue;
          const m = (o === corr.id || touch.has(o)) ? near : far;
          m.set(o, (m.get(o) || 0) + 1);
        }
      const pick = m => { let b = -1, k = -1; for (const [o,t] of m) if (t > k) { k = t; b = o; } return b; };
      const into = near.size ? pick(near) : pick(far);
      if (into === -1) { skip.add(need); continue; }
      for (const bb of mine) {
        areaOf[need] -= vg.voxels[bb].area;
        assign[bb] = into;
        areaOf[into] += vg.voxels[bb].area;
      }
      carved++;
    }
  }
  healFragments(vg, pg, state);
  return { assign, areaOf, carved };
}
// how many spaces actually open onto circulation
function accessScore(vg, pg, assign) {
  let need = 0, ok = 0;
  for (let s = 0; s < pg.byStory.length; s++) {
    const ids = pg.byStory[s] || [];
    const corr = ids.map(i => pg.rooms[i]).find(r => r.type === 'corridor');
    if (!corr) continue;
    const touch = new Set();
    for (const b of roomBays(vg, assign, s, corr.id))
      for (const n of vg.voxels[b].nbrs) if (assign[n] !== -1) touch.add(assign[n]);
    for (const rid of ids) {
      if (rid === corr.id) continue;
      if (!roomBays(vg, assign, s, rid).length) continue;
      need++; if (touch.has(rid)) ok++;
    }
  }
  return need ? ok / need : 1;
}

// Would handing this bay over cut its room off from the corridor?
function lastLink(vg, pg, assign, id) {
  const rid = assign[id];
  if (rid === -1 || !pg.rooms[rid]) return false;
  const onCorr = b => vg.voxels[b].nbrs.some(n =>
    assign[n] !== -1 && pg.rooms[assign[n]] && pg.rooms[assign[n]].skeleton);
  if (!onCorr(id)) return false;
  for (const b of (vg.byStory[pg.rooms[rid].s] || []))
    if (b !== id && assign[b] === rid && onCorr(b)) return false;
  return true;
}

// ---------- Leave nothing empty ----------
// Growth stops each space at its brief, which can leave odd bays over. Hand
// every one of them to the adjoining space that is furthest below target,
// preferring whichever it already shares the most wall with.
function fillRemainder(vg, pg, state) {
  const { assign, areaOf } = state;
  const LK = pg.lockedVoxels || new Set();
  let placed = 0;
  for (let pass = 0; pass < 60; pass++) {
    const open = [];
    for (const v of vg.voxels) if (!v.dead && assign[v.id] === -1) open.push(v.id);
    if (!open.length) break;
    let moved = false;
    for (const id of open) {
      const share = new Map(), fallback = new Map();
      for (const n of vg.voxels[id].nbrs) {
        const r = assign[n];
        if (r === -1 || pg.rooms[r].fixed) continue;
        if (pg.rooms[r].skeleton) { fallback.set(r, (fallback.get(r) || 0) + 1); continue; }
        share.set(r, (share.get(r) || 0) + 1);
      }
      if (!share.size && fallback.size) for (const [k, v] of fallback) share.set(k, v);
      if (!share.size) {
        // nothing adjoining yet: look one bay further out
        for (const n of vg.voxels[id].nbrs) {
          for (const nn of vg.voxels[n].nbrs) {
            const r2 = assign[nn];
            if (r2 === -1 || pg.rooms[r2].fixed) continue;
            share.set(r2, (share.get(r2) || 0) + 0.5);
          }
        }
      }
      if (!share.size) continue;
      let best = -1, bestKey = -Infinity;
      for (const [rid, touch] of share) {
        const need = (pg.rooms[rid].target - areaOf[rid]) / Math.max(1, pg.rooms[rid].target);
        const key = touch * 2 + need;
        if (key > bestKey) { bestKey = key; best = rid; }
      }
      if (best === -1) continue;
      assign[id] = best;
      areaOf[best] += vg.voxels[id].area;
      placed++; moved = true;
    }
    if (!moved) break;
  }
  return { assign, areaOf, placed };
}

// ---------- Trim to the FAR budget ----------
function trimToBudget(vg, pg, state, budget) {
  const { assign, areaOf } = state;
  const LK = pg.lockedVoxels || new Set();
  const { voxels } = vg;
  let total = 0;
  for (const v of voxels) if (assign[v.id] !== -1) total += v.area;
  if (total <= budget) return { assign, areaOf, trimmed: 0 };

  let trimmed = 0;
  for (let pass = 0; pass < 40 && total > budget; pass++) {
    // rooms furthest over their target give up a bay first
    const over = pg.rooms
      .map(r => ({ r, d: areaOf[r.id] - r.target }))
      .filter(o => o.d > 0 && !o.r.fixed && !o.r.skeleton)
      .sort((a, b) => b.d - a.d);
    if (!over.length) break;
    let moved = false;
    for (const { r } of over) {
      if (total <= budget) break;
      if (r.fixed || r.skeleton) continue;
      const cells = [];
      for (const v of voxels) if (assign[v.id] === r.id && !LK.has(v.id)) cells.push(v.id);
      if (cells.length <= 1) continue;
      // drop the most exposed bay that does not split the room
      cells.sort((a, b) => {
        const nb = id => voxels[id].nbrs.filter(n => assign[n] === r.id).length;
        return nb(a) - nb(b);
      });
      for (const c of cells) {
        if (lastLink(vg, pg, assign, c)) continue;
        if (!staysConnected(vg, assign, r.id, c)) continue;
        assign[c] = -1;
        areaOf[r.id] -= voxels[c].area;
        total -= voxels[c].area;
        trimmed++; moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return { assign, areaOf, trimmed };
}

// ---------- Annealing ----------
function initSeeds(vg, pg, rnd) {
  const seeds = new Int32Array(pg.rooms.length).fill(-1);
  const used = new Set();
  for (let s = 0; s < pg.byStory.length; s++) {
    const cells = vg.byStory[s]; if (!cells.length) continue;
    for (const rid of pg.byStory[s]) {
      const r = pg.rooms[rid];
      let pick = -1;
      // cores try to stack on the seed used below
      if (CORE.has(r.type) && s > 0) {
        const below = pg.byStory[s - 1].map(i => pg.rooms[i]).find(x => x.type === r.type);
        if (below && seeds[below.id] !== -1) {
          const bv = vg.voxels[seeds[below.id]];
          const cand = vg.index.get(`${s},${bv.ix},${bv.iy}`);
          if (cand !== undefined && !used.has(cand)) pick = cand;
        }
      }
      if (pick === -1) {
        let bestC = -1, bestS = -Infinity;
        for (let t = 0; t < 24; t++) {
          const c = cells[Math.floor(rnd() * cells.length)];
          if (used.has(c)) continue;
          const edge = 4 - vg.voxels[c].nbrs.length;
          let sc = rnd() * 0.8;
          if (LEASABLE.has(r.type)) sc += edge * 1.2;
          else if (CORE.has(r.type) || r.type === 'corridor') sc -= edge * 1.5;
          if (sc > bestS) { bestS = sc; bestC = c; }
        }
        pick = bestC;
      }
      if (pick !== -1) { seeds[r.id] = pick; used.add(pick); }
    }
  }
  return seeds;
}

function solve(vg, pg, opts = {}) {
  const iters = opts.iters ?? 900;
  const rnd = mulberry32(opts.seed ?? 1);
  let seeds = initSeeds(vg, pg, rnd);
  let order = pg.rooms.map(r => r.id);
  // cores and corridor claim space first
  order.sort((a, b) => {
    const w = t => (t === 'corridor' ? 0 : CORE.has(t) ? 1 : 2);
    return w(pg.rooms[a].type) - w(pg.rooms[b].type);
  });

  const req = requiredNbrs(pg);
  let state = grow(vg, pg, seeds, order, req);
  let ev = evaluate(vg, pg, state);
  let best = { seeds: seeds.slice(), order: order.slice(), state, ev };

  let T0 = 0.55;
  for (let i = 0; i < iters; i++) {
    const T = T0 * (1 - i / iters) + 0.005;
    const cand = seeds.slice();
    const candOrder = order.slice();
    const move = rnd();

    if (move < 0.52) {
      // nudge one seed to a neighbouring cell
      const rid = Math.floor(rnd() * pg.rooms.length);
      if (pg.rooms[rid].fixed || pg.rooms[rid].skeleton) continue;
      const cur = cand[rid]; if (cur === -1) continue;
      const nb = vg.voxels[cur].nbrs;
      if (!nb.length) continue;
      cand[rid] = nb[Math.floor(rnd() * nb.length)];
    } else if (move < 0.74) {
      // relocate one seed anywhere on its floor
      const rid = Math.floor(rnd() * pg.rooms.length);
      if (pg.rooms[rid].fixed || pg.rooms[rid].skeleton) continue;
      const cells = vg.byStory[pg.rooms[rid].s];
      if (!cells.length) continue;
      cand[rid] = cells[Math.floor(rnd() * cells.length)];
    } else {
      // pull a core seed into vertical line with the floor below
      const cores = pg.rooms.filter(r => CORE.has(r.type) && r.s > 0 && !r.fixed);
      if (!cores.length) continue;
      const r = cores[Math.floor(rnd() * cores.length)];
      const below = pg.byStory[r.s - 1].map(i => pg.rooms[i]).find(x => x.type === r.type);
      if (!below || cand[below.id] === -1) continue;
      const bv = vg.voxels[cand[below.id]];
      const c = vg.index.get(`${r.s},${bv.ix},${bv.iy}`);
      if (c === undefined) continue;
      cand[r.id] = c;
    }

    const st2 = grow(vg, pg, cand, candOrder, req);
    const ev2 = evaluate(vg, pg, st2);
    const d = ev2.score - ev.score;
    if (d > 0 || rnd() < Math.exp(d / T)) {
      seeds = cand; order = candOrder; state = st2; ev = ev2;
      if (ev.score > best.ev.score) best = { seeds: seeds.slice(), order: order.slice(), state: st2, ev: ev2 };
    }
  }
  const seqKeep = best.state.seq;
  best.state = fillRemainder(vg, pg,
    { assign: best.state.assign.slice(), areaOf: best.state.areaOf.slice() });
  best.state = fillRemainder(vg, pg, best.state);
  best.access = accessScore(vg, pg, best.state.assign);
  best.state.seq = seqKeep;
  best.ev = evaluate(vg, pg, best.state);
  return best;
}
