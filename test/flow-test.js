// 新しい厨房（家具の自由配置・棚の自由収納・洗い物・お会計）を最初から最後まで
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/plan.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data, P = CS.plan, R = D.RULES;
let now = 1000, fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const S = sim.newState({});
const A = (a, pid) => { const r = sim.apply(S, Object.assign({ pid: pid || 'p1' }, a), now); if (!r.ok && !a.quiet) console.log('  NG', a.t, r.msg); return r; };
const tick = (ms, step) => { for (let t = 0; t < ms; t += step || 500) { now += step || 500; sim.tick(S, now); } };
const held = (pid) => { const id = K.held(S, pid || 'p1'); return id ? S.k.items[id] : null; };
const furn = (k) => P.list(S, k)[0];
const slot = (k, i) => 'f:' + furn(k) + ':' + (i || 0);
const findIt = (f) => Object.keys(S.k.items).find((id) => f(S.k.items[id]));
// ---- 最初の状態 ----
const kinds = Object.values(S.fu).map((f) => f.k).sort();
console.log('furniture', kinds.join(','));
ok(JSON.stringify(kinds) === JSON.stringify(P.START.slice().sort()), 'start kit = 机・棚・クリーム台・商品棚・洗い場・冷蔵棚・冷蔵庫・レジ・ゴミ箱');
ok(Object.keys(S.fu).every((id) => !P.valid(S, id, S.fu[id].k, S.fu[id].x, S.fu[id].z, S.fu[id].r)), 'start layout is valid: ' + Object.keys(S.fu).map((id) => P.valid(S, id, S.fu[id].k, S.fu[id].x, S.fu[id].z, S.fu[id].r)).filter((x) => x).join('/'));
ok(Object.keys(D.ING).every((k) => K.invCount(S, k) === 0), 'no ingredients at start');
ok(Object.values(S.k.items).filter((i) => i.t === 'pan').length === 1 && Object.values(S.k.items).filter((i) => i.t === 'plate').length === 1, 'one cake pan and one plate');
console.log('funds', S.funds);
A({ t: 'start' });
// ---- オーブン・ミキサー・デコ台を買う ----
// 家具はトラックで大きな段ボールとして届く → 持って、置きたい床で展開する
['oven', 'mixer', 'deco'].forEach((k) => { const r = A({ t: 'fbuy', k }); ok(r.ok && P.count(S, k) === 0, 'bought ' + k + ' (not placed yet)'); });
const big = () => Object.keys(S.k.items).filter((id) => S.k.items[id].t === 'fcrate');
ok(big().length === 3 && big().every((id) => String(S.k.items[id].at).startsWith('dl:')), 'three big crates are on the truck');
// 材料の注文も、まだ来ていないトラックに一緒に積まれる
const r0 = A({ t: 'order', items: ['egg', 'sugar', 'flour', 'butter', 'cream', 'strawberry', 'box'] }); ok(r0.ok, 'order rides on the same truck: ' + r0.msg);
ok(!A({ t: 'pick', id: big()[0], quiet: 1 }).ok, 'cannot take before the truck arrives');
tick(9500);
const g0 = P.geomOf(S);
const spots = { oven: [g0.pc.x1 + 3.6, -g0.RZ + 0.5, 0], mixer: [g0.pc.x1 + 5.0, -g0.RZ + 0.4, 0], deco: [g0.pc.x1 + 2.4, -g0.RZ + 3.5, 0] };
big().forEach((id) => {
  const k = S.k.items[id].k;
  A({ t: 'pick', id });
  ok(!A({ t: 'put', slot: slot('table', 0), quiet: 1 }).ok && !A({ t: 'trash', quiet: 1 }).ok, k + ': big crate cannot go on a table or in the trash');
  ok(!A({ t: 'unpack', x: S.fu[furn('fridge')].x, z: S.fu[furn('fridge')].z, r: 0, quiet: 1 }).ok, k + ': cannot unpack on top of the fridge');
  const f0 = P.findSpot(S, k, [spots[k][0], spots[k][1]]); const r = A({ t: 'unpack', x: f0.x, z: f0.z, r: f0.r });
  const f = S.fu[r.id]; ok(r.ok && f && f.k === k && !K.held(S, 'p1'), 'unpacked ' + k + ' at ' + (f && [f.x, f.z, f.r].join(',')));
});
console.log('funds after furniture', S.funds);
// 家具を動かす（壁・ドア・ほかの家具は不可）
const tb = furn('table'); const t0 = Object.assign({}, S.fu[tb]);
ok(!A({ t: 'fmove', id: tb, x: t0.x + 1, z: t0.z, r: 1 }).ok === false, 'move table');
ok(!A({ t: 'fmove', id: tb, x: S.fu[furn('fridge')].x, z: S.fu[furn('fridge')].z, r: 0, quiet: 1 }).ok, 'cannot overlap fridge');
const g = P.geomOf(S);
ok(!A({ t: 'fmove', id: tb, x: g.pc.door, z: g.pc.z1 + 0.5, r: 0, quiet: 1 }).ok, 'cannot block the PC room door');
ok(!A({ t: 'fmove', id: tb, x: (g.pc.x0 + g.pc.x1) / 2, z: g.pc.z0 + 1.5, r: 0, quiet: 1 }).ok, 'cannot put furniture in the PC room');
A({ t: 'fmove', id: tb, x: t0.x, z: t0.z, r: 0 });
// ---- 仕入れ（材料と箱）----
const crate = (ing) => findIt((i) => i.t === 'crate' && i.ing === ing);
// 段ボールは棚・冷蔵棚に直接は入れられない（机・床はOK）。開けたら閉じられる
A({ t: 'pick', id: crate('egg') });
ok(!A({ t: 'put', slot: slot('cshelf', 5), quiet: 1 }).ok && !A({ t: 'put', slot: slot('shelf', 5), quiet: 1 }).ok, 'a crate cannot go into a shelf or cold shelf');
A({ t: 'openCrate' }); ok(held().open === 1 && A({ t: 'openCrate', close: 1 }).ok && !held().open, 'opened and closed the crate again');
const gf = P.geomOf(S);
ok(!A({ t: 'floor', x: gf.store.x1, z: -gf.RZ + 1, r: 0, quiet: 1 }).ok, 'cannot put a crate into a wall');
const fsp = P.floorSpot(S, held(), [gf.store.x0 + 2, gf.store.z0 + 2.5]);
ok(A({ t: 'floor', x: fsp.x, z: fsp.z, r: fsp.r }).ok && S.k.items[crate('egg')].at === 'fl' && !held(), 'put the crate on the floor at ' + fsp.x + ',' + fsp.z);
ok(!A({ t: 'floor', x: fsp.x, z: fsp.z, r: fsp.r, quiet: 1 }).ok, 'nothing in hand');
A({ t: 'pick', id: crate('flour') }); ok(!A({ t: 'floor', x: fsp.x, z: fsp.z, r: fsp.r, quiet: 1 }).ok, 'cannot stack crates on the floor'); A({ t: 'put', slot: slot('table', 1) }); ok(S.k.items[crate('flour')].at === slot('table', 1), 'a crate can go on a table');
ok(!A({ t: 'fmove', id: furn('table'), x: fsp.x, z: fsp.z, r: 0, quiet: 1 }).ok, 'furniture cannot be moved onto a floor crate');
A({ t: 'pick', id: crate('egg') }); ok(held() && held().ing === 'egg' && S.k.items[crate('egg')].fx == null, 'picked the crate up from the floor');
// 卵 → 冷蔵棚の1枠目、小麦粉 → 冷蔵棚の同じ枠はダメ（卵専用になっている）→ 棚へ
A({ t: 'openCrate' }); A({ t: 'shelve', slot: slot('cshelf', 0), all: 1 });
ok(!held().n && A({ t: 'floor', x: fsp.x, z: fsp.z, r: fsp.r }).ok, 'the empty crate can be left on the floor'); A({ t: 'pick', id: findIt((i) => i.t === 'crate' && i.at === 'fl') }); A({ t: 'trash' });
A({ t: 'pick', id: crate('flour') }); A({ t: 'openCrate' });
ok(!A({ t: 'shelve', slot: slot('cshelf', 0), quiet: 1 }).ok, 'a slot with eggs only accepts eggs');
A({ t: 'shelve', slot: slot('shelf', 1), all: 1 }); A({ t: 'trash' });
const putCrate = (ing, sl) => { A({ t: 'pick', id: crate(ing) }); A({ t: 'openCrate' }); A({ t: 'shelve', slot: sl, all: 1 }); A({ t: 'trash' }); };
putCrate('sugar', slot('shelf', 3)); putCrate('butter', slot('cshelf', 1)); putCrate('cream', slot('cshelf', 2)); putCrate('strawberry', slot('cshelf', 3)); putCrate('box', slot('shelf', 4));
console.log('inv', ['egg', 'flour', 'sugar', 'butter', 'cream', 'strawberry', 'box'].map((k) => k + ':' + K.invCount(S, k)).join(' '));
ok(K.invCount(S, 'egg') === 10 && K.invCount(S, 'box') === 10, 'shelved into the chosen slots');
// 1枠に置けるのは10個まで（手に持てるのも10個まで）
K.add(S, { t: 'crate', ing: 'sugar', n: 10, u: 40, open: 1, at: 'h:p1', pl: now });
const r10 = A({ t: 'shelve', slot: slot('shelf', 3), all: 1 }); ok(K.inSlot(S, slot('shelf', 3)).map((id) => S.k.items[id].n)[0] === 10 && held().n === 10, 'a full slot (10) takes no more: ' + r10.msg);
A({ t: 'shelve', slot: slot('shelf', 5), all: 1 }); ok(K.inSlot(S, slot('shelf', 5)).map((id) => S.k.items[id].n)[0] === 10 && !held().n, 'the rest goes into another slot');
A({ t: 'trash' });
const sg = K.inSlot(S, slot('shelf', 5))[0]; for (let k = 0; k < 12; k++) A({ t: 'take', id: sg, quiet: 1 });
ok(held().n === 10 && !S.k.items[sg], 'can hold up to 10'); A({ t: 'put', slot: slot('shelf', 5) });
// ---- 材料を手に取ってミキサーへ（余りは棚に戻せる）----
const stackAt = (sl) => K.inSlot(S, sl)[0];
const mixer = furn('mixer');
for (let k = 0; k < 3; k++) A({ t: 'take', id: stackAt(slot('cshelf', 0)) });
ok(held() && held().t === 'ing' && held().n === 3, 'took 3 eggs one by one');
for (let k = 0; k < 3; k++) A({ t: 'addIng', fid: mixer });
ok(!held(), 'eggs went into the bowl');
const fill = (sl, n) => { A({ t: 'take', id: stackAt(sl), all: 1 }); for (let k = 0; k < n; k++) A({ t: 'addIng', fid: mixer }); if (held()) A({ t: 'put', slot: sl }); };
fill(slot('shelf', 3), 2); fill(slot('shelf', 1), 2); fill(slot('cshelf', 1), 1);
ok(K.invCount(S, 'sugar') === 18 && K.invCount(S, 'flour') === 8, 'left-overs went back to the shelf (sugar ' + K.invCount(S, 'sugar') + ')');
A({ t: 'run', fid: mixer }); now += 6500 * K.gauge(S, 'mix').sec / 6.5; console.log('mix:', A({ t: 'run', fid: mixer }).msg);
// 型（棚）を持って流す → オーブン
const pan = findIt((i) => i.t === 'pan'); A({ t: 'pick', id: pan }); A({ t: 'pour', fid: mixer });
ok(held() && held().st === 'raw', 'poured into the cake pan');
const oven = furn('oven'); A({ t: 'oven', fid: oven, op: 'set', temp: 170 }); tick(10000); A({ t: 'put', slot: 'f:' + oven + ':0' });
const it = S.k.items[pan]; tick(it.bk.dur, 250); A({ t: 'pick', id: pan }); console.log('baked', it.st, it.lab);
A({ t: 'put', slot: slot('table', 0) }); tick(40000);
// ---- クリーム ----
const whip = furn('whip');
A({ t: 'take', id: stackAt(slot('cshelf', 2)), all: 1 }); A({ t: 'addIng', fid: whip }); A({ t: 'addIng', fid: whip }); A({ t: 'put', slot: slot('cshelf', 2) });
A({ t: 'take', id: stackAt(slot('shelf', 3)) }); A({ t: 'addIng', fid: whip });
A({ t: 'run', fid: whip }); now += K.gauge(S, 'whip').sec * 1000; console.log('whip:', A({ t: 'run', fid: whip }).msg);
A({ t: 'scoop', fid: whip }); A({ t: 'put', slot: slot('fridge', 0) });
// ---- デコ：型から外すと、空の型は汚れて手に残る ----
const deco = furn('deco');
A({ t: 'pick', id: pan }); A({ t: 'put', slot: 'f:' + deco + ':0' });
ok(held() && held().t === 'pan' && held().dirty && held().st === 'empty', 'after depanning the dirty pan stays in hand');
// 洗い場：流しに入れる → 泡立て（足りないとダメ）→ 水で流す → 置いて30秒で乾く
const sink = furn('sink'); A({ t: 'put', slot: 'f:' + sink + ':0' });
A({ t: 'washStart', fid: sink }); ok(!A({ t: 'wash', fid: sink, q: 0.2, quiet: 1 }).ok, 'not enough scrubbing → still dirty');
A({ t: 'washStart', fid: sink }); A({ t: 'wash', fid: sink, q: 0.9 });
ok(!S.k.items[pan].dirty && S.k.items[pan].wet, 'washed → clean but wet');
A({ t: 'pick', id: pan }); tick(40000); ok(S.k.items[pan].wet, 'does not dry while held');
A({ t: 'put', slot: 'f:' + sink + ':1' }); tick(25000); ok(S.k.items[pan].wet, 'still wet 25s after placing'); tick(6000); ok(!S.k.items[pan].wet, 'dry 30s after placing');
A({ t: 'pick', id: pan }); A({ t: 'put', slot: slot('shelf', 0) });
// クリームを塗る → いちごを手に取って置く（まちがえたら戻せる）→ 仕上げ
const cr = findIt((i) => i.t === 'cream'); A({ t: 'pick', id: cr }); A({ t: 'run', fid: deco }); A({ t: 'spreadDone', fid: deco, q: 0.9 }); A({ t: 'put', slot: slot('table', 1) });
A({ t: 'take', id: stackAt(slot('cshelf', 3)), all: 1 }); const nS = held().n;
for (let k = 0; k < 4; k++) { const a = (k / 3) * Math.PI * 2; A({ t: 'topPlace', fid: deco, x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55 }); }
ok(!A({ t: 'finish', fid: deco, quiet: 1 }).ok, '4 strawberries → wrong recipe');
A({ t: 'topTake', fid: deco }); ok(held().n === nS - 3, 'took one strawberry back into the hand');
A({ t: 'put', slot: slot('cshelf', 3) }); ok(!held() && K.invCount(S, 'strawberry') === 7, 'and put the rest back on the cold shelf');
A({ t: 'finish', fid: deco });
const cake = K.at(S, 'f:' + deco + ':0'); ok(S.k.items[cake].t === 'cake', 'cake finished');
ok(S.k.items[cake].w === 1, 'finished cake is a whole (uncut) cake');
// ショーケースに置く → ホールのまま並ぶ → ケーキナイフで6等分
A({ t: 'pick', id: cake }); A({ t: 'put', slot: slot('scase', 0) });
const tray = K.at(S, slot('scase', 0)); ok(S.k.items[tray].t === 'tray' && S.k.items[tray].w === 1, 'whole cake displayed uncut in the showcase');
const knife = findIt((i) => i.t === 'knife'); ok(knife && String(S.k.items[knife].at).startsWith('f:'), 'one cake knife in the start kit: ' + (knife && S.k.items[knife].at));
ok(!A({ t: 'cut', id: tray, quiet: 1 }).ok, 'cannot cut without the knife');
A({ t: 'take', id: stackAt(slot('shelf', 4)) }); ok(!A({ t: 'slice', id: tray, quiet: 1 }).ok, 'cannot take a slice from an uncut cake'); A({ t: 'put', slot: slot('shelf', 4) });
A({ t: 'pick', id: knife }); ok(A({ t: 'cut', id: tray }).ok && !S.k.items[tray].w && S.k.items[tray].p === 6, 'cut into 6 with the knife (in the showcase)');
ok(!A({ t: 'cut', id: tray, quiet: 1 }).ok, 'already cut');
A({ t: 'put', slot: slot('table', 3) }); ok(!held(), 'knife back on the table');
D.CUSTOMERS.forEach((c) => { c._h = c.hole; c.hole = 0; });
// ---- 接客：持ち帰り（箱）→ レジで現金のお会計 ----
for (const r in S.menu) A({ t: 'menuOn', r, on: r === 'short' });
A({ t: 'sign' });
const reg = furn('reg');
const custFor = (dine, pm) => { for (let k = 0; k < 60; k++) { K.spawn(S, now); const id = Object.keys(S.cust).find((x) => S.cust[x].st === 'in'); now += R.WALK_MS + 50; K.tickCustomers(S, now); const c = S.cust[id]; if (c && c.st === 'q' && c.dine === dine && c.pm === pm && Object.values(c.ord).reduce((a, b) => a + b, 0) <= 2) { Object.keys(S.cust).forEach((x) => { if (x !== id) delete S.cust[x]; }); return id; } delete S.cust[id]; } return null; };
const c1 = custFor(0, 'cash'); const C1 = S.cust[c1]; console.log('cust', JSON.stringify(C1.ord), 'dine', C1.dine, C1.pm);
A({ t: 'takeOrder', c: c1 });
A({ t: 'take', id: stackAt(slot('shelf', 4)) }); ok(held() && held().t === 'box', 'took an empty box from the box stack');
for (let k = 0; k < C1.ord.short; k++) A({ t: 'slice', id: tray });
A({ t: 'serve', c: c1 }); ok(C1.st === 'pay' && C1.pm === 'cash' && C1.tend >= C1.due, 'handed the box → pay at the register (cash ¥' + C1.tend + ' for ¥' + C1.due + ')');
const need = K.change(C1);
if (need > 0) ok(!A({ t: 'pay', c: c1, ch: need - 10, quiet: 1 }).ok, 'cannot return less change than ¥' + need);
const f0 = S.funds; A({ t: 'pay', c: c1, ch: need });
ok(S.funds === f0 + C1.paid && C1.st === 'out', 'paid ¥' + C1.paid + ' with ¥' + need + ' change');
// カード
const c2 = custFor(0, 'card'); const C2 = S.cust[c2]; A({ t: 'takeOrder', c: c2 }); A({ t: 'take', id: stackAt(slot('shelf', 4)) }); for (let k = 0; k < C2.ord.short; k++) A({ t: 'slice', id: tray }); A({ t: 'serve', c: c2 });
const f1 = S.funds; A({ t: 'pay', c: c2 }); ok(S.funds > f1 && C2.st === 'out', 'card: just touch');
// ---- 店内（お皿）→ 食べ終わると汚れたお皿が席に残る ----
S.furn.table = 1;
const c3 = custFor(1, 'card'); const C3 = S.cust[c3]; ok(C3 && C3.dine && C3.seat >= 0, 'eat-in customer with a seat');
A({ t: 'takeOrder', c: c3 });
const plate = findIt((i) => i.t === 'plate'); A({ t: 'pick', id: plate });
for (let k = 0; k < C3.ord.short; k++) A({ t: 'slice', id: K.at(S, slot('scase', 0)) || tray });
ok(!A({ t: 'serve', c: c1 === c3 ? 'x' : 'nobody', quiet: 1 }).ok, '');
A({ t: 'serve', c: c3 }); A({ t: 'pay', c: c3 }); ok(C3.st === 'eat', 'eating at the table');
tick(R.SIT_MS + 5000); const atSeat = K.at(S, 'seat:' + 0);
ok(atSeat === plate && S.k.items[plate].dirty, 'dirty plate left on the table');
A({ t: 'pick', id: plate }); ok(!A({ t: 'slice', id: K.at(S, slot('scase', 0)), quiet: 1 }).ok, 'cannot serve on a dirty plate');
// 落とすと割れる
A({ t: 'drop' }); ok(!S.k.items[plate] && S.today.broken === 1, 'dropped plate breaks');
const f2 = S.funds; A({ t: 'tbuy', k: 'plate' }); ok(S.funds === f2 - P.TOOLS.plate.price && Object.values(S.k.items).some((i) => i.t === 'plate'), 'bought one plate');
// ---- 閉店：商品棚のケーキは残る。期限は2日 ----
A({ t: 'sign' }); A({ t: 'endDay' });
ok(S.k.items[tray] && S.k.items[tray].t === 'tray', 'tray stays in the cold product shelf overnight');
A({ t: 'next' }); A({ t: 'sign' }); tick(2000); A({ t: 'sign' }); A({ t: 'endDay' });
ok(!S.k.items[tray], 'expired after 2 days');
// ---- ホール売り：お祝いのお客さん → 切らずに箱へ → ホールの値段 ----
D.CUSTOMERS.forEach((c) => { c.hole = c._h; });
A({ t: 'next' }); const ck2 = K.add(S, { t: 'tray', r: 'short', q: 0.9, p: 6, n: 6, c: 900, d: S.day, df: [], w: 1, at: slot('scase', 1) });
 A({ t: 'sign' }); S.cust = {};
