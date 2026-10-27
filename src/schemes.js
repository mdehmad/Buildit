/* Option schemes
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters.

   Generation used to run the annealer five times with five different seeds and
   call the results five options. The seeds only shuffled the bay assignment,
   which stopped being what gets drawn when space planning moved off the bay
   grid, so all five came back as the same building: identical footprint,
   identical storey count, identical plans, identical schedule. The only number
   that differed was a score nothing read any more.

   An option is now a scheme -- a different design decision about the same site
   and the same FAR allowance. Three levers do the work:

     inset     holds the footprint back from the setback line, so the same
               allowance has to go up instead of out. This is what separates a
               slab from a tower, and it moves footprint, storey count, height,
               floor plate, wall-to-floor ratio and cost per sq ft together.
     prefer    asks for a typology. Honoured only if the plate can carry it
               soundly -- see planStorey.
     unitMix   the share of the larger unit type, so one scheme is mostly
               2 beds and large shops and another is mostly 1 beds and small
               ones. Drives unit count, net area and therefore GDV.

   Each scheme carries its own voxel graph, program graph, plans and storey
   count, so switching option switches the whole building rather than a layer
   on top of a shared one. */

/* Each scheme must pull a lever none of the others pulls, or two of them come
   back as the same building and the ribbon is back to showing five shades of
   one answer. A "balanced, best fit" scheme was the first casualty of that
   rule: best fit on most plates is the double-loaded slab, so it was simply
   that scheme under another name. The recommendation is made instead by
   marking whichever scheme returns the most lettable area. */
const SCHEMES = [
  { key:'slab', name:'Double-loaded slab',
    note:'One central corridor serving both sides. The least circulation per unit.',
    prefer:'bar', unitMix:0.45, shopMix:0.45 },

  { key:'block', name:'Perimeter block',
    note:'Units wrapped round a courtyard, so most get daylight on two sides. '
       + 'Costs lettable floor to buy that.',
    prefer:'courtyard', unitMix:0.45, shopMix:0.50 },

  { key:'compact', name:'Compact units',
    note:'Mostly 1 beds and small shops: more units, more frontage, more doors '
       + 'and lifts to serve them.',
    prefer:'auto', unitMix:0.12, shopMix:0.15 },

  /* A tower carries its own massing. Holding the footprint back under a taper
     pinches the top floors out as well, so the allowance stops fitting and the
     scheme comes back as the same building with less in it. Extruded, the
     storeys it gains pay for the plate it gives up. */
  { key:'tower', name:'Tower on podium',
    note:'Footprint held back and the allowance taken upward, freeing ground. '
       + 'More facade per sq ft to build and to heat.',
    footprint:0.75, massing:'extrude', prefer:'bar', unitMix:0.45, shopMix:0.45 },

  { key:'shallow', name:'Shallow plan',
    note:'Narrower bands front to back: better daylight and cross-ventilation, '
       + 'paid for in corridor.',
    prefer:'auto', unitMix:0.45, shopMix:0.45, depthScale:0.76 },

  { key:'large', name:'Large units',
    note:'Mostly 2 beds and large shops: fewer units, each at a higher rate.',
    prefer:'auto', unitMix:0.88, shopMix:0.85 },
];

/* A scheme's own cfg. The storey count is not a user input: it falls out of the
   allowance divided by the plate, so holding the footprint back here has to be
   followed by re-sizing the building, or the voxel graph gets stacked to the
   full-footprint storey count and overshoots the FAR. */
function schemeCfg(base, site, sch, inset){
  const cfg = { ...base, plotInset: inset, scheme: sch };
  if (sch.massing) cfg.massing = sch.massing;
  const z = sizeBuilding(site, cfg);
  cfg.stories = z.storeys;
  cfg.allowed = z.allowed;
  cfg.stack   = resolveStack(state.stack, z.storeys);
  cfg.size    = z;
  return cfg;
}

/* How far to hold the footprint back, in feet, for a scheme that asks for a
   share of the full footprint.

   This has to be searched rather than calculated. A bay is buildable or it is
   not, so the footprint only moves in whole bays: insetting by a few feet
   leaves the plate exactly as it was while still shifting the storey count,
   which is how the first attempt produced a 20-storey building on an unchanged
   plate. And every foot given up has to be won back in height, so the search
   only accepts an inset that still houses the whole FAR allowance -- otherwise
   the scheme is not a different building, just a smaller one.

   Returns the inset in feet, or -1 if no inset both shrinks the plate and
   keeps the allowance, in which case the caller drops the scheme. */
