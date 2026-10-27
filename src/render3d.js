/* The three.js massing and rendered views
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ================= three.js ================= */
let renderer, scene, camera, groups={}, ghost, plotLine, gMass, gRender, gRoot,
    colMass, slabMass, beamMass;
let orbit={theta:0.72,phi:1.02,r:400,tx:0,ty:0,tz:0};
/* The 3D view is a bonus, not a prerequisite. THREE comes off a CDN and
   WebGL can be switched off or blocked by the browser, so initGL is allowed
   to fail: gl3d stays false, every 3D entry point turns into a no-op, and the
   drawing board, plans and schedule carry on working. Before this, one throw
   in here killed the rest of the boot and left a blank white canvas. */
let gl3d=false;
function glExcuse(){
  if (typeof THREE==='undefined')
    return 'The 3D library could not be loaded — check the connection and reload.';
  return 'This browser has WebGL turned off, so the 3D views are unavailable.';
}
function noGLNote(){
  const host=$('gl') && $('gl').parentElement; if(!host) return;
  if(host.querySelector('.noglmsg')) return;
  const d=document.createElement('div');
  d.className='noglmsg';
  d.innerHTML='<strong>3D view unavailable</strong><span>'+glExcuse()+
    '</span><span>Plot, Plans and Schedule all still work.</span>';
  host.appendChild(d);
}
function initGL(){
  try {
    initGLUnsafe();
    /* set before the first resize/tick: both are gl3d-guarded, so the flag has
       to be up or the canvas never gets a size and the render loop never runs */
    gl3d=true;
    resize(); tick();
  } catch(err){
    gl3d=false; console.warn('3D disabled:',err);
    noGLNote();
  }
}
function initGLUnsafe(){
  const cv=$('gl');
  renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  scene=new THREE.Scene(); scene.background=new THREE.Color(0xf5f5f7);
  camera=new THREE.PerspectiveCamera(38,1,1,30000);
  scene.add(new THREE.HemisphereLight(0xffffff,0xd9d9de,0.88));
  const key=new THREE.DirectionalLight(0xffffff,0.56); key.position.set(220,420,170); scene.add(key);
  const fill=new THREE.DirectionalLight(0xffffff,0.20); fill.position.set(-260,160,-200); scene.add(fill);
  const gr=new THREE.Mesh(new THREE.PlaneGeometry(12000,12000),
    new THREE.MeshBasicMaterial({color:0xeeeef0}));
  gr.rotation.x=-Math.PI/2; gr.position.y=-0.2; scene.add(gr);
  gRoot=new THREE.Group(); scene.add(gRoot);
  gMass=new THREE.Group(); gRender=new THREE.Group();
  gRoot.add(gMass); gRoot.add(gRender);
  gRender.visible=false;
  const box=new THREE.BoxGeometry(1,1,1);
  for (const t in USE_COL){
    const m=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:USE_HEX[t]}),9000);
    m.count=0; m.frustumCulled=false; groups[t]=m; gMass.add(m);
  }
  colMass=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:0xc4c4ca}),30000);
  colMass.count=0; colMass.frustumCulled=false; gMass.add(colMass);
  slabMass=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:0xe6e6ea}),30000);
  slabMass.count=0; slabMass.frustumCulled=false; gMass.add(slabMass);
  beamMass=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:0xd0d0d6}),40000);
  beamMass.count=0; beamMass.frustumCulled=false; gMass.add(beamMass);
  ghost=new THREE.InstancedMesh(box,new THREE.MeshBasicMaterial(
    {color:0xb9b9c0,wireframe:true,transparent:true,opacity:0.5}),9000);
  ghost.count=0; ghost.frustumCulled=false; gMass.add(ghost);
  plotLine=new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({color:0xb0b0b6})); gRoot.add(plotLine);
  BOX=box;
  bindOrbit(cv);
  new ResizeObserver(()=>{resize(); if(state.view==='site')paintSite();}).observe($('gl').parentElement.parentElement);
}
function resize(){
  if(!gl3d) return;
  const el=$('gl').parentElement, w=el.clientWidth, h=el.clientHeight;
  if(!w||!h) return;
  renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
}
function bindOrbit(cv){
  let down=false,lx=0,ly=0;
  cv.addEventListener('pointerdown',e=>{down=true;lx=e.clientX;ly=e.clientY;cv.setPointerCapture(e.pointerId);});
  cv.addEventListener('pointermove',e=>{ if(!down)return;
    orbit.theta-=(e.clientX-lx)*0.007;
    orbit.phi=Math.max(0.12,Math.min(1.52,orbit.phi-(e.clientY-ly)*0.006));
    lx=e.clientX; ly=e.clientY; });
  const end=e=>{down=false;try{cv.releasePointerCapture(e.pointerId);}catch(_){}}; 
  cv.addEventListener('pointerup',end); cv.addEventListener('pointercancel',end);
  cv.addEventListener('wheel',e=>{e.preventDefault();
    orbit.r=Math.max(60,Math.min(9000,orbit.r*(1+Math.sign(e.deltaY)*0.09)));},{passive:false});
}
function tick(){
  if(!gl3d) return;
  requestAnimationFrame(tick);
  if(state.reveal<1){ state.reveal=Math.min(1,state.reveal+0.022); paint3D(); }
  const {theta,phi,r}=orbit;
  camera.position.set(orbit.tx+r*Math.sin(phi)*Math.cos(theta),
    orbit.ty+r*Math.cos(phi), orbit.tz+r*Math.sin(phi)*Math.sin(theta));
  camera.lookAt(orbit.tx,orbit.ty,orbit.tz);
  renderer.render(scene,camera);
}
let BOX=null;
let TW_AXIS;  /* built lazily in scratch3D, for the same reason */
const twistAt = st => (state.massing==='twist')
  ? (state.cfg ? state.cfg.twistDeg||0 : 0) * st * Math.PI/180 : 0;
