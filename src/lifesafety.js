/* Occupant load, core demand and means of escape
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ============================================================================
   Basements and parking.

   Parking usually decides what a site can actually carry: a scheme that sells
   well on paper is undeliverable if the cars will not fit. Basements sit below
   grade, are excluded from the floor area ratio in most bye-laws, and are
   counted in the cost at their own rate.
   ========================================================================== */
const PARK = {
  bayW: 8.5, bayD: 18,      // a standard 90-degree bay
  aisle: 24,                // two-way aisle between facing rows
  rampW: 14, rampSlope: 8,  // 1 in 8, which is the usual working maximum
  wall: 1.5,                // perimeter retaining wall
};

/* Spaces required, by use. These ratios vary by city and are the single most
   locally-amended figure in any bye-law, so they are inputs, not constants. */
const parkDefaults = () => ({
  perOneBed:1, perTwoBed:1.5,
  per1000Retail:2.5, per1000Office:3.3,
  visitorPct:10,
  basementSetback:5,        // how far the basement box sits inside the plot
  levels:'auto',            // or a number
});

function parkingDemand(){
  const sch = schedule(); if (!sch) return null;
  const p = state.park || (state.park = parkDefaults());
  let spaces = 0; const lines = [];
  const add = (label, n, why) => { if (n>0){ spaces += n; lines.push({label, n:Math.ceil(n), why}); } };

  for (const r of sch.rows){
    if (!r.unit) continue;
    if (r.name === '1 Bed') add('1 bed', r.count * p.perOneBed, `${r.count} x ${p.perOneBed}`);
    else if (r.name === '2 Bed') add('2 bed', r.count * p.perTwoBed, `${r.count} x ${p.perTwoBed}`);
    else if (r.use === 'retail' || r.use === 'restaurant')
      add('Retail', r.area/1000 * p.per1000Retail, `${fmt(Math.round(r.area))} sq ft`);
    else if (r.use === 'office' || r.use === 'coworking')
      add('Office', r.area/1000 * p.per1000Office, `${fmt(Math.round(r.area))} sq ft`);
  }
  const visitors = spaces * (p.visitorPct/100);
  add('Visitors', visitors, `${p.visitorPct}% of the above`);
  return { required: Math.ceil(spaces), lines, cfg:p };
}

/* Lay one basement level out: rows of bays either side of an aisle, with the
   ramp and the core punched out of them. */
function planParkingLevel(plate, obstacles){
  const { x, y, w, d } = plate;
  const alongX = w >= d;                  // rows run along the longer side
  const runLen = alongX ? w : d;
  const span   = alongX ? d : w;
  const bays = [], aisles = [];

  const blocked = (r) => obstacles.some(o =>
    o.x < r.x + r.w - 0.01 && r.x < o.x + o.w - 0.01 &&
    o.y < r.y + r.d - 0.01 && r.y < o.y + o.d - 0.01);

  const place = (off, depth, kind) => {
    // one strip across the plate, at `off` from its near edge
    const rect = alongX ? { x, y: y + off, w: runLen, d: depth }
                        : { x: x + off, y, w: depth, d: runLen };
    if (kind === 'aisle'){ aisles.push({ ...rect, use:'corridor' }); return; }
    const n = Math.floor(runLen / PARK.bayW);
    const pad = (runLen - n * PARK.bayW) / 2;
    for (let i = 0; i < n; i++){
      const t = pad + i * PARK.bayW;
      const b = alongX ? { x: x + t, y: rect.y, w: PARK.bayW, d: depth }
                       : { x: rect.x, y: y + t, w: depth, d: PARK.bayW };
      if (blocked(b)) continue;
      bays.push({ ...b, area: b.w * b.d, use:'parking', label:'Bay' });
    }
  };

  /* Double-loaded modules first: bay, aisle, bay. Anything left over takes a
     single-loaded row if it can, and is otherwise circulation. */
  const mod = PARK.bayD * 2 + PARK.aisle;
  let off = 0;
  while (span - off >= mod){
    place(off, PARK.bayD, 'bay');
    place(off + PARK.bayD, PARK.aisle, 'aisle');
    place(off + PARK.bayD + PARK.aisle, PARK.bayD, 'bay');
    off += mod;
  }
  if (span - off >= PARK.bayD + PARK.aisle){
    place(off, PARK.bayD, 'bay');
    place(off + PARK.bayD, PARK.aisle, 'aisle');
    off += PARK.bayD + PARK.aisle;
  }
  if (span - off > 1){
    const rect = alongX ? { x, y:y+off, w:runLen, d:span-off }
                        : { x:x+off, y, w:span-off, d:runLen };
    aisles.push({ ...rect, use:'corridor' });
  }
  return { plate, bays, aisles, count: bays.length };
}