function resolveInset(base, site, ref, sch){
  if (!sch.footprint || !ref) return 0;
  const refA = ref.w * ref.d, step = Math.max(2, base.bay / 4);
  // an inset comes off both sides, so this is what keeps 45 ft of plate
  const limit = (Math.min(ref.w, ref.d) - 45) / 2;
  let found = -1;
  for (let t = step; t <= limit; t += step){
    const cfg = { ...base, plotInset: t, massing: sch.massing || base.massing };
    const z = sizeBuilding(site, cfg);
    if (z.built < z.allowed * 0.98) break;         // past here the allowance is lost
    const vg = buildVoxelGraph(site, { ...cfg, stories: Math.max(1, z.storeys) });
    const pl = storeyPlate(vg, 0);
    if (!pl) break;
    const share = pl.w * pl.d / refA;
    if (share >= 0.98) continue;                   // no bay has dropped yet
    found = t;
    if (share <= sch.footprint) break;             // small enough; stop giving up plate
  }
  return found;
}

/* Build one scheme all the way to plans. Returns null if the inset or the
   setbacks leave nothing to build, in which case the scheme is skipped rather
   than shown as an empty option. */
function buildScheme(base, site, sch, ref, iters, seed){
  const inset = resolveInset(base, site, ref, sch);
  if (inset < 0) return null;        // asked to hold the footprint back, and could not
  const cfg = schemeCfg(base, site, sch, inset);
  const vg = buildVoxelGraph(site, cfg);
  if (!vg.voxels.length) return null;
  const pg = buildProgramGraph(vg, cfg);

  /* buildPlans reads state.vg to put the lobby in the room the entrance lands
     in, so this scheme's graph has to be installed before its plans are cut. */
  const keep = { vg: state.vg, pg: state.pg, cfg: state.cfg, stale: state.vgStale };
  state.vg = vg; state.pg = pg; state.cfg = cfg; state.vgStale = false;
  let plan;
  try { plan = buildPlans(vg, pg, cfg); }
  finally { Object.assign(state, { vg:keep.vg, pg:keep.pg, cfg:keep.cfg, vgStale:keep.stale }); }

  const b = solve(vg, pg, { iters, seed });
  b.contig = contiguity(vg, pg, b.state.assign);
  return { ...b, sch, cfg, vg, pg, plan, edits:{} };
}

/* What distinguishes this option from the others, in numbers. The ribbon and
   the compare table both read this, so they cannot drift apart. */
function schemeStats(o){
  const plate = storeyPlate(o.vg, 0);
  let units = 0, net = 0, gfa = 0;
  for (const p of o.plan){
    if (!p) continue;
    for (const r of p.rooms){
      if (r.isCore || !r.target) continue;
      units++; net += r.area;
    }
    gfa += p.gross || 0;
  }
  return {
    name: o.sch.name, note: o.sch.note, typology: typologyOf(o),
    storeys: o.cfg.stories, height: o.cfg.stories * o.cfg.floorH,
    footprint: plate ? plate.w * plate.d : 0,
    units, net, gfa, eff: gfa ? net / gfa : 0,
  };
}

/* The typology the plates actually came out as, which is not always the one the
   scheme asked for -- planStorey falls back when the plate cannot carry it. */
function typologyOf(o){
  const seen = new Map();
  for (const p of o.plan){
    if (!p || !p.typology || p.typology === 'none') continue;
    const t = p.typology.replace('!', '');
    seen.set(t, (seen.get(t) || 0) + 1);
  }
  if (!seen.size) return '—';
  /* A scheme rarely comes out as one typology all the way up: the retail
     storeys have a different band depth from the flats above them, and a
     tapered plate stops carrying a courtyard partway up. Reporting only the
     most common one labelled the perimeter block as a bar and hid the reason
     its efficiency was five points lower than the slab's. */
  return [...seen].sort((a,b)=>b[1]-a[1]).map(([t,n])=>`${t} ×${n}`).join(' + ');
}

/* Install an option: its envelope, its program, its plans and its storey
   count all become the live building. Plan edits are held on the option, so
   switching away and back does not throw them away. */
function applyOption(i){
  const o = state.options[i];
  if (!o) return;
  state.pick = i;
  state.cfg = o.cfg; state.vg = o.vg; state.pg = o.pg; state.plan = o.plan;
  state.size = o.cfg.size; state.vgStale = false;
  state.edits = o.edits || (o.edits = {});
  dirtyEdits();
  if (state.floor >= o.cfg.stories) state.floor = -1;
  state.parking = buildParking();
}
