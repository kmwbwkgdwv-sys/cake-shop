// でたらめな操作を大量に送って、例外・状態の矛盾（同じ置き場に2つ・手に2つ・在庫がマイナスなど）が起きないか
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data;
let seed = +(process.argv[2] || 7);
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
Math.random = rnd;
const pick = (a) => a[Math.floor(rnd() * a.length)];
let now = 1000, errors = 0, checks = 0;
const S = sim.newState({}); S.funds = 500000; S.xp = 3000; sim.normalize(S);
const pids = ['p1', 'p2', 'p3'];
const ings = Object.keys(D.ING);
const slots = () => {
  const out = [];
  ['sp', 'rk', 'pk', 'fr', 'mo', 'ov', 'dt'].forEach((k) => { for (let i = 0; i < 14; i++) out.push(k + ':' + i); });
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) { out.push('wo:' + i + ':' + k); out.push('dp:' + i + ':' + k); }
  for (let i = 0; i < 8; i++) out.push('cs:' + i);
  out.push('dl:0', 'xx:1', 'sp:-1', 'sp:1.5');
  return out;
};
const SL = slots();
function randomAction() {
  const pid = pick(pids), items = Object.keys(S.k.items);
  const t = pick(['pick', 'put', 'put', 'trash', 'newPan', 'newBox', 'takeTop', 'addIng', 'addIng', 'run', 'run', 'pour', 'scoop', 'dump', 'oven', 'spreadDone', 'topPlace', 'finish', 'slice', 'caseTake', 'openCrate', 'shelve', 'shelve', 'order', 'sign', 'takeOrder', 'serve', 'endDay', 'next', 'buy', 'menu']);
  const a = { t, pid };
  switch (t) {
    case 'pick': a.id = pick(items.concat(['nope'])); break;
    case 'put': a.slot = pick(SL); break;
    case 'takeTop': a.k = pick(Object.keys(D.TOPS).concat(['flour'])); break;
    case 'addIng': a.st = pick(['mix', 'whip', 'deco', 'xx']); a.i = Math.floor(rnd() * 4); a.ing = pick(ings); break;
    case 'run': a.st = pick(['mix', 'whip', 'deco']); a.i = Math.floor(rnd() * 4); break;
    case 'pour': case 'scoop': case 'spreadDone': case 'topPlace': case 'finish': a.i = Math.floor(rnd() * 4); a.q = rnd(); a.x = rnd() * 2 - 1; a.z = rnd() * 2 - 1; break;
    case 'dump': a.st = pick(['mix', 'whip']); a.i = Math.floor(rnd() * 4); break;
    case 'oven': a.i = Math.floor(rnd() * 5); a.op = pick(['set', 'next', 'off']); a.temp = pick([150, 170, 190, 999]); break;
    case 'slice': case 'caseTake': a.ci = Math.floor(rnd() * 9); break;
    case 'shelve': a.ing = pick(ings); a.all = rnd() < 0.5 ? 1 : 0; break;
    case 'order': a.items = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pick(ings)); break;
    case 'takeOrder': case 'serve': a.c = pick(Object.keys(S.cust).concat(['zz'])); break;
    case 'buy': a.id = pick(ings); a.n = 10; break;
    case 'menu': a.t = 'price'; a.r = 'short'; a.price = Math.floor(rnd() * 900); break;
  }
  return a;
}
function check(label) {
  checks++;
  const bad = [];
  const at = {};
  for (const id in S.k.items) {
    const it = S.k.items[id];
    const k = String(it.at);
    if (at[k] && !k.startsWith('h:') ) bad.push('two items at ' + k);
    if (k.startsWith('h:') && at[k]) bad.push('two items in hand ' + k);
    at[k] = id;
    if (it.t === 'crate' && !(it.n >= 0)) bad.push('crate n ' + it.n);
    if (it.df && !Array.isArray(it.df)) bad.push('df not array');
    if (it.wm != null && !(it.wm >= 0)) bad.push('wm ' + it.wm);
    const p = k.split(':')[0];
    if (!['h', 'dl'].includes(p) && !K.validSlot(S, k)) bad.push('invalid slot ' + k + ' ' + it.t);
  }
  for (const id in S.inv) for (const l of S.inv[id]) if (!(l[0] > 0) || !isFinite(l[1]) || !isFinite(l[2])) bad.push('inv lot ' + id + JSON.stringify(l));
  if (!isFinite(S.funds)) bad.push('funds ' + S.funds);
  if (!isFinite(S.rep) || S.rep < 1 || S.rep > 5) bad.push('rep ' + S.rep);
  S.showcase.forEach((c, i) => { if (c && !(c.p > 0)) bad.push('showcase ' + i + ' p ' + c.p); });
  try { JSON.parse(JSON.stringify(S)); } catch (e) { bad.push('json'); }
  if (bad.length) { errors++; if (errors < 8) console.log('BAD', label, bad.slice(0, 4).join(' | ')); }
}
sim.apply(S, { t: 'start', pid: 'p1' }, now);
for (let step = 0; step < 60000; step++) {
  const a = randomAction();
  try { sim.apply(S, a, now); } catch (e) { errors++; if (errors < 8) console.log('THROW', JSON.stringify(a), e.stack.split('\n').slice(0, 3).join(' ')); }
  if (step % 3 === 0) { now += 250 + Math.floor(rnd() * 3000); try { sim.tick(S, now); } catch (e) { errors++; if (errors < 8) console.log('TICK THROW', e.stack.split('\n').slice(0, 3).join(' ')); } }
  if (step % 50 === 0) { check('step ' + step + ' ' + a.t); if (S.funds < 50000) S.funds += 200000; if (S.bankrupt) S.bankrupt = 0; }
  if (step % 400 === 0) for (const k of ings) if (sim.invCount(S, k) < 5) sim._.invAdd(S, k, 20, D.ING[k].price);
  // ときどき保存→読み込み（Firebase は空の配列・オブジェクトを消すので、それも再現）
  if (step % 997 === 0) {
    const strip = (o) => { if (Array.isArray(o)) { const a2 = o.map(strip); return a2.length ? a2 : undefined; } if (o && typeof o === 'object') { const r = {}; for (const k in o) { const v = strip(o[k]); if (v !== undefined && v !== null && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) r[k] = v; } return r; } return o; };
    const S2 = sim.normalize(strip(JSON.parse(JSON.stringify(S))));
    Object.keys(S).forEach((k) => delete S[k]); Object.assign(S, S2);
  }
}
check('end');
console.log('day', S.day, 'phase', S.phase, 'items', Object.keys(S.k.items).length, 'history', S.history.length, 'spoiled total', S.history.reduce((a, h) => a + (h.spl || 0), 0), 'checks', checks);
console.log(errors ? errors + ' ERRORS' : 'FUZZ OK');
