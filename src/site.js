/* Unit mix, the plot, and the site drawing canvas
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ================= unit mix ================= */
function levelsFor(use){
  const n=(state.size||sizeNow()).storeys, st=resolveStack(state.stack,n);
  const ls=[]; st.forEach((u,i)=>{ if(u===use) ls.push(i+1); });
  if(!ls.length) return '';
  const out=[]; let a=ls[0], p=ls[0];
  for(let i=1;i<=ls.length;i++){
    if(ls[i]===p+1){ p=ls[i]; continue; }
    out.push(a===p?('L'+a):('L'+a+'\u2013'+p)); a=ls[i]; p=ls[i];
  }
  return out.join(', ');
}
function paintMix(){
  const built={};
  if (state.pg) for (const r of state.pg.rooms) if (r.unit && r.mixId)
    built[r.mixId]=(built[r.mixId]||0)+1;
  $('mixRows').innerHTML = state.mix.map(m=>`
    <div class="unit" data-id="${m.id}">
      <div class="top">
        <i class="sw" style="background:${USE_COL[m.use]}"></i>
        <input class="fld" data-f="name" value="${m.name.replace(/"/g,'&quot;')}">
        <button class="x" data-x="1" title="Remove">&times;</button>
      </div>
      <div class="g">
        <div><label>Use</label>
          <select class="fld" data-f="use">${USES.map(u=>
            `<option value="${u}"${u===m.use?' selected':''}>${u[0].toUpperCase()+u.slice(1)}</option>`).join('')}</select></div>
        <div><label>Size, sq ft</label>
          <input class="fld" type="number" min="80" step="10" data-f="unitArea" value="${m.unitArea}"></div>
      </div>
      <div class="g">
        <div><label>Mix ratio</label>
          <input class="fld" type="number" min="0" max="20" data-f="perFloor" value="${m.perFloor}"></div>
        <div><label>Built</label>
          <input class="fld" value="${built[m.id]||0} units" disabled style="opacity:.6"></div>
      </div>
      <p class="tiny" style="margin:6px 0 0">On ${USE_LABEL[m.use]} levels
        (${levelsFor(m.use)||'none'})</p>
    </div>`).join('');

  $('mixRows').querySelectorAll('.unit').forEach(el=>{
    const m = state.mix.find(x=>x.id===el.dataset.id);
    el.querySelector('[data-x]').onclick = ()=>{
      if (state.mix.length<=1) return;
      state.mix = state.mix.filter(x=>x.id!==m.id);
      paintMix(); syncLabels(); invalidate();
    };
    el.querySelectorAll('[data-f]').forEach(inp=>{
      inp.onchange = ()=>{
        const f = inp.dataset.f;
        m[f] = (f==='name'||f==='use') ? inp.value : Math.max(0,+inp.value||0);
        paintMix(); invalidate();
      };
    });
  });
}


/* ================= plot ================= */
function faceOf(e){
  let a = Math.atan2(-e.nx, e.ny)*180/Math.PI;
  if (a<0) a+=360;
  return COMPASS[Math.round(a/45)%8];
}
function normalizeSite(){
  const st = state.site;
  if (polyArea(st.pts) >= 0) return;
  const n = st.pts.length, sb = st.setbacks.slice();
  st.pts = st.pts.slice().reverse();
  st.setbacks = st.pts.map((_,j)=> sb[((n-2-j)%n+n)%n] ?? 0);
}
const plotArea = () => Math.abs(polyArea(state.site.pts));

function paintEdgeRows(){
  normalizeSite();
  const edges = edgeData(state.site.pts), sb = state.site.setbacks;
  $('edgeRows').innerHTML = edges.map((e,i)=>`
    <div class="edge${state.hotEdge===i?' hot':''}" data-i="${i}">
      <span class="face">${faceOf(e)}</span>
      <span class="len">${Math.round(e.len)} ft</span>
      <input class="fld" type="number" min="0" max="200" data-i="${i}" value="${sb[i]??0}">
      <span class="u">ft</span>
    </div>`).join('');
  $('edgeRows').querySelectorAll('input').forEach(inp=>{
    inp.oninput = ()=>{ state.site.setbacks[+inp.dataset.i]=Math.max(0,Math.min(200,+inp.value||0));
      resize2(); invalidate(); };
  });
  $('edgeRows').querySelectorAll('.edge').forEach(el=>{
    el.onmouseenter=()=>{ state.hotEdge=+el.dataset.i; paintSite(); hotRows(); };
    el.onmouseleave=()=>{ state.hotEdge=-1; paintSite(); hotRows(); };
  });
}
const hotRows = () => $('edgeRows').querySelectorAll('.edge').forEach(el=>
  el.classList.toggle('hot', +el.dataset.i===state.hotEdge));

