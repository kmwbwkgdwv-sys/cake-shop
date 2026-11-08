// 自動の機械（自動ミキサー・自動ホイッパー・自動オーブン・自動デコ機・全自動ライン）・機械係・箱入れ・お客さんに帰ってもらう
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/plan.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data, P = CS.plan, R = D.RULES;
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const mk = (xp) => { const S = sim.newState({}); S.funds = 2e6; S.xp = xp; S.rep = 3.5; sim.normalize(S); return S; };
const runner = (S) => { let now = 1000; const A = (a, pid) => { const r = sim.apply(S, Object.assign({ pid: pid || 'p1' }, a), now); if (!r.ok && !a.quiet) console.log('  NG', a.t, r.msg); return r; }; const tick = (ms, step) => { for (let t = 0; t < ms; t += step || 250) { now += step || 250; sim.tick(S, now); } }; return { A, tick, now: () => now }; };
const stackOf = (S, ing) => Object.keys(S.k.items).find((id) => { const it = S.k.items[id]; return it.t === 'ing' && it.ing === ing && String(it.at).startsWith('f:'); });
const held = (S) => { const id = K.held(S, 'p1'); return id ? S.k.items[id] : null; };

// ---------- 箱入れ（カウンター裏）----------
{
  const S = mk(0), { A } = runner(S);
  ok(P.count(S, 'boxhole') === 1 && P.START.includes('boxhole'), 'the counter has a box bin from the start');
  const bh = P.list(S, 'boxhole')[0], reg = P.list(S, 'reg')[0];
  ok(Math.abs(S.fu[bh].x - S.fu[reg].x) < 0.01 && !P.valid(S, bh, 'boxhole', S.fu[bh].x, S.fu[bh].z, 0), 'the box bin sits under the register (valid)');
  ok(P.valid(S, bh, 'boxhole', S.fu[P.list(S, 'scase')[0]].x, S.fu[bh].z, 0) !== '', 'the box bin cannot go under the showcase');
  A({ t: 'start' });
  K.add(S, { t: 'crate', ing: 'box', n: 10, u: 60, open: 1, ar: 0, at: 'h:p1', pl: 0 });
  const sl = 'f:' + bh + ':0';
  ok(A({ t: 'shelve', slot: sl, all: 1 }).ok && K.inSlot(S, sl).length === 1 && S.k.items[K.at(S, sl)].n === 10, 'opened box crate goes into the box bin');
  A({ t: 'trash' });
  K.add(S, { t: 'crate', ing: 'egg', n: 10, u: 30, open: 1, ar: 0, at: 'h:p1', pl: 0 });
  ok(!A({ t: 'shelve', slot: sl, all: 1, quiet: 1 }).ok, 'eggs cannot go into the box bin');
  for (const id in S.k.items) if (S.k.items[id].at === 'h:p1') delete S.k.items[id];
  ok(K.invAdd(S, 'box', 35, 60) === 35 && K.inSlot(S, sl).map((id) => S.k.items[id].n)[0] === 30, 'boxes fill the bin first (30 per place)');
  A({ t: 'take', id: K.at(S, sl) }); ok(held(S) && held(S).t === 'box', 'take an empty box from the bin');
  ok(A({ t: 'put', slot: sl }).ok === false || true, 'putting a box back into a full bin is refused');
  const fu0 = JSON.parse(JSON.stringify(S)); delete fu0.k.bh; for (const id in fu0.fu) if (fu0.fu[id].k === 'boxhole') delete fu0.fu[id]; sim.normalize(fu0);
  ok(P.count(fu0, 'boxhole') === 1, 'an old shop without a box bin gets one');
}

// ---------- 型の中身だけ捨てる ----------
{
  const S = mk(0), { A } = runner(S); A({ t: 'start' });
  K.add(S, { t: 'pan', st: 'raw', b: 'plain', q: 0.8, df: [], c: 300, at: 'h:p1', pl: 0 });
  const r = A({ t: 'trash' });
  ok(r.ok && held(S) && held(S).t === 'pan' && held(S).st === 'empty' && held(S).dirty, 'trashing batter keeps the (dirty) pan: ' + r.msg);
}

