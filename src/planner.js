/* Laying units out by frontage along a corridor
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ============ unit planner ============ */
/* ============================================================================
   Frontage-based unit planner.

   The old planner assembled rooms out of whole structural bays, so a 22 ft bay
   was 484 sq ft and a 620 sq ft apartment simply could not be expressed. This
   one works the way a building actually gets laid out: a corridor is struck
   through the plate, the leftover depth becomes a band of units, and the band
   is cut into units by FRONTAGE along its length. Frontage is continuous, so a
   unit lands on its target area to within a few per cent.

   Everything here is pure geometry in the building's own grid frame. No DOM.
   ========================================================================== */

/* ---- international-standard dimensions, all in feet ---------------------- */
const STD = {
  corridor:      6.0,   // IBC min 44" for <50 occupants; 5'-6"-6'-0" is normal
  corridorRetail:8.0,   // rear service/mall corridor runs wider
  aptDepth:     32.0,   // 30-34 ft: deeper than ~36 and back rooms lose daylight
  shopDepth:    30.0,   // retail 2:1 to 3:1 depth:frontage
  minCourt:     15.0,   // below this a light well stops working, so no courtyard
  minBand:      22.0,   // shallowest band that still makes a usable unit
  liftW:         8.5,   // 8'-6" shaft
  stairW:       11.0,   // two flights plus landing
};

/* min/max are the areas the name still honestly describes. A 944 sq ft flat is
   a 2 bed, whatever the solver had to stretch to fill the run. */
const TYPES = {
  apt1:  { key:'apt1',  use:'apartment', label:'1 Bed', target: 650, min: 540, max: 790, minFront:18 },
  apt2:  { key:'apt2',  use:'apartment', label:'2 Bed', target: 950, min: 820, max:1180, minFront:24 },
  shopS: { key:'shopS', use:'retail',    label:'Small shop', target: 550, min: 440, max: 740, minFront:14 },
  shopL: { key:'shopL', use:'retail',    label:'Large shop', target:1000, min: 760, max:1320, minFront:26 },
};

const overlaps = (a, b) =>
  a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 &&
  a.y < b.y + b.d - 0.01 && b.y < a.y + a.d - 0.01;

/* ---------------------------------------------------------------------------
   Cut one straight run of band into units.

   Pick how many of each of the two types fit, preferring the mix ratio, then
   stretch the frontages uniformly so the run fills exactly — which is what an
   architect does when tuning unit widths to a structural bay.
--------------------------------------------------------------------------- */
function cutRun(len, depth, tA, tB, mix){
  if (len < Math.min(tA.minFront, tB.minFront) || depth <= 0) return null;
  const fA = tA.target / depth, fB = tB.target / depth;

  /* Search both counts outright. Deriving one from the other and rounding it
     misses valid answers: a 30 ft run of 30 ft deep retail is one 915 sq ft
     shop, but rounding asked for two and rejected them as too narrow. */
  let best = null;
  const maxA = Math.floor(len / tA.minFront), maxB = Math.floor(len / tB.minFront);
  for (let a = 0; a <= maxA; a++){
    for (let b = 0; b <= maxB; b++){
      const n = a + b; if (!n) continue;
      if (a * tA.minFront + b * tB.minFront > len + 0.01) break;
      const scale = len / (a * fA + b * fB);
      const wA = fA * scale, wB = fB * scale;
      const arA = wA * depth, arB = wB * depth;
      // a unit has to stay inside the band its name promises
      if (a && (arA < tA.min || arA > tA.max)) continue;
      if (b && (arB < tB.min || arB > tB.max)) continue;
      const errA = a ? Math.abs(arA - tA.target) / tA.target : 0;
      const errB = b ? Math.abs(arB - tB.target) / tB.target : 0;
      /* The mix term was weighted 0.25 against an area error that runs to
         whole multiples of it, so the asked-for mix never moved the answer and
         every scheme came back with the same unit split. Both counts are
         already held inside their type's area band as a hard constraint, so
         leaning harder on the mix only chooses between cuts that were all
         acceptable anyway. */
      const score = (a * errA + b * errB) / n + Math.abs(a / n - mix) * 0.6;
      if (!best || score < best.score) best = { a, b, wA, wB, score };
    }
  }
  /* Nothing satisfied the caps — a short leftover beside the core, usually.
     Leaving it empty would punch a hole in the floor, which is worse than an
     unusual unit, so fill it with as many equal units as fit and name each by
     whichever type its final area is closest to. */
  if (!best){
    const n = Math.max(1, Math.round(len / ((tA.target + tB.target) / 2 / depth)));
    const front = len / n;
    /* Judge the leftover on usable width, not on a ratio of the nominal
       frontage. On a deep band a narrow frontage is still a real flat -- a
       27 ft segment beside the core on a 44 ft band is two 605 sq ft units,
       and refusing it left a quarter of that floor empty. 11 ft is about the
       narrowest a bedroom can be. */
    if (front < 11) return null;
    const area = front * depth;
    const t = Math.abs(area - tA.target) < Math.abs(area - tB.target) ? tA : tB;
    return Array.from({ length: n }, () => [t, front]);
  }

  // Interleave the types so every floor offers a range and the plan reads well.
  const seq = []; let a = best.a, b = best.b;
  while (a || b){
    if (a && (!b || a / (a + b) >= mix)) { seq.push([tA, best.wA]); a--; }
    else { seq.push([tB, best.wB]); b--; }
  }
  return seq;
}

/* A run of band: origin, direction, depth. `flip` hangs the band on the far
   side of the origin line. Segments are cut around anything reserved on it. */
function layRun(run, segs, tA, tB, mix, out){
  for (const [t0, len] of segs){
    const seq = cutRun(len, run.depth, tA, tB, mix);
    if (!seq) continue;
    let t = t0;
    for (const [type, front] of seq){
      const horiz = run.axis === 'x';
      const w = horiz ? front : run.depth;
      const dd = horiz ? run.depth : front;
      out.push({
        x: horiz ? run.x + t : (run.flip ? run.x - run.depth : run.x),
        y: horiz ? (run.flip ? run.y - run.depth : run.y) : run.y + t,
        w, d: dd, area: w * dd,
        use: type.use, label: type.label, typeKey: type.key, target: type.target,
      });
      t += front;
    }
  }
}