function plotNote(){
  const c = readCfg(), a = plotArea();
  const vg = buildVoxelGraph({pts:state.site.pts,setbacks:state.site.setbacks},
    {stories:1,upperSetback:0,bay:c.bay,gridAngle:c.gridAngle});
  const foot = vg.voxels.reduce((s,v)=>s+v.area,0);
  $('mSite').textContent = fmt(a)+' sq ft';
  $('plotNote').innerHTML = `${state.site.pts.length} edges &middot; <b>${fmt(a)} sq ft</b>.
    Ground floor covers <b>${fmt(foot)} sq ft</b> after setbacks,
    in ${vg.voxels.length} bays of ${c.bay}&times;${c.bay} ft.`;
}

/* ================= plot canvas ================= */
let sctx;
function initSite(){
  const cv = $('site'); sctx = cv.getContext('2d');
  cv.addEventListener('pointerdown',siteDown);
  cv.addEventListener('pointermove',siteMove);
  cv.addEventListener('pointerup',siteUp);
  cv.addEventListener('pointerleave',()=>{state.hotEdge=-1;paintSite();hotRows();});
  cv.addEventListener('contextmenu',e=>e.preventDefault());
}
function computeView(){
  const cv=$('site'), w=cv.clientWidth, h=cv.clientHeight;
  const pts = state.drawing&&state.draft.length ? state.draft : state.site.pts;
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y), pad=70;
  const x0=Math.min(...xs)-pad, x1=Math.max(...xs)+pad;
  const y0=Math.min(...ys)-pad, y1=Math.max(...ys)+pad;
  const k=Math.min(w/(x1-x0), h/(y1-y0));
  return { k, ox:(w-(x1-x0)*k)/2-x0*k, oy:(h-(y1-y0)*k)/2-y0*k, w, h };
}
const toPx=(v,p)=>[v.ox+p.x*v.k, v.oy+p.y*v.k];
const toFt=(v,px,py)=>({x:(px-v.ox)/v.k, y:(py-v.oy)/v.k});
const snap=n=>Math.round(n/5)*5;

