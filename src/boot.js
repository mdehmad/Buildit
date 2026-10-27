/* Generation run loop and start-up
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ================= run ================= */
let busy=false;
async function generate(animate){
  if(busy) return;
  if(state.drawing) endDraw();
  busy=true; $('go').disabled=true; $('working').classList.add('on');
  try {
  if(state.view==='site') showView('mass');
  const cfg=readCfg(); state.cfg=cfg;
  const vg=buildVoxelGraph({pts:state.site.pts,setbacks:state.site.setbacks},cfg);
  if(!vg.voxels.length){
    endWork();
    state.options=[]; paintRibbon(); paintSheet();
    flag('No buildable area \u2014 setbacks consume the plot'); showView('site'); return;
  }
  const pg=buildProgramGraph(vg,cfg);
  state.vg=vg; state.pg=pg; state.vgStale=false;
  state.plan=buildPlans(vg,pg,cfg);
  const out=[];
  for(let i=0;i<cfg.nOpts;i++){
    $('workingTxt').textContent=`Solving option ${i+1} of ${cfg.nOpts}`;
    await new Promise(r=>setTimeout(r,0));
    const b=solve(vg,pg,{iters:cfg.iters,seed:(Date.now()%9973)+i*131});
    b.contig=contiguity(vg,pg,b.state.assign);
    out.push(b);
  }
  out.sort((a,b)=>(b.ev.edgeAcc+b.ev.coreAlign*0.35)-(a.ev.edgeAcc+a.ev.coreAlign*0.35));
  state.options=out; state.pick=0; state.edits={}; dirtyEdits(); state.mEdited=false;
  // parking reads the area schedule, which needs the options in place first
  state.parking=buildParking();
  if(state.floor>=cfg.stories) state.floor=-1;
  frameCamera(); paintFloors(); paintMix(); refreshAll();
  state.reveal=animate?0:1; paint3D();
  flag('');
  if (pg.dropped.length){
    const n=pg.dropped.reduce((a,x)=>a+x.removed,0);
    flag(`${n} room${n>1?'s':''} dropped from upper levels \u2014 not enough bays`);
  }
  } catch(err){
    console.error(err);
    flag('Something went wrong while solving \u2014 adjust an input and try again');
  } finally { endWork(); }
}

/* Any throw inside generate used to leave the translucent "Solving" scrim
   covering the canvas for good, with Generate stuck disabled. */
function endWork(){
  $('working').classList.remove('on'); $('go').disabled=false; busy=false;
}

/* ---------- saving a file, in the artifact viewer or a plain page ---------- */
let _dl;
async function saveFile(filename, text, mime){
  if (_dl === undefined){
    try { _dl = (window.claude && claude.use) ? await claude.use('downloads') : null; }
    catch(_) { _dl = null; }
  }
  if (_dl){
    try { await _dl.save({ filename, data: text }); flag('Saved '+filename); }
    catch(err){
      const c = err && err.code;
      if (c === 'declined') flag('Download cancelled');
      else if (c === 'rate_limited') flag('A download prompt is already open \u2014 try again in a moment');
      else flag('Download unavailable here');
    }
    return;
  }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:mime}));
  a.download=filename; a.click(); URL.revokeObjectURL(a.href);
}

function download(){
  const {vg,pg,cfg}=state, opt=state.options[state.pick]; if(!opt) return;
  normalizeSite();
  const edges=edgeData(state.site.pts);
  const s=schedule();
  const doc={ generator:'massing / region growing + annealing', units:'feet',
    location: state.loc || null,
    plot:{ corners:state.site.pts, area:Math.round(plotArea()),
      setbacks:edges.map((e,i)=>({edge:i,faces:faceOf(e),length:Math.round(e.len),
        setback:state.site.setbacks[i]??0})) },
    building:{ storeys:cfg.stories, floorHeight:cfg.floorH, height:cfg.stories*cfg.floorH,
      bay:cfg.bay, upperStoreySetback:cfg.upperSetback, heightLimit:cfg.heightLimit,
      farRatio:state.ratio, permissibleArea:Math.round(cfg.allowed),
      stacking:cfg.stack, core:cfg.core },
    unitMix: state.mix,
    schedule: s && { gfa:Math.round(s.gfa), net:Math.round(s.net),
      efficiency:+(s.eff).toFixed(4), far:+s.far.toFixed(3),
      rows:s.rows.map(r=>({name:r.name,use:r.use,count:r.count,
        totalArea:Math.round(r.area), eachArea:r.count?Math.round(r.area/r.count):0})) },
    rooms: pg.rooms.map(r=>({id:r.id,name:r.name,type:r.type,level:r.s+1,
      targetArea:+r.target.toFixed(1)})),
    adjacency: pg.edges,
    voxels: vg.voxels.map(v=>({id:v.id,level:v.s+1,x:v.x,y:v.y,
      z:+(v.s*cfg.floorH).toFixed(1),w:v.w,d:v.d,h:cfg.floorH,room:effAssign()[v.id]})),
    quality:{ coverage:+opt.ev.coverage.toFixed(4), adjacency:+opt.ev.edgeAcc.toFixed(4),
      contiguity:+opt.contig.toFixed(4), coreStacking:+opt.ev.coreAlign.toFixed(4) } };
  saveFile('massing.json', JSON.stringify(doc,null,2), 'application/json');
}

