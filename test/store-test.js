// 倉庫（店の横の別棟）：間取り・拡張・古いセーブの引っ越し・アルバイトが倉庫まで取りに行く時間
global.window = global;
['data', 'sim', 'plan', 'kitchen'].forEach((f) => require('../js/' + f + '.js'));
const K = CS.kitchen, P = CS.plan, sim = CS.sim, D = CS.data;
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const mk = (xp) => { const S = sim.newState({}); S.funds = 2e6; S.xp = xp; S.rep = 3.5; sim.normalize(S); return S; };
const A = (S, a, now) => sim.apply(S, Object.assign({ pid: 'p1' }, a), now || 1000);
const zone = (S, id) => P.zoneOf(P.geomOf(S), S.fu[id].x, S.fu[id].z);
const allValid = (S) => Object.keys(S.fu).every((id) => !S.fu[id].bad && !P.valid(S, id, S.fu[id].k, S.fu[id].x, S.fu[id].z, S.fu[id].r));

// ---- 新しいお店：倉庫は店の外（左横）の別棟、最初の棚・冷蔵棚・冷蔵庫はその中 ----
{
  const S = mk(0), g = P.geomOf(S);
  ok(g.store.x1 < -g.RX - 1 && g.store.z0 === -g.RZ, 'the storage is a separate building beside the shop (x ' + g.store.x0.toFixed(1) + '〜' + g.store.x1.toFixed(1) + ', shop wall at ' + (-g.RX) + ')');
  ok(['shelf', 'cshelf', 'fridge'].every((k) => P.list(S, k).every((id) => zone(S, id) === 'store')), 'starting shelf / cold shelf / fridge are inside the storage building');
  ok(allValid(S), 'starting layout is valid');
  ok(P.zoneOf(g, (g.link.x0 + g.link.x1) / 2, g.link.z) === 'link' && P.zoneOf(g, 0, -5) === 'kit' && P.zoneOf(g, g.ox - 1, 0) === 'out', 'zones: kitchen / link corridor / storage / outside');
  const sh = P.list(S, 'shelf')[0], f = S.fu[sh], d = P.walkLen(g, 3, -6, f.x, f.z + 0.6);
  ok(d > Math.hypot(3 - f.x, -6 - f.z) && d < 40, 'walking from the kitchen to the storage goes through the corridor (' + d.toFixed(1) + 'm)');
  ok(g.truck.x < g.ox - 2 && Math.abs(g.truck.z - g.backDoor.z - 3) < 1e-9, 'the truck parks in the alley next to the storage back door');
  // 新しく買った棚は倉庫へ、機械は厨房へ
  const nsh = K.placeNew(S, 'shelf'), nov = K.placeNew(S, 'oven');
  ok(zone(S, nsh) === 'store' && zone(S, nov) === 'kit', 'a new shelf goes to the storage, a new oven to the kitchen');
  // 倉庫の中にも置ける・廊下やドアの前は置けない
  const sd = g.store;
  ok(!P.valid(S, null, 'table', sd.x0 + 2.5, sd.z1 - 1.2, 0), 'furniture can be placed inside the storage');
  ok(!!P.valid(S, null, 'table', (g.link.x0 + g.link.x1) / 2, g.link.z, 0), 'not in the link corridor');
  ok(!!P.valid(S, null, 'table', sd.x1 - 0.6, g.link.z, 1), 'not in front of the corridor door');
  ok(!!P.valid(S, null, 'table', sd.x0 + 0.5, g.backDoor.z, 1), 'not in front of the back door');
}
// ---- 倉庫の拡張：建物ごと大きくなる（家具はそのまま） ----
{
  const S = mk(9600), area = (q) => (q.x1 - q.x0) * (q.z1 - q.z0), a0 = P.geomOf(S).store, ids = Object.keys(S.fu).sort(), pos = JSON.stringify(ids.map((id) => [S.fu[id].x, S.fu[id].z]));
  const sizes = [area(a0)];
  for (let i = 0; i < 3; i++) { ok(A(S, { t: 'upgrade', id: 'storage' }).ok, 'storage upgrade ' + (i + 1)); sizes.push(area(P.geomOf(S).store)); }
  ok(sizes.every((v, i) => !i || v > sizes[i - 1] + 5), 'storage area grows each step: ' + sizes.map((v) => v.toFixed(1) + '㎡').join(' → '));
  const g = P.geomOf(S);
  ok(g.store.x0 < a0.x0 - 2.5 && g.store.z1 > a0.z1 + 4, 'the building grows outward and forward');
  ok(allValid(S) && JSON.stringify(ids.map((id) => [S.fu[id].x, S.fu[id].z])) === pos, 'furniture stays where it was');
  // 増床しても倉庫の家具は倉庫に
  for (let i = 0; i < 3; i++) A(S, { t: 'upgrade', id: 'floor' });
  ok((S.up.floor || 0) === 3 && ['shelf', 'cshelf', 'fridge'].every((k) => P.list(S, k).every((id) => zone(S, id) === 'store')) && allValid(S), 'after enlarging the shop, the storage furniture is still in the storage');
}
// ---- 前の間取り（倉庫が店の中の左奥）のセーブ：倉庫の家具を別棟へそのまま引っ越す ----
{
  const S = mk(9600); S.up.storage = 2;
  const g = P.geomOf(S), RX = g.RX, RZ = g.RZ;
  // 前の倉庫（x -RX〜-RX+6.2・奥行き 4.6+1.3×2）の中に並べ直して、古いデータにする
  const old = [['cshelf', -RX + 0.72, -RZ + 0.34, 0], ['fridge', -RX + 2.25, -RZ + 0.4, 0], ['shelf', -RX + 3.7, -RZ + 0.28, 0], ['shelf', -RX + 0.28, -RZ + 4.5, 1], ['crack', -RX + 3.0, -RZ + 6.6, 0]];
  for (const k of ['cshelf', 'fridge', 'shelf']) P.list(S, k).forEach((id) => delete S.fu[id]);
  const ids = old.map(([k, x, z, r]) => K.addFurn(S, k, x, z, r));
  const sh = ids[2]; S.k.items.egg1 = { t: 'ing', ing: 'egg', n: 10, lots: [[10, 999999, 30]], at: 'f:' + sh + ':0', pl: 0 };
  S.k.items.cr1 = { t: 'crate', ing: 'flour', n: 10, lots: [[10, 999999, 30]], at: 'fl', fx: -RX + 4.6, fz: -RZ + 3.0, fr: 0, open: 0 };
  delete S.k.wh;
  K.normalize(S);
  ok(S.k.wh === 2, 'migration runs once (k.wh = 2)');
  ok(ids.every((id) => S.fu[id] && zone(S, id) === 'store'), 'old storage furniture moved into the storage building: ' + ids.map((id) => S.fu[id].k + '@' + zone(S, id)).join(' '));
  const dx = S.fu[ids[1]].x - S.fu[ids[0]].x, dz = S.fu[ids[1]].z - S.fu[ids[0]].z;
  ok(Math.abs(dx - 1.53) < 1e-6 && Math.abs(dz - 0.06) < 1e-6, 'the layout inside the storage is kept');
  ok(S.k.items.egg1.at === 'f:' + sh + ':0', 'ingredients on the shelves move with the shelves');
  ok(P.zoneOf(P.geomOf(S), S.k.items.cr1.fx, S.k.items.cr1.fz) === 'store' && !P.floorOk(S, S.k.items.cr1, S.k.items.cr1.fx, S.k.items.cr1.fz, 0, 'cr1'), 'a crate on the old storage floor moved too');
  ok(allValid(S), 'all furniture valid after the move');
  const before = JSON.stringify(S.fu); K.normalize(S); ok(JSON.stringify(S.fu) === before, 'normalize again changes nothing');
}
// ---- パソコン室は厨房の奥の右の角。前の位置（右の角）にあった家具は近くの空いている所へ ----
{
  const S = mk(0), g = P.geomOf(S);
  ok(g.pc.x1 === g.RX && g.pc.z0 === -g.RZ, 'the PC room is in the back-right corner of the kitchen');
  ok(Object.keys(S.fu).every((id) => P.zoneOf(g, S.fu[id].x, S.fu[id].z) !== 'pc'), 'no starting furniture inside the PC room');
  // 前の間取りのお店：洗い場とゴミ箱が奥の右の角にあった
  for (const k of ['sink', 'trash']) P.list(S, k).forEach((id) => delete S.fu[id]);
  S.fu.oldSink = { k: 'sink', x: g.RX - 1.1, z: -g.RZ + 0.37, r: 0 }; S.fu.oldTrash = { k: 'trash', x: g.RX - 0.3, z: -g.RZ + 1.4, r: 3 };
  K.normalize(S);
  ok(['oldSink', 'oldTrash'].every((id) => S.fu[id] && P.zoneOf(g, S.fu[id].x, S.fu[id].z) === 'kit' && !P.valid(S, id, S.fu[id].k, S.fu[id].x, S.fu[id].z, S.fu[id].r)), 'sink / trash that were in the corner moved out next to the PC room: ' + ['oldSink', 'oldTrash'].map((id) => S.fu[id].x.toFixed(2) + ',' + S.fu[id].z.toFixed(2)).join(' '));
  ok(allValid(S), 'all furniture valid');
}
// ---- アルバイト：倉庫まで取りに行く時間が仕事にかかる ----
{
  const S = mk(9600), line = K.placeNew(S, 'line'), sh = P.list(S, 'shelf')[0];
  const near = K.walkMs(S, { k: 'f-hop', from: line, fid: line }), far = K.walkMs(S, { k: 'f-hop', from: sh, fid: line });
  ok(near < 500 && far > 4000 && far < 30000, 'fetching from the storage adds walking time (' + (far / 1000).toFixed(1) + 's)');
}
console.log(fail ? fail + ' FAILED' : 'ALL OK');
