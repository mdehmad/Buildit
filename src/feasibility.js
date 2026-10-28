/* Residual appraisal, projects and the dashboard
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ============================================================================
   Projects.

   A project is the inputs, never the output: the site, the rules, the program
   and the appraisal assumptions. Options are re-solved when it opens, so a
   saved project stays small and never goes stale against a newer solver.

   Storage is best-effort. The published page keeps projects in the browser,
   but an artifact sandbox may refuse localStorage outright, so every call is
   guarded and falls back to memory for the session. Losing a project silently
   would be worse than saying plainly that it was not saved.
   ========================================================================== */
const PKEY = 'buildit.projects.v1';
let memProjects = null, storeWorks = true;

function readStore(){
  if (memProjects) return memProjects;
  try {
    const raw = localStorage.getItem(PKEY);
    memProjects = raw ? JSON.parse(raw) : [];
  } catch(_) { storeWorks = false; memProjects = []; }
  return memProjects;
}
function writeStore(list){
  memProjects = list;
  try { localStorage.setItem(PKEY, JSON.stringify(list)); }
  catch(_) { storeWorks = false; }
  return storeWorks;
}

const UI_FIELDS = ['sFh','sBay','sUp','sHl','sAng','sTwist','sCor','sIter','sOpts',
                   'cStairN','cStairs','cLiftN','cLifts','cWc','cSvc'];

function projectSnapshot(){
  const ui = {};
  for (const id of UI_FIELDS){ const el = $(id); if (el) ui[id] = el.value; }
  return {
    site: JSON.parse(JSON.stringify(state.site)),
    mix:  JSON.parse(JSON.stringify(state.mix)),
    stack: state.stack.slice(),
    entrances: (state.entrances||[]).map(e=>({x:e.x, y:e.y})),
    ratio: state.ratio, style: state.style, material: state.material,
    massing: state.massing, loc: state.loc || '',
    feas: JSON.parse(JSON.stringify(state.feas || feasDefaults())),
    ui,
  };
}
function applyProject(p){
  state.site = JSON.parse(JSON.stringify(p.site));
  state.mix  = JSON.parse(JSON.stringify(p.mix));
  state.stack = (p.stack||['retail','apartment']).slice();
  // entrances saved before they moved to site coordinates cannot be placed
  state.entrances = (p.entrances||[]).filter(e=>e.x!=null&&e.y!=null)
                                     .map(e=>({x:e.x, y:e.y}));
  state.ratio = p.ratio; state.style = p.style; state.material = p.material;
  state.massing = p.massing; state.loc = p.loc || '';
  state.feas = JSON.parse(JSON.stringify(p.feas || feasDefaults()));
  for (const id in (p.ui||{})){ const el = $(id); if (el) el.value = p.ui[id]; }
  state.options = []; state.edits = {}; state.plan = null; dirtyEdits();
  if ($('locName')) $('locName').value = state.loc;
  syncLabels(); paintRatios(); paintMassing(); paintUsePicker();
  paintStyles(); paintMats(); paintEdgeRows(); coreNote();
  resize2(); paintSite();
}

