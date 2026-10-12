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
  shopS: { key:'shopS', use:'retail',    label:'Shop',  target: 550, min: 440, max: 740, minFront:16 },
  shopL: { key:'shopL', use:'retail',    label:'Shop',  target:1000, min: 760, max:1320, minFront:26 },
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
      const score = (a * errA + b * errB) / n + Math.abs(a / n - mix) * 0.25;
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
    if (front < Math.min(tA.minFront, tB.minFront) * 0.8) return null;
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
function skeleton(typ, plate, depth, cw){
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

  if (typ === 'bar'){
    /* Corridor down the middle, units both sides, every one with an external
       wall. Depth the bands cannot use widens the corridor rather than being
       left as a dead strip. */
    /* Both bands share whatever depth is left once the corridor is taken.
       A back-of-house strip between corridor and far band was tried and cut
       that band off from the corridor, so the slack goes to the units. Past
       about 1.4x the daylight depth a bar stops making sense and the plate
       belongs to the courtyard instead. */
    const band = (short - cw) / 2;
    if (band < STD.minBand || band > depth * 1.4) return null;
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
  const rooms = (sk.back || []).slice(), core = [];

  /* Reserve the core BEFORE cutting. Carving it out afterwards either overlaps
     a unit or leaves a hole; reserving keeps the floor filling exactly. Always
     the longest run at the same fraction along it, so the shaft stacks. */
  const coreLen = nLifts * STD.liftW + nStair * STD.stairW;
  const host = runs.slice().sort((a,b)=>b.len-a.len)[0];
  const reserved = new Map(runs.map(r => [r.tag, []]));
  if (host && coreLen > 0 && host.len >= coreLen + 2*tB.minFront){
    const t0 = Math.round(((host.len - coreLen) / 2) * 100) / 100;
    reserved.set(host.tag, [[t0, coreLen]]);
    const horiz = host.axis === 'x';
    let t = t0;
    const push = (label, wide) => {
      const cwid = horiz ? wide : host.depth, cdep = horiz ? host.depth : wide;
      core.push({
        x: horiz ? host.x + t : (host.flip ? host.x - host.depth : host.x),
        y: horiz ? (host.flip ? host.y - host.depth : host.y) : host.y + t,
        w: cwid, d: cdep, area: cwid * cdep, use:'services', label, isCore:true,
      });
      t += wide;
    };
    for (let i = 0; i < nLifts; i++) push('Lift',  STD.liftW);
    for (let i = 0; i < nStair; i++) push('Stair', STD.stairW);
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
  const depth  = retail ? STD.shopDepth : STD.aptDepth;
  const cw     = retail ? STD.corridorRetail : STD.corridor;
  const tA     = retail ? TYPES.shopL : TYPES.apt2;
  const tB     = retail ? TYPES.shopS : TYPES.apt1;
  const mix    = opts.mix    != null ? opts.mix    : 0.45;
  const nLifts = opts.lifts  != null ? opts.lifts  : 2;
  const nStair = opts.stairs != null ? opts.stairs : 2;
  const A = plate.w * plate.d;

  let best = null;
  for (const typ of ['courtyard', 'bar', 'single']){
    const sk = skeleton(typ, plate, depth, cw);
    if (!sk) continue;
    const plan = fillSkeleton(sk, plate, tA, tB, mix, nLifts, nStair);
    const units = plan.rooms.filter(u => !u.isCore);
    if (!units.length) continue;

    const corr  = plan.corridor.reduce((a,c)=>a + c.w*c.d, 0) / A;
    const courtA= plan.court ? plan.court.w*plan.court.d / A : 0;
    const filled= (plan.rooms.reduce((a,u)=>a+u.area,0) / A) + corr + courtA;
    const areaErr = units.reduce((a,u)=>a + Math.abs(u.area-u.target)/u.target, 0) / units.length;

    // leaving floor unbuilt is the worst outcome, then runaway circulation
    const score = (1 - Math.min(1, filled)) * 6
                + Math.max(0, corr - 0.18) * 8
                + areaErr
                + courtA * 0.35;             // a void is useful, but it is not lettable
    plan.typology = typ;
    plan.metrics = { corr, filled, areaErr, courtA, score };
    if (!best || score < best.metrics.score) best = plan;
  }
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

module.exports = { planStorey, checkAccess, checkOverlap, cutRun, overlaps, STD, TYPES };