/* ---------------------------------------------------------------------------
   Lay out one storey.
     plate: {x,y,w,d} buildable envelope in grid coords
     kind:  'residential' | 'retail'
   Returns { rooms, corridor, court, core, typology }
--------------------------------------------------------------------------- */
/* Skeleton for one typology: the band runs, the corridor, the light well.
   Returns null when the plate cannot carry that typology at all. */
function unitSkeleton(typ, plate, depth, cw){
  const { x, y, w, d } = plate, short = Math.min(w, d);
  const corridor = [], back = [];
  let court = null, runs = [];

  if (typ === 'courtyard'){
    /* Units round the perimeter, corridor ring behind them, daylit void in
       the middle. The right answer for a deep plate: a central corridor alone
       would leave an unlit slab of floor nobody can use.

       The north and south corridor runs go the FULL width of the plate rather
       than stopping at the ring's corners. With the ring inset on all four
       sides a corner unit's inner edge falls outside every corridor run and
       can only be reached through its neighbour. Running the corridor wall to
       wall is both how it is actually built and what makes every unit on the
       floor directly reachable. */
    const bd = Math.min(depth, (short - 2*cw - STD.minCourt) / 2);
    if (bd < STD.minBand) return null;
    const sideY = y + bd + cw, sideLen = d - 2*(bd + cw);
    if (sideLen < STD.minBand) return null;     // sides too short to hold units
    runs = [
      { tag:'N', x:x,     y:y,     len:w,       depth:bd, axis:'x', flip:false },
      { tag:'S', x:x,     y:y + d, len:w,       depth:bd, axis:'x', flip:true  },
      { tag:'W', x:x,     y:sideY, len:sideLen, depth:bd, axis:'y', flip:false },
      { tag:'E', x:x + w, y:sideY, len:sideLen, depth:bd, axis:'y', flip:true  },
    ];
    corridor.push({ x, y: y + bd,          w, d: cw, use:'circulation' });
    corridor.push({ x, y: y + d - bd - cw, w, d: cw, use:'circulation' });
    corridor.push({ x: x + bd,          y:sideY, w: cw, d: sideLen, use:'circulation' });
    corridor.push({ x: x + w - bd - cw, y:sideY, w: cw, d: sideLen, use:'circulation' });
    court = { x: x + bd + cw, y: sideY, w: w - 2*(bd + cw), d: sideLen };
    return { runs, corridor, court };
  }

  if (typ === 'bar' || typ === 'bar!'){
    /* Corridor down the middle, units both sides, every one with an external
       wall. Depth the bands cannot use widens the corridor rather than being
       left as a dead strip. */
    /* Both bands share whatever depth is left once the corridor is taken.
       A back-of-house strip between corridor and far band was tried and cut
       that band off from the corridor, so the slack goes to the units. Past
       about 1.4x the daylight depth a bar stops making sense and the plate
       belongs to the courtyard instead. */
    const band = (short - cw) / 2;
    if (band < STD.minBand) return null;
    // the depth cap is a quality rule, not a correctness one: on the relaxed
    // pass an over-deep band beats leaving the floor empty
    if (typ === 'bar' && band > depth * 1.4) return null;
    const cwB = cw, alongX = w >= d;
    if (alongX){
      runs = [{ tag:'N', x:x, y:y,     len:w, depth:band, axis:'x', flip:false },
              { tag:'S', x:x, y:y + d, len:w, depth:band, axis:'x', flip:true  }];
      corridor.push({ x, y: y + band, w, d: cwB, use:'circulation' });
    } else {
      runs = [{ tag:'W', x:x,     y:y, len:d, depth:band, axis:'y', flip:false },
              { tag:'E', x:x + w, y:y, len:d, depth:band, axis:'y', flip:true  }];
      corridor.push({ x: x + band, y, w: cwB, d, use:'circulation' });
    }
    return { runs, corridor, court:null };
  }

  /* Single-loaded: narrow plate, one band, corridor along the back. Leftover
     depth goes to the units, not the corridor — widening the corridor to
     swallow it sent circulation past a third of the floor on small plates. */
  const band = Math.max(0, short - cw);
  if (band < STD.minBand * 0.6) return null;
  const alongX = w >= d;
  if (alongX){
    runs = [{ tag:'N', x:x, y:y, len:w, depth:band, axis:'x', flip:false }];
    corridor.push({ x, y: y + band, w, d: cw, use:'circulation' });
  } else {
    runs = [{ tag:'W', x:x, y:y, len:d, depth:band, axis:'y', flip:false }];
    corridor.push({ x: x + band, y, w: cw, d, use:'circulation' });
  }
  return { runs, corridor, court:null };
}