// place one box, turned about the building's axis when the massing twists
function setM(x,y,z,sx,sy,sz,ang){
  if (ang){
    const c=Math.cos(ang), si=Math.sin(ang);
    _p.set(x*c - z*si, y, x*si + z*c);
    _q.setFromAxisAngle(TW_AXIS, -ang);
  } else { _p.set(x,y,z); _q.set(0,0,0,1); }
  _s.set(sx,sy,sz); _m.compose(_p,_q,_s);
}
/* Built on first use, not at parse time: these used to be top-level `new
   THREE.*` calls, so a CDN miss threw while the script was still running and
   took every function defined below it down with it. */
let _m,_q,_p,_s;
function scratch3D(){
  if(_m) return;
  _m=new THREE.Matrix4(); _q=new THREE.Quaternion();
  _p=new THREE.Vector3(); _s=new THREE.Vector3();
  TW_AXIS=new THREE.Vector3(0,1,0);
}
function paint3D(){
  if(!gl3d) return;
  scratch3D();
  const {vg,pg,cfg}=state; if(!vg) return;
  const FH=cfg.floorH, opt=state.options[state.pick];
  const assign=opt?effAssign():null, seq=opt?opt.state.seq:null;
  const cut=seq?Math.floor(seq.length*state.reveal):0;
  const shown=new Set(seq?seq.slice(0,cut):[]);
  const cx=(vg.minX+vg.maxX)/2, cz=(vg.minY+vg.maxY)/2;
  const counts={}; for(const t in USE_COL) counts[t]=0;
  const entIds = new Set(entranceList().map(e=>e.id));
  const SLAB=1.0, BEAM=1.7, colS=Math.max(1.4,Math.min(2.4,cfg.bay*0.085));
  let gc=0;

  /* Enclosure. Built from the unit plans so the colours in the massing are the
     same rooms the floor plans show; extruding bays would paint a layout that
     no longer exists. The structural frame and slabs below still come off the
     bay grid, which is what actually carries the building. */
  const uplans = state.plan;
  const revealTo = state.reveal>=1 ? cfg.stories : Math.ceil(cfg.stories*state.reveal);
  if (uplans && uplans.some(Boolean)){
    for (let st=0; st<cfg.stories; st++){
      if (state.floor>=0 && st!==state.floor) continue;
      if (state.floor<0 && st>=revealTo) continue;
      const pl = uplans[st]; if(!pl) continue;
      const ents = (st===0) ? entranceList() : [];
      for (const r of pl.rooms.concat(pl.corridor)){
        let t = r.use;
        if (ents.length && st===0){
          const e = ents.find(e=>{ const v=vg.voxels[e.id];
            return v && v.x < r.x+r.w-0.5 && r.x < v.x+v.w-0.5
                     && v.y < r.y+r.d-0.5 && r.y < v.y+v.d-0.5; });
          if (e) t = 'entrance';
        }
        if (!groups[t]) t = 'mech';
        setM(r.x+r.w/2-cx, st*FH+SLAB+(FH-SLAB)/2, r.y+r.d/2-cz,
             r.w, FH-SLAB, r.d, twistAt(st));
        groups[t].setMatrixAt(counts[t]++,_m);
      }
    }
  } else {
    for (const v of vg.voxels){
      if (state.floor>=0 && v.s!==state.floor) continue;
      const rid=assign?assign[v.id]:-1;
      if (rid===-1) continue;
      if (!(state.reveal>=1||shown.has(v.id))) continue;
      const t = entIds.has(v.id) ? 'entrance' : pg.rooms[rid].type;
      setM(v.x+v.w/2-cx, v.s*FH+SLAB+(FH-SLAB)/2, v.y+v.d/2-cz,
           v.w, FH-SLAB, v.d, twistAt(v.s));
      groups[t].setMatrixAt(counts[t]++,_m);
    }
  }
  for(const t in USE_COL){ groups[t].count=counts[t]; groups[t].instanceMatrix.needsUpdate=true; }
  ghost.count=gc; ghost.instanceMatrix.needsUpdate=true;

  // frame and floor plates across the whole plate, so an open bay reads as a deck
  let ci=0, si=0, bi=0;
  for (let st=0; st<cfg.stories; st++){
    if (state.floor>=0 && st!==state.floor) continue;
    const bays = vg.byStory[st]||[];
    if (!bays.length) continue;
    for (const id of bays){
      if (assign && assign[id]===-1) continue;   // not part of the building
      const v = vg.voxels[id];
      // a bay sitting in the light well gets no floor, or the void reads solid
      const ct = state.plan && state.plan[st] && state.plan[st].court;
      if (ct && v.x >= ct.x-0.5 && v.x+v.w <= ct.x+ct.w+0.5
             && v.y >= ct.y-0.5 && v.y+v.d <= ct.y+ct.d+0.5) continue;
      // the floor of this level
      setM(v.x+v.w/2-cx, st*FH+SLAB/2, v.y+v.d/2-cz, v.w+0.7, SLAB, v.d+0.7, twistAt(st));
      slabMass.setMatrixAt(si++,_m);
      // and its roof, wherever the building stops here
      if (v.above === -1){
        setM(v.x+v.w/2-cx, (st+1)*FH+SLAB/2, v.y+v.d/2-cz, v.w+0.7, SLAB, v.d+0.7, twistAt(st));
        slabMass.setMatrixAt(si++,_m);
      }
    }
    for (const nd of frameNodes(vg, st, colS)){
      setM(nd[0]-cx, st*FH+FH/2, nd[1]-cz, colS, FH, colS, twistAt(st));
      colMass.setMatrixAt(ci++,_m);
    }
    for (const bm of frameBeams(vg, st)){
      setM(bm[0]-cx, (st+1)*FH-SLAB-BEAM/2, bm[1]-cz,
           bm[3]==='x'?bm[2]:colS*0.75, BEAM, bm[3]==='x'?colS*0.75:bm[2], twistAt(st));
      beamMass.setMatrixAt(bi++,_m);
    }
  }
  colMass.count=ci;  colMass.instanceMatrix.needsUpdate=true;
  slabMass.count=si; slabMass.instanceMatrix.needsUpdate=true;
  beamMass.count=bi; beamMass.instanceMatrix.needsUpdate=true;
  gRoot.rotation.y = -(vg.angle||0);
  const pts=vg.pts, P=[];
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    P.push(new THREE.Vector3(a.x-cx,0.1,a.y-cz), new THREE.Vector3(b.x-cx,0.1,b.y-cz));
  }
  plotLine.geometry.dispose();
  plotLine.geometry=new THREE.BufferGeometry().setFromPoints(P);
}
/* ---------- structural frame ---------- */
// A column on the edge of the plate is pulled inboard by half its width, so
// the wall face sits flush outside it and no column shows on the elevation.
function frameNodes(vg, s, colS){
  const bays = vg.byStory[s] || [];
  const have = new Set();
  for (const id of bays){ const v = vg.voxels[id]; have.add(v.ix+','+v.iy); }
  const nodes = new Map();
  for (const id of bays){
    const v = vg.voxels[id];
    for (const g of [[v.ix,v.iy],[v.ix+1,v.iy],[v.ix,v.iy+1],[v.ix+1,v.iy+1]])
      nodes.set(g[0]+','+g[1], g);
  }
  const out = [];
  for (const [gx,gy] of nodes.values()){
    const left  = have.has((gx-1)+','+(gy-1)) || have.has((gx-1)+','+gy);
    const right = have.has(gx+','+(gy-1))     || have.has(gx+','+gy);
    const up    = have.has((gx-1)+','+(gy-1)) || have.has(gx+','+(gy-1));
    const down  = have.has((gx-1)+','+gy)     || have.has(gx+','+gy);
    let ox = 0, oy = 0;
    if (!left && right) ox =  colS/2;
    if (!right && left) ox = -colS/2;
    if (!up && down)    oy =  colS/2;
    if (!down && up)    oy = -colS/2;
    out.push([ vg.nodeX[gx]+ox, vg.nodeY[gy]+oy ]);
  }
  return out;
}
// one beam per bay edge, claimed once
function frameBeams(vg, s){
  const out = [];
  for (const id of (vg.byStory[s] || [])){
    const v = vg.voxels[id];
    const sides = [
      [ v.ix, v.iy-1, v.x+v.w/2, v.y,       v.w, 'x' ],
      [ v.ix, v.iy+1, v.x+v.w/2, v.y+v.d,   v.w, 'x' ],
      [ v.ix-1, v.iy, v.x,       v.y+v.d/2, v.d, 'z' ],
      [ v.ix+1, v.iy, v.x+v.w,   v.y+v.d/2, v.d, 'z' ],
    ];
    for (const sd of sides){
      const j = vg.index.get(s+','+sd[0]+','+sd[1]);
      if (j !== undefined && j < id) continue;
      out.push([sd[2], sd[3], sd[4], sd[5]]);
    }
  }
  return out;
}