let hc = null; for (let k = 0; k < 200 && !hc; k++) { K.spawn(S, now); now += R.WALK_MS + 50; K.tickCustomers(S, now); hc = Object.keys(S.cust).find((x) => S.cust[x].st === 'q' && Object.keys(S.cust[x].wh || {}).length); Object.keys(S.cust).forEach((x) => { if (x !== hc) delete S.cust[x]; }); }
ok(hc && S.cust[hc].wh.short === 1 && !Object.keys(S.cust[hc].ord).length && !S.cust[hc].dine, 'a customer orders a whole cake (take-out): ' + (hc && S.cust[hc].ty));
A({ t: 'takeOrder', c: hc }); ok(K.ordText(S, S.cust[hc].ord, S.cust[hc].wh).includes('ホール'), 'order text says whole: ' + K.ordText(S, S.cust[hc].ord, S.cust[hc].wh));
A({ t: 'take', id: stackAt(slot('shelf', 4)) }); ok(A({ t: 'hole', id: ck2 }).ok && held().s.length === 1 && held().s[0][4] === 1 && !S.k.items[ck2], 'whole cake into an empty box');
ok(!A({ t: 'slice', id: ck2, quiet: 1 }).ok, 'box with a whole cake is full');
A({ t: 'serve', c: hc }); ok(S.cust[hc].st === 'pay' && S.cust[hc].due === S.menu.short.hp, 'whole price ¥' + S.cust[hc].due + ' (piece ¥' + S.menu.short.price + ', market whole ¥' + sim.holeMarket(S, 'short') + ')');
const so0 = S.today.sold; A({ t: 'pay', c: hc, ch: K.change(S.cust[hc]) }); ok(S.today.sold === so0 + 6 && S.today.hole === 1, 'counted as 6 pieces / 1 whole');
// ---- お皿の上でも切れる：お皿を机に置く → ケーキをのせる → 切る → 1切れずつ取ると最後にお皿が残る ----
const pl2 = findIt((i) => i.t === 'plate' && !i.dirty);
const ck3 = K.add(S, { t: 'cake', r: 'short', q: 0.9, p: 6, n: 6, c: 900, d: S.day, df: [], w: 1, at: slot('table', 0) });
A({ t: 'pick', id: pl2 }); A({ t: 'put', slot: slot('table', 1) }); A({ t: 'pick', id: ck3 }); ok(A({ t: 'put', slot: slot('table', 1) }).ok && S.k.items[ck3].dish === 1 && !S.k.items[pl2], 'cake put on a plate');
A({ t: 'pick', id: findIt((i) => i.t === 'knife') }); ok(A({ t: 'cut', id: ck3 }).ok, 'cut on the plate (on the table)'); A({ t: 'put', slot: slot('table', 3) });
A({ t: 'take', id: stackAt(slot('shelf', 4)) }); for (let k = 0; k < 6; k++) A({ t: 'slice', id: ck3 });
const left = K.at(S, slot('table', 1)); ok(held().s.length === 6 && left && S.k.items[left].t === 'plate' && S.k.items[left].dirty, 'took 6 slices; a dirty plate is left');
// ---- 在庫棚：段ボールのまま保管（2列×2段で4つまで）----
const clearHand = () => { for (const id of Object.keys(S.k.items)) if (S.k.items[id].at === 'h:p1') delete S.k.items[id]; };
clearHand();
const ck = K.placeNew(S, 'crack'); ok(ck && P.slots(S, ck).length === 4, 'crate rack has 4 places');
let n4 = 0; P.slots(S, ck).forEach((sl, i) => { K.add(S, { t: 'crate', ing: i % 2 ? 'sugar' : 'flour', n: 10, u: 40, ar: 0, open: i === 3 ? 1 : 0, at: 'h:p1', pl: now }); const r = A({ t: 'put', slot: sl }); if (r.ok) n4++; });
ok(n4 === 4 && P.slots(S, ck).every((sl) => K.inSlot(S, sl).length === 1) && !held(), 'four crates stored in the crate rack (2 columns x 2 levels)');
K.add(S, { t: 'crate', ing: 'sugar', n: 10, u: 40, ar: 0, at: 'h:p1', pl: now });
ok(!A({ t: 'put', slot: P.slots(S, ck)[0], quiet: 1 }).ok, 'a fifth crate does not fit');
ok(!A({ t: 'put', slot: slot('shelf', 0), quiet: 1 }).ok, 'still not into a normal shelf');
clearHand(); K.add(S, { t: 'plate', s: [], at: 'h:p1', pl: now });
ok(!A({ t: 'put', slot: P.slots(S, ck)[0], quiet: 1 }).ok, 'only crates go in the crate rack'); clearHand();
A({ t: 'pick', id: K.inSlot(S, P.slots(S, ck)[3])[0] }); ok(held() && held().t === 'crate' && held().open === 1, 'took a crate back out of the rack');
clearHand(); for (const sl of P.slots(S, ck)) for (const id of K.inSlot(S, sl)) delete S.k.items[id];
delete S.fu[ck];
// ---- 倉庫の拡張（店舗レベル2から）----
const sa = P.geomOf(S).store, area = (q) => (q.x1 - q.x0) * (q.z1 - q.z0), z1a = sa.z1; S.xp = 0;
ok(!A({ t: 'upgrade', id: 'storage', quiet: 1 }).ok, 'storage expansion is locked at Lv1');
S.xp = 200; S.funds += 30000; const fu0 = JSON.stringify(Object.keys(S.fu).sort());
ok(A({ t: 'upgrade', id: 'storage' }).ok && P.geomOf(S).store.z1 > z1a && P.geomOf(S).store.x0 < sa.x0 && P.geomOf(S).store.x1 === sa.x1, 'storage (annex) expanded: ' + area(sa).toFixed(1) + '㎡ → ' + area(P.geomOf(S).store).toFixed(1) + '㎡');
ok(Object.keys(S.fu).every((id) => !S.fu[id].bad && !P.valid(S, id, S.fu[id].k, S.fu[id].x, S.fu[id].z, S.fu[id].r)) && JSON.stringify(Object.keys(S.fu).sort()) === fu0, 'all furniture still valid after the storage expansion');
ok(!A({ t: 'upgrade', id: 'storage', quiet: 1 }).ok, 'the next storage step needs Lv4');
// ---- 追加のケーキナイフ ----
A({ t: 'put', slot: slot('shelf', 5) }); const f3 = S.funds; A({ t: 'tbuy', k: 'knife' });
ok(S.funds === f3 - P.TOOLS.knife.price && Object.values(S.k.items).filter((i) => i.t === 'knife').length === 2, 'bought another knife');
console.log('history', JSON.stringify(S.history[S.history.length - 1]).slice(0, 200));
console.log('JSON size', JSON.stringify(S).length);
console.log(fail ? fail + ' FAILED' : 'ALL OK');