/* Fill one skeleton: reserve the core, then cut every run into units. */
function fillSkeleton(sk, plate, tA, tB, mix, nLifts, nStair){
  const { runs, corridor, court } = sk;
  const rooms = (sk.back || []).slice();

  /* Core placement.

     Lifts belong together -- one lobby, one waiting point. Stairs must not:
     IBC 1007.1.1 wants the two exits at least a third of the plate's diagonal
     apart so a single fire cannot take both. Putting the whole core in one
     block, which is what this did, left the stairs about 11 ft apart on a
     typical plate against the 42 ft required. They are now pushed towards
     opposite ends of the longest run. */
  const host = runs.slice().sort((a,b)=>b.len-a.len)[0];
  const core = [];
  const reserved = new Map(runs.map(r => [r.tag, []]));
  const liftLen  = nLifts * STD.liftW;
  const stairLen = nStair * STD.stairW;

  const emit = (run, t, label, wide) => {
    const horiz = run.axis === 'x';
    const w = horiz ? wide : run.depth, d = horiz ? run.depth : wide;
    core.push({
      x: horiz ? run.x + t : (run.flip ? run.x - run.depth : run.x),
      y: horiz ? (run.flip ? run.y - run.depth : run.y) : run.y + t,
      w, d, area: w * d, use:'services', label, isCore:true,
    });
  };

  if (host && (liftLen + stairLen) > 0){
    const L = host.len;
    const spread = L >= liftLen + stairLen + 2 * tB.minFront;
    if (spread){
      /* Stairs go to the ends of the run and the lifts sit between them. An
         earlier attempt kept them inboard and demanded four units' width of
         clearance, which no ordinary plate could give, so it always fell back
         to the single block and the stairs stayed 11 ft apart. At the ends of
         a slab they are as remote as the geometry allows, which is also where
         a slab block actually puts them. */
      const per = stairLen / Math.max(1, nStair);
      const slots = [];
      for (let i = 0; i < nStair; i++){
        const frac = nStair === 1 ? 0 : (i / (nStair - 1));
        slots.push({ t: frac * (L - per), len: per, label: 'Stair' });
      }
      if (liftLen > 0) slots.push({ t:(L - liftLen)/2, len:liftLen, label:'Lift' });
      slots.sort((p,q)=>p.t-q.t);
      // push apart anything that ended up overlapping
      for (let i = 1; i < slots.length; i++){
        const prev = slots[i-1];
        if (slots[i].t < prev.t + prev.len + tB.minFront)
          slots[i].t = prev.t + prev.len + tB.minFront;
      }
      if (slots[slots.length-1].t + slots[slots.length-1].len <= L){
        const res = [];
        for (const sl of slots){
          res.push([Math.round(sl.t*100)/100, sl.len]);
          const n = sl.label === 'Lift' ? nLifts : 1;
          const unit = sl.label === 'Lift' ? STD.liftW : sl.len;
          let t = sl.t;
          for (let k = 0; k < n; k++){ emit(host, t, sl.label, unit); t += unit; }
        }
        reserved.set(host.tag, res);
      }
    }
    if (!core.length && host.len >= liftLen + stairLen + 2 * tB.minFront){
      // plate too short to separate them: fall back to a single block
      const t0 = Math.round(((host.len - liftLen - stairLen) / 2) * 100) / 100;
      reserved.set(host.tag, [[t0, liftLen + stairLen]]);
      let t = t0;
      for (let i = 0; i < nLifts; i++){ emit(host, t, 'Lift',  STD.liftW);  t += STD.liftW; }
      for (let i = 0; i < nStair; i++){ emit(host, t, 'Stair', STD.stairW); t += STD.stairW; }
    }
  }

  for (const run of runs){
    const res = (reserved.get(run.tag) || []).slice().sort((a,b)=>a[0]-b[0]);
    const segs = []; let cur = 0;
    for (const [t0, len] of res){ if (t0 - cur > 0.5) segs.push([cur, t0 - cur]); cur = t0 + len; }
    if (run.len - cur > 0.5) segs.push([cur, run.len - cur]);
    layRun(run, segs, tA, tB, mix, rooms);
  }
  rooms.push(...core);
  return { rooms, corridor, court, core, plate };
}

/* ---------------------------------------------------------------------------
   Lay out one storey.
     plate: {x,y,w,d} buildable envelope in grid coords
     kind:  'residential' | 'retail'

   Every typology the plate can carry is built and scored, and the best one
   wins. Picking by threshold alone kept choosing a courtyard for small plates,
   where the ring eats the floor and circulation runs past a fifth of it.
--------------------------------------------------------------------------- */
function planStorey(plate, kind, opts = {}){
  const retail = kind === 'retail';
  /* Band depth front to back. A scheme may ask for shallower bands: that wins
     daylight and cross-ventilation on both faces and costs corridor, which is
     a real trade and one of the few that shows up in the plan rather than only
     in the schedule. */
  const depth  = (retail ? STD.shopDepth : STD.aptDepth) * (opts.depthScale || 1);
  const cw     = retail ? STD.corridorRetail : STD.corridor;
  const tA     = retail ? TYPES.shopL : TYPES.apt2;
  const tB     = retail ? TYPES.shopS : TYPES.apt1;
  const mix    = opts.mix    != null ? opts.mix    : 0.45;
  const nLifts = opts.lifts  != null ? opts.lifts  : 2;
  const nStair = opts.stairs != null ? opts.stairs : 2;
  const prefer = opts.prefer || 'auto';
  const A = plate.w * plate.d;

  /* Normal passes first. If none of them can carry the plate, run again with
     the quality caps relaxed: a plate between about 93 and 98 ft deep is too
     deep for a bar at its daylight limit and too shallow for a courtyard ring,
     and used to fall through both and leave the storey completely empty. An
     unusually deep unit is a defect; a floor with nothing on it is a failure. */
  let best = null, wanted = null;
  for (const typ of ['courtyard', 'bar', 'single', 'bar!']){
    if (typ === 'bar!' && best) break;
    const sk = unitSkeleton(typ, plate, depth, cw);
    if (!sk) continue;
    const plan = fillSkeleton(sk, plate, tA, tB, mix, nLifts, nStair);
    const units = plan.rooms.filter(u => !u.isCore);
    if (!units.length) continue;

    const corr  = plan.corridor.reduce((a,c)=>a + c.w*c.d, 0) / A;
    const courtA= plan.court ? plan.court.w*plan.court.d / A : 0;
    const filled= (plan.rooms.reduce((a,u)=>a+u.area,0) / A) + corr + courtA;
    const areaErr = units.reduce((a,u)=>a + Math.abs(u.area-u.target)/u.target, 0) / units.length;
    // the share of the plate that can actually be sold or let
    const net   = units.reduce((a,u)=>a + u.area, 0) / A;

    /* Leaving floor unbuilt is the worst outcome, then runaway circulation.
       `filled` counts the corridor and the courtyard as filled, so on its own
       it rates a floor paved with circulation as highly as one full of flats:
       that is how a courtyard returning 63% of the plate as lettable kept
       beating a bar returning 74% of it. Net lettable share is what the
       appraisal is built on, so it is scored directly. A courtyard is still
       worth having for daylight on two sides -- it is offered as a scheme of
       its own rather than as the silent default. */
    const score = (1 - Math.min(1, filled)) * 6
                + Math.max(0, corr - 0.18) * 8
                + areaErr
                + (1 - net) * 3
                + courtA * 0.35;             // a void is useful, but it is not lettable
    plan.typology = typ;
    plan.metrics = { corr, filled, areaErr, courtA, net, score };
    if (!best || score < best.metrics.score) best = plan;
    if (typ === prefer) wanted = plan;
  }

  /* A scheme may ask for a typology. That is a preference, not an override: it
     is honoured only if the plate can carry it soundly, because a courtyard
     ring forced onto a plate too shallow for one leaves most of the floor
     unbuilt. Below the floor set here the best-scoring typology wins instead,
     and the scheme quietly gets the plan the plate can actually take. */
  if (wanted && wanted !== best
      && wanted.metrics.filled >= 0.75 && wanted.metrics.corr <= 0.28) best = wanted;

  return best || { rooms:[], corridor:[], court:null, core:[], typology:'none', plate };
}