function newProjectId(){ return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function saveProject(name){
  const list = readStore();
  const now = Date.now();
  const snap = projectSnapshot();
  const r = (state.options.length && state.plan) ? feasibility() : null;
  const card = {
    gfa: r ? Math.round(r.sch.gfa) : null,
    units: r ? r.sale.reduce((a,x)=>a+x.count,0) : null,
    far: r ? r.sch.far : null,
    profit: r ? r.profit : null,
    margin: r ? r.onCost : null,
    cur: state.feas ? state.feas.cur : 'PKR',
    fx: state.feas ? state.feas.fx : 280,
  };
  let p = list.find(x=>x.id === state.projectId);
  if (p){ Object.assign(p, { name:name||p.name, data:snap, card, updated:now }); }
  else {
    p = { id:newProjectId(), name:name||'Untitled scheme', data:snap, card,
          created:now, updated:now };
    list.unshift(p); state.projectId = p.id;
  }
  state.projectName = p.name;
  const ok = writeStore(list);
  paintProjectName();
  flag(ok ? 'Saved — ' + p.name
          : 'Could not save — this browser is blocking local storage');
  return p;
}
function openProject(id){
  const p = readStore().find(x=>x.id===id); if(!p) return;
  state.projectId = p.id; state.projectName = p.name;
  applyProject(p.data); paintProjectName();
  showView('site'); generate(false);
  flag('Opened — ' + p.name);
}
function duplicateProject(id){
  const list = readStore(), p = list.find(x=>x.id===id); if(!p) return;
  const copy = { ...JSON.parse(JSON.stringify(p)), id:newProjectId(),
                 name:p.name + ' copy', created:Date.now(), updated:Date.now() };
  list.unshift(copy); writeStore(list); paintDash();
}
function deleteProject(id){
  const list = readStore().filter(x=>x.id!==id);
  writeStore(list);
  if (state.projectId === id){ state.projectId = null; state.projectName = 'Untitled scheme'; paintProjectName(); }
  paintDash();
}
function paintProjectName(){
  const el = $('projName'); if(!el) return;
  if (document.activeElement !== el) el.value = state.projectName || 'Untitled scheme';
}

/* ---------------------------------------------------------------------------
   The dashboard: the saved schemes, and an overview of the one that is open.

   The workflow strip at the top is the point of this screen. The tool used to
   present every control at once with no sense of order; this says what has
   been done and what is next, so a scheme can be picked up a week later.
--------------------------------------------------------------------------- */
function workflowSteps(){
  const hasSite = state.site && state.site.pts && state.site.pts.length >= 3;
  const solved  = state.options.length > 0 && state.plan;
  const r = solved ? feasibility() : null;
  const touched = state.feas && JSON.stringify(state.feas) !== JSON.stringify(feasDefaults());
  return [
    { n:1, t:'Site',        d:'Boundary and setbacks', done:hasSite,
      note:hasSite ? `${fmt(Math.round(plotArea()))} sq ft · ${state.site.pts.length} edges` : 'Draw or trace the plot',
      go:'site' },
    { n:2, t:'Entrance',    d:'Where the street comes in', done:(state.entrances||[]).length>0,
      note:(state.entrances||[]).length
        ? `${state.entrances.length} placed on the boundary`
        : 'One is chosen automatically on the longest frontage', go:'site' },
    { n:3, t:'Rules',       d:'FAR, height, grid', done:hasSite,
      note:`FAR 1:${state.ratio} · ${state.cfg?state.cfg.stories:'—'} storeys`, go:'site' },
    { n:4, t:'Program',     d:'What goes on each floor', done:!!state.stack.length,
      note:[...new Set(state.stack)].map(u=>USE_LABEL[u]||u).join(', '), go:'site' },
    { n:5, t:'Scheme',      d:'Plans and massing', done:solved,
      note:solved ? `${r.sale.reduce((a,x)=>a+x.count,0)} units · ${fmt(Math.round(r.sch.gfa))} sq ft` : 'Not generated yet',
      go:'plans' },
    { n:6, t:'Feasibility', d:'Cost and return', done:solved && touched,
      note:solved ? `${(r.onCost*100).toFixed(1)}% on cost · rates are placeholders` : 'Needs a scheme',
      go:'feas' },
  ];
}

function paintDash(){
  /* The dashboard is BuildMe's now: a hero you describe the scheme into, four
     headline numbers, recent work and a plot to start from. What used to be
     the whole page is still rendered below, as the detail. */
  paintDashHero(); paintKpis(); paintRecent(); paintPlotBars(); paintQuickPlots();
  const steps = workflowSteps();
  const solved = state.options.length > 0 && state.plan;
  const r = solved ? feasibility() : null;
  const M = v => r ? fmtMoney(v, r.f) : '—';
  const list = readStore();

  const head = `
    <h2>${state.projectName || 'Untitled scheme'}</h2>
    <p class="sub">${state.loc ? state.loc + ' &middot; ' : ''}
      ${list.length} saved scheme${list.length===1?'':'s'}
      ${storeWorks ? '' : '&middot; <b class="warn">local storage unavailable, projects last only this session</b>'}</p>

    <div class="flow">
      ${steps.map(s=>`<div class="step${s.done?' done':''}" data-go="${s.go}">
        <span class="n">${s.done?'✓':s.n}</span>
        <b>${s.t}</b><i>${s.d}</i><em>${s.note}</em></div>`).join('')}
    </div>`;

  const nums = solved ? `
    <h3>Scheme</h3>
    <div class="tot">
      <div><span>Plot</span><b class="num">${fmt(Math.round(r.plot))} sq ft</b></div>
      <div><span>Gross floor area</span><b class="num">${fmt(Math.round(r.sch.gfa))} sq ft</b></div>
      <div><span>Achieved FAR</span><b class="num">1:${r.sch.far.toFixed(2)}</b></div>
      <div><span>Storeys</span><b class="num">${state.cfg.stories}</b></div>
      <div><span>Units</span><b class="num">${r.sale.reduce((a,x)=>a+x.count,0)}</b></div>
      <div><span>Efficiency</span><b class="num">${(r.sch.eff*100).toFixed(0)}%</b></div>
    </div>

    <h3>Feasibility <i class="tiny">indicative rates</i></h3>
    <div class="tot">
      <div><span>Development cost</span><b class="num">${M(r.tdc)}</b></div>
      <div><span>Gross development value</span><b class="num">${M(r.gdv)}</b></div>
      <div><span>Profit</span><b class="num ${r.profit>=0?'':'warn'}">${M(r.profit)}</b></div>
      <div><span>Margin on cost</span><b class="num ${r.onCost<0.15?'warn':''}">${(r.onCost*100).toFixed(1)}%</b></div>
      <div><span>Breakeven rate</span><b class="num">${fmt(Math.round(r.f.cur==='USD'?r.breakeven/(r.f.fx||280):r.breakeven))}</b></div>
      <div><span>Residual land value</span><b class="num">${M(r.resid)}</b></div>
    </div>

    <h3>Unit mix</h3>
    <table class="sch"><thead><tr><th>Type</th><th>Count</th><th>Avg area</th><th>Total</th><th>Value</th></tr></thead>
      <tbody>${r.sale.map(l=>`<tr>
        <td><span class="nm"><i style="background:${USE_COL[l.use]||'#c7c7cc'}"></i>${l.name}</span></td>
        <td>${l.count}</td><td>${fmt(Math.round(l.area/Math.max(1,l.count)))}</td>
        <td>${fmt(Math.round(l.area))}</td><td>${M(l.value)}</td></tr>`).join('')}
      </tbody></table>`
    : `<div class="empty-note">No scheme generated yet. Set the site and rules,
        then press <b>Generate options</b> to build one.</div>`;

  const cards = `
    <h3>Saved schemes</h3>
    <div class="projrow">
      <button class="btn sm" id="pSave">Save this scheme</button>
      <button class="btn quiet sm" id="pNew">Start a new one</button>
    </div>
    ${list.length ? `<div class="pgrid">${list.map(p=>`
      <div class="pcard${p.id===state.projectId?' on':''}" data-id="${p.id}">
        <b>${p.name}</b>
        <span class="tiny">${new Date(p.updated).toLocaleDateString()} &middot;
          ${p.card && p.card.gfa ? fmt(p.card.gfa)+' sq ft' : 'not solved'}</span>
        <span class="tiny">${p.card && p.card.units ? p.card.units+' units' : ''}
          ${p.card && p.card.margin!=null ? '&middot; '+(p.card.margin*100).toFixed(0)+'% on cost' : ''}</span>
        <div class="pacts">
          <button data-act="open" data-id="${p.id}">Open</button>
          <button data-act="dup"  data-id="${p.id}">Duplicate</button>
          <button data-act="del"  data-id="${p.id}" class="danger">Delete</button>
        </div>
      </div>`).join('')}</div>`
      : `<div class="empty-note">Nothing saved yet. Build a scheme and press
          <b>Save this scheme</b> to keep it.</div>`}`;

  /* Mimar's quick answers sit at the foot of the dashboard, where someone
     who has just arrived is most likely to have a question. */
  $('dashSheet').innerHTML = head + nums + cards;
  if (HELP) HELP.mountQuick($('quickDash'), 'dash',
    { title:'Questions people ask', sub:'Tap one for Mimar\u2019s answer', n:4 });
  if (HELP) HELP.mountQuick($('quickNew'), 'site',
    { title:'Quick answers', sub:'About the site and the rules', n:4 });

  $('dashSheet').querySelectorAll('.step').forEach(el=>
    el.onclick = () => showView(el.dataset.go));
  $('pNew').onclick = () => {
    state.projectId = null; state.projectName = 'Untitled scheme';
    state.site = DEFAULT_PLOT(); state.mix = DEFAULT_MIX();
    state.stack = ['retail','apartment']; state.entrances = [];
    state.feas = feasDefaults(); state.options = []; state.plan = null;
    paintProjectName(); paintEdgeRows(); resize2(); paintSite();
    showView('site'); generate(false);
  };
  $('pSave').onclick = () => {
    const n = ($('projName').value || '').trim();
    saveProject(n || 'Untitled scheme'); paintDash();
  };
  wireProjectCards($('dashSheet'));
}

/* Saved-scheme cards appear on the dashboard and on My schemes, so the
   handlers live here rather than in either of them. */
function wireProjectCards(host){
  if (!host) return;
  host.querySelectorAll('.pacts button').forEach(b=>{
    b.onclick = e => {
      e.stopPropagation();
      const id = b.dataset.id;
      if (b.dataset.act === 'open') openProject(id);
      else if (b.dataset.act === 'dup') duplicateProject(id);
      else if (b.dataset.act === 'del'){
        // a second click confirms: dialogs are refused in some embeddings, and
        // a destructive action should not depend on one
        if (b.dataset.armed === '1'){ deleteProject(id); return; }
        host.querySelectorAll('.pacts button[data-act=del]')
          .forEach(x=>{ x.dataset.armed=''; x.textContent='Delete'; });
        b.dataset.armed = '1'; b.textContent = 'Confirm?';
        setTimeout(()=>{ if(b.dataset.armed==='1'){ b.dataset.armed=''; b.textContent='Delete'; } }, 4000);
      }
    };
  });
}

/* ============================================================================
   Life safety: occupant load, core demand, and means of egress.

   Figures follow the International Building Code, which is what most of the
   region's bye-laws are modelled on. They are a design check at concept stage,
   not a code submission: a fire engineer still has to sign the scheme off, and
   local amendments routinely differ. Every threshold used is named so it can
   be argued with.
   ========================================================================== */

/* Gross floor area per occupant, IBC Table 1004.5. */
const OCC_LOAD = {
  apartment:200, studio:200, hotel:200,          // residential
  retail:60, restaurant:15,                      // mercantile / assembly
  office:150, coworking:150, clinic:100,
  amenity:50, parking:200, entrance:100,
  corridor:0, stairs:0, elevator:0, restroom:0, mech:0,
};

const EGRESS = {
  // IBC 1017.2 travel distance, 1020.4 dead ends, 1007.1.1 exit remoteness
  travelSprinklered:250, travelBare:200,
  deadEndSprinklered:50, deadEndBare:20,
  remoteSprinklered:1/3, remoteBare:1/2,
  stairInPerOcc:0.2,        // 1005.3.1 sprinklered; 0.3 without
  stairInPerOccBare:0.3,
  minStairWidthIn:44,       // 1011.2
};

/* How many people a storey holds, and what that demands of the core. */
function occupancy(){
  const plans = (state.plan||[]).filter(Boolean);
  if (!plans.length) return null;
  const sprinklered = state.sprinklered !== false;

  const perFloor = plans.map(p => {
    let occ = 0;
    for (const r of p.rooms){
      const f = OCC_LOAD[r.use]; if (!f) continue;
      occ += r.area / f;
    }
    return Math.ceil(occ);
  });
  const total = perFloor.reduce((a,b)=>a+b, 0);
  const peak  = Math.max(...perFloor);

  /* Exits per storey, IBC 1006.3.2: two up to 500, three to 1000, then four. */
  const exitsFor = o => o > 1000 ? 4 : o > 500 ? 3 : 2;
  const stairsNeeded = Math.max(...perFloor.map(exitsFor));

  /* Stair width is driven by the people above it, which on a stacked building
     accumulates downward -- the ground-floor flight carries the whole tower. */
  let acc = 0, widthNeeded = EGRESS.minStairWidthIn;
  for (let i = perFloor.length - 1; i >= 1; i--){
    acc += perFloor[i];
    const per = sprinklered ? EGRESS.stairInPerOcc : EGRESS.stairInPerOccBare;
    widthNeeded = Math.max(widthNeeded, (acc * per) / stairsNeeded);
  }

  /* Lifts are practice, not code: one car per 65 dwellings is the usual
     residential rule, one per 15,000 sq ft of net lettable for commercial.
     Anything over six storeys needs at least two so the building still works
     when one is out. */
  const sch = schedule();
  const homes = sch ? sch.rows.filter(r=>r.unit && r.use==='apartment')
                              .reduce((a,r)=>a+r.count,0) : 0;
  const commercialNet = sch ? sch.rows.filter(r=>r.unit && r.use!=='apartment')
                                      .reduce((a,r)=>a+r.area,0) : 0;
  let liftsNeeded = Math.ceil(homes/65) + Math.ceil(commercialNet/15000);
  liftsNeeded = Math.max(1, liftsNeeded);
  if (plans.length > 6) liftsNeeded = Math.max(2, liftsNeeded);

  const haveStairs = Math.max(1, (state.cfg && state.cfg.core.stairCount) || 1);
  const haveLifts  = Math.max(1, (state.cfg && state.cfg.core.liftCount) || 1);

  return { perFloor, total, peak, stairsNeeded, liftsNeeded, widthNeeded,
           haveStairs, haveLifts, sprinklered, homes,
           stairShort: haveStairs < stairsNeeded,
           liftShort:  haveLifts  < liftsNeeded };
}

/* ---------------------------------------------------------------------------
   Egress geometry.

   The corridor rectangles are sampled along their centrelines into a graph,
   which joins itself at the corners of a ring. Each unit attaches at the
   middle of its corridor frontage; travel is then the walk inside the unit to
   its door plus the shortest path along the corridor to a stair.
--------------------------------------------------------------------------- */
function corridorGraph(plan){
  const STEP = 2;
  const nodes = [];
  for (const c of plan.corridor){
    const horiz = c.w >= c.d;
    const len = horiz ? c.w : c.d;
    const cx = c.x + c.w/2, cy = c.y + c.d/2;
    const n = Math.max(1, Math.round(len / STEP));
    for (let i = 0; i <= n; i++){
      const t = (i/n) * len;
      nodes.push(horiz ? { x:c.x + t, y:cy } : { x:cx, y:c.y + t });
    }
  }
  // join samples that are adjacent, including across rectangles at a corner
  const adj = nodes.map(()=>[]);
  const JOIN = STEP * 1.6;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i+1; j < nodes.length; j++){
      const d = Math.hypot(nodes[i].x-nodes[j].x, nodes[i].y-nodes[j].y);
      if (d <= JOIN){ adj[i].push([j,d]); adj[j].push([i,d]); }
    }
  return { nodes, adj };
}

