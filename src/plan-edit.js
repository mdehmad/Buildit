/* Editing a generated plan: walls, merges, divisions
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ================= plan editing ================= */
// Edits live as overrides on top of the generated plan and everything
// re-derives from them: walls follow whichever bays belong to which room,
// so reassigning a bay is how a wall gets moved.
const WALLK = { solid:'#1d1d1f', partition:'#8e8e93', curtain:'#5a8fb8', none:'#d2d2d7' };
const WALLW = { solid:3.6, partition:2.0, curtain:2.4, none:1.0 };
const WALL_ORDER = ['solid','partition','curtain','none'];

function edits(lvl){
  return (state.edits[lvl] ||= { bays:{}, wall:{}, door:{}, win:{} });
}
// assignment for a level with the user's bay moves applied
function effAssign(){
  if (state._eff) return state._eff;
  const opt = state.options[state.pick];
  if (!opt) return null;
  const a = Int32Array.from(opt.state.assign);
  for (const lvl in state.edits){
    for (const [vid,rid] of Object.entries(state.edits[lvl].bays||{})) a[+vid] = rid;
  }
  return (state._eff = a);
}
const dirtyEdits = () => { state._eff = null; };

// stable key for a wall: a bay plus the side it sits on
const wkey = (id,k) => id+'.'+k;
const OPP = [2,3,0,1];
function wallSegs(lvl){
  const vg = state.vg, pg = state.pg, A = effAssign();
  const out = [], seen = new Set();
  for (const id of (vg.byStory[lvl]||[])){
    const v = vg.voxels[id], a = A[id];
    if (a === -1) continue;
    DIRS.forEach(([dx,dy],k)=>{
      const j = vg.index.get(`${lvl},${v.ix+dx},${v.iy+dy}`);
      const b = (j===undefined) ? null : A[j];
      if (b === a) return;
      const key = (j!==undefined && b!==null && b!==-1 && j<id) ? wkey(j,OPP[k]) : wkey(id,k);
      if (seen.has(key)) return;
      seen.add(key);
      let p1,p2;
      if (k===0)      { p1=[v.x,v.y];         p2=[v.x+v.w,v.y]; }
      else if (k===1) { p1=[v.x+v.w,v.y];     p2=[v.x+v.w,v.y+v.d]; }
      else if (k===2) { p1=[v.x,v.y+v.d];     p2=[v.x+v.w,v.y+v.d]; }
      else            { p1=[v.x,v.y];         p2=[v.x,v.y+v.d]; }
      const ext = (j===undefined || b===null || b===-1);
      out.push({ key, p1, p2, a, b: ext?null:b, ext, id, k, dir:DIRS[k] });
    });
  }
  return out;
}
function defaultWall(sg){
  const pg = state.pg;
  if (sg.ext){
    const r = pg.rooms[sg.a];
    return (r && LEASABLE.has(r.type)) ? 'curtain' : 'solid';
  }
  const ra = pg.rooms[sg.a], rb = pg.rooms[sg.b];
  if (!ra || !rb) return 'partition';
  if (CORE.has(ra.type) || CORE.has(rb.type)) return 'solid';
  return 'partition';
}
const wallOf = (lvl,sg) => edits(lvl).wall[sg.key] || defaultWall(sg);
function defaultDoor(lvl, sg, firstFor){
  if (sg.ext) return false;
  const ra = state.pg.rooms[sg.a], rb = state.pg.rooms[sg.b];
  if (!ra || !rb) return false;
  if ((ra.type==='corridor') === (rb.type==='corridor')) return false;
  const pair = sg.a < sg.b ? sg.a+'|'+sg.b : sg.b+'|'+sg.a;
  if (firstFor.has(pair)) return false;
  firstFor.add(pair);
  return true;
}
function planState(lvl){
  const segs = wallSegs(lvl), E = edits(lvl), first = new Set();
  for (const sg of segs){
    sg.type = wallOf(lvl,sg);
    const auto = defaultDoor(lvl,sg,first);
    sg.door = (sg.key in E.door) ? E.door[sg.key] : auto;
    const autoWin = sg.ext && sg.type==='curtain';
    sg.win = (sg.key in E.win) ? E.win[sg.key] : autoWin;
    if (sg.type==='none'){ sg.door=false; sg.win=false; }
  }
  return segs;
}