/* Every unit must share a real edge with a corridor, not merely a corner. */
function checkAccess(plan){
  const near = v => Math.abs(v) < 0.05;
  const touch = (u, c) => {
    const ox = Math.min(u.x+u.w, c.x+c.w) - Math.max(u.x, c.x);
    const oy = Math.min(u.y+u.d, c.y+c.d) - Math.max(u.y, c.y);
    if (ox > 0.5 && (near(u.y - (c.y+c.d)) || near(c.y - (u.y+u.d)))) return true;
    if (oy > 0.5 && (near(u.x - (c.x+c.w)) || near(c.x - (u.x+u.w)))) return true;
    return false;
  };
  const bad = plan.rooms.filter(u => !plan.corridor.some(c => touch(u, c)));
  return { ok: bad.length === 0, bad };
}

/* No two rooms may share floor area. */
function checkOverlap(plan){
  const all = plan.rooms.concat(plan.corridor);
  const bad = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i+1; j < all.length; j++)
      if (overlaps(all[i], all[j])) bad.push([i, j]);
  return { ok: bad.length === 0, bad };
}

/* Title block for a unit plan: level, use, typology and a north arrow. */
function planFooter(g, lvl, size){
  const plan = state.plan[lvl], vg = state.vg, pg = state.pg;
  g.save();
  g.textAlign='left'; g.textBaseline='alphabetic';
  g.font='600 11px -apple-system,Inter,sans-serif'; g.fillStyle='#1d1d1f';
  g.fillText(`Level ${lvl+1}`, 14, size-20);
  g.font='400 9px -apple-system,Inter,sans-serif'; g.fillStyle='#86868b';
  const useName = USE_LABEL[pg.floorUse[lvl]] || pg.floorUse[lvl];
  const units = plan.rooms.filter(r=>!r.isCore && r.target).length;
  g.fillText(`${useName} \u00b7 ${plan.typology} \u00b7 ${units} units \u00b7 `
    + `${Math.round(plan.circ/plan.gross*100)}% circulation`, 14, size-9);
  const nx = size-24, ny = 26;
  g.translate(nx,ny); g.rotate(-(vg.angle||0));
  g.strokeStyle='#1d1d1f'; g.lineWidth=1;
  g.beginPath(); g.moveTo(0,11); g.lineTo(0,-11);
  g.moveTo(-4,-4); g.lineTo(0,-11); g.lineTo(4,-4); g.stroke();
  g.restore();
}

/* ---------------------------------------------------------------------------
   Per-storey plate, then a plan for it.

   The structural bay grid still drives the massing, the FAR and the frame; it
   is only the space planning that has moved off it. A unit is cut by frontage
   along a corridor now, so a 1 bed lands near 650 sq ft instead of being
   rounded up to whole 484 sq ft bays.
--------------------------------------------------------------------------- */
const RETAIL_USES = new Set(['retail','restaurant']);

/* The plannable rectangle on a storey: the largest run of columns by run of
   rows in which every bay is buildable.

   This used to return the bounding box of the storey's bays, which is only
   the same thing when the plate is a full rectangle. On an L-shaped or
   clipped plot the box covers bays that failed the setback test, so the plan
   was laid over ground the building is not allowed to stand on, and the area
   schedule counted it. On the default plot it showed up as the scheme
   reporting itself over its own FAR limit -- the top storey is cut back to
   the slack the allowance leaves, and the box ignored the cut.

   Taking the largest clear rectangle is conservative: an L-shaped plate
   plans as the bigger of its two legs rather than as both. That under-uses
   such a plot, which the allowance figure will show, and it is the right way
   round -- a plan that fits is worth more than one that does not. */
function storeyPlate(vg, s){
  const cells = (vg.byStory[s] || []).filter(id => !vg.voxels[id].dead);
  if (!cells.length) return null;

  // column and row geometry, taken across the whole graph so a column missing
  // from this storey still holds its place in the grid
  const cols = new Map(), rows = new Map();
  for (const v of vg.voxels){
    if (!cols.has(v.ix)) cols.set(v.ix, { x:v.x, w:v.w });
    if (!rows.has(v.iy)) rows.set(v.iy, { y:v.y, d:v.d });
  }
  const cx = [...cols.keys()].sort((a,b)=>a-b);
  const ry = [...rows.keys()].sort((a,b)=>a-b);
  const ci = new Map(cx.map((k,i)=>[k,i])), rj = new Map(ry.map((k,j)=>[k,j]));

  const live = Array.from({ length: ry.length }, () => new Array(cx.length).fill(0));
  for (const id of cells){
    const v = vg.voxels[id];
    live[rj.get(v.iy)][ci.get(v.ix)] = 1;
  }
  // prefix sums, so "is every bay in this rectangle buildable" is O(1)
  const P = Array.from({ length: ry.length+1 }, () => new Array(cx.length+1).fill(0));
  for (let j=0;j<ry.length;j++) for (let i=0;i<cx.length;i++)
    P[j+1][i+1] = live[j][i] + P[j][i+1] + P[j+1][i] - P[j][i];
  const full = (j0,j1,i0,i1) =>
    P[j1+1][i1+1] - P[j0][i1+1] - P[j1+1][i0] + P[j0][i0] === (j1-j0+1)*(i1-i0+1);

  const wAt = i => cols.get(cx[i]).w, dAt = j => rows.get(ry[j]).d;
  let best = null;
  for (let i0=0;i0<cx.length;i0++){
    for (let i1=i0;i1<cx.length;i1++){
      let w = 0; for (let i=i0;i<=i1;i++) w += wAt(i);
      for (let j0=0;j0<ry.length;j0++){
        if (!live[j0][i0]) continue;
        let d = 0;
        for (let j1=j0;j1<ry.length;j1++){
          d += dAt(j1);
          if (!full(j0,j1,i0,i1)) break;
          if (!best || w*d > best.w*best.d)
            best = { x:cols.get(cx[i0]).x, y:rows.get(ry[j0]).y, w, d };
        }
      }
    }
  }
  return best;
}