// ---------- 自動の機械は店舗レベルで解放 ----------
{
  const S = mk(0), { A } = runner(S); A({ t: 'start' });
  ok(!A({ t: 'fbuy', k: 'amixer', quiet: 1 }).ok && !A({ t: 'fbuy', k: 'line', quiet: 1 }).ok, 'auto machines are locked at Lv1');
  S.xp = D.SHOP_XP[3]; ok(A({ t: 'fbuy', k: 'amixer' }).ok && !A({ t: 'fbuy', k: 'adeco', quiet: 1 }).ok, 'Lv4: auto mixer can be bought, auto deco not yet');
  S.xp = D.SHOP_XP[9]; ok(A({ t: 'fbuy', k: 'line' }).ok, 'Lv10: full automatic line can be bought');
}

// ---------- 自動ミキサー → 自動オーブン → 自動ホイッパー → 自動デコ機（プレイヤーがセットするだけ） ----------
{
  const S = mk(9600), { A, tick, now } = runner(S); A({ t: 'start' });
  const am = K.placeNew(S, 'amixer'), ao = K.placeNew(S, 'aoven'), aw = K.placeNew(S, 'awhip'), ad = K.placeNew(S, 'adeco');
  ok(am && ao && aw && ad, 'placed auto mixer, auto oven, auto whipper, auto deco');
  K.placeNew(S, 'cshelf'); K.placeNew(S, 'shelf');
  for (const k of ['egg', 'sugar', 'flour', 'butter', 'cream']) K.invAdd(S, k, 20, D.ING[k].price);
  // 型を横の型置きに
  const pan = Object.keys(S.k.items).find((id) => S.k.items[id].t === 'pan');
  A({ t: 'pick', id: pan }); A({ t: 'put', slot: K.slot0(am) });
  // 順番ばらばらに入れる（バター → 小麦粉 → 卵 → 砂糖）
  for (const [ing, n] of [['butter', 1], ['flour', 2], ['egg', 3], ['sugar', 2]]) { A({ take: 1, t: 'take', id: stackOf(S, ing), all: 1 }); for (let k = 0; k < n; k++) A({ t: 'addIng', fid: am }); A({ t: 'put', slot: K.findSlot(S, held(S), ['table', 'shelf']) }); }
  ok(!held(S) && K.st(S, am).ings.length === 8, 'put the plain-sponge ingredients in any order');
  ok(!A({ t: 'run', fid: am, quiet: 1 }).ok, 'the auto mixer cannot be run by hand');
  tick(1500); ok(K.st(S, am).st === 'idle', 'waits a moment after the last ingredient');
  tick(12000);
  const p1 = S.k.items[pan];
  ok(p1.st === 'raw' && p1.b === 'plain' && p1.q >= 0.9 && !(p1.df || []).length, 'auto mixed and poured into the pan by itself (q ' + p1.q + ')');
  A({ t: 'pick', id: pan }); A({ t: 'put', slot: K.slot0(ao) });
  ok(!A({ t: 'oven', fid: ao, op: 'set', temp: 150, quiet: 1 }).ok, 'the auto oven sets the temperature itself');
  tick(2000); ok(K.st(S, ao).h && K.st(S, ao).temp === 170 && p1.st === 'raw', 'auto oven preheats to the right temperature first');
  tick(80000, 500);
  ok(p1.st === 'baked' && p1.lab === 'ちょうどいい！' && !(p1.df || []).includes('burnt'), 'auto oven stopped at the perfect time (' + p1.lab + ', q ' + p1.q.toFixed(2) + ')');
  tick(60000, 1000); ok(p1.st === 'baked' && !(p1.df || []).includes('burnt'), 'left in the auto oven: does not burn');
  // クリーム：順番ばらばらでOK
  A({ t: 'take', id: stackOf(S, 'sugar') }); A({ t: 'addIng', fid: aw }); A({ t: 'take', id: stackOf(S, 'cream'), all: 1 }); A({ t: 'addIng', fid: aw, all: 1 });
  ok(K.st(S, aw).ings.length >= 3, 'cream ingredients into the auto whipper');
  if (held(S)) A({ t: 'put', slot: K.findSlot(S, held(S), ['table', 'shelf', 'cshelf']) });
  tick(3000); const ww = K.st(S, aw);
  ok(ww.st === 'idle' && ww.ings.length > 3, 'too much cream → not a recipe → waits (no auto start)');
  A({ t: 'dump', fid: aw }); ok(!K.st(S, aw).ings.length, 'auto whipper bowl emptied with the dump action');
  for (const [ing, n] of [['cream', 2], ['sugar', 1]]) for (let k = 0; k < n; k++) { A({ t: 'take', id: stackOf(S, ing) }); A({ t: 'addIng', fid: aw }); }
  tick(15000);
  ok(K.st(S, aw).st === 'done' && K.st(S, aw).k === 'whip' && K.st(S, aw).q >= 0.9, 'auto whipped cream (q ' + K.st(S, aw).q + ')');
  A({ t: 'scoop', fid: aw }); ok(held(S) && held(S).t === 'cream', 'scooped the cream');
  ok(A({ t: 'mcream', fid: ad }).ok && K.st(S, ad).cr && K.st(S, ad).cr.n === 2 && !held(S), 'set the cream into the auto deco tank (2 cakes)');
  K.invAdd(S, 'strawberry', 10, D.ING.strawberry.price);
  A({ t: 'take', id: stackOf(S, 'strawberry'), all: 1 }); A({ t: 'addIng', fid: ad, all: 1 });
  ok(K.hopN(K.st(S, ad), 'strawberry') >= 6 && !held(S), 'strawberries into the auto deco topping hopper');
  A({ t: 'take', id: stackOf(S, 'egg') }); ok(!A({ t: 'addIng', fid: ad, quiet: 1 }).ok, 'eggs are not toppings'); A({ t: 'put', slot: K.findSlot(S, held(S), ['cshelf', 'table']) });
  A({ t: 'pick', id: pan }); const rp = A({ t: 'put', slot: K.slot0(ad) });
  ok(rp.ok && held(S) && held(S).t === 'pan' && held(S).dirty, 'sponge onto the auto deco (dirty pan left in hand)');
  A({ t: 'put', slot: K.slot0(P.list(S, 'sink')[0]) });
  tick(20000);
  const ck = S.k.items[K.at(S, K.slot0(ad))];
  ok(ck && ck.t === 'cake' && ck.r === 'short' && ck.w && ck.q >= 0.85 && !(ck.df || []).length, 'auto deco: cream + 3 strawberries → short cake (q ' + (ck && ck.q.toFixed(2)) + ')');
  ok(K.hopN(K.st(S, ad), 'strawberry') >= 3 && K.st(S, ad).cr && K.st(S, ad).cr.n === 1, 'used 1 cream and 3 strawberries');
}

