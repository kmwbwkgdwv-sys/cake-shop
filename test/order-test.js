// 注文のしかた：販売中の商品から好きな数／持ち帰り・店内／商品棚に無ければ作るまで待つ（遅すぎると帰る）／無効の商品は注文されない／賞味期限2日／お会計
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/plan.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data, R = D.RULES, P = CS.plan;
let now = 1000, fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const S = sim.newState({}); S.funds = 100000; S.xp = 2000; sim.normalize(S); S.rep = 4.2;
const A = (a) => sim.apply(S, Object.assign({ pid: 'p1' }, a), now);
const sl = (k, n, i) => 'f:' + P.list(S, k)[i || 0] + ':' + n;
const stackOf = (ing) => Object.keys(S.k.items).find((id) => { const it = S.k.items[id]; return it.t === 'ing' && it.ing === ing && !String(it.at).startsWith('h:'); });
A({ t: 'start' });
const HOLE = D.CUSTOMERS.map((c) => c.hole); D.CUSTOMERS.forEach((c) => (c.hole = 0));
console.log('known', Object.keys(S.known).join(','), 'menu on', Object.keys(S.menu).filter((r) => S.menu[r].on).join(','));
// 無効にした商品は注文されない
A({ t: 'menuOn', r: 'chocolate', on: false });
S.furn.table = 2;
A({ t: 'sign' });
const orders = {}; let total = 0, maxN = 0, dine = 0, card = 0, n = 0;
for (let k = 0; k < 400; k++) {
  K.spawn(S, now); now += R.WALK_MS + 100; K.tickCustomers(S, now);
  for (const id in S.cust) { const c = S.cust[id]; if (c.st === 'q') { n++; if (c.dine) dine++; if (c.pm === 'card') card++; for (const r in c.ord) { orders[r] = (orders[r] || 0) + c.ord[r]; total += c.ord[r]; } maxN = Math.max(maxN, Object.values(c.ord).reduce((a, b) => a + b, 0)); } delete S.cust[id]; }
}
console.log('ordered (shelf empty)', JSON.stringify(orders), 'max per customer', maxN, 'dine', dine, '/', n, 'card', card);
ok(!orders.chocolate, 'disabled item never ordered');
ok(total > 200 && Object.keys(orders).length >= 2, 'customers order from the menu even when the shelf is empty');
ok(maxN <= R.ORDER_MAX && maxN >= 3, 'customers choose any count (max ' + maxN + ')');
ok(dine > n * 0.2 && dine < n * 0.7, 'some eat in, some take out (' + dine + '/' + n + ')');
ok(card > n * 0.25 && card < n * 0.7, 'card and cash both used (' + card + '/' + n + ')');
// 商品棚に無い物の注文 → 作るまで待ってくれる（長め）→ 作って箱で渡す → お会計
for (const r in S.menu) A({ t: 'menuOn', r, on: r === 'short' });
S.cust = {}; S.k.ordNo = 0; S.furn.table = 0;
let cid = null; for (let k = 0; k < 30 && !cid; k++) { S.cust = {}; K.spawn(S, now); const id = Object.keys(S.cust)[0]; now += R.WALK_MS + 100; K.tickCustomers(S, now); if (S.cust[id] && S.cust[id].st === 'q') cid = id; } // 値段しだいで買わずに帰る人もいるので、並んだ人で
const c = S.cust[cid]; console.log('cust', c.st, JSON.stringify(c.ord), c.pm);
A({ t: 'takeOrder', c: cid });
ok(c.st === 'w' && c.make === 1 && c.pw - now >= R.MAKE_MS, 'not on shelf → make-to-order, waits ' + Math.round((c.pw - now) / 1000) + 's: ' + S.fx[S.fx.length - 1].x);
now += 120000; sim.tick(S, now); ok(c.st === 'w', 'still waiting after 2 minutes');
K.add(S, { t: 'tray', r: 'short', q: 0.9, p: 6, n: 6, c: 900, d: S.day, o: 0, df: [], at: sl('scase', 0) });
K.invAdd(S, 'box', 5, 60);
const box = () => { A({ t: 'take', id: stackOf('box') }); for (let k = 0; k < Object.values(S.cust[cid2()].ord).reduce((a, b) => a + b, 0); k++) A({ t: 'slice', id: K.at(S, sl('scase', 0)) }); };
let cur = cid; const cid2 = () => cur;
box();
const sales0 = S.today.sales; const rs = A({ t: 'serve', c: cid });
ok(rs.ok && c.st === 'pay', 'served the box → customer goes to the register to pay: ' + rs.msg);
ok(S.today.sales === sales0, 'no sale until paid');
if (c.pm === 'cash') { const need = K.change(c); ok(need >= 0 && c.tend >= c.due, 'cash: due ' + c.due + ' tendered ' + c.tend + ' change ' + need); if (need > 0) ok(!A({ t: 'pay', c: cid, ch: need - 1 }).ok, 'too little change refused'); A({ t: 'pay', c: cid, ch: need }); }
else A({ t: 'pay', c: cid });
ok(S.today.sales > sales0 && c.paid > 0, 'paid ' + c.paid + ' "' + c.say + '"');
// 在庫がある物 → ふつうの待ち時間
let c2id = null; for (let k = 0; k < 30 && !c2id; k++) { K.spawn(S, now); const id = Object.keys(S.cust).find((x) => S.cust[x].st === 'in'); now += R.WALK_MS + 100; K.tickCustomers(S, now); if (S.cust[id] && S.cust[id].st === 'q') c2id = id; else delete S.cust[id]; }
if (S.cust[c2id].st === 'q') { S.cust[c2id].ord = { short: 1 }; S.cust[c2id].price = { short: S.menu.short.price }; A({ t: 'takeOrder', c: c2id }); const c2 = S.cust[c2id]; ok(!c2.make && c2.pw - now < R.MAKE_MS, 'in stock → normal wait ' + Math.round((c2.pw - now) / 1000) + 's'); }
// お会計をしないでいると、商品を置いて帰る
cur = c2id; box(); A({ t: 'serve', c: c2id });
const w0 = S.today.waste; now += R.PAY_MS + 1000; sim.tick(S, now);
ok(S.cust[c2id].st === 'out' && S.today.waste > w0, 'not paid in time → customer leaves the box (waste +' + (S.today.waste - w0) + ')');
// 遅すぎると帰る
const tr = K.at(S, sl('scase', 0)); if (tr) delete S.k.items[tr];
let c3id = null; for (let k = 0; k < 30 && !c3id; k++) { K.spawn(S, now); const id = Object.keys(S.cust).find((x) => S.cust[x].st === 'in'); now += R.WALK_MS + 100; K.tickCustomers(S, now); if (S.cust[id] && S.cust[id].st === 'q') c3id = id; else delete S.cust[id]; }
A({ t: 'takeOrder', c: c3id }); const slow0 = S.today.slow || 0;
now += R.MAKE_MS + R.WAIT_MS + 60000; sim.tick(S, now);
ok(S.cust[c3id] && S.cust[c3id].st === 'out' && S.today.slow >= slow0 + 1, 'too slow → customer leaves: "' + (S.cust[c3id] || {}).say + '"');
// 賞味期限：作った日を入れて2日。3日目には消える（冷蔵の商品棚なら翌日も売れる）
A({ t: 'sign' }); S.cust = {};
K.add(S, { t: 'tray', r: 'short', q: 0.9, p: 4, n: 6, c: 900, d: S.day, o: 0, df: [], at: sl('scase', 1) });
console.log('exp text day', S.day, sim.cakeExpText(S, S.day));
A({ t: 'endDay' }); A({ t: 'next' });
const t1 = S.k.items[K.at(S, sl('scase', 1))];
ok(t1 && t1.p === 4, 'day 2: still on the shelf (' + (t1 && sim.cakeExpText(S, t1.d)) + ')');
A({ t: 'sign' }); now += 3000; sim.tick(S, now); A({ t: 'sign' }); S.cust = {};
A({ t: 'endDay' });
ok(!K.at(S, sl('scase', 1)) && S.history[S.history.length - 1].exp === 4, 'day 2 night: expired cake removed (' + S.history[S.history.length - 1].exp + ' pieces)');
// ホールの注文：お祝い・家族が多い。値段が高すぎるとホールは買わない
D.CUSTOMERS.forEach((c, i) => (c.hole = HOLE[i]));
for (const r in S.menu) A({ t: 'menuOn', r, on: true });
A({ t: 'next' }); A({ t: 'sign' }); S.cust = {};
const holeBy = {}; let nh = 0, nq = 0;
const holeRun = (k0) => { let h = 0, q = 0; for (let k = 0; k < k0; k++) { K.spawn(S, now); now += R.WALK_MS + 100; K.tickCustomers(S, now); for (const id in S.cust) { const c = S.cust[id]; if (c.st === 'q') { q++; if (Object.keys(c.wh || {}).length) { h++; holeBy[c.ty] = (holeBy[c.ty] || 0) + 1; if (Object.keys(c.ord).length || c.dine) fail++; } } delete S.cust[id]; } } return [h, q]; };
[nh, nq] = holeRun(500);
console.log('whole orders', nh, '/', nq, JSON.stringify(holeBy));
ok(nh > nq * 0.06 && nh < nq * 0.35, 'some customers buy whole cakes (' + nh + '/' + nq + ')');
ok((holeBy.party || 0) > (holeBy.student || 0), 'party customers buy whole more than students');
const hp0 = S.menu.short.hp; for (const r in S.menu) if (S.menu[r].hp) A({ t: 'price', r, hp: sim.holeMarket(S, r) * 1.5 });
const [nh2, nq2] = holeRun(300);
ok(nh2 / nq2 < (nh / nq) * 0.65, 'whole price x1.5 → fewer whole orders (' + nh2 + '/' + nq2 + ' vs ' + nh + '/' + nq + ')');
for (const r in S.menu) if (S.menu[r].hp) A({ t: 'price', r, hp: sim.holeMarket(S, r) * 1.9 });
const [nh3, nq3] = holeRun(300);
ok(nh3 === 0, 'whole price x1.9 (over PRICE_MAX) → nobody buys whole (' + nh3 + '/' + nq3 + ')');
ok(A({ t: 'price', r: 'short', hp: hp0 }).ok && S.menu.short.hp === hp0 && !A({ t: 'price', r: 'butter_cookie', hp: 2000 }).ok, 'set whole price; cookies have no whole');
console.log(fail ? fail + ' FAILED' : 'ALL OK');