function paintSite(){
  const cv=$('site'), dpr=Math.min(devicePixelRatio,2);
  const w=cv.clientWidth, h=cv.clientHeight; if(!w||!h) return;
  cv.width=w*dpr; cv.height=h*dpr;
  const g=sctx; g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
  /* The view is held still. It used to be recomputed on every repaint, so
     dragging a corner re-fitted the canvas under the cursor and the drawing
     appeared to zoom and pan by itself. It now only re-fits on a fresh site,
     on resize, or when Fit is pressed. */
  if (!state.vw || state.fitPending){ state.vw = computeView(); state.fitPending = false; }
  const v = state.vw;
  if (state.img && state.img.el && state.img.el.complete){
    const im=state.img;
    const hft = im.wft * (im.el.naturalHeight/im.el.naturalWidth);
    const [ix,iy]=toPx(v,{x:im.cx-im.wft/2, y:im.cy-hft/2});
    g.save(); g.globalAlpha=state.imgOp;
    g.drawImage(im.el, ix, iy, im.wft*v.k, hft*v.k);
    g.restore();
    if (state.tool==='img'){
      g.strokeStyle='rgba(0,113,227,.8)'; g.lineWidth=1.5; g.setLineDash([6,4]);
      g.strokeRect(ix,iy,im.wft*v.k,hft*v.k); g.setLineDash([]);
    }
  }
  const f0=toFt(v,0,0), f1=toFt(v,w,h);
  for (const [step,col] of [[10,'#f3f3f5'],[50,'#e5e5ea']]){
    g.strokeStyle=col; g.lineWidth=1; g.beginPath();
    for(let x=Math.floor(f0.x/step)*step;x<f1.x;x+=step){const[px]=toPx(v,{x,y:0});g.moveTo(px+.5,0);g.lineTo(px+.5,h);}
    for(let y=Math.floor(f0.y/step)*step;y<f1.y;y+=step){const[,py]=toPx(v,{x:0,y});g.moveTo(0,py+.5);g.lineTo(w,py+.5);}
    g.stroke();
  }
  normalizeSite();
  const pts = state.drawing ? state.draft : state.site.pts;
  if(!pts.length){ scaleBar(g,v,w,h); return; }

  g.beginPath();
  pts.forEach((p,i)=>{const[x,y]=toPx(v,p); i?g.lineTo(x,y):g.moveTo(x,y);});
  if(!state.drawing) g.closePath();
  if(!state.drawing){ g.fillStyle='rgba(255,255,255,.92)'; g.fill(); }
  g.strokeStyle='#1d1d1f'; g.lineWidth=2; g.stroke();

  if (state.drawing){
    if (state.cursor && pts.length){
      const [lx,ly]=toPx(v,pts[pts.length-1]);
      g.setLineDash([5,4]); g.strokeStyle='#0071e3'; g.lineWidth=1.5;
      g.beginPath(); g.moveTo(lx,ly); g.lineTo(state.cursor[0],state.cursor[1]); g.stroke();
      g.setLineDash([]);
      const ft=toFt(v,state.cursor[0],state.cursor[1]);
      const run=Math.hypot(ft.x-pts[pts.length-1].x, ft.y-pts[pts.length-1].y);
      g.fillStyle='#0071e3'; g.font='600 11px ui-monospace,SFMono-Regular,monospace';
      g.textAlign='left'; g.textBaseline='bottom';
      g.fillText(`${Math.round(run)} ft`, state.cursor[0]+10, state.cursor[1]-6);
    }
    g.fillStyle='#0071e3';
    pts.forEach((p,i)=>{const[x,y]=toPx(v,p);g.beginPath();g.arc(x,y,i===0?6:4,0,7);g.fill();});
    scaleBar(g,v,w,h); return;
  }

  const c=readCfg();
  const vg=buildVoxelGraph({pts:state.site.pts,setbacks:state.site.setbacks},
    {stories:1,upperSetback:0,bay:c.bay,gridAngle:c.gridAngle});
  g.fillStyle='rgba(0,113,227,.12)'; g.strokeStyle='rgba(0,113,227,.32)'; g.lineWidth=1;
  const W2 = p => vg.angle ? rotPt(p, vg.angle, vg.pivot) : p;
  for (const cell of vg.voxels){
    const c4=[{x:cell.x,y:cell.y},{x:cell.x+cell.w,y:cell.y},
              {x:cell.x+cell.w,y:cell.y+cell.d},{x:cell.x,y:cell.y+cell.d}].map(W2);
    g.beginPath();
    c4.forEach((q,qi)=>{ const [qx,qy]=toPx(v,q); qi?g.lineTo(qx,qy):g.moveTo(qx,qy); });
    g.closePath(); g.fill(); g.stroke();
  }

  const edges=edgeData(pts);
  g.font='500 11px -apple-system,Inter,sans-serif'; g.textAlign='center'; g.textBaseline='middle';
  edges.forEach((e,i)=>{
    const sb=state.site.setbacks[i]||0, hot=state.hotEdge===i;
    if (sb>0){
      const [ax,ay]=toPx(v,e.a), [bx,by]=toPx(v,e.b);
      const ix=e.nx*sb*v.k, iy=e.ny*sb*v.k;
      g.beginPath(); g.moveTo(ax,ay); g.lineTo(bx,by);
      g.lineTo(bx+ix,by+iy); g.lineTo(ax+ix,ay+iy); g.closePath();
      g.fillStyle = hot?'rgba(194,112,58,.26)':'rgba(194,112,58,.1)'; g.fill();
      g.strokeStyle = hot?'#c2703a':'rgba(194,112,58,.42)';
      g.setLineDash([5,4]); g.lineWidth=hot?1.8:1;
      g.beginPath(); g.moveTo(ax+ix,ay+iy); g.lineTo(bx+ix,by+iy); g.stroke(); g.setLineDash([]);
    }
    const mid={x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2}, [mx,my]=toPx(v,mid);
    const lx=mx-e.nx*20, ly=my-e.ny*20;
    const txt=`${faceOf(e)}  ${Math.round(e.len)}'`;
    const tw=g.measureText(txt).width;
    state.dimHits[i]={x:lx-tw/2-5,y:ly-9,w:tw+10,h:18,cx:lx,cy:ly};
    if (state.tool==='select'){
      g.fillStyle='rgba(255,255,255,.75)';
      g.fillRect(lx-tw/2-5, ly-9, tw+10, 18);
    }
    g.fillStyle = hot?'#c2703a':'#6e6e73';
    g.fillText(txt, lx, ly);
    if (sb>0){
      const [cx,cy]=toPx(v,{x:mid.x+e.nx*sb/2,y:mid.y+e.ny*sb/2});
      g.fillStyle = hot?'#c2703a':'#b0854f'; g.fillText(`${sb}'`,cx,cy);
    }
  });
  if (state.tool==='add'){
    g.lineWidth=1.5;
    edges.forEach(e=>{
      const [x,y]=toPx(v,{x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2});
      g.beginPath(); g.arc(x,y,5,0,7);
      g.fillStyle='#fff'; g.fill(); g.strokeStyle='#0071e3'; g.stroke();
    });
  }
  // entrances: the bays that can take one while the tool is live, then the doors
  if (state.vg){
    const poly = cell => [{x:cell.x,y:cell.y},{x:cell.x+cell.w,y:cell.y},
      {x:cell.x+cell.w,y:cell.y+cell.d},{x:cell.x,y:cell.y+cell.d}].map(fromGrid);
    const trace = pl => { g.beginPath();
      pl.forEach((q,qi)=>{ const [qx,qy]=toPx(v,q); qi?g.lineTo(qx,qy):g.moveTo(qx,qy); });
      g.closePath(); };

    g.font='600 9px -apple-system,Inter,sans-serif';
    g.textAlign='center'; g.textBaseline='middle';
    for (const en of ((state.vg && !state.vgStale) ? entranceList() : [])){
      const cell = state.vg.voxels[en.id];
      if (!cell) continue;
      trace(poly(cell));
      g.fillStyle = en.manual ? 'rgba(122,46,30,.34)' : 'rgba(122,46,30,.20)';
      g.fill();
      g.strokeStyle='#7a2e1e'; g.lineWidth=2.4;
      if (!en.manual) g.setLineDash([5,3]);
      g.stroke(); g.setLineDash([]);
      if (en.face >= 0){
        const [dx,dy] = DIRS[en.face];
        let p1,p2;
        if (dx===1)      { p1={x:cell.x+cell.w,y:cell.y}; p2={x:cell.x+cell.w,y:cell.y+cell.d}; }
        else if (dx===-1){ p1={x:cell.x,y:cell.y};        p2={x:cell.x,y:cell.y+cell.d}; }
        else if (dy===1) { p1={x:cell.x,y:cell.y+cell.d}; p2={x:cell.x+cell.w,y:cell.y+cell.d}; }
        else             { p1={x:cell.x,y:cell.y};        p2={x:cell.x+cell.w,y:cell.y}; }
        const [ax,ay]=toPx(v,fromGrid(p1)), [bx,by]=toPx(v,fromGrid(p2));
        g.strokeStyle='#7a2e1e'; g.lineWidth=5; g.lineCap='round';
        g.beginPath(); g.moveTo(ax,ay); g.lineTo(bx,by); g.stroke(); g.lineCap='butt';
      }
      const [cxp,cyp]=toPx(v, fromGrid({x:cell.x+cell.w/2, y:cell.y+cell.d/2}));
      g.fillStyle='#7a2e1e';
      g.fillText(en.manual ? 'ENTRY' : 'ENTRY · auto', cxp, cyp);
    }
  }
  /* Entrance markers, drawn from the stored boundary points. These exist
     whether or not a scheme has been solved, which is the whole point of
     keeping them in site coordinates: you place the door, then generate. */
  if (state.site.pts.length >= 3){
    const ents = state.entrances || [];
    const drawDoor = (pt, solid) => {
      const [ex,ey] = toPx(v, pt);
      const e2 = edgeData(state.site.pts)[ (snapToBoundary(pt)||{edge:0} ).edge ] ;
      const nx = e2 ? e2.nx : 0, ny = e2 ? e2.ny : 1;
      const tx = -ny, ty = nx;                       // along the boundary
      const half = Math.max(9, 11 * v.k);
      g.strokeStyle = '#7a2e1e';
      g.lineWidth = solid ? 5 : 3;
      g.setLineDash(solid ? [] : [5,4]);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ex - tx*half, ey - ty*half);
      g.lineTo(ex + tx*half, ey + ty*half);
      g.stroke();
      g.setLineDash([]); g.lineCap = 'butt';
      // a short leader pointing in, the way a door swing is indicated
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(ex, ey);
      g.lineTo(ex + nx*half*0.85, ey + ny*half*0.85); g.stroke();
    };
    for (const pt of ents) drawDoor(pt, true);
    if (state.tool === 'entrance' && state.entHoverPt){
      const dup = ents.some(m => Math.hypot(m.x-state.entHoverPt.x, m.y-state.entHoverPt.y) < 18);
      if (!dup) drawDoor(state.entHoverPt, false);
    }
    if (state.tool === 'entrance' && !ents.length){
      g.font='500 11px var(--mono),monospace';
      g.fillStyle='#7a2e1e'; g.textAlign='center';
      const c = centroid(state.site.pts), [cx,cy] = toPx(v, c);
      g.fillText('Click the boundary to place an entrance', cx, cy);
    }
  }

  pts.forEach(p=>{
    const [x,y]=toPx(v,p);
    g.beginPath(); g.arc(x,y,6.5,0,7); g.fillStyle='#fff'; g.fill();
    g.lineWidth=2.5; g.strokeStyle = state.tool==='del' ? '#c2703a' : '#1d1d1f'; g.stroke();
  });
  if (state.drag){
    const p=pts[state.drag.i], [x,y]=toPx(v,p);
    g.fillStyle='#1d1d1f'; g.font='600 11px ui-monospace,SFMono-Regular,monospace';
    g.fillText(`${Math.round(p.x)}, ${Math.round(p.y)}`, x, y-17);
  }
  if (state.cal && state.cal.b){
    const [ax,ay]=toPx(v,state.cal.a), [bx,by]=toPx(v,state.cal.b);
    g.strokeStyle='#0071e3'; g.lineWidth=2.5;
    g.beginPath(); g.moveTo(ax,ay); g.lineTo(bx,by); g.stroke();
    for (const [qx,qy] of [[ax,ay],[bx,by]]){
      g.beginPath(); g.arc(qx,qy,4.5,0,7); g.fillStyle='#0071e3'; g.fill();
    }
  }
  scaleBar(g,v,w,h);
}
function scaleBar(g,v,w,h){
  const len=50*v.k, x=w-len-26, y=h-30;
  g.strokeStyle='#a1a1a6'; g.lineWidth=1.5;
  g.beginPath(); g.moveTo(x,y); g.lineTo(x+len,y);
  g.moveTo(x,y-4); g.lineTo(x,y+4); g.moveTo(x+len,y-4); g.lineTo(x+len,y+4); g.stroke();
  g.fillStyle='#a1a1a6'; g.font='500 11px -apple-system,Inter,sans-serif';
  g.textAlign='center'; g.textBaseline='top'; g.fillText('50 ft',x+len/2,y+6);
}
function hit(px,py){
  const v=state.vw||computeView(); if(!v) return null;
  normalizeSite();
  const pts=state.site.pts;
  for(let i=0;i<pts.length;i++){
    const [x,y]=toPx(v,pts[i]);
    if(Math.hypot(px-x,py-y)<11) return {kind:'vertex',i};
  }
  if (state.tool==='add'){
    const edges=edgeData(pts);
    for(let i=0;i<edges.length;i++){
      const e=edges[i], [x,y]=toPx(v,{x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2});
      if(Math.hypot(px-x,py-y)<10) return {kind:'mid',i};
    }
  }
  return null;
}
const local = e => { const r=$('site').getBoundingClientRect(); return [e.clientX-r.left,e.clientY-r.top]; };

