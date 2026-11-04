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
['oven', 'mixer', 'deco'].forEach((k) => { const r = A({ t: 'fbuy', k }); const f = S.fu[r.id]; ok(r.ok && f && !P.valid(S, r.id, f.k, f.x, f.z, f.r), 'bought ' + k + ' at ' + (f && [f.x, f.z, f.r].join(','))); });
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
const r0 = A({ t: 'order', items: ['egg', 'sugar', 'flour', 'butter', 'cream', 'strawberry', 'box'] }); ok(r0.ok, 'order with boxes: ' + r0.msg);
tick(9500);
const crate = (ing) => findIt((i) => i.t === 'crate' && i.ing === ing);
// 卵 → 冷蔵棚の1枠目、小麦粉 → 冷蔵棚の同じ枠はダメ（卵専用になっている）→ 棚へ
A({ t: 'pick', id: crate('egg') }); A({ t: 'openCrate' }); A({ t: 'shelve', slot: slot('cshelf', 0), all: 1 }); A({ t: 'trash' });
A({ t: 'pick', id: crate('flour') }); A({ t: 'openCrate' });
ok(!A({ t: 'shelve', slot: slot('cshelf', 0), quiet: 1 }).ok, 'a slot with eggs only accepts eggs');
A({ t: 'shelve', slot: slot('shelf', 1), all: 1 }); A({ t: 'trash' });
const putCrate = (ing, sl) => { A({ t: 'pick', id: crate(ing) }); A({ t: 'openCrate' }); A({ t: 'shelve', slot: sl, all: 1 }); A({ t: 'trash' }); };
putCrate('sugar', slot('shelf', 3)); putCrate('butter', slot('cshelf', 1)); putCrate('cream', slot('cshelf', 2)); putCrate('strawberry', slot('cshelf', 3)); putCrate('box', slot('shelf', 4));
console.log('inv', ['egg', 'flour', 'sugar', 'butter', 'cream', 'strawberry', 'box'].map((k) => k + ':' + K.invCount(S, k)).join(' '));
ok(K.invCount(S, 'egg') === 10 && K.invCount(S, 'box') === 10, 'shelved into the chosen slots');
// ---- 材料を手に取ってミキサーへ（余りは棚に戻せる）----
const stackAt = (sl) => K.inSlot(S, sl)[0];
const mixer = furn('mixer');
for (let k = 0; k < 3; k++) A({ t: 'take', id: stackAt(slot('cshelf', 0)) });
ok(held() && held().t === 'ing' && held().n === 3, 'took 3 eggs one by one');
for (let k = 0; k < 3; k++) A({ t: 'addIng', fid: mixer });
ok(!held(), 'eggs went into the bowl');
const fill = (sl, n) => { A({ t: 'take', id: stackAt(sl), all: 1 }); for (let k = 0; k < n; k++) A({ t: 'addIng', fid: mixer }); if (held()) A({ t: 'put', slot: sl }); };
fill(slot('shelf', 3), 2); fill(slot('shelf', 1), 2); fill(slot('cshelf', 1), 1);
ok(K.invCount(S, 'sugar') === 8 && K.invCount(S, 'flour') === 8, 'left-overs went back to the shelf (sugar ' + K.invCount(S, 'sugar') + ')');
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
// 商品棚に置く → 切って並べる
A({ t: 'pick', id: cake }); A({ t: 'put', slot: slot('pcase', 0) });
const tray = K.at(S, slot('pcase', 0)); ok(S.k.items[tray].t === 'tray' && S.k.items[tray].p === 6, 'cut into 6 on the product shelf');
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
for (let k = 0; k < C3.ord.short; k++) A({ t: 'slice', id: K.at(S, slot('pcase', 0)) || tray });
ok(!A({ t: 'serve', c: c1 === c3 ? 'x' : 'nobody', quiet: 1 }).ok, '');
A({ t: 'serve', c: c3 }); A({ t: 'pay', c: c3 }); ok(C3.st === 'eat', 'eating at the table');
tick(R.SIT_MS + 5000); const atSeat = K.at(S, 'seat:' + 0);
ok(atSeat === plate && S.k.items[plate].dirty, 'dirty plate left on the table');
A({ t: 'pick', id: plate }); ok(!A({ t: 'slice', id: K.at(S, slot('pcase', 0)), quiet: 1 }).ok, 'cannot serve on a dirty plate');
// 落とすと割れる
A({ t: 'drop' }); ok(!S.k.items[plate] && S.today.broken === 1, 'dropped plate breaks');
const f2 = S.funds; A({ t: 'tbuy', k: 'plate' }); ok(S.funds === f2 - P.TOOLS.plate.price && Object.values(S.k.items).some((i) => i.t === 'plate'), 'bought one plate');
// ---- 閉店：商品棚のケーキは残る。期限は2日 ----
A({ t: 'sign' }); A({ t: 'endDay' });
ok(S.k.items[tray] && S.k.items[tray].t === 'tray', 'tray stays in the cold product shelf overnight');
A({ t: 'next' }); A({ t: 'sign' }); tick(2000); A({ t: 'sign' }); A({ t: 'endDay' });
ok(!S.k.items[tray], 'expired after 2 days');
console.log('history', JSON.stringify(S.history[S.history.length - 1]).slice(0, 200));
console.log('JSON size', JSON.stringify(S).length);
console.log(fail ? fail + ' FAILED' : 'ALL OK');
