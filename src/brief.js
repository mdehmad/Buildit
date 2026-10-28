/* The dashboard and the typed brief.
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters.

   BuildMe opens on "describe the house in your own words" and reads a brief
   out of the sentence. This is the same idea against a different vocabulary:
   plot dimensions, a floor area ratio, setbacks, what goes on which floor and
   how the units are sized.

   It is deliberately a set of rules rather than anything cleverer. The point
   is not to understand the sentence but to save typing: whatever it reads is
   shown back as chips, whatever it had to assume is shown as a dashed chip,
   and either way the brief opens so you can correct it. Nothing is applied
   that is not on screen.
--------------------------------------------------------------------------- */

/* The help layer keeps its own escaper inside its closure; this is the one
   the rest of the application uses. */
const esc = v => String(v == null ? '' : v)
  .replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

const WORD_NUM = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8,
  nine:9, ten:10, eleven:11, twelve:12, single:1, double:2, triple:3 };
const numOf = w => WORD_NUM[w] != null ? WORD_NUM[w] : +w;

/* Standard local plots, so "10 marla" or "1 kanal" means something. */
const LAND_UNITS = [
  { re:/(\d+(?:\.\d+)?)\s*kanals?/, sqft: 5445 },
  { re:/(\d+(?:\.\d+)?)\s*marlas?/, sqft: 272.25 },
];