/* ---------- the big editable plan ---------- */
let mView = null;
function drawBigPlan(){
  const cv = $('mPlan'), vg = state.vg, pg = state.pg;
  const lvl = state.mLvl, A = effAssign();
  if (!vg || !A) return;
  const wrap = cv.parentElement;
  const size = Math.max(320, Math.min(wrap.clientWidth-32, wrap.clientHeight-32));
  const dpr = Math.min(devicePixelRatio,2);
  cv.style.width = size+'px'; cv.style.height = size+'px';
  cv.width = size*dpr; cv.height = size*dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle='#fff'; g.fillRect(0,0,size,size);

  const m = 56, span = Math.max(vg.totalW, vg.totalD), k = (size-m*2)/span;
  const ox = m+((size-m*2)-vg.totalW*k)/2 - vg.minX*k;
  const oy = m+((size-m*2)-vg.totalD*k)/2 - vg.minY*k;
  mView = { ox, oy, k, size };
  const P = (x,y)=>[ox+x*k, oy+y*k];

  // plot line, in the grid frame the plan is drawn in
  g.save(); g.setLineDash([6,4]); g.strokeStyle='#d2d2d7'; g.lineWidth=1; g.beginPath();
  vg.pts.forEach((p,i)=>{ const [x,y]=P(p.x,p.y); i?g.lineTo(x,y):g.moveTo(x,y); });
  g.closePath(); g.stroke(); g.restore();

  // structural grid
  g.save(); g.strokeStyle='#ededf1'; g.lineWidth=1; g.setLineDash([9,3,2,3]);
  const gy0=oy+vg.minY*k-26, gy1=oy+vg.maxY*k+26, gx0=ox+vg.minX*k-26, gx1=ox+vg.maxX*k+26;
  vg.cx.forEach(x=>{const[px]=P(x,0);g.beginPath();g.moveTo(px,gy0);g.lineTo(px,gy1);g.stroke();});
  vg.cy.forEach(y=>{const[,py]=P(0,y);g.beginPath();g.moveTo(gx0,py);g.lineTo(gx1,py);g.stroke();});
  g.setLineDash([]);
  g.font='500 9px -apple-system,Inter,sans-serif'; g.textAlign='center'; g.textBaseline='middle';
  vg.cx.forEach((x,i)=>{const[px]=P(x,0);g.beginPath();g.arc(px,gy0,8,0,7);
    g.fillStyle='#fff';g.fill();g.strokeStyle='#d2d2d7';g.stroke();
    g.fillStyle='#86868b';g.fillText(GRIDLET(i),px,gy0);});
  vg.cy.forEach((y,i)=>{const[,py]=P(0,y);g.beginPath();g.arc(gx0,py,8,0,7);
    g.fillStyle='#fff';g.fill();g.strokeStyle='#d2d2d7';g.stroke();
    g.fillStyle='#86868b';g.fillText(String(i+1),gx0,py);});
  g.restore();

  /* Zoomed view of the same unit plan the thumbnails show. Drawing the bay
     assignment here instead would put a different layout on screen the moment
     the reader zoomed in. The wall-editing tools act on bay edges, so they are
     held back until they are rebuilt against units; the plan below is read-only. */
  const bigPlan = state.plan && state.plan[lvl];
  if (bigPlan && bigPlan.rooms.length){
    drawUnitPlan(g, bigPlan, P, k, true);

    /* The editable walls, with whichever is hovered or held picked out. */
    const sel = state.mWall, hot = state.mHot;
    const same = (a,b) => a && b && a.axis===b.axis && Math.abs(a.pos-b.pos)<0.4
                       && Math.abs(a.lo-b.lo)<0.4;
    for (const w of demisingWalls(bigPlan)){
      const on = same(w, sel), warm = same(w, hot);
      const [x1,y1] = P(w.axis==='v' ? w.pos : w.lo, w.axis==='v' ? w.lo : w.pos);
      const [x2,y2] = P(w.axis==='v' ? w.pos : w.hi, w.axis==='v' ? w.hi : w.pos);
      g.strokeStyle = on ? '#E2521D' : warm ? 'rgba(226,82,29,.55)' : 'rgba(17,17,17,.0)';
      g.lineWidth = on ? 4 : 3.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
      g.lineCap = 'butt';
      if (on){
        const mx=(x1+x2)/2, my=(y1+y2)/2;
        g.fillStyle='#E2521D'; g.beginPath(); g.arc(mx,my,4,0,7); g.fill();
      }
    }
    g.save();
    g.textAlign='left'; g.textBaseline='alphabetic';
    g.font='600 12px -apple-system,Inter,sans-serif'; g.fillStyle='#1d1d1f';
    const useName = USE_LABEL[pg.floorUse[lvl]] || pg.floorUse[lvl];
    g.fillText(`Level ${lvl+1} \u00b7 ${useName}`, 16, size-28);
    g.font='400 10px -apple-system,Inter,sans-serif'; g.fillStyle='#86868b';
    const nU = bigPlan.rooms.filter(r=>!r.isCore && r.target).length;
    g.fillText(`${bigPlan.typology} plan \u00b7 ${nU} units \u00b7 `
      + `${fmt(Math.round(bigPlan.net))} sq ft net \u00b7 `
      + `${Math.round(bigPlan.circ/bigPlan.gross*100)}% circulation`, 16, size-14);
    g.restore();
    return;
  }

  // bay washes
  for (const id of (vg.byStory[lvl]||[])){
    const v = vg.voxels[id], a = A[id];
    if (a===-1) continue;
    const [x,y]=P(v.x,v.y);
    g.fillStyle = tint(USE_COL[pg.rooms[a].type],0.30);
    g.fillRect(x,y,v.w*k+.4,v.d*k+.4);
    if (state.mTool==='bay'){
      g.strokeStyle='rgba(0,113,227,.22)'; g.lineWidth=1;
      g.strokeRect(x+1,y+1,v.w*k-2,v.d*k-2);
    }
  }
  // locked lift bays
  for (const id of (vg.byStory[lvl]||[])){
    if (!pg.lockedVoxels.has(id)) continue;
    const v=vg.voxels[id], [x,y]=P(v.x,v.y);
    g.save(); g.strokeStyle='rgba(52,199,89,.55)'; g.lineWidth=1;
    for(let o=-v.d*k;o<v.w*k;o+=7){ g.beginPath();
      g.moveTo(x+Math.max(0,o), y+Math.max(0,-o));
      g.lineTo(x+Math.min(v.w*k,o+v.d*k), y+Math.min(v.d*k,v.d*k-o+ (o<0?o:0)));
      g.stroke(); }
    g.restore();
  }

  const segs = planState(lvl);
  state.mSegs = segs;
  // walls
  for (const sg of segs){
    const [x1,y1]=P(sg.p1[0],sg.p1[1]), [x2,y2]=P(sg.p2[0],sg.p2[1]);
    const L=Math.hypot(x2-x1,y2-y1), ux=(x2-x1)/L, uy=(y2-y1)/L;
    const hot = state.mHot===sg.key;
    g.lineCap='butt';
    if (sg.type==='curtain'){
      g.strokeStyle='#1d1d1f'; g.lineWidth=WALLW.curtain;
      const pier=Math.min(L*0.16,3.5*k);
      g.beginPath(); g.moveTo(x1,y1); g.lineTo(x1+ux*pier,y1+uy*pier);
      g.moveTo(x2-ux*pier,y2-uy*pier); g.lineTo(x2,y2); g.stroke();
      g.strokeStyle=WALLK.curtain; g.lineWidth=1.6;
      g.beginPath(); g.moveTo(x1+ux*pier,y1+uy*pier); g.lineTo(x2-ux*pier,y2-uy*pier); g.stroke();
      const n=Math.max(1,Math.round((L-pier*2)/(9*k)));
      g.lineWidth=1; g.strokeStyle='#8fb4cd';
      for(let i=1;i<n;i++){ const t=pier+(L-2*pier)*i/n;
        g.beginPath(); g.moveTo(x1+ux*t-uy*3, y1+uy*t+ux*3);
        g.lineTo(x1+ux*t+uy*3, y1+uy*t-ux*3); g.stroke(); }
    } else if (sg.door && sg.type!=='none'){
      const dw=Math.min(L*0.5, 3.2*k);
      const mx=(x1+x2)/2,my=(y1+y2)/2;
      const j1=[mx-ux*dw/2,my-uy*dw/2], j2=[mx+ux*dw/2,my+uy*dw/2];
      g.strokeStyle=WALLK[sg.type]; g.lineWidth=WALLW[sg.type];
      g.beginPath(); g.moveTo(x1,y1); g.lineTo(j1[0],j1[1]);
      g.moveTo(j2[0],j2[1]); g.lineTo(x2,y2); g.stroke();
      const ra=pg.rooms[sg.a];
      const into = (ra && ra.type==='corridor') ? 1 : -1;
      const nx=-uy*into, ny=ux*into;
      g.strokeStyle='#6e6e73'; g.lineWidth=1.2;
      g.beginPath(); g.moveTo(j1[0],j1[1]); g.lineTo(j1[0]+nx*dw,j1[1]+ny*dw); g.stroke();
      g.beginPath(); g.arc(j1[0],j1[1],dw,Math.atan2(ny,nx),Math.atan2(uy,ux),into>0); g.stroke();
    } else {
      g.strokeStyle=WALLK[sg.type];
      g.lineWidth=WALLW[sg.type];
      if (sg.type==='none') g.setLineDash([4,4]);
      g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
      g.setLineDash([]);
    }
    if (sg.win && sg.type!=='curtain' && sg.ext){
      const pier=Math.min(L*0.24,4*k);
      g.strokeStyle='#fff'; g.lineWidth=WALLW[sg.type];
      g.beginPath(); g.moveTo(x1+ux*pier,y1+uy*pier); g.lineTo(x2-ux*pier,y2-uy*pier); g.stroke();
      g.strokeStyle='#5a8fb8'; g.lineWidth=1.4;
      g.beginPath(); g.moveTo(x1+ux*pier,y1+uy*pier); g.lineTo(x2-ux*pier,y2-uy*pier); g.stroke();
      g.strokeStyle='#1d1d1f'; g.lineWidth=1;
      for (const t of [pier,L-pier]){
        g.beginPath(); g.moveTo(x1+ux*t-uy*3,y1+uy*t+ux*3);
        g.lineTo(x1+ux*t+uy*3,y1+uy*t-ux*3); g.stroke();
      }
    }
    const seld = state.mSel===sg.key;
    if (hot || seld){
      g.strokeStyle = seld ? 'rgba(0,113,227,.95)' : 'rgba(0,113,227,.85)';
      g.lineWidth = WALLW[sg.type] + (seld?7:5);
      g.globalAlpha = seld?.45:.3;
      g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
      g.globalAlpha=1;
      if (seld){
        const mx=(x1+x2)/2,my=(y1+y2)/2;
        g.fillStyle='#0071e3';
        g.beginPath(); g.arc(mx,my,4.5,0,7); g.fill();
      }
    }
  }

  // candidate cut lines while drawing a wall
  if (state.mTool==='split'){
    const A2=effAssign();
    g.save(); g.setLineDash([3,4]); g.strokeStyle='rgba(0,113,227,.4)'; g.lineWidth=1.4;
    for (const id of (vg.byStory[lvl]||[])){
      const a=A2[id]; if(a===-1) continue;
      const v=vg.voxels[id];
      DIRS.forEach(([dx,dy],kk)=>{
        const j=vg.index.get(`${lvl},${v.ix+dx},${v.iy+dy}`);
        if (j===undefined || A2[j]!==a || j<id) return;
        let q1,q2;
        if(kk===0){q1=[v.x,v.y];q2=[v.x+v.w,v.y];}
        else if(kk===1){q1=[v.x+v.w,v.y];q2=[v.x+v.w,v.y+v.d];}
        else if(kk===2){q1=[v.x,v.y+v.d];q2=[v.x+v.w,v.y+v.d];}
        else {q1=[v.x,v.y];q2=[v.x,v.y+v.d];}
        const [a1,b1]=P(q1[0],q1[1]), [a2,b2]=P(q2[0],q2[1]);
        g.beginPath(); g.moveTo(a1,b1); g.lineTo(a2,b2); g.stroke();
      });
    }
    g.restore();
    if (state.mCut){
      const [a1,b1]=P(state.mCut.p1[0],state.mCut.p1[1]);
      const [a2,b2]=P(state.mCut.p2[0],state.mCut.p2[1]);
      g.strokeStyle='#0071e3'; g.lineWidth=4; g.lineCap='round';
      g.beginPath(); g.moveTo(a1,b1); g.lineTo(a2,b2); g.stroke(); g.lineCap='butt';
    }
  }

  // annotations
  const grp={};
  for (const id of (vg.byStory[lvl]||[])){
    const a=A[id]; if(a===-1) continue;
    const v=vg.voxels[id];
    (grp[a] ||= {x0:1e9,y0:1e9,x1:-1e9,y1:-1e9,cx:0,cy:0,n:0,ar:0});
    const o=grp[a];
    o.x0=Math.min(o.x0,v.x); o.y0=Math.min(o.y0,v.y);
    o.x1=Math.max(o.x1,v.x+v.w); o.y1=Math.max(o.y1,v.y+v.d);
    o.cx+=v.x+v.w/2; o.cy+=v.y+v.d/2; o.n++; o.ar+=v.area;
  }
  state.mAreas = grp;
  g.textAlign='center'; g.textBaseline='middle';
  for (const [rid,o] of Object.entries(grp)){
    const r=pg.rooms[rid];
    const [bx,by]=P(o.x0,o.y0), [bx2,by2]=P(o.x1,o.y1);
    const bw=bx2-bx, bh=by2-by;
    if (r.type==='stairs' && bw>16 && bh>16){
      const vert=bh>bw; g.strokeStyle='#1d1d1f'; g.lineWidth=1;
      for(let i=1;i<9;i++){const t=i/9; g.beginPath();
        if(vert){g.moveTo(bx+4,by+bh*t);g.lineTo(bx+bw-4,by+bh*t);}
        else{g.moveTo(bx+bw*t,by+4);g.lineTo(bx+bw*t,by+bh-4);} g.stroke();}
    }
    if (r.type==='elevator' && bw>14 && bh>14){
      g.strokeStyle='#1d1d1f'; g.lineWidth=1;
      g.beginPath(); g.moveTo(bx+4,by+4); g.lineTo(bx2-4,by2-4);
      g.moveTo(bx2-4,by+4); g.lineTo(bx+4,by2-4); g.stroke();
    }
    if (o.ar < 150) continue;
    const tx=ox+(o.cx/o.n)*k, ty=oy+(o.cy/o.n)*k;
    g.font='600 11px -apple-system,Inter,sans-serif'; g.fillStyle='#1d1d1f';
    g.fillText(r.name, tx, ty-13);
    g.font='400 9.5px -apple-system,Inter,sans-serif'; g.fillStyle='#6e6e73';
    g.fillText(fmt(o.ar)+' sq ft', tx, ty-1);
    const wft=Math.round(o.x1-o.x0), dft=Math.round(o.y1-o.y0);
    g.fillStyle='#a1a1a6'; g.fillText(`${wft}' \u00d7 ${dft}'`, tx, ty+11);
  }
  // title and scale
  g.textAlign='left'; g.textBaseline='alphabetic';
  g.font='600 13px -apple-system,Inter,sans-serif'; g.fillStyle='#1d1d1f';
  g.fillText(`Level ${lvl+1}`, 18, size-26);
  g.font='400 10px -apple-system,Inter,sans-serif'; g.fillStyle='#86868b';
  g.fillText(`${USE_LABEL[pg.floorUse[lvl]]||pg.floorUse[lvl]} \u00b7 ${state.cfg.bay} ft structural grid \u00b7 1 bay = ${fmt(state.cfg.bay*state.cfg.bay)} sq ft`, 18, size-12);
  const nx2=size-34, ny2=34;
  g.save(); g.translate(nx2,ny2); g.rotate(-(vg.angle||0));
  g.strokeStyle='#1d1d1f'; g.lineWidth=1.2;
  g.beginPath(); g.moveTo(0,13); g.lineTo(0,-13);
  g.moveTo(-5,-5); g.lineTo(0,-13); g.lineTo(5,-5); g.stroke();
  g.font='600 9px -apple-system,Inter,sans-serif'; g.fillStyle='#1d1d1f';
  g.textAlign='center'; g.textBaseline='middle'; g.fillText('N',0,22);
  g.restore();
  g.textAlign='left'; g.textBaseline='alphabetic';
  const sl=50*k, sx=size-20-sl, sy=size-20;
  g.strokeStyle='#a1a1a6'; g.lineWidth=1;
  g.beginPath(); g.moveTo(sx,sy); g.lineTo(sx+sl,sy);
  g.moveTo(sx,sy-4); g.lineTo(sx,sy+4); g.moveTo(sx+sl,sy-4); g.lineTo(sx+sl,sy+4); g.stroke();
  g.font='400 9px -apple-system,Inter,sans-serif'; g.fillStyle='#a1a1a6';
  g.textAlign='center'; g.fillText('50 ft', sx+sl/2, sy-8);
}