/* ---------- facade styles ---------- */
// Each style is a recipe applied to every exterior bay face: how much solid
// pier, sill and head, how many openings, and what projects from the wall.
const STYLES = {
  curtain: { label:'Curtain wall', clad:false, pier:0.04, sill:0,   head:0,   win:1, inner:0,
             mull:2, spandrel:2.4, reveal:0.15, fin:0,    cornice:0,   string:0,   balcony:0, op:0.48 },
  punched: { label:'Punched stone', clad:true, pier:0.11, sill:2.6, head:1.5, win:2, inner:0.08,
             mull:1, spandrel:0,   reveal:0.9,  fin:0,    cornice:1.6, string:0.5, balcony:0, op:0.58 },
  loft:    { label:'Brick loft',    clad:true, pier:0.10, sill:2.8, head:1.2, win:1, inner:0,
             mull:2, spandrel:0,   reveal:1.1,  fin:0.35, cornice:2.4, string:0,   balcony:0, op:0.56,
             lintel:true },
  classical:{ label:'Neoclassical', clad:true, pier:0.20, sill:2.2, head:1.4, win:1, inner:0,
             mull:1, spandrel:0,   reveal:1.2,  fin:0.85, cornice:2.8, string:0.7, balcony:0, op:0.62,
             tripartite:true, balustrade:true },
  deco:    { label:'Art Deco',      clad:true, pier:0.14, sill:0,   head:0.8, win:1, inner:0,
             mull:1, spandrel:2.8, reveal:0.7,  fin:0.9,  cornice:1.2, string:0,   balcony:0, op:0.52,
             finRise:7, darkSpandrel:true },
  med:     { label:'Mediterranean', clad:true, pier:0.15, sill:3.0, head:2.4, win:1, inner:0,
             mull:1, spandrel:0,   reveal:1.0,  fin:0,    cornice:1.8, string:0,   balcony:2.0, op:0.60,
             arch:true, tileRoof:true },
};
const MATERIALS = {
  limestone:{ label:'Limestone', c:0xe4ded1 }, sandstone:{ label:'Sandstone', c:0xd9c39f },
  redbrick: { label:'Red brick', c:0xa5543c }, buffbrick:{ label:'Buff brick', c:0xc3a87e },
  stucco:   { label:'Stucco',    c:0xf0e7d9 }, concrete: { label:'Concrete',  c:0xc9c9c6 },
  bronze:   { label:'Bronze',    c:0x8b6b45 },
};
const STYLE_MAT = { curtain:'concrete', punched:'limestone', loft:'redbrick',
                    classical:'limestone', deco:'sandstone', med:'stucco' };

