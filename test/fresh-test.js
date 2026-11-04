// 鮮度：要冷蔵の物は常温で傷む／冷蔵庫・荷台では傷まない／一晩の扱い
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data;
let now = 1000;
const S = sim.newState({}); S.funds = 100000;
const A = (a, pid) => { const r = sim.apply(S, Object.assign({ pid: pid || 'p1' }, a), now); if (!r.ok) console.log('  NG', a.t, r.msg); return r; };
const tick = (ms, step) => { for (let t = 0; t < ms; t += step || 1000) { now += step || 1000; sim.tick(S, now); } };
const fxs = () => S.fx.slice(-3).map((f) => f.x).join(' / ');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
A({ t: 'start' });
console.log('fridge slots', K.count(S, 'fridge'), 'valid fr:5', K.validSlot(S, 'fr:5'), 'fr:6', K.validSlot(S, 'fr:6'));
// 1) 段ボール：荷台の中では傷まない → 持ち出すと常温
A({ t: 'order', items: ['strawberry', 'strawberry', 'flour'] });
tick(9500);
const ids = Object.keys(S.k.items).filter((id) => S.k.items[id].t === 'crate');
const st = ids.find((id) => S.k.items[id].ing === 'strawberry'), st2 = ids.filter((id) => S.k.items[id].ing === 'strawberry')[1], fl = ids.find((id) => S.k.items[id].ing === 'flour');
tick(200000); ok(!(S.k.items[st].sp > 0), 'truck bed keeps crates cold (200s)');
A({ t: 'pick', id: st }); tick(30000);
ok(K.fresh(S, S.k.items[st], now).left < 95, 'held crate warms up (left ' + Math.round(K.fresh(S, S.k.items[st], now).left) + 's)');
tick(40000); ok(S.k.items[st].sp === 1, 'after 70s strawberry crate is warm: ' + fxs());
A({ t: 'openCrate' }); A({ t: 'shelve', ing: 'strawberry', all: 1 });
const lot = S.inv.strawberry.find((l) => l[0] === 10); ok(lot && lot[1] - S.day < 2, 'warm crate shelved with shorter life (exp in ' + (lot && lot[1] - S.day) + ' days)');
A({ t: 'trash' });
// 2) 傷むまで放置 → 棚に置けない → 中身ごと捨てられる（廃棄・件数）
A({ t: 'pick', id: st2 }); A({ t: 'put', slot: 'sp:0' }); tick(125000);
ok(S.k.items[st2].sp === 2, 'crate left on worktable spoiled: ' + fxs());
A({ t: 'pick', id: st2 }); A({ t: 'openCrate' }); const r2 = A({ t: 'shelve', ing: 'strawberry' });
ok(!r2.ok, 'spoiled crate cannot be shelved');
const w0 = S.today.waste; const r3 = A({ t: 'trash' }); ok(r3.ok && S.today.waste > w0 && S.today.spoiled === 1, 'spoiled crate trashed: ' + r3.msg + ' waste +' + (S.today.waste - w0));
// 小麦粉（乾物）は傷まない
A({ t: 'pick', id: fl }); tick(400000); ok(!S.k.items[fl].sp, 'flour crate never spoils');
A({ t: 'openCrate' }); A({ t: 'shelve', ing: 'flour', all: 1 }); A({ t: 'trash' });
tick(12000);
// 3) 生クリーム：常温 → だれる → 傷む／冷蔵庫では止まる
sim._.invAdd(S, 'cream', 20, 120); sim._.invAdd(S, 'sugar', 20, 25);
const whip = () => { ['cream', 'cream', 'sugar'].forEach((ing) => A({ t: 'addIng', st: 'whip', i: 0, ing })); A({ t: 'run', st: 'whip', i: 0 }); now += K.gauge(S, 'whip').sec * 1000; A({ t: 'run', st: 'whip', i: 0 }); A({ t: 'scoop', i: 0 }); return K.held(S, 'p1'); };
const c1 = whip(); A({ t: 'put', slot: 'fr:0' }); tick(600000);
ok(!(S.k.items[c1].sp > 0) && !S.k.items[c1].w0, 'cream in fridge stays fresh 10 min');
A({ t: 'pick', id: c1 }); A({ t: 'put', slot: 'sp:1' }); tick(125000);
ok(S.k.items[c1].sp === 1 && S.k.items[c1].df.includes('soft'), 'cream out of fridge 2 min → soft');
A({ t: 'pick', id: c1 }); A({ t: 'put', slot: 'fr:1' }); tick(300000); ok(S.k.items[c1].sp === 1, 'back in fridge: no further spoil');
A({ t: 'pick', id: c1 }); A({ t: 'put', slot: 'sp:1' }); tick(125000);
ok(S.k.items[c1].sp === 2 && S.k.items[c1].df.includes('spoil'), 'cream spoiled after total 4 min warm: ' + fxs());
// 4) 傷んだクリームでケーキ → お客さんが大クレーム
const pan = Object.keys(S.k.items).length; // dummy
S.k.items.pz = { t: 'pan', st: 'baked', b: 'plain', q: 0.9, df: [], c: 300, cool: 0, at: 'dt:0' };
A({ t: 'pick', id: 'pz' }); A({ t: 'put', slot: 'dt:0' });
A({ t: 'pick', id: c1 }); A({ t: 'run', st: 'deco', i: 0 });
const dk = S.k.items[K.at(S, 'dt:0')];
ok(dk.df.includes('spoil') && dk.sp === 2, 'deco inherits spoiled cream (df ' + dk.df.join(',') + ')');
ok(!A({ t: 'finish', i: 0 }).ok, 'cannot finish while spreading');
A({ t: 'spreadDone', i: 0, q: 0.9 });
A({ t: 'put', slot: 'sp:2' }); // 残りのクリーム
sim._.invAdd(S, 'strawberry', 10, 130);
for (let k = 0; k < 3; k++) { A({ t: 'takeTop', k: 'strawberry' }); const a = (k / 3) * Math.PI * 2; A({ t: 'topPlace', i: 0, x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55 }); }
A({ t: 'finish', i: 0 }, 'p1', now);
const cake = S.k.items[K.at(S, 'dt:0')];
ok(cake && cake.t === 'cake' && cake.df.includes('spoil'), 'cake keeps spoil defect');
A({ t: 'pick', id: K.at(S, 'dt:0') }); A({ t: 'put', slot: 'cs:0' });
ok(S.showcase[0] && S.showcase[0].df.includes('spoil') && S.showcase[0].sp === 2, 'showcase entry carries freshness');
A({ t: 'sign' });
const rep0 = S.rep; K.spawn(S, now); const cid = Object.keys(S.cust)[0]; for (let k = 0; k < 4; k++) { now += 2500; sim.tick(S, now); }
if (S.cust[cid].st === 'q') {
  A({ t: 'takeOrder', c: cid }); A({ t: 'newBox' }); for (let n = 0; n < S.cust[cid].ord.short; n++) A({ t: 'slice', ci: 0 });
  A({ t: 'serve', c: cid }); ok(S.today.issues.spoil >= 1 && S.rep < rep0, 'customer complains about spoiled cake: "' + S.cust[cid].say + '" rep ' + rep0.toFixed(2) + '→' + S.rep.toFixed(2) + ' / ' + fxs());
} else console.log('  (customer did not queue:', S.cust[cid].st, S.cust[cid].say, ')');
A({ t: 'sign' }); console.log('phase after CLOSE', S.phase);
// 5) 新鮮なケーキ：冷蔵庫の中は傷まない、外に5分で傷む
S.k.items.ck = { t: 'cake', r: 'short', q: 0.9, df: [], p: 6, n: 6, c: 900, at: 'sp:5' };
tick(160000); ok(S.k.items.ck.sp === 1 && S.k.items.ck.df.includes('melt'), 'cake on worktable 2.6 min → cream melting');
A({ t: 'pick', id: 'ck' }); A({ t: 'put', slot: 'fr:2' }); tick(600000); ok(S.k.items.ck.sp === 1, 'cake in fridge: paused');
// 6) 一晩：冷蔵庫の中は残る（1晩まで）・外の要冷蔵の段ボールは傷む
S.k.items.cr9 = { t: 'crate', ing: 'egg', n: 10, u: 35, ar: 0, at: 'sp:6', open: 1 };
S.k.items.cr8 = { t: 'crate', ing: 'sugar', n: 10, u: 25, ar: 0, at: 'sp:7', open: 1 };
const c2 = whip(); A({ t: 'put', slot: 'fr:3' }); const c3 = whip(); A({ t: 'put', slot: 'sp:8' });
A({ t: 'endDay' });
ok(S.k.items.ck && S.k.items.ck.o === 1 && S.k.items.ck.df.includes('stale'), 'cake in fridge kept overnight (stale)');
ok(S.k.items[c2] && S.k.items[c2].o === 1, 'cream in fridge kept overnight');
ok(!S.k.items[c3], 'cream left out discarded at night');
ok(S.k.items.cr9.sp === 2 && !S.k.items.cr8.sp, 'egg crate left out spoiled overnight, sugar crate fine');
A({ t: 'next' }); if (S.phase === 'report') A({ t: 'start' });
console.log('phase', S.phase, 'day', S.day);
A({ t: 'sign' }); tick(3000); A({ t: 'sign' });
A({ t: 'endDay' }); ok(!S.k.items.ck && !S.k.items[c2], 'second night in fridge → discarded');
console.log('history spl', S.history[S.history.length - 1].spl, 'JSON', JSON.stringify(S).length);
console.log(fail ? fail + ' FAILED' : 'ALL OK');