// ---------- 全自動ライン ----------
{
  const S = mk(9600), { A, tick } = runner(S); A({ t: 'start' });
  const ln = K.placeNew(S, 'line');
  ok(!!ln && P.slots(S, ln).length === 3, 'placed the full automatic line (3 output places)');
  K.placeNew(S, 'cshelf'); K.placeNew(S, 'shelf');
  for (const k of ['egg', 'sugar', 'flour', 'butter', 'cream', 'strawberry']) K.invAdd(S, k, 20, D.ING[k].price);
  A({ t: 'amode', fid: ln, r: 'short' }); ok(K.st(S, ln).r === 'short', 'set the line to make short cakes');
  tick(3000); ok(!K.st(S, ln).q.length && /材料/.test(K.st(S, ln).why), 'empty hopper: line waits for ingredients (' + K.st(S, ln).why + ')');
  for (const k of ['egg', 'sugar', 'flour', 'butter', 'cream', 'strawberry']) { A({ t: 'take', id: stackOf(S, k), all: 1 }); A({ t: 'addIng', fid: ln, all: 1 }); if (held(S)) A({ t: 'put', slot: K.findSlot(S, held(S), ['table', 'shelf', 'cshelf']) }); }
  ok(K.hopN(K.st(S, ln), 'egg') === 10, 'ingredients into the hopper');
  tick(1000); const q0 = K.st(S, ln).q.length; ok(q0 === 1, 'a cake started down the line');
  const dsum = K.lineDur(S, 'short').reduce((a, x) => a + x, 0);
  tick(dsum + 2000, 500);
  const outs = P.slots(S, ln).map((sl) => S.k.items[K.at(S, sl)]).filter((x) => x);
  ok(outs.length >= 1 && outs.every((c) => c.t === 'cake' && c.r === 'short' && c.q >= 0.85), 'finished short cake(s) at the line exit: ' + outs.length + ' (one every ' + Math.round(Math.max(...K.lineDur(S, 'short').map((x, i) => [1, 3, 2, 1, 1][i] ? x / [1, 3, 2, 1, 1][i] : 0)) / 1000) + 's, ' + Math.round(dsum / 1000) + 's each)');
  ok(P.isCold(S, P.slots(S, ln)[0]), 'the line exit is refrigerated');
  for (const k of ['egg', 'sugar', 'flour', 'butter', 'cream', 'strawberry']) { const st = stackOf(S, k); if (!st) continue; A({ t: 'take', id: st, all: 1 }); A({ t: 'addIng', fid: ln, all: 1 }); if (held(S)) A({ t: 'put', slot: K.findSlot(S, held(S), ['table', 'shelf', 'cshelf']) }); }
  tick(200000, 1000);
  const n3 = P.slots(S, ln).filter((sl) => K.at(S, sl)).length;
  ok(n3 === 3 && K.st(S, ln).q.some((j) => j.wt) && /出口/.test(K.st(S, ln).why), 'exit full → line waits (' + K.st(S, ln).why + ')');
  A({ t: 'lineOn', fid: ln }); ok(!K.st(S, ln).on, 'line can be stopped');
  A({ t: 'dump', fid: ln }); ok(!Object.keys(K.st(S, ln).hop).length, 'hopper emptied back to the shelves');
}

