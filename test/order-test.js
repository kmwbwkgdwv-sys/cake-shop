// 注文のしかた：販売中の商品から好きな数／商品棚に無ければ作るまで待つ（遅すぎると帰る）／無効の商品は注文されない／賞味期限2日
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data, R = D.RULES;
let now = 1000, fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const S = sim.newState({}); S.funds = 100000; S.xp = 2000; sim.normalize(S); S.rep = 4.2;
const A = (a) => sim.apply(S, Object.assign({ pid: 'p1' }, a), now);
A({ t: 'start' });
console.log('known', Object.keys(S.known).join(','), 'menu on', Object.keys(S.menu).filter((r) => S.menu[r].on).join(','));
// 無効にした商品は注文されない
A({ t: 'menuOn', r: 'chocolate', on: false });
A({ t: 'sign' });
const orders = {}; let total = 0, maxN = 0;
for (let k = 0; k < 400; k++) {
  K.spawn(S, now); now += R.WALK_MS + 100; K.tickCustomers(S, now);
  for (const id in S.cust) { const c = S.cust[id]; if (c.st === 'q') { for (const r in c.ord) { orders[r] = (orders[r] || 0) + c.ord[r]; total += c.ord[r]; } maxN = Math.max(maxN, Object.values(c.ord).reduce((a, b) => a + b, 0)); } delete S.cust[id]; }
}
console.log('ordered (showcase empty)', JSON.stringify(orders), 'max per customer', maxN);
ok(!orders.chocolate, 'disabled item never ordered');
ok(total > 200 && Object.keys(orders).length >= 2, 'customers order from the menu even when the shelf is empty');
ok(maxN <= R.ORDER_MAX && maxN >= 3, 'customers choose any count (max ' + maxN + ')');
// 商品棚に無い物の注文 → 作るまで待ってくれる（長め）→ 作って渡せる
for (const r in S.menu) A({ t: 'menuOn', r, on: r === 'short' });
S.cust = {}; S.k.ordNo = 0;
K.spawn(S, now); const cid = Object.keys(S.cust)[0]; now += R.WALK_MS + 100; K.tickCustomers(S, now);
const c = S.cust[cid]; console.log('cust', c.st, JSON.stringify(c.ord));
A({ t: 'takeOrder', c: cid });
ok(c.st === 'w' && c.make === 1 && c.pw - now >= R.MAKE_MS, 'not on shelf → make-to-order, waits ' + Math.round((c.pw - now) / 1000) + 's: ' + S.fx[S.fx.length - 1].x);
now += 120000; sim.tick(S, now); ok(c.st === 'w', 'still waiting after 2 minutes');
S.showcase[0] = { r: 'short', q: 0.9, p: 6, n: 6, c: 900, d: S.day, o: 0, df: [] };
A({ t: 'newBox' }); for (let n = 0; n < c.ord.short; n++) A({ t: 'slice', ci: 0 });
const sales0 = S.today.sales; A({ t: 'serve', c: cid }); ok(S.today.sales > sales0, 'served the freshly made cake: "' + c.say + '"');
// 在庫がある物 → ふつうの待ち時間
K.spawn(S, now); const c2id = Object.keys(S.cust).find((id) => S.cust[id].st === 'in'); now += R.WALK_MS + 100; K.tickCustomers(S, now);
if (S.cust[c2id].st === 'q') { A({ t: 'takeOrder', c: c2id }); const c2 = S.cust[c2id]; ok(!c2.make && c2.pw - now < R.MAKE_MS, 'in stock → normal wait ' + Math.round((c2.pw - now) / 1000) + 's'); }
// 遅すぎると帰る
S.showcase[0] = 0;
K.spawn(S, now); const c3id = Object.keys(S.cust).find((id) => S.cust[id].st === 'in'); now += R.WALK_MS + 100; K.tickCustomers(S, now);
A({ t: 'takeOrder', c: c3id }); const slow0 = S.today.slow || 0;
now += R.MAKE_MS + R.WAIT_MS + 60000; sim.tick(S, now);
ok(S.cust[c3id] && S.cust[c3id].st === 'out' && S.today.slow >= slow0 + 1, 'too slow → customer leaves: "' + (S.cust[c3id] || {}).say + '"');
// 賞味期限：作った日を入れて2日。3日目には消える
A({ t: 'sign' }); S.cust = {};
S.showcase[1] = { r: 'short', q: 0.9, p: 4, n: 6, c: 900, d: S.day, o: 0, df: [] };
console.log('exp text day', S.day, sim.cakeExpText(S, S.day));
A({ t: 'endDay' }); A({ t: 'next' });
ok(S.showcase[1] && S.showcase[1].p === 4, 'day 2: still on the shelf (' + sim.cakeExpText(S, S.showcase[1].d) + ')');
A({ t: 'sign' }); now += 3000; sim.tick(S, now); A({ t: 'sign' }); S.cust = {};
A({ t: 'endDay' });
ok(!S.showcase[1] && S.history[S.history.length - 1].exp === 4, 'day 2 night: expired cake removed (' + S.history[S.history.length - 1].exp + ' pieces)');
console.log(fail ? fail + ' FAILED' : 'ALL OK');
