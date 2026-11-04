// 鮮度：要冷蔵の物は常温で傷む／冷蔵棚・冷蔵庫・冷蔵の商品棚・荷台では傷まない／一晩の扱い
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/plan.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data, P = CS.plan;
let now = 1000;
const S = sim.newState({}); S.funds = 300000; sim.normalize(S);
const A = (a, pid) => { const r = sim.apply(S, Object.assign({ pid: pid || 'p1' }, a), now); if (!r.ok && !a.quiet) console.log('  NG', a.t, r.msg); return r; };
const tick = (ms, step) => { for (let t = 0; t < ms; t += step || 1000) { now += step || 1000; sim.tick(S, now); } };
const fxs = () => S.fx.slice(-3).map((f) => f.x).join(' / ');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const sl = (k, n, i) => 'f:' + P.list(S, k)[i || 0] + ':' + n;
const fid = (k, i) => P.list(S, k)[i || 0];
const held = () => S.k.items[K.held(S, 'p1')];
const stackOf = (ing, at) => Object.keys(S.k.items).find((id) => { const it = S.k.items[id]; return it.t === 'ing' && it.ing === ing && !String(it.at).startsWith('h:') && (!at || it.at === at); });
A({ t: 'start' });
['oven', 'mixer', 'deco', 'pcaseN'].forEach((k) => A({ t: 'fbuy', k }));
// 1) 段ボール：荷台の中では傷まない → 持ち出すと常温
A({ t: 'order', items: ['strawberry', 'strawberry', 'flour'] });
tick(9500);
const ids = Object.keys(S.k.items).filter((id) => S.k.items[id].t === 'crate');
const st = ids.find((id) => S.k.items[id].ing === 'strawberry'), st2 = ids.filter((id) => S.k.items[id].ing === 'strawberry')[1], fl = ids.find((id) => S.k.items[id].ing === 'flour');
tick(200000); ok(!(S.k.items[st].sp > 0), 'truck bed keeps crates cold (200s)');
A({ t: 'pick', id: st }); tick(30000);
ok(K.fresh(S, S.k.items[st], now).left < 95, 'held crate warms up (left ' + Math.round(K.fresh(S, S.k.items[st], now).left) + 's)');
tick(40000); ok(S.k.items[st].sp === 1, 'after 70s strawberry crate is warm: ' + fxs());
A({ t: 'openCrate' }); A({ t: 'shelve', slot: sl('cshelf', 0), all: 1 });
const lot = S.k.items[stackOf('strawberry', sl('cshelf', 0))].lots[0]; ok(lot && lot[1] - S.day < 2, 'warm crate shelved with shorter life (exp in ' + (lot && lot[1] - S.day) + ' days)');
A({ t: 'trash' });
// 2) 傷むまで放置 → 棚に置けない → 中身ごと捨てる（廃棄・件数）
A({ t: 'pick', id: st2 }); A({ t: 'put', slot: sl('table', 0) }); tick(125000);
ok(S.k.items[st2].sp === 2, 'crate left on the table spoiled: ' + fxs());
A({ t: 'pick', id: st2 }); A({ t: 'openCrate' }); const r2 = A({ t: 'shelve', slot: sl('shelf', 3), quiet: 1 });
ok(!r2.ok, 'spoiled crate cannot be shelved: ' + r2.msg);
const w0 = S.today.waste; const r3 = A({ t: 'trash' }); ok(r3.ok && S.today.waste > w0 && S.today.spoiled === 1, 'spoiled crate trashed: ' + r3.msg + ' waste +' + (S.today.waste - w0));
// 小麦粉（乾物）は傷まない
A({ t: 'pick', id: fl }); tick(400000); ok(!S.k.items[fl].sp, 'flour crate never spoils');
A({ t: 'openCrate' }); A({ t: 'shelve', slot: sl('shelf', 4), all: 1 }); A({ t: 'trash' });
// 3) 材料の山：冷蔵棚の中は傷まない／常温の棚では傷む（ぬるい → 傷む）
K.invAdd(S, 'egg', 12, 35); const eggCold = stackOf('egg');
ok(P.isCold(S, S.k.items[eggCold].at), 'eggs auto-placed into the cold shelf');
tick(500000); ok(!(S.k.items[eggCold].sp > 0), 'eggs in the cold shelf stay fresh (500s)');
for (let k = 0; k < 4; k++) A({ t: 'take', id: stackOf('egg') });
ok(held().n === 4, 'took 4 eggs one by one (hand: ' + held().n + ')');
A({ t: 'put', slot: sl('shelf', 5) });
const eggWarm = stackOf('egg', sl('shelf', 5));
tick(D.ING.egg.warm * 1000 + 5000); ok(S.k.items[eggWarm].sp === 2, 'eggs left on a room-temp shelf spoiled: ' + fxs());
ok(K.invCount(S, 'egg') === 8, 'spoiled eggs do not count as stock (' + K.invCount(S, 'egg') + ')');
A({ t: 'take', id: eggWarm, all: 1 }); A({ t: 'trash' });
// 4) 生クリーム：常温 → だれる → 傷む／冷蔵庫では止まる
K.invAdd(S, 'cream', 20, 120); K.invAdd(S, 'sugar', 20, 25);
const W = fid('whip');
const whip = () => { for (const ing of ['cream', 'cream', 'sugar']) { A({ t: 'take', id: stackOf(ing) }); A({ t: 'addIng', fid: W }); } A({ t: 'run', fid: W }); now += K.gauge(S, 'whip').sec * 1000; A({ t: 'run', fid: W }); A({ t: 'scoop', fid: W }); return K.held(S, 'p1'); };
const c1 = whip(); A({ t: 'put', slot: sl('fridge', 0) }); tick(600000);
ok(c1 && !(S.k.items[c1].sp > 0) && !S.k.items[c1].w0, 'cream in fridge stays fresh 10 min');
A({ t: 'pick', id: c1 }); A({ t: 'put', slot: sl('table', 1) }); tick(125000);
ok(S.k.items[c1].sp === 1 && S.k.items[c1].df.includes('soft'), 'cream out of fridge 2 min → soft');
A({ t: 'pick', id: c1 }); A({ t: 'put', slot: sl('fridge', 1) }); tick(300000); ok(S.k.items[c1].sp === 1, 'back in fridge: no further spoil');
A({ t: 'pick', id: c1 }); A({ t: 'put', slot: sl('table', 1) }); tick(125000);
ok(S.k.items[c1].sp === 2 && S.k.items[c1].df.includes('spoil'), 'cream spoiled after total 4 min warm: ' + fxs());
// 5) 傷んだクリームでケーキ → 商品棚 → お客さんが大クレーム
const DF = fid('deco');
S.k.items.pz = { t: 'pan', st: 'baked', b: 'plain', q: 0.9, df: [], c: 300, cool: 0, at: sl('table', 2) };
A({ t: 'pick', id: 'pz' }); A({ t: 'put', slot: K.slot0(DF) });
A({ t: 'put', slot: K.findSlot(S, held(), ['table', 'shelf', 'rack']) }); // 空いた型（汚れ）をどこかへ
A({ t: 'pick', id: c1 }); A({ t: 'run', fid: DF });
const dk = S.k.items[K.at(S, K.slot0(DF))];
ok(dk.df.includes('spoil') && dk.sp === 2, 'deco inherits spoiled cream (df ' + dk.df.join(',') + ')');
ok(!A({ t: 'finish', fid: DF, quiet: 1 }).ok, 'cannot finish while spreading');
A({ t: 'spreadDone', fid: DF, q: 0.9 });
A({ t: 'put', slot: K.findSlot(S, held(), ['table', 'fridge', 'shelf']) });
K.invAdd(S, 'strawberry', 10, 130);
for (let k = 0; k < 3; k++) { A({ t: 'take', id: stackOf('strawberry') }); const a = (k / 3) * Math.PI * 2; A({ t: 'topPlace', fid: DF, x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55 }); }
A({ t: 'finish', fid: DF });
const cake = S.k.items[K.at(S, K.slot0(DF))];
ok(cake && cake.t === 'cake' && cake.df.includes('spoil'), 'cake keeps spoil defect');
A({ t: 'pick', id: K.at(S, K.slot0(DF)) }); A({ t: 'put', slot: sl('pcase', 0) });
const tr = S.k.items[K.at(S, sl('pcase', 0))];
ok(tr && tr.t === 'tray' && tr.df.includes('spoil') && tr.sp === 2, 'product shelf tray carries freshness');
for (const r in S.menu) A({ t: 'menuOn', r, on: r === 'short' });
K.invAdd(S, 'box', 10, 60);
S.furn.table = 0;
A({ t: 'sign' });
const rep0 = S.rep; K.spawn(S, now); const cid = Object.keys(S.cust)[0]; for (let k = 0; k < 4; k++) { now += 2500; sim.tick(S, now); }
if (S.cust[cid].st === 'q') {
  const c = S.cust[cid]; A({ t: 'takeOrder', c: cid });
  if (c.dine) { console.log('  (dine-in; skipping)'); } else {
    A({ t: 'take', id: stackOf('box') }); for (let n = 0; n < c.ord.short; n++) A({ t: 'slice', id: K.at(S, sl('pcase', 0)) });
    A({ t: 'serve', c: cid }); A({ t: 'pay', c: cid, ch: K.change(c) });
    ok(S.today.issues.spoil >= 1 && S.rep < rep0, 'customer complains about spoiled cake: "' + c.say + '" rep ' + rep0.toFixed(2) + '→' + S.rep.toFixed(2));
  }
} else console.log('  (customer did not queue:', S.cust[cid].st, S.cust[cid].say, ')');
A({ t: 'sign' }); console.log('phase after CLOSE', S.phase);
// 6) 新鮮なケーキ：机の上は溶ける、冷蔵庫では止まる。常温の商品棚ではクリームのケーキは溶ける
S.k.items.ck = { t: 'cake', r: 'short', q: 0.9, df: [], p: 6, n: 6, c: 900, d: S.day, at: sl('table', 2) };
tick(160000); ok(S.k.items.ck.sp === 1 && S.k.items.ck.df.includes('melt'), 'cake on the table 2.6 min → cream melting');
A({ t: 'pick', id: 'ck' }); A({ t: 'put', slot: sl('fridge', 2) }); tick(600000); ok(S.k.items.ck.sp === 1, 'cake in fridge: paused');
S.k.items.tw = { t: 'cake', r: 'short', q: 0.9, df: [], p: 6, n: 6, c: 900, d: S.day, at: sl('table', 0) };
A({ t: 'pick', id: 'tw' }); A({ t: 'put', slot: sl('pcaseN', 0) }); tick(160000);
const tw = S.k.items[K.at(S, sl('pcaseN', 0))];
ok(tw && tw.t === 'tray' && tw.sp === 1, 'cream cake on the room-temp product shelf melts');
S.k.items.ck2 = { t: 'cake', r: 'butter_cookie', q: 0.9, df: [], p: 8, n: 8, c: 300, d: S.day, at: sl('table', 3) };
A({ t: 'pick', id: 'ck2' }); A({ t: 'put', slot: sl('pcaseN', 1) }); tick(600000);
const ck2 = S.k.items[K.at(S, sl('pcaseN', 1))];
ok(ck2 && ck2.t === 'tray' && !(ck2.sp > 0), 'cookies on the room-temp product shelf are fine');
// 7) 一晩：冷蔵庫のケーキは賞味期限まで、クリームは1晩まで。外の要冷蔵は傷む
S.k.items.cr9 = { t: 'crate', ing: 'egg', n: 10, u: 35, ar: 0, at: sl('table', 0), open: 1 };
S.k.items.cr8 = { t: 'crate', ing: 'sugar', n: 10, u: 25, ar: 0, at: sl('table', 1), open: 1 };
const c2 = whip(); A({ t: 'put', slot: sl('fridge', 3) }); const c3 = whip(); A({ t: 'put', slot: sl('table', 2) });
A({ t: 'endDay' });
ok(S.k.items.ck && S.k.items.ck.o === 1, 'cake in fridge kept overnight (until best-before)');
ok(S.k.items[c2] && S.k.items[c2].o === 1, 'cream in fridge kept overnight');
ok(!S.k.items[c3], 'cream left out discarded at night');
ok(S.k.items.cr9.sp === 2 && !S.k.items.cr8.sp, 'egg crate left out spoiled overnight, sugar crate fine');
A({ t: 'next' }); if (S.phase === 'report') A({ t: 'start' });
console.log('phase', S.phase, 'day', S.day);
A({ t: 'sign' }); tick(3000); A({ t: 'sign' });
A({ t: 'endDay' }); ok(!S.k.items.ck && !S.k.items[c2], 'second night → cake past best-before and cream discarded');
console.log('history spl', S.history[S.history.length - 1].spl, 'JSON', JSON.stringify(S).length);
console.log(fail ? fail + ' FAILED' : 'ALL OK');
