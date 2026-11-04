// アルバイトだけで1日回るか（家具・棚・洗い物・お会計つき）
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/plan.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data, P = CS.plan;
function run(tasks, menu, boost, label, opt) {
  let now = 1000;
  const S = sim.newState({}); S.funds = 1e6; S.xp = 9600; S.rep = 3.5; sim.normalize(S);
  const A = (a) => sim.apply(S, Object.assign({ pid: 'p1' }, a), now);
  // 設備をそろえる
  ['oven', 'oven', 'mixer', 'deco', 'cshelf', 'shelf', 'rack', 'pcaseN'].forEach((k) => K.placeNew(S, k));
  for (let i = 0; i < 3; i++) { A({ t: 'tbuy', k: 'pan' }); A({ t: 'tbuy', k: 'plate' }); }
  S.furn.table = 3;
  for (let i = 0; i < 4; i++) A({ t: 'hire', slot: i });
  tasks.forEach((t, i) => A({ t: 'staffTask', slot: i, task: t }));
  S.staff.forEach((st) => { if (st) st.lv = Math.min(10, st.lv + boost); });
  for (const k in D.ING) K.invAdd(S, k, 40, D.ING[k].price);
  for (const r in S.menu) S.menu[r].on = menu.includes(r);
  A({ t: 'start' }); now += 60000; for (let t = 0; t < 240; t++) { now += 250; sim.tick(S, now); }
  A({ t: 'sign' });
  while (S.phase === 'open') { now += 250; sim.tick(S, now); }
  const T = S.history[S.history.length - 1];
  const dirty = Object.values(S.k.items).filter((i) => i.dirty).length;
  console.log(label, 'cust', T.cust, 'miss', T.miss, 'sold', T.sold, 'whole', T.hole || 0, 'sales', T.sales, 'slow', T.slow, 'wages', T.wages, 'profit', T.profit, 'dirty', dirty, '| staff', S.staff.map((s) => s && s.name + ':' + s.task + ':Lv' + s.lv + ' x' + (s.done || 0)).join(' '));
  return T;
}
const a = run(['mix', 'bake', 'deco', 'cashier'], ['butter_cookie', 'baked_cheese'], 0, '[cookie/cheese start]');
const b = run(['mix', 'bake', 'deco', 'cashier'], ['butter_cookie', 'baked_cheese'], 4, '[cookie/cheese +4]');
const c = run(['mix', 'bake', 'whip', 'deco'], ['short', 'chocolate'], 4, '[cake no cashier +4]');
const d = run(['mix', 'bake', 'deco', 'wash'], ['butter_cookie', 'baked_cheese'], 6, '[with wash staff: pans get reused]');
const e = run(['mix', 'bake', 'deco', 'cashier'], ['baked_cheese'], 6, '[cheese: whole + cut by staff]');
console.log(b.sold > 10 && c.sold === 0 && e.sold > 10 && (e.hole || 0) > 0 ? 'STAFF OK' : 'STAFF CHECK');