function siteDown(e){
  const [px,py]=local(e), v=state.vw||computeView();
  if (state.drawing){
    const f=toFt(v,px,py), p={x:snap(f.x),y:snap(f.y)};
    if (state.draft.length>=3){
      const [fx,fy]=toPx(v,state.draft[0]);
      if(Math.hypot(px-fx,py-fy)<13){ endDraw(); return; }
    }
    state.draft.push(p); paintSite(); return;
  }
  if (state.tool==='img'){
    if (!state.img) { flag('Load a site image first'); return; }
    $('site').setPointerCapture(e.pointerId);
    const f=toFt(v,px,py);
    state.drag={kind:'img', dx:state.img.cx-f.x, dy:state.img.cy-f.y};
    return;
  }
  if (state.tool==='cal'){
    if (!state.img) { flag('Load a site image first'); return; }
    $('site').setPointerCapture(e.pointerId);
    state.cal={ a:toFt(v,px,py), b:null };
    return;
  }
  if (state.tool==='entrance'){
    /* An entrance is a decision about the street, so it only needs the plot.
       The click is snapped onto the boundary and kept in site coordinates;
       which bay it belongs to is worked out whenever a scheme is solved. */
    if (!state.site.pts || state.site.pts.length < 3){
      flag('Draw the plot boundary first'); return; }
    const w = toFt(state.vw, px, py);
    const sn = snapToBoundary(w);
    if (!sn || sn.d > 45){
      flag('Click on or near the plot boundary to place an entrance'); return; }
    const near = (state.entrances || [])
      .findIndex(m => Math.hypot(m.x-sn.x, m.y-sn.y) < 18);
    if (near >= 0){
      state.entrances.splice(near, 1);
      flag(state.entrances.length ? state.entrances.length+' entrances'
                                  : 'Back to the automatic entrance');
    } else {
      state.entrances = (state.entrances || []).concat([{ x:sn.x, y:sn.y }]);
      flag(state.entrances.length>1 ? state.entrances.length+' entrances' : 'Entrance set');
    }
    paintSite(); invalidate(); if (state.options.length) refreshAll();
    return;
  }
  if (state.tool==='select'){
    for (let i=0;i<state.dimHits.length;i++){
      const b=state.dimHits[i];
      if (b && px>=b.x && px<=b.x+b.w && py>=b.y && py<=b.y+b.h){ openDim(i); return; }
    }
  }
  const h=hit(px,py); if(!h) return;
  $('site').setPointerCapture(e.pointerId);
  normalizeSite();
  if (h.kind==='mid'){
    const n=state.site.pts.length, a=state.site.pts[h.i], b=state.site.pts[(h.i+1)%n];
    state.site.pts.splice(h.i+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    state.site.setbacks.splice(h.i+1,0,state.site.setbacks[h.i]??0);
    state.drag={kind:'vertex',i:h.i+1};
  } else if (state.tool==='del' || e.altKey || e.button===2){
    if (state.site.pts.length>3){
      state.site.pts.splice(h.i,1); state.site.setbacks.splice(h.i,1);
    }
    state.drag=null;
  } else state.drag={kind:'vertex',i:h.i};
  paintEdgeRows(); paintSite(); plotNote(); invalidate();
}
function siteMove(e){
  const [px,py]=local(e);
  if (state.drawing){ state.cursor=[px,py]; paintSite(); return; }
  if (state.tool==='entrance'){
    // show where on the boundary the click would land
    const sn = (state.site.pts.length>=3 && state.vw)
      ? snapToBoundary(toFt(state.vw, px, py)) : null;
    const ok = (sn && sn.d <= 45) ? sn : null;
    const a = state.entHoverPt, same = ok && a && a.x===ok.x && a.y===ok.y;
    if (!same){ state.entHoverPt = ok; paintSite(); }
    return;
  }
  if (state.tool==='cal' && state.cal && !state.calDone){
    if (state.drag===null && state.cal.a){ state.cal.b=toFt(state.vw||computeView(),px,py); paintSite(); }
    return;
  }
  if (!state.drag){
    const v=state.vw; if(!v) return;
    normalizeSite();
    const edges=edgeData(state.site.pts);
    let near=-1,best=24;
    edges.forEach((ed,i)=>{
      const [x,y]=toPx(v,{x:(ed.a.x+ed.b.x)/2,y:(ed.a.y+ed.b.y)/2});
      const d=Math.hypot(px-x,py-y); if(d<best){best=d;near=i;}
    });
    if(near!==state.hotEdge){ state.hotEdge=near; paintSite(); hotRows(); }
    return;
  }
  if (state.drag.kind==='img'){
    const f=toFt(state.vw,px,py);
    state.img.cx=f.x+state.drag.dx; state.img.cy=f.y+state.drag.dy;
    paintSite(); return;
  }
  const f=toFt(state.vw,px,py);
  state.site.pts[state.drag.i]={x:snap(f.x),y:snap(f.y)};
  paintSite();
}
function siteUp(){
  if (state.cal && state.cal.b){
    const d=Math.hypot(state.cal.b.x-state.cal.a.x, state.cal.b.y-state.cal.a.y);
    if (d>1){
      const inp=$('dimEdit');
      state.dimEdit=-2; state.calDist=d;
      const mid=toPx(state.vw,{x:(state.cal.a.x+state.cal.b.x)/2,y:(state.cal.a.y+state.cal.b.y)/2});
      inp.value=Math.round(d); inp.style.display='block';
      inp.style.left=(mid[0]-36)+'px'; inp.style.top=(mid[1]-34)+'px';
      inp.focus(); inp.select();
      flag('Type the real length of that line, in feet');
    } else state.cal=null;
    paintSite(); return;
  }
  if(!state.drag) return;
  if (state.drag.kind==='img'){ state.drag=null; paintSite(); return; }
  state.drag=null; normalizeSite();
  paintEdgeRows(); resize2(); paintSite(); invalidate();
}
function openDim(i){
  normalizeSite();
  const e = edgeData(state.site.pts)[i], b = state.dimHits[i];
  const inp = $('dimEdit');
  state.dimEdit = i;
  inp.value = Math.round(e.len);
  inp.style.display = 'block';
  inp.style.left = (b.cx - 36) + 'px';
  inp.style.top  = (b.cy - 14) + 'px';
  inp.focus(); inp.select();
}
function closeDim(apply){
  const i = state.dimEdit;
  $('dimEdit').style.display='none';
  state.dimEdit = -1;
  if (i===-2){
    if (apply && state.img && state.calDist>1){
      const want=Math.max(1,+$('dimEdit').value||0);
      state.img.wft *= want/state.calDist;
      state.img.baseW = state.img.wft;
      $('sImgSc').value=100; imgScaleLabel();
      flag('Image scaled \u2014 one drawn foot now matches the site');
    }
    state.cal=null; state.calDist=0; paintSite(); return;
  }
  if (i<0 || !apply) return;
  const want = Math.max(5, Math.min(2000, +$('dimEdit').value||0));
  normalizeSite();
  const pts = state.site.pts, n = pts.length;
  const a0 = pts[i], b0 = pts[(i+1)%n];
  const L = Math.hypot(b0.x-a0.x, b0.y-a0.y) || 1;
  const ux = (b0.x-a0.x)/L, uy = (b0.y-a0.y)/L;
  const d = want - L;
  // slide this edge's far corner, and carry the next corner with it, so the
  // following edge keeps its direction and a rectangle stays a rectangle
  const bi = (i+1)%n, ci = (i+2)%n;
  pts[bi] = { x:Math.round(b0.x+ux*d), y:Math.round(b0.y+uy*d) };
  pts[ci] = { x:Math.round(pts[ci].x+ux*d), y:Math.round(pts[ci].y+uy*d) };
  normalizeSite(); paintEdgeRows(); resize2(); paintSite(); invalidate();
}
function startDraw(){
  state.drawing=true; state.draft=[]; setTool('draw');
  $('siteHint').textContent='Click to place corners \u00b7 click the first corner again to close';
  showView('site'); paintSite();
}
function endDraw(){
  if (state.draft.length>=3){
    state.site.pts=state.draft.slice();
    state.site.setbacks=state.site.pts.map(()=>15);
    normalizeSite();
  }
  state.drawing=false; state.draft=[]; setTool('select');
  $('siteHint').textContent='Drag a corner to reshape';
  paintEdgeRows(); plotNote(); paintSite(); invalidate();
}
function setTool(t){
  if (t!=='draw' && state.drawing){ state.drawing=false; state.draft=[]; }
  state.tool=t;
  for (const [id,name] of [['tSelect','select'],['tDraw','draw'],['tAdd','add'],['tDel','del'],['tEnt','entrance'],['tImg','img'],['tCal','cal']])
    $(id).classList.toggle('on', name===t);
  if (t!=='cal') state.cal=null;
  if (t!=='entrance') state.entHoverPt=null;
  $('site').style.cursor = (t==='draw'||t==='entrance'||t==='cal') ? 'crosshair' : t==='img' ? 'move' : t==='del' ? 'not-allowed' : 'default';
  if (t!=='select') closeDim(false);
  paintSite();
}
