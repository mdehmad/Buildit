/* Area schedule, options ribbon and view routing
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ================= inventory schedule ================= */
function schedule(){
  const {vg,pg,cfg}=state, opt=state.options[state.pick];
  if(!vg||!opt) return null;

  /* Read the unit plans, not the bay assignment. The two used to be the same
     thing; now the planner cuts units by frontage and the bay grid only carries
     the structure, so totting up bays would describe a plan nobody is looking
     at. A courtyard is a void, not floor, so it is taken out of the gross. */
  if (state.plan && state.plan.some(Boolean)){
    const byType={}, byFloor=[];
    let gfa=0, net=0;
    for(let s=0;s<cfg.stories;s++) byFloor[s]={gfa:0,net:0,core:0,units:0};
    state.plan.forEach((p,s)=>{
      if(!p || !byFloor[s]) return;
      const floorGfa = p.gross - p.voidA;
      byFloor[s].gfa = floorGfa; gfa += floorGfa;
      for (const r of p.rooms){
        const leasable = LEASABLE.has(r.use) && !r.isCore;
        const key = (r.isCore ? 'core|' : 'unit|') + r.use + '|' + r.label;
        (byType[key] ||= { name:r.label, use:r.use, unit:leasable,
                           count:0, area:0, target:0 });
        byType[key].count++; byType[key].area += r.area;
        byType[key].target += (r.target || r.area);
        if (leasable){ byFloor[s].net += r.area; net += r.area; byFloor[s].units++; }
        else byFloor[s].core += r.area;
      }
      const circ = p.circ;
      byType['core|corridor|Circulation'] ||=
        { name:'Circulation', use:'corridor', unit:false, count:0, area:0, target:0 };
      byType['core|corridor|Circulation'].count++;
      byType['core|corridor|Circulation'].area += circ;
      byType['core|corridor|Circulation'].target += circ;
      byFloor[s].core += circ;
    });
    const rows=Object.values(byType).sort((a,b)=> (b.unit-a.unit) || (b.area-a.area));
    const z = state.size || sizeNow();
    /* Basements are deliberately outside gfa: almost every bye-law excludes
       below-grade parking from the floor area ratio, so counting it would
       under-report what the plot can still carry above ground. It is costed
       all the same. */
    const pk = state.parking;
    const park = pk ? { gross:pk.gross, cars:pk.supply, required:pk.required,
                        short:pk.short, levels:pk.levels.length } : null;
    return { rows, byFloor, gfa, net, park, bay:cfg.bay*cfg.bay, plot:plotArea(),
      far:gfa/plotArea(), eff:gfa?net/gfa:0,
      allowed:z.allowed, used:z.allowed?gfa/z.allowed:0, bind:z.bind, storeys:z.storeys };
  }

  const assign=effAssign();
  const byRoom={}, byType={}, byFloor=[];
  for(let s=0;s<cfg.stories;s++) byFloor[s]={gfa:0,net:0,core:0,units:0};
  for (const v of vg.voxels){
    const rid=assign[v.id]; if(rid===-1) continue;
    const r=pg.rooms[rid];
    byRoom[rid]=(byRoom[rid]||0)+v.area;
    const key=r.unit ? (r.mixId+'|'+r.name) : r.type;
    (byType[key] ||= { name:r.unit?r.name:CORE_LABEL[r.type], use:r.type,
                       unit:r.unit, count:new Set(), area:0, target:0 });
    byType[key].area+=v.area; byType[key].count.add(rid);
    const f=byFloor[r.s];
    f.gfa+=v.area;
    if (LEASABLE.has(r.type)) { f.net+=v.area; } else { f.core+=v.area; }
  }
  for (const r of pg.rooms){
    const key=r.unit ? (r.mixId+'|'+r.name) : r.type;
    if (byType[key]) byType[key].target+=r.target;
    if (r.unit && byRoom[r.id]) byFloor[r.s].units++;
  }
  const rows=Object.values(byType).map(t=>({...t, count:t.count.size}))
    .sort((a,b)=> (b.unit-a.unit) || (b.area-a.area));
  const gfa=rows.reduce((a,r)=>a+r.area,0);
  const net=rows.filter(r=>r.unit).reduce((a,r)=>a+r.area,0);
  const bay=cfg.bay*cfg.bay;
  const z = state.size || sizeNow();
  return { rows, byFloor, gfa, net, bay, plot:plotArea(),
    far:gfa/plotArea(), eff:gfa?net/gfa:0,
    allowed:z.allowed, used:z.allowed?gfa/z.allowed:0, bind:z.bind, storeys:z.storeys };
}
function paintSheet(){
  const s=schedule();
  if(!s){ $('sheet').innerHTML='<h2>Schedule</h2><p class="sub">Generate options to build the area statement.</p>'; return; }
  const {cfg}=state;
  const overFar = s.far > state.ratio + .01;
  const row = r => {
    const per = r.count ? r.area/r.count : 0;
    const tgt = r.count ? r.target/r.count : 0;
    const off = tgt>0 && Math.abs(per-tgt)/tgt > .2;
    return `<tr>
      <td><span class="nm"><i style="background:${USE_COL[r.use]}"></i>${r.name}</span></td>
      <td>${r.unit?r.use:'core'}</td>
      <td>${r.count}</td>
      <td>${tgt?fmt(tgt):'\u2014'}</td>
      <td class="${off?'off':''}">${fmt(per)}</td>
      <td>${fmt(r.area)}</td>
      <td>${(r.area/s.gfa*100).toFixed(1)}%</td></tr>`;
  };
  const units=s.rows.filter(r=>r.unit), core=s.rows.filter(r=>!r.unit);
  const totUnits=units.reduce((a,r)=>a+r.count,0);
  $('sheet').innerHTML=`
    <h2>Area schedule</h2>
    <p class="sub">FAR 1:${state.ratio} &middot; ${cfg.stories} storeys at ${cfg.floorH} ft
      &middot; ${cfg.bay} ft structural bay &middot; option ${state.pick+1} of ${state.options.length}</p>
    <div class="tot">
      <div><span>Plot area</span><b class="num">${fmt(s.plot)}</b></div>
      <div><span>Permissible</span><b class="num">${fmt(s.allowed)}</b></div>
      <div><span>Gross floor area</span><b class="num">${fmt(s.gfa)}</b></div>
      <div><span>Allowance used</span><b class="num ${s.used<0.9?'warn':''}">${(s.used*100).toFixed(0)}%</b></div>
      <div><span>Net leasable</span><b class="num">${fmt(s.net)}</b></div>
      <div><span>Efficiency</span><b class="num">${(s.eff*100).toFixed(0)}%</b></div>
      <div><span>Achieved FAR</span><b class="num ${overFar?'warn':''}">1:${s.far.toFixed(2)}</b></div>
      <div><span>Total units</span><b class="num">${totUnits}</b></div>
    </div>

    <h3>Unit mix</h3>
    <table class="sch"><thead><tr>
      <th>Type</th><th>Use</th><th>Count</th><th>Target</th><th>Achieved</th><th>Total</th><th>Share</th>
    </tr></thead><tbody>
      ${units.map(row).join('')}
      <tr class="sum"><td>Net leasable</td><td></td><td>${totUnits}</td><td></td><td></td>
        <td>${fmt(s.net)}</td><td>${(s.net/s.gfa*100).toFixed(1)}%</td></tr>
    </tbody></table>

    <h3>Core and services</h3>
    <table class="sch"><thead><tr>
      <th>Type</th><th>Use</th><th>Rooms</th><th>Target</th><th>Achieved</th><th>Total</th><th>Share</th>
    </tr></thead><tbody>
      ${core.map(row).join('')}
      <tr class="sum"><td>Gross floor area</td><td></td><td></td><td></td><td></td>
        <td>${fmt(s.gfa)}</td><td>100%</td></tr>
    </tbody></table>

    <h3>By level</h3>
    <table class="sch"><thead><tr>
      <th>Level</th><th>Use</th><th>Units</th><th>Net leasable</th><th>Core</th><th>Gross</th><th>Efficiency</th>
    </tr></thead><tbody>
      ${s.byFloor.map((f,i)=> f.gfa?`<tr><td>Level ${i+1}</td>
        <td><span class="nm"><i style="background:${USE_COL[state.pg.floorUse[i]]}"></i>${USE_LABEL[state.pg.floorUse[i]]||state.pg.floorUse[i]}</span></td><td>${f.units}</td>
        <td>${fmt(f.net)}</td><td>${fmt(f.core)}</td><td>${fmt(f.gfa)}</td>
        <td>${(f.net/f.gfa*100).toFixed(0)}%</td></tr>`:'').join('')}
    </tbody></table>

    <p class="foots">${s.bind==='height'
      ? 'The height limit binds before the ratio does, so the full allowance cannot be built on this plot. '
      : s.bind==='plot' ? 'The plot runs out before the ratio does. ' : ''}Areas are measured in whole structural bays of
      ${fmt(s.bay)} sq ft, so any room smaller than one bay is rounded up &mdash; that is why
      small service rooms read above target. Achieved sizes more than 20% off target are
      marked in amber. Net leasable counts only unit types from the mix; circulation,
      stairs, lifts, restrooms and plant are treated as core.</p>`;
}
function exportCSV(){
  const s=schedule(); if(!s) return;
  const {cfg}=state;
  const L=[];
  L.push(['Area schedule']);
  if (state.loc) L.push(['Location',state.loc]);
  L.push(['Plot area (sq ft)',Math.round(s.plot)]);
  L.push(['Gross floor area (sq ft)',Math.round(s.gfa)]);
  L.push(['Net leasable (sq ft)',Math.round(s.net)]);
  L.push(['Efficiency (%)',(s.eff*100).toFixed(1)]);
  L.push(['Permissible covered area (sq ft)',Math.round(s.allowed),'FAR ratio','1:'+state.ratio]);
  L.push(['Allowance used (%)',(s.used*100).toFixed(1)]);
  L.push(['Achieved FAR',s.far.toFixed(2)]);
  L.push(['Storeys',cfg.stories,'Floor height (ft)',cfg.floorH,'Bay (ft)',cfg.bay]);
  L.push([]);
  L.push(['Type','Use','Count','Target each (sq ft)','Achieved each (sq ft)','Total (sq ft)','Share (%)']);
  for (const r of s.rows){
    L.push([r.name, r.unit?r.use:'core', r.count,
      r.count?Math.round(r.target/r.count):'', r.count?Math.round(r.area/r.count):'',
      Math.round(r.area), (r.area/s.gfa*100).toFixed(1)]);
  }
  L.push([]);
  L.push(['Level','Use','Units','Net leasable (sq ft)','Core (sq ft)','Gross (sq ft)','Efficiency (%)']);
  s.byFloor.forEach((f,i)=>{ if(!f.gfa) return;
    L.push([i+1, USE_LABEL[state.pg.floorUse[i]]||'', f.units, Math.round(f.net),
      Math.round(f.core), Math.round(f.gfa), (f.net/f.gfa*100).toFixed(0)]); });
  const csv=L.map(r=>r.map(c=>{
    const v=String(c??''); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
  }).join(',')).join('\n');
  saveFile('area-schedule.csv', csv, 'text/csv');
}