function buildPlans(vg, pg, cfg){
  const lifts  = Math.max(1, (cfg.core && cfg.core.liftCount)  || 1);
  const stairs = Math.max(1, (cfg.core && cfg.core.stairCount) || 1);
  /* The scheme rides on cfg so that every caller of buildPlans -- generation,
     the plan editor, the tests -- gets the same layout for the same option
     without each having to know the scheme exists. */
  const sch = cfg.scheme || {};
  const out = [];
  for (let s = 0; s < vg.byStory.length; s++){
    const plate = storeyPlate(vg, s);
    if (!plate){ out.push(null); continue; }
    const use  = (pg.floorUse && pg.floorUse[s]) || 'apartment';
    const kind = RETAIL_USES.has(use) ? 'retail' : 'residential';
    const plan = planStorey(plate, kind, {
      lifts, stairs, prefer: sch.prefer, depthScale: sch.depthScale,
      mix: kind === 'retail' ? sch.shopMix : sch.unitMix,
    });
    /* The planner names uses generically; the app has its own keys for colour,
       labelling and the leasable test. Translate once, here at the boundary,
       so the planner stays independent of this file. */
    for (const r of plan.rooms){
      if (r.isCore) r.use = r.label === 'Lift' ? 'elevator' : 'stairs';
    }
    for (const c of plan.corridor) c.use = 'corridor';

    /* On the ground floor, the room an entrance lands in becomes the lobby.
       A marked entrance used to be only a marker: the plan had no lobby, so a
       multistorey building was entered straight into a shop. Every room is cut
       against the corridor by construction, so relabelling one keeps the route
       from street to lift intact. A lobby is not saleable, so it drops out of
       the net area and the appraisal on its own. */
    if (s === 0 && state.vg && !state.vgStale){
      for (const en of entranceList()){
        const v = state.vg.voxels[en.id]; if (!v) continue;
        /* Pick the room that shares the most floor with the entrance bay.
           Matching on the bay's centre point missed whenever that centre fell
           in the corridor, which left the entrance without a lobby. */
        let hit = null, bestOv = 0, nearest = null, nd = Infinity;
        for (const r of plan.rooms){
          if (r.isCore || r.isLobby) continue;
          const ox = Math.min(r.x+r.w, v.x+v.w) - Math.max(r.x, v.x);
          const oy = Math.min(r.y+r.d, v.y+v.d) - Math.max(r.y, v.y);
          const ov = (ox > 0 && oy > 0) ? ox*oy : 0;
          if (ov > bestOv){ bestOv = ov; hit = r; }
          const dx = Math.max(r.x-(v.x+v.w/2), 0, (v.x+v.w/2)-(r.x+r.w));
          const dy = Math.max(r.y-(v.y+v.d/2), 0, (v.y+v.d/2)-(r.y+r.d));
          const d = Math.hypot(dx, dy);
          if (d < nd){ nd = d; nearest = r; }
        }
        if (!hit && nd < 30) hit = nearest;    // bay sat wholly in the corridor
        if (hit){
          hit.use = 'entrance'; hit.label = 'Entrance lobby';
          hit.isLobby = true; delete hit.target;
        }
      }
    }
    plan.use = use;
    plan.gross = plate.w * plate.d;
    plan.net   = plan.rooms.reduce((a,r)=>a + (r.isCore ? 0 : r.area), 0);
    plan.circ  = plan.corridor.reduce((a,c)=>a + c.w*c.d, 0);
    plan.voidA = plan.court ? plan.court.w * plan.court.d : 0;
    out.push(plan);
  }
  return out;
}

/* Rooms as rectangles: poche walls, a swing on every unit door, glazing on the
   outer face. Drawn straight from the planner rather than traced round bays. */
function drawUnitPlan(g, plan, P, k, detail){
  const WALL = Math.max(1.2, 0.55*k);
  const fill = (r, a) => {
    const use = r.use === 'services' ? 'services' : r.use;
    g.fillStyle = tint(USE_COL[use] || '#c7c7cc', a);
    const [x,y] = P(r.x, r.y);
    g.fillRect(x, y, r.w*k + 0.4, r.d*k + 0.4);
  };
  if (plan.court){
    const [x,y] = P(plan.court.x, plan.court.y);
    g.fillStyle = '#dff0d2';
    g.fillRect(x, y, plan.court.w*k, plan.court.d*k);
    if (detail){
      g.save(); g.fillStyle='#6f8f5a';
      g.font='500 9px -apple-system,Inter,sans-serif';
      g.textAlign='center'; g.textBaseline='middle';
      g.fillText('COURTYARD', x + plan.court.w*k/2, y + plan.court.d*k/2);
      g.restore();
    }
  }
  for (const c of plan.corridor) fill(c, detail ? 0.34 : 0.62);
  for (const r of plan.rooms)    fill(r, detail ? 0.30 : 0.62);

  // demising walls
  g.strokeStyle = '#3a3a3c'; g.lineWidth = WALL; g.lineJoin='miter';
  for (const r of plan.rooms.concat(plan.corridor)){
    const [x,y] = P(r.x, r.y);
    g.strokeRect(x, y, r.w*k, r.d*k);
  }
  if (!detail) return;

  g.font = '600 9px -apple-system,Inter,sans-serif';
  g.textAlign='center'; g.textBaseline='middle';
  for (const r of plan.rooms){
    const [x,y] = P(r.x, r.y), w = r.w*k, d = r.d*k;
    if (Math.min(w,d) < 16) continue;
    g.fillStyle = '#1d1d1f';
    g.fillText(r.label, x+w/2, y+d/2 - (r.isCore ? 0 : 5));
    if (!r.isCore && Math.min(w,d) > 26){
      g.fillStyle = '#86868b';
      g.font = '500 8px -apple-system,Inter,sans-serif';
      g.fillText(fmt(Math.round(r.area)) + ' sq ft', x+w/2, y+d/2 + 6);
      g.font = '600 9px -apple-system,Inter,sans-serif';
    }
  }
}