/* ---------- wall operations ---------- */
const segAxis = sg => (sg.k % 2 === 0) ? 'h' : 'v';
const segCoord = sg => segAxis(sg)==='h' ? sg.p1[1] : sg.p1[0];

// every segment of the same wall: same line, same two rooms
function wallRun(sg){
  const ax = segAxis(sg), c = segCoord(sg);
  const pair = (x,y) => (x===null?'e':x)+'|'+(y===null?'e':y);
  const want = pair(Math.min(sg.a, sg.b===null?1e9:sg.b), Math.max(sg.a, sg.b===null?-1:sg.b));
  return (state.mSegs||[]).filter(o =>
    segAxis(o)===ax && Math.abs(segCoord(o)-c) < 0.01 &&
    pair(Math.min(o.a, o.b===null?1e9:o.b), Math.max(o.a, o.b===null?-1:o.b)) === want);
}
// the bay on each side of a segment
function sidesOf(sg){
  const vg = state.vg, v = vg.voxels[sg.id];
  const [dx,dy] = sg.dir;
  const j = vg.index.get(`${sg.lvl ?? state.mLvl},${v.ix+dx},${v.iy+dy}`);
  return { near: sg.id, far: (j===undefined ? -1 : j) };
}
function countBays(rid){
  const A = effAssign();
  let n = 0;
  for (const id of (state.vg.byStory[state.mLvl]||[])) if (A[id]===rid) n++;
  return n;
}
// push a wall one bay: into===sg.b takes from B and gives to A, and vice versa
function moveWall(run, intoB){
  const E = edits(state.mLvl), A = effAssign(), vg = state.vg;
  const give = [], from = intoB ? run[0].b : run[0].a;
  const to   = intoB ? run[0].a : run[0].b;
  if (from === null || to === null) return 'Outside walls cannot be moved.';
  if (state.pg.rooms[from].fixed || state.pg.rooms[to].fixed)
    return 'The lift shaft is fixed on every level.';
  for (const sg of run){
    const s = sidesOf(sg);
    const cell = (A[s.near]===from) ? s.near : s.far;
    if (cell < 0 || A[cell] !== from) continue;
    if (state.pg.lockedVoxels.has(cell)) return 'That run touches the lift shaft.';
    give.push(cell);
  }
  if (!give.length) return 'Nothing left to move there.';
  if (countBays(from) - give.length < 1)
    return `${state.pg.rooms[from].name} would disappear \u2014 delete the wall instead.`;
  for (const c of give) E.bays[c] = to;
  dirtyEdits();
  return null;
}
// remove a wall entirely: the two spaces become one
function deleteWall(sg){
  if (sg.b === null) return 'Outside walls cannot be deleted.';
  const E = edits(state.mLvl), A = effAssign();
  const ra = state.pg.rooms[sg.a], rb = state.pg.rooms[sg.b];
  if (ra.fixed || rb.fixed) return 'The lift shaft cannot be merged away.';
  const na = countBays(sg.a), nb = countBays(sg.b);
  const keep = na >= nb ? sg.a : sg.b, drop = na >= nb ? sg.b : sg.a;
  for (const id of (state.vg.byStory[state.mLvl]||[])) if (A[id]===drop) E.bays[id] = keep;
  dirtyEdits();
  return { merged: state.pg.rooms[drop].name, into: state.pg.rooms[keep].name };
}
// cut a space in two along an internal grid line
function splitAt(sg){
  const vg = state.vg, pg = state.pg, A = effAssign(), lvl = state.mLvl;
  const rid = sg.a;
  const r = pg.rooms[rid];
  if (r.fixed) return 'The lift shaft cannot be subdivided.';
  const ax = segAxis(sg), c = segCoord(sg);
  // every same-room bay pair straddling this line
  const cut = new Set();
  for (const id of (vg.byStory[lvl]||[])){
    if (A[id] !== rid) continue;
    const v = vg.voxels[id];
    DIRS.forEach(([dx,dy],k)=>{
      if ((k%2===0 ? 'h' : 'v') !== ax) return;
      const j = vg.index.get(`${lvl},${v.ix+dx},${v.iy+dy}`);
      if (j===undefined || A[j] !== rid) return;
      const edgeC = (ax==='h')
        ? (k===0 ? v.y : v.y+v.d)
        : (k===3 ? v.x : v.x+v.w);
      if (Math.abs(edgeC - c) > 0.01) return;
      cut.add(id+'~'+j); cut.add(j+'~'+id);
    });
  }
  if (!cut.size) return 'Pick a line inside a single space.';
  // flood one side
  const mine = new Set();
  for (const id of (vg.byStory[lvl]||[])) if (A[id]===rid) mine.add(id);
  const start = sg.id;
  const seen = new Set([start]), q = [start];
  while (q.length){
    const cur = q.pop();
    for (const n of vg.voxels[cur].nbrs){
      if (!mine.has(n) || seen.has(n)) continue;
      if (cut.has(cur+'~'+n)) continue;
      seen.add(n); q.push(n);
    }
  }
  if (seen.size === mine.size) return 'That line does not divide the space in two.';
  const other = [...mine].filter(id=>!seen.has(id));
  const grp = (seen.size <= other.length) ? [...seen] : other;
  // a new space, same use as its parent
  const sameKind = (pg.byStory[lvl]||[]).filter(i=>pg.rooms[i].mixId===r.mixId).length;
  const nr = { id: pg.rooms.length, type: r.type, s: lvl, unit: r.unit, mixId: r.mixId,
    name: r.unit ? `${r.name} ${String.fromCharCode(65+sameKind)}` : r.name+' 2',
    target: r.target, want: r.want, split: true };
  pg.rooms.push(nr); (pg.byStory[lvl] ||= []).push(nr.id);
  const E = edits(lvl);
  for (const id of grp) E.bays[id] = nr.id;
  dirtyEdits();
  return { created: nr.name };
}

