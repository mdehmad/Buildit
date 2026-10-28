/* buildIT — help layer: Mimar (the architect guide), FAQ library, quick-answer
   cards, animated pop-ups and toasts.

   Ported from BuildMe, which this tool is meant to read as a sibling of. The
   machinery, the mascot and the animations are BuildMe's; what is rewritten is
   the part that is actually about this tool -- the FAQ library, the per-screen
   greetings and the side table. BuildMe answers questions about CDA bylaws and
   marlas; buildIT answers them about setbacks, FAR, typologies and the
   appraisal.

   Pure DOM + inline SVG; no dependencies. Exposes window.BuildITHelp. */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  // ---------------------------------------------------------------------------
  // FAQ library. screens: where the question is most useful (side cards + Mimar).
  // ---------------------------------------------------------------------------
  const CATS = {
    fit: 'When a scheme won’t build', site: 'Site & setbacks', rules: 'FAR & height',
    options: 'The six schemes', plans: 'Layouts & units', safety: 'Escape, cores & parking',
    cost: 'Cost & feasibility', app: 'Using buildIT',
  };

  /* What each option scheme gives up and what it buys. This is the side table
     on the help page, and it is the thing people most often ask about now that
     the five options are genuinely different buildings. */
  const SCHEME_TRADES = [
    ['Double-loaded slab', 'One central corridor, so the least circulation per unit.'],
    ['Perimeter block', 'Units round a courtyard: daylight on two sides, paid for in lettable floor.'],
    ['Compact units', 'Mostly 1 beds and small shops \u2014 more units, and more doors and lifts to serve them.'],
    ['Tower on podium', 'Footprint held back and the allowance taken upward. Frees ground, more facade to build.'],
    ['Shallow plan', 'Narrower bands front to back: cross-ventilation, paid for in corridor.'],
    ['Large units', 'Mostly 2 beds and large shops \u2014 fewer units, each at a higher rate.'],
  ];
  /* Deliberately not .sch: that class is the area schedule's, which sets every
     column in the monospace and right-aligns the numbers. This is prose. */
  const tradesTable = () => `<ul class="trade-list">${
    SCHEME_TRADES.map(r => `<li><b>${esc(r[0])}</b><span>${esc(r[1])}</span></li>`).join('')
  }</ul><p class="hint">Every scheme is solved against the same site and the same allowance. Only as many as you ask for are generated, in this order.</p>`;

  const FAQ = [
    // ---- when a scheme won't build
    { id: 'nobuild', cat: 'fit', screens: ['site', 'dash'], tip: 'If the setbacks eat the plot, no bay has all four corners clear — that is why nothing generates.',
      q: 'Why does it say there is no buildable area?',
      a: 'A structural bay is only buildable if <b>all four of its corners</b> clear every setback line, so slabs never overhang. On a small or narrow plot, generous setbacks can leave no whole bay standing even though there is clearly ground left over. Reduce a setback, or drop the structural bay size on the Rules panel so smaller bays can fit inside what is left.' },

    { id: 'unused', cat: 'fit', screens: ['mass', 'dash'], tip: 'Allowance not fully used usually means the height limit bound before the ratio did.',
      q: 'Why is only part of my FAR allowance built?',
      a: 'Three things can stop a scheme reaching its allowance. The <b>height limit</b> may bind first, so there is nowhere left to put the floor area. The <b>plot</b> may run out — setbacks leave too little plate to stack. Or the plate is not a clean rectangle, in which case plans are laid on the largest rectangle of buildable bays and the leftover legs go unused. The note under the ratio says which of the three is binding.' },

    { id: 'overfar', cat: 'fit', screens: ['mass'], tip: 'The top storey is cut back to the slack the allowance leaves, so a scheme should never read over its own limit.',
      q: 'Can a scheme come out over the FAR limit?',
      a: 'It should not. The building is sized by taking whole storeys while they fit inside the allowance and then adding one part storey for the slack that is left. That top storey is <b>cut back a whole edge line at a time</b> until the stack is inside the allowance, which keeps it a rectangle the planner can still lay a corridor and a stair on. If the panel ever shows otherwise, treat it as a bug.' },

    // ---- site & setbacks
    { id: 'setbacks', cat: 'site', screens: ['site'], tip: 'Setbacks are per edge, so a four-sided plot takes four different values.',
      q: 'How do setbacks work here?',
      a: 'Every edge of the boundary carries its own setback in feet, which is how most bye-laws are written. Type a value per edge, or use <b>Match all setbacks to first</b> for a uniform one. The deepest setback is taken to be the front, which is where the entrance is placed unless you move it.' },

    { id: 'trace', cat: 'site', screens: ['site'], tip: 'You can trace the boundary over a screenshot of a map or a survey.',
      q: 'Can I draw my actual plot instead of a rectangle?',
      a: 'Yes. Load an image of a map or survey, set its scale by drawing a line of known length, then trace the boundary over it with the Draw tool. You can also drag any corner to reshape, and click any dimension to type an exact measurement rather than dragging to it.' },

    { id: 'entrance', cat: 'site', screens: ['site', 'plans'], tip: 'The entrance is placed before generation, and the room it lands in becomes the lobby.',
      q: 'Where does the entrance go?',
      a: 'One is chosen automatically on the longest frontage, and you can move it before generating. It matters: at solve time the ground-floor room the entrance bay lands in is <b>relabelled as the lobby</b>, so the route from street to lift is real rather than drawn on afterwards. A lobby is not saleable, so it drops out of the net area and the appraisal on its own.' },

    { id: 'angle', cat: 'site', screens: ['site', 'mass'], tip: 'The structural grid turns with the building, not with the screen.',
      q: 'What does building angle change?',
      a: 'It rotates the structural grid so bays stay rectangular against a plot that is not square to north. The whole solve happens in that turned frame; only the display rotates back. Setbacks are still measured against the real boundary.' },

    // ---- FAR & height
    { id: 'far', cat: 'rules', screens: ['mass', 'dash'], tip: 'Permissible covered area is simply plot area × the ratio.',
      q: 'What does the floor area ratio control?',
      a: 'The ratio sets the <b>permissible covered area</b>: plot area multiplied by the ratio. The solver then fills that allowance with whole storeys plus one trimmed top storey, inside the height limit and the floor-to-floor you set. Basements are costed but kept out of the ratio, which is how most bye-laws treat parking below ground.' },

    { id: 'massing', cat: 'rules', screens: ['mass', 'render'], tip: 'Massing styles change how the plate shrinks as the building rises, not just how it looks.',
      q: 'What do the massing styles do?',
      a: 'They set how much each storey is held back from the one below. <b>Extruded</b> holds none; <b>tapered</b> insets every storey by the upper-storey setback; <b>stepped</b> does it in groups of three; <b>crowned</b> accelerates toward the top; <b>notched</b> takes a corner off alternate floors; <b>twisted</b> rotates each plate. Because they change plate areas, they change how many storeys the allowance buys.' },

    // ---- the six schemes
    { id: 'schemes', cat: 'options', screens: ['mass', 'plans', 'dash'], tip: 'Each option is a different design decision, not the same building solved again.',
      q: 'What is the difference between the options?',
      a: () => `Each option is a <b>scheme</b> — a different decision about the same site and the same allowance — and carries its own envelope, storey count and plans. Five levers separate them: typology, unit mix, band depth, and holding the footprint back so the allowance goes up instead of out.${tradesTable()}` },

    { id: 'mostlettable', cat: 'options', screens: ['mass', 'plans'], tip: '“Most lettable” measures net area, not design quality — it cannot price daylight.',
      q: 'What does the “most lettable” tag mean?',
      a: 'It marks whichever scheme returns the most net saleable area, because that is what the appraisal is built on. It is <b>not a verdict on the design</b>: a perimeter block buys daylight on two sides with floor area the tool cannot put a price on. Treat it as one column of the comparison, not the answer.' },

    { id: 'typology', cat: 'options', screens: ['plans'], tip: 'A scheme only gets the typology it asked for if the plate can carry it soundly.',
      q: 'Why did my perimeter block come out as a bar?',
      a: 'A typology is a preference, not an override. A courtyard ring forced onto a plate too shallow for one leaves most of the floor unbuilt, so the planner only honours the request when the resulting plan fills the plate and keeps circulation in band. Otherwise the scheme quietly gets the plan the plate can actually take. The options strip shows what each storey came out as, so a mixed result reads as <i>courtyard × 7 + bar × 6</i>.' },

    { id: 'fewopts', cat: 'options', screens: ['mass'], tip: 'A scheme that cannot house the whole allowance is dropped rather than shown as a worse version of the same building.',
      q: 'Why did I get fewer options than I asked for?',
      a: 'A scheme that asks to hold the footprint back is only offered if an inset exists that both drops at least one bay <b>and</b> still houses the whole allowance. On a tight plot no such inset exists, so the tower is skipped rather than shown as a smaller building wearing a different name.' },

    // ---- layouts & units
    { id: 'frontage', cat: 'plans', screens: ['plans'], tip: 'Units are cut by frontage along the corridor, not assembled from whole bays.',
      q: 'How are the units laid out?',
      a: 'The corridor is laid first, then each band beside it is cut into units by <b>frontage</b> — so a 1 bed lands near its target area instead of being rounded up to whole structural bays. Every unit shares a real edge with a corridor by construction, so access is a property of the layout rather than something checked afterwards. Across a sweep of 6,048 plate sizes the median unit is within about 4.5% of its target area.' },

    { id: 'circ', cat: 'plans', screens: ['plans'], tip: 'Circulation is held under 21% of the plate on every verified plate size.',
      q: 'How much of each floor is circulation?',
      a: 'Corridors stay under 21% of the plate on every plate size in the sweep, and the plan score penalises anything above about 18%. Efficiency — net saleable over gross — is shown per option and typically lands between 65% and 72% depending on the scheme. A courtyard costs several points of it in exchange for daylight.' },

    { id: 'editwalls', cat: 'plans', screens: ['plans'], tip: 'Click a demising wall to select it, drag to move it, press Delete to merge the two units.',
      q: 'Can I change a layout by hand?',
      a: 'Yes. Open a storey and the demising walls between units become editable: click one to select it, drag to move it and re-area both units, or press <b>Delete</b> to merge them. Every edit is checked and undone if it would strand a unit off the corridor, and a lift or a stair cannot be merged away. Edits are held per option, so switching schemes and back does not lose them.' },

    { id: 'irregular', cat: 'plans', screens: ['plans', 'site'], tip: 'Plans are laid on the largest rectangle of buildable bays, so an L-shaped plot plans as its bigger leg.',
      q: 'Why does my L-shaped plot only use part of the plate?',
      a: 'Plans are cut on the <b>largest rectangle in which every bay is buildable</b>. That is deliberately conservative — an L-shaped plate plans as the bigger of its two legs rather than as both — and it is the right way round, because the alternative was laying plans over bays that failed the setback test. The allowance figure shows what is going unused.' },

    // ---- escape, cores & parking
    { id: 'egress', cat: 'safety', screens: ['plans', 'mass'], tip: 'Travel distance is measured along the corridor graph, not as the crow flies.',
      q: 'How is means of escape checked?',
      a: 'Against the IBC: occupant load from Table 1004.5, number of exits per storey from 1006.3.2, stair width from 1005.3.1, travel distance from 1017.2 and dead ends from 1020.4. Travel distance is measured by sampling the corridor and running a shortest path, not as a straight line. Stairs are pushed to opposite ends of the longest run so they clear the remoteness rule in 1007.1.1 — at least a third of the plate’s diagonal apart.' },

    { id: 'core', cat: 'safety', screens: ['plans'], tip: 'Lifts belong together; stairs must not — a single fire should not be able to take both.',
      q: 'How are the lifts and stairs sized and placed?',
      a: 'Lift count follows the occupancy the scheme generates, and the lifts are grouped so there is one lobby and one waiting point. Stairs are deliberately separated: putting the whole core in one block left them about 11 ft apart on a typical plate against the 42 ft the code wanted, so they are pushed toward opposite ends of the longest corridor run instead.' },

    { id: 'parking', cat: 'safety', screens: ['feas', 'mass'], tip: 'Basements are excluded from FAR but fully costed — they can move the margin a long way.',
      q: 'How is parking worked out?',
      a: 'Bays are 8′-6″ × 18′-0″ in double-loaded modules with 24 ft aisles and a 1-in-8 ramp, stacked into basements until the requirement is met. Basements sit <b>outside the floor area ratio</b> but inside the cost, so they add development cost with no revenue against them. On a typical scheme that is the single biggest reason a healthy-looking margin turns thin.' },

    // ---- cost & feasibility
    { id: 'rates', cat: 'cost', screens: ['feas', 'dash'], tip: 'Every rate in the appraisal is an indicative placeholder, not market data.',
      q: 'Where do the cost and sale rates come from?',
      a: 'They are <b>indicative placeholders</b>, not market data, and they are labelled as such everywhere they surface. Replace each one with your own figures on the Feasibility screen before anything leaves your desk. The arithmetic is sound; the inputs are a starting point.' },

    { id: 'residual', cat: 'cost', screens: ['feas'], tip: 'Breakeven sale rate solves for zero profit with marketing taken as a share of value.',
      q: 'What do breakeven rate and residual land value mean?',
      a: 'The <b>breakeven sale rate</b> is the rate per sq ft at which profit reaches zero. Marketing is a share of value rather than a fixed sum, so it moves with the answer — the figure divides fixed costs by net area adjusted for that share. <b>Residual land value</b> is what you could pay for the land and still hit your target margin. Both are only as good as the rates above them.' },

    { id: 'cashflow', cat: 'cost', screens: ['feas'], tip: 'Interest is charged on funds actually drawn, which is usually far more than a flat percentage suggests.',
      q: 'How is finance cost calculated?',
      a: 'Construction is spread on an S-curve and sales on a booking, instalment and possession plan, month by month. Interest is then charged on <b>funds actually drawn</b>, which is normally much higher than a flat percentage of build cost implies, and the cashflow reports peak funding and an IRR. If a scheme never turns cash positive, that shows up here rather than in the headline margin.' },

    // ---- using buildIT
    { id: 'export', cat: 'app', screens: ['inv', 'dash'], tip: 'The area schedule exports as JSON or CSV.',
      q: 'What can I export?',
      a: 'The full area schedule as <b>JSON</b> or <b>CSV</b> from the inputs panel. The schedule carries every unit by type, count, average area and total, plus circulation and core, for the option currently selected.' },

    { id: 'nogl', cat: 'app', screens: ['mass', 'render'], tip: 'If 3D is unavailable, everything else still works.',
      q: 'The 3D view is blank — what now?',
      a: 'The 3D views pull Three.js from a CDN. If that is blocked, or WebGL is switched off, the pane says so and <b>everything else keeps working</b>: site, plans, schedule, feasibility and exports are all drawn without it.' },

    { id: 'save', cat: 'app', screens: ['dash'], tip: 'Saved schemes live in this browser only — they are not uploaded anywhere.',
      q: 'Where are my schemes saved?',
      a: 'In this browser’s local storage. There is no account and no server, so nothing is uploaded and nothing is shared between devices. Export the schedule if you need a copy that outlives the browser.' },

    { id: 'scope', cat: 'app', screens: ['dash', 'feas'], tip: 'This is a sketch-stage aid, not a documentation tool.',
      q: 'What is buildIT not?',
      a: 'It is a feasibility and option-generation aid for the sketch stage. Columns, beams and slabs are drawn to make the massing read as a building but are <b>not engineered</b> and carry no structural meaning. Bye-law checking covers setbacks, FAR and height only. Get an architect and a cost consultant before anything is committed.' },
  ];

  const byId = Object.fromEntries(FAQ.map(f => [f.id, f]));
  const ans = f => typeof f.a === 'function' ? f.a() : f.a;
  function forScreen(screen) { const a = FAQ.filter(f => f.screens.includes(screen)); return a.length ? a : FAQ; }
  function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

  // ---------------------------------------------------------------------------
  // Mimar — BuildMe's cartoon architect, drawn in SVG. mood: happy | think | oops | idea | wave
  // ---------------------------------------------------------------------------
  let mmN = 0;
  function mimarSVG(cls) {
    const u = 'mm' + (mmN++);
    return `<svg class="mm ${cls || ''}" viewBox="0 0 120 150" aria-hidden="true" focusable="false">
      <defs><clipPath id="${u}h"><circle cx="60" cy="64" r="27"/></clipPath></defs>
      <ellipse class="mm-shadow" cx="60" cy="145" rx="26" ry="3.6" fill="#0F2A43" opacity=".12"/>
      <g class="mm-bob">
        <g class="mm-bp"><rect x="70" y="104" width="44" height="11" rx="5.5" transform="rotate(-28 92 110)" fill="#CFE5FF" stroke="#1659B4" stroke-width="1.6"/>
          <path d="M80 117 104 104" stroke="#1659B4" stroke-width="1" opacity=".6" transform="translate(-2 -1)"/><ellipse cx="111" cy="98.5" rx="3.2" ry="5.6" transform="rotate(-28 111 98.5)" fill="#fff" stroke="#1659B4" stroke-width="1.4"/></g>
        <path d="M30 141c0-22 12-38 30-38s30 16 30 38z" fill="#1E6FD9"/>
        <path d="M49 104l11 13 11-13" fill="#fff"/><path d="M57 113l3 4 3-4-3 22z" fill="#0F2A43" opacity=".85"/>
        <rect x="68" y="120" width="11" height="9" rx="1.5" fill="#1659B4"/><rect x="70" y="113" width="2.2" height="9" rx="1" fill="#FFC531"/><rect x="74" y="115" width="2.2" height="7" rx="1" fill="#F05D5E"/>
        <path d="M84 116c6 3 10 8 12 12" stroke="#1E6FD9" stroke-width="9" stroke-linecap="round" fill="none"/><circle cx="96.5" cy="129" r="5" fill="#E8B48D"/>
        <g class="mm-arm"><path d="M36 116c-7 2-12-1-15-7" stroke="#1E6FD9" stroke-width="9" stroke-linecap="round" fill="none"/><circle cx="20" cy="107" r="5.2" fill="#E8B48D"/>
          <g class="mm-pencil"><rect x="16.5" y="88" width="3.4" height="16" rx=".8" fill="#FFC531" transform="rotate(-14 18 96)"/><path d="M15.4 87.6l2.1-5.4 2.2 5.2z" fill="#0F2A43" transform="rotate(-14 18 96)"/></g></g>
        <g class="mm-head">
          <circle cx="33.5" cy="66" r="5" fill="#E8B48D"/><circle cx="86.5" cy="66" r="5" fill="#E8B48D"/>
          <circle cx="60" cy="64" r="27" fill="#F2C29B"/>
          <g clip-path="url(#${u}h)"><path d="M33 72c3 17 14 22 27 22s24-5 27-22c-5 9-14 12-27 12S38 81 33 72z" fill="#5B3A29"/></g>
          <path class="mm-mous" d="M50 77c4-3 7-3 10-1 3-2 6-2 10 1-4 2-7 2-10 0-3 2-6 2-10 0z" fill="#5B3A29"/>
          <circle cx="44" cy="74" r="4" fill="#F28C8C" opacity=".35"/><circle cx="76" cy="74" r="4" fill="#F28C8C" opacity=".35"/>
          <g class="mm-eyes"><circle cx="50" cy="64" r="2.6" fill="#0F2A43"/><circle cx="70" cy="64" r="2.6" fill="#0F2A43"/><circle cx="51" cy="63" r=".8" fill="#fff"/><circle cx="71" cy="63" r=".8" fill="#fff"/></g>
          <g fill="none" stroke="#0F2A43" stroke-width="2"><circle cx="50" cy="64" r="7"/><circle cx="70" cy="64" r="7"/><path d="M57 63.5c2-1.5 4-1.5 6 0M43 63l-8-2M77 63l8-2"/></g>
          <g class="mm-brows" stroke="#5B3A29" stroke-width="2.4" stroke-linecap="round"><path class="b1" d="M44 56.5q6-3 11 0"/><path class="b2" d="M65 56.5q5-3 11 0"/></g>
          <path class="mm-m mm-m-happy" d="M53 82q7 6 14 0" stroke="#7A2E2E" stroke-width="2.2" fill="#fff" stroke-linecap="round"/>
          <ellipse class="mm-m mm-m-oops" cx="60" cy="83.5" rx="3.6" ry="4.2" fill="#7A2E2E"/>
          <path class="mm-m mm-m-think" d="M54 83.5q4 1.5 10-1" stroke="#7A2E2E" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <g class="mm-hat"><path d="M31 49c0-17 13-27 29-27s29 10 29 27z" fill="#FFC531"/><path d="M60 22v27M46 25.5c-3 6-4 14-4 23.5M74 25.5c3 6 4 14 4 23.5" stroke="#E0A817" stroke-width="2.2" fill="none"/>
            <rect x="25" y="46" width="70" height="7.5" rx="3.75" fill="#FFD45E" stroke="#E0A817" stroke-width="1.4"/><rect x="53" y="34" width="14" height="8" rx="2" fill="#1E6FD9"/><path d="M56.5 40v-3.6l3.5-2.4 3.5 2.4V40z" fill="#fff"/></g>
          <path class="mm-sweat" d="M93 40c3 5 4 7 4 9a4 4 0 0 1-8 0c0-2 1-4 4-9z" fill="#8CC2FF" stroke="#1E6FD9" stroke-width="1"/>
        </g>
        <g class="mm-bulb"><circle cx="100" cy="22" r="9" fill="#FFE27A" stroke="#E0A817" stroke-width="1.6"/><rect x="96.5" y="30" width="7" height="5" rx="1.4" fill="#9FB2C6"/>
          <path d="M100 8v-5M88 13l-3-3M112 13l3-3" stroke="#E0A817" stroke-width="1.8" stroke-linecap="round"/></g>
        <g class="mm-q"><text x="98" y="30" font-family="Sora,system-ui,sans-serif" font-weight="700" font-size="22" fill="#1E6FD9">?</text></g>
      </g>
    </svg>`;
  }


  // ---------------------------------------------------------------------------
  // Floating guide (bottom-right). Rotates FAQs for the current screen.
  // ---------------------------------------------------------------------------
  const G = { el: null, screen: 'dash', deck: [], cur: null, timer: null, paused: false, shownAnswer: false, typing: null };
  const ROTATE_MS = 16000;
  const GREET = {
    dash: 'Salaam! I’m Mimar. Draw a plot, set the setbacks, and I’ll find what fits on it.',
    site: 'Draw or trace the boundary, then give each edge its setback. I’ll do the rest.',
    mass: 'Here are the schemes that fit your allowance. Each one trades something different.',
    render: 'The same building, with a skin on it. The massing is what matters at this stage.',
    plans: 'Every storey, down to the unit. Click a wall if you want to move it.',
    inv: 'Everything the scheme adds up to. Export it as JSON or CSV.',
    feas: 'What it costs and what it returns — on placeholder rates until you replace them.',
    help: 'Search below, or tap me for a random tip.',
  };
  function mountGuide() {
    if (G.el) return G.el;
    const el = document.createElement('div'); el.className = 'mimar'; el.id = 'mimar';
    el.innerHTML = `
      <div class="mm-bubble" id="mm-bubble" role="region" aria-label="Tips from Mimar">
        <div class="mm-top"><span class="mm-kicker" id="mm-kicker">Mimar says</span><span class="grow"></span>
          <button class="mm-x" id="mm-min" type="button" aria-label="Minimise Mimar" title="Minimise"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button></div>
        <p class="mm-text" id="mm-text" aria-live="polite"></p>
        <div class="mm-answer" id="mm-answer" hidden></div>
        <div class="mm-acts"><button type="button" class="btn sm soft" id="mm-ans">Tell me more</button><button type="button" class="btn sm ghost" id="mm-next">Next tip</button><a class="btn sm ghost" href="#help" data-view="help">All FAQs</a></div>
        <div class="mm-timer"><i id="mm-bar"></i></div>
      </div>
      <button type="button" class="mm-avatar" id="mm-avatar" aria-label="Mimar, your architect guide: show a tip" aria-expanded="true">${mimarSVG('mood-wave')}<span class="mm-badge" id="mm-badge" hidden>1</span></button>`;
    document.body.appendChild(el); G.el = el;
    const minimised = store.get('buildit.mimar') === 'min' || (window.innerWidth < 640 && store.get('buildit.mimar') !== 'open');
    setMin(minimised, true);
    el.querySelector('#mm-min').addEventListener('click', () => setMin(true));
    el.querySelector('#mm-avatar').addEventListener('click', () => { if (el.dataset.state === 'min') { setMin(false); next(); } else next(); poke(); });
    el.querySelector('#mm-next').addEventListener('click', () => next());
    el.querySelector('#mm-ans').addEventListener('click', toggleAnswer);
    el.addEventListener('mouseenter', () => { G.paused = true; el.classList.add('paused'); });
    el.addEventListener('mouseleave', () => { G.paused = false; el.classList.remove('paused'); });
    el.addEventListener('focusin', () => { G.paused = true; el.classList.add('paused'); });
    el.addEventListener('focusout', () => { G.paused = false; el.classList.remove('paused'); });
    return el;
  }
  function setMin(min, silent) {
    const el = G.el; el.dataset.state = min ? 'min' : 'open';
    el.querySelector('#mm-avatar').setAttribute('aria-expanded', String(!min));
    el.querySelector('#mm-avatar').setAttribute('aria-label', min ? 'Mimar, your architect guide: show tips' : 'Next tip from Mimar');
    if (!silent) store.set('buildit.mimar', min ? 'min' : 'open');
    el.querySelector('#mm-badge').hidden = !min;
    schedule();
  }
  function mood(m, svgRoot) {
    const svg = (svgRoot || G.el).querySelector('svg.mm'); if (!svg) return;
    svg.setAttribute('class', 'mm mood-' + m);
  }
  function poke() { const a = G.el.querySelector('.mm-avatar'); a.classList.remove('poke'); void a.offsetWidth; a.classList.add('poke'); }
  function typeText(node, text) {
    clearInterval(G.typing);
    if (reduce()) { node.textContent = text; return; }
    node.textContent = ''; let i = 0; const step = Math.max(1, Math.round(text.length / 60));
    G.typing = setInterval(() => { i += step; node.textContent = text.slice(0, i); if (i >= text.length) clearInterval(G.typing); }, 18);
  }
  function show(f, kicker) {
    const el = G.el; if (!el) return; G.cur = f; G.shownAnswer = false;
    el.querySelector('#mm-kicker').textContent = kicker || (f ? CATS[f.cat] : 'Mimar says');
    typeText(el.querySelector('#mm-text'), f ? f.tip || f.q : kicker);
    const a = el.querySelector('#mm-answer'); a.hidden = true; a.innerHTML = '';
    const b = el.querySelector('#mm-ans'); b.hidden = !f; b.textContent = 'Tell me more';
    mood(f ? (Math.random() < 0.5 ? 'idea' : 'happy') : 'wave');
    const bubble = el.querySelector('.mm-bubble'); bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
    schedule();
  }
  function toggleAnswer() {
    const el = G.el, f = G.cur; if (!f) return; const a = el.querySelector('#mm-answer');
    G.shownAnswer = !G.shownAnswer; a.hidden = !G.shownAnswer;
    if (G.shownAnswer) { a.innerHTML = `<b>${esc(f.q)}</b><div>${ans(f)}</div>`; mood('think'); }
    el.querySelector('#mm-ans').textContent = G.shownAnswer ? 'Hide' : 'Tell me more';
    schedule();
  }
  function next() {
    if (!G.deck.length) G.deck = shuffle(forScreen(G.screen)).filter(f => !G.cur || f.id !== G.cur.id);
    show(G.deck.shift());
  }
  function schedule() {
    clearTimeout(G.timer); const bar = G.el && G.el.querySelector('#mm-bar'); if (!bar) return;
    bar.style.animation = 'none'; void bar.offsetWidth;
    if (G.el.dataset.state === 'min' || G.shownAnswer) { bar.style.animation = 'none'; return; }
    bar.style.animation = `mm-timer ${ROTATE_MS}ms linear forwards`;
    G.timer = setTimeout(function tick() { if (G.paused || document.hidden) { G.timer = setTimeout(tick, 1500); return; } next(); }, ROTATE_MS);
  }
  function setScreen(screen) {
    mountGuide(); if (G.screen === screen && G.cur) return; G.screen = screen; G.deck = [];
    G.el.dataset.screen = screen;
    show(null, GREET[screen] || GREET.dash);
    G.el.querySelector('#mm-kicker').textContent = 'Mimar says';
    clearTimeout(G.timer); G.timer = setTimeout(() => next(), 6000);
    // busy screens: say hello, then tuck into the corner unless the user is reading
    clearTimeout(G.tuck);
    const tuck = () => { if (!G.paused && !G.shownAnswer) { G.el.dataset.state = 'min'; G.el.querySelector('#mm-badge').hidden = false; schedule(); } };
    /* The dashboard carries its own quick-answer card in the same corner, so a
       floating copy of the same questions sits on top of it. Mimar waits there
       as the avatar alone until she is asked. */
    if (screen === 'dash') tuck();
    else if ((screen === 'plans' || screen === 'mass' || screen === 'render' || window.innerWidth < 1240)
      && G.el.dataset.state !== 'min') G.tuck = setTimeout(tuck, 7000);
  }
  function say(text, m) { mountGuide(); show(null, text); G.el.querySelector('#mm-kicker').textContent = 'Mimar says'; if (m) mood(m); if (G.el.dataset.state === 'min') { const b = G.el.querySelector('#mm-badge'); b.hidden = false; poke(); } }
  function hideGuide(h) { if (G.el) G.el.classList.toggle('away', !!h); }

  // ---------------------------------------------------------------------------
  // Quick-answer cards (side panels on several screens)
  // ---------------------------------------------------------------------------
  function mountQuick(host, screen, opts) {
    if (!host) return; opts = opts || {};
    const n = opts.n || 4; let pool = shuffle(forScreen(screen));
    const draw = () => {
      const items = pool.slice(0, n); pool = pool.slice(n).concat(items);
      host.innerHTML = `<div class="card card-pad quick-faq">
        <div class="qf-head"><span class="qf-face">${mimarSVG('mood-happy mini')}</span><div><b>${esc(opts.title || 'Quick answers')}</b><div class="hint">${esc(opts.sub || 'Mimar answers common questions')}</div></div>
          <button class="btn sm ghost qf-more" type="button" aria-label="Show other questions" title="Other questions"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg></button></div>
        <div class="qf-list">${items.map(f => `<details class="faq-item"><summary>${esc(f.q)}</summary><div class="faq-a">${ans(f)}</div></details>`).join('')}</div>
        <a class="btn link" href="#help" data-view="help">All questions</a></div>`;
      const list = host.querySelector('.qf-list'); if (!reduce()) { list.classList.remove('in'); void list.offsetWidth; list.classList.add('in'); }
      host.querySelector('.qf-more').addEventListener('click', draw);
    };
    draw();
  }

  // ---------------------------------------------------------------------------
  // Help page (route #help)
  // ---------------------------------------------------------------------------
  function mountHelpPage(host) {
    if (!host || host.dataset.ready) return; host.dataset.ready = '1';
    host.innerHTML = `
      <div class="card help-hero">
        <div class="help-hero-main">
          <span class="lab">Help &amp; FAQ</span>
          <h2>Ask Mimar</h2>
          <p>Answers about setbacks, floor area ratio, the six schemes, escape routes and the appraisal. Type a few words or pick a topic.</p>
          <div class="help-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input type="search" id="faq-q" placeholder="e.g. setbacks, courtyard, breakeven, parking, egress" aria-label="Search questions"></div>
          <div class="faq-chips" id="faq-cats" role="group" aria-label="Topics"></div>
        </div>
        <div class="help-hero-art">${mimarSVG('mood-wave big')}<div class="help-speech" id="help-speech">Tap me for a random tip!</div></div>
      </div>
      <div class="help-grid">
        <div class="faq-list" id="faq-list"></div>
        <aside class="help-side">
          <div class="card card-pad"><h3>What each scheme trades</h3>${tradesTable()}</div>
          <div class="card card-pad tip-of-day"><span class="lab">Tip of the moment</span><p id="tip-now"></p><button class="btn sm soft" id="tip-next" type="button">Another tip</button></div>
        </aside>
      </div>`;
    let cat = 'all', q = '';
    const cats = host.querySelector('#faq-cats');
    cats.innerHTML = [['all', 'All']].concat(Object.entries(CATS)).map(([k, v]) => `<button type="button" data-c="${k}" aria-pressed="${k === 'all'}">${esc(v)}</button>`).join('');
    cats.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; cat = b.dataset.c; cats.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); render(); });
    host.querySelector('#faq-q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); });
    const strip = h => String(h).replace(/<[^>]+>/g, ' ');
    function render() {
      const words = q.split(/\s+/).filter(Boolean);
      const list = FAQ.filter(f => (cat === 'all' || f.cat === cat) && (!words.length || words.every(w => (f.q + ' ' + strip(ans(f)) + ' ' + (f.tip || '')).toLowerCase().includes(w))));
      const el = host.querySelector('#faq-list');
      if (!list.length) { el.innerHTML = `<div class="empty-state">${mimarSVG('mood-think mini')}<p>Mimar has no answer for “${esc(q)}” yet. Try other words, or browse all topics.</p></div>`; return; }
      const groups = {}; list.forEach(f => (groups[f.cat] = groups[f.cat] || []).push(f));
      el.innerHTML = Object.entries(groups).map(([c, fs]) => `<section class="faq-group"><h3>${esc(CATS[c])}</h3>${fs.map((f, i) => `<details class="faq-item" style="--i:${i}" ${words.length && i === 0 ? 'open' : ''}><summary>${esc(f.q)}</summary><div class="faq-a">${ans(f)}</div></details>`).join('')}</section>`).join('');
    }
    render();
    const tips = shuffle(FAQ); let ti = 0;
    const tip = () => { const f = tips[ti++ % tips.length]; host.querySelector('#tip-now').textContent = f.tip || f.q; };
    tip(); host.querySelector('#tip-next').addEventListener('click', tip);
    const art = host.querySelector('.help-hero-art'); const sp = host.querySelector('#help-speech');
    art.addEventListener('click', () => { const f = tips[ti++ % tips.length]; sp.textContent = f.tip || f.q; sp.classList.remove('pop'); void sp.offsetWidth; sp.classList.add('pop'); const s = art.querySelector('svg.mm'); s.setAttribute('class', 'mm big mood-' + (['idea', 'happy', 'wave', 'think'][ti % 4])); });
  }
  function openFaq(id) {
    if (typeof showView === 'function') showView('help');
    setTimeout(() => { const host = document.getElementById('faq-list'); if (!host) return; const f = byId[id]; if (!f) return;
      const it = [...host.querySelectorAll('.faq-item')].find(d => d.querySelector('summary').textContent === f.q);
      if (it) { it.open = true; it.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center' }); it.classList.add('flash'); setTimeout(() => it.classList.remove('flash'), 1600); } }, 120);
  }

  // ---------------------------------------------------------------------------
  // Animated pop-up ("oops") — used when a brief can't be designed, and for other errors
  // ---------------------------------------------------------------------------
  let lastFocus = null;
  function oops(o) {
    close(true); lastFocus = document.activeElement;
    const kind = o.kind || 'bad'; // bad | info
    const back = document.createElement('div'); back.className = 'oops-back ' + kind; back.id = 'oops';
    const house = `<svg class="oops-house" viewBox="0 0 160 110" aria-hidden="true">
        <path d="M6 104h148" stroke="#C9D7E6" stroke-width="3" stroke-linecap="round"/>
        <g class="blk b1"><rect x="34" y="78" width="30" height="24" rx="2"/></g><g class="blk b2"><rect x="66" y="78" width="30" height="24" rx="2"/></g><g class="blk b3"><rect x="98" y="78" width="28" height="24" rx="2"/></g>
        <g class="blk b4"><rect x="40" y="52" width="40" height="24" rx="2"/></g><g class="blk b5"><rect x="82" y="52" width="38" height="24" rx="2"/></g>
        <g class="blk b6 odd"><rect x="58" y="26" width="58" height="24" rx="2"/><text x="87" y="43" text-anchor="middle">?</text></g>
        <g class="crane"><path d="M140 104V12h-62" stroke="#1E6FD9" stroke-width="3" fill="none" stroke-linejoin="round"/><path class="hook" d="M100 12v9" stroke="#0F2A43" stroke-width="1.6"/></g>
      </svg>`;
    const reasons = (o.reasons || []).map((r, i) => `<li style="--i:${i}"><span class="ri">${r.icon || (kind === 'info' ? 'i' : '!')}</span><div><b>${esc(r.title)}</b>${r.text ? `<span>${esc(r.text)}</span>` : ''}</div></li>`).join('');
    const fixes = (o.fixes || []).map((f, i) => `<button type="button" class="btn ${i === 0 ? 'primary' : ''}" data-fix="${i}" style="--i:${i}">${esc(f.label)}</button>`).join('');
    const faqs = (o.faqs || []).map(id => byId[id]).filter(Boolean).map(f => `<details class="faq-item"><summary>${esc(f.q)}</summary><div class="faq-a">${ans(f)}</div></details>`).join('');
    back.innerHTML = `<div class="oops-card" role="alertdialog" aria-modal="true" aria-labelledby="oops-t" aria-describedby="oops-l">
      <button class="oops-x" type="button" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="oops-stage">${kind === 'bad' ? house : ''}<div class="oops-mm">${mimarSVG(kind === 'bad' ? 'mood-oops' : 'mood-idea')}</div></div>
      <div class="oops-body">
        <span class="lab">${esc(o.kicker || (kind === 'bad' ? 'Mimar couldn’t build it' : 'Mimar has a note'))}</span>
        <h2 id="oops-t">${esc(o.title)}</h2>
        ${o.lead ? `<p id="oops-l" class="oops-lead">${esc(o.lead)}</p>` : '<p id="oops-l" hidden></p>'}
        ${reasons ? `<ul class="oops-reasons">${reasons}</ul>` : ''}
        ${fixes ? `<div class="oops-fixes"><span class="lab">${esc(o.fixLabel || 'Try one of these')}</span><div class="row">${fixes}</div></div>` : ''}
        ${faqs ? `<div class="oops-faq"><span class="lab">Related questions</span>${faqs}</div>` : ''}
        <div class="oops-foot"><button type="button" class="btn ghost" data-close>${esc(o.closeLabel || 'Close')}</button>${o.help !== false ? '<a class="btn link" href="#help" data-view="help" data-close>Open Help &amp; FAQ</a>' : ''}</div>
      </div></div>`;
    document.body.appendChild(back); hideGuide(true);
    requestAnimationFrame(() => back.classList.add('in'));
    back.addEventListener('click', e => {
      if (e.target === back || e.target.closest('.oops-x') || e.target.closest('[data-close]')) { close(); return; }
      const b = e.target.closest('[data-fix]'); if (b) { const f = o.fixes[+b.dataset.fix]; close(); setTimeout(() => f.run(), 160); }
    });
    back.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') { const f = [...back.querySelectorAll('button,a,summary')].filter(x => x.offsetParent); if (!f.length) return; const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    });
    setTimeout(() => { const t = back.querySelector('[data-fix="0"]') || back.querySelector('.oops-x'); if (t) t.focus({ preventScroll: true }); }, 60);
    return back;
  }
  function close(instant) {
    const back = document.getElementById('oops'); if (!back) return;
    hideGuide(false);
    if (instant || reduce()) back.remove(); else { back.classList.remove('in'); back.classList.add('out'); setTimeout(() => back.remove(), 260); }
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) try { lastFocus.focus({ preventScroll: true }); } catch (e) { }
  }

  // ---------------------------------------------------------------------------
  // Toast — small, self-dismissing note with Mimar's face
  // ---------------------------------------------------------------------------
  function toast(o) {
    let host = document.getElementById('toasts'); if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.className = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    const t = document.createElement('div'); t.className = 'toast ' + (o.kind || 'info');
    t.innerHTML = `<span class="t-face">${mimarSVG('mini mood-' + (o.mood || (o.kind === 'bad' ? 'oops' : 'happy')))}</span><div class="t-txt">${o.title ? `<b>${esc(o.title)}</b>` : ''}<span>${esc(o.text || '')}</span></div>${o.action ? `<button type="button" class="btn sm soft">${esc(o.action.label)}</button>` : ''}<button type="button" class="t-x" aria-label="Dismiss"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
    host.appendChild(t); requestAnimationFrame(() => t.classList.add('in'));
    const kill = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); };
    t.querySelector('.t-x').addEventListener('click', kill);
    if (o.action) t.querySelector('.btn').addEventListener('click', () => { kill(); o.action.run(); });
    setTimeout(kill, o.ms || 8000);
    return t;
  }

  root.BuildITHelp = { FAQ, CATS, SCHEME_TRADES, byId, forScreen, mimarSVG, mountGuide, setScreen, say, mood, hideGuide, mountQuick, mountHelpPage, openFaq, oops, close, toast };
})(typeof window !== 'undefined' ? window : globalThis);

/* One handle for the rest of the application. help.js is concatenated first,
   so this is assigned before anything that uses it can run. It stays null if
   the layer ever fails to load, and every call site tests it, so losing the
   guide can never take the tool down with it. */
const HELP = (typeof window !== 'undefined' && window.BuildITHelp) || null;
