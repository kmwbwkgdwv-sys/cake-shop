/* ケーキ屋さんシミュレーター : 厨房のしくみ（家具・物の置き場所・調理・洗い物・接客・お会計・アルバイト）
 *  ホストだけが実行する。物は「家具の置く所」か「だれかの手」か「トラックの荷台」にある。
 *   置く所 'f:家具ID:番号'（棚は同じ物なら重ねられる。材料は1つの山にまとまる）/ 'h:プレイヤー' 手 / 'dl:j' 荷台 / 'seat:i' 客席 / 'c:客ID' お客さんが持っている
 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data, R = D.RULES;
  const sim = CS.sim, _ = sim._, P = CS.plan;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const K = (CS.kitchen = {});
  const KD = D.KITCHEN;
  const ok = (msg) => ({ ok: true, msg });
  const ng = (msg) => ({ ok: false, msg });
  const kindOf = (at) => String(at).split(':')[0];
  const ingName = (k) => (D.ING[k] || {}).name || k;
  // 棚などの1枠に置けるのは10個まで（手に持てる材料も10個まで）
  const STACK_CAP = { ing: 10, plate: 10, pan: 10, knife: 10 };
  K.STACK_CAP = STACK_CAP;

  // =====================================================================
  //  物
  // =====================================================================
  const items = (S) => S.k.items;
  const add = (S, it) => { const id = _.uid(S, 'i'); S.k.items[id] = it; return id; };
  const del = (S, id) => { delete S.k.items[id]; };
  K.add = add;
  K.at = (S, slot) => { const I = items(S); for (const id in I) if (I[id].at === slot) return id; return null; };
  K.inSlot = (S, slot) => { const I = items(S), out = []; for (const id in I) if (I[id].at === slot) out.push(id); return out.sort((a, b) => (I[a].pl || 0) - (I[b].pl || 0) || (a < b ? -1 : 1)); };
  K.top = (S, slot) => { const l = K.inSlot(S, slot); return l.length ? l[l.length - 1] : null; };
  K.held = (S, pid) => K.at(S, 'h:' + pid);
  // 重ねられる物の種類（同じなら同じ所に重ねられる）
  K.skey = (it) => (!it ? null : it.t === 'ing' ? 'i:' + it.ing : it.t === 'box' && !(it.s && it.s.length) ? 'i:box' : it.t === 'plate' && !(it.s && it.s.length) ? (it.dirty ? 'plate-d' : 'plate') : it.t === 'pan' && it.st === 'empty' ? (it.dirty ? 'pan-d' : 'pan') : it.t === 'knife' ? 'knife' : null);
  const capOf = (k) => (!k ? 1 : k.startsWith('i:') ? STACK_CAP.ing : k.startsWith('plate') ? STACK_CAP.plate : k === 'knife' ? STACK_CAP.knife : STACK_CAP.pan);
  // 置き場所ごとの上限（箱入れは30枚。ほかは物の種類で決まる）
  const slotCapT = (type, k) => (P.SLOT_CAP && P.SLOT_CAP[type]) || capOf(k);
  K.slotCap = (S, at, it) => { const sd = P.slotDef(S, at); return slotCapT(sd && sd.type, K.skey(it)); };
  // ホール（切っていないケーキ）か。w=1 がホール。切ると w が消えて p 切れになる
  K.isWhole = (it) => !!it && (it.t === 'cake' || it.t === 'tray') && !!it.w;
  const HOLE_U = 6; // 箱の中でホール1台が使う大きさ（1切れ=1）
  K.boxUnits = (h) => ((h && h.s) || []).reduce((a, x) => a + (x[4] ? HOLE_U : 1), 0);
  // ケーキを使い切った：お皿の上にのせていたら、汚れたお皿が残る
  function consumeCake(S, id, now) {
    const it = items(S)[id]; if (!it) return;
    if (it.dish) { S.k.items[id] = { t: 'plate', s: [], dirty: 1, at: it.at, pl: now || it.pl || 0 }; return; }
    del(S, id);
  }
  K.hasKnife = (S) => Object.values(items(S)).some((it) => it.t === 'knife');
  // 段ボールを床に置く（置ける所が無ければ false）
  function toFloor(S, it, near) {
    const sp = P.floorSpot(S, it, near); if (!sp) return false;
    it.at = 'fl'; it.fx = sp.x; it.fz = sp.z; it.fr = sp.r; return true;
  }
  K.toFloor = toFloor;
  const clearFloor = (it) => { delete it.fx; delete it.fz; delete it.fr; };
  const units = (it) => (it.t === 'ing' ? it.n || 0 : 1);
  function lotsCost(lots, n) { let c = 0; for (const l of lots || []) { const k = Math.min(n, l[0]); c += k * l[2]; n -= k; if (n <= 0) break; } return c; }
  // 原価（捨てたときの廃棄額）
  const itemCost = (it) => (it.t === 'tray' || it.t === 'cake' ? (it.c / (it.n || R.PIECES)) * (it.p || 0) : it.t === 'box' || it.t === 'plate' ? (it.s || []).reduce((a, x) => a + (x[3] || 0), 0) : it.t === 'cream' ? (it.c || 0) * (it.n || 1) : it.t === 'crate' ? (it.n || 0) * (it.u || 0) : it.t === 'ing' ? lotsCost(it.lots, it.n) : it.c || 0);
  K.itemCost = itemCost;

  // ---------- 材料の山（ロット＝[個数, 期限の日, 単価]）----------
  function lotsTake(lots, n) { lots.sort((a, b) => a[1] - b[1]); const out = []; let cost = 0; while (n > 0 && lots.length) { const l = lots[0], k = Math.min(n, l[0]); out.push([k, l[1], l[2]]); cost += k * l[2]; l[0] -= k; n -= k; if (l[0] <= 0) lots.shift(); } return { lots: out, cost }; }
  function lotsMerge(a, b) { const out = (a || []).map((x) => x.slice()); for (const l of b || []) { const s = out.find((x) => x[1] === l[1] && x[2] === l[2]); if (s) s[0] += l[0]; else out.push(l.slice()); } return out.sort((x, y) => x[1] - y[1]); }
  function newLots(S, id, n, cost, half) {
    const I = D.ING[id], life = I && I.life;
    let exp = life ? S.day + Math.ceil(life * _.eqv(S, 'fridge').life) : 9999;
    if (half && life) exp = S.day + Math.floor((exp - S.day) / 2);
    return [[n, exp, cost]];
  }
  K.newLots = newLots;
  // 山を分ける（手に1つ取るとき）
  function split(S, id, n) {
    const it = items(S)[id]; n = Math.min(n, it.n);
    const t = lotsTake(it.lots, n); it.n -= n;
    return { t: 'ing', ing: it.ing, n, lots: t.lots, wm: it.wm || 0, w0: 0, sp: it.sp || 0 };
  }
  function mergeInto(S, dst, src) {
    // 温度の記録は「ぬるいほう」に合わせる
    const now = S._now || 0, fa = K.warmFrac(S, dst, now), fb = K.warmFrac(S, src, now), lim = K.spoilSec(S, dst) || K.spoilSec(S, src);
    dst.n += src.n; dst.lots = lotsMerge(dst.lots, src.lots);
    if (lim) { dst.wm = Math.round(Math.max(fa, fb) * lim * 1000); dst.w0 = 0; }
    dst.sp = Math.max(dst.sp || 0, src.sp || 0);
  }

  // ---------- 在庫（棚・机の材料の山を全部合わせた数） ----------
  const stackOK = (it) => it && it.t === 'ing' && it.n > 0 && (it.sp || 0) < 2 && !it.res;
  K.stacks = (S, ing, incHeld) => Object.keys(items(S)).filter((id) => { const it = items(S)[id]; return it.t === 'ing' && it.ing === ing && it.n > 0 && (incHeld || !String(it.at).startsWith('h:')); });
  K.invCount = function (S, ing) { let n = 0; for (const id in items(S)) { const it = items(S)[id]; if (it.t === 'ing' && it.ing === ing && (it.sp || 0) < 2) n += it.n || 0; } return n; };
  // アルバイトが使う：棚の山から（古い物から）
  K.invTake = function (S, ing, n) {
    const ids = K.stacks(S, ing).filter((id) => stackOK(items(S)[id])).sort((a, b) => ((items(S)[a].lots[0] || [0, 9999])[1]) - ((items(S)[b].lots[0] || [0, 9999])[1]));
    let have = 0; ids.forEach((id) => (have += items(S)[id].n)); if (have < n) return -1;
    let cost = 0;
    for (const id of ids) { if (n <= 0) break; const it = items(S)[id], k = Math.min(n, it.n), t = lotsTake(it.lots, k); it.n -= k; n -= k; cost += t.cost; if (it.n <= 0) del(S, id); }
    return cost;
  };
  K.hasAll = (S, req) => { for (const id in req) if (K.invCount(S, id) < req[id]) return false; return true; };
  K.takeAll = (S, req) => { if (!K.hasAll(S, req)) return -1; let c = 0; for (const id in req) c += K.invTake(S, id, req[id]); return c; };
  // 材料を棚に足す（アルバイト・テスト用）。同じ材料の山 → 空いている所（要冷蔵は冷蔵棚）の順。入れられた数を返す
  K.invAdd = function (S, ing, n, cost, half) {
    let left = n; const I = D.ING[ing] || {};
    const lot = newLots(S, ing, 1, cost, half)[0];
    const put = (slot) => {
      const ex = K.inSlot(S, slot).map((id) => items(S)[id]);
      if (ex.length && !(ex[0].t === 'ing' && ex[0].ing === ing)) return;
      const cap = slotCapT((P.slotDef(S, slot) || {}).type, 'i:' + ing);
      const cur = ex[0] ? ex[0].n : 0, k = Math.min(left, cap - cur); if (k <= 0) return;
      if (ex[0]) { ex[0].n += k; ex[0].lots = lotsMerge(ex[0].lots, [[k, lot[1], lot[2]]]); } else add(S, { t: 'ing', ing, n: k, lots: [[k, lot[1], lot[2]]], at: slot, pl: S._now || 0 });
      left -= k;
    };
    // ケーキの箱はカウンター裏の箱入れから
    const order = ing === 'box' ? ['boxhole', 'shelf', 'cshelf', 'rack', 'table'] : I.cold ? ['cshelf', 'shelf', 'rack', 'table'] : ['shelf', 'cshelf', 'rack', 'table'];
    const okT = (t) => t === 'any' || (t === 'boxes' && ing === 'box');
    const slotsOf = (k) => P.list(S, k).reduce((a, fid) => a.concat(P.slots(S, fid)), []).filter((sl) => okT((P.slotDef(S, sl) || {}).type));
    for (const k of order) for (const sl of slotsOf(k)) { if (left <= 0) break; const ex = K.inSlot(S, sl).map((id) => items(S)[id]); if (ex.length && ex[0].t === 'ing' && ex[0].ing === ing) put(sl); }
    for (const k of order) for (const sl of slotsOf(k)) { if (left <= 0) break; if (!K.inSlot(S, sl).length) put(sl); }
    return n - left;
  };
  K.expSoon = function (S, ing) { let e = null; for (const id of K.stacks(S, ing, true)) { const l = items(S)[id].lots[0]; if (l && l[1] !== 9999 && (e === null || l[1] < e)) e = l[1]; } return e === null ? null : e - S.day; };
  // 閉店時：期限切れの材料を捨てる
  K.expireLots = function (S) {
    let waste = 0;
    for (const id of Object.keys(items(S))) {
      const it = items(S)[id]; if (it.t !== 'ing') continue;
      it.lots = (it.lots || []).filter((l) => { if (l[1] <= S.day) { waste += l[0] * l[2]; it.n -= l[0]; return false; } return true; });
      if (it.n <= 0) del(S, id);
    }
    return waste;
  };

  // =====================================================================
  //  家具
  // =====================================================================
  K.count = (S, k) => P.count(S, { mix: 'mixer', oven: 'oven', reg: 'reg', whip: 'whip', deco: 'deco' }[k] || k);
  K.newKitchen = () => ({ items: {}, st: {}, ordNo: 0 });
  K.st = (S, fid) => S.k.st[fid] || (S.k.st[fid] = {});
  const STATION0 = {
    mix: () => ({ ings: [], st: 'idle' }), whip: () => ({ ings: [], st: 'idle' }), deco: () => ({ st: 'idle' }), oven: () => ({ h: 0, temp: 170, hot: 0 }), sink: () => ({}),
    // 自動の機械
    amix: () => ({ ings: [], st: 'idle' }), awhip: () => ({ ings: [], st: 'idle' }), aoven: () => ({ h: 0, temp: 170, hot: 0 }),
    adeco: () => ({ st: 'idle', hop: {}, cr: null, r: '' }), line: () => ({ on: 1, hop: {}, q: [], r: '' }),
  };
  K.STATION0 = STATION0;
  function addFurn(S, k, x, z, r) { S.fu = S.fu || {}; const id = 'f' + (S.fseq = (S.fseq || 0) + 1); S.fu[id] = { k, x, z, r: r || 0 }; const st = P.KINDS[k].station; if (st) S.k.st[id] = STATION0[st](); return id; }
  K.addFurn = addFurn;
  // 最初のお店：机1・棚1・クリーム台1・商品棚1・洗い場1・冷蔵棚1・冷蔵庫1・レジ1・ゴミ箱1、ケーキの型1・お皿1。材料はなし
  K.setup = function (S) {
    S.fu = {}; S.fseq = 0;
    if (!S.k) S.k = K.newKitchen();
    S.k.wh = 2; // 倉庫は別棟（新しい間取り）
    P.startLayout((S.up && S.up.floor) || 0).forEach(([k, x, z, r]) => addFurn(S, k, x, z, r));
    const sh = P.list(S, 'shelf')[0];
    add(S, { t: 'pan', st: 'empty', at: 'f:' + sh + ':0', pl: 0 });
    add(S, { t: 'plate', s: [], at: 'f:' + sh + ':2', pl: 0 });
    giveKnife(S);
  };
  // 最初のケーキナイフ（1本もらえる）
  function giveKnife(S) {
    S.k.kn = 1;
    if (K.hasKnife(S)) return;
    const it = { t: 'knife', pl: 0 }, tb = P.list(S, 'table')[0];
    const sl = tb && !K.canPut(S, 'f:' + tb + ':3', it) ? 'f:' + tb + ':3' : K.findSlot(S, it, ['table', 'shelf', 'rack', 'cshelf']);
    if (sl) add(S, Object.assign(it, { at: sl }));
  }
  // 空いている置く所（アルバイト・移し替え用）
  K.findSlot = function (S, it, kinds) {
    for (const k of kinds || ['rack', 'table', 'shelf', 'cshelf', 'fridge']) for (const fid of P.list(S, k)) for (const sl of P.slots(S, fid)) if (!K.canPut(S, sl, it)) return sl;
    return null;
  };

  // ---------- 置けるか ----------
  K.canPut = function (S, slot, it) {
    if (!it) return 'もうありません';
    const sd = P.slotDef(S, slot); if (!sd) return 'そこには置けません';
    if (it.t === 'fcrate') return '大きな段ボールは置けません（持ったまま、置きたい床をねらって展開しよう）';
    if (it.t === 'crate' && sd.kind !== 'table' && sd.type !== 'crate') return '段ボールは棚には入れられません（在庫棚・机・床に置くか、開けて中身を並べよう）';
    const here = K.inSlot(S, slot).map((id) => items(S)[id]).filter((x) => x !== it);
    const T = sd.type;
    const one = () => (here.length ? 'ここはうまっています' : '');
    switch (T) {
      case 'any': case 'dry': {
        if (T === 'dry' && !((it.t === 'plate' && !(it.s || []).length) || (it.t === 'pan' && it.st === 'empty'))) return '水切りかごにはお皿・ケーキ型だけ';
        if (!here.length) return '';
        const k = K.skey(it), k0 = K.skey(here[0]);
        if (!k || k !== k0) return 'ここには「' + K.label(S, here[0]) + '」が置いてあります（同じ物だけ重ねられる）';
        const cnt = here.reduce((a, x) => a + units(x), 0);
        if (cnt + (it.t === 'ing' ? it.n : 1) > capOf(k)) return 'いっぱいです';
        return '';
      }
      case 'fridge': if (!(it.t === 'cake' || it.t === 'deco' || it.t === 'cream' || (it.t === 'pan' && (it.st === 'baked' || it.st === 'raw')))) return '冷蔵庫にはケーキ・作りかけ・クリーム・型だけ'; return one();
      case 'tray': if (!(it.t === 'cake' || it.t === 'tray')) return '商品棚にはできたケーキを並べます'; return one();
      case 'mixpan': if (!(it.t === 'pan' && (it.st === 'empty' || it.st === 'raw'))) return 'ここには型を置きます'; return one();
      case 'oven': if (!(it.t === 'pan' && it.st !== 'empty')) return '生地を流した型を入れよう'; return one();
      case 'turn': if (!((it.t === 'pan' && it.st === 'baked') || it.t === 'deco' || it.t === 'cake')) return '焼けたスポンジをのせよう'; return one();
      case 'basin': if (!((it.t === 'plate' && !(it.s || []).length) || (it.t === 'pan' && it.st === 'empty'))) return '流しにはお皿・ケーキ型を入れます'; return one();
      case 'crate': if (it.t !== 'crate') return '在庫棚には段ボールだけ置けます'; return one();
      case 'boxes': {
        // カウンター裏の箱入れ：ケーキの箱だけ（空の箱もここに戻せる）
        if (!((it.t === 'ing' && it.ing === 'box') || (it.t === 'box' && !(it.s || []).length))) return 'ここにはケーキの箱だけしまえます';
        const cnt = here.reduce((a, x) => a + units(x), 0);
        if (cnt + (it.t === 'ing' ? it.n : 1) > P.SLOT_CAP.boxes) return 'いっぱいです（' + P.SLOT_CAP.boxes + '枚まで）';
        return '';
      }
      case 'out': return 'ここは全自動ラインの出口です（できたケーキを取り出す所）';
      default: return 'そこには置けません';
    }
  };
  // ---------- 鮮度（要冷蔵の物は常温に置いているあいだだけ傷む）----------
  const coldSlot = (S, at) => kindOf(at) === 'dl' || P.isCold(S, at);
  K.coldSlot = coldSlot;
  K.spoilSec = function (S, it) {
    if (!it) return 0;
    if (it.t === 'crate' || it.t === 'ing') { const I = D.ING[it.ing]; return I && I.cold && it.n > 0 ? I.warm : 0; }
    if (it.t === 'cream') return D.SPOIL.cream;
    if (it.t === 'deco') return it.cr ? D.SPOIL.cake : 0;
    if (it.t === 'cake' || it.t === 'tray') { const r = sim.recipe(S, it.r); return r && r.cream && r.cream !== 'none' ? D.SPOIL.cake : 0; }
    return 0;
  };
  K.warmMs = (it, now) => (it.wm || 0) + (it.w0 ? Math.max(0, now - it.w0) : 0);
  K.warmFrac = (S, it, now) => { const l = K.spoilSec(S, it); return l ? K.warmMs(it, now) / 1000 / l : 0; };
  K.fresh = function (S, it, now) {
    const lim = K.spoilSec(S, it); if (!lim) return null;
    const w = K.warmMs(it, now) / 1000;
    return { lim, f: clamp(1 - w / lim, 0, 1), stage: it.sp || 0, cold: coldSlot(S, it.at), left: Math.max(0, lim - w) };
  };
  K.label = function (S, it) {
    if (!it) return '';
    switch (it.t) {
      case 'ing': return it.ing === 'box' ? 'ケーキの箱' : ingName(it.ing);
      case 'pan': return it.st === 'empty' ? (it.dirty ? '汚れたケーキ型' : it.wet ? 'ケーキ型（ぬれている）' : 'ケーキ型') : (D.BASES[it.b] || {}).short + (it.st === 'baked' ? '（焼けた）' : it.st === 'baking' ? '（焼いている）' : '生地');
      case 'plate': return it.s && it.s.length ? 'お皿（' + it.s.length + '個）' : it.dirty ? '汚れたお皿' : it.wet ? 'お皿（ぬれている）' : 'お皿';
      case 'box': return 'ケーキの箱' + (it.s && it.s.length ? (it.s.some((x) => x[4]) ? '（' + ((sim.recipe(S, it.s[0][0]) || {}).name || '') + ' ホール）' : '（' + it.s.length + '個）') : '（空）');
      case 'knife': return 'ケーキナイフ';
      case 'cream': return (D.CREAMS[it.k] || {}).name || 'クリーム';
      case 'cake': return ((sim.recipe(S, it.r) || {}).name || 'ケーキ') + (it.w ? '（ホール）' : it.p < it.n ? '（残り' + it.p + '切れ）' : '（' + it.n + '切れ）') + (it.dish ? '・お皿' : '');
      case 'tray': return ((sim.recipe(S, it.r) || {}).name || 'ケーキ') + (it.w ? '（ホール）' : '（' + it.p + '切れ）') + (it.dish ? '・お皿' : '');
      case 'deco': return 'デコ中のケーキ';
      case 'crate': return (it.ing === 'box' ? 'ケーキの箱' : ingName(it.ing)) + '×' + it.n + ' の段ボール';
      case 'fcrate': return ((P.KINDS[it.k] || {}).name || '家具') + 'の大きな段ボール';
      default: return '';
    }
  };
  function spoilStep(S, it, st) {
    const nm = K.label(S, it), raw = it.t === 'crate' || it.t === 'ing';
    if (st === 1) {
      if (it.t === 'cream') it.df = _.union(it.df, ['soft']);
      else if (it.t === 'deco' || it.t === 'cake' || it.t === 'tray') it.df = _.union(it.df, ['melt']);
      _.fx(S, 'err', nm + 'がぬるくなってきた！' + (raw ? '冷蔵棚へ' : '冷蔵庫か冷蔵の商品棚へ'));
    } else {
      if (!raw) it.df = _.union(it.df, ['spoil']);
      _.fx(S, 'err', nm + 'が傷んでしまった…' + (raw ? '使えないので捨てよう' : 'このまま出すとお客さんがお腹をこわすかも'));
    }
  }
  function carryFresh(S, from, to, now) {
    const lf = K.spoilSec(S, from), lt = K.spoilSec(S, to); if (!lf || !lt) return;
    const fr = K.warmMs(from, now) / 1000 / lf, cur = K.warmMs(to, now) / 1000 / lt;
    to.wm = Math.round(Math.max(fr, cur) * lt * 1000); to.w0 = coldSlot(S, to.at) ? 0 : now; to.sp = Math.max(from.sp || 0, to.sp || 0);
  }
  K.tickItems = function (S, now) {
    S._now = now;
    for (const id in S.k.items) {
      const it = S.k.items[id], held = String(it.at).startsWith('h:');
      // ぬれた物は「置いてから」30秒で乾く
      if (it.wet) { if (held) it.wd = 0; else if (!it.wd) it.wd = now + (R.DRY_MS || 30000); else if (now >= it.wd) { it.wet = 0; it.wd = 0; } }
      const lim = K.spoilSec(S, it);
      if (!lim || coldSlot(S, it.at)) { if (it.w0) { it.wm = Math.round(K.warmMs(it, now)); it.w0 = 0; } continue; }
      if (!it.w0) it.w0 = now;
      const w = K.warmMs(it, now) / 1000, st = w >= lim ? 2 : w >= lim / 2 ? 1 : 0;
      if (st > (it.sp || 0)) { it.sp = st; spoilStep(S, it, st); }
    }
  };

  // =====================================================================
  //  正規化（Firebase は空の配列・空のオブジェクトを消す。古いデータは家具の形に移す）
  // =====================================================================
  K.normalize = function (S) {
    if (!S.k || typeof S.k !== 'object') S.k = K.newKitchen();
    const k = S.k;
    if (!k.items || typeof k.items !== 'object') k.items = {};
    if (!k.st || typeof k.st !== 'object') k.st = {};
    if (!S.fu || typeof S.fu !== 'object' || !Object.keys(S.fu).length) migrate(S);
    for (const id in S.fu) { const f = S.fu[id]; if (!f || !P.KINDS[f.k]) { delete S.fu[id]; continue; } f.x = +f.x || 0; f.z = +f.z || 0; f.r = (+f.r || 0) % 4; }
    if (!(k.wh >= 2)) moveStore(S);
    // 間取りが変わって壁・通路・ほかの家具にかかった家具は、近くの空いている所へ（全員の画面で同じ結果になる）
    for (const id of Object.keys(S.fu).sort()) {
      const f = S.fu[id]; if (f.bad || !P.valid(S, id, f.k, f.x, f.z, f.r)) continue;
      delete S.fu[id];
      const sp = P.findSpot(S, f.k, [f.x, f.z]);
      S.fu[id] = sp ? Object.assign(f, sp) : Object.assign(f, { bad: 1 });
    }
    k.pend = _.toArr(k.pend).filter((x) => P.KINDS[x]);
    for (const id in k.items) {
      const it = k.items[id]; if (!it || typeof it !== 'object' || !it.t) { delete k.items[id]; continue; }
      it.df = _.toArr(it.df).filter((x) => x);
      if (it.ings) it.ings = _.toArr(it.ings).filter((x) => x);
      if (it.t === 'box' || it.t === 'plate' || it.s) it.s = _.toArr(it.s).filter((x) => x).map((x) => { const v = _.toArr(x, 4); v[2] = _.toArr(v[2]).filter((y) => y); return v; });
      if (it.t === 'deco' || it.tp) it.tp = _.toArr(it.tp).filter((x) => x).map((x) => _.toArr(x));
      if (it.t === 'deco' && (!it.tops || typeof it.tops !== 'object')) it.tops = {};
      if (it.t === 'ing') { it.lots = _.toArr(it.lots).map((l) => _.toArr(l)).filter((l) => l.length === 3 && l[0] > 0); it.n = it.lots.reduce((a, l) => a + l[0], 0); if (!it.n) { delete k.items[id]; continue; } }
      if (it.t === 'crate') it.n = Math.max(0, +it.n || 0);
      if ((it.t === 'cake' || it.t === 'tray') && !(it.d > 0)) it.d = S.day || 1;
    }
    for (const id in k.items) {
      // 置き場所がなくなった物（家具を消した・古いデータ）は空いている所へ
      const it = k.items[id], at = String(it.at || '');
      if (!at || (at.startsWith('f:') && !P.slotDef(S, at)) || /^(sp|rk|pk|dp|wo|mo|ov|dt|cs):/.test(at)) { const sl = K.findSlot(S, it, ['table', 'shelf', 'rack', 'cshelf', 'fridge']); if (sl) it.at = sl; else if (!((it.t === 'crate' || it.t === 'fcrate') && toFloor(S, it))) delete k.items[id]; }
    }
    for (const fid in S.fu) {
      const st = P.KINDS[S.fu[fid].k].station; if (!st) { delete k.st[fid]; continue; }
      const b = k.st[fid];
      if (!b || typeof b !== 'object') k.st[fid] = STATION0[st]();
      else if (st === 'mix' || st === 'whip' || st === 'amix' || st === 'awhip') { b.ings = _.toArr(b.ings).filter((x) => x); b.df = _.toArr(b.df).filter((x) => x); if (!b.st) b.st = 'idle'; }
      else if ((st === 'oven' || st === 'aoven') && b.temp == null) b.temp = 170;
      else if (st === 'deco' && !b.st) b.st = 'idle';
      else if (st === 'adeco' || st === 'line') {
        if (!b.st) b.st = 'idle';
        b.hop = cleanHop(b.hop);
        if (b.cr && !(typeof b.cr === 'object' && b.cr.k && b.cr.n > 0)) b.cr = null;
        if (b.cr) b.cr.df = _.toArr(b.cr.df).filter((x) => x);
        if (b.tl) b.tl = _.toArr(b.tl).filter((x) => x);
        if (st === 'line') {
          if (b.on == null) b.on = 1;
          b.q = _.toArr(b.q).filter((j) => j && typeof j === 'object' && j.r && sim.recipe(S, j.r)).map((j) => { j.d = _.toArr(j.d).map((x) => +x || 0); if (j.d.length !== 5) j.d = [6000, 12000, 6000, 4000, 3000]; return j; });
        }
      }
    }
    // カウンター裏の箱入れ（前からあるお店にも1つ付ける）
    if (!k.bh && Object.keys(S.fu).length) {
      k.bh = 1;
      if (!P.list(S, 'boxhole').length) { const reg = P.list(S, 'reg')[0], sp = P.findSpot(S, 'boxhole', reg ? [S.fu[reg].x, S.fu[reg].z] : null); if (sp) addFurn(S, 'boxhole', sp.x, sp.z, sp.r); }
    }
    for (const fid in k.st) if (!S.fu[fid]) delete k.st[fid];
    if (S.dayT == null) S.dayT = 0;
    if (k.truck && (typeof k.truck !== 'object' || !(k.truck.at >= 0))) k.truck = null;
    for (const id in k.items) { const it = k.items[id]; if (it.t === 'fcrate' && String(it.at).startsWith('dl:') && !k.truck) { k.pend.push(it.k); delete k.items[id]; continue; } if (it.t === 'fcrate' && !P.KINDS[it.k]) { delete k.items[id]; continue; } }
    for (const id in k.items) { const it = k.items[id]; if (it.t === 'crate' && String(it.at).startsWith('dl:') && !k.truck) { const sl = K.findSlot(S, it, ['crack', 'table']); if (sl) it.at = sl; else if (!toFloor(S, it)) delete k.items[id]; } }
    // 床の物：段ボール以外は棚へ。置けない所（壁が動いた・家具が来た）にある段ボールは近くの床へ
    for (const id of Object.keys(k.items).sort()) {
      const it = k.items[id];
      if (it.at !== 'fl') { if (it.fx != null && !String(it.at).startsWith('h:')) clearFloor(it); continue; }
      if (!(it.t === 'crate' || it.t === 'fcrate')) { clearFloor(it); const sl = K.findSlot(S, it, ['table', 'shelf', 'rack', 'cshelf', 'fridge']); if (sl) it.at = sl; else delete k.items[id]; continue; }
      it.fx = +it.fx || 0; it.fz = +it.fz || 0; it.fr = (+it.fr || 0) % 2;
      if (P.floorOk(S, it, it.fx, it.fz, it.fr, id)) { it.at = 'tmp'; if (!toFloor(S, it, [it.fx, it.fz])) { if (it.t === 'fcrate') { k.pend.push(it.k); delete k.items[id]; } else delete k.items[id]; } }
    }
    // 棚に入っている段ボール（古いデータ）は床へ。1枠10個を超えた材料の山は分ける
    for (const id of Object.keys(k.items).sort()) {
      const it = k.items[id], sd = P.slotDef(S, it.at);
      if (it.t === 'crate' && sd && sd.kind !== 'table' && sd.type !== 'crate') { if (!toFloor(S, it)) delete k.items[id]; continue; }
      if (it.t === 'ing' && sd && it.n > slotCapT(sd.type, 'i:' + it.ing)) {
        const part = split(S, id, it.n - STACK_CAP.ing), kinds = D.ING[it.ing] && D.ING[it.ing].cold ? ['cshelf', 'shelf', 'table'] : ['shelf', 'cshelf', 'table'];
        for (const kd of kinds) for (const fid of P.list(S, kd)) for (const sl of P.slots(S, fid)) {
          if (!(part.n > 0) || K.inSlot(S, sl).length || P.slotDef(S, sl).type !== 'any') continue;
          const c = Math.min(STACK_CAP.ing, part.n), t = lotsTake(part.lots, c); part.n -= c;
          add(S, { t: 'ing', ing: it.ing, n: c, lots: t.lots, wm: part.wm, w0: 0, sp: part.sp, at: sl, pl: 0 });
        }
        if (part.n > 0) { const cr = { t: 'crate', ing: it.ing, n: part.n, u: Math.round(lotsCost(part.lots, part.n) / part.n), open: 1, ar: 0, pl: 0 }; if (toFloor(S, cr)) add(S, cr); }
      }
    }
    delete S.ovens; delete S.showcase;
    if (!k.kn && Object.keys(S.fu).length) giveKnife(S);
  };
  // 機械の投入口：{ 材料: [個数, 原価の合計] }
  function cleanHop(h) {
    const out = {};
    if (h && typeof h === 'object') for (const ing in h) { const v = _.toArr(h[ing]); if (D.ING[ing] && +v[0] > 0) out[ing] = [+v[0], Math.max(0, +v[1] || 0)]; }
    return out;
  }
  // 前の間取り（倉庫が店の中の左奥）のお店：倉庫にあった家具と床の段ボールを、店の横に建てた倉庫へそのまま引っ越す
  function moveStore(S) {
    S.k.wh = 2;
    const g = P.geomOf(S), RX = g.RX, RZ = g.RZ, st = g.st;
    const old = { x0: -RX, x1: -RX + 6.2, z0: -RZ, z1: -RZ + 4.6 + st * 1.3 }, dx = g.store.x0 - old.x0, dz = g.store.z0 - old.z0;
    const inOld = (b) => b[0] >= old.x0 - 0.05 && b[2] <= old.x1 + 0.1 && b[1] >= old.z0 - 0.05 && b[3] <= old.z1 + 0.1;
    const moved = [];
    for (const id of Object.keys(S.fu).sort()) {
      const f = S.fu[id]; if (P.KINDS[f.k].counter || !inOld(P.box(f))) continue;
      const nx = Math.round((f.x + dx) * 100) / 100, nz = Math.round((f.z + dz) * 100) / 100;
      if (!P.valid(S, id, f.k, nx, nz, f.r)) { f.x = nx; f.z = nz; moved.push(id); continue; }
      const keep = S.fu[id]; delete S.fu[id];
      const sp = P.findSpot(S, keep.k, [nx, nz]);
      S.fu[id] = sp && P.zoneOf(g, sp.x, sp.z) === 'store' ? Object.assign(keep, sp) : keep;
    }
    for (const id of Object.keys(S.k.items || {}).sort()) {
      const it = S.k.items[id]; if (!it || it.at !== 'fl' || !(it.t === 'crate' || it.t === 'fcrate')) continue;
      if (!inOld(P.floorBox(it))) continue;
      const nx = it.fx + dx, nz = it.fz + dz; if (!P.floorOk(S, it, nx, nz, it.fr, id)) { it.fx = nx; it.fz = nz; }
    }
    return moved.length;
  }
  K.moveStore = moveStore;
  // 古いお店（家具が無い）を新しい形に移す。持っていた設備・在庫・並んでいたケーキはできるだけ引きつぐ
  function migrate(S) {
    const old = { inv: S.inv || {}, cases: _.toArr(S.showcase).filter((c) => c && typeof c === 'object' && c.p > 0), ovens: _.toArr(S.ovens).length, items: S.k.items || {} };
    const fl = clamp((S.up && S.up.floor) || 0, 0, 3);
    S.k.items = {}; S.k.st = {};
    K.setup(S);
    if (old.ovens || Object.keys(old.inv).length || old.cases.length) {
      const extra = [['oven', Math.max(1, old.ovens)], ['mixer', KD.mix ? KD.mix[fl] || 2 : 2], ['deco', KD.deco ? KD.deco[fl] || 2 : 2], ['whip', (KD.whip ? KD.whip[fl] || 2 : 2) - 1], ['shelf', 2], ['cshelf', 2]];
      extra.forEach(([kd, n]) => { for (let i = 0; i < n; i++) { const sp = P.findSpot(S, kd); if (sp) addFurn(S, kd, sp.x, sp.z, sp.r); } });
      const sh = P.list(S, 'shelf');
      for (let i = 0; i < 2; i++) add(S, { t: 'pan', st: 'empty', at: 'f:' + sh[0] + ':0', pl: 0 });
      for (let i = 0; i < 2 + 2 * ((S.furn && S.furn.table) || 0); i++) add(S, { t: 'plate', s: [], at: 'f:' + sh[0] + ':2', pl: 0 });
      for (const id in old.inv) { let n = 0, cost = 0; _.toArr(old.inv[id]).forEach((l) => { l = _.toArr(l); n += +l[0] || 0; cost = +l[2] || cost; }); if (n > 0 && D.ING[id]) K.invAdd(S, id, n, cost || D.ING[id].price); }
      K.invAdd(S, 'box', 20, D.ING.box.price);
      const slots = P.list(S, 'scase').concat(P.list(S, 'pcase')).reduce((a, f) => a.concat(P.slots(S, f)), []).concat(P.list(S, 'fridge').reduce((a, f) => a.concat(P.slots(S, f)), []));
      old.cases.forEach((c) => { const sl = slots.find((x) => !K.inSlot(S, x).length); if (!sl) return; const tray = P.slotDef(S, sl).type === 'tray'; add(S, { t: tray ? 'tray' : 'cake', r: c.r, q: c.q, p: c.p, n: c.n || R.PIECES, c: c.c || 0, d: c.d || S.day, df: _.toArr(c.df), at: sl, pl: 0 }); });
      for (const id in old.items) { const it = old.items[id]; if (it && it.t === 'crate' && String(it.at).startsWith('dl:')) S.k.items[id] = it; }
    }
    delete S.inv;
    S.v = 2;
  }

  // =====================================================================
  //  判定・ゲージ
  // =====================================================================
  function baseFromIngs(ings) {
    const cnt = {}; ings.forEach((x) => (cnt[x] = (cnt[x] || 0) + 1));
    for (const id in D.BASES) { const B = D.BASES[id]; const keys = Object.keys(B.ing); if (keys.length === Object.keys(cnt).length && keys.every((k) => cnt[k] === B.ing[k])) return id; }
    return null;
  }
  function creamFromIngs(ings) {
    const cnt = {}; ings.forEach((x) => (cnt[x] = (cnt[x] || 0) + 1));
    for (const id in D.CREAMS) { if (id === 'none') continue; const C = D.CREAMS[id]; const keys = Object.keys(C.ing); if (keys.length === Object.keys(cnt).length && keys.every((k) => cnt[k] === C.ing[k])) return id; }
    return null;
  }
  function orderMistakes(ings, order) { const seq = []; ings.forEach((x) => { if (seq.indexOf(x) < 0) seq.push(x); }); let m = 0; seq.forEach((x, i) => { if (order[i] !== x) m++; }); return m; }
  K.baseFromIngs = baseFromIngs; K.creamFromIngs = creamFromIngs;
  K.gauge = function (S, kind) {
    const diff = (D.DIFF[S.diff] || D.DIFF.normal).win;
    if (kind === 'mix') { const e = _.eqv(S, 'mixer'); return { sec: 6.5 * e.fast, lo: 1 - 0.09 * diff * e.win, hi: 1 + 0.09 * diff * e.win, over: 1.3 }; }
    if (kind === 'whip') { const e = _.eqv(S, 'whisk'); return { sec: 7 / e.gain, lo: 1 - 0.07 * diff * e.win, hi: 1 + 0.05 * diff * e.win, over: 1.12 }; }
    return { sec: 4.2, lo: 1 - 0.1 * diff, hi: 1 + 0.12 * diff, over: 1.45 };
  };
  K.prog = (st, now) => (st && st.st === 'run' ? Math.max(0, (now - st.t0) / 1000 / st.sec) : st ? st.m || 0 : 0);
  function gaugeResult(g, m) {
    if (m >= g.lo && m <= g.hi) return { q: 1, d: null };
    if (m < g.lo) return { q: clamp(1 - (g.lo - m) * 2.4, 0.2, 1), d: m < g.lo - 0.12 ? 'under' : null };
    return { q: clamp(1 - (m - g.hi) * 2.2, 0.2, 1), d: m > g.over ? 'over' : null };
  }
  function topScore(tp) {
    const n = tp.length; if (!n) return 1;
    if (n === 1) return clamp(1 - Math.hypot(tp[0][0], tp[0][1]) * 0.9, 0.3, 1);
    const pts = tp.map(([x, z]) => ({ a: Math.atan2(z, x), r: Math.hypot(x, z) }));
    const rm = pts.reduce((s, p) => s + p.r, 0) / n, rs = Math.sqrt(pts.reduce((s, p) => s + (p.r - rm) ** 2, 0) / n);
    const as = pts.map((p) => p.a).sort((a, b) => a - b); let ae = 0; const gap = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) { const g = (i < n - 1 ? as[i + 1] - as[i] : as[0] + Math.PI * 2 - as[i]); ae += Math.abs(g - gap) / gap; }
    ae /= n;
    let close = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.hypot(tp[i][0] - tp[j][0], tp[i][1] - tp[j][1]) < 0.18) close++;
    return clamp(1 - ae * 0.55 - rs * 1.6 - close * 0.15, 0.15, 1);
  }
  const station = (S, fid, kind) => { const f = S.fu && S.fu[fid]; return f && P.KINDS[f.k].station === kind ? K.st(S, fid) : null; };
  const slot0 = (fid) => 'f:' + fid + ':0';
  K.slot0 = slot0;

  // =====================================================================
  //  プレイヤーの操作
  // =====================================================================
  const needHand = (S, a) => (K.held(S, a.pid) ? ng('手がふさがっています') : null);
  const A = (K.ACT = {});
  K.ANYTIME = { fbuy: 1, tbuy: 1, fmove: 1 }; // 家具の買い物・配置はいつでも
  const heldIt = (S, a) => { const id = K.held(S, a.pid); return id ? [id, items(S)[id]] : [null, null]; };
  // 持つ（棚の山は一番上の1つ。材料の山は take）
  A.pick = function (S, a, now) {
    const it = items(S)[a.id]; if (!it || String(it.at).startsWith('h:') || kindOf(it.at) === 'c') return ng('もうありません');
    if (it.t === 'ing') return A.take(S, Object.assign({}, a, { all: a.all == null ? 1 : a.all }), now);
    if (needHand(S, a)) return needHand(S, a);
    if (!K.arrived(it, now)) return ng('トラックがまだ到着していません');
    if (it.res) return ng('アルバイトが使っています');
    const sd = P.slotDef(S, it.at);
    if (sd && sd.type === 'turn' && it.t === 'deco' && /^(run|spread)$/.test(K.st(S, sd.fid).st)) return ng('クリームを塗っているところです（塗り終えてから）');
    if (sd && sd.type === 'turn' && it.t === 'deco' && K.st(S, sd.fid).st === 'auto') return ng('自動デコ機が仕上げているところです');
    if (sd && sd.type === 'basin' && K.st(S, sd.fid).by && K.st(S, sd.fid).by !== a.pid && now - (K.st(S, sd.fid).t0 || 0) < 120000) return ng('ほかの人が洗っているところです');
    if (sd && sd.type === 'oven') takeFromOven(S, it, now);
    if (it.t === 'tray') it.t = 'cake';
    it.at = 'h:' + a.pid; it.pl = now; clearFloor(it);
    return ok();
  };
  // 材料の山から取る（1つずつ／全部）。手に同じ材料を持っていれば足していく
  A.take = function (S, a, now) {
    const it = items(S)[a.id]; if (!it || it.t !== 'ing' || String(it.at).startsWith('h:')) return ng('もうありません');
    if (it.res) return ng('アルバイトが使っています');
    const [, h] = heldIt(S, a);
    if (it.ing === 'box') {
      if (h) return ng('手をあけてから箱を取ろう');
      const t = lotsTake(it.lots, 1); it.n -= 1; if (it.n <= 0) del(S, a.id);
      add(S, { t: 'box', s: [], c: t.cost, at: 'h:' + a.pid, pl: now });
      return ok();
    }
    if (h && !(h.t === 'ing' && h.ing === it.ing)) return ng('手がふさがっています');
    const n = a.all ? it.n : 1;
    if (h && h.n + n > STACK_CAP.ing) return ng('これ以上持てません');
    const part = split(S, a.id, n);
    if (h) mergeInto(S, h, part); else add(S, Object.assign(part, { at: 'h:' + a.pid, pl: now }));
    if (it.n <= 0) del(S, a.id);
    return ok();
  };
  // 置く（同じ材料・同じ物は重なる）。one=1 なら材料を1つだけ
  A.put = function (S, a, now) {
    const [hid, it] = heldIt(S, a); if (!hid) return ng('何も持っていません');
    const sd = P.slotDef(S, a.slot); if (!sd) return ng('そこには置けません');
    if (it.t === 'fcrate') return ng('大きな段ボールは置けません。床をねらって展開しよう');
    if (it.t === 'crate' && sd.kind !== 'table' && sd.type !== 'crate') return ng('段ボールは棚には入れられません。在庫棚・机・床に置くか、開けて中身を並べよう');
    let src = it, srcId = hid;
    if (it.t === 'ing' && a.one && it.n > 1) { src = split(S, hid, 1); srcId = null; }
    if (src.t === 'cake' && !src.dish && sd.type === 'any') {
      // お皿の上にのせる（お皿の上でも切れる。使い切るとお皿が残る）
      const here = K.inSlot(S, a.slot).map((id) => [id, items(S)[id]]);
      if (here.length === 1 && here[0][1].t === 'plate' && !(here[0][1].s || []).length) {
        const pl = here[0][1];
        if (pl.dirty || pl.wet) return ng(pl.dirty ? '汚れたお皿です。洗い場へ' : 'お皿がまだぬれています');
        del(S, here[0][0]); src.dish = 1; src.at = a.slot; src.pl = now;
        return ok('お皿にのせた（ケーキナイフで切れます）');
      }
    }
    const why = K.canPut(S, a.slot, src); if (why) { if (!srcId) mergeInto(S, it, src); return ng(why); }
    if (sd.type === 'tray' && src.t === 'cake') {
      // ケーキをショーケース・商品棚に並べる（ホールはホールのまま。切ってあれば切れのまま）
      del(S, hid); add(S, Object.assign({}, src, { t: 'tray', at: a.slot, pl: now }));
      return ok(src.w ? 'ホールのまま並べた（ケーキナイフで6等分にするとカットでも売れる）' : (sim.recipe(S, src.r) || {}).name + ' を' + src.p + '切れ並べた');
    }
    if (sd.type === 'turn' && src.t === 'pan') {
      // 焼けた型を回転台に → 型から外す（空の型は汚れて手に残る）
      // 自動デコ機は、温かいスポンジは冷めるまで待ってから塗る（溶けない）
      const warm = now < (src.cool || 0), auto = sd.kind === 'adeco';
      add(S, { t: 'deco', b: src.b, q: src.q, df: _.union(src.df, warm && !auto ? ['melt'] : []), c: src.c, cr: null, crq: 1, sq: 1, tops: {}, tp: [], warm: warm && !auto ? 1 : 0, cu: warm && auto ? src.cool : 0, at: a.slot, pl: now });
      Object.assign(src, { st: 'empty', dirty: 1, b: null, q: 0, df: [], c: 0, cool: 0, lab: '' });
      if (auto) return ok(warm ? '自動デコ機にのせた（冷めてから自動で仕上げます。空の型は洗い場へ）' : '自動デコ機にのせた（空の型は洗い場へ）');
      return ok(warm ? 'まだ温かい…クリームが溶けるかも（空の型は洗い場へ）' : 'スポンジを回転台にのせた（空の型は洗い場へ）');
    }
    if (src.t === 'box' && !(src.s || []).length) {
      // 空の箱 → 箱の山へ
      const ex = K.inSlot(S, a.slot).map((id) => items(S)[id])[0];
      if (ex && ex.t === 'ing' && ex.ing === 'box') { ex.n += 1; ex.lots = lotsMerge(ex.lots, [[1, 9999, src.c || D.ING.box.price]]); }
      else add(S, { t: 'ing', ing: 'box', n: 1, lots: [[1, 9999, src.c || D.ING.box.price]], at: a.slot, pl: now });
      del(S, hid); return ok();
    }
    if (src.t === 'ing') {
      const ex = K.inSlot(S, a.slot).map((id) => items(S)[id])[0];
      if (ex) { mergeInto(S, ex, src); if (srcId) del(S, srcId); else if (it.n <= 0) del(S, hid); return ok(); }
      if (srcId) { src.at = a.slot; src.pl = now; } else { add(S, Object.assign(src, { at: a.slot, pl: now })); if (it.n <= 0) del(S, hid); }
      return ok();
    }
    src.at = a.slot; src.pl = now;
    // 冷却ラック・冷蔵の所に置くと、焼いたスポンジが早く冷める
    if (src.t === 'pan' && src.st === 'baked' && src.cool > now && !src.cq) { const f = P.KINDS[sd.kind].cool || (P.KINDS[sd.kind].cold ? 0.6 : 1); if (f < 1) { src.cool = now + (src.cool - now) * f; src.cq = 1; } }
    if (sd.type === 'oven') putInOven(S, src, sd.fid, now);
    if (src.wet) src.wd = 0;
    return ok();
  };
  // 捨てる（ゴミ箱）
  A.trash = function (S, a) {
    const [hid, it] = heldIt(S, a); if (!hid) return ng('何も持っていません');
    if (it.t === 'fcrate') return ng('買った家具です。置きたい所をねらって展開しよう');
    if (it.t === 'knife') return ng('ケーキナイフは捨てません。机や棚に置こう');
    if (it.t === 'crate' && it.n > 0 && (it.sp || 0) < 2) return ng('中身が入っています。開けて棚に置こう');
    if (it.t === 'crate' && !(it.n > 0)) { del(S, hid); return ok('段ボールを片づけた'); }
    if (it.t === 'pan' && it.st !== 'empty') {
      // 型に入った生地・スポンジは中身だけ捨てる（型は汚れて手に残る）
      S.today.waste += Math.round(itemCost(it));
      if ((it.sp || 0) >= 2) S.today.spoiled = (S.today.spoiled || 0) + 1;
      Object.assign(it, { st: 'empty', dirty: 1, b: null, q: 0, df: [], c: 0, cool: 0, lab: '' }); delete it.bk; delete it.tg;
      return ok('中身を捨てた（型は洗い場で洗おう）');
    }
    S.today.waste += Math.round(itemCost(it));
    if ((it.sp || 0) >= 2) S.today.spoiled = (S.today.spoiled || 0) + 1;
    del(S, hid);
    if (it.t === 'plate') { S.today.broken = (S.today.broken || 0) + 1; return ok('お皿を捨てた（お皿が1枚減った）'); }
    if (it.t === 'pan') return ok('ケーキ型を捨てた（型が1つ減った）');
    return ok((it.sp || 0) >= 2 ? '傷んだ' + K.label(S, it) + 'を捨てました' : '捨てました');
  };
  // 手から落とす：お皿は床に落ちて割れる
  A.drop = function (S, a) {
    const [hid, it] = heldIt(S, a); if (!hid) return ng('何も持っていません');
    if (it.t === 'plate') { S.today.broken = (S.today.broken || 0) + 1; S.today.waste += Math.round(itemCost(it)); del(S, hid); _.fx(S, 'break', 'パリン！お皿を落として割ってしまった…'); return ok(); }
    return A.trash(S, a);
  };
  // ボウルに材料を入れる（手に持った材料から1つ。all=1 なら持っている分を全部）
  // 全自動ライン・自動デコ機は投入口へ
  const bowlOf = (S, fid) => station(S, fid, 'mix') || station(S, fid, 'whip') || station(S, fid, 'amix') || station(S, fid, 'awhip');
  K.bowlOf = bowlOf;
  const stKind = (S, fid) => { const f = S.fu && S.fu[fid]; return f && P.KINDS[f.k] ? P.KINDS[f.k].station : null; };
  A.addIng = function (S, a, now) {
    const kd = stKind(S, a.fid);
    if (kd === 'line' || kd === 'adeco') return hopLoad(S, a, kd);
    const b = bowlOf(S, a.fid); if (!b) return ng();
    if (b.by) return ng('アルバイトが使っています');
    if (b.st !== 'idle') return ng(b.st === 'run' ? (b.auto ? '自動で混ぜているところです' : '回しているところです') : 'ボウルを空けてから入れよう');
    const [hid, h] = heldIt(S, a);
    if (!h || h.t !== 'ing' || h.ing === 'box') return ng('棚から材料を持ってこよう');
    if ((h.sp || 0) >= 2) return ng(ingName(h.ing) + 'は傷んでいて使えません');
    if (b.ings.length >= 10) return ng('ボウルがいっぱいです');
    const n = a.all ? Math.min(h.n, 10 - b.ings.length) : 1;
    for (let k = 0; k < n; k++) { const t = lotsTake(h.lots, 1); h.n -= 1; b.c = (b.c || 0) + t.cost; b.ings.push(h.ing); }
    if (h.n <= 0) del(S, hid);
    b.lt = now || S._now || 0;
    return ok();
  };
  A.run = function (S, a, now) {
    if (station(S, a.fid, 'deco')) return runDeco(S, a, now);
    if (station(S, a.fid, 'amix') || station(S, a.fid, 'awhip')) return ng('自動で混ぜます（材料をそろえるだけでOK）');
    if (station(S, a.fid, 'adeco')) return ng('自動で塗ります（スポンジ・クリーム・トッピングをセットするだけ）');
    const kind = station(S, a.fid, 'mix') ? 'mix' : 'whip';
    const b = station(S, a.fid, kind); if (!b) return ng();
    if (b.by && a.pid) return ng('アルバイトが使っています');
    if (b.st === 'idle') {
      if (!b.ings.length) return ng('先に材料を入れよう');
      const g = K.gauge(S, kind);
      b.st = 'run'; b.t0 = now; b.sec = g.sec; b.m = 0;
      return ok();
    }
    if (b.st !== 'run') return ng();
    const g = K.gauge(S, kind), m = K.prog(b, now), r = gaugeResult(g, m);
    b.st = 'done'; b.m = m;
    if (kind === 'mix') {
      const base = baseFromIngs(b.ings);
      if (!base) { b.k = null; b.q = 0; b.df = []; return ok('分量が合わない…失敗した生地になった（捨てよう）'); }
      const mis = orderMistakes(b.ings, D.BASES[base].order);
      const df = []; if (mis >= 2) df.push('flat'); if (r.d === 'under') df.push('lump'); if (r.d === 'over') df.push('flat');
      b.k = base; b.q = clamp(r.q * (1 - mis * 0.12), 0.1, 1); b.df = _.cleanDf(df);
      return ok(D.BASES[base].name + 'ができた' + (r.q >= 1 && !mis ? '（ばっちり！）' : '') + '。きれいなケーキ型を持ってきて流そう');
    }
    const cream = creamFromIngs(b.ings);
    if (!cream) { b.k = null; b.q = 0; b.df = []; return ok('分量が合わない…失敗したクリーム（捨てよう）'); }
    const df = []; if (r.d === 'under') df.push('soft'); if (r.d === 'over' || m > g.over) df.push('sep');
    b.k = cream; b.q = r.q; b.df = _.cleanDf(df); b.n = D.CREAM_YIELD;
    return ok(D.CREAMS[cream].name + 'ができた' + (r.q >= 1 ? '（ばっちり！）' : ''));
  };
  // 生地を型に流す（ケーキ型を持ってミキサーへ。横の型置きに置いてあればそれに）
  A.pour = function (S, a, now) {
    const b = station(S, a.fid, 'mix') || station(S, a.fid, 'amix'); if (!b || b.st !== 'done') return ng('まだ生地ができていません');
    if (!b.k) return ng('失敗した生地は捨てよう');
    let pid = K.held(S, a.pid), pan = pid && items(S)[pid];
    if (!pan || pan.t !== 'pan') { pid = K.at(S, slot0(a.fid)); pan = pid && items(S)[pid]; }
    if (!pan || pan.t !== 'pan' || pan.st !== 'empty') return ng('空のケーキ型を持ってこよう');
    if (pan.dirty) return ng('汚れた型です。洗い場で洗おう');
    if (pan.wet) return ng('型がまだぬれています（置いて乾かそう）');
    Object.assign(pan, { b: b.k, st: 'raw', q: b.q, df: b.df || [], c: b.c || 0 });
    S.k.st[a.fid] = { ings: [], st: 'idle' };
    return ok(D.BASES[pan.b].short + 'の生地を型に流した');
  };
  A.scoop = function (S, a, now) {
    if (needHand(S, a)) return needHand(S, a);
    const b = station(S, a.fid, 'whip') || station(S, a.fid, 'awhip'); if (!b || b.st !== 'done') return ng('まだクリームができていません');
    if (!b.k) return ng('失敗したクリームは捨てよう');
    add(S, { t: 'cream', k: b.k, q: b.q, df: b.df || [], n: b.n || D.CREAM_YIELD, c: (b.c || 0) / D.CREAM_YIELD, day: S.day, at: 'h:' + a.pid, pl: now });
    S.k.st[a.fid] = { ings: [], st: 'idle' };
    return ok();
  };
  A.dump = function (S, a, now) {
    const kd = stKind(S, a.fid);
    if (kd === 'adeco') {
      // 自動デコ機：クリームのタンクを空ける
      const b = K.st(S, a.fid); if (!b.cr || !(b.cr.n > 0)) return ng('クリームのタンクは空です');
      if (b.st === 'auto') return ng('仕上げているところです');
      S.today.waste += Math.round((b.cr.c || 0) * b.cr.n); b.cr = null;
      return ok('クリームのタンクを空けた');
    }
    if (kd === 'line') {
      // 全自動ライン：投入口の材料を棚に戻す（入りきらない分は廃棄）
      const b = K.st(S, a.fid); const ks = Object.keys(b.hop || {}); if (!ks.length) return ng('投入口は空です');
      let back = 0, waste = 0;
      for (const ing of ks) { const [n, c] = b.hop[ing], u = n ? c / n : 0, put = K.invAdd(S, ing, n, Math.round(u)); back += put; waste += (n - put) * u; }
      b.hop = {}; S.today.waste += Math.round(waste);
      return ok('投入口の材料を棚に戻した（' + back + '個）' + (waste > 0 ? '。入りきらない分は廃棄' : ''));
    }
    const b = bowlOf(S, a.fid); if (!b || (!b.ings.length && b.st !== 'done')) return ng('空です');
    if (b.by) return ng('アルバイトが使っています');
    S.today.waste += Math.round(b.c || 0);
    S.k.st[a.fid] = { ings: [], st: 'idle' };
    return ok('ボウルを空けた');
  };
  // オーブン：温度を変える（電源も入る）／電源を切る
  A.oven = function (S, a, now) {
    if (station(S, a.fid, 'aoven')) return ng('自動オーブンは温度を自動で合わせます（生地を入れるだけ）');
    const o = station(S, a.fid, 'oven'); if (!o) return ng();
    if (a.op === 'off') { o.h = 0; return ok('オーブンを止めた'); }
    const T = D.OVEN_TEMPS; const cur = o.h ? T.indexOf(o.temp) : -1;
    const t = a.op === 'set' ? +a.temp : T[(cur + 1) % T.length] || 170;
    if (T.indexOf(t) < 0) return ng();
    const heat = D.PREHEAT_MS * _.eqv(S, 'oven').heat;
    o.hot = now + (o.h ? heat * 0.5 : heat); o.h = 1; o.temp = t;
    const pid = K.at(S, slot0(a.fid)); if (pid) putInOven(S, items(S)[pid], a.fid, now);
    return ok(t + '℃ で予熱中…');
  };
  function putInOven(S, it, fid, now) {
    const o = K.st(S, fid);
    if (it.st !== 'raw' || !o) return;
    if (!o.h) { it.wait = 1; return; }
    // 自動オーブン：温度が合って予熱が終わってから焼き始める
    if (stKind(S, fid) === 'aoven' && (now < (o.hot || 0) || o.temp !== (D.BASES[it.b] || {}).temp)) { it.wait = 1; return; }
    const cold = now < (o.hot || 0), B = D.BASES[it.b];
    it.st = 'baking'; it.wait = 0;
    it.bk = { t0: now, dur: _.ovenDur(S, it.b, o.temp, cold), dT: o.temp - B.temp, cold: cold ? 1 : 0, temp: o.temp };
  }
  function takeFromOven(S, it, now) {
    if (it.st !== 'baking' || !it.bk) return;
    const d = (now - it.bk.t0) / it.bk.dur;
    const r = _.bakeQuality(S, d, it.bk.dT, it.bk.cold);
    it.st = 'baked'; it.q = clamp((it.q || 0.5) * 0.4 + r.q * 0.6 + (_.eqv(S, 'oven').qb || 0), 0, 1); it.df = _.union(it.df, r.df);
    it.cool = now + _.coolMs(S) * 2; it.cq = 0; it.lab = r.label; delete it.bk;
    _.fx(S, d >= 1 - _.bakeWindow(S, 0) && d <= 1 + _.bakeWindow(S, 0) ? 'good' : 'info', D.BASES[it.b].short + '：' + r.label);
  }
  K.takeFromOven = takeFromOven;
  // デコ：クリームを持って回転台を使う → 指でなぞって塗る（spreadDone で点数）
  function runDeco(S, a, now) {
    const b = K.st(S, a.fid), did = K.at(S, slot0(a.fid)), dk = did && items(S)[did];
    if (!dk || dk.t !== 'deco') return ng('回転台にスポンジをのせよう');
    if (b.st === 'spread') return ng(b.by === a.pid ? '塗っているところです' : 'ほかの人が塗っています');
    if (dk.cr) return ng('クリームはもう塗ってあります');
    const [hid, cr] = heldIt(S, a);
    if (!cr || cr.t !== 'cream') return ng('クリームを持ってこよう');
    if (D.BASES[dk.b] && D.BASES[dk.b].cookie) return ng('焼き菓子にはクリームを使いません');
    dk.cr = cr.k; dk.crq = cr.q; dk.df = _.union(dk.df, cr.df, dk.warm ? ['melt'] : []); dk.c = (dk.c || 0) + (cr.c || 0);
    carryFresh(S, cr, dk, now);
    cr.n -= 1; if (cr.n <= 0) del(S, hid);
    dk.sq = 0.35;
    Object.assign(b, { st: 'spread', t0: now, by: a.pid });
    return ok();
  }
  A.spreadDone = function (S, a, now) {
    const b = station(S, a.fid, 'deco'), did = K.at(S, slot0(a.fid)), dk = did && items(S)[did];
    if (!b || b.st !== 'spread') return ng();
    if (b.by !== a.pid && now - (b.t0 || 0) < 60000) return ng('ほかの人が塗っています');
    const q = clamp(+a.q || 0, 0, 1);
    b.st = 'idle'; b.by = null;
    if (dk && dk.t === 'deco') { dk.sq = q; if (q < 0.55) dk.df = _.union(dk.df, ['uneven']); }
    return ok(q >= 0.85 ? 'なめらかに塗れた！（' + Math.round(q * 100) + '点）' : q >= 0.55 ? 'まあまあ（' + Math.round(q * 100) + '点）' : 'ムラになった…（' + Math.round(q * 100) + '点）');
  };
  // トッピングを置く（手に持った材料から1つ。x, z はケーキ上の位置 -1〜1）
  A.topPlace = function (S, a, now) {
    const did = K.at(S, slot0(a.fid)), dk = did && items(S)[did];
    if (!dk || dk.t !== 'deco') return ng('回転台にスポンジをのせよう');
    if (K.st(S, a.fid).st === 'spread') return ng('クリームを塗り終えてから');
    const [hid, h] = heldIt(S, a);
    if (!h || h.t !== 'ing' || !D.TOPS[h.ing]) return ng('トッピングを持ってこよう');
    if ((h.sp || 0) >= 2) return ng(ingName(h.ing) + 'は傷んでいて使えません');
    const x = clamp(+a.x || 0, -1, 1), z = clamp(+a.z || 0, -1, 1);
    if (Math.hypot(x, z) > 1.02) return ng('ケーキの上に置こう');
    const t = lotsTake(h.lots, 1); h.n -= 1; if (h.n <= 0) del(S, hid);
    dk.tp.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100, h.ing, Math.round(t.cost)]);
    dk.tops[h.ing] = (dk.tops[h.ing] || 0) + 1; dk.c = (dk.c || 0) + t.cost;
    return ok();
  };
  // 置いたトッピングを1つ取る（まちがえたとき・手に戻す）
  A.topTake = function (S, a, now) {
    const did = K.at(S, slot0(a.fid)), dk = did && items(S)[did];
    if (!dk || dk.t !== 'deco' || !dk.tp.length) return ng();
    const [, h] = heldIt(S, a);
    const last = dk.tp[dk.tp.length - 1], k = last[2];
    if (h && !(h.t === 'ing' && h.ing === k)) return ng('手をあけてから');
    dk.tp.pop(); dk.tops[k] = Math.max(0, (dk.tops[k] || 0) - 1); if (!dk.tops[k]) delete dk.tops[k];
    const cost = last[3] != null ? +last[3] : Math.round((D.ING[k] || {}).price || 0); dk.c = Math.max(0, (dk.c || 0) - cost);
    const part = { t: 'ing', ing: k, n: 1, lots: newLots(S, k, 1, cost), wm: 0, w0: 0, sp: 0 };
    if (h) mergeInto(S, h, part); else add(S, Object.assign(part, { at: 'h:' + a.pid, pl: now }));
    return ok();
  };
  A.finish = function (S, a, now) {
    const did = K.at(S, slot0(a.fid)), dk = did && items(S)[did];
    if (!dk || dk.t !== 'deco') return ng('回転台に何もありません');
    if (K.st(S, a.fid).st === 'spread') return ng('クリームを塗り終えてから');
    const tops = {}; for (const k in dk.tops) if (dk.tops[k] > 0) tops[k] = dk.tops[k];
    const rid = _.findRecipeByCombo(dk.b, dk.cr || 'none', tops);
    const exact = rid && Object.keys(tops).every((k) => (sim.recipe(S, rid).tops || {})[k] === tops[k]) && Object.keys(sim.recipe(S, rid).tops || {}).every((k) => tops[k] === sim.recipe(S, rid).tops[k]);
    if (!rid || !exact) {
      const near = Object.keys(S.known).map((r) => sim.recipe(S, r)).find((r) => r && r.base === dk.b && (r.cream || 'none') === (dk.cr || 'none'));
      return ng(near ? '組み合わせが違います（' + near.name + ' なら ' + Object.keys(near.tops || {}).map((k) => D.ING[k].name + '×' + near.tops[k]).join('・') + '）' : 'このスポンジとクリームのレシピはありません');
    }
    if (!S.known[rid]) return ng('「' + sim.recipe(S, rid).name + '」はまだ作れません（店舗レベル ' + (sim.recipe(S, rid).lv || 1) + '）');
    const r = sim.recipe(S, rid), n = sim.pieceCount(r);
    const ts = topScore(dk.tp);
    const q = clamp(dk.q * 0.35 + (dk.cr ? dk.crq * 0.2 + dk.sq * 0.2 : 0.4) + ts * 0.25, 0, 1);
    const df = _.union(dk.df, ts < 0.45 ? ['messy'] : []);
    del(S, did);
    const whole = sim.wholeable(r);
    const cid = add(S, Object.assign({ t: 'cake', r: rid, q, df, p: n, n, c: Math.round(dk.c || 0), d: S.day, at: slot0(a.fid), pl: now }, whole ? { w: 1 } : {}));
    carryFresh(S, dk, items(S)[cid], now);
    _.fx(S, 'cake', r.name + ' が完成！（品質' + Math.round(q * 100) + '）' + (whole ? 'ホールのまま売るか、ケーキナイフで6等分に切ってカットで売ろう' : 'ショーケースに並べよう'));
    return ok();
  };
  // 箱・お皿に1切れ入れる（箱やお皿を持って、切ってあるケーキを使う。ショーケースでも台の上でも）
  const onSlot = (it) => !!it && String(it.at).startsWith('f:');
  A.slice = function (S, a, now) {
    const [, h] = heldIt(S, a);
    if (!h || !(h.t === 'box' || h.t === 'plate')) return ng('箱かお皿を持ってこよう');
    if (h.t === 'plate' && (h.dirty || h.wet)) return ng(h.dirty ? '汚れたお皿です。洗い場へ' : 'お皿がまだぬれています（置いて乾かそう）');
    const tr = items(S)[a.id]; if (!tr || !(tr.t === 'tray' || tr.t === 'cake') || !onSlot(tr) || !(tr.p > 0)) return ng('売り切れです');
    if (tr.res) return ng('アルバイトが使用中');
    if (tr.w) return ng('まだ切っていません。ケーキナイフで6等分に切ろう（ホールのまま箱に入れることもできます）');
    const max = h.t === 'box' ? 6 : R.EAT_MAX || 3;
    if (K.boxUnits(h) >= max) return ng(h.t === 'box' ? '箱がいっぱいです' : 'お皿がいっぱいです');
    h.s.push([tr.r, Math.round(tr.q * 100) / 100, tr.df || [], Math.round(tr.c / (tr.n || R.PIECES))]);
    tr.p -= 1; if (tr.p <= 0) consumeCake(S, a.id, now);
    return ok();
  };
  // 箱・お皿の最後の1切れを戻す
  A.unslice = function (S, a) {
    const [, h] = heldIt(S, a); if (!h || !(h.t === 'box' || h.t === 'plate') || !h.s.length) return ng();
    const tr = items(S)[a.id]; const last = h.s[h.s.length - 1];
    if (last[4]) return ng('ホールは空いている所に戻そう');
    if (!tr || !(tr.t === 'tray' || tr.t === 'cake') || tr.w || !onSlot(tr) || tr.r !== last[0] || tr.p >= tr.n) return ng('同じケーキの所に戻そう');
    h.s.pop(); tr.p += 1; return ok();
  };
  // ケーキナイフで6等分に切る（机・棚・ショーケース・デコ台・お皿の上など、台の上ならどこでも）
  const CUT_OK = { any: 1, tray: 1, turn: 1, dry: 1, out: 1 };
  A.cut = function (S, a) {
    const [, kn] = heldIt(S, a);
    if (!kn || kn.t !== 'knife') return ng('ケーキナイフを持とう');
    const it = items(S)[a.id];
    if (!it || !(it.t === 'cake' || it.t === 'tray')) return ng('切れるケーキがありません');
    if (!it.w) return ng('もう切ってあります');
    if (it.res) return ng('アルバイトが使用中');
    const sd = onSlot(it) && P.slotDef(S, it.at);
    if (!sd || !CUT_OK[sd.type]) return ng(sd && sd.type === 'fridge' ? '冷蔵庫の中では切れません。台の上に出そう' : '台の上に置いてから切ろう');
    delete it.w; it.p = it.n;
    S.today.cut = (S.today.cut || 0) + 1;
    return ok(((sim.recipe(S, it.r) || {}).name || 'ケーキ') + 'を' + it.n + '等分に切った！箱かお皿で1切れずつ取れます');
  };
  // 切っていないホールを、空の箱にそのまま入れる（ホールは1箱に1台）
  A.hole = function (S, a, now) {
    const [, h] = heldIt(S, a);
    if (!h || h.t !== 'box') return ng('ケーキの箱を持ってこよう');
    if ((h.s || []).length) return ng('空の箱を持ってこよう（ホールは1箱に1台）');
    const it = items(S)[a.id];
    if (!it || !(it.t === 'cake' || it.t === 'tray') || !onSlot(it)) return ng('ケーキがありません');
    if (!it.w) return ng('切ってあるケーキはホールで入れられません（1切れずつ入れよう）');
    if (it.res) return ng('アルバイトが使用中');
    h.s.push([it.r, Math.round(it.q * 100) / 100, it.df || [], Math.round(it.c || 0), 1, it.d || S.day]);
    consumeCake(S, a.id, now);
    return ok('ホールのまま箱に入れた');
  };
  // 箱に入れたホールを出す（空いている台の上に）
  A.unhole = function (S, a, now) {
    const [, h] = heldIt(S, a);
    const last = h && h.t === 'box' && (h.s || [])[0];
    if (!last || !last[4]) return ng();
    const sd = P.slotDef(S, a.slot); if (!sd) return ng('そこには置けません');
    const r = sim.recipe(S, last[0]); if (!r) return ng();
    const n = sim.pieceCount(r);
    const ck = { t: sd.type === 'tray' ? 'tray' : 'cake', r: last[0], q: +last[1] || 0, df: _.toArr(last[2]).filter((x) => x), p: n, n, c: +last[3] || 0, d: +last[5] || S.day, w: 1 };
    const why = K.canPut(S, a.slot, ck.t === 'tray' ? Object.assign({}, ck, { t: 'cake' }) : ck); if (why) return ng(why);
    h.s = [];
    add(S, Object.assign(ck, { at: a.slot, pl: now }));
    return ok('ホールを箱から出した');
  };
  // 商品棚のケーキごと手に取る
  A.caseTake = function (S, a, now) {
    if (needHand(S, a)) return needHand(S, a);
    const tr = items(S)[a.id]; if (!tr || tr.t !== 'tray') return ng();
    tr.t = 'cake'; tr.at = 'h:' + a.pid; tr.pl = now;
    return ok();
  };
  // 段ボール
  A.openCrate = function (S, a) {
    const [, cr] = heldIt(S, a);
    if (!cr || cr.t !== 'crate') return ng('段ボールを持っていません');
    if (a.close) { if (!cr.open) return ng('もう閉じています'); cr.open = 0; return ok('段ボールを閉じた'); }
    if (cr.open) return ng('もう開いています');
    cr.open = 1; return ok();
  };
  // 段ボール（材料の段ボール・家具の大きな段ボール）を床に置く。空の段ボールもOK
  A.floor = function (S, a, now) {
    const [hid, it] = heldIt(S, a);
    if (!it || !(it.t === 'crate' || it.t === 'fcrate')) return ng('床に置けるのは段ボールだけです');
    const x = Math.round((+a.x || 0) * 100) / 100, z = Math.round((+a.z || 0) * 100) / 100, r = ((Math.round(+a.r || 0) % 2) + 2) % 2;
    const why = P.floorOk(S, it, x, z, r, hid); if (why) return ng(why);
    it.at = 'fl'; it.fx = x; it.fz = z; it.fr = r; it.pl = now;
    return ok(it.t === 'fcrate' ? '大きな段ボールを床に置いた（持ち上げて、置きたい所で展開）' : it.n > 0 ? '段ボールを床に置いた' : '空の段ボールを床に置いた');
  };
  // 開けた段ボールの中身を棚に置く（1つずつ／全部）。置く所は自分で決める
  A.shelve = function (S, a, now) {
    const [, cr] = heldIt(S, a);
    if (!cr || cr.t !== 'crate') return ng('段ボールを持っていません');
    if (!cr.open) return ng('先に段ボールを開けよう');
    if (!(cr.n > 0)) return ng('段ボールは空です（捨てよう）');
    if ((cr.sp || 0) >= 2) return ng(ingName(cr.ing) + 'は常温に置きすぎて傷んでいます。ゴミ箱へ（廃棄）');
    const sd = P.slotDef(S, a.slot); if (!sd || !(sd.type === 'any' || (sd.type === 'boxes' && cr.ing === 'box'))) return ng(sd && sd.type === 'boxes' ? '箱入れにはケーキの箱だけしまえます' : '棚や机に置こう');
    const ex = K.inSlot(S, a.slot).map((id) => items(S)[id]);
    if (ex.length && !(ex[0].t === 'ing' && ex[0].ing === cr.ing)) return ng('ここには「' + K.label(S, ex[0]) + '」が置いてあります');
    const cap = slotCapT(sd.type, 'i:' + cr.ing), cur = ex.length ? ex[0].n : 0, room = cap - cur;
    if (room <= 0) return ng('いっぱいです');
    const k = Math.min(a.all ? cr.n : 1, room), half = (cr.sp || 0) >= 1;
    const part = { t: 'ing', ing: cr.ing, n: k, lots: newLots(S, cr.ing, k, cr.u, half), wm: cr.wm || 0, w0: 0, sp: cr.sp || 0 };
    if (ex.length) mergeInto(S, ex[0], part); else add(S, Object.assign(part, { at: a.slot, pl: now }));
    cr.n -= k; S.today.shelved = (S.today.shelved || 0) + k;
    if (!cr.n) { cr.wm = 0; cr.w0 = 0; cr.sp = 0; }
    return ok(cr.n ? (k < (a.all ? cr.n + k : 1) ? 'この枠はいっぱい（1枠' + cap + '個まで）。残りはほかの枠へ' : '') :(cr.ing === 'box' ? 'ケーキの箱' : ingName(cr.ing)) + 'を全部しまった' + (half ? '（ぬるくなっていたので日持ちが短め）' : '') + '（空の段ボールはゴミ箱へ・床に置いてもOK）');
  };
  // 洗う：流しに入れたお皿・型を、なぞって泡立て → 水で流す（q は泡立ての点数）
  A.washStart = function (S, a, now) {
    const b = station(S, a.fid, 'sink'); if (!b) return ng();
    const id = K.at(S, slot0(a.fid));
    if (!id) return ng('流しにお皿か型を入れよう');
    if (b.by && b.by !== a.pid && now - (b.t0 || 0) < 120000) return ng('ほかの人が洗っています');
    b.by = a.pid; b.t0 = now; return ok();
  };
  A.wash = function (S, a, now) {
    const b = station(S, a.fid, 'sink'); if (!b) return ng();
    const id = K.at(S, slot0(a.fid)), it = id && items(S)[id];
    if (b.by && b.by !== a.pid && now - (b.t0 || 0) < 120000) return ng('ほかの人が洗っています');
    b.by = null;
    if (!it) return ng('流しが空です');
    if (!(+a.q >= 0.5)) return ng('まだ汚れが落ちていません（もっと泡立てて）');
    it.dirty = 0; it.wet = 1; it.wd = 0;
    S.today.washed = (S.today.washed || 0) + 1;
    return ok((it.t === 'plate' ? 'お皿' : 'ケーキ型') + 'がきれいになった！水切りかごや棚に置くと30秒で乾きます');
  };
  // 看板：OPEN／CLOSE
  A.sign = function (S, a, now) {
    if (S.phase === 'prep') return sim.ACT.open(S, a, now);
    if (S.phase === 'open') return sim.ACT.close(S, a, now);
    return ng('今日の営業は終わりました');
  };
  // ---------- 家具：動かす・買う ----------
  A.fmove = function (S, a) {
    const f = S.fu[a.id]; if (!f) return ng('もうありません');
    const ctr = P.KINDS[f.k].counter, g = P.geomOf(S);
    const x = Math.round((+a.x || 0) * 100) / 100, z = ctr ? g.counter.z : Math.round((+a.z || 0) * 100) / 100, r = ctr ? 0 : ((Math.round(+a.r || 0) % 4) + 4) % 4;
    const why = P.valid(S, a.id, f.k, x, z, r); if (why) return ng(why);
    f.x = x; f.z = z; f.r = r;
    return ok();
  };
  A.fbuy = function (S, a, now) {
    const Kd = P.KINDS[a.k]; if (!Kd) return ng();
    if (Kd.lv &&sim.shopLevel(S).lv < Kd.lv) return ng('「' + Kd.name + '」は店舗レベル ' + Kd.lv + ' で買えるようになります');
    if (S.funds < Kd.price) return ng('資金が足りません');
    S.funds -= Kd.price; S.today.capex = (S.today.capex || 0) + Kd.price;
    const pend = (S.k.pend = S.k.pend || []); pend.push(a.k);
    const n0 = pend.length; loadFurn(S, now || S._now || 0);
    const onTruck = pend.length < n0;
    _.fx(S, 'up', Kd.name + ' を買った！' + (onTruck ? 'トラックで大きな段ボールが届きます。持って、置きたい所で展開しよう' : 'いまのトラックが帰ったら次の便で届きます'));
    return { ok: true };
  };
  // 大きな段ボールを持って、置きたい床で展開する
  A.unpack = function (S, a, now) {
    const [hid, it] = heldIt(S, a); if (!it || it.t !== 'fcrate') return ng('大きな段ボールを持っていません');
    const Kd = P.KINDS[it.k], g = P.geomOf(S);
    const x = Math.round((+a.x || 0) * 100) / 100, z = Kd.counter ? g.counter.z : Math.round((+a.z || 0) * 100) / 100, r = Kd.counter ? 0 : ((Math.round(+a.r || 0) % 4) + 4) % 4;
    const why = P.valid(S, null, it.k, x, z, r); if (why) return ng(why);
    const id = addFurn(S, it.k, x, z, r); del(S, hid);
    _.fx(S, 'good', Kd.name + ' を設置した！（「配置」でいつでも動かせます）');
    return { ok: true, id };
  };
  // テスト・引きつぎ用：すぐに空いている所へ置く
  K.placeNew = function (S, k, near) { const sp = P.findSpot(S, k, near); return sp ? addFurn(S, k, sp.x, sp.z, sp.r) : null; };
  A.tbuy = function (S, a, now) {
    const T = P.TOOLS[a.k]; if (!T) return ng();
    if (S.funds < T.price) return ng('資金が足りません');
    const it = a.k === 'plate' ? { t: 'plate', s: [] } : a.k === 'knife' ? { t: 'knife' } : { t: 'pan', st: 'empty' };
    const sl = K.findSlot(S, it, ['shelf', 'table', 'rack', 'cshelf']); if (!sl) return ng('置く場所がありません（棚を空けよう）');
    S.funds -= T.price; S.today.capex = (S.today.capex || 0) + T.price;
    add(S, Object.assign(it, { at: sl, pl: now }));
    return ok(T.name + 'を1つ買って棚に置きました');
  };

  // =====================================================================
  //  お客さん（OPEN のときだけ来る）
  //   来る → レジに並ぶ（q）→ 注文を受ける → 待つ（w）→ 商品を受け取る → レジでお会計（pay）→ 店内なら席で食べる（eat）→ 帰る
  // =====================================================================
  K.regs = (S) => P.list(S, 'reg');
  K.queue = function (S, reg) { return Object.keys(S.cust).filter((id) => S.cust[id].st === 'q' && S.cust[id].reg === reg).sort((a, b) => S.cust[a].tq - S.cust[b].tq); };
  K.payQ = function (S, reg) { return Object.keys(S.cust).filter((id) => S.cust[id].st === 'pay' && S.cust[id].reg === reg).sort((a, b) => (S.cust[a].tPay || 0) - (S.cust[b].tPay || 0)); };
  K.seats = (S) => 2 * ((S.furn && S.furn.table) || 0);
  K.seatBusy = function (S, i) { for (const id in S.cust) { const c = S.cust[id]; if (c.seat === i && c.st !== 'out') return true; } return !!K.at(S, 'seat:' + i); };
  K.spawn = function (S, now) {
    const regs = K.regs(S); if (!regs.length) return;
    const inShop = Object.values(S.cust).filter((c) => c.st === 'in' || c.st === 'q' || c.st === 'w' || c.st === 'pay').length;
    if (inShop >= 5 * regs.length + 2 + sim.rush(S).cap) { S.today.miss++; S.today.cust++; return; }
    const ct = _.wpick(D.CUSTOMERS);
    let reg = regs[0], best = 1e9; for (const r of regs) { const n = Object.values(S.cust).filter((c) => c.reg === r && (c.st === 'q' || c.st === 'in' || c.st === 'pay')).length; if (n < best) { best = n; reg = r; } }
    S.cust[_.uid(S, 'u')] = { ty: ct.id, v: Math.floor(Math.random() * 4), st: 'in', t0: now, tq: now + R.WALK_MS, reg, seat: -1 };
  };
  // ショーケースの在庫：切ってある切れ数（shelfStock）／ホールの台数（holeStock）
  K.shelfStock = function (S) { const st = {}; for (const id in items(S)) { const it = items(S)[id]; if (it.t === 'tray' && it.p > 0 && !it.w) st[it.r] = (st[it.r] || 0) + it.p; } return st; };
  K.holeStock = function (S) { const st = {}; for (const id in items(S)) { const it = items(S)[id]; if (it.t === 'tray' && it.w) st[it.r] = (st[it.r] || 0) + 1; } return st; };
  K.trays = (S) => Object.keys(items(S)).filter((id) => items(S)[id].t === 'tray' && items(S)[id].p > 0 && !items(S)[id].w);
  K.holes = (S) => Object.keys(items(S)).filter((id) => items(S)[id].t === 'tray' && items(S)[id].w);
  // 足りない物：先にホールの注文にホールを回し、残ったホールは切ればカットに使える
  K.need = function (S) {
    const left = K.shelfStock(S), leftH = K.holeStock(S), short = {}, shortH = {}, by = {}, per = {};
    const ws = Object.keys(S.cust).filter((id) => S.cust[id].st === 'w').sort((a, b) => (S.cust[a].no || 0) - (S.cust[b].no || 0));
    ws.forEach((id) => { const o = S.cust[id].wh || {}; per[id] = { p: {}, h: {} }; for (const r in o) { const use = Math.min(leftH[r] || 0, o[r]); leftH[r] = (leftH[r] || 0) - use; if (o[r] > use) { shortH[r] = (shortH[r] || 0) + o[r] - use; per[id].h[r] = o[r] - use; by[id] = 1; } } });
    for (const r in leftH) if (leftH[r] > 0) { const rc = sim.recipe(S, r); left[r] = (left[r] || 0) + leftH[r] * sim.pieceCount(rc); }
    ws.forEach((id) => { const o = S.cust[id].ord || {}; for (const r in o) { const use = Math.min(left[r] || 0, o[r]); left[r] = (left[r] || 0) - use; if (o[r] > use) { short[r] = (short[r] || 0) + o[r] - use; per[id].p[r] = o[r] - use; by[id] = 1; } } });
    return { short, shortH, by, per };
  };
  K.shortage = function (S) { const n = K.need(S), short = Object.assign({}, n.short); for (const r in n.shortH) short[r] = (short[r] || 0) + n.shortH[r]; short._by = n.by; return short; };
  function decide(S, c, now) {
    const ct = D.CUSTOMERS.find((x) => x.id === c.ty) || D.CUSTOMERS[0];
    const noise = Math.exp(_.gauss() * 0.15);
    const opts = [];
    let seen = 0, worstP = null;
    const avail = {}; for (const id of K.trays(S)) { const k = items(S)[id]; avail[k.r] = { p: (avail[k.r] ? avail[k.r].p : 0) + k.p, q: k.q, df: k.df }; }
    const availH = {}; for (const id of K.holes(S)) { const k = items(S)[id]; availH[k.r] = { n: (availH[k.r] ? availH[k.r].n : 0) + 1, q: k.q, df: k.df }; if (!avail[k.r]) avail[k.r] = { p: k.n, q: k.q, df: k.df }; }
    const big = sim.rush(S).size;
    // ホールで買う人（お祝い・家族など）：ホールの値段で決める
    if (Math.random() < Math.min(0.95, (ct.hole || 0) * (1 + 0.2 * big))) {
      const hopts = [];
      for (const rid of _.menuRecipes(S)) {
        const m = S.menu[rid], r = sim.recipe(S, rid); if (!sim.wholeable(r) || !(m.hp > 0)) continue;
        const a = availH[rid] || avail[rid];
        const w = sim.holeWtp(S, r, a ? a.q : 0.78, ct, noise, rid) * (a ? _.appearance(a.df) : 1), mk = sim.holeMarket(S, rid, r);
        if (w > m.hp && m.hp <= mk * R.PRICE_LIMIT) hopts.push({ rid, s: (w - m.hp) / m.hp + (availH[rid] ? 0.2 : 0) + Math.random() * 0.25, price: m.hp });
      }
      if (hopts.length) {
        hopts.sort((a, b) => b.s - a.s);
        const o = hopts[0];
        c.ord = {}; c.price = {}; c.wh = { [o.rid]: 1 }; c.hprice = { [o.rid]: o.price };
        c.st = 'q'; c.pq = now + R.QUEUE_MS; c.say = ''; c.dine = 0; c.seat = -1;
        c.pm = Math.random() < 0.6 ? 'card' : 'cash';
        return;
      }
    }
    for (const rid of _.menuRecipes(S)) {
      const m = S.menu[rid], r = sim.recipe(S, rid);
      seen++;
      const a = avail[rid];
      const w = _.wtp(S, r, a ? a.q : 0.78, ct, noise, rid) * (a ? _.appearance(a.df) : 1);
      const mk = _.cakeMarket(S, rid, r); if (!worstP || m.price / mk > worstP.f) worstP = { rid, f: m.price / mk, mk };
      if (w > m.price && m.price <= mk * R.PRICE_LIMIT) opts.push({ rid, s: (w - m.price) / m.price + (a ? 0.12 : 0) + Math.random() * 0.25, price: m.price });
    }
    if (!opts.length) {
      c.st = 'out'; c.tEnd = now + R.WALK_MS; c.sayT = now; S.today.miss++; S.today.cust++;
      if (!seen) { c.say = _.pick(D.SAY.soldout); S.today.soldout++; _.rate(S, 1.8, 0.02); }
      else if (worstP && worstP.f > R.PRICE_LIMIT) {
        c.say = _.pick(['高すぎる！相場の倍近いよ', 'この値段はないでしょ…', 'ぼったくりじゃない？']);
        S.today.pcomp = (S.today.pcomp || 0) + 1; S.today.complaints = (S.today.complaints || 0) + 1;
        _.rate(S, 1.4, 0.035);
        if (Math.random() < 0.45) _.fx(S, 'review', '口コミ ★1「' + ((sim.recipe(S, worstP.rid) || {}).name || 'ケーキ') + 'が高すぎる。相場は' + worstP.mk + '円くらいなのに」');
      } else { c.say = _.pick(D.SAY.pricey); _.rate(S, 2.6, 0.012); }
      return;
    }
    opts.sort((a, b) => b.s - a.s);
    // 店内で食べる？（空いている席があれば。お皿1枚にのる数まで）
    let seat = -1;
    if (Math.random() < 0.42) for (let i = 0; i < K.seats(S); i++) if (!K.seatBusy(S, i)) { seat = i; break; }
    const MAX = seat >= 0 ? R.EAT_MAX || 3 : R.ORDER_MAX || 6;
    const ord = {}, price = {};
    const kinds = Math.min(opts.length, ct.multi ? (Math.random() < 0.55 ? 2 : Math.random() < 0.4 + 0.15 * big ? 3 : 1) : Math.random() < 0.2 + 0.1 * big ? 2 : 1);
    let total = 0;
    for (let i = 0; i < kinds && total < MAX; i++) {
      const o = opts[i], want = ct.multi ? 1 + Math.floor(Math.random() * (3 + big)) : Math.random() < 0.3 + 0.12 * big ? 2 + (Math.random() < 0.25 * big ? 1 : 0) : 1;
      const n = Math.min(MAX - total, want); if (n <= 0) break;
      ord[o.rid] = n; price[o.rid] = o.price; total += n;
    }
    c.ord = ord; c.price = price; c.wh = {}; c.st = 'q'; c.pq = now + R.QUEUE_MS; c.say = '';
    c.dine = seat >= 0 ? 1 : 0; c.seat = seat;
    c.pm = Math.random() < 0.45 ? 'card' : 'cash';
  }
  K.tickCustomers = function (S, now) {
    for (const id in S.cust) {
      const c = S.cust[id];
      if (c.st === 'in' && now >= c.tq) decide(S, c, now);
      else if (c.st === 'q' && now >= c.pq) { leave(S, c, now, '待ちきれない…'); _.rate(S, 1.6, 0.03); }
      else if (c.st === 'w' && now >= c.pw) { leave(S, c, now, c.make ? '遅すぎる…もういいです' : 'まだ来ない…もういいです'); S.today.slow = (S.today.slow || 0) + 1; _.rate(S, 1.3, 0.05); _.fx(S, 'err', '注文 #' + c.no + ' のお客さんが待ちきれずに帰ってしまった…'); }
      else if (c.st === 'pay' && now >= (c.pt || 0)) {
        // お会計してもらえない → 商品を置いて帰る
        const got = K.at(S, 'c:' + id);
        if (got) { const it = items(S)[got]; S.today.waste += Math.round(itemCost(it)); if (it.t === 'plate') { it.s = []; it.dirty = 1; const sl = K.findSlot(S, it, ['table', 'shelf']); if (sl) it.at = sl; else del(S, got); } else del(S, got); }
        leave(S, c, now, 'お会計してくれない…'); _.rate(S, 1.2, 0.06); _.fx(S, 'err', 'お会計を待っていたお客さんが帰ってしまった…');
      }
      else if ((c.st === 'out' || c.st === 'eat') && now >= c.tEnd) endEat(S, id, c, now);
    }
  };
  // 食べ終わった：汚れたお皿が席に残る
  function endEat(S, id, c, now) {
    if (c.st === 'eat') {
      const pl = K.at(S, 'c:' + id); if (pl) Object.assign(items(S)[pl], { at: 'seat:' + c.seat, s: [], dirty: 1, pl: now });
      c.st = 'out'; c.tEnd = now + R.WALK_MS; c.seat = -1; c.left = 1;
    } else delete S.cust[id];
  }
  function leave(S, c, now, say) { c.st = 'out'; c.tEnd = now + R.WALK_MS; c.say = say || ''; c.sayT = now; c.seat = -1; S.today.miss++; S.today.cust++; }
  // お客さんに帰ってもらう（ねらって「帰ってもらう」）。渡した商品は返してもらう
  A.shoo = function (S, a, now) {
    const c = S.cust[a.c]; if (!c || c.st === 'out') return ng('もう帰るところです');
    const was = c.st;
    c.res = null;
    if (was === 'eat') { endEat(S, a.c, c, now); c.say = 'ごちそうさまでした…'; c.sayT = now; return ok('お客さんに帰ってもらいました（お皿は席に残ります）'); }
    let back = '';
    const gid = K.at(S, 'c:' + a.c), it = gid && items(S)[gid];
    if (it) {
      // 渡した箱・お皿は返してもらう（手が空いていれば手に、だめなら机・棚に。置けなければ廃棄）
      if (!K.held(S, a.pid)) { it.at = 'h:' + a.pid; it.pl = now; back = '（商品は返してもらいました）'; }
      else { const sl = K.findSlot(S, it, ['table', 'fridge', 'shelf']); if (sl) { it.at = sl; it.pl = now; back = '（商品は机・棚に戻しました）'; } else { S.today.waste += Math.round(itemCost(it)); del(S, gid); } }
    }
    leave(S, c, now, was === 'w' || was === 'pay' ? 'えっ…じゃあ、いいです' : 'あ、はい…また来ます');
    if (was === 'w' || was === 'pay') _.rate(S, 2.2, 0.015);
    return ok('お客さんに帰ってもらいました' + back);
  };
  K.sendAway = function (S, now, msg) { for (const id in S.cust) { const c = S.cust[id]; if (c.st === 'in' || c.st === 'q') { c.st = 'out'; c.tEnd = now + R.WALK_MS; c.say = msg || ''; c.sayT = now; c.seat = -1; } } };
  // 注文を受ける（レジで先頭のお客さん）
  A.takeOrder = function (S, a, now) {
    const c = S.cust[a.c]; if (!c || c.st !== 'q') return ng();
    if (K.queue(S, c.reg)[0] !== a.c) return ng('先頭のお客さんから注文を受けよう');
    return takeOrder(S, a.c, now);
  };
  function takeOrder(S, cid, now) {
    const c = S.cust[cid];
    c.st = 'w'; c.no = ++S.k.ordNo; c.tOrd = now;
    const n = Object.values(c.ord || {}).reduce((s, x) => s + x, 0) + Object.values(c.wh || {}).reduce((s, x) => s + x * 3, 0);
    const nd = K.need(S).per[cid] || { p: {}, h: {} }, mk = Object.keys(nd.p).concat(Object.keys(nd.h));
    c.make = mk.length ? 1 : 0;
    c.pw = now + R.WAIT_MS + n * 9000 + (mk.length ? (R.MAKE_MS || 180000) + (mk.length - 1) * 45000 : 0);
    c.say = c.make ? '作ってもらえるなら待つよ' : '注文 #' + c.no;
    _.fx(S, 'order', '注文 #' + c.no + '：' + K.ordText(S, c.ord, c.wh) + (c.dine ? '（店内・お皿で）' : '（お持ち帰り・箱で）') + (c.make ? '／ショーケースに無い → 急いで作ろう！' : ''));
    return ok();
  }
  const rname = (S, r) => (sim.recipe(S, r) || {}).name || r;
  K.ordText = (S, ord, wh) => Object.keys(wh || {}).map((r) => rname(S, r) + ' ホール×' + wh[r]).concat(Object.keys(ord || {}).map((r) => rname(S, r) + ' カット×' + ord[r])).join('、');
  // 商品を渡す（持ち帰り＝箱、店内＝お皿）→ レジでお会計へ
  A.serve = function (S, a, now) {
    const c = S.cust[a.c]; if (!c || c.st !== 'w') return ng('注文を待っているお客さんに渡そう');
    const [, h] = heldIt(S, a);
    if (!h || !(h.t === 'box' || h.t === 'plate')) return ng(c.dine ? 'お皿にのせて渡そう（店内で食べます）' : '箱に詰めて渡そう（お持ち帰り）');
    if (c.dine && h.t !== 'plate') return ng('このお客さんは店内で食べます。お皿にのせて渡そう');
    if (!c.dine && h.t !== 'box') return ng('このお客さんはお持ち帰りです。箱に詰めて渡そう');
    const got = {}, gotH = {}; h.s.forEach((x) => { const g = x[4] ? gotH : got; g[x[0]] = (g[x[0]] || 0) + 1; });
    const eq = (A, B) => Object.keys(A).every((r) => B[r] === A[r]) && Object.keys(B).every((r) => A[r] === B[r]);
    if (!eq(c.ord || {}, got) || !eq(c.wh || {}, gotH)) { c.say = '注文と違うよ…'; c.sayT = now; return ng('注文と違います：' + K.ordText(S, c.ord, c.wh)); }
    h.at = 'c:' + a.c;
    toPay(S, a.c, now);
    return ok(c.pm === 'card' ? 'レジでお会計（カード）' : 'レジでお会計（現金 ¥' + c.tend.toLocaleString() + ' お預かり）');
  };
  function toPay(S, cid, now) {
    const c = S.cust[cid], it = items(S)[K.at(S, 'c:' + cid)];
    c.st = 'pay'; c.tPay = now; c.pt = now + (R.PAY_MS || 60000);
    c.due = (it ? it.s : []).reduce((a, x) => a + priceOf(S, c, x), 0);
    if (c.pm === 'cash') { const d = c.due, opts = [Math.ceil(d / 1000) * 1000, Math.ceil(d / 500) * 500, Math.ceil(d / 100) * 100, Math.ceil(d / 10) * 10, d < 5000 ? 5000 : 10000, 10000]; c.tend = _.pick(opts.filter((x) => x >= d)); }
    c.say = c.pm === 'card' ? 'カードでお願いします' : '現金で（¥' + c.tend.toLocaleString() + '）';
    c.sayT = now;
  }
  // 1つぶんの値段（ホールはホールの値段）
  function priceOf(S, c, x) { const m = S.menu[x[0]] || {}; return x[4] ? (c.hprice && c.hprice[x[0]]) || m.hp || (m.price || 0) * 6 : (c.price && c.price[x[0]]) || m.price || 0; }
  K.change = (c) => (c && c.pm === 'cash' ? Math.max(0, (c.tend || 0) - (c.due || 0)) : 0);
  // お会計：カードはタッチするだけ。現金はお釣りを選んで渡す（足りないと渡せない）
  A.pay = function (S, a, now) {
    const c = S.cust[a.c]; if (!c || c.st !== 'pay') return ng('お会計を待っているお客さんはいません');
    if (K.payQ(S, c.reg)[0] !== a.c) return ng('先頭のお客さんからお会計しよう');
    let over = 0;
    if (c.pm === 'cash') {
      const ch = Math.round(+a.ch || 0), need = K.change(c);
      if (ch < need) return ng('お釣りが足りません（¥' + need.toLocaleString() + '）');
      over = ch - need;
      if (over > 0) { S.funds -= over; S.today.over = (S.today.over || 0) + over; }
    }
    const gid = K.at(S, 'c:' + a.c), it = gid && items(S)[gid];
    settle(S, c, it ? it.s : [], now);
    if (it && it.t === 'box') del(S, gid);
    return ok(c.pm === 'card' ? 'カードでお会計しました' : over > 0 ? 'お釣りを ¥' + over.toLocaleString() + ' 多く渡してしまった…' : 'ありがとうございました！');
  };
  function settle(S, c, slices, now) {
    const ct = D.CUSTOMERS.find((x) => x.id === c.ty) || D.CUSTOMERS[0];
    let sales = 0, cogs = 0, qs = 0, pen = 0, surplus = 0, worst = null, priceF = 0; const df = [];
    let units = 0;
    slices.forEach((x) => {
      const [rid, q, d, cost, hole] = x;
      const price = priceOf(S, c, x);
      sales += price; cogs += cost || 0; qs += q;
      const r = sim.recipe(S, rid), u = hole && r ? sim.pieceCount(r) : 1; units += u;
      surplus += r ? ((hole ? sim.holeWtp(S, r, q, ct, 1, rid) : _.wtp(S, r, q, ct, 1, rid)) * _.appearance(d) - price) / Math.max(1, price) : 0;
      const over = r ? price / (hole ? sim.holeMarket(S, rid, r) : _.cakeMarket(S, rid, r)) : 1; if (over > priceF) priceF = over;
      (d || []).forEach((y) => { if (df.indexOf(y) < 0) df.push(y); });
      S.today.best[rid] = (S.today.best[rid] || 0) + u;
      if (hole) S.today.hole = (S.today.hole || 0) + 1;
    });
    const n = Math.max(1, slices.length); qs /= n; surplus /= n;
    df.forEach((x) => { const X = D.DEFECTS[x]; pen += X.sat * (ct.picky > 0.6 ? 1.3 : 1); if (!worst || X.sat > D.DEFECTS[worst].sat) worst = x; });
    const waitF = clamp(((c.tPay || now) - c.tOrd) / Math.max(1, c.pw - c.tOrd), 0, 1);
    const cash = S.staff.find((x) => x && x.task === 'cashier');
    S.today.sales += sales; S.funds += sales; S.today.cogs += Math.round(cogs); S.today.sold += units;
    const dine = c.dine && c.seat >= 0;
    if (dine && S.furn.coffee && Math.random() < 0.55 + (cash ? 0.15 : 0)) { S.today.drinks += 350; S.funds += 350; S.today.cogs += 80; c.drink = 1; }
    let sat = clamp(0.38 + surplus * 1.3 + (qs - 0.6) * 0.9 + (1 - waitF) * 0.14 + 0.04 * (S.up.interior || 0) + (dine ? 0.06 : 0) + (S.furn.speaker ? 0.03 : 0) + (cash ? 0.02 : 0) - pen, 0, 1);
    const bad = df.indexOf('spoil') >= 0;
    if (bad) { sat = Math.min(sat, 0.04); _.rate(S, 1, 0.08); }
    S.today.sat += sat; S.today.cust++;
    if (priceF > 1.12 && !df.length && sat < 0.55 && Math.random() < 0.5) {
      S.today.pcomp = (S.today.pcomp || 0) + 1; S.today.complaints = (S.today.complaints || 0) + 1; _.rate(S, 1.8, 0.03);
      _.fx(S, 'review', '口コミ ★2「値段のわりにふつう…」');
    }
    if (!df.length) _.addXp(S, units + (sat > 0.6 ? 1 : 0));
    if (df.length) {
      S.today.complaints = (S.today.complaints || 0) + 1;
      df.forEach((x) => (S.today.issues[x] = (S.today.issues[x] || 0) + 1));
      _.rate(S, 1 + sat * 4, 0.07);
      if (!D.DEFECTS[worst].vis) _.fx(S, 'review', '口コミ ★' + Math.max(1, Math.round(1 + sat * 4)) + '「' + D.DEFECTS[worst].say + '」');
    } else _.rate(S, 1 + sat * 4, 0.03);
    c.say = bad ? D.DEFECTS.spoil.say : worst && D.DEFECTS[worst].vis ? D.DEFECTS[worst].say : ct.id === 'gourmet' && qs > 0.8 ? _.pick(D.SAY.gourmet) : sat > 0.65 ? _.pick(D.SAY.great) : sat > 0.4 ? _.pick(D.SAY.ok) : _.pick(D.SAY.meh);
    c.sayT = now; c.paid = sales;
    if (dine) { c.st = 'eat'; c.tEnd = now + 3500 + R.SIT_MS; } else { c.st = 'out'; c.tEnd = now + R.WALK_MS; c.seat = -1; }
    _.fx(S, 'sale', '¥' + sales.toLocaleString(), '');
  }

  // =====================================================================
  //  仕入れ（段ボールで届く）
  // =====================================================================
  K.TRUCK = { IN: 9000, OUT: 8000, WAIT: 2500 };
  // 材料の段ボール：トラックがまだ来ていなければ同じトラックに積む（到着後・帰り道は次の便）
  K.deliver = function (S, list, now) {
    let tk = S.k.truck;
    if (tk && !(now < tk.at)) return 0;
    const free = []; for (let j = 0; j < KD.deliv; j++) if (!K.at(S, 'dl:' + j)) free.push(j);
    if (free.length < list.length) return 0;
    if (!tk) tk = S.k.truck = { at: now + K.TRUCK.IN, out: 0 };
    list.forEach((x, i) => add(S, { t: 'crate', ing: x.ing, n: x.n, u: x.u, ar: tk.at, at: 'dl:' + free[i] }));
    return tk.at;
  };
  // 家具は大きな段ボールでトラックが届ける（荷台の大きな置き場は3つ。あふれた分は次の便）
  K.BIG = [12, 13, 14];
  function loadFurn(S, now) {
    const pend = S.k.pend || (S.k.pend = []);
    if (!pend.length) return;
    let tk = S.k.truck;
    if (tk && !(now < tk.at)) return;
    const free = K.BIG.filter((j) => !K.at(S, 'dl:' + j)); if (!free.length) return;
    if (!tk) tk = S.k.truck = { at: now + K.TRUCK.IN, out: 0 };
    while (pend.length && free.length) add(S, { t: 'fcrate', k: pend.shift(), ar: tk.at, at: 'dl:' + free.shift() });
  }
  K.loadFurn = loadFurn;
  K.deliveryFree = (S) => (S.k.truck ? 0 : KD.deliv);
  K.arrived = (it, now) => !it || !(it.t === 'crate' || it.t === 'fcrate') || !(it.ar > now);
  K.deliveryFree = (S) => (S.k.truck ? 0 : KD.deliv);

  // =====================================================================
  //  自動の機械（店舗レベルで解放。材料・型・スポンジをセットするだけで動く）
  //   自動ミキサー amix・自動ホイッパー awhip：材料がそろうと自動で混ぜる（順番は気にしない）
  //   自動オーブン aoven：温度を合わせて予熱 → 焼き上がりで自動で止める
  //   自動デコ機 adeco：冷めたスポンジ＋タンクのクリーム＋投入口のトッピングで自動で仕上げる
  //   全自動ライン line：投入口の材料だけで、生地 → オーブン → 冷却 → クリーム → トッピング → 出口
  // =====================================================================
  const AUTO_MS = { wait: 2200, coat: 6000, top: 700, fin: 1500 };
  K.AUTO_MS = AUTO_MS;
  const HOP_CAP = { line: 40, adeco: 20 };
  K.HOP_CAP = HOP_CAP;
  const hopN = (b, ing) => (b && b.hop && b.hop[ing] ? b.hop[ing][0] : 0);
  K.hopN = hopN;
  function hopAdd(b, ing, n, cost) { b.hop = b.hop || {}; const h = b.hop[ing] || [0, 0]; h[0] += n; h[1] += cost; b.hop[ing] = h; }
  function hopTake(b, ing, n) { const h = b.hop && b.hop[ing]; if (!h || h[0] < n) return -1; const c = h[1] * (n / h[0]); h[0] -= n; h[1] -= c; if (h[0] <= 0) delete b.hop[ing]; return c; }
  function hopHasAll(b, req) { for (const k in req) if (hopN(b, k) < req[k]) return false; return true; }
  function hopTakeAll(b, req) { if (!hopHasAll(b, req)) return -1; let c = 0; for (const k in req) c += hopTake(b, k, req[k]); return c; }
  K.hopHasAll = hopHasAll;
  // 投入口に材料を入れる（全自動ライン：何でも／自動デコ機：トッピングだけ）
  function hopLoad(S, a, kd) {
    const b = K.st(S, a.fid), [hid, h] = heldIt(S, a);
    if (!h || h.t !== 'ing' || h.ing === 'box') return ng('棚から材料を持ってこよう');
    if ((h.sp || 0) >= 2) return ng(ingName(h.ing) + 'は傷んでいて使えません');
    if (kd === 'adeco' && !D.TOPS[h.ing]) return ng('自動デコ機に入れるのはトッピング（いちご・チョコなど）です。クリームは「クリームをセット」');
    if (kd === 'adeco' && b.st === 'auto' && b.ph === 'top') return ng('トッピングをのせているところです');
    b.hop = b.hop || {};
    if (kd === 'adeco' && !b.hop[h.ing] && Object.keys(b.hop).length >= 4) return ng('トッピングは4種類までです');
    const cap = HOP_CAP[kd], room = cap - hopN(b, h.ing); if (room <= 0) return ng('いっぱいです（1種類' + cap + '個まで）');
    const n = Math.min(room, a.all ? h.n : 1), t = lotsTake(h.lots, n); h.n -= n; if (h.n <= 0) del(S, hid);
    hopAdd(b, h.ing, n, t.cost);
    return ok();
  }
  // 自動デコ機にクリームをセット（すくったクリームを持って）
  A.mcream = function (S, a) {
    const b = station(S, a.fid, 'adeco'); if (!b) return ng();
    const [hid, cr] = heldIt(S, a); if (!cr || cr.t !== 'cream') return ng('クリームを持ってこよう（クリーム台ですくう）');
    if ((cr.sp || 0) >= 2) return ng('傷んだクリームは使えません');
    if (b.cr && b.cr.n > 0 && b.cr.k !== cr.k) return ng('タンクに「' + (D.CREAMS[b.cr.k] || {}).name + '」が入っています（使い切るか空けてから）');
    const tk = b.cr && b.cr.n > 0 ? b.cr : { k: cr.k, q: 0, n: 0, c: 0, df: [] };
    if (tk.n >= 4) return ng('タンクがいっぱいです（4台分まで）');
    const k = Math.min(cr.n || 1, 4 - tk.n);
    tk.q = (tk.q * tk.n + (cr.q || 0.5) * k) / (tk.n + k); tk.c = (tk.c * tk.n + (cr.c || 0) * k) / (tk.n + k);
    tk.df = _.union(tk.df, cr.df, (cr.sp || 0) >= 1 ? ['soft'] : []); tk.n += k;
    b.cr = tk; cr.n -= k; if (!(cr.n > 0)) del(S, hid);
    return ok((D.CREAMS[tk.k] || {}).name + 'をタンクにセットした（' + tk.n + '台分）');
  };
  // 自動デコ機・全自動ラインで作るケーキ（'' はおまかせ）
  A.amode = function (S, a) {
    const kd = stKind(S, a.fid); if (kd !== 'adeco' && kd !== 'line') return ng();
    const b = K.st(S, a.fid);
    const list = [''].concat(Object.keys(S.known).filter((r) => S.known[r] && sim.recipe(S, r)));
    const r = a.r != null ? String(a.r) : list[(list.indexOf(b.r || '') + 1) % list.length];
    if (r && !(S.known[r] && sim.recipe(S, r))) return ng('まだ作れないケーキです');
    b.r = r;
    return ok('作るケーキ：' + (r ? sim.recipe(S, r).name : 'おまかせ（足りない物から）'));
  };
  A.lineOn = function (S, a) { const b = station(S, a.fid, 'line'); if (!b) return ng(); b.on = b.on ? 0 : 1; return ok(b.on ? '全自動ラインを動かした' : '全自動ラインを止めた（途中のケーキは最後まで進みます）'); };
  // 作りかけ（ラインの上・デコ中・できたけれどまだ並べていない）のケーキの数
  function pipeCount(S, r) {
    let n = 0;
    for (const fid of P.list(S, 'line')) n += _.toArr((K.st(S, fid) || {}).q).filter((j) => j && j.r === r).length;
    for (const id in items(S)) { const it = items(S)[id]; if (it.t === 'cake' && it.r === r) n++; }
    return n;
  }
  // 機械で作る候補：指定があればそれ。おまかせなら販売中で、足りない・少ない物から
  function autoRecipes(S, want) {
    if (want && S.known[want] && sim.recipe(S, want)) return [want];
    const short = K.shortage(S), stock = K.shelfStock(S), hs = K.holeStock(S);
    const have = (r) => { const n = sim.pieceCount(sim.recipe(S, r)); return (stock[r] || 0) + (hs[r] || 0) * n + pipeCount(S, r) * n; };
    return _.menuRecipes(S).filter((r) => (short[r] || 0) > 0 || have(r) < 12).sort((a, b) => (short[b] || 0) - (short[a] || 0) || have(a) - have(b));
  }
  K.autoRecipes = autoRecipes;
  // ---- 自動ミキサー・自動ホイッパー ----
  function tickBowlAuto(S, fid, b, kd, now) {
    if (b.by) return;
    const find = (ings) => (kd === 'amix' ? baseFromIngs(ings) : creamFromIngs(ings));
    if (b.st === 'idle') {
      if (!b.ings.length) { b.why = ''; return; }
      const id = find(b.ings);
      if (!id) { b.why = b.ings.length >= 10 ? '分量が合いません（ボウルを空けよう）' : ''; return; }
      if (now - (b.lt || 0) < AUTO_MS.wait) { b.why = 'そろった！まもなく自動で混ぜます'; return; }
      const g = K.gauge(S, kd === 'amix' ? 'mix' : 'whip');
      Object.assign(b, { st: 'run', t0: now, sec: g.sec * 0.8 + 1.2, m: 0, auto: 1, why: '' });
      return;
    }
    if (b.st === 'run' && b.auto && now >= b.t0 + b.sec * 1000) {
      const id = find(b.ings);
      Object.assign(b, { st: 'done', m: 1, k: id, q: id ? 0.95 : 0, df: [] });
      if (kd === 'awhip') b.n = D.CREAM_YIELD;
    }
    // 自動ミキサー：横の型置きにきれいな型があれば自動で流し込む
    if (kd === 'amix' && b.st === 'done' && b.k) {
      const pid = K.at(S, slot0(fid)), pan = pid && items(S)[pid];
      if (pan && pan.t === 'pan' && pan.st === 'empty' && !pan.dirty && !pan.wet && !pan.res) A.pour(S, { fid, pid: '~' }, now);
    }
  }
  // ---- 自動オーブン ----
  function tickAOven(S, fid, o, now) {
    const id = K.at(S, slot0(fid)), it = id && items(S)[id];
    if (!it || it.t !== 'pan' || it.st === 'empty') { if (o.h && !o.idle) o.idle = now; if (o.h && now - (o.idle || now) > 60000) o.h = 0; return; }
    o.idle = 0;
    const B = D.BASES[it.b];
    if (it.st === 'raw' && B) {
      const heat = D.PREHEAT_MS * _.eqv(S, 'oven').heat;
      if (!o.h || o.temp !== B.temp) { o.hot = now + (o.h ? heat * 0.5 : heat); o.h = 1; o.temp = B.temp; it.wait = 1; return; }
      if (now >= (o.hot || 0) && !it.res) putInOven(S, it, fid, now);
      return;
    }
    if (it.st === 'baking' && it.bk && !it.res && now - it.bk.t0 >= it.bk.dur) { takeFromOven(S, it, now); it.auto = 1; }
  }
  // ---- 自動デコ機 ----
  function decoCands(S, b, dk) {
    const known = Object.keys(S.known).filter((r) => S.known[r] && sim.recipe(S, r) && sim.recipe(S, r).base === dk.b && (!dk.cr || sim.recipe(S, r).cream === dk.cr));
    if (b.r) return known.includes(b.r) ? [b.r] : [];
    const pref = autoRecipes(S, '').filter((r) => known.includes(r));
    return [...new Set(pref.concat(known.filter((r) => S.menu[r] && S.menu[r].on), known))];
  }
  function whyDeco(S, b, dk, cands) {
    if (!cands.length) return b.r ? 'このスポンジでは「' + ((sim.recipe(S, b.r) || {}).name || '') + '」は作れません（設定を変えよう）' : 'このスポンジで作れるケーキがありません';
    const R2 = sim.recipe(S, cands[0]), miss = [];
    if (R2.cream && R2.cream !== 'none' && !dk.cr && !(b.cr && b.cr.k === R2.cream && b.cr.n > 0)) miss.push('クリーム「' + D.CREAMS[R2.cream].name + '」をセット');
    for (const k in R2.tops || {}) if (hopN(b, k) < R2.tops[k]) miss.push(ingName(k) + 'をあと' + (R2.tops[k] - hopN(b, k)) + 'つ補充');
    return R2.name + '：' + miss.join('・');
  }
  // このデコ機で、いまの材料のまま仕上げられるか（冷蔵庫に移した作りかけを戻すとき）
  K.decoReady = function (S, fid, dk) {
    const b = K.st(S, fid), cands = decoCands(S, b, dk);
    return cands.some((r) => { const R2 = sim.recipe(S, r); const cOK = (R2.cream || 'none') === 'none' ? !dk.cr : dk.cr === R2.cream || (!dk.cr && b.cr && b.cr.k === R2.cream && b.cr.n > 0); return cOK && (Object.keys(dk.tops || {}).length || hopHasAll(b, R2.tops || {})); });
  };
  K.decoNeed = function (S, fid) { const b = K.st(S, fid), did = K.at(S, slot0(fid)), dk = did && items(S)[did]; if (!dk || dk.t !== 'deco') return null; const c = decoCands(S, b, dk); return c.length ? sim.recipe(S, c[0]) : null; };
  function tickADeco(S, fid, b, now) {
    const did = K.at(S, slot0(fid)), dk = did && items(S)[did];
    if (!dk || dk.t !== 'deco' || dk.res) {
      b.ws = 0;
      if (b.st !== 'idle' || b.ph) { if (b.tc) S.today.waste += Math.round(b.tc); Object.assign(b, { st: 'idle', ph: '', tc: 0, tl: [] }); }
      b.why = dk && dk.t === 'cake' ? '完成！ショーケースへ運ぼう' : '';
      return;
    }
    if (b.ph) {
      if (now < (b.t1 || 0)) return;
      const ph = b.ph; b.ph = '';
      if (ph === 'coat') {
        const tk = b.cr; b.st = 'idle';
        if (!tk || !(tk.n > 0) || tk.k !== b.ck) return;
        Object.assign(dk, { cr: tk.k, crq: tk.q, sq: 0.95 }); dk.df = _.union(dk.df, tk.df || []); dk.c = (dk.c || 0) + (tk.c || 0);
        tk.n -= 1; if (tk.n <= 0) b.cr = null;
        return;
      }
      if (ph === 'top') {
        const tl = _.toArr(b.tl).filter((x) => x), n = tl.length;
        dk.tp = tl.map((k, i) => { const a = (i / Math.max(1, n)) * Math.PI * 2 + 0.3, rr = n === 1 ? 0 : 0.55; return [Math.round(Math.cos(a) * rr * 100) / 100, Math.round(Math.sin(a) * rr * 100) / 100, k, Math.round((b.tc || 0) / Math.max(1, n))]; });
        dk.tops = {}; tl.forEach((k) => (dk.tops[k] = (dk.tops[k] || 0) + 1)); dk.c = (dk.c || 0) + (b.tc || 0);
        b.tc = 0; b.tl = []; b.ph = 'fin'; b.t1 = now + AUTO_MS.fin;
        return;
      }
      b.st = 'idle';
      if (ph === 'fin') { const r = A.finish(S, { fid }, now); b.why = r.ok ? '' : r.msg; if (r.ok) b.made = (b.made || 0) + 1; }
      return;
    }
    if (now < (dk.cu || 0)) { b.why = 'スポンジが冷めるのを待っています（あと' + Math.ceil((dk.cu - now) / 1000) + '秒）'; return; }
    // 手でトッピングをのせてあれば、そのまま仕上げる
    if (Object.keys(dk.tops || {}).length) { Object.assign(b, { st: 'auto', ph: 'fin', t1: now + AUTO_MS.fin }); return; }
    const cands = decoCands(S, b, dk);
    const creamOK = (R2) => ((R2.cream || 'none') === 'none' ? !dk.cr : dk.cr === R2.cream || (!dk.cr && b.cr && b.cr.k === R2.cream && b.cr.n > 0));
    const rid = cands.find((r) => { const R2 = sim.recipe(S, r); return creamOK(R2) && hopHasAll(b, R2.tops || {}); });
    if (!rid) { b.why = whyDeco(S, b, dk, cands); if (!b.ws) b.ws = now; return; }
    const R2 = sim.recipe(S, rid);
    b.rr = rid; b.why = ''; b.ws = 0;
    if (R2.cream && R2.cream !== 'none' && !dk.cr) { Object.assign(b, { st: 'auto', ph: 'coat', ck: R2.cream, t1: now + AUTO_MS.coat }); return; }
    const tl = [], cnt = Object.assign({}, R2.tops || {}), ks = Object.keys(cnt);
    for (let more = true; more;) { more = false; for (const k of ks) if (cnt[k] > 0) { tl.push(k); cnt[k]--; more = true; } }
    if (tl.length) { Object.assign(b, { tc: hopTakeAll(b, R2.tops), tl, st: 'auto', ph: 'top', t1: now + AUTO_MS.top * tl.length + 800 }); return; }
    Object.assign(b, { st: 'auto', ph: 'fin', t1: now + AUTO_MS.fin });
  }
  // ---- 全自動ライン ----
  // 段階の時間：生地 → オーブン → 冷却 → クリーム → トッピング（ミリ秒）
  K.lineDur = function (S, rid) {
    const r = sim.recipe(S, rid), B = D.BASES[r.base];
    const nt = Object.values(r.tops || {}).reduce((a, x) => a + x, 0);
    return [7000 * (_.eqv(S, 'mixer').fast || 1), Math.max(9000, _.ovenDur(S, r.base, B.temp) * 0.75), Math.max(4000, 9000 * _.eqv(S, 'cooler').cool), r.cream && r.cream !== 'none' ? 6000 : 2500, 2500 + 600 * nt].map(Math.round);
  };
  K.LINE_STAGES = ['生地', 'オーブン', '冷却', 'クリーム', 'トッピング'];
  // 1台分に要る材料（クリームは1回で2台分できるので、残りがあれば材料は要らない）
  function lineReq(S, b, r) {
    const need = {}, addG = (g) => { for (const k in g || {}) need[k] = (need[k] || 0) + g[k]; };
    addG(D.BASES[r.base].ing); addG(r.tops);
    if (r.cream && r.cream !== 'none' && !(b.cr && b.cr.k === r.cream && b.cr.n > 0)) addG(D.CREAMS[r.cream].ing);
    return need;
  }
  K.lineReq = (S, fid, rid) => lineReq(S, K.st(S, fid), sim.recipe(S, rid));
  function tickLine(S, fid, b, now) {
    b.q = _.toArr(b.q).filter((j) => j && j.r);
    const outs = P.slots(S, fid);
    // できあがり → 出口へ（出口がいっぱいならラインの最後で待つ）
    for (const j of b.q.slice()) {
      if (now < j.t0 + j.d.reduce((a, x) => a + x, 0)) continue;
      const r = sim.recipe(S, j.r); if (!r) { b.q.splice(b.q.indexOf(j), 1); continue; }
      const sl = outs.find((x) => !K.inSlot(S, x).length);
      if (!sl) { if (!j.wt) { j.wt = 1; _.fx(S, 'info', '全自動ライン：出口がいっぱいです。できたケーキを取り出そう'); } continue; }
      const n = sim.pieceCount(r);
      add(S, Object.assign({ t: 'cake', r: j.r, q: j.q, df: [], p: n, n, c: Math.round(j.c || 0), d: S.day, at: sl, pl: now }, sim.wholeable(r) ? { w: 1 } : {}));
      b.q.splice(b.q.indexOf(j), 1); b.made = (b.made || 0) + 1;
    }
    if (!b.on) { b.why = '停止中'; return; }
    if (!sim.working(S)) { b.why = ''; return; }
    if (b.q.some((j) => j.wt)) { b.why = '出口がいっぱい（ケーキを取り出そう）'; return; }
    const cand = autoRecipes(S, b.r);
    if (!cand.length) { b.why = '作る物はいまのところ十分あります（おまかせ）'; b.need = ''; return; }
    const rid = cand.find((r) => hopHasAll(b, lineReq(S, b, sim.recipe(S, r))));
    if (!rid) { b.why = '材料が足りません（投入口に入れよう）'; b.need = cand[0]; return; }
    const d = K.lineDur(S, rid), gap = Math.max(d[0], d[1] / 3, d[2] / 2, d[3], d[4]);
    const last = b.q.length ? Math.max(...b.q.map((j) => j.t0)) : -1e15;
    if (now - last < gap || b.q.length >= 8) { b.why = ''; return; }
    const r = sim.recipe(S, rid);
    let cost = hopTakeAll(b, D.BASES[r.base].ing) + (Object.keys(r.tops || {}).length ? hopTakeAll(b, r.tops) : 0);
    if (r.cream && r.cream !== 'none') {
      if (!(b.cr && b.cr.k === r.cream && b.cr.n > 0)) { const cc = hopTakeAll(b, D.CREAMS[r.cream].ing); b.cr = { k: r.cream, n: D.CREAM_YIELD, c: cc / D.CREAM_YIELD, q: 1, df: [] }; }
      cost += b.cr.c || 0; b.cr.n -= 1; if (b.cr.n <= 0) b.cr = null;
    }
    const q = clamp(0.9 + 0.015 * ((S.eq && S.eq.oven) || 0) + 0.01 * ((S.eq && S.eq.mixer) || 0) + _.gauss() * 0.01, 0.85, 0.99);
    b.seq = (b.seq || 0) + 1;
    b.q.push({ i: b.seq, r: rid, t0: now, d, c: Math.round(cost), q: Math.round(q * 100) / 100 });
    b.why = ''; b.need = '';
  }

  // =====================================================================
  //  毎ティック
  // =====================================================================
  K.tick = function (S, now) {
    for (const fid in S.fu) {
      const kd = P.KINDS[S.fu[fid].k].station, b = S.k.st[fid]; if (!b) continue;
      if (kd === 'amix' || kd === 'awhip') tickBowlAuto(S, fid, b, kd, now);
      else if (kd === 'aoven') tickAOven(S, fid, b, now);
      else if (kd === 'adeco') tickADeco(S, fid, b, now);
      else if (kd === 'line') tickLine(S, fid, b, now);
      if (kd === 'oven') { const id = K.at(S, slot0(fid)); if (id) { const it = items(S)[id]; if (it.st === 'raw' && b.h) putInOven(S, it, fid, now); } }
      if ((kd === 'mix' || kd === 'whip') && b.st === 'run' && !b.by && K.prog(b, now) > 1.8) A.run(S, { fid, pid: '' }, now);
      if (kd === 'deco' && b.st === 'spread' && now - (b.t0 || 0) > 180000) { b.st = 'idle'; b.by = null; }
      if (kd === 'sink' && b.by && !String(b.by).startsWith('staff') && now - (b.t0 || 0) > 120000) b.by = null;
    }
    if ((S.k.pend || []).length) loadFurn(S, now);
    const tk = S.k.truck;
    if (tk) {
      if (!tk.out && now >= tk.at && !Object.keys(S.k.items).some((id) => String(S.k.items[id].at).startsWith('dl:'))) tk.out = now + K.TRUCK.WAIT;
      if (tk.out && now > tk.out + K.TRUCK.OUT) S.k.truck = null;
    }
    K.tickItems(S, now);
    if (S.phase === 'open') K.tickCustomers(S, now);
    else for (const id in S.cust) { const c = S.cust[id]; if ((c.st === 'out' || c.st === 'eat') && now >= c.tEnd) endEat(S, id, c, now); }
    staffTick(S, now);
  };
  // 1日の終わり：冷えている所のケーキは賞味期限まで残る。作りかけ・クリームは冷蔵庫なら1晩まで。それ以外は廃棄
  K.endDay = function (S) {
    let waste = 0;
    for (const id of Object.keys(S.k.items)) {
      const it = S.k.items[id]; if (!it) continue;
      const at = String(it.at);
      if (it.t === 'fcrate') { if (at.startsWith('h:')) { const sp = P.findSpot(S, it.k); if (sp) { addFurn(S, it.k, sp.x, sp.z, sp.r); delete S.k.items[id]; } } continue; }
      if (at.startsWith('h:') || at.startsWith('c:')) { const sl = K.findSlot(S, it, it.t === 'crate' ? ['crack', 'table'] : ['fridge', 'table', 'shelf', 'rack', 'cshelf']); if (sl) it.at = sl; else if (it.t === 'crate') toFloor(S, it); }
      const cold = coldSlot(S, it.at);
      if (it.t === 'crate' || it.t === 'ing') { if (K.spoilSec(S, it) && !cold && (it.sp || 0) < 2) { it.sp = 2; it.wm = K.spoilSec(S, it) * 1000; it.w0 = 0; } continue; }
      if (it.t === 'plate' || it.t === 'box') {
        if ((it.s || []).length) { waste += itemCost(it); it.s = []; if (it.t === 'plate') it.dirty = 1; }
        if (it.t === 'box') { const sl = it.at; delete S.k.items[id]; const ex = K.inSlot(S, sl).map((x) => S.k.items[x]).find((x) => x.t === 'ing' && x.ing === 'box'); if (ex) { ex.n += 1; ex.lots = lotsMerge(ex.lots, [[1, 9999, it.c || D.ING.box.price]]); } else add(S, { t: 'ing', ing: 'box', n: 1, lots: [[1, 9999, it.c || D.ING.box.price]], at: sl, pl: 0 }); }
        continue;
      }
      if ((it.t === 'pan' && it.st === 'empty') || it.t === 'knife') continue;
      if (it.t === 'pan' && it.st === 'baked') { it.q *= cold ? 0.97 : 0.9; continue; }
      if ((it.t === 'cake' || it.t === 'tray') && (cold || !K.spoilSec(S, it)) && (it.sp || 0) < 2) {
        if (_.cakeExpired(S, it.d, 1)) { S.today.expired = (S.today.expired || 0) + (it.p || 0); waste += itemCost(it); consumeCake(S, id, 0); continue; }
        it.o = (it.o || 0) + 1; it.q = (it.q || 0.5) * 0.95; continue;
      }
      if (cold && (it.t === 'cream' || it.t === 'deco') && !it.o && (it.sp || 0) < 2) { it.o = 1; it.q = (it.q || 0.5) * 0.9; continue; }
      if (it.t === 'pan') { waste += itemCost(it); Object.assign(it, { st: 'empty', dirty: 1, b: null, q: 0, df: [], c: 0 }); delete it.bk; continue; }
      waste += itemCost(it); if (it.dish) consumeCake(S, id, 0); else delete S.k.items[id];
    }
    for (const fid in S.k.st) {
      const kd = P.KINDS[S.fu[fid].k].station, b = S.k.st[fid];
      if (kd === 'mix' || kd === 'whip' || kd === 'amix' || kd === 'awhip') { waste += b.c || 0; S.k.st[fid] = { ings: [], st: 'idle' }; }
      else if (kd === 'deco') S.k.st[fid] = { st: 'idle' };
      else if (kd === 'oven' || kd === 'aoven') b.h = 0;
      else if (kd === 'sink') b.by = null;
      else if (kd === 'adeco' || kd === 'line') {
        // クリームのタンク・ラインの泡立てたクリームは1日で片づけ。トッピング・材料の投入口は冷蔵なので翌日も使える
        if (b.cr) waste += (b.cr.c || 0) * (b.cr.n || 0);
        if (b.tc) waste += b.tc;
        Object.assign(b, { cr: null, st: 'idle', ph: '', tc: 0, tl: [] });
      }
    }
    waste += K.expireLots(S);
    return Math.round(waste);
  };

  // =====================================================================
  //  アルバイト（1人1業務。物を確保してから作業し、結果を置く）
  // =====================================================================
  const staffQ = (lv) => clamp(0.48 + 0.048 * lv + _.gauss() * 0.05, 0.3, 0.99);
  const staffDf = (lv, kinds) => (Math.random() < 0.2 - 0.02 * lv ? [_.pick(kinds)] : []);
  const free = (S, id) => { const it = items(S)[id]; const at = String(it && it.at); return it && !it.res && !at.startsWith('h:') && !at.startsWith('c:') && !at.startsWith('dl:'); };
  const cleanPan = (S) => Object.keys(items(S)).find((id) => { const it = items(S)[id]; return free(S, id) && it.t === 'pan' && it.st === 'empty' && !it.dirty && !it.wet && (P.slotDef(S, it.at) || {}).type !== 'mixpan'; });
  // 段ボールの中身を、決めた家具の空いている所に並べる（1枠10個まで）。並べた数
  function shelveInto(S, cr, fid) {
    let put = 0;
    for (const sl of P.slots(S, fid)) {
      if (!(cr.n > 0)) break;
      const sd = P.slotDef(S, sl); if (!sd || sd.type !== 'any') continue;
      const ex = K.inSlot(S, sl).map((id) => items(S)[id]);
      if (ex.length && !(ex[0].t === 'ing' && ex[0].ing === cr.ing)) continue;
      const room = STACK_CAP.ing - (ex.length ? ex[0].n : 0); if (room <= 0) continue;
      const k = Math.min(room, cr.n), half = (cr.sp || 0) >= 1;
      const part = { t: 'ing', ing: cr.ing, n: k, lots: newLots(S, cr.ing, k, cr.u, half), wm: cr.wm || 0, w0: 0, sp: cr.sp || 0 };
      if (ex.length) mergeInto(S, ex[0], part); else add(S, Object.assign(part, { at: sl, pl: S._now || 0 }));
      cr.n -= k; put += k;
    }
    S.today.shelved = (S.today.shelved || 0) + put;
    return put;
  }
  K.shelveInto = shelveInto;
  // ほかの棚にまだ置ける所があるか
  function roomFor(S, ing) {
    const I = D.ING[ing] || {};
    for (const kd of I.cold ? ['cshelf', 'shelf', 'rack', 'table'] : ['shelf', 'cshelf', 'rack', 'table']) for (const fid of P.list(S, kd)) for (const sl of P.slots(S, fid)) {
      const sd = P.slotDef(S, sl); if (!sd || sd.type !== 'any') continue;
      const ex = K.inSlot(S, sl).map((id) => items(S)[id]);
      if (!ex.length || (ex[0].t === 'ing' && ex[0].ing === ing && ex[0].n < STACK_CAP.ing)) return true;
    }
    return false;
  }
  const W_NAME = (S, fid) => { const f = S.fu[fid], k = f && f.k, same = P.list(S, k); return ((P.KINDS[k] || {}).name || '家具') + (same.length > 1 ? (same.indexOf(fid) + 1) : ''); };
  // ---------------------------------------------------------------------
  //  機械係：自動の機械に材料・型・クリームをセットし、できた物を次の機械・ショーケースへ運ぶ
  //   物を運ぶときは、アルバイトの手（'h:staff番号'）に持って歩き、着いたら置く
  // ---------------------------------------------------------------------
  const fidOf = (at) => { const p = String(at || '').split(':'); return p[0] === 'f' ? p[1] : null; };
  const handOf = (S, tag) => { const id = K.held(S, tag); return id ? [id, items(S)[id]] : [null, null]; };
  const byExp = (S) => (a, b) => ((items(S)[a].lots[0] || [0, 9999])[1]) - ((items(S)[b].lots[0] || [0, 9999])[1]);
  const grabIds = (S, ing) => K.stacks(S, ing).filter((id) => stackOK(items(S)[id]) && free(S, id)).sort(byExp(S));
  const stackFid = (S, ing) => { const id = grabIds(S, ing)[0]; return id ? fidOf(items(S)[id].at) : null; };
  // 棚の材料を手に取る（古い物から）。取れた数
  function grab(S, tag, ing, n) {
    let got = null, left = n;
    for (const id of grabIds(S, ing)) { if (left <= 0) break; const k = Math.min(left, items(S)[id].n), part = split(S, id, k); if (items(S)[id].n <= 0) del(S, id); if (got) mergeInto(S, got, part); else got = part; left -= k; }
    if (!got) return 0;
    add(S, Object.assign(got, { at: 'h:' + tag, pl: S._now || 0 }));
    return got.n;
  }
  // アルバイトの手の物を片づける（汚れ物は流し、材料は棚、ほかは棚・机。置けなければ床か廃棄）
  function dropHand(S, tag, now) {
    const [id, it] = handOf(S, tag); if (!id) return;
    if (it.t === 'ing') { const u = lotsCost(it.lots, it.n) / Math.max(1, it.n), n = K.invAdd(S, it.ing, it.n, Math.round(u)); if (n < it.n) S.today.waste += Math.round((it.n - n) * u); del(S, id); return; }
    let sl = null;
    if (it.dirty && (it.t === 'pan' || it.t === 'plate')) for (const f of P.list(S, 'sink')) if (!K.canPut(S, slot0(f), it)) { sl = slot0(f); break; }
    if (!sl) sl = K.findSlot(S, it, it.t === 'cake' ? ['fridge', 'table'] : ['shelf', 'table', 'rack', 'cshelf', 'fridge']);
    if (sl) { const r = A.put(S, { pid: tag, slot: sl }, now); if (r.ok && !K.held(S, tag)) return; }
    const [id2, it2] = handOf(S, tag); if (!id2) return;
    if ((it2.t === 'crate' || it2.t === 'fcrate') && toFloor(S, it2)) return;
    S.today.waste += Math.round(itemCost(it2)); del(S, id2);
  }
  K.dropHand = dropHand;
  // 運ぶ途中（半分の時間）で手に取る
  function feedHalf(S, st, slot, now) {
    const j = st.job, tag = 'staff' + slot, I = items(S); j.hd = 1;
    if (K.held(S, tag)) dropHand(S, tag, now);
    if (j.k === 'f-carry' || j.k === 'f-cream') {
      const it = I[j.id];
      if (!it || it.res !== tag || String(it.at).startsWith('h:') || String(it.at).startsWith('c:')) { if (it && it.res === tag) it.res = null; st.job = null; return; }
      const sd = P.slotDef(S, it.at); if (sd && sd.type === 'oven') takeFromOven(S, it, now);
      if (it.t === 'tray') it.t = 'cake';
      it.res = null; it.at = 'h:' + tag; it.pl = now; clearFloor(it);
    } else if (j.k === 'f-hop') { if (!grab(S, tag, j.ing, j.n)) st.job = null; }
  }
  function feedPlan(S, st, slot, now, job, T) {
    const tag = 'staff' + slot, I = items(S), want = st.opt && S.known[st.opt] && sim.recipe(S, st.opt) ? st.opt : '';
    if (K.held(S, tag)) { dropHand(S, tag, now); return; }
    const carry = (id, to, fid) => { I[id].res = tag; job({ k: 'f-carry', id, to, fid, from: fidOf(I[id].at), end: now + T }); return true; };
    const grabbable = (ing) => grabIds(S, ing).length > 0;
    const caseSlot = (it) => { const creamy = !!K.spoilSec(S, Object.assign({}, it, { t: 'cake' })); for (const kd of creamy ? ['scase', 'pcase'] : ['scase', 'pcase', 'pcaseN']) for (const f of P.list(S, kd)) for (const sl of P.slots(S, f)) if (!K.inSlot(S, sl).length) return sl; return null; };
    const plan = (b) => { const rs = autoRecipes(S, (b && b.r) || want); return rs.length ? sim.recipe(S, rs[0]) : null; };
    // 1) できたケーキ → ショーケース（いっぱいなら自動デコ機の分は冷蔵庫へ）
    for (const fid of P.list(S, 'line').concat(P.list(S, 'adeco'))) for (const sl of P.slots(S, fid)) {
      const id = K.at(S, sl), it = id && I[id];
      if (!it || it.t !== 'cake' || it.res) continue;
      const to = caseSlot(it) || (S.fu[fid].k === 'adeco' ? K.findSlot(S, it, ['fridge']) : null);
      if (to) return carry(id, to, fidOf(to));
    }
    // 2) 全自動ライン：投入口に材料（作る予定のケーキ2種類×2台分）
    for (const fid of P.list(S, 'line')) {
      const b = K.st(S, fid); if (!b.on) continue;
      const need = {};
      autoRecipes(S, b.r || want).slice(0, 2).forEach((r) => { const R2 = sim.recipe(S, r); [D.BASES[R2.base].ing, R2.cream && R2.cream !== 'none' ? D.CREAMS[R2.cream].ing : {}, R2.tops || {}].forEach((g) => { for (const k in g) need[k] = (need[k] || 0) + g[k] * 2; }); });
      for (const ing in need) { const have = hopN(b, ing), n = Math.min(10, HOP_CAP.line - have); if (have < need[ing] && n > 0 && grabbable(ing)) return job({ k: 'f-hop', fid, ing, n, from: stackFid(S, ing), end: now + T }); }
    }
    // 3) 自動デコ機：冷めたスポンジをのせる・クリームをセット・トッピングを補充
    for (const fid of P.list(S, 'adeco')) {
      const b = K.st(S, fid), did = K.at(S, slot0(fid)), dk = did && I[did];
      // 仕上げられないまま止まっている作りかけ → いったん冷蔵庫へ（後ろのスポンジを先に）
      if (dk && dk.t === 'deco' && b.st !== 'auto' && b.ws && now - b.ws > 40000 && Object.keys(I).some((id) => free(S, id) && ((I[id].t === 'pan' && I[id].st === 'baked') || (I[id].t === 'deco' && id !== did && K.decoReady(S, fid, I[id]))))) {
        const to = K.findSlot(S, dk, ['fridge']); if (to) return carry(did, to, fidOf(to));
      }
      if (!dk) {
        // 冷蔵庫に移した作りかけで、いま仕上げられる物を戻す
        const back = Object.keys(I).find((id) => free(S, id) && I[id].t === 'deco' && (P.slotDef(S, I[id].at) || {}).type !== 'turn' && K.decoReady(S, fid, I[id]));
        if (back) return carry(back, slot0(fid), fid);
        const rs = b.r ? [b.r] : autoRecipes(S, want), bases = rs.map((r) => sim.recipe(S, r).base);
        // 温かいままでもOK（自動デコ機が冷めるまで待つ）。オーブンの中の物から先に（オーブンを空けるため）
        const inOv = (id) => ((P.slotDef(S, I[id].at) || {}).type === 'oven' ? 0 : 1);
        const pid = Object.keys(I).filter((id) => { const it = I[id]; return free(S, id) && it.t === 'pan' && it.st === 'baked' && bases.includes(it.b); }).sort((a, b2) => inOv(a) - inOv(b2) || (I[a].cool || 0) - (I[b2].cool || 0))[0];
        if (pid) return carry(pid, slot0(fid), fid);
      }
      const R2 = dk && dk.t === 'deco' ? K.decoNeed(S, fid) : !dk ? plan(b) : null;
      if (!R2) continue;
      if (R2.cream && R2.cream !== 'none' && !(dk && dk.cr) && !(b.cr && b.cr.n > 0)) {
        const cid = Object.keys(I).find((id) => free(S, id) && I[id].t === 'cream' && I[id].k === R2.cream && (I[id].sp || 0) < 2);
        if (cid) { I[cid].res = tag; return job({ k: 'f-cream', id: cid, fid, from: fidOf(I[cid].at), end: now + T }); }
        const wf = P.list(S, 'awhip').concat(P.list(S, 'whip')).find((f) => { const w = K.st(S, f); return w.st === 'done' && w.k === R2.cream && !w.by && (w.n || 0) > 0; });
        if (wf) { K.st(S, wf).by = tag; return job({ k: 'f-scoop', wf, fid, from: wf, end: now + T }); }
      }
      // トッピングは2台分だけ（ほかで使う材料を取りすぎない）
      for (const k in R2.tops || {}) { const have = hopN(b, k), n = Math.min(10, HOP_CAP.adeco - have, R2.tops[k] * 2 - have); if (n > 0 && grabbable(k)) return job({ k: 'f-hop', fid, ing: k, n, from: stackFid(S, k), end: now + T }); }
    }
    // 4) 自動ホイッパー：自動デコ機で使うクリームを作る
    for (const fid of P.list(S, 'awhip')) {
      const w = K.st(S, fid); if (w.st !== 'idle' || w.ings.length || w.by) continue;
      const need = [];
      for (const df of P.list(S, 'adeco')) { const b = K.st(S, df), R2 = K.decoNeed(S, df) || plan(b); if (R2 && R2.cream && R2.cream !== 'none' && !(b.cr && b.cr.k === R2.cream && b.cr.n > 0)) need.push(R2.cream); }
      // 冷蔵庫で待っている作りかけ（クリームがまだ）の分も
      Object.values(I).forEach((it) => { if (it.t === 'deco' && !it.cr && (P.slotDef(S, it.at) || {}).type !== 'turn') { const r = Object.keys(S.known).map((x) => sim.recipe(S, x)).find((x) => x && x.base === it.b && x.cream && x.cream !== 'none' && S.menu[Object.keys(S.known).find((y) => sim.recipe(S, y) === x)] ); if (r) need.push(r.cream); } });
      const busy = (c) => Object.values(I).some((it) => it.t === 'cream' && it.k === c && (it.sp || 0) < 2) || P.list(S, 'awhip').concat(P.list(S, 'whip')).some((f) => { const x = K.st(S, f); return x !== w && (x.st !== 'idle' || x.by || (x.ings || []).length) && (x.k === c || creamFromIngs(x.ings || []) === c || String(x.by).startsWith('staff')); });
      const k = need.find((c) => !busy(c) && K.hasAll(S, D.CREAMS[c].ing));
      if (k) { w.by = tag; return job({ k: 'f-load', fid, what: k, kind: 'whip', from: stackFid(S, Object.keys(D.CREAMS[k].ing)[0]), end: now + T }); }
    }
    // 5) 自動オーブン：焼けた型を冷ましに出す → 生地の入った型を入れる（自動ミキサーの横の型から）
    for (const fid of P.list(S, 'aoven')) {
      const id = K.at(S, slot0(fid)), it = id && I[id];
      if (it && !it.res && it.t === 'pan' && it.st === 'baked') { const to = K.findSlot(S, it, ['rack', 'table', 'shelf', 'fridge', 'cshelf']); if (to) return carry(id, to, fidOf(to)); continue; }
      if (it) continue;
      const tp = (x) => ((P.slotDef(S, I[x].at) || {}).type === 'mixpan' ? 0 : 1);
      const raw = Object.keys(I).filter((x) => free(S, x) && I[x].t === 'pan' && I[x].st === 'raw' && (P.slotDef(S, I[x].at) || {}).type !== 'oven').sort((a, b2) => tp(a) - tp(b2))[0];
      if (raw) return carry(raw, slot0(fid), fid);
    }
    // 6) 自動ミキサー：横の型置きにきれいな型 → 足りないケーキの生地の材料を入れる
    for (const fid of P.list(S, 'amixer')) {
      const b = K.st(S, fid), ps = slot0(fid);
      if (!K.inSlot(S, ps).length) { const pan = cleanPan(S); if (pan) return carry(pan, ps, fid); }
      if (b.st !== 'idle' || b.ings.length || b.by) continue;
      const inPipe = (base) => Object.values(I).filter((it) => (it.t === 'pan' && it.b === base && it.st !== 'empty') || (it.t === 'deco' && it.b === base)).length + P.list(S, 'amixer').filter((f) => { const x = K.st(S, f); return x !== b && (x.k === base || ((x.ings || []).length && baseFromIngs(x.ings) === base)); }).length;
      const base = autoRecipes(S, want).map((r) => sim.recipe(S, r).base).find((bs) => inPipe(bs) < 2 && K.hasAll(S, D.BASES[bs].ing));
      if (base) { b.by = tag; return job({ k: 'f-load', fid, what: base, kind: 'mix', from: stackFid(S, D.BASES[base].order[0]), end: now + T }); }
    }
  }
  function feedFinish(S, st, slot, j, now) {
    const tag = 'staff' + slot, I = items(S);
    if (j.k === 'f-carry' || j.k === 'f-cream') {
      const it = I[j.id];
      if (!it || it.at !== 'h:' + tag) { if (it && it.res === tag) it.res = null; return false; }
      const r = j.k === 'f-cream' ? (S.fu[j.fid] ? A.mcream(S, { pid: tag, fid: j.fid }, now) : ng()) : P.slotDef(S, j.to) ? A.put(S, { pid: tag, slot: j.to }, now) : ng();
      dropHand(S, tag, now);
      return !!r.ok;
    }
    if (j.k === 'f-hop') {
      const [, h] = handOf(S, tag);
      if (h && h.t === 'ing' && S.fu[j.fid]) hopLoad(S, { pid: tag, fid: j.fid, all: 1 }, stKind(S, j.fid));
      dropHand(S, tag, now);
      return !!h;
    }
    if (j.k === 'f-load') {
      const b = S.fu[j.fid] && K.st(S, j.fid); if (b && b.by === tag) b.by = null;
      const G = j.kind === 'mix' ? D.BASES[j.what] : D.CREAMS[j.what]; if (!b || !G) return false;
      const req = G.ing, order = G.order || Object.keys(req);
      if (b.st !== 'idle' || (b.ings || []).length || !K.hasAll(S, req)) return false;
      const c = K.takeAll(S, req); b.ings = []; order.forEach((k) => { for (let n = 0; n < req[k]; n++) b.ings.push(k); }); b.c = c; b.lt = now;
      return true;
    }
    if (j.k === 'f-scoop') {
      const w = S.fu[j.wf] && K.st(S, j.wf); if (w && w.by === tag) w.by = null;
      if (!w || w.st !== 'done' || K.held(S, tag)) return false;
      if (!A.scoop(S, { pid: tag, fid: j.wf }, now).ok) return false;
      const r2 = S.fu[j.fid] ? A.mcream(S, { pid: tag, fid: j.fid }, now) : ng();
      dropHand(S, tag, now);
      return !!r2.ok;
    }
    return false;
  }
  // 取りに行って運ぶ仕事は、歩く時間も足す（倉庫は店の横の別棟なので遠い。行って戻る分）
  const WALK_V = 2.2;
  function walkMs(S, o) {
    const g = P.geomOf(S), I = items(S);
    const posF = (fid) => { const f = fid && S.fu[fid]; return f ? P.stand(f, 0.6) : null; };
    const posI = (id) => { const it = id && I[id]; if (!it) return null; const at = String(it.at); if (at.startsWith('dl:')) return [g.truck.x, g.truck.z - 3.3]; if (at === 'fl') return [it.fx, it.fz]; const sd = P.slotDef(S, at); return sd ? posF(sd.fid) : null; };
    const a = (o.k === 'stock' ? posI(o.id) : null) || posF(o.from) || posI(o.id);
    const toF = o.k === 'stock' ? o.dest || null : o.fid || (o.to && P.slotDef(S, o.to) ? P.slotDef(S, o.to).fid : null);
    const b = posF(toF) || (o.k === 'stock' ? [(g.store.x0 + g.store.x1) / 2, (g.store.z0 + g.store.z1) / 2] : null);
    if (!a || !b) return 0;
    return Math.min(45000, Math.round((2 * P.walkLen(g, a[0], a[1], b[0], b[1]) / WALK_V) * 1000));
  }
  K.walkMs = walkMs;
  function staffTick(S, now) {
    if (!S.staff || !(S.phase === 'prep' || S.phase === 'open')) return;
    const recs = _.menuRecipes(S).map((rid) => [rid, sim.recipe(S, rid)]);
    S.staff.forEach((st, slot) => {
      if (!st) return;
      const sp = (D.STAFF.speed[st.lv - 1] || 0.3) * (st.sp || 1); // レベル × その人の手際
      const dur = (k) => ((D.STAFF.jobSec[k] || 10) * 1000) / sp * (k === 'mix' ? _.eqv(S, 'mixer').fast || 1 : 1);
      if (st.job) {
        if (String(st.job.k).startsWith('f-') && !st.job.hd && now >= (st.job.t0 + st.job.end) / 2) feedHalf(S, st, slot, now);
        if (st.job && now >= st.job.end) finish(S, st, slot, now);
        return;
      }
      if (st.wait && now < st.wait) return;
      st.wait = now + 1200;
      const job = (o) => { if (String(o.k).startsWith('f-') || o.k === 'stock') o.end += walkMs(S, o); st.job = Object.assign(o, { t0: now }); };
      const I = items(S), tag = 'staff' + slot;
      // ---- 作業の部品（各係・お菓子係で使う）。仕事を始めたら true ----
      const panCount = (base, sts) => Object.values(I).filter((it) => it.t === 'pan' && sts.includes(it.st) && (!base || it.b === base)).length;
      const doMix = (baseFix, onlyIfNone) => {
        if (onlyIfNone ? panCount(baseFix, ['raw', 'baking', 'baked']) > 0 : panCount(null, ['raw', 'baking']) >= Math.max(1, P.count(S, 'oven'))) return false;
        const fid = P.list(S, 'mixer').find((f) => { const b = K.st(S, f); return b.st === 'idle' && !b.ings.length && !b.by && !K.at(S, slot0(f)); });
        if (!fid) return false;
        const pan = cleanPan(S); if (!pan) return false;
        let base = D.BASES[baseFix] ? baseFix : null;
        if (!base) { const need = {}; recs.forEach(([, r]) => (need[r.base] = 0)); Object.values(I).forEach((it) => { if (it.t === 'pan' && it.b in need) need[it.b]++; }); let best = 1e9; for (const k in need) if (need[k] < best && K.hasAll(S, D.BASES[k].ing)) { best = need[k]; base = k; } }
        if (!base || !K.hasAll(S, D.BASES[base].ing)) return false;
        const cost = K.takeAll(S, D.BASES[base].ing);
        K.st(S, fid).by = tag; I[pan].res = tag;
        job({ k: 'mix', fid, pan, base, cost, end: now + dur('mix') });
        return true;
      };
      const doBake = (onlyBase) => {
        const err = Math.max(0.02, 0.22 - 0.022 * st.lv);
        for (const fid of P.list(S, 'oven')) {
          const id = K.at(S, slot0(fid)); if (!id || !free(S, id)) continue; const it = I[id];
          if (it.st !== 'baking' || !it.bk || (onlyBase && it.b !== onlyBase)) continue;
          if (it.tg == null) it.tg = 1 + _.gauss() * err;
          const d = (now - it.bk.t0) / it.bk.dur;
          if (d >= it.tg - dur('out') / it.bk.dur) { it.res = tag; job({ k: 'out', fid, id, end: now + dur('out') }); return true; }
        }
        const rid = Object.keys(I).find((id) => free(S, id) && I[id].t === 'pan' && I[id].st === 'raw' && (!onlyBase || I[id].b === onlyBase) && (P.slotDef(S, I[id].at) || {}).type !== 'oven');
        if (!rid) return false;
        const B = D.BASES[I[rid].b], fid = P.list(S, 'oven').find((f) => !K.at(S, slot0(f)));
        if (!fid) return false;
        const o = K.st(S, fid);
        if (!o.h || o.temp !== B.temp) { A.oven(S, { fid, op: 'set', temp: B.temp }, now); st.wait = now + 2500; return true; }
        if (now >= (o.hot || 0) || (st.lv <= 2 && Math.random() < 0.08)) { I[rid].res = tag; job({ k: 'in', fid, id: rid, end: now + dur('in') }); return true; }
        return true; // 予熱を待っている
      };
      const haveCream = (k) => Object.values(I).filter((it) => it.t === 'cream' && it.k === k && (it.sp || 0) < 2).reduce((a, it) => a + it.n, 0) + P.list(S, 'whip').reduce((a, f) => { const b = K.st(S, f); return a + (b.st === 'done' && b.k === k ? b.n || 0 : 0); }, 0);
      const doWhip = (creamFix, enough) => {
        let cream = D.CREAMS[creamFix] && creamFix !== 'none' ? creamFix : null;
        if (!cream) { let best = 1e9; recs.forEach(([, r]) => { if (r.cream !== 'none' && haveCream(r.cream) < best && K.hasAll(S, D.CREAMS[r.cream].ing)) { best = haveCream(r.cream); cream = r.cream; } }); }
        if (!cream || haveCream(cream) >= (enough || 2) || !K.hasAll(S, D.CREAMS[cream].ing)) return false;
        const fid = P.list(S, 'whip').find((f) => { const b = K.st(S, f); return b.st === 'idle' && !b.ings.length && !b.by; });
        if (!fid) return false;
        const cost = K.takeAll(S, D.CREAMS[cream].ing);
        K.st(S, fid).by = tag;
        job({ k: 'whip', fid, cream, cost, end: now + dur('whip') });
        return true;
      };
      const doDeco = (cand) => {
        const fid = P.list(S, 'deco').find((f) => K.st(S, f).st === 'idle' && !K.at(S, slot0(f)) && !K.st(S, f).by); if (!fid) return false;
        for (const [rid, r] of cand) {
          const creamy = r.cream !== 'none';
          const outs = [].concat(...P.list(S, 'scase').map((f) => P.slots(S, f)), ...P.list(S, 'pcase').map((f) => P.slots(S, f)), ...(creamy ? [] : P.list(S, 'pcaseN').map((f) => P.slots(S, f))));
          const out = outs.find((sl) => !K.inSlot(S, sl).length);
          if (!out) continue;
          const pid = Object.keys(I).filter((id) => free(S, id) && I[id].t === 'pan' && I[id].st === 'baked' && I[id].b === r.base && now >= (I[id].cool || 0)).sort((x, y) => (I[x].df || []).length - (I[y].df || []).length)[0];
          if (!pid) continue;
          let cr = null, cid = null, wfid = null;
          if (creamy) {
            cid = Object.keys(I).find((id) => free(S, id) && I[id].t === 'cream' && I[id].k === r.cream && I[id].n > 0 && (I[id].sp || 0) < 2);
            if (!cid) wfid = P.list(S, 'whip').find((f) => { const b = K.st(S, f); return b.st === 'done' && b.k === r.cream && (b.n || 0) > 0 && !b.by; });
            if (!cid && !wfid) continue;
          }
          if (!K.hasAll(S, r.tops || {})) continue;
          const b = I[pid];
          if (cid) { const c = I[cid]; cr = { q: c.q, c: c.c, df: c.df || [] }; c.n -= 1; if (c.n <= 0) del(S, cid); }
          else if (wfid) { const w = K.st(S, wfid); cr = { q: w.q, c: (w.c || 0) / D.CREAM_YIELD, df: w.df || [] }; w.n -= 1; if (w.n <= 0) S.k.st[wfid] = { ings: [], st: 'idle' }; }
          const tc = K.takeAll(S, r.tops || {});
          const bb = { q: b.q, df: b.df, c: b.c };
          Object.assign(b, { st: 'empty', dirty: 1, b: null, q: 0, df: [], c: 0, cool: 0, lab: '' });
          K.st(S, fid).by = tag;
          job({ k: 'deco', fid, out, r: rid, b: bb, cr, tc, end: now + dur('deco') });
          return true;
        }
        return false;
      };
      const byNeed = () => { const short = K.shortage(S), stock = K.shelfStock(S); return recs.slice().sort((a, b) => (short[b[0]] || 0) - (short[a[0]] || 0) || (stock[a[0]] || 0) - (stock[b[0]] || 0)); };
      if (st.task === 'mix') doMix(st.opt);
      else if (st.task === 'bake') doBake(null);
      else if (st.task === 'whip') doWhip(st.opt, 2);
      else if (st.task === 'deco') doDeco(st.opt && S.known[st.opt] && sim.recipe(S, st.opt) ? [[st.opt, sim.recipe(S, st.opt)]] : byNeed());
      else if (st.task === 'chef') {
        // お菓子係：決められたお菓子を、生地 → 焼く → クリーム → 仕上げまで1人で（1台ずつ順番に）
        const fixed = st.opt && S.known[st.opt] && sim.recipe(S, st.opt);
        const cand = fixed ? [[st.opt, fixed]] : byNeed();
        for (const [rid, r] of cand) {
          if (doBake(r.base)) return;
          if (doDeco([[rid, r]])) return;
          const creamy = r.cream !== 'none', inPipe = panCount(r.base, ['raw', 'baking', 'baked']) > 0;
          if (creamy && inPipe && doWhip(r.cream, 1)) return;
          if (!inPipe && (fixed || (K.shortage(S)[rid] || 0) > 0 || !(K.shelfStock(S)[rid] || K.holeStock(S)[rid])) && doMix(r.base, true)) return;
          if (inPipe) return; // この1台を仕上げるまで、ほかのお菓子には手を出さない
        }
      } else if (st.task === 'feed') {
        feedPlan(S, st, slot, now, job, dur('feed'));
      } else if (st.task === 'wash') {
        const dirty = Object.keys(I).find((id) => { const it = I[id], at = String(it.at); return !it.res && (it.t === 'plate' || (it.t === 'pan' && it.st === 'empty')) && it.dirty && !at.startsWith('h:') && !at.startsWith('c:'); });
        const fid = P.list(S, 'sink').find((f) => !K.st(S, f).by);
        if (!dirty || !fid) return;
        I[dirty].res = tag; K.st(S, fid).by = tag; K.st(S, fid).t0 = now;
        job({ k: 'wash', fid, id: dirty, end: now + dur('wash') });
      } else if (st.task === 'stock') {
        // トラック・床・机・在庫棚の段ボールを、指定の場所（おまかせなら要冷蔵は冷蔵棚・ほかは棚）へ
        const dest = st.opt && S.fu[st.opt] ? st.opt : null, toRack = dest && (P.KINDS[S.fu[dest].k].slots || []).some((x) => x[3] === 'crate');
        const inRack = (it) => (P.slotDef(S, it.at) || {}).type === 'crate';
        const cid = Object.keys(I).filter((id) => { const it = I[id], at = String(it.at); return !it.res && !at.startsWith('h:') && it.t === 'crate' && it.n > 0 && K.arrived(it, now) && !(it.sw > now) && !(toRack && inRack(it)) && !(!dest && inRack(it) && !roomFor(S, it.ing)); })
          .sort((x, y) => (String(I[y].at).startsWith('dl:') ? 1 : 0) - (String(I[x].at).startsWith('dl:') ? 1 : 0))[0];
        if (cid) { I[cid].res = tag; return job({ k: 'stock', id: cid, dest, end: now + dur('stock') }); }
        if (S.funds < 8000 || S.k.truck) return;
        const need = { box: 6 };
        recs.forEach(([, r]) => { [D.BASES[r.base].ing, r.cream !== 'none' ? D.CREAMS[r.cream].ing : {}, r.tops || {}].forEach((g) => { for (const k in g) need[k] = Math.max(need[k] || 0, g[k]); }); });
        const buy = Object.keys(need).filter((k) => sim.ingUnlocked(S, k) && K.invCount(S, k) < need[k] * 2 + 2).slice(0, 4);
        if (buy.length) sim.ACT.order(S, { items: buy }, now);
      } else if (st.task === 'cashier') {
        // お会計 → 注文を受ける → そろっている注文を箱・お皿で渡す
        for (const reg of K.regs(S)) { const q = K.payQ(S, reg); if (q.length && !S.cust[q[0]].res) { S.cust[q[0]].res = tag; return job({ k: 'pay', c: q[0], end: now + dur('order') }); } }
        for (const reg of K.regs(S)) { const q = K.queue(S, reg); if (q.length) return job({ k: 'order', c: q[0], end: now + dur('order') }); }
        const waiting = Object.keys(S.cust).filter((id) => S.cust[id].st === 'w' && !S.cust[id].res).sort((a, b) => S.cust[a].tOrd - S.cust[b].tOrd);
        const stock = K.shelfStock(S), hstock = K.holeStock(S);
        for (const id of waiting) {
          const c = S.cust[id], ord = c.ord || {}, wh = c.wh || {};
          if (!Object.keys(wh).every((r) => (hstock[r] || 0) >= wh[r])) continue;
          if (!Object.keys(ord).every((r) => (stock[r] || 0) >= ord[r])) {
            // ショーケースのホールを切れば足りる → ケーキナイフで切る
            if (!K.hasKnife(S)) continue;
            const r0 = Object.keys(ord).find((r) => (stock[r] || 0) < ord[r]);
            const tid = K.holes(S).find((x) => I[x].r === r0 && !I[x].res) ;
            if (!tid || (hstock[r0] || 0) <= (wh[r0] || 0)) continue;
            I[tid].res = tag; return job({ k: 'cut', id: tid, end: now + dur('serve') });
          }
          const n = Object.values(ord).reduce((a, x) => a + x, 0) + Object.values(wh).reduce((a, x) => a + x, 0);
          if (c.dine) { const pl = Object.keys(I).find((x) => free(S, x) && I[x].t === 'plate' && !I[x].dirty && !I[x].wet && !(I[x].s || []).length); if (!pl) continue; I[pl].res = tag; c.res = tag; return job({ k: 'serve', c: id, vessel: pl, end: now + dur('serve') * n }); }
          if (K.invCount(S, 'box') < 1) continue;
          c.res = tag; return job({ k: 'serve', c: id, end: now + dur('serve') * n });
        }
      }
    });
  }
  function finish(S, st, slot, now) {
    const j = st.job; st.job = null;
    const I = items(S);
    let done = true;
    if (j.k === 'mix') {
      if (S.fu[j.fid]) K.st(S, j.fid).by = null;
      const pan = I[j.pan];
      if (pan && S.fu[j.fid] && !K.at(S, slot0(j.fid))) Object.assign(pan, { st: 'raw', b: j.base, q: staffQ(st.lv), df: staffDf(st.lv, ['lump', 'flat']), c: j.cost, at: slot0(j.fid), res: null, pl: now });
      else { if (pan) pan.res = null; S.today.waste += j.cost; done = false; }
    } else if (j.k === 'whip') {
      if (S.fu[j.fid]) Object.assign(K.st(S, j.fid), { by: null, ings: [j.cream], st: 'done', k: j.cream, q: staffQ(st.lv), df: staffDf(st.lv, ['soft', 'sep']), c: j.cost, n: D.CREAM_YIELD, m: 1 }); else done = false;
    } else if (j.k === 'in') {
      const it = I[j.id];
      if (it && S.fu[j.fid] && !K.at(S, slot0(j.fid))) { it.res = null; it.at = slot0(j.fid); it.pl = now; putInOven(S, it, j.fid, now); } else { if (it) it.res = null; done = false; }
    } else if (j.k === 'out') {
      const it = I[j.id];
      if (it && it.at === slot0(j.fid)) { takeFromOven(S, it, now); it.res = null; const sl = K.findSlot(S, it, ['rack', 'table', 'shelf']); if (sl) { it.at = sl; it.pl = now; } delete it.tg; } else { if (it) it.res = null; done = false; }
    } else if (j.k === 'deco') {
      if (S.fu[j.fid]) K.st(S, j.fid).by = null;
      const r = sim.recipe(S, j.r), n = sim.pieceCount(r);
      const q = clamp(j.b.q * 0.35 + (j.cr ? j.cr.q * 0.25 : 0.25) + staffQ(st.lv) * 0.4, 0, 1);
      const df = _.union(j.b.df, j.cr ? j.cr.df : [], staffDf(st.lv, r.cream === 'none' ? ['messy'] : ['messy', 'uneven']));
      // ホールで並べるか、切って並べるか（ホールの注文が待っている・ナイフが無い・切れが十分ある → ホール）
      const whole = sim.wholeable(r) && (!K.hasKnife(S) || (K.need(S).shortH[j.r] || 0) > 0 || (!(K.holeStock(S)[j.r] > 0) && (K.shelfStock(S)[j.r] || 0) >= n));
      const cake = Object.assign({ t: 'tray', r: j.r, q, p: n, n, c: Math.round((j.b.c || 0) + (j.cr ? j.cr.c : 0) + (j.tc || 0)), d: S.day, o: 0, df, pl: now }, whole ? { w: 1 } : {});
      const sl = P.slotDef(S, j.out) && !K.inSlot(S, j.out).length ? j.out : K.findSlot(S, cake, ['scase', 'pcase', 'pcaseN']);
      if (sl) add(S, Object.assign(cake, { at: sl }));
      else { const c2 = Object.assign({}, cake, { t: 'cake' }), s2 = K.findSlot(S, c2, ['fridge', 'table']); if (s2) add(S, Object.assign(c2, { at: s2 })); else S.today.waste += cake.c; }
      _.fx(S, 'cake', st.name + ' さんが ' + r.name + ' を仕上げて' + (whole ? 'ホールのまま' : n + '切れに切って') + 'ショーケースに並べた');
    } else if (j.k === 'wash') {
      if (S.fu[j.fid]) K.st(S, j.fid).by = null;
      const it = I[j.id];
      if (it) { it.res = null; it.dirty = 0; it.wet = 0; const sl = K.findSlot(S, it, ['shelf', 'table', 'rack']); if (sl) { it.at = sl; it.pl = now; } S.today.washed = (S.today.washed || 0) + 1; } else done = false;
    } else if (j.k === 'stock') {
      const it = I[j.id];
      if (it && (it.sp || 0) >= 2) { S.today.waste += Math.round(itemCost(it)); S.today.spoiled = (S.today.spoiled || 0) + 1; _.fx(S, 'info', st.name + ' さんが傷んだ' + ingName(it.ing) + 'の段ボールを捨てた'); del(S, j.id); }
      else if (it) {
        it.res = null;
        const dest = j.dest && S.fu[j.dest], rack = dest && (P.KINDS[dest.k].slots || []).some((x) => x[3] === 'crate');
        if (rack) {
          // 在庫棚：段ボールのまま置く
          const sl = P.slots(S, j.dest).find((x) => !K.inSlot(S, x).length);
          if (sl) { it.at = sl; clearFloor(it); it.pl = now; }
          else { _.fx(S, 'err', st.name + ' さん「' + W_NAME(S, j.dest) + 'がいっぱいです」'); it.sw = now + 60000; done = false; }
        } else {
          // 棚・冷蔵棚・机：中身を出して並べる（1枠10個まで）。指定の場所がいっぱいなら、ほかの空いている棚へ
          if (dest) shelveInto(S, it, j.dest);
          if (it.n > 0) { const p2 = K.invAdd(S, it.ing, it.n, it.u, (it.sp || 0) >= 1); S.today.shelved = (S.today.shelved || 0) + p2; it.n -= p2; }
          if (it.n <= 0) del(S, j.id);
          else {
            if (String(it.at).startsWith('dl:')) { const sl = K.findSlot(S, it, ['crack', 'table']); if (sl) it.at = sl; else toFloor(S, it); }
            it.sw = now + 60000;
            _.fx(S, 'err', st.name + ' さん「棚がいっぱいで' + ingName(it.ing) + 'を置けません（在庫棚や棚を増やそう）」'); done = false;
          }
        }
      } else done = false;
    } else if (j.k === 'order') {
      const c = S.cust[j.c]; if (c && c.st === 'q') takeOrder(S, j.c, now); else done = false;
    } else if (j.k === 'cut') {
      const it = I[j.id];
      if (it) { it.res = null; if (it.w) { delete it.w; it.p = it.n; S.today.cut = (S.today.cut || 0) + 1; } } else done = false;
    } else if (j.k === 'serve') {
      const c = S.cust[j.c]; if (c) c.res = null;
      const ves = j.vessel && I[j.vessel]; if (ves) ves.res = null;
      if (c && c.st === 'w') {
        const ord = c.ord || {}, wh = c.wh || {};
        const total = Object.values(ord).reduce((a, x) => a + x, 0) + Object.values(wh).reduce((a, x) => a + x, 0), stock = K.shelfStock(S), hstock = K.holeStock(S);
        const okStock = Object.keys(ord).every((r) => (stock[r] || 0) >= ord[r]) && Object.keys(wh).every((r) => (hstock[r] || 0) >= wh[r]);
        if (okStock && (c.dine ? ves && !ves.dirty && !(ves.s || []).length : K.invCount(S, 'box') >= 1)) {
          const slices = [];
          for (const r in wh) for (let n = 0; n < wh[r]; n++) { const tid = K.holes(S).find((id) => I[id].r === r && !I[id].res); if (!tid) break; const k = I[tid]; slices.push([k.r, Math.round(k.q * 100) / 100, k.df || [], Math.round(k.c || 0), 1, k.d || S.day]); consumeCake(S, tid, now); }
          for (const r in ord) for (let n = 0; n < ord[r]; n++) { const tid = K.trays(S).find((id) => I[id].r === r && !I[id].res); if (!tid) break; const k = I[tid]; slices.push([k.r, k.q, k.df || [], Math.round(k.c / (k.n || R.PIECES))]); k.p -= 1; if (k.p <= 0) consumeCake(S, tid, now); }
          if (c.dine) Object.assign(ves, { s: slices, at: 'c:' + j.c }); else { K.invTake(S, 'box', 1); add(S, { t: 'box', s: slices, at: 'c:' + j.c }); }
          toPay(S, j.c, now);
          // レジ係はそのままお会計（カード／ちょうどのお釣り）
          settle(S, c, slices, now); const b = K.at(S, 'c:' + j.c); if (b && I[b].t === 'box') del(S, b);
          if (slices.length !== total) done = false;
        } else done = false;
      } else done = false;
    } else if (j.k === 'pay') {
      const c = S.cust[j.c]; if (c) c.res = null;
      if (c && c.st === 'pay') { const gid = K.at(S, 'c:' + j.c), it = gid && I[gid]; settle(S, c, it ? it.s : [], now); if (it && it.t === 'box') del(S, gid); } else done = false;
    } else if (String(j.k).startsWith('f-')) done = feedFinish(S, st, slot, j, now);
    if (!done) return;
    st.xp = (st.xp || 0) + 1; st.done = (st.done || 0) + 1;
    while (st.lv < 10 && st.xp >= D.STAFF.xp[st.lv]) { st.lv++; _.fx(S, 'info', st.name + ' さんが Lv' + st.lv + ' に！仕事が速くなった'); }
  }
  K.releaseStaff = function (S, slot) {
    const tag = 'staff' + slot;
    if (K.held(S, tag)) dropHand(S, tag, S._now || 0);
    for (const id in S.k.items) if (S.k.items[id].res === tag) S.k.items[id].res = null;
    for (const fid in S.k.st) if (S.k.st[fid].by === tag) S.k.st[fid].by = null;
    for (const id in S.cust) if (S.cust[id].res === tag) S.cust[id].res = null;
  };
})(typeof window !== 'undefined' ? window : globalThis);