function parseBrief(text){
  const t = ' ' + text.toLowerCase().replace(/[,;]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const out = { found: [] };

  /* ---- the plot ---- */
  const dim = /(\d{2,4})\s*(?:x|×|\*|by)\s*(\d{2,4})/.exec(t);
  if (dim){
    const w = +dim[1], d = +dim[2];
    if (w >= 20 && w <= 1200 && d >= 20 && d <= 1200){
      out.plot = { w, d };
      out.found.push(`${w} × ${d} ft plot`);
    }
  }
  if (!out.plot) for (const u of LAND_UNITS){
    const m = u.re.exec(t); if (!m) continue;
    const area = +m[1] * u.sqft;
    // a sensible frontage for the area: deeper than wide, as most plots here are
    const w = Math.round(Math.sqrt(area / 1.7) / 5) * 5;
    out.plot = { w, d: Math.round(area / w) };
    out.found.push(`${m[0].trim()} — about ${out.plot.w} × ${out.plot.d} ft`);
    break;
  }

  /* ---- the ratio ---- */
  let far = /(?:far|f\.a\.r|ratio)\D{0,12}?1\s*[:\-to ]\s*(\d{1,2})/.exec(t)
         || /\b1\s*[:]\s*(\d{1,2})\b/.exec(t)
         || /(?:far|f\.a\.r)\D{0,6}(\d{1,2})\b/.exec(t);
  if (far){
    const r = RATIOS.reduce((a,b) => Math.abs(b - +far[1]) < Math.abs(a - +far[1]) ? b : a);
    out.ratio = r;
    out.found.push(`floor area ratio 1:${r}`);
  }

  /* ---- setbacks ---- */
  const allRound = /(\d{1,3})\s*(?:ft|feet|foot|')?\s*setbacks?\s*(?:all round|all around|everywhere|on all sides)/.exec(t)
                || /setbacks?\s*of\s*(\d{1,3})\s*(?:ft|feet|foot|')?\s*(?:all round|all around|everywhere)/.exec(t);
  if (allRound){
    out.setbackAll = +allRound[1];
    out.found.push(`${out.setbackAll} ft setback all round`);
  } else {
    const sides = { front:0, n:0, north:0, east:1, e:1, rear:2, back:2, south:2, s:2, west:3, w:3 };
    const per = {};
    const re = /(\d{1,3})\s*(?:ft|feet|foot|')?\s*(front|rear|back|north|south|east|west)\s*setback|(front|rear|back|north|south|east|west)\s*setback\D{0,8}(\d{1,3})/g;
    let m;
    while ((m = re.exec(t))){
      const side = (m[2] || m[3] || '').toLowerCase();
      const val = +(m[1] || m[4]);
      if (sides[side] != null && val >= 0 && val <= 200){ per[sides[side]] = val; }
    }
    if (Object.keys(per).length){
      out.setbacks = per;
      out.found.push(Object.entries(per)
        .map(([i,v]) => `${v} ft ${['front','east','rear','west'][i]}`).join(', ') + ' setback');
    }
  }

  /* ---- height and section ---- */
  const hl = /(\d{2,3})\s*(?:ft|feet|foot|')\s*(?:height|tall|high)|height limit\D{0,8}(\d{2,3})|max(?:imum)? height\D{0,8}(\d{2,3})/.exec(t);
  if (hl){ out.heightLimit = +(hl[1] || hl[2] || hl[3]); out.found.push(`${out.heightLimit} ft height limit`); }
  const st = /(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:-\s*)?(?:storey|story|storeys|stories|floors?|levels?)\b/.exec(t);
  if (st && !/ground floor|first floor/.test(st[0])){
    out.storeys = Math.max(1, Math.min(60, numOf(st[1])));
    out.found.push(`${out.storeys} storeys`);
  }
  const ff = /(\d{1,2}(?:\.\d)?)\s*(?:ft|feet|foot|')?\s*floor[- ]to[- ]floor|floor[- ]to[- ]floor\D{0,6}(\d{1,2}(?:\.\d)?)/.exec(t);
  if (ff){ out.floorH = +(ff[1] || ff[2]); out.found.push(`${out.floorH} ft floor to floor`); }
  const bay = /(\d{2})\s*(?:ft|feet|foot|')?\s*(?:structural\s*)?(?:bay|grid|span)|bays?\s*of\s*(\d{2})/.exec(t);
  if (bay){ out.bay = +(bay[1] || bay[2]); out.found.push(`${out.bay} ft structural bay`); }

  /* ---- what goes in it ---- */
  const usesFound = [];
  const useWords = [
    [/retail|shops?|showrooms?/, 'retail', 'retail'],
    [/restaurants?|cafes?|food (?:court|and drink)/, 'restaurant', 'food & drink'],
    [/apartments?|flats?|residential|housing/, 'apartment', 'apartments'],
    [/offices?|workspace/, 'office', 'offices'],
    [/co-?working/, 'coworking', 'co-working'],
    [/hotels?|rooms? for guests/, 'hotel', 'hotel'],
    [/clinics?|medical/, 'clinic', 'clinic'],
    [/gym|amenity|amenities/, 'amenity', 'amenity'],
  ];
  for (const [re, use, label] of useWords) if (re.test(t)) usesFound.push([use, label]);
  if (usesFound.length){
    /* "retail on the ground floor" is the common shape, so a retail mention
       puts retail at the bottom and everything else above it. */
    const ground = usesFound.find(([u]) => /ground/.test(t) && (u === 'retail' || u === 'restaurant'))
                || (usesFound.length > 1 ? usesFound.find(([u]) => u === 'retail') : null);
    const rest = usesFound.filter(x => x !== ground);
    out.stack = (ground ? [ground[0]] : []).concat(rest.map(x => x[0]));
    if (!out.stack.length) out.stack = usesFound.map(x => x[0]);
    out.found.push(usesFound.map(x => x[1]).join(' over ').replace(/^/, ''));
  }

  /* ---- unit sizing ---- */
  if (/mostly (?:2|two)[- ]bed|larger units|large units|family units/.test(t)){
    out.unitBias = 'large'; out.found.push('larger units');
  } else if (/mostly (?:1|one)[- ]bed|compact units|smaller units|studios?/.test(t)){
    out.unitBias = 'small'; out.found.push('compact units');
  }

  /* ---- form and skin ---- */
  for (const [k, label] of MASSINGS)
    if (new RegExp('\\b' + label.toLowerCase() + '\\b').test(t)){
      out.massing = k; out.found.push(label.toLowerCase() + ' form'); break;
    }
  for (const [k, sp] of Object.entries(STYLES))
    if (sp.label && new RegExp('\\b' + sp.label.toLowerCase() + '\\b').test(t)){
      out.style = k; out.found.push(sp.label.toLowerCase()); break;
    }

  /* ---- the rest ---- */
  if (/not sprinklered|unsprinklered|no sprinklers?/.test(t)){ out.sprinklered = false; out.found.push('not sprinklered'); }
  else if (/sprinklered|sprinklers?/.test(t)){ out.sprinklered = true; out.found.push('sprinklered'); }
  const op = /(\d|one|two|three|four|five|six)\s*(?:options?|schemes?)/.exec(t);
  if (op){ out.nOpts = Math.max(1, Math.min(6, numOf(op[1]))); out.found.push(`${out.nOpts} options`); }
  return out;
}

/* Write a parsed brief into the application's state and its inputs. Only what
   was actually read is written; everything else keeps the value it had, which
   is what the dashed chips are telling you. */
function applyBrief(b){
  if (b.plot){
    state.site.pts = [{x:0,y:0},{x:b.plot.w,y:0},{x:b.plot.w,y:b.plot.d},{x:0,y:b.plot.d}];
    state.site.setbacks = state.site.setbacks.slice(0,4);
    while (state.site.setbacks.length < 4) state.site.setbacks.push(10);
    state.entrances = []; state.vgStale = true; state.fitPending = true;
  }
  if (b.setbackAll != null) state.site.setbacks = state.site.setbacks.map(() => b.setbackAll);
  else if (b.setbacks) for (const [i,v] of Object.entries(b.setbacks))
    { if (state.site.setbacks[i] != null) state.site.setbacks[i] = v; }
  else if (b.plot) b.scaled = fitSetbacks();
  if (b.ratio) state.ratio = b.ratio;
  if (b.massing) state.massing = b.massing;
  if (b.style) state.style = b.style;
  if (b.stack && b.stack.length) state.stack = b.stack.slice();
  if (b.sprinklered != null){ state.sprinklered = b.sprinklered; $('cSprink').checked = b.sprinklered; }

  const slide = (id, v) => { const el = $(id); if (!el || v == null) return;
    el.value = Math.max(+el.min, Math.min(+el.max, v)); };
  if (b.floorH) slide('sFh', b.floorH);
  if (b.bay) slide('sBay', b.bay);
  if (b.nOpts) slide('sOpts', b.nOpts);
  /* Storeys are not an input: they fall out of the allowance divided by the
     plate. Asking for a number of them is really asking for a height limit
     that permits exactly that many, so that is what is set. */
  if (b.heightLimit) slide('sHl', b.heightLimit);
  else if (b.storeys) slide('sHl', Math.round(b.storeys * (b.floorH || baseCfg().floorH)));

  /* A bias toward larger or smaller units is a change to the mix, not a
     separate setting: the per-floor counts are what decide the split. */
  if (b.unitBias){
    const big = b.unitBias === 'large';
    state.mix = state.mix.map(m => ({ ...m,
      perFloor: m.unitArea >= 900 ? (big ? 3 : 1) : (big ? 1 : 3) }));
  }

  state.projectId = null;
  paintEdgeRows(); paintRatios(); paintMassing(); paintStyles(); paintMix();
  paintStack(); syncLabels(); plotNote(); resize2(); paintSite(); invalidate();
}

/* Setbacks are kept between schemes, which is usually what you want and
   occasionally ruinous: the 25 ft front setback that suits a 130 ft frontage
   leaves a 55 ft kanal plot with 5 ft of buildable width. When a new plot
   arrives and no setback came with it, anything taking more than a third of
   a dimension is brought back to a tenth of it. Returns what it changed so
   the chips can say so, because a silently rewritten input is worse than a
   bad one. */
function fitSetbacks(){
  const xs = state.site.pts.map(p => p.x), ys = state.site.pts.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
  /* What matters is the pair, not the side: 15 ft each side is nothing on a
     130 ft frontage and leaves 25 ft of a 55 ft one. Opposite setbacks may
     take at most 45% of the dimension they eat into between them. */
  const pairs = [[0, 2, d], [1, 3, w]];     // N/S eat depth, E/W eat width
  let changed = false;
  for (const [a, b, span] of pairs){
    const sa = state.site.setbacks[a] || 0, sb = state.site.setbacks[b] || 0;
    const cap = span * 0.45;
    if (sa + sb <= cap || !(sa + sb)) continue;
    const k = cap / (sa + sb);
    state.site.setbacks[a] = Math.max(3, Math.round(sa * k));
    state.site.setbacks[b] = Math.max(3, Math.round(sb * k));
    changed = true;
  }
  return changed ? state.site.setbacks.slice() : null;
}

/* ---------------------------------------------------------------------------
   The dashboard.
--------------------------------------------------------------------------- */
/* Briefs that produce something on a plot of the size they name. A corridor
   needs a band of units beside it, so anything under about 70 ft of frontage
   is a single-loaded floor at best -- the examples stay above that. */
const ASK_EXAMPLES = [
  '130 by 170 ft plot, 1:4 FAR, retail ground floor, apartments above',
  '2 kanal, offices over retail, 1:6 ratio, 180 ft height limit',
  '100 x 200, mostly 2 bed apartments, 15 ft setback all round',
  '200 x 300, mixed use with a hotel, tapered, 24 ft bays, 6 options',
];

function paintDashHero(){
  $('examples').innerHTML = ASK_EXAMPLES
    .map((e,i) => `<button type="button" data-i="${i}">${esc(e.split(',')[0])}…</button>`).join('');
  $('examples').querySelectorAll('button').forEach(b => b.onclick = () => {
    $('askInput').value = ASK_EXAMPLES[+b.dataset.i]; understand();
  });
  if (HELP && !$('heroArt').childElementCount)
    $('heroArt').innerHTML = HELP.mimarSVG('mood-wave');
}

function understand(){
  const txt = ($('askInput').value || '').trim(), box = $('understood');
  box.hidden = false;
  if (!txt){
    box.innerHTML = '<span class="hint">Type a short description first — '
      + 'the plot size, the ratio, and what goes in it.</span>';
    return;
  }
  const b = parseBrief(txt);
  const assumed = [];
  if (!b.plot) assumed.push(`${state.site.pts.length === 4
    ? Math.round(Math.abs(state.site.pts[1].x - state.site.pts[0].x)) + ' × '
      + Math.round(Math.abs(state.site.pts[2].y - state.site.pts[1].y)) + ' ft'
    : 'the plot you drew'} — no size given`);
  if (!b.ratio) assumed.push(`1:${state.ratio} ratio — unchanged`);
  if (!b.stack) assumed.push(`${[...new Set(state.stack)].map(u => USE_LABEL[u] || u).join(' over ')} — unchanged`);
  if (!b.setbackAll && !b.setbacks) assumed.push(
    `setbacks ${state.site.setbacks.join('/')} ft — unchanged, unless the plot is too small for them`);

  box.innerHTML = `<b>Here’s what I understood</b>
    <ul>${b.found.map(f => `<li>${esc(f)}</li>`).join('')}
        ${assumed.map(f => `<li class="def">${esc(f)}</li>`).join('')}</ul>
    <div class="row">
      <button class="btn primary" id="briefGo">Generate from this</button>
      <button class="btn" id="briefReview">Check the brief first</button></div>`;
  $('briefGo').onclick = () => { applyBrief(b); showView('brief'); wizStep(3);
    generate(true).then(() => { if (state.options.length) showView('plans'); }); };
  $('briefReview').onclick = () => { applyBrief(b); showView('brief'); wizStep(3); };
}

/* The four headline numbers, which are about the scheme on screen when there
   is one and about the plot when there is not. */
function paintKpis(){
  const solved = state.options.length && state.plan;
  const s = solved ? schedule() : null;
  const r = solved ? feasibility() : null;
  const z = state.size || sizeNow();
  const kpi = (k, v, d) => `<div class="card kpi"><span class="k">${k}</span>
    <span class="v">${v}</span><span class="d">${d}</span></div>`;
  $('kpis').innerHTML = [
    kpi('Plot', fmt(Math.round(z.plotArea)) + ' sq ft',
      `${state.site.pts.length} edges · 1:${state.ratio}`),
    kpi('Permissible', fmt(Math.round(z.allowed)) + ' sq ft',
      z.bind === 'far' ? 'the ratio binds'
        : z.bind === 'height' ? 'the height limit binds first' : 'the plot binds first'),
    kpi('Gross floor area', s ? fmt(Math.round(s.gfa)) + ' sq ft' : '—',
      s ? `${state.cfg.stories} storeys · ${(s.used*100).toFixed(0)}% of allowance`
        : 'not generated yet'),
    kpi('Margin on cost', r ? (r.onCost*100).toFixed(1) + '%' : '—',
      r ? 'on placeholder rates' : 'not generated yet'),
  ].join('');
}

/* Recent schemes, newest first. */
function paintRecent(){
  const list = readStore().slice(0, 4);
  $('navCount').textContent = readStore().length;
  if (!list.length){
    $('recent').innerHTML = `<div class="empty-state"><p>Nothing saved yet.
      Build a scheme and press Save.</p></div>`;
    return;
  }
  $('recent').innerHTML = `<div class="pgrid">${list.map(p => `
    <div class="pcard${p.id === state.projectId ? ' on' : ''}" data-id="${p.id}">
      <b>${p.name}</b>
      <span class="tiny">${new Date(p.updated).toLocaleDateString()}
        ${p.card && p.card.gfa ? '&middot; ' + fmt(p.card.gfa) + ' sq ft' : ''}</span>
      <div class="pacts"><button data-act="open" data-id="${p.id}">Open</button></div>
    </div>`).join('')}</div>`;
  wireProjectCards($('recent'));
}

/* What each standard plot would carry at the ratio currently set. */
function paintPlotBars(){
  const rows = PLOT_PRESETS.slice(0, 6).map(p => ({ p, y: presetYield(p) }));
  const max = Math.max(1, ...rows.map(r => r.y.allowed));
  $('plotBars').innerHTML = rows.map(({p,y}) => `
    <div class="bar-row">
      <span class="nm">${p.name}<small>${p.w} × ${p.d}</small></span>
      <span class="bar-track">
        <i class="t" style="width:${(y.allowed/max*100).toFixed(1)}%"></i>
        <i class="g" style="width:${(y.plate/max*100).toFixed(1)}%"></i></span>
      <span class="val">${fmt(Math.round(y.allowed))}</span>
    </div>`).join('');
}

/* Start from a plot size. */
function paintQuickPlots(){
  $('quickPlots').innerHTML = PLOT_PRESETS.map(p =>
    `<button type="button" data-w="${p.w}" data-d="${p.d}">
      <b>${p.name}</b><span>${p.w} × ${p.d} ft</span></button>`).join('');
  $('quickPlots').querySelectorAll('button').forEach(b =>
    b.onclick = () => usePlot(+b.dataset.w, +b.dataset.d));
}


/* The ask box. Enter submits, as it does in BuildMe; shift-enter is a newline. */
$('askGo').onclick = understand;
$('askInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); understand(); }
});