/* ---------- interaction ---------- */
const M_TOOLS = [ ['sel','Select & drag'], ['split','Divide a unit'] ];
function mLocal(e){ const r=$('mPlan').getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }
function mToFt(px,py){ const v=mView; return { x:(px-v.ox)/v.k, y:(py-v.oy)/v.k }; }
function bayAt(px,py){
  const f=mToFt(px,py), vg=state.vg;
  for (const id of (vg.byStory[state.mLvl]||[])){
    const v=vg.voxels[id];
    if (f.x>=v.x && f.x<=v.x+v.w && f.y>=v.y && f.y<=v.y+v.d) return id;
  }
  return -1;
}
function segAt(px,py){
  let best=null, bd=11;
  for (const sg of (state.mSegs||[])){
    const [x1,y1]=[mView.ox+sg.p1[0]*mView.k, mView.oy+sg.p1[1]*mView.k];
    const [x2,y2]=[mView.ox+sg.p2[0]*mView.k, mView.oy+sg.p2[1]*mView.k];
    const dx=x2-x1, dy=y2-y1, L2=dx*dx+dy*dy;
    let t=L2?((px-x1)*dx+(py-y1)*dy)/L2:0; t=Math.max(0,Math.min(1,t));
    const d=Math.hypot(px-(x1+t*dx), py-(y1+t*dy));
    if (d<bd){ bd=d; best=sg; }
  }
  return best;
}
/* ---- editing by pointer ------------------------------------------------- */
function mSay(t){ const el=$('mHint'); if(el) el.textContent=t; }

