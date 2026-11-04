// 新しい厨房でアルバイトだけで1日回るか
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data;
function run(tasks, menu, boost, label) {
  let now = 1000;
  const S = sim.newState({}); S.funds = 1e6; S.xp = 9600; S.rep = 3.5; sim.normalize(S);
  const A = (a) => sim.apply(S, Object.assign({ pid: 'p1' }, a), now);
  for (let i = 0; i < 4; i++) A({ t: 'hire', slot: i });
  tasks.forEach((t, i) => A({ t: 'staffTask', slot: i, task: t }));
  S.staff.forEach((st) => { st.lv = Math.min(10, st.lv + boost); });
  for (const k in D.ING) { const r = A({ t: 'buy', id: k, n: 10 }); }
  // 段ボールを全部しまう（プレイヤーの代わり）
  for (const id of Object.keys(S.k.items)) { const it = S.k.items[id]; if (it.t === 'crate') { sim._.invAdd(S, it.ing, it.n, it.u); delete S.k.items[id]; } }
  for (const k in D.ING) sim._.invAdd(S, k, 60, D.ING[k].price);
  for (const r in S.menu) S.menu[r].on = menu.includes(r);
  A({ t: 'start' }); now += 60000; for (let t = 0; t < 240; t++) { now += 250; sim.tick(S, now); }
  A({ t: 'sign' });
  while (S.phase === 'open') { now += 250; sim.tick(S, now); }
  const T = S.history[S.history.length - 1];
  console.log(label, 'cust', T.cust, 'miss', T.miss, 'sold', T.sold, 'sales', T.sales, 'wages', T.wages, 'profit', T.profit, '| staff', S.staff.map((s) => s && s.name + ':' + s.task + ':Lv' + s.lv + ' x' + (s.done || 0)).join(' '));
}
run(['mix', 'bake', 'deco', 'cashier'], ['butter_cookie', 'baked_cheese'], 0, '[cookie/cheese start]');
run(['mix', 'bake', 'deco', 'cashier'], ['butter_cookie', 'baked_cheese'], 4, '[cookie/cheese +4]');
run(['mix', 'bake', 'whip', 'deco'], ['short', 'chocolate'], 4, '[cake no cashier +4]');
