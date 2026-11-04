// 相場より高すぎるとクレームが入るか
global.window = global; require('../js/data.js'); require('../js/sim.js'); require('../js/kitchen.js');
const { sim, kitchen: K, data: D } = CS;
for (const f of [1.0, 1.2, 1.5]) {
  let now = 1000; const S = sim.newState('t', 'normal', now); sim.apply(S, { t: 'start' }, now); sim.apply(S, { t: 'open' }, now);
  const mk = sim.cakeMarket(S, 'short'); S.menu.short.price = Math.round(mk * f / 10) * 10;
  for (let i = 0; i < 4; i++) S.showcase[i] = { r: 'short', q: 0.85, p: 6, n: 6, c: 900, d: 1, o: 0, df: [] };
  let bought = 0;
  for (let k = 0; k < 40; k++) { K.spawn(S, now); now += 8000; K.tickCustomers(S, now); for (const id in S.cust) { const c = S.cust[id]; if (c.st === 'q') { bought++; delete S.cust[id]; } else if (c.st === 'out') delete S.cust[id]; } }
  console.log('price x' + f, 'market', mk, 'price', S.menu.short.price, 'bought', bought, '/40', 'price complaints', S.today.pcomp, 'rep', S.rep.toFixed(2), 'reviews', S.fx.filter((x) => x.k === 'review').length);
}