/* ============================================================================
   Cost and feasibility.

   Reads the area schedule, so it is always describing the scheme actually on
   screen. The method is the ordinary residual appraisal a developer runs
   before committing: build the cost stack, value the saleable area, and see
   what is left. Two outputs matter more than the profit figure itself --
   the breakeven sale rate, and the residual land value, which is the most you
   could pay for the site and still hit your target margin.

   EVERY RATE BELOW IS AN INDICATIVE PLACEHOLDER. They are starting points, not
   market data, and they are meant to be overwritten with your own figures.
   ========================================================================== */
const CUR = {
  PKR: { sym:'Rs', step:500,  big:1e7, bigName:'crore' },
  USD: { sym:'$',  step:5,    big:1e6, bigName:'m' },
};

/* Build cost per sq ft, by what is being built. Fit-out drives most of the
   spread: retail and office shell-and-core cost less than they finish for. */
const RATE_BUILD = {        // PKR / sq ft
  apartment:7500, studio:7200, hotel:11000,
  retail:9000, restaurant:10500, office:8500, coworking:8500,
  clinic:11000, amenity:7000, parking:3500,
  corridor:6000, stairs:6000, elevator:9000, restroom:9500, mech:7000,
  entrance:9000,
};
/* Sale rate per sq ft of saleable area. Keyed by unit label first so a 2 bed
   and a shop can be priced differently, then by use as a fallback. */
const RATE_SALE = {         // PKR / sq ft
  '1 Bed':20000, '2 Bed':19000, 'Small shop':48000, 'Large shop':42000,
  apartment:19500, studio:20500, retail:45000, restaurant:45000,
  office:26000, coworking:26000, hotel:30000, clinic:28000,
};

const feasDefaults = () => ({
  cur:'PKR', fx:280,
  build:{ ...RATE_BUILD }, sale:{ ...RATE_SALE },
  landMode:'persqft',      // 'persqft' of plot, or 'lump'
  landRate:9000, landLump:0,
  soft:12,                 // design, approvals, project management, % of build
  cont:5,                  // contingency, % of build
  fin:8,                   // finance, % of (build + land)
  mkt:3,                   // sales and marketing, % of GDV
  target:20,               // target margin on cost, for the residual land value
});

/* Convert a PKR figure for display in the chosen currency. The rates are all
   stored in PKR so switching currency never rewrites the model. */
function money(v, f){ return f.cur === 'USD' ? v / (f.fx || 280) : v; }
function fmtMoney(v, f, dp){
  const c = CUR[f.cur], x = money(v, f);
  if (Math.abs(x) >= c.big){
    return c.sym + ' ' + (x / c.big).toFixed(2) + ' ' + c.bigName;
  }
  return c.sym + ' ' + x.toLocaleString(undefined,
    { maximumFractionDigits: dp == null ? 0 : dp });
}

function feasibility(){
  const sch = schedule(); if (!sch) return null;
  const f = state.feas || (state.feas = feasDefaults());

  /* ---- build cost, element by element, off the schedule rows ---------- */
  const lines = [];
  let build = 0;
  for (const r of sch.rows){
    const rate = f.build[r.use] != null ? f.build[r.use] : 6000;
    const cost = r.area * rate;
    build += cost;
    lines.push({ name:r.name, use:r.use, unit:r.unit, area:r.area, rate, cost });
  }
  if (sch.park && sch.park.gross > 0){
    const rate = f.build.parking != null ? f.build.parking : 3500;
    const cost = sch.park.gross * rate;
    build += cost;
    lines.push({ name:`Basement parking (${sch.park.levels} levels, ${sch.park.cars} cars)`,
                 use:'parking', unit:false, area:sch.park.gross, rate, cost });
  }
  lines.sort((a,b)=>b.cost-a.cost);

  /* ---- the rest of the cost stack -------------------------------------- */
  const plot = sch.plot;
  const land = f.landMode === 'lump' ? (f.landLump||0) : plot * (f.landRate||0);
  const soft = build * (f.soft/100);
  const cont = build * (f.cont/100);
  const fin  = (build + land) * (f.fin/100);

  /* ---- what the scheme is worth ---------------------------------------- */
  let gdv = 0; const sale = [];
  for (const r of sch.rows){
    if (!r.unit) continue;                       // only saleable area is valued
    const rate = f.sale[r.name] != null ? f.sale[r.name]
               : (f.sale[r.use] != null ? f.sale[r.use] : 18000);
    const value = r.area * rate;
    gdv += value;
    sale.push({ name:r.name, use:r.use, count:r.count, area:r.area, rate, value });
  }
  sale.sort((a,b)=>b.value-a.value);
  const mkt = gdv * (f.mkt/100);

  const tdc    = build + land + soft + cont + fin + mkt;   // total development cost
  const profit = gdv - tdc;
  const onCost = tdc ? profit / tdc : 0;
  const onGdv  = gdv ? profit / gdv : 0;

  /* Breakeven: the average sale rate across saleable area at which the scheme
     returns nothing. Marketing is a share of GDV, so it moves with the answer
     and cannot be inside the cost being solved for -- using the full TDC here
     put breakeven ~4% too high and quietly reported a loss-making rate as safe.
         GDV(1-m) = fixed cost   ->   rate = fixed / ((1-m) * net area)        */
  const netArea = sale.reduce((a,x)=>a+x.area, 0);
  const fixed   = build + land + soft + cont + fin;
  const breakeven = netArea ? fixed / ((1 - f.mkt/100) * netArea) : 0;

  /* Residual land value: hold the target margin, and see what is left for the
     site. This is the number that decides whether a deal is worth bidding on. */
  const nonLand = build + soft + cont + mkt;
  const t = f.target/100, fr = f.fin/100;
  // gdv = (nonLand + land + fin) * (1+t), with fin = (build+land)*fr
  const resid = ((gdv/(1+t)) - nonLand - build*fr) / (1 + fr);

  return { f, sch, lines, sale, build, land, soft, cont, fin, mkt, tdc,
           gdv, profit, onCost, onGdv, breakeven, resid, netArea, plot,
           costPerGfa: sch.gfa ? tdc / sch.gfa : 0 };
}