/* ================= ribbon ================= */
function paintRibbon(){
  /* The ribbon used to show one score that nothing else read, which made five
     schemes look like five shades of the same answer. It now shows what a
     scheme costs you and what it buys: how tall it got, how big the plate is
     and how many units came out. */
  const st = state.options.map(schemeStats);
  /* Most lettable area, which is what the appraisal is built on. It is not a
     verdict on the design -- a courtyard buys daylight with floor the tool
     cannot price -- so it is labelled for what it measures. */
  let top = 0;
  for (let i = 1; i < st.length; i++) if (st[i].net > st[top].net) top = i;
  $('opts').innerHTML = st.map((s,i)=>
    `<button class="opt ${i===state.pick?'on':''}" data-i="${i}" title="${s.note}">
      <div class="r">${String.fromCharCode(65+i)} · ${s.name}${
        i===top?' <span class="tag">most lettable</span>':''}</div>
      <div class="v">${s.units} units</div>
      <div class="o">${s.storeys} storeys · ${fmt(Math.round(s.footprint))} sq ft plate
        · ${Math.round(s.eff*100)}% eff · ${s.typology}</div></button>`).join('');
  $('opts').querySelectorAll('.opt').forEach(b=>b.onclick=()=>{
    applyOption(+b.dataset.i); state.reveal=1; refreshAll();
  });
  $('ribbon').style.display = state.options.length ? '' : 'none';
  paintInfo(); paintCoreDemand();
}

