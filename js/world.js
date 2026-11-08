/* ケーキ屋さんシミュレーター : 3D のお店（一人称視点）
 *  ・歩いて物を「持つ・置く・使う」。照準の先にあるものが操作の対象
 *  ・部屋の間取り（倉庫・パソコン室・厨房・売り場）は plan.geom、厨房の家具は S.fu（配置モードで自由に動かせる）
 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data, sim = CS.sim, ST = CS.settings, K = CS.kitchen, P = CS.plan;
  const { Geo, Builder, Node, Engine, rgb, mix } = CS.gl;
  const MD = CS.models;
  const PI = Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const angLerp = (a, b, t) => { let d = b - a; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return a + d * t; };
  const shade = (c, t) => (t < 0 ? mix(c, '#000000', -t) : mix(c, '#ffffff', t));
  const WH = 3.2, REACH = 2.4, CAKE_SC = 1.5, CT = 0.9;
  const ING_COL = { flour: '#F3EFE6', egg: '#F2D9A8', sugar: '#FBFAF6', butter: '#F4DD8A', milk: '#F7F6F1', cream: '#FFFDF6', strawberry: '#C8102E', blueberry: '#2E3560', peach: '#F6A06B', lemon: '#F7D94C', choco: '#4A2A1C', cocoa: '#6B4030', matcha: '#7E9B4E', cheese: '#F3E7C2', chestnut: '#9A5A22', box: '#F7F5F0' };
  let RX = 10, RZ = 8, CZ = 0, GK = '';
  const W = (CS.world = { ready: false });
  W.dims = {};

  // =====================================================================
  //  間取り（部屋の位置は増床レベルで決まる。家具は S.fu）
  // =====================================================================
  function layout(s) {
    const g = P.geomOf(s);
    RX = g.RX; RZ = g.RZ; CZ = g.CZ;
    const L = { g, lv: g.lv, key: g.key, store: g.store, pc: g.pc };
    L.backDoor = [g.backDoor.x, g.backDoor.z]; // 倉庫（別棟）の裏口
    // トラック（荷台の後ろが倉庫の裏口のそば）。段ボールは荷台の中に積んである
    L.truck = { x: g.truck.x, z: g.truck.z };
    L.alley = [g.ox - 5.4, -RZ - 3.0];
    L.board = [-RX + 0.09, CZ + 2.1];
    L.sign = [1.75, RZ + 0.95];
    // パソコン室：奥の壁ぞいの机
    L.desk = [g.pc.x0 + 1.25, -RZ + 0.42];
    L.pcScr = [L.desk[0] + 0.05, 1.08, -RZ + 0.27];
    L.lamps = []; for (let x = -RX + 1.8; x <= RX - 1.2; x += 3.4) for (let z = -RZ + 1.8; z <= RZ - 1.2; z += 3.2) L.lamps.push([x, z]);
    // 倉庫の照明
    { const sd = g.store, nx = Math.max(1, Math.round((sd.x1 - sd.x0) / 3)), nz = Math.max(1, Math.round((sd.z1 - sd.z0) / 2.9)); for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) L.lamps.push([sd.x0 + ((i + 0.5) * (sd.x1 - sd.x0)) / nx, sd.z0 + ((j + 0.5) * (sd.z1 - sd.z0)) / nz]); }
    // 売り場のテーブル（家具の数だけ）
    L.tables = []; for (let z = CZ + 3.4; z <= RZ - 1.3; z += 1.9) for (let x = -RX + 1.8; x <= -2.6; x += 2.1) L.tables.push([x, z]);
    for (let z = CZ + 6.4; z <= RZ - 1.4; z += 1.9) for (let x = 3.6; x <= RX - 1.8; x += 2.1) L.tables.push([x, z]);
    W.dims = { RX, RZ, CZ, LV: g.lv };
    return L;
  }
  W.L = layout(null);
  W.tablePos = (s) => W.L.tables.slice(0, (s && s.furn && s.furn.table) || 0);
  W.seatPos = (s, i) => { const t = W.tablePos(s)[i >> 1]; if (!t) return null; const sd = i % 2 ? 1 : -1; return { x: t[0] + sd * 0.62, z: t[1], r: sd > 0 ? -PI / 2 : PI / 2 }; };
  W.seatPlate = (s, i) => { const t = W.tablePos(s)[i >> 1]; if (!t) return null; const sd = i % 2 ? 1 : -1; return [t[0] + sd * 0.2, 0.757, t[1]]; };
  // レジの前の列（注文）と、お会計の列
  const regX = (s, fid) => { const f = fOf(s, fid); return f ? f.x : 4.3; };
  W.queueAt = (s, fid, k) => [regX(s, fid) - 0.4, CZ + 1.0 + k * 0.75];
  W.payAt = (s, fid, k) => [regX(s, fid) + 0.55, CZ + 0.85 + k * 0.7];
  // 商品を待つ所（レジの列をよけてカウンターの前に並ぶ）
  W.waitSpot = function (s, k) {
    const regs = P.list(s, 'reg').map((id) => regX(s, id)), key = regs.join(',');
    if (W._wsKey !== key) {
      W._wsKey = key; W._ws = [];
      const x0 = W.L.g.counter.x0 + 0.4, x1 = W.L.g.counter.x1 - 0.4;
      for (let row = 0; row < 3; row++) for (let x = x1; x >= x0; x -= 0.8) if (regs.every((rx) => Math.abs(x - rx) > 1.25)) W._ws.push([x, CZ + 1.1 + row * 0.8]);
      if (!W._ws.length) W._ws.push([0, CZ + 4.5]);
    }
    return W._ws[k % W._ws.length];
  };
  // 家具の表示上の位置（配置モードで動かしている家具は、その場所）
  function fOf(s, fid) {
    const f = s && s.fu && s.fu[fid]; if (!f) return null;
    const mv = W.mv; if (mv && mv.id === fid) return { k: f.k, x: mv.x, z: mv.z, r: mv.r };
    const h = W.hold; if (h && h.id === fid && performance.now() < h.until && (f.x !== h.x || f.z !== h.z || f.r !== h.r)) return { k: f.k, x: h.x, z: h.z, r: h.r };
    return f;
  }
  W.fOf = fOf;
  // 置き場所 → 3D の位置
  function slotWorld(s, at) {
    const p = String(at).split(':');
    if (p[0] === 'f') { const f = fOf(s, p[1]); const Kd = f && P.KINDS[f.k]; const sl = Kd && Kd.slots[+p[2]]; if (!sl) return null; return { p: P.local(f, sl[0], sl[1], sl[2]), ry: P.dirs(f.r).a, type: sl[3], f, fid: p[1] }; }
    if (p[0] === 'dl') { const q = W.truckSlot(+p[1]); return q ? { p: q, ry: 0 } : null; }
    if (p[0] === 'seat') { const q = W.seatPlate(s, +p[1]); return q ? { p: q, ry: 0 } : null; }
    return null;
  }
  W.slotWorld = slotWorld;
  // トラックの荷台の中の段ボールの位置（後ろの扉から近い順に 2列×3段×2層）
  const TRUCK_SLOTS = []; for (let j = 0; j < 12; j++) { const layer = Math.floor(j / 6), k = j % 6; TRUCK_SLOTS.push([(k % 2 ? 0.46 : -0.46), 0.68 + layer * 0.36, -2.42 + Math.floor(k / 2) * 0.56]); }
  TRUCK_SLOTS.push([-0.55, 0.68, -0.55], [0.55, 0.68, -0.55], [0, 1.5, -0.55]); // 家具の大きな段ボール（12〜14）：走っている間は荷台の奥
  const TRUCK_GROUND = [[1.95, 0, -2.25], [1.95, 0, -1.15], [1.95, 0, -0.05]]; // 着いたら運転手さんが荷台の横の地面に下ろしてくれる
  W.truckSlot = function (i) {
    const t = i >= 12 && W.truckParked ? TRUCK_GROUND[i - 12] : TRUCK_SLOTS[i]; if (!t) return null;
    const P0 = W.truck && W.truck.node.vis ? W.truck.node.p : [W.L.truck.x, 0, W.L.truck.z];
    return [P0[0] + t[0], t[1], P0[2] + t[2]];
  };
  // 家具の名前（同じ種類が2つ以上なら番号つき）
  W.fname = function (s, fid) {
    const f = s.fu[fid]; if (!f) return ''; const Kd = P.KINDS[f.k];
    const list = P.list(s, f.k); return Kd.name + (list.length > 1 ? list.indexOf(fid) + 1 : '');
  };

  // =====================================================================
  //  初期化
  // =====================================================================
  W.init = function (host) {
    W.host = host;
    host.innerHTML = '<canvas id="gl3d" aria-label="お店の中"></canvas><div class="labels" id="labels"></div><div class="xhair" id="xhair"></div>';
    const canvas = host.querySelector('canvas');
    // 前のエンジンのテクスチャ・メッシュは使えないので作り直す
    W.T = null; W.bhTex = null; W.lineTex = null; W.lineTex2 = null; W.boardTex = null; W.signTex = null; W.openTex = null; W.blobTex = null; W.blobMesh = null; W.frTex = null; W.csTex = null; W.dockTex = null; W.truckTex = null; W.trayM = null; W.footM = null;
    for (const k in meshCache) delete meshCache[k];
    W.fmesh = {}; W.bowlM = null; W.TT = null;
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
    e.env.light = norm3([0.2, 1.0, 0.34]);
    e.env.sky = [0.62, 0.59, 0.55]; e.env.ground = [0.36, 0.32, 0.28]; e.env.wall = [0.56, 0.53, 0.49]; e.env.sun = [1.38, 1.32, 1.22];
    e.env.fog = rgb('#D7DEE5'); e.env.fogR = [40, 95]; e.env.clear = rgb('#9EBBD6'); e.env.expo = 1.06; e.env.lampR = 0.55;
    W.scene = new Node();
    W.labels = host.querySelector('#labels');
    W.me = { x: 0, z: 0, yaw: 0, pitch: -0.18, vx: 0, vz: 0, bob: 0, speed: 0 };
    W.items = {}; W.others = {}; W.custs = {}; W.staffN = {}; W.fn = {}; W.kb = {}; W.keys = {}; W.lbl = {}; W.alerted = {};
    W.bm = false; W.mv = null; W.hold = null; W.ghost = null; W.up = null;
    GK = ''; W.L = layout(null);
    W.buildStatic();
    W.applyQuality();
    W.me.x = 2.2; W.me.z = CZ - 1.6; W.me.yaw = 0.15;
    W.bindInput(canvas);
    W.ready = true;
    W.last = performance.now();
    return true;
  };
  W.destroy = function () { W.ready = false; W.dying = true; clearTimeout(W._lostT); W.unbind && W.unbind(); if (document.pointerLockElement) document.exitPointerLock(); if (W.eng) { const x = W.eng.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } if (W.host) W.host.innerHTML = ''; };
  // 描画を作り直す（WebGL が落ちた・何度もエラーが出た）。立ち位置と状態はそのまま
  W.recover = function (lower) {
    const host = W.host; if (!host || W.dying) return;
    const me = W.me ? Object.assign({}, W.me) : null, s = W.S, room = W.room, bm = W.bm;
    if (lower && ST.autoQ !== false) { W.qlv = Math.min(3, (W.qlv || 0) + 1); CS.LS.set('cs.qlv', W.qlv); }
    W.unbind && W.unbind();
    W.dying = true; if (W.eng) { try { const x = W.eng.gl.getExtension('WEBGL_lose_context'); if (x && !W.eng.gl.isContextLost()) x.loseContext(); } catch (err) { /* noop */ } }
    if (!W.init(host)) return;
    if (me) Object.assign(W.me, me);
    W.bm = bm;
    if (s) W.sync(s, room);
    if (CS.ui && CS.ui.toast) CS.ui.toast('画面を立て直しました' + (lower ? '（画質を少し下げました）' : ''));
  };
  // 画質：軽量モード、または自動調整の段階（0 標準 → 3 いちばん軽い）
  W.QNAME = ['標準', 'やや軽く', '軽く', 'いちばん軽く'];
  W.applyQuality = function () {
    const e = W.eng; if (!e) return;
    const coarse = G.matchMedia && matchMedia('(pointer: coarse)').matches;
    const q = ST.autoQ === false ? 0 : clamp(W.qlv || 0, 0, 3);
    e.scale = ST.light ? 0.55 : (coarse ? 0.8 : 1) * [1, 0.8, 0.72, 0.62][q];
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
  const MATS = {
    oak: { tex: 'oak', rough: 0.55 }, walnut: { tex: 'walnut', rough: 0.45 }, marble: { tex: 'marble', rough: 0.18 }, steel: { tex: 'steel', rough: 0.32, metal: 1 },
    paint: { rough: 0.6 }, gloss: { rough: 0.22 }, cloth: { rough: 0.9 }, brass: { rough: 0.28, metal: 1 }, plant: { rough: 0.7 }, facade: { tex: 'facade', rough: 0.8 },
  };
  W.obstacles = [];
  // 長方形の集まりから穴（長方形）を抜く [x0, z0, x1, z1]
  W.rectSub = function (rects, holes) {
    let out = rects.slice();
    for (const h of holes) {
      const next = [];
      for (const r of out) {
        if (h[0] >= r[2] || h[2] <= r[0] || h[1] >= r[3] || h[3] <= r[1]) { next.push(r); continue; }
        const x0 = Math.max(r[0], h[0]), x1 = Math.min(r[2], h[2]), z0 = Math.max(r[1], h[1]), z1 = Math.min(r[3], h[3]);
        if (r[0] < x0) next.push([r[0], r[1], x0, r[3]]);
        if (x1 < r[2]) next.push([x1, r[1], r[2], r[3]]);
        if (r[1] < z0) next.push([x0, r[1], x1, z0]);
        if (z1 < r[3]) next.push([x0, z1, x1, r[3]]);
      }
      out = next;
    }
    return out.filter((r) => r[2] - r[0] > 1e-4 && r[3] - r[1] > 1e-4);
  };
  function block(x0, z0, x1, z1) { W.obstacles.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]); }
  // 文字の札（キャンバス）
  function textCard(text, sub, w, h) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const g = cv.getContext('2d');
    g.fillStyle = '#2A2624'; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#C9A35E'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 88);
    g.fillStyle = '#F2EBE1'; g.textAlign = 'center'; g.font = '700 38px "Zen Kaku Gothic New",sans-serif'; g.fillText(text, 128, 52); g.fillStyle = '#C9A35E'; g.font = '600 18px "Zen Kaku Gothic New",sans-serif'; g.fillText(sub, 128, 80);
    return new Node(W.eng.mesh(Geo.card(w || 0.62, h || 0.23), null, { rough: 0.6 }), { tex: W.eng.texFromCanvas(cv, false), cast: false });
  }
  function ledTex(text, temp) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const g = cv.getContext('2d');
    g.fillStyle = '#20262B'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#8FD3FF'; g.font = '700 30px "Zen Kaku Gothic New",sans-serif'; g.textAlign = 'left'; g.fillText(text, 14, 43);
    g.textAlign = 'right'; g.fillStyle = '#9BE08A'; g.font = '700 32px monospace'; g.fillText(temp, 242, 44);
    return W.eng.texFromCanvas(cv, false);
  }
  W.buildStatic = function () {
    const e = W.eng, sc = W.scene, L = W.L, g = L.g;
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
    if (!T.concrete) { T.concrete = e.texFromCanvas(MD.TX.concrete(), true); T.siding = e.texFromCanvas(MD.TX.siding(), true); }
    W.frTex = W.frTex || ledTex('❄ 冷蔵庫', '3℃');
    W.csTex = W.csTex || ledTex('❄ 冷蔵棚', '4℃');
    const BB = {};
    const Pt = (m, gg, p, r, s, color, opt) => { (BB[m] = BB[m] || new Builder()).put(gg, p, r, s, color || [1, 1, 1], Object.assign({ rough: MATS[m].rough, metal: MATS[m].metal || 0 }, opt || {})); };
    W.Pt = Pt;
    // ---------- 外 ----------
    sc.add(new Node(e.mesh(Geo.sphere(90, 24, 12)), { tex: T.sky, em: 1, cast: false, recv: false, twoSide: true }));
    const ground = (gg, tex, p, rough) => { const n = new Node(e.mesh(gg, null, { rough }), { tex, cast: false, ao: 0 }); n.p = p; sc.add(n); };
    ground(Geo.plane(160, 40, 40, 10), T.asphalt, [0, -0.03, RZ + 9], 0.85);
    ground(Geo.plane(90, 5, 22, 1.25), T.walk, [0, -0.01, RZ + 2.5], 0.8);
    ground(Geo.plane(90, 40, 22, 10), T.grass, [0, -0.02, -RZ - 20], 0.95);
    ground(Geo.plane(30, 90, 7, 22), T.walk, [RX + 15.2, -0.015, 0], 0.8);
    // ---------- 床・天井 ----------
    const FZ = CZ + g.counter.d / 2;
    // 床は重ねずに敷く（重なった床は奥でちらつく）：厨房のタイルから、パソコン室・仕切りの前の木の床の所を抜く
    const wood = [[-RX, FZ, RX, RZ], [g.pc.x0, -RZ, g.pc.x1, g.pc.z1]];
    if (g.hall[2] - g.hall[0] >= 0.2 && FZ - g.hall[3] > 0.01) wood.push([g.hall[0], g.hall[3], g.hall[2], FZ]);
    const tiles = W.rectSub([[-RX, -RZ, RX, FZ]], wood.slice(1));
    const floorMesh = (rects, tile, rough) => { const gg = CS.gl.geo(); rects.forEach(([x0, z0, x1, z1]) => CS.gl.quad(gg, [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [[x0 / tile, -z1 / tile], [x1 / tile, -z1 / tile], [x1 / tile, -z0 / tile], [x0 / tile, -z0 / tile]], true)); return e.mesh(gg, null, { rough }); };
    W._floorMesh = floorMesh;
    // 左の歩道（路地のアスファルトの下には敷かない＝重ねない）
    { const n = new Node(floorMesh(W.rectSub([[-RX - 60.2, -45, -RX - 0.2, 45]], [[L.alley[0], -45, -RX + 0.1, RZ]]), 4.3, 0.8), { tex: T.walk, cast: false, ao: 0 }); n.p = [0, -0.015, 0]; sc.add(n); }
    const kf = new Node(floorMesh(tiles, 0.6, 0.4), { tex: T.ktile, cast: false, ao: 0 }); kf.p = [0, 0.001, 0]; sc.add(kf);
    const ff = new Node(floorMesh(wood, 1.2, 0.38), { tex: T.parquet, cast: false, ao: 0 }); ff.p = [0, 0.001, 0]; sc.add(ff);
    Pt('brass', Geo.box(RX * 2, 0.006, 0.04), [0, 0.004, FZ]);
    const ceil = new Node(e.mesh(Geo.plane(RX * 2 + 0.4, RZ * 2 + 0.4, RX, RZ), null, { rough: 0.9 }), { tex: T.ceil, cast: false, ao: 0, r: [PI, 0, 0] }); ceil.p = [0, WH, 0]; sc.add(ceil);
    // ---------- 外の壁（影は落とさない：窓際が暗くならないように） ----------
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
    // 左の壁：倉庫（別棟）への渡り廊下の入口がある
    const lz = g.link.z, lw = g.link.w / 2;
    wall('left', [[-RX - 0.1, WH / 2, (lz - lw - RZ) / 2, 0.2, WH, lz - lw + RZ], [-RX - 0.1, WH / 2, (lz + lw + RZ) / 2, 0.2, WH, RZ - lz - lw], [-RX - 0.1, (WH + 2.1) / 2, lz, 0.2, WH - 2.1, lw * 2]], [[-RX + 0.03, 0.5, (FZ + RZ) / 2, 0.06, 1.0, RZ - FZ]]);
    wall('right', [[RX + 0.1, WH / 2, 0, 0.2, WH, RZ * 2]], [[RX - 0.03, 0.5, (FZ + RZ) / 2, 0.06, 1.0, RZ - FZ]]);
    // 厨房の壁はサブウェイタイル（床から 1.9m）
    { const TB = new Builder(), th = 1.9, tg = { rough: 0.16 };
      [[-RX, g.pc.x0 - 0.07]].forEach(([a, b]) => { TB.put(Geo.box(b - a, th, 0.02, 1), [(a + b) / 2, th / 2, -RZ + 0.012], 0, 1, [1, 1, 1], tg); Pt('steel', Geo.box(b - a, 0.03, 0.035), [(a + b) / 2, th + 0.015, -RZ + 0.02]); });
      [[-RZ, lz - lw], [lz + lw, FZ]].forEach(([a, b]) => { TB.put(Geo.box(0.02, th, b - a, 1), [-RX + 0.012, th / 2, (a + b) / 2], 0, 1, [1, 1, 1], tg); Pt('steel', Geo.box(0.035, 0.03, b - a), [-RX + 0.02, th + 0.015, (a + b) / 2]); });
      const rz0 = g.pc.z1 + 0.07;
      TB.put(Geo.box(0.02, th, FZ - rz0, 1), [RX - 0.012, th / 2, (FZ + rz0) / 2], 0, 1, [1, 1, 1], tg);
      sc.add(new Node(TB.build(e), { tex: T.subway, ao: 0, cast: false }));
      Pt('steel', Geo.box(0.035, 0.03, FZ - rz0), [RX - 0.02, th + 0.015, (FZ + rz0) / 2]);
    }
    // 天井の回り縁
    [[0, -RZ + 0.04, RX * 2, 0.08], [0, RZ - 0.04, RX * 2, 0.08]].forEach(([x, z, w, d]) => Pt('paint', Geo.box(w, 0.09, d), [x, WH - 0.045, z], 0, 1, rgb('#F4F0E9')));
    [-RX + 0.04, RX - 0.04].forEach((x) => Pt('paint', Geo.box(0.08, 0.09, RZ * 2), [x, WH - 0.045, 0], 0, 1, rgb('#F4F0E9')));
    // 渡り廊下の入口の枠（倉庫へ）
    // 枠は開口の角にまたがるように置く（壁の切り口と同じ面にならない＝ちらつかない）
    [lz - lw, lz + lw].forEach((z) => Pt('steel', Geo.box(0.26, 2.13, 0.06), [-RX - 0.1, 1.065, z], 0, 1, rgb('#6E757C')));
    Pt('steel', Geo.box(0.26, 0.06, lw * 2 + 0.06), [-RX - 0.1, 2.12, lz], 0, 1, rgb('#6E757C'));
    block(-RX - 0.2, -RZ - 0.25, -RX, lz - lw); block(-RX - 0.2, lz + lw, -RX, RZ + 0.25);
    block(g.ox, -RZ - 8, RX + 1, -RZ);
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
    // 壁ごしに手が届かないように（照準用）
    W.rayWalls = [[-RX - 0.2, -RZ, -RX, lz - lw], [-RX - 0.2, lz + lw, -RX, RZ], [-RX, RZ, -DW, RZ + 0.2], [DW, RZ, RX, RZ + 0.2]].concat(g.walls);

    W.buildRooms(e, sc, L, Pt, T);
    W.buildStore(e, sc, L, Pt, T);
    W.buildCounter(e, sc, L, Pt, T);
    if (g.hall[2] - g.hall[0] > 0.2) W.rayWalls.push(g.hall);
    // ---------- 売り場 ----------
    const [mbx, mbz] = L.board;
    Pt('walnut', Geo.rbox(0.06, 1.3, 1.9, 0.01), [mbx - 0.04, 1.75, mbz]);
    const plant = (x, z, s2) => { Pt('paint', Geo.cyl(0.2 * s2, 0.15 * s2, 0.4 * s2, 18), [x, 0.2 * s2, z], 0, 1, C.terracotta); for (let i = 0; i < 7; i++) Pt('plant', Geo.sphere(0.12 * s2, 10, 8), [x + Math.sin(i * 2.4) * 0.12 * s2, (0.5 + i * 0.07) * s2, z + Math.cos(i * 2.4) * 0.12 * s2], [i * 0.5, 0, 0.3], [1, 1.6, 0.5], shade(C.leaf, (i % 3) * 0.08)); block(x - 0.25 * s2, z - 0.25 * s2, x + 0.25 * s2, z + 0.25 * s2); };
    plant(-RX + 0.7, RZ - 0.7, 1.2); plant(RX - 0.7, RZ - 0.7, 1.2);
    // 窓ぎわのベンチと、焼き菓子の陳列棚（雰囲気用）
    [-1, 1].forEach((sd) => { const bx0 = sd * (1.9 + (RX - 3.6) / 2), bw2 = RX - 4.6; Pt('oak', Geo.rbox(bw2, 0.06, 0.42, 0.02), [bx0, 0.46, RZ - 0.3], 0, 1, rgb('#C9A174')); Pt('walnut', Geo.box(bw2 - 0.1, 0.43, 0.36), [bx0, 0.215, RZ - 0.3]); Pt('cloth', Geo.rbox(bw2 - 0.1, 0.06, 0.38, 0.03), [bx0, 0.52, RZ - 0.3], 0, 1, rgb('#2F4A3F')); block(bx0 - bw2 / 2, RZ - 0.52, bx0 + bw2 / 2, RZ); });
    { const rx = RX - 0.25, rz = CZ + 3.8; Pt('walnut', Geo.box(0.04, 1.8, 1.6), [rx + 0.18, 0.9, rz]); [0.35, 0.8, 1.25, 1.7].forEach((y, k) => { Pt('walnut', Geo.box(0.38, 0.03, 1.6), [rx, y, rz]); if (k < 3) for (let i = 0; i < 5; i++) Pt('paint', Geo.rbox(0.12, 0.16, 0.2, 0.02), [rx, y + 0.095, rz - 0.6 + i * 0.3], [0, 0.1 * (i % 2), 0], 1, rgb(['#E8D9C4', '#D9C2A3', '#F2E6D8', '#C9A35E', '#E9CFC9'][(i + k) % 5]), { rough: 0.6 }); }); block(rx - 0.2, rz - 0.82, RX, rz + 0.82); }
    // ---------- 天井の照明 ----------
    const LB = new Builder();
    L.lamps.forEach(([x, z]) => {
      if (z < FZ) { Pt('paint', Geo.box(1.25, 0.03, 0.38), [x, WH - 0.015, z], 0, 1, rgb('#E6E3DD')); LB.put(Geo.box(1.15, 0.01, 0.29), [x, WH - 0.034, z], 0, 1, rgb('#FFF8EC')); }
      else { Pt('paint', Geo.cyl(0.17, 0.17, 0.03, 28), [x, WH - 0.015, z], 0, 1, rgb('#E6E3DD')); LB.put(Geo.cyl(0.12, 0.12, 0.01, 28), [x, WH - 0.034, z], 0, 1, rgb('#FFF1D6')); }
    });
    W.buildDetails(e, sc, L, Pt, T, LB);
    sc.add(new Node(LB.build(e), { cast: false, em: 1, recv: false }));
    // ---------- 外：町並み ----------
    W.buildTown(e, sc, T, Pt);
    [[-RX - 7, RZ + 3], [RX + 2.6, RZ + 3], [-RX / 2 - 0.5, RZ + 3], [RX / 2 + 0.5, RZ + 3]].forEach(([x, z]) => { Pt('walnut', Geo.cyl(0.12, 0.16, 2.2, 8), [x, 1.1, z]); for (let k = 0; k < 5; k++) Pt('plant', Geo.sphere(0.8, 10, 8), [x + Math.sin(k * 1.3) * 0.5, 2.4 + (k % 2) * 0.4, z + Math.cos(k * 1.3) * 0.4], 0, [1, 0.85, 1], shade(C.leaf, (k % 3) * 0.1 - 0.05)); });
    W.staticNodes = [];
    for (const m in BB) { const n = new Node(BB[m].build(e), { tex: MATS[m].tex ? T[MATS[m].tex] : null }); sc.add(n); W.staticNodes.push(n); }
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
    W.furnGroup = sc.add(new Node()); W.itemGroup = sc.add(new Node());
    W.decoGroup = sc.add(new Node()); W.people = sc.add(new Node());
    W.blobTex = W.blobTex || e.texFromCanvas(MD.TX.shadow(), false);
    W.blobMesh = W.blobMesh || CS.gl.keep(e.mesh(Geo.plane(1, 1)));
    // 配置モード：置く場所の目印（緑＝置ける／赤＝置けない）
    W.footM = W.footM || CS.gl.keep(e.mesh(Geo.plane(1, 1), '#FFFFFF', { rough: 1 }));
    W.foot = sc.add(new Node(W.footM, { em: 1, op: 0.42, blend: true, cast: false, recv: false, color: rgb('#5BD18B') })); W.foot.vis = false;
    W.buildAlley(e, sc, L, T);
    W.sObs = W.obstacles.slice();
  };
  // 倉庫とパソコン室（壁・ドア・表示）。パソコン室の中は机とパソコン
  W.buildRooms = function (e, sc, L, Pt, T) {
    const g = L.g, WB = new Builder(), TRM = new Builder(), pw = { rough: 0.85 }, trim = { rough: 0.45 };
    // 壁（plan の壁の箱そのまま）
    g.walls.forEach(([x0, z0, x1, z1]) => {
      const w = x1 - x0, d = z1 - z0;
      WB.put(Geo.box(w, WH, d, 1), [(x0 + x1) / 2, WH / 2, (z0 + z1) / 2], 0, 1, [1, 1, 1], pw);
      TRM.put(Geo.box(w + 0.02, 0.1, d + 0.02), [(x0 + x1) / 2, 0.05, (z0 + z1) / 2], 0, 1, C.walnut, trim);
      block(x0, z0, x1, z1);
    });
    // ドアの上の壁と枠
    const th = 0.14;
    [[g.pc.door, g.pc.dw, g.pc.z1]].forEach(([x, w, z]) => {
      WB.put(Geo.box(w, WH - 2.15, th, 1), [x, (WH + 2.15) / 2, z], 0, 1, [1, 1, 1], pw);
      [x - w / 2, x + w / 2].forEach((xx) => TRM.put(Geo.box(0.06, 2.15, th + 0.04), [xx, 1.075, z], 0, 1, C.walnut, trim));
      TRM.put(Geo.box(w + 0.12, 0.06, th + 0.04), [x, 2.15, z], 0, 1, C.walnut, trim);
    });
    sc.add(new Node(WB.build(e), { tex: T.plaster, ao: 0, cast: false }));
    sc.add(new Node(TRM.build(e), { ao: 0 }));
    // 入口の上の表示
    const sign = (text, sub, x, z) => { const n = textCard(text, sub); n.p = [x, 2.42, z]; sc.add(n); };
    sign('パソコン室', 'OFFICE・PC', g.pc.door, g.pc.z1 + th / 2 + 0.012);
    // ---- パソコン室：机とパソコン・本棚・ホワイトボード・観葉植物 ----
    const [bx, bz] = L.desk;
    Pt('walnut', Geo.rbox(1.5, 0.04, 0.7, 0.01), [bx, 0.76, bz]);
    [-1, 1].forEach((s2) => Pt('walnut', Geo.box(0.04, 0.74, 0.65), [bx + s2 * 0.7, 0.37, bz]));
    Pt('gloss', Geo.rbox(0.56, 0.34, 0.04, 0.01), [L.pcScr[0], 1.08, L.pcScr[2] - 0.02], [-0.08, 0, 0], 1, rgb('#1A1A1A'));
    Pt('gloss', Geo.rbox(0.06, 0.16, 0.05, 0.01), [L.pcScr[0], 0.86, L.pcScr[2] - 0.05], 0, 1, rgb('#2A2A2A'));
    Pt('gloss', Geo.rbox(0.42, 0.012, 0.15, 0.004), [L.pcScr[0], 0.785, bz + 0.12], 0, 1, rgb('#2A2A2A'));
    Pt('cloth', Geo.rbox(0.48, 0.07, 0.48, 0.03), [bx, 0.47, bz + 0.7], 0, 1, rgb('#6B4A3A'));
    Pt('cloth', Geo.rbox(0.46, 0.48, 0.07, 0.03), [bx, 0.75, bz + 0.93], 0, 1, rgb('#6B4A3A'));
    block(bx - 0.76, -RZ, bx + 0.76, bz + 0.36);
    W.pcScreen = new Node(e.mesh(Geo.box(0.5, 0.28, 0.005), '#FFFFFF', { rough: 0.2 }), { em: 1, color: rgb('#3E6A8A'), cast: false });
    W.pcScreen.p = [L.pcScr[0], 1.08, L.pcScr[2]]; W.pcScreen.r = [-0.08, 0, 0];
    const px1 = g.pc.x1 >= RX - 1e-6 ? RX : g.pc.x1 - th / 2, px0 = g.pc.x0 + th / 2;
    // 本棚（左の壁ぞい）
    Pt('walnut', Geo.box(0.36, 1.9, 1.5), [px0 + 0.2, 0.95, -RZ + 1.75]);
    [0.4, 0.85, 1.3, 1.75].forEach((y, k) => { for (let i = 0; i < 8; i++) Pt('paint', Geo.box(0.24, 0.26 - (i % 2) * 0.04, 0.05 + (i % 3) * 0.01), [px0 + 0.24, y + 0.14, -RZ + 1.2 + i * 0.16], [(i % 4 === 3 ? 0.15 : 0), 0, 0], 1, rgb(['#7A3B3B', '#2F4A3F', '#C9A35E', '#3F6F93', '#E9DCC9'][(i + k) % 5])); Pt('walnut', Geo.box(0.32, 0.025, 1.42), [px0 + 0.22, y, -RZ + 1.75]); });
    block(px0, -RZ + 0.98, px0 + 0.4, -RZ + 2.52);
    // ホワイトボード（右の壁）
    const wbCv = document.createElement('canvas'); wbCv.width = 512; wbCv.height = 256; { const c = wbCv.getContext('2d'); c.fillStyle = '#FBFBF8'; c.fillRect(0, 0, 512, 256); c.strokeStyle = '#8A8F95'; c.lineWidth = 8; c.strokeRect(0, 0, 512, 256); c.fillStyle = '#2F4A6E'; c.font = '700 34px "Zen Kaku Gothic New",sans-serif'; c.fillText('今日のめあて', 24, 52); c.font = '500 25px "Zen Kaku Gothic New",sans-serif'; c.fillStyle = '#333'; ['・焦がさない！', '・使ったお皿と型はすぐ洗う', '・お釣りはまちがえない', '・要冷蔵はすぐ冷蔵棚へ'].forEach((t, i) => c.fillText(t, 30, 100 + i * 38)); c.strokeStyle = '#C0392B'; c.lineWidth = 4; c.beginPath(); c.moveTo(380, 210); c.lineTo(420, 160); c.lineTo(450, 185); c.lineTo(490, 120); c.stroke(); }
    const wb = new Node(e.mesh(Geo.card(1.5, 0.75), null, { rough: 0.3 }), { tex: e.texFromCanvas(wbCv, false), cast: false }); wb.p = [px1 - 0.012, 1.6, -RZ + 1.7]; wb.r = [0, -PI / 2, 0]; sc.add(wb);
    Pt('steel', Geo.box(0.02, 0.81, 1.56), [px1 - 0.004, 1.6, -RZ + 1.7], 0, 1, rgb('#B9BEC4'));
    Pt('paint', Geo.rbox(0.45, 0.7, 0.55, 0.02), [px1 - 0.3, 0.35, -RZ + 0.4], 0, 1, rgb('#8A8F95'));
    block(px1 - 0.55, -RZ, px1, -RZ + 0.7);
    Pt('paint', Geo.cyl(0.18, 0.14, 0.36, 16), [px1 - 0.35, 0.18, g.pc.z1 - 0.45], 0, 1, C.terracotta);
    for (let i = 0; i < 6; i++) Pt('plant', Geo.sphere(0.12, 10, 8), [px1 - 0.35 + Math.sin(i * 2.4) * 0.1, 0.48 + i * 0.07, g.pc.z1 - 0.45 + Math.cos(i * 2.4) * 0.1], [i * 0.5, 0, 0.3], [1, 1.6, 0.5], shade(C.leaf, (i % 3) * 0.08));
    block(px1 - 0.6, g.pc.z1 - 0.7, px1, g.pc.z1 - 0.2);
  };
  // 倉庫（店の左横に建てた別棟）と渡り廊下。拡張すると建物ごと大きくなる
  W.buildStore = function (e, sc, L, Pt, T) {
    const g = L.g, sd = g.store, lk = g.link, TW = P.WALL, ox = g.ox, DH = 2.12, PH = 2.62;
    const lz = lk.z, lw = lk.w / 2, wt = lk.wt, bz = g.backDoor.z, bw = g.backDoor.w / 2;
    const xr = sd.x1 + TW, zb = sd.z0 - TW, zf = sd.z1 + TW, px1 = -g.RX - TW;
    // 床（コンクリート）：倉庫・渡り廊下・裏口の敷居
    const fl = new Node(W._floorMesh([[sd.x0, sd.z0, sd.x1, sd.z1], [sd.x1, lz - lw, -g.RX, lz + lw], [ox, bz - bw, sd.x0, bz + bw]], 1.5, 0.6), { tex: T.concrete, cast: false, ao: 0 }); fl.p = [0, 0.001, 0]; sc.add(fl);
    // 天井（倉庫・渡り廊下）
    const ceil = (x0, z0, x1, z1, y) => { const n = new Node(e.mesh(Geo.plane(x1 - x0, z1 - z0, (x1 - x0) / 2, (z1 - z0) / 2), null, { rough: 0.9 }), { tex: T.ceil, cast: false, ao: 0, r: [PI, 0, 0] }); n.p = [(x0 + x1) / 2, y, (z0 + z1) / 2]; sc.add(n); };
    ceil(ox, zb, xr, zf, WH); // 渡り廊下は屋根の板の裏がそのまま天井（同じ高さに2枚重ねない）
    // 外壁（波板）。[x0, z0, x1, z1, y0, y1]
    const parts = [
      [ox, zb, xr, sd.z0, 0, WH], [ox, sd.z1, xr, zf, 0, WH],
      [ox, sd.z0, sd.x0, bz - bw, 0, WH], [ox, bz + bw, sd.x0, sd.z1, 0, WH], [ox, bz - bw, sd.x0, bz + bw, DH + 0.02, WH],
      [sd.x1, sd.z0, xr, lz - lw, 0, WH], [sd.x1, lz + lw, xr, sd.z1, 0, WH], [sd.x1, lz - lw, xr, lz + lw, DH + 0.02, WH],
      // 渡り廊下の両側の壁（低め）
      [xr, lz - lw - wt, px1, lz - lw, 0, PH], [xr, lz + lw, px1, lz + lw + wt, 0, PH],
    ];
    const WB = new Builder(), CAP = new Builder(), cap = rgb('#59615D');
    parts.forEach(([x0, z0, x1, z1, y0, y1]) => {
      WB.put(Geo.box(x1 - x0, y1 - y0, z1 - z0, 1), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], 0, 1, [1, 1, 1], { rough: 0.55 });
      if (y0 === 0) { CAP.put(Geo.box(x1 - x0 + 0.04, 0.12, z1 - z0 + 0.04), [(x0 + x1) / 2, 0.06, (z0 + z1) / 2], 0, 1, rgb('#3E4441'), { rough: 0.6 }); block(x0, z0, x1, z1); W.rayWalls.push([x0, z0, x1, z1]); }
    });
    // 屋根のふち（笠木）と渡り廊下の屋根
    [[ox - 0.04, zb - 0.04, xr + 0.04, zf + 0.04]].forEach(([x0, z0, x1, z1]) => {
      CAP.put(Geo.box(x1 - x0, 0.1, 0.24), [(x0 + x1) / 2, WH + 0.05, z0 + 0.12], 0, 1, cap, { rough: 0.5 });
      CAP.put(Geo.box(x1 - x0, 0.1, 0.24), [(x0 + x1) / 2, WH + 0.05, z1 - 0.12], 0, 1, cap, { rough: 0.5 });
      CAP.put(Geo.box(0.24, 0.1, z1 - z0), [x0 + 0.12, WH + 0.05, (z0 + z1) / 2], 0, 1, cap, { rough: 0.5 });
      CAP.put(Geo.box(0.24, 0.1, z1 - z0), [x1 - 0.12, WH + 0.05, (z0 + z1) / 2], 0, 1, cap, { rough: 0.5 });
    });
    CAP.put(Geo.box(px1 - xr, 0.12, lk.w + 2 * wt + 0.3), [(xr + px1) / 2, PH + 0.06, lz], 0, 1, rgb('#C9CFCB'), { rough: 0.6 });
    sc.add(new Node(WB.build(e), { tex: T.siding, ao: 0, cast: false }));
    sc.add(new Node(CAP.build(e), { ao: 0, cast: false }));
    // 渡り廊下の入口（倉庫側）の枠と、裏口の開けっぱなしの鉄の扉
    const steel = rgb('#6E757C');
    // 枠は開口の角にまたがるように置く（壁の切り口と同じ面にならない＝ちらつかない）
    [lz - lw, lz + lw].forEach((z) => Pt('steel', Geo.box(TW + 0.06, DH, 0.06), [sd.x1 + TW / 2, DH / 2, z], 0, 1, steel));
    Pt('steel', Geo.box(TW + 0.06, 0.06, lw * 2 + 0.06), [sd.x1 + TW / 2, DH, lz], 0, 1, steel);
    [bz - bw, bz + bw].forEach((z) => Pt('steel', Geo.box(TW + 0.06, DH, 0.06), [ox + TW / 2, DH / 2, z], 0, 1, steel));
    Pt('steel', Geo.box(TW + 0.06, 0.06, bw * 2 + 0.06), [ox + TW / 2, DH, bz], 0, 1, steel);
    // 裏口は巻き上げたシャッター（上の箱と両わきのレール）
    Pt('steel', Geo.box(0.26, 0.34, bw * 2 + 0.3), [ox - 0.13, DH + 0.2, bz], 0, 1, rgb('#9AA2A6'));
    Pt('steel', Geo.box(0.28, 0.03, bw * 2 + 0.34), [ox - 0.14, DH + 0.03, bz], 0, 1, rgb('#6E757C'));
    [bz - bw - 0.09, bz + bw + 0.09].forEach((z) => Pt('steel', Geo.box(0.07, DH + 0.02, 0.09), [ox - 0.035, (DH + 0.02) / 2, z], 0, 1, rgb('#8E959C')));
    // 看板：外（路地側・正面側）と中（厨房から倉庫へ／倉庫からお店へ）
    const board = (text, sub, w, h, p, ry) => { const n = textCard(text, sub, w, h); n.p = p; n.r = [0, ry, 0]; sc.add(n); };
    board('倉庫', 'STORAGE', 1.5, 0.56, [ox - 0.012, 2.72, bz + bw + 1.3], -PI / 2);
    board('倉庫', 'STORAGE', 1.5, 0.56, [(ox + xr) / 2, 2.6, zf + 0.012], 0);
    board('倉庫', 'STORAGE →', 0.62, 0.23, [-g.RX + 0.012, 2.42, lz], PI / 2);
    board('お店へ', 'TO KITCHEN →', 0.62, 0.23, [sd.x1 - 0.012, 2.42, lz], -PI / 2);
    // 中：壁ぞいの配管と、床の黄色い線（通路の目安）
    Pt('steel', Geo.cyl(0.03, 0.03, sd.x1 - sd.x0, 8), [(sd.x0 + sd.x1) / 2, WH - 0.25, sd.z0 + 0.12], [0, 0, PI / 2], 1, rgb('#9AA0A6'));
    const YB = new Builder(), yl = rgb('#E2B93B');
    [lz - lw, lz + lw].forEach((z) => YB.put(Geo.box(1.3, 0.004, 0.06), [sd.x1 - 0.65, 0.004, z], 0, 1, yl));
    [bz - bw, bz + bw].forEach((z) => YB.put(Geo.box(1.3, 0.004, 0.06), [sd.x0 + 0.65, 0.004, z], 0, 1, yl));
    sc.add(new Node(YB.build(e), { cast: false, ao: 0 }));
  };
  // カウンター（売り場との境目。右の端は通路）
  W.buildCounter = function (e, sc, L, Pt) {
    const c = L.g.counter, w = c.x1 - c.x0, cx = (c.x0 + c.x1) / 2, z = c.z;
    // 厨房側は開いている（中に箱入れなどを置ける）。売り場側の前板・両端・底板・天板
    const zf = z + c.d / 2 - 0.03, zb = z - c.d / 2 + 0.03;
    Pt('walnut', Geo.rbox(w, 0.86, 0.08, 0.02), [cx, 0.43, zf - 0.04]);
    [c.x0 + 0.03, c.x1 - 0.03].forEach((x) => Pt('walnut', Geo.box(0.06, 0.86, zf - zb), [x, 0.43, (zf + zb) / 2]));
    Pt('walnut', Geo.box(w - 0.08, 0.06, zf - zb), [cx, 0.03, (zf + zb) / 2], 0, 1, rgb('#5A3A28'));
    Pt('walnut', Geo.box(w - 0.08, 0.07, 0.05), [cx, CT - 0.075, zb + 0.025]);
    Pt('marble', Geo.rbox(w + 0.04, 0.04, c.d + 0.02, 0.012), [cx, CT - 0.02, z]);
    const np = Math.max(1, Math.round(w / 1.05));
    for (let i = 0; i < np; i++) Pt('oak', Geo.rbox(w / np - 0.1, 0.56, 0.02, 0.008), [c.x0 + (i + 0.5) * (w / np), 0.46, z + c.d / 2 - 0.02]);
    Pt('brass', Geo.box(w, 0.03, 0.02), [cx, 0.08, z + c.d / 2 - 0.01]);
    Pt('brass', Geo.cyl(0.018, 0.018, w, 10), [cx, 0.16, z + c.d / 2 + 0.1], [0, 0, PI / 2]);
    block(c.x0, z - c.d / 2, c.x1, z + c.d / 2);
    // 厨房と売り場の仕切りの壁（カウンターの左）。売り場側は腰板と絵、厨房側はタイル
    const h = L.g.hall, T = W.T; if (h[2] - h[0] < 0.2) return;
    const hw = h[2] - h[0], hx = (h[0] + h[2]) / 2, hz = (h[1] + h[3]) / 2, hd = h[3] - h[1];
    const WB = new Builder(); WB.put(Geo.box(hw, WH, hd, 1), [hx, WH / 2, hz], 0, 1, [1, 1, 1], { rough: 0.85 });
    sc.add(new Node(WB.build(e), { tex: T.plaster, ao: 0, cast: false }));
    const PB = new Builder(); PB.put(Geo.box(hw, 1.0, 0.03, 1), [hx, 0.5, h[3] + 0.015], 0, 1, [1, 1, 1], { rough: 0.5 });
    sc.add(new Node(PB.build(e), { tex: T.panel, ao: 0, cast: false }));
    Pt('paint', Geo.box(hw, 0.05, 0.06), [hx, 1.02, h[3] + 0.03], 0, 1, rgb('#F7F3EC'));
    Pt('walnut', Geo.box(hw, 0.1, 0.05), [hx, 0.05, h[3] + 0.025]);
    const TB = new Builder(); TB.put(Geo.box(hw, 1.9, 0.02, 1), [hx, 0.95, h[1] - 0.01], 0, 1, [1, 1, 1], { rough: 0.16 });
    sc.add(new Node(TB.build(e), { tex: T.subway, ao: 0, cast: false }));
    Pt('walnut', Geo.box(0.06, WH, hd + 0.04), [h[2], WH / 2, hz]);
    // 売り場の床（仕切りの前）は buildStatic でほかの床といっしょに敷く（重ねるとちらつくため）
    // 絵（売り場側）
    const AB = new Builder(), n = Math.max(1, Math.floor(hw / 2.6));
    for (let i = 0; i < n; i++) { const x = h[0] + (hw / n) * (i + 0.5); Pt('walnut', Geo.rbox(1.02, 0.82, 0.05, 0.01), [x, 1.85, h[3] + 0.025]); AB.put(Geo.card(0.9, 0.7), [x, 1.85, h[3] + 0.052], 0, 1, [1, 1, 1], { rough: 0.8 }); }
    sc.add(new Node(AB.build(e), { tex: T.art[1], cast: false }));
    block(h[0], h[1], h[2], h[3]);
  };
  // 雰囲気を出す細部（ペンダント照明・絵・時計・外の街灯など）
  W.buildDetails = function (e, sc, L, Pt, T, LB) {
    const g = L.g;
    // ペンダント照明（カウンターの上）
    const PD = new Builder(), brass = { rough: 0.28, metal: 1 };
    const pend = (x, z, y) => {
      PD.put(Geo.cyl(0.006, 0.006, WH - y - 0.15, 6), [x, (WH + y + 0.15) / 2, z], 0, 1, C.dark, { rough: 0.5 });
      PD.put(Geo.cyl(0.045, 0.2, 0.2, 28, 0, PI * 2, true), [x, y + 0.03, z], 0, 1, rgb('#B88A4A'), brass);
      PD.put(Geo.cyl(0.035, 0.035, 0.06, 12), [x, y + 0.15, z], 0, 1, rgb('#B88A4A'), brass);
      LB.put(Geo.sphere(0.055, 14, 10), [x, y - 0.02, z], 0, 1, rgb('#FFE6B5'));
    };
    for (let x = g.counter.x0 + 1.3; x < g.counter.x1 - 0.5; x += 2.3) pend(x, CZ + 0.05, 2.3);
    sc.add(new Node(PD.build(e), { twoSide: true, cast: false }));
    // 壁の絵（売り場）と時計
    const AB = [new Builder(), new Builder(), new Builder()];
    const art = (x, z, k, w, h) => {
      Pt('walnut', Geo.rbox(0.05, h + 0.12, w + 0.12, 0.01), [x, 1.85, z]);
      AB[k].put(Geo.card(w, h), [x + (x < 0 ? 0.03 : -0.03), 1.85, z], [0, x < 0 ? PI / 2 : -PI / 2, 0], 1, [1, 1, 1], { rough: 0.8 });
    };
    art(-RX + 0.03, CZ + 4.3, 0, 0.9, 0.7);
    art(-RX + 0.03, CZ + 6.4, 1, 0.7, 0.9);
    if (CZ + 6.2 < RZ - 1) art(RX - 0.03, CZ + 6.2, 2, 0.9, 0.7);
    AB.forEach((b, k) => { if (!b.empty()) sc.add(new Node(b.build(e), { tex: T.art[k], cast: false })); });
    {
      const cz = CZ + 1.6, cx = RX - 0.04;
      Pt('paint', Geo.cyl(0.25, 0.25, 0.04, 36), [cx, 2.4, cz], [0, 0, PI / 2], 1, C.dark);
      const face = new Node(e.mesh(Geo.card(0.44, 0.44), null, { rough: 0.5 }), { tex: T.clock, cast: false }); face.p = [cx - 0.025, 2.4, cz]; face.r = [0, -PI / 2, 0]; sc.add(face);
      Pt('paint', Geo.box(0.006, 0.12, 0.018), [cx - 0.03, 2.45, cz - 0.02], [0.6, 0, 0], 1, C.dark);
      Pt('paint', Geo.box(0.006, 0.17, 0.012), [cx - 0.032, 2.47, cz + 0.05], [-1.05, 0, 0], 1, C.dark);
    }
    // 空調の吹き出し口（売り場の天井）
    [[-3.2, CZ + 4.6], [5.2, CZ + 3.4]].forEach(([x, z]) => {
      Pt('paint', Geo.box(0.8, 0.05, 0.8), [x, WH - 0.025, z], 0, 1, rgb('#F2F0EC'));
      for (let k = 0; k < 5; k++) Pt('paint', Geo.box(0.62, 0.012, 0.02), [x, WH - 0.054, z - 0.24 + k * 0.12], 0, 1, rgb('#CFCBC4'));
    });
    // 倉庫の裏口の非常口の表示・渡り廊下の入口の横の消火器
    const bd = L.backDoor[1];
    LB.put(Geo.box(0.04, 0.14, 0.36), [g.store.x0 + 0.04, 2.35, bd], 0, 1, rgb('#2FBF71'));
    const ex = -RX + 0.13, ez = g.link.z + g.link.w / 2 + 0.45;
    Pt('gloss', Geo.cyl(0.07, 0.07, 0.48, 16), [ex, 1.15, ez], 0, 1, rgb('#C21F24'), { rough: 0.25 });
    Pt('paint', Geo.cyl(0.03, 0.03, 0.08, 10), [ex, 1.43, ez], 0, 1, C.dark);
    Pt('steel', Geo.box(0.06, 0.04, 0.16), [ex - 0.03, 0.9, ez], 0, 1, rgb('#8E959C'));
    // 外：街灯・花のプランター
    const OB = new Builder(), iron = { rough: 0.4, metal: 0.6 };
    [-(RX - 1.2), RX - 1.2].forEach((x) => {
      Pt('paint', Geo.cyl(0.05, 0.07, 3.3, 10), [x, 1.65, RZ + 3.7], 0, 1, rgb('#2B3330'), iron);
      Pt('paint', Geo.cyl(0.16, 0.1, 0.3, 12), [x, 3.35, RZ + 3.7], 0, 1, rgb('#2B3330'), iron);
      OB.put(Geo.cyl(0.11, 0.11, 0.16, 12), [x, 3.15, RZ + 3.7], 0, 1, rgb('#FFF0D0'));
    });
    const flower = ['#E36A7E', '#F2D16B', '#F4F1EC'];
    [-1.6, 1.6].forEach((x) => {
      Pt('walnut', Geo.box(0.7, 0.42, 0.34), [x, 0.21, RZ + 0.42]);
      for (let k = 0; k < 10; k++) Pt('plant', Geo.sphere(0.07, 8, 6), [x - 0.27 + (k % 5) * 0.135, 0.5 + (k % 2) * 0.05, RZ + 0.36 + Math.floor(k / 5) * 0.12], 0, 1, k % 2 ? shade(C.leaf, 0.1) : rgb(flower[(k / 2) % 3]));
      block(x - 0.36, RZ + 0.24, x + 0.36, RZ + 0.6);
    });
    sc.add(new Node(OB.build(e), { em: 1, cast: false, recv: false }));
  };
  // =====================================================================
  //  町の風景（向かいの商店街・道路・電柱・車・歩く人。店の外には出なくても窓から見える）
  // =====================================================================
  function cvs(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
  const TOWN_SIGNS = [['ベーカリー こむぎ', '#7A4A2A', '#FBEFD9'], ['花屋 フローラ', '#3F7A4E', '#FFFFFF'], ['本屋 しおり堂', '#2F3E4E', '#F2EBE1'], ['カフェ こもれび', '#C9A35E', '#2A2624'], ['クリーニング', '#3F6F93', '#FFFFFF'], ['ドラッグストア', '#C0392B', '#FFFFFF'], ['ラーメン 一番', '#2A2624', '#F2D16B'], ['八百屋 みどり', '#6E9B3A', '#FFFFFF']];
  function townTextures(e) {
    if (W.TT) return W.TT;
    // 窓（2×2 区画 = 6m 四方。建物ごとに色を掛ける）
    const win = cvs(512, 512, (g) => {
      g.fillStyle = '#ECE8E1'; g.fillRect(0, 0, 512, 512);
      for (let k = 0; k < 1800; k++) { g.fillStyle = 'rgba(0,0,0,' + Math.random() * 0.04 + ')'; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
      for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
        const x = bx * 256 + 52, y = by * 256 + 50, w = 152, h = 128;
        g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, by * 256 + 250, 512, 6);
        g.fillStyle = '#4A4F55'; g.fillRect(x - 6, y - 6, w + 12, h + 12);
        const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, '#5E7C94'); gr.addColorStop(0.5, '#9FBBD0'); gr.addColorStop(1, '#4F6A80'); g.fillStyle = gr; g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(x + 20, y + h); g.lineTo(x + 70, y); g.lineTo(x + 95, y); g.lineTo(x + 45, y + h); g.fill();
        if ((bx + by * 2) % 3 === 1) { g.fillStyle = ['#E9D9B5', '#D9B8B0', '#C9D6C0'][(bx + by) % 3]; g.fillRect(x, y, 40, h); g.fillRect(x + w - 40, y, 40, h); }
        g.fillStyle = '#4A4F55'; g.fillRect(x + w / 2 - 3, y, 6, h);
        g.fillStyle = '#D8D3CA'; g.fillRect(x - 10, y + h + 6, w + 20, 8);
        if ((bx + by) % 2 === 0) { g.fillStyle = 'rgba(60,60,60,.6)'; for (let k = 0; k < 9; k++) g.fillRect(x - 14 + k * 21, y + h + 20, 4, 46); g.fillRect(x - 18, y + h + 18, w + 36, 6); }
      }
    });
    // 1階のお店の正面（ガラス・扉・陳列）
    const front = cvs(512, 256, (g) => {
      g.fillStyle = '#3A3430'; g.fillRect(0, 0, 512, 256);
      const gr = g.createLinearGradient(0, 60, 0, 256); gr.addColorStop(0, '#8FA9BC'); gr.addColorStop(1, '#3E4E5A'); g.fillStyle = gr; g.fillRect(12, 60, 488, 184);
      g.fillStyle = 'rgba(255,240,200,.55)'; g.fillRect(12, 60, 488, 30);
      for (let k = 0; k < 14; k++) { g.fillStyle = ['#E8C38A', '#D46A7A', '#F2D16B', '#9FC5E8', '#E9DCC9'][k % 5]; g.fillRect(30 + k * 26, 170 + (k % 3) * 8, 18, 40 - (k % 3) * 8); }
      g.fillStyle = '#2A2624'; g.fillRect(12, 214, 488, 6); g.fillRect(340, 60, 6, 184); g.fillRect(420, 60, 6, 184);
      g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(60, 244); g.lineTo(140, 60); g.lineTo(175, 60); g.lineTo(95, 244); g.fill();
      g.fillStyle = '#C9A35E'; g.fillRect(380, 140, 4, 30);
    });
    // 看板（8枚を1枚の画像に）
    const signs = cvs(512, 1024, (g) => {
      TOWN_SIGNS.forEach(([t, bg, fg], i) => { const y = i * 128; g.fillStyle = bg; g.fillRect(0, y, 512, 128); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 6; g.strokeRect(8, y + 8, 496, 112); g.fillStyle = fg; g.textAlign = 'center'; g.font = '700 58px "Zen Kaku Gothic New",sans-serif'; g.fillText(t, 256, y + 84); });
    });
    W.TT = { win: e.texFromCanvas(win, true), front: e.texFromCanvas(front, true), signs: e.texFromCanvas(signs, false) };
    return W.TT;
  }
  // 看板の1行ぶんを使う板
  function signCard(w, h, k) { const v0 = 1 - (k + 1) / 8, v1 = 1 - k / 8; return CS.gl.quad(CS.gl.geo(), [-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0], [0, 0, 1], [[0, v0], [1, v0], [1, v1], [0, v1]]); }
  W.buildTown = function (e, sc, T, Pt) {
    const TT = townTextures(e);
    let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const WB = new Builder(), FB = new Builder(), SB = new Builder(), DB = new Builder(), GB = new Builder(), LB2 = new Builder();
    const WALL = ['#E8DCC8', '#CFC3B0', '#B9A48C', '#D8D2C8', '#A9B4AE', '#C9B8A6', '#E4D6D0', '#B7AFA5', '#D9C9A8', '#C4CCD2'];
    const AWN = ['#2F4A3F', '#7A1F2B', '#C9A35E', '#3F6F93', '#B86B4B', '#4E7A43'];
    const stuff = { rough: 0.8 }, metal = { rough: 0.4, metal: 0.6 };
    // 建物：front＝通りに面した側の z、dir＝正面の向き（+1 なら +z 向き、-1 なら -z 向き）
    const building = (x, zf, w, d, floors, dir, shop, k) => {
      const H = 3.6 + floors * 3, col = rgb(WALL[k % WALL.length]), zc = zf + dir * -d / 2;
      WB.put(Geo.box(w, H - 3.6, d, 1 / 6), [x, 3.6 + (H - 3.6) / 2, zc], 0, 1, col, stuff);
      if (shop) {
        FB.put(Geo.box(w - 0.2, 3.6, d - 0.4, 1 / 6), [x, 1.8, zc - dir * 0.2], 0, 1, [1, 1, 1], { rough: 0.3 });
        const ac = rgb(AWN[k % AWN.length]);
        DB.put(Geo.box(Math.min(w - 0.6, 6.5), 0.06, 1.3), [x, 3.25, zf + dir * 0.55], [dir * 0.35, 0, 0], 1, ac, stuff);
        DB.put(Geo.box(Math.min(w - 0.6, 6.5), 0.3, 0.04), [x, 3.0, zf + dir * 1.15], 0, 1, ac, stuff);
        SB.put(signCard(Math.min(w - 1, 4.2), 0.75, k % 8), [x, 4.15, zf + dir * 0.03], [0, dir > 0 ? 0 : PI, 0], 1, [1, 1, 1], { rough: 0.6 });
        DB.put(Geo.box(Math.min(w - 1, 4.2) + 0.12, 0.87, 0.05), [x, 4.15, zf - dir * 0.0], 0, 1, rgb('#2A2624'), stuff);
      } else WB.put(Geo.box(w, 3.6, d, 1 / 6), [x, 1.8, zc], 0, 1, shade(col, -0.08), stuff);
      DB.put(Geo.box(w + 0.1, 0.45, d + 0.1), [x, H + 0.22, zc], 0, 1, shade(col, -0.18), stuff);
      DB.put(Geo.box(w - 0.4, 0.06, d - 0.4), [x, H + 0.03, zc], 0, 1, rgb('#6E6A64'), stuff);
      if (floors >= 2 && rnd() < 0.7) { DB.put(Geo.box(1.4, 1.0, 1.0), [x - w / 4, H + 0.5, zc], 0, 1, rgb('#9AA0A6'), metal); DB.put(Geo.cyl(0.6, 0.6, 1.4, 12), [x + w / 4, H + 1.2, zc + 1], 0, 1, rgb('#C7CBD0'), metal); DB.put(Geo.box(0.1, 0.8, 0.1), [x + w / 4, H + 0.4, zc + 1], 0, 1, rgb('#6E757C'), metal); }
    };
    // ---------- 道路・歩道 ----------
    const RZ1 = RZ + 5, RZ2 = RZ + 13, RZ3 = RZ + 17;
    GB.put(Geo.box(200, 0.15, 0.22), [0, 0.075, RZ1], 0, 1, rgb('#BDB8AF'), stuff);
    GB.put(Geo.box(200, 0.15, 0.22), [0, 0.075, RZ2], 0, 1, rgb('#BDB8AF'), stuff);
    const fw = new Node(e.mesh(Geo.plane(200, RZ3 - RZ2, 50, (RZ3 - RZ2) / 4), null, { rough: 0.8 }), { tex: T.walk, cast: false, ao: 0 }); fw.p = [0, 0.01, (RZ2 + RZ3) / 2]; sc.add(fw);
    [RZ1 + 0.35, RZ2 - 0.35].forEach((z) => GB.put(Geo.box(200, 0.004, 0.12), [0, 0.004, z], 0, 1, rgb('#E9E6DF'), stuff));
    for (let x = -96; x < 96; x += 6) if (Math.abs(x) > 4) GB.put(Geo.box(3, 0.004, 0.12), [x, 0.004, (RZ1 + RZ2) / 2], 0, 1, rgb('#E9E6DF'), stuff);
    for (let x = -3.15; x <= 3.2; x += 0.9) GB.put(Geo.box(0.45, 0.005, RZ2 - RZ1 - 0.9), [x, 0.005, (RZ1 + RZ2) / 2], 0, 1, rgb('#ECE9E2'), stuff);
    // ---------- 向かいの商店街 ----------
    let x = -78, k = 0;
    while (x < 78) { const w = 7 + Math.floor(rnd() * 6); const floors = 1 + Math.floor(rnd() * 4); building(x + w / 2, RZ3, w, 9, floors, -1, true, k++); x += w + 0.15; }
    // 遠くのビル（かすんで見える）
    for (let x2 = -90; x2 < 90; x2 += 14 + rnd() * 8) { const h = 14 + rnd() * 26, w = 9 + rnd() * 8; DB.put(Geo.box(w, h, 10), [x2, h / 2, RZ + 42 + rnd() * 12], 0, 1, mix('#9FB0BE', '#C9D3DA', rnd()), stuff); }
    for (let x2 = -90; x2 < 90; x2 += 16 + rnd() * 10) { const h = 12 + rnd() * 22, w = 10 + rnd() * 8; DB.put(Geo.box(w, h, 10), [x2, h / 2, -RZ - 45 - rnd() * 10], 0, 1, mix('#9FB0BE', '#C9D3DA', rnd()), stuff); }
    // ---------- 店のとなりの建物（右・左） ----------
    building(RX + 0.35 + 3.5, RZ, 7, 2 * RZ + 4, 2, 1, true, 3);
    building(RX + 7.4 + 4.5, RZ - 1, 9, 2 * RZ + 2, 4, 1, true, 5);
    const ax = L0().alley[0] - 0.4;
    building(ax - 4.5, RZ, 9, 2 * RZ + 6, 3, 1, true, 6);
    building(ax - 13.6, RZ - 0.5, 9, 2 * RZ + 4, 1, 1, true, 1);
    building(RX + 21, RZ - 0.5, 10, 2 * RZ, 3, 1, true, 7);
    // 裏（奥の通りの建物）
    for (let x2 = -RX - 6; x2 < RX + 20; x2 += 9.2) building(x2 + 4.5, -RZ - 7, 9, 8, 1 + Math.floor(rnd() * 3), 1, false, 2 + Math.floor(rnd() * 5));
    // ---------- 電柱と電線 ----------
    const poles = [];
    [RZ1 - 0.4, RZ2 + 0.4].forEach((z, side) => { for (let px = -60 + side * 7; px <= 60; px += 15) { if (Math.abs(px) < 3) continue; poles.push([px, z]); } });
    poles.forEach(([px, z]) => {
      DB.put(Geo.cyl(0.13, 0.17, 9.5, 10), [px, 4.75, z], 0, 1, rgb('#A9A59D'), stuff);
      DB.put(Geo.box(1.6, 0.1, 0.1), [px, 8.6, z], 0, 1, rgb('#6E6A64'), stuff); DB.put(Geo.box(1.2, 0.1, 0.1), [px, 7.9, z], 0, 1, rgb('#6E6A64'), stuff);
      if (Math.round(px) % 2 === 0) DB.put(Geo.cyl(0.32, 0.32, 0.9, 10), [px + 0.45, 7.0, z], 0, 1, rgb('#8E959C'), metal);
      DB.put(Geo.box(0.3, 1.0, 0.04), [px, 2.4, z + (z < RZ2 ? 0.17 : -0.17)], 0, 1, rgb('#F2D16B'), stuff);
    });
    [RZ1 - 0.4, RZ2 + 0.4].forEach((z) => [-0.7, 0, 0.7].forEach((dx, wi) => { const y = wi === 1 ? 7.9 : 8.6; DB.put(Geo.cyl(0.012, 0.012, 120, 4), [dx, y - 0.25, z], [0, 0, PI / 2], 1, rgb('#2A2624'), stuff); }));
    // ---------- 自動販売機・バス停・ポスト・自転車 ----------
    [RX + 0.9, RX + 1.75].forEach((vx, i) => { DB.put(Geo.box(0.8, 1.8, 0.7), [vx, 0.9, RZ + 0.45], 0, 1, rgb(i ? '#C0392B' : '#3F6F93'), { rough: 0.35 }); LB2.put(Geo.box(0.62, 0.9, 0.02), [vx, 1.15, RZ + 0.81], 0, 1, rgb('#FFF6E4')); DB.put(Geo.box(0.6, 0.12, 0.05), [vx, 0.45, RZ + 0.81], 0, 1, rgb('#2A2624'), stuff); });
    block(RX + 0.45, RZ, RX + 2.2, RZ + 0.85);
    DB.put(Geo.cyl(0.18, 0.18, 1.0, 14), [-RX + 0.5, 0.5, RZ + 0.5], 0, 1, rgb('#C21F24'), { rough: 0.35 }); DB.put(Geo.sphere(0.18, 14, 8, 0, PI / 2), [-RX + 0.5, 1.0, RZ + 0.5], 0, 1, rgb('#C21F24'), { rough: 0.35 }); block(-RX + 0.28, RZ + 0.28, -RX + 0.72, RZ + 0.72);
    { const bx = 14, bz = RZ2 + 1.6; DB.put(Geo.box(3.4, 0.08, 1.4), [bx, 2.5, bz + 0.2], 0, 1, rgb('#4A4F55'), metal); [-1.6, 1.6].forEach((dx) => DB.put(Geo.box(0.08, 2.5, 0.08), [bx + dx, 1.25, bz + 0.8], 0, 1, rgb('#4A4F55'), metal)); DB.put(Geo.box(3.3, 2.2, 0.04), [bx, 1.3, bz + 0.85], 0, 1, rgb('#BFD8E6'), { rough: 0.1 }); DB.put(Geo.box(2.4, 0.08, 0.4), [bx, 0.45, bz + 0.5], 0, 1, rgb('#8A6142'), stuff); DB.put(Geo.cyl(0.04, 0.04, 2.6, 8), [bx - 2.3, 1.3, bz - 1.0], 0, 1, rgb('#6E757C'), metal); DB.put(Geo.cyl(0.3, 0.3, 0.05, 20), [bx - 2.3, 2.6, bz - 1.0], [PI / 2, 0, 0], 1, rgb('#3F6F93'), stuff); }
    for (let i = 0; i < 4; i++) { const bx = -12 + i * 0.7, bz = RZ2 + 1.0; [-0.42, 0.42].forEach((dz) => DB.put(Geo.torus(0.32, 0.025, 6, 18), [bx, 0.34, bz + dz], [0, PI / 2, 0], 1, rgb('#2A2624'), metal)); DB.put(Geo.box(0.05, 0.05, 0.85), [bx, 0.62, bz], [0.25, 0, 0], 1, rgb(['#C0392B', '#3F6F93', '#E9E6DF', '#4E7A43'][i]), metal); }
    // ---------- 街路樹（向かい側） ----------
    for (let tx = -54; tx <= 54; tx += 12) { if (Math.abs(tx) < 4) continue; DB.put(Geo.cyl(0.12, 0.16, 2.4, 8), [tx, 1.2, RZ2 + 0.9], 0, 1, rgb('#6B4630'), stuff); for (let q = 0; q < 4; q++) DB.put(Geo.sphere(0.85, 10, 8), [tx + Math.sin(q * 1.6) * 0.5, 2.7 + (q % 2) * 0.45, RZ2 + 0.9 + Math.cos(q * 1.6) * 0.4], 0, [1, 0.85, 1], shade(C.leaf, (q % 3) * 0.08 - 0.04), { rough: 0.7 }); }
    const add = (B, o) => { if (!B.empty()) sc.add(new Node(B.build(e), Object.assign({ cast: false }, o || {}))); };
    add(WB, { tex: TT.win }); add(FB, { tex: TT.front }); add(SB, { tex: TT.signs }); add(DB); add(GB); add(LB2, { em: 1, recv: false });
    // ---------- 動くもの（車・歩く人）：軽量モードでは出さない ----------
    W.extras = sc.add(new Node());
    const car = (col) => { const B = new Builder(), gl = { rough: 0.25 }; B.put(Geo.rbox(4.2, 0.75, 1.75, 0.12), [0, 0.6, 0], 0, 1, rgb(col), gl); B.put(Geo.rbox(2.3, 0.6, 1.6, 0.15), [-0.2, 1.22, 0], 0, 1, rgb(col), gl); B.put(Geo.box(2.1, 0.45, 1.62), [-0.2, 1.24, 0], 0, 1, rgb('#22303C'), { rough: 0.05 }); [[-1.3, -0.8], [-1.3, 0.8], [1.3, -0.8], [1.3, 0.8]].forEach(([cx, cz]) => B.put(Geo.cyl(0.33, 0.33, 0.24, 14), [cx, 0.33, cz], [PI / 2, 0, 0], 1, rgb('#1C1C1E'), { rough: 0.8 })); B.put(Geo.box(0.05, 0.12, 1.3), [2.1, 0.7, 0], 0, 1, rgb('#FFF6DD'), gl); return CS.gl.keep(B.build(e)); };
    const cols = ['#C0392B', '#F2F0EB', '#2F4A6E', '#3A3E42', '#E8C38A'];
    W.cars = [];
    [[-20, RZ2 - 1.1, 0, 0], [26, RZ2 - 1.1, PI, 0], [-40, RZ1 + 2.0, 0, 9], [10, RZ1 + 2.0, 0, 7.5], [35, RZ2 - 2.0, PI, -8]].forEach(([cx, cz, ry, v], i) => { const n = W.extras.add(new Node(car(cols[i]), { cast: false })); n.p = [cx, 0, cz]; n.r = [0, ry, 0]; W.cars.push({ n, x: cx, v }); });
    W.peds = [];
    for (let i = 0; i < 5; i++) { const ch = MD.character(e, MD.customerSkin(CS.data.CUSTOMERS[i % CS.data.CUSTOMERS.length].id, i)); W.extras.add(ch.node); const far = i % 2 === 0; W.peds.push({ ch, x: -40 + i * 17, z: far ? RZ2 + 2.6 + (i % 3) * 0.4 : RZ1 - 0.9, v: (i % 3 === 1 ? -1 : 1) * (1.1 + (i % 2) * 0.25) }); }
  };
  const L0 = () => W.L;
  // 車と歩く人を動かす
  W.updateTown = function (dt) {
    if (!W.extras || !W.extras.vis) return;
    for (const c of W.cars || []) { if (!c.v) continue; c.x += c.v * dt; if (c.x > 80) c.x = -80; if (c.x < -80) c.x = 80; c.n.p[0] = c.x; }
    for (const p of W.peds || []) { p.x += p.v * dt; if (p.x > 60) p.x = -60; if (p.x < -60) p.x = 60; p.ch.node.p = [p.x, 0, p.z]; p.ch.node.r = [0, p.v > 0 ? PI / 2 : -PI / 2, 0]; if (Math.abs(p.x - W.me.x) < 30) p.ch.anim(dt, 'walk', 1); }
  };
  // 裏の路地（トラックが材料を届けに来る）
  W.buildAlley = function (e, sc, L, T) {
    const bd = L.backDoor[1], x0 = L.alley[0], len = RZ + 40, ox = L.g.ox + P.WALL; // ox - 0.2 が倉庫の外の壁の面
    { const G = L.g, sd = G.store, lk = G.link, holes = [[G.ox, sd.z0 - P.WALL, sd.x1 + P.WALL, sd.z1 + P.WALL], [sd.x1 + P.WALL, lk.z - lk.w / 2 - lk.wt, -RX - P.WALL, lk.z + lk.w / 2 + lk.wt]];
      const g = new Node(W._floorMesh(W.rectSub([[x0, RZ - len, -RX + 0.1, RZ]], holes), 4, 0.85), { tex: T.asphalt, cast: false, ao: 0 }); g.p = [0, -0.008, 0]; sc.add(g); }
    const B = new Builder(), paint = { rough: 0.7 };
    [L.truck.x - 1.35, L.truck.x + 1.35].forEach((x) => B.put(Geo.box(0.08, 0.004, 5.6), [x, 0.002, L.truck.z], 0, 1, rgb('#E9E6DF'), paint));
    B.put(Geo.box(2.78, 0.004, 0.08), [L.truck.x, 0.002, L.truck.z + 2.8], 0, 1, rgb('#E9E6DF'), paint);
    const wall = new Node(e.mesh(Geo.box(0.3, 2.3, RZ + 30, 1), null, { rough: 0.85 }), { tex: T.facade, cast: false }); wall.p = [x0 - 0.15, 1.15, RZ - (RZ + 30) / 2 - 0.5]; sc.add(wall);
    B.put(Geo.rbox(1.5, 1.05, 0.9, 0.04), [ox - 0.7, 0.55, -RZ - 1.6], [0, PI / 2, 0], 1, rgb('#2F5D44'), { rough: 0.5 }); B.put(Geo.box(0.95, 0.06, 1.55), [ox - 0.7, 1.1, -RZ - 1.6], [0.12, 0, 0], 1, rgb('#244A36'), { rough: 0.5 });
    block(ox - 1.2, -RZ - 2.4, ox - 0.2, -RZ - 0.8);
    for (let k = 0; k < 4; k++) { const y = 0.07 + k * 0.14; for (let i = 0; i < 5; i++) B.put(Geo.box(0.12, 0.025, 1.2), [ox - 0.75 - 0.4 + i * 0.2, y + 0.06, bd + 4.6], 0, 1, rgb('#B08A60'), { rough: 0.8 }); B.put(Geo.box(1.0, 0.1, 0.1), [ox - 0.75, y, bd + 4.1], 0, 1, rgb('#9A7550'), { rough: 0.8 }); B.put(Geo.box(1.0, 0.1, 0.1), [ox - 0.75, y, bd + 5.1], 0, 1, rgb('#9A7550'), { rough: 0.8 }); }
    block(ox - 1.3, bd + 3.95, ox - 0.2, bd + 5.25);
    B.put(Geo.box(0.16, 0.08, 0.3), [ox - 0.28, 2.42, bd + L.g.backDoor.w / 2 + 0.35], 0, 1, rgb('#2A2624'), { rough: 0.4 });
    sc.add(new Node(B.build(e)));
    const lamp = new Node(e.mesh(Geo.box(0.12, 0.03, 0.24), '#FFF1D2'), { em: 1, cast: false, recv: false }); lamp.p = [ox - 0.3, 2.37, bd + L.g.backDoor.w / 2 + 0.35]; sc.add(lamp);
    if (!W.dockCv) { W.dockCv = document.createElement('canvas'); W.dockCv.width = 256; W.dockCv.height = 96; const c = W.dockCv.getContext('2d'); c.fillStyle = '#1F2A24'; c.fillRect(0, 0, 256, 96); c.fillStyle = '#E8D3A6'; c.textAlign = 'center'; c.font = '700 40px "Zen Kaku Gothic New",sans-serif'; c.fillText('搬入口', 128, 52); c.font = '500 18px "Zen Kaku Gothic New",sans-serif'; c.fillText('DELIVERY', 128, 80); }
    W.dockTex = W.dockTex || e.texFromCanvas(W.dockCv, false);
    const sign = new Node(e.mesh(Geo.card(0.75, 0.28), null, { rough: 0.6 }), { tex: W.dockTex, cast: false }); sign.p = [ox - 0.21, 2.72, bd]; sign.r = [0, -PI / 2, 0]; sc.add(sign);
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
    const cz = -0.95, cl = 3.6, cw = 2.24, ch = 2.3, cy0 = 0.62;
    B.put(Geo.box(cw, 0.06, cl), [0, cy0 + 0.03, cz], 0, 1, rgb('#8C7A64'), { rough: 0.8 });
    B.put(Geo.box(cw, 0.06, cl), [0, cy0 + ch - 0.03, cz], 0, 1, white, wall);
    [-1, 1].forEach((sd) => B.put(Geo.box(0.05, ch, cl), [sd * (cw / 2 - 0.025), cy0 + ch / 2, cz], 0, 1, white, wall));
    B.put(Geo.box(cw, ch, 0.05), [0, cy0 + ch / 2, cz + cl / 2 - 0.025], 0, 1, white, wall);
    for (let k = 0; k < 5; k++) [-1, 1].forEach((sd) => B.put(Geo.box(0.02, 0.05, cl - 0.1), [sd * (cw / 2 - 0.06), cy0 + 0.4 + k * 0.38, cz], 0, 1, rgb('#B9B4AC'), gloss));
    B.put(Geo.box(cw + 0.04, 0.08, 0.08), [0, cy0 + ch - 0.04, cz - cl / 2], 0, 1, rgb('#B9B4AC'), gloss);
    B.put(Geo.box(cw + 0.04, 0.1, 0.1), [0, cy0 - 0.02, cz - cl / 2], 0, 1, rgb('#3A3E42'), { rough: 0.4, metal: 0.6 });
    B.put(Geo.rbox(2.12, 1.55, 1.55, 0.14), [0, 1.36, 1.85], 0, 1, rgb('#2F6E9E'), gloss);
    B.put(Geo.rbox(2.0, 0.55, 1.2, 0.1), [0, 2.18, 1.72], 0, 1, rgb('#2F6E9E'), gloss);
    B.put(Geo.box(1.86, 0.62, 0.04), [0, 1.88, 2.56], [-0.18, 0, 0], 1, rgb('#1B2530'), { rough: 0.05 });
    [-1, 1].forEach((sd) => { B.put(Geo.box(0.04, 0.5, 0.75), [sd * 1.065, 1.93, 1.95], 0, 1, rgb('#1B2530'), { rough: 0.05 }); B.put(Geo.box(0.06, 0.2, 0.14), [sd * 1.15, 1.88, 2.45], 0, 1, rgb('#2A2624'), gloss); });
    B.put(Geo.box(2.14, 0.32, 0.12), [0, 0.66, 2.66], 0, 1, rgb('#3A3E42'), { rough: 0.4, metal: 0.6 });
    root.add(new Node(B.build(e)));
    [-1, 1].forEach((sd) => { const side = new Node(e.mesh(Geo.card(3.3, 1.65), null, { rough: 0.5 }), { tex: W.truckTex, cast: false }); side.p = [sd * (cw / 2 + 0.003), cy0 + ch / 2, cz]; side.r = [0, sd * PI / 2, 0]; root.add(side); });
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
    // 床に置いた段ボールにはぶつかる
    for (const id in s.k.items) { const it = s.k.items[id]; if (it.at === 'fl') { const b = P.floorBox(it); W.dynBlocks.push([b[0] - 0.02, b[1] - 0.02, b[2] + 0.02, b[3] + 0.02]); } }
    if (!tr) return;
    if (!tk) { tr.node.vis = false; tr.z = null; W.truckParked = false; return; }
    const P0 = W.L.truck; let z, parked = false;
    if (g < tk.at) { const f = clamp(1 - (tk.at - g) / TT.IN, 0, 1); z = P0.z - 42 * Math.pow(1 - f, 2.2); }
    else if (!tk.out || g < tk.out) { z = P0.z; parked = true; }
    else { const f = clamp((g - tk.out) / TT.OUT, 0, 1); z = P0.z + 40 * f * f; }
    tr.node.vis = z < RZ + 16; tr.node.p = [P0.x, 0, z]; W.truckParked = parked;
    if (tr.z !== null) { tr.spin += (z - tr.z) / 0.42; tr.wheels.forEach((w) => (w.r = [tr.spin, 0, 0])); }
    tr.z = z;
    tr.doors.forEach((d) => { d.a = lerp(d.a, parked ? 1.75 : 0, 1 - Math.exp(-dt * 3)); d.hinge.r = [0, d.sd * d.a, 0]; });
    if (Math.abs(z - P0.z) < 7) W.dynBlocks.push([P0.x - 1.15, z - 2.85, P0.x + 1.15, z + 2.75]);
    if (parked && W._truckAt !== tk.at) {
      W._truckAt = tk.at;
      if (Object.values(s.k.items).some((it) => (it.t === 'crate' || it.t === 'fcrate') && String(it.at).startsWith('dl:'))) { CS.sound.play('beep'); CS.ui.toast('トラックが到着！倉庫の裏口から出て、荷台の段ボールを運ぼう', 'good'); }
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

  // =====================================================================
  //  家具のモデル（中心が原点・前が +z。種類ごとに1回だけ作って使い回す）
  // =====================================================================
  const FM = {};
  const island = (m, w, col) => {
    m.put('marble', Geo.rbox(w, 0.05, 0.75, 0.012), [0, 0.885, 0]);
    m.put('paint', Geo.rbox(w - 0.08, 0.82, 0.68, 0.02), [0, 0.43, 0], 0, 1, col);
    for (let i = 0; i < Math.max(1, Math.round(w / 0.9)); i++) m.put('brass', Geo.cyl(0.012, 0.012, 0.12, 8), [-w / 2 + w / (2 * Math.max(1, Math.round(w / 0.9))) * (2 * i + 1), 0.7, 0.35], [0, 0, PI / 2]);
  };
  const steelCounter = (m, w, d) => { m.put('steel', Geo.rbox(w, 0.86, d - 0.03, 0.015), [0, 0.43, 0]); m.put('steel', Geo.rbox(w + 0.02, 0.04, d, 0.01), [0, 0.88, 0]); };
  const pad = (m, x, y, z, w, d) => m.put('paint', Geo.box(w || 0.3, 0.003, d || 0.3), [x, y - 0.0015, z], 0, 1, rgb('#BFC4C8'));
  FM.table = (m) => {
    m.put('steel', Geo.rbox(1.4, 0.04, 0.75, 0.01), [0, 0.88, 0]);
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => m.put('steel', Geo.cyl(0.02, 0.02, 0.86, 8), [sx * 0.65, 0.43, sz * 0.32])));
    m.put('steel', Geo.rbox(1.3, 0.025, 0.64, 0.006), [0, 0.2, 0], 0, 1, rgb('#B9BEC4'));
    P.KINDS.table.slots.forEach((s) => pad(m, s[0], s[1], s[2], 0.6, 0.3));
  };
  FM.shelf = (m) => {
    [0.33, 0.93, 1.53].forEach((y) => { m.put('oak', Geo.box(1.14, 0.03, 0.46), [0, y - 0.015, 0]); m.put('oak', Geo.box(0.014, 0.08, 0.36), [0, y + 0.04, 0.02]); });
    m.put('oak', Geo.box(1.2, 0.03, 0.5), [0, 1.84, 0]);
    [-1, 1].forEach((sx) => m.put('walnut', Geo.box(0.03, 1.85, 0.5), [sx * 0.585, 0.925, 0]));
    m.put('walnut', Geo.box(1.14, 1.8, 0.015), [0, 0.92, -0.24], 0, 1, rgb('#8A6142'));
    m.put('walnut', Geo.box(1.14, 0.12, 0.03), [0, 0.06, 0.22]);
  };
  FM.cshelf = (m) => {
    const w = 1.25, d = 0.62;
    m.put('steel', Geo.box(w, 0.46, d), [0, 0.23, 0], 0, 1, rgb('#B9BEC4'));
    [-1, 1].forEach((sx) => m.put('steel', Geo.box(0.04, 1.95, d), [sx * (w / 2 - 0.02), 0.975, 0], 0, 1, rgb('#D9DCE0')));
    m.put('steel', Geo.box(w, 1.95, 0.04), [0, 0.975, -d / 2 + 0.02], 0, 1, rgb('#E6E9EC'));
    m.put('paint', Geo.box(w, 0.26, d), [0, 1.82, 0], 0, 1, rgb('#2F4A3F'));
    [0.5, 0.97, 1.44].forEach((y) => { m.put('steel', Geo.box(w - 0.08, 0.02, d - 0.1), [0, y - 0.01, -0.03], 0, 1, rgb('#E6E9EC')); m.put('gloss', Geo.box(w - 0.08, 0.05, 0.015), [0, y + 0.015, d / 2 - 0.05], 0, 1, rgb('#9FC5E8'), { rough: 0.1 }); });
    m.put('steel', Geo.box(w - 0.06, 0.04, 0.08), [0, 0.47, d / 2 - 0.05], 0, 1, rgb('#5A5F64'));
    m.led(Geo.box(w - 0.1, 0.015, 0.03), [0, 1.685, d / 2 - 0.08]);
    m.sign(W.csTex, 0.5, 0.125, [0, 1.84, d / 2 + 0.004]);
  };
  FM.fridge = (m) => {
    const w = 1.42, d = 0.74, H = 2.08, hw = w / 2, z0 = -d / 2, z1 = d / 2, th = 0.045;
    const body = rgb('#D6DADE'), inner = rgb('#F4F6F7'), dark = rgb('#3A3F44');
    m.put('steel', Geo.rbox(w, 0.13, d, 0.01), [0, 0.065, 0], 0, 1, rgb('#9AA0A6'));
    m.put('steel', Geo.rbox(w, 0.24, d, 0.01), [0, H - 0.12, 0], 0, 1, body);
    [-1, 1].forEach((sd) => m.put('steel', Geo.box(th, H - 0.37, d), [sd * (hw - th / 2), 0.13 + (H - 0.37) / 2, 0], 0, 1, body));
    m.put('paint', Geo.box(w - th * 2, H - 0.37, 0.02), [0, 0.13 + (H - 0.37) / 2, z0 + 0.03], 0, 1, inner, { rough: 0.35 });
    m.put('paint', Geo.box(w - th * 2, 0.02, d - 0.06), [0, 0.14, 0], 0, 1, inner, { rough: 0.35 });
    [0.5, 0.92, 1.34].forEach((y) => { m.put('steel', Geo.box(w - th * 2 - 0.02, 0.012, d - 0.12), [0, y - 0.006, -0.02], 0, 1, rgb('#C7CBD0')); for (let k = 0; k < 9; k++) m.put('steel', Geo.box(0.006, 0.014, d - 0.12), [-hw + 0.12 + k * ((w - 0.24) / 8), y + 0.002, -0.02], 0, 1, rgb('#AEB3B8')); });
    const fz = z1 + 0.012, dw = hw - th;
    [-1, 1].forEach((sd) => {
      const cx = sd * (dw / 2 + 0.005);
      m.put('steel', Geo.box(dw, 0.05, 0.03), [cx, 0.15, fz], 0, 1, dark); m.put('steel', Geo.box(dw, 0.05, 0.03), [cx, H - 0.265, fz], 0, 1, dark);
      m.put('steel', Geo.box(0.04, H - 0.42, 0.03), [cx - dw / 2 + 0.02, 0.13 + (H - 0.37) / 2, fz], 0, 1, dark); m.put('steel', Geo.box(0.04, H - 0.42, 0.03), [cx + dw / 2 - 0.02, 0.13 + (H - 0.37) / 2, fz], 0, 1, dark);
      m.put('steel', Geo.cyl(0.012, 0.012, 0.62, 10), [sd * 0.07, 1.1, fz + 0.045], 0, 1, rgb('#E1E4E7'));
      [0.82, 1.38].forEach((y) => m.put('steel', Geo.box(0.02, 0.02, 0.05), [sd * 0.07, y, fz + 0.025], 0, 1, rgb('#E1E4E7')));
      m.glass(Geo.box(dw - 0.06, H - 0.48, 0.008), [cx, 0.13 + (H - 0.37) / 2, fz]);
    });
    m.led(Geo.box(w - 0.16, 0.012, 0.03), [0, H - 0.255, z1 - 0.07]);
    m.sign(W.frTex, 0.62, 0.155, [0, H - 0.12, z1 + 0.006]);
  };
  FM.pcase = (m) => {
    const w = 1.5, d = 0.8, gh = 0.4, gy = 0.94 + gh / 2;
    m.put('walnut', Geo.rbox(w, 0.86, d, 0.02), [0, 0.43, 0]);
    [-1, 1].forEach((sz) => m.put('oak', Geo.rbox(w - 0.12, 0.5, 0.02, 0.008), [0, 0.46, sz * (d / 2)]));
    m.put('walnut', Geo.rbox(w, 0.06, d, 0.01), [0, 0.898, 0], 0, 1, rgb('#5A3A28'));
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => m.put('brass', Geo.box(0.025, gh + 0.02, 0.025), [sx * (w / 2 - 0.02), gy, sz * (d / 2 - 0.02)])));
    [-1, 1].forEach((sz) => m.put('brass', Geo.box(w, 0.02, 0.02), [0, 0.94 + gh, sz * (d / 2 - 0.02)]));
    [-1, 1].forEach((sx) => m.put('brass', Geo.box(0.02, 0.02, d), [sx * (w / 2 - 0.02), 0.94 + gh, 0]));
    m.glass(Geo.box(w - 0.04, gh, 0.012), [0, gy, d / 2 - 0.02]); m.glass(Geo.box(w - 0.04, gh, 0.012), [0, gy, -d / 2 + 0.02]);
    [-1, 1].forEach((sx) => m.glass(Geo.box(0.012, gh, d - 0.04), [sx * (w / 2 - 0.02), gy, 0]));
    m.glass(Geo.box(w - 0.04, 0.012, d - 0.04), [0, 0.94 + gh, 0]);
    m.led(Geo.box(w - 0.12, 0.01, 0.03), [0, 0.93 + gh, 0]);
    P.KINDS.pcase.slots.forEach((s) => m.put('gloss', Geo.cyl(0.19, 0.19, 0.012, 32), [s[0], 0.934, s[2]], 0, 1, rgb('#F4F1EC'), { rough: 0.2 }));
    m.put('gloss', Geo.box(w - 0.1, 0.05, 0.012), [0, 0.86, d / 2 + 0.006], 0, 1, rgb('#9FC5E8'), { rough: 0.1 });
  };
  // カウンターのショーケース（3段×3ホール。前はガラス、後ろから出し入れ）
  FM.scase = (m) => {
    const w = 2.3, zb = -0.41, zf = 0.6, y0 = 0.92, top = 1.8, zc = (zb + zf) / 2, d = zf - zb;
    m.put('walnut', Geo.rbox(w, y0, d, 0.02), [0, y0 / 2, zc]);
    const np = 3; for (let i = 0; i < np; i++) m.put('oak', Geo.rbox(w / np - 0.1, 0.56, 0.02, 0.008), [-w / 2 + (i + 0.5) * (w / np), 0.46, zf + 0.01]);
    m.put('brass', Geo.box(w, 0.03, 0.02), [0, 0.08, zf + 0.012]);
    m.put('gloss', Geo.box(w - 0.08, 0.05, 0.012), [0, y0 - 0.05, zf + 0.012], 0, 1, rgb('#9FC5E8'), { rough: 0.1 });
    // 段々の台（前が低く、奥が高い）
    [[0.95, 0.15, 0.5], [1.17, -0.12, 0.15], [1.39, zb + 0.02, -0.12]].forEach(([y, a, b]) => {
      m.put('walnut', Geo.box(w - 0.08, y - y0 + 0.02, b - a), [0, (y + y0) / 2 - 0.01, (a + b) / 2], 0, 1, rgb('#5A3A28'));
      m.put('marble', Geo.box(w - 0.08, 0.012, b - a), [0, y - 0.006, (a + b) / 2]);
      m.led(Geo.box(w - 0.12, 0.01, 0.02), [0, y - 0.03, b + 0.002], '#FFEBC8');
    });
    P.KINDS.scase.slots.forEach((sl) => m.put('gloss', Geo.cyl(0.19, 0.19, 0.012, 32), [sl[0], sl[1] - 0.006 + 0.006, sl[2]], 0, 1, rgb('#F4F1EC'), { rough: 0.2 }));
    // 枠とガラス
    [-1, 1].forEach((sx) => { m.put('brass', Geo.box(0.03, top - y0, 0.03), [sx * (w / 2 - 0.015), (top + y0) / 2, zf - 0.02]); m.put('brass', Geo.box(0.03, top - y0, 0.03), [sx * (w / 2 - 0.015), (top + y0) / 2, zb + 0.02]); m.glass(Geo.box(0.012, top - y0, d - 0.04), [sx * (w / 2 - 0.015), (top + y0) / 2, zc]); });
    m.put('walnut', Geo.box(w + 0.02, 0.07, 0.62), [0, top + 0.035, zb + 0.31]);
    m.led(Geo.box(w - 0.1, 0.01, 0.03), [0, top - 0.005, zb + 0.3], '#FFF1D6');
    m.put('brass', Geo.box(w, 0.025, 0.025), [0, top, zb + 0.6]);
    m.glass(Geo.box(w - 0.04, 0.58, 0.012), [0, y0 + 0.29, zf - 0.02]);
    m.glass(Geo.box(w - 0.04, 0.012, 0.46), [0, 1.5 + 0.15, zf - 0.21], [-0.62, 0, 0]);
    m.put('brass', Geo.box(w, 0.025, 0.025), [0, 1.5, zf - 0.02]);
    // 後ろの引き戸（ガラス・取っ手）
    m.glass(Geo.box(w / 2 - 0.04, top - y0 - 0.08, 0.01), [-w / 4, (top + y0) / 2, zb + 0.01]);
    m.put('steel', Geo.box(0.02, 0.2, 0.03), [-0.15, 1.3, zb - 0.01], 0, 1, rgb('#E1E4E7'));
  };
  FM.pcaseN = (m) => {
    const w = 1.5, d = 0.62;
    m.put('oak', Geo.rbox(w, 0.86, d, 0.02), [0, 0.43, 0], 0, 1, rgb('#C9A174'));
    m.put('walnut', Geo.rbox(w + 0.02, 0.04, d + 0.02, 0.01), [0, 0.88, 0]);
    m.put('walnut', Geo.box(w, 0.35, 0.03), [0, 1.075, -d / 2 + 0.015]);
    m.put('oak', Geo.box(w, 0.025, 0.16), [0, 1.24, -d / 2 + 0.08]);
    for (let k = 0; k < 5; k++) { const x = -0.6 + k * 0.3; m.put('gloss', Geo.cyl(0.045, 0.045, 0.11, 14), [x, 1.31, -d / 2 + 0.08], 0, 1, rgb('#EEF2F4'), { rough: 0.08 }); m.put('paint', Geo.cyl(0.04, 0.04, 0.07, 14), [x, 1.29, -d / 2 + 0.08], 0, 1, rgb(['#C9A35E', '#8B5A3C', '#E9D7B5', '#F3EEE6', '#B88A4A'][k]), { rough: 0.7 }); }
    P.KINDS.pcaseN.slots.forEach((s) => m.put('paint', Geo.rbox(0.38, 0.006, 0.32, 0.01), [s[0], 0.903, s[2]], 0, 1, rgb('#E8DCC8')));
  };
  FM.mixer = (m) => {
    steelCounter(m, 1.4, 0.75);
    const mc = rgb('#9C2F3A'), mx = -0.2;
    m.put('gloss', Geo.rbox(0.3, 0.07, 0.38, 0.03), [mx, 0.935, -0.03], 0, 1, mc);
    m.put('gloss', Geo.rbox(0.14, 0.46, 0.17, 0.05), [mx, 1.16, -0.17], 0, 1, mc);
    m.put('gloss', Geo.rbox(0.19, 0.14, 0.42, 0.06), [mx, 1.42, -0.05], 0, 1, mc);
    m.put('paint', Geo.cyl(0.05, 0.05, 0.02, 16), [mx, 1.42, 0.17], [PI / 2, 0, 0], 1, rgb('#E6E2DA'));
    pad(m, 0.42, 0.905, 0.08);
    [-0.45, 0.45].forEach((x) => m.put('brass', Geo.cyl(0.012, 0.012, 0.12, 8), [x, 0.7, 0.37], [0, 0, PI / 2]));
  };
  FM.oven = (m) => {
    const stl = {};
    m.put('steel', Geo.rbox(1.15, 0.5, 0.9, 0.02), [0, 0.25, 0], 0, 1, rgb('#B9BEC4'), stl);
    m.put('steel', Geo.rbox(1.15, 0.85, 0.95, 0.02), [0, 0.92, 0], 0, 1, rgb('#C7CBD0'), stl);
    m.put('gloss', Geo.rbox(0.96, 0.55, 0.04, 0.02), [0, 0.88, 0.47], 0, 1, rgb('#1E1E20'), { rough: 0.2 });
    m.put('steel', Geo.cyl(0.018, 0.018, 0.8, 10), [0, 1.22, 0.53], [0, 0, PI / 2], 1, rgb('#D8DBDF'), stl);
    [-0.36, 0.36].forEach((dx) => m.put('steel', Geo.box(0.03, 0.03, 0.06), [dx, 1.22, 0.5], 0, 1, rgb('#D8DBDF'), stl));
    m.put('gloss', Geo.rbox(1.0, 0.1, 0.03, 0.01), [0, 1.29, 0.47], 0, 1, rgb('#1A1A1A'), { rough: 0.25 });
    [-0.38, -0.25].forEach((dx) => m.put('gloss', Geo.cyl(0.03, 0.03, 0.03, 14), [dx, 1.29, 0.5], [PI / 2, 0, 0], 1, rgb('#2A2A2A'), { rough: 0.3 }));
    m.put('steel', Geo.box(1.1, 0.04, 0.5), [0, 1.37, -0.1], 0, 1, rgb('#9AA0A6'), stl);
    m.put('steel', Geo.box(0.9, 0.012, 0.6), [0, 0.8 - 0.006, 0.1], 0, 1, rgb('#8C9298'), stl);
  };
  FM.whip = (m) => {
    island(m, 1.3, C.sage);
    m.put('gloss', Geo.cyl(0.07, 0.06, 0.16, 16), [0.45, 0.99, -0.22], 0, 1, rgb('#E8E2D8'), { rough: 0.2 });
    [-0.02, 0.02].forEach((dx, k) => m.put('steel', Geo.cyl(0.006, 0.006, 0.26, 6), [0.45 + dx, 1.12, -0.22 + dx], [0.1 * (k ? 1 : -1), 0, 0.12 * (k ? -1 : 1)]));
    m.put('gloss', Geo.rbox(0.09, 0.07, 0.2, 0.02), [0.38, 0.945, 0.14], [0, 0.5, 0], 1, rgb('#F2F0EC'));
  };
  FM.deco = (m) => {
    island(m, 1.2, C.navy);
    m.put('steel', Geo.cyl(0.05, 0.2, 0.06, 28), [0, 0.94, 0.04], 0, 1, rgb('#D8DCE0'));
    m.put('steel', Geo.rbox(0.03, 0.005, 0.24, 0.002), [0.42, 0.912, 0.18], [0, 1.2, 0]);
    m.put('gloss', Geo.cyl(0.035, 0.012, 0.16, 12), [-0.44, 0.97, -0.2], [0, 0, 1.3], 1, rgb('#F2F0EC'));
  };
  FM.sink = (m) => {
    const w = 1.6, d = 0.7, bx = -0.36, bw = 0.62, bd = 0.46, bz = 0.02, by = 0.76, top = 0.9, inner = rgb('#7E848A');
    const xL = bx - bw / 2, xR = bx + bw / 2, zB = bz - bd / 2, zF = bz + bd / 2;
    m.put('steel', Geo.box(w, by, d - 0.03), [0, by / 2, 0]);
    m.put('steel', Geo.box(xL + w / 2, top - by, d - 0.03), [(-w / 2 + xL) / 2, (top + by) / 2, 0]);
    m.put('steel', Geo.box(w / 2 - xR, top - by, d - 0.03), [(xR + w / 2) / 2, (top + by) / 2, 0]);
    m.put('steel', Geo.box(bw, top - by, zB + d / 2 - 0.015), [bx, (top + by) / 2, (-d / 2 + 0.015 + zB) / 2]);
    m.put('steel', Geo.box(bw, top - by, d / 2 - 0.015 - zF), [bx, (top + by) / 2, (zF + d / 2 - 0.015) / 2]);
    m.put('steel', Geo.box(bw - 0.01, 0.01, bd - 0.01), [bx, by + 0.005, bz], 0, 1, inner);
    // ふち（流しの上は開いている）
    m.put('steel', Geo.box(w + 0.02, 0.02, 0.06), [0, top, -d / 2 + 0.03]);
    m.put('steel', Geo.box(0.02, 0.12, bd), [xL, top - 0.06, bz], 0, 1, inner); m.put('steel', Geo.box(0.02, 0.12, bd), [xR, top - 0.06, bz], 0, 1, inner);
    m.put('steel', Geo.box(bw, 0.12, 0.02), [bx, top - 0.06, zB], 0, 1, inner); m.put('steel', Geo.box(bw, 0.12, 0.02), [bx, top - 0.06, zF], 0, 1, inner);
    // 蛇口
    m.put('steel', Geo.cyl(0.016, 0.016, 0.32, 10), [bx, top + 0.16, -0.29]);
    m.put('steel', Geo.cyl(0.013, 0.013, 0.26, 10), [bx, top + 0.31, -0.17], [PI / 2, 0, 0]);
    m.put('steel', Geo.cyl(0.013, 0.011, 0.06, 10), [bx, top + 0.28, -0.04]);
    m.put('steel', Geo.cyl(0.03, 0.03, 0.03, 12), [bx + 0.12, top + 0.03, -0.29], 0, 1, rgb('#C21F24'));
    // 水切りかご
    m.put('steel', Geo.rbox(0.56, 0.012, 0.42, 0.006), [0.49, top + 0.006, -0.06], 0, 1, rgb('#AEB3B8'));
    for (let k = 0; k < 12; k++) m.put('steel', Geo.box(0.006, 0.09, 0.006), [0.23 + k * 0.047, top + 0.05, -0.25], 0, 1, rgb('#C7CBD0'));
    [-0.25, 0.13].forEach((z) => m.put('steel', Geo.box(0.56, 0.008, 0.008), [0.49, top + 0.09, z], 0, 1, rgb('#C7CBD0')));
    [0.21, 0.77].forEach((x) => [-0.25, 0.13].forEach((z) => m.put('steel', Geo.box(0.008, 0.09, 0.008), [x, top + 0.05, z], 0, 1, rgb('#C7CBD0'))));
    // 洗剤とスポンジ
    m.put('gloss', Geo.cyl(0.03, 0.03, 0.17, 12), [-0.73, top + 0.085, -0.22], 0, 1, rgb('#4FB3D9'), { rough: 0.15 });
    m.put('paint', Geo.rbox(0.09, 0.03, 0.06, 0.01), [-0.73, top + 0.015, -0.05], 0, 1, rgb('#F2D16B'));
  };
  // 在庫棚（段ボール置き場。2列×2段）
  FM.crack = (m) => {
    const W2 = 1.2, D2 = 0.6, H2 = 1.3;
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => m.put('steel', Geo.box(0.035, H2, 0.035), [sx * (W2 / 2 - 0.02), H2 / 2, sz * (D2 / 2 - 0.02)], 0, 1, rgb('#4F6B8A'))));
    [0.06, 0.64, 1.22].forEach((y) => {
      m.put('oak', Geo.box(W2 - 0.04, 0.025, D2 - 0.04), [0, y + 0.0125, 0], 0, 1, rgb('#C9A57A'));
      [-1, 1].forEach((sz) => m.put('steel', Geo.box(W2, 0.05, 0.03), [0, y - 0.01, sz * (D2 / 2 - 0.02)], 0, 1, rgb('#E07A2E')));
    });
    m.put('steel', Geo.box(0.02, 1.12, 0.02), [0, 0.66, D2 / 2 - 0.02], 0, 1, rgb('#4F6B8A'));
    m.put('gloss', Geo.box(0.16, 0.05, 0.004), [-0.29, 0.6, D2 / 2], 0, 1, rgb('#F2EBE1'));
    m.put('gloss', Geo.box(0.16, 0.05, 0.004), [0.29, 0.6, D2 / 2], 0, 1, rgb('#F2EBE1'));
  };
  FM.rack = (m) => {
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => m.put('steel', Geo.cyl(0.014, 0.014, 1.7, 6), [sx * 0.355, 0.85, sz * 0.28])));
    [0.5, 0.95, 1.4].forEach((y) => { for (let i = 0; i < 7; i++) m.put('steel', Geo.cyl(0.005, 0.005, 0.56, 4), [-0.33 + i * 0.11, y - 0.005, 0], [PI / 2, 0, 0]); [-0.28, 0.28].forEach((z) => m.put('steel', Geo.box(0.72, 0.012, 0.012), [0, y - 0.005, z])); });
  };
  FM.trash = (m) => {
    m.put('steel', Geo.cyl(0.22, 0.19, 0.62, 20), [0, 0.31, 0], 0, 1, rgb('#5A5F64'));
    m.put('steel', Geo.cyl(0.235, 0.235, 0.04, 20), [0, 0.64, 0], 0, 1, rgb('#3A3E42'));
    m.put('steel', Geo.box(0.16, 0.025, 0.08), [0, 0.03, 0.22], 0, 1, rgb('#3A3E42'));
  };
  FM.reg = (m) => {
    const y = CT;
    m.put('walnut', Geo.rbox(1.6, 0.015, 0.6, 0.006), [0, y + 0.0075, 0], 0, 1, rgb('#4A3022'));
    m.put('gloss', Geo.rbox(0.4, 0.1, 0.36, 0.02), [-0.45, y + 0.065, -0.05], 0, 1, C.dark);
    m.put('brass', Geo.cyl(0.02, 0.03, 0.14, 10), [-0.45, y + 0.18, -0.08]);
    m.put('gloss', Geo.rbox(0.34, 0.24, 0.025, 0.01), [-0.45, y + 0.33, -0.1], [-0.35, 0, 0], 1, rgb('#151515'));
    m.led(Geo.box(0.3, 0.2, 0.004), [-0.45, y + 0.33, -0.116], '#7FB3D5', [-0.35, 0, 0]);
    m.put('gloss', Geo.rbox(0.2, 0.1, 0.02, 0.008), [-0.45, y + 0.28, 0.06], [0.25, 0, 0], 1, rgb('#151515'));
    m.led(Geo.box(0.17, 0.06, 0.004), [-0.45, y + 0.28, 0.072], '#9BE08A', [0.25, 0, 0]);
    m.put('steel', Geo.rbox(0.24, 0.015, 0.16, 0.005), [-0.05, y + 0.016, 0.17], 0, 1, rgb('#3A3E42'));
    m.put('gloss', Geo.rbox(0.14, 0.1, 0.18, 0.02), [0.12, y + 0.06, -0.14], 0, 1, rgb('#E9E6DF'));
    m.put('gloss', Geo.rbox(0.1, 0.035, 0.18, 0.012), [0.52, y + 0.03, 0.12], [-0.3, 0, 0], 1, rgb('#2A2A2A'));
    m.led(Geo.box(0.07, 0.004, 0.07), [0.52, y + 0.052, 0.09], '#8FD3FF', [-0.3, 0, 0]);
    // 列の仕切り（床）とお会計の立ち位置
    [-0.85, 0.05].forEach((xx) => [1.0, 3.2].forEach((dz) => { m.put('brass', Geo.cyl(0.025, 0.025, 0.9, 10), [xx, 0.45, dz]); m.put('steel', Geo.cyl(0.14, 0.16, 0.03, 16), [xx, 0.015, dz], 0, 1, C.dark); }));
    [-0.85, 0.05].forEach((xx) => m.put('cloth', Geo.box(0.012, 0.05, 2.2), [xx, 0.85, 2.1], 0, 1, rgb('#7A1F2B')));
    m.put('paint', Geo.cyl(0.22, 0.22, 0.004, 24), [0.55, 0.003, 0.85], 0, 1, rgb('#C9A35E'));
    m.put('paint', Geo.cyl(0.22, 0.22, 0.004, 24), [-0.4, 0.003, 1.0], 0, 1, rgb('#7A1F2B'));
  };
  // ---------- カウンター裏の箱入れ（カウンターの下に入る。厨房側が前） ----------
  const cardTex = (key, text, sub) => {
    if (W[key]) return W[key];
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const g = cv.getContext('2d');
    g.fillStyle = '#2A2624'; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#E8C547'; g.lineWidth = 5; g.strokeRect(5, 5, 246, 86);
    g.fillStyle = '#F2EBE1'; g.textAlign = 'center'; g.font = '700 38px "Zen Kaku Gothic New",sans-serif'; g.fillText(text, 128, 50);
    g.fillStyle = '#E8C547'; g.font = '600 18px "Zen Kaku Gothic New",sans-serif'; g.fillText(sub, 128, 80);
    return (W[key] = W.eng.texFromCanvas(cv, false));
  };
  FM.boxhole = (m) => {
    const zb = -0.36, zf = 0.0, zc = (zb + zf) / 2, dd = zf - zb;
    m.put('oak', Geo.box(0.86, 0.04, dd), [0, 0.08, zc], 0, 1, rgb('#C9A57A'));
    [-0.43, 0, 0.43].forEach((x) => m.put('oak', Geo.box(x ? 0.03 : 0.02, x ? 0.4 : 0.32, dd), [x, x ? 0.3 : 0.26, zc], 0, 1, rgb('#B88C5E')));
    m.put('oak', Geo.box(0.86, 0.4, 0.02), [0, 0.3, zf], 0, 1, rgb('#9A7550'));
    m.put('oak', Geo.box(0.86, 0.07, 0.02), [0, 0.135, zb], 0, 1, rgb('#B88C5E'));
    m.sign(cardTex('bhTex', 'ケーキの箱', 'BOX'), 0.34, 0.13, [0, 0.43, zb + 0.02], [0, PI, 0]);
  };
  // ---------- 自動の機械（黄色い帯と緑の表示が目印） ----------
  const autoBadge = (m, w, y, z) => { m.put('paint', Geo.box(w, 0.05, 0.012), [0, y, z], 0, 1, rgb('#E8C547')); };
  FM.amixer = (m) => {
    steelCounter(m, 1.4, 0.75);
    const mc = rgb('#3F6F93'), mx = -0.2;
    m.put('gloss', Geo.rbox(0.34, 0.07, 0.4, 0.03), [mx, 0.935, -0.03], 0, 1, mc);
    m.put('gloss', Geo.rbox(0.16, 0.52, 0.19, 0.05), [mx, 1.19, -0.18], 0, 1, mc);
    m.put('gloss', Geo.rbox(0.22, 0.15, 0.46, 0.06), [mx, 1.48, -0.05], 0, 1, mc);
    m.put('steel', Geo.cyl(0.085, 0.035, 0.14, 16, 0, PI * 2, true), [mx + 0.15, 1.34, 0.17], [0.35, 0, -0.35]);
    m.put('gloss', Geo.rbox(0.26, 0.15, 0.03, 0.01), [0.18, 1.0, 0.37], [-0.5, 0, 0], 1, rgb('#151515'));
    m.led(Geo.box(0.22, 0.11, 0.004), [0.18, 1.005, 0.386], '#7FD3A8', [-0.5, 0, 0]);
    autoBadge(m, 1.2, 0.8, 0.376);
    pad(m, 0.42, 0.905, 0.08);
  };
  FM.awhip = (m) => {
    steelCounter(m, 1.2, 0.75);
    const c = rgb('#6E8F62');
    m.put('gloss', Geo.rbox(0.3, 0.04, 0.34, 0.015), [-0.15, 0.9, 0.02], 0, 1, c);
    m.put('gloss', Geo.rbox(0.12, 0.52, 0.14, 0.04), [-0.15, 1.16, -0.24], 0, 1, c);
    m.put('gloss', Geo.rbox(0.18, 0.12, 0.36, 0.05), [-0.15, 1.44, -0.1], 0, 1, c);
    m.put('gloss', Geo.rbox(0.24, 0.14, 0.03, 0.01), [0.32, 1.0, 0.37], [-0.5, 0, 0], 1, rgb('#151515'));
    m.led(Geo.box(0.2, 0.1, 0.004), [0.32, 1.005, 0.386], '#7FD3A8', [-0.5, 0, 0]);
    autoBadge(m, 1.0, 0.8, 0.376);
  };
  FM.aoven = (m) => {
    FM.oven(m);
    autoBadge(m, 1.0, 0.54, 0.476);
    m.led(Geo.box(0.26, 0.06, 0.004), [0.3, 1.29, 0.488], '#7FD3A8');
  };
  FM.adeco = (m) => {
    island(m, 1.4, C.navy);
    m.put('steel', Geo.cyl(0.05, 0.2, 0.06, 28), [-0.18, 0.94, 0.08], 0, 1, rgb('#D8DCE0'));
    [-0.62, 0.26].forEach((x) => m.put('steel', Geo.box(0.05, 0.62, 0.05), [x, 1.21, -0.3]));
    m.put('steel', Geo.box(0.95, 0.06, 0.08), [-0.18, 1.52, -0.3]);
    m.put('steel', Geo.box(0.07, 0.06, 0.4), [-0.18, 1.52, -0.1]);
    m.put('gloss', Geo.cyl(0.11, 0.11, 0.3, 18), [0.45, 1.06, -0.18], 0, 1, rgb('#F2F0EC'), { rough: 0.2 });
    m.put('steel', Geo.cyl(0.118, 0.118, 0.025, 18), [0.45, 1.22, -0.18]);
    for (let k = 0; k < 4; k++) m.put('gloss', Geo.cyl(0.045, 0.03, 0.1, 12, 0, PI * 2, true), [0.36 + (k % 2) * 0.13, 0.96, 0.08 + Math.floor(k / 2) * 0.13], 0, 1, rgb('#DDE8EE'), { rough: 0.1 });
    m.put('gloss', Geo.rbox(0.24, 0.14, 0.03, 0.01), [0.45, 1.3, -0.12], [-0.3, 0, 0], 1, rgb('#151515'));
    m.led(Geo.box(0.2, 0.1, 0.004), [0.45, 1.302, -0.104], '#7FD3A8', [-0.3, 0, 0]);
    autoBadge(m, 1.2, 0.75, 0.356);
  };
  // 全自動製造ライン（左 → 右に流れる。生地 → オーブン → 冷却 → クリーム → トッピング → 出口）
  FM.line = (m) => {
    const L2 = 5.4, bx0 = -1.95, bx1 = 1.9;
    // 脚と枠
    for (let x = -2.6; x <= 2.61; x += 0.87) [-0.3, 0.3].forEach((z) => m.put('steel', Geo.box(0.05, 0.86, 0.05), [x, 0.43, z]));
    [-0.3, 0.3].forEach((z) => m.put('steel', Geo.box(L2, 0.06, 0.04), [0, 0.86, z], 0, 1, rgb('#B9BEC4')));
    m.put('steel', Geo.box(L2, 0.03, 0.56), [0, 0.18, 0], 0, 1, rgb('#9AA0A6'));
    // ベルト
    m.put('paint', Geo.box(bx1 - bx0, 0.02, 0.5), [(bx0 + bx1) / 2, 0.895, 0], 0, 1, rgb('#2E3236'));
    for (let x = bx0; x <= bx1 + 0.01; x += 0.3) m.put('steel', Geo.cyl(0.025, 0.025, 0.52, 10), [x, 0.87, 0], [PI / 2, 0, 0], 1, rgb('#C7CBD0'));
    // ① 生地：ミキサーと投入口
    m.put('steel', Geo.box(0.7, 0.06, 0.62), [-2.35, 0.86, 0], 0, 1, rgb('#C7CBD0'));
    m.put('steel', Geo.box(0.06, 0.9, 0.06), [-2.62, 1.34, -0.26]);
    m.put('gloss', Geo.rbox(0.2, 0.16, 0.5, 0.05), [-2.35, 1.72, -0.06], 0, 1, rgb('#3F6F93'));
    m.put('steel', Geo.cyl(0.34, 0.1, 0.34, 20, 0, PI * 2, true), [-2.3, 1.38, 0.05], 0, 1, rgb('#D8DCE0'));
    m.put('steel', Geo.torus(0.34, 0.012, 6, 24), [-2.3, 1.55, 0.05], [PI / 2, 0, 0]);
    // ② オーブン（トンネル）
    m.put('steel', Geo.rbox(1.85, 0.08, 0.66, 0.02), [-0.7, 1.46, 0], 0, 1, rgb('#9AA0A6'));
    [-0.33, 0.33].forEach((z) => m.put('steel', Geo.box(1.85, 0.52, 0.04), [-0.7, 1.17, z], 0, 1, rgb('#B9BEC4')));
    [-1.63, 0.23].forEach((x) => m.put('steel', Geo.box(0.05, 0.08, 0.66), [x, 1.38, 0], 0, 1, rgb('#6E757C')));
    for (let k = 0; k < 6; k++) m.put('cloth', Geo.box(0.012, 0.24, 0.07), [-1.63, 1.22, -0.2 + k * 0.08], 0, 1, rgb('#3A3E42'));
    m.put('steel', Geo.cyl(0.05, 0.05, 0.3, 12), [-1.1, 1.65, -0.15]);
    // ③ 冷却ファン
    [0.42, 0.78].forEach((x) => { m.put('steel', Geo.cyl(0.16, 0.16, 0.05, 20, 0, PI * 2, true), [x, 1.38, 0]); m.put('steel', Geo.box(0.04, 0.48, 0.04), [x, 1.12, -0.3]); });
    m.put('steel', Geo.box(0.5, 0.04, 0.04), [0.6, 1.36, -0.3]);
    // ④ クリーム塗り・⑤ トッピング（門型の台）
    [1.0, 1.95].forEach((x) => [-0.3, 0.3].forEach((z) => m.put('steel', Geo.box(0.045, 0.66, 0.045), [x, 1.22, z])));
    m.put('steel', Geo.box(1.0, 0.06, 0.66), [1.47, 1.55, 0], 0, 1, rgb('#B9BEC4'));
    m.put('gloss', Geo.cyl(0.1, 0.1, 0.22, 16), [1.2, 1.68, -0.12], 0, 1, rgb('#F2F0EC'), { rough: 0.2 });
    for (let k = 0; k < 3; k++) m.put('gloss', Geo.cyl(0.05, 0.035, 0.12, 12, 0, PI * 2, true), [1.62 + k * 0.12, 1.64, -0.14], 0, 1, rgb('#DDE8EE'), { rough: 0.1 });
    // 出口（冷蔵の台）
    m.put('marble', Geo.box(0.82, 0.05, 0.82), [2.32, 0.885, 0]);
    m.put('steel', Geo.box(0.82, 0.85, 0.82), [2.32, 0.43, 0], 0, 1, rgb('#D6DADE'));
    P.KINDS.line.slots.forEach((sl) => m.put('gloss', Geo.cyl(0.17, 0.17, 0.01, 28), [sl[0], 0.913, sl[2]], 0, 1, rgb('#F4F1EC'), { rough: 0.2 }));
    m.glass(Geo.box(0.82, 0.32, 0.012), [2.32, 1.08, -0.4]);
    m.led(Geo.box(0.7, 0.01, 0.03), [2.32, 1.22, -0.36], '#E9F6FF');
    // 操作パネル・看板
    m.put('gloss', Geo.rbox(0.5, 0.34, 0.06, 0.02), [-1.25, 1.1, 0.42], [-0.45, 0, 0], 1, rgb('#20262B'));
    m.led(Geo.box(0.42, 0.2, 0.004), [-1.25, 1.12, 0.455], '#7FD3A8', [-0.45, 0, 0]);
    m.put('steel', Geo.box(0.05, 0.3, 0.05), [-1.25, 0.86, 0.38]);
    autoBadge(m, L2 - 0.2, 0.76, 0.32);
    m.sign(cardTex('lineTex', '全自動製造ライン', 'AUTO LINE'), 1.0, 0.36, [-0.7, 1.72, 0.0]);
    m.sign(cardTex('lineTex2', '出口', 'できあがり'), 0.4, 0.15, [2.32, 1.32, -0.405]);
  };
  function furnParts(k) {
    if (W.fmesh[k]) return W.fmesh[k];
    const e = W.eng, BB = {}, extra = [], LB = new Builder();
    const m = {
      put: (mat, g, p, r, s, c, opt) => (BB[mat] = BB[mat] || new Builder()).put(g, p, r || 0, s || 1, c || [1, 1, 1], Object.assign({ rough: MATS[mat].rough, metal: MATS[mat].metal || 0 }, opt || {})),
      glass: (g, p, r) => extra.push({ g, p, r, o: { color: rgb('#CFE3EE'), op: 0.14, cast: false, recv: false } }),
      led: (g, p, c, r) => LB.put(g, p, r || 0, 1, rgb(c || '#F4FBFF'), {}),
      sign: (tex, w, h, p, r) => extra.push({ g: Geo.card(w, h), p, r, o: { tex, em: 0.85, cast: false } }),
    };
    (FM[k] || FM.table)(m);
    const parts = [];
    for (const mat in BB) parts.push({ meshes: CS.gl.keep(BB[mat].build(e)), o: { tex: MATS[mat].tex ? W.T[MATS[mat].tex] : null } });
    if (!LB.empty()) parts.push({ meshes: CS.gl.keep(LB.build(e)), o: { em: 1, cast: false, recv: false } });
    extra.forEach((x) => parts.push({ meshes: CS.gl.keep(e.mesh(x.g, null, { rough: x.o.op ? 0.04 : 0.4 })), o: x.o, p: x.p, r: x.r }));
    return (W.fmesh[k] = parts);
  }
  // 家具ごとに中身が変わる部分（ボウル・回転台・オーブンの窓・水）
  function shared() {
    if (W.bowlM) return;
    const e = W.eng, stl = { rough: 0.25, metal: 1 };
    const bowlB = new Builder(); bowlB.put(Geo.cyl(0.16, 0.1, 0.16, 28, 0, PI * 2, true), [0, 0.08, 0], 0, 1, rgb('#C7CBD0'), stl); bowlB.put(Geo.cyl(0.1, 0.1, 0.004, 24), [0, 0.002, 0], 0, 1, rgb('#C7CBD0'), stl); bowlB.put(Geo.torus(0.16, 0.006, 6, 28), [0, 0.16, 0], [PI / 2, 0, 0], 1, rgb('#D6D9DD'), stl);
    W.bowlM = CS.gl.keep(bowlB.build(e));
    W.fillM = []; for (let k = 1; k <= 10; k++) { const h = 0.014 * k, rt = 0.1 + (0.06 * (h + 0.004)) / 0.16 - 0.006; W.fillM.push(CS.gl.keep(e.mesh(Geo.cyl(rt, 0.094, h, 24), '#FFFFFF', { rough: 0.5 }))); }
    const whiskB = new Builder(); for (let k = 0; k < 4; k++) whiskB.put(Geo.torus(0.04, 0.003, 4, 16), [0, -0.05, 0], [0, (k * PI) / 4, PI / 2], [1, 1.6, 1], rgb('#D8DBDF'), stl); whiskB.put(Geo.cyl(0.006, 0.006, 0.16, 6), [0, 0.06, 0], 0, 1, rgb('#D8DBDF'), stl);
    W.whiskM = CS.gl.keep(whiskB.build(e));
    W.ttM = CS.gl.keep(e.mesh(Geo.cyl(0.2, 0.2, 0.012, 36), '#E6E9EC', { rough: 0.3, metal: 1 }));
    W.winM = CS.gl.keep(e.mesh(Geo.box(0.8, 0.4, 0.01), null, { rough: 0.05 }));
    W.dispM = CS.gl.keep(e.mesh(Geo.box(0.16, 0.05, 0.01)));
    W.waterM = CS.gl.keep(e.mesh(Geo.cyl(0.009, 0.012, 0.42, 10), '#FFFFFF', { rough: 0.05 }));
    W.foamM = CS.gl.keep(e.mesh(Geo.sphere(0.03, 10, 8), '#FFFFFF', { rough: 0.6 }));
    // 自動の機械の動く部分（クリームのノズル・ベルトの板・ファン・オーブンの窓・トッピングのアーム）
    const nozB = new Builder(); nozB.put(Geo.cyl(0.03, 0.03, 0.12, 12), [0, 0.06, 0], 0, 1, rgb('#C7CBD0'), stl); nozB.put(Geo.cyl(0.03, 0.008, 0.07, 12), [0, -0.035, 0], 0, 1, rgb('#D8DBDF'), stl);
    W.nozM = CS.gl.keep(nozB.build(e));
    W.slatM = CS.gl.keep(e.mesh(Geo.box(0.035, 0.006, 0.48), '#FFFFFF', { rough: 0.7 }));
    const fanB = new Builder(); for (let k = 0; k < 4; k++) fanB.put(Geo.box(0.13, 0.006, 0.05), [Math.cos(k * PI / 2) * 0.07, 0, Math.sin(k * PI / 2) * 0.07], [0.3, -k * PI / 2, 0], 1, rgb('#AEB3B8'), stl); fanB.put(Geo.cyl(0.025, 0.025, 0.02, 10), [0, 0, 0], 0, 1, rgb('#6E757C'), stl);
    W.fanM = CS.gl.keep(fanB.build(e));
    W.lwinM = CS.gl.keep(e.mesh(Geo.box(1.6, 0.16, 0.01), null, { rough: 0.05 }));
    const armB = new Builder(); armB.put(Geo.box(0.03, 0.2, 0.03), [0, 0.1, 0], 0, 1, rgb('#C7CBD0'), stl); armB.put(Geo.box(0.08, 0.02, 0.02), [0, 0, 0], 0, 1, rgb('#6E757C'), stl); [-0.035, 0.035].forEach((x) => armB.put(Geo.box(0.008, 0.05, 0.016), [x, -0.025, 0], 0, 1, rgb('#6E757C'), stl));
    W.armM = CS.gl.keep(armB.build(e));
  }
  function mkBowl(parent, p, mix2) {
    const n = parent.add(new Node(W.bowlM)); n.p = p.slice();
    const f = n.add(new Node(W.fillM[0], { cast: false })); f.vis = false;
    const w = n.add(new Node(W.whiskM, { cast: false })); w.p = [0, 0.24, 0]; w.vis = !!mix2;
    return { n, f, w, lv: 0, mix: !!mix2 };
  }
  function mkFurn(fid, f) {
    shared();
    const n = new Node();
    for (const pt of furnParts(f.k)) { const c = new Node(pt.meshes, Object.assign({}, pt.o)); if (pt.p) c.p = pt.p.slice(); if (pt.r) c.r = pt.r.slice(); n.add(c); }
    const o = { n, k: f.k, fid };
    if (f.k === 'mixer' || f.k === 'amixer') o.bowl = mkBowl(n, [-0.2, 0.97, 0.05], true);
    if (f.k === 'whip') o.bowl = mkBowl(n, [-0.15, 0.915, 0.04], false);
    if (f.k === 'awhip') o.bowl = mkBowl(n, [-0.15, 0.92, 0.02], true);
    if (f.k === 'deco') { o.tt = n.add(new Node(W.ttM)); o.tt.p = [0, 0.968, 0.04]; o.a = 0; }
    if (f.k === 'adeco') { o.tt = n.add(new Node(W.ttM)); o.tt.p = [-0.18, 0.968, 0.08]; o.a = 0; o.noz = n.add(new Node(W.nozM, { cast: false })); o.noz.p = [-0.18, 1.42, 0.08]; }
    if (f.k === 'line') mkLine(o, n);
    if (f.k === 'oven' || f.k === 'aoven') { o.win = n.add(new Node(W.winM, { color: rgb('#202020'), em: 0, cast: false })); o.win.p = [0, 0.88, 0.495]; o.disp = n.add(new Node(W.dispM, { color: rgb('#FF5A2A'), em: 1, cast: false })); o.disp.p = [0.25, 1.29, 0.49]; }
    if (f.k === 'sink') {
      o.water = n.add(new Node(W.waterM, { color: rgb('#CDEBFA'), op: 0.55, em: 0.25, cast: false, recv: false })); o.water.p = [-0.36, 0.97, -0.04]; o.water.vis = false;
      o.foam = []; for (let k = 0; k < 7; k++) { const fn = n.add(new Node(W.foamM, { color: [1, 1, 1], cast: false, em: 0.1 })); fn.p = [-0.36 + Math.sin(k * 2.1) * 0.14, 0.84, 0.02 + Math.cos(k * 1.7) * 0.1]; fn.s = [1.3, 0.7, 1.3]; fn.vis = false; o.foam.push(fn); }
    }
    W.furnGroup.add(n);
    return o;
  }
  // 全自動ラインの動く部分
  function mkLine(o, n) {
    o.bowl = mkBowl(n, [-2.3, 0.89, 0.05], true);
    o.slats = []; for (let k = 0; k < 14; k++) { const sl = n.add(new Node(W.slatM, { cast: false, color: rgb('#4A5056') })); sl.p = [0, 0.909, 0]; o.slats.push(sl); }
    o.fans = [0.42, 0.78].map((x) => { const fn = n.add(new Node(W.fanM, { cast: false })); fn.p = [x, 1.37, 0]; return fn; });
    o.lwin = n.add(new Node(W.lwinM, { color: rgb('#202020'), em: 0, cast: false })); o.lwin.p = [-0.7, 1.17, 0.352];
    o.ltt = n.add(new Node(W.ttM)); o.ltt.p = [1.2, 0.912, 0]; o.ltt.s = [0.8, 1, 0.8]; o.lta = 0;
    o.noz = n.add(new Node(W.nozM, { cast: false })); o.noz.p = [1.2, 1.4, 0];
    o.arm = n.add(new Node(W.armM, { cast: false })); o.arm.p = [1.72, 1.32, 0];
    o.jobs = {}; o.jg = n.add(new Node()); o.slatT = 0; o.fa = 0;
  }
  // 家具の当たり判定（レジ・箱入れはカウンターの上・下なので要らない）
  function furnObstacles(s) {
    W.obstacles = W.sObs.slice();
    for (const fid in s.fu) { const f = s.fu[fid]; if (!P.KINDS[f.k] || P.KINDS[f.k].counter && f.k !== 'scase') continue; const b = P.box(f); const o = f.k === 'scase' ? [b[0], CZ - 0.41, b[2], CZ + 0.6] : [b[0], b[1], b[2], b[3]]; o.furn = fid; W.obstacles.push(o); }
    if (W._decoObs) W.obstacles.push(...W._decoObs);
  }
  W.syncFurn = function (s) {
    const key = JSON.stringify(s.fu || {});
    if (W.keys.fu === key) return;
    W.keys.fu = key;
    for (const fid in W.fn) { const f = s.fu[fid]; if (!f || f.k !== W.fn[fid].k) { W.furnGroup.remove(W.fn[fid].n); delete W.fn[fid]; } }
    for (const fid in s.fu) { const f = s.fu[fid]; if (!P.KINDS[f.k]) continue; if (!W.fn[fid]) W.fn[fid] = mkFurn(fid, f); }
    W.placeFurn(s);
    furnObstacles(s);
    W._wsKey = '';
  };
  W.placeFurn = function (s) {
    for (const fid in W.fn) { const f = fOf(s, fid); if (!f) continue; const o = W.fn[fid]; o.n.p = [f.x, 0, f.z]; o.n.r = [0, P.dirs(f.r).a, 0]; }
  };

  // =====================================================================
  //  小物のモデル（材料の山・型・お皿・箱・クリーム・段ボール）
  // =====================================================================
  const meshCache = {};
  const PKG = { flour: ['#EDE3CF', 0.16, 0.2, 0.11], sugar: ['#F7F5F0', 0.14, 0.16, 0.1], cocoa: ['#6B4030', 0.1, 0.13, 0.1], matcha: ['#7E9B4E', 0.09, 0.12, 0.09], choco: ['#4A2A1C', 0.16, 0.04, 0.09], chestnut: ['#9A5A22', 0.1, 0.11, 0.1], egg: ['#E9D9B5', 0.2, 0.07, 0.11], butter: ['#F4DD8A', 0.11, 0.05, 0.07], milk: ['#F2F2EE', 0.08, 0.2, 0.08], cream: ['#FFFDF6', 0.07, 0.14, 0.07], cheese: ['#F3E7C2', 0.12, 0.06, 0.1], strawberry: ['#C8102E', 0.14, 0.07, 0.1], blueberry: ['#2E3560', 0.12, 0.06, 0.09], peach: ['#F6A06B', 0.08, 0.08, 0.08], lemon: ['#F7D94C', 0.07, 0.07, 0.07], box: ['#F7F5F0', 0.3, 0.012, 0.24] };
  const shownN = (n, small) => (small ? Math.min(n, 3) : n <= 12 ? n : Math.min(24, 12 + Math.ceil((n - 12) / 4)));
  function ingStack(B, ing, n, small) {
    const pk = PKG[ing] || ['#DDD', 0.1, 0.1, 0.1], col = rgb(pk[0]), white = rgb('#F2F0EC'), cap = rgb('#3F6F93');
    const shown = shownN(n, small);
    if (ing === 'box') { for (let k = 0; k < Math.min(shown, 14); k++) B.put(Geo.box(pk[1], 0.011, pk[3]), [0, 0.006 + k * 0.012, 0], [0, (k % 3 - 1) * 0.04, 0], 1, k % 2 ? col : rgb('#EFEBE3'), { rough: 0.7 }); B.put(Geo.box(pk[1] * 0.5, 0.003, 0.03), [0, 0.012 * Math.min(shown, 14) + 0.002, 0], 0, 1, rgb('#C9A35E'), { rough: 0.5 }); return; }
    const FW = small ? 0.26 : 0.46, FD = small ? 0.16 : 0.3, gap = 0.022;
    const round = ing === 'peach' || ing === 'lemon', berry = ing === 'strawberry' || ing === 'blueberry', carton = ing === 'milk' || ing === 'cream';
    const cols = Math.max(1, Math.floor((FW + gap) / (pk[1] + gap))), rows = Math.max(1, Math.floor((FD + gap) / (pk[3] + gap)));
    const gA = round ? Geo.sphere(pk[1] / 2, 10, 8) : berry ? Geo.rbox(pk[1], pk[2] * 0.6, pk[3], 0.008) : Geo.rbox(pk[1], pk[2], pk[3], 0.01);
    const gB = berry ? Geo.sphere(0.022, 8, 6) : carton ? Geo.box(pk[1] * 0.9, 0.02, pk[3] * 0.9) : null;
    const per = cols * rows, maxL = small ? 2 : Math.max(1, Math.floor(0.4 / (pk[2] + 0.004))), shownC = Math.min(shown, per * maxL), layers = Math.ceil(shownC / per);
    for (let k = 0; k < shownC; k++) {
      const layer = Math.floor(k / per), kk = k % per, inL = layer === layers - 1 ? shownC - layer * per : per;
      const cN = Math.min(cols, inL), rN = Math.ceil(inL / cols), cx = kk % cols, rz = Math.floor(kk / cols);
      const x = (cx - (cN - 1) / 2) * (pk[1] + gap), z = (rz - (rN - 1) / 2) * (pk[3] + gap), y = pk[2] / 2 + layer * (pk[2] + 0.004);
      if (round) B.put(gA, [x, y, z], 0, 1, col, { rough: 0.5 });
      else if (berry) { B.put(gA, [x, y - pk[2] * 0.2, z], 0, 1, white, { rough: 0.3 }); for (let b = 0; b < 4; b++) B.put(gB, [x - 0.03 + (b % 2) * 0.06, y + pk[2] * 0.15, z - 0.025 + Math.floor(b / 2) * 0.05], 0, 1, col, { rough: 0.3 }); }
      else { B.put(gA, [x, y, z], 0, 1, col, { rough: 0.6 }); if (carton) B.put(gB, [x, y + pk[2] / 2 + 0.01, z], 0, 1, cap, { rough: 0.4 }); }
    }
  }
  // ケーキ1切れ（箱・お皿の上）
  function sliceMesh(B, s, rid, p, a) {
    const r = sim.recipe(s, rid) || {}, Bs = D.BASES[r.base] || D.BASES.plain, cr = D.CREAMS[r.cream] || {};
    const SP = rgb(Bs.color || '#EFC77C'), CR = cr.color ? rgb(cr.color) : null, R = 0.085, th = PI / 3;
    if (Bs.cookie) { for (let k = 0; k < 3; k++) B.put(Geo.cyl(0.024, 0.026, 0.01, 14), [p[0] + (k - 1) * 0.03, p[1] + 0.006 + (k % 2) * 0.008, p[2]], [0.2, 0, 0], 1, SP, { rough: 0.8 }); return; }
    const t0 = a - th / 2, ox = p[0] - Math.sin(a) * R * 0.45, oz = p[2] - Math.cos(a) * R * 0.45;
    let y = p[1];
    const lay = CR ? [[SP, 0.026], [CR, 0.012], [SP, 0.026], [CR, 0.008]] : [[SP, Bs.tart ? 0.03 : 0.055]];
    lay.forEach(([c, h]) => { B.put(Geo.cyl(R, R, h, 10, t0, th), [ox, y + h / 2, oz], 0, 1, c, { rough: c === CR ? 0.4 : 0.85 }); y += h; });
    const tk = Object.keys(r.tops || {})[0];
    if (tk) MD.topPiece(B, tk, [ox + Math.sin(a) * R * 0.6, y, oz + Math.cos(a) * R * 0.6], 1);
  }
  function itemKey(it, small) {
    return JSON.stringify([it.t, it.st, it.b, it.k, it.ing, it.t === 'ing' ? shownN(it.n, small) : 0, small ? 1 : 0, (it.s || []).map((x) => x[0] + (x[4] ? 'H' : '')), it.df, it.cr, it.tp, it.r, it.p, it.dirty ? 1 : 0, it.open ? Math.min(10, it.n) : 0, it.w ? 1 : 0, it.dish ? 1 : 0]);
  }
  function itemMesh(it, s, small) {
    const e = W.eng;
    const key = itemKey(it, small);
    if (meshCache[key]) return meshCache[key];
    const B = new Builder(), st = { rough: 0.3, metal: 1 };
    if (it.t === 'ing') ingStack(B, it.ing, it.n, small);
    else if (it.t === 'fcrate') {
      // 家具の大きな段ボール（中身の大きさに合わせる）
      const Kd = P.KINDS[it.k] || {}, w = clamp((Kd.w || 1) * 0.8, 0.6, 1.05), d = clamp((Kd.d || 1) * 0.95, 0.5, 0.85), h = clamp((Kd.h || 1) * 0.62, 0.5, 0.88), cb = { rough: 0.85 };
      B.put(Geo.rbox(w, h, d, 0.012), [0, h / 2, 0], 0, 1, C.card, cb);
      B.put(Geo.box(w + 0.004, 0.05, 0.08), [0, h - 0.03, 0], 0, 1, rgb('#B88C5E'), cb);
      B.put(Geo.box(0.08, 0.05, d + 0.004), [0, h - 0.03, 0], 0, 1, rgb('#B88C5E'), cb);
      B.put(Geo.box(w * 0.5, h * 0.36, 0.006), [0, h * 0.5, d / 2 + 0.002], 0, 1, rgb('#F2EBE1'), cb);
      B.put(Geo.box(w * 0.42, h * 0.08, 0.008), [0, h * 0.58, d / 2 + 0.004], 0, 1, rgb('#2F4A3F'), cb);
      for (let k = 0; k < 2; k++) B.put(Geo.cyl(0.0, 0.035, 0.07, 3), [w / 2 - 0.12 - k * 0.09, h * 0.75, d / 2 + 0.005], [PI / 2, 0, 0], 1, rgb('#C0392B'), cb);
    }
    else if (it.t === 'pan') {
      const Bs = D.BASES[it.b] || {}, burnt = (it.df || []).includes('burnt');
      if (Bs.cookie) B.put(Geo.rbox(0.38, 0.02, 0.28, 0.006), [0, 0.01, 0], 0, 1, rgb('#8C9298'), st);
      else { B.put(Geo.cyl(0.12, 0.115, 0.07, 28, 0, PI * 2, true), [0, 0.035, 0], 0, 1, rgb('#A6ACB2'), st); B.put(Geo.cyl(0.115, 0.115, 0.004, 28), [0, 0.002, 0], 0, 1, rgb('#A6ACB2'), st); }
      if (it.st === 'empty' && it.dirty) for (let k = 0; k < 6; k++) B.put(Geo.sphere(0.03, 8, 6), [Math.sin(k * 2.3) * 0.06, 0.006, Math.cos(k * 1.9) * 0.06], 0, [1.2, 0.18, 0.9], rgb(k % 2 ? '#B98A55' : '#E8D9B5'), { rough: 0.9 });
      if (it.st !== 'empty') {
        const raw = it.st === 'raw' || it.st === 'baking';
        const col = raw ? mix('#F4E7C6', Bs.color || '#EFC77C', 0.35) : burnt ? mix(Bs.color || '#EFC77C', '#24130A', 0.6) : rgb(Bs.color || '#EFC77C');
        if (Bs.cookie) { for (let k = 0; k < 8; k++) { const sx = (k % 4) * 0.085 - 0.13, sz = Math.floor(k / 4) * 0.11 - 0.055; B.put(Bs.shell ? Geo.sphere(0.035, 12, 8, 0, PI / 2) : Geo.cyl(0.034, 0.036, raw ? 0.012 : 0.014, 16), [sx, 0.026, sz], 0, Bs.shell ? [1.2, 0.5, 0.8] : 1, col, { rough: 0.8 }); } }
        else { B.put(Geo.cyl(0.112, 0.112, raw ? 0.03 : 0.058, 28), [0, raw ? 0.017 : 0.031, 0], 0, 1, col, { rough: 0.85 }); if (!raw) B.put(Geo.cyl(0.108, 0.112, 0.004, 28), [0, 0.061, 0], 0, 1, burnt ? rgb('#1C0F07') : rgb(Bs.crumb || '#C98D45'), { rough: 0.85 }); }
      }
    } else if (it.t === 'plate') {
      B.put(Geo.cyl(0.13, 0.1, 0.012, 32), [0, 0.006, 0], 0, 1, rgb('#F7F5F0'), { rough: 0.15 });
      B.put(Geo.torus(0.122, 0.0028, 6, 32), [0, 0.0125, 0], [PI / 2, 0, 0], 1, rgb('#C9A96E'), { rough: 0.25, metal: 1 });
      if (it.dirty) { for (let k = 0; k < 5; k++) B.put(Geo.sphere(0.02, 8, 6), [Math.sin(k * 2.5) * 0.05, 0.013, Math.cos(k * 2.1) * 0.05], 0, [1.4, 0.2, 1], rgb(k % 2 ? '#E8D9B5' : '#B98A55'), { rough: 0.9 }); B.put(Geo.box(0.012, 0.004, 0.17), [0.05, 0.016, 0], [0, 0.5, 0], 1, rgb('#D8DBDF'), st); }
      const sl = it.s || [];
      sl.forEach((x, k) => { const a = sl.length === 1 ? 0 : (k / sl.length) * PI * 2; const rr = sl.length === 1 ? 0 : 0.05; sliceMesh(B, s, x[0], [Math.sin(a) * rr, 0.012, Math.cos(a) * rr], a + PI); });
    } else if (it.t === 'knife') {
      // ケーキナイフ（波刃・木の柄）
      B.put(Geo.rbox(0.25, 0.003, 0.036, 0.001), [0.06, 0.004, 0], 0, 1, rgb('#D9DDE1'), { rough: 0.18, metal: 1 });
      for (let k = 0; k < 10; k++) B.put(Geo.cyl(0.004, 0.004, 0.0032, 6), [-0.05 + k * 0.024, 0.004, -0.018], 0, 1, rgb('#C2C7CC'), { rough: 0.2, metal: 1 });
      B.put(Geo.box(0.012, 0.012, 0.03), [-0.07, 0.007, 0], 0, 1, rgb('#B9BEC3'), { rough: 0.3, metal: 1 });
      B.put(Geo.rbox(0.12, 0.018, 0.026, 0.008), [-0.135, 0.01, 0], 0, 1, rgb('#6B4A32'), { rough: 0.6 });
      [-0.11, -0.16].forEach((x) => B.put(Geo.cyl(0.004, 0.004, 0.0186, 8), [x, 0.01, 0], 0, 1, rgb('#E1E4E7'), { rough: 0.2, metal: 1 }));
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
      if ((it.s || []).some((x) => x[4])) {
        // ホール入り：ピンクのリボンを十字に
        B.put(Geo.box(0.306, 0.166, 0.03), [0, 0.083, 0], 0, 1, rgb('#E8789A'), { rough: 0.5 }); B.put(Geo.box(0.03, 0.166, 0.246), [0, 0.083, 0], 0, 1, rgb('#E8789A'), { rough: 0.5 });
        B.put(Geo.torus(0.035, 0.009, 6, 14), [-0.03, 0.172, 0], [PI / 2, 0, 0.5], [1, 1, 0.5], rgb('#E8789A'), { rough: 0.5 }); B.put(Geo.torus(0.035, 0.009, 6, 14), [0.03, 0.172, 0], [PI / 2, 0, -0.5], [1, 1, 0.5], rgb('#E8789A'), { rough: 0.5 });
      } else for (let k = 0; k < (it.s || []).length; k++) B.put(Geo.cyl(0.035, 0.035, 0.012, 3), [-0.1 + (k % 3) * 0.1, 0.172, -0.05 + Math.floor(k / 3) * 0.1], [0, 0.4, 0], 1, rgb('#E8D9C4'), { rough: 0.6 });
    } else if (it.t === 'crate' && it.open) {
      const cb = { rough: 0.85 }, cc = C.card, W2 = 0.48, D2 = 0.36, H2 = 0.34;
      B.put(Geo.box(W2, 0.012, D2), [0, 0.006, 0], 0, 1, cc, cb);
      [-1, 1].forEach((sd) => { B.put(Geo.box(W2, H2, 0.012), [0, H2 / 2, sd * (D2 / 2)], 0, 1, cc, cb); B.put(Geo.box(0.012, H2, D2), [sd * (W2 / 2), H2 / 2, 0], 0, 1, cc, cb); });
      [-1, 1].forEach((sd) => { B.put(Geo.box(W2, 0.012, D2 / 2), [0, H2 + 0.02, sd * (D2 / 2 + D2 / 4 - 0.02)], [sd * 1.25, 0, 0], 1, mix(cc, '#000000', 0.06), cb); B.put(Geo.box(W2 / 2, 0.012, D2), [sd * (W2 / 2 + W2 / 4 - 0.03), H2 + 0.02, 0], [0, 0, -sd * 1.3], 1, mix(cc, '#000000', 0.1), cb); });
      const pk = PKG[it.ing] || ['#DDD', 0.1, 0.1, 0.1], n = Math.min(10, it.n);
      for (let k = 0; k < n; k++) { const cx = (k % 5) - 2, cz2 = Math.floor(k / 5) - 0.5; B.put(Geo.rbox(Math.min(0.085, pk[1]), Math.min(0.2, Math.max(0.03, pk[2])), Math.min(0.15, pk[3]), 0.008), [cx * 0.088, H2 - Math.min(0.2, pk[2]) / 2 - 0.02, cz2 * 0.16], 0, 1, rgb(pk[0]), { rough: 0.6 }); }
    } else if (it.t === 'crate') {
      B.put(Geo.rbox(0.48, 0.34, 0.36, 0.01), [0, 0.17, 0], 0, 1, C.card, { rough: 0.85 });
      B.put(Geo.box(0.485, 0.04, 0.05), [0, 0.32, 0], 0, 1, rgb('#B88C5E'), { rough: 0.8 });
      B.put(Geo.box(0.16, 0.12, 0.005), [0, 0.18, 0.182], 0, 1, rgb(ING_COL[it.ing] || '#ddd'), { rough: 0.7 });
      B.put(Geo.box(0.005, 0.12, 0.16), [0.242, 0.18, 0], 0, 1, rgb(ING_COL[it.ing] || '#ddd'), { rough: 0.7 });
    }
    if (B.empty()) B.put(Geo.sphere(0.03, 10, 8), [0, 0.03, 0], 0, 1, rgb('#ccc'), { rough: 0.3 });
    // お皿の上のケーキはレシピで形が変わるので、ケーキ入りのお皿は使い回さない
    const ms = B.build(e);
    if (it.t === 'plate' && (it.s || []).length) return ms;
    return (meshCache[key] = CS.gl.keep(ms));
  }
  // 回転台の上の作りかけのケーキ
  function decoNode(it) {
    const e = W.eng;
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
  function itemNode(it, s, small) {
    if (it.t === 'deco') return { n: decoNode(it), sc: CAKE_SC };
    if (it.t === 'cake' || it.t === 'tray') {
      const r = sim.recipe(s, it.r); const n = new Node();
      const pcs = it.p >= it.n ? 6 : Math.max(1, Math.round(((it.p || 0) / (it.n || 6)) * 6));
      if (r) { const c = MD.cake(W.eng, r, pcs, 1, it.df, !it.w); if (it.dish) c.p = [0, 0.009, 0]; n.add(c); }
      if (it.dish) { const d = new Node(itemMesh({ t: 'plate', s: [] }, s, small)); d.s = [1.32 / CAKE_SC, 1 / CAKE_SC, 1.32 / CAKE_SC]; n.add(d); }
      return { n, sc: it.t === 'tray' ? CAKE_SC * 0.95 : CAKE_SC };
    }
    return { n: new Node(itemMesh(it, s, small)), sc: 1 };
  }

  // =====================================================================
  //  状態の反映（サーバーから来るたび）
  // =====================================================================
  W.sync = function (s, room) {
    if (!W.ready || !s) return;
    W.S = s; W.room = room;
    const L = layout(s);
    if (L.key !== GK) { GK = L.key; W.L = L; W.rebuild(); }
    W.syncFurn(s);
    const e = W.eng, seen = {};
    for (const id in s.k.items) {
      const it = s.k.items[id]; seen[id] = 1;
      const small = String(it.at).startsWith('h:') || String(it.at).startsWith('c:');
      const key = itemKey(it, small) + (it.t === 'plate' || it.t === 'cake' || it.t === 'tray' ? '|' + (it.r || '') : '');
      let o = W.items[id];
      if (o && o.key !== key) { W.itemGroup.remove(o.n); e.freeTree(o.n); o = null; }
      if (!o) { const x = itemNode(it, s, small); W.itemGroup.add(x.n); o = W.items[id] = { n: x.n, key, sc: x.sc }; }
      o.it = it;
    }
    for (const id in W.items) if (!seen[id]) { W.itemGroup.remove(W.items[id].n); e.freeTree(W.items[id].n); delete W.items[id]; }
    const uk = JSON.stringify([s.up.interior || 0, s.up.sign || 0, s.furn, s.up.floor || 0, s.name, GK]);
    if (W.keys.up !== uk) { W.keys.up = uk; W.decorate(s); furnObstacles(s); }
    const mk = JSON.stringify([s.menu, s.known]);
    if (W.keys.mb !== mk) { W.keys.mb = mk; W.drawBoard(s); }
    if (W.keys.op !== s.phase) { W.keys.op = s.phase; W.drawOpen(s.phase === 'open'); }
  };
  W.rebuild = function () {
    W._keep = {};
    for (const id in W.custs) { const o = W.custs[id]; W._keep[id] = [o.x, o.z, o.r]; }
    for (const id in W.staffN) { const o = W.staffN[id]; W._keep[id] = [o.x, o.z, o.r]; }
    W.eng.freeTree(W.scene); W.scene.clear();
    W.keys = { mb: W.keys.mb }; W.items = {}; W.others = {}; W.custs = {}; W.staffN = {}; W.fn = {}; W._decoObs = null; W.mv = null; W.hold = null; W.ghost = null;
    W.buildStatic();
    W.applyQuality();
    if (W.S) { W.syncFurn(W.S); }
    const [x, z] = collide(W.me.x, W.me.z, 0.3); W.me.x = x; W.me.z = z;
    if (W.boardCv && W.S) W.drawBoard(W.S);
  };
  // 売り場の飾り（テーブル・観葉植物・コーヒー・スピーカー・内装）
  W.decorate = function (s) {
    const e = W.eng;
    const lv = s.up.interior || 0;
    e.updateTex(W.T.plaster, MD.TX.plaster(['#EFE8DD', '#E6EEE6', '#EDE4EC', '#F2EADB'][Math.min(3, lv)]));
    e.freeTree(W.decoGroup); W.decoGroup.clear();
    const obs = (W._decoObs = []);
    const fblock = (x0, z0, x1, z1) => obs.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);
    const B = {}; const Pd = (m, g, p, r, sc2, c, o) => { (B[m] = B[m] || new Builder()).put(g, p, r, sc2, c || [1, 1, 1], o); };
    W.tablePos(s).forEach(([x, z]) => {
      Pd('marble', Geo.cyl(0.4, 0.4, 0.03, 32), [x, 0.74, z], 0, 1, null, { rough: 0.18 });
      Pd('d', Geo.cyl(0.03, 0.03, 0.72, 10), [x, 0.37, z], 0, 1, C.dark, { rough: 0.3, metal: 1 }); Pd('d', Geo.cyl(0.2, 0.22, 0.02, 20), [x, 0.01, z], 0, 1, C.dark, { rough: 0.3, metal: 1 });
      [0.65, -0.65].forEach((dx) => { Pd('w', Geo.cyl(0.19, 0.19, 0.04, 20), [x + dx, 0.46, z], 0, 1, null, { rough: 0.5 }); Pd('d', Geo.cyl(0.015, 0.015, 0.44, 6), [x + dx, 0.22, z], 0, 1, C.dark, { rough: 0.3, metal: 1 }); Pd('w', Geo.rbox(0.04, 0.4, 0.34, 0.01), [x + dx * 1.3, 0.7, z], [0, 0, dx > 0 ? -0.1 : 0.1], 1, null, { rough: 0.5 }); });
      Pd('d', Geo.cyl(0.03, 0.025, 0.08, 12), [x, 0.795, z - 0.25], 0, 1, rgb('#F2EFE8'), { rough: 0.15 });
      fblock(x - 1.0, z - 0.35, x + 1.0, z + 0.35);
    });
    const plants = s.furn.plant || 0;
    for (let i = 0; i < plants; i++) { const px = i % 2 ? RX - 0.6 : -RX + 0.6, z = CZ + (i % 2 ? 5.1 : 3.3) + Math.floor(i / 2) * 2.2; if (z > RZ - 1.3) continue; Pd('d', Geo.cyl(0.2, 0.15, 0.4, 18), [px, 0.2, z], 0, 1, C.terracotta, { rough: 0.6 }); for (let k = 0; k < 7; k++) Pd('d', Geo.sphere(0.13, 10, 8), [px + Math.sin(k * 2.4) * 0.12, 0.55 + k * 0.08, z + Math.cos(k * 2.4) * 0.12], [k * 0.5, 0, 0.3], [1, 1.6, 0.5], shade(C.leaf, (k % 3) * 0.08), { rough: 0.7 }); fblock(px - 0.22, z - 0.22, px + 0.22, z + 0.22); }
    if (s.furn.coffee) { const x = -RX + 0.45, z = CZ + 0.95; Pd('w', Geo.rbox(0.6, 0.9, 0.9, 0.02), [x + 0.05, 0.45, z], 0, 1, null, { rough: 0.5 }); Pd('d', Geo.rbox(0.42, 0.45, 0.4, 0.04), [x + 0.05, 1.13, z], 0, 1, rgb('#2A2624'), { rough: 0.3, metal: 0.4 }); Pd('d', Geo.cyl(0.035, 0.03, 0.08, 12), [x + 0.15, 0.94, z + 0.25], 0, 1, rgb('#F2EFE8'), { rough: 0.15 }); fblock(-RX, z - 0.46, x + 0.36, z + 0.46); }
    if (s.furn.speaker) [-1, 1].forEach((sd) => Pd('d', Geo.rbox(0.22, 0.34, 0.2, 0.02), [sd * (RX - 0.15), 2.7, CZ + 1.5], [0, sd * 0.5, 0], 1, rgb('#2A2624'), { rough: 0.5 }));
    if (lv >= 1) [[-RX + 0.1, CZ + 4.3], [-RX + 0.1, CZ + 6.4]].forEach(([x, z]) => { Pd('d', Geo.cyl(0.015, 0.015, 0.6, 10), [x + 0.1, 2.38, z], [PI / 2, 0, 0], 1, rgb('#C9A35E'), { rough: 0.25, metal: 1 }); Pd('d', Geo.box(0.12, 0.02, 0.02), [x + 0.05, 2.38, z], 0, 1, rgb('#C9A35E'), { rough: 0.25, metal: 1 }); });
    if (lv >= 2) for (let x = 2.0; x <= RX - 1.3; x += 1.9) [-1, 1].forEach((sd) => { const px = sd * x, pz = RZ - 0.04; Pd('d', Geo.cyl(0.06, 0.045, 0.16, 14), [px, 1.04, pz], 0, 1, rgb('#E8E2D8'), { rough: 0.15 }); for (let k = 0; k < 4; k++) Pd('d', Geo.sphere(0.032, 8, 6), [px + Math.sin(k * 1.6) * 0.035, 1.16 + k * 0.018, pz + Math.cos(k * 1.6) * 0.03], 0, 1, rgb(['#D46A7A', '#F2D16B', '#F4F1EC', '#C98FB0'][(Math.round(x) + k) % 4]), { rough: 0.6 }); });
    if (lv >= 3) for (let x = -RX + 2.5; x < -1.5; x += 2.1) Pd('d', Geo.cyl(0.18, 0.1, 0.22, 20, 0, PI * 2, true), [x, WH - 0.55, CZ + 4.2], 0, 1, rgb('#C9A35E'), { rough: 0.3, metal: 1 });
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
  //  入力（PC：WASD＋マウス／スマホ：スティック＋右側スワイプ）
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
      if (e.code === 'KeyB') W.setBuild(!W.bm);
      if (e.code === 'Escape' && W.bm) { if (W.mv) W.mv = null; else W.setBuild(false); }
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
    W._joyReset = () => { id = null; knob.style.transform = ''; W.input.joy = null; W.kb = {}; W.primaryHold(false); };
    if (!W._visBound) { W._visBound = true; document.addEventListener('visibilitychange', () => { if (document.hidden && W._joyReset) W._joyReset(); }); }
  };
  W.blocked = function () {
    const m = document.getElementById('modal'), g = document.getElementById('gov');
    const sp = document.getElementById('mg');
    return !!((CS.ui && CS.ui.sheet) || (m && !m.hidden) || W.editing || (g && !g.hidden) || (sp && !sp.hidden));
  };
  // 配置モード（家具を動かす）
  W.setBuild = function (on) {
    on = !!on;
    if (on && W.S && !(W.S.phase === 'prep' || W.S.phase === 'open' || W.S.phase === 'lobby')) return;
    W.bm = on; W.mv = null;
    if (W.foot) W.foot.vis = false;
    if (W.onBuild) W.onBuild(on);
    if (W.S) W.placeFurn(W.S);
  };

  // =====================================================================
  //  毎フレーム
  // =====================================================================
  W.frame = function () {
    if (!W.ready) return;
    const now = performance.now();
    const raw = Math.max(0, (now - W.last) / 1000); W.last = now;
    W.autoQuality(now, raw);
    const dt = Math.min(0.05, raw), dtN = Math.min(0.3, raw);
    const s = W.S, room = W.room, g = room ? room.now() : 0;
    if (W.blocked() && document.pointerLockElement) document.exitPointerLock();
    for (let k = 0, n = Math.min(5, Math.ceil(raw / 0.05) || 1); k < n; k++) W.updatePlayer(Math.min(0.05, raw / n));
    W.updateCamera(dt);
    W.updateOthers(dtN);
    W.updateTown(dtN);
    if (s) { if (W.hold && performance.now() > W.hold.until) { W.hold = null; W.placeFurn(s); } if (W.mv || W.hold) W.placeFurn(s); W.updateStations(s, g, dtN); W.updateCustomers(dtN, s, g); W.updateStaff(dtN, s, g); W.updateTruck(s, g, dtN); }
    W.updateTarget(s, g);
    if (s) { W.updateItems(s, g); W.updateGhost(s); }
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
    e.cam.near = 0.07; e.cam.far = 140; // near を少し大きくして奥の深度の精度を上げる（床・壁のちらつき防止）
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
  // ---------- 設備（ボウルの中身・回転台・オーブン・流し） ----------
  const stOf = (s, fid) => (s.k.st && s.k.st[fid]) || {};
  // 全自動ラインの上を流れるケーキ（段階：0 生地 → 1 オーブン → 2 冷却 → 3 クリーム → 4 トッピング → 5 出口待ち）
  W.lineStage = function (j, g) { const d = j.d || [1, 1, 1, 1, 1]; let el = g - j.t0, k = 0; while (k < 5 && el >= d[k]) { el -= d[k]; k++; } return { k, f: k < 5 ? clamp(el / Math.max(1, d[k]), 0, 1) : 1 }; };
  const ringTops = (r) => { const tl = [], cnt = Object.assign({}, r.tops || {}), ks = Object.keys(cnt); for (let more = true; more;) { more = false; for (const k of ks) if (cnt[k] > 0) { tl.push(k); cnt[k]--; more = true; } } return tl.map((k, i) => { const a = (i / Math.max(1, tl.length)) * PI * 2 + 0.3, rr = tl.length === 1 ? 0 : 0.55; return [Math.cos(a) * rr, Math.sin(a) * rr, k]; }); };
  function lineItem(s, r, k, f) {
    const cr = r.cream && r.cream !== 'none' ? r.cream : null;
    if (k === 1) return { n: new Node(itemMesh({ t: 'pan', st: 'raw', b: r.base }, s, false)), sc: 1 };
    if (k === 2) return { n: new Node(itemMesh({ t: 'pan', st: 'baked', b: r.base }, s, false)), sc: 1 };
    if (k === 3) return { n: decoNode({ b: r.base, cr: f > 0.5 ? cr : null, tp: [], df: [] }), sc: CAKE_SC };
    if (k === 4) { const tp = ringTops(r); return { n: decoNode({ b: r.base, cr, tp: tp.slice(0, Math.ceil(tp.length * Math.min(1, f * 1.2))), df: [] }), sc: CAKE_SC }; }
    return { n: MD.cake(W.eng, r, 6, 1, [], false), sc: CAKE_SC };
  }
  function updLine(s, fid, o, b, g, dt) {
    const seen = {}, on = !!b.on;
    let belt = false, oven = false, mixing = null, coating = null, topping = null;
    for (const j of b.q || []) {
      const r = sim.recipe(s, j.r); if (!r) continue;
      const { k, f } = W.lineStage(j, g);
      seen[j.i] = 1;
      if (k === 0) mixing = { r, f };
      const key = k === 0 ? '' : k + '|' + j.r + '|' + (k === 3 ? (f > 0.5 ? 1 : 0) : k === 4 ? Math.min(9, Math.ceil(f * 6)) : 0);
      let jn = o.jobs[j.i];
      if (jn && jn.key !== key) { o.jg.remove(jn.n); W.eng.freeTree(jn.n); delete o.jobs[j.i]; jn = null; }
      if (!jn && key) { const it = lineItem(s, r, k, f); o.jg.add(it.n); jn = o.jobs[j.i] = { n: it.n, key, sc: it.sc }; }
      if (!jn) continue;
      const x = k === 1 ? lerp(-1.85, 0.2, f) : k === 2 ? lerp(0.28, 0.95, f) : k === 3 ? 1.2 : k === 4 ? 1.72 : 1.88;
      jn.n.p = [x, k === 3 ? 0.918 : 0.905, 0]; jn.n.s = [jn.sc, jn.sc, jn.sc]; jn.n.r = [0, k === 3 ? o.lta : 0, 0];
      if (k === 1 || k === 2) belt = true; if (k === 1) oven = true; if (k === 3) coating = f; if (k === 4) topping = f;
    }
    for (const id in o.jobs) if (!seen[id]) { o.jg.remove(o.jobs[id].n); W.eng.freeTree(o.jobs[id].n); delete o.jobs[id]; }
    // ベルト・ファン・オーブンの窓・ミキサー・ノズル・アーム
    if (belt || (on && (b.q || []).length)) o.slatT += dt * 0.32;
    const span = 3.85; o.slats.forEach((sl, k) => { sl.p[0] = -1.95 + ((k * span / o.slats.length + o.slatT) % span); });
    o.fa += on ? dt * 9 : 0; o.fans.forEach((fn) => (fn.r[1] = o.fa));
    o.lwin.em = oven ? 0.45 : on ? 0.12 : 0; o.lwin.color = oven ? rgb('#E2802F') : on ? rgb('#7A3A14') : rgb('#202020');
    const bw = o.bowl;
    if (mixing) { const kk = clamp(Math.round(4 + mixing.f * 6), 1, 10); if (bw.lv !== kk) { bw.lv = kk; bw.f.meshes = W.fillM[kk - 1]; bw.f.p = [0, 0.004 + (0.014 * kk) / 2, 0]; } bw.f.vis = true; bw.f.color = mix('#F4E7C6', (D.BASES[mixing.r.base] || {}).color || '#EFC77C', mixing.f); bw.w.r[1] += dt * 18; bw.w.p[1] = 0.13; }
    else { bw.f.vis = false; bw.w.p[1] = 0.25; }
    if (coating != null) { o.lta += dt * 3; o.noz.p[1] = 1.24 + Math.sin(g / 150) * 0.02; } else o.noz.p[1] = lerp(o.noz.p[1], 1.4, 1 - Math.exp(-dt * 6));
    o.ltt.r[1] = o.lta;
    o.arm.p[1] = topping != null ? 1.12 + Math.abs(Math.sin(g / 220)) * 0.12 : lerp(o.arm.p[1], 1.32, 1 - Math.exp(-dt * 6));
  }
  W.updateStations = function (s, g, dt) {
    const fillOf = (b, cream) => {
      const ings = b.ings || [], n = ings.length; const lvl = clamp(n / 8, 0, 1);
      let col = '#F2E8D0';
      if (b.st === 'done') col = cream ? (D.CREAMS[b.k] || {}).color || '#E8D9A8' : b.k ? D.BASES[b.k].color : '#9A8B78';
      else if (n) { const c = [0, 0, 0]; ings.forEach((x) => { const v = rgb(ING_COL[x] || '#EEE'); c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }); col = [c[0] / n, c[1] / n, c[2] / n]; }
      return { lvl: b.st === 'done' ? 0.75 : lvl, col };
    };
    for (const fid in W.fn) {
      const o = W.fn[fid], b = stOf(s, fid);
      if (o.k === 'line') { updLine(s, fid, o, b, g, dt); continue; }
      if (o.noz) { const coat = b.st === 'auto' && b.ph === 'coat'; o.noz.p[1] = coat ? 1.3 + Math.sin(g / 140) * 0.02 : lerp(o.noz.p[1], 1.42, 1 - Math.exp(-dt * 6)); }
      if (o.bowl) {
        const bw = o.bowl, f = fillOf(b, o.k === 'whip' || o.k === 'awhip');
        if (f.lvl > 0) { const k = clamp(Math.round(f.lvl * 10), 1, 10); if (bw.lv !== k) { bw.lv = k; bw.f.meshes = W.fillM[k - 1]; bw.f.p = [0, 0.004 + (0.014 * k) / 2, 0]; } bw.f.vis = true; bw.f.color = rgb(f.col); } else bw.f.vis = false;
        const run = b.st === 'run' || !!b.by;
        bw.w.r[1] += run ? dt * 18 : 0; bw.w.p[1] = run ? 0.13 : 0.25; bw.w.p[0] = run ? Math.sin(g / 120) * 0.03 : 0;
        bw.w.vis = bw.mix || run;
      }
      if (o.tt) {
        if (b.st === 'run' || b.by || (b.st === 'auto' && b.ph !== 'fin')) o.a += dt * 2.6;
        else { const tgt = Math.round(o.a / (PI * 2)) * PI * 2; o.a = lerp(o.a, tgt, 1 - Math.exp(-dt * 8)); }
        o.tt.r[1] = o.a;
      }
      if (o.win) {
        const id = K.at(s, K.slot0(fid)), it = id && s.k.items[id];
        const heating = b.h && g < (b.hot || 0), hot = b.h && !heating;
        o.disp.color = it && it.st === 'baking' ? rgb('#FF5A2A') : hot ? rgb('#7CFF6B') : heating ? rgb('#FFB02A') : rgb('#333333');
        o.disp.em = b.h ? 1 : 0.2;
        if (it && it.st === 'baking' && it.bk) {
          o.win.em = 0.35; o.win.color = rgb('#E2802F');
          const d = (g - it.bk.t0) / it.bk.dur, w = sim.bakeWindow(s, it.bk.dT || 0);
          if (Math.abs(d - 1) <= w && !W.alerted[id + it.bk.t0]) { W.alerted[id + it.bk.t0] = 1; CS.sound.play('ding'); }
        } else { o.win.em = hot || heating ? 0.1 : 0; o.win.color = hot || heating ? rgb('#7A3A14') : rgb('#202020'); }
      }
      if (o.water) {
        const mine = W.washing === fid, other = !!b.by && !mine && b.by !== (W.room && W.room.pid);
        o.water.vis = W.rinse === fid || (other && Math.sin(g / 300) > 0);
        const foam = mine ? W.foamLv || 0 : other ? 0.6 : 0;
        o.foam.forEach((fn, k) => { fn.vis = foam > k / 8; });
      }
    }
    if (W.pcScreen) W.pcScreen.em = 0.8 + Math.sin(performance.now() / 600) * 0.05;
  };
  // ---------- 小物の位置（置き場・手の中・お客さん・客席） ----------
  const STACK_H = { plate: 0.016, pan: 0.03 };
  W.updateItems = function (s, g) {
    const me = W.me, pid = W.room && W.room.pid;
    const groups = {};
    for (const id in W.items) { const it = W.items[id].it; if (!it) continue; const at = String(it.at); if (at.startsWith('f:') || at.startsWith('seat:')) (groups[at] = groups[at] || []).push(id); }
    const idx = {};
    for (const at in groups) { const l = groups[at]; if (l.length > 1) l.sort((a, b) => ((W.items[a].it.pl || 0) - (W.items[b].it.pl || 0)) || (a < b ? -1 : 1)); l.forEach((id, i) => (idx[id] = i)); }
    for (const id in W.items) {
      const o = W.items[id], it = o.it; if (!it) continue;
      const at = String(it.at);
      let p = null, ry = 0, scl = 1, mine = false;
      if (at.startsWith('h:')) {
        const who = at.slice(2);
        if (who === pid) {
          mine = true;
          const f = W.fwd, cp = Math.cos(me.pitch), sp = Math.sin(me.pitch);
          const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
          const big = it.t === 'crate' || it.t === 'box' || it.t === 'cake' || it.t === 'fcrate';
          const crate = it.t === 'crate', huge = it.t === 'fcrate', dist = huge ? 0.95 : crate ? 0.72 : big ? 0.6 : 0.5, side = big ? 0.0 : 0.2, down = huge ? 0.95 : crate ? 0.5 : big ? 0.42 : 0.3;
          const cam = W.eng.cam.pos;
          const ux = Math.sin(me.yaw) * sp, uy = cp, uz = Math.cos(me.yaw) * sp;
          p = [cam[0] + f[0] * dist + rx * side - ux * down, cam[1] + f[1] * dist - uy * down, cam[2] + f[2] * dist + rz * side - uz * down];
          ry = me.yaw; scl = it.t === 'ing' ? 0.9 : it.t === 'crate' ? 0.72 : it.t === 'fcrate' ? 0.8 : 0.85;
        } else {
          const ot = W.others[who] || W.staffN[who];
          if (ot) { const r = ot.r || 0, hg = it.t === 'fcrate'; p = [ot.x + Math.sin(r) * (hg ? 0.6 : 0.42), hg ? 0.6 : 1.02, ot.z + Math.cos(r) * (hg ? 0.6 : 0.42)]; ry = r; }
        }
      } else if (at === 'fl') {
        p = [+it.fx || 0, 0, +it.fz || 0]; ry = ((it.fr || 0) % 2) * PI / 2;
      } else if (at.startsWith('c:')) {
        const oc = W.custs[at.slice(2)];
        if (oc) { const r = oc.r || 0; p = [oc.x + Math.sin(r) * 0.34, 0.95, oc.z + Math.cos(r) * 0.34]; ry = r; }
      } else {
        const sw = slotWorld(s, at);
        if (sw) { p = sw.p.slice(); ry = sw.ry; const k = idx[id] || 0; if (k) p[1] += k * (STACK_H[it.t] || 0.02); }
        const sk = it.res && W.staffN[it.res];
        if (p && sk && sk.m && sk.m.job && sk.m.job.k === 'stock' && sk.carry) { const r = sk.r || 0; p = [sk.x + Math.sin(r) * 0.42, 1.02, sk.z + Math.cos(r) * 0.42]; ry = r; }
      }
      o.n.vis = !!p;
      if (!p) continue;
      o.n.p = p;
      o.n.cast = !mine;
      if (it.t === 'deco' || it.t === 'cake') { const sw = at.startsWith('f:') ? slotWorld(s, at) : null; const ft = sw && sw.type === 'turn' && W.fn[sw.fid]; o.n.r = [0, ry + (ft ? ft.a : 0), 0]; }
      else o.n.r = [0, ry, 0];
      const sc = o.sc * scl; o.n.s = [sc, sc, sc];
      setEm(o.n, W.target && (W.target.item === id) ? 0.16 : 0);
      setTint(o.n, (it.sp || 0) >= 2 ? 2 : it.wet ? 3 : 0);
    }
  };
  const TINT = [[1, 1, 1], null, [0.74, 0.8, 0.6], [0.86, 0.95, 1.12], [0.72, 1.18, 0.78], [1.3, 0.62, 0.6]];
  function setTint(n, v) { if (n._tn === v) return; n._tn = v; if (n.meshes.length) n.color = TINT[v] || TINT[0]; n.kids.forEach((k) => setTint(k, v)); }
  function setEm(n, v) { if (n._em === v) return; n._em = v; n.em = v; n.kids.forEach((k) => setEm(k, v)); }
  W.setTint = setTint;
  // 配置モード：動かしている家具の色と床の目印
  W.updateGhost = function (s) {
    for (const fid in W.fn) { const o = W.fn[fid]; const v = W.mv && W.mv.id === fid ? (W.mv.why ? 5 : 4) : W.bm && W.target && W.target.fid === fid ? 4 : 0; if (o._g !== v) { o._g = v; o.n.kids.forEach((k) => { if (!k.op || k.op >= 1) setTint(k, v); }); } }
    const ft = W.foot;
    if (!ft) return;
    // 大きな段ボールの展開先（家具の形の影）
    const up = W.up, gh = W.ghost;
    if (up) {
      if (!gh || gh.k !== up.k) { if (gh) W.scene.remove(gh.n); const n = new Node(); for (const pt of furnParts(up.k)) { const c = new Node(pt.meshes, Object.assign({}, pt.o, { cast: false })); if (pt.p) c.p = pt.p.slice(); if (pt.r) c.r = pt.r.slice(); n.add(c); } W.scene.add(n); W.ghost = { n, k: up.k, v: -1 }; }
      const G2 = W.ghost; G2.n.vis = true; G2.n.p = [up.x, 0, up.z]; G2.n.r = [0, P.dirs(up.r).a, 0];
      const v = up.why ? 5 : 4; if (G2.v !== v) { G2.v = v; G2.n.kids.forEach((k) => { if (!k.op || k.op >= 1) setTint(k, v); }); }
    } else if (gh) gh.n.vis = false;
    const mv = W.mv && s.fu[W.mv.id] ? W.mv : null, dg = W.dropG && W.dropG.show ? W.dropG : null, cur = mv ? { k: s.fu[mv.id].k, x: mv.x, z: mv.z, r: mv.r, why: mv.why } : up || dg;
    if (!cur) { ft.vis = false; return; }
    const [w, d] = cur.it ? (() => { const b = P.floorBox(cur.it, cur.x, cur.z, cur.r); return [b[2] - b[0], b[3] - b[1]]; })() : P.size(cur.k, cur.r);
    ft.vis = true; ft.p = [cur.x, 0.012, cur.z]; ft.s = [w + 0.06, 1, d + 0.06]; ft.color = cur.why ? rgb('#E2574C') : rgb('#5BD18B');
  };
  // 床をねらった位置（配置・展開）
  W.floorAim = function (o, d) {
    let hx, hz;
    if (d[1] < -0.04) { const tt = Math.min(-o[1] / d[1], 5.5); hx = o[0] + d[0] * tt; hz = o[2] + d[2] * tt; } else { hx = o[0] + d[0] * 4; hz = o[2] + d[2] * 4; }
    return [Math.round(hx * 20) / 20, Math.round(hz * 20) / 20];
  };
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
    if (c.st === 'in' || c.st === 'q') { const q = K.queue(s, c.reg); let k = q.indexOf(id); if (k < 0) k = q.length; return W.queueAt(s, c.reg, Math.min(k, 5)); }
    if (c.st === 'pay') { const q = K.payQ(s, c.reg); let k = q.indexOf(id); if (k < 0) k = q.length; return W.payAt(s, c.reg, Math.min(k, 4)); }
    if (c.st === 'w') { const ws = Object.keys(s.cust).filter((x) => s.cust[x].st === 'w').sort((a, b) => s.cust[a].no - s.cust[b].no); return W.waitSpot(s, Math.max(0, ws.indexOf(id))); }
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
      const inside = o.z < RZ - 0.2, wantIn = tgt[1] < RZ;
      let goal = tgt;
      if (inside !== wantIn) goal = Math.abs(o.x) > 0.35 ? [0, inside ? RZ - 0.7 : RZ + 1.0] : [0, wantIn ? RZ - 0.9 : RZ + 1.2];
      const dx = goal[0] - o.x, dz = goal[1] - o.z, d = Math.hypot(dx, dz);
      let mode = 'idle';
      if (d > 0.08) { const v = Math.min(d, dt * 2.4); o.x += (dx / d) * v; o.z += (dz / d) * v; o.r = angLerp(o.r, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10)); mode = 'walk'; }
      else if (c.st === 'eat') { const st = W.seatPos(s, c.seat); if (st) { o.r = angLerp(o.r, st.r, 1 - Math.exp(-dt * 8)); mode = 'sit'; } }
      else if (c.st === 'q' || c.st === 'w' || c.st === 'in' || c.st === 'pay') o.r = angLerp(o.r, PI, 1 - Math.exp(-dt * 6));
      o.atSpot = d <= 0.3 && goal === tgt;
      if (c.paid && !o.happy) { o.happy = performance.now() + 1400; CS.sound.play('coin'); o.coin = true; }
      if (o.happy && performance.now() < o.happy && mode === 'idle') mode = 'happy';
      o.ch.node.p = [o.x, 0, o.z]; o.ch.node.r = [0, o.r, 0];
      o.ch.anim(dt, mode, 0.9);
      o.c = c;
    }
  };
  // ---------- アルバイト ----------
  const TASK_KIND = { mix: 'mixer', bake: 'oven', whip: 'whip', deco: 'deco', wash: 'sink', chef: 'mixer' };
  function staffSpot(s, m) {
    const L = W.L, j = m.job;
    const at = (fid, d) => { const f = fOf(s, fid); if (!f) return null; const q = P.stand(f, d || 0.5); return { x: q[0], z: q[1], fx: f.x, fz: f.z }; };
    if (m.task === 'stock') {
      const cr = j && j.id && s.k.items[j.id];
      if (cr && W.room) { const half = (j.t0 + j.end) / 2; if (W.room.now() < half && String(cr.at).startsWith('dl:')) return { x: L.truck.x, z: L.truck.z - 3.3, fx: L.truck.x, fz: L.truck.z, pick: true }; }
      const sh = cr && (j.dest && s.fu[j.dest] ? j.dest : P.list(s, D.ING[cr.ing] && D.ING[cr.ing].cold ? 'cshelf' : 'shelf')[0]);
      if (sh) { const q = at(sh, 0.6); if (q) return Object.assign(q, { carry: true }); }
      return { x: L.store.x0 + 2.2, z: L.store.z0 + 2.0, fx: L.store.x0, fz: L.store.z0 + 2.0 };
    }
    if (m.task === 'cashier') {
      const c = j && j.c && s.cust[j.c], reg = (c && c.reg) || P.list(s, 'reg')[0];
      const f = reg && fOf(s, reg);
      if (j && j.k === 'serve' && c) { const q = custTarget(s, c, j.c); return { x: clamp(q[0], -RX + 0.5, W.L.g.counter.x1 - 0.3), z: CZ - 0.75, fx: q[0], fz: q[1] }; }
      if (f) return { x: f.x - 0.3, z: CZ - 0.75, fx: f.x, fz: CZ + 2 };
    }
    if (m.task === 'feed') {
      // 機械係：取りに行く所（前半）→ 機械（後半）。ひまなときは最初の自動の機械の前
      if (j) {
        const go = !j.hd && j.from && s.fu[j.from] ? j.from : j.fid && s.fu[j.fid] ? j.fid : j.to ? String(j.to).split(':')[1] : null;
        const gf = go && fOf(s, go);
        if (gf && gf.k === 'line') {
          // 長いライン：材料は左の投入口、ケーキは右の出口
          const lx = go === j.fid && j.k !== 'f-carry' ? -2.1 : 2.2, q = P.local(gf, lx, 0, 0.6 + 0.55), c = P.local(gf, lx, 0, 0);
          return { x: q[0], z: q[2], fx: c[0], fz: c[2], carry: !!j.hd };
        }
        const q = gf && at(go, 0.6); if (q) return Object.assign(q, { carry: !!j.hd });
      }
      const mf = ['line', 'adeco', 'aoven', 'amixer', 'awhip'].map((k) => P.list(s, k)[0]).find(Boolean);
      if (mf) { const q = at(mf, 0.9); if (q) return q; }
    }
    if (j && j.fid && s.fu[j.fid]) { const q = at(j.fid); if (q) return q; }
    const fid = TASK_KIND[m.task] && P.list(s, TASK_KIND[m.task])[0];
    if (fid) { const q = at(fid, 0.75); if (q) return q; }
    return { x: 0, z: -RZ + 4, fx: 0, fz: -RZ };
  }
  // 厨房・パソコン室・渡り廊下・倉庫（別棟）・外（路地）を行き来するときはドアを通る
  function waypoint(o, t) {
    const g = W.L.g, zo = P.zoneOf(g, o.x, o.z), zt = P.zoneOf(g, t.x, t.z);
    if (zo === zt) return [t.x, t.z];
    const door = P.doorPts(g, zo, P.nextZone(zo, zt)), d1 = door[1];
    // ドアの手前の点まで来た／もうドアを通り抜けている途中（壁にさえぎられずに向こうの点が近い）なら、向こう側の点へ
    if (Math.hypot(o.x - door[0][0], o.z - door[0][1]) < 0.3) return d1;
    const d01 = Math.hypot(d1[0] - door[0][0], d1[1] - door[0][1]);
    if (Math.hypot(o.x - d1[0], o.z - d1[1]) < d01 && !(W.rayWalls || []).some((w) => segHit(o.x, o.z, d1[0], d1[1], w))) return d1;
    return door[0];
  }
  W.updateStaff = function (dt, s) {
    const list = s.staff || [];
    for (let i = 0; i < 8; i++) {
      const m = list[i]; let o = W.staffN['staff' + i];
      const key = m ? m.name + JSON.stringify(m.skin || {}) : '';
      if (o && o.key !== key) { W.people.remove(o.ch.node); delete W.staffN['staff' + i]; o = null; }
      if (!m) continue;
      const t = staffSpot(s, m);
      if (!o) { const kp = W._keep && W._keep['staff' + i]; o = W.staffN['staff' + i] = { ch: MD.character(W.eng, Object.assign({}, D.DEFAULT_SKIN, m.skin || {})), key, x: kp ? kp[0] : t.x, z: kp ? kp[1] : t.z, r: kp ? kp[2] : 0 }; W.people.add(o.ch.node); W.addBlob(o.ch.node); }
      const [gx, gz] = waypoint(o, t);
      o.carry = !!t.carry;
      const dx = gx - o.x, dz = gz - o.z, d = Math.hypot(dx, dz);
      let mode = 'idle';
      if (d > 0.06 || gx !== t.x || gz !== t.z) { const v = Math.min(d, dt * 2.4); if (d > 1e-4) { o.x += (dx / d) * v; o.z += (dz / d) * v; o.r = angLerp(o.r, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10)); } mode = 'walk'; }
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
  // 線分が壁の箱を横切るか（上から見て）
  function segHit(ax, az, bx, bz, w) {
    let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
    const chk = (dd, o, lo, hi) => { if (Math.abs(dd) < 1e-9) return o >= lo && o <= hi; let u = (lo - o) / dd, v = (hi - o) / dd; if (u > v) { const x = u; u = v; v = x; } t0 = Math.max(t0, u); t1 = Math.min(t1, v); return t0 <= t1; };
    if (!chk(dx, ax, w[0], w[2]) || !chk(dz, az, w[1], w[3])) return false;
    return t1 > 0.001 && t0 < 0.999;
  }
  const nm = (id) => (D.ING[id] ? D.ING[id].name : id === 'box' ? 'ケーキの箱' : id);
  const yen = (n) => '¥' + Math.round(n || 0).toLocaleString();
  W.itemName = (it, s) => (!it ? '' : K.label(s, it) + (it.t === 'ing' ? ' ×' + it.n : ''));
  // 手に持っている物を捨てるボタンの名前
  W.delLabel = (held) => (!held || held.t === 'fcrate' ? '' : held.t === 'crate' ? ((held.sp || 0) >= 2 && held.n > 0 ? '捨てる' : '') : held.t === 'plate' ? '落とす（割れる）' : held.t === 'pan' && held.st !== 'empty' ? '中身を捨てる' : '捨てる');
  const SHORT = (s, it) => (it.t === 'ing' ? nm(it.ing) + ' ' + it.n : it.t === 'plate' ? (it.dirty ? '汚れたお皿' : 'お皿') : it.t === 'pan' && it.st === 'empty' ? (it.dirty ? '汚れた型' : 'ケーキ型') : K.label(s, it));
  // ケーキに対する操作（ナイフで切る・ホールのまま箱へ・1切れずつ箱／お皿へ）
  function cakeT(s, t, held, top, topId) {
    if (!held || !top || !(top.t === 'cake' || top.t === 'tray') || top.res) return false;
    if (held.t === 'knife') {
      if (top.w) t.pri = { label: 'ケーキナイフで6等分に切る', a: { t: 'cut', id: topId } };
      else t.name += '（もう切ってあります）';
      return true;
    }
    if (held.t !== 'box' && held.t !== 'plate') return false;
    if (held.t === 'plate' && (held.dirty || held.wet)) { t.name += held.dirty ? '（汚れたお皿は洗い場へ）' : '（お皿がまだぬれている）'; return true; }
    if (top.w) {
      if (held.t === 'box' && !(held.s || []).length) t.pri = { label: 'ホールのまま箱に入れる', a: { t: 'hole', id: topId } };
      t.name += held.t === 'box' ? ((held.s || []).length ? '（ホールは空の箱に1台）' : '') + '・切るならケーキナイフで' : '（ケーキナイフで切ってから1切れずつ）';
      return true;
    }
    t.pri = { label: (held.t === 'box' ? '箱' : 'お皿') + 'に1切れ入れる', a: { t: 'slice', id: topId } };
    const last = (held.s || [])[(held.s || []).length - 1];
    if (last && !last[4] && last[0] === top.r && top.p < top.n) t.sec = { label: '1切れ戻す', a: { t: 'unslice', id: topId } };
    return true;
  }
  // 家具の置く所 1か所の操作
  function slotT(s, fid, f, k, sl, held) {
    const at = 'f:' + fid + ':' + k, ids = K.inSlot(s, at), topId = ids.length ? ids[ids.length - 1] : null, top = topId ? s.k.items[topId] : null;
    const T = sl[3], Kd = P.KINDS[f.k], cold = !!Kd.cold;
    const p = P.local(f, sl[0], sl[1], sl[2]);
    if (!top && !held) return T === 'boxes' ? { slot: at, fid, pp: [p[0], p[1] + 0.09, p[2]], rr: 0.2, boost: 0.35, name: W.fname(s, fid) + '（空き：箱の段ボールを持ってきて、開けてしまう）' } : null;
    const t = { slot: at, item: topId, fid, pp: [p[0], p[1] + (T === 'tray' || T === 'out' ? 0.12 : T === 'fridge' ? 0.1 : T === 'crate' ? 0.2 : T === 'boxes' ? 0.09 : 0.07), p[2]], rr: T === 'tray' ? 0.24 : T === 'out' ? 0.2 : T === 'fridge' ? 0.18 : T === 'crate' ? 0.26 : T === 'boxes' ? 0.2 : 0.17 };
    if (T === 'boxes') t.boost = 0.35; // レジの下の箱入れは、レジより先にねらえるように
    if (top) t.name = W.itemName(top, s) + (ids.length > 1 ? '（' + ids.length + 'つ）' : '');
    else t.name = W.fname(s, fid) + (T === 'dry' ? '：水切りかご' : T === 'mixpan' ? '：型置き' : T === 'boxes' ? '：ケーキの箱をしまう所' : T === 'out' ? '：出口' : '') + '（空き' + (T === 'tray' || T === 'any' ? (cold ? '・冷蔵' : '・常温') : '') + '）';
    if (top && top.t === 'tray') t.name = ((sim.recipe(s, top.r) || {}).name || 'ケーキ') + (top.w ? '（ホール・' : '（残り ' + top.p + ' 切れ・') + sim.cakeExpText(s, top.d) + '）';
    if (top && top.res) { t.name += '（アルバイトが使用中）'; return t; }
    if (held) {
      if (held.t === 'crate') {
        if (T === 'boxes') {
          // ケーキの箱の段ボール → 箱入れにしまう
          const close = { label: '段ボールを閉じる', a: { t: 'openCrate', close: 1 } };
          if (held.ing !== 'box') { t.name += '（ケーキの箱だけしまえます）'; return t; }
          if (!held.open) { t.sec = { label: '段ボールを開ける', a: { t: 'openCrate' } }; t.name += '（開けてからしまう）'; return t; }
          if (!(held.n > 0)) { t.sec = close; return t; }
          const room = P.SLOT_CAP.boxes - (top && top.t === 'ing' ? top.n : 0);
          if (top && !(top.t === 'ing' && top.ing === 'box')) { t.name += '（ほかの物が置いてある）'; return t; }
          if (room <= 0) { t.name += '（いっぱい・' + P.SLOT_CAP.boxes + '枚まで）'; t.sec = close; return t; }
          t.pri = { label: '箱を1枚しまう（長押しで続けて）', a: { t: 'shelve', slot: at }, hold: 1 };
          t.sec = { label: 'しまえるだけしまう（' + Math.min(room, held.n) + '）', a: { t: 'shelve', slot: at, all: 1 } };
          t.del = close;
          return t;
        }
        if (T === 'crate') { if (!top) t.pri = { label: held.n > 0 ? '段ボールを在庫棚に置く' : '空の段ボールを在庫棚に置く', a: { t: 'put', slot: at } }; else t.name += '（うまっています）'; t.sec = held.open ? { label: '段ボールを閉じる', a: { t: 'openCrate', close: 1 } } : { label: '段ボールを開ける', a: { t: 'openCrate' } }; return t; }
        if (T !== 'any') return t;
        const onTable = f.k === 'table' && !top, put = onTable ? { label: held.n > 0 ? '段ボールごと机に置く' : '空の段ボールを机に置く', a: { t: 'put', slot: at } } : null;
        const close = { label: '段ボールを閉じる', a: { t: 'openCrate', close: 1 } };
        if (!held.open) { t.pri = put; t.sec = { label: '段ボールを開ける', a: { t: 'openCrate' } }; if (!put && !top) t.name += '（段ボールは棚に入れられません。開けて中身を並べよう）'; return t; }
        if (!(held.n > 0)) { t.pri = put; t.sec = close; if (!put) t.name += '（空の段ボールは床・机に置くか、ゴミ箱へ）'; return t; }
        if ((held.sp || 0) >= 2) { t.name = nm(held.ing) + 'は傷んでいて置けません（ゴミ箱へ）'; return t; }
        if (!top || (top.t === 'ing' && top.ing === held.ing)) {
          const room = K.STACK_CAP.ing - (top ? top.n : 0);
          if (room <= 0) { t.name += '（この枠はいっぱい・1枠10個まで）'; t.sec = close; return t; }
          t.pri = { label: (held.ing === 'box' ? '箱' : nm(held.ing)) + 'を1つ置く（長押しで続けて）', a: { t: 'shelve', slot: at }, hold: 1 };
          t.sec = { label: '置けるだけ置く（' + Math.min(room, held.n) + '）', a: { t: 'shelve', slot: at, all: 1 } };
          t.del = put ? { label: put.label, a: put.a } : close;
          if (D.ING[held.ing] && D.ING[held.ing].cold && !cold) t.name += '・ここは常温（要冷蔵は冷蔵棚へ）';
        } else { t.name += '（ほかの物が置いてある）'; t.sec = close; }
        return t;
      }
      if (cakeT(s, t, held, top, topId)) return t;
      if (held.t === 'cake' && !held.dish && T === 'any' && ids.length === 1 && top && top.t === 'plate' && !(top.s || []).length) {
        if (top.dirty || top.wet) t.name += top.dirty ? '（汚れたお皿）' : '（お皿がぬれている）';
        else t.pri = { label: 'お皿にのせる', a: { t: 'put', slot: at } };
        return t;
      }
      const hb = held.t === 'box' && (held.s || [])[0] && held.s[0][4];
      if (hb && !top) {
        const ck = { t: 'cake', r: held.s[0][0], p: 6, n: 6, w: 1 }, why2 = K.canPut(s, at, ck);
        if (!why2) { t.pri = { label: 'ホールを箱から出して置く', a: { t: 'unhole', slot: at } }; if (T !== 'tray' && !K.canPut(s, at, held)) t.sec = { label: '箱ごと置く', a: { t: 'put', slot: at } }; return t; }
      }
      if (held.t === 'ing' && top && top.t === 'ing' && top.ing === held.ing) {
        // 同じ材料の山：もう1つ取る（長押しで続けて）／1つ戻す／全部戻す
        if (held.n < K.STACK_CAP.ing && (top.sp || 0) < 2) t.pri = { label: 'もう1つ取る（手に ' + held.n + '）', a: { t: 'take', id: topId }, hold: 1 };
        const why = K.canPut(s, at, Object.assign({}, held, { n: 1 }));
        if (!why) { t.sec = { label: '1つ戻す', a: { t: 'put', slot: at, one: 1 } }; t.del = { label: '全部戻す（' + held.n + '）', a: { t: 'put', slot: at } }; }
        else t.name += '（' + why + '）';
        return t;
      }
      const why = K.canPut(s, at, held);
      if (!why) {
        const lbl = T === 'tray' ? (held.t === 'cake' && held.w ? 'ホールのまま並べる' : '並べる') : T === 'fridge' ? '冷蔵庫に入れる' : T === 'mixpan' ? '型を置く' : T === 'dry' ? '水切りかごに置く' : held.t === 'box' && top ? '箱を戻す' : top ? '重ねて置く' : '置く';
        t.pri = { label: lbl, a: { t: 'put', slot: at } };
        if (held.t === 'ing' && held.n > 1 && !top) t.sec = { label: '1つだけ置く', a: { t: 'put', slot: at, one: 1 } };
        if (T === 'tray' && held.t === 'cake' && K.spoilSec(s, held) && !cold) t.name += '・常温（クリームのケーキは傷む）';
        else if (K.spoilSec(s, held) && !cold && T === 'any') t.name += '・常温（要冷蔵）';
      } else t.name += '（' + why + '）';
      return t;
    }
    // 手が空いている
    if (top.t === 'ing') {
      if (top.ing === 'box') t.pri = { label: '箱を1つ取る', a: { t: 'take', id: topId } };
      else { t.pri = { label: '1つ取る（長押しで続けて）', a: { t: 'take', id: topId }, hold: 1 }; t.sec = { label: '全部取る（' + top.n + '）', a: { t: 'take', id: topId, all: 1 } }; }
      if ((top.sp || 0) >= 2) t.name += '（傷んでいる）';
      return t;
    }
    if (top.t === 'tray') { t.sec = { label: 'ケーキごと持つ', a: { t: 'caseTake', id: topId } }; t.name += top.w ? '・ケーキナイフで6等分に切れる／空の箱ならホールのまま入れられる' : '・箱かお皿を持ってくると入れられる'; return t; }
    if (top.t === 'cake') t.name += top.w ? '・ケーキナイフで切れる' : '・箱かお皿で1切れずつ取れる';
    t.pri = { label: ids.length > 1 ? '1つ持つ' : '持つ', a: { t: 'pick', id: topId } };
    return t;
  }
  // 設備（ミキサー・クリーム台・オーブン・デコ台・洗い場）
  function stationT(s, fid, f, Kd, held, pid, add) {
    const b = stOf(s, fid), nmF = W.fname(s, fid), kind = Kd.station, staffBusy = b.by && String(b.by).startsWith('staff');
    if (kind === 'mix' || kind === 'whip' || kind === 'amix' || kind === 'awhip') {
      const t = { name: nmF, station: fid }, auto = kind === 'amix' || kind === 'awhip';
      const ings = b.ings || [];
      if (staffBusy) t.name += '（アルバイトが使用中）';
      else {
        if (held && held.t === 'ing' && held.ing !== 'box' && b.st === 'idle') { t.pri = { label: nm(held.ing) + 'を入れる（残り ' + held.n + '・長押しで続けて）', a: { t: 'addIng', fid }, hold: 1 }; if (auto && held.n > 1 && ings.length < 10) t.sec = { label: '全部入れる（' + Math.min(held.n, 10 - ings.length) + '）', a: { t: 'addIng', fid, all: 1 } }; }
        else if (kind === 'amix' && b.st === 'done' && b.k) {
          if (held && held.t === 'pan' && held.st === 'empty' && !held.dirty && !held.wet) t.pri = { label: '型に流す', a: { t: 'pour', fid } };
          else t.name += '（横の型置きにきれいな型を置くと自動で流し込みます）';
        }
        else if (kind === 'awhip' && !held && b.st === 'done' && b.k) t.pri = { label: 'クリームをすくう', a: { t: 'scoop', fid } };
        else if (kind === 'mix' && b.st === 'done' && b.k) {
          const pz = K.at(s, K.slot0(fid)), ph = pz && s.k.items[pz];
          if (held && held.t === 'pan' && held.st === 'empty') { if (held.dirty) t.name += '（汚れた型は洗い場で洗おう）'; else if (held.wet) t.name += '（型がまだぬれている）'; else t.pri = { label: '型に流す', a: { t: 'pour', fid } }; }
          else if (!held && ph && ph.t === 'pan' && ph.st === 'empty' && !ph.dirty && !ph.wet) t.pri = { label: '横の型に流す', a: { t: 'pour', fid } };
          else if (!held) t.name += '（きれいなケーキ型を持ってこよう）';
        } else if (kind === 'whip' && !held && b.st === 'done' && b.k) t.pri = { label: 'クリームをすくう', a: { t: 'scoop', fid } };
        if (!auto && b.st === 'idle' && ings.length) t.sec = { label: kind === 'mix' ? 'ミキサーを回す' : '泡立てる', a: { t: 'run', fid } };
        if (!auto && b.st === 'run') t.sec = { label: kind === 'mix' ? 'ミキサーを止める' : '泡立てを止める', a: { t: 'run', fid } };
        if (ings.length || b.st === 'done') {
          t.del = { label: 'ボウルを空ける', a: { t: 'dump', fid } };
          // 失敗した生地・クリームは「使う」ボタンでも捨てられる
          if (b.st === 'done' && !b.k && !t.sec) t.sec = t.del;
        }
        if (!t.pri && !held && b.st === 'idle' && !ings.length) t.name += auto ? '（材料を入れるだけ。順番は気にしなくてOK）' : '（棚から材料を持ってきて入れる）';
        if (auto && b.st === 'run') t.name += '（自動で混ぜています）';
      }
      add(kind === 'mix' || kind === 'amix' ? P.local(f, -0.2, 1.1, 0.05) : P.local(f, -0.15, 1.02, 0.04), 0.26, t);
    } else if (kind === 'oven') {
      const sl = K.slot0(fid), id = K.at(s, sl), it = id && s.k.items[id];
      const t = { name: nmF + '（' + (b.h ? b.temp + '℃' : '電源オフ') + '）', station: fid, item: id || null };
      if (it && it.res) t.name += '（アルバイトが使用中）';
      else if (!held && it) t.pri = { label: it.st === 'baking' ? '取り出す' : '持つ', a: { t: 'pick', id } };
      else if (held && !it) { const why = K.canPut(s, sl, held); if (!why) t.pri = { label: 'オーブンに入れる', a: { t: 'put', slot: sl } }; else t.name += '・' + why; }
      const TT = D.OVEN_TEMPS, nx = b.h ? TT[(TT.indexOf(b.temp) + 1) % TT.length] : 170;
      t.sec = { label: b.h ? '温度 ' + b.temp + '→' + nx + '℃' : '電源を入れる（170℃）', a: { t: 'oven', fid, op: b.h ? 'next' : 'set', temp: 170 } };
      if (b.h && !(it && it.st === 'baking')) t.del = { label: '電源を切る', a: { t: 'oven', fid, op: 'off' } };
      add(P.local(f, 0, 0.95, 0.45), 0.42, t);
    } else if (kind === 'deco') {
      const sl = K.slot0(fid), did = K.at(s, sl), dk = did && s.k.items[did];
      const t = { name: nmF, station: fid, item: did || null, deco: fid };
      if (staffBusy) t.name += '（アルバイトが使用中）';
      else {
        if (dk && dk.t === 'cake' && cakeT(s, t, held, dk, did)) { /* ナイフ・箱・お皿 */ }
        else if (!held && dk) t.pri = { label: dk.t === 'cake' ? 'ケーキを持つ' : '持つ', a: { t: 'pick', id: did } };
        else if (held && !dk) { const why = K.canPut(s, sl, held); if (!why) t.pri = { label: held.t === 'pan' ? '型から出してのせる' : 'のせる', a: { t: 'put', slot: sl } }; else t.name += '・' + why; }
        else if (held && held.t === 'ing' && D.TOPS[held.ing] && dk && dk.t === 'deco') t.pri = { label: nm(held.ing) + 'をここに置く（残り ' + held.n + '）', a: { t: 'topPlace', fid }, aim: true };
        if (dk && dk.t === 'deco') {
          if (b.st === 'spread') { if (b.by === pid) t.sec = { label: 'クリームの続きを塗る', spread: fid }; else t.name += '（ほかの人が塗っています）'; }
          else if (held && held.t === 'cream' && !dk.cr) t.sec = { label: 'クリームを塗る（指でなぞる）', a: { t: 'run', fid }, spread: fid };
          else if (!held) t.sec = { label: '仕上げる', a: { t: 'finish', fid } };
          const tp = dk.tp || [], last = tp[tp.length - 1];
          if (last && b.st !== 'spread' && (!held || (held.t === 'ing' && held.ing === last[2]))) t.del = { label: nm(last[2]) + 'を1つ取る', a: { t: 'topTake', fid } };
        }
      }
      add(P.local(f, 0, 1.02, 0.04), 0.25, t);
    } else if (kind === 'aoven') {
      const sl = K.slot0(fid), id = K.at(s, sl), it = id && s.k.items[id];
      const stt = !it ? '空き・生地を入れるだけで焼けます' : it.st === 'baking' ? '焼いています' : it.st === 'baked' ? '焼き上がり' : b.h && (s && W.room && W.room.now() < (b.hot || 0)) ? '予熱中' : '温度を合わせています';
      const t = { name: nmF + '（' + stt + '）', station: fid, item: id || null };
      if (it && it.res) t.name += '（アルバイトが使用中）';
      else if (!held && it) t.pri = { label: it.st === 'baking' ? '途中で取り出す' : '取り出す', a: { t: 'pick', id } };
      else if (held && !it) { const why = K.canPut(s, sl, held); if (!why) t.pri = { label: '自動オーブンに入れる', a: { t: 'put', slot: sl } }; else t.name += '・' + why; }
      add(P.local(f, 0, 0.95, 0.45), 0.42, t);
    } else if (kind === 'adeco') {
      const sl = K.slot0(fid), did = K.at(s, sl), dk = did && s.k.items[did];
      const rn = b.r ? ((sim.recipe(s, b.r) || {}).name || '') : 'おまかせ';
      const t = { name: nmF + '（作るケーキ：' + rn + '）', station: fid, item: did || null };
      if (staffBusy) t.name += '（アルバイトが使用中）';
      else {
        if (dk && dk.t === 'cake' && cakeT(s, t, held, dk, did)) { /* ナイフ・箱・お皿 */ }
        else if (!held && dk && b.st !== 'auto') t.pri = { label: dk.t === 'cake' ? 'ケーキを持つ' : '作りかけを持つ', a: { t: 'pick', id: did } };
        else if (held && held.t === 'cream') t.pri = { label: (D.CREAMS[held.k] || {}).name + 'をタンクにセット', a: { t: 'mcream', fid } };
        else if (held && held.t === 'ing' && D.TOPS[held.ing]) { t.pri = { label: nm(held.ing) + 'を補充（長押しで続けて）', a: { t: 'addIng', fid }, hold: 1 }; if (held.n > 1) t.sec = { label: '全部補充（' + held.n + '）', a: { t: 'addIng', fid, all: 1 } }; }
        else if (held && !dk) { const why = K.canPut(s, sl, held); if (!why) t.pri = { label: held.t === 'pan' ? 'スポンジをのせる（型から出す）' : 'のせる', a: { t: 'put', slot: sl } }; else t.name += '・' + why; }
        if (!held && !t.sec) t.sec = { label: '作るケーキを選ぶ', ui: 'amode:' + fid };
        if (b.cr && b.cr.n > 0 && b.st !== 'auto' && !t.del) t.del = { label: 'クリームのタンクを空ける', a: { t: 'dump', fid } };
      }
      add(P.local(f, -0.18, 1.05, 0.08), 0.3, t);
    } else if (kind === 'line') {
      const rn = b.r ? ((sim.recipe(s, b.r) || {}).name || '') : 'おまかせ';
      const t = { name: nmF + '：投入口（' + (b.on ? '運転中' : '停止中') + '・' + rn + '）', station: fid };
      if (held && held.t === 'ing' && held.ing !== 'box') { t.pri = { label: nm(held.ing) + 'を投入（長押しで続けて）', a: { t: 'addIng', fid }, hold: 1 }; if (held.n > 1) t.sec = { label: '全部投入（' + held.n + '）', a: { t: 'addIng', fid, all: 1 } }; }
      else if (!held) { t.name += '（材料を持ってきて入れるだけ）'; t.sec = { label: '作るケーキを選ぶ', ui: 'amode:' + fid }; if (Object.keys(b.hop || {}).length) t.del = { label: '投入口の材料を棚に戻す', a: { t: 'dump', fid } }; }
      add(P.local(f, -2.3, 1.42, 0.05), 0.42, t);
      add(P.local(f, -1.25, 1.1, 0.45), 0.24, { name: nmF + '：操作パネル（' + (b.on ? '運転中' : '停止中') + '・作るケーキ：' + rn + '）', station: fid, pri: { label: b.on ? 'ラインを止める' : 'ラインを動かす', a: { t: 'lineOn', fid } }, sec: { label: '作るケーキを選ぶ', ui: 'amode:' + fid } });
    } else if (kind === 'sink') {
      const sl = K.slot0(fid), id = K.at(s, sl), it = id && s.k.items[id];
      const t = { name: nmF, station: fid, item: id || null };
      if (b.by && b.by !== pid) t.name += staffBusy ? '（アルバイトが洗っています）' : '（ほかの人が洗っています）';
      else if (!it) {
        if (held) { const why = K.canPut(s, sl, held); if (!why) t.pri = { label: '流しに入れる', a: { t: 'put', slot: sl } }; else t.name += '・' + why; }
        else t.name += '（汚れたお皿・ケーキ型を入れて洗う）';
      } else {
        t.name = '流し：' + K.label(s, it);
        if (!held) t.pri = { label: '持つ', a: { t: 'pick', id } };
        if (it.dirty) t.sec = { label: '洗う（こすって泡立てる）', wash: fid };
        else if (it.wet) t.name += '（持って棚や水切りかごへ。置くと30秒で乾く）';
      }
      add(P.local(f, -0.36, 0.95, 0.02), 0.26, t);
    }
  }
  function trashT(held) {
    const t = { name: 'ゴミ箱' };
    if (!held) return t;
    if (held.t === 'crate' && held.n > 0 && (held.sp || 0) < 2) { t.name += '（中身は棚に置こう）'; return t; }
    t.pri = { label: held.t === 'crate' ? (held.n > 0 ? '傷んだ段ボールを捨てる（廃棄）' : '空の段ボールを捨てる') : held.t === 'plate' ? 'お皿を捨てる（1枚減る）' : held.t === 'pan' && held.st === 'empty' ? '型を捨てる（1つ減る）' : held.t === 'pan' ? '中身を捨てる（型は残る）' : '捨てる', a: { t: 'trash' } };
    return t;
  }
  function payAct(c, id) { return c.pm === 'card' ? { label: 'カードをタッチしてお会計（' + yen(c.due) + '）', a: { t: 'pay', c: id } } : { label: 'お会計（' + yen(c.tend) + ' お預かり・お釣りを選ぶ）', pay: id }; }
  function regT(s, fid) {
    const t = { name: W.fname(s, fid), reg: fid };
    const pq = K.payQ(s, fid), q = K.queue(s, fid);
    const pc = pq[0] && s.cust[pq[0]], po = pq[0] && W.custs[pq[0]], oc = q[0] && W.custs[q[0]];
    let pay = null, ord = null;
    if (pc && po && po.atSpot && !pc.res) pay = payAct(pc, pq[0]);
    if (oc && oc.atSpot) ord = { label: '注文を受ける', a: { t: 'takeOrder', c: q[0] } };
    t.pri = pay || ord; if (pay && ord) t.sec = ord;
    if (pq.length) t.name += '（お会計待ち ' + pq.length + '人）';
    else if (!q.length) t.name += '（お客さんを待っています）';
    return t;
  }
  W.updateTarget = function (s, g) {
    W.target = null; W.aim = null;
    if (!s || !W.room || W.blocked()) { if (W.onTarget) W.onTarget(null, null); return; }
    const L = W.L, o = W.eng.cam.pos, d = W.fwd, pid = W.room.pid;
    const hid = K.held(s, pid), held = hid ? s.k.items[hid] : null;
    W.up = null; W.dropG = null;
    if (W.bm) { const t = W.buildTarget(s, o, d); W.target = t; if (W.onTarget) W.onTarget(t, held); return; }
    if (held && held.t === 'fcrate' && P.KINDS[held.k]) {
      // 大きな段ボール：置きたい床をねらって展開する
      const Kd = P.KINDS[held.k], [x, z] = W.floorAim(o, d), r = Kd.counter ? 0 : (W.upR || 0) % 4, zz = Kd.counter ? CZ : z;
      const why = P.valid(s, null, held.k, x, zz, r);
      W.up = { k: held.k, x, z: zz, r, why };
      const t = { name: Kd.name + '：' + (why || 'ここに展開できます'), unpack: 1,
        pri: why ? null : { label: 'ここに展開する', a: { t: 'unpack', x, z: zz, r } },
        sec: Kd.counter ? null : { label: '向きを変える', fn: () => { W.upR = ((W.upR || 0) + 1) % 4; } } };
      const fw = P.floorOk(s, held, x, z, (W.upR || 0) % 2, hid);
      if (!fw && Math.hypot(x - o[0], z - o[2]) < 3.4) t.del = { label: '段ボールのまま床に置く', a: { t: 'floor', x, z, r: (W.upR || 0) % 2 } };
      W.target = t; if (W.onTarget) W.onTarget(t, held); return;
    }
    const cands = [];
    const reachable = (p) => { for (const w of W.rayWalls) if (segHit(o[0], o[2], p[0], p[2], w)) return false; return true; };
    const add = (p, r, t, reach) => { if (!t) return; const dist = raySphere(o, d, p, r); if (dist >= 0 && dist <= (reach || REACH) && reachable(p)) cands.push(Object.assign(t, { dist: dist - (t.boost || 0), p })); };
    // 機械の本体をねらっていれば、その機械の操作（照準が少しずれても、手の物を捨ててしまわないように）
    const bodyHits = [];
    const working = s.phase === 'prep' || s.phase === 'open';
    // 家具（置く所・設備）
    for (const fid in s.fu) {
      const f = fOf(s, fid), Kd = P.KINDS[f.k]; if (!Kd) continue;
      if (Math.hypot(f.x - o[0], f.z - o[2]) > REACH + 1.8) continue;
      if (Kd.station) {
        stationT(s, fid, f, Kd, held, pid, add);
        const bb = P.box(f), bd = rayBox(o, d, [bb[0], 0, bb[1]], [bb[2], Kd.h || 1, bb[3]]);
        if (bd >= 0 && bd <= REACH && reachable([f.x, 1, f.z])) bodyHits.push({ fid, f, Kd, dist: bd });
      }
      if (f.k === 'trash') add(P.local(f, 0, 0.6, 0), 0.32, trashT(held));
      if (f.k === 'reg') add(P.local(f, -0.1, 1.05, 0), 0.48, regT(s, fid));
      Kd.slots.forEach((sl, k) => { if (sl[3] === 'turn' || sl[3] === 'oven' || sl[3] === 'basin') return; const t = slotT(s, fid, f, k, sl, held); if (t) add(t.pp, t.rr, t); });
    }
    // 客席の汚れたお皿・トラックの段ボール
    for (const id in s.k.items) {
      const it = s.k.items[id], at = String(it.at);
      if (at === 'fl') {
        const hg = it.t === 'fcrate', hh = hg ? 0.45 : 0.2;
        add([it.fx, hh, it.fz], hg ? 0.5 : 0.32, { item: id, name: W.itemName(it, s) + '（床）', pri: !held ? { label: hg ? '大きな段ボールを持つ' : '段ボールを持つ', a: { t: 'pick', id } } : null });
        continue;
      }
      if (!(at.startsWith('seat:') || at.startsWith('dl:'))) continue;
      if ((it.t === 'crate' || it.t === 'fcrate') && (it.ar > g || (s.k.truck && s.k.truck.out))) continue;
      const sw = slotWorld(s, at); if (!sw) continue;
      const hg = it.t === 'fcrate';
      add([sw.p[0], sw.p[1] + (hg ? 0.35 : it.t === 'crate' ? 0.17 : 0.05), sw.p[2]], hg ? 0.45 : it.t === 'crate' ? 0.28 : 0.16, { item: id, name: W.itemName(it, s) + (hg ? '（持って、置きたい所で展開）' : ''), pri: !held ? { label: hg ? '大きな段ボールを持つ' : '持つ', a: { t: 'pick', id } } : null }, at.startsWith('dl:') ? 3.4 : 0);
    }
    add(L.pcScr, 0.36, { name: 'パソコン（仕入れ・家具・経営）', pri: { label: 'パソコンを使う', ui: 'pc' } });
    add([L.board[0] + 0.1, 1.75, L.board[1]], 0.7, { name: 'メニュー黒板', pri: { label: 'メニューと価格', ui: 'menu' } });
    add([L.sign[0], 0.55, L.sign[1]], 0.45, { name: '店の看板（' + (s.phase === 'open' ? 'OPEN' : 'CLOSED') + '）', pri: working ? { label: s.phase === 'open' ? 'CLOSE にする' : 'OPEN にする', a: { t: 'sign' } } : null });
    // お客さん
    for (const id in W.custs) {
      const oc = W.custs[id], c = s.cust[id]; if (!c) continue;
      const t = { name: 'お客さん', cust: id };
      if (c.st === 'q' && K.queue(s, c.reg)[0] === id && oc.atSpot) t.pri = { label: '注文を受ける', a: { t: 'takeOrder', c: id } };
      if (c.st === 'w') { t.name = '注文 #' + c.no + '：' + K.ordText(s, c.ord, c.wh) + (c.dine ? '（店内・お皿で）' : '（持ち帰り・箱で）'); if (held && (held.t === 'box' || held.t === 'plate')) t.pri = { label: (held.t === 'box' ? '箱' : 'お皿') + 'を渡す', a: { t: 'serve', c: id } }; }
      if (c.st === 'pay') { t.name = 'お会計待ち（' + (c.pm === 'card' ? 'カード' : '現金 ' + yen(c.tend)) + '）'; if (K.payQ(s, c.reg)[0] === id && oc.atSpot && !c.res) t.pri = payAct(c, id); }
      if (c.st === 'eat') t.name = 'お客さん（店内で食べています）';
      // ねらって「帰ってもらう」（押しまちがえないように、2回押すと帰ってもらう）
      if (c.st !== 'out' && working) {
        const armed = W._shoo && W._shoo.id === id && performance.now() < W._shoo.until;
        t.del = { label: armed ? 'もう一度押すと帰ってもらう' : '帰ってもらう', fn: () => { if (W._shoo && W._shoo.id === id && performance.now() < W._shoo.until) { W._shoo = null; send({ t: 'shoo', c: id }); } else { W._shoo = { id, until: performance.now() + 2600 }; CS.ui.toast('もう一度「帰ってもらう」を押すと、このお客さんに帰ってもらいます'); } } };
      }
      add([oc.x, 1.25, oc.z], 0.42, t);
    }
    cands.sort((a, b) => a.dist - b.dist);
    bodyHits.sort((a, b) => a.dist - b.dist);
    const bh = bodyHits[0];
    if (bh && (!cands.length || (cands[0].dist > bh.dist + 0.45 && cands[0].station !== bh.fid && cands[0].fid !== bh.fid))) {
      const extra = []; stationT(s, bh.fid, bh.f, bh.Kd, held, pid, (p, r, t2) => { if (t2) extra.push(Object.assign(t2, { dist: bh.dist, p })); });
      if (extra.length) cands.unshift(extra[0]);
    }
    let t = cands[0] || null;
    // 段ボール（空でもOK）を持っているとき → 床に置ける（床をねらう／前を向いていれば足もとの少し先）
    if (held && held.t === 'crate') {
      const aimF = d[1] < -0.08, fl = aimF ? W.floorAim(o, d) : [Math.round((W.me.x - Math.sin(W.me.yaw) * 0.9) * 20) / 20, Math.round((W.me.z - Math.cos(W.me.yaw) * 0.9) * 20) / 20];
      const r = Math.abs(Math.sin(W.me.yaw)) > 0.7 ? 1 : 0, far = Math.hypot(fl[0] - o[0], fl[1] - o[2]) > 3.0;
      const tryAt = (x, z) => { const bx = P.floorBox(held, x, z, r), nearMe = Math.hypot(W.me.x - clamp(W.me.x, bx[0], bx[2]), W.me.z - clamp(W.me.z, bx[1], bx[3])) < 0.3; return nearMe ? '足もとすぎます（少し先の床をねらおう）' : P.floorOk(s, held, x, z, r, hid); };
      let x = fl[0], z = fl[1], why = far ? 'もう少し近くの床をねらおう' : tryAt(x, z);
      // 少しずらせば置けるなら、そこに
      if (why && !far) for (const [dx, dz] of [[0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) { if (!tryAt(x + dx, z + dz)) { x = Math.round((x + dx) * 100) / 100; z = Math.round((z + dz) * 100) / 100; why = ''; break; } }
      const label = held.n > 0 ? '段ボールを床に置く' : '空の段ボールを床に置く', act = { t: 'floor', x, z, r };
      W.dropG = { it: held, x, z, r, why, show: !t && aimF };
      if (!t && aimF) t = { name: '床' + (why ? '：' + why : '（段ボールを置ける）'), dist: 1, p: [x, 0, z], floor: 1, pri: why ? null : { label, a: act } };
      else if (t && !t.del && !why) t.del = { label, a: act };
      else if (!t && !why) t = { name: W.itemName(held, s), dist: 0, p: o, del: { label: label + '（前）', a: act } };
    }
    // 段ボールを持っているときは、どこでも「開ける／閉じる」ができる
    if (held && held.t === 'crate' && !(t && t.sec)) { t = t || { name: W.itemName(held, s), dist: 0, p: o }; t.sec = held.open ? { label: '段ボールを閉じる', a: { t: 'openCrate', close: 1 } } : { label: '段ボールを開ける', a: { t: 'openCrate' } }; }
    if (t && t.pri && t.pri.aim) {
      // 回転台のケーキの上面の照準 → ケーキの向きに合わせた -1〜1 の位置
      const f = fOf(s, t.deco), dk = s.k.items[K.at(s, K.slot0(t.deco))];
      const c = P.local(f, 0, 0.975, 0.04), y = c[1] + W.topY(dk);
      t.aimOK = false;
      if (d[1] < -0.05) {
        const tt = (y - o[1]) / d[1], hx = o[0] + d[0] * tt - c[0], hz = o[2] + d[2] * tt - c[2];
        const a = P.dirs(f.r).a + ((W.fn[t.deco] && W.fn[t.deco].a) || 0), R = 0.09 * 0.92 * CAKE_SC;
        const lx = (hx * Math.cos(a) - hz * Math.sin(a)) / R, lz = (hx * Math.sin(a) + hz * Math.cos(a)) / R;
        t.pri.a = Object.assign({}, t.pri.a, { x: +lx.toFixed(2), z: +lz.toFixed(2) });
        t.aimOK = Math.hypot(lx, lz) <= 1.02;
        W.aim = { x: c[0] + hx, y, z: c[2] + hz, ok: t.aimOK };
      }
    }
    W.target = t;
    if (W.onTarget) W.onTarget(t, held);
  };
  // ---------- 配置モード ----------
  W.buildTarget = function (s, o, d) {
    const mv = W.mv;
    if (mv) {
      const f = s.fu[mv.id]; if (!f) { W.mv = null; return null; }
      const Kd = P.KINDS[f.k];
      let hx, hz;
      if (d[1] < -0.04) { const tt = Math.min(-o[1] / d[1], 5.5); hx = o[0] + d[0] * tt; hz = o[2] + d[2] * tt; } else { hx = o[0] + d[0] * 4; hz = o[2] + d[2] * 4; }
      mv.x = Math.round(hx * 20) / 20; mv.z = Kd.counter ? CZ : Math.round(hz * 20) / 20;
      if (Kd.counter) mv.r = 0;
      mv.why = P.valid(s, mv.id, f.k, mv.x, mv.z, mv.r);
      return { name: Kd.name + '：' + (mv.why || 'ここに置けます'), fid: mv.id, build: 1,
        pri: mv.why ? null : { label: 'ここに置く', fn: () => W.placeMove() },
        sec: Kd.counter ? null : { label: '向きを変える', fn: () => { mv.r = (mv.r + 1) % 4; } },
        del: { label: 'やめる', fn: () => { W.mv = null; W.placeFurn(s); } } };
    }
    let best = null;
    for (const fid in s.fu) {
      const f = s.fu[fid], Kd = P.KINDS[f.k]; if (!Kd) continue;
      const b = P.box(f), lowC = f.k === 'reg', y0 = lowC ? CT : 0, h = lowC ? 0.45 : Kd.h;
      const dist = rayBox(o, d, [b[0], y0, b[1]], [b[2], y0 + h, b[3]]);
      if (dist >= 0 && dist < 7 && (!best || dist < best.dist)) best = { fid, dist };
    }
    const t = { name: '配置モード：動かしたい家具をねらう', build: 1, del: { label: '配置をおわる', fn: () => W.setBuild(false) } };
    if (best) {
      const f = s.fu[best.fid], Kd = P.KINDS[f.k];
      t.name = W.fname(s, best.fid) + (Kd.counter ? '（カウンターの上で左右に動かせる）' : ''); t.fid = best.fid;
      t.pri = { label: '動かす', fn: () => { W.mv = { id: best.fid, x: f.x, z: f.z, r: f.r }; } };
      if (!Kd.counter) t.sec = { label: '向きを変える', fn: () => W.rotateNow(best.fid) };
    }
    return t;
  };
  W.placeMove = function () {
    const mv = W.mv; if (!mv || !W.S) return;
    if (mv.why) { CS.ui.toast(mv.why, 'err'); return; }
    W.hold = { id: mv.id, x: mv.x, z: mv.z, r: mv.r, until: performance.now() + 2500 };
    W.mv = null;
    send({ t: 'fmove', id: W.hold.id, x: W.hold.x, z: W.hold.z, r: W.hold.r });
  };
  W.rotateNow = function (fid) {
    const s = W.S, f = s && s.fu[fid]; if (!f) return;
    const r = (f.r + 1) % 4, why = P.valid(s, fid, f.k, f.x, f.z, r);
    if (why) { CS.ui.toast('その場では回せません：' + why + '（「動かす」で場所を変えて回そう）', 'err'); return; }
    W.hold = { id: fid, x: f.x, z: f.z, r, until: performance.now() + 2500 };
    send({ t: 'fmove', id: fid, x: f.x, z: f.z, r });
  };
  // 操作（つかむ・置く／使う／捨てる）
  const REPEAT_OK = { addIng: 1, slice: 1, unslice: 1, shelve: 1, take: 1, put: 1, topPlace: 1, topTake: 1, mcream: 1 };
  function send(a) {
    if (!a || !W.room) return;
    // 連打・通信待ちの二重送信を防ぐ（同じ操作は 0.6 秒あける。続けて置く・取る操作はのぞく）
    const k = JSON.stringify(a), t = performance.now();
    if (W._last && W._last.k === k && t - W._last.t < 600 && !REPEAT_OK[a.t]) return;
    W._last = { k, t };
    CS.sound.play(a.t === 'put' || a.t === 'pick' || a.t === 'take' || a.t === 'trash' || a.t === 'shelve' || a.t === 'fmove' ? 'put' : a.t === 'openCrate' ? 'pop' : a.t === 'drop' ? 'bad' : 'tap');
    if (W.onSend) W.onSend(a);
    W.room.act(a);
  }
  W.send = send;
  W.primary = function () {
    const t = W.target;
    if (t && t.pri) {
      if (t.pri.fn) { CS.sound.play('tap'); t.pri.fn(); return; }
      if (t.pri.ui) { if (W.onUI) W.onUI(t.pri.ui); return; }
      if (t.pri.pay) { if (W.onPay) W.onPay(t.pri.pay); return; }
      if (t.pri.aim && !t.aimOK) { CS.ui.toast('ケーキの上をねらって置こう', 'err'); return; }
      send(t.pri.a); return;
    }
    const s = W.S; if (s && W.room && !W.bm && K.held(s, W.room.pid) && !t) CS.ui.toast('置き場をねらって「置く」。いらない物はゴミ箱へ');
  };
  W.secondary = function () {
    const t = W.target; if (!t || !t.sec) return;
    if (t.sec.fn) { CS.sound.play('tap'); t.sec.fn(); return; }
    if (t.sec.ui) { CS.sound.play('tap'); if (W.onUI) W.onUI(t.sec.ui); return; }
    if (t.sec.pay) { if (W.onPay) W.onPay(t.sec.pay); return; }
    if (t.sec.wash) { if (W.onWash) W.onWash(t.sec.wash); return; }
    if (t.sec.a) send(t.sec.a);
    if (t.sec.spread !== undefined && W.onSpread) W.onSpread(t.sec.spread);
  };
  // 長押しで続けて置く・取る・入れる
  W.primaryHold = function (on) {
    clearInterval(W._holdT); W._holdT = null;
    if (!on) return;
    W._holdT = setInterval(() => { const t = W.target; if (!t || !t.pri || !t.pri.hold) { clearInterval(W._holdT); W._holdT = null; return; } send(t.pri.a); }, 180);
  };
  W.discard = function () {
    const t = W.target;
    if (t && t.del) { if (t.del.fn) { CS.sound.play('tap'); t.del.fn(); } else send(t.del.a); return; }
    if (W.bm) return;
    const s = W.S; if (!s || !W.room) return;
    const hid = K.held(s, W.room.pid); if (!hid) return;
    const it = s.k.items[hid];
    if (it.t === 'fcrate') { CS.ui.toast('置きたい床をねらって「ここに展開する」', 'err'); return; }
    if (it.t === 'crate' && !((it.sp || 0) >= 2 && it.n > 0)) { if (W.dropG && !W.dropG.why) { send({ t: 'floor', x: W.dropG.x, z: W.dropG.z, r: W.dropG.r }); return; } CS.ui.toast('段ボールは床（足もと）をねらって置こう。空ならゴミ箱へ', 'err'); return; }
    if (it.t === 'plate') { send({ t: 'drop' }); return; }
    send({ t: 'trash' });
  };

  // =====================================================================
  //  ラベル（設備の状態・ゲージ・棚の中身・お客さんの吹き出し・名前）
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
    if (fr.stage >= 2) return `<small class="bad">傷んでいる（${crate || (it && it.t === 'ing') ? 'ゴミ箱へ' : '使うとクレームに'}）</small>`;
    if (fr.cold) return `<small class="cold">❄ 冷えている${fr.stage ? '・少しぬるくなっていた' : '・傷まない'}</small>`;
    return `<small class="${fr.stage ? 'bad' : 'warn'}">要冷蔵・常温であと ${mmss(fr.left)} で傷む${fr.stage ? '（ぬるい）' : ''}</small><span class="frb"><u style="width:${Math.round(fr.f * 100)}%"></u></span>`;
  };
  function setHTML(el, h) { if (el._h !== h) { if (!el._h || el._h.length !== h.length) el._hh = null; el._h = h; el.innerHTML = h; } }
  const esc = (x) => CS.art.esc(x);
  function prog(f) { return `<span class="pb"><i style="width:${(clamp(f, 0, 1) * 100).toFixed(0)}%"></i></span>`; }
  function meter(m, lo, hi, max) { return `<span class="dm"><u style="left:${((lo / max) * 100).toFixed(1)}%;width:${(((hi - lo) / max) * 100).toFixed(1)}%"></u><b style="left:${(clamp(m / max, 0, 1) * 100).toFixed(1)}%"></b></span>`; }
  const dryLeft = (it, g) => (it.wet ? (it.wd ? Math.max(0, Math.ceil((it.wd - g) / 1000)) : Math.ceil((D.RULES.DRY_MS || 30000) / 1000)) : 0);
  W.updateLabels = function (s, g) {
    if (!s) return;
    for (const k in W.lbl) W.lbl[k]._used = false;
    const tg = W.target, pid = W.room && W.room.pid;
    const near = (x, z, r) => distMe(x, z) < (r || 3.4);
    if (W.bm) {
      // 配置モード：家具の名前
      for (const fid in s.fu) {
        const f = fOf(s, fid), Kd = P.KINDS[f.k]; if (!Kd || distMe(f.x, f.z) > 9) continue;
        const sel = (W.mv && W.mv.id === fid) || (tg && tg.fid === fid);
        const el = lab('bm-' + fid, 'nm-lb' + (sel ? ' player' : ' staff'));
        setHTML(el, esc(W.fname(s, fid)) + (W.mv && W.mv.id === fid && W.mv.why ? `<small>${esc(W.mv.why)}</small>` : ''));
        place(el, [f.x, (Kd.counter ? CT + 0.5 : Kd.h + 0.15), f.z], 0, sel ? 0.95 : 0.75);
      }
    } else for (const fid in s.fu) {
      const f = fOf(s, fid), Kd = P.KINDS[f.k]; if (!Kd) continue;
      const b = stOf(s, fid), look = tg && tg.station === fid, kind = Kd.station;
      if (kind === 'mix' || kind === 'whip') {
        const ings = b.ings || [];
        if (look || (b.st === 'run' && near(f.x, f.z, 6)) || (near(f.x, f.z, 2.6) && (ings.length || b.st !== 'idle'))) {
          const el = lab('st' + fid, 'st-lb' + (look ? ' near' : ''));
          const gauge = K.gauge(s, kind);
          let h = `<b>${esc(W.fname(s, fid))}</b>`;
          if (b.by && String(b.by).startsWith('staff')) h += '<small>アルバイトが作業中</small>';
          if (ings.length && b.st !== 'done') { const cnt = {}; ings.forEach((x) => (cnt[x] = (cnt[x] || 0) + 1)); h += `<small>${Object.keys(cnt).map((x) => esc(nm(x)) + '×' + cnt[x]).join(' ')}</small>`; const id = kind === 'mix' ? K.baseFromIngs(ings) : K.creamFromIngs(ings); h += `<small class="${id ? 'ok' : ''}">${id ? '→ ' + esc(kind === 'mix' ? D.BASES[id].name : D.CREAMS[id].name) : '（レシピの材料にまだ足りない）'}</small>`; }
          if (b.st === 'run') h += meter(K.prog(b, g), gauge.lo, gauge.hi, 1.5) + '<small>緑のところで止める</small>';
          if (b.st === 'done') h += `<small class="${b.k ? 'ok' : 'bad'}">${b.k ? esc(kind === 'mix' ? D.BASES[b.k].name : D.CREAMS[b.k].name) + ' 完成' + (b.df && b.df.length ? '（' + b.df.map((x) => esc(D.DEFECTS[x].name)).join('・') + '）' : '') + (kind === 'mix' ? '・型に流そう' : '・すくって使おう') : '失敗…ボウルを空けよう'}</small>`;
          if (!ings.length && b.st === 'idle') h += '<small>棚から材料を持ってきて入れる</small>';
          setHTML(el, h); place(el, kind === 'mix' ? P.local(f, -0.2, 1.7, 0.05) : P.local(f, -0.15, 1.45, 0.04));
        }
      } else if (kind === 'amix' || kind === 'awhip') {
        const ings = b.ings || [];
        if (look || (b.st === 'run' && near(f.x, f.z, 6)) || (near(f.x, f.z, 2.6) && (ings.length || b.st !== 'idle'))) {
          const el = lab('st' + fid, 'st-lb auto' + (look ? ' near' : ''));
          const nmK = (id) => (kind === 'amix' ? D.BASES[id].name : D.CREAMS[id].name);
          let h = `<b>${esc(W.fname(s, fid))}</b>`;
          if (b.by && String(b.by).startsWith('staff')) h += '<small>アルバイトが材料を入れています</small>';
          if (ings.length && b.st !== 'done') { const cnt = {}; ings.forEach((x) => (cnt[x] = (cnt[x] || 0) + 1)); h += `<small>${Object.keys(cnt).map((x) => esc(nm(x)) + '×' + cnt[x]).join(' ')}</small>`; const id = kind === 'amix' ? K.baseFromIngs(ings) : K.creamFromIngs(ings); if (b.st === 'idle') h += `<small class="${id ? 'ok' : ''}">${id ? '→ ' + esc(nmK(id)) : '（レシピの材料にまだ足りない）'}</small>`; }
          if (b.st === 'idle' && b.why) h += `<small class="${/合いません/.test(b.why) ? 'bad' : 'ok'}">${esc(b.why)}</small>`;
          if (b.st === 'run') h += prog((g - b.t0) / Math.max(1, (b.sec || 1) * 1000)) + '<small>自動で混ぜています</small>';
          if (b.st === 'done') h += `<small class="${b.k ? 'ok' : 'bad'}">${b.k ? esc(nmK(b.k)) + ' 完成' + (kind === 'amix' ? '・横の型置きにきれいな型を置くと自動で流します' : '・すくって自動デコ機のタンクへ（残り ' + (b.n || 0) + '）') : '失敗…ボウルを空けよう'}</small>`;
          if (!ings.length && b.st === 'idle') h += '<small>材料を入れるだけで自動で混ぜます</small>';
          setHTML(el, h); place(el, kind === 'amix' ? P.local(f, -0.2, 1.75, 0.05) : P.local(f, -0.15, 1.5, 0.04));
        }
      } else if (kind === 'aoven') {
        const id = K.at(s, K.slot0(fid)), it = id && s.k.items[id];
        if (look || (it && near(f.x, f.z, 6))) {
          const el = lab('st' + fid, 'st-lb auto' + (look ? ' near' : ''));
          let h = `<b>${esc(W.fname(s, fid))}</b>`;
          if (!it) h += '<small>生地を流した型を入れるだけ。温度も時間も自動です</small>';
          else if (it.st === 'raw') h += `<small>${b.h && g < (b.hot || 0) ? '予熱中… ' + b.temp + '℃（終わると自動で焼き始めます）' : '焼き始めます'}</small>`;
          else if (it.st === 'baking' && it.bk) h += `<small>${esc((D.BASES[it.b] || {}).name || '')}・${it.bk.temp}℃・あと${Math.max(0, Math.ceil((it.bk.t0 + it.bk.dur - g) / 1000))}秒</small>` + prog((g - it.bk.t0) / Math.max(1, it.bk.dur));
          else if (it.st === 'baked') h += '<small class="ok">焼き上がり（ちょうどよく止めました）・デコ台へ</small>';
          setHTML(el, h); place(el, P.local(f, 0, 1.8, 0.4));
        }
      } else if (kind === 'adeco') {
        const did = K.at(s, K.slot0(fid)), dk = did && s.k.items[did];
        if (look || (dk && near(f.x, f.z, 3.2)) || (near(f.x, f.z, 2.2) && b.cr)) {
          const el = lab('st' + fid, 'st-lb auto' + (look ? ' near' : ''));
          const rn = b.r ? (sim.recipe(s, b.r) || {}).name || '' : 'おまかせ';
          let h = `<b>${esc(W.fname(s, fid))}</b><small>作るケーキ：${esc(rn)}</small>`;
          const tank = b.cr && b.cr.n > 0 ? esc(D.CREAMS[b.cr.k].short || D.CREAMS[b.cr.k].name) + '×' + b.cr.n : 'なし';
          const hop = Object.keys(b.hop || {}).filter((k) => K.hopN(b, k) > 0).map((k) => esc(nm(k)) + '×' + K.hopN(b, k)).join(' ');
          h += `<small>クリーム：${tank}　トッピング：${hop || 'なし'}</small>`;
          if (b.ph === 'coat') h += prog(1 - ((b.t1 || g) - g) / K.AUTO_MS.coat) + '<small>クリームを塗っています</small>';
          else if (b.ph === 'top') h += '<small>トッピングをのせています</small>';
          else if (b.ph === 'fin') h += '<small>仕上げています</small>';
          else if (dk && dk.t === 'cake') h += `<small class="ok">${esc((sim.recipe(s, dk.r) || {}).name || '')} 完成！ショーケースへ</small>`;
          else if (b.why) h += `<small class="bad">${esc(b.why)}</small>`;
          else if (!dk) h += '<small>焼けた型をのせる（クリームはタンク、トッピングは補充口へ）</small>';
          if (b.made) h += `<small>今日 ${b.made} 台</small>`;
          setHTML(el, h); place(el, P.local(f, 0, 1.75, 0.04));
        }
      } else if (kind === 'line') {
        if (look || near(f.x, f.z, 4.5)) {
          const el = lab('st' + fid, 'st-lb auto' + (look ? ' near' : ''));
          const rn = b.r ? (sim.recipe(s, b.r) || {}).name || '' : 'おまかせ';
          let h = `<b>${esc(W.fname(s, fid))}（${b.on ? '運転中' : '停止中'}）</b><small>作るケーキ：${esc(rn)}</small>`;
          const hop = Object.keys(b.hop || {}).filter((k) => K.hopN(b, k) > 0).map((k) => esc(nm(k)) + '×' + K.hopN(b, k));
          h += `<small>投入口：${hop.length ? hop.slice(0, 8).join(' ') + (hop.length > 8 ? ' …' : '') : '空'}</small>`;
          const q = (b.q || []).filter((j) => j && j.r);
          if (q.length) { const cnt = [0, 0, 0, 0, 0]; q.forEach((j) => { const k = W.lineStage(j, g).k; if (k < 5) cnt[k]++; }); h += `<small>${K.LINE_STAGES.map((x, i) => esc(x) + ' ' + cnt[i]).join(' → ')}</small>`; }
          if (b.why) h += `<small class="${b.on ? 'bad' : ''}">${esc(b.why)}</small>`;
          if (b.need && sim.recipe(s, b.need)) { const nd = K.lineReq(s, fid, b.need), miss = Object.keys(nd).filter((k) => K.hopN(b, k) < nd[k]).map((k) => esc(nm(k)) + ' あと' + (nd[k] - K.hopN(b, k))); if (miss.length) h += `<small>${esc(sim.recipe(s, b.need).name)}：${miss.join('・')}</small>`; }
          if (b.made) h += `<small class="ok">今日 ${b.made} 台できました</small>`;
          setHTML(el, h); place(el, P.local(f, -0.6, 2.25, 0.1));
        }
      } else if (kind === 'oven') {
        const id = K.at(s, K.slot0(fid)), it = id && s.k.items[id];
        if (look || (it && it.st === 'baking' && near(f.x, f.z, 7)) || (near(f.x, f.z, 3) && (b.h || it))) {
          const el = lab('st' + fid, 'st-lb' + (look ? ' near' : ''));
          let h = `<b>${esc(W.fname(s, fid))}</b>`, status = '';
          if (b.h && (!it || it.st !== 'baking')) status = g < (b.hot || 0) ? '予熱中… ' + b.temp + '℃' : b.temp + '℃ 予熱OK';
          if (!b.h) status = '電源オフ';
          if (it && it.st === 'raw') status = '電源を入れると焼き始める';
          if (it && it.st === 'baked') status = '焼き上がっている（取り出そう）';
          if (it && it.st === 'baking' && it.bk) {
            const dd = (g - it.bk.t0) / it.bk.dur, w = sim.bakeWindow(s, it.bk.dT || 0), max = 1.4;
            status = it.bk.temp + '℃・' + (dd < 1 - w ? 'あと' + Math.max(0, Math.ceil(((1 - w - dd) * it.bk.dur) / 1000)) + '秒' : Math.abs(dd - 1) <= w ? '焼き上がり！今だ' : dd < 1.18 ? '焼きすぎ…' : '焦げている！');
            h += `<small>${esc(status)}</small>` + meter(dd, 1 - w, 1 + w, max); el.classList.toggle('hot', dd >= 1 - w);
          } else { h += `<small>${esc(status)}</small>`; el.classList.remove('hot'); }
          setHTML(el, h); place(el, P.local(f, 0, 1.8, 0.4));
        }
      } else if (kind === 'deco') {
        const did = K.at(s, K.slot0(fid)), dk = did && s.k.items[did];
        if (look || (dk && near(f.x, f.z, 2.6))) {
          const el = lab('st' + fid, 'st-lb' + (look ? ' near' : ''));
          let h = `<b>${esc(W.fname(s, fid))}</b>`;
          if (dk && dk.t === 'deco') {
            const tops = Object.keys(dk.tops || {}).map((k) => nm(k) + '×' + dk.tops[k]).join(' ');
            h += `<small>${esc((D.BASES[dk.b] || {}).short || '')}${dk.cr ? '＋' + esc(D.CREAMS[dk.cr].short) : ''}${tops ? '＋' + esc(tops) : ''}</small>`;
            if (b.st === 'run') { const gg = K.gauge(s, 'deco'); h += meter(K.prog(b, g), gg.lo, gg.hi, 1.5) + '<small>緑で「塗り終える」</small>'; }
            else if (b.st === 'spread') h += `<small>${esc(b.by === pid ? 'クリームを塗っています' : ((W.room.members[b.by] || {}).name || 'だれか') + 'さんが塗っています')}</small>`;
            else if (dk.warm) h += '<small class="bad">まだ温かい（クリームが溶ける）</small>';
            else h += '<small>クリームを塗る → 棚からトッピングを持ってきてのせる → 仕上げる</small>';
          } else if (dk && dk.t === 'cake') h += `<small class="ok">${esc((sim.recipe(s, dk.r) || {}).name || '')} 完成！${dk.w ? 'ホールのままショーケースへ／ケーキナイフで6等分にも切れる' : 'ショーケースに並べよう'}</small>`;
          else h += '<small>焼けた型をのせる</small>';
          setHTML(el, h); place(el, P.local(f, 0, 1.5, 0.04));
        }
      } else if (kind === 'sink') {
        const id = K.at(s, K.slot0(fid)), it = id && s.k.items[id];
        if (look || (near(f.x, f.z, 2.6) && (it || b.by))) {
          const el = lab('st' + fid, 'st-lb' + (look ? ' near' : ''));
          let h = `<b>${esc(W.fname(s, fid))}</b>`;
          if (b.by && String(b.by).startsWith('staff')) h += '<small>アルバイトが洗っています</small>';
          else if (it && it.dirty) h += `<small>${esc(K.label(s, it))} → 「洗う」でこすって泡立てる</small>`;
          else if (it && it.wet) h += '<small class="ok">きれいになった！棚か水切りかごに置いて乾かそう</small>';
          else if (it) h += `<small>${esc(K.label(s, it))}</small>`;
          else h += '<small>汚れたお皿・ケーキ型を入れる</small>';
          setHTML(el, h); place(el, P.local(f, -0.36, 1.45, 0.02));
        }
      } else if (f.k === 'reg') {
        const pq = K.payQ(s, fid), c = pq[0] && s.cust[pq[0]];
        if (c && near(f.x, f.z, 5)) {
          const el = lab('st' + fid, 'st-lb' + (tg && tg.reg === fid ? ' near' : ''));
          setHTML(el, `<b>お会計 ${esc(yen(c.due))}</b><small>${c.pm === 'card' ? '💳 カード（タッチするだけ）' : '💴 現金 ' + esc(yen(c.tend)) + ' お預かり → お釣り ' + esc(yen(K.change(c)))}</small>${pq.length > 1 ? `<small>ほか ${pq.length - 1} 人待ち</small>` : ''}`);
          place(el, P.local(f, -0.1, 1.6, 0));
        }
      }
      // 棚・机の中身の名札（近くにいるとき）
      // カウンター裏の箱入れは厨房側からだけ（売り場からは見えない）
      if (Kd.slots.length && distMe(f.x, f.z) < 2.7 && !kind && !(Kd.under && W.me.z > f.z)) {
        Kd.slots.forEach((sl, k) => {
          if (sl[3] === 'tray') return;
          const at = 'f:' + fid + ':' + k, ids = K.inSlot(s, at); if (!ids.length) return;
          const top = s.k.items[ids[ids.length - 1]]; if (!top) return;
          const look2 = tg && tg.slot === at;
          if (look2) return;
          const el = lab('sl-' + at, 'bin-lb' + ((top.sp || 0) >= 2 ? ' out' : ''));
          let h = esc(SHORT(s, top)) + (ids.length > 1 ? ' ×' + ids.length : '');
          if (top.wet) h += ' 💧' + dryLeft(top, g) + '秒';
          setHTML(el, h);
          const p = P.local(f, sl[0], sl[1], sl[2]);
          place(el, [p[0], p[1] + (top.t === 'cake' || top.t === 'deco' ? 0.3 : 0.2), p[2]], 0, 0.78);
        });
      }
      // 水切りかご・型置きの乾燥
      if (kind && Kd.slots.length && distMe(f.x, f.z) < 2.7) Kd.slots.forEach((sl, k) => {
        if (sl[3] !== 'dry' && sl[3] !== 'mixpan') return;
        const at = 'f:' + fid + ':' + k, id = K.top(s, at), it = id && s.k.items[id]; if (!it || (tg && tg.slot === at)) return;
        const el = lab('sl-' + at, 'bin-lb'); setHTML(el, esc(SHORT(s, it)) + (it.wet ? ' 💧' + dryLeft(it, g) + '秒' : ''));
        const p = P.local(f, sl[0], sl[1], sl[2]); place(el, [p[0], p[1] + 0.16, p[2]], 0, 0.78);
      });
    }
    // ねらっている物
    if (tg && tg.item && s.k.items[tg.item]) {
      const it = s.k.items[tg.item], p = tg.p;
      const el = lab('it', 'tag-lb');
      let h = esc(tg.slot ? tg.name : W.itemName(it, s));
      if (it.t === 'pan' && it.st === 'baked') h += `<small>${g < (it.cool || 0) ? '冷ましています… あと' + Math.ceil((it.cool - g) / 1000) + '秒' : '冷めた'}${it.lab ? '・' + esc(it.lab) : ''}</small>`;
      if (it.df && it.df.length) h += `<small class="bad">${it.df.map((x) => esc((D.DEFECTS[x] || {}).name || x)).join('・')}</small>`;
      if (it.t === 'cake' || it.t === 'tray') h += `<small class="${sim.cakeExpDay(it.d, s) <= s.day ? 'warn' : 'cold'}">${esc(sim.cakeExpText(s, it.d))}</small>`;
      if (it.wet) h += `<small class="cold">💧 ぬれている${it.wd ? '・あと' + dryLeft(it, g) + '秒で乾く' : '（置くと30秒で乾く）'}</small>`;
      if (it.dirty) h += '<small class="warn">汚れている（洗い場で洗おう）</small>';
      if (it.t === 'ing') { const e2 = (it.lots || [])[0]; if (e2 && e2[1] !== 9999) { const left = e2[1] - s.day; h += `<small class="${left <= 1 ? 'warn' : ''}">期限 ${left <= 0 ? '今日まで' : 'あと' + left + '日'}</small>`; } }
      if (!tg.station || it.t !== 'pan') h += W.freshHTML(K.fresh(s, it, g), it);
      setHTML(el, h); place(el, [p[0], p[1] + 0.3, p[2]], 0, 0.9);
    }
    // 常温でぬるくなった・傷んだ物の目印（近くにあるとき）
    for (const id in W.items) {
      const o = W.items[id], it = o.it; if (!it || !o.n.vis || (tg && tg.item === id) || String(it.at).startsWith('h:')) continue;
      const fr = K.fresh(s, it, g); if (!fr || fr.cold || !fr.stage) continue;
      const p = o.n.p; if (distMe(p[0], p[2]) > 4.5) continue;
      const el = lab('fr-' + id, 'fr-lb' + (fr.stage >= 2 ? ' bad' : ''));
      setHTML(el, fr.stage >= 2 ? '傷んでいる' : 'ぬるい あと' + mmss(fr.left));
      place(el, [p[0], p[1] + (it.t === 'crate' ? 0.5 : 0.36), p[2]], 0, 0.8);
    }
    // 商品棚の値札と賞味期限（賞味期限はいつも表示）・そのほかのケーキの賞味期限
    const expTag = (d) => { const last = sim.cakeExpDay(d, s) <= s.day; return `<small class="${last ? 'warn' : 'cold'}">${esc(sim.cakeExpText(s, d))}</small>`; };
    for (const id in W.items) {
      const o = W.items[id], it = o.it; if (!it || !(it.t === 'tray' || it.t === 'cake') || !o.n.vis || (tg && tg.item === id) || String(it.at).startsWith('h:')) continue;
      const pp = o.n.p, dd = distMe(pp[0], pp[2]); if (dd > 16) continue;
      if (it.t === 'tray') {
        const nr = dd < 2.6, m = s.menu[it.r];
        const el = lab('tag-' + id, 'tag-lb' + (nr ? '' : ' far'));
        const ex = sim.cakeExpDay(it.d, s) <= s.day, exS = `<small class="${ex ? 'warn' : 'cold'}">${ex ? '今日まで' : '明日まで'}</small>`;
        setHTML(el, nr ? (it.w ? `ホール ${esc(yen(m ? m.hp || 0 : 0))}<small>1切れ ${esc(yen(m ? m.price : 0))}</small>` : `${esc(yen(m ? m.price : 0))}<small>残り${it.p}</small>`) + exS : exS);
        place(el, [pp[0], pp[1] + 0.27, pp[2]], 0, nr ? 0.8 : clamp(3.2 / Math.max(1, dd), 0.66, 0.8));
      } else if (dd < 10) { const el = lab('ex-' + id, 'tag-lb far'); setHTML(el, expTag(it.d)); place(el, [pp[0], pp[1] + 0.34, pp[2]], 0, clamp(3.2 / Math.max(1, dd), 0.72, 0.9)); }
    }
    // お客さん（注文・お会計・吹き出し）
    for (const id in W.custs) {
      const o = W.custs[id], c = o.c; if (!c) continue;
      let h = '', cls = 'say-lb';
      if (c.st === 'q' && K.queue(s, c.reg)[0] === id && o.atSpot) { h = 'すみません、注文いいですか？'; cls += ' ask'; }
      else if (c.st === 'w') { const left = Math.max(0, Math.ceil(((c.pw || 0) - g) / 1000)); h = `<b>#${c.no}</b> ${esc(K.ordText(s, c.ord, c.wh))}<small>${c.dine ? '🍽 店内（お皿）' : '🛍 持ち帰り（箱）'}・<span class="${left < 12 ? 'bad' : ''}">あと${left}秒</span></small>`; cls += ' ord'; }
      else if (c.st === 'pay') { h = `お会計 <b>${esc(yen(c.due))}</b><small>${c.pm === 'card' ? '💳 カードで' : '💴 現金 ' + esc(yen(c.tend))}</small>`; cls += ' ask'; }
      else if (c.say && g - (c.sayT || 0) < 2800) { h = esc(c.say); cls += c.paid ? ' buy' : ' bad'; }
      if (!h || distMe(o.x, o.z) > 10) continue;
      const el = lab('say-' + id, cls);
      setHTML(el, h);
      const p = place(el, [o.x, 1.9, o.z], 0, clamp(3 / Math.max(1, distMe(o.x, o.z)), 0.6, 1));
      if (o.coin && p && CS.coinFly) { o.coin = false; const from = { getBoundingClientRect: () => ({ left: p.x, top: p.y, width: 0, height: 0 }) }; const to = document.getElementById('h-money'); if (to) CS.coinFly(from, to, '¥'); }
    }
    // ほかのプレイヤー・アルバイトの名前（頭の上）
    for (const op in W.others) { const o = W.others[op]; const dd = distMe(o.x, o.z); if (dd > 40) continue; const el = lab('nm-' + op, 'nm-lb player'); setHTML(el, esc(o.name || '')); place(el, [o.x, 2.02 * (o.hs || 1), o.z], 0, clamp(3.2 / Math.max(1, dd), 0.6, 1.05)); }
    for (const k in W.staffN) { const o = W.staffN[k], m = o.m; if (!m || distMe(o.x, o.z) > 7) continue; const el = lab('sf-' + k, 'nm-lb staff'); setHTML(el, `${esc(m.name)} <small>Lv${m.lv}・${esc((D.STAFF.tasks[m.task] || {}).name || '')}</small>`); place(el, [o.x, 1.98, o.z], 0, 0.8); }
    // トッピングの照準
    if (W.aim) { const el = lab('aim', 'aim-lb' + (W.aim.ok ? ' ok' : '')); setHTML(el, ''); const p = W.eng.project([W.aim.x, W.aim.y, W.aim.z]); if (p) { el.hidden = false; el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-50%)`; } }
    // チュートリアルの目印（見えていればその上に、画面の外なら端に矢印）
    if (W.guide && !W.bm && !W.blocked()) { const gp = W.guidePos(s, W.guide); if (gp) guideMark(gp, W.guide.label || ''); }
    for (const k in W.lbl) if (!W.lbl[k]._used) { W.lbl[k].remove(); delete W.lbl[k]; }
  };
  // 目印の場所：{ item } 物 / { fid, y } 家具 / { p } 座標 / { at } 置き場所 / { pc } パソコン / { sign } 看板 / { truck } トラック / { cust } お客さん
  W.guidePos = function (s, g) {
    if (!g || !W.L) return null;
    if (g.p) return g.p;
    if (g.pc) return [W.L.pcScr[0], 1.32, W.L.pcScr[2]];
    if (g.sign) return [W.L.sign[0], 1.25, W.L.sign[1]];
    if (g.truck) { const t = W.truck && W.truck.node.vis ? W.truck.node.p : null; return t ? [t[0], 2.3, t[2] - 2.6] : [W.L.truck.x, 2.0, W.L.truck.z - 2.6]; }
    if (g.item) { const o = W.items[g.item], it = s.k.items[g.item]; if (!o || !it || String(it.at).startsWith('h:')) return null; const q = o.n.p; return [q[0], q[1] + 0.28, q[2]]; }
    if (g.at) { const w = slotWorld(s, g.at); return w ? [w.p[0], w.p[1] + 0.3, w.p[2]] : null; }
    if (g.fid) { const f = fOf(s, g.fid); if (!f) return null; const Kd = P.KINDS[f.k] || {}; return P.local(f, 0, g.y != null ? g.y : (Kd.h || 1) + 0.2, g.dz || 0); }
    if (g.cust) { const o = W.custs[g.cust]; return o ? [o.x, 2.05, o.z] : null; }
    return null;
  };
  function guideMark(p3, label) {
    const el = lab('guide', 'guide-lb'), cv = W.eng.canvas, cw = cv.clientWidth, ch = cv.clientHeight;
    const me = W.me, dx = p3[0] - me.x, dz = p3[2] - me.z, dist = Math.hypot(dx, dz);
    const fwd = -dx * Math.sin(me.yaw) - dz * Math.cos(me.yaw), side = dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw);
    const h = `<i class="ga"></i><span>${esc(label)}<small>${dist < 1.6 ? 'ここ！' : Math.round(dist) + 'm'}</small></span>`;
    if (el._h !== h) { el._h = h; el.innerHTML = h; }
    const p = W.eng.project(p3), top = (W.hudH || 52) + 8;
    const onScreen = p && p.z <= 1 && p.d > 0.15 && fwd > 0 && p.x > 24 && p.x < cw - 24 && p.y > top + 20 && p.y < ch - 40;
    el.hidden = false;
    if (onScreen) { el.classList.remove('edge'); el.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y + Math.sin(performance.now() / 260) * 4).toFixed(1)}px) translate(-50%, -100%)`; return; }
    // 画面の外：見ている向きからの角度で、画面の端に矢印
    const a = Math.atan2(side, fwd), rx = cw / 2 - 80, ry = ch / 2 - 80;
    let x = Math.sin(a), y = -Math.cos(a); const k = Math.min(rx / Math.max(1e-3, Math.abs(x)), ry / Math.max(1e-3, Math.abs(y)));
    x = cw / 2 + x * k; y = clamp(ch / 2 + y * k, top + 40, Math.min(ch - 140, ch * 0.7));
    el.classList.add('edge'); el.style.setProperty('--ga', (a * 180 / PI).toFixed(0) + 'deg');
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
  }
})(typeof window !== 'undefined' ? window : globalThis);
