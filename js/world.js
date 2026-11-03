/* ケーキ屋さんシミュレーター : 3D のお店（SD 視点操作） */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data, sim = CS.sim, ST = CS.settings;
  const { M, Geo, Builder, Node, Engine, rgb, mix } = CS.gl;
  const MD = CS.models;
  const PI = Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const angLerp = (a, b, t) => { let d = b - a; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return a + d * t; };
  const S = (r, a, b) => Geo.sphere(r, a || 14, b || 10);

  // ---------- 店の寸法（増床レベルで広がる） ----------
  const WH = 3.2, OVEN_DX = 1.35;
  let RX, RZ, KZ, CASE_X0, CASE_Z, OVEN_X0, OVEN_Z, REG, DOOR, LV = -1;
  const W = (CS.world = { ready: false });
  function setDims(lv) {
    const SZ = D.SHOP_SIZES;
    LV = clamp(lv | 0, 0, SZ.length - 1);
    const d = SZ[LV];
    RX = d.rx; RZ = d.rz; CASE_Z = -RZ + d.kd; KZ = CASE_Z + 0.42;
    CASE_X0 = -4.0;                       // ショーケース（最大8スロット・1m 間隔）
    OVEN_X0 = -3.4; OVEN_Z = -RZ + 0.58;  // オーブンは奥の壁ぞいに最大5台
    REG = [4.6, CASE_Z]; DOOR = [0, RZ];
    const iz = -RZ + 3.15;
    W.L = {
      mixT: [-RX + 1.45, -RZ + 0.5], sink: [OVEN_X0 + 5 * OVEN_DX - 0.4, RX - 1.25], rack: [RX - 0.5, -RZ + 2.05],
      whipT: [-2.4, iz], decoT: [2.4, iz], shelf: [-RX + 0.35, -RZ + 3.0], desk: [RX - 0.6, -RZ + 3.9], board: [-RX + 0.09, CASE_Z + 1.5],
      lamps: [[-2.4, iz], [2.4, iz], [-RX / 2, CASE_Z + 2.9], [RX / 2 - 0.4, CASE_Z + 2.9]],
    };
    W.dims = { RX, RZ, CASE_Z, KZ, LV };
  }
  setDims(0);

  // =====================================================================
  //  初期化
  // =====================================================================
  W.init = function (host) {
    W.host = host;
    host.innerHTML = '<canvas id="gl3d" aria-label="お店の中"></canvas><div class="labels" id="labels"></div>';
    const canvas = host.querySelector('canvas');
    let e;
    try { e = W.eng = new Engine(canvas, { aa: !ST.light }); } catch (err) { host.innerHTML = '<div class="banner" style="margin:20px">この端末では 3D 表示（WebGL）が使えません。</div>'; W.ready = false; return false; }
    e.env.light = norm3([0.25, 0.75, 0.6]);
    e.env.sky = [0.36, 0.38, 0.42]; e.env.ground = [0.17, 0.14, 0.12]; e.env.sun = [2.4, 2.25, 2.0];
    e.env.fog = rgb('#D7DEE5'); e.env.fogR = [28, 75]; e.env.clear = rgb('#9EBBD6'); e.env.expo = 1.05;
    e.shadowCenter = [0, 0, 0]; e.shadowRadius = 10.5;
    W.applyQuality();
    W.scene = new Node();
    W.labels = host.querySelector('#labels');
    W.cam = { yaw: 0.3, pitch: 0.62, dist: 6.4, tYaw: 0.3, tPitch: 0.62, tDist: 6.4, target: [0, 1.1, 0] };
    setDims(0);
    W.me = { x: 0, z: CASE_Z - 1.2, r: PI, vx: 0, vz: 0, mode: 'idle', ch: null, skinKey: '' };
    W.others = {}; W.custs = {}; W.ovens = []; W.keys = {}; W.lbl = {}; W.alerted = {};
    W.buildStatic();
    W.bindInput(canvas);
    W.ready = true;
    W.last = performance.now();
    return true;
  };
  W.destroy = function () { W.ready = false; W.unbind && W.unbind(); if (W.eng) { const x = W.eng.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } if (W.host) W.host.innerHTML = ''; };
  W.applyQuality = function () {
    const e = W.eng; if (!e) return;
    e.scale = ST.light ? 0.6 : 1;
    e.shadows = !ST.light;
    e.outline = 0;
    e.smSize = 2048;
    // 店内のペンダントライト（軽量モードでは2灯）
    const L = W.L.lamps.map(([x, z]) => [x, 2.6, z]);
    e.lights = (ST.light ? [L[0], L[3]] : L).map((p) => ({ p, c: [3.2, 2.5, 1.7], r: 8 + LV * 0.7 }));
    e.shadowRadius = 10.5 + LV * 1.2;
    if (W.people) W.people.kids.forEach((n) => n.kids.forEach((k) => { if (k.isBlob) k.vis = !e.shadows; }));
  };
  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

  // =====================================================================
  //  静的なお店（素材ごとに1メッシュへ結合）
  // =====================================================================
  const C = {
    oak: rgb('#C49A6C'), walnut: rgb('#6B4630'), white: rgb('#F3EFE8'), paint: rgb('#E9E2D6'), sage: rgb('#8FA58A'), navy: rgb('#2F3E4E'), rose: rgb('#C98F8A'),
    steel: rgb('#C7CBD0'), dark: rgb('#2A2624'), brass: rgb('#C9A35E'), leaf: rgb('#4E7A43'), terracotta: rgb('#B86B4B'), cream: rgb('#F5EEE2'),
  };
  W.obstacles = [];
  function block(x0, z0, x1, z1) { W.obstacles.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]); }
  const shade = (c, t) => (t < 0 ? mix(c, '#000000', -t) : mix(c, '#ffffff', t));
  W.buildStatic = function () {
    const e = W.eng, sc = W.scene;
    W.obstacles = [];
    const T = W.T || (W.T = {
      oak: e.texFromCanvas(MD.TX.wood('#C9A174', '#8A6142', 90), true), walnut: e.texFromCanvas(MD.TX.wood('#6E4A33', '#3E2618', 70), true),
      marble: e.texFromCanvas(MD.TX.marble(), true), steel: e.texFromCanvas(MD.TX.brushed(), true), floor: e.texFromCanvas(MD.TX.floor(), true),
      ktile: e.texFromCanvas(MD.TX.ktile(), true), parquet: e.texFromCanvas(MD.TX.parquet(), true),
      plaster: e.texFromCanvas(MD.TX.plaster('#EFE8DD'), true), panel: e.texFromCanvas(MD.TX.panel(), true), asphalt: e.texFromCanvas(MD.TX.asphalt(), true),
      walk: e.texFromCanvas(MD.TX.sidewalk(), true), grass: e.texFromCanvas(MD.TX.grass(), true), facade: e.texFromCanvas(MD.TX.facade(), true),
      sky: e.texFromCanvas(MD.TX.sky(), false),
    });
    // 素材ごとのビルダー
    const mats = {
      oak: { tex: T.oak, rough: 0.55 }, walnut: { tex: T.walnut, rough: 0.45 }, marble: { tex: T.marble, rough: 0.18 }, steel: { tex: T.steel, rough: 0.32, metal: 1 },
      paint: { rough: 0.6 }, gloss: { rough: 0.22 }, cloth: { rough: 0.9 }, brass: { rough: 0.28, metal: 1 }, plant: { rough: 0.7 }, facade: { tex: T.facade, rough: 0.8 },
    };
    const BB = {};
    const P = (m, g, p, r, s, color, opt) => { (BB[m] = BB[m] || new Builder()).put(g, p, r, s, color || [1, 1, 1], Object.assign({ rough: mats[m].rough, metal: mats[m].metal || 0 }, opt || {})); };
    W.P = P;
    // ---------- 外（空・道・向かいの街並み） ----------
    sc.add(new Node(e.mesh(Geo.sphere(80, 24, 12)), { tex: T.sky, em: 1, cast: false, recv: false, twoSide: true }));
    const ground = (g, tex, p, rough) => { const n = new Node(e.mesh(g, null, { rough }), { tex, cast: false, ao: 0 }); n.p = p; sc.add(n); };
    ground(Geo.plane(140, 40, 35, 10), T.asphalt, [0, -0.03, RZ + 8], 0.85);
    ground(Geo.plane(80, 4, 20, 1), T.walk, [0, -0.01, RZ + 2], 0.8);
    ground(Geo.plane(80, 40, 20, 10), T.grass, [0, -0.02, -RZ - 20], 0.95);
    ground(Geo.plane(24, 80, 6, 20), T.walk, [-RX - 12.2, -0.015, 0], 0.8); ground(Geo.plane(24, 80, 6, 20), T.walk, [RX + 12.2, -0.015, 0], 0.8);
    // ---------- 床：厨房はタイル、売り場は寄せ木 ----------
    const kd = KZ + RZ, fd = RZ - KZ;
    const kf = new Node(e.mesh(Geo.plane(RX * 2, kd, RX * 2 / 0.6, kd / 0.6), null, { rough: 0.4 }), { tex: T.ktile, cast: false, ao: 0 }); kf.p = [0, 0.001, -RZ + kd / 2]; sc.add(kf);
    const ff = new Node(e.mesh(Geo.plane(RX * 2, fd, RX * 2 / 1.2, fd / 1.2), null, { rough: 0.38 }), { tex: T.parquet, cast: false, ao: 0 }); ff.p = [0, 0.001, KZ + fd / 2]; sc.add(ff);
    P('brass', Geo.box(RX * 2, 0.006, 0.04), [0, 0.004, KZ]);
    // ---------- 壁（カメラ側の壁は自動で消える） ----------
    W.walls = {};
    const wall = (name, parts, inner) => {
      const B = new Builder(), WB = new Builder(), TR = new Builder();
      parts.forEach((q) => B.put(Geo.box(q[3], q[4], q[5], 1), [q[0], q[1], q[2]], 0, 1, [1, 1, 1], { rough: 0.85 }));
      inner.forEach((q) => { WB.put(Geo.box(q[3], q[4], q[5], 1), [q[0], q[1], q[2]], 0, 1, [1, 1, 1], { rough: 0.5 }); TR.put(Geo.box(q[6] || q[3] + 0.02, 0.05, q[7] || q[5] + 0.03), [q[0], q[1] + q[4] / 2 + 0.02, q[2]], 0, 1, rgb('#F7F3EC'), { rough: 0.4 }); TR.put(Geo.box(q[6] || q[3] + 0.02, 0.1, q[7] || q[5] + 0.01), [q[0], 0.05, q[2]], 0, 1, C.walnut, { rough: 0.5 }); });
      const n = sc.add(new Node(B.build(e), { tex: T.plaster, ao: 0 }));
      if (!WB.empty()) n.add(new Node(WB.build(e), { tex: T.panel, ao: 0 }));
      if (!TR.empty()) n.add(new Node(TR.build(e), { ao: 0 }));
      W.walls[name] = n;
      return n;
    };
    wall('back', [[0, WH / 2, -RZ - 0.1, RX * 2 + 0.4, WH, 0.2]], [[0, 0.5, -RZ + 0.03, RX * 2, 1.0, 0.06]]);
    wall('left', [[-RX - 0.1, WH / 2, 0, 0.2, WH, RZ * 2]], [[-RX + 0.03, 0.5, 0, 0.06, 1.0, RZ * 2]]);
    wall('right', [[RX + 0.1, WH / 2, 0, 0.2, WH, RZ * 2]], [[RX - 0.03, 0.5, 0, 0.06, 1.0, RZ * 2]]);
    const fz = RZ + 0.1, ww = RX - 2.2, wc = 1.2 + ww / 2;
    const front = wall('front', [
      [-(RX + 1.2) / 2 - 0.4, 0.45, fz, RX - 0.8 + 0.4, 0.9, 0.2], [(RX + 1.2) / 2 + 0.4, 0.45, fz, RX - 0.8 + 0.4, 0.9, 0.2], [0, 2.75, fz, RX * 2 + 0.4, 0.9, 0.2],
      [-(RX - 0.4), 1.6, fz, 1.2, 1.4, 0.2], [-1.0, 1.6, fz, 0.4, 1.4, 0.2], [1.0, 1.6, fz, 0.4, 1.4, 0.2], [RX - 0.4, 1.6, fz, 1.2, 1.4, 0.2],
    ], []);
    const FB = new Builder();
    [-wc, wc].forEach((x) => {
      FB.put(Geo.box(ww + 0.05, 0.07, 0.14), [x, 2.3, fz], 0, 1, C.dark, { rough: 0.4 }); FB.put(Geo.box(ww + 0.05, 0.12, 0.3), [x, 0.9, fz], 0, 1, C.dark, { rough: 0.4 });
      const nm = Math.max(1, Math.round(ww / 1.3)); for (let i = 1; i < nm; i++) FB.put(Geo.box(0.05, 1.4, 0.1), [x - ww / 2 + (i * ww) / nm, 1.6, fz], 0, 1, C.dark, { rough: 0.4 });
    });
    // 外のオーニング（日よけ）
    const na = Math.floor((RX * 2 - 0.4) / 0.5);
    for (let i = 0; i < na; i++) FB.put(Geo.box(0.5, 0.025, 1.15), [-(na - 1) * 0.25 + i * 0.5, 2.55, RZ + 0.62], [0.42, 0, 0], 1, i % 2 ? C.cream : rgb('#2F4A3F'), { rough: 0.85 });
    FB.put(Geo.cyl(0.02, 0.02, na * 0.5, 8), [0, 2.32, RZ + 1.1], [0, 0, PI / 2], 1, C.dark, { rough: 0.4 });
    front.add(new Node(FB.build(e)));
    const glass = (w, h, p) => { const n = new Node(e.mesh(Geo.box(w, h, 0.02), null, { rough: 0.05 }), { color: rgb('#BFD8E6'), op: 0.16, cast: false, recv: false }); n.p = p; front.add(n); };
    glass(ww, 1.38, [-wc, 1.6, fz]); glass(ww, 1.38, [wc, 1.6, fz]);
    const door = new Node(e.mesh(Geo.box(1.5, 2.2, 0.06), '#FFFFFF', { rough: 0.45 }), { tex: T.walnut }); door.p = [0, 1.1, fz]; front.add(door);
    glass(0.95, 1.2, [0, 1.35, fz + 0.04]);
    W.doorNode = door;

    // ---------- ショーケース（大理石の天板・ガラス）とレジ ----------
    const cw = 8.2, cx = CASE_X0 + 3.5;
    P('walnut', Geo.rbox(cw, 0.86, 0.72, 0.02), [cx, 0.43, CASE_Z]);
    for (let i = 0; i < 8; i++) P('oak', Geo.rbox(0.9, 0.5, 0.02, 0.008), [CASE_X0 + i, 0.48, CASE_Z + 0.365]);
    P('brass', Geo.box(cw, 0.03, 0.02), [cx, 0.08, CASE_Z + 0.37]);
    P('marble', Geo.rbox(cw + 0.06, 0.04, 0.8, 0.012), [cx, 0.88, CASE_Z]);
    [-1, 1].forEach((s) => P('brass', Geo.box(0.03, 0.5, 0.6), [cx + s * (cw / 2 - 0.02), 1.15, CASE_Z]));
    P('brass', Geo.box(cw, 0.025, 0.025), [cx, 1.4, CASE_Z + 0.29]);
    P('brass', Geo.box(cw, 0.025, 0.025), [cx, 1.4, CASE_Z - 0.29]);
    block(cx - cw / 2, CASE_Z - 0.4, cx + cw / 2, CASE_Z + 0.4);
    const caseGlass = new Node(e.mesh(Geo.box(cw - 0.08, 0.5, 0.58), null, { rough: 0.04 }), { color: rgb('#D6E7EE'), op: 0.1, cast: false, recv: false });
    caseGlass.p = [cx, 1.15, CASE_Z]; sc.add(caseGlass);
    P('walnut', Geo.rbox(1.6, 0.92, 0.72, 0.02), [REG[0], 0.46, REG[1]]);
    P('marble', Geo.rbox(1.66, 0.04, 0.8, 0.012), [REG[0], 0.94, REG[1]]);
    P('gloss', Geo.rbox(0.32, 0.08, 0.3, 0.02), [REG[0] - 0.2, 1.0, REG[1]], 0, 1, C.dark);
    P('gloss', Geo.rbox(0.3, 0.2, 0.02, 0.01), [REG[0] - 0.2, 1.15, REG[1] - 0.04], [-0.35, 0, 0], 1, rgb('#151515'));
    P('brass', Geo.cyl(0.02, 0.03, 0.12, 10), [REG[0] - 0.2, 1.06, REG[1] - 0.06]);
    for (let i = 0; i < 3; i++) P('paint', Geo.rbox(0.26, 0.12, 0.26, 0.01), [REG[0] + 0.45, 1.02 + i * 0.12, REG[1] + 0.05], [0, i * 0.15, 0], 1, i % 2 ? C.cream : rgb('#D9C6B0'));
    block(REG[0] - 0.8, REG[1] - 0.4, REG[0] + 0.8, REG[1] + 0.4);
    // レジの右は包装カウンター（売り場と厨房の仕切り）
    const wx0 = REG[0] + 0.8, wl = RX - wx0;
    if (wl > 0.3) {
      P('walnut', Geo.rbox(wl, 0.92, 0.6, 0.02), [wx0 + wl / 2, 0.46, CASE_Z]); P('marble', Geo.rbox(wl + 0.04, 0.04, 0.66, 0.012), [wx0 + wl / 2, 0.94, CASE_Z]);
      for (let i = 0; i < Math.floor(wl / 0.5); i++) P('cloth', Geo.rbox(0.22, 0.16, 0.16, 0.02), [wx0 + 0.3 + i * 0.5, 1.04, CASE_Z - 0.1], [0, i * 0.3, 0], 1, rgb(['#E9D9C4', '#C9A35E', '#F3EEE6'][i % 3]));
      block(wx0, CASE_Z - 0.3, RX, CASE_Z + 0.3);
    }
    // ---------- 厨房 ----------
    const worktable = (x, z, w, d, top) => {
      P(top || 'steel', Geo.rbox(w, 0.05, d, 0.01), [x, 0.88, z]);
      P('steel', Geo.box(w - 0.1, 0.03, d - 0.1), [x, 0.25, z]);
      [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => P('steel', Geo.cyl(0.022, 0.022, 0.86, 10), [x + sx * (w / 2 - 0.06), 0.43, z + sz * (d / 2 - 0.06)])));
    };
    // ミキサー台（左奥）
    const [mx, mz] = W.L.mixT;
    worktable(mx, mz, 1.8, 0.8);
    P('cloth', Geo.rbox(0.3, 0.38, 0.22, 0.06), [mx + 0.55, 1.09, mz - 0.15], [0, 0.2, 0], 1, rgb('#E5DCCB'));
    P('cloth', Geo.rbox(0.2, 0.3, 0.16, 0.05), [mx + 0.85, 1.05, mz - 0.2], [0, -0.3, 0], 1, rgb('#D8CBB3'));
    P('paint', Geo.cyl(0.13, 0.13, 0.01, 24), [mx + 0.3, 0.91, mz + 0.1], 0, 1, rgb('#2B2B2B'));   // はかり
    block(mx - 0.9, mz - 0.45, mx + 0.9, mz + 0.45);
    // 洗い場（奥の壁ぞい・オーブンの右）
    const sx0 = W.L.sink[0], sx1 = W.L.sink[1], sw = sx1 - sx0, scx = (sx0 + sx1) / 2, sz = -RZ + 0.38;
    if (sw > 1) {
      P('steel', Geo.rbox(sw, 0.86, 0.7, 0.015), [scx, 0.43, sz]); P('steel', Geo.rbox(sw + 0.02, 0.04, 0.72, 0.01), [scx, 0.88, sz]);
      P('steel', Geo.rbox(0.7, 0.03, 0.48, 0.01), [scx - sw / 4, 0.86, sz + 0.02], 0, 1, rgb('#8E949A'));
      P('steel', Geo.cyl(0.015, 0.015, 0.35, 8), [scx - sw / 4, 1.05, sz - 0.25]); P('steel', Geo.cyl(0.012, 0.012, 0.25, 8), [scx - sw / 4, 1.22, sz - 0.14], [PI / 2, 0, 0]);
      P('steel', Geo.rbox(sw, 0.03, 0.32, 0.01), [scx, 1.75, -RZ + 0.18]);
      for (let i = 0; i < Math.floor(sw / 0.4); i++) P('gloss', Geo.cyl(0.11, 0.08, 0.06, 18), [sx0 + 0.25 + i * 0.4, 1.8, -RZ + 0.18], 0, 1, rgb(i % 2 ? '#E8E2D8' : '#C7CBD0'), { rough: 0.2, metal: i % 2 ? 0 : 1 });
      block(sx0, -RZ, sx1, sz + 0.36);
    }
    // 冷却ラック（右の壁ぞい）
    const [rkx, rkz] = W.L.rack;
    [-0.45, 0.45].forEach((dz) => [-0.35, 0.35].forEach((dx) => P('steel', Geo.cyl(0.015, 0.015, 1.9, 6), [rkx + dx, 0.95, rkz + dz])));
    [0.35, 0.85, 1.35, 1.85].forEach((y) => { for (let i = 0; i < 9; i++) P('steel', Geo.cyl(0.005, 0.005, 0.72, 4), [rkx, y, rkz - 0.44 + i * 0.11], [0, 0, PI / 2]); P('steel', Geo.box(0.74, 0.012, 0.012), [rkx, y, rkz + 0.46]); P('steel', Geo.box(0.74, 0.012, 0.012), [rkx, y, rkz - 0.46]); });
    [0, 1, 2, 3].forEach((i) => P('gloss', Geo.cyl(0.015, 0.015, 0.06, 8), [rkx + (i % 2 ? 0.35 : -0.35), 0.03, rkz + (i < 2 ? 0.45 : -0.45)], 0, 1, C.dark));
    block(rkx - 0.45, rkz - 0.55, rkx + 0.45, rkz + 0.55);
    // 中央のアイランド（クリーム台・デコ台：大理石天板）
    const island = (x, z, col) => {
      P('marble', Geo.rbox(1.8, 0.05, 0.95, 0.012), [x, 0.885, z]);
      P('paint', Geo.rbox(1.72, 0.82, 0.86, 0.02), [x, 0.43, z], 0, 1, col);
      for (let i = 0; i < 2; i++) P('brass', Geo.cyl(0.012, 0.012, 0.12, 8), [x - 0.4 + i * 0.8, 0.7, z + 0.44], [0, 0, PI / 2]);
      block(x - 0.92, z - 0.5, x + 0.92, z + 0.5);
    };
    const [wx, wz] = W.L.whipT, [dx, dz] = W.L.decoT;
    island(wx, wz, C.sage); island(dx, dz, C.navy);
    P('steel', Geo.cyl(0.22, 0.13, 0.17, 24, 0, PI * 2, true), [wx - 0.5, 1.0, wz - 0.05]);
    P('steel', Geo.cyl(0.13, 0.13, 0.005, 24), [wx - 0.5, 0.915, wz - 0.05]);
    P('steel', Geo.cyl(0.006, 0.006, 0.3, 6), [wx - 0.35, 1.12, wz], [0, 0, 0.7]);
    P('gloss', Geo.cyl(0.05, 0.11, 0.1, 16), [dx - 0.3, 0.96, dz], 0, 1, rgb('#E8E2D8'));
    P('gloss', Geo.cyl(0.17, 0.17, 0.015, 32), [dx - 0.3, 1.02, dz], 0, 1, rgb('#F2EEE8'));
    P('cloth', Geo.cyl(0.0, 0.05, 0.24, 12), [dx + 0.45, 0.97, dz - 0.15], [0.15, 0, 1.25], 1, rgb('#F2EEE8'));
    P('steel', Geo.cyl(0.004, 0.012, 0.03, 8), [dx + 0.58, 0.94, dz - 0.15], [0, 0, 1.25]);
    P('steel', Geo.rbox(0.03, 0.005, 0.24, 0.002), [dx + 0.5, 0.915, dz + 0.2], [0, 0.3, 0]);
    // 仕入れ棚・冷蔵庫（左壁）
    const shx = -RX + 0.35, [, shz] = W.L.shelf;
    P('oak', Geo.rbox(0.62, 1.9, 1.6, 0.015), [shx + 0.31, 0.95, shz]);
    [0.5, 1.0, 1.5].forEach((y) => P('oak', Geo.box(0.6, 0.03, 1.52), [shx + 0.33, y, shz]));
    [[0.52, -0.45, '#E5DCCB'], [0.52, 0, '#E5DCCB'], [0.52, 0.45, '#D8CBB3'], [1.02, -0.4, '#F0E6D2'], [1.02, 0.1, '#C9B79C'], [1.02, 0.45, '#E8E2D6'], [1.52, -0.2, '#D9C6B0'], [1.52, 0.3, '#E5DCCB']].forEach(([y, z, c], i) => P(i % 3 ? 'cloth' : 'oak', Geo.rbox(0.38, 0.3, 0.34, i % 3 ? 0.06 : 0.01), [shx + 0.36, y + 0.15, shz + z], [0, (i % 3) * 0.08, 0], 1, rgb(c)));
    const fzz = shz + 1.35;
    P('steel', Geo.rbox(0.78, 2.05, 0.88, 0.02), [shx + 0.4, 1.025, fzz]);
    P('steel', Geo.box(0.02, 1.95, 0.005), [shx + 0.8, 1.03, fzz]);
    [0.2, -0.2].forEach((dzz) => P('brass', Geo.rbox(0.03, 0.6, 0.03, 0.01), [shx + 0.82, 1.25, fzz + dzz]));
    P('gloss', Geo.rbox(0.03, 0.22, 0.32, 0.01), [shx + 0.7, 1.25, shz], [0, 0, 0.1], 1, rgb('#151515'));
    block(-RX, shz - 0.85, -RX + 1.2, fzz + 0.48);
    // 経営デスク（右壁）
    const [bx, bz] = W.L.desk;
    P('walnut', Geo.rbox(0.9, 0.04, 1.3, 0.01), [bx, 0.76, bz]);
    [-1, 1].forEach((s2) => P('walnut', Geo.box(0.85, 0.74, 0.04), [bx, 0.37, bz + s2 * 0.6]));
    P('gloss', Geo.rbox(0.02, 0.24, 0.38, 0.005), [bx + 0.17, 0.94, bz], [0, 0, 0.25], 1, rgb('#1A1A1A'));
    P('steel', Geo.box(0.26, 0.012, 0.38), [bx - 0.03, 0.785, bz]);
    P('cloth', Geo.rbox(0.48, 0.07, 0.48, 0.03), [bx - 0.7, 0.47, bz], 0, 1, rgb('#6B4A3A'));
    P('cloth', Geo.rbox(0.07, 0.48, 0.46, 0.03), [bx - 0.93, 0.75, bz], 0, 1, rgb('#6B4A3A'));
    P('steel', Geo.cyl(0.025, 0.025, 0.42, 6), [bx - 0.7, 0.22, bz]);
    P('gloss', Geo.cyl(0.04, 0.035, 0.1, 12), [bx - 0.15, 0.83, bz + 0.45], 0, 1, C.white);
    block(bx - 0.5, bz - 0.7, RX, bz + 0.7);
    // ---------- 売り場 ----------
    const [mbx, mbz] = W.L.board;
    P('walnut', Geo.rbox(0.06, 1.3, 1.9, 0.01), [mbx - 0.04, 1.75, mbz]);
    const plant = (x, z, s) => { P('paint', Geo.cyl(0.2 * s, 0.15 * s, 0.4 * s, 18), [x, 0.2 * s, z], 0, 1, C.terracotta); for (let i = 0; i < 7; i++) P('plant', Geo.sphere(0.12 * s, 10, 8), [x + Math.sin(i * 2.4) * 0.12 * s, (0.5 + i * 0.07) * s, z + Math.cos(i * 2.4) * 0.12 * s], [i * 0.5, 0, 0.3], [1, 1.6, 0.5], shade(C.leaf, (i % 3) * 0.08)); block(x - 0.25 * s, z - 0.25 * s, x + 0.25 * s, z + 0.25 * s); };
    plant(-RX + 0.7, RZ - 0.7, 1.2); plant(RX - 0.7, RZ - 0.7, 1.2); plant(RX - 0.6, CASE_Z + 1.4, 0.9);
    const bxx = RX / 2 + 0.9;
    P('walnut', Geo.rbox(2.2, 0.06, 0.45, 0.02), [bxx, 0.46, RZ - 0.45]); P('walnut', Geo.box(0.06, 0.44, 0.4), [bxx - 1.0, 0.22, RZ - 0.45]); P('walnut', Geo.box(0.06, 0.44, 0.4), [bxx + 1.0, 0.22, RZ - 0.45]);
    block(bxx - 1.1, RZ - 0.7, bxx + 1.1, RZ - 0.2);
    // ペンダントライト（真上から見下ろすときは邪魔なので隠す → 別ノード）
    const LB = new Builder();
    W.L.lamps.forEach(([x, z]) => { LB.put(Geo.cyl(0.004, 0.004, 0.5, 4), [x, 2.95, z], 0, 1, C.dark, { rough: 0.5 }); LB.put(Geo.loft([{ y: 0.09, rx: 0.07, rz: 0.07 }, { y: 0.04, rx: 0.12, rz: 0.12 }, { y: -0.09, rx: 0.2, rz: 0.2 }], { seg: 28, thick: 0.006, capTop: true }), [x, 2.62, z], 0, 1, C.brass, { rough: 0.3, metal: 1 }); });
    W.lampNode = sc.add(new Node(LB.build(e), { cast: false }));
    // 外：街並み
    for (let i = 0; i < 14; i++) { const x = -32 + i * 5; P('facade', Geo.box(4.6, 6 + (i % 3), 6), [x, 3 + (i % 3) / 2, RZ + 19], 0, 1, [1, 1, 1], { rough: 0.85 }); }
    [[-RX - 6, -2, 4, 5], [RX + 6, -3, 4, 6]].forEach(([x, z, w, h]) => P('facade', Geo.box(w, h, 8), [x, h / 2, z], 0, 1, [1, 1, 1]));
    [[-RX - 2, RZ + 2.4], [RX + 2, RZ + 2.4], [-RX / 2 - 0.5, RZ + 2.4], [RX / 2 + 0.5, RZ + 2.4]].forEach(([x, z]) => { P('walnut', Geo.cyl(0.12, 0.16, 2.2, 8), [x, 1.1, z]); for (let k = 0; k < 5; k++) P('plant', Geo.sphere(0.8, 10, 8), [x + Math.sin(k * 1.3) * 0.5, 2.4 + (k % 2) * 0.4, z + Math.cos(k * 1.3) * 0.4], 0, [1, 0.85, 1], shade(C.leaf, (k % 3) * 0.1 - 0.05)); });
    [[-2.6, RZ + 1.6], [2.6, RZ + 1.6]].forEach(([x, z]) => { P('gloss', Geo.cyl(0.05, 0.07, 3.0, 8), [x, 1.5, z], 0, 1, C.dark); P('gloss', Geo.rbox(0.25, 0.3, 0.25, 0.04), [x, 3.1, z], 0, 1, C.dark); });
    W.staticNodes = [];
    for (const m in BB) { const n = new Node(BB[m].build(e), { tex: mats[m].tex || null }); sc.add(n); W.staticNodes.push(n); }
    // ランプの電球（自発光）
    W.bulbs = W.L.lamps.map(([x, z]) => { const b = new Node(e.mesh(Geo.sphere(0.055, 12, 8), '#FFE2A8'), { em: 1, cast: false }); b.p = [x, 2.56, z]; sc.add(b); return b; });

    // メニューボード（黒板）
    if (!W.boardCv) { W.boardCv = document.createElement('canvas'); W.boardCv.width = 512; W.boardCv.height = 512; }
    W.boardTex = W.boardTex || e.texFromCanvas(W.boardCv, false);
    const board = new Node(e.mesh(Geo.card(1.75, 1.15), null, { rough: 0.8 }), { tex: W.boardTex, ao: 0 });
    board.p = [mbx, 1.75, mbz]; board.r = [0, PI / 2, 0]; sc.add(board);
    // 看板（拡張で出現）
    W.signTex = W.signTex || e.texFromCanvas(MD.TX.sign('ケーキ屋さん'), false);
    W.signNode = sc.add(new Node(e.mesh(Geo.box(3.2, 0.8, 0.1), null, { rough: 0.5 }), { tex: W.signTex }));
    W.signNode.p = [0, 3.62, RZ + 0.22]; W.signNode.vis = false;
    // 動くもの用
    W.caseGroup = sc.add(new Node()); W.ovenGroup = sc.add(new Node()); W.rackGroup = sc.add(new Node());
    W.tableGroup = sc.add(new Node()); W.decoGroup = sc.add(new Node()); W.people = sc.add(new Node());
    W.blobTex = W.blobTex || e.texFromCanvas(MD.TX.shadow(), false);
    W.blobMesh = W.blobMesh || e.mesh(Geo.plane(1, 1));
  };
  // 増床したらお店を作り直す
  W.rebuild = function (lv) {
    setDims(lv);
    W.scene.clear();
    W.keys = { mb: W.keys.mb }; W.ovens = []; W.others = {}; W.custs = {}; W.staffN = {};
    W.me.ch = null;
    W.buildStatic();
    W.applyQuality();
    const [x, z] = collide(W.me.x, W.me.z, 0.28); W.me.x = x; W.me.z = z;
    if (W.boardCv && W.S) W.drawBoard(W.S);
  };

  // =====================================================================
  //  作業台（近づいてボタンで操作）
  // =====================================================================
  // イートインのテーブル位置（売り場の左右）
  W.tablePos = function (s) {
    const out = [];
    for (let z = CASE_Z + 2.9; z <= RZ - 1.3; z += 1.9) for (let x = -RX + 1.7; x <= -2.3; x += 2.1) out.push([x, z]);
    for (let z = CASE_Z + 3.3; z <= RZ - 1.8; z += 1.9) for (let x = 3.4; x <= RX - 1.7; x += 2.1) out.push([x, z]);
    return out.slice(0, (s && s.furn && s.furn.table) || 0);
  };
  W.seatPos = function (s, i) { const t = W.tablePos(s)[i >> 1]; if (!t) return null; const sd = i % 2 ? 1 : -1; return { x: t[0] + sd * 0.62, z: t[1], r: sd > 0 ? -PI / 2 : PI / 2 }; };
  W.stations = function (s) {
    const L = W.L;
    const list = [
      { id: 'mix', name: 'ミキサー台', x: L.mixT[0], z: L.mixT[1] + 0.8, y: 1.75, verb: '生地を作る' },
      { id: 'rack', name: '冷却ラック', x: L.rack[0] - 0.9, z: L.rack[1], y: 2.15, verb: 'ラックを見る' },
      { id: 'whip', name: 'クリーム台', x: L.whipT[0], z: L.whipT[1] + 0.8, y: 1.45, verb: 'クリームを作る' },
      { id: 'deco', name: 'デコ台', x: L.decoT[0], z: L.decoT[1] + 0.8, y: 1.45, verb: '仕上げる' },
      { id: 'market', name: '仕入れ棚', x: -RX + 1.55, z: L.shelf[1], y: 2.1, verb: '仕入れる' },
      { id: 'biz', name: '経営デスク', x: L.desk[0] - 1.3, z: L.desk[1], y: 1.4, verb: '経営を見る' },
      { id: 'menu', name: 'メニュー黒板', x: -RX + 0.8, z: L.board[1], y: 2.55, verb: 'メニュー・価格' },
      { id: 'case', name: 'ショーケース', x: CASE_X0 + 3.5, z: CASE_Z - 0.68, y: 1.65, verb: '陳列・入れ替え', wide: 4.2 },
      { id: 'sign', name: '入口の札', x: 1.6, z: RZ - 0.7, y: 1.6, verb: s && s.phase === 'prep' ? '開店する' : '営業の様子' },
    ];
    if (s) s.ovens.forEach((o, i) => list.push({ id: 'oven' + i, oven: i, name: 'オーブン' + (i + 1), x: OVEN_X0 + i * OVEN_DX, z: OVEN_Z + 0.67, y: 1.75, verb: o.s ? '取り出す' : '予熱・焼く' }));
    return list;
  };

  // =====================================================================
  //  状態の反映（サーバーから来るたび）
  // =====================================================================
  W.sync = function (s, room) {
    if (!W.ready || !s) return;
    W.S = s; W.room = room;
    if ((s.up.floor || 0) !== LV) W.rebuild(s.up.floor || 0);
    const e = W.eng;
    // オーブン（業務用・ステンレス）
    const ot = (s.eq && s.eq.oven) || 0;
    if (W.keys.ov !== s.ovens.length + '|' + ot) {
      W.keys.ov = s.ovens.length + '|' + ot; W.ovenGroup.clear(); W.ovens = [];
      s.ovens.forEach((o, i) => {
        const x = OVEN_X0 + i * OVEN_DX;
        const B = new Builder(), st = ot === 0 ? { rough: 0.25 } : ot === 3 ? { rough: 0.5 } : { rough: 0.3, metal: 1 };
        const body = rgb(['#ECE8E1', '#C7CBD0', '#2B2D30', '#3A3430'][ot]), stand = rgb(['#B9BEC4', '#B9BEC4', '#1E2022', '#2A2522'][ot]);
        B.put(Geo.rbox(1.15, 0.5, 0.9, 0.02), [0, 0.25, 0], 0, 1, stand, { rough: 0.3, metal: 1 });
        B.put(Geo.rbox(1.15, 0.85, 0.95, ot === 3 ? 0.06 : 0.02), [0, 0.92, 0], 0, 1, body, st);
        if (ot === 2) B.put(Geo.cyl(0.11, 0.11, 0.01, 24), [0.42, 0.88, 0.48], [PI / 2, 0, 0], 1, rgb('#55585C'), { rough: 0.3, metal: 1 });
        if (ot === 3) { B.put(Geo.box(1.16, 0.03, 0.02), [0, 1.3, 0.48], 0, 1, C.brass, { rough: 0.3, metal: 1 }); B.put(Geo.box(1.16, 0.03, 0.02), [0, 0.53, 0.48], 0, 1, C.brass, { rough: 0.3, metal: 1 }); B.put(Geo.rbox(0.3, 0.12, 0.02, 0.01), [0.38, 1.27, 0.49], 0, 1, rgb('#6E4A33'), { rough: 0.5 }); }
        B.put(Geo.rbox(0.96, 0.55, 0.04, 0.02), [0, 0.88, 0.47], 0, 1, rgb('#1E1E20'), { rough: 0.2 });
        B.put(Geo.cyl(0.018, 0.018, 0.8, 10), [0, 1.22, 0.53], [0, 0, PI / 2], 1, rgb('#D8DBDF'), st);
        B.put(Geo.rbox(1.0, 0.1, 0.03, 0.01), [0, 1.27, 0.47], 0, 1, rgb('#1A1A1A'), { rough: 0.25 });
        [-0.38, -0.25].forEach((dx) => B.put(Geo.cyl(0.03, 0.03, 0.03, 14), [dx, 1.27, 0.5], [PI / 2, 0, 0], 1, rgb('#2A2A2A'), { rough: 0.3 }));
        for (let k = 0; k < 4; k++) B.put(Geo.cyl(0.02, 0.02, 0.06, 8), [k % 2 ? 0.5 : -0.5, 0.03, k < 2 ? 0.4 : -0.4], 0, 1, rgb('#2A2A2A'), { rough: 0.5 });
        const n = W.ovenGroup.add(new Node(B.build(e))); n.p = [x, 0, OVEN_Z];
        const win = n.add(new Node(e.mesh(Geo.box(0.8, 0.4, 0.01), null, { rough: 0.05 }), { color: rgb('#202020'), em: 0, cast: false }));
        win.p = [0, 0.88, 0.495];
        const disp = n.add(new Node(e.mesh(Geo.box(0.16, 0.05, 0.01)), { color: rgb('#FF5A2A'), em: 1, cast: false })); disp.p = [0.25, 1.27, 0.49];
        const tray = n.add(new Node(null)); tray.p = [0, 0.74, 0.25];
        W.ovens.push({ n, win, disp, tray, k: '' });
        block(x - 0.58, OVEN_Z - 0.5, x + 0.58, OVEN_Z + 0.5);
      });
    }
    s.ovens.forEach((o, i) => {
      const ov = W.ovens[i]; if (!ov) return;
      const k = o.s ? o.k + o.t0 : '';
      if (ov.k !== k) {
        ov.k = k; ov.tray.clear();
        if (o.s) { const B = new Builder(); B.put(Geo.cyl(0.11, 0.1, 0.07, 24, 0, PI * 2, true), [0, 0.035, 0], 0, 1, rgb('#9AA0A6'), { rough: 0.3, metal: 1 }); const pan = new Node(B.build(e), { cast: false }); ov.tray.add(pan); const m = new Node(e.mesh(Geo.cyl(0.1, 0.1, 0.06, 24), '#FFFFFF', { rough: 0.9 }), { cast: false }); m.p = [0, 0.03, 0]; ov.tray.add(m); ov.cake = m; } else ov.cake = null;
      }
    });
    // ショーケース
    const caseKey = JSON.stringify(s.showcase.map((c) => (c ? [c.r, c.p, c.df] : 0)));
    if (W.keys.cs !== caseKey) {
      W.keys.cs = caseKey; W.caseGroup.clear();
      s.showcase.forEach((c, i) => {
        const x = CASE_X0 + i;
        const stand = new Node(e.mesh(Geo.cyl(0.16, 0.16, 0.012, 32), '#F4F1EC', { rough: 0.2 })); stand.p = [x, 0.905, CASE_Z]; W.caseGroup.add(stand);
        if (c) { const r = sim.recipe(s, c.r); if (r) { const n = MD.cake(e, r, c.p, 1.15, c.df); n.p = [x, 0.92, CASE_Z]; n.r = [0, PI * 0.1, 0]; W.caseGroup.add(n); } }
      });
    }
    // 冷却ラック
    const ids = Object.keys(s.bases).sort();
    const rk = JSON.stringify(ids.map((id) => [s.bases[id].k, s.bases[id].df]));
    if (W.keys.rk !== rk) {
      W.keys.rk = rk; W.rackGroup.clear();
      ids.slice(0, 12).forEach((id, i) => {
        const b = s.bases[id], B0 = D.BASES[b.k];
        const burnt = (b.df || []).includes('burnt');
        const BB = new Builder();
        const col = burnt ? mix(B0.color, '#24130A', 0.6) : rgb(B0.color), top = burnt ? rgb('#1C0F07') : rgb(B0.crumb);
        if (B0.cookie) { BB.put(Geo.box(0.34, 0.012, 0.24), [0, 0.006, 0], 0, 1, rgb('#9AA0A6'), { rough: 0.3, metal: 1 }); for (let k = 0; k < 8; k++) BB.put(B0.shell ? Geo.sphere(0.022, 10, 6, 0, PI / 2) : Geo.cyl(0.024, 0.024, 0.008, 14), [-0.12 + (k % 4) * 0.08, 0.016, -0.05 + Math.floor(k / 4) * 0.1], 0, B0.shell ? [0.8, 0.4, 1.1] : 1, col, { rough: 0.85 }); const n = new Node(BB.build(e)); n.p = [W.L.rack[0], 0.36 + Math.floor(i / 2) * 0.5, W.L.rack[1] + ((i % 2) - 0.5) * 0.46]; W.rackGroup.add(n); return; }
        BB.put(Geo.cyl(0.1, 0.1, B0.tart ? 0.03 : 0.06, 24), [0, B0.tart ? 0.015 : 0.03, 0], 0, 1, col, { rough: 0.9 });
        BB.put(Geo.cyl(0.098, 0.1, 0.006, 24), [0, B0.tart ? 0.031 : 0.062, 0], 0, 1, top, { rough: 0.85 });
        const n = new Node(BB.build(e));
        n.p = [W.L.rack[0] + ((i % 2) - 0.5) * 0.36, 0.36 + Math.floor(i / 4) * 0.5, W.L.rack[1] + (((i >> 1) % 2) - 0.5) * 0.46];
        W.rackGroup.add(n);
      });
    }
    // 台の上（生地ボウル・クリームボウル）
    const tk = JSON.stringify([Object.keys(s.batters).map((id) => s.batters[id].k), Object.keys(s.creams).map((id) => [s.creams[id].k, s.creams[id].n])]);
    if (W.keys.tb !== tk) {
      W.keys.tb = tk; W.tableGroup.clear();
      Object.keys(s.batters).slice(0, 4).forEach((id, i) => {
        const B = new Builder(); B.put(Geo.cyl(0.11, 0.07, 0.09, 20, 0, PI * 2, true), [0, 0.045, 0], 0, 1, rgb('#C7CBD0'), { rough: 0.3, metal: 1 }); B.put(Geo.cyl(0.07, 0.07, 0.005, 20), [0, 0.003, 0], 0, 1, rgb('#C7CBD0'), { rough: 0.3, metal: 1 }); B.put(Geo.cyl(0.1, 0.1, 0.005, 20), [0, 0.075, 0], 0, 1, rgb(D.BASES[s.batters[id].k].color), { rough: 0.35 });
        const n = W.tableGroup.add(new Node(B.build(e))); n.p = [W.L.mixT[0] - 0.75 + (i % 2) * 0.26, 0.905, W.L.mixT[1] + 0.22 - Math.floor(i / 2) * 0.25];
      });
      Object.keys(s.creams).slice(0, 4).forEach((id, i) => {
        const c = s.creams[id]; const B = new Builder();
        B.put(Geo.cyl(0.09, 0.06, 0.07, 20, 0, PI * 2, true), [0, 0.035, 0], 0, 1, rgb('#EDEAE4'), { rough: 0.15 });
        B.put(Geo.cyl(0.06, 0.06, 0.004, 20), [0, 0.002, 0], 0, 1, rgb('#EDEAE4'), { rough: 0.15 });
        for (let k = 0; k < c.n; k++) B.put(Geo.sphere(0.06, 14, 10), [k ? 0.02 : -0.015, 0.06 + k * 0.012, 0], 0, [1, 0.55, 1], rgb(D.CREAMS[c.k].color), { rough: 0.4 });
        const n = W.tableGroup.add(new Node(B.build(e))); n.p = [W.L.whipT[0] + 0.1 + i * 0.24, 0.91, W.L.whipT[1] + 0.25];
      });
    }
    const uk = JSON.stringify([s.up.interior || 0, s.up.sign || 0, s.furn, s.eq, s.up.floor || 0, s.name, LV]);
    if (W.keys.up !== uk) { W.keys.up = uk; W.decorate(s); }
    const mk = JSON.stringify([s.menu, s.known]);
    if (W.keys.mb !== mk) { W.keys.mb = mk; W.drawBoard(s); }
  };
  W.decorate = function (s) {
    const e = W.eng;
    const lv = s.up.interior || 0;
    e.updateTex(W.T.plaster, MD.TX.plaster(['#EFE8DD', '#E6EEE6', '#EDE4EC', '#F2EADB'][Math.min(3, lv)]));
    W.decoGroup.clear();
    const B = {}; const P = (m, g, p, r, sc, c, o) => { (B[m] = B[m] || new Builder()).put(g, p, r, sc, c || [1, 1, 1], o); };
    {
      W.tablePos(s).forEach(([x, z]) => {
        P('marble', Geo.cyl(0.4, 0.4, 0.03, 32), [x, 0.74, z], 0, 1, null, { rough: 0.18 });
        P('d', Geo.cyl(0.03, 0.03, 0.72, 10), [x, 0.37, z], 0, 1, C.dark, { rough: 0.3, metal: 1 }); P('d', Geo.cyl(0.2, 0.22, 0.02, 20), [x, 0.01, z], 0, 1, C.dark, { rough: 0.3, metal: 1 });
        [0.65, -0.65].forEach((dx) => { P('w', Geo.cyl(0.19, 0.19, 0.04, 20), [x + dx, 0.46, z], 0, 1, null, { rough: 0.5 }); P('d', Geo.cyl(0.015, 0.015, 0.44, 6), [x + dx, 0.22, z], 0, 1, C.dark, { rough: 0.3, metal: 1 }); P('w', Geo.rbox(0.04, 0.4, 0.34, 0.01), [x + dx * 1.3, 0.7, z], [0, 0, dx > 0 ? -0.1 : 0.1], 1, null, { rough: 0.5 }); });
        P('d', Geo.cyl(0.035, 0.03, 0.1, 12), [x, 0.8, z], 0, 1, rgb('#D6E7EE'), { rough: 0.05 });
        block(x - 1.0, z - 0.35, x + 1.0, z + 0.35);
      });
    }
    // 観葉植物・コーヒーマシン・スピーカー（家具）
    const F = s.furn || {};
    [[-RX + 0.6, CASE_Z + 0.95], [RX - 0.6, CASE_Z + 2.6], [-2.0, RZ - 0.6], [RX - 0.6, RZ - 1.6], [-RX + 0.6, RZ - 1.8]].slice(0, F.plant || 0).forEach(([x, z], i) => {
      P('d', Geo.cyl(0.19, 0.14, 0.42, 18), [x, 0.21, z], 0, 1, rgb(['#B86B4B', '#3A3A3A', '#E8E2D8'][i % 3]), { rough: 0.6 });
      for (let k = 0; k < 9; k++) P('d', Geo.sphere(0.12, 10, 8), [x + Math.sin(k * 2.4) * 0.14, 0.55 + k * 0.09, z + Math.cos(k * 2.4) * 0.14], [k * 0.5, k, 0.3], [1, 1.9, 0.45], shade(C.leaf, (k % 3) * 0.08 - 0.04), { rough: 0.6 });
      block(x - 0.22, z - 0.22, x + 0.22, z + 0.22);
    });
    if (F.coffee) { const x = Math.min(RX - 0.5, REG[0] + 1.35), z = CASE_Z - 0.05; P('d', Geo.rbox(0.42, 0.46, 0.4, 0.04), [x, 1.19, z], 0, 1, rgb('#2A2624'), { rough: 0.3 }); P('d', Geo.rbox(0.3, 0.06, 0.3, 0.02), [x, 1.45, z], 0, 1, C.steel, { rough: 0.25, metal: 1 }); P('d', Geo.cyl(0.035, 0.03, 0.08, 12), [x, 1.0, z + 0.12], 0, 1, C.white, { rough: 0.2 }); P('d', Geo.cyl(0.012, 0.012, 0.08, 8), [x, 1.12, z + 0.12], 0, 1, C.steel, { rough: 0.25, metal: 1 }); }
    if (F.speaker) [[-RX + 0.15, -1], [RX - 0.15, 1]].forEach(([x, sd]) => { P('d', Geo.rbox(0.18, 0.28, 0.18, 0.02), [x, 2.6, RZ - 0.4], [0, sd * 0.6, 0], 1, rgb('#1E1C1B'), { rough: 0.5 }); P('d', Geo.cyl(0.05, 0.05, 0.01, 16), [x - sd * 0.06, 2.62, RZ - 0.32], [PI / 2, sd * 0.6, 0], 1, rgb('#3A3633'), { rough: 0.6 }); });
    // ミキサー（設備のグレードで見た目が変わる）
    const mt = (s.eq && s.eq.mixer) || 0, [mx, mz] = W.L.mixT;
    if (mt === 0) { P('d', Geo.rbox(0.09, 0.14, 0.22, 0.03), [mx - 0.3, 0.98, mz], [0, 0.4, 0], 1, C.white, { rough: 0.3 }); P('d', Geo.cyl(0.11, 0.07, 0.12, 20), [mx - 0.55, 0.97, mz + 0.1], 0, 1, C.steel, { rough: 0.3, metal: 1 }); }
    else {
      const col = rgb(['#9C2F3A', '#9C2F3A', '#C7CBD0', '#D8DBDF'][mt]), sc = [1, 1, 1.35, 1.8][mt];
      P('d', Geo.rbox(0.28 * sc, 0.08, 0.36 * sc, 0.03), [mx - 0.3, 0.95, mz - 0.05], 0, 1, col, { rough: 0.22, metal: mt >= 2 ? 1 : 0 });
      P('d', Geo.rbox(0.13 * sc, 0.42 * sc, 0.16 * sc, 0.05), [mx - 0.3, 0.92 + 0.25 * sc, mz - 0.18 * sc], 0, 1, col, { rough: 0.22, metal: mt >= 2 ? 1 : 0 });
      P('d', Geo.rbox(0.18 * sc, 0.13 * sc, 0.4 * sc, 0.05), [mx - 0.3, 0.92 + 0.48 * sc, mz - 0.07 * sc], 0, 1, col, { rough: 0.22, metal: mt >= 2 ? 1 : 0 });
      P('d', Geo.cyl(0.11 * sc, 0.07 * sc, 0.15 * sc, 20), [mx - 0.3, 0.98 + 0.08 * sc, mz + 0.04 * sc], 0, 1, C.steel, { rough: 0.3, metal: 1 });
    }
    if (lv >= 1) [[-RX + 0.1, 2.0, -RZ + 1.7], [RX - 0.1, 2.0, CASE_Z + 2.6]].forEach(([x, y, z], i) => { P('w', Geo.rbox(0.05, 0.85, 1.1, 0.01), [x, y, z], 0, 1, null, { rough: 0.5 }); P('d', Geo.box(0.06, 0.65, 0.9), [x, y, z], 0, 1, rgb(['#C7B299', '#8FA9B8'][i]), { rough: 0.7 }); });
    if (lv >= 2) [-1, 1].forEach((sd) => { for (let x = 1.7; x <= RX - 1.3; x += 1.7) { const px = sd * x, pz = RZ - 0.02; P('d', Geo.cyl(0.06, 0.045, 0.16, 14), [px, 1.04, pz], 0, 1, rgb('#E8E2D8'), { rough: 0.15 }); for (let k = 0; k < 4; k++) P('d', Geo.sphere(0.032, 8, 6), [px + Math.sin(k * 1.6) * 0.035, 1.16 + k * 0.018, pz + Math.cos(k * 1.6) * 0.03], 0, 1, rgb(['#D46A7A', '#F2D16B', '#F4F1EC', '#C98FB0'][(Math.round(x) + k) % 4]), { rough: 0.6 }); } });
    if (lv >= 3) W.L.lamps.slice(2).forEach(([x, z]) => { P('d', Geo.torus(0.35, 0.02, 6, 24), [x, 2.4, z], [PI / 2, 0, 0], 1, C.brass, { rough: 0.25, metal: 1 }); for (let k = 0; k < 8; k++) P('d', Geo.sphere(0.035, 8, 6), [x + Math.cos(k * 0.785) * 0.35, 2.36, z + Math.sin(k * 0.785) * 0.35], 0, 1, rgb('#FFF0D0'), { rough: 0.1 }); });
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
    W.eng.updateTex(W.boardTex, W.boardCv);
  };

  // =====================================================================
  //  入力（PC：WASD＋マウス / スマホ：スティック＋右側スワイプ）
  // =====================================================================
  W.input = { mx: 0, mz: 0, joy: null, action: false };
  W.bindInput = function (canvas) {
    const ptr = {};
    const camDrag = (dx, dy) => {
      const s = (ST.camSens || 1) * 0.006;
      W.cam.tYaw -= dx * s;
      W.cam.tPitch = clamp(W.cam.tPitch + dy * s * (ST.invertY ? -1 : 1), 0.18, 1.35);
    };
    const pinch = () => { const ps = Object.values(ptr).filter((p) => p.kind === 'cam'); if (ps.length < 2) return null; return Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y); };
    let pinch0 = null, dist0 = 0;
    const down = (e) => {
      if (W.blocked()) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      ptr[e.pointerId] = { x: e.clientX, y: e.clientY, kind: 'cam', type: e.pointerType };
      const p = pinch(); if (p) { pinch0 = p; dist0 = W.cam.tDist; }
    };
    const move = (e) => {
      const p = ptr[e.pointerId]; if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      const pn = pinch();
      if (pn && pinch0) { W.cam.tDist = clamp(dist0 * (pinch0 / pn), 3.2, 13); return; }
      camDrag(dx, dy);
    };
    const up = (e) => { delete ptr[e.pointerId]; if (!pinch()) pinch0 = null; };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    const wheel = (e) => { e.preventDefault(); W.cam.tDist = clamp(W.cam.tDist * (1 + Math.sign(e.deltaY) * 0.1), 3.2, 13); };
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const kd = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (W.blocked()) return;
      W.keys[e.code] = true;
      if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) W.doAction(); }
      if (e.code === 'KeyQ') W.cam.tYaw += 0.4; if (e.code === 'KeyR') W.cam.tYaw -= 0.4;
    };
    const ku = (e) => { W.keys[e.code] = false; };
    const blur = () => { W.keys = {}; };
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
  W.blocked = function () { return !!(CS.ui.sheet || !document.getElementById('mg').hidden || !document.getElementById('modal').hidden || W.editing || (document.getElementById('gov') && !document.getElementById('gov').hidden)); };

  // =====================================================================
  //  毎フレーム
  // =====================================================================
  W.frame = function () {
    if (!W.ready) return;
    const now = performance.now();
    // 調理ミニゲーム中は背景の 3D をゆっくり描く（操作を軽く・電池を節約）
    if (document.body.classList.contains('mg-open') && now - (W.lastRender || 0) < 160) return;
    W.lastRender = now;
    const dt = Math.min(0.05, (now - W.last) / 1000); W.last = now;
    const s = W.S, room = W.room;
    W.updatePlayer(dt);
    W.updateCamera(dt);
    W.updateOthers(dt);
    if (s) { W.updateCustomers(dt, s, room.now()); W.updateStaff(dt, s, room.now()); }
    W.updateOvens(s, room && room.now());
    W.updateWalls();
    W.eng.shadowCenter = [W.me.x * 0.5, 0, W.me.z * 0.5];
    W.eng.render(W.scene);
    W.updateLabels(s, room && room.now());
  };
  function collide(x, z, r) {
    x = clamp(x, -RX + r, RX - r); z = clamp(z, -RZ + r, RZ - r);
    for (const b of W.obstacles) {
      const nx = clamp(x, b[0], b[2]), nz = clamp(z, b[1], b[3]);
      const dx = x - nx, dz = z - nz, d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-5) { x = nx + (dx / d) * r; z = nz + (dz / d) * r; }
        else { const l = x - b[0], ri = b[2] - x, t = z - b[1], bo = b[3] - z; const m = Math.min(l, ri, t, bo); if (m === l) x = b[0] - r; else if (m === ri) x = b[2] + r; else if (m === t) z = b[1] - r; else z = b[3] + r; }
      }
    }
    return [x, z];
  }
  W.updatePlayer = function (dt) {
    const me = W.me, s = W.S, room = W.room;
    // キャラクター（スキンが変わったら作り直す）
    const skin = CS.save.data.skin, sk = JSON.stringify(skin);
    if (!me.ch || me.skinKey !== sk) { if (me.ch) W.people.remove(me.ch.node); me.ch = MD.character(W.eng, skin); me.skinKey = sk; W.people.add(me.ch.node); me.blob = W.addBlob(me.ch.node); }
    let ix = 0, iz = 0;
    if (!W.blocked()) {
      const K = W.keys;
      if (K.KeyW || K.ArrowUp) iz -= 1; if (K.KeyS || K.ArrowDown) iz += 1; if (K.KeyA || K.ArrowLeft) ix -= 1; if (K.KeyD || K.ArrowRight) ix += 1;
      if (W.input.joy) { ix += W.input.joy.x; iz += W.input.joy.y; }
    }
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    // カメラ基準の向きに変換
    const yaw = W.cam.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const mx = rx * ix + fx * -iz, mz = rz * ix + fz * -iz;
    const speed = 3.4;
    me.vx = lerp(me.vx, mx * speed, 1 - Math.exp(-dt * 12)); me.vz = lerp(me.vz, mz * speed, 1 - Math.exp(-dt * 12));
    const sp = Math.hypot(me.vx, me.vz);
    if (sp > 0.05) { const [nx, nz] = collide(me.x + me.vx * dt, me.z + me.vz * dt, 0.28); me.x = nx; me.z = nz; me.r = angLerp(me.r, Math.atan2(me.vx, me.vz), 1 - Math.exp(-dt * 14)); }
    const busy = !!(CS.ui.sheet || !document.getElementById('mg').hidden);
    me.mode = sp > 0.3 ? 'walk' : busy ? 'work' : 'idle';
    if (busy && W.near) me.r = angLerp(me.r, Math.atan2(W.near.x - me.x, W.near.z - me.z), 1 - Math.exp(-dt * 8));
    me.ch.node.p = [me.x, 0, me.z]; me.ch.node.r = [0, me.r, 0];
    me.ch.anim(dt, me.mode, sp / 3.4);
    // 近くの作業台
    W.near = null;
    if (s) {
      let best = null, bd = 1e9;
      for (const st of W.stations(s)) {
        let dx = me.x - st.x, dz = me.z - st.z;
        if (st.wide) dx = Math.max(0, Math.abs(dx) - st.wide);
        const d = Math.hypot(dx, dz);
        if (d < 1.35 && d < bd) { bd = d; best = st; }
      }
      W.near = best;
    }
    if (W.onNear) W.onNear(W.near);
    // 位置を共有
    if (room && room.sendPos) room.sendPos({ x: +me.x.toFixed(2), z: +me.z.toFixed(2), r: +me.r.toFixed(2), a: me.mode === 'walk' ? 1 : me.mode === 'work' ? 2 : 0 });
  };
  W.updateCamera = function (dt) {
    const c = W.cam, me = W.me, k = 1 - Math.exp(-dt * 10);
    c.yaw = angLerp(c.yaw, c.tYaw, k); c.pitch = lerp(c.pitch, c.tPitch, k); c.dist = lerp(c.dist, c.tDist, k);
    c.target[0] = lerp(c.target[0], me.x, 1 - Math.exp(-dt * 8)); c.target[2] = lerp(c.target[2], me.z, 1 - Math.exp(-dt * 8)); c.target[1] = 1.15;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const e = W.eng;
    e.cam.pos = [c.target[0] + Math.sin(c.yaw) * cp * c.dist, c.target[1] + sp * c.dist, c.target[2] + Math.cos(c.yaw) * cp * c.dist];
    e.cam.target = c.target.slice();
    e.cam.fov = 0.8;
  };
  W.updateWalls = function () {
    const p = W.eng.cam.pos;
    const out = { front: p[2] > RZ - 0.2, back: p[2] < -RZ + 0.2, left: p[0] < -RX + 0.2, right: p[0] > RX - 0.2 };
    for (const k in W.walls) W.walls[k].vis = !out[k];
    // 見下ろし視点ではランプを隠す（光はそのまま）
    const hide = p[1] > 2.8;
    if (W.lampNode) W.lampNode.vis = !hide;
    if (W.bulbs) W.bulbs.forEach((b) => (b.vis = !hide));
  };
  W.addBlob = function (node) {
    const b = new Node(W.blobMesh, { tex: W.blobTex, op: 0.85, blend: true, outline: false, cast: false, recv: false, em: 1, color: [1, 1, 1], isBlob: true });
    b.p = [0, 0.012, 0]; b.s = [0.8, 1, 0.8];
    node.add(b);
    b.vis = !W.eng.shadows;
    return b;
  };
  // ---------- ほかのプレイヤー ----------
  W.updateOthers = function (dt) {
    const room = W.room; if (!room) return;
    const pos = room.pos || {};
    const seen = {};
    for (const pid in pos) {
      if (pid === room.pid) continue;
      const p = pos[pid]; const mem = room.members[pid];
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
      o.ch.anim(dt, p.a === 1 || sp > 0.4 ? 'walk' : p.a === 2 ? 'work' : 'idle', 1);
      o.name = mem.name;
    }
    for (const pid in W.others) if (!seen[pid]) { W.people.remove(W.others[pid].ch.node); delete W.others[pid]; }
  };
  // ---------- お客さん ----------
  function custPath(c, g, qi) {
    const out = [DOOR[0], RZ + 2.2], inDoor = [DOOR[0], RZ - 0.6];
    const spot = [clamp(REG[0] - qi * 0.75, CASE_X0, REG[0]), CASE_Z + 0.95];
    const look = [spot[0], CASE_Z];
    const walk = (pts, f) => { let L = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; } let d = f * L; for (let i = 0; i < seg.length; i++) { if (d <= seg[i] || i === seg.length - 1) { const t = seg[i] ? clamp(d / seg[i], 0, 1) : 1; return { x: lerp(pts[i][0], pts[i + 1][0], t), z: lerp(pts[i][1], pts[i + 1][1], t), r: Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) }; } d -= seg[i]; } return { x: pts[pts.length - 1][0], z: pts[pts.length - 1][1], r: 0 }; };
    if (c.st === 'walk' || g < c.t1) {
      const f = clamp((g - c.t0) / (c.t1 - c.t0), 0, 1);
      const p = walk([out, inDoor, spot], f);
      if (f >= 1) p.r = Math.atan2(look[0] - spot[0], look[1] - spot[1]);
      return Object.assign(p, { walking: f < 1 });
    }
    const seat = c.seat >= 0 ? W.seatPos(W.S, c.seat) : null;
    if (seat) {
      const sp = [seat.x, seat.z + 0.55], a0 = c.t1 + 1100, a1 = a0 + 3200, b0 = c.t2 - 2400;
      if (g < a0) return { x: spot[0], z: spot[1], r: Math.atan2(look[0] - spot[0], look[1] - spot[1]), walking: false };
      if (g < a1) { const p = walk([spot, sp, [seat.x, seat.z]], clamp((g - a0) / (a1 - a0), 0, 1)); return Object.assign(p, { walking: true }); }
      if (g < b0) return { x: seat.x, z: seat.z, r: seat.r, walking: false, sit: true };
      const p = walk([[seat.x, seat.z], sp, inDoor, out], clamp((g - b0) / 2400, 0, 1)); return Object.assign(p, { walking: true });
    }
    const f = clamp((g - c.t1 - 1100) / Math.max(1, c.t2 - c.t1 - 1100), 0, 1);
    const p = walk([spot, inDoor, out], f);
    if (f <= 0) p.r = Math.atan2(look[0] - spot[0], look[1] - spot[1]);
    return Object.assign(p, { walking: f > 0 && f < 1 });
  }
  W.updateCustomers = function (dt, s, g) {
    const ids = Object.keys(s.cust).sort((a, b) => s.cust[a].t0 - s.cust[b].t0);
    let qi = 0;
    for (const id in W.custs) if (!s.cust[id]) { W.people.remove(W.custs[id].ch.node); delete W.custs[id]; }
    ids.forEach((id) => {
      const c = s.cust[id];
      let o = W.custs[id];
      if (!o) { o = W.custs[id] = { ch: MD.character(W.eng, MD.customerSkin(c.ty, c.v || 0)) }; W.people.add(o.ch.node); W.addBlob(o.ch.node); }
      const p = custPath(c, g, c.st === 'walk' ? qi++ : 0);
      o.ch.node.p = [p.x, 0, p.z];
      o.ch.node.r[1] = angLerp(o.ch.node.r[1], p.r, 1 - Math.exp(-dt * 10));
      o.ch.anim(dt, p.sit ? 'sit' : p.walking ? 'walk' : c.st === 'buy' && g - c.t1 < 1100 && !(c.say || '').endsWith('…') ? 'happy' : 'idle', 0.9);
      o.c = c;
      if (c.st !== 'walk' && !o.said) {
        o.said = true; o.sayUntil = performance.now() + 2300;
        if (c.st === 'buy') { CS.sound.play('coin'); o.coin = true; }
      }
    });
  };
  // ---------- アルバイト（担当の作業台で働く） ----------
  function staffSpot(s, m, i) {
    const sts = W.stations(s), by = (id) => sts.find((x) => x.id === id);
    let st = null, off = 0.55;
    if (m.task === 'bake') st = m.job && m.job.slot != null ? by('oven' + m.job.slot) : { x: OVEN_X0 + 0.7, z: OVEN_Z + 1.1, face: [OVEN_X0 + 0.7, OVEN_Z] };
    else if (m.task === 'cashier') return { x: REG[0] + 0.1, z: CASE_Z - 0.75, fx: REG[0] + 0.1, fz: CASE_Z + 2 };
    else st = by({ mix: 'mix', whip: 'whip', deco: 'deco', stock: 'market' }[m.task] || 'mix');
    if (!st) return { x: 0, z: CASE_Z - 1.5, fx: 0, fz: CASE_Z };
    const tgt = { mix: W.L.mixT, whip: W.L.whipT, deco: W.L.decoT, stock: [-RX, st.z] }[m.task] || (st.face || [st.x, st.z - 1]);
    const x = st.x + (m.task === 'stock' || m.task === 'bake' ? 0 : off), z = st.z;
    return { x, z, fx: m.task === 'stock' ? -RX : tgt[0] + (m.task === 'bake' ? 0 : off), fz: tgt[1] };
  }
  W.updateStaff = function (dt, s, g) {
    const list = s.staff || []; W.staffN = W.staffN || {};
    for (let i = 0; i < 4; i++) {
      const m = list[i]; let o = W.staffN[i];
      const key = m ? m.name + JSON.stringify(m.skin || {}) : '';
      if (o && o.key !== key) { W.people.remove(o.ch.node); delete W.staffN[i]; o = null; }
      if (!m) continue;
      if (!o) { const t0 = staffSpot(s, m, i); o = W.staffN[i] = { ch: MD.character(W.eng, Object.assign({}, D.DEFAULT_SKIN, m.skin || {})), key, x: t0.x, z: t0.z, r: Math.atan2(t0.fx - t0.x, t0.fz - t0.z) }; W.people.add(o.ch.node); W.addBlob(o.ch.node); }
      const t = staffSpot(s, m, i), dx = t.x - o.x, dz = t.z - o.z, d = Math.hypot(dx, dz);
      let mode = 'idle';
      if (d > 0.06) { const v = Math.min(d, dt * 1.5); o.x += (dx / d) * v; o.z += (dz / d) * v; o.r = angLerp(o.r, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10)); mode = 'walk'; }
      else { o.r = angLerp(o.r, Math.atan2(t.fx - o.x, t.fz - o.z), 1 - Math.exp(-dt * 6)); mode = m.job && (s.phase === 'open' || s.phase === 'prep') ? 'work' : 'idle'; }
      o.ch.node.p = [o.x, 0, o.z]; o.ch.node.r = [0, o.r, 0];
      o.ch.anim(dt, mode, 0.8);
      o.m = m;
    }
    for (const k in W.staffN) if (!list[k]) { W.people.remove(W.staffN[k].ch.node); delete W.staffN[k]; }
  };
  W.updateOvens = function (s, g) {
    if (!s) return;
    s.ovens.forEach((o, i) => {
      const ov = W.ovens[i]; if (!ov) return;
      const heating = o.h && g < (o.hot || 0), hot = o.h && !heating;
      ov.disp.color = o.s ? rgb('#FF5A2A') : hot ? rgb('#7CFF6B') : heating ? rgb('#FFB02A') : rgb('#333333');
      ov.disp.em = o.h ? 1 : 0.2;
      if (!o.s) { ov.win.em = hot || heating ? 0.1 : 0; ov.win.color = hot || heating ? rgb('#7A3A14') : rgb('#202020'); return; }
      const w = sim.bakeWindow(s, o.dT || 0);
      const d = (g - o.t0) / o.dur; ov.d = d;
      ov.win.em = 0.32; ov.win.color = rgb('#E2802F');
      if (ov.cake) {
        const B0 = D.BASES[o.k];
        const f = Math.max(0, Math.min(1.5, d));
        ov.cake.color = f < 1 ? mix('#F4E7C6', B0.color, f) : mix(B0.color, '#1C0F07', Math.min(1, (f - 1) / 0.4));
        ov.cake.s = [1, (B0.tart || B0.cookie ? 0.4 : 0.55 + Math.min(1, f) * 0.6) * (o.cold ? 0.75 : 1), 1];
      }
      if (Math.abs(d - 1) <= w && !W.alerted[o.t0]) { W.alerted[o.t0] = 1; CS.sound.play('ding'); }
    });
  };

  // =====================================================================
  //  ラベル（作業台の名前・状態、名前タグ、吹き出し）
  // =====================================================================
  function lab(key, cls) {
    let el = W.lbl[key];
    if (!el) { el = document.createElement('div'); el.className = 'lb ' + (cls || ''); W.labels.appendChild(el); W.lbl[key] = el; el._h = ''; }
    el._used = true;
    return el;
  }
  function place(el, p3, dy, scale) {
    const p = W.eng.project(p3);
    if (!p || p.z > 1 || p.x < -80 || p.x > W.eng.canvas.clientWidth + 80) { el.hidden = true; return null; }
    el.hidden = false;
    const sc = scale || clamp(7 / p.d, 0.55, 1.1);
    el.style.transform = `translate(${p.x}px, ${p.y + (dy || 0)}px) translate(-50%, -100%) scale(${sc.toFixed(2)})`;
    return p;
  }
  const distMe = (x, z) => Math.hypot(W.me.x - x, W.me.z - z);
  function setHTML(el, h) { if (el._h !== h) { el._h = h; el.innerHTML = h; } }
  W.updateLabels = function (s, g) {
    if (!s) return;
    for (const k in W.lbl) W.lbl[k]._used = false;
    const esc = CS.art.esc;
    // 作業台
    for (const st of W.stations(s)) {
      const near = W.near && W.near.id === st.id;
      const important = st.oven !== undefined ? s.ovens[st.oven] && s.ovens[st.oven].s : st.id === 'rack' && Object.keys(s.bases).length;
      if (!near && !important && distMe(st.x, st.z) > 4.2) continue;
      const el = lab('st-' + st.id, 'st-lb');
      el.classList.toggle('near', near);
      let status = '';
      if (st.id === 'mix') { const n = Object.keys(s.batters).length; status = n ? `生地 ${n}` : ''; }
      if (st.id === 'rack') { const ids = Object.keys(s.bases); const cool = ids.filter((id) => g >= s.bases[id].cool).length; status = ids.length ? `OK ${cool} / 冷却中 ${ids.length - cool}` : ''; }
      if (st.id === 'whip') { const n = Object.values(s.creams).reduce((a, c) => a + c.n, 0); status = n ? `クリーム ${n}台分` : ''; }
      if (st.id === 'sign') status = s.phase === 'open' ? 'OPEN' : 'CLOSED';
      let extra = '';
      if (st.oven !== undefined) {
        const o = s.ovens[st.oven];
        if (o && !o.s && o.h) status = g < (o.hot || 0) ? '予熱中 ' + o.temp + '℃' : o.temp + '℃ 予熱OK';
        if (o && o.s) {
          const d = (g - o.t0) / o.dur, w = sim.bakeWindow(s, o.dT || 0), max = 1.4;
          const inZ = Math.abs(d - 1) <= w;
          status = o.temp + '℃・' + (d < 1 - w ? 'あと' + Math.max(0, Math.ceil(((1 - d) * o.dur) / 1000)) + '秒' : inZ ? '焼き上がり！' : d < 1.18 ? '焼きすぎ' : '焦げている');
          extra = `<span class="dm"><u style="left:${((1 - w) / max) * 100}%;width:${((2 * w) / max) * 100}%"></u><b style="left:${clamp(d / max, 0, 1) * 100}%"></b></span>`;
          el.classList.toggle('hot', d >= 1 - w);
        } else el.classList.remove('hot');
      }
      setHTML(el, `<b>${esc(st.name)}</b>${status ? `<small>${esc(status)}</small>` : ''}${extra}${near ? `<em>${esc(st.verb)}</em>` : ''}`);
      place(el, [st.x, st.y, st.z]);
    }
    // ショーケースの値札
    s.showcase.forEach((c, i) => {
      if (!c || distMe(CASE_X0 + i, CASE_Z) > 3.6) return;
      const el = lab('tag-' + i, 'tag-lb');
      const m = s.menu[c.r];
      const rr = sim.recipe(s, c.r); setHTML(el, `¥${m ? m.price : 0}<small>${c.p}${(rr && rr.unit) || '切れ'}・品質${Math.round(c.q * 100)}</small>`);
      place(el, [CASE_X0 + i, 1.6, CASE_Z + 0.2]);
    });
    // アルバイトの名札と作業の進み具合
    for (const i in (W.staffN || {})) {
      const o = W.staffN[i], m = o.m; if (!m || distMe(o.x, o.z) > 6) continue;
      const el = lab('sf-' + i, 'nm-lb staff');
      const pr = m.job ? clamp((g - m.job.t0) / Math.max(1, m.job.end - m.job.t0), 0, 1) : -1;
      setHTML(el, `${esc(m.name)} <small>Lv${m.lv}・${esc(D.STAFF.tasks[m.task].name)}</small>${pr >= 0 ? `<i class="pg"><u style="width:${Math.round(pr * 100)}%"></u></i>` : ''}`);
      place(el, [o.x, 1.85, o.z]);
    }
    // 名前タグ
    for (const pid in W.others) { const o = W.others[pid]; const el = lab('nm-' + pid, 'nm-lb'); setHTML(el, esc(o.name || '')); place(el, [o.x, 1.62, o.z]); }
    // 吹き出し
    const nowp = performance.now();
    for (const id in W.custs) {
      const o = W.custs[id];
      if (o.said && nowp < o.sayUntil && o.c && o.c.say) {
        const el = lab('say-' + id, 'say-lb ' + (o.c.st === 'buy' ? 'buy' : 'bad'));
        setHTML(el, esc(o.c.say));
        const p = place(el, [o.ch.node.p[0], 1.55, o.ch.node.p[2]]);
        if (o.coin && p) { o.coin = false; const from = { getBoundingClientRect: () => ({ left: p.x, top: p.y, width: 0, height: 0 }) }; CS.coinFly(from, document.getElementById('h-money'), '¥'); }
      }
    }
    for (const k in W.lbl) if (!W.lbl[k]._used) { W.lbl[k].remove(); delete W.lbl[k]; }
  };

  // =====================================================================
  //  アクション（近くの作業台で）
  // =====================================================================
  W.doAction = function () {
    const st = W.near; if (!st || !W.onAction) return;
    CS.sound.play('tap');
    W.onAction(st);
  };
  W.slotNear = function () { return clamp(Math.round(W.me.x - CASE_X0), 0, (W.S ? W.S.showcase.length : 1) - 1); };
})(typeof window !== 'undefined' ? window : globalThis);
