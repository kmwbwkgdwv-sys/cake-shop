/* ケーキ屋さんシミュレーター : 間取りと家具（ホストの計算と 3D 表示の両方で使う）
 *  ・お店の部屋（倉庫・パソコン室・厨房・売り場）の位置は増床レベルで決まる
 *  ・厨房の家具（棚・オーブンなど）は S.fu に置かれ、自由に動かせる
 *     S.fu[id] = { k: 種類, x, z, r: 向き 0〜3（0 = 前が +z）}
 *  ・物の置き場所は「家具ID:番号」（例 'f:f3:2'）。どこに何を置くかはプレイヤーが決める
 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data;
  const P = (CS.plan = {});
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------------------------------------------------------------
  //  家具の種類
  //   w, d, h：幅・奥行き・高さ（m）  slots：物を置く所 [左右, 高さ, 前後, 種類]
  //   置く所の種類：any 何でも（同じ物なら重ねられる）／fridge ケーキなど1つ／tray 商品（切ったケーキ）
  //                 mixpan ミキサーの型置き／oven オーブンの中／turn デコの回転台／basin 洗い場の流し／dry 水切りかご
  // ---------------------------------------------------------------------
  const shelf6 = (ys, xs, z, kind) => { const out = []; ys.forEach((y) => xs.forEach((x) => out.push([x, y, z || 0, kind || 'any']))); return out; };
  P.KINDS = {
    table:  { name: '机', desc: '物を置ける作業用の机（4か所）', icon: 'box', w: 1.4, d: 0.75, h: 0.9, price: 9000, slots: [[-0.34, 0.905, -0.16, 'any'], [0.34, 0.905, -0.16, 'any'], [-0.34, 0.905, 0.16, 'any'], [0.34, 0.905, 0.16, 'any']] },
    shelf:  { name: '棚', desc: '何でも置ける棚（6か所・1か所10個まで）。置いた物と同じ物だけ重ねられる。段ボールのままは入らない', icon: 'box', w: 1.2, d: 0.5, h: 1.85, price: 12000, slots: shelf6([0.33, 0.93, 1.53], [-0.3, 0.3]) },
    cshelf: { name: '冷蔵棚', desc: '冷えている棚（6か所・1か所10個まで）。卵・乳製品・果物はここに置かないと傷む。段ボールのままは入らない', icon: 'snow', w: 1.25, d: 0.62, h: 1.95, price: 26000, cold: 1, slots: shelf6([0.5, 0.97, 1.44], [-0.3, 0.3], -0.02) },
    fridge: { name: '冷蔵庫', desc: 'ケーキが6ホール入る（作りかけ・クリーム・焼いたスポンジも）', icon: 'fridge', w: 1.42, d: 0.74, h: 2.08, price: 32000, cold: 1, slots: shelf6([0.92, 1.34], [-0.43, 0, 0.43], 0.02, 'fridge') },
    scase:  { name: 'ショーケース', desc: 'カウンターに置くガラスのショーケース（冷蔵）。3段×3ホールのケーキを切って並べられ、お客さんからよく見える', icon: 'case', w: 2.3, d: 1.0, h: 1.8, price: 48000, counter: 1, cold: 1, slots: [[-0.72, 0.95, 0.3, 'tray'], [0, 0.95, 0.3, 'tray'], [0.72, 0.95, 0.3, 'tray'], [-0.72, 1.17, 0.02, 'tray'], [0, 1.17, 0.02, 'tray'], [0.72, 1.17, 0.02, 'tray'], [-0.72, 1.39, -0.25, 'tray'], [0, 1.39, -0.25, 'tray'], [0.72, 1.39, -0.25, 'tray']] },
    pcase:  { name: '商品棚（冷蔵）', hide: 1, desc: '切ったケーキを並べて売る。冷えているのでクリームのケーキも傷まない（3種類）', icon: 'case', w: 1.5, d: 0.8, h: 1.35, price: 30000, cold: 1, slots: shelf6([0.94], [-0.46, 0, 0.46], 0, 'tray') },
    pcaseN: { name: '商品棚（常温）', desc: 'クッキーなど焼き菓子向けの常温の商品棚（3種類）。クリームのケーキは傷む', icon: 'case', w: 1.5, d: 0.62, h: 1.25, price: 16000, slots: shelf6([0.9], [-0.46, 0, 0.46], 0, 'tray') },
    mixer:  { name: 'ミキサー台', desc: '生地を作る。横に型を置いて流し込む', icon: 'mixer', w: 1.4, d: 0.75, h: 0.9, price: 12000, station: 'mix', slots: [[0.42, 0.905, 0.08, 'mixpan']] },
    oven:   { name: 'オーブン', desc: '型に入れた生地を焼く', icon: 'oven', w: 1.15, d: 0.95, h: 1.4, price: 18000, station: 'oven', slots: [[0, 0.8, 0.12, 'oven']] },
    whip:   { name: 'クリーム台', desc: '生クリームなどを泡立てる', icon: 'hand', w: 1.3, d: 0.75, h: 0.9, price: 10000, station: 'whip', slots: [] },
    deco:   { name: 'デコ台', desc: '回転台で焼いたスポンジにクリームを塗り、トッピングをのせて仕上げる', icon: 'star', w: 1.2, d: 0.75, h: 0.9, price: 9000, station: 'deco', slots: [[0, 0.975, 0.04, 'turn']] },
    sink:   { name: '洗い場', desc: '汚れたお皿・ケーキ型を洗う。水切りかごで乾かす', icon: 'sync', w: 1.6, d: 0.7, h: 0.9, price: 15000, station: 'sink', slots: [[-0.36, 0.8, 0.02, 'basin'], [0.36, 0.93, -0.06, 'dry'], [0.62, 0.93, -0.06, 'dry']] },
    crack:  { name: '在庫棚', desc: '段ボールのまま保管できる棚（2列×2段・1台で段ボール4つまで）。常温なので要冷蔵の物は早めに冷蔵棚へ', icon: 'box', w: 1.2, d: 0.62, h: 1.3, price: 10000, slots: [[-0.29, 0.1, 0, 'crate'], [0.29, 0.1, 0, 'crate'], [-0.29, 0.68, 0, 'crate'], [0.29, 0.68, 0, 'crate']] },
    rack:   { name: '冷却ラック', desc: '焼いたスポンジを早く冷ませる棚（6か所）', icon: 'snow', w: 0.75, d: 0.6, h: 1.7, price: 8000, cool: 0.5, slots: shelf6([0.5, 0.95, 1.4], [-0.17, 0.17]) },
    trash:  { name: 'ゴミ箱', desc: 'いらない物・空の段ボールを捨てる', icon: 'trash', w: 0.55, d: 0.55, h: 0.7, price: 3000, slots: [] },
    reg:    { name: 'レジ', desc: 'カウンターに置く。お客さんの注文とお会計', icon: 'cart', w: 1.7, d: 0.7, h: 1.2, price: 20000, counter: 1, slots: [] },
    // カウンターの裏（厨房側）の穴に入れる箱置き。レジの下にも置ける
    boxhole: { name: '箱入れ（カウンター裏）', desc: 'カウンターの裏の穴に、ケーキの箱をしまっておける（2か所・1か所30枚まで）。接客のときはここから箱を取って詰める', icon: 'box', w: 0.9, d: 0.6, h: 0.86, price: 5000, counter: 1, under: 1, slots: [[-0.21, 0.105, -0.1, 'boxes'], [0.21, 0.105, -0.1, 'boxes']] },
    // ---- 自動の機械（店舗レベルで解放。材料をセットするだけで動く） ----
    amixer: { name: '自動ミキサー', lv: 4, desc: '材料を入れるだけ（順番も気にしなくてOK）。そろったら自動で混ぜ、横の型置きにきれいな型があれば自動で流し込む', icon: 'mixer', w: 1.4, d: 0.75, h: 1.0, price: 60000, station: 'amix', auto: 1, slots: [[0.42, 0.905, 0.08, 'mixpan']] },
    awhip:  { name: '自動ホイッパー', lv: 5, desc: 'クリームの材料を入れるだけで、ちょうどいい固さに泡立てる。できたら「すくう」か自動デコ機へ', icon: 'hand', w: 1.2, d: 0.75, h: 1.0, price: 55000, station: 'awhip', auto: 1, slots: [] },
    aoven:  { name: '自動オーブン', lv: 6, desc: '生地を入れるだけで、温度を合わせて予熱し、ちょうどいい焼き加減で自動で止める（焦げない）', icon: 'oven', w: 1.2, d: 0.95, h: 1.45, price: 90000, station: 'aoven', auto: 1, slots: [[0, 0.8, 0.12, 'oven']] },
    adeco:  { name: '自動デコ機', lv: 7, desc: '冷めたスポンジをのせると、セットしたクリームを自動で塗り、補充したトッピングをきれいに並べて仕上げる', icon: 'star', w: 1.4, d: 0.8, h: 1.5, price: 120000, station: 'adeco', auto: 1, slots: [[-0.18, 0.975, 0.08, 'turn']] },
    line:   { name: '全自動製造ライン', lv: 10, desc: '材料を投入口に入れるだけ。レーンで生地 → オーブン → 冷却 → クリーム塗り → トッピングと進み、完成したケーキが出口に出てくる（出口は冷蔵）', icon: 'bolt', w: 5.4, d: 1.2, h: 1.9, price: 380000, station: 'line', auto: 1, cold: 1, slots: [[2.12, 0.93, -0.22, 'out'], [2.12, 0.93, 0.22, 'out'], [2.5, 0.93, 0, 'out']] },
  };
  // 1か所に置ける数（箱入れは30枚まで）
  P.SLOT_CAP = { boxes: 30 };
  // 道具（パソコンで1つずつ買う）
  P.TOOLS = {
    plate: { name: 'お皿', desc: '店内で食べるお客さんに出す。落とすと割れる', icon: 'cup', price: 1200 },
    pan: { name: 'ケーキの型', desc: '生地を流して焼く。使ったら洗う', icon: 'oven', price: 3000 },
    knife: { name: 'ケーキナイフ', desc: 'ホールケーキを6等分に切る。台の上やお皿の上で使える（最初に1本もらえる）', icon: 'knife', price: 1800 },
  };
  // 最初にある物（机1・棚1・クリーム台1・ショーケース1・洗い場1・冷蔵棚1・冷蔵庫1・レジ1・ゴミ箱1、型1・お皿1・ケーキナイフ1）
  P.START = ['table', 'shelf', 'whip', 'scase', 'sink', 'cshelf', 'fridge', 'reg', 'trash', 'boxhole'];

  // ---------------------------------------------------------------------
  //  間取り（増床レベルで大きさが変わる。倉庫とパソコン室は裏に並ぶ）
  // ---------------------------------------------------------------------
  // lv = 増床の段階、st = 倉庫の拡張の段階（1段ごとに奥行き +1.3m）
  P.STORE_STEP = 1.3;
  P.geom = function (lv, st) {
    const sz = D.SHOP_SIZES[clamp(lv || 0, 0, D.SHOP_SIZES.length - 1)];
    const RX = sz.rx, RZ = sz.rz, CZ = -RZ + sz.kd;
    st = clamp(st || 0, 0, 3);
    const g = { RX, RZ, CZ, lv: lv || 0, st };
    // 倉庫（左奥・広め。拡張すると手前に広がる）とパソコン室（そのとなり）
    g.store = { x0: -RX, x1: -RX + 6.2, z0: -RZ, z1: -RZ + 4.6 + st * P.STORE_STEP, door: -RX + 4.9, dw: 1.4 };
    g.pc = { x0: -RX + 6.2, x1: -RX + 9.4, z0: -RZ, z1: -RZ + 3.4, door: -RX + 7.8, dw: 1.2 };
    g.backDoor = { x: -RX, z: -RZ + 2.3, w: 1.2 };
    // カウンターは売り場の右寄りだけ。左は壁で仕切る（右の端は通路で売り場へ出られる）
    g.counter = { z: CZ, d: 0.78, x0: Math.max(-RX + 4, RX - 9.6), x1: RX - 1.8 };
    g.kitchen = { x0: -RX, x1: RX, z0: -RZ, z1: CZ - g.counter.d / 2 };
    g.hall = [-RX, CZ - g.counter.d / 2, g.counter.x0, CZ - g.counter.d / 2 + 0.16]; // 厨房と売り場の仕切りの壁
    const th = 0.14, sd = g.store, pc = g.pc;
    // 壁（家具はここにかからない）
    g.walls = [
      [sd.x0, sd.z1 - th / 2, sd.door - sd.dw / 2, sd.z1 + th / 2],
      [sd.door + sd.dw / 2, sd.z1 - th / 2, sd.x1 + th / 2, sd.z1 + th / 2],
      [pc.x0, pc.z1 - th / 2, pc.door - pc.dw / 2, pc.z1 + th / 2],
      [pc.door + pc.dw / 2, pc.z1 - th / 2, pc.x1 + th / 2, pc.z1 + th / 2],
      [sd.x1 - th / 2, -RZ, sd.x1 + th / 2, sd.z1],
      [pc.x1 - th / 2, -RZ, pc.x1 + th / 2, pc.z1],
    ];
    // 家具を置けない所：パソコン室の中、ドアの前、裏口の前、カウンターの通路
    g.noBuild = [
      [pc.x0, -RZ, pc.x1 + th / 2, pc.z1 + th / 2],
      [sd.door - sd.dw / 2 - 0.15, sd.z1 - 1.15, sd.door + sd.dw / 2 + 0.15, sd.z1 + 1.25],
      [pc.door - pc.dw / 2 - 0.15, pc.z1 - 0.1, pc.door + pc.dw / 2 + 0.15, pc.z1 + 1.25],
      [-RX, g.backDoor.z - g.backDoor.w / 2 - 0.2, -RX + 1.25, g.backDoor.z + g.backDoor.w / 2 + 0.2],
      [g.counter.x1 - 0.1, g.counter.z - 1.5, RX, g.counter.z + 0.5],
    ];
    g.key = [lv, RX, RZ, CZ, st, 3].join(',');
    // 床に段ボールを置ける外の路地（トラックと建物のあいだ）
    g.alley = { x0: -RX - 5.4, x1: -RX - 0.12, z0: -RZ - 2.6, z1: RZ - 0.3 };
    return g;
  };
  P.geomOf = (S) => P.geom(S && S.up ? S.up.floor || 0 : 0, S && S.up ? S.up.storage || 0 : 0);

  // ---------------------------------------------------------------------
  //  家具の向き・大きさ・置く所の位置
  // ---------------------------------------------------------------------
  // 向き r（0〜3）→ 前・右の向き
  P.dirs = function (r) { const a = ((r || 0) % 4) * Math.PI / 2; return { a, fx: Math.sin(a), fz: Math.cos(a), rx: Math.cos(a), rz: -Math.sin(a) }; };
  P.size = function (k, r) { const K = P.KINDS[k] || { w: 1, d: 1 }; return (r || 0) % 2 ? [K.d, K.w] : [K.w, K.d]; };
  P.box = function (f) { const [w, d] = P.size(f.k, f.r); return [f.x - w / 2, f.z - d / 2, f.x + w / 2, f.z + d / 2]; };
  P.local = function (f, lx, y, lz) { const o = P.dirs(f.r); return [f.x + lx * o.rx + lz * o.fx, y, f.z + lx * o.rz + lz * o.fz]; };
  P.slotDef = function (S, at) { const p = String(at).split(':'); if (p[0] !== 'f') return null; const f = S.fu && S.fu[p[1]]; if (!f) return null; const K = P.KINDS[f.k]; const s = K && K.slots[+p[2]]; return s ? { f, fid: p[1], k: +p[2], kind: f.k, type: s[3], def: s } : null; };
  P.slotPos = function (S, at) { const sd = P.slotDef(S, at); if (!sd) return null; const s = sd.def; return P.local(sd.f, s[0], s[1], s[2]); };
  P.slots = function (S, fid) { const f = S.fu[fid]; if (!f) return []; return (P.KINDS[f.k].slots || []).map((s, k) => 'f:' + fid + ':' + k); };
  P.isCold = function (S, at) { const sd = P.slotDef(S, at); return !!(sd && P.KINDS[sd.kind].cold); };
  // 種類ごとの家具（左から順）
  P.list = function (S, k) { return Object.keys(S.fu || {}).filter((id) => S.fu[id] && S.fu[id].k === k).sort((a, b) => S.fu[a].x - S.fu[b].x || S.fu[a].z - S.fu[b].z); };
  P.count = (S, k) => P.list(S, k).length;
  // 立って作業する位置（家具の前）
  // ---------------------------------------------------------------------
  //  床に置いた段ボール（at = 'fl'、位置は fx, fz、向き fr）
  // ---------------------------------------------------------------------
  P.itemFoot = function (it) {
    if (it && it.t === 'fcrate') { const K = P.KINDS[it.k] || { w: 1, d: 1 }; return [clamp(K.w * 0.8, 0.6, 1.05), clamp(K.d * 0.95, 0.5, 0.85)]; }
    return [0.48, 0.36];
  };
  P.floorBox = function (it, x, z, r) { const [w0, d0] = P.itemFoot(it), rr = r == null ? it.fr || 0 : r, w = rr % 2 ? d0 : w0, d = rr % 2 ? w0 : d0, X = x == null ? it.fx : x, Z = z == null ? it.fz : z; return [X - w / 2, Z - d / 2, X + w / 2, Z + d / 2]; };
  P.floorItems = (S) => Object.keys((S.k && S.k.items) || {}).filter((id) => S.k.items[id] && S.k.items[id].at === 'fl');
  // 置けるか：厨房・倉庫の中か、裏の路地（トラック・裏口・荷おろしの所はだめ）。壁・通路・家具・ほかの段ボールと重ならない
  P.floorOk = function (S, it, x, z, r, id) {
    const g = P.geomOf(S), b = P.floorBox(it, x, z, r), m = 0.01;
    const kz = g.kitchen, al = g.alley;
    const inK = b[0] >= kz.x0 + 0.02 && b[2] <= kz.x1 - 0.02 && b[1] >= kz.z0 + 0.02 && b[3] <= kz.z1 - 0.02;
    const inA = b[0] >= al.x0 && b[2] <= al.x1 && b[1] >= al.z0 && b[3] <= al.z1;
    if (!inK && !inA) return '厨房・倉庫の中か、裏の路地に置こう';
    if (inA) {
      const bd = g.backDoor.z, tx = -g.RX - 3.45, tz = bd + 3.0;
      if (hit(b, [tx - 1.3, tz - 3.0, tx + 1.3, tz + 2.9], m)) return 'トラックの所には置けません';
      if (hit(b, [-g.RX - 2.25, bd + 0.2, -g.RX - 0.75, bd + 3.6], m)) return '荷おろしの場所はあけておこう';
      if (hit(b, [-g.RX - 1.4, bd - g.backDoor.w / 2 - 0.3, -g.RX, bd + g.backDoor.w / 2 + 0.3], m)) return '裏口の前はふさがないで';
    } else {
      for (const w of g.walls) if (hit(b, w, m)) return '壁にぶつかっています';
      for (const w of g.noBuild) if (hit(b, w, m)) return 'ドアや通路をふさいでしまいます';
      for (const o in S.fu) { const f = S.fu[o]; if (P.KINDS[f.k] && !P.KINDS[f.k].counter && hit(b, P.box(f), 0.002)) return '家具と重なっています'; }
    }
    for (const o of P.floorItems(S)) { if (o === id) continue; if (hit(b, P.floorBox(S.k.items[o]), 0.002)) return 'ほかの段ボールと重なっています'; }
    return '';
  };
  // 空いている床（near の近くから。倉庫の裏口のそば → 厨房）
  P.floorSpot = function (S, it, near) {
    const g = P.geomOf(S), kz = g.kitchen, c = [];
    const n = near || [-g.RX + 1.2, g.backDoor.z + 1.6];
    for (let z = kz.z0 + 0.3; z < kz.z1 - 0.3; z += 0.25) for (let x = kz.x0 + 0.3; x < kz.x1 - 0.3; x += 0.25) c.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.hypot(x - n[0], z - n[1])]);
    c.sort((a, b) => a[2] - b[2]);
    for (const q of c) for (const r of [0, 1]) if (!P.floorOk(S, it, q[0], q[1], r)) return { x: q[0], z: q[1], r };
    return null;
  };
  P.stand = function (f, dist) { const o = P.dirs(f.r), d = P.size(f.k, 0)[1] / 2 + (dist || 0.55); return [f.x + o.fx * d, f.z + o.fz * d]; };

  // ---------------------------------------------------------------------
  //  置けるかどうか（ホストが確かめる。画面でも同じ判定で緑／赤を出す）
  // ---------------------------------------------------------------------
  const hit = (a, b, m) => a[0] < b[2] - m && a[2] > b[0] + m && a[1] < b[3] - m && a[3] > b[1] + m;
  P.valid = function (S, id, k, x, z, r) {
    const g = P.geomOf(S), K = P.KINDS[k]; if (!K) return '置けない物です';
    if (K.counter) {
      // レジはカウンターの上（左右だけ動かせる）
      // 箱入れ（カウンターの下）はレジの下に置ける。ショーケース・ほかの箱入れとは重ならない
      const half = K.w / 2;
      if (x - half < g.counter.x0 + 0.1 || x + half > g.counter.x1 - 0.05) return K.under ? 'カウンターの下に置こう' : 'カウンターの上に置こう';
      for (const o in S.fu) {
        if (o === id) continue; const f = S.fu[o], Ko = P.KINDS[f.k]; if (!Ko || !Ko.counter) continue;
        const clash = K.under ? Ko.under || f.k === 'scase' : Ko.under ? k === 'scase' : true;
        if (clash && Math.abs(f.x - x) < (K.w + Ko.w) / 2 + (K.under || Ko.under ? 0.02 : 0.1)) return K.under || Ko.under ? 'ショーケース・ほかの箱入れと重なっています' : 'ほかのレジとくっつきすぎ';
      }
      return '';
    }
    const b = P.box({ k, x, z, r });
    const kz = g.kitchen;
    if (b[0] < kz.x0 + 0.02 || b[2] > kz.x1 - 0.02 || b[1] < kz.z0 + 0.02 || b[3] > kz.z1 - 0.02) return '厨房・倉庫の中に置こう';
    for (const w of g.walls) if (hit(b, w, 0.01)) return '壁にぶつかっています';
    for (const w of g.noBuild) if (hit(b, w, 0.01)) return 'ドアや通路をふさいでしまいます';
    for (const o in S.fu) { if (o === id) continue; const f = S.fu[o]; if (P.KINDS[f.k].counter) continue; if (hit(b, P.box(f), 0.002)) return 'ほかの家具と重なっています'; }
    for (const o of P.floorItems(S)) if (hit(b, P.floorBox(S.k.items[o]), 0.002)) return '床の段ボールがじゃまです（どかそう）';
    return '';
  };
  // 空いている場所をさがす（壁ぞい → 真ん中の順）。near があればその近くから
  P.findSpot = function (S, k, near) {
    const g = P.geomOf(S), K = P.KINDS[k];
    if (K.counter) {
      const xs = []; for (let x = g.counter.x1 - K.w / 2 - 0.1; x > g.counter.x0 + K.w / 2; x -= 0.1) xs.push(Math.round(x * 100) / 100);
      if (near) xs.sort((a, b) => Math.abs(a - near[0]) - Math.abs(b - near[0]));
      for (const v of xs) if (!P.valid(S, null, k, v, g.counter.z, 0)) return { x: v, z: g.counter.z, r: 0 };
      return null;
    }
    const cand = [];
    const kz = g.kitchen, step = 0.1;
    for (let r = 0; r < 4; r++) {
      const [w, d] = P.size(k, r);
      for (let z = kz.z0 + d / 2 + 0.03; z < kz.z1 - d / 2; z += step) for (let x = kz.x0 + w / 2 + 0.03; x < kz.x1 - w / 2; x += step) {
        const X = Math.round(x * 100) / 100, Z = Math.round(z * 100) / 100;
        // 向き：壁を背にする（奥の壁→前向き、左の壁→右向き…）
        const back = Z - d / 2 - kz.z0, left = X - w / 2 - kz.x0, right = kz.x1 - X - w / 2;
        const want = back < 0.12 ? 0 : left < 0.12 ? 1 : right < 0.12 ? 3 : 0;
        if (r !== want) continue;
        const wallD = Math.min(back, left, right);
        cand.push([X, Z, r, (near ? Math.hypot(X - near[0], Z - near[1]) : 0) + (wallD < 0.12 ? 0 : 6 + wallD)]);
      }
    }
    cand.sort((a, b) => a[3] - b[3]);
    for (const c of cand) if (!P.valid(S, null, k, c[0], c[1], c[2])) return { x: c[0], z: c[1], r: c[2] };
    return null;
  };
  // 最初の配置（厨房の基本形）
  P.startLayout = function (lv) {
    const g = P.geom(lv), RX = g.RX, RZ = g.RZ, CZ = g.CZ;
    return [
      ['cshelf', g.store.x0 + 0.72, -RZ + 0.34, 0],
      ['fridge', g.store.x0 + 2.25, -RZ + 0.4, 0],
      ['shelf', g.store.x0 + 3.7, -RZ + 0.28, 0],
      ['whip', g.pc.x1 + 1.4, -RZ + 0.4, 0],
      ['sink', RX - 1.1, -RZ + 0.37, 0],
      ['trash', RX - 0.3, -RZ + 1.4, 3],
      ['table', g.pc.x1 + 2.4, -RZ + 7.0, 0],
      ['scase', g.counter.x0 + 1.35, CZ, 0],
      ['reg', g.counter.x0 + 3.6, CZ, 0],
      ['boxhole', g.counter.x0 + 3.6, CZ, 0],
    ];
  };
})(typeof window !== 'undefined' ? window : globalThis);