/* The whole basement stack. */
function buildParking(){
  const vg = state.vg; if (!vg) return null;
  const dem = parkingDemand(); if (!dem) return null;
  const p = state.park;

  /* The basement box is the plot inset by its own setback, in the grid frame
     so it lines up with the structure above. */
  const pts = state.site.pts.map(q => toGrid(q));
  const xs = pts.map(q=>q.x), ys = pts.map(q=>q.y);
  const inset = (p.basementSetback||0) + PARK.wall;
  const plate = { x:Math.min(...xs)+inset, y:Math.min(...ys)+inset,
                  w:(Math.max(...xs)-Math.min(...xs)) - inset*2,
                  d:(Math.max(...ys)-Math.min(...ys)) - inset*2 };
  if (plate.w < 40 || plate.d < 40) return null;

  /* The core continues down, in the same place, and the ramp eats a strip of
     the first level. */
  const g0 = (state.plan||[])[0];
  /* Only the shafts continue down, not the full-depth core rooms of the tower
     plan. Blocking bays with a 32 ft deep room where a 9 ft lift pit actually
     sits was costing about a third of the spaces on every level. */
  const shaft = r => {
    const isLift = r.label === 'Lift';
    const sw = isLift ? STD.liftW : STD.stairW;
    const sd = isLift ? 9 : 22;
    const w = Math.min(r.w, Math.max(sw, sd * (r.w > r.d ? 1 : 0)) || sw);
    const d = Math.min(r.d, r.w > r.d ? sw : sd);
    return { x: r.x + (r.w - Math.min(r.w, w))/2, y: r.y + (r.d - Math.min(r.d, d))/2,
             w: Math.min(r.w, w), d: Math.min(r.d, d) };
  };
  const coreRects = g0 ? g0.rooms.filter(r=>r.isCore).map(shaft) : [];
  const drop = (state.cfg ? state.cfg.floorH : 11) + 0.5;
  const rampLen = Math.min(plate.d * 0.8, drop * PARK.rampSlope);
  const ramp = { x: plate.x + plate.w - PARK.rampW, y: plate.y,
                 w: PARK.rampW, d: rampLen, use:'corridor', label:'Ramp' };

  const want = dem.required;
  const levels = [];
  const maxLevels = p.levels === 'auto' ? 4 : Math.max(0, +p.levels || 0);
  let supply = 0;
  for (let i = 0; i < maxLevels; i++){
    const obstacles = coreRects.concat(i === 0 ? [ramp] : []);
    const lv = planParkingLevel(plate, obstacles);
    lv.level = i + 1;
    lv.core = coreRects;
    lv.ramp = i === 0 ? ramp : null;
    lv.gross = plate.w * plate.d;
    levels.push(lv);
    supply += lv.count;
    if (p.levels === 'auto' && supply >= want) break;
  }
  return { levels, supply, required: want, demand: dem, plate,
           short: supply < want,
           gross: levels.reduce((a,l)=>a+l.gross, 0) };
}

/* A basement level, drawn the same way as a storey plan. */
function drawParkingPlan(cv, idx, size){
  const park = state.parking; if (!park) return;
  const lv = park.levels[idx]; if (!lv) return;
  const g = cv.getContext('2d'), dpr = Math.min(devicePixelRatio,2);
  cv.width = size*dpr; cv.height = size*dpr;
  g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle = '#fff'; g.fillRect(0,0,size,size);

  const pl = lv.plate, m = 26;
  const k = (size - m*2) / Math.max(pl.w, pl.d);
  const ox = m + ((size-m*2) - pl.w*k)/2 - pl.x*k;
  const oy = m + ((size-m*2) - pl.d*k)/2 - pl.y*k;
  const R = (r, fill, stroke) => {
    g.fillStyle = fill;
    g.fillRect(ox+r.x*k, oy+r.y*k, r.w*k, r.d*k);
    if (stroke){ g.strokeStyle = stroke; g.lineWidth = 1; 
      g.strokeRect(ox+r.x*k, oy+r.y*k, r.w*k, r.d*k); }
  };
  // the box itself
  R(pl, '#F4F3EF', '#DEDCD5');
  for (const a of lv.aisles) R(a, tint(USE_COL.corridor, 0.4));
  for (const bth of lv.bays)  R(bth, tint(USE_COL.parking, 0.45), 'rgba(17,17,17,.22)');
  for (const c of lv.core)   R(c, tint(USE_COL.elevator, 0.5), '#3a3a3c');
  if (lv.ramp){
    R(lv.ramp, tint(USE_COL.mech, 0.5), '#3a3a3c');
    if (size >= 230){
      g.save(); g.fillStyle='#4A4A48'; g.font='600 9px var(--mono),monospace';
      g.textAlign='center'; g.textBaseline='middle';
      g.fillText('RAMP', ox+(lv.ramp.x+lv.ramp.w/2)*k, oy+(lv.ramp.y+lv.ramp.d/2)*k);
      g.restore();
    }
  }
  if (size >= 230){
    g.fillStyle='#1d1d1f'; g.font='600 11px -apple-system,Inter,sans-serif';
    g.textAlign='left'; g.textBaseline='alphabetic';
    g.fillText(`Basement ${idx+1}`, 14, size-20);
    g.font='400 9px var(--mono),monospace'; g.fillStyle='#86868b';
    g.fillText(`${lv.count} bays · ${PARK.bayW}′ × ${PARK.bayD}′ · `
      + `${Math.round(lv.gross/Math.max(1,lv.count))} sq ft per car`, 14, size-9);
  }
}
