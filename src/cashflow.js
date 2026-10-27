/* Programme, monthly cashflow and funding
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ============================================================================
   Editing a plan.

   Units are rectangles cut along a corridor, so the thing between two of them
   is a shared edge and nothing more. Dragging it moves frontage from one unit
   to its neighbour; deleting it merges them; clicking inside a unit cuts it in
   two. That is the whole edit model, and it is a far better fit than the bay
   machinery this replaces, which could only ever move a wall a whole bay at a
   time and stopped working altogether once units were cut by frontage.

   Edits are applied straight to state.plan, so the schedule, the appraisal and
   the 3D model follow without any plumbing of their own, and regenerating
   clears them the way it always has.
   ========================================================================== */
const MIN_FRONT = 11;          // the narrowest a room can usefully be

/* Every wall shared by two rooms on a level. */
function demisingWalls(plan){
  const R = plan.rooms, out = [];
  const near = (a,b) => Math.abs(a-b) < 0.4;
  for (let i = 0; i < R.length; i++)
    for (let j = 0; j < R.length; j++){
      if (i === j) continue;
      const a = R[i], b = R[j];
      // b immediately right of a, sharing vertical extent
      if (near(a.x + a.w, b.x) && near(a.y, b.y) && near(a.d, b.d))
        out.push({ axis:'v', pos:b.x, lo:a.y, hi:a.y + a.d, a:i, b:j });
      // b immediately below a, sharing horizontal extent
      if (near(a.y + a.d, b.y) && near(a.x, b.x) && near(a.w, b.w))
        out.push({ axis:'h', pos:b.y, lo:a.x, hi:a.x + a.w, a:i, b:j });
    }
  return out;
}

/* Rename a room to whatever its area now makes it. A dragged wall changes the
   areas either side, and a 2 bed that has shrunk to 640 sq ft is a 1 bed. */
function relabel(room, kind){
  if (room.isCore || room.isLobby || room.use === 'corridor') return;
  const set = kind === 'retail' ? [TYPES.shopS, TYPES.shopL] : [TYPES.apt1, TYPES.apt2];
  let best = set[0], bd = Infinity;
  for (const t of set){
    const d = Math.abs(room.area - t.target);
    if (d < bd){ bd = d; best = t; }
  }
  room.use = best.use; room.label = best.label;
  room.typeKey = best.key; room.target = best.target;
}
const levelKind = lvl => {
  const u = (state.pg && state.pg.floorUse[lvl]) || 'apartment';
  return RETAIL_USES.has(u) ? 'retail' : 'residential';
};

/* Move a wall. Returns a reason when it cannot go where it was asked. */
function moveWall(plan, wall, to){
  const A = plan.rooms[wall.a], B = plan.rooms[wall.b];
  if (wall.axis === 'v'){
    const lo = A.x + MIN_FRONT, hi = B.x + B.w - MIN_FRONT;
    if (hi < lo) return 'Neither unit can give up any more frontage';
    const x = Math.max(lo, Math.min(hi, to));
    A.w = x - A.x; B.w = (B.x + B.w) - x; B.x = x;
  } else {
    const lo = A.y + MIN_FRONT, hi = B.y + B.d - MIN_FRONT;
    if (hi < lo) return 'Neither unit can give up any more frontage';
    const y = Math.max(lo, Math.min(hi, to));
    A.d = y - A.y; B.d = (B.y + B.d) - y; B.y = y;
  }
  A.area = A.w * A.d; B.area = B.w * B.d;
  return null;
}

function mergeWall(plan, wall){
  const R = plan.rooms, A = R[wall.a], B = R[wall.b];
  if (A.isCore || B.isCore) return 'A lift or stair cannot be merged away';
  const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y);
  const w = Math.max(A.x + A.w, B.x + B.w) - x;
  const d = Math.max(A.y + A.d, B.y + B.d) - y;
  const keep = A.isLobby ? A : B.isLobby ? B : A;
  const drop = keep === A ? B : A;
  keep.x = x; keep.y = y; keep.w = w; keep.d = d; keep.area = w * d;
  R.splice(R.indexOf(drop), 1);
  return null;
}

function splitRoom(plan, idx, at, kind){
  const r = plan.rooms[idx];
  if (r.isCore) return 'A lift or stair cannot be subdivided';
  /* Cut across the frontage, never across the depth. A unit reaches the
     corridor along one edge; dividing it parallel to that edge would leave the
     back half with no way out. Splitting across the longer side did exactly
     that on a deep plate. */
  const near = (a,b) => Math.abs(a-b) < 0.4;
  let horiz = r.w >= r.d;
  for (const c of plan.corridor){
    if (near(r.y + r.d, c.y) || near(c.y + c.d, r.y)){ horiz = true;  break; }
    if (near(r.x + r.w, c.x) || near(c.x + c.w, r.x)){ horiz = false; break; }
  }
  const span = horiz ? r.w : r.d;
  if (span < MIN_FRONT * 2) return 'Not enough width to divide this one';
  const origin = horiz ? r.x : r.y;
  const t = Math.max(MIN_FRONT, Math.min(span - MIN_FRONT, at - origin));
  const second = { ...r };
  if (horiz){ second.x = r.x + t; second.w = r.w - t; r.w = t; }
  else      { second.y = r.y + t; second.d = r.d - t; r.d = t; }
  r.area = r.w * r.d; second.area = second.w * second.d;
  delete second.isLobby;
  plan.rooms.splice(idx + 1, 0, second);
  relabel(r, kind); relabel(second, kind);
  return null;
}

function roomAtFt(plan, p){
  for (let i = 0; i < plan.rooms.length; i++){
    const r = plan.rooms[i];
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.d) return i;
  }
  return -1;
}
function wallNear(plan, p, tol){
  const ws = demisingWalls(plan);
  let best = null, bd = tol;
  for (const w of ws){
    const along = w.axis === 'v' ? p.y : p.x;
    if (along < w.lo - 1 || along > w.hi + 1) continue;
    const d = Math.abs((w.axis === 'v' ? p.x : p.y) - w.pos);
    if (d < bd){ bd = d; best = w; }
  }
  return best;
}

/* Run an edit, and put it back if it breaks the plan. An edit that leaves a
   room unreachable or two rooms overlapping is not an edit worth having, and
   silently accepting one would undo the guarantee the planner works to. */
function tryEdit(plan, fn){
  const before = JSON.stringify(plan.rooms);
  const err = fn();
  if (err){ plan.rooms = JSON.parse(before); return err; }
  if (!checkAccess(plan).ok || !checkOverlap(plan).ok){
    plan.rooms = JSON.parse(before);
    return 'That would leave a space with no way out';
  }
  return null;
}

/* Everything downstream reads state.plan, so one refresh does the lot. */
function afterEdit(){
  state.mEdited = true;
  paintInfo(); paintSheet(); drawBigPlan(); paintRoomList();
  if (state.view === 'plans') paintPlans();
  invalidate3DOnly();
}
function invalidate3DOnly(){ try { paint3D(); } catch(_){} }
