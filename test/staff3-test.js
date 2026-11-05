// アルバイト：8人まで・Lv1 では雇えない・人によって手際（速さ）が違う・お菓子係（作る物を指定）・仕入れ係（運ぶ場所を指定）
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/plan.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data, P = CS.plan;
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
ok(D.STAFF.slots.length === 8 && D.STAFF.slots.every((x) => x.lv >= 2), '8 staff slots, none at Lv1');
{
  const S = sim.newState({}); sim.normalize(S);
  ok(S.staff.length === 8, 'state has 8 staff places');
  ok(!sim.apply(S, { t: 'hire', slot: 0 }, 1000).ok, 'cannot hire at shop Lv1');
  S.xp = 9600; ok(D.STAFF.slots.every((x, i) => sim.apply(S, { t: 'hire', slot: i }, 1000).ok), 'can hire all 8 at Lv10');
  const sps = S.staff.map((x) => x.sp); ok(new Set(sps).size >= 5, 'staff differ in skill: ' + sps.join(','));
}
// お菓子係：1人で ショートケーキ を最後まで（ショーケースに並ぶ）
function chefRun(slot, lvBoost) {
  let now = 1000;
  const S = sim.newState({}); S.funds = 1e6; S.xp = 9600; S.rep = 3.5; sim.normalize(S);
  ['oven', 'mixer', 'deco', 'cshelf', 'shelf'].forEach((k) => K.placeNew(S, k));
  for (const k of ['egg', 'sugar', 'flour', 'butter', 'cream', 'strawberry', 'box']) K.invAdd(S, k, 20, D.ING[k].price);
  sim.apply(S, { t: 'hire', slot }, now); const st = S.staff[slot]; st.lv = lvBoost;
  sim.apply(S, { t: 'staffTask', slot, task: 'chef', opt: 'short' }, now);
  sim.apply(S, { t: 'start' }, now);
  let t = 0; const T0 = now;
  for (; t < 4000; t++) { now += 250; sim.tick(S, now); if (Object.values(S.k.items).some((i) => i.t === 'tray' && i.r === 'short')) break; }
  const tray = Object.values(S.k.items).find((i) => i.t === 'tray');
  return { S, st, sec: Math.round((now - T0) / 1000), tray };
}
const a = chefRun(1, 6), b = chefRun(2, 6);
console.log('chef', a.st.name, 'sp', a.st.sp, 'Lv', a.st.lv, a.sec + 's |', b.st.name, 'sp', b.st.sp, 'Lv', b.st.lv, b.sec + 's');
ok(a.tray && a.tray.r === 'short' && b.tray, 'one staff made a short cake from scratch and put it in the showcase');
ok(a.st.sp > b.st.sp && a.sec < b.sec, 'the more skilful staff is faster (' + a.sec + 's < ' + b.sec + 's)');
// 仕入れ係：運ぶ場所を指定（在庫棚 → 段ボールのまま／冷蔵棚2 → 中身をその棚へ）
{
  let now = 1000;
  const S = sim.newState({}); S.funds = 1e6; S.xp = 9600; sim.normalize(S);
  const rack = K.placeNew(S, 'crack'), cs2 = K.placeNew(S, 'cshelf');
  sim.apply(S, { t: 'hire', slot: 0 }, now); S.staff[0].lv = 8;
  sim.apply(S, { t: 'staffTask', slot: 0, task: 'stock', opt: rack }, now);
  sim.apply(S, { t: 'start' }, now);
  sim.apply(S, { t: 'order', items: ['flour', 'sugar', 'egg'] }, now);
  for (let i = 0; i < 400; i++) { now += 250; sim.tick(S, now); }
  const inRack = P.slots(S, rack).map((sl) => K.inSlot(S, sl).map((id) => S.k.items[id].ing).join('')).filter((x) => x);
  ok(inRack.length >= 3 && ['flour', 'sugar', 'egg'].every((x) => inRack.includes(x)), 'stock staff carried the crates from the truck into the crate rack: ' + inRack.join(','));
  sim.apply(S, { t: 'staffTask', slot: 0, task: 'stock', opt: cs2 }, now);
  for (let i = 0; i < 400; i++) { now += 250; sim.tick(S, now); }
  const inCs2 = P.slots(S, cs2).map((sl) => K.inSlot(S, sl).map((id) => S.k.items[id].ing + S.k.items[id].n).join('')).filter((x) => x);
  ok(['flour', 'sugar', 'egg'].every((x) => inCs2.some((y) => y.startsWith(x))) && !P.slots(S, rack).some((sl) => K.inSlot(S, sl).some((id) => S.k.items[id].n > 0)), 'then unpacked them into the chosen cold shelf: ' + inCs2.join(','));
}
console.log(fail ? fail + ' FAILED' : 'ALL OK');
