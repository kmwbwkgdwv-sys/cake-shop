// でたらめな操作を大量に送って、例外・状態の矛盾（同じ置き場に違う物・手に2つ・在庫がマイナス・壁の中の家具など）が起きないか
global.window = global;
require('../js/data.js'); require('../js/sim.js'); require('../js/plan.js'); require('../js/kitchen.js');
const sim = CS.sim, K = CS.kitchen, D = CS.data, P = CS.plan;
let seed = +(process.argv[2] || 7);
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
Math.random = rnd;
const pick = (a) => a[Math.floor(rnd() * a.length)];
let now = 1000, errors = 0, checks = 0;
const S = sim.newState({}); S.funds = 900000; S.xp = 3000; sim.normalize(S); K.placeNew(S, 'crack');
const pids = ['p1', 'p2', 'p3'];
const ings = Object.keys(D.ING);
for (const k of ings) K.invAdd(S, k, 20, D.ING[k].price);
const fids = () => Object.keys(S.fu);
const allSlots = () => fids().reduce((a, f) => a.concat(P.slots(S, f)), []).concat(['f:zz:0', 'f:' + fids()[0] + ':99', 'dl:0', 'xx:1']);
const verbs = ['pick', 'take', 'take', 'put', 'put', 'put', 'trash', 'drop', 'addIng', 'addIng', 'run', 'run', 'pour', 'scoop', 'dump', 'oven', 'spreadDone', 'topPlace', 'topTake', 'finish', 'slice', 'unslice', 'caseTake', 'cut', 'cut', 'hole', 'unhole', 'openCrate', 'openCrate', 'floor', 'floor', 'shelve', 'shelve', 'washStart', 'wash', 'order', 'sign', 'takeOrder', 'serve', 'pay', 'fmove', 'fbuy', 'unpack', 'unpack', 'tbuy', 'endDay', 'next', 'start', 'price', 'upgrade', 'hire', 'staffTask', 'staffTask'];
function randomAction() {
  const pid = pick(pids), items = Object.keys(S.k.items);
  const t = pick(verbs);
  const a = { t, pid };
  const fid = pick(fids().concat(['nope']));
  switch (t) {
    case 'pick': case 'take': a.id = pick(items.concat(['nope'])); a.all = rnd() < 0.4 ? 1 : 0; break;
    case 'put': a.slot = pick(allSlots()); a.one = rnd() < 0.4 ? 1 : 0; break;
    case 'addIng': case 'run': case 'pour': case 'scoop': case 'dump': case 'spreadDone': case 'topPlace': case 'topTake': case 'finish': case 'washStart': case 'wash':
      a.fid = fid; a.q = rnd(); a.x = rnd() * 2 - 1; a.z = rnd() * 2 - 1; break;
    case 'oven': a.fid = fid; a.op = pick(['set', 'next', 'off']); a.temp = pick([150, 170, 190, 999]); break;
    case 'slice': case 'unslice': case 'caseTake': case 'cut': case 'hole': a.id = pick(K.trays(S).concat(K.holes(S)).concat(items).concat(['zz'])); break;
    case 'unhole': a.slot = pick(allSlots()); break;
    case 'shelve': a.slot = pick(allSlots()); a.all = rnd() < 0.5 ? 1 : 0; break;
    case 'order': a.items = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pick(ings)); break;
    case 'takeOrder': case 'serve': case 'pay': a.c = pick(Object.keys(S.cust).concat(['zz'])); a.ch = Math.floor(rnd() * 3000); break;
    case 'fmove': { const g = P.geomOf(S); a.id = fid; a.x = -g.RX + rnd() * g.RX * 2; a.z = -g.RZ + rnd() * (g.CZ + g.RZ); a.r = Math.floor(rnd() * 5); break; }
    case 'fbuy': a.k = pick(Object.keys(P.KINDS).concat(['zz'])); break;
    case 'hire': a.slot = Math.floor(rnd() * 9); break;
    case 'staffTask': a.slot = Math.floor(rnd() * 8); a.task = pick(Object.keys(D.STAFF.tasks).concat(['zz'])); a.opt = pick(['', 'short', 'chocolate', 'zz'].concat(fids())); break;
    case 'upgrade': a.id = pick(['storage', 'storage', 'floor']); break;
    case 'openCrate': a.close = rnd() < 0.4 ? 1 : 0; break;
    case 'floor': { const g = P.geomOf(S); a.x = -g.RX - 5 + rnd() * (g.RX * 2 + 5); a.z = -g.RZ + rnd() * (g.CZ + g.RZ); a.r = Math.floor(rnd() * 2); break; }
    case 'unpack': { const g = P.geomOf(S); a.x = -g.RX + rnd() * g.RX * 2; a.z = -g.RZ + rnd() * (g.CZ + g.RZ); a.r = Math.floor(rnd() * 4); break; }
    case 'tbuy': a.k = pick(['plate', 'pan', 'zz']); break;
    case 'price': a.r = 'short'; a.price = Math.floor(rnd() * 900); break;
    default: break;
  }
  return a;
}
const hit = (a, b) => a[0] < b[2] - 0.005 && a[2] > b[0] + 0.005 && a[1] < b[3] - 0.005 && a[3] > b[1] + 0.005;
function check() {
  checks++;
  const err = (m) => { errors++; if (errors < 15) console.log('NG', m); };
  const held = {}, slotK = {};
  for (const id in S.k.items) {
    const it = S.k.items[id], at = String(it.at);
    if (at.startsWith('h:')) { if (held[at]) err('two in hand ' + at); held[at] = 1; continue; }
    if (at.startsWith('f:')) {
      const sd = P.slotDef(S, at); if (!sd) { err('bad slot ' + at + ' ' + it.t); continue; }
      if (it.t === 'crate' && sd.kind !== 'table' && sd.type !== 'crate') err('crate in a shelf ' + sd.kind);
      if (sd.type === 'crate' && it.t !== 'crate') err('non-crate in a crate rack ' + it.t);
      const k = K.skey(it) || 'one:' + id;
      if (slotK[at] && slotK[at] !== k) err('mixed slot ' + at + ' ' + slotK[at] + ' / ' + k);
      slotK[at] = k;
      continue;
    }
    if (at.startsWith('c:')) { if (!S.cust[at.slice(2)]) err('orphan c: ' + id); continue; }
    if (at.startsWith('seat:') || at.startsWith('dl:')) continue;
    if (at === 'fl') { if (!(it.t === 'crate' || it.t === 'fcrate')) err('non-crate on floor ' + it.t); else if (P.floorOk(S, it, it.fx, it.fz, it.fr, id)) err('bad floor spot ' + id + ' ' + P.floorOk(S, it, it.fx, it.fz, it.fr, id)); continue; }
    if (it.t === 'fcrate') { err('fcrate in slot ' + at); continue; }
    err('weird at ' + at);
  }
  for (const id in S.k.items) { const it = S.k.items[id]; if (it.t === 'ing' && !(it.n > 0)) err('empty stack ' + id); if (it.t === 'ing' && it.n > (K.slotCap ? K.slotCap(S, it.at, it) : K.STACK_CAP.ing)) err('over cap ' + id); }
  for (const ing of ings) if (K.invCount(S, ing) < 0) err('neg inv ' + ing);
  for (const id in S.k.items) { const it = S.k.items[id]; if ((it.t === 'box' && K.boxUnits(it) > 6) || (it.t === 'plate' && K.boxUnits(it) > 3)) err('overfull ' + it.t); if ((it.t === 'cake' || it.t === 'tray') && (it.w && it.p !== it.n || !(it.p > 0))) err('bad cake ' + JSON.stringify(it)); }
  if (!isFinite(S.funds)) err('funds NaN');
  // 家具が壁・ほかの家具と重なっていない
  const ids = fids(), g = P.geomOf(S);
  ids.forEach((a, i) => {
    const fa = S.fu[a]; if (P.KINDS[fa.k].counter) return;
    const ba = P.box(fa);
    for (const w of g.walls) if (hit(ba, w)) err('furn in wall ' + a + ' ' + fa.k);
    for (let j = i + 1; j < ids.length; j++) { const fb = S.fu[ids[j]]; if (!P.KINDS[fb.k].counter && hit(ba, P.box(fb))) err('furn overlap ' + a + ' ' + ids[j]); }
  });
  try { JSON.parse(JSON.stringify(S)); } catch (e) { err('json'); }
}
const stats = {};
for (let step = 0; step < 30000; step++) {
  const a = randomAction();
  try { const r = sim.apply(S, a, now); stats[a.t] = stats[a.t] || [0, 0]; stats[a.t][r && r.ok ? 0 : 1]++; }
  catch (e) { errors++; if (errors < 15) console.log('THROW', a.t, e.stack.split('\n').slice(0, 3).join(' | ')); }
  now += 120 + Math.floor(rnd() * 600);
  try { sim.tick(S, now); } catch (e) { errors++; if (errors < 15) console.log('TICK THROW', e.stack.split('\n').slice(0, 3).join(' | ')); }
  if (step % 50 === 0) check();
  if (step % 997 === 0) { const copy = JSON.parse(JSON.stringify(S)); sim.normalize(copy); }
}
check();
console.log('ok verbs', Object.keys(stats).filter((k) => stats[k][0] > 0).length, '/', Object.keys(stats).length, JSON.stringify(stats));
console.log(errors ? 'FUZZ FAIL ' + errors : 'FUZZ OK', 'checks', checks, 'items', Object.keys(S.k.items).length, 'furn', fids().length, 'day', S.day);
