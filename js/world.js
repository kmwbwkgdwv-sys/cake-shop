/* ケーキ屋さんシミュレーター : 3D のお店（一人称視点）
 *  ・歩いて物を「持つ・置く・使う」。照準の先にあるものが操作の対象
 *  ・お店の大きさ・設備の数は増床レベルで変わる（data.SHOP_SIZES / KITCHEN）
 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data, sim = CS.sim, ST = CS.settings, K = CS.kitchen;
  const { Geo, Builder, Node, Engine, rgb, mix } = CS.gl;
  const MD = CS.models;
  const PI = Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const angLerp = (a, b, t) => { let d = b - a; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return a + d * t; };
  const shade = (c, t) => (t < 0 ? mix(c, '#000000', -t) : mix(c, '#ffffff', t));
  const WH = 3.2, OVEN_DX = 1.35, REACH = 2.4, CASE_X0 = -4.5, CAKE_SC = 1.5;
  const MIX_BINS = ['egg', 'sugar', 'flour', 'butter', 'milk', 'cream', 'cheese', 'cocoa', 'matcha'];
  const WHIP_BINS = ['cream', 'sugar', 'milk', 'egg', 'choco', 'matcha', 'chestnut', 'lemon'];
  const TOP_BINS = ['strawberry', 'blueberry', 'peach', 'lemon', 'choco', 'chestnut'];
  const BIN_NAME = { cream: '生クリーム', cheese: 'チーズ', blueberry: 'ベリー', chestnut: '栗', strawberry: 'いちご', peach: 'もも' };
  const ING_COL = { flour: '#F3EFE6', egg: '#F2D9A8', sugar: '#FBFAF6', butter: '#F4DD8A', milk: '#F7F6F1', cream: '#FFFDF6', strawberry: '#C8102E', blueberry: '#2E3560', peach: '#F6A06B', lemon: '#F7D94C', choco: '#4A2A1C', cocoa: '#6B4030', matcha: '#7E9B4E', cheese: '#F3E7C2', chestnut: '#9A5A22' };
  let RX = 10, RZ = 8, CASE_Z = 0, KZ = 0, LK = '';
  const W = (CS.world = { ready: false });
  W.dims = {};

  // =====================================================================
  //  レイアウト（設備の位置はここで決める。sim はスロット ID だけを使う）
  // =====================================================================
  function layout(s) {
    const lv = s ? clamp(s.up.floor || 0, 0, 3) : 0;
    const d = D.SHOP_SIZES[lv];
    RX = d.rx; RZ = d.rz; CASE_Z = -RZ + d.kd; KZ = CASE_Z + 0.42;
    const cnt = (k) => (s ? K.count(s, k) : Array.isArray(D.KITCHEN[k]) ? D.KITCHEN[k][0] : D.KITCHEN[k]);
    const L = { lv, nMix: cnt('mix'), nWhip: cnt('whip'), nDeco: cnt('deco'), nReg: cnt('reg'), nOven: s ? s.ovens.length : 3, nCase: s ? s.showcase.length : 4 };
    const bz = -RZ + 0.42;
    L.panShelf = [-RX + 0.72, -RZ + 0.42];
    L.mix = []; for (let i = 0; i < L.nMix; i++) { const x = -RX + 2.25 + i * 1.7; L.mix.push({ x, z: bz, bowl: [x - 0.18, 0.92, bz + 0.05], pan: [x + 0.5, 0.92, bz + 0.1], bins: MIX_BINS.map((ing, k) => ({ ing, p: [x - 0.66 + k * 0.165, 1.36, bz - 0.2] })), stand: [x, bz + 0.95] }); }
    const ox0 = -RX + 2.25 + L.nMix * 1.7 + 0.15;
    L.ovens = []; for (let i = 0; i < L.nOven; i++) { const x = ox0 + i * OVEN_DX; L.ovens.push({ x, z: -RZ + 0.5, slot: [x, 0.8, -RZ + 0.62], stand: [x, -RZ + 1.55] }); }
    L.sink = [ox0 + L.nOven * OVEN_DX - 0.25, RX - 1.05];
    L.rack = []; [-RZ + 2.0, -RZ + 3.15].forEach((rz) => [0.5, 0.95, 1.4].forEach((y) => [-0.22, 0.22].forEach((dz) => L.rack.push([RX - 0.42, y + 0.01, rz + dz]))));
    L.racks = [[RX - 0.42, -RZ + 2.0], [RX - 0.42, -RZ + 3.15]];
    L.desk = [RX - 0.55, -RZ + 4.7];
    const z1 = -RZ + 3.0, z2 = -RZ + 5.4;
    L.deco = []; for (let i = 0; i < L.nDeco; i++) { const x = -RX + 3.4 + i * 2.6; L.deco.push({ x, z: z1, tt: [x, 0.975, z1 + 0.06], side: [[x - 0.66, 0.915, z1 + 0.2], [x + 0.66, 0.915, z1 + 0.2]], bins: TOP_BINS.map((ing, k) => ({ ing, p: [x - 0.62 + k * 0.248, 0.96, z1 - 0.3] })), stand: [x, z1 + 0.95] }); }
    L.whip = []; for (let i = 0; i < L.nWhip; i++) { const x = -RX + 3.1 + i * 2.25; L.whip.push({ x, z: z2, bowl: [x - 0.12, 0.915, z2 + 0.06], bins: WHIP_BINS.map((ing, k) => ({ ing, p: [x - 0.72 + k * 0.17, 0.96, z2 - 0.3] })), out: [[x + 0.66, 0.915, z2 - 0.12], [x + 0.66, 0.915, z2 + 0.2]], stand: [x, z2 + 0.95] }); }
    const wx0 = -RX + 3.1 + L.nWhip * 2.25 - 0.4, wx1 = RX - 2.3;
    L.work = [wx0, wx1, z2];
    L.spots = []; for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) L.spots.push([wx0 + 0.35 + (k * (wx1 - wx0 - 0.7)) / 5, 0.915, z2 - 0.2 + r * 0.4]);
    L.backDoor = [-RX, -RZ + 1.55];
    L.deliv = []; for (let j = 0; j < D.KITCHEN.deliv; j++) L.deliv.push([-RX + 0.6 + (j % 2) * 0.62, 0.12, -RZ + 2.45 + Math.floor(j / 2) * 0.62]);
    L.shelf = [-RX + 0.36, -RZ + 6.1];
    L.trash = [[-RX + 0.5, -RZ + 7.6], [RX - 0.55, -RZ + 6.4]];
    L.cases = []; for (let i = 0; i < 8; i++) L.cases.push([CASE_X0 + i, 0.92, CASE_Z]);
    L.reg = []; for (let l = 0; l < L.nReg; l++) { const c = 4.3 + l * 1.6; L.reg.push({ x: c, z: CASE_Z, till: [c - 0.3, 1.05, CASE_Z], pk: [c + 0.38, 0.96, CASE_Z + 0.02] }); }
    L.pack = L.reg.map((r) => r.pk);
    L.counter = [3.3, 4.3 + (L.nReg - 1) * 1.6 + 0.8];
    L.boxStack = [3.58, 0.96, CASE_Z];
    L.board = [-RX + 0.09, CASE_Z + 1.6];
    L.sign = [1.75, RZ + 0.95];
    L.pc = [RX - 0.6, 1.0, -RZ + 4.7];
    L.lamps = []; for (let x = -RX + 1.8; x <= RX - 1.2; x += 3.4) for (let z = -RZ + 1.8; z <= RZ - 1.2; z += 3.2) L.lamps.push([x, z]);
    L.queue = (l, k) => [L.reg[l] ? L.reg[l].x : 4.3, CASE_Z + 1.0 + k * 0.75];
    L.waitAt = (k) => [2.4 - (k % 8) * 0.85, CASE_Z + 1.05 + Math.floor(k / 8) * 0.8];
    L.tables = []; for (let z = CASE_Z + 3.2; z <= RZ - 1.3; z += 1.9) for (let x = -RX + 1.8; x <= -2.6; x += 2.1) L.tables.push([x, z]);
    for (let z = CASE_Z + 6.4; z <= RZ - 1.4; z += 1.9) for (let x = 3.6; x <= RX - 1.8; x += 2.1) L.tables.push([x, z]);
    L.key = [lv, L.nMix, L.nWhip, L.nDeco, L.nReg, L.nOven, L.nCase].join(',');
    W.dims = { RX, RZ, CASE_Z, KZ, LV: lv };
    return L;
  }
  W.L = layout(null);
  W.tablePos = (s) => W.L.tables.slice(0, (s && s.furn && s.furn.table) || 0);
  W.seatPos = (s, i) => { const t = W.tablePos(s)[i >> 1]; if (!t) return null; const sd = i % 2 ? 1 : -1; return { x: t[0] + sd * 0.62, z: t[1], r: sd > 0 ? -PI / 2 : PI / 2 }; };
  // スロット ID → 3D 位置
  W.slotPos = function (slot) {
    const [k, a, b] = String(slot).split(':'); const i = +a, L = W.L;
    switch (k) {
      case 'mo': return L.mix[i] && L.mix[i].pan;
      case 'ov': return L.ovens[i] && L.ovens[i].slot;
      case 'rk': return L.rack[i];
      case 'wo': return L.whip[i] && L.whip[i].out[+b];
      case 'dt': return L.deco[i] && L.deco[i].tt;
      case 'dp': return L.deco[i] && L.deco[i].side[+b];
      case 'dl': return L.deliv[i];
      case 'sp': return L.spots[i];
      case 'pk': return L.pack[i];
      default: return null;
    }
  };
  const kindOf = (slot) => String(slot).split(':')[0];

  // =====================================================================
  //  初期化
  // =====================================================================
  W.init = function (host) {
    W.host = host;
    host.innerHTML = '<canvas id="gl3d" aria-label="お店の中"></canvas><div class="labels" id="labels"></div><div class="xhair" id="xhair"></div>';
    const canvas = host.querySelector('canvas');
    // 前のエンジンのテクスチャは使えないので作り直す
    W.T = null; W.boardTex = null; W.signTex = null; W.openTex = null; W.blobTex = null; W.blobMesh = null; for (const k in meshCache) delete meshCache[k];
    let e;
    try { e = W.eng = new Engine(canvas, { aa: !ST.light }); } catch (err) { host.innerHTML = '<div class="banner" style="margin:20px">この端末では 3D 表示（WebGL）が使えません。</div>'; W.ready = false; return false; }
    e.env.light = norm3([0.3, 0.8, 0.52]);
    e.env.sky = [0.52, 0.52, 0.54]; e.env.ground = [0.28, 0.24, 0.21]; e.env.sun = [1.55, 1.46, 1.32];
    e.env.fog = rgb('#D7DEE5'); e.env.fogR = [40, 95]; e.env.clear = rgb('#9EBBD6'); e.env.expo = 1.08;
    W.scene = new Node();
    W.labels = host.querySelector('#labels');
    W.me = { x: 0, z: 0, yaw: 0, pitch: -0.18, vx: 0, vz: 0, bob: 0, speed: 0 };
    W.items = {}; W.others = {}; W.custs = {}; W.staffN = {}; W.ovens = []; W.kb = {}; W.keys = {}; W.lbl = {}; W.alerted = {};
    LK = ''; W.L = layout(null);
    W.buildStatic();
    W.applyQuality();
    W.me.x = 0.6; W.me.z = CASE_Z - 1.3; W.me.yaw = 0.15;
    W.bindInput(canvas);
    W.ready = true;
    W.last = performance.now();
    return true;
  };
  W.destroy = function () { W.ready = false; W.unbind && W.unbind(); if (document.pointerLockElement) document.exitPointerLock(); if (W.eng) { const x = W.eng.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } if (W.host) W.host.innerHTML = ''; };
  W.applyQuality = function () {
    const e = W.eng; if (!e) return;
    e.scale = ST.light ? 0.55 : 1;
    e.shadows = !ST.light;
    e.outline = 0;
    e.smSize = ST.light ? 1024 : 2048;
    e.shadowRadius = 9;
    W.nLights = ST.light ? 2 : 4;
    if (W.people) W.people.kids.forEach((n) => n.kids.forEach((k) => { if (k.isBlob) k.vis = !e.shadows; }));
    if (W.extras) W.extras.vis = !ST.light;
  };
  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

  // =====================================================================
  //  静的なお店（素材ごとに1メッシュへ結合）
  // =====================================================================
  const C = {
    oak: rgb('#C49A6C'), walnut: rgb('#6B4630'), white: rgb('#F3EFE8'), sage: rgb('#8FA58A'), navy: rgb('#2F3E4E'),
    steel: rgb('#C7CBD0'), dark: rgb('#2A2624'), leaf: rgb('#4E7A43'), terracotta: rgb('#B86B4B'), cream: rgb('#F5EEE2'), card: rgb('#C69C6D'),
  };
  W.obstacles = [];
  function block(x0, z0, x1, z1) { W.obstacles.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]); }
  W.buildStatic = function () {
    const e = W.eng, sc = W.scene, L = W.L;
    W.obstacles = [];
    const T = W.T || (W.T = {
      oak: e.texFromCanvas(MD.TX.wood('#C9A174', '#8A6142', 90), true), walnut: e.texFromCanvas(MD.TX.wood('#6E4A33', '#3E2618', 70), true),
      marble: e.texFromCanvas(MD.TX.marble(), true), steel: e.texFromCanvas(MD.TX.brushed(), true),
      ktile: e.texFromCanvas(MD.TX.ktile(), true), parquet: e.texFromCanvas(MD.TX.parquet(), true),
      plaster: e.texFromCanvas(MD.TX.plaster('#EFE8DD'), true), panel: e.texFromCanvas(MD.TX.panel(), true), asphalt: e.texFromCanvas(MD.TX.asphalt(), true),
      walk: e.texFromCanvas(MD.TX.sidewalk(), true), grass: e.texFromCanvas(MD.TX.grass(), true), facade: e.texFromCanvas(MD.TX.facade(), true),
      sky: e.texFromCanvas(MD.TX.sky(), false), ceil: e.texFromCanvas(MD.TX.plaster('#F6F3EE'), true),
    });
    const mats = {
      oak: { tex: T.oak, rough: 0.55 }, walnut: { tex: T.walnut, rough: 0.45 }, marble: { tex: T.marble, rough: 0.18 }, steel: { tex: T.steel, rough: 0.32, metal: 1 },
      paint: { rough: 0.6 }, gloss: { rough: 0.22 }, cloth: { rough: 0.9 }, brass: { rough: 0.28, metal: 1 }, plant: { rough: 0.7 }, facade: { tex: T.facade, rough: 0.8 },
    };
    const BB = {};
    const P = (m, g, p, r, s, color, opt) => { (BB[m] = BB[m] || new Builder()).put(g, p, r, s, color || [1, 1, 1], Object.assign({ rough: mats[m].rough, metal: mats[m].metal || 0 }, opt || {})); };
    // ---------- 外 ----------
    sc.add(new Node(e.mesh(Geo.sphere(90, 24, 12)), { tex: T.sky, em: 1, cast: false, recv: false, twoSide: true }));
    const ground = (g, tex, p, rough) => { const n = new Node(e.mesh(g, null, { rough }), { tex, cast: false, ao: 0 }); n.p = p; sc.add(n); };
    ground(Geo.plane(160, 40, 40, 10), T.asphalt, [0, -0.03, RZ + 9], 0.85);
    ground(Geo.plane(90, 5, 22, 1.25), T.walk, [0, -0.01, RZ + 2.5], 0.8);
    ground(Geo.plane(90, 40, 22, 10), T.grass, [0, -0.02, -RZ - 20], 0.95);
    ground(Geo.plane(30, 90, 7, 22), T.walk, [-RX - 15.2, -0.015, 0], 0.8); ground(Geo.plane(30, 90, 7, 22), T.walk, [RX + 15.2, -0.015, 0], 0.8);
    // ---------- 床・天井 ----------
    const kd = KZ + RZ, fd = RZ - KZ;
    const kf = new Node(e.mesh(Geo.plane(RX * 2, kd, (RX * 2) / 0.6, kd / 0.6), null, { rough: 0.4 }), { tex: T.ktile, cast: false, ao: 0 }); kf.p = [0, 0.001, -RZ + kd / 2]; sc.add(kf);
    const ff = new Node(e.mesh(Geo.plane(RX * 2, fd, (RX * 2) / 1.2, fd / 1.2), null, { rough: 0.38 }), { tex: T.parquet, cast: false, ao: 0 }); ff.p = [0, 0.001, KZ + fd / 2]; sc.add(ff);
    P('brass', Geo.box(RX * 2, 0.006, 0.04), [0, 0.004, KZ]);
    const ceil = new Node(e.mesh(Geo.plane(RX * 2 + 0.4, RZ * 2 + 0.4, RX, RZ), null, { rough: 0.9 }), { tex: T.ceil, cast: false, ao: 0, r: [PI, 0, 0] }); ceil.p = [0, WH, 0]; sc.add(ceil);
    // ---------- 壁（影は落とさない：窓際が暗くならないように） ----------
    W.walls = {};
    const wall = (name, parts, inner) => {
      const B = new Builder(), WB = new Builder(), TR = new Builder();
      parts.forEach((q) => B.put(Geo.box(q[3], q[4], q[5], 1), [q[0], q[1], q[2]], 0, 1, [1, 1, 1], { rough: 0.85 }));
      inner.forEach((q) => { WB.put(Geo.box(q[3], q[4], q[5], 1), [q[0], q[1], q[2]], 0, 1, [1, 1, 1], { rough: 0.5 }); TR.put(Geo.box(q[3] + 0.02, 0.05, q[5] + 0.03), [q[0], q[1] + q[4] / 2 + 0.02, q[2]], 0, 1, rgb('#F7F3EC'), { rough: 0.4 }); TR.put(Geo.box(q[3] + 0.02, 0.1, q[5] + 0.01), [q[0], 0.05, q[2]], 0, 1, C.walnut, { rough: 0.5 }); });
      const n = sc.add(new Node(B.build(e), { tex: T.plaster, ao: 0, cast: false }));
      if (!WB.empty()) n.add(new Node(WB.build(e), { tex: T.panel, ao: 0, cast: false }));
      if (!TR.empty()) n.add(new Node(TR.build(e), { ao: 0, cast: false }));
      W.walls[name] = n;
      return n;
    };
    wall('back', [[0, WH / 2, -RZ - 0.1, RX * 2 + 0.4, WH, 0.2]], [[0, 0.5, -RZ + 0.03, RX * 2, 1.0, 0.06]]);
    const bd = L.backDoor[1];
    wall('left', [[-RX - 0.1, WH / 2, (bd - 0.6 - RZ) / 2, 0.2, WH, bd - 0.6 + RZ], [-RX - 0.1, WH / 2, (bd + 0.6 + RZ) / 2, 0.2, WH, RZ - bd - 0.6], [-RX - 0.1, 2.65, bd, 0.2, 1.1, 1.2]], [[-RX + 0.03, 0.5, (bd + 0.6 + RZ) / 2, 0.06, 1.0, RZ - bd - 0.6]]);
    wall('right', [[RX + 0.1, WH / 2, 0, 0.2, WH, RZ * 2]], [[RX - 0.03, 0.5, 0, 0.06, 1.0, RZ * 2]]);
    P('steel', Geo.box(0.06, 2.1, 1.1), [-RX - 0.05, 1.05, bd], 0, 1, rgb('#9AA0A6'));
    P('steel', Geo.cyl(0.015, 0.015, 0.25, 8), [-RX + 0.02, 1.05, bd + 0.35], [PI / 2, 0, 0]);
    block(-RX - 1, bd - 0.6, -RX, bd + 0.6);
    // 正面：腰壁・窓・入口（幅 1.44m）
    const fz = RZ + 0.1, DW = 0.72, ww = RX - 1.8, wc = (RX + 0.6) / 2;
    const front = wall('front', [
      [-(RX + DW) / 2, 0.45, fz, RX - DW, 0.9, 0.2], [(RX + DW) / 2, 0.45, fz, RX - DW, 0.9, 0.2], [0, 2.75, fz, RX * 2 + 0.4, 0.9, 0.2],
      [-RX + 0.3, 1.6, fz, 0.6, 1.4, 0.2], [-0.96, 1.6, fz, 0.48, 1.4, 0.2], [0.96, 1.6, fz, 0.48, 1.4, 0.2], [RX - 0.3, 1.6, fz, 0.6, 1.4, 0.2],
    ], []);
    const FB = new Builder();
    [-wc, wc].forEach((x) => {
      FB.put(Geo.box(ww + 0.05, 0.07, 0.14), [x, 2.3, fz], 0, 1, C.dark, { rough: 0.4 }); FB.put(Geo.box(ww + 0.05, 0.08, 0.32), [x, 0.92, fz], 0, 1, C.dark, { rough: 0.4 });
      const nmul = Math.max(1, Math.round(ww / 1.3)); for (let i = 1; i < nmul; i++) FB.put(Geo.box(0.05, 1.4, 0.1), [x - ww / 2 + (i * ww) / nmul, 1.6, fz], 0, 1, C.dark, { rough: 0.4 });
    });
    FB.put(Geo.box(DW * 2 + 0.1, 0.08, 0.24), [0, 2.32, fz], 0, 1, C.dark, { rough: 0.4 });
    const na = Math.floor((RX * 2 - 0.4) / 0.5);
    for (let i = 0; i < na; i++) FB.put(Geo.box(0.5, 0.025, 1.15), [-(na - 1) * 0.25 + i * 0.5, 2.55, RZ + 0.62], [0.42, 0, 0], 1, i % 2 ? C.cream : rgb('#2F4A3F'), { rough: 0.85 });
    FB.put(Geo.cyl(0.02, 0.02, na * 0.5, 8), [0, 2.32, RZ + 1.1], [0, 0, PI / 2], 1, C.dark, { rough: 0.4 });
    FB.put(Geo.box(0.05, 2.2, 0.74), [-DW, 1.1, RZ + 0.55], 0, 1, C.walnut, { rough: 0.45 });
    FB.put(Geo.box(0.05, 2.2, 0.74), [DW, 1.1, RZ + 0.55], 0, 1, C.walnut, { rough: 0.45 });
    front.add(new Node(FB.build(e), { cast: false }));
    const glass = (w, h, p, r) => { const n = new Node(e.mesh(Geo.box(w, h, 0.02), null, { rough: 0.05 }), { color: rgb('#BFD8E6'), op: 0.16, cast: false, recv: false }); n.p = p; if (r) n.r = r; front.add(n); };
    glass(ww, 1.38, [-wc, 1.6, fz]); glass(ww, 1.38, [wc, 1.6, fz]);
    block(-RX - 1, RZ - 0.02, -DW, RZ + 0.25); block(DW, RZ - 0.02, RX + 1, RZ + 0.25);
    block(-DW - 0.05, RZ + 0.2, -DW + 0.05, RZ + 0.92); block(DW - 0.05, RZ + 0.2, DW + 0.05, RZ + 0.92);

    // ---------- 奥：型の棚・ミキサー台・オーブン・洗い場 ----------
    const [psx, psz] = L.panShelf;
    P('steel', Geo.rbox(1.0, 0.04, 0.6, 0.01), [psx, 0.9, psz]); P('steel', Geo.rbox(1.0, 0.04, 0.6, 0.01), [psx, 0.45, psz]);
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => P('steel', Geo.cyl(0.018, 0.018, 1.3, 8), [psx + sx * 0.46, 0.65, psz + sz * 0.26])));
    for (let k = 0; k < 5; k++) { const px = psx - 0.3 + (k % 3) * 0.3, py = 0.92 + Math.floor(k / 3) * 0.072; P('steel', Geo.cyl(0.11, 0.105, 0.065, 24, 0, PI * 2, true), [px, py + 0.033, psz], 0, 1, rgb('#9AA0A6')); P('steel', Geo.cyl(0.105, 0.105, 0.004, 24), [px, py + 0.002, psz], 0, 1, rgb('#9AA0A6')); }
    for (let k = 0; k < 3; k++) P('steel', Geo.rbox(0.36, 0.02, 0.26, 0.004), [psx, 0.48 + k * 0.025, psz], 0, 1, rgb('#8C9298'));
    block(psx - 0.5, -RZ, psx + 0.5, psz + 0.32);
    const counter = (x0, x1, z, d, top) => { const w = x1 - x0, cx = (x0 + x1) / 2; P('steel', Geo.rbox(w, 0.86, d, 0.015), [cx, 0.43, z]); P(top || 'steel', Geo.rbox(w + 0.02, 0.04, d + 0.02, 0.01), [cx, 0.88, z]); };
    L.mix.forEach((m) => {
      counter(m.x - 0.8, m.x + 0.8, m.z, 0.72);
      // 材料の入れ物（壁の棚）
      P('steel', Geo.rbox(1.6, 0.025, 0.28, 0.005), [m.x, 1.27, m.z - 0.19]);
      [-0.78, 0.78].forEach((dx) => P('steel', Geo.box(0.02, 0.4, 0.26), [m.x + dx, 1.08, m.z - 0.19]));
      m.bins.forEach((b) => { P('gloss', Geo.rbox(0.15, 0.13, 0.2, 0.02), [b.p[0], 1.35, b.p[2]], 0, 1, rgb('#F2F0EC'), { rough: 0.15 }); P('paint', Geo.rbox(0.13, 0.04, 0.18, 0.01), [b.p[0], 1.4, b.p[2]], 0, 1, rgb(ING_COL[b.ing] || '#ddd'), { rough: 0.7 }); });
      // スタンドミキサー本体
      const mc = rgb('#9C2F3A'), mx = m.bowl[0], mz = m.z;
      P('gloss', Geo.rbox(0.3, 0.07, 0.38, 0.03), [mx, 0.935, mz - 0.03], 0, 1, mc);
      P('gloss', Geo.rbox(0.14, 0.46, 0.17, 0.05), [mx, 1.16, mz - 0.17], 0, 1, mc);
      P('gloss', Geo.rbox(0.19, 0.14, 0.42, 0.06), [mx, 1.42, mz - 0.05], 0, 1, mc);
      P('paint', Geo.cyl(0.05, 0.05, 0.02, 16), [mx, 1.42, mz + 0.17], [PI / 2, 0, 0], 1, rgb('#E6E2DA'));
      P('paint', Geo.box(0.3, 0.003, 0.3), [m.pan[0], 0.902, m.pan[2]], 0, 1, rgb('#BFC4C8'));
      block(m.x - 0.8, -RZ, m.x + 0.8, m.z + 0.37);
    });
    if (L.sink[1] - L.sink[0] > 0.8) {
      counter(L.sink[0], L.sink[1], -RZ + 0.38, 0.7);
      const scx = L.sink[0] + 0.55;
      P('steel', Geo.rbox(0.62, 0.03, 0.44, 0.01), [scx, 0.875, -RZ + 0.4], 0, 1, rgb('#7E848A'));
      P('steel', Geo.cyl(0.015, 0.015, 0.35, 8), [scx, 1.05, -RZ + 0.13]); P('steel', Geo.cyl(0.012, 0.012, 0.25, 8), [scx, 1.22, -RZ + 0.25], [PI / 2, 0, 0]);
      P('steel', Geo.rbox(L.sink[1] - L.sink[0], 0.03, 0.3, 0.01), [(L.sink[0] + L.sink[1]) / 2, 1.75, -RZ + 0.17]);
      for (let x = L.sink[0] + 0.25; x < L.sink[1] - 0.15; x += 0.38) P('gloss', Geo.cyl(0.11, 0.08, 0.06, 18), [x, 1.8, -RZ + 0.17], 0, 1, rgb('#E8E2D8'), { rough: 0.2 });
      block(L.sink[0], -RZ, L.sink[1], -RZ + 0.74);
    }
    // ---------- 冷却ラック・経営デスク（右壁） ----------
    L.racks.forEach(([rx, rz]) => {
      [-0.45, 0.45].forEach((dz) => [-0.3, 0.3].forEach((dx) => P('steel', Geo.cyl(0.014, 0.014, 1.7, 6), [rx + dx, 0.85, rz + dz])));
      [0.5, 0.95, 1.4].forEach((y) => { for (let i = 0; i < 8; i++) P('steel', Geo.cyl(0.005, 0.005, 0.62, 4), [rx, y, rz - 0.42 + i * 0.12], [0, 0, PI / 2]); P('steel', Geo.box(0.62, 0.012, 0.012), [rx, y, rz + 0.46]); P('steel', Geo.box(0.62, 0.012, 0.012), [rx, y, rz - 0.46]); });
      block(rx - 0.35, rz - 0.5, RX, rz + 0.5);
    });
    const [bx, bz2] = L.desk;
    P('walnut', Geo.rbox(0.8, 0.04, 1.3, 0.01), [bx, 0.76, bz2]);
    [-1, 1].forEach((s2) => P('walnut', Geo.box(0.75, 0.74, 0.04), [bx, 0.37, bz2 + s2 * 0.6]));
    P('gloss', Geo.rbox(0.04, 0.34, 0.56, 0.01), [bx + 0.2, 1.03, bz2], [0, 0, 0.08], 1, rgb('#1A1A1A'));
    P('gloss', Geo.rbox(0.05, 0.16, 0.06, 0.01), [bx + 0.24, 0.85, bz2], 0, 1, rgb('#2A2A2A'));
    P('gloss', Geo.rbox(0.16, 0.012, 0.42, 0.004), [bx - 0.12, 0.785, bz2], 0, 1, rgb('#2A2A2A'));
    P('cloth', Geo.rbox(0.48, 0.07, 0.48, 0.03), [bx - 0.65, 0.47, bz2], 0, 1, rgb('#6B4A3A'));
    P('cloth', Geo.rbox(0.07, 0.48, 0.46, 0.03), [bx - 0.88, 0.75, bz2], 0, 1, rgb('#6B4A3A'));
    block(bx - 0.42, bz2 - 0.68, RX, bz2 + 0.68);
    W.pcScreen = new Node(e.mesh(Geo.box(0.005, 0.28, 0.5), '#FFFFFF', { rough: 0.2 }), { em: 1, color: rgb('#3E6A8A'), cast: false });
    W.pcScreen.p = [bx + 0.172, 1.03, bz2]; W.pcScreen.r = [0, 0, 0.08];
    // ---------- アイランド（デコ台・クリーム台・作業台） ----------
    const island = (x, z, w, col, top) => {
      P(top || 'marble', Geo.rbox(w, 0.05, 0.95, 0.012), [x, 0.885, z]);
      P('paint', Geo.rbox(w - 0.08, 0.82, 0.86, 0.02), [x, 0.43, z], 0, 1, col);
      for (let i = 0; i < Math.max(1, Math.round(w / 0.9)); i++) P('brass', Geo.cyl(0.012, 0.012, 0.12, 8), [x - w / 2 + 0.45 + i * 0.9, 0.7, z + 0.44], [0, 0, PI / 2]);
      block(x - w / 2, z - 0.48, x + w / 2, z + 0.48);
    };
    L.deco.forEach((d) => {
      island(d.x, d.z, 1.9, C.navy);
      P('steel', Geo.cyl(0.05, 0.2, 0.06, 28), [d.tt[0], 0.94, d.tt[2]], 0, 1, rgb('#D8DCE0'));
      d.bins.forEach((b) => { P('gloss', Geo.rbox(0.2, 0.06, 0.16, 0.02), [b.p[0], 0.94, b.p[2]], 0, 1, rgb('#F2F0EC'), { rough: 0.15 }); for (let k = 0; k < 6; k++) P('paint', Geo.sphere(0.022, 8, 6), [b.p[0] - 0.055 + (k % 3) * 0.055, 0.972, b.p[2] - 0.03 + Math.floor(k / 3) * 0.06], [k, k * 0.7, 0], [1, 0.8, 1], rgb(ING_COL[b.ing] || '#ddd'), { rough: 0.35 }); });
      P('steel', Geo.rbox(0.03, 0.005, 0.24, 0.002), [d.x + 0.36, 0.915, d.z + 0.34], [0, 1.2, 0]);
      d.side.forEach((q) => P('paint', Geo.box(0.3, 0.003, 0.3), [q[0], 0.912, q[2]], 0, 1, rgb('#BFC4C8')));
    });
    L.whip.forEach((w) => {
      island(w.x, w.z, 2.0, C.sage);
      w.bins.forEach((b) => { P('gloss', Geo.rbox(0.15, 0.08, 0.16, 0.02), [b.p[0], 0.95, b.p[2]], 0, 1, rgb('#F2F0EC'), { rough: 0.15 }); P('paint', Geo.rbox(0.13, 0.02, 0.14, 0.005), [b.p[0], 0.99, b.p[2]], 0, 1, rgb(ING_COL[b.ing] || '#ddd'), { rough: 0.7 }); });
      w.out.forEach((o) => P('paint', Geo.cyl(0.14, 0.14, 0.006, 20), [o[0], 0.912, o[2]], 0, 1, rgb('#D9D4CC')));
    });
    if (L.work[1] - L.work[0] > 1) island((L.work[0] + L.work[1]) / 2, L.work[2], L.work[1] - L.work[0], C.sage, 'steel');
    L.spots.forEach((p) => P('paint', Geo.box(0.32, 0.003, 0.32), [p[0], 0.912, p[2]], 0, 1, rgb('#BFC4C8')));
    // ---------- 左：裏口の配達置き場・在庫棚・ゴミ箱 ----------
    for (let k = 0; k < 7; k++) P('oak', Geo.box(1.3, 0.025, 0.3), [-RX + 0.9, 0.11, -RZ + 2.15 + k * 0.4], 0, 1, rgb('#B08A60'));
    for (let k = 0; k < 3; k++) P('oak', Geo.box(0.1, 0.09, 2.6), [-RX + 0.3 + k * 0.6, 0.045, -RZ + 3.35], 0, 1, rgb('#9A7550'));
    const [shx, shz] = L.shelf;
    P('oak', Geo.box(0.03, 1.95, 2.0), [shx - 0.02, 0.975, shz]);
    [-1, 1].forEach((sd) => P('oak', Geo.box(0.6, 1.95, 0.03), [shx + 0.29, 0.975, shz + sd * 0.985]));
    [0.06, 0.5, 1.0, 1.5, 1.94].forEach((y) => P('oak', Geo.box(0.6, 0.03, 1.97), [shx + 0.29, y, shz]));
    for (let k = 0; k < 12; k++) P(k % 3 ? 'cloth' : 'oak', Geo.rbox(0.36, 0.3, 0.34, k % 3 ? 0.06 : 0.01), [shx + 0.36, 0.67 + Math.floor(k / 4) * 0.5, shz - 0.7 + (k % 4) * 0.46], [0, (k % 3) * 0.08, 0], 1, rgb(['#E5DCCB', '#D8CBB3', '#C9B79C', '#F0E6D2'][k % 4]));
    block(-RX, shz - 1.0, -RX + 0.65, shz + 1.0);
    L.trash.forEach(([x, z]) => { P('steel', Geo.cyl(0.22, 0.19, 0.62, 20), [x, 0.31, z], 0, 1, rgb('#5A5F64')); P('steel', Geo.cyl(0.235, 0.235, 0.04, 20), [x, 0.64, z], 0, 1, rgb('#3A3E42')); block(x - 0.25, z - 0.25, x + 0.25, z + 0.25); });
    // ---------- ショーケース・レジカウンター ----------
    const cw = 8.2, cx = CASE_X0 + 3.5;
    P('walnut', Geo.rbox(cw, 0.86, 0.72, 0.02), [cx, 0.43, CASE_Z]);
    for (let i = 0; i < 8; i++) P('oak', Geo.rbox(0.9, 0.5, 0.02, 0.008), [CASE_X0 + i, 0.48, CASE_Z + 0.365]);
    P('brass', Geo.box(cw, 0.03, 0.02), [cx, 0.08, CASE_Z + 0.37]);
    P('marble', Geo.rbox(cw + 0.06, 0.04, 0.8, 0.012), [cx, 0.88, CASE_Z]);
    [-1, 1].forEach((s2) => P('brass', Geo.box(0.03, 0.5, 0.6), [cx + s2 * (cw / 2 - 0.02), 1.15, CASE_Z]));
    P('brass', Geo.box(cw, 0.025, 0.025), [cx, 1.4, CASE_Z + 0.29]);
    P('brass', Geo.box(cw, 0.025, 0.025), [cx, 1.4, CASE_Z - 0.29]);
    block(cx - cw / 2, CASE_Z - 0.4, cx + cw / 2, CASE_Z + 0.4);
    const cg = new Node(e.mesh(Geo.box(cw - 0.08, 0.48, 0.02), null, { rough: 0.04 }), { color: rgb('#D6E7EE'), op: 0.12, cast: false, recv: false }); cg.p = [cx, 1.15, CASE_Z + 0.29]; sc.add(cg);
    const cg2 = new Node(e.mesh(Geo.box(cw - 0.08, 0.02, 0.58), null, { rough: 0.04 }), { color: rgb('#D6E7EE'), op: 0.1, cast: false, recv: false }); cg2.p = [cx, 1.4, CASE_Z]; sc.add(cg2);
    const [cx0, cx1] = L.counter, ccx = (cx0 + cx1) / 2;
    P('walnut', Geo.rbox(cx1 - cx0, 0.92, 0.72, 0.02), [ccx, 0.46, CASE_Z]);
    P('marble', Geo.rbox(cx1 - cx0 + 0.06, 0.04, 0.8, 0.012), [ccx, 0.94, CASE_Z]);
    block(cx0, CASE_Z - 0.4, cx1, CASE_Z + 0.4);
    L.reg.forEach((r) => {
      P('gloss', Geo.rbox(0.32, 0.08, 0.3, 0.02), [r.till[0], 1.0, CASE_Z], 0, 1, C.dark);
      P('gloss', Geo.rbox(0.3, 0.2, 0.02, 0.01), [r.till[0], 1.15, CASE_Z - 0.04], [-0.35, 0, 0], 1, rgb('#151515'));
      P('brass', Geo.cyl(0.02, 0.03, 0.12, 10), [r.till[0], 1.06, CASE_Z - 0.06]);
      P('paint', Geo.box(0.34, 0.003, 0.3), [r.pk[0], 0.962, r.pk[2]], 0, 1, rgb('#E9E2D6'));
      // 列の仕切り（ベルトパーテーション）
      [r.x - 0.45, r.x + 0.45].forEach((xx) => [1.0, 3.2].forEach((dz) => { P('brass', Geo.cyl(0.025, 0.025, 0.9, 10), [xx, 0.45, CASE_Z + dz]); P('steel', Geo.cyl(0.14, 0.16, 0.03, 16), [xx, 0.015, CASE_Z + dz], 0, 1, C.dark); }));
      [r.x - 0.45, r.x + 0.45].forEach((xx) => P('cloth', Geo.box(0.012, 0.05, 2.2), [xx, 0.85, CASE_Z + 2.1], 0, 1, rgb('#7A1F2B')));
    });
    for (let k = 0; k < 6; k++) P('paint', Geo.rbox(0.26, 0.1, 0.22, 0.008), [L.boxStack[0], 1.01 + k * 0.1, CASE_Z], [0, k * 0.05, 0], 1, rgb(k % 2 ? '#F7F5F0' : '#EFEBE3'));
    // ---------- 売り場 ----------
    const [mbx, mbz] = L.board;
    P('walnut', Geo.rbox(0.06, 1.3, 1.9, 0.01), [mbx - 0.04, 1.75, mbz]);
    const plant = (x, z, s2) => { P('paint', Geo.cyl(0.2 * s2, 0.15 * s2, 0.4 * s2, 18), [x, 0.2 * s2, z], 0, 1, C.terracotta); for (let i = 0; i < 7; i++) P('plant', Geo.sphere(0.12 * s2, 10, 8), [x + Math.sin(i * 2.4) * 0.12 * s2, (0.5 + i * 0.07) * s2, z + Math.cos(i * 2.4) * 0.12 * s2], [i * 0.5, 0, 0.3], [1, 1.6, 0.5], shade(C.leaf, (i % 3) * 0.08)); block(x - 0.25 * s2, z - 0.25 * s2, x + 0.25 * s2, z + 0.25 * s2); };
    plant(-RX + 0.7, RZ - 0.7, 1.2); plant(RX - 0.7, RZ - 0.7, 1.2);
    // 窓ぎわのベンチと、焼き菓子の陳列棚（雰囲気用）
    [-1, 1].forEach((sd) => { const bx0 = sd * (1.9 + (RX - 3.6) / 2), bw = RX - 4.6; P('oak', Geo.rbox(bw, 0.06, 0.42, 0.02), [bx0, 0.46, RZ - 0.3], 0, 1, rgb('#C9A174')); P('walnut', Geo.box(bw - 0.1, 0.43, 0.36), [bx0, 0.215, RZ - 0.3]); P('cloth', Geo.rbox(bw - 0.1, 0.06, 0.38, 0.03), [bx0, 0.52, RZ - 0.3], 0, 1, rgb('#2F4A3F')); block(bx0 - bw / 2, RZ - 0.52, bx0 + bw / 2, RZ); });
    { const rx = RX - 0.25, rz = CASE_Z + 3.4; P('walnut', Geo.box(0.04, 1.8, 1.6), [rx + 0.18, 0.9, rz]); [0.35, 0.8, 1.25, 1.7].forEach((y, k) => { P('walnut', Geo.box(0.38, 0.03, 1.6), [rx, y, rz]); if (k < 3) for (let i = 0; i < 5; i++) P('paint', Geo.rbox(0.12, 0.16, 0.2, 0.02), [rx, y + 0.095, rz - 0.6 + i * 0.3], [0, 0.1 * (i % 2), 0], 1, rgb(['#E8D9C4', '#D9C2A3', '#F2E6D8', '#C9A35E', '#E9CFC9'][(i + k) % 5]), { rough: 0.6 }); }); block(rx - 0.2, rz - 0.82, RX, rz + 0.82); }
    // ---------- 天井の照明 ----------
    const LB = new Builder();
    L.lamps.forEach(([x, z]) => { LB.put(Geo.cyl(0.26, 0.26, 0.03, 28), [x, WH - 0.015, z], 0, 1, rgb('#F2EFE8'), { rough: 0.4 }); LB.put(Geo.cyl(0.21, 0.21, 0.01, 28), [x, WH - 0.032, z], 0, 1, rgb('#FFF4DF'), { rough: 0.2 }); });
    sc.add(new Node(LB.build(e), { cast: false, em: 1, recv: false }));
    // ---------- 外：街並み ----------
    const EB = new Builder();
    for (let i = 0; i < 16; i++) { const x = -38 + i * 5; EB.put(Geo.box(4.6, 6 + (i % 3), 6), [x, 3 + (i % 3) / 2, RZ + 20], 0, 1, [1, 1, 1], { rough: 0.85 }); }
    [[-RX - 6, -2, 4, 5], [RX + 6, -3, 4, 6]].forEach(([x, z, w, h]) => EB.put(Geo.box(w, h, 8), [x, h / 2, z], 0, 1, [1, 1, 1], { rough: 0.85 }));
    W.extras = sc.add(new Node(EB.build(e), { tex: T.facade, cast: false }));
    [[-RX - 2, RZ + 3], [RX + 2, RZ + 3], [-RX / 2 - 0.5, RZ + 3], [RX / 2 + 0.5, RZ + 3]].forEach(([x, z]) => { P('walnut', Geo.cyl(0.12, 0.16, 2.2, 8), [x, 1.1, z]); for (let k = 0; k < 5; k++) P('plant', Geo.sphere(0.8, 10, 8), [x + Math.sin(k * 1.3) * 0.5, 2.4 + (k % 2) * 0.4, z + Math.cos(k * 1.3) * 0.4], 0, [1, 0.85, 1], shade(C.leaf, (k % 3) * 0.1 - 0.05)); });
    W.staticNodes = [];
    for (const m in BB) { const n = new Node(BB[m].build(e), { tex: mats[m].tex || null }); sc.add(n); W.staticNodes.push(n); }
    sc.add(W.pcScreen);
    // メニューボード（黒板）
    if (!W.boardCv) { W.boardCv = document.createElement('canvas'); W.boardCv.width = 512; W.boardCv.height = 512; }
    W.boardTex = W.boardTex || e.texFromCanvas(W.boardCv, false);
    const board = new Node(e.mesh(Geo.card(1.75, 1.15), null, { rough: 0.8 }), { tex: W.boardTex, ao: 0 });
    board.p = [mbx, 1.75, mbz]; board.r = [0, PI / 2, 0]; sc.add(board);
    // 看板（店の上・拡張で出現）
    W.signTex = W.signTex || e.texFromCanvas(MD.TX.sign('ケーキ屋さん'), false);
    W.signNode = sc.add(new Node(e.mesh(Geo.box(3.2, 0.8, 0.1), null, { rough: 0.5 }), { tex: W.signTex, cast: false }));
    W.signNode.p = [0, 3.62, RZ + 0.22]; W.signNode.vis = false;
    // 店の前の OPEN / CLOSE 看板（A型スタンド）
    W.openCv = W.openCv || document.createElement('canvas'); W.openCv.width = 256; W.openCv.height = 320;
    W.openTex = W.openTex || e.texFromCanvas(W.openCv, false);
    const SB = new Builder();
    [-1, 1].forEach((sd) => { SB.put(Geo.box(0.62, 0.9, 0.035), [0, 0.45, sd * 0.13], [sd * -0.16, 0, 0], 1, C.walnut, { rough: 0.5 }); });
    const stand = new Node(SB.build(e)); stand.p = [L.sign[0], 0, L.sign[1]]; sc.add(stand);
    [-1, 1].forEach((sd) => { const f = new Node(e.mesh(Geo.card(0.52, 0.68), null, { rough: 0.85 }), { tex: W.openTex, cast: false }); f.p = [0, 0.47, sd * 0.155]; f.r = [sd * -0.16, sd > 0 ? 0 : PI, 0]; stand.add(f); });
    block(L.sign[0] - 0.35, L.sign[1] - 0.3, L.sign[0] + 0.35, L.sign[1] + 0.3);
    W.drawOpen(false);
    // 動くもの用
    W.caseGroup = sc.add(new Node()); W.ovenGroup = sc.add(new Node()); W.itemGroup = sc.add(new Node());
    W.stationGroup = sc.add(new Node()); W.decoGroup = sc.add(new Node()); W.people = sc.add(new Node());
    W.blobTex = W.blobTex || e.texFromCanvas(MD.TX.shadow(), false);
    W.blobMesh = W.blobMesh || e.mesh(Geo.plane(1, 1));
    W.buildStations();
  };
  W.drawOpen = function (open) {
    const g = W.openCv.getContext('2d'), w = 256, h = 320;
    g.fillStyle = '#1F2A24'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#C9A96E'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    g.textAlign = 'center'; g.fillStyle = open ? '#9BE08A' : '#F19C8C';
    g.font = '700 60px "Zen Kaku Gothic New",sans-serif'; g.fillText(open ? 'OPEN' : 'CLOSED', w / 2, 140);
    g.fillStyle = '#E8D3A6'; g.font = '500 30px "Zen Kaku Gothic New",sans-serif'; g.fillText(open ? '営業中' : '準備中', w / 2, 200);
    g.font = '500 22px "Zen Kaku Gothic New",sans-serif'; g.fillText('PÂTISSERIE', w / 2, 262);
    if (W.eng && W.openTex) W.eng.updateTex(W.openTex, W.openCv);
  };
  // ミキサーのボウル・泡立てボウル・回転台（中身が変わる部分）
  W.buildStations = function () {
    const e = W.eng, L = W.L;
    W.stationGroup.clear(); W.st = { mix: [], whip: [], deco: [] };
    const stl = { rough: 0.25, metal: 1 };
    const bowlB = new Builder(); bowlB.put(Geo.cyl(0.16, 0.1, 0.16, 28, 0, PI * 2, true), [0, 0.08, 0], 0, 1, rgb('#C7CBD0'), stl); bowlB.put(Geo.cyl(0.1, 0.1, 0.004, 24), [0, 0.002, 0], 0, 1, rgb('#C7CBD0'), stl); bowlB.put(Geo.torus(0.16, 0.006, 6, 28), [0, 0.16, 0], [PI / 2, 0, 0], 1, rgb('#D6D9DD'), stl);
    const bowlM = bowlB.build(e);
    W.fillM = []; for (let k = 1; k <= 10; k++) { const h = 0.014 * k, rt = 0.1 + (0.06 * (h + 0.004)) / 0.16 - 0.006; W.fillM.push(e.mesh(Geo.cyl(rt, 0.094, h, 24), '#FFFFFF', { rough: 0.5 })); }
    const whiskB = new Builder(); for (let k = 0; k < 4; k++) whiskB.put(Geo.torus(0.04, 0.003, 4, 16), [0, -0.05, 0], [0, (k * PI) / 4, PI / 2], [1, 1.6, 1], rgb('#D8DBDF'), stl); whiskB.put(Geo.cyl(0.006, 0.006, 0.16, 6), [0, 0.06, 0], 0, 1, rgb('#D8DBDF'), stl);
    const whiskM = whiskB.build(e);
    const mkBowl = (p) => { const n = W.stationGroup.add(new Node(bowlM)); n.p = p.slice(); const f = n.add(new Node(W.fillM[0], { cast: false })); f.vis = false; const w = n.add(new Node(whiskM, { cast: false })); w.p = [0, 0.24, 0]; return { n, f, w, lv: 0 }; };
    L.mix.forEach((m) => W.st.mix.push(mkBowl([m.bowl[0], 0.97, m.bowl[2]])));
    L.whip.forEach((m) => W.st.whip.push(mkBowl([m.bowl[0], 0.915, m.bowl[2]])));
    L.deco.forEach((d) => { const n = W.stationGroup.add(new Node(e.mesh(Geo.cyl(0.2, 0.2, 0.012, 36), '#E6E9EC', { rough: 0.3, metal: 1 }))); n.p = [d.tt[0], 0.968, d.tt[2]]; W.st.deco.push({ n, a: 0 }); });
  };

  // =====================================================================
  //  小物のモデル（型・ボウル・クリーム・箱・段ボール・トッピング）
  // =====================================================================
  const meshCache = {};
  function itemMesh(it) {
    if (it.t === 'deco' || it.t === 'cake') return null;
    const e = W.eng;
    const key = [it.t, it.st || '', it.b || '', it.k || it.ing || '', it.t === 'box' ? it.s.length : '', (it.df || []).includes('burnt') ? 'B' : ''].join('|');
    if (meshCache[key]) return meshCache[key];
    const B = new Builder(), st = { rough: 0.3, metal: 1 };
    if (it.t === 'pan') {
      const Bs = D.BASES[it.b] || {}, burnt = (it.df || []).includes('burnt');
      if (Bs.cookie) B.put(Geo.rbox(0.38, 0.02, 0.28, 0.006), [0, 0.01, 0], 0, 1, rgb('#8C9298'), st);
      else { B.put(Geo.cyl(0.12, 0.115, 0.07, 28, 0, PI * 2, true), [0, 0.035, 0], 0, 1, rgb('#A6ACB2'), st); B.put(Geo.cyl(0.115, 0.115, 0.004, 28), [0, 0.002, 0], 0, 1, rgb('#A6ACB2'), st); }
      if (it.st !== 'empty') {
        const raw = it.st === 'raw' || it.st === 'baking';
        const col = raw ? mix('#F4E7C6', Bs.color || '#EFC77C', 0.35) : burnt ? mix(Bs.color || '#EFC77C', '#24130A', 0.6) : rgb(Bs.color || '#EFC77C');
        if (Bs.cookie) { for (let k = 0; k < 8; k++) { const sx = (k % 4) * 0.085 - 0.13, sz = Math.floor(k / 4) * 0.11 - 0.055; B.put(Bs.shell ? Geo.sphere(0.035, 12, 8, 0, PI / 2) : Geo.cyl(0.034, 0.036, raw ? 0.012 : 0.014, 16), [sx, 0.026, sz], 0, Bs.shell ? [1.2, 0.5, 0.8] : 1, col, { rough: 0.8 }); } }
        else { B.put(Geo.cyl(0.112, 0.112, raw ? 0.03 : 0.058, 28), [0, raw ? 0.017 : 0.031, 0], 0, 1, col, { rough: 0.85 }); if (!raw) B.put(Geo.cyl(0.108, 0.112, 0.004, 28), [0, 0.061, 0], 0, 1, burnt ? rgb('#1C0F07') : rgb(Bs.crumb || '#C98D45'), { rough: 0.85 }); }
      }
    } else if (it.t === 'cream') {
      B.put(Geo.cyl(0.12, 0.08, 0.09, 24, 0, PI * 2, true), [0, 0.045, 0], 0, 1, rgb('#EDEAE4'), { rough: 0.15 });
      B.put(Geo.cyl(0.08, 0.08, 0.004, 24), [0, 0.002, 0], 0, 1, rgb('#EDEAE4'), { rough: 0.15 });
      const cc = (D.CREAMS[it.k] || {}).color || '#FFFDF7';
      B.put(Geo.sphere(0.105, 18, 12), [0, 0.07, 0], 0, [1, 0.42, 1], rgb(cc), { rough: 0.4 });
      B.put(Geo.cyl(0.0, 0.03, 0.05, 10), [0.02, 0.11, 0.01], [0.3, 0, 0.2], 1, rgb(cc), { rough: 0.4 });
      B.put(Geo.box(0.02, 0.008, 0.2), [0.05, 0.1, 0], [0.5, 0.4, 0], 1, rgb('#E2E4E6'), st);
    } else if (it.t === 'box') {
      B.put(Geo.rbox(0.3, 0.16, 0.24, 0.01), [0, 0.08, 0], 0, 1, rgb('#F7F5F0'), { rough: 0.7 });
      B.put(Geo.box(0.302, 0.01, 0.06), [0, 0.165, 0], 0, 1, rgb('#C9A35E'), { rough: 0.5 });
      B.put(Geo.torus(0.05, 0.006, 6, 16, PI), [0, 0.165, 0], 0, 1, rgb('#C9A35E'), { rough: 0.5 });
      for (let k = 0; k < it.s.length; k++) B.put(Geo.cyl(0.035, 0.035, 0.012, 3), [-0.1 + (k % 3) * 0.1, 0.172, -0.05 + Math.floor(k / 3) * 0.1], [0, 0.4, 0], 1, rgb('#E8D9C4'), { rough: 0.6 });
    } else if (it.t === 'crate') {
      B.put(Geo.rbox(0.48, 0.34, 0.36, 0.01), [0, 0.17, 0], 0, 1, C.card, { rough: 0.85 });
      B.put(Geo.box(0.485, 0.04, 0.05), [0, 0.32, 0], 0, 1, rgb('#B88C5E'), { rough: 0.8 });
      B.put(Geo.box(0.16, 0.12, 0.005), [0, 0.18, 0.182], 0, 1, rgb(ING_COL[it.ing] || '#ddd'), { rough: 0.7 });
      B.put(Geo.box(0.005, 0.12, 0.16), [0.242, 0.18, 0], 0, 1, rgb(ING_COL[it.ing] || '#ddd'), { rough: 0.7 });
    } else if (it.t === 'top') {
      MD.topPiece(B, it.k, [0, 0, 0], 2.2);
      if (B.empty()) B.put(Geo.sphere(0.03, 10, 8), [0, 0.03, 0], 0, 1, rgb(ING_COL[it.k] || '#ccc'), { rough: 0.3 });
    }
    return (meshCache[key] = B.build(e));
  }
  // 回転台の上の作りかけ・完成したケーキ
  function decoNode(it, S) {
    const e = W.eng;
    if (it.t === 'cake') { const r = sim.recipe(S, it.r); const n = new Node(); if (r) { const c = MD.cake(e, r, it.p >= it.n ? 6 : Math.max(1, Math.round((it.p / it.n) * 6)), 1, it.df); n.add(c); } return n; }
    const Bs = D.BASES[it.b] || D.BASES.plain;
    const B = new Builder();
    const burnt = (it.df || []).includes('burnt'), R = 0.09;
    const col = burnt ? mix(Bs.color, '#24130A', 0.55) : rgb(Bs.color);
    if (Bs.cookie) { for (let k = 0; k < 8; k++) { const a = (k / 8) * PI * 2; B.put(Geo.cyl(0.022, 0.024, 0.009, 14), [Math.cos(a) * 0.06, 0.005, Math.sin(a) * 0.06], 0, 1, col, { rough: 0.8 }); } }
    else if (Bs.tart) { B.put(Geo.cyl(R, R * 0.97, 0.026, 28, 0, PI * 2, true), [0, 0.013, 0], 0, 1, col, { rough: 0.75 }); B.put(Geo.cyl(R * 0.95, R * 0.95, 0.008, 28), [0, 0.004, 0], 0, 1, col, { rough: 0.75 }); }
    else B.put(Geo.cyl(R, R, 0.065, 32), [0, 0.0325, 0], 0, 1, col, { rough: 0.9 });
    const topY = Bs.cookie ? 0.012 : Bs.tart ? 0.022 : 0.065;
    if (it.cr) { const cc = rgb((D.CREAMS[it.cr] || {}).color || '#FFFDF7'); if (Bs.tart) B.put(Geo.cyl(R * 0.93, R * 0.93, 0.016, 28), [0, 0.016, 0], 0, 1, cc, { rough: 0.3 }); else if (!Bs.cookie) { B.put(Geo.cyl(R + 0.004, R + 0.004, 0.066, 32, 0, PI * 2, true), [0, 0.033, 0], 0, 1, cc, { rough: 0.45 }); B.put(Geo.cyl(R + 0.004, R + 0.004, 0.005, 32), [0, 0.068, 0], 0, 1, cc, { rough: 0.45 }); } }
    (it.tp || []).forEach(([x, z, k]) => MD.topPiece(B, k, [x * R * 0.92, it.cr && !Bs.tart && !Bs.cookie ? 0.071 : topY, z * R * 0.92], 1));
    B.put(Geo.cyl(0.115, 0.1, 0.008, 36), [0, -0.004, 0], 0, 1, rgb('#F6F4F0'), { rough: 0.15 });
    return new Node(B.build(e));
  }
  W.topY = function (it) { const Bs = D.BASES[it.b] || {}; return (Bs.cookie ? 0.012 : Bs.tart ? 0.022 : it.cr ? 0.071 : 0.065) * CAKE_SC; };

  // =====================================================================
  //  状態の反映（サーバーから来るたび）
  // =====================================================================
  W.sync = function (s, room) {
    if (!W.ready || !s) return;
    W.S = s; W.room = room;
    const L = layout(s);
    if (L.key !== LK) { LK = L.key; W.L = L; W.rebuild(); }
    const e = W.eng;
    // オーブン
    if (W.keys.ov !== s.ovens.length) {
      W.keys.ov = s.ovens.length; W.ovenGroup.clear(); W.ovens = [];
      W.L.ovens.forEach((ov) => {
        const B = new Builder(), stl = { rough: 0.3, metal: 1 };
        B.put(Geo.rbox(1.15, 0.5, 0.9, 0.02), [0, 0.25, 0], 0, 1, rgb('#B9BEC4'), stl);
        B.put(Geo.rbox(1.15, 0.85, 0.95, 0.02), [0, 0.92, 0], 0, 1, rgb('#C7CBD0'), stl);
        B.put(Geo.rbox(0.96, 0.55, 0.04, 0.02), [0, 0.88, 0.47], 0, 1, rgb('#1E1E20'), { rough: 0.2 });
        B.put(Geo.cyl(0.018, 0.018, 0.8, 10), [0, 1.22, 0.53], [0, 0, PI / 2], 1, rgb('#D8DBDF'), stl);
        [-0.36, 0.36].forEach((dx) => B.put(Geo.box(0.03, 0.03, 0.06), [dx, 1.22, 0.5], 0, 1, rgb('#D8DBDF'), stl));
        B.put(Geo.rbox(1.0, 0.1, 0.03, 0.01), [0, 1.29, 0.47], 0, 1, rgb('#1A1A1A'), { rough: 0.25 });
        [-0.38, -0.25].forEach((dx) => B.put(Geo.cyl(0.03, 0.03, 0.03, 14), [dx, 1.29, 0.5], [PI / 2, 0, 0], 1, rgb('#2A2A2A'), { rough: 0.3 }));
        B.put(Geo.box(1.1, 0.04, 0.5), [0, 1.37, -0.1], 0, 1, rgb('#9AA0A6'), stl);
        const n = W.ovenGroup.add(new Node(B.build(e))); n.p = [ov.x, 0, ov.z];
        const win = n.add(new Node(e.mesh(Geo.box(0.8, 0.4, 0.01), null, { rough: 0.05 }), { color: rgb('#202020'), em: 0, cast: false }));
        win.p = [0, 0.88, 0.495];
        const disp = n.add(new Node(e.mesh(Geo.box(0.16, 0.05, 0.01)), { color: rgb('#FF5A2A'), em: 1, cast: false })); disp.p = [0.25, 1.29, 0.49];
        W.ovens.push({ n, win, disp });
        block(ov.x - 0.58, -RZ, ov.x + 0.58, ov.z + 0.5);
      });
    }
    // ショーケース
    const caseKey = JSON.stringify(s.showcase.map((c) => (c ? [c.r, c.p, c.df] : 0)));
    if (W.keys.cs !== caseKey) {
      W.keys.cs = caseKey; W.caseGroup.clear();
      s.showcase.forEach((c, i) => {
        const p = W.L.cases[i]; if (!p) return;
        const stand = new Node(e.mesh(Geo.cyl(0.19, 0.19, 0.012, 32), '#F4F1EC', { rough: 0.2 })); stand.p = [p[0], 0.906, p[2]]; W.caseGroup.add(stand);
        if (c) { const r = sim.recipe(s, c.r); if (r) { const n = MD.cake(e, r, Math.max(1, Math.round((c.p / (c.n || 6)) * 6)), CAKE_SC * 0.95, c.df); n.p = [p[0], 0.913, p[2]]; n.r = [0, PI * 0.1, 0]; W.caseGroup.add(n); } }
      });
    }
    // 小物
    const seen = {};
    for (const id in s.k.items) {
      const it = s.k.items[id]; seen[id] = 1;
      const key = JSON.stringify([it.t, it.st, it.b, it.k, it.ing, it.s && it.s.length, it.df, it.cr, it.tp, it.r, it.p]);
      let o = W.items[id];
      if (o && o.key !== key) { W.itemGroup.remove(o.n); o = null; }
      if (!o) { const m = itemMesh(it); const n = m ? new Node(m) : decoNode(it, s); W.itemGroup.add(n); o = W.items[id] = { n, key }; }
      o.it = it;
    }
    for (const id in W.items) if (!seen[id]) { W.itemGroup.remove(W.items[id].n); delete W.items[id]; }
    const uk = JSON.stringify([s.up.interior || 0, s.up.sign || 0, s.furn, s.up.floor || 0, s.name, LK]);
    if (W.keys.up !== uk) { W.keys.up = uk; W.decorate(s); }
    const mk = JSON.stringify([s.menu, s.known]);
    if (W.keys.mb !== mk) { W.keys.mb = mk; W.drawBoard(s); }
    if (W.keys.op !== s.phase) { W.keys.op = s.phase; W.drawOpen(s.phase === 'open'); }
  };
  W.rebuild = function () {
    W.scene.clear();
    W.keys = { mb: W.keys.mb }; W.ovens = []; W.items = {}; W.others = {}; W.custs = {}; W.staffN = {};
    W.buildStatic();
    W.applyQuality();
    const [x, z] = collide(W.me.x, W.me.z, 0.3); W.me.x = x; W.me.z = z;
    if (W.boardCv && W.S) W.drawBoard(W.S);
  };
  W.decorate = function (s) {
    const e = W.eng;
    const lv = s.up.interior || 0;
    e.updateTex(W.T.plaster, MD.TX.plaster(['#EFE8DD', '#E6EEE6', '#EDE4EC', '#F2EADB'][Math.min(3, lv)]));
    W.decoGroup.clear();
    // 家具の当たり判定を作り直す
    W.obstacles = W.obstacles.filter((b) => !b.furn);
    const fblock = (x0, z0, x1, z1) => { const b = [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]; b.furn = 1; W.obstacles.push(b); };
    const B = {}; const P = (m, g, p, r, sc2, c, o) => { (B[m] = B[m] || new Builder()).put(g, p, r, sc2, c || [1, 1, 1], o); };
    W.tablePos(s).forEach(([x, z]) => {
      P('marble', Geo.cyl(0.4, 0.4, 0.03, 32), [x, 0.74, z], 0, 1, null, { rough: 0.18 });
      P('d', Geo.cyl(0.03, 0.03, 0.72, 10), [x, 0.37, z], 0, 1, C.dark, { rough: 0.3, metal: 1 }); P('d', Geo.cyl(0.2, 0.22, 0.02, 20), [x, 0.01, z], 0, 1, C.dark, { rough: 0.3, metal: 1 });
      [0.65, -0.65].forEach((dx) => { P('w', Geo.cyl(0.19, 0.19, 0.04, 20), [x + dx, 0.46, z], 0, 1, null, { rough: 0.5 }); P('d', Geo.cyl(0.015, 0.015, 0.44, 6), [x + dx, 0.22, z], 0, 1, C.dark, { rough: 0.3, metal: 1 }); P('w', Geo.rbox(0.04, 0.4, 0.34, 0.01), [x + dx * 1.3, 0.7, z], [0, 0, dx > 0 ? -0.1 : 0.1], 1, null, { rough: 0.5 }); });
      P('d', Geo.cyl(0.03, 0.025, 0.08, 12), [x + 0.1, 0.795, z - 0.05], 0, 1, rgb('#F2EFE8'), { rough: 0.15 });
      fblock(x - 1.0, z - 0.35, x + 1.0, z + 0.35);
    });
    const plants = s.furn.plant || 0;
    for (let i = 0; i < plants; i++) { const px = i % 2 ? RX - 0.6 : -RX + 0.6, z = CASE_Z + 3.0 + Math.floor(i / 2) * 2.2 + (i % 2) * 0.6; if (z > RZ - 1.3) continue; P('d', Geo.cyl(0.2, 0.15, 0.4, 18), [px, 0.2, z], 0, 1, C.terracotta, { rough: 0.6 }); for (let k = 0; k < 7; k++) P('d', Geo.sphere(0.13, 10, 8), [px + Math.sin(k * 2.4) * 0.12, 0.55 + k * 0.08, z + Math.cos(k * 2.4) * 0.12], [k * 0.5, 0, 0.3], [1, 1.6, 0.5], shade(C.leaf, (k % 3) * 0.08), { rough: 0.7 }); fblock(px - 0.22, z - 0.22, px + 0.22, z + 0.22); }
    if (s.furn.coffee) { const x = RX - 0.45, z = CASE_Z + 1.1; P('w', Geo.rbox(0.6, 0.9, 0.9, 0.02), [x - 0.05, 0.45, z], 0, 1, null, { rough: 0.5 }); P('d', Geo.rbox(0.42, 0.45, 0.4, 0.04), [x - 0.05, 1.13, z], 0, 1, rgb('#2A2624'), { rough: 0.3, metal: 0.4 }); P('d', Geo.cyl(0.035, 0.03, 0.08, 12), [x - 0.15, 0.94, z + 0.25], 0, 1, rgb('#F2EFE8'), { rough: 0.15 }); fblock(x - 0.36, z - 0.46, RX, z + 0.46); }
    if (s.furn.speaker) [-1, 1].forEach((sd) => P('d', Geo.rbox(0.22, 0.34, 0.2, 0.02), [sd * (RX - 0.15), 2.7, CASE_Z + 1.5], [0, sd * 0.5, 0], 1, rgb('#2A2624'), { rough: 0.5 }));
    if (lv >= 1) [[-RX + 0.1, 2.0, CASE_Z + 4.0], [RX - 0.1, 2.0, CASE_Z + 4.0]].forEach(([x, y, z], i) => { P('w', Geo.rbox(0.05, 0.85, 1.1, 0.01), [x, y, z], 0, 1, null, { rough: 0.5 }); P('d', Geo.box(0.06, 0.65, 0.9), [x, y, z], 0, 1, rgb(['#C7B299', '#8FA9B8'][i]), { rough: 0.7 }); });
    if (lv >= 2) for (let x = 2.0; x <= RX - 1.3; x += 1.9) [-1, 1].forEach((sd) => { const px = sd * x, pz = RZ - 0.04; P('d', Geo.cyl(0.06, 0.045, 0.16, 14), [px, 1.04, pz], 0, 1, rgb('#E8E2D8'), { rough: 0.15 }); for (let k = 0; k < 4; k++) P('d', Geo.sphere(0.032, 8, 6), [px + Math.sin(k * 1.6) * 0.035, 1.16 + k * 0.018, pz + Math.cos(k * 1.6) * 0.03], 0, 1, rgb(['#D46A7A', '#F2D16B', '#F4F1EC', '#C98FB0'][(Math.round(x) + k) % 4]), { rough: 0.6 }); });
    if (lv >= 3) for (let x = -RX + 2.5; x < -1.5; x += 2.1) P('d', Geo.cyl(0.18, 0.1, 0.22, 20, 0, PI * 2, true), [x, WH - 0.55, CASE_Z + 4.2], 0, 1, rgb('#C9A35E'), { rough: 0.3, metal: 1 });
    const texOf = { marble: W.T.marble, w: W.T.walnut };
    for (const m in B) W.decoGroup.add(new Node(B[m].build(e), { tex: texOf[m] || null }));
    W.signNode.vis = !!s.up.sign;
    if (s.up.sign) e.updateTex(W.signTex, MD.TX.sign(s.name || 'ケーキ屋さん'));
  };
  W.drawBoard = function (s) {
    const g = W.boardCv.getContext('2d');
    g.fillStyle = '#20302A'; g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 1400; k++) { g.fillStyle = 'rgba(255,255,255,' + Math.random() * 0.04 + ')'; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    g.fillStyle = '#EDE6D8'; g.textAlign = 'center'; g.font = 'italic 600 44px "Shippori Mincho B1","Zen Old Mincho",serif'; g.fillText('Menu', 256, 72);
    g.strokeStyle = 'rgba(237,230,216,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(160, 92); g.lineTo(352, 92); g.stroke();
    const items = Object.keys(s.menu).filter((r) => s.menu[r].on && s.known[r]).slice(0, 8);
    g.font = '500 27px "Zen Kaku Gothic New",sans-serif';
    items.forEach((rid, i) => {
      const r = sim.recipe(s, rid); if (!r) return;
      const y = 140 + i * 44;
      g.textAlign = 'left'; g.fillStyle = '#EDE6D8';
      let name = r.name; while (g.measureText(name).width > 320 && name.length > 2) name = name.slice(0, -1);
      g.fillText(name, 40, y);
      g.textAlign = 'right'; g.fillStyle = '#E8C98F'; g.fillText('¥' + s.menu[rid].price, 472, y);
    });
    if (!items.length) { g.textAlign = 'center'; g.fillStyle = '#C9C2B4'; g.fillText('メニューを決めよう', 256, 260); }
    W.eng.updateTex(W.boardTex, W.boardCv);
  };

  // =====================================================================
  //  入力（PC：WASD＋マウス（クリックで視点固定）／スマホ：スティック＋右側スワイプ）
  // =====================================================================
  W.input = { joy: null };
  W.bindInput = function (canvas) {
    const look = (dx, dy, k) => {
      const s = (ST.camSens || 1) * k;
      W.me.yaw -= dx * s;
      W.me.pitch = clamp(W.me.pitch - dy * s * (ST.invertY ? -1 : 1), -1.35, 1.2);
    };
    const touches = {};
    const down = (e) => {
      if (W.blocked()) return;
      if (e.pointerType === 'mouse') {
        if (!document.pointerLockElement) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* noop */ } return; }
        if (e.button === 0) W.primary(); else if (e.button === 2) W.secondary();
        return;
      }
      touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    };
    const move = (e) => {
      if (e.pointerType === 'mouse') { if (document.pointerLockElement === canvas) look(e.movementX || 0, e.movementY || 0, 0.0022); return; }
      const t = touches[e.pointerId]; if (!t) return;
      look(e.clientX - t.x, e.clientY - t.y, 0.0058); t.x = e.clientX; t.y = e.clientY;
    };
    const up = (e) => { delete touches[e.pointerId]; };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const kd = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (W.blocked()) return;
      W.kb[e.code] = true;
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); W.primary(); }
      if (e.code === 'KeyF') W.secondary();
      if (e.code === 'KeyQ' || e.code === 'KeyX') W.discard();
    };
    const ku = (e) => { W.kb[e.code] = false; };
    const blur = () => { W.kb = {}; };
    document.addEventListener('keydown', kd); document.addEventListener('keyup', ku); G.addEventListener('blur', blur);
    W.unbind = () => { document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); G.removeEventListener('blur', blur); };
  };
  // 仮想スティック
  W.bindJoystick = function (el) {
    const knob = el.querySelector('i');
    let id = null, cx = 0, cy = 0, R = 50;
    el.addEventListener('pointerdown', (e) => {
      if (W.editing) return;
      e.preventDefault(); id = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベント */ }
      const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width * 0.42;
      upd(e);
    });
    const upd = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      const m = Math.min(1, l / R);
      W.input.joy = m < 0.12 ? null : { x: dx / R, y: dy / R };
    };
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) upd(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; W.input.joy = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };
  W.blocked = function () {
    const m = document.getElementById('modal'), g = document.getElementById('gov');
    return !!((CS.ui && CS.ui.sheet) || (m && !m.hidden) || W.editing || (g && !g.hidden));
  };

  // =====================================================================
  //  毎フレーム
  // =====================================================================
  W.frame = function () {
    if (!W.ready) return;
    const now = performance.now();
    const raw = Math.max(0, (now - W.last) / 1000); W.last = now;
    const dt = Math.min(0.05, raw), dtN = Math.min(0.3, raw); // 遅い端末でもお客さん・仲間の動きが遅れないように
    const s = W.S, room = W.room, g = room ? room.now() : 0;
    if (W.blocked() && document.pointerLockElement) document.exitPointerLock();
    for (let k = 0, n = Math.min(5, Math.ceil(raw / 0.05) || 1); k < n; k++) W.updatePlayer(Math.min(0.05, raw / n));
    W.updateCamera(dt);
    W.updateOthers(dtN);
    if (s) { W.updateStations(s, g, dtN); W.updateCustomers(dtN, s, g); W.updateStaff(dtN, s, g); W.updateOvens(s, g); }
    W.updateTarget(s, g);
    if (s) W.updateItems(s, g);
    W.updateLights();
    W.eng.shadowCenter = [W.me.x - Math.sin(W.me.yaw) * 3, 0, W.me.z - Math.cos(W.me.yaw) * 3];
    W.eng.render(W.scene);
    W.updateLabels(s, g);
  };
  function collide(x, z, r) {
    x = clamp(x, -RX + r, RX - r); z = clamp(z, -RZ + r, RZ + 3.2);
    for (let pass = 0; pass < 2; pass++) for (const b of W.obstacles) {
      const nx = clamp(x, b[0], b[2]), nz = clamp(z, b[1], b[3]);
      const dx = x - nx, dz = z - nz, d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-5) { x = nx + (dx / d) * r; z = nz + (dz / d) * r; }
        else { const l = x - b[0], ri = b[2] - x, t = z - b[1], bo = b[3] - z; const m = Math.min(l, ri, t, bo); if (m === l) x = b[0] - r; else if (m === ri) x = b[2] + r; else if (m === t) z = b[1] - r; else z = b[3] + r; }
      }
    }
    return [x, z];
  }
  W.collide = collide;
  W.updatePlayer = function (dt) {
    const me = W.me, room = W.room;
    let ix = 0, iz = 0, run = false;
    if (!W.blocked()) {
      const k = W.kb;
      if (k.KeyW || k.ArrowUp) iz -= 1; if (k.KeyS || k.ArrowDown) iz += 1; if (k.KeyA) ix -= 1; if (k.KeyD) ix += 1;
      if (k.ArrowLeft) me.yaw += dt * 2.2; if (k.ArrowRight) me.yaw -= dt * 2.2;
      if (W.input.joy) { ix += W.input.joy.x; iz += W.input.joy.y; run = Math.hypot(W.input.joy.x, W.input.joy.y) > 0.92; }
      if (k.ShiftLeft || k.ShiftRight) run = true;
    }
    const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    const mx = rx * ix + fx * -iz, mz = rz * ix + fz * -iz;
    const speed = run ? 4.4 : 3.3;
    me.vx = lerp(me.vx, mx * speed, 1 - Math.exp(-dt * 12)); me.vz = lerp(me.vz, mz * speed, 1 - Math.exp(-dt * 12));
    const sp = Math.hypot(me.vx, me.vz);
    if (sp > 0.02) { const [nx, nz] = collide(me.x + me.vx * dt, me.z + me.vz * dt, 0.3); me.x = nx; me.z = nz; }
    me.bob += dt * sp * 3.2;
    me.speed = sp;
    if (room && room.sendPos) room.sendPos({ x: +me.x.toFixed(2), z: +me.z.toFixed(2), r: +(me.yaw + PI).toFixed(2), p: +me.pitch.toFixed(2), a: sp > 0.3 ? 1 : 0 });
  };
  W.updateCamera = function () {
    const me = W.me, e = W.eng;
    const skin = CS.save && CS.save.data && CS.save.data.skin;
    const hs = { s: 0.95, m: 1, l: 1.05 }[(skin || {}).height] || 1;
    const eye = 1.58 * hs + (ST.bob === false ? 0 : Math.sin(me.bob * 2) * 0.018 * Math.min(1, me.speed / 3));
    const cp = Math.cos(me.pitch);
    e.cam.pos = [me.x, eye, me.z];
    e.cam.target = [me.x - Math.sin(me.yaw) * cp, eye + Math.sin(me.pitch), me.z - Math.cos(me.yaw) * cp];
    e.cam.fov = ((ST.fov || 72) * PI) / 180;
    e.cam.near = 0.04; e.cam.far = 140;
    W.fwd = [-Math.sin(me.yaw) * cp, Math.sin(me.pitch), -Math.cos(me.yaw) * cp];
  };
  // いちばん近い天井ライトだけを点灯（WebGL1 なので最大4灯）
  W.updateLights = function () {
    const e = W.eng, me = W.me, f = W.fwd;
    const ls = W.L.lamps.map(([x, z]) => ({ x, z, d: (x - me.x - f[0] * 2) ** 2 + (z - me.z - f[2] * 2) ** 2 })).sort((a, b) => a.d - b.d).slice(0, W.nLights || 4);
    e.lights = ls.map((l) => ({ p: [l.x, WH - 0.3, l.z], c: [2.4, 2.1, 1.7], r: 7.5 }));
  };
  W.addBlob = function (node) {
    const b = new Node(W.blobMesh, { tex: W.blobTex, op: 0.85, blend: true, outline: false, cast: false, recv: false, em: 1, color: [1, 1, 1], isBlob: true });
    b.p = [0, 0.012, 0]; b.s = [0.8, 1, 0.8];
    node.add(b);
    b.vis = !W.eng.shadows;
    return b;
  };
  // ---------- 設備（ボウルの中身・回転・オーブン） ----------
  W.updateStations = function (s, g, dt) {
    const fillOf = (b, cream) => {
      const n = b.ings.length; const lvl = clamp(n / 8, 0, 1);
      let col = '#F2E8D0';
      if (b.st === 'done') col = cream ? (D.CREAMS[b.k] || {}).color || '#E8D9A8' : b.k ? D.BASES[b.k].color : '#9A8B78';
      else if (n) { const c = [0, 0, 0]; b.ings.forEach((x) => { const v = rgb(ING_COL[x] || '#EEE'); c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }); col = [c[0] / n, c[1] / n, c[2] / n]; }
      return { lvl: b.st === 'done' ? 0.75 : lvl, col };
    };
    ['mix', 'whip'].forEach((k) => (W.st[k] || []).forEach((o, i) => {
      const b = s.k[k][i]; if (!b) return;
      const f = fillOf(b, k === 'whip');
      if (f.lvl > 0) { const k = clamp(Math.round(f.lvl * 10), 1, 10); if (o.lv !== k) { o.lv = k; o.f.meshes = W.fillM[k - 1]; o.f.p = [0, 0.004 + (0.014 * k) / 2, 0]; } o.f.vis = true; o.f.color = rgb(f.col); } else o.f.vis = false;
      const run = b.st === 'run' || !!b.by;
      o.w.r[1] += run ? dt * 18 : 0; o.w.p[1] = run ? 0.13 : 0.25; o.w.p[0] = run ? Math.sin(g / 120) * 0.03 : 0;
      o.w.vis = k === 'mix' || run;
    }));
    (W.st.deco || []).forEach((o, i) => {
      const b = s.k.deco[i];
      if (b && (b.st === 'run' || b.by)) o.a += dt * 2.6;
      else { const tgt = Math.round(o.a / (PI * 2)) * PI * 2; o.a = lerp(o.a, tgt, 1 - Math.exp(-dt * 8)); }
      o.n.r[1] = o.a;
    });
    if (W.pcScreen) W.pcScreen.em = 0.8 + Math.sin(performance.now() / 600) * 0.05;
  };
  W.updateOvens = function (s, g) {
    s.ovens.forEach((o, i) => {
      const ov = W.ovens[i]; if (!ov) return;
      const id = K.at(s, 'ov:' + i), it = id && s.k.items[id];
      const heating = o.h && g < (o.hot || 0), hot = o.h && !heating;
      ov.disp.color = it && it.st === 'baking' ? rgb('#FF5A2A') : hot ? rgb('#7CFF6B') : heating ? rgb('#FFB02A') : rgb('#333333');
      ov.disp.em = o.h ? 1 : 0.2;
      if (it && it.st === 'baking') {
        ov.win.em = 0.35; ov.win.color = rgb('#E2802F');
        const d = (g - it.bk.t0) / it.bk.dur, w = sim.bakeWindow(s, it.bk.dT || 0);
        if (Math.abs(d - 1) <= w && !W.alerted[id + it.bk.t0]) { W.alerted[id + it.bk.t0] = 1; CS.sound.play('ding'); }
      } else { ov.win.em = hot || heating ? 0.1 : 0; ov.win.color = hot || heating ? rgb('#7A3A14') : rgb('#202020'); }
    });
  };
  // ---------- 小物の位置（置き場・手の中） ----------
  W.updateItems = function (s) {
    const me = W.me, pid = W.room && W.room.pid;
    for (const id in W.items) {
      const o = W.items[id], it = o.it; if (!it) continue;
      const at = String(it.at);
      let p = null, ry = 0, scl = 1, mine = false;
      if (at.startsWith('h:')) {
        const who = at.slice(2);
        if (who === pid) {
          // 自分の手（画面の右下）
          mine = true;
          const f = W.fwd, cp = Math.cos(me.pitch), sp = Math.sin(me.pitch);
          const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
          const big = it.t === 'crate' || it.t === 'box';
          const dist = big ? 0.6 : 0.5, side = big ? 0.0 : 0.2, down = big ? 0.42 : 0.3;
          const cam = W.eng.cam.pos;
          // 「下」はカメラの上方向の逆（見上げても手元に見えるように）
          const ux = Math.sin(me.yaw) * sp, uy = cp, uz = Math.cos(me.yaw) * sp;
          p = [cam[0] + f[0] * dist + rx * side - ux * down, cam[1] + f[1] * dist - uy * down, cam[2] + f[2] * dist + rz * side - uz * down];
          ry = me.yaw; scl = it.t === 'top' ? 1 : 0.85;
        } else {
          const ot = W.others[who] || W.staffN[who];
          if (ot) { const r = ot.r || 0; p = [ot.x + Math.sin(r) * 0.42, 1.02, ot.z + Math.cos(r) * 0.42]; ry = r; }
        }
      } else p = W.slotPos(at);
      o.n.vis = !!p;
      if (!p) continue;
      o.n.p = [p[0], p[1], p[2]];
      o.n.cast = !mine;
      if (it.t === 'deco' || it.t === 'cake') { const dk = kindOf(at) === 'dt' ? W.st.deco[+at.split(':')[1]] : null; o.n.r = [0, dk ? dk.a : ry, 0]; o.n.s = [CAKE_SC * scl, CAKE_SC * scl, CAKE_SC * scl]; }
      else { o.n.r = [0, ry, 0]; o.n.s = [scl, scl, scl]; }
      setEm(o.n, W.target && W.target.item === id ? 0.16 : 0);
    }
  };
  function setEm(n, v) { if (n._em === v) return; n._em = v; n.em = v; n.kids.forEach((k) => setEm(k, v)); }
  // ---------- ほかのプレイヤー ----------
  W.updateOthers = function (dt) {
    const room = W.room; if (!room) return;
    const pos = room.pos || {};
    const seen = {};
    for (const pid in pos) {
      if (pid === room.pid) continue;
      const p = pos[pid]; const mem = room.members && room.members[pid];
      if (!p || !mem || !room.isOnline(pid)) continue;
      seen[pid] = 1;
      let o = W.others[pid];
      const sk = JSON.stringify(mem.skin || {});
      if (!o || o.sk !== sk) { if (o) W.people.remove(o.ch.node); o = W.others[pid] = { ch: MD.character(W.eng, mem.skin), sk, x: p.x, z: p.z, r: p.r }; W.people.add(o.ch.node); W.addBlob(o.ch.node); }
      const k = 1 - Math.exp(-dt * 10);
      const px = o.x, pz = o.z;
      o.x = lerp(o.x, p.x, k); o.z = lerp(o.z, p.z, k); o.r = angLerp(o.r, p.r, k);
      const sp = Math.hypot(o.x - px, o.z - pz) / Math.max(dt, 0.001);
      o.ch.node.p = [o.x, 0, o.z]; o.ch.node.r = [0, o.r, 0];
      o.ch.anim(dt, p.a === 1 || sp > 0.4 ? 'walk' : 'idle', 1);
      o.ch.head.r[0] = clamp(-(p.p || 0) * 0.7, -0.6, 0.6);
      o.name = mem.name;
    }
    for (const pid in W.others) if (!seen[pid]) { W.people.remove(W.others[pid].ch.node); delete W.others[pid]; }
  };
  // ---------- お客さん ----------
  function custTarget(s, c, id) {
    const L = W.L;
    if (c.st === 'in' || c.st === 'q') { const q = K.queue(s, c.lane); let k = q.indexOf(id); if (k < 0) k = q.length; return L.queue(c.lane, Math.min(k, 5)); }
    if (c.st === 'w') { const ws = Object.keys(s.cust).filter((x) => s.cust[x].st === 'w').sort((a, b) => s.cust[a].no - s.cust[b].no); return L.waitAt(Math.max(0, ws.indexOf(id))); }
    if (c.st === 'eat' && c.seat >= 0) { const st = W.seatPos(s, c.seat); if (st) return [st.x, st.z]; }
    const h = (parseInt(String(id).replace(/\D/g, ''), 10) || 0) % 2 ? 1 : -1;
    return [h * 6, RZ + 2.4];
  }
  W.updateCustomers = function (dt, s) {
    for (const id in W.custs) if (!s.cust[id]) { W.people.remove(W.custs[id].ch.node); delete W.custs[id]; }
    for (const id in s.cust) {
      const c = s.cust[id];
      let o = W.custs[id];
      if (!o) { const sd = Math.random() < 0.5 ? -1 : 1; o = W.custs[id] = { ch: MD.character(W.eng, MD.customerSkin(c.ty, c.v || 0)), x: sd * 7, z: RZ + 2.2, r: -sd * PI / 2 }; W.people.add(o.ch.node); W.addBlob(o.ch.node); }
      if (o.fresh === undefined) { o.fresh = false; if (c.st === 'in' && s.phase === 'open' && W.room && W.room.now() - (c.t0 || 0) < 2500) setTimeout(() => CS.sound.play('chime'), 2400); }
      const tgt = custTarget(s, c, id);
      // 入口を通る道順
      const inside = o.z < RZ - 0.2, wantIn = tgt[1] < RZ;
      let goal = tgt;
      if (inside !== wantIn) goal = Math.abs(o.x) > 0.35 ? [0, inside ? RZ - 0.7 : RZ + 1.0] : [0, wantIn ? RZ - 0.9 : RZ + 1.2];
      const dx = goal[0] - o.x, dz = goal[1] - o.z, d = Math.hypot(dx, dz);
      let mode = 'idle';
      if (d > 0.08) { const v = Math.min(d, dt * 1.6); o.x += (dx / d) * v; o.z += (dz / d) * v; o.r = angLerp(o.r, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10)); mode = 'walk'; }
      else if (c.st === 'eat') { const st = W.seatPos(s, c.seat); if (st) { o.r = angLerp(o.r, st.r, 1 - Math.exp(-dt * 8)); mode = 'sit'; } }
      else if (c.st === 'q' || c.st === 'w' || c.st === 'in') o.r = angLerp(o.r, PI, 1 - Math.exp(-dt * 6));
      o.atSpot = d <= 0.3 && goal === tgt;
      if (c.paid && !o.happy) { o.happy = performance.now() + 1400; CS.sound.play('coin'); o.coin = true; }
      if (o.happy && performance.now() < o.happy && mode === 'idle') mode = 'happy';
      o.ch.node.p = [o.x, 0, o.z]; o.ch.node.r = [0, o.r, 0];
      o.ch.anim(dt, mode, 0.9);
      o.c = c;
    }
  };
  // ---------- アルバイト ----------
  function staffSpot(s, m) {
    const L = W.L, j = m.job;
    if (m.task === 'mix') { const q = L.mix[j ? j.i : 0] || L.mix[0]; return { x: q.stand[0], z: q.stand[1] - 0.15, fx: q.x, fz: q.z }; }
    if (m.task === 'bake') { const q = L.ovens[j ? j.i : 0] || L.ovens[0]; return { x: q.stand[0], z: q.stand[1], fx: q.x, fz: q.z }; }
    if (m.task === 'whip') { const q = L.whip[j ? j.i : 0] || L.whip[0]; return { x: q.stand[0], z: q.stand[1] - 0.15, fx: q.x, fz: q.z }; }
    if (m.task === 'deco') { const q = L.deco[j ? j.di : 0] || L.deco[0]; return { x: q.stand[0], z: q.stand[1] - 0.15, fx: q.x, fz: q.z }; }
    if (m.task === 'stock') { const p = j ? [L.shelf[0] + 0.95, L.shelf[1]] : [-RX + 1.9, -RZ + 3.3]; return { x: p[0], z: p[1], fx: -RX, fz: p[1] }; }
    const r = L.reg[0]; return { x: r.x, z: CASE_Z - 0.7, fx: r.x, fz: CASE_Z + 2 };
  }
  W.updateStaff = function (dt, s) {
    const list = s.staff || [];
    for (let i = 0; i < 4; i++) {
      const m = list[i]; let o = W.staffN['staff' + i];
      const key = m ? m.name + JSON.stringify(m.skin || {}) : '';
      if (o && o.key !== key) { W.people.remove(o.ch.node); delete W.staffN['staff' + i]; o = null; }
      if (!m) continue;
      const t = staffSpot(s, m);
      if (!o) { o = W.staffN['staff' + i] = { ch: MD.character(W.eng, Object.assign({}, D.DEFAULT_SKIN, m.skin || {})), key, x: t.x, z: t.z, r: 0 }; W.people.add(o.ch.node); W.addBlob(o.ch.node); }
      const dx = t.x - o.x, dz = t.z - o.z, d = Math.hypot(dx, dz);
      let mode = 'idle';
      if (d > 0.06) { const v = Math.min(d, dt * 1.6); o.x += (dx / d) * v; o.z += (dz / d) * v; o.r = angLerp(o.r, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10)); mode = 'walk'; }
      else { o.r = angLerp(o.r, Math.atan2(t.fx - o.x, t.fz - o.z), 1 - Math.exp(-dt * 6)); mode = m.job ? 'work' : 'idle'; }
      o.ch.node.p = [o.x, 0, o.z]; o.ch.node.r = [0, o.r, 0];
      o.ch.anim(dt, mode, 0.8);
      o.m = m;
    }
  };

  // =====================================================================
  //  照準（何を見ているか）と操作
  // =====================================================================
  function raySphere(o, d, c, r) { const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2]; const b = ox * d[0] + oy * d[1] + oz * d[2]; const cc = ox * ox + oy * oy + oz * oz - r * r; const h = b * b - cc; if (h < 0) return -1; const t = -b - Math.sqrt(h); return t >= 0 ? t : -b + Math.sqrt(h) >= 0 ? 0.001 : -1; }
  const nm = (id) => (D.ING[id] ? D.ING[id].name : id);
  const itemName = (it, s) => (it.t === 'pan' ? (it.st === 'empty' ? '空の型' : (D.BASES[it.b] || {}).short + (it.st === 'baked' ? '（焼けた）' : it.st === 'baking' ? '（焼いている）' : '生地')) : it.t === 'cream' ? (D.CREAMS[it.k] || {}).name : it.t === 'cake' ? (sim.recipe(s, it.r) || {}).name || 'ケーキ' : it.t === 'deco' ? 'デコ中のケーキ' : it.t === 'box' ? 'ケーキの箱' + (it.s.length ? '（' + it.s.length + '個）' : '（空）') : it.t === 'crate' ? nm(it.ing) + '×' + it.n + ' の段ボール' : it.t === 'top' ? nm(it.k) : '');
  W.itemName = itemName;
  W.updateTarget = function (s) {
    W.target = null;
    if (!s || !W.room || W.blocked()) { if (W.onTarget) W.onTarget(null, null); return; }
    const L = W.L, o = W.eng.cam.pos, d = W.fwd, pid = W.room.pid;
    const hid = K.held(s, pid), held = hid ? s.k.items[hid] : null;
    const cands = [];
    const add = (p, r, t) => { const dist = raySphere(o, d, p, r); if (dist >= 0 && dist <= REACH) cands.push(Object.assign(t, { dist, p })); };
    const working = s.phase === 'prep' || s.phase === 'open';
    // 置いてある物
    for (const id in s.k.items) {
      const it = s.k.items[id], at = String(it.at); if (at.startsWith('h:')) continue;
      if (kindOf(at) === 'dt' || kindOf(at) === 'ov') continue; // 回転台・オーブンは設備側で扱う
      const p = W.slotPos(at); if (!p) continue;
      const big = it.t === 'crate' ? 0.28 : 0.16;
      add([p[0], p[1] + (it.t === 'crate' ? 0.17 : 0.06), p[2]], big, { item: id, name: itemName(it, s), pri: !held ? { label: '持つ', a: { t: 'pick', id } } : null });
    }
    // 空いている置き場
    if (held) {
      const slots = [];
      L.spots.forEach((p, j) => slots.push(['sp:' + j, p])); L.pack.forEach((p, j) => slots.push(['pk:' + j, p]));
      L.rack.forEach((p, j) => slots.push(['rk:' + j, p])); L.mix.forEach((m, i) => slots.push(['mo:' + i, m.pan]));
      L.whip.forEach((w, i) => w.out.forEach((p, k) => slots.push(['wo:' + i + ':' + k, p]))); L.deliv.forEach((p, j) => slots.push(['dl:' + j, p]));
      L.deco.forEach((d, i) => d.side.forEach((p, k) => slots.push(['dp:' + i + ':' + k, p])));
      slots.forEach(([slot, p]) => { if (!K.at(s, slot) && K.accepts(slot, held)) add([p[0], p[1] + 0.05, p[2]], 0.17, { slot, name: '置き場', pri: { label: '置く', a: { t: 'put', slot } } }); });
    }
    // 型の棚・箱
    add([L.panShelf[0], 1.0, L.panShelf[1]], 0.36, { name: 'ケーキ型の棚', pri: !held ? { label: '型を取る', a: { t: 'newPan' } } : null });
    add([L.boxStack[0], 1.2, L.boxStack[2]], 0.24, { name: 'ケーキの箱', pri: !held ? { label: '箱を取る', a: { t: 'newBox' } } : null });
    // ミキサー
    L.mix.forEach((m, i) => {
      const b = s.k.mix[i]; if (!b) return;
      m.bins.forEach((bn) => add(bn.p, 0.085, { bin: bn, name: nm(bn.ing) + '（在庫 ' + sim.invCount(s, bn.ing) + '）', pri: { label: nm(bn.ing) + 'を入れる', a: { t: 'addIng', st: 'mix', i, ing: bn.ing } } }));
      const t = { name: 'ミキサー' + (i + 1), station: ['mix', i] };
      if (held && held.t === 'pan' && held.st === 'empty' && b.st === 'done' && b.k) t.pri = { label: '型に流す', a: { t: 'pour', i } };
      if (b.st === 'idle' && b.ings.length) t.sec = { label: 'ミキサーを回す', a: { t: 'run', st: 'mix', i } };
      if (b.st === 'run') t.sec = { label: 'ミキサーを止める', a: { t: 'run', st: 'mix', i } };
      if (b.ings.length || b.st === 'done') t.del = { label: 'ボウルを空ける', a: { t: 'dump', st: 'mix', i } };
      add([m.bowl[0], 1.1, m.bowl[2]], 0.22, t);
    });
    // オーブン
    L.ovens.forEach((ov, i) => {
      const id = K.at(s, 'ov:' + i), it = id && s.k.items[id], o2 = s.ovens[i]; if (!o2) return;
      const t = { name: 'オーブン' + (i + 1) + '（' + (o2.h ? o2.temp + '℃' : '電源オフ') + '）', station: ['oven', i] };
      if (!held && it) t.pri = { label: it.st === 'baking' ? '取り出す' : '持つ', a: { t: 'pick', id } };
      else if (held && !it && K.accepts('ov:' + i, held)) t.pri = { label: 'オーブンに入れる', a: { t: 'put', slot: 'ov:' + i } };
      const TT = D.OVEN_TEMPS, nx = o2.h ? TT[(TT.indexOf(o2.temp) + 1) % TT.length] : 170;
      t.sec = { label: o2.h ? '温度 ' + o2.temp + '→' + nx + '℃' : '電源を入れる（170℃）', a: { t: 'oven', i, op: o2.h ? 'next' : 'set', temp: 170 } };
      if (o2.h && !(it && it.st === 'baking')) t.del = { label: '電源を切る', a: { t: 'oven', i, op: 'off' } };
      add([ov.x, 0.95, ov.z + 0.45], 0.42, t);
    });
    // クリーム台
    L.whip.forEach((w, i) => {
      const b = s.k.whip[i]; if (!b) return;
      w.bins.forEach((bn) => add(bn.p, 0.085, { bin: bn, name: nm(bn.ing) + '（在庫 ' + sim.invCount(s, bn.ing) + '）', pri: { label: nm(bn.ing) + 'を入れる', a: { t: 'addIng', st: 'whip', i, ing: bn.ing } } }));
      const t = { name: 'クリーム台' + (i + 1), station: ['whip', i] };
      if (!held && b.st === 'done' && b.k) t.pri = { label: 'クリームを取る', a: { t: 'scoop', i } };
      if (b.st === 'idle' && b.ings.length) t.sec = { label: '泡立てる', a: { t: 'run', st: 'whip', i } };
      if (b.st === 'run') t.sec = { label: '泡立てを止める', a: { t: 'run', st: 'whip', i } };
      if (b.ings.length || b.st === 'done') t.del = { label: 'ボウルを空ける', a: { t: 'dump', st: 'whip', i } };
      add([w.bowl[0], 1.02, w.bowl[2]], 0.21, t);
    });
    // デコ台
    L.deco.forEach((dc, i) => {
      const did = K.at(s, 'dt:' + i), dk = did && s.k.items[did], b = s.k.deco[i] || {};
      dc.bins.forEach((bn) => add([bn.p[0], 0.98, bn.p[2]], 0.1, { bin: bn, name: nm(bn.ing) + '（在庫 ' + sim.invCount(s, bn.ing) + '）' + (held ? '・手をあけてから取る' : ''), pri: !held ? { label: nm(bn.ing) + 'を取る', a: { t: 'takeTop', k: bn.ing } } : null }));
      const t = { name: 'デコ台' + (i + 1), station: ['deco', i], item: did || null, deco: i };
      if (!held && dk) t.pri = { label: dk.t === 'cake' ? 'ケーキを持つ' : '持つ', a: { t: 'pick', id: did } };
      else if (held && !dk && K.accepts('dt:' + i, held)) t.pri = { label: held.t === 'pan' ? '型から出してのせる' : 'のせる', a: { t: 'put', slot: 'dt:' + i } };
      else if (held && held.t === 'top' && dk && dk.t === 'deco') t.pri = { label: nm(held.k) + 'をここに置く', a: { t: 'topPlace', i }, aim: true };
      if (dk && dk.t === 'deco') {
        if (b.st === 'run') t.sec = { label: '塗り終える', a: { t: 'run', st: 'deco', i } };
        else if (held && held.t === 'cream' && !dk.cr) t.sec = { label: 'クリームを塗る', a: { t: 'run', st: 'deco', i } };
        else if (!held) t.sec = { label: '仕上げる', a: { t: 'finish', i } };
      }
      add([dc.tt[0], 1.02, dc.tt[2]], 0.25, t);
    });
    // ショーケース
    s.showcase.forEach((c, i) => {
      const p = L.cases[i]; if (!p) return;
      const t = { name: c ? ((sim.recipe(s, c.r) || {}).name || '') + '（残り' + c.p + '）' : 'ショーケース ' + (i + 1) + '番（空き）', caseI: i };
      if (c && held && held.t === 'box') t.pri = { label: '箱に1つ入れる', a: { t: 'slice', ci: i } };
      if (c && !held) t.sec = { label: 'ケーキごと持つ', a: { t: 'caseTake', ci: i } };
      if (!c && held && held.t === 'cake') t.pri = { label: '並べる', a: { t: 'put', slot: 'cs:' + i } };
      add([p[0], 1.08, p[2]], 0.3, t);
    });
    // そのほかの設備
    add([L.shelf[0] + 0.3, 1.0, L.shelf[1]], 0.6, { name: '在庫の棚', pri: held && held.t === 'crate' ? { label: '棚にしまう', a: { t: 'stock' } } : null });
    L.trash.forEach(([x, z]) => add([x, 0.6, z], 0.32, { name: 'ゴミ箱', pri: held && held.t !== 'crate' ? { label: '捨てる', a: { t: 'trash' } } : null }));
    add([L.pc[0] + 0.15, 1.0, L.pc[2]], 0.36, { name: 'パソコン（仕入れ・経営）', pri: { label: 'パソコンを使う', ui: 'pc' } });
    add([L.board[0] + 0.1, 1.75, L.board[1]], 0.7, { name: 'メニュー黒板', pri: { label: 'メニューと価格', ui: 'menu' } });
    add([L.sign[0], 0.55, L.sign[1]], 0.45, { name: '店の看板（' + (s.phase === 'open' ? 'OPEN' : 'CLOSED') + '）', pri: working ? { label: s.phase === 'open' ? 'CLOSE にする' : 'OPEN にする', a: { t: 'sign' } } : null });
    // お客さん
    for (const id in W.custs) {
      const oc = W.custs[id], c = s.cust[id]; if (!c) continue;
      const t = { name: 'お客さん', cust: id };
      if (c.st === 'q' && K.queue(s, c.lane)[0] === id && oc.atSpot) t.pri = { label: '注文を受ける', a: { t: 'takeOrder', c: id } };
      if (c.st === 'w') { t.name = '注文 #' + c.no + '：' + K.ordText(s, c.ord); if (held && held.t === 'box') t.pri = { label: '箱を渡す', a: { t: 'serve', c: id } }; }
      add([oc.x, 1.25, oc.z], 0.42, t);
    }
    // レジ（先頭のお客さんの注文）
    L.reg.forEach((r, l) => { const q = K.queue(s, l); const oc = q.length && W.custs[q[0]]; add(r.till, 0.22, { name: 'レジ' + (l + 1), pri: oc && oc.atSpot ? { label: '注文を受ける', a: { t: 'takeOrder', c: q[0] } } : null }); });
    cands.sort((a, b) => a.dist - b.dist);
    const t = cands[0] || null;
    if (t && t.pri && t.pri.aim) {
      // 回転台の上の照準位置（ケーキの上面）を -1〜1 に
      const dc = L.deco[t.deco], dk = s.k.items[K.at(s, 'dt:' + t.deco)];
      const y = dc.tt[1] + W.topY(dk);
      t.aimOK = false;
      if (d[1] < -0.05) {
        const tt = (y - o[1]) / d[1], hx = o[0] + d[0] * tt - dc.tt[0], hz = o[2] + d[2] * tt - dc.tt[2];
        const R = 0.09 * 0.92 * CAKE_SC, lx = hx / R, lz = hz / R;
        t.pri.a = Object.assign({}, t.pri.a, { x: +lx.toFixed(2), z: +lz.toFixed(2) });
        t.aimOK = Math.hypot(lx, lz) <= 1.02;
        W.aim = { x: dc.tt[0] + hx, y, z: dc.tt[2] + hz, ok: t.aimOK };
      }
    } else W.aim = null;
    W.target = t;
    if (W.onTarget) W.onTarget(t, held);
  };
  // 操作（つかむ・置く／使う／捨てる）
  function send(a) {
    if (!a || !W.room) return;
    // 連打・通信待ちの二重送信を防ぐ（同じ操作は 0.6 秒あける）
    const k = JSON.stringify(a), t = performance.now();
    if (W._last && W._last.k === k && t - W._last.t < 600 && a.t !== 'addIng' && a.t !== 'slice') return;
    W._last = { k, t };
    CS.sound.play(a.t === 'put' || a.t === 'pick' || a.t === 'stock' || a.t === 'trash' ? 'put' : 'tap');
    if (W.onSend) W.onSend(a);
    W.room.act(a);
  }
  W.send = send;
  W.primary = function () {
    const t = W.target;
    if (t && t.pri) {
      if (t.pri.ui) { if (W.onUI) W.onUI(t.pri.ui); return; }
      if (t.pri.aim && !t.aimOK) { CS.ui.toast('ケーキの上をねらって置こう', 'err'); return; }
      send(t.pri.a); return;
    }
    const s = W.S; if (s && W.room && K.held(s, W.room.pid) && !t) CS.ui.toast('置き場をねらって「置く」。いらない物はゴミ箱へ');
  };
  W.secondary = function () { const t = W.target; if (t && t.sec) send(t.sec.a); };
  W.discard = function () {
    const t = W.target;
    if (t && t.del) { send(t.del.a); return; }
    const s = W.S; if (!s || !W.room) return;
    const hid = K.held(s, W.room.pid);
    if (hid) { const it = s.k.items[hid]; if (it && it.t === 'crate') { CS.ui.toast('段ボールは在庫の棚にしまおう', 'err'); return; } send({ t: 'trash' }); }
  };

  // =====================================================================
  //  ラベル（設備の状態・ゲージ・お客さんの吹き出し・名前）
  // =====================================================================
  function lab(key, cls) {
    let el = W.lbl[key];
    if (!el) { el = document.createElement('div'); W.labels.appendChild(el); W.lbl[key] = el; el._h = ''; }
    const c = 'lb ' + (cls || '');
    if (el._c !== c) { el._c = c; el.className = c; }
    el._used = true;
    return el;
  }
  function place(el, p3, dy, scale) {
    const p = W.eng.project(p3);
    if (!p || p.z > 1 || p.d < 0.15 || p.x < -80 || p.x > W.eng.canvas.clientWidth + 80) { el.hidden = true; return null; }
    el.hidden = false;
    const sc = scale || clamp(2.2 / p.d, 0.55, 1.1);
    const y = Math.max(p.y + (dy || 0), (W.hudH || 52) + (el._hh || 24) * sc);
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(2)})`;
    return p;
  }
  const distMe = (x, z) => Math.hypot(W.me.x - x, W.me.z - z);
  function setHTML(el, h) { if (el._h !== h) { el._h = h; el.innerHTML = h; el._hh = el.offsetHeight; } }
  const esc = (x) => CS.art.esc(x);
  function meter(m, lo, hi, max) { return `<span class="dm"><u style="left:${((lo / max) * 100).toFixed(1)}%;width:${(((hi - lo) / max) * 100).toFixed(1)}%"></u><b style="left:${(clamp(m / max, 0, 1) * 100).toFixed(1)}%"></b></span>`; }
  W.updateLabels = function (s, g) {
    if (!s) return;
    for (const k in W.lbl) W.lbl[k]._used = false;
    const L = W.L, tg = W.target;
    const near = (x, z, r) => distMe(x, z) < (r || 3.4);
    // ミキサー・クリーム台
    ['mix', 'whip'].forEach((kind) => L[kind].forEach((m, i) => {
      const b = s.k[kind][i]; if (!b) return;
      const look = tg && tg.station && tg.station[0] === kind && tg.station[1] === i;
      if (!look && !(b.st === 'run' && near(m.x, m.z, 6)) && !(near(m.x, m.z + 0.8) && (b.ings.length || b.st !== 'idle'))) return;
      const el = lab(kind + i, 'st-lb' + (look ? ' near' : ''));
      const gauge = K.gauge(s, kind);
      let h = `<b>${kind === 'mix' ? 'ミキサー' : 'クリーム台'}${i + 1}</b>`;
      if (b.by) h += '<small>アルバイトが作業中</small>';
      if (b.ings.length && b.st !== 'done') { const cnt = {}; b.ings.forEach((x) => (cnt[x] = (cnt[x] || 0) + 1)); h += `<small>${Object.keys(cnt).map((x) => esc(nm(x)) + '×' + cnt[x]).join(' ')}</small>`; const id = kind === 'mix' ? K.baseFromIngs(b.ings) : K.creamFromIngs(b.ings); h += `<small class="${id ? 'ok' : ''}">${id ? '→ ' + esc(kind === 'mix' ? D.BASES[id].name : D.CREAMS[id].name) : '（レシピの材料にまだ足りない）'}</small>`; }
      if (b.st === 'run') h += meter(K.prog(b, g), gauge.lo, gauge.hi, 1.5) + '<small>緑のところで止める</small>';
      if (b.st === 'done') h += `<small class="${b.k ? 'ok' : 'bad'}">${b.k ? esc(kind === 'mix' ? D.BASES[b.k].name : D.CREAMS[b.k].name) + ' 完成' + (b.df && b.df.length ? '（' + b.df.map((x) => esc(D.DEFECTS[x].name)).join('・') + '）' : '') : '失敗…ボウルを空けよう'}</small>`;
      if (!b.ings.length && b.st === 'idle') h += '<small>上の材料をねらって入れる</small>';
      setHTML(el, h); place(el, [m.bowl[0], kind === 'mix' ? 1.7 : 1.45, m.bowl[2]]);
    }));
    // オーブン
    L.ovens.forEach((ov, i) => {
      const o = s.ovens[i]; if (!o) return;
      const id = K.at(s, 'ov:' + i), it = id && s.k.items[id];
      const look = tg && tg.station && tg.station[0] === 'oven' && tg.station[1] === i;
      if (!look && !(it && it.st === 'baking' && near(ov.x, ov.z, 7)) && !(near(ov.x, ov.z + 1, 3) && (o.h || it))) return;
      const el = lab('ov' + i, 'st-lb' + (look ? ' near' : ''));
      let h = `<b>オーブン${i + 1}</b>`, status = '';
      if (o.h && (!it || it.st !== 'baking')) status = g < (o.hot || 0) ? '予熱中… ' + o.temp + '℃' : o.temp + '℃ 予熱OK';
      if (!o.h) status = '電源オフ';
      if (it && it.st === 'raw') status = '電源を入れると焼き始める';
      if (it && it.st === 'baked') status = '焼き上がっている（取り出そう）';
      if (it && it.st === 'baking') {
        const dd = (g - it.bk.t0) / it.bk.dur, w = sim.bakeWindow(s, it.bk.dT || 0), max = 1.4;
        status = it.bk.temp + '℃・' + (dd < 1 - w ? 'あと' + Math.max(0, Math.ceil(((1 - w - dd) * it.bk.dur) / 1000)) + '秒' : Math.abs(dd - 1) <= w ? '焼き上がり！今だ' : dd < 1.18 ? '焼きすぎ…' : '焦げている！');
        h += `<small>${esc(status)}</small>` + meter(dd, 1 - w, 1 + w, max); el.classList.toggle('hot', dd >= 1 - w);
      } else { h += `<small>${esc(status)}</small>`; el.classList.remove('hot'); }
      setHTML(el, h); place(el, [ov.x, 1.8, ov.z + 0.4]);
    });
    // デコ台
    L.deco.forEach((dc, i) => {
      const did = K.at(s, 'dt:' + i), dk = did && s.k.items[did], b = s.k.deco[i] || {};
      const look = tg && tg.deco === i;
      if (!look && !(dk && near(dc.x, dc.z + 0.8))) return;
      const el = lab('dc' + i, 'st-lb' + (look ? ' near' : ''));
      let h = `<b>デコ台${i + 1}</b>`;
      if (dk && dk.t === 'deco') {
        const tops = Object.keys(dk.tops || {}).map((k) => nm(k) + '×' + dk.tops[k]).join(' ');
        h += `<small>${esc(D.BASES[dk.b].short)}${dk.cr ? '＋' + esc(D.CREAMS[dk.cr].short) : ''}${tops ? '＋' + esc(tops) : ''}</small>`;
        if (b.st === 'run') { const gg = K.gauge(s, 'deco'); h += meter(K.prog(b, g), gg.lo, gg.hi, 1.5) + '<small>緑で「塗り終える」</small>'; }
        else if (dk.warm) h += '<small class="bad">まだ温かい（クリームが溶ける）</small>';
        else h += '<small>クリームを塗る → トッピング → 仕上げる</small>';
      } else if (dk && dk.t === 'cake') h += `<small class="ok">${esc((sim.recipe(s, dk.r) || {}).name || '')} 完成！ショーケースへ</small>`;
      else h += '<small>焼けた型をのせる</small>';
      setHTML(el, h); place(el, [dc.tt[0], 1.5, dc.tt[2]]);
    });
    // 材料の入れ物の名札（近くにいるときだけ）
    const binTags = (kind, list, dy) => list.forEach((st, i) => {
      if (distMe(st.x, st.z) > 2.1) return;
      st.bins.forEach((bn, k) => { const n = sim.invCount(s, bn.ing); const el = lab('bin-' + kind + i + '-' + k, 'bin-lb' + (n ? '' : ' out') + (tg && tg.bin === bn ? ' tg' : '')); setHTML(el, esc(BIN_NAME[bn.ing] || nm(bn.ing)) + (n ? '' : '×')); const pp = W.eng.project(bn.p); place(el, [bn.p[0], bn.p[1] + dy + (k % 2) * 0.045, bn.p[2] + 0.06], 0, pp ? clamp(1.5 / pp.d, 0.6, 0.9) : 0.8); });
    });
    binTags('mix', L.mix, 0.1); binTags('whip', L.whip, 0.07); binTags('deco', L.deco, 0.06);
    // ねらっている物
    if (tg && tg.item && s.k.items[tg.item] && !tg.station) {
      const it = s.k.items[tg.item], p = tg.p;
      const el = lab('it', 'tag-lb');
      let h = esc(itemName(it, s));
      if (it.t === 'pan' && it.st === 'baked') h += `<small>${g < (it.cool || 0) ? '冷ましています… あと' + Math.ceil((it.cool - g) / 1000) + '秒' : '冷めた'}${it.lab ? '・' + esc(it.lab) : ''}</small>`;
      if (it.df && it.df.length) h += `<small class="bad">${it.df.map((x) => esc((D.DEFECTS[x] || {}).name || x)).join('・')}</small>`;
      setHTML(el, h); place(el, [p[0], p[1] + 0.3, p[2]], 0, 0.9);
    }
    // ショーケースの値札
    s.showcase.forEach((c, i) => {
      const p = L.cases[i]; if (!c || !p) return;
      if (!(tg && tg.caseI === i) && distMe(p[0], p[2]) > 2.6) return;
      const el = lab('tag-' + i, 'tag-lb');
      const m = s.menu[c.r];
      setHTML(el, `¥${m ? m.price : 0}<small>${esc((sim.recipe(s, c.r) || {}).name || '')}・残り${c.p}</small>`);
      place(el, [p[0], 1.55, p[2] + 0.2], 0, 0.85);
    });
    // お客さん（注文・吹き出し）
    for (const id in W.custs) {
      const o = W.custs[id], c = o.c; if (!c) continue;
      let h = '', cls = 'say-lb';
      if (c.st === 'q' && K.queue(s, c.lane)[0] === id && o.atSpot) { h = 'すみません、注文いいですか？'; cls += ' ask'; }
      else if (c.st === 'w') { const left = Math.max(0, Math.ceil(((c.pw || 0) - g) / 1000)); h = `<b>#${c.no}</b> ${esc(K.ordText(s, c.ord))}<small class="${left < 12 ? 'bad' : ''}">あと${left}秒</small>`; cls += ' ord'; }
      else if (c.say && g - (c.sayT || 0) < 2800) { h = esc(c.say); cls += c.paid ? ' buy' : ' bad'; }
      if (!h || distMe(o.x, o.z) > 10) continue;
      const el = lab('say-' + id, cls);
      setHTML(el, h);
      const p = place(el, [o.x, 1.9, o.z], 0, clamp(3 / Math.max(1, distMe(o.x, o.z)), 0.6, 1));
      if (o.coin && p && CS.coinFly) { o.coin = false; const from = { getBoundingClientRect: () => ({ left: p.x, top: p.y, width: 0, height: 0 }) }; const to = document.getElementById('h-money'); if (to) CS.coinFly(from, to, '¥'); }
    }
    // 名前タグ
    for (const pid in W.others) { const o = W.others[pid]; if (distMe(o.x, o.z) > 12) continue; const el = lab('nm-' + pid, 'nm-lb'); setHTML(el, esc(o.name || '')); place(el, [o.x, 1.98, o.z], 0, 0.8); }
    for (const k in W.staffN) { const o = W.staffN[k], m = o.m; if (!m || distMe(o.x, o.z) > 7) continue; const el = lab('sf-' + k, 'nm-lb staff'); setHTML(el, `${esc(m.name)} <small>Lv${m.lv}・${esc(D.STAFF.tasks[m.task].name)}</small>`); place(el, [o.x, 1.98, o.z], 0, 0.8); }
    // トッピングの照準
    if (W.aim) { const el = lab('aim', 'aim-lb' + (W.aim.ok ? ' ok' : '')); setHTML(el, ''); const p = W.eng.project([W.aim.x, W.aim.y, W.aim.z]); if (p) { el.hidden = false; el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-50%)`; } }
    for (const k in W.lbl) if (!W.lbl[k]._used) { W.lbl[k].remove(); delete W.lbl[k]; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
