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
    const cnt = (k) => (s ? K.count(s, k) : k === 'fridge' ? 6 : Array.isArray(D.KITCHEN[k]) ? D.KITCHEN[k][0] : D.KITCHEN[k]);
    const L = { lv, nMix: cnt('mix'), nWhip: cnt('whip'), nDeco: cnt('deco'), nReg: cnt('reg'), nOven: s ? s.ovens.length : 3, nCase: s ? s.showcase.length : 4 };
    const bz = -RZ + 0.42;
    // 在庫室（左奥）と事務室（右・パソコン）
    const SR = (L.store = { x0: -RX, x1: -RX + 4.2, z0: -RZ, z1: -RZ + 4.6, door: -RZ + 1.9 });
    L.office = { x0: RX - 3.8, x1: RX, z0: -RZ + 3.85, z1: -RZ + 7.1, door: -RZ + 5.5 };
    L.mix = []; for (let i = 0; i < L.nMix; i++) { const x = SR.x1 + 1.2 + i * 1.7; L.mix.push({ x, z: bz, bowl: [x - 0.18, 0.92, bz + 0.05], pan: [x + 0.5, 0.92, bz + 0.1], bins: MIX_BINS.map((ing, k) => ({ ing, p: [x - 0.66 + k * 0.165, 1.36, bz - 0.2] })), stand: [x, bz + 0.95] }); }
    const ox0 = SR.x1 + 1.2 + L.nMix * 1.7 + 0.15;
    L.ovens = []; for (let i = 0; i < L.nOven; i++) { const x = ox0 + i * OVEN_DX; L.ovens.push({ x, z: -RZ + 0.5, slot: [x, 0.8, -RZ + 0.62], stand: [x, -RZ + 1.55] }); }
    const oEnd = ox0 + (L.nOven - 1) * OVEN_DX + 0.58;
    L.panShelf = [oEnd + 0.65, -RZ + 0.42];
    L.sink = [oEnd + 1.3, RX - 2.75];
    // 厨房の冷蔵庫（奥の壁・冷却ラックのとなり）：ガラス扉。棚 × 3列（冷蔵庫のグレードで棚が増える）
    { const nFr = cnt('fridge'), ys = [[0.92, 1.34], [0.5, 0.92, 1.34], [0.5, 0.92, 1.34, 1.76]][clamp(Math.ceil(nFr / 3) - 2, 0, 2)], fx = RX - 1.95, fz = -RZ + 0.38;
      L.fridge = { x: fx, z: fz, w: 1.42, d: 0.74, h: 2.08, ys, slots: [] };
      for (let k = 0; k < nFr; k++) L.fridge.slots.push([fx - 0.43 + (k % 3) * 0.43, ys[Math.floor(k / 3)] + 0.012, fz + 0.02]);
      L.nFr = nFr; }
    L.rack = []; [-RZ + 2.0, -RZ + 3.15].forEach((rz) => [0.5, 0.95, 1.4].forEach((y) => [-0.22, 0.22].forEach((dz) => L.rack.push([RX - 0.42, y + 0.01, rz + dz]))));
    L.racks = [[RX - 0.42, -RZ + 2.0], [RX - 0.42, -RZ + 3.15]];
    L.desk = [RX - 0.55, -RZ + 5.6];
    const z1 = -RZ + 3.0, z2 = -RZ + 5.4;
    L.deco = []; for (let i = 0; i < L.nDeco; i++) { const x = -RX + 5.6 + i * 2.6; L.deco.push({ x, z: z1, tt: [x, 0.975, z1 + 0.06], side: [[x - 0.66, 0.915, z1 + 0.2], [x + 0.66, 0.915, z1 + 0.2]], bins: TOP_BINS.map((ing, k) => ({ ing, p: [x - 0.62 + k * 0.248, 0.96, z1 - 0.3] })), stand: [x, z1 + 0.95] }); }
    L.whip = []; for (let i = 0; i < L.nWhip; i++) { const x = -RX + 3.1 + i * 2.25; L.whip.push({ x, z: z2, bowl: [x - 0.12, 0.915, z2 + 0.06], bins: WHIP_BINS.map((ing, k) => ({ ing, p: [x - 0.72 + k * 0.17, 0.96, z2 - 0.3] })), out: [[x + 0.66, 0.915, z2 - 0.12], [x + 0.66, 0.915, z2 + 0.2]], stand: [x, z2 + 0.95] }); }
    const wx0 = -RX + 3.1 + L.nWhip * 2.25 - 0.4, wx1 = L.office.x0 - 0.5;
    L.work = [wx0, wx1, z2];
    L.spots = []; for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) L.spots.push([wx0 + 0.35 + (k * (wx1 - wx0 - 0.7)) / 5, 0.915, z2 - 0.2 + r * 0.4]);
    L.backDoor = [-RX, -RZ + 2.2];
    // トラック（荷台の後ろが裏口のそば）。段ボールは荷台の中に積んである
    L.truck = { x: -RX - 3.45, z: L.backDoor[1] + 3.0 };
    L.alley = [-RX - 5.6, -RZ - 3.0];
    // 在庫室の棚（材料ごとに置き場所が決まっている）：乾物の棚＝奥の壁、冷蔵ケース＝手前の壁
    L.stock = {};
    ['flour', 'sugar', 'cocoa', 'matcha', 'choco', 'chestnut'].forEach((ing, k) => { const col = k % 2, lv2 = Math.floor(k / 2); L.stock[ing] = { ing, kind: 'dry', p: [-RX + 1.2 + col * 1.75, 1.43 - lv2 * 0.5, -RZ + 0.33], w: 1.6, d: 0.42, f: 1 }; });
    ['egg', 'butter', 'milk', 'cream', 'cheese', 'strawberry', 'blueberry', 'peach', 'lemon'].forEach((ing, k) => { const u = Math.floor(k / 3), lv2 = k % 3; L.stock[ing] = { ing, kind: 'cold', p: [-RX + 0.85 + u * 1.25, 1.43 - lv2 * 0.46, -RZ + 4.27], w: 1.04, d: 0.44, f: -1 }; });
    L.trash = [[-RX + 0.5, -RZ + 7.6], [RX - 0.6, -RZ + 7.75], [-RX + 0.45, -RZ + 3.35]];
    L.cases = []; for (let i = 0; i < 8; i++) L.cases.push([CASE_X0 + i, 0.92, CASE_Z]);
    L.reg = []; for (let l = 0; l < L.nReg; l++) { const c = 4.3 + l * 1.6; L.reg.push({ x: c, z: CASE_Z, till: [c - 0.3, 1.05, CASE_Z], pk: [c + 0.38, 0.96, CASE_Z + 0.02] }); }
    L.pack = L.reg.map((r) => r.pk);
    L.counter = [3.3, 4.3 + (L.nReg - 1) * 1.6 + 0.8];
    L.boxStack = [3.58, 0.96, CASE_Z];
    L.board = [-RX + 0.09, CASE_Z + 1.6];
    L.sign = [1.75, RZ + 0.95];
    L.pc = [RX - 0.6, 1.0, -RZ + 5.6];
    L.lamps = []; for (let x = -RX + 1.8; x <= RX - 1.2; x += 3.4) for (let z = -RZ + 1.8; z <= RZ - 1.2; z += 3.2) L.lamps.push([x, z]);
    L.queue = (l, k) => [L.reg[l] ? L.reg[l].x : 4.3, CASE_Z + 1.0 + k * 0.75];
    L.waitAt = (k) => [2.4 - (k % 8) * 0.85, CASE_Z + 1.05 + Math.floor(k / 8) * 0.8];
    L.tables = []; for (let z = CASE_Z + 3.2; z <= RZ - 1.3; z += 1.9) for (let x = -RX + 1.8; x <= -2.6; x += 2.1) L.tables.push([x, z]);
    for (let z = CASE_Z + 6.4; z <= RZ - 1.4; z += 1.9) for (let x = 3.6; x <= RX - 1.8; x += 2.1) L.tables.push([x, z]);
    L.key = [lv, L.nMix, L.nWhip, L.nDeco, L.nReg, L.nOven, L.nCase, L.nFr].join(',');
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
      case 'dl': return W.truckSlot(i);
      case 'sp': return L.spots[i];
      case 'pk': return L.pack[i];
      case 'fr': return L.fridge && L.fridge.slots[i];
      default: return null;
    }
  };
  const kindOf = (slot) => String(slot).split(':')[0];
  // トラックの荷台の中の段ボールの位置（後ろの扉から近い順に 2列×3段×2層）
  const TRUCK_SLOTS = []; for (let j = 0; j < 12; j++) { const layer = Math.floor(j / 6), k = j % 6; TRUCK_SLOTS.push([(k % 2 ? 0.46 : -0.46), 0.68 + layer * 0.36, -2.42 + Math.floor(k / 2) * 0.56]); }
  W.truckSlot = function (i) {
    const t = TRUCK_SLOTS[i]; if (!t) return null;
    const P0 = W.truck && W.truck.node.vis ? W.truck.node.p : [W.L.truck.x, 0, W.L.truck.z];
    return [P0[0] + t[0], t[1], P0[2] + t[2]];
  };

  // =====================================================================
  //  初期化
  // =====================================================================
  W.init = function (host) {
    W.host = host;
    host.innerHTML = '<canvas id="gl3d" aria-label="お店の中"></canvas><div class="labels" id="labels"></div><div class="xhair" id="xhair"></div>';
    const canvas = host.querySelector('canvas');
    // 前のエンジンのテクスチャは使えないので作り直す
    W.T = null; W.boardTex = null; W.signTex = null; W.openTex = null; W.blobTex = null; W.blobMesh = null; W.standM = null; W.stockN = {}; W.frTex = null; for (const k in meshCache) delete meshCache[k];
    W.dying = false;
    if (W.qlv == null) W.qlv = ST.autoQ === false ? 0 : clamp(+CS.LS.get('cs.qlv', 0) || 0, 0, 3);
    let e;
    // ふちのギザギザは仕上げ処理（FXAA）で消すので、画面そのもののアンチエイリアスは使わない（スマホのメモリ節約）
    try { e = W.eng = new Engine(canvas, { aa: false }); } catch (err) { host.innerHTML = '<div class="banner" style="margin:20px">この端末では 3D 表示（WebGL）が使えません。</div>'; W.ready = false; return false; }
    // スマホでメモリが足りなくなるなどで WebGL が落ちたら、画質を1段下げて作り直す（画面が固まったままにしない）
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      if (W.eng !== e || W.dying) return;
      W.ready = false; clearTimeout(W._lostT);
      W._lostT = setTimeout(() => W.recover(true), 1200);
    }, false);
    canvas.addEventListener('webglcontextrestored', () => { if (W.eng !== e || W.dying) return; clearTimeout(W._lostT); W.recover(false); }, false);
    // 天井からのやわらかい光（影は真下に落ちる）＋近くの照明4灯。映り込みは「床・壁・天井」
    e.env.light = norm3([0.2, 1.0, 0.34]);
    e.env.sky = [0.62, 0.59, 0.55]; e.env.ground = [0.36, 0.32, 0.28]; e.env.wall = [0.56, 0.53, 0.49]; e.env.sun = [1.38, 1.32, 1.22];
    e.env.fog = rgb('#D7DEE5'); e.env.fogR = [40, 95]; e.env.clear = rgb('#9EBBD6'); e.env.expo = 1.06; e.env.lampR = 0.55;
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
  W.destroy = function () { W.ready = false; W.dying = true; clearTimeout(W._lostT); W.unbind && W.unbind(); if (document.pointerLockElement) document.exitPointerLock(); if (W.eng) { const x = W.eng.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } if (W.host) W.host.innerHTML = ''; };
  // 描画を作り直す（WebGL が落ちた・何度もエラーが出た）。立ち位置と状態はそのまま
  W.recover = function (lower) {
    const host = W.host; if (!host || W.dying) return;
    const me = W.me ? Object.assign({}, W.me) : null, s = W.S, room = W.room;
    if (lower && ST.autoQ !== false) { W.qlv = Math.min(3, (W.qlv || 0) + 1); CS.LS.set('cs.qlv', W.qlv); }
    W.unbind && W.unbind();
    W.dying = true; if (W.eng) { try { const x = W.eng.gl.getExtension('WEBGL_lose_context'); if (x && !W.eng.gl.isContextLost()) x.loseContext(); } catch (err) { /* noop */ } }
    if (!W.init(host)) return;
    if (me) Object.assign(W.me, me);
    if (s) W.sync(s, room);
    if (CS.ui && CS.ui.toast) CS.ui.toast('画面を立て直しました' + (lower ? '（画質を少し下げました）' : ''));
  };
  // 画質：軽量モード、または自動調整の段階（0 標準 → 3 いちばん軽い）
  W.QNAME = ['標準', 'やや軽く', '軽く', 'いちばん軽く'];
  W.applyQuality = function () {
    const e = W.eng; if (!e) return;
    const coarse = G.matchMedia && matchMedia('(pointer: coarse)').matches;
    const q = ST.autoQ === false ? 0 : clamp(W.qlv || 0, 0, 3);
    e.scale = ST.light ? 0.55 : (coarse ? 0.8 : 1) * [1, 0.8, 0.72, 0.62][q]; // スマホは仕上げ処理の分だけ少し解像度を下げて軽く
    e.shadows = !ST.light && q < 3;
    e.outline = 0;
    e.smSize = ST.light || q >= 1 ? 1024 : 2048;
    e.shadowRadius = 8;
    e.post = !ST.light && q < 2; e.softShadow = !ST.light && q < 1; e.bloom = 0.5; e.vignette = 0.24; e.bloomThr = 0.82;
    W.nLights = ST.light || q >= 3 ? 2 : q >= 2 ? 3 : 4;
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
      subway: e.texFromCanvas(MD.TX.subway(), true), mat: e.texFromCanvas(MD.TX.mat(), true), clock: e.texFromCanvas(MD.TX.clock(), false),
      art: [0, 1, 2].map((k) => e.texFromCanvas(MD.TX.art(k), false)),
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
    wall('back', [[0, WH / 2, -RZ - 0.1, RX * 2 + 0.4, WH, 0.2]], []);
    const bd = L.backDoor[1];
    wall('left', [[-RX - 0.1, WH / 2, (bd - 0.6 - RZ) / 2, 0.2, WH, bd - 0.6 + RZ], [-RX - 0.1, WH / 2, (bd + 0.6 + RZ) / 2, 0.2, WH, RZ - bd - 0.6], [-RX - 0.1, 2.65, bd, 0.2, 1.1, 1.2]], [[-RX + 0.03, 0.5, (KZ + RZ) / 2, 0.06, 1.0, RZ - KZ]]);
    wall('right', [[RX + 0.1, WH / 2, 0, 0.2, WH, RZ * 2]], [[RX - 0.03, 0.5, (KZ + RZ) / 2, 0.06, 1.0, RZ - KZ]]);
    // 厨房の壁はサブウェイタイル（床から 1.9m）
    { const TB = new Builder(), th = 1.9, tg = { rough: 0.16 };
      const sx1 = L.store.x1, sz1 = L.store.z1, of = L.office;
      TB.put(Geo.box(RX - sx1, th, 0.02, 1), [(sx1 + RX) / 2, th / 2, -RZ + 0.012], 0, 1, [1, 1, 1], tg);
      TB.put(Geo.box(0.02, th, KZ - sz1, 1), [-RX + 0.012, th / 2, (sz1 + KZ) / 2], 0, 1, [1, 1, 1], tg);
      [[-RZ, of.z0], [of.z1, KZ]].forEach(([z0, z1]) => TB.put(Geo.box(0.02, th, z1 - z0, 1), [RX - 0.012, th / 2, (z0 + z1) / 2], 0, 1, [1, 1, 1], tg));
      sc.add(new Node(TB.build(e), { tex: T.subway, ao: 0, cast: false }));
      P('steel', Geo.box(RX - sx1, 0.03, 0.035), [(sx1 + RX) / 2, th + 0.015, -RZ + 0.02]);
      P('steel', Geo.box(0.035, 0.03, KZ - sz1), [-RX + 0.02, th + 0.015, (sz1 + KZ) / 2]);
      [[-RZ, of.z0], [of.z1, KZ]].forEach(([z0, z1]) => P('steel', Geo.box(0.035, 0.03, z1 - z0), [RX - 0.02, th + 0.015, (z0 + z1) / 2]));
    }
    // 天井の回り縁
    [[0, -RZ + 0.04, RX * 2, 0.08], [0, RZ - 0.04, RX * 2, 0.08]].forEach(([x, z, w, d]) => P('paint', Geo.box(w, 0.09, d), [x, WH - 0.045, z], 0, 1, rgb('#F4F0E9')));
    [-RX + 0.04, RX - 0.04].forEach((x) => P('paint', Geo.box(0.08, 0.09, RZ * 2), [x, WH - 0.045, 0], 0, 1, rgb('#F4F0E9')));
    // 裏口（開けっぱなしの鉄の扉。ここから外の路地へ出られる）
    P('steel', Geo.box(0.05, 2.1, 1.1), [-RX - 0.26, 1.05, bd - 1.16], 0, 1, rgb('#8E959C'));
    P('steel', Geo.cyl(0.015, 0.015, 0.22, 8), [-RX - 0.3, 1.05, bd - 1.55], [PI / 2, 0, 0]);
    [[bd - 0.63, 0.06], [bd + 0.63, 0.06]].forEach(([z, w]) => P('steel', Geo.box(0.26, 2.15, w), [-RX - 0.1, 1.075, z], 0, 1, rgb('#6E757C')));
    P('steel', Geo.box(0.26, 0.06, 1.32), [-RX - 0.1, 2.15, bd], 0, 1, rgb('#6E757C'));
    block(-RX - 0.2, -RZ - 0.25, -RX, bd - 0.6); block(-RX - 0.2, bd + 0.6, -RX, RZ + 0.25);
    block(-RX - 0.32, bd - 1.75, -RX - 0.2, bd - 0.6);
    block(-RX - 0.2, -RZ - 8, RX + 1, -RZ);
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
    [-1, 1].forEach((sd) => { const dx = sd * DW, fr = { rough: 0.4 };
      FB.put(Geo.box(0.05, 2.2, 0.06), [dx, 1.1, RZ + 0.22], 0, 1, C.dark, fr); FB.put(Geo.box(0.05, 2.2, 0.06), [dx, 1.1, RZ + 0.88], 0, 1, C.dark, fr);
      FB.put(Geo.box(0.05, 0.08, 0.72), [dx, 2.16, RZ + 0.55], 0, 1, C.dark, fr); FB.put(Geo.box(0.05, 0.14, 0.72), [dx, 0.07, RZ + 0.55], 0, 1, C.dark, fr);
      FB.put(Geo.cyl(0.012, 0.012, 0.42, 8), [dx - sd * 0.035, 1.05, RZ + 0.8], 0, 1, rgb('#C9A35E'), { rough: 0.25, metal: 1 }); });
    front.add(new Node(FB.build(e), { cast: false }));
    const glass = (w, h, p, r) => { const n = new Node(e.mesh(Geo.box(w, h, 0.02), null, { rough: 0.05 }), { color: rgb('#BFD8E6'), op: 0.16, cast: false, recv: false }); n.p = p; if (r) n.r = r; front.add(n); };
    glass(ww, 1.38, [-wc, 1.6, fz]); glass(ww, 1.38, [wc, 1.6, fz]);
    [-1, 1].forEach((sd) => glass(0.62, 1.98, [sd * DW, 1.13, RZ + 0.55], [0, PI / 2, 0]));
    block(-RX - 0.2, RZ - 0.02, -DW, RZ + 0.25); block(DW, RZ - 0.02, RX + 1, RZ + 0.25);
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
    L.trash.forEach(([x, z], k) => { if (k < 2) { P('steel', Geo.cyl(0.22, 0.19, 0.62, 20), [x, 0.31, z], 0, 1, rgb('#5A5F64')); P('steel', Geo.cyl(0.235, 0.235, 0.04, 20), [x, 0.64, z], 0, 1, rgb('#3A3E42')); } block(x - 0.27, z - 0.27, x + 0.27, z + 0.27); });
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
    L.lamps.forEach(([x, z]) => {
      if (z < KZ) { P('paint', Geo.box(1.25, 0.03, 0.38), [x, WH - 0.015, z], 0, 1, rgb('#E6E3DD')); LB.put(Geo.box(1.15, 0.01, 0.29), [x, WH - 0.034, z], 0, 1, rgb('#FFF8EC')); }
      else { P('paint', Geo.cyl(0.17, 0.17, 0.03, 28), [x, WH - 0.015, z], 0, 1, rgb('#E6E3DD')); LB.put(Geo.cyl(0.12, 0.12, 0.01, 28), [x, WH - 0.034, z], 0, 1, rgb('#FFF1D6')); }
    });
    W.buildDetails(e, sc, L, P, T, LB);
    W.buildRooms(e, sc, L, P, T, LB);
    W.buildFridge(e, sc, L, P, LB);
    sc.add(new Node(LB.build(e), { cast: false, em: 1, recv: false }));
    // ---------- 外：街並み ----------
    const EB = new Builder();
    for (let i = 0; i < 16; i++) { const x = -38 + i * 5; EB.put(Geo.box(4.6, 6 + (i % 3), 6), [x, 3 + (i % 3) / 2, RZ + 20], 0, 1, [1, 1, 1], { rough: 0.85 }); }
    [[-RX - 8.6, -2, 4, 5], [RX + 6, -3, 4, 6]].forEach(([x, z, w, h]) => EB.put(Geo.box(w, h, 8), [x, h / 2, z], 0, 1, [1, 1, 1], { rough: 0.85 }));
    W.extras = sc.add(new Node(EB.build(e), { tex: T.facade, cast: false }));
    [[-RX - 7, RZ + 3], [RX + 2, RZ + 3], [-RX / 2 - 0.5, RZ + 3], [RX / 2 + 0.5, RZ + 3]].forEach(([x, z]) => { P('walnut', Geo.cyl(0.12, 0.16, 2.2, 8), [x, 1.1, z]); for (let k = 0; k < 5; k++) P('plant', Geo.sphere(0.8, 10, 8), [x + Math.sin(k * 1.3) * 0.5, 2.4 + (k % 2) * 0.4, z + Math.cos(k * 1.3) * 0.4], 0, [1, 0.85, 1], shade(C.leaf, (k % 3) * 0.1 - 0.05)); });
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
    W.stationGroup = sc.add(new Node()); W.decoGroup = sc.add(new Node()); W.people = sc.add(new Node()); W.stockGroup = sc.add(new Node());
    W.blobTex = W.blobTex || e.texFromCanvas(MD.TX.shadow(), false);
    W.blobMesh = W.blobMesh || CS.gl.keep(e.mesh(Geo.plane(1, 1)));
    W.buildAlley(e, sc, L, T);
    W.buildStations();
  };
  // 雰囲気を出す細部（レンジフード・ペンダント照明・ゴムマット・棚の小物・絵・時計・外の街灯など）
  W.buildDetails = function (e, sc, L, P, T, LB) {
    const steel = { rough: 0.3, metal: 1 };
    // レンジフード（オーブンの上。下に照明）
    if (L.ovens.length) {
      const HB = new Builder(), x0 = L.ovens[0].x - 0.64, x1 = L.ovens[L.ovens.length - 1].x + 0.64, w = x1 - x0, cx = (x0 + x1) / 2;
      HB.put(Geo.box(w, 0.4, 1.08), [cx, 2.56, -RZ + 0.54], 0, 1, rgb('#C9CDD2'), steel);
      HB.put(Geo.box(w, 0.07, 0.06), [cx, 2.36, -RZ + 1.06], 0, 1, rgb('#B9BEC4'), steel);
      HB.put(Geo.box(0.6, WH - 2.76, 0.5), [cx, (WH + 2.76) / 2, -RZ + 0.3], 0, 1, rgb('#C9CDD2'), steel);
      L.ovens.forEach((ov) => {
        HB.put(Geo.box(0.95, 0.006, 0.62), [ov.x, 2.358, -RZ + 0.45], 0, 1, rgb('#7E848A'), steel);
        for (let k = 0; k < 6; k++) HB.put(Geo.box(0.93, 0.004, 0.012), [ov.x, 2.354, -RZ + 0.2 + k * 0.1], 0, 1, rgb('#5E6368'), steel);
        LB.put(Geo.box(0.5, 0.008, 0.05), [ov.x, 2.355, -RZ + 0.86], 0, 1, rgb('#FFF6E4'));
      });
      sc.add(new Node(HB.build(e), { tex: T.steel, cast: false }));
    }
    // ミキサー台の上の棚（ボウル・保存びん）
    L.mix.forEach((m) => {
      P('steel', Geo.box(1.55, 0.025, 0.3), [m.x, 1.88, -RZ + 0.17]);
      [-0.7, 0.7].forEach((dx) => P('steel', Geo.box(0.02, 0.2, 0.26), [m.x + dx, 1.79, -RZ + 0.17]));
      for (let k = 0; k < 3; k++) P('steel', Geo.cyl(0.13 - k * 0.012, 0.08 - k * 0.008, 0.07, 20, 0, PI * 2, true), [m.x - 0.45, 1.93 + k * 0.03, -RZ + 0.17], 0, 1, rgb('#D6D9DD'));
      ['#E9D7B5', '#F3EEE6', '#8B5A3C', '#C9A35E'].forEach((c, k) => {
        const jx = m.x - 0.05 + k * 0.17;
        P('gloss', Geo.cyl(0.055, 0.055, 0.16, 16), [jx, 1.97, -RZ + 0.17], 0, 1, rgb('#EEF2F4'), { rough: 0.08 });
        P('paint', Geo.cyl(0.05, 0.05, 0.1, 16), [jx, 1.94, -RZ + 0.17], 0, 1, rgb(c), { rough: 0.7 });
        P('walnut', Geo.cyl(0.057, 0.057, 0.025, 16), [jx, 2.06, -RZ + 0.17]);
      });
    });
    // 作業場の黒いゴムマット
    const MB = new Builder(), mat = (x, z, w, d) => MB.put(Geo.box(w, 0.012, d, 3), [x, 0.006, z], 0, 1, [1, 1, 1], { rough: 0.95 });
    L.mix.forEach((m) => mat(m.x, m.z + 0.82, 1.45, 0.62));
    if (L.ovens.length) { const a = L.ovens[0].x - 0.5, b = L.ovens[L.ovens.length - 1].x + 0.5; mat((a + b) / 2, -RZ + 1.4, b - a, 0.7); }
    L.deco.forEach((d) => mat(d.x, d.z + 0.82, 1.7, 0.6));
    L.whip.forEach((w) => mat(w.x, w.z + 0.82, 1.7, 0.6));
    mat(0, RZ + 0.62, 1.3, 0.75);
    sc.add(new Node(MB.build(e), { tex: T.mat, cast: false, ao: 0 }));
    // ショーケースの中の照明
    LB.put(Geo.box(8.1, 0.012, 0.03), [CASE_X0 + 3.5, 1.384, CASE_Z - 0.2], 0, 1, rgb('#FFEBC8'));
    // ペンダント照明（ショーケースとレジの上）
    const PD = new Builder(), brass = { rough: 0.28, metal: 1 };
    const pend = (x, z, y) => {
      PD.put(Geo.cyl(0.006, 0.006, WH - y - 0.15, 6), [x, (WH + y + 0.15) / 2, z], 0, 1, C.dark, { rough: 0.5 });
      PD.put(Geo.cyl(0.045, 0.2, 0.2, 28, 0, PI * 2, true), [x, y + 0.03, z], 0, 1, rgb('#B88A4A'), brass);
      PD.put(Geo.cyl(0.035, 0.035, 0.06, 12), [x, y + 0.15, z], 0, 1, rgb('#B88A4A'), brass);
      LB.put(Geo.sphere(0.055, 14, 10), [x, y - 0.02, z], 0, 1, rgb('#FFE6B5'));
    };
    for (let k = 0; k < 4; k++) pend(CASE_X0 + 0.5 + k * 2, CASE_Z + 0.05, 2.25);
    L.reg.forEach((r) => pend(r.x, CASE_Z + 0.05, 2.25));
    sc.add(new Node(PD.build(e), { twoSide: true, cast: false }));
    // 壁の絵（売り場）と時計
    const AB = [new Builder(), new Builder(), new Builder()];
    const art = (x, z, k, w, h) => {
      P('walnut', Geo.rbox(0.05, h + 0.12, w + 0.12, 0.01), [x, 1.85, z]);
      AB[k].put(Geo.card(w, h), [x + (x < 0 ? 0.03 : -0.03), 1.85, z], [0, x < 0 ? PI / 2 : -PI / 2, 0], 1, [1, 1, 1], { rough: 0.8 });
    };
    art(-RX + 0.03, CASE_Z + 4.3, 0, 0.9, 0.7);
    art(-RX + 0.03, CASE_Z + 6.4, 1, 0.7, 0.9);
    if (CASE_Z + 6.0 < RZ - 1) art(RX - 0.03, CASE_Z + 6.0, 2, 0.9, 0.7);
    AB.forEach((b, k) => { if (!b.empty()) sc.add(new Node(b.build(e), { tex: T.art[k], cast: false })); });
    {
      const cz = CASE_Z + 1.1, cx = RX - 0.04;
      P('paint', Geo.cyl(0.25, 0.25, 0.04, 36), [cx, 2.4, cz], [0, 0, PI / 2], 1, C.dark);
      const face = new Node(e.mesh(Geo.card(0.44, 0.44), null, { rough: 0.5 }), { tex: T.clock, cast: false }); face.p = [cx - 0.025, 2.4, cz]; face.r = [0, -PI / 2, 0]; sc.add(face);
      P('paint', Geo.box(0.006, 0.12, 0.018), [cx - 0.03, 2.45, cz - 0.02], [0.6, 0, 0], 1, C.dark);
      P('paint', Geo.box(0.006, 0.17, 0.012), [cx - 0.032, 2.47, cz + 0.05], [-1.05, 0, 0], 1, C.dark);
    }
    // 空調の吹き出し口（売り場の天井）
    [[-3.2, CASE_Z + 4.6], [5.2, CASE_Z + 3.4]].forEach(([x, z]) => {
      P('paint', Geo.box(0.8, 0.05, 0.8), [x, WH - 0.025, z], 0, 1, rgb('#F2F0EC'));
      for (let k = 0; k < 5; k++) P('paint', Geo.box(0.62, 0.012, 0.02), [x, WH - 0.054, z - 0.24 + k * 0.12], 0, 1, rgb('#CFCBC4'));
    });
    // 裏口：非常口の表示・消火器
    const bd = L.backDoor[1];
    LB.put(Geo.box(0.04, 0.14, 0.36), [-RX + 0.04, 2.35, bd], 0, 1, rgb('#2FBF71'));
    P('gloss', Geo.cyl(0.07, 0.07, 0.48, 16), [L.store.x1 + 0.2, 0.3, L.store.z1 + 0.22], 0, 1, rgb('#C21F24'), { rough: 0.25 });
    P('paint', Geo.cyl(0.03, 0.03, 0.08, 10), [L.store.x1 + 0.2, 0.58, L.store.z1 + 0.22], 0, 1, C.dark);
    // ペーパータオル（洗い場）
    if (L.sink[1] - L.sink[0] > 1.4) P('gloss', Geo.rbox(0.3, 0.32, 0.12, 0.03), [L.sink[0] + 1.15, 1.45, -RZ + 0.08], 0, 1, rgb('#F2F0EC'), { rough: 0.2 });
    // 外：街灯・花のプランター
    const OB = new Builder(), iron = { rough: 0.4, metal: 0.6 };
    [-(RX - 1.2), RX - 1.2].forEach((x) => {
      P('paint', Geo.cyl(0.05, 0.07, 3.3, 10), [x, 1.65, RZ + 3.7], 0, 1, rgb('#2B3330'), iron);
      P('paint', Geo.cyl(0.16, 0.1, 0.3, 12), [x, 3.35, RZ + 3.7], 0, 1, rgb('#2B3330'), iron);
      OB.put(Geo.cyl(0.11, 0.11, 0.16, 12), [x, 3.15, RZ + 3.7], 0, 1, rgb('#FFF0D0'));
    });
    const flower = ['#E36A7E', '#F2D16B', '#F4F1EC'];
    [-1.6, 1.6].forEach((x) => {
      P('walnut', Geo.box(0.7, 0.42, 0.34), [x, 0.21, RZ + 0.42]);
      for (let k = 0; k < 10; k++) P('plant', Geo.sphere(0.07, 8, 6), [x - 0.27 + (k % 5) * 0.135, 0.5 + (k % 2) * 0.05, RZ + 0.36 + Math.floor(k / 5) * 0.12], 0, 1, k % 2 ? shade(C.leaf, 0.1) : rgb(flower[(k / 2) % 3]));
      block(x - 0.36, RZ + 0.24, x + 0.36, RZ + 0.6);
    });
    sc.add(new Node(OB.build(e), { em: 1, cast: false, recv: false }));
  };
  // 裏の路地（トラックが材料を届けに来る）
  W.buildAlley = function (e, sc, L, T) {
    const bd = L.backDoor[1], x0 = L.alley[0], len = RZ + 40;
    const g = new Node(e.mesh(Geo.plane(-x0 - RX + 0.2, len, 1.6, len / 4), null, { rough: 0.85 }), { tex: T.asphalt, cast: false, ao: 0 });
    g.p = [(x0 - RX) / 2, -0.008, RZ - len / 2]; sc.add(g);
    const B = new Builder(), paint = { rough: 0.7 };
    // 駐車の白線・止まれ
    [L.truck.x - 1.35, L.truck.x + 1.35].forEach((x) => B.put(Geo.box(0.08, 0.004, 5.6), [x, 0.002, L.truck.z], 0, 1, rgb('#E9E6DF'), paint));
    B.put(Geo.box(2.78, 0.004, 0.08), [L.truck.x, 0.002, L.truck.z + 2.8], 0, 1, rgb('#E9E6DF'), paint);
    // 路地の向こう側のレンガ塀
    const wall = new Node(e.mesh(Geo.box(0.3, 2.3, RZ + 30, 1), null, { rough: 0.85 }), { tex: T.facade, cast: false }); wall.p = [x0 - 0.15, 1.15, RZ - (RZ + 30) / 2 - 0.5]; sc.add(wall);
    // ゴミ置き場・パレット
    B.put(Geo.rbox(1.5, 1.05, 0.9, 0.04), [-RX - 0.7, 0.55, -RZ - 1.6], [0, PI / 2, 0], 1, rgb('#2F5D44'), { rough: 0.5 }); B.put(Geo.box(0.95, 0.06, 1.55), [-RX - 0.7, 1.1, -RZ - 1.6], [0.12, 0, 0], 1, rgb('#244A36'), { rough: 0.5 });
    block(-RX - 1.2, -RZ - 2.4, -RX - 0.2, -RZ - 0.8);
    for (let k = 0; k < 4; k++) { const y = 0.07 + k * 0.14; for (let i = 0; i < 5; i++) B.put(Geo.box(0.12, 0.025, 1.2), [-RX - 0.75 - 0.4 + i * 0.2, y + 0.06, bd + 4.4], 0, 1, rgb('#B08A60'), { rough: 0.8 }); B.put(Geo.box(1.0, 0.1, 0.1), [-RX - 0.75, y, bd + 4.4 - 0.5], 0, 1, rgb('#9A7550'), { rough: 0.8 }); B.put(Geo.box(1.0, 0.1, 0.1), [-RX - 0.75, y, bd + 4.4 + 0.5], 0, 1, rgb('#9A7550'), { rough: 0.8 }); }
    block(-RX - 1.3, bd + 3.75, -RX - 0.2, bd + 5.05);
    // 搬入口の灯り・表示
    B.put(Geo.box(0.16, 0.08, 0.3), [-RX - 0.28, 2.42, bd], 0, 1, rgb('#2A2624'), { rough: 0.4 });
    sc.add(new Node(B.build(e)));
    const lamp = new Node(e.mesh(Geo.box(0.12, 0.03, 0.24), '#FFF1D2'), { em: 1, cast: false, recv: false }); lamp.p = [-RX - 0.3, 2.37, bd]; sc.add(lamp);
    if (!W.dockCv) { W.dockCv = document.createElement('canvas'); W.dockCv.width = 256; W.dockCv.height = 96; const c = W.dockCv.getContext('2d'); c.fillStyle = '#1F2A24'; c.fillRect(0, 0, 256, 96); c.fillStyle = '#E8D3A6'; c.textAlign = 'center'; c.font = '700 40px "Zen Kaku Gothic New",sans-serif'; c.fillText('搬入口', 128, 52); c.font = '500 18px "Zen Kaku Gothic New",sans-serif'; c.fillText('DELIVERY', 128, 80); }
    W.dockTex = W.dockTex || e.texFromCanvas(W.dockCv, false);
    const sign = new Node(e.mesh(Geo.card(0.75, 0.28), null, { rough: 0.6 }), { tex: W.dockTex, cast: false }); sign.p = [-RX - 0.21, 2.62, bd]; sign.r = [0, -PI / 2, 0]; sc.add(sign);
    W.buildTruck(e, sc);
  };
  // 配送トラック（前が +z。荷台は後ろが開いていて、中に段ボールが積んである）
  W.buildTruck = function (e, sc) {
    if (!W.truckCv) {
      const c = (W.truckCv = document.createElement('canvas')); c.width = 512; c.height = 256; const x = c.getContext('2d');
      x.fillStyle = '#F6F4EF'; x.fillRect(0, 0, 512, 256); x.fillStyle = '#2F4A3F'; x.fillRect(0, 170, 512, 40); x.fillStyle = '#C9A35E'; x.fillRect(0, 210, 512, 8);
      x.fillStyle = '#2F4A3F'; x.textAlign = 'center'; x.font = '700 64px "Zen Kaku Gothic New",sans-serif'; x.fillText('新鮮食材便', 256, 110);
      x.font = '600 26px "Zen Kaku Gothic New",sans-serif'; x.fillStyle = '#7A6A58'; x.fillText('FRESH  INGREDIENTS  DELIVERY', 256, 150);
    }
    W.truckTex = W.truckTex || e.texFromCanvas(W.truckCv, false);
    const root = new Node(), B = new Builder(), gloss = { rough: 0.3 }, white = rgb('#F6F4EF'), wall = { rough: 0.45 };
    B.put(Geo.box(1.9, 0.28, 5.4), [0, 0.48, -0.1], 0, 1, rgb('#2A2624'), { rough: 0.6 });
    // 荷台（床・天井・左右・前の壁。後ろは開いている）
    const cz = -0.95, cl = 3.6, cw = 2.24, ch = 2.3, cy0 = 0.62;
    B.put(Geo.box(cw, 0.06, cl), [0, cy0 + 0.03, cz], 0, 1, rgb('#8C7A64'), { rough: 0.8 });
    B.put(Geo.box(cw, 0.06, cl), [0, cy0 + ch - 0.03, cz], 0, 1, white, wall);
    [-1, 1].forEach((sd) => B.put(Geo.box(0.05, ch, cl), [sd * (cw / 2 - 0.025), cy0 + ch / 2, cz], 0, 1, white, wall));
    B.put(Geo.box(cw, ch, 0.05), [0, cy0 + ch / 2, cz + cl / 2 - 0.025], 0, 1, white, wall);
    for (let k = 0; k < 5; k++) [-1, 1].forEach((sd) => B.put(Geo.box(0.02, 0.05, cl - 0.1), [sd * (cw / 2 - 0.06), cy0 + 0.4 + k * 0.38, cz], 0, 1, rgb('#B9B4AC'), gloss));
    B.put(Geo.box(cw + 0.04, 0.08, 0.08), [0, cy0 + ch - 0.04, cz - cl / 2], 0, 1, rgb('#B9B4AC'), gloss);
    B.put(Geo.box(cw + 0.04, 0.1, 0.1), [0, cy0 - 0.02, cz - cl / 2], 0, 1, rgb('#3A3E42'), { rough: 0.4, metal: 0.6 });
    // 運転席
    B.put(Geo.rbox(2.12, 1.55, 1.55, 0.14), [0, 1.36, 1.85], 0, 1, rgb('#2F6E9E'), gloss);
    B.put(Geo.rbox(2.0, 0.55, 1.2, 0.1), [0, 2.18, 1.72], 0, 1, rgb('#2F6E9E'), gloss);
    B.put(Geo.box(1.86, 0.62, 0.04), [0, 1.88, 2.56], [-0.18, 0, 0], 1, rgb('#1B2530'), { rough: 0.05 });
    [-1, 1].forEach((sd) => { B.put(Geo.box(0.04, 0.5, 0.75), [sd * 1.065, 1.93, 1.95], 0, 1, rgb('#1B2530'), { rough: 0.05 }); B.put(Geo.box(0.06, 0.2, 0.14), [sd * 1.15, 1.88, 2.45], 0, 1, rgb('#2A2624'), gloss); });
    B.put(Geo.box(2.14, 0.32, 0.12), [0, 0.66, 2.66], 0, 1, rgb('#3A3E42'), { rough: 0.4, metal: 0.6 });
    root.add(new Node(B.build(e)));
    [-1, 1].forEach((sd) => { const side = new Node(e.mesh(Geo.card(3.3, 1.65), null, { rough: 0.5 }), { tex: W.truckTex, cast: false }); side.p = [sd * (cw / 2 + 0.003), cy0 + ch / 2, cz]; side.r = [0, sd * PI / 2, 0]; root.add(side); });
    // 後ろの観音扉（止まると開く）
    const doors = [-1, 1].map((sd) => {
      const hinge = new Node(); hinge.p = [sd * cw / 2, cy0 + ch / 2, cz - cl / 2]; root.add(hinge);
      const leaf = new Node(e.mesh(Geo.box(cw / 2 - 0.02, ch - 0.1, 0.04), '#F2F0EB', { rough: 0.45 })); leaf.p = [-sd * (cw / 4), 0, -0.02]; hinge.add(leaf);
      const bar = new Node(e.mesh(Geo.cyl(0.015, 0.015, ch - 0.3, 8), '#9AA0A6', { rough: 0.3, metal: 1 })); bar.p = [-sd * (cw / 2 - 0.15), 0, -0.05]; hinge.add(bar);
      return { hinge, sd, a: 0 };
    });
    const L2 = new Builder();
    [-0.78, 0.78].forEach((x) => L2.put(Geo.box(0.32, 0.14, 0.04), [x, 0.88, 2.72], 0, 1, rgb('#FFF6DD')));
    [-0.95, 0.95].forEach((x) => L2.put(Geo.box(0.16, 0.24, 0.04), [x, 0.75, -2.82], 0, 1, rgb('#E2402F')));
    L2.put(Geo.box(1.8, 0.02, 0.04), [0, cy0 + ch - 0.08, cz], 0, 1, rgb('#FFF6E4'));
    root.add(new Node(L2.build(e), { em: 1, cast: false, recv: false }));
    const wm = new Builder(); wm.put(Geo.cyl(0.42, 0.42, 0.3, 20), [0, 0, 0], [0, 0, PI / 2], 1, rgb('#1C1C1E'), { rough: 0.8 }); wm.put(Geo.cyl(0.24, 0.24, 0.32, 14), [0, 0, 0], [0, 0, PI / 2], 1, rgb('#9AA0A6'), { rough: 0.3, metal: 1 }); for (let k = 0; k < 5; k++) wm.put(Geo.box(0.33, 0.06, 0.06), [0, 0, 0.16], [k * PI * 0.4, 0, 0], 1, rgb('#6E757C'), { rough: 0.3, metal: 1 });
    const wmesh = wm.build(e), wheels = [];
    [[-0.95, 1.75], [0.95, 1.75], [-0.95, -1.55], [0.95, -1.55], [-0.95, -2.15], [0.95, -2.15]].forEach(([x, z]) => { const w = new Node(wmesh); w.p = [x, 0.42, z]; root.add(w); wheels.push(w); });
    root.vis = false; sc.add(root);
    W.truck = { node: root, wheels, doors, spin: 0, z: null };
  };
  // トラックの動き（到着時刻と出発時刻から決まるので全員の画面で同じ）
  W.updateTruck = function (s, g, dt) {
    const tr = W.truck, TT = K.TRUCK, tk = s.k.truck; W.dynBlocks = [];
    if (!tr) return;
    if (!tk) { tr.node.vis = false; tr.z = null; return; }
    const P0 = W.L.truck; let z, parked = false;
    if (g < tk.at) { const f = clamp(1 - (tk.at - g) / TT.IN, 0, 1); z = P0.z - 42 * Math.pow(1 - f, 2.2); }
    else if (!tk.out || g < tk.out) { z = P0.z; parked = true; }
    else { const f = clamp((g - tk.out) / TT.OUT, 0, 1); z = P0.z + 40 * f * f; }
    tr.node.vis = z < RZ + 16; tr.node.p = [P0.x, 0, z];
    if (tr.z !== null) { tr.spin += (z - tr.z) / 0.42; tr.wheels.forEach((w) => (w.r = [tr.spin, 0, 0])); }
    tr.z = z;
    tr.doors.forEach((d) => { d.a = lerp(d.a, parked ? 1.75 : 0, 1 - Math.exp(-dt * 3)); d.hinge.r = [0, d.sd * d.a, 0]; });
    if (Math.abs(z - P0.z) < 7) W.dynBlocks.push([P0.x - 1.15, z - 2.85, P0.x + 1.15, z + 2.75]);
    if (parked && W._truckAt !== tk.at) {
      W._truckAt = tk.at;
      if (Object.values(s.k.items).some((it) => it.t === 'crate' && String(it.at).startsWith('dl:'))) { CS.sound.play('beep'); CS.ui.toast('トラックが到着！裏口から出て、荷台の段ボールを在庫室へ運ぼう', 'good'); }
    }
  };
  // 在庫室（乾物の棚・冷蔵ケース・段ボール回収）と事務室（パソコン）
  W.buildRooms = function (e, sc, L, P, T, LB) {
    const SR = L.store, OF = L.office, th = 0.14, WB = new Builder(), TRM = new Builder();
    const pw = { rough: 0.85 }, trim = { rough: 0.45 };
    // 壁（入口のすき間を空けて立てる）。zz=[z0,z1] の範囲に、gap=[g0,g1] を除いて
    const wallX = (x, z0, z1, gap) => { const segs = gap ? [[z0, gap[0]], [gap[1], z1]] : [[z0, z1]]; segs.forEach(([a, b]) => { if (b - a < 0.02) return; WB.put(Geo.box(th, WH, b - a, 1), [x, WH / 2, (a + b) / 2], 0, 1, [1, 1, 1], pw); TRM.put(Geo.box(th + 0.02, 0.1, b - a), [x, 0.05, (a + b) / 2], 0, 1, C.walnut, trim); block(x - th / 2, a, x + th / 2, b); }); if (gap) { WB.put(Geo.box(th, WH - 2.15, gap[1] - gap[0], 1), [x, (WH + 2.15) / 2, (gap[0] + gap[1]) / 2], 0, 1, [1, 1, 1], pw); [gap[0], gap[1]].forEach((z) => TRM.put(Geo.box(th + 0.04, 2.15, 0.06), [x, 1.075, z], 0, 1, C.walnut, trim)); TRM.put(Geo.box(th + 0.04, 0.06, gap[1] - gap[0] + 0.12), [x, 2.15, (gap[0] + gap[1]) / 2], 0, 1, C.walnut, trim); } };
    const wallZ = (z, x0, x1) => { WB.put(Geo.box(x1 - x0, WH, th, 1), [(x0 + x1) / 2, WH / 2, z], 0, 1, [1, 1, 1], pw); TRM.put(Geo.box(x1 - x0, 0.1, th + 0.02), [(x0 + x1) / 2, 0.05, z], 0, 1, C.walnut, trim); block(x0, z - th / 2, x1, z + th / 2); };
    wallX(SR.x1, SR.z0, SR.z1 + th / 2, [SR.door - 0.55, SR.door + 0.55]);
    wallZ(SR.z1, SR.x0, SR.x1 + th / 2);
    wallX(OF.x0, OF.z0 - th / 2, OF.z1 + th / 2, [OF.door - 0.55, OF.door + 0.55]);
    wallZ(OF.z0, OF.x0, OF.x1); wallZ(OF.z1, OF.x0, OF.x1);
    sc.add(new Node(WB.build(e), { tex: T.plaster, ao: 0, cast: false }));
    sc.add(new Node(TRM.build(e), { ao: 0 }));
    // 入口の上の表示
    const signCard = (text, sub, x, z, ry) => {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const g = cv.getContext('2d');
      g.fillStyle = '#2A2624'; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#C9A35E'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 88);
      g.fillStyle = '#F2EBE1'; g.textAlign = 'center'; g.font = '700 40px "Zen Kaku Gothic New",sans-serif'; g.fillText(text, 128, 52); g.fillStyle = '#C9A35E'; g.font = '600 18px "Zen Kaku Gothic New",sans-serif'; g.fillText(sub, 128, 80);
      const n = new Node(e.mesh(Geo.card(0.62, 0.23), null, { rough: 0.6 }), { tex: e.texFromCanvas(cv, false), cast: false }); n.p = [x, 2.42, z]; n.r = [0, ry, 0]; sc.add(n);
    };
    signCard('在庫室', 'STOCK ROOM', SR.x1 + th / 2 + 0.01, SR.door, PI / 2);
    signCard('事務室', 'OFFICE・PC', OF.x0 - th / 2 - 0.01, OF.door, -PI / 2);
    // ---- 在庫室：乾物の棚（奥の壁ぞい） ----
    const dx0 = -RX + 0.3, dx1 = -RX + 3.95, dcx = (dx0 + dx1) / 2, dz = -RZ + 0.33;
    [0.06, 0.43, 0.93, 1.43, 1.95].forEach((y) => P('oak', Geo.box(dx1 - dx0, 0.03, 0.46), [dcx, y, dz]));
    [dx0, dcx, dx1].forEach((x) => P('oak', Geo.box(0.04, 1.98, 0.46), [x, 0.99, dz]));
    P('oak', Geo.box(dx1 - dx0, 1.98, 0.02), [dcx, 0.99, dz - 0.22], 0, 1, rgb('#B08A60'));
    block(dx0, -RZ, dx1, dz + 0.25);
    // ---- 在庫室：冷蔵ケース3台（手前の壁ぞい・前が開いた多段タイプ） ----
    for (let u = 0; u < 3; u++) {
      const cx = -RX + 0.85 + u * 1.25, cz = -RZ + 4.27, w = 1.18;
      P('steel', Geo.box(w, 2.05, 0.04), [cx, 1.025, cz + 0.27], 0, 1, rgb('#D9DCE0'));
      [-1, 1].forEach((sd) => P('steel', Geo.box(0.04, 2.05, 0.58), [cx + sd * (w / 2 - 0.02), 1.025, cz], 0, 1, rgb('#C7CBD0')));
      P('steel', Geo.box(w, 0.3, 0.58), [cx, 2.0, cz], 0, 1, rgb('#2F4A3F'));
      P('steel', Geo.box(w, 0.42, 0.62), [cx, 0.21, cz], 0, 1, rgb('#B9BEC4'));
      [0.97, 0.51, 1.43].forEach((y) => P('steel', Geo.box(w - 0.06, 0.02, 0.5), [cx, y - 0.01, cz], 0, 1, rgb('#E6E9EC')));
      LB.put(Geo.box(w - 0.08, 0.015, 0.03), [cx, 1.83, cz - 0.24], 0, 1, rgb('#E8F4FF'));
      P('gloss', Geo.box(w - 0.06, 0.06, 0.02), [cx, 0.44, cz - 0.28], 0, 1, rgb('#9FC5E8'), { rough: 0.1 });
      block(cx - w / 2, cz - 0.3, cx + w / 2, cz + 0.3);
    }
    // 段ボール回収（青いかご）
    const [rx, rz] = L.trash[2];
    P('paint', Geo.rbox(0.55, 0.62, 0.55, 0.04), [rx, 0.31, rz], 0, 1, rgb('#3F6F93'));
    for (let k = 0; k < 3; k++) P('paint', Geo.box(0.5, 0.02, 0.38), [rx, 0.55 + k * 0.02, rz], [0.06 * k, 0.4 * k, 0], 1, C.card);
    // ---- 事務室：机とパソコン（buildStatic の机）・本棚・ホワイトボード・観葉植物 ----
    const ox = OF.x0, oz0 = OF.z0, oz1 = OF.z1;
    P('walnut', Geo.box(1.6, 1.9, 0.36), [ox + 1.15, 0.95, oz0 + 0.27]);
    [0.4, 0.85, 1.3, 1.75].forEach((y, k) => { for (let i = 0; i < 9; i++) P('paint', Geo.box(0.05 + (i % 3) * 0.01, 0.26 - (i % 2) * 0.04, 0.24), [ox + 0.5 + i * 0.16, y + 0.14, oz0 + 0.3], [0, 0, (i % 4 === 3 ? 0.15 : 0)], 1, rgb(['#7A3B3B', '#2F4A3F', '#C9A35E', '#3F6F93', '#E9DCC9'][(i + k) % 5])); P('walnut', Geo.box(1.52, 0.025, 0.32), [ox + 1.15, y, oz0 + 0.27]); });
    block(ox + 0.33, oz0, ox + 1.97, oz0 + 0.48);
    const wbCv = document.createElement('canvas'); wbCv.width = 512; wbCv.height = 256; { const g = wbCv.getContext('2d'); g.fillStyle = '#FBFBF8'; g.fillRect(0, 0, 512, 256); g.strokeStyle = '#8A8F95'; g.lineWidth = 8; g.strokeRect(0, 0, 512, 256); g.fillStyle = '#2F4A6E'; g.font = '700 34px "Zen Kaku Gothic New",sans-serif'; g.fillText('今日のめあて', 24, 52); g.font = '500 26px "Zen Kaku Gothic New",sans-serif'; g.fillStyle = '#333'; ['・焦がさない！', '・注文は早く渡す', '・相場より高すぎない値段に', '・段ボールは在庫室で開ける'].forEach((t, i) => g.fillText(t, 34, 100 + i * 38)); g.strokeStyle = '#C0392B'; g.lineWidth = 4; g.beginPath(); g.moveTo(380, 200); g.lineTo(420, 150); g.lineTo(450, 175); g.lineTo(490, 110); g.stroke(); }
    const wb = new Node(e.mesh(Geo.card(1.5, 0.75), null, { rough: 0.3 }), { tex: e.texFromCanvas(wbCv, false), cast: false }); wb.p = [ox + 1.9, 1.6, oz1 - th / 2 - 0.01]; wb.r = [0, PI, 0]; sc.add(wb);
    P('steel', Geo.box(1.56, 0.81, 0.02), [ox + 1.9, 1.6, oz1 - th / 2], 0, 1, rgb('#B9BEC4'));
    P('paint', Geo.rbox(0.45, 0.7, 0.55, 0.02), [ox + 0.35, 0.35, oz1 - 0.45], 0, 1, rgb('#8A8F95'));
    block(ox + 0.1, oz1 - 0.75, ox + 0.6, oz1 - 0.1);
    P('paint', Geo.cyl(0.18, 0.14, 0.36, 16), [OF.x1 - 0.35, 0.18, oz1 - 0.35], 0, 1, C.terracotta);
    for (let i = 0; i < 6; i++) P('plant', Geo.sphere(0.12, 10, 8), [OF.x1 - 0.35 + Math.sin(i * 2.4) * 0.1, 0.48 + i * 0.07, oz1 - 0.35 + Math.cos(i * 2.4) * 0.1], [i * 0.5, 0, 0.3], [1, 1.6, 0.5], shade(C.leaf, (i % 3) * 0.08));
  };
  // 厨房の冷蔵庫（ガラス扉・中は LED で明るい）。生クリーム・ケーキ・焼いたスポンジを入れると傷まない
  W.buildFridge = function (e, sc, L, P, LB) {
    const F = L.fridge; if (!F) return;
    const x = F.x, hw = F.w / 2, z0 = -RZ, z1 = -RZ + F.d, zc = (z0 + z1) / 2, H = F.h, th = 0.045;
    const body = rgb('#D6DADE'), inner = rgb('#F4F6F7'), dark = rgb('#3A3F44');
    P('steel', Geo.rbox(F.w, 0.13, F.d, 0.01), [x, 0.065, zc], 0, 1, rgb('#9AA0A6'));
    P('steel', Geo.rbox(F.w, 0.24, F.d, 0.01), [x, H - 0.12, zc], 0, 1, body);
    [-1, 1].forEach((sd) => P('steel', Geo.box(th, H - 0.37, F.d), [x + sd * (hw - th / 2), 0.13 + (H - 0.37) / 2, zc], 0, 1, body));
    P('paint', Geo.box(F.w - th * 2, H - 0.37, 0.02), [x, 0.13 + (H - 0.37) / 2, z0 + 0.03], 0, 1, inner, { rough: 0.35 });
    P('paint', Geo.box(F.w - th * 2, 0.02, F.d - 0.06), [x, 0.14, zc], 0, 1, inner, { rough: 0.35 });
    // 棚（網）
    F.ys.forEach((y) => { P('steel', Geo.box(F.w - th * 2 - 0.02, 0.012, F.d - 0.12), [x, y, zc - 0.02], 0, 1, rgb('#C7CBD0')); for (let k = 0; k < 9; k++) P('steel', Geo.box(0.006, 0.014, F.d - 0.12), [x - hw + 0.12 + k * ((F.w - 0.24) / 8), y + 0.008, zc - 0.02], 0, 1, rgb('#AEB3B8')); });
    // 扉（2枚のガラス・取っ手）
    const fz = z1 + 0.012, dw = hw - th;
    [-1, 1].forEach((sd) => {
      const cx = x + sd * (dw / 2 + 0.005);
      P('steel', Geo.box(dw, 0.05, 0.03), [cx, 0.15, fz], 0, 1, dark); P('steel', Geo.box(dw, 0.05, 0.03), [cx, H - 0.265, fz], 0, 1, dark);
      P('steel', Geo.box(0.04, H - 0.42, 0.03), [cx - dw / 2 + 0.02, 0.13 + (H - 0.37) / 2, fz], 0, 1, dark); P('steel', Geo.box(0.04, H - 0.42, 0.03), [cx + dw / 2 - 0.02, 0.13 + (H - 0.37) / 2, fz], 0, 1, dark);
      P('steel', Geo.cyl(0.012, 0.012, 0.62, 10), [x + sd * 0.07, 1.1, fz + 0.045], 0, 1, rgb('#E1E4E7'));
      [0.82, 1.38].forEach((y) => P('steel', Geo.box(0.02, 0.02, 0.05), [x + sd * 0.07, y, fz + 0.025], 0, 1, rgb('#E1E4E7')));
      const g = new Node(e.mesh(Geo.box(dw - 0.06, H - 0.48, 0.008), null, { rough: 0.04 }), { color: rgb('#CFE3EE'), op: 0.14, cast: false, recv: false });
      g.p = [cx, 0.13 + (H - 0.37) / 2, fz]; sc.add(g);
    });
    // 中の照明（LED）と温度表示
    LB.put(Geo.box(F.w - 0.16, 0.012, 0.03), [x, H - 0.255, z1 - 0.07], 0, 1, rgb('#F4FBFF'));
    if (!W.frTex) { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const g = cv.getContext('2d'); g.fillStyle = '#20262B'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#8FD3FF'; g.font = '700 30px "Zen Kaku Gothic New",sans-serif'; g.textAlign = 'left'; g.fillText('❄ 冷蔵庫', 14, 43); g.textAlign = 'right'; g.fillStyle = '#9BE08A'; g.font = '700 32px monospace'; g.fillText('3℃', 242, 44); W.frTex = e.texFromCanvas(cv, false); }
    const sign = new Node(e.mesh(Geo.card(0.62, 0.155), null, { rough: 0.4 }), { tex: W.frTex, em: 0.85, cast: false }); sign.p = [x, H - 0.12, z1 + 0.006]; sc.add(sign);
    block(x - hw, -RZ, x + hw, z1 + 0.05);
  };
  // 在庫室の棚に、いまの在庫の数だけ品物を並べる
  const PKG = { flour: ['#EDE3CF', 0.16, 0.2, 0.11], sugar: ['#F7F5F0', 0.14, 0.16, 0.1], cocoa: ['#6B4030', 0.1, 0.13, 0.1], matcha: ['#7E9B4E', 0.09, 0.12, 0.09], choco: ['#4A2A1C', 0.16, 0.04, 0.09], chestnut: ['#9A5A22', 0.1, 0.11, 0.1], egg: ['#E9D9B5', 0.2, 0.07, 0.11], butter: ['#F4DD8A', 0.11, 0.05, 0.07], milk: ['#F2F2EE', 0.08, 0.2, 0.08], cream: ['#FFFDF6', 0.07, 0.14, 0.07], cheese: ['#F3E7C2', 0.12, 0.06, 0.1], strawberry: ['#C8102E', 0.14, 0.07, 0.1], blueberry: ['#2E3560', 0.12, 0.06, 0.09], peach: ['#F6A06B', 0.08, 0.08, 0.08], lemon: ['#F7D94C', 0.07, 0.07, 0.07] };
  W.updateStock = function (s) {
    if (!W.stockGroup) return;
    const e = W.eng; W.stockN = W.stockN || {};
    for (const ing in W.L.stock) {
      const n = Math.min(48, sim.invCount(s, ing)), o = W.stockN[ing];
      if (o && o.n === n && o.g === W.stockGroup) continue;
      if (o && o.node) { W.stockGroup.remove(o.node); e.freeTree(o.node); }
      const st = W.L.stock[ing], pk = PKG[ing] || ['#DDD', 0.1, 0.1, 0.1], B = new Builder();
      const cols = Math.max(1, Math.floor((st.w - 0.06) / (pk[1] + 0.03))), rows = Math.max(1, Math.floor((st.d - 0.04) / (pk[3] + 0.03)));
      const col = rgb(pk[0]), white = rgb('#F2F0EC'), cap = rgb('#3F6F93');
      const round = ing === 'peach' || ing === 'lemon', berry = ing === 'strawberry' || ing === 'blueberry', carton = ing === 'milk' || ing === 'cream';
      const gA = round ? Geo.sphere(pk[1] / 2, 10, 8) : berry ? Geo.rbox(pk[1], pk[2] * 0.6, pk[3], 0.008) : Geo.rbox(pk[1], pk[2], pk[3], 0.01);
      const gB = berry ? Geo.sphere(0.022, 8, 6) : carton ? Geo.box(pk[1] * 0.9, 0.02, pk[3] * 0.9) : null;
      for (let k = 0; k < n; k++) {
        const layer = Math.floor(k / (cols * rows)), kk = k % (cols * rows), cx = kk % cols, rz = Math.floor(kk / cols);
        if (layer > 1) break;
        const x = st.p[0] - st.w / 2 + 0.05 + pk[1] / 2 + cx * (pk[1] + 0.03), z = st.p[2] + st.f * (st.d / 2 - 0.04 - pk[3] / 2 - rz * (pk[3] + 0.03)), y = st.p[1] + 0.012 + pk[2] / 2 + layer * (pk[2] + 0.005);
        if (round) B.put(gA, [x, y, z], 0, 1, col, { rough: 0.5 });
        else if (berry) { B.put(gA, [x, y - pk[2] * 0.2, z], 0, 1, white, { rough: 0.3 }); for (let b = 0; b < 4; b++) B.put(gB, [x - 0.03 + (b % 2) * 0.06, y + pk[2] * 0.15, z - 0.025 + Math.floor(b / 2) * 0.05], 0, 1, col, { rough: 0.3 }); }
        else { B.put(gA, [x, y, z], 0, 1, col, { rough: 0.6 }); if (carton) B.put(gB, [x, y + pk[2] / 2 + 0.01, z], 0, 1, cap, { rough: 0.4 }); }
      }
      const node = B.empty() ? null : W.stockGroup.add(new Node(B.build(e)));
      W.stockN[ing] = { n, node, g: W.stockGroup };
    }
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
    W.eng.freeTree(W.stationGroup); W.stationGroup.clear(); W.st = { mix: [], whip: [], deco: [] };
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
    const key = [it.t, it.st || '', it.b || '', it.k || it.ing || '', it.t === 'box' ? it.s.length : '', (it.df || []).includes('burnt') ? 'B' : '', it.t === 'crate' ? (it.open ? 'o' + Math.min(10, it.n) : 'c') : ''].join('|');
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
    } else if (it.t === 'crate' && it.open) {
      // 開けた段ボール：ふたが開いて中身が見える
      const cb = { rough: 0.85 }, cc = C.card, W2 = 0.48, D2 = 0.36, H2 = 0.34;
      B.put(Geo.box(W2, 0.012, D2), [0, 0.006, 0], 0, 1, cc, cb);
      [-1, 1].forEach((sd) => { B.put(Geo.box(W2, H2, 0.012), [0, H2 / 2, sd * (D2 / 2)], 0, 1, cc, cb); B.put(Geo.box(0.012, H2, D2), [sd * (W2 / 2), H2 / 2, 0], 0, 1, cc, cb); });
      [-1, 1].forEach((sd) => { B.put(Geo.box(W2, 0.012, D2 / 2), [0, H2 + 0.02, sd * (D2 / 2 + D2 / 4 - 0.02)], [sd * 1.25, 0, 0], 1, mix(cc, '#000000', 0.06), cb); B.put(Geo.box(W2 / 2, 0.012, D2), [sd * (W2 / 2 + W2 / 4 - 0.03), H2 + 0.02, 0], [0, 0, -sd * 1.3], 1, mix(cc, '#000000', 0.1), cb); });
      const pk = PKG[it.ing] || ['#DDD', 0.1, 0.1, 0.1], n = Math.min(10, it.n);
      for (let k = 0; k < n; k++) { const cx = (k % 5) - 2, cz2 = Math.floor(k / 5) - 0.5; B.put(Geo.rbox(Math.min(0.085, pk[1]), Math.min(0.2, pk[2]), Math.min(0.15, pk[3]), 0.008), [cx * 0.088, H2 - Math.min(0.2, pk[2]) / 2 - 0.02, cz2 * 0.16], 0, 1, rgb(pk[0]), { rough: 0.6 }); }
    } else if (it.t === 'crate') {
      B.put(Geo.rbox(0.48, 0.34, 0.36, 0.01), [0, 0.17, 0], 0, 1, C.card, { rough: 0.85 });
      B.put(Geo.box(0.485, 0.04, 0.05), [0, 0.32, 0], 0, 1, rgb('#B88C5E'), { rough: 0.8 });
      B.put(Geo.box(0.16, 0.12, 0.005), [0, 0.18, 0.182], 0, 1, rgb(ING_COL[it.ing] || '#ddd'), { rough: 0.7 });
      B.put(Geo.box(0.005, 0.12, 0.16), [0.242, 0.18, 0], 0, 1, rgb(ING_COL[it.ing] || '#ddd'), { rough: 0.7 });
    } else if (it.t === 'top') {
      MD.topPiece(B, it.k, [0, 0, 0], 2.2);
      if (B.empty()) B.put(Geo.sphere(0.03, 10, 8), [0, 0.03, 0], 0, 1, rgb(ING_COL[it.k] || '#ccc'), { rough: 0.3 });
    }
    return (meshCache[key] = CS.gl.keep(B.build(e)));
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
      W.keys.ov = s.ovens.length; e.freeTree(W.ovenGroup); W.ovenGroup.clear(); W.ovens = [];
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
      W.keys.cs = caseKey; e.freeTree(W.caseGroup); W.caseGroup.clear();
      W.standM = W.standM || CS.gl.keep(e.mesh(Geo.cyl(0.19, 0.19, 0.012, 32), '#F4F1EC', { rough: 0.2 }));
      s.showcase.forEach((c, i) => {
        const p = W.L.cases[i]; if (!p) return;
        const stand = new Node(W.standM); stand.p = [p[0], 0.906, p[2]]; W.caseGroup.add(stand);
        if (c) { const r = sim.recipe(s, c.r); if (r) { const n = MD.cake(e, r, Math.max(1, Math.round((c.p / (c.n || 6)) * 6)), CAKE_SC * 0.95, c.df); n.p = [p[0], 0.913, p[2]]; n.r = [0, PI * 0.1, 0]; W.caseGroup.add(n); } }
      });
    }
    // 小物
    const seen = {};
    for (const id in s.k.items) {
      const it = s.k.items[id]; seen[id] = 1;
      const key = JSON.stringify([it.t, it.st, it.b, it.k, it.ing, it.s && it.s.length, it.df, it.cr, it.tp, it.r, it.p]);
      let o = W.items[id];
      if (o && o.key !== key) { W.itemGroup.remove(o.n); e.freeTree(o.n); o = null; }
      if (!o) { const m = itemMesh(it); const n = m ? new Node(m) : decoNode(it, s); W.itemGroup.add(n); o = W.items[id] = { n, key }; }
      o.it = it;
    }
    for (const id in W.items) if (!seen[id]) { W.itemGroup.remove(W.items[id].n); e.freeTree(W.items[id].n); delete W.items[id]; }
    const uk = JSON.stringify([s.up.interior || 0, s.up.sign || 0, s.furn, s.up.floor || 0, s.name, LK]);
    if (W.keys.up !== uk) { W.keys.up = uk; W.decorate(s); }
    W.updateStock(s);
    const mk = JSON.stringify([s.menu, s.known]);
    if (W.keys.mb !== mk) { W.keys.mb = mk; W.drawBoard(s); }
    if (W.keys.op !== s.phase) { W.keys.op = s.phase; W.drawOpen(s.phase === 'open'); }
  };
  W.rebuild = function () {
    W._keep = {};
    for (const id in W.custs) { const o = W.custs[id]; W._keep[id] = [o.x, o.z, o.r]; }
    for (const id in W.staffN) { const o = W.staffN[id]; W._keep[id] = [o.x, o.z, o.r]; }
    W.eng.freeTree(W.scene); W.scene.clear();
    W.keys = { mb: W.keys.mb }; W.ovens = []; W.items = {}; W.others = {}; W.custs = {}; W.staffN = {}; W.stockN = {};
    W.buildStatic();
    W.applyQuality();
    const [x, z] = collide(W.me.x, W.me.z, 0.3); W.me.x = x; W.me.z = z;
    if (W.boardCv && W.S) W.drawBoard(W.S);
  };
  W.decorate = function (s) {
    const e = W.eng;
    const lv = s.up.interior || 0;
    e.updateTex(W.T.plaster, MD.TX.plaster(['#EFE8DD', '#E6EEE6', '#EDE4EC', '#F2EADB'][Math.min(3, lv)]));
    e.freeTree(W.decoGroup); W.decoGroup.clear();
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
    for (let i = 0; i < plants; i++) { const px = i % 2 ? RX - 0.6 : -RX + 0.6, z = CASE_Z + (i % 2 ? 4.7 : 3.0) + Math.floor(i / 2) * 2.2; if (z > RZ - 1.3) continue; P('d', Geo.cyl(0.2, 0.15, 0.4, 18), [px, 0.2, z], 0, 1, C.terracotta, { rough: 0.6 }); for (let k = 0; k < 7; k++) P('d', Geo.sphere(0.13, 10, 8), [px + Math.sin(k * 2.4) * 0.12, 0.55 + k * 0.08, z + Math.cos(k * 2.4) * 0.12], [k * 0.5, 0, 0.3], [1, 1.6, 0.5], shade(C.leaf, (k % 3) * 0.08), { rough: 0.7 }); fblock(px - 0.22, z - 0.22, px + 0.22, z + 0.22); }
    if (s.furn.coffee) { const x = RX - 0.45, z = CASE_Z + 1.1; P('w', Geo.rbox(0.6, 0.9, 0.9, 0.02), [x - 0.05, 0.45, z], 0, 1, null, { rough: 0.5 }); P('d', Geo.rbox(0.42, 0.45, 0.4, 0.04), [x - 0.05, 1.13, z], 0, 1, rgb('#2A2624'), { rough: 0.3, metal: 0.4 }); P('d', Geo.cyl(0.035, 0.03, 0.08, 12), [x - 0.15, 0.94, z + 0.25], 0, 1, rgb('#F2EFE8'), { rough: 0.15 }); fblock(x - 0.36, z - 0.46, RX, z + 0.46); }
    if (s.furn.speaker) [-1, 1].forEach((sd) => P('d', Geo.rbox(0.22, 0.34, 0.2, 0.02), [sd * (RX - 0.15), 2.7, CASE_Z + 1.5], [0, sd * 0.5, 0], 1, rgb('#2A2624'), { rough: 0.5 }));
    if (lv >= 1) [[-RX + 0.1, CASE_Z + 4.3], [-RX + 0.1, CASE_Z + 6.4]].forEach(([x, z]) => { P('d', Geo.cyl(0.015, 0.015, 0.6, 10), [x + 0.1, 2.38, z], [PI / 2, 0, 0], 1, rgb('#C9A35E'), { rough: 0.25, metal: 1 }); P('d', Geo.box(0.12, 0.02, 0.02), [x + 0.05, 2.38, z], 0, 1, rgb('#C9A35E'), { rough: 0.25, metal: 1 }); });
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
        // クリックはそのまま操作（左＝つかむ・置く／右＝使う）。設定で「マウスを固定」にしたときだけ画面に固定する
        if (ST.lockMouse && !document.pointerLockElement) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* noop */ } }
        if (e.button === 0) { W.primary(); W.primaryHold(true); } else if (e.button === 2) W.secondary();
        if (W.onMouseUsed) W.onMouseUsed('click');
        return;
      }
      touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    };
    const move = (e) => {
      if (e.pointerType === 'mouse') {
        if (W.blocked()) return;
        // ボタンを押さなくても、マウスを動かすだけで見回せる
        look(e.movementX || 0, e.movementY || 0, 0.0022);
        W.mouse = document.pointerLockElement === canvas ? null : { x: e.clientX, y: e.clientY };
        if (W.onMouseUsed && (e.movementX || e.movementY)) W.onMouseUsed('move');
        return;
      }
      const t = touches[e.pointerId]; if (!t) return;
      look(e.clientX - t.x, e.clientY - t.y, 0.0058); t.x = e.clientX; t.y = e.clientY;
    };
    const up = (e) => { delete touches[e.pointerId]; if (e.pointerType === 'mouse') W.primaryHold(false); };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', (e) => { if (e.pointerType !== 'mouse') delete touches[e.pointerId]; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') W.mouse = null; });
    const kd = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (W.blocked()) return;
      W.kb[e.code] = true;
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); W.primary(); W.primaryHold(true); }
      if (e.code === 'KeyF') W.secondary();
      if (e.code === 'KeyQ' || e.code === 'KeyX') W.discard();
    };
    const ku = (e) => { W.kb[e.code] = false; if (e.code === 'KeyE' || e.code === 'Space') W.primaryHold(false); };
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
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    // 画面を裏に回したら、スティックを離したことにする（戻ったときに勝手に歩き続けないように）
    W._joyReset = () => { id = null; knob.style.transform = ''; W.input.joy = null; W.kb = {}; W.primaryHold(false); };
    if (!W._visBound) { W._visBound = true; document.addEventListener('visibilitychange', () => { if (document.hidden && W._joyReset) W._joyReset(); }); }
  };
  W.blocked = function () {
    const m = document.getElementById('modal'), g = document.getElementById('gov');
    const sp = document.getElementById('mg');
    return !!((CS.ui && CS.ui.sheet) || (m && !m.hidden) || W.editing || (g && !g.hidden) || (sp && !sp.hidden));
  };

  // =====================================================================
  //  毎フレーム
  // =====================================================================
  W.frame = function () {
    if (!W.ready) return;
    const now = performance.now();
    const raw = Math.max(0, (now - W.last) / 1000); W.last = now;
    W.autoQuality(now, raw);
    const dt = Math.min(0.05, raw), dtN = Math.min(0.3, raw); // 遅い端末でもお客さん・仲間の動きが遅れないように
    const s = W.S, room = W.room, g = room ? room.now() : 0;
    if (W.blocked() && document.pointerLockElement) document.exitPointerLock();
    for (let k = 0, n = Math.min(5, Math.ceil(raw / 0.05) || 1); k < n; k++) W.updatePlayer(Math.min(0.05, raw / n));
    W.updateCamera(dt);
    W.updateOthers(dtN);
    if (s) { W.updateStations(s, g, dtN); W.updateCustomers(dtN, s, g); W.updateStaff(dtN, s, g); W.updateOvens(s, g); W.updateTruck(s, g, dtN); }
    W.updateTarget(s, g);
    if (s) W.updateItems(s, g);
    W.updateLights();
    W.eng.shadowCenter = [W.me.x - Math.sin(W.me.yaw) * 3, 0, W.me.z - Math.cos(W.me.yaw) * 3];
    W.eng.render(W.scene);
    W.updateLabels(s, g);
  };
  // 重い端末では画質を自動で下げる（2.5 秒ごとに、平均のフレーム間隔を見る）
  W.autoQuality = function (now, raw) {
    if (ST.autoQ === false || ST.light || document.hidden || raw > 1) { W.pf = null; return; }
    const pf = W.pf || (W.pf = { t0: now, n: 0, sum: 0 });
    pf.n++; pf.sum += Math.min(raw, 0.25);
    if (now - pf.t0 < 2500) return;
    const avg = pf.sum / Math.max(1, pf.n); W.pf = null;
    if (avg > 0.048 && (W.qlv || 0) < 3 && now - (W.qT || 0) > 3000) {
      W.qlv = (W.qlv || 0) + 1; W.qT = now; CS.LS.set('cs.qlv', W.qlv); W.applyQuality();
      if (!W._qToast && CS.ui && CS.ui.toast) { W._qToast = 1; CS.ui.toast('動きが重いので画質を自動で下げました（設定 → 画面 で変えられます）'); }
    }
  };
  function collide(x, z, r) {
    x = clamp(x, (W.L.alley ? W.L.alley[0] : -RX) + r, RX - r); z = clamp(z, (W.L.alley ? W.L.alley[1] : -RZ) + r, RZ + 3.2);
    const list = W.dynBlocks && W.dynBlocks.length ? W.obstacles.concat(W.dynBlocks) : W.obstacles;
    for (let pass = 0; pass < 2; pass++) for (const b of list) {
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
    if (W.mouse && !document.pointerLockElement && !W.blocked() && W.eng) {
      const rc = W.eng.canvas.getBoundingClientRect(), u = (W.mouse.x - rc.left) / Math.max(1, rc.width), ed = 0.04;
      if (u < ed) me.yaw += dt * 2.4 * (ST.camSens || 1) * (1 - u / ed); else if (u > 1 - ed) me.yaw -= dt * 2.4 * (ST.camSens || 1) * ((u - (1 - ed)) / ed);
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
    e.lights = ls.map((l) => ({ p: [l.x, WH - 0.3, l.z], c: [2.3, 2.02, 1.65], r: 7.5 }));
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
  W.updateItems = function (s, g) {
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
          const crate = it.t === 'crate', dist = crate ? 0.72 : big ? 0.6 : 0.5, side = big ? 0.0 : 0.2, down = crate ? 0.5 : big ? 0.42 : 0.3;
          const cam = W.eng.cam.pos;
          // 「下」はカメラの上方向の逆（見上げても手元に見えるように）
          const ux = Math.sin(me.yaw) * sp, uy = cp, uz = Math.cos(me.yaw) * sp;
          p = [cam[0] + f[0] * dist + rx * side - ux * down, cam[1] + f[1] * dist - uy * down, cam[2] + f[2] * dist + rz * side - uz * down];
          ry = me.yaw; scl = it.t === 'top' ? 1 : it.t === 'crate' ? 0.72 : 0.85;
        } else {
          const ot = W.others[who] || W.staffN[who];
          if (ot) { const r = ot.r || 0; p = [ot.x + Math.sin(r) * 0.42, 1.02, ot.z + Math.cos(r) * 0.42]; ry = r; }
        }
      } else {
        p = W.slotPos(at);
        const sk = it.res && W.staffN[it.res];
        if (p && sk && sk.m && sk.m.job && sk.m.job.k === 'stock' && sk.carry) { const r = sk.r || 0; p = [sk.x + Math.sin(r) * 0.42, 1.02, sk.z + Math.cos(r) * 0.42]; ry = r; }
      }
      o.n.vis = !!p;
      if (!p) continue;
      o.n.p = [p[0], p[1], p[2]];
      o.n.cast = !mine;
      if (it.t === 'deco' || it.t === 'cake') { const dk = kindOf(at) === 'dt' ? W.st.deco[+at.split(':')[1]] : null; o.n.r = [0, dk ? dk.a : ry, 0]; o.n.s = [CAKE_SC * scl, CAKE_SC * scl, CAKE_SC * scl]; }
      else { o.n.r = [0, ry, 0]; o.n.s = [scl, scl, scl]; }
      setEm(o.n, W.target && W.target.item === id ? 0.16 : 0);
      setTint(o.n, (it.sp || 0) >= 2 ? 2 : 0);
    }
  };
  const TINT = [[1, 1, 1], null, [0.74, 0.8, 0.6]];
  function setTint(n, v) { if (n._tn === v) return; n._tn = v; if (n.meshes.length) n.color = TINT[v] || TINT[0]; n.kids.forEach((k) => setTint(k, v)); }
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
      if (!o || o.sk !== sk) { if (o) W.people.remove(o.ch.node); o = W.others[pid] = { ch: MD.character(W.eng, mem.skin), sk, x: p.x, z: p.z, r: p.r, hs: { s: 0.95, m: 1, l: 1.05 }[(mem.skin || {}).height] || 1 }; W.people.add(o.ch.node); W.addBlob(o.ch.node); }
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
      if (!o) { const sd = Math.random() < 0.5 ? -1 : 1, kp = W._keep && W._keep[id]; o = W.custs[id] = { ch: MD.character(W.eng, MD.customerSkin(c.ty, c.v || 0)), x: kp ? kp[0] : sd * 7, z: kp ? kp[1] : RZ + 2.2, r: kp ? kp[2] : -sd * PI / 2 }; if (kp) o.fresh = false; W.people.add(o.ch.node); W.addBlob(o.ch.node); }
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
    if (m.task === 'stock') {
      const cr = j && j.id && s.k.items[j.id];
      if (cr && W.room) { const half = (j.t0 + j.end) / 2; if (W.room.now() < half) return { x: L.truck.x, z: L.truck.z - 3.3, fx: L.truck.x, fz: L.truck.z, pick: true }; }
      const st = cr && L.stock[cr.ing];
      if (st) return { x: st.p[0], z: st.p[2] + st.f * 0.85, fx: st.p[0], fz: st.p[2], carry: true };
      return { x: L.store.x0 + 2.2, z: L.store.z0 + 2.2, fx: L.store.x0, fz: L.store.z0 + 2.2 };
    }
    const r = L.reg[0]; return { x: r.x, z: CASE_Z - 0.7, fx: r.x, fz: CASE_Z + 2 };
  }
  // 店の中（厨房）・在庫室・外（路地）を行き来するときはドアを通る
  function zoneOf(x, z) { const S2 = W.L.store; if (x < -RX) return 'out'; if (x < S2.x1 && z < S2.z1) return 'store'; return 'kit'; }
  function waypoint(o, t) {
    const S2 = W.L.store, bd = W.L.backDoor[1], zo = zoneOf(o.x, o.z), zt = zoneOf(t.x, t.z);
    if (zo === zt) return [t.x, t.z];
    let door;
    if (zo === 'kit') door = [[S2.x1 + 0.6, S2.door], [S2.x1 - 0.6, S2.door]];
    else if (zo === 'out') door = [[-RX - 0.6, bd], [-RX + 0.6, bd]];
    else door = zt === 'kit' ? [[S2.x1 - 0.6, S2.door], [S2.x1 + 0.6, S2.door]] : [[-RX + 0.6, bd], [-RX - 0.6, bd]];
    return Math.hypot(o.x - door[0][0], o.z - door[0][1]) < 0.3 ? door[1] : door[0];
  }
  W.updateStaff = function (dt, s) {
    const list = s.staff || [];
    for (let i = 0; i < 4; i++) {
      const m = list[i]; let o = W.staffN['staff' + i];
      const key = m ? m.name + JSON.stringify(m.skin || {}) : '';
      if (o && o.key !== key) { W.people.remove(o.ch.node); delete W.staffN['staff' + i]; o = null; }
      if (!m) continue;
      const t = staffSpot(s, m);
      if (!o) { const kp = W._keep && W._keep['staff' + i]; o = W.staffN['staff' + i] = { ch: MD.character(W.eng, Object.assign({}, D.DEFAULT_SKIN, m.skin || {})), key, x: kp ? kp[0] : t.x, z: kp ? kp[1] : t.z, r: kp ? kp[2] : 0 }; W.people.add(o.ch.node); W.addBlob(o.ch.node); }
      // 店の中と外を行き来するときは裏口を通る
      const [gx, gz] = waypoint(o, t);
      o.carry = !!t.carry;
      const dx = gx - o.x, dz = gz - o.z, d = Math.hypot(dx, dz);
      let mode = 'idle';
      if (d > 0.06 || gx !== t.x || gz !== t.z) { const v = Math.min(d, dt * 1.6); o.x += (dx / d) * v; o.z += (dz / d) * v; o.r = angLerp(o.r, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10)); mode = 'walk'; }
      else { o.r = angLerp(o.r, Math.atan2(t.fx - o.x, t.fz - o.z), 1 - Math.exp(-dt * 6)); mode = m.job ? 'work' : 'idle'; }
      o.ch.node.p = [o.x, 0, o.z]; o.ch.node.r = [0, o.r, 0];
      o.ch.anim(dt, mode, 0.8);
      o.m = m;
    }
  };

  // =====================================================================
  //  照準（何を見ているか）と操作
  // =====================================================================
  function rayBox(o, d, mn, mx) {
    let t0 = 0, t1 = 1e9;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-8) { if (o[k] < mn[k] || o[k] > mx[k]) return -1; continue; }
      let a = (mn[k] - o[k]) / d[k], b = (mx[k] - o[k]) / d[k]; if (a > b) { const x = a; a = b; b = x; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return -1;
    }
    return t0;
  }
  function raySphere(o, d, c, r) { const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2]; const b = ox * d[0] + oy * d[1] + oz * d[2]; const cc = ox * ox + oy * oy + oz * oz - r * r; const h = b * b - cc; if (h < 0) return -1; const t = -b - Math.sqrt(h); return t >= 0 ? t : -b + Math.sqrt(h) >= 0 ? 0.001 : -1; }
  const nm = (id) => (D.ING[id] ? D.ING[id].name : id);
  const itemName = (it, s) => (it.t === 'pan' ? (it.st === 'empty' ? '空の型' : (D.BASES[it.b] || {}).short + (it.st === 'baked' ? '（焼けた）' : it.st === 'baking' ? '（焼いている）' : '生地')) : it.t === 'cream' ? (D.CREAMS[it.k] || {}).name : it.t === 'cake' ? (sim.recipe(s, it.r) || {}).name || 'ケーキ' : it.t === 'deco' ? 'デコ中のケーキ' : it.t === 'box' ? 'ケーキの箱' + (it.s.length ? '（' + it.s.length + '個）' : '（空）') : it.t === 'crate' ? nm(it.ing) + '×' + it.n + ' の段ボール' : it.t === 'top' ? nm(it.k) : '');
  W.itemName = itemName;
  W.updateTarget = function (s, g) {
    W.target = null;
    if (!s || !W.room || W.blocked()) { if (W.onTarget) W.onTarget(null, null); return; }
    const L = W.L, o = W.eng.cam.pos, d = W.fwd, pid = W.room.pid;
    const hid = K.held(s, pid), held = hid ? s.k.items[hid] : null;
    const cands = [];
    // 壁ごしには触れない（裏口・入口を通して見えている物だけ）
    const bdz = L.backDoor[1];
    const reachable = (p) => {
      if ((o[0] > -RX) !== (p[0] > -RX)) { const t = (-RX - o[0]) / (p[0] - o[0]), z = o[2] + (p[2] - o[2]) * t, y = o[1] + (p[1] - o[1]) * t; if (Math.abs(z - bdz) > 0.6 || y > 2.1) return false; }
      if ((o[2] < RZ) !== (p[2] < RZ) && o[0] > -RX && p[0] > -RX) { const t = (RZ - o[2]) / (p[2] - o[2]), x = o[0] + (p[0] - o[0]) * t; if (Math.abs(x) > 0.72) return false; }
      return true;
    };
    const add = (p, r, t) => { const dist = raySphere(o, d, p, r); if (dist >= 0 && dist <= REACH && reachable(p)) cands.push(Object.assign(t, { dist, p })); };
    const addBox = (mn, mx, t) => { const dist = rayBox(o, d, mn, mx), p = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]; if (dist >= 0 && dist <= REACH && reachable(p)) cands.push(Object.assign(t, { dist, p })); };
    const working = s.phase === 'prep' || s.phase === 'open';
    // 置いてある物
    for (const id in s.k.items) {
      const it = s.k.items[id], at = String(it.at); if (at.startsWith('h:')) continue;
      if (kindOf(at) === 'dt' || kindOf(at) === 'ov') continue; // 回転台・オーブンは設備側で扱う
      if (it.t === 'crate' && (it.ar > g || (s.k.truck && s.k.truck.out && kindOf(at) === 'dl'))) continue; // トラックがまだ来ていない
      const p = W.slotPos(at); if (!p) continue;
      const big = it.t === 'crate' ? 0.28 : 0.16;
      add([p[0], p[1] + (it.t === 'crate' ? 0.17 : 0.06), p[2]], big, { item: id, name: itemName(it, s), pri: !held ? { label: '持つ', a: { t: 'pick', id } } : null });
    }
    // 空いている置き場
    if (held) {
      const slots = [];
      L.spots.forEach((p, j) => slots.push(['sp:' + j, p])); L.pack.forEach((p, j) => slots.push(['pk:' + j, p]));
      L.rack.forEach((p, j) => slots.push(['rk:' + j, p])); L.mix.forEach((m, i) => slots.push(['mo:' + i, m.pan]));
      L.whip.forEach((w, i) => w.out.forEach((p, k) => slots.push(['wo:' + i + ':' + k, p])));
      L.deco.forEach((d, i) => d.side.forEach((p, k) => slots.push(['dp:' + i + ':' + k, p])));
      if (L.fridge) L.fridge.slots.forEach((p, j) => slots.push(['fr:' + j, p]));
      slots.forEach(([slot, p]) => { if (!K.at(s, slot) && K.accepts(slot, held)) { const fr = kindOf(slot) === 'fr'; add([p[0], p[1] + 0.06, p[2]], fr ? 0.18 : 0.17, { slot, name: fr ? '冷蔵庫（入れた物は傷まない）' : '置き場', pri: { label: fr ? '冷蔵庫に入れる' : '置く', a: { t: 'put', slot } } }); } });
    }
    // 冷蔵庫に入らない物を持って冷蔵庫を見たとき
    if (L.fridge && held && !K.accepts('fr:0', held)) { const F = L.fridge; addBox([F.x - F.w / 2, 0.13, -RZ], [F.x + F.w / 2, F.h - 0.25, -RZ + F.d], { name: held.t === 'crate' ? '冷蔵庫（段ボールは在庫室の冷蔵ケースへ）' : '冷蔵庫（クリーム・ケーキ・スポンジを入れられる）' }); }
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
        else if (b.st === 'spread') { if (b.by === pid) t.sec = { label: 'クリームの続きを塗る', spread: i }; else t.name = 'デコ台' + (i + 1) + '（ほかの人が塗っています）'; }
        else if (held && held.t === 'cream' && !dk.cr) t.sec = { label: 'クリームを塗る（指でなぞる）', a: { t: 'run', st: 'deco', i }, spread: i };
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
    // 在庫室の棚（材料ごと）
    for (const ing in L.stock) {
      const st = L.stock[ing], n = sim.invCount(s, ing), z0 = st.p[2] - st.d / 2, z1 = st.p[2] + st.d / 2;
      const t = { name: nm(ing) + 'の棚（在庫 ' + n + '）', stockIng: ing };
      if (held && held.t === 'crate') {
        if (held.ing !== ing) t.name += '・ここは' + nm(ing) + 'の場所';
        else if (!held.open) t.sec = { label: '段ボールを開ける', a: { t: 'openCrate' } };
        else if ((held.sp || 0) >= 2 && held.n > 0) t.name = nm(ing) + 'は傷んでいて置けません（ゴミ箱へ）';
        else if (held.n > 0) { t.pri = { label: '1つ置く（長押しで続けて）', a: { t: 'shelve', ing }, hold: true }; t.sec = { label: '全部置く（' + held.n + '）', a: { t: 'shelve', ing, all: 1 } }; }
      }
      addBox([st.p[0] - st.w / 2, st.p[1], Math.min(z0, z1)], [st.p[0] + st.w / 2, st.p[1] + (st.kind === 'dry' ? 0.46 : 0.42), Math.max(z0, z1)], t);
    }
    L.trash.forEach(([x, z], k) => add([x, 0.6, z], 0.32, { name: k === 2 ? '段ボール回収' : 'ゴミ箱', pri: held && (held.t !== 'crate' || !(held.n > 0) || (held.sp || 0) >= 2) ? { label: held.t === 'crate' ? (held.n > 0 ? '傷んだ段ボールを捨てる（廃棄）' : '空の段ボールを捨てる') : '捨てる', a: { t: 'trash' } } : null }));
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
    let t = cands[0] || null;
    // 段ボールを持っているときは、どこでも「開ける」ができる
    if (held && held.t === 'crate' && !held.open && !(t && t.sec)) { t = t || { name: itemName(held, s), dist: 0, p: o }; t.sec = { label: '段ボールを開ける', a: { t: 'openCrate' } }; }
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
    if (W._last && W._last.k === k && t - W._last.t < 600 && a.t !== 'addIng' && a.t !== 'slice' && a.t !== 'shelve') return;
    W._last = { k, t };
    CS.sound.play(a.t === 'put' || a.t === 'pick' || a.t === 'stock' || a.t === 'trash' || a.t === 'shelve' ? 'put' : a.t === 'openCrate' ? 'pop' : 'tap');
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
  W.secondary = function () {
    const t = W.target; if (!t || !t.sec) return;
    if (t.sec.a) send(t.sec.a);
    if (t.sec.spread !== undefined && W.onSpread) W.onSpread(t.sec.spread);
  };
  // 長押しで続けて置く（棚に1つずつ）
  W.primaryHold = function (on) {
    clearInterval(W._holdT); W._holdT = null;
    if (!on) return;
    W._holdT = setInterval(() => { const t = W.target; if (!t || !t.pri || !t.pri.hold) { clearInterval(W._holdT); W._holdT = null; return; } send(t.pri.a); }, 170);
  };
  W.discard = function () {
    const t = W.target;
    if (t && t.del) { send(t.del.a); return; }
    const s = W.S; if (!s || !W.room) return;
    const hid = K.held(s, W.room.pid);
    if (hid) { const it = s.k.items[hid]; if (it && it.t === 'crate' && !((it.sp || 0) >= 2 && it.n > 0)) { CS.ui.toast(it.n > 0 ? '中身は在庫室の棚に置こう（開けてから）' : '空の段ボールは回収かごかゴミ箱へ', 'err'); return; } send({ t: 'trash' }); }
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
    const sc = scale || clamp(2.2 / p.d, 0.55, 1.1), top = W.hudH || 52;
    if (el._hh == null && p.y + (dy || 0) < top + 160) el._hh = el.offsetHeight || 24;
    const y = Math.max(p.y + (dy || 0), top + (el._hh || 24) * sc);
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(2)})`;
    return p;
  }
  const distMe = (x, z) => Math.hypot(W.me.x - x, W.me.z - z);
  const mmss = (sec) => { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
  W.mmss = mmss;
  // 鮮度の表示（ねらった物・手に持っている物）
  W.freshHTML = function (fr, it) {
    if (!fr) return '';
    const crate = it && it.t === 'crate';
    if (fr.stage >= 2) return `<small class="bad">傷んでいる（${crate ? 'ゴミ箱へ' : '使うとクレームに'}）</small>`;
    if (fr.cold) return `<small class="cold">❄ ${crate ? 'トラックの荷台（冷蔵）' : '冷蔵庫の中'}${fr.stage ? '・少しぬるくなっていた' : '・傷まない'}</small>`;
    return `<small class="${fr.stage ? 'bad' : 'warn'}">要冷蔵・常温であと ${mmss(fr.left)} で傷む${fr.stage ? '（ぬるい）' : ''}</small><span class="frb"><u style="width:${Math.round(fr.f * 100)}%"></u></span>`;
  };
  function setHTML(el, h) { if (el._h !== h) { if (!el._h || el._h.length !== h.length) el._hh = null; el._h = h; el.innerHTML = h; } }
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
        else if (b.st === 'spread') h += `<small>${esc(b.by === W.room.pid ? 'クリームを塗っています' : ((W.room.members[b.by] || {}).name || 'だれか') + 'さんが塗っています')}</small>`;
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
    // 在庫室の棚の名札（中にいるとき）
    if (W.me.x < L.store.x1 && W.me.z < L.store.z1 + 0.5 && W.me.x > L.store.x0) for (const ing in L.stock) {
      const st = L.stock[ing], n = sim.invCount(s, ing);
      const el = lab('stk-' + ing, 'bin-lb' + (n ? '' : ' out') + (tg && tg.stockIng === ing ? ' tg' : ''));
      setHTML(el, esc(nm(ing)) + ' <b>' + n + '</b>');
      place(el, [st.p[0], st.p[1] + 0.3, st.p[2] + st.f * 0.2], 0, 0.85);
    }
    // ねらっている物
    if (tg && tg.item && s.k.items[tg.item] && !tg.station) {
      const it = s.k.items[tg.item], p = tg.p;
      const el = lab('it', 'tag-lb');
      let h = esc(itemName(it, s));
      if (it.t === 'pan' && it.st === 'baked') h += `<small>${g < (it.cool || 0) ? '冷ましています… あと' + Math.ceil((it.cool - g) / 1000) + '秒' : '冷めた'}${it.lab ? '・' + esc(it.lab) : ''}</small>`;
      if (it.df && it.df.length) h += `<small class="bad">${it.df.map((x) => esc((D.DEFECTS[x] || {}).name || x)).join('・')}</small>`;
      h += W.freshHTML(K.fresh(s, it, g), it);
      setHTML(el, h); place(el, [p[0], p[1] + 0.3, p[2]], 0, 0.9);
    }
    // 常温でぬるくなった・傷んだ物の目印（近くにあるとき）
    for (const id in W.items) {
      const o = W.items[id], it = o.it; if (!it || !o.n.vis || (tg && tg.item === id) || String(it.at).startsWith('h:')) continue;
      const fr = K.fresh(s, it, g); if (!fr || fr.cold || !fr.stage) continue;
      const p = o.n.p; if (distMe(p[0], p[2]) > 4.5) continue;
      const el = lab('fr-' + id, 'fr-lb' + (fr.stage >= 2 ? ' bad' : ''));
      setHTML(el, fr.stage >= 2 ? '傷んでいる' : 'ぬるい あと' + mmss(fr.left));
      place(el, [p[0], p[1] + (it.t === 'crate' ? 0.5 : 0.28), p[2]], 0, 0.8);
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
    // ほかのプレイヤーの名前（頭の上）
    for (const pid in W.others) { const o = W.others[pid]; const dd = distMe(o.x, o.z); if (dd > 40) continue; const el = lab('nm-' + pid, 'nm-lb player'); setHTML(el, esc(o.name || '')); place(el, [o.x, 2.02 * (o.hs || 1), o.z], 0, clamp(3.2 / Math.max(1, dd), 0.6, 1.05)); }
    for (const k in W.staffN) { const o = W.staffN[k], m = o.m; if (!m || distMe(o.x, o.z) > 7) continue; const el = lab('sf-' + k, 'nm-lb staff'); setHTML(el, `${esc(m.name)} <small>Lv${m.lv}・${esc(D.STAFF.tasks[m.task].name)}</small>`); place(el, [o.x, 1.98, o.z], 0, 0.8); }
    // トッピングの照準
    if (W.aim) { const el = lab('aim', 'aim-lb' + (W.aim.ok ? ' ok' : '')); setHTML(el, ''); const p = W.eng.project([W.aim.x, W.aim.y, W.aim.z]); if (p) { el.hidden = false; el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-50%)`; } }
    for (const k in W.lbl) if (!W.lbl[k]._used) { W.lbl[k].remove(); delete W.lbl[k]; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
