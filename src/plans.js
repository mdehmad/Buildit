/* Architectural floor plans drawn to canvas
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ================= architectural plans ================= */
const GRIDLET = i => String.fromCharCode(65+i);
function tint(hex, a){
  const n = parseInt(hex.slice(1),16);
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  return `rgb(${Math.round(255-(255-r)*a)},${Math.round(255-(255-g)*a)},${Math.round(255-(255-b)*a)})`;
}
function drawPlan(cv, lvl, size, detail){
  const g = cv.getContext('2d'), { vg, pg, cfg } = state, opt = state.options[state.pick];
  const dpr = Math.min(devicePixelRatio, 2);
  cv.width = size*dpr; cv.height = size*dpr;
  g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle = '#fff'; g.fillRect(0,0,size,size);
  if (!vg || !opt) return;

  const margin = detail ? 40 : 14;
  const span = Math.max(vg.totalW, vg.totalD);
  const k = (size - margin*2) / span;
  const ox = margin + ((size-margin*2) - vg.totalW*k)/2 - vg.minX*k;
  const oy = margin + ((size-margin*2) - vg.totalD*k)/2 - vg.minY*k;
  const P = (x,y)=>[ox+x*k, oy+y*k];
  const assign = effAssign();
  const cells = vg.byStory[lvl] || [];
  const at = (ix,iy)=>{ const j = vg.index.get(`${lvl},${ix},${iy}`); return j===undefined?null:assign[j]; };
  const room = id => id===null||id===-1 ? null : pg.rooms[id];

  /* --- plot line and mandatory open space --- */
  normalizeSite();
  g.save();
  g.setLineDash([6,4]); g.lineWidth = 1; g.strokeStyle = '#c7c7cc';
  g.beginPath();
  state.site.pts.forEach((p,i)=>{ const [x,y]=P(p.x,p.y); i?g.lineTo(x,y):g.moveTo(x,y); });
  g.closePath(); g.stroke(); g.restore();

  /* --- structural grid --- */
  if (detail){
    g.save();
    g.strokeStyle = '#e8e8ed'; g.lineWidth = 1; g.setLineDash([9,3,2,3]);
    const y0 = oy + vg.minY*k - 22, y1 = oy + vg.maxY*k + 22;
    const x0 = ox + vg.minX*k - 22, x1 = ox + vg.maxX*k + 22;
    vg.cx.forEach(x=>{ const [px]=P(x,0); g.beginPath(); g.moveTo(px,y0); g.lineTo(px,y1); g.stroke(); });
    vg.cy.forEach(y=>{ const [,py]=P(0,y); g.beginPath(); g.moveTo(x0,py); g.lineTo(x1,py); g.stroke(); });
    g.setLineDash([]);
    g.font = '500 8.5px -apple-system,Inter,sans-serif';
    g.textAlign='center'; g.textBaseline='middle';
    vg.cx.forEach((x,i)=>{ const [px]=P(x,0);
      g.beginPath(); g.arc(px,y0,7,0,7); g.fillStyle='#fff'; g.fill();
      g.strokeStyle='#c7c7cc'; g.lineWidth=1; g.stroke();
      g.fillStyle='#86868b'; g.fillText(GRIDLET(i),px,y0); });
    vg.cy.forEach((y,i)=>{ const [,py]=P(0,y);
      g.beginPath(); g.arc(x0,py,7,0,7); g.fillStyle='#fff'; g.fill();
      g.strokeStyle='#c7c7cc'; g.lineWidth=1; g.stroke();
      g.fillStyle='#86868b'; g.fillText(String(i+1),x0,py); });
    g.restore();
  }

  /* The planner lays units by frontage, so the plan is a set of rectangles
     rather than a colouring of bays. Draw those and we are done. */
  const uplan = state.plan && state.plan[lvl];
  if (uplan && uplan.rooms.length){
    drawUnitPlan(g, uplan, P, k, detail);
    if (detail) planFooter(g, lvl, size);
    return;
  }

  /* --- room washes --- */
  for (const id of cells){
    const v = vg.voxels[id], rid = assign[id];
    if (rid===-1) continue;
    const [x,y] = P(v.x, v.y), w = v.w*k, d = v.d*k;
    g.fillStyle = tint(USE_COL[pg.rooms[rid].type], detail ? 0.30 : 0.62);
    g.fillRect(x,y,w+.4,d+.4);
  }

  /* --- collect wall segments --- */
  const ext = [], part = [];
  for (const id of cells){
    const v = vg.voxels[id], a = assign[id];
    if (a===-1) continue;
    const seg = [
      [[v.x,v.y],[v.x+v.w,v.y], at(v.ix,v.iy-1)],
      [[v.x+v.w,v.y],[v.x+v.w,v.y+v.d], at(v.ix+1,v.iy)],
      [[v.x,v.y+v.d],[v.x+v.w,v.y+v.d], at(v.ix,v.iy+1)],
      [[v.x,v.y],[v.x,v.y+v.d], at(v.ix-1,v.iy)],
    ];
    for (const [p1,p2,nb] of seg){
      if (nb===a) continue;
      if (nb===null || nb===-1) ext.push([p1,p2,a]);
      else part.push([p1,p2,a,nb]);
    }
  }

  /* --- external envelope with glazing --- */
  const wExt = detail ? 3.4 : 2;
  g.lineCap = 'butt';
  for (const [p1,p2,a] of ext){
    const [x1,y1]=P(p1[0],p1[1]), [x2,y2]=P(p2[0],p2[1]);
    g.strokeStyle='#1d1d1f'; g.lineWidth=wExt;
    g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
    if (!detail) continue;
    const r = room(a);
    if (!r || !LEASABLE.has(r.type)) continue;
    // glazing: leave a pier at each end, draw the glass line through the middle
    const L = Math.hypot(x2-x1, y2-y1);
    const pier = Math.min(L*0.22, 4.5*k);
    if (L - pier*2 < 6) continue;
    const ux=(x2-x1)/L, uy=(y2-y1)/L;
    const gx1=x1+ux*pier, gy1=y1+uy*pier, gx2=x2-ux*pier, gy2=y2-uy*pier;
    g.strokeStyle='#fff'; g.lineWidth=wExt;
    g.beginPath(); g.moveTo(gx1,gy1); g.lineTo(gx2,gy2); g.stroke();
    g.strokeStyle='#5a8fb8'; g.lineWidth=1.2;
    g.beginPath(); g.moveTo(gx1,gy1); g.lineTo(gx2,gy2); g.stroke();
    g.strokeStyle='#1d1d1f'; g.lineWidth=1;
    for (const [px,py] of [[gx1,gy1],[gx2,gy2]]){
      g.beginPath(); g.moveTo(px-uy*wExt/2, py+ux*wExt/2);
      g.lineTo(px+uy*wExt/2, py-ux*wExt/2); g.stroke();
    }
  }

  /* --- partitions, with a door where a room meets circulation --- */
  const doorDone = new Set();
  const wPart = detail ? 2 : 1.3;
  for (const [p1,p2,a,b] of part){
    const [x1,y1]=P(p1[0],p1[1]), [x2,y2]=P(p2[0],p2[1]);
    const ra = room(a), rb = room(b);
    const pairKey = a<b ? a+'|'+b : b+'|'+a;
    const wantDoor = detail && ra && rb &&
      (ra.type==='corridor') !== (rb.type==='corridor') && !doorDone.has(pairKey);
    if (!wantDoor){
      g.strokeStyle='#1d1d1f'; g.lineWidth=wPart;
      g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
      continue;
    }
    const L = Math.hypot(x2-x1,y2-y1), dw = Math.min(L*0.55, 3.2*k);
    if (L < dw + 6){
      g.strokeStyle='#1d1d1f'; g.lineWidth=wPart;
      g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
      continue;
    }
    doorDone.add(pairKey);
    const ux=(x2-x1)/L, uy=(y2-y1)/L;
    const mx=(x1+x2)/2, my=(y1+y2)/2;
    const j1x=mx-ux*dw/2, j1y=my-uy*dw/2, j2x=mx+ux*dw/2, j2y=my+uy*dw/2;
    g.strokeStyle='#1d1d1f'; g.lineWidth=wPart;
    g.beginPath(); g.moveTo(x1,y1); g.lineTo(j1x,j1y);
    g.moveTo(j2x,j2y); g.lineTo(x2,y2); g.stroke();
    // swing into whichever side is not the corridor
    const into = (ra.type==='corridor') ? 1 : -1;
    const nx=-uy*into, ny=ux*into;
    g.strokeStyle='#8e8e93'; g.lineWidth=1;
    g.beginPath(); g.moveTo(j1x,j1y); g.lineTo(j1x+nx*dw, j1y+ny*dw); g.stroke();
    g.beginPath();
    g.arc(j1x, j1y, dw, Math.atan2(ny,nx), Math.atan2(uy,ux), into>0);
    g.stroke();
  }

  /* --- core symbols and room tags --- */
  const grp = {};
  for (const id of cells){
    const rid = assign[id]; if (rid===-1) continue;
    const v = vg.voxels[id];
    (grp[rid] ||= { x0:1e9,y0:1e9,x1:-1e9,y1:-1e9, cx:0, cy:0, n:0, a:0 });
    const o = grp[rid];
    o.x0=Math.min(o.x0,v.x); o.y0=Math.min(o.y0,v.y);
    o.x1=Math.max(o.x1,v.x+v.w); o.y1=Math.max(o.y1,v.y+v.d);
    o.cx+=v.x+v.w/2; o.cy+=v.y+v.d/2; o.n++; o.a+=v.area;
  }
  for (const [rid,o] of Object.entries(grp)){
    const r = pg.rooms[rid];
    const [bx,by] = P(o.x0,o.y0), [bx2,by2] = P(o.x1,o.y1);
    const bw = bx2-bx, bh = by2-by;
    if (detail && r.type==='stairs' && bw>14 && bh>14){
      const vert = bh>bw, n = 8;
      g.strokeStyle='#1d1d1f'; g.lineWidth=.9;
      for (let i=1;i<n;i++){
        const t=i/n;
        g.beginPath();
        if (vert){ g.moveTo(bx+3,by+bh*t); g.lineTo(bx+bw-3,by+bh*t); }
        else { g.moveTo(bx+bw*t,by+3); g.lineTo(bx+bw*t,by+bh-3); }
        g.stroke();
      }
      g.beginPath();
      if (vert){ g.moveTo(bx+bw/2,by+bh-5); g.lineTo(bx+bw/2,by+5);
        g.moveTo(bx+bw/2-3,by+10); g.lineTo(bx+bw/2,by+5); g.lineTo(bx+bw/2+3,by+10); }
      else { g.moveTo(bx+5,by+bh/2); g.lineTo(bx+bw-5,by+bh/2);
        g.moveTo(bx+bw-10,by+bh/2-3); g.lineTo(bx+bw-5,by+bh/2); g.lineTo(bx+bw-10,by+bh/2+3); }
      g.strokeStyle='#1d1d1f'; g.lineWidth=1.1; g.stroke();
    }
    if (detail && r.type==='elevator' && bw>12 && bh>12){
      g.strokeStyle='#1d1d1f'; g.lineWidth=.9;
      g.beginPath(); g.moveTo(bx+3,by+3); g.lineTo(bx2-3,by2-3);
      g.moveTo(bx2-3,by+3); g.lineTo(bx+3,by2-3); g.stroke();
    }
    const label = detail ? r.name : SHORT[r.type];
    const minA = detail ? 180 : 320;
    if (o.a < minA) continue;
    const tx = ox+(o.cx/o.n)*k, ty = oy+(o.cy/o.n)*k;
    g.textAlign='center'; g.textBaseline='middle';
    if (detail){
      g.font='600 9px -apple-system,Inter,sans-serif';
      g.fillStyle='#1d1d1f'; g.fillText(label, tx, ty-5);
      g.font='400 8px -apple-system,Inter,sans-serif';
      g.fillStyle='#6e6e73'; g.fillText(fmt(o.a)+' sq ft', tx, ty+5);
    } else {
      g.font='600 10px -apple-system,Inter,sans-serif';
      g.fillStyle = r.type==='stairs' ? '#1d1d1f' : '#3a3a3c';
      g.fillText(label, tx, ty);
    }
  }

  /* --- entrance: revolving door, side leaves, steps --- */
  for (const ei of ((lvl===0 && detail) ? entranceList() : [])){
    if (ei.face < 0) continue;
    {
    const v = vg.voxels[ei.id];
    const [dx,dy] = DIRS[ei.face];
    // the open face of the bay, in plan
    let p1,p2;
    if (dx===1)      { p1=[v.x+v.w, v.y]; p2=[v.x+v.w, v.y+v.d]; }
    else if (dx===-1){ p1=[v.x, v.y];     p2=[v.x, v.y+v.d]; }
    else if (dy===1) { p1=[v.x, v.y+v.d]; p2=[v.x+v.w, v.y+v.d]; }
    else             { p1=[v.x, v.y];     p2=[v.x+v.w, v.y]; }
    const [x1,y1]=P(p1[0],p1[1]), [x2,y2]=P(p2[0],p2[1]);
    const L=Math.hypot(x2-x1,y2-y1), ux=(x2-x1)/L, uy=(y2-y1)/L;
    const ox2=dx*k, oy2=dy*k;                       // one foot outward, in px
    const mx=(x1+x2)/2, my=(y1+y2)/2;
    const openW=Math.min(L*0.8, 16*k);
    const j1=[mx-ux*openW/2, my-uy*openW/2], j2=[mx+ux*openW/2, my+uy*openW/2];
    // steps down to grade
    g.strokeStyle='#b9b9c0'; g.lineWidth=1;
    for (let i=1;i<=3;i++){
      const off=i*1.6;
      g.beginPath();
      g.moveTo(j1[0]+ox2*off - ux*off*0.6, j1[1]+oy2*off - uy*off*0.6);
      g.lineTo(j2[0]+ox2*off + ux*off*0.6, j2[1]+oy2*off + uy*off*0.6);
      g.stroke();
    }
    // reopen the wall
    g.strokeStyle='#fff'; g.lineWidth=wExt+1.5;
    g.beginPath(); g.moveTo(j1[0],j1[1]); g.lineTo(j2[0],j2[1]); g.stroke();
    g.strokeStyle='#1d1d1f'; g.lineWidth=1.2;
    g.beginPath(); g.moveTo(x1,y1); g.lineTo(j1[0],j1[1]);
    g.moveTo(j2[0],j2[1]); g.lineTo(x2,y2); g.stroke();
    // revolving drum with four blades
    const r=Math.min(openW*0.3, 4*k);
    g.beginPath(); g.arc(mx,my,r,0,7);
    g.fillStyle='#fff'; g.fill(); g.strokeStyle='#1d1d1f'; g.lineWidth=1.3; g.stroke();
    g.beginPath();
    for (let i=0;i<4;i++){
      const th=Math.atan2(uy,ux)+i*Math.PI/2+Math.PI/4;
      g.moveTo(mx,my); g.lineTo(mx+Math.cos(th)*r, my+Math.sin(th)*r);
    }
    g.lineWidth=1; g.strokeStyle='#3a3a3c'; g.stroke();
    // a hinged leaf either side
    for (const s of [-1,1]){
      const hx=mx+ux*(r+openW*0.18)*s, hy=my+uy*(r+openW*0.18)*s;
      const lw=openW*0.17;
      g.strokeStyle='#8e8e93'; g.lineWidth=1.4;
      g.beginPath(); g.moveTo(hx,hy); g.lineTo(hx-ox2*lw/k*0.9, hy-oy2*lw/k*0.9); g.stroke();
    }
    g.fillStyle='#7a2e1e'; g.font='600 8.5px -apple-system,Inter,sans-serif';
    g.textAlign='center'; g.textBaseline='middle';
    g.fillText('ENTRANCE', mx+ox2*7, my+oy2*7);
    }
  }

  /* --- title block, north point, scale --- */
  if (detail){
    g.textAlign='left'; g.textBaseline='alphabetic';
    g.font='600 11px -apple-system,Inter,sans-serif'; g.fillStyle='#1d1d1f';
    g.fillText(`Level ${lvl+1}`, 14, size-20);
    g.font='400 9px -apple-system,Inter,sans-serif'; g.fillStyle='#86868b';
    const useName = USE_LABEL[pg.floorUse[lvl]] || pg.floorUse[lvl];
    g.fillText(`${useName} \u00b7 ${cfg.bay} ft grid`, 14, size-9);
    const nx = size-24, ny = 26;
    g.save(); g.translate(nx,ny); g.rotate(-(vg.angle||0));
    g.strokeStyle='#1d1d1f'; g.lineWidth=1;
    g.beginPath(); g.moveTo(0,11); g.lineTo(0,-11);
    g.moveTo(-4,-4); g.lineTo(0,-11); g.lineTo(4,-4); g.stroke();
    g.font='600 8px -apple-system,Inter,sans-serif'; g.fillStyle='#1d1d1f';
    g.textAlign='center'; g.textBaseline='middle'; g.fillText('N', 0, 19);
    g.restore();
    const sl = 50*k, sx = size-14-sl, sy = size-14;
    g.strokeStyle='#86868b'; g.lineWidth=1;
    g.beginPath(); g.moveTo(sx,sy); g.lineTo(sx+sl,sy);
    g.moveTo(sx,sy-3); g.lineTo(sx,sy+3);
    g.moveTo(sx+sl,sy-3); g.lineTo(sx+sl,sy+3); g.stroke();
    g.font='400 8px -apple-system,Inter,sans-serif'; g.fillStyle='#86868b';
    g.textAlign='center'; g.fillText('50 ft', sx+sl/2, sy-6);
  }
}
function paintPlans(){
  const {vg,cfg}=state; const opt=state.options[state.pick];
  if(!vg||!opt){ $('plansGrid').innerHTML=''; return; }
  const html=[];
  // basements read downward: B1 is the first level below grade
  const park = state.parking;
  if (park) park.levels.forEach((lv,i)=>{
    html.push(`<figure><canvas data-park="${i}"></canvas>
      <figcaption><b>Basement ${i+1}</b><span>${lv.count} cars</span></figcaption></figure>`);
  });
  for(let s=0;s<cfg.stories;s++){
    if(!vg.byStory[s].length) continue;
    const EA=effAssign();
    const gfa=vg.byStory[s].reduce((a,i)=>a+(EA[i]!==-1?vg.voxels[i].area:0),0);
    html.push(`<figure><canvas data-lvl="${s}"></canvas>
      <figcaption><b>Level ${s+1}</b><span>${fmt(gfa)} sq ft</span></figcaption></figure>`);
  }
  $('plansGrid').innerHTML=html.join('');
  $('plansGrid').querySelectorAll('figure').forEach(f=>{
    const c=f.querySelector('canvas');
    if (c.dataset.lvl !== undefined) f.onclick=()=>openPlan(+c.dataset.lvl);
  });
  $('plansGrid').querySelectorAll('canvas').forEach(cv=>{
    const w=cv.parentElement.clientWidth-20;
    cv.style.width=w+'px'; cv.style.height=w+'px';
    if (cv.dataset.park !== undefined) drawParkingPlan(cv,+cv.dataset.park,w);
    else drawPlan(cv,+cv.dataset.lvl,w,w>=230);
  });
}