function nearestNode(g, p){
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.nodes.length; i++){
    const d = Math.hypot(g.nodes[i].x-p.x, g.nodes[i].y-p.y);
    if (d < bd){ bd = d; best = i; }
  }
  return { i:best, d:bd };
}

function dijkstra(g, sources){
  const dist = new Array(g.nodes.length).fill(Infinity);
  const seen = new Array(g.nodes.length).fill(false);
  for (const s of sources) if (s >= 0) dist[s] = 0;
  for (;;){
    let u = -1, bd = Infinity;
    for (let i = 0; i < dist.length; i++) if (!seen[i] && dist[i] < bd){ bd = dist[i]; u = i; }
    if (u < 0) break;
    seen[u] = true;
    for (const [v,w] of g.adj[u]) if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
  }
  return dist;
}

function egressCheck(plan){
  const sprinklered = state.sprinklered !== false;
  const lim = {
    travel:  sprinklered ? EGRESS.travelSprinklered  : EGRESS.travelBare,
    deadEnd: sprinklered ? EGRESS.deadEndSprinklered : EGRESS.deadEndBare,
    remote:  sprinklered ? EGRESS.remoteSprinklered  : EGRESS.remoteBare,
  };
  const stairs = plan.rooms.filter(r => r.isCore && r.label === 'Stair');
  const g = corridorGraph(plan);
  if (!g.nodes.length || !stairs.length)
    return { ok:false, reason:'No corridor or no stair on this floor', lim };

  const srcs = stairs.map(st => nearestNode(g, { x:st.x+st.w/2, y:st.y+st.d/2 }).i);
  const dist = dijkstra(g, srcs);

  let maxTravel = 0, worst = null;
  for (const r of plan.rooms){
    if (r.isCore) continue;
    const door = nearestNode(g, { x:r.x+r.w/2, y:r.y+r.d/2 });
    const corridorWalk = dist[door.i];
    if (!isFinite(corridorWalk)) continue;
    // the walk inside the unit, from its most remote corner to its door
    const inside = Math.min(r.w, r.d) + Math.max(r.w, r.d)/2;
    const t = inside + corridorWalk;
    if (t > maxTravel){ maxTravel = t; worst = r.label; }
  }

  /* A dead end is corridor that carries on past the last stair: a terminal
     sample of the graph, measured back to the nearest stair. A ring has none,
     because every point can be left in two directions. */
  let deadEnd = 0;
  for (let i = 0; i < g.nodes.length; i++){
    if (g.adj[i].length > 1) continue;              // not a terminal
    if (isFinite(dist[i])) deadEnd = Math.max(deadEnd, dist[i]);
  }

  /* Exit remoteness: the two stairs must be at least a fraction of the plate's
     diagonal apart, so one fire cannot take both. */
  const diag = Math.hypot(plan.plate.w, plan.plate.d);
  let sep = 0;
  for (let i = 0; i < stairs.length; i++)
    for (let j = i+1; j < stairs.length; j++)
      sep = Math.max(sep, Math.hypot(
        (stairs[i].x+stairs[i].w/2)-(stairs[j].x+stairs[j].w/2),
        (stairs[i].y+stairs[i].d/2)-(stairs[j].y+stairs[j].d/2)));
  const sepNeeded = diag * lim.remote;

  const fails = [];
  if (maxTravel > lim.travel) fails.push(`travel ${Math.round(maxTravel)} ft over ${lim.travel} ft`);
  if (deadEnd > lim.deadEnd)  fails.push(`dead end ${Math.round(deadEnd)} ft over ${lim.deadEnd} ft`);
  if (stairs.length < 2)      fails.push('only one stair');
  else if (sep < sepNeeded)   fails.push(`stairs ${Math.round(sep)} ft apart, need ${Math.round(sepNeeded)} ft`);

  return { ok: !fails.length, fails, maxTravel, worst, deadEnd, sep, sepNeeded,
           stairs: stairs.length, lim, sprinklered };
}