function mDown(e){
  const plan = state.plan && state.plan[state.mLvl]; if (!plan) return;
  const [px,py] = mLocal(e);
  const f = mToFt(px,py);
  const tol = 7 / (mView.k || 1);

  if (state.mTool === 'split'){
    const i = roomAtFt(plan, f);
    if (i < 0){ mSay('Click inside a unit to divide it.'); return; }
    const at = plan.rooms[i].w >= plan.rooms[i].d ? f.x : f.y;
    const err = tryEdit(plan, () => splitRoom(plan, i, at, levelKind(state.mLvl)));
    mSay(err || 'Divided. Drag the new wall to adjust it.');
    if (!err) afterEdit();
    return;
  }

  const w = wallNear(plan, f, tol);
  if (w){
    state.mWall = w; state.mDrag = true;
    $('mPlan').setPointerCapture(e.pointerId);
    mSay('Drag to move the wall. Press Delete to merge the two units.');
    drawBigPlan();
    return;
  }
  const i = roomAtFt(plan, f);
  state.mWall = null; state.mRoomSel = i;
  mSay(i >= 0 ? `${plan.rooms[i].label} \u00b7 ${fmt(Math.round(plan.rooms[i].area))} sq ft`
              : 'Click a wall to select it, or a unit to see its area.');
  drawBigPlan();
}