/* The right-hand panel: whether the scheme complies, what it adds up to, what
   it would cost, and anything worth saying about it. Pulled out of a row of
   chips along the bottom, where none of it could be read. */
function paintInfo(){
  const el = $('info'); if (!el) return;
  const o = state.options[state.pick], s = o ? schedule() : null;
  if (!s){ el.innerHTML = '<p class="tiny" style="padding:16px">Generate a scheme to see how it performs.</p>'; return; }
  const r = feasibility();
  const over = s.far > state.ratio + .01;
  const bar = (v, warn) => `<div class="meter"><i style="width:${Math.min(100,v*100).toFixed(1)}%"
    class="${warn?'warn':''}"></i></div>`;

  const notes = [];
  if (over) notes.push(['Over the allowance',
    `Achieved FAR is 1:${s.far.toFixed(2)} against a 1:${state.ratio} limit. Reduce storeys or the plate.`]);
  else if (s.used < 0.9) notes.push(['Allowance not used',
    `Only ${(s.used*100).toFixed(0)}% of the permissible area is built. A taller or wider envelope would fit.`]);
  else notes.push(['Within the allowance',
    `${(s.used*100).toFixed(0)}% of the permissible area used, at 1:${s.far.toFixed(2)}.`]);

  const pl = state.plan && state.plan.find(Boolean);
  if (pl) notes.push(['Every unit reachable',
    `${pl.typology} plan · corridor is ${Math.round(pl.circ/pl.gross*100)}% of the plate, and no unit is entered through another.`]);
  const voidA = (state.plan||[]).filter(Boolean).reduce((a,p)=>a+p.voidA,0);
  if (voidA > 0) notes.push(['Courtyard costs floor area',
    `${fmt(Math.round(voidA))} sq ft of the envelope is light well, so the scheme will not reach its full FAR.`]);
  const pk = state.parking;
  if (pk) notes.push([pk.short ? 'Parking short' : 'Parking satisfied',
    pk.short
      ? `${pk.supply} spaces over ${pk.levels.length} basements against ${pk.required} required. Add a level or reduce the mix.`
      : `${pk.supply} spaces over ${pk.levels.length} basements against ${pk.required} required, at ${Math.round(pk.gross/Math.max(1,pk.supply))} sq ft per car.`]);
  if (r && r.onCost < 0.15) notes.push(['Thin margin',
    `${(r.onCost*100).toFixed(1)}% on cost at the current rates. Check them before relying on it.`]);

  el.innerHTML = `
    <div class="ibox ${over?'bad':'ok'}">
      <b>${over?'Over the FAR allowance':'Meets the bye-laws set'}</b>
      <span>Setbacks per edge · whole-bay buildability · FAR 1:${state.ratio}</span>
    </div>

    <div class="istats">
      <div><span>Plot</span><b class="num">${fmt(Math.round(s.plot))}</b></div>
      <div><span>Storeys</span><b class="num">${state.cfg.stories}</b></div>
      <div><span>Gross floor area</span><b class="num">${fmt(Math.round(s.gfa))}</b></div>
      <div><span>Net saleable</span><b class="num">${fmt(Math.round(s.net))}</b></div>
    </div>

    <div class="igauge">
      <p class="lbl">Allowance used</p>
      <div class="gv"><b class="num">${(s.used*100).toFixed(0)}%</b>
        <span class="tiny">of ${fmt(Math.round(s.allowed))} sq ft</span></div>
      ${bar(s.used, over)}
    </div>
    <div class="igauge">
      <p class="lbl">Efficiency</p>
      <div class="gv"><b class="num">${(s.eff*100).toFixed(0)}%</b>
        <span class="tiny">net of gross</span></div>
      ${bar(s.eff)}
    </div>

    ${r?`<div class="icost">
      <p class="lbl">Estimated development</p>
      <b class="num big">${fmtMoney(r.tdc, r.f)}</b>
      <span class="tiny">against ${fmtMoney(r.gdv, r.f)} value ·
        ${(r.onCost*100).toFixed(1)}% on cost</span>
      <button class="hbtn sm" id="infoFeas">Open feasibility</button>
      <p class="tiny" style="margin-top:8px">Rates are indicative placeholders.</p>
    </div>`:''}

    ${(()=>{ const eg = egressReport(), oc = occupancy();
       if (!eg || !oc) return '';
       const bad = !eg.ok || oc.stairShort || oc.liftShort;
       return `<div class="ibox ${bad?'bad':'ok'}" style="margin-top:18px">
         <b>${bad ? 'Life safety needs attention' : 'Means of escape checks out'}</b>
         <span>travel ${Math.round(eg.worstTravel)} / ${eg.per[0].lim.travel} ft ·
           dead end ${Math.round(eg.worstDeadEnd)} / ${eg.per[0].lim.deadEnd} ft ·
           ${oc.total} occupants · ${oc.haveStairs}/${oc.stairsNeeded} stairs ·
           ${oc.haveLifts}/${oc.liftsNeeded} lifts</span></div>`; })()}

    <p class="lbl" style="margin:18px 0 7px">Notes on this option</p>
    ${notes.map(([t,d])=>`<div class="inote"><b>${t}</b><span>${d}</span></div>`).join('')}`;

  if ($('infoFeas')) $('infoFeas').onclick = () => showView('feas');
}

