// 手で運ぶ調理〜接客の流れをロジックだけで確認
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data;
let now = 1000;
const S = sim.newState({}); S.funds = 100000;
const A = (a) => { const r = sim.apply(S, Object.assign({ pid: 'p1' }, a), now); if (!r.ok) console.log('  NG', a.t, r.msg); return r; };
console.log('ovens', S.ovens.length, 'case', S.showcase.length, 'mix', S.k.mix.length, 'deco', S.k.deco.length);
A({ t: 'start' });
// 仕入れ → 段ボール → 棚へ
A({ t: 'buy', id: 'strawberry', n: 12 });
let crates = Object.keys(S.k.items).filter((id) => S.k.items[id].t === 'crate');
console.log('crates', crates.map((id) => S.k.items[id].at + ':' + S.k.items[id].n));
console.log('pick before truck:', A({ t: 'pick', id: crates[0] }).msg); now += 9500; console.log('trucks', JSON.stringify(S.k.trucks)); A({ t: 'pick', id: crates[0] }); A({ t: 'stock' });
console.log('strawberry inv', sim.invCount(S, 'strawberry'));
// 生地：卵→砂糖→小麦粉→バター（plain: egg3 sugar2 flour2 butter1）
['egg', 'egg', 'egg', 'sugar', 'sugar', 'flour', 'flour', 'butter'].forEach((ing) => A({ t: 'addIng', st: 'mix', i: 0, ing }));
A({ t: 'run', st: 'mix', i: 0 }); now += 6500 * K.gauge(S, 'mix').sec / 6.5; const r1 = A({ t: 'run', st: 'mix', i: 0 }); console.log('mix:', r1.msg, S.k.mix[0].k, S.k.mix[0].q);
A({ t: 'newPan' }); A({ t: 'pour', i: 0 });
// オーブン：予熱 → 入れる
A({ t: 'oven', i: 0, op: 'set', temp: 170 }); now += 10000;
A({ t: 'put', slot: 'ov:0' });
const pan = K.at(S, 'ov:0'); const it = S.k.items[pan];
console.log('baking', it.st, Math.round(it.bk.dur));
now += it.bk.dur; sim.tick(S, now);
A({ t: 'pick', id: pan }); console.log('baked', it.st, it.lab, it.q.toFixed(2), it.df);
A({ t: 'put', slot: 'rk:0' }); now += 40000;
// クリーム
['cream', 'cream', 'sugar'].forEach((ing) => A({ t: 'addIng', st: 'whip', i: 0, ing }));
A({ t: 'run', st: 'whip', i: 0 }); now += K.gauge(S, 'whip').sec * 1000; console.log('whip:', A({ t: 'run', st: 'whip', i: 0 }).msg);
A({ t: 'scoop', i: 0 }); const crId = K.held(S, 'p1'); A({ t: 'put', slot: 'sp:0' });
// デコ
A({ t: 'pick', id: pan }); A({ t: 'put', slot: 'dt:0' });
A({ t: 'pick', id: crId }); A({ t: 'run', st: 'deco', i: 0 }); now += K.gauge(S, 'deco').sec * 1000; console.log('spread:', A({ t: 'run', st: 'deco', i: 0 }).msg);
A({ t: 'put', slot: 'sp:1' });
for (let k = 0; k < 3; k++) { A({ t: 'takeTop', k: 'strawberry' }); const a = (k / 3) * Math.PI * 2; A({ t: 'topPlace', i: 0, x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55 }); }
console.log('finish:', A({ t: 'finish', i: 0 }).ok, S.fx[S.fx.length - 1].x);
const cake = K.at(S, 'dt:0'); A({ t: 'pick', id: cake }); A({ t: 'put', slot: 'cs:0' });
console.log('case0', JSON.stringify(S.showcase[0]));
// OPEN → お客さん → 注文 → 箱詰め → 手渡し
A({ t: 'sign' }); console.log('phase', S.phase);
K.spawn(S, now); const cid = Object.keys(S.cust)[0]; for (let k = 0; k < 4; k++) { now += 2500; sim.tick(S, now); }
console.log('cust', S.cust[cid].st, JSON.stringify(S.cust[cid].ord), S.cust[cid].say);
if (S.cust[cid].st === 'q') {
  A({ t: 'takeOrder', c: cid }); console.log('ordered #', S.cust[cid].no, S.cust[cid].st);
  A({ t: 'newBox' }); for (let n = 0; n < S.cust[cid].ord.short; n++) A({ t: 'slice', ci: 0 });
  A({ t: 'serve', c: cid }); console.log('after serve', S.cust[cid].st, S.cust[cid].say, 'sales', S.today.sales, 'pieces left', S.showcase[0] && S.showcase[0].p);
}
// CLOSE で時計が止まる
const t0 = S.dayT; now += 5000; sim.tick(S, now); const t1 = S.dayT; A({ t: 'sign' }); now += 5000; sim.tick(S, now);
console.log('clock open +', t1 - t0, 'closed +', S.dayT - t1, 'phase', S.phase);
console.log('JSON size', JSON.stringify(S).length);