/* ---------- rendered model ---------- */
function clearRender(){
  while (gRender.children.length){
    const c = gRender.children.pop();
    if (c.geometry && c.geometry !== BOX) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
}
function mixHex(a,b,t){
  const ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255;
  const br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
  return ((Math.round(ar+(br-ar)*t)<<16)|(Math.round(ag+(bg-ag)*t)<<8)|Math.round(ab+(bb-ab)*t));
}
const shade=(c,f)=>mixHex(c, f<1?0x000000:0xffffff, f<1?1-f:f-1);

function buildRender(){
  if(!gl3d) return;
  scratch3D();
  clearRender();
  const {vg,pg,cfg}=state, opt=state.options[state.pick];
  if(!vg||!opt||!BOX) return;
  const st = STYLES[state.style] || STYLES.curtain;
  const matC = (MATERIALS[state.material]||MATERIALS.concrete).c;
  const FH=cfg.floorH, assign=effAssign();
  const cx=(vg.minX+vg.maxX)/2, cz=(vg.minY+vg.maxY)/2;

  const glassBy={}, clad=[], trim=[], mull=[], fin=[], slab=[], terrace=[], column=[],
        deck=[], garden=[], parapet=[], lawn=[], trunk=[], crown=[], dark=[];
  const push=(arr,x,y,z,sx,sy,sz)=>{ if(sx>0.02&&sy>0.02&&sz>0.02) arr.push([x,y,z,sx,sy,sz]); };
  const live = id => id!==undefined && id!==null && id!==-1 && assign[id]!==-1;

  const entMap = new Map(entranceList().map(e=>[e.id, e.face]));
  const carriesOn=[];
  for(let s=0;s<cfg.stories;s++) carriesOn[s]=(vg.byStory[s+1]||[]).some(i=>assign[i]!==-1);
  const grnd=mulberry32(413);
  const topS = carriesOn.lastIndexOf(true)+1;

  for (const v of vg.voxels){
    if (assign[v.id]===-1) continue;
    const s=v.s, yb=s*FH, X=v.x+v.w/2-cx, Z=v.y+v.d/2-cz;
    push(slab, X, yb+0.4, Z, v.w, 0.8, v.d);

    if (!live(v.above)){
      if (carriesOn[s]) push(terrace, X, yb+FH+0.25, Z, v.w*0.9, 0.35, v.d*0.9);
      else {
        push(st.tileRoof?terrace:deck, X, yb+FH+0.2, Z, v.w*0.96, 0.3, v.d*0.96);
        if (!st.tileRoof && grnd()<0.38) push(garden, X, yb+FH+0.5, Z, v.w*0.7, 0.4, v.d*0.7);
      }
      const pf=[[v.ix,v.iy-1,X,v.y-cz,v.w,0.5],[v.ix,v.iy+1,X,v.y+v.d-cz,v.w,0.5],
                [v.ix-1,v.iy,v.x-cx,Z,0.5,v.d],[v.ix+1,v.iy,v.x+v.w-cx,Z,0.5,v.d]];
      for (const [nx2,ny2,px,pz,sx,sz] of pf){
        if (live(vg.index.get(`${s},${nx2},${ny2}`))) continue;
        push(parapet, px, yb+FH+1.5, pz, sx, st.balustrade?3.4:2.6, sz);
      }
    }

    const use = pg.floorUse[s] || 'apartment';
    (glassBy[use] ||= []);
    const entHere = entMap.has(v.id);
    const isBase = st.tripartite && s===0;
    const isTop  = s===topS-1;

    // last field is the index into DIRS, so the entrance face can be identified
    const faces=[
      [ v.ix, v.iy-1, X, v.y-cz,        v.w, 'x', -1, 0 ],
      [ v.ix, v.iy+1, X, v.y+v.d-cz,    v.w, 'x',  1, 2 ],
      [ v.ix-1, v.iy, v.x-cx,     Z,    v.d, 'z', -1, 3 ],
      [ v.ix+1, v.iy, v.x+v.w-cx, Z,    v.d, 'z',  1, 1 ],
    ];
    for (const [nx2,ny2,px,pz,W,ax,sign,dirI] of faces){
      if (live(vg.index.get(`${s},${nx2},${ny2}`))) continue;
      const isDoorFace = entHere && entMap.get(v.id)===dirI;
      // u runs along the face, v is vertical, n is outward
      const put=(arr,uOff,vOff,uS,vS,thk,nOff)=>{
        const ox2 = ax==='x' ? px+uOff : px + (nOff||0)*sign;
        const oz2 = ax==='x' ? pz + (nOff||0)*sign : pz+uOff;
        push(arr, ox2, yb+vOff, oz2, ax==='x'?uS:thk, vS, ax==='x'?thk:uS);
      };
      const pier = Math.min(W*0.45, W*st.pier + (st.clad?1.2:0.3));
      const inner = W*st.inner;
      let sill = isBase ? Math.max(0.8, st.sill-1.6) : st.sill;
      sill = Math.max(sill, st.spandrel);  // glass starts above the spandrel
      const head = isBase ? Math.max(0.8, st.head-0.8) : st.head;
      const nWin = Math.max(1, st.win);
      const winH = Math.max(2, FH - sill - head - 0.6);
      const winW = Math.max(1.2, (W - 2*pier - (nWin-1)*inner)/nWin);
      const T = st.clad ? 1.3 : 0.45;

      if (isDoorFace){
        // the opening itself is built by the entrance assembly; here we only
        // wrap it so the wall above and beside the doors still reads solid
        const oW = Math.min(W*0.78, 17), oH = Math.min(FH-1.6, 11);
        const jamb = (W-oW)/2;
        const putD=(arr,uOff,vOff,uS,vS,thk,nOff)=>{
          const ox2 = ax==='x' ? px+uOff : px + (nOff||0)*sign;
          const oz2 = ax==='x' ? pz + (nOff||0)*sign : pz+uOff;
          push(arr, ox2, yb+vOff, oz2, ax==='x'?uS:thk, vS, ax==='x'?thk:uS);
        };
        putD(clad, -W/2+jamb/2, FH/2, jamb, FH, T, 0);
        putD(clad,  W/2-jamb/2, FH/2, jamb, FH, T, 0);
        putD(clad, 0, (FH+oH)/2, oW, FH-oH, T, 0);
        putD(trim, 0, oH+0.4, oW+2.2, 0.8, T+0.6, 0.3);
        continue;
      }

      if (st.clad){
        const cl = isBase ? -0.06 : 0;
        put(clad, -W/2+pier/2, FH/2, pier, FH, T, 0);
        put(clad,  W/2-pier/2, FH/2, pier, FH, T, 0);
        for (let i=1;i<nWin;i++)
          put(clad, -W/2+pier+i*winW+(i-0.5)*inner, FH/2, inner, FH, T, 0);
        const spanU = W-2*pier;
        if (sill>st.spandrel) put(clad, 0, (sill+st.spandrel)/2, spanU, sill-st.spandrel, T, 0);
        if (head>0) put(clad, 0, FH-head/2, spanU, head, T, 0);
        put(clad, 0, FH-0.3, W, 0.6, T, 0);
        if (isBase) for (let b=2.2;b<FH-1;b+=2.4) put(trim, 0, b, W, 0.35, T+0.35, 0.18);
        void cl;
      } else {
        put(clad, -W/2+pier/2, FH/2, pier, FH, T, 0);
        put(clad,  W/2-pier/2, FH/2, pier, FH, T, 0);
      }
      if (st.spandrel>0)
        put(st.darkSpandrel?dark:trim, 0, st.spandrel/2, W, st.spandrel, T+0.25, 0.12);
      if (st.string>0 && !isTop) put(trim, 0, FH-0.4, W, st.string, T+0.7, 0.35);
      if (st.lintel && head>0) put(trim, 0, FH-head-0.3, W-2*pier+0.8, 0.7, T+0.5, 0.25);
      if (st.arch){
        const top = sill+winH;
        put(trim, 0, top+0.35, winW*1.06, 0.7, T+0.3, 0.16);
        put(trim, 0, top+0.95, winW*0.78, 0.6, T+0.3, 0.16);
        put(trim, 0, top+1.45, winW*0.44, 0.5, T+0.3, 0.16);
      }
      if (st.balcony>0 && LEASABLE.has(pg.rooms[assign[v.id]].type) && s>0){
        put(trim, 0, sill-0.3, winW+1.4, 0.5, st.balcony, st.balcony/2);
        put(trim, 0, sill+1.3, winW+1.4, 2.6, 0.35, st.balcony-0.2);
      }
      if (st.fin>0){
        const rise = (isTop && st.finRise) ? st.finRise : 0;
        for (const u of [-W/2+pier/2, W/2-pier/2])
          put(clad, u, (FH+rise)/2, pier*0.55, FH+rise, T+st.fin, st.fin/2+0.2);
      }
      if (st.cornice>0 && isTop){
        put(trim, 0, FH+st.cornice/2, W, st.cornice, T+1.5, 0.75);
        put(trim, 0, FH-0.5, W, 0.9, T+0.9, 0.45);
      }
      // glazing, set back into the reveal
      for (let i=0;i<nWin;i++){
        const u = -W/2+pier+winW/2+i*(winW+inner);
        put(glassBy[use], u, sill+winH/2, winW, winH, 0.4, -st.reveal);
        const mn = Math.max(0, st.mull-1);
        for (let mI=1; mI<=mn; mI++){
          const mu = u - winW/2 + (winW*mI)/(mn+1);
          put(mull, mu, sill+winH/2, 0.5, winH, 0.7, -st.reveal+0.15);
        }
        if (!st.clad) put(mull, u, sill+winH/2, winW, 0.45, 0.7, -st.reveal+0.15);
      }
    }
  }

  // Frame over the whole plate, open bays included, with the edge columns
  // pulled inboard so the wall face is flush outside them.
  const colS = Math.max(1.4, Math.min(2.4, cfg.bay*0.085));
  const BEAM = 1.7;
  for (let s=0;s<cfg.stories;s++){
    if (!(vg.byStory[s]||[]).length) continue;
    for (const nd of frameNodes(vg, s, colS))
      push(column, nd[0]-cx, s*FH+FH/2, nd[1]-cz, colS, FH, colS);
    for (const bm of frameBeams(vg, s))
      push(column, bm[0]-cx, (s+1)*FH-0.9-BEAM/2, bm[1]-cz,
        bm[3]==='x'?bm[2]:colS*0.75, BEAM, bm[3]==='x'?colS*0.75:bm[2]);
    // an unbuilt bay is a planted terrace, not a hole
    for (const id of (vg.byStory[s]||[])){
      if (assign[id] !== -1) continue;
      const v = vg.voxels[id];
      push(slab, v.x+v.w/2-cx, s*FH+0.45, v.y+v.d/2-cz, v.w+0.7, 0.9, v.d+0.7);
      push(terrace, v.x+v.w/2-cx, s*FH+1.05, v.y+v.d/2-cz, v.w*0.88, 0.35, v.d*0.88);
      if (grnd()<0.5){
        const th=6+grnd()*4;
        push(trunk, v.x+v.w/2-cx, 1.2+th*0.32, v.y+v.d/2-cz, 0.7, th*0.64, 0.7);
        push(crown, v.x+v.w/2-cx, 1.2+th*0.8,  v.y+v.d/2-cz, th*0.6, th*0.6, th*0.6);
      }
      // a rail wherever the deck runs out to open air
      const rails=[
        [v.ix,v.iy-1, v.x+v.w/2, v.y,       v.w, 'x'],
        [v.ix,v.iy+1, v.x+v.w/2, v.y+v.d,   v.w, 'x'],
        [v.ix-1,v.iy, v.x,       v.y+v.d/2, v.d, 'z'],
        [v.ix+1,v.iy, v.x+v.w,   v.y+v.d/2, v.d, 'z'],
      ];
      for (const r of rails){
        if (vg.index.get(s+','+r[0]+','+r[1]) !== undefined) continue;
        push(trim, r[2]-cx, s*FH+2.6, r[3]-cz,
          r[5]==='x'?r[4]:0.45, 0.4, r[5]==='x'?0.45:r[4]);
        push(trim, r[2]-cx, s*FH+1.5, r[3]-cz,
          r[5]==='x'?r[4]:0.3, 0.25, r[5]==='x'?0.3:r[4]);
      }
    }
  }

  for (let iy=0; iy<vg.rowD.length; iy++){
    for (let ix=0; ix<vg.colW.length; ix++){
      const mx=vg.cx[ix]+vg.colW[ix]/2, my=vg.cy[iy]+vg.rowD[iy]/2;
      if (!pointInPoly(mx,my,vg.pts)) continue;
      if (buildable(mx,my,vg.pts,vg.edges,vg.setbacks,0)) continue;
      push(lawn, mx-cx, 0.12, my-cz, vg.colW[ix]*0.96, 0.24, vg.rowD[iy]*0.96);
      if (grnd()<0.5){
        const tx=mx-cx+(grnd()-.5)*6, tz=my-cz+(grnd()-.5)*6, h=9+grnd()*7;
        push(trunk, tx, h*0.35, tz, 0.9, h*0.7, 0.9);
        push(crown, tx, h*0.85, tz, h*0.62, h*0.62, h*0.62);
      }
    }
  }

  // main entrance: recessed doorway, revolving drum, canopy and steps
  for (const ei of entranceList()){
    const v = vg.voxels[ei.id];
    if (!v || ei.face < 0) continue;
    const [dx,dy] = DIRS[ei.face];
    const fx = (v.x+v.w/2-cx) + dx*v.w/2, fz = (v.y+v.d/2-cz) + dy*v.d/2;
    const along = dx!==0 ? v.d : v.w;
    const openW = Math.min(along*0.78, 17);
    const openH = Math.min(FH-1.6, 11);
    const aw = dx!==0 ? 0 : openW, ad = dx!==0 ? openW : 0;
    const dark2 = new THREE.MeshLambertMaterial({color:0x2c2c30});
    const mk=(geo,mat,x,y,z,rot)=>{
      const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z);
      if(rot) m.rotation.y=rot; gRender.add(m); return m;
    };
    // reveal
    mk(new THREE.BoxGeometry(aw||1.6, openH, ad||1.6), dark2,
       fx+dx*0.5, openH/2, fz+dy*0.5);
    // revolving drum
    const drumR = Math.min(openW*0.3, 4.2);
    const drum = mk(new THREE.CylinderGeometry(drumR, drumR, openH-1.4, 20, 1, true),
      new THREE.MeshPhongMaterial({color:0xbcd6e6, transparent:true, opacity:0.5,
        shininess:90, side:THREE.DoubleSide, depthWrite:false}),
      fx+dx*1.2, (openH-1.4)/2, fz+dy*1.2);
    drum.renderOrder = 4;
    const blade = new THREE.BoxGeometry(drumR*1.9, openH-1.8, 0.35);
    for (let i=0;i<4;i++)
      mk(blade, new THREE.MeshPhongMaterial({color:0xd8e6ef, transparent:true,
        opacity:0.62, shininess:70, side:THREE.DoubleSide}),
        fx+dx*1.2, (openH-1.8)/2, fz+dy*1.2, i*Math.PI/4 + (dx!==0?Math.PI/2:0));
    // side leaves
    for (const sgn of [-1,1]){
      const ox3 = dx!==0 ? 0 : sgn*(drumR+2.6), oz3 = dx!==0 ? sgn*(drumR+2.6) : 0;
      mk(new THREE.BoxGeometry(dx!==0?0.4:3.4, openH-2.2, dx!==0?3.4:0.4),
        new THREE.MeshPhongMaterial({color:0xcfe0ec, transparent:true, opacity:0.55,
          shininess:80, side:THREE.DoubleSide}),
        fx+dx*1.0+ox3, (openH-2.2)/2, fz+dy*1.0+oz3);
    }
    // canopy and steps
    const canopyD = 7;
    mk(new THREE.BoxGeometry(dx!==0?canopyD:openW+5, 0.8, dx!==0?openW+5:canopyD),
      new THREE.MeshLambertMaterial({color:shade(matC,1.08)}),
      fx+dx*canopyD/2, openH+0.9, fz+dy*canopyD/2);
    for (let i=0;i<3;i++){
      const d2=(i+1)*2.2, w2=openW+2+i*1.6;
      push(trim, fx+dx*d2/2, 0.55-i*0.22, fz+dy*d2/2,
        dx!==0?d2:w2, 0.45, dx!==0?w2:d2);
    }
    push(dark, fx-dx*0.2, openH/2, fz-dy*0.2, dx!==0?0.5:openW+1.2, 0.5, dx!==0?openW+1.2:0.5);
  }

  const add=(list,mat,geo)=>{
    if(!list.length) return null;
    const m=new THREE.InstancedMesh(geo||BOX, mat, list.length);
    m.frustumCulled=false;
    list.forEach((t,i)=>{
      const st = Math.max(0, Math.min(cfg.stories-1, Math.floor(t[1]/FH)));
      setM(t[0],t[1],t[2],t[3],t[4],t[5], twistAt(st));
      m.setMatrixAt(i,_m); });
    m.instanceMatrix.needsUpdate=true; gRender.add(m); return m;
  };
  const L=c=>new THREE.MeshLambertMaterial({color:c});
  add(lawn,    L(0x8fbf5a));
  add(terrace, L(st.tileRoof?0xb5643f:0x74ab52));
  add(deck,    L(0xd6d6db));
  add(garden,  L(0x74ab52));
  add(slab,    L(st.clad?shade(matC,0.94):0xf3f3f5));
  add(column,  L(st.clad?shade(matC,0.88):0xcfcfd4));
  add(clad,    L(matC));
  add(trim,    L(shade(matC,1.09)));
  add(dark,    L(0x3f3a35));
  add(parapet, L(st.clad?shade(matC,1.04):0xe4e4e8));
  add(mull,    L(st.clad?shade(matC,0.72):0x54545a));
  add(trunk,   L(0x7a5c46));
  add(crown,   L(0x5f9142), new THREE.SphereGeometry(0.5,10,8));
  for (const [use,list] of Object.entries(glassBy)){
    const base = st.clad ? 0x7d9fb4 : 0x9ec9e6;
    const c = mixHex(base, USE_HEX[use]||base, st.clad?0.12:0.22);
    const m = add(list, new THREE.MeshPhongMaterial({ color:c, transparent:true,
      opacity:st.op, shininess:st.clad?60:96, specular:0xffffff,
      depthWrite:false, side:THREE.DoubleSide }));
    if (m) m.renderOrder = 3;
  }
}
function frameCamera(){
  if(!gl3d) return;
  const vg=state.vg, h=state.cfg.stories*state.cfg.floorH;
  orbit.r=Math.max(vg.totalW,vg.totalD,h)*2.5; orbit.ty=h*0.42;
}