function paintFloors(){
  let h='';
  for(let i=0;i<state.cfg.stories;i++){
    if(!state.vg.byStory[i].length) continue;
    h+=`<button data-f="${i}" class="${state.floor===i?'on':''}">${i+1}</button>`;
  }
  h+=`<button data-f="-1" class="all ${state.floor===-1?'on':''}">All</button>`;
  $('floors').innerHTML=h;
  $('floors').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    state.floor=+b.dataset.f; paintFloors(); paint3D();
  });
}
function paintHead(){
  const s=schedule(), c=state.cfg;
  $('mSite').textContent=fmt(plotArea())+' sq ft';
  $('mHt').textContent=(c?c.stories*c.floorH:0)+' ft';
  if(!s){ $('mGross').textContent='\u2014'; $('mFar').textContent='\u2014'; $('mEff').textContent='\u2014'; return; }
  $('mGross').textContent=fmt(s.gfa)+' sq ft';
  $('mFar').textContent='1:'+s.far.toFixed(2);
  $('mFar').classList.toggle('over', s.far>state.ratio+.01);
  $('mEff').textContent=(s.eff*100).toFixed(0)+'%';
}
function refreshAll(){ paintRibbon(); paint3D();
  if(state.view==='render') buildRender();
  paintPlans(); paintSheet(); paintHead(); }

