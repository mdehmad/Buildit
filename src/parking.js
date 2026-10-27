/* Basements, parking demand and bay layout
   Part of buildIT. Concatenated into app.html by scripts/build.mjs in the
   order listed there; everything shares one scope, so that order matters. */

/* ============================================================================
   Programme and cashflow.

   A residual appraisal says whether a scheme makes money. It does not say how
   much money has to be in the ground before any comes back, or when. On a
   phased build with off-plan sales those are the questions that decide whether
   a developer can carry it at all, so the single-point answer is extended into
   a monthly model: spend on an S-curve, receipts on a payment plan, interest
   charged on whatever is drawn.
   ========================================================================== */
const phaseDefaults = () => ({
  preMonths: 6,        // design, approvals and mobilisation before site start
  buildMonths: 30,
  presaleLead: 6,      // months of selling before construction starts
  salesMonths: 36,     // how long the units take to sell
  downPct: 20,         // on booking
  instalPct: 60,       // spread through construction
  handoverPct: 20,     // on possession
  debtRate: 16,        // annual, on drawn funds
});

/* Cumulative construction spend. The usual S: slow to mobilise, fast in the
   middle, tailing off through finishes and snagging. */
const sCurve = x => x <= 0 ? 0 : x >= 1 ? 1 : x*x*(3 - 2*x);

function cashflow(){
  const r = feasibility(); if (!r) return null;
  const ph = state.phase || (state.phase = phaseDefaults());
  const pre = Math.max(0, Math.round(ph.preMonths));
  const bld = Math.max(1, Math.round(ph.buildMonths));
  const saleStart = Math.max(0, pre - Math.max(0, Math.round(ph.presaleLead)));
  const saleLen = Math.max(1, Math.round(ph.salesMonths));
  const done = pre + bld;                       // practical completion
  const N = Math.max(done, saleStart + saleLen) + 2;

  const out = new Array(N+1).fill(0);           // money going out
  const inn = new Array(N+1).fill(0);           // money coming in

  out[0] += r.land;                             // site paid up front
  for (let m = 0; m < pre; m++) out[m] += r.soft / pre;      // fees before start
  for (let m = 0; m < bld; m++){                             // build on the S-curve
    const w = sCurve((m+1)/bld) - sCurve(m/bld);
    out[pre + m] += (r.build + r.cont) * w;
  }
  for (let m = 0; m < saleLen; m++) out[saleStart + m] += r.mkt / saleLen;

  /* Receipts. A unit sold in month m pays a deposit then, instalments through
     to completion, and the balance on possession. */
  const perMonth = r.gdv / saleLen;
  for (let m = 0; m < saleLen; m++){
    const sold = saleStart + m, value = perMonth;
    inn[sold] += value * (ph.downPct/100);
    const left = Math.max(1, done - sold);
    for (let k = 0; k < left; k++)
      inn[Math.min(N, sold + k)] += value * (ph.instalPct/100) / left;
    inn[Math.min(N, Math.max(done, sold + 1))] += value * (ph.handoverPct/100);
  }

  /* Walk it month by month, charging interest on whatever is outstanding. */
  const mRate = (ph.debtRate/100) / 12;
  let bal = 0, interest = 0, peak = 0, peakAt = 0, payback = null;
  const series = [];
  for (let m = 0; m <= N; m++){
    const net = inn[m] - out[m];
    bal += net;
    if (bal < 0){ const i = -bal * mRate; interest += i; bal -= i; }
    if (bal < peak){ peak = bal; peakAt = m; }
    if (payback === null && bal >= 0 && m > 0) payback = m;
    series.push({ m, out: out[m], in: inn[m], bal });
  }

  /* IRR on the monthly net flows, by bisection -- robust where Newton is not. */
  const flows = series.map(p => p.in - p.out);
  const npv = rate => flows.reduce((a,f,i)=>a + f/Math.pow(1+rate, i), 0);
  let irr = null;
  if (npv(0) > 0){
    let lo = 0, hi = 1;
    while (npv(hi) > 0 && hi < 10) hi *= 2;
    if (npv(hi) <= 0){
      for (let i = 0; i < 200; i++){
        const mid = (lo + hi) / 2;
        if (npv(mid) > 0) lo = mid; else hi = mid;
      }
      irr = Math.pow(1 + (lo+hi)/2, 12) - 1;
    }
  }

  return { series, peak:-peak, peakAt, payback, interest, irr,
           months:N, pre, bld, done, saleStart, saleLen, ph, r,
           profit: series[series.length-1].bal };
}
