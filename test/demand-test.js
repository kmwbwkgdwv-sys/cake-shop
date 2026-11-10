// 値段を少し上げても、急に売れなくならない（なだらかに減る）
global.window = global; ['data', 'sim', 'plan', 'kitchen'].forEach((f) => require('../js/' + f + '.js'));
const { sim, kitchen: K, data: D, plan: P } = CS; const R = D.RULES;
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
function run(f, q, n) {
  let now = 1000; const S = sim.newState({}); sim.normalize(S); sim.apply(S, { t: 'start' }, now); sim.apply(S, { t: 'open' }, now);
  for (const r in S.menu) S.menu[r].on = r === 'short';
  const mk = sim.cakeMarket(S, 'short'); S.menu.short.price = Math.round((mk * f) / 10) * 10;
  P.slots(S, P.list(S, 'scase')[0]).forEach((sl) => K.add(S, { t: 'tray', r: 'short', q, p: 6, n: 6, c: 900, d: 1, o: 0, df: [], at: sl }));
  let bought = 0;
  for (let k = 0; k < n; k++) { S.rep = 2.8; K.spawn(S, now); now += 8000; K.tickCustomers(S, now); for (const id in S.cust) { const c = S.cust[id]; if (c.st === 'q') { if (Object.keys(c.ord || {}).length) bought++; delete S.cust[id]; } else if (c.st === 'out') delete S.cust[id]; } }
  return { rate: bought / n, est: sim.demandEstimate(S, 'short', S.menu.short.price, q), S };
}
const N = 600, rows = {};
for (const q of [0.6, 0.8]) {
  rows[q] = [0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 1.9].map((f) => ({ f, ...run(f, q, N) }));
  console.log('quality ' + q + ': ' + rows[q].map((x) => 'x' + x.f + ' ' + Math.round(x.rate * 100) + '%(予想' + Math.round(x.est * 100) + '%)').join('  '));
}
const at = (q, f) => rows[q].find((x) => x.f === f).rate;
ok(at(0.6, 1.0) >= 0.45 && at(0.8, 1.0) >= 0.55, 'at the market price, about half or more buy even with so-so cakes');
ok(at(0.6, 1.1) >= 0.35 && at(0.6, 1.2) >= 0.28, 'raising the price 10–20% does not stop sales (so-so cakes: ' + Math.round(at(0.6, 1.1) * 100) + '% / ' + Math.round(at(0.6, 1.2) * 100) + '%)');
ok(at(0.8, 1.2) >= 0.38, 'good cakes at +20%: ' + Math.round(at(0.8, 1.2) * 100) + '%');
ok(rows[0.6].every((x, i, a) => !i || x.rate <= a[i - 1].rate + 0.06) && at(0.6, 0.9) > at(0.6, 1.5), 'higher price → fewer buyers, step by step');
ok(at(0.6, 1.9) === 0 && at(0.8, 1.9) === 0, 'over ' + R.PRICE_MAX + '× the market nobody buys');
ok(rows[0.8].every((x) => Math.abs(x.rate - x.est) < 0.15), 'the menu screen estimate matches what happens');
console.log(fail ? fail + ' FAILED' : 'ALL OK');