/* Every storey at once. */
function egressReport(){
  const plans = (state.plan||[]).filter(Boolean);
  if (!plans.length) return null;
  const per = plans.map((p,i)=>({ lvl:i+1, ...egressCheck(p) }));
  const bad = per.filter(x=>!x.ok);
  return { per, bad, ok: !bad.length,
           worstTravel: Math.max(...per.map(x=>x.maxTravel||0)),
           worstDeadEnd: Math.max(...per.map(x=>x.deadEnd||0)) };
}

/* What the core demands of the scheme, shown beside the inputs that set it. */
function paintCoreDemand(){
  const el = $('coreDemand'); if (!el) return;
  const o = occupancy();
  if (!o){ el.innerHTML = ''; return; }
  const short = o.stairShort || o.liftShort;
  const bits = [];
  if (o.stairShort) bits.push(`${o.stairsNeeded} stairs for ${o.peak} people on the busiest floor`);
  if (o.liftShort)  bits.push(`${o.liftsNeeded} lifts for ${o.homes} homes`);
  el.innerHTML = `<div class="demand ${short?'short':'ok'}">
    <b>${short ? 'Core is undersized' : 'Core meets the demand'}</b>
    ${short ? bits.join(' · ')
            : `${o.total} people in the building · ${o.stairsNeeded} stairs and
               ${o.liftsNeeded} lifts required, ${o.haveStairs} and ${o.haveLifts} provided`}
    · stair width ${Math.round(o.widthNeeded)} in
    ${short ? '<button id="coreFix">Size it for me</button>' : ''}</div>`;
  if ($('coreFix')) $('coreFix').onclick = () => {
    $('cStairN').value = o.stairsNeeded;
    $('cLiftN').value  = o.liftsNeeded;
    coreNote(); invalidate(); generate(false);
  };
}