/* ================= boot ================= */
const SIZERS=new Set(['sHl','sFh','sBay','sUp','sAng','sTwist']);
document.querySelectorAll('input[type=range]').forEach(el=>
  el.addEventListener('input',()=>{
    if (SIZERS.has(el.id)) resize2(); else { syncLabels(); plotNote(); if(state.view==='site')paintSite(); }
    invalidate();
  }));
['cStairs','cLifts','cWc','cSvc','cStairN','cLiftN'].forEach(id=>
  $(id).addEventListener('change',()=>{ coreNote(); invalidate(); }));
function coreNote(){
  const c=readCfg().core, bay=+$('sBay').value, bayArea=bay*bay;
  const shaft=Math.max(1,Math.round(c.lifts/bayArea));
  $('coreNote').innerHTML =
    `<b>${c.liftCount}</b> lift${c.liftCount>1?'s':''} in one shaft of
     <b>${shaft}</b> bay${shaft>1?'s':''} (${fmt(c.lifts)} ft&sup2;), held on the same grid on every
     level. <b>${c.stairCount}</b> stair${c.stairCount>1?'s':''} placed separately for escape.`;
}
$('go').onclick=()=>generate(true);
$('dl').onclick=download;
$('csv').onclick=exportCSV;
$('addUnit').onclick=()=>{
  state.mix.push({ id:'u'+(state.uid++), name:'New unit', use:state.paint,
    unitArea:800, perFloor:2 });
  paintMix(); syncLabels(); invalidate();
};
$('applyAll').onclick=()=>{
  const v=state.site.setbacks[0]??0;
  state.site.setbacks=state.site.setbacks.map(()=>v);
  paintEdgeRows(); plotNote(); paintSite(); invalidate();
};
$('tSelect').onclick=()=>setTool('select');
$('tDraw').onclick=()=>{ state.drawing?endDraw():startDraw(); };
$('tAdd').onclick=()=>setTool('add');
$('tDel').onclick=()=>setTool('del');
$('tEnt').onclick=()=>setTool('entrance');
$('alignPlot').onclick=()=>{
  normalizeSite();
  const e=edgeData(state.site.pts);
  let best=e[0]; for(const x of e) if(x.len>best.len) best=x;
  let deg=Math.atan2(best.b.y-best.a.y, best.b.x-best.a.x)*180/Math.PI;
  deg=((deg%90)+90)%90;
  $('sAng').value=Math.round(deg); resize2(); invalidate();
  flag(`Grid turned to ${Math.round(deg)}\u00b0, square to the longest boundary`);
};
$('tImg').onclick=()=>setTool('img');
$('tCal').onclick=()=>{ setTool('cal'); flag('Drag a line across a known distance on the image'); };
$('imgPick').onclick=()=>$('imgFile').click();
$('imgClear').onclick=()=>{ state.img=null; setTool('select'); imgScaleLabel(); paintSite();
  $('imgNote').textContent='Drop in a screenshot from a map or a survey, set its scale, then trace the boundary with the Draw tool.'; };
$('imgFile').addEventListener('change',ev=>{
  const f=ev.target.files && ev.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    const el=new Image();
    el.onload=()=>{
      const span=Math.max(vgSpan(),200);
      state.img={ el, cx:plotCentre().x, cy:plotCentre().y, wft:span*1.6, baseW:span*1.6 };
      $('sImgSc').value=100; imgScaleLabel();
      $('imgNote').innerHTML='Now pick <b>Set the image scale</b> in the toolbar, drag a line across a known distance, and type its length. Then trace with <b>Draw plot</b>.';
      setTool('img'); paintSite();
    };
    el.src=rd.result;
  };
  rd.readAsDataURL(f);
  ev.target.value='';
});
$('sImgOp').addEventListener('input',()=>{ state.imgOp=+$('sImgOp').value/100;
  $('vImgOp').textContent=$('sImgOp').value+'%'; paintSite(); });