function mMove(e){
  const plan = state.plan && state.plan[state.mLvl]; if (!plan) return;
  const [px,py] = mLocal(e);
  const f = mToFt(px,py);

  if (state.mDrag && state.mWall){
    const err = tryEdit(plan, () =>
      moveWall(plan, state.mWall, state.mWall.axis === 'v' ? f.x : f.y));
    if (!err){
      const R = plan.rooms, k = levelKind(state.mLvl);
      relabel(R[state.mWall.a], k); relabel(R[state.mWall.b], k);
      state.mWall.pos = state.mWall.axis === 'v' ? R[state.mWall.b].x : R[state.mWall.b].y;
      mSay(`${R[state.mWall.a].label} ${fmt(Math.round(R[state.mWall.a].area))} \u00b7 `
         + `${R[state.mWall.b].label} ${fmt(Math.round(R[state.mWall.b].area))} sq ft`);
      drawBigPlan();
    } else mSay(err);
    return;
  }
  const tol = 7 / (mView.k || 1);
  const hot = wallNear(plan, f, tol);
  const was = state.mHot;
  state.mHot = hot;
  $('mPlan').style.cursor = hot ? (hot.axis==='v' ? 'ew-resize' : 'ns-resize')
                                : (state.mTool==='split' ? 'crosshair' : 'default');
  if ((!!hot) !== (!!was) || (hot && was && hot.pos !== was.pos)) drawBigPlan();
}

