/* The pages that are not a drawing: the brief review, saved schemes, the plot
   reference and the rules reference.
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ---------------------------------------------------------------------------
   Review — the last card of the brief, so you can read the whole thing back
   before spending a solve on it.
--------------------------------------------------------------------------- */
function paintReview(){
  const b = baseCfg(), z = sizeNow();
  const sb = state.site.setbacks;
  const uses = [...new Set(resolveStack(state.stack, z.storeys))]
    .map(u => USE_LABEL[u] || u).join(', ');
  const rows = [
    ['Plot', `${fmt(Math.round(Math.abs(polyArea(state.site.pts))))} sq ft
      &middot; ${state.site.pts.length} edges${state.loc ? ' &middot; ' + state.loc : ''}`],
    ['Setbacks', sb.map(v => v + ' ft').join(' &middot; ')],
    ['Ratio', `1:${state.ratio} &mdash; ${fmt(Math.round(z.allowed))} sq ft permissible`],
    ['Storeys', `${z.storeys} at ${b.floorH} ft, ${z.height} ft tall
      (limit ${b.heightLimit} ft)`],
    ['Uses', uses || '—'],
    ['Unit mix', state.mix.map(m => m.name).join(', ') || '—'],
    ['Structure', `${b.bay} ft bays${b.gridAngle ? ', grid at ' + b.gridAngle + '°' : ''}
      &middot; ${MASSINGS.find(m => m[0] === state.massing)[1].toLowerCase()} form`],
    ['Core', `${+$('cLiftN').value} lift${+$('cLiftN').value > 1 ? 's' : ''},
      ${+$('cStairN').value} stair${+$('cStairN').value > 1 ? 's' : ''},
      ${$('cSprink').checked ? 'sprinklered' : 'not sprinklered'}`],
    ['Options', `${+$('sOpts').value} scheme${+$('sOpts').value > 1 ? 's' : ''}`],
  ];
  $('review').innerHTML = rows.map(([k,v]) =>
    `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('allowNote2').innerHTML = $('allowNote').innerHTML;
}

/* ---------------------------------------------------------------------------
   My schemes.
--------------------------------------------------------------------------- */
function paintProjects(){
  const q = ($('projSearch').value || '').trim().toLowerCase();
  const list = readStore().filter(p => !q || (p.name || '').toLowerCase().includes(q));
  $('navCount').textContent = readStore().length;
  if (!list.length){
    $('projList').innerHTML = `<div class="empty-state">
      ${HELP ? HELP.mimarSVG('mood-think mini') : ''}
      <p>${q ? 'No scheme matches “' + q + '”.'
            : 'Nothing saved yet. Build a scheme and press Save.'}</p></div>`;
    return;
  }
  $('projList').innerHTML = `<div class="pgrid">${list.map(p => `
    <div class="pcard${p.id === state.projectId ? ' on' : ''}" data-id="${p.id}">
      <b>${p.name}</b>
      <span class="tiny">${new Date(p.updated).toLocaleDateString()}
        ${p.card && p.card.gfa ? '&middot; ' + fmt(p.card.gfa) + ' sq ft' : '&middot; not solved'}</span>
      <span class="tiny">${p.card && p.card.units ? p.card.units + ' units' : ''}
        ${p.card && p.card.margin != null ? '&middot; ' + (p.card.margin*100).toFixed(0) + '% on cost' : ''}</span>
      <div class="pacts">
        <button data-act="open" data-id="${p.id}">Open</button>
        <button data-act="dup"  data-id="${p.id}">Duplicate</button>
        <button data-act="del"  data-id="${p.id}" class="danger">Delete</button>
      </div>
    </div>`).join('')}</div>`;
  wireProjectCards($('projList'));
}

/* ---------------------------------------------------------------------------
   Plot presets. The standard plot sizes people actually buy here, and what the
   ratio currently set would allow on each. Picking one loads it as the site.
--------------------------------------------------------------------------- */
const PLOT_PRESETS = [
  { w: 25,  d: 50,  name: '5 Marla',   note: 'Shop row or a small block' },
  { w: 30,  d: 60,  name: '8 Marla',   note: 'Corner plaza' },
  { w: 35,  d: 70,  name: '10 Marla',  note: 'Mixed use, lifts just viable' },
  { w: 50,  d: 90,  name: '1 Kanal',   note: 'A double-loaded bar fits across' },
  { w: 60,  d: 120, name: '1.6 Kanal', note: 'Courtyard becomes possible' },
  { w: 75,  d: 120, name: '2 Kanal',   note: 'Full perimeter block' },
  { w: 100, d: 170, name: '4 Kanal',   note: 'Tower and podium' },
  { w: 130, d: 170, name: '5 Kanal',   note: 'Anything on this list' },
];

/* What a preset would actually yield, at the settings currently in the brief.
   Running the real sizing rather than a rule of thumb means the page cannot
   drift away from what pressing Generate would give you. */
function presetYield(pre){
  const pts = [{x:0,y:0},{x:pre.w,y:0},{x:pre.w,y:pre.d},{x:0,y:pre.d}];
  const setbacks = new Array(4).fill(0).map((_, i) => state.site.setbacks[i] != null
    ? state.site.setbacks[i] : 10);
  const site = { pts, setbacks };
  const cfg = baseCfg();
  const z = sizeBuilding(site, cfg);
  const vg = buildVoxelGraph(site, { ...cfg, stories: Math.max(1, z.storeys), allowed: z.allowed });
  const plate = vg.voxels.length ? storeyPlate(vg, 0) : null;
  return { ...z, plate: plate ? plate.w * plate.d : 0, area: pre.w * pre.d,
    eatW: (setbacks[1] || 0) + (setbacks[3] || 0),
    eatD: (setbacks[0] || 0) + (setbacks[2] || 0) };
}

function paintPlots(){
  const rows = PLOT_PRESETS.map(p => ({ p, y: presetYield(p) }));
  const max = Math.max(1, ...rows.map(r => r.y.allowed));
  $('plotsPage').innerHTML = `<div class="pgrid wide">${rows.map(({p,y}) => `
    <div class="card card-pad plot-card" data-w="${p.w}" data-d="${p.d}">
      <div class="row between"><b>${p.name}</b>
        <span class="tiny">${p.w} &times; ${p.d} ft</span></div>
      <p class="hint" style="margin:2px 0 10px">${p.note}</p>
      <div class="bar"><i style="width:${(y.allowed/max*100).toFixed(1)}%"></i></div>
      <dl class="mini">
        <div><dt>Plot</dt><dd>${fmt(y.area)} sq ft</dd></div>
        <div><dt>Ground plate</dt><dd>${y.plate ? fmt(Math.round(y.plate)) + ' sq ft' : 'nothing fits'}</dd></div>
        <div><dt>Permissible</dt><dd>${fmt(Math.round(y.allowed))} sq ft</dd></div>
        <div><dt>Storeys</dt><dd>${y.plate ? y.storeys : '—'}</dd></div>
      </dl>
      ${y.plate ? '' : `<p class="hint" style="margin:-4px 0 10px">Your setbacks take
        ${y.eatW} ft of the ${p.w} ft frontage and ${y.eatD} ft of the ${p.d} ft depth,
        leaving no whole bay standing. Starting from this plot brings them back to fit.</p>`}
      <button class="btn sm" data-use="1">Start from this plot</button>
    </div>`).join('')}</div>
    <p class="hint" style="margin-top:14px">At 1:${state.ratio} with your current
      setbacks, height limit and ${baseCfg().bay} ft bays. Change those in the
      brief and these move with them.</p>`;

  $('plotsPage').querySelectorAll('[data-use]').forEach(b => b.onclick = () => {
    const c = b.closest('.plot-card');
    usePlot(+c.dataset.w, +c.dataset.d);
  });
}

/* Load a rectangular plot of the given size as the site, and open the brief. */
function usePlot(w, d){
  state.site.pts = [{x:0,y:0},{x:w,y:0},{x:w,y:d},{x:0,y:d}];
  while (state.site.setbacks.length < 4) state.site.setbacks.push(10);
  state.site.setbacks.length = 4;
  state.entrances = []; state.vgStale = true; state.fitPending = true;
  const fitted = fitSetbacks();
  paintEdgeRows(); plotNote(); resize2(); paintSite(); invalidate();
  showView('site');
  if (HELP) HELP.toast({ title:`${w} × ${d} ft plot loaded`,
    text: fitted
      ? `Your setbacks were too deep for a plot this size, so they came back to ${fitted.join('/')} ft. Change them below.`
      : 'Setbacks and the ratio are whatever you last used. Change them below.' });
}

/* ---------------------------------------------------------------------------
   Rules used — what the tool actually checks, said plainly. The point is that
   none of this is guessed: every figure here is the one the code applies.
--------------------------------------------------------------------------- */
const RULE_GROUPS = [
  { title: 'Envelope', rows: [
    ['Setbacks', 'Per edge, in feet. A structural bay is buildable only if all four of its corners clear every setback line, so slabs never overhang.'],
    ['Floor area ratio', 'Permissible covered area is plot area × the ratio. Whole storeys are taken while they fit, then one part storey for the slack, cut back a whole edge line at a time.'],
    ['Height', 'A flat limit in feet, divided by the floor-to-floor to cap the storey count. Whichever of ratio, height or plot binds first is named on the brief.'],
    ['Upper storeys', 'The form setting decides how much each plate is held back from the one below: none when extruded, a fixed inset per storey when tapered, in groups of three when stepped, accelerating when crowned.'],
  ]},
  { title: 'Means of escape — IBC', rows: [
    ['Occupant load', 'Table 1004.5, by use: 200 ft² per person residential, 60 ft² assembly, 30 ft² mercantile on grade.'],
    ['Exits per storey', '1006.3.2 — two from any storey above the occupant-load threshold, three above 500 occupants, four above 1,000.'],
    ['Stair width', '1005.3.1 — 0.3 inches per occupant unsprinklered, 0.2 inches sprinklered, never less than 44 inches.'],
    ['Travel distance', '1017.2 — measured along the corridor by shortest path, not as the crow flies. 200 ft, or 250 ft sprinklered.'],
    ['Dead ends', '1020.4 — 20 ft, or 50 ft sprinklered.'],
    ['Exit remoteness', '1007.1.1 — two exits at least a third of the plate’s diagonal apart, which is why the stairs sit at opposite ends of the longest run.'],
  ]},
  { title: 'Parking', rows: [
    ['Bay size', '8′-6″ × 18′-0″, in double-loaded modules with 24 ft aisles.'],
    ['Ramp', '1 in 8, taken off the usable area of each basement level.'],
    ['Floor area ratio', 'Basements sit outside the ratio but inside the cost, so they add development cost with no revenue against them.'],
  ]},
  { title: 'Planning', rows: [
    ['Unit areas', 'Units are cut by frontage along the corridor, inside a minimum and maximum area for their type, so a 1 bed lands near its target rather than being rounded to whole bays.'],
    ['Access', 'Every unit shares a real edge with a corridor by construction. An edit that would break that is undone.'],
    ['Circulation', 'Held under 21% of the plate across a sweep of 6,048 plate sizes.'],
    ['Plannable area', 'Plans are laid on the largest rectangle in which every bay is buildable, so nothing is drawn over ground that failed the setback test.'],
  ]},
  { title: 'What is not checked', rows: [
    ['Structure', 'Columns, beams and slabs are drawn to make the massing read as a building. They are not sized and carry no engineering meaning.'],
    ['Daylight and planning law', 'No daylight angles, no rights of light, no height planes beyond the flat limit, no local zoning beyond the setbacks and ratio you enter.'],
    ['Cost', 'Every rate is an indicative placeholder, not market data. Replace them before the numbers leave your desk.'],
  ]},
];

function paintRulesPage(){
  $('rulesPage').innerHTML = `
    <div class="card card-pad">
      <h2>The rules buildIT applies</h2>
      <p class="sub">Everything the tool checks, and the figure it checks against.
        What is not on this list is not checked.</p>
    </div>
    ${RULE_GROUPS.map(g => `<div class="card card-pad">
      <h3>${g.title}</h3>
      <dl class="rules">${g.rows.map(([k,v]) =>
        `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    </div>`).join('')}`;
}

/* The same reference, but measured against the scheme on screen: the
   Compliance tab of the workspace. */
function paintRulesTab(){
  const el = $('rulesSheet');
  if (!state.options.length || !state.plan){
    el.innerHTML = '<div class="empty-note">Generate a scheme to check it.</div>';
    return;
  }
  const s = schedule(), g = egressReport(), pk = state.parking;
  const over = s.far > state.ratio + .01;
  const row = (ok, title, detail) =>
    `<div class="chk-row ${ok ? 'ok' : 'bad'}">
      <span class="pill ${ok ? 'ok' : 'bad'}">${ok ? 'Pass' : 'Check'}</span>
      <div><b>${title}</b><span>${detail}</span></div></div>`;

  const bad = g.bad.length;
  el.innerHTML = `<h2>Compliance</h2>
    <p class="sub">Measured against the scheme on screen, by the rules on the
      <a href="#rules" data-view="rules">Rules used</a> page.</p>
    ${row(!over, 'Floor area ratio',
      `Achieved 1:${s.far.toFixed(2)} against a 1:${state.ratio} limit —
       ${(s.used*100).toFixed(0)}% of the permissible area built.`)}
    ${row(s.far <= state.ratio + .01 && state.cfg.stories * state.cfg.floorH <= baseCfg().heightLimit,
      'Height', `${state.cfg.stories} storeys at ${state.cfg.floorH} ft is
       ${state.cfg.stories * state.cfg.floorH} ft, against a ${baseCfg().heightLimit} ft limit.`)}
    ${row(!bad, 'Means of escape', bad
      ? `${bad} storey${bad>1?'s':''} fail: ${g.bad.map(x=>`L${x.lvl} ${x.reason || (x.fails||[]).join(', ')}`).join('; ')}`
      : `All ${g.per.length} storeys pass travel distance, dead ends, exit count,
         stair width and remoteness.`)}
    ${pk ? row(!pk.short, 'Parking', pk.short
      ? `${pk.supply} spaces over ${pk.levels.length} basements against ${pk.required} required.`
      : `${pk.supply} spaces over ${pk.levels.length} basements against
         ${pk.required} required, at ${Math.round(pk.gross/Math.max(1,pk.supply))} sq ft per car.`) : ''}
    ${row(true, 'Unit access', 'Every unit shares an edge with a corridor by construction.')}
    <p class="hint" style="margin-top:16px">Setbacks, ratio and height are the only
      bye-laws checked. There is no daylight, zoning or structural check here.</p>`;
}

/* ---------------------------------------------------------------------------
   Customise tab — the storey thumbnails again, but opening the wall editor.
--------------------------------------------------------------------------- */
function paintEditGrid(){
  const el = $('editGrid');
  if (!state.options.length || !state.plan){
    el.innerHTML = '<div class="empty-note">Generate a scheme to edit it.</div>';
    return;
  }
  paintPlans(el);
}