$('sImgSc').addEventListener('input',()=>{
  if(!state.img){ imgScaleLabel(); return; }
  state.img.wft = state.img.baseW * (+$('sImgSc').value/100);
  imgScaleLabel(); paintSite();
});
function imgScaleLabel(){
  $('vImgSc').textContent = $('sImgSc').value+'%';
  const n=$('imgSpan');
  if(!state.img){ n.textContent=''; return; }
  const im=state.img;
  const hft=im.wft*(im.el.naturalHeight/im.el.naturalWidth||1);
  n.innerHTML=`Image covers <b>${Math.round(im.wft)} \u00d7 ${Math.round(hft)} ft</b>. Scroll over the plot with the image tool to resize.`;
}
// wheel scales the underlay while the image tool is active
$('site').addEventListener('wheel',e=>{
  if(state.tool!=='img'||!state.img) return;
  e.preventDefault();
  const f = e.deltaY<0 ? 1.06 : 1/1.06;
  const pct = Math.max(10, Math.min(400, (+$('sImgSc').value)*f));
  $('sImgSc').value=Math.round(pct);
  state.img.wft = state.img.baseW*(pct/100);
  imgScaleLabel(); paintSite();
},{passive:false});
$('locName').addEventListener('change',()=>{ state.loc=$('locName').value.trim(); });
function vgSpan(){ const xs=state.site.pts.map(p=>p.x), ys=state.site.pts.map(p=>p.y);
  return Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys)); }
function plotCentre(){ const xs=state.site.pts.map(p=>p.x), ys=state.site.pts.map(p=>p.y);
  return { x:(Math.min(...xs)+Math.max(...xs))/2, y:(Math.min(...ys)+Math.max(...ys))/2 }; }
$('tFit').onclick=()=>{ state.fitPending=true; paintSite(); if(state.vg) frameCamera(); };
$('tReset').onclick=()=>{ state.site=DEFAULT_PLOT(); state.drawing=false; setTool('select');
  paintEdgeRows(); plotNote(); paintSite(); invalidate(); };
for(const [id,v] of [['vwDash','dash'],['vwSite','site'],['vwMass','mass'],
  ['vwRender','render'],['vwPlans','plans'],['vwInv','inv'],['vwFeas','feas']])
  $(id).onclick=()=>showView(v);

/* The inputs drawer. Everything that shapes a scheme is still one click away,
   but it is no longer the first thing the tool shows you. */
function openPanel(on){
  $('panel').classList.toggle('open', on);
  $('scrim').classList.toggle('on', on);
}
$('btnInputs').onclick = () => openPanel(!$('panel').classList.contains('open'));
$('scrim').onclick = () => openPanel(false);
$('cSprink').onchange = e => { state.sprinklered = e.target.checked;
  paintCoreDemand(); paintInfo(); };
$('btnGen').onclick = () => { openPanel(false); generate(true); };
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('panel').classList.contains('open')) openPanel(false);
});
$('dimEdit').addEventListener('keydown',e=>{
  if(e.key==='Enter'){ e.preventDefault(); closeDim(true); }
  if(e.key==='Escape'){ e.preventDefault(); closeDim(false); }
});
$('dimEdit').addEventListener('blur',()=>closeDim(true));
window.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&state.drawing) endDraw();
  if(e.key==='Escape'&&state.drawing){ state.drawing=false; state.draft=[]; setTool('select'); }
});

$('mClose').onclick=()=>{ $('planModal').classList.remove('on'); refreshAll(); };
$('mPrev').onclick=()=>mStep(-1);
$('mNext').onclick=()=>mStep(1);
$('mReset').onclick=()=>{ state.edits[state.mLvl]={bays:{},wall:{},door:{},win:{}};
  dirtyEdits(); redrawEditor(); mSay('Level reverted to the generated plan.'); };
$('mPlan').addEventListener('pointerdown',mDown);
$('mPlan').addEventListener('pointermove',mMove);
$('mPlan').addEventListener('pointerup',mUp);
$('mRevert').onclick = revertLevel;
$('mPlan').addEventListener('pointercancel',mUp);
window.addEventListener('pointerup',()=>{
  if (state.mDrag){ state.mDrag=null; syncDownstream(); }
  state.mPaint=false;
});
window.addEventListener('keydown',e=>{
  if(!$('planModal').classList.contains('on')) return;
  if(e.key==='Escape'){ $('planModal').classList.remove('on'); refreshAll(); }
  if(e.key==='ArrowUp'){ e.preventDefault(); mStep(1); }
  if(e.key==='ArrowDown'){ e.preventDefault(); mStep(-1); }
  if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); deleteSelected(); }
});
new ResizeObserver(()=>{ if($('planModal').classList.contains('on')) drawBigPlan(); })
  .observe($('mPlan').parentElement);

/* Boot order matters: everything the 2D app needs is built first, so that if
   the 3D stack is unavailable the drawing board still comes up fully drawn
   instead of a blank white panel. initGL swallows its own failure. */
syncLabels(); coreNote(); initSite();
$('projName').addEventListener('input', e => { state.projectName = e.target.value; });
$('projName').addEventListener('blur', () => { if (state.projectId) saveProject(state.projectName); });
paintRatios(); paintMassing(); paintUsePicker(); paintStyles(); paintMats();
paintEdgeRows(); resize2(); paintSite();
showView('site');
initGL();
generate(true).then(()=>{ paintProjectName(); showView('dash'); });