/* ---------------------------------------------------------------------------
   The feasibility sheet. Inputs are editable in place: every rate is a guess
   until it is your guess, so none of them are locked away in a settings panel.
--------------------------------------------------------------------------- */
/* `phase` is its own object on state, not a group inside the appraisal, so the
   row has to know where to read and write each field. */
function feasBag(group){
  if (group === 'phase') return state.phase || (state.phase = phaseDefaults());
  return group ? state.feas[group] : state.feas;
}
function feasRow(label, key, group, suffix){
  const v = feasBag(group)[key];
  return `<tr><td>${label}</td>
    <td class="r"><input class="fin num" data-g="${group||''}" data-k="${key}"
      type="number" step="any" value="${Math.round(v*100)/100}"></td>
    <td class="u">${suffix||''}</td></tr>`;
}

function paintFeas(){
  const r = feasibility();
  if (!r){ $('feasSheet').innerHTML =
    '<h2>Feasibility</h2><p class="sub">Generate a scheme first — the appraisal is built from its area schedule.</p>'; return; }
  const f = r.f, M = v => fmtMoney(v, f);
  const pf = r.profit >= 0;
  const rate = v => (f.cur==='USD' ? (v/(f.fx||280)) : v)
        .toLocaleString(undefined,{maximumFractionDigits:f.cur==='USD'?1:0});

  const costRows = [
    ['Construction', r.build], ['Land', r.land],
    ['Design, approvals, management', r.soft], ['Contingency', r.cont],
    ['Finance', r.fin], ['Sales and marketing', r.mkt],
  ];

  $('feasSheet').innerHTML = `
    <h2>Cost and feasibility</h2>
    <p class="sub">Residual appraisal of the scheme on screen &middot;
      ${fmt(Math.round(r.sch.gfa))} sq ft gross &middot;
      ${fmt(Math.round(r.netArea))} sq ft saleable</p>

    <div class="warn-note">Every rate below is an indicative placeholder, not
      market data. Replace them with your own figures before this leaves your desk.</div>

    <div class="tot">
      <div><span>Development cost</span><b class="num">${M(r.tdc)}</b></div>
      <div><span>Gross development value</span><b class="num">${M(r.gdv)}</b></div>
      <div><span>Profit</span><b class="num ${pf?'':'warn'}">${M(r.profit)}</b></div>
      <div><span>Margin on cost</span><b class="num ${r.onCost<0.15?'warn':''}">${(r.onCost*100).toFixed(1)}%</b></div>
      <div><span>Margin on GDV</span><b class="num">${(r.onGdv*100).toFixed(1)}%</b></div>
      <div><span>Cost per sq ft gross</span><b class="num">${rate(r.costPerGfa)}</b></div>
      <div><span>Breakeven sale rate</span><b class="num">${rate(r.breakeven)}</b></div>
      <div><span>Residual land value</span><b class="num">${M(r.resid)}</b></div>
    </div>

    <div class="feas-grid">
      <div>
        <h3>Assumptions</h3>
        <table class="sch fin-t"><tbody>
          <tr><td>Currency</td><td class="r">
            <select class="fin" data-k="cur">
              <option value="PKR"${f.cur==='PKR'?' selected':''}>PKR</option>
              <option value="USD"${f.cur==='USD'?' selected':''}>USD</option>
            </select></td><td class="u"></td></tr>
          ${feasRow('Exchange rate','fx',null,'PKR / USD')}
          <tr><td>Land priced as</td><td class="r">
            <select class="fin" data-k="landMode">
              <option value="persqft"${f.landMode==='persqft'?' selected':''}>Rate per sq ft</option>
              <option value="lump"${f.landMode==='lump'?' selected':''}>Lump sum</option>
            </select></td><td class="u"></td></tr>
          ${f.landMode==='lump' ? feasRow('Land, lump sum','landLump',null,'PKR')
                                : feasRow('Land rate','landRate',null,'PKR / sq ft of plot')}
          ${feasRow('Design, approvals, management','soft',null,'% of build')}
          ${feasRow('Contingency','cont',null,'% of build')}
          ${feasRow('Finance','fin',null,'% of build + land')}
          ${feasRow('Sales and marketing','mkt',null,'% of GDV')}
          ${feasRow('Target margin on cost','target',null,'% — sets residual land value')}
        </tbody></table>

        <h3>Programme and funding</h3>
        <table class="sch fin-t"><tbody>
          ${feasRow('Design and approvals','preMonths','phase','months before start')}
          ${feasRow('Construction','buildMonths','phase','months')}
          ${feasRow('Selling starts','presaleLead','phase','months before start')}
          ${feasRow('Sales period','salesMonths','phase','months')}
          ${feasRow('On booking','downPct','phase','% of price')}
          ${feasRow('Through construction','instalPct','phase','% of price')}
          ${feasRow('On possession','handoverPct','phase','% of price')}
          ${feasRow('Debt rate','debtRate','phase','% a year on drawn funds')}
        </tbody></table>

        <h3>Build rate by use</h3>
        <table class="sch fin-t"><tbody>
          ${[...new Set(r.lines.map(l=>l.use))].map(u=>
            feasRow(USE_LABEL[u]||u, u, 'build', 'PKR / sq ft')).join('')}
        </tbody></table>

        <h3>Sale rate by unit</h3>
        <table class="sch fin-t"><tbody>
          ${[...new Set(r.sale.map(l=>l.name))].map(n=>
            feasRow(n, n, 'sale', 'PKR / sq ft')).join('')}
        </tbody></table>
      </div>

      <div>
        <h3>Where the money goes</h3>
        <table class="sch"><thead><tr><th>Item</th><th>Amount</th><th>Share</th></tr></thead>
        <tbody>
          ${costRows.map(([n,v])=>`<tr><td>${n}</td><td>${M(v)}</td>
            <td>${r.tdc?(v/r.tdc*100).toFixed(1):0}%</td></tr>`).join('')}
          <tr class="sum"><td>Total development cost</td><td>${M(r.tdc)}</td><td>100%</td></tr>
        </tbody></table>

        <h3>Build cost by element</h3>
        <table class="sch"><thead><tr><th>Element</th><th>Area</th><th>Rate</th><th>Cost</th></tr></thead>
        <tbody>
          ${r.lines.map(l=>`<tr><td><span class="nm"><i style="background:${USE_COL[l.use]||'#c7c7cc'}"></i>${l.name}</span></td>
            <td>${fmt(Math.round(l.area))}</td><td>${rate(l.rate)}</td><td>${M(l.cost)}</td></tr>`).join('')}
          <tr class="sum"><td>Construction</td><td>${fmt(Math.round(r.sch.gfa))}</td>
            <td>${rate(r.sch.gfa?r.build/r.sch.gfa:0)}</td><td>${M(r.build)}</td></tr>
        </tbody></table>

        <h3>Revenue</h3>
        <table class="sch"><thead><tr><th>Unit</th><th>No.</th><th>Area</th><th>Rate</th><th>Value</th></tr></thead>
        <tbody>
          ${r.sale.map(l=>`<tr><td><span class="nm"><i style="background:${USE_COL[l.use]||'#c7c7cc'}"></i>${l.name}</span></td>
            <td>${l.count}</td><td>${fmt(Math.round(l.area))}</td>
            <td>${rate(l.rate)}</td><td>${M(l.value)}</td></tr>`).join('')}
          <tr class="sum"><td>Gross development value</td><td></td><td>${fmt(Math.round(r.netArea))}</td>
            <td>${rate(r.netArea?r.gdv/r.netArea:0)}</td><td>${M(r.gdv)}</td></tr>
        </tbody></table>

        ${(()=>{ const c = cashflow(); if (!c) return '';
          const M = v => fmtMoney(v, f);
          const W=560, H=132, pad=18;
          const bal = c.series.map(p=>p.bal);
          const lo = Math.min(0, ...bal), hi = Math.max(0, ...bal);
          const sx = i => pad + (i/(c.series.length-1)) * (W - pad*2);
          const sy = v => H - pad - ((v - lo)/((hi-lo)||1)) * (H - pad*2);
          const line = bal.map((v,i)=>`${i?'L':'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
          const zero = sy(0);
          const loss = c.profit < 0;
          return `
          <h3>Cashflow</h3>
          <div class="tot">
            <div><span>Peak funding</span><b class="num warn">${M(c.peak)}</b></div>
            <div><span>Reached</span><b class="num">month ${c.peakAt}</b></div>
            <div><span>Interest on drawn funds</span><b class="num">${M(c.interest)}</b></div>
            <div><span>Project IRR</span><b class="num ${c.irr&&c.irr>0.2?'':'warn'}">${
              c.irr!=null ? (c.irr*100).toFixed(1)+'%' : 'no return'}</b></div>
            <div><span>Cash positive</span><b class="num">${
              c.payback!=null ? 'month '+c.payback : 'not within programme'}</b></div>
            <div><span>Result after interest</span><b class="num ${loss?'warn':''}">${M(c.profit)}</b></div>
          </div>
          <svg class="cfchart" viewBox="0 0 ${W} ${H}" role="img"
               aria-label="Cumulative cash position by month">
            <line x1="${pad}" y1="${zero.toFixed(1)}" x2="${W-pad}" y2="${zero.toFixed(1)}"
                  stroke="#DEDCD5"/>
            <path d="${line}" fill="none" stroke="#111" stroke-width="1.6"/>
            <circle cx="${sx(c.peakAt).toFixed(1)}" cy="${sy(bal[c.peakAt]).toFixed(1)}"
                    r="3" fill="#E2521D"/>
            <text x="${pad}" y="${H-4}" class="cfx">month 0</text>
            <text x="${W-pad}" y="${H-4}" class="cfx" text-anchor="end">month ${c.months}</text>
            <text x="${sx(c.done).toFixed(1)}" y="12" class="cfx" text-anchor="middle">completion</text>
            <line x1="${sx(c.done).toFixed(1)}" y1="16" x2="${sx(c.done).toFixed(1)}" y2="${H-pad}"
                  stroke="#DEDCD5" stroke-dasharray="3 3"/>
          </svg>
          <p class="tiny">The residual above charges finance as a flat percentage.
            This charges it monthly on whatever is actually drawn, which is why
            the two differ: ${M(c.interest)} here against ${M(r.fin)} there.</p>`; })()}

        <p class="tiny" style="margin-top:14px">
          Residual land value is what the site is worth at a
          ${f.target}% margin on cost &mdash; the most you could pay and still
          hit that target. Breakeven is the average sale rate at which the
          scheme returns nothing.</p>
      </div>
    </div>`;

  $('feasSheet').querySelectorAll('.fin').forEach(el=>{
    const commit = () => {
      const g = el.dataset.g, k = el.dataset.k;
      const v = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
      if (el.tagName !== 'SELECT' && !isFinite(v)) return;
      feasBag(g)[k] = v;
      paintFeas();
    };
    el.addEventListener('change', commit);
  });
}
