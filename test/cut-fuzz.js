// ケーキの切り分け・ホール・お皿の上・箱：でたらめに操作して矛盾が起きないか
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/plan.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, P = CS.plan;
let seed = +(process.argv[2] || 5);
Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const S = sim.newState({}); S.funds = 900000; S.xp = 3000; sim.normalize(S);
K.invAdd(S, 'box', 40, 60);
let now = 1000, err = 0, okc = {};
sim.apply(S, { t: 'start' }, now); sim.apply(S, { t: 'sign' }, now);
const slots = () => Object.keys(S.fu).reduce((a, f) => a.concat(P.slots(S, f)), []);
const recipes = ['short', 'chocolate', 'baked_cheese'];
for (let i = 0; i < 6; i++) { const sl = slots().find((x) => !K.inSlot(S, x).length && P.slotDef(S, x).type !== 'oven' && P.slotDef(S, x).type !== 'basin' && P.slotDef(S, x).type !== 'mixpan'); if (sl) K.add(S, { t: P.slotDef(S, sl).type === 'tray' ? 'tray' : 'cake', r: pick(recipes), q: 0.9, p: 6, n: 6, c: 900, d: S.day, df: [], w: 1, at: sl }); }
for (let i = 0; i < 3; i++) { const sl = slots().find((x) => !K.inSlot(S, x).length && P.slotDef(S, x).type === 'any'); K.add(S, { t: 'plate', s: [], at: sl }); }
const verbs = ['pick', 'put', 'put', 'cut', 'cut', 'hole', 'unhole', 'slice', 'slice', 'unslice', 'caseTake', 'take', 'trash', 'serve', 'pay', 'takeOrder', 'tbuy'];
for (let step = 0; step < 60000; step++) {
  const t = pick(verbs), pid = pick(['p1', 'p2']), ids = Object.keys(S.k.items);
  if (S.phase === 'report') { sim.apply(S, { t: 'next' }, now); sim.apply(S, { t: 'sign' }, now); }
  const cakes = ids.filter((id) => /cake|tray|knife|plate|box/.test(S.k.items[id].t));
  const a = { t, pid, id: Math.random() < 0.7 && cakes.length ? pick(cakes) : pick(ids), slot: pick(slots()), c: pick(Object.keys(S.cust).concat(['x'])), k: 'knife' };
  if (t === 'take') { const b = ids.find((id) => S.k.items[id].t === 'ing' && S.k.items[id].ing === 'box'); a.id = b; }
  if (Math.random() < 0.02) { const sl = slots().find((x) => !K.inSlot(S, x).length && P.slotDef(S, x).type === 'any'); if (sl) K.add(S, { t: 'cake', r: pick(recipes), q: 0.9, p: 6, n: 6, c: 900, d: S.day, df: [], w: 1, at: sl }); }
  try { const r = sim.apply(S, a, now); if (r.ok) okc[t] = (okc[t] || 0) + 1; } catch (e) { err++; console.log('THROW', t, e.stack.split('\n').slice(0, 3).join(' | ')); }
  now += 300; if (step % 7 === 0) { try { sim.tick(S, now); } catch (e) { err++; console.log('TICK', e.message); } }
  const held = {}, slot = {};
  for (const id in S.k.items) {
    const it = S.k.items[id], at = String(it.at);
    if (at.startsWith('h:')) { if (held[at]) { err++; console.log('two in hand'); } held[at] = 1; }
    if (at.startsWith('f:')) { const k = K.skey(it) || id; if (slot[at] && slot[at] !== k) { err++; if (err < 10) console.log('mixed', at, JSON.stringify(it)); } slot[at] = k; }
    if ((it.t === 'cake' || it.t === 'tray') && ((it.w && it.p !== it.n) || !(it.p > 0))) { err++; console.log('bad cake', JSON.stringify(it)); }
    if (it.t === 'tray' && !(at.startsWith('f:') && P.slotDef(S, at) && P.slotDef(S, at).type === 'tray')) { err++; console.log('tray outside showcase', at); }
    if (it.t === 'box' && K.boxUnits(it) > 6) { err++; console.log('box overfull'); }
  }
  if (!Object.values(S.k.items).some((i) => i.t === 'knife') && step % 500 === 0) sim.apply(S, { t: 'tbuy', k: 'knife' }, now);
}
console.log(JSON.stringify(okc));
console.log(err ? 'CUT FUZZ FAIL ' + err : 'CUT FUZZ OK');