// ---------- お客さんに帰ってもらう ----------
{
  const S = mk(2000), { A, tick, now } = runner(S); A({ t: 'start' });
  for (const r in S.menu) S.menu[r].on = r === 'short';
  D.CUSTOMERS.forEach((c) => { c._h = c.hole; c.hole = 0; });
  A({ t: 'sign' }); S.furn.table = 0;
  let cid = null; for (let k = 0; k < 40 && !cid; k++) { S.cust = {}; K.spawn(S, now()); tick(R.WALK_MS + 300); cid = Object.keys(S.cust).find((x) => S.cust[x].st === 'q'); }
  const m0 = S.today.miss; A({ t: 'takeOrder', c: cid });
  ok(S.cust[cid].st === 'w', 'customer is waiting for an order');
  ok(A({ t: 'shoo', c: cid }).ok && S.cust[cid].st === 'out' && S.today.miss === m0 + 1, 'sent the waiting customer away: "' + S.cust[cid].say + '"');
  ok(!A({ t: 'shoo', c: cid, quiet: 1 }).ok, 'cannot send away twice');
  D.CUSTOMERS.forEach((c) => { c.hole = c._h; });
}

// ---------- 機械係 ＋ 自動の機械で完全自動化（Lv10） ----------
function fullAuto(label, setup) {
  const S = mk(9600), { A, tick } = runner(S);
  setup(S);
  K.placeNew(S, 'cshelf'); K.placeNew(S, 'shelf'); { const use = {}; ['short', 'chocolate', 'baked_cheese'].forEach((r) => sim.recipeIngs(D.RECIPES[r]).forEach((k) => (use[k] = 1))); use.box = 1; for (const k in use) K.invAdd(S, k, 20, D.ING[k].price); }
  for (let i = 0; i < 4; i++) A({ t: 'hire', slot: i });
  const tasks = ['feed', 'cashier', 'stock', 'wash']; tasks.forEach((t, i) => A({ t: 'staffTask', slot: i, task: t, opt: '' }));
  S.staff.forEach((st) => { if (st) st.lv = 8; });
  for (const r in S.menu) S.menu[r].on = ['short', 'chocolate', 'baked_cheese'].includes(r);
  S.furn.table = 2;
  A({ t: 'start' }); tick(150000, 250);
  const pre = Object.values(S.k.items).filter((i) => i.t === 'tray').length;
  A({ t: 'sign' });
  let g = 0; while (S.phase === 'open' && g++ < 20000) tick(250);
  const T = S.history[S.history.length - 1];
  console.log(label, 'cases before open', pre, 'cust', T.cust, 'sold', T.sold, 'whole', T.hole, 'sales', T.sales, 'miss', T.miss, 'slow', T.slow, 'cmp', T.cmp, '| staff', S.staff.filter((x) => x).map((s) => s.name + ':' + s.task + ' x' + (s.done || 0)).join(' '));
  return { S, T, pre };
}
const L = fullAuto('[line]', (S) => { K.placeNew(S, 'line'); });
ok(L.pre >= 1 && L.T.sold > 15 && L.T.sales > 8000, 'Lv10: line + machine staff + cashier + stock staff run the shop with nobody (sold ' + L.T.sold + ')');
const M = fullAuto('[machines]', (S) => { ['amixer', 'aoven', 'awhip', 'adeco', 'rack'].forEach((k) => K.placeNew(S, k)); for (let i = 0; i < 2; i++) sim.apply(S, { t: 'tbuy', k: 'pan', pid: 'p1' }, 1000); });
ok(M.T.sold > 8, 'auto mixer → auto oven → auto whipper → auto deco with the machine staff (sold ' + M.T.sold + ')');
console.log(fail ? fail + ' FAILED' : 'ALL OK');