/* ================= views ================= */
/* Declared beside the function that reads it. It used to sit in the boot
   section, which worked only because nothing happened to call showView before
   that line ran -- the same temporal-dead-zone trap that has bitten this file
   before. */
const VIEW_TITLE = { dash:'Dashboard', site:'Site', mass:'Massing',
  render:'Render', plans:'Floor plans', inv:'Area schedule', feas:'Cost and feasibility' };

function showView(v){
  state.view=v;
  const three = (v==='mass'||v==='render');
  const map={site:'paneSite',mass:'paneMass',render:'paneMass',plans:'panePlans',inv:'paneInv'};
  $('paneSite').classList.toggle('on', v==='site');
  $('paneMass').classList.toggle('on', three);
  $('panePlans').classList.toggle('on', v==='plans');
  $('paneInv').classList.toggle('on', v==='inv');
  $('paneFeas').classList.toggle('on', v==='feas');
  $('paneDash').classList.toggle('on', v==='dash');
  for(const [id,k] of [['vwDash','dash'],['vwSite','site'],['vwMass','mass'],
    ['vwRender','render'],['vwPlans','plans'],['vwInv','inv'],['vwFeas','feas']])
    $(id).classList.toggle('on',k===v);
  $('rail').style.display = v==='site' ? '' : 'none';
  $('floors').style.display = v==='mass' ? '' : 'none';
  $('ribbon').style.display =
    (v==='mass'||v==='render'||v==='plans') && state.options.length ? '' : 'none';
  if (gMass){ gMass.visible = v==='mass'; gRender.visible = v==='render'; }
  if(v==='site') paintSite();
  if(three){ resize(); if(v==='render'){ state.floor=-1; buildRender(); } else paint3D(); }
  if(v==='plans') paintPlans();
  if(v==='inv') paintSheet();
  if(v==='feas') paintFeas();
  if(v==='dash') paintDash();
  const t = $('viewTitle'); if (t) t.textContent = VIEW_TITLE[v] || 'buildIT';
  const work = (v==='mass'||v==='render'||v==='plans');
  document.querySelector('.body').classList.toggle('with-info', work);
  if (work) paintInfo();
  if (v !== 'site' && typeof openPanel === 'function') openPanel(false);
}
function flag(m){ const el=$('tabMsg'); el.textContent=m||''; el.classList.toggle('on',!!m); }
/* Inputs have moved on from the solved grid. Anything derived from that grid --
   the entrance markers above all -- would now be drawn at coordinates that no
   longer exist on the plot, which is how entries ended up floating outside the
   boundary. Mark it stale and stop trusting it until the next solve. */
function invalidate(){
  state.vgStale = true;
  if(state.options.length) flag('Inputs changed \u2014 generate again');
}