function mUp(e){
  if (!state.mDrag) return;
  state.mDrag = false;
  try { $('mPlan').releasePointerCapture(e.pointerId); } catch(_){}
  afterEdit();
}

function deleteSelected(){
  const plan = state.plan && state.plan[state.mLvl];
  if (!plan || !state.mWall){ mSay('Select a wall first, then press Delete.'); return; }
  const err = tryEdit(plan, () => mergeWall(plan, state.mWall));
  if (err){ mSay(err); return; }
  relabel(plan.rooms[Math.min(state.mWall.a, plan.rooms.length-1)], levelKind(state.mLvl));
  state.mWall = null;
  mSay('Merged.');
  afterEdit();
}

/* Revert this level to what the planner produced. */
function revertLevel(){
  const fresh = buildPlans(state.vg, state.pg, state.cfg);
  if (fresh && fresh[state.mLvl]) state.plan[state.mLvl] = fresh[state.mLvl];
  state.mWall = null; state.mHot = null;
  mSay('Level reset to the generated layout.');
  afterEdit();
}

function syncDownstream(){
  paintHead(); paintSheet(); paint3D();
  if (state.view==='render') buildRender();
  paintRibbon();
}
function markEdited(){ state.mEdited=true; }

function redrawEditor(){ drawBigPlan(); paintRoomList(); }
function paintRoomList(){
  const pg=state.pg, g=state.mAreas||{};

  /* List the units the plan actually shows. Grouped by type, because a
     thirty-row list of individual flats is a worse answer to "what is on this
     level" than "7 x 1 Bed, 5 x 2 Bed". */
  const up = state.plan && state.plan[state.mLvl];
  if (up && up.rooms.length){
    const by = new Map();
    for (const r of up.rooms){
      const k = r.label;
      const e = by.get(k) || { label:r.label, use:r.use, n:0, area:0 };
      e.n++; e.area += r.area; by.set(k, e);
    }
    by.set('__circ', { label:'Circulation', use:'corridor', n:1, area:up.circ });
    $('mRooms').innerHTML = [...by.values()]
      .sort((a,b)=>b.area-a.area)
      .map(e=>`<div class="mrow">
        <i style="background:${USE_COL[e.use]||'#c7c7cc'}"></i>
        <span>${e.n>1?e.n+' \u00d7 ':''}${e.label}</span>
        <b>${fmt(Math.round(e.area))}</b></div>`).join('')
      + `<p class="sub" style="margin-top:10px">Units are laid out by frontage
         along the corridor. The wall tools act on the old bay grid and are
         being rebuilt for this plan \u2014 the drawing is read-only for now.</p>`;
    return;
  }

  const ids=(pg.byStory[state.mLvl]||[]).filter(rid=>(state.mAreas||{})[rid]);
  $('mRooms').innerHTML = ids.map(rid=>{
    const r=pg.rooms[rid], o=g[rid];
    const lock = r.fixed ? ' lock' : '';
    return `<div class="mrow${state.mRoom===rid?' on':''}${lock}" data-r="${rid}">
      <i style="background:${USE_COL[r.type]}"></i><span>${r.name}</span>
      <b>${o?fmt(o.ar):0}</b></div>`;
  }).join('');
  $('mRooms').querySelectorAll('.mrow').forEach(el=>el.onclick=()=>{
    state.mRoom=+el.dataset.r; paintRoomList();
  });
}
function paintTools(){
  $('mTools').innerHTML = M_TOOLS.map(([k,l])=>
    `<button data-t="${k}" class="${state.mTool===k?'on':''}">${l}</button>`).join('');
  $('mTools').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    state.mTool=b.dataset.t; paintTools(); drawBigPlan();
    state.mSel=null; state.mCut=null;
    mSay(({sel:'Click a wall to select it, drag to move it, press Delete to remove it.',
      split:'Hover a dotted line inside a space and click to cut a new wall there.',
      wall:'Click a wall to cycle solid \u2192 partition \u2192 curtain \u2192 open.',
      door:'Click an internal wall to add or remove a door.',
      win:'Click an external wall to add or remove a window.',
      erase:'Click a wall to revert it to the generated default.'})[state.mTool]);
  });
}
function openPlan(lvl){
  if (!state.vg || !state.options.length) return;
  state.mLvl=lvl; state.mTool=state.mTool||'sel';
  state.mRoom=null; state.mHot=null; state.mSel=null; state.mCut=null; state.mDrag=null;
  $('planModal').classList.add('on');
  paintTools(); redrawEditor(); mNav();
  mSay('Click a wall to select it, drag to move it, press Delete to remove it.');
}
function mNav(){
  $('mTitle').textContent = 'Level '+(state.mLvl+1);
  $('mOpt').innerHTML = state.options.map((o,i)=>
    `<button data-i="${i}" class="${i===state.pick?'on':''}" title="${o.sch.name}"
      >${String.fromCharCode(65+i)}</button>`).join('');
  $('mOpt').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    applyOption(+b.dataset.i);
    // schemes differ in storey count, so the level being edited may be gone
    if (state.mLvl >= state.cfg.stories) state.mLvl = 0;
    mNav(); redrawEditor(); refreshAll();
  });
}
function mStep(d){
  const vg=state.vg;
  let l=state.mLvl+d;
  while (l>=0 && l<state.cfg.stories && !(vg.byStory[l]||[]).length) l+=d;
  if (l<0||l>=state.cfg.stories) return;
  state.mLvl=l; state.mRoom=null; redrawEditor(); mNav();
}
