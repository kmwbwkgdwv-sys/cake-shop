/* ケーキ屋さんシミュレーター : 厨房のしくみ（手で運ぶ調理・注文・配達・アルバイト）
 *  ホストだけが実行する。物は「置き場（スロット）」か「誰かの手」にある。
 *   スロット ID：mo:i ミキサー横の型置き / ov:i オーブン / rk:j 冷却ラック / wo:i:k クリーム置き /
 *                dt:i デコの回転台 / dp:i:k デコ台のわきの置き場 / cs:i ショーケース / dl:j 配達置き場 / sp:j 作業台 / pk:j 受け渡しカウンター
 *                fr:j 厨房の冷蔵庫（中の物は傷まない）
 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data, R = D.RULES;
  const sim = CS.sim, _ = sim._;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const K = (CS.kitchen = {});
  const KD = D.KITCHEN;

  // ---------- 設備の数 ----------
  const fl = (S) => clamp(S.up.floor || 0, 0, 3);
  K.count = (S, k) => (k === 'oven' ? S.ovens.length : k === 'case' ? S.showcase.length : k === 'fridge' ? _.eqv(S, 'fridge').slots || 6 : Array.isArray(KD[k]) ? KD[k][fl(S)] : KD[k]);
  K.newKitchen = () => ({ items: {}, mix: [], whip: [], deco: [], ordNo: 0 });
  K.normalize = function (S) {
    if (!S.k || typeof S.k !== 'object') S.k = K.newKitchen();
    const k = S.k;
    if (!k.items || typeof k.items !== 'object') k.items = {};
    // Firebase は空の配列・空のオブジェクトを保存しないので、届いた状態では「空の箱の中身」などが消えている。必ず作り直す
    //（これが無いと、空の箱を持った人がいるだけで、ほかの端末の画面が止まっていた）
    for (const id in k.items) {
      const it = k.items[id]; if (!it || typeof it !== 'object' || !it.t) { delete k.items[id]; continue; }
      it.df = _.toArr(it.df).filter((x) => x);
      if (it.ings) it.ings = _.toArr(it.ings).filter((x) => x);
      if (it.t === 'box' || it.s) it.s = _.toArr(it.s).filter((x) => x).map((x) => { const v = _.toArr(x, 4); v[2] = _.toArr(v[2]).filter((y) => y); return v; });
      if (it.t === 'deco' || it.tp) it.tp = _.toArr(it.tp).filter((x) => x).map((x) => _.toArr(x));
      if (it.t === 'deco' && (!it.tops || typeof it.tops !== 'object')) it.tops = {};
      if (it.at == null) it.at = freeSpot(S, 'sp') || 'sp:0';
      if (it.t === 'cake' && !(it.d > 0)) it.d = S.day || 1;
    }
    ['mix', 'whip'].forEach((st) => { k[st] = _.toArr(k[st]).map((b) => (b && typeof b === 'object' ? Object.assign(b, { ings: _.toArr(b.ings).filter((x) => x), df: _.toArr(b.df).filter((x) => x) }) : { ings: [], st: 'idle' })); while (k[st].length < K.count(S, st)) k[st].push({ ings: [], st: 'idle' }); });
    k.deco = _.toArr(k.deco).map((b) => (b && typeof b === 'object' ? b : { st: 'idle' })); while (k.deco.length < K.count(S, 'deco')) k.deco.push({ st: 'idle' });
    S.ovens.forEach((o) => { if (o.temp == null) o.temp = 170; });
    if (S.dayT == null) S.dayT = 0;
    if (k.trucks) { const has = Object.keys(k.items).some((id) => String(k.items[id].at).startsWith('dl:')); k.truck = has ? { at: 0, out: 0 } : null; delete k.trucks; }
    if (k.truck && (typeof k.truck !== 'object' || !(k.truck.at >= 0))) k.truck = null;
    for (const id in k.items) { const it = k.items[id]; if (it.t === 'crate') { it.n = Math.max(0, +it.n || 0); if (String(it.at).startsWith('dl:') && !k.truck) it.at = freeSpot(S, 'sp') || 'h:'; } }
  };

  // ---------- 物 ----------
  const items = (S) => S.k.items;
  K.at = (S, slot) => { const I = items(S); for (const id in I) if (I[id].at === slot) return id; return null; };
  K.held = (S, pid) => K.at(S, 'h:' + pid);
  const add = (S, it) => { const id = _.uid(S, 'i'); S.k.items[id] = it; return id; };
  const del = (S, id) => { delete S.k.items[id]; };
  const kindOf = (slot) => String(slot).split(':')[0];
  // スロットに置けるか
  K.accepts = function (slot, it) {
    if (!it || it.t === 'top') return false;
    switch (kindOf(slot)) {
      case 'mo': return it.t === 'pan' && (it.st === 'empty' || it.st === 'raw');
      case 'ov': return it.t === 'pan' && it.st !== 'empty';
      case 'rk': return it.t === 'pan';
      case 'wo': return it.t === 'cream';
      case 'dt': return (it.t === 'pan' && it.st === 'baked') || it.t === 'deco';
      case 'cs': return it.t === 'cake';
      case 'dl': return false; // トラックの荷台には戻せない
      case 'fr': return it.t === 'cream' || it.t === 'cake' || it.t === 'deco' || (it.t === 'pan' && it.st === 'baked');
      case 'sp': case 'pk': case 'dp': return true;
      default: return false;
    }
  };
  // スロット ID が今のお店に実在するか
  K.validSlot = function (S, slot) {
    const p = String(slot).split(':'), i = +p[1], k = p[2] === undefined ? 0 : +p[2];
    if (!(i >= 0) || i !== Math.floor(i)) return false;
    switch (p[0]) {
      case 'mo': return i < S.k.mix.length;
      case 'ov': return i < S.ovens.length;
      case 'rk': return i < KD.rack;
      case 'wo': return i < S.k.whip.length && (k === 0 || k === 1);
      case 'dt': return i < S.k.deco.length;
      case 'dp': return i < S.k.deco.length && (k === 0 || k === 1);
      case 'dl': return false;
      case 'sp': return i < KD.spots;
      case 'pk': return i < K.count(S, 'reg');
      case 'fr': return i < K.count(S, 'fridge');
      default: return false;
    }
  };
  // ---------- 鮮度（要冷蔵の物は、常温に置いているあいだだけ傷んでいく） ----------
  // 冷えている場所：厨房の冷蔵庫（fr）・トラックの荷台（dl）。ショーケースのケーキは物ではないので傷まない
  const coldSlot = (at) => { const k = kindOf(at); return k === 'fr' || k === 'dl'; };
  K.coldSlot = coldSlot;
  K.spoilSec = function (S, it) {
    if (!it) return 0;
    if (it.t === 'crate') { const I = D.ING[it.ing]; return I && I.cold && it.n > 0 ? I.warm : 0; }
    if (it.t === 'cream') return D.SPOIL.cream;
    if (it.t === 'deco') return it.cr ? D.SPOIL.cake : 0;
    if (it.t === 'cake') { const r = sim.recipe(S, it.r); return r && r.cream && r.cream !== 'none' ? D.SPOIL.cake : 0; }
    return 0;
  };
  K.warmMs = (it, now) => (it.wm || 0) + (it.w0 ? Math.max(0, now - it.w0) : 0);
  // 画面表示用：{ lim 秒, f 残り割合, stage 0=新鮮 1=ぬるい 2=傷んだ, cold 冷えた場所か, left 傷むまでの秒 }
  K.fresh = function (S, it, now) {
    const lim = K.spoilSec(S, it); if (!lim) return null;
    const w = K.warmMs(it, now) / 1000;
    return { lim, f: clamp(1 - w / lim, 0, 1), stage: it.sp || 0, cold: coldSlot(it.at), left: Math.max(0, lim - w) };
  };
  const ingName = (k) => (D.ING[k] || {}).name || k;
  const freshName = (S, it) => (it.t === 'crate' ? ingName(it.ing) + 'の段ボール' : it.t === 'cream' ? (D.CREAMS[it.k] || {}).name || 'クリーム' : it.t === 'cake' ? (sim.recipe(S, it.r) || {}).name || 'ケーキ' : 'デコ中のケーキ');
  function spoilStep(S, it, st) {
    const nm = freshName(S, it), crate = it.t === 'crate';
    if (st === 1) {
      if (it.t === 'cream') it.df = _.union(it.df, ['soft']);
      else if (it.t === 'deco' || it.t === 'cake') it.df = _.union(it.df, ['melt']);
      _.fx(S, 'err', nm + 'がぬるくなってきた！' + (crate ? '早く在庫室の冷蔵ケースへ' : '冷蔵庫へ入れよう'));
    } else {
      if (!crate) it.df = _.union(it.df, ['spoil']);
      _.fx(S, 'err', nm + 'が傷んでしまった…' + (crate ? '使えないので捨てよう' : 'このまま使うとお客さんがお腹をこわすかも'));
    }
  }
  // 物が冷蔵庫・荷台に入った／出たときの記録を毎ティック合わせる
  K.tickFresh = function (S, now) {
    for (const id in S.k.items) {
      const it = S.k.items[id], lim = K.spoilSec(S, it);
      if (!lim || coldSlot(it.at)) { if (it.w0) { it.wm = Math.round(K.warmMs(it, now)); it.w0 = 0; } continue; }
      if (!it.w0) it.w0 = now;
      const w = K.warmMs(it, now) / 1000, st = w >= lim ? 2 : w >= lim / 2 ? 1 : 0;
      if (st > (it.sp || 0)) { it.sp = st; spoilStep(S, it, st); }
    }
  };
  // 鮮度をほかの物に引きつぐ（クリーム → デコ → ケーキ）。割合で引きつぐ
  function carryFresh(S, from, to, now) {
    const lf = K.spoilSec(S, from), lt = K.spoilSec(S, to); if (!lf || !lt) return;
    const fr = K.warmMs(from, now) / 1000 / lf, cur = K.warmMs(to, now) / 1000 / lt;
    to.wm = Math.round(Math.max(fr, cur) * lt * 1000); to.w0 = coldSlot(to.at) ? 0 : now; to.sp = Math.max(from.sp || 0, to.sp || 0);
  }

  // 原価（捨てたときの廃棄額）
  const itemCost = (it) => (it.t === 'cake' ? (it.c / (it.n || R.PIECES)) * (it.p || 0) : it.t === 'box' ? it.s.reduce((a, x) => a + (x[3] || 0), 0) : it.t === 'cream' ? (it.c || 0) * (it.n || 1) : it.t === 'crate' ? (it.n || 0) * (it.u || 0) : it.c || 0);

  // ---------- 判定 ----------
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
  // 投入順のまちがい数（種類が初めて入った順を比べる）
  function orderMistakes(ings, order) {
    const seq = []; ings.forEach((x) => { if (seq.indexOf(x) < 0) seq.push(x); });
    let m = 0; seq.forEach((x, i) => { if (order[i] !== x) m++; });
    return m;
  }
  K.baseFromIngs = baseFromIngs; K.creamFromIngs = creamFromIngs;
  // ゲージ（ミキサー・泡立て・ナッペ）：0→1 で「ちょうどいい」帯に入る
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
  // トッピングの並びの美しさ
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

  // =====================================================================
  //  プレイヤーの操作（ACT）
  // =====================================================================
  const ok = (msg) => ({ ok: true, msg });
  const ng = (msg) => ({ ok: false, msg });
  const needHand = (S, a) => (K.held(S, a.pid) ? ng('手がふさがっています') : null);
  const A = (K.ACT = {});
  // 拾う（スロットの物を手に）
  A.pick = function (S, a, now) {
    if (needHand(S, a)) return needHand(S, a);
    const it = S.k.items[a.id]; if (!it || String(it.at).startsWith('h:')) return ng('もうありません');
    if (!K.arrived(it, now)) return ng('トラックがまだ到着していません');
    if (it.res) return ng('アルバイトが使っています');
    const from = it.at;
    if (kindOf(from) === 'ov') takeFromOven(S, it, now);
    if (kindOf(from) === 'dt' && it.t === 'deco' && /^(run|spread)$/.test(S.k.deco[+from.split(':')[1]].st)) return ng('クリームを塗っているところです（塗り終えてから）');
    it.at = 'h:' + a.pid;
    return ok();
  };
  // 置く
  A.put = function (S, a, now) {
    const hid = K.held(S, a.pid); if (!hid) return ng('何も持っていません');
    const it = S.k.items[hid];
    if (kindOf(a.slot) === 'cs') return putCase(S, a, hid, it, now);
    if (!K.validSlot(S, a.slot)) return ng('そこには置けません');
    if (K.at(S, a.slot)) return ng('そこには置けません（いっぱい）');
    if (!K.accepts(a.slot, it)) return ng('ここには置けません');
    if (kindOf(a.slot) === 'dt' && it.t === 'pan') {
      // 型から外してデコ用のスポンジに
      const warm = now < (it.cool || 0);
      const dk = { t: 'deco', b: it.b, q: it.q, df: _.union(it.df, warm ? ['melt'] : []), c: it.c, cr: null, crq: 1, sq: 1, tops: {}, tp: [], warm: warm ? 1 : 0 };
      del(S, hid); add(S, Object.assign(dk, { at: a.slot }));
      return ok(warm ? 'まだ温かい…クリームが溶けるかも' : 'スポンジを回転台にのせた');
    }
    it.at = a.slot;
    if (kindOf(a.slot) === 'ov') putInOven(S, it, +a.slot.split(':')[1], now);
    return ok();
  };
  function putCase(S, a, hid, it, now) {
    const i = +a.slot.split(':')[1];
    if (it.t !== 'cake') return ng('ショーケースにはケーキだけ並べられます');
    if (S.showcase[i]) return ng('ここはうまっています');
    S.showcase[i] = { r: it.r, q: it.q, p: it.p, n: it.n, c: it.c, d: it.d || S.day, o: it.o || 0, df: it.df || [] };
    const wm = Math.round(K.warmMs(it, now)); if (wm) { S.showcase[i].wm = wm; S.showcase[i].sp = it.sp || 0; }
    del(S, hid);
    _.fx(S, 'cake', (sim.recipe(S, it.r) || {}).name + ' を並べた！');
    return ok();
  }
  // 捨てる（ゴミ箱）
  A.trash = function (S, a) {
    const hid = K.held(S, a.pid); if (!hid) return ng('何も持っていません');
    const it = S.k.items[hid];
    if (it.t === 'crate' && it.n > 0 && (it.sp || 0) < 2) return ng('中身が入っています。在庫室で開けて棚に置こう');
    if (it.t === 'crate' && !(it.n > 0)) { del(S, hid); return ok('段ボールを片づけた'); }
    S.today.waste += Math.round(itemCost(it));
    if ((it.sp || 0) >= 2) S.today.spoiled = (S.today.spoiled || 0) + 1;
    del(S, hid);
    return ok((it.sp || 0) >= 2 ? '傷んだ' + freshName(S, it) + 'を捨てました' : '捨てました');
  };
  // 型・箱・トッピングを取る
  A.newPan = (S, a) => needHand(S, a) || (add(S, { t: 'pan', st: 'empty', at: 'h:' + a.pid }), ok());
  A.newBox = (S, a) => needHand(S, a) || (add(S, { t: 'box', s: [], at: 'h:' + a.pid }), ok());
  A.takeTop = function (S, a) {
    if (needHand(S, a)) return needHand(S, a);
    if (!D.TOPS[a.k]) return ng();
    if (_.invCount(S, a.k) < 1) return ng(D.ING[a.k].name + ' の在庫がありません（棚に補充しよう）');
    const c = _.invTake(S, a.k, 1);
    add(S, { t: 'top', k: a.k, c, at: 'h:' + a.pid });
    return ok();
  };
  // ボウルに材料を入れる（ミキサー・泡立て）
  A.addIng = function (S, a) {
    const arr = S.k[a.st]; const b = arr && arr[a.i]; if (!b) return ng();
    if (b.by) return ng('アルバイトが使っています');
    if (b.st !== 'idle') return ng(b.st === 'run' ? '回しているところです' : 'ボウルを空けてから入れよう');
    if (!D.ING[a.ing]) return ng();
    if (b.ings.length >= 10) return ng('ボウルがいっぱいです');
    if (_.invCount(S, a.ing) < 1) return ng(D.ING[a.ing].name + ' の在庫がありません（棚に補充しよう）');
    b.c = (b.c || 0) + _.invTake(S, a.ing, 1);
    b.ings.push(a.ing);
    return ok();
  };
  // 回す／止める
  A.run = function (S, a, now) {
    if (a.st === 'deco') return runDeco(S, a, now);
    const b = S.k[a.st] && S.k[a.st][a.i]; if (!b) return ng();
    if (b.by) return ng('アルバイトが使っています');
    if (b.st === 'idle') {
      if (!b.ings.length) return ng('先に材料を入れよう');
      const g = K.gauge(S, a.st);
      b.st = 'run'; b.t0 = now; b.sec = g.sec; b.m = 0;
      return ok();
    }
    if (b.st !== 'run') return ng();
    const g = K.gauge(S, a.st), m = K.prog(b, now), r = gaugeResult(g, m);
    b.st = 'done'; b.m = m;
    if (a.st === 'mix') {
      const base = baseFromIngs(b.ings);
      if (!base) { b.k = null; b.q = 0; b.df = []; return ok('分量が合わない…失敗した生地になった（捨てよう）'); }
      const mis = orderMistakes(b.ings, D.BASES[base].order);
      const df = []; if (mis >= 2) df.push('flat'); if (r.d === 'under') df.push('lump'); if (r.d === 'over') df.push('flat');
      b.k = base; b.q = clamp(r.q * (1 - mis * 0.12), 0.1, 1); b.df = _.cleanDf(df);
      return ok(D.BASES[base].name + 'ができた' + (r.q >= 1 && !mis ? '（ばっちり！）' : ''));
    }
    const cream = creamFromIngs(b.ings);
    if (!cream) { b.k = null; b.q = 0; b.df = []; return ok('分量が合わない…失敗したクリーム（捨てよう）'); }
    const df = []; if (r.d === 'under') df.push('soft'); if (r.d === 'over' || m > g.over) df.push('sep');
    b.k = cream; b.q = r.q; b.df = _.cleanDf(df);
    return ok(D.CREAMS[cream].name + 'ができた' + (r.q >= 1 ? '（ばっちり！）' : ''));
  };
  // 生地を型に流す（空の型を持ってミキサーへ）
  A.pour = function (S, a) {
    const b = S.k.mix[a.i]; if (!b || b.st !== 'done') return ng('まだ生地ができていません');
    if (!b.k) return ng('失敗した生地は捨てよう');
    const hid = K.held(S, a.pid), it = hid && S.k.items[hid];
    if (!it || it.t !== 'pan' || it.st !== 'empty') return ng('空の型を持ってこよう');
    Object.assign(it, { b: b.k, st: 'raw', q: b.q, df: b.df || [], c: b.c || 0 });
    S.k.mix[a.i] = { ings: [], st: 'idle' };
    return ok(D.BASES[it.b].short + 'の生地を型に流した');
  };
  // クリームをすくう（空いた手で）
  A.scoop = function (S, a) {
    if (needHand(S, a)) return needHand(S, a);
    const b = S.k.whip[a.i]; if (!b || b.st !== 'done') return ng('まだクリームができていません');
    if (!b.k) return ng('失敗したクリームは捨てよう');
    add(S, { t: 'cream', k: b.k, q: b.q, df: b.df || [], n: D.CREAM_YIELD, c: (b.c || 0) / D.CREAM_YIELD, day: S.day, at: 'h:' + a.pid });
    S.k.whip[a.i] = { ings: [], st: 'idle' };
    return ok();
  };
  // ボウルを空ける
  A.dump = function (S, a) {
    const arr = S.k[a.st]; const b = arr && arr[a.i]; if (!b || (!b.ings.length && b.st !== 'done')) return ng('空です');
    if (b.by) return ng('アルバイトが使っています');
    S.today.waste += Math.round(b.c || 0);
    arr[a.i] = { ings: [], st: 'idle' };
    return ok('ボウルを空けた');
  };
  // オーブン：温度を変える（電源も入る）／電源を切る
  A.oven = function (S, a, now) {
    const o = S.ovens[a.i]; if (!o) return ng();
    if (a.op === 'off') { o.h = 0; return ok('オーブンを止めた'); }
    const T = D.OVEN_TEMPS; const cur = o.h ? T.indexOf(o.temp) : -1;
    const t = a.op === 'set' ? +a.temp : T[(cur + 1) % T.length] || 170;
    if (T.indexOf(t) < 0) return ng();
    const heat = D.PREHEAT_MS * _.eqv(S, 'oven').heat;
    o.hot = now + (o.h ? heat * 0.5 : heat); o.h = 1; o.temp = t;
    const pid = K.at(S, 'ov:' + a.i); if (pid) putInOven(S, S.k.items[pid], a.i, now);
    return ok(t + '℃ で予熱中…');
  };
  function putInOven(S, it, i, now) {
    const o = S.ovens[i];
    if (it.st !== 'raw' || !o) return;
    if (!o.h) { it.wait = 1; return; }
    const cold = now < (o.hot || 0);
    const B = D.BASES[it.b];
    it.st = 'baking'; it.wait = 0;
    it.bk = { t0: now, dur: _.ovenDur(S, it.b, o.temp, cold), dT: o.temp - B.temp, cold: cold ? 1 : 0, temp: o.temp };
  }
  function takeFromOven(S, it, now) {
    if (it.st !== 'baking' || !it.bk) return;
    const d = (now - it.bk.t0) / it.bk.dur;
    const r = _.bakeQuality(S, d, it.bk.dT, it.bk.cold);
    it.st = 'baked'; it.q = clamp((it.q || 0.5) * 0.4 + r.q * 0.6 + (_.eqv(S, 'oven').qb || 0), 0, 1); it.df = _.union(it.df, r.df);
    it.cool = now + _.coolMs(S) * 2; it.lab = r.label; delete it.bk;
    _.fx(S, d >= 1 - _.bakeWindow(S, 0) && d <= 1 + _.bakeWindow(S, 0) ? 'good' : 'info', D.BASES[it.b].short + '：' + r.label);
  }
  // デコ：クリームを塗る（クリームを持って回転台を使う → もう一度で止める）
  function runDeco(S, a, now) {
    const b = S.k.deco[a.i], did = K.at(S, 'dt:' + a.i), dk = did && S.k.items[did];
    if (!dk || dk.t !== 'deco') return ng('回転台にスポンジをのせよう');
    if (b.st === 'run') {
      const g = K.gauge(S, 'deco'), m = K.prog(b, now), r = gaugeResult(g, m);
      b.st = 'idle'; dk.sq = r.q; if (r.d) dk.df = _.union(dk.df, ['uneven']);
      return ok(r.q >= 1 ? 'きれいに塗れた！' : r.d ? 'ムラになった…' : '少しムラがある');
    }
    if (b.st === 'spread') return ng(b.by === a.pid ? '塗っているところです' : 'ほかの人が塗っています');
    if (dk.cr) return ng('クリームはもう塗ってあります');
    const hid = K.held(S, a.pid), cr = hid && S.k.items[hid];
    if (!cr || cr.t !== 'cream') return ng('クリームを持ってこよう');
    if (D.BASES[dk.b] && D.BASES[dk.b].cookie) return ng('焼き菓子にはクリームを使いません');
    dk.cr = cr.k; dk.crq = cr.q; dk.df = _.union(dk.df, cr.df, dk.warm ? ['melt'] : []); dk.c = (dk.c || 0) + (cr.c || 0);
    carryFresh(S, cr, dk, now);
    cr.n -= 1; if (cr.n <= 0) del(S, hid);
    // 指（マウス）でなぞって塗る。仕上がりは spreadDone で受け取る（塗り終えるまでは低い点のまま）
    dk.sq = 0.35;
    Object.assign(b, { st: 'spread', t0: now, by: a.pid });
    return ok();
  }
  A.spreadDone = function (S, a, now) {
    const b = S.k.deco[a.i], did = K.at(S, 'dt:' + a.i), dk = did && S.k.items[did];
    if (!b || b.st !== 'spread') return ng();
    if (b.by !== a.pid && now - (b.t0 || 0) < 60000) return ng('ほかの人が塗っています');
    const q = clamp(+a.q || 0, 0, 1);
    b.st = 'idle'; b.by = null;
    if (dk && dk.t === 'deco') { dk.sq = q; if (q < 0.55) dk.df = _.union(dk.df, ['uneven']); }
    return ok(q >= 0.85 ? 'なめらかに塗れた！（' + Math.round(q * 100) + '点）' : q >= 0.55 ? 'まあまあ（' + Math.round(q * 100) + '点）' : 'ムラになった…（' + Math.round(q * 100) + '点）');
  };
  // トッピングを置く（x, z は回転台のケーキ上の位置 -1〜1）
  A.topPlace = function (S, a) {
    const did = K.at(S, 'dt:' + a.i), dk = did && S.k.items[did];
    if (!dk || dk.t !== 'deco') return ng('回転台にスポンジをのせよう');
    if (S.k.deco[a.i].st === 'run') return ng('クリームを塗り終えてから');
    const hid = K.held(S, a.pid), tp = hid && S.k.items[hid];
    if (!tp || tp.t !== 'top') return ng();
    const x = clamp(+a.x || 0, -1, 1), z = clamp(+a.z || 0, -1, 1);
    if (Math.hypot(x, z) > 1.02) return ng('ケーキの上に置こう');
    dk.tp.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100, tp.k]);
    dk.tops[tp.k] = (dk.tops[tp.k] || 0) + 1; dk.c = (dk.c || 0) + (tp.c || 0);
    del(S, hid);
    return ok();
  };
  // 仕上げる（レシピと照らし合わせてケーキ完成）
  A.finish = function (S, a, now) {
    const did = K.at(S, 'dt:' + a.i), dk = did && S.k.items[did];
    if (!dk || dk.t !== 'deco') return ng('回転台に何もありません');
    if (S.k.deco[a.i].st === 'run' || S.k.deco[a.i].st === 'spread') return ng('クリームを塗り終えてから');
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
    const cid = add(S, { t: 'cake', r: rid, q, df, p: n, n, c: Math.round(dk.c || 0), d: S.day, at: 'dt:' + a.i });
    carryFresh(S, dk, S.k.items[cid], now);
    _.fx(S, 'cake', r.name + ' が完成！（品質' + Math.round(q * 100) + '）');
    return ok();
  };
  // 箱にケーキを1切れ入れる（箱を持ってショーケースを使う）
  A.slice = function (S, a) {
    const hid = K.held(S, a.pid), box = hid && S.k.items[hid];
    if (!box || box.t !== 'box') return ng('箱を持ってこよう');
    const k = S.showcase[a.ci]; if (!k || k.p <= 0) return ng('売り切れです');
    if (box.s.length >= 6) return ng('箱がいっぱいです');
    box.s.push([k.r, Math.round(k.q * 100) / 100, k.df || [], Math.round(k.c / (k.n || R.PIECES))]);
    k.p -= 1; if (k.p <= 0) S.showcase[a.ci] = 0;
    return ok();
  };
  // ショーケースのケーキごと手に取る（並べ替え用）
  A.caseTake = function (S, a) {
    if (needHand(S, a)) return needHand(S, a);
    const k = S.showcase[a.ci]; if (!k) return ng();
    add(S, { t: 'cake', r: k.r, q: k.q, df: k.df || [], p: k.p, n: k.n, c: k.c, d: k.d || S.day, o: k.o || 0, wm: k.wm || 0, sp: k.sp || 0, at: 'h:' + a.pid });
    S.showcase[a.ci] = 0;
    return ok();
  };
  // 段ボールを棚にしまう → 在庫に
  // 段ボールを開ける（持ったまま）
  A.openCrate = function (S, a) {
    const hid = K.held(S, a.pid), cr = hid && S.k.items[hid];
    if (!cr || cr.t !== 'crate') return ng('段ボールを持っていません');
    if (cr.open) return ng('もう開いています');
    cr.open = 1; return ok();
  };
  // 開けた段ボールの中身を棚に置く（1つずつ／全部）
  A.shelve = function (S, a) {
    const hid = K.held(S, a.pid), cr = hid && S.k.items[hid];
    if (!cr || cr.t !== 'crate') return ng('段ボールを持っていません');
    if (!cr.open) return ng('先に段ボールを開けよう');
    if (!(cr.n > 0)) return ng('段ボールは空です（捨てよう）');
    if (a.ing !== cr.ing) return ng('ここは' + ((D.ING[a.ing] || {}).name || '別の材料') + 'の棚です');
    if ((cr.sp || 0) >= 2) return ng(D.ING[cr.ing].name + 'は常温に置きすぎて傷んでいます。ゴミ箱へ（廃棄）');
    const k = a.all ? cr.n : 1, half = (cr.sp || 0) >= 1;
    _.invAdd(S, cr.ing, k, cr.u, half); cr.n -= k;
    S.today.shelved = (S.today.shelved || 0) + k;
    if (!cr.n) { cr.wm = 0; cr.w0 = 0; cr.sp = 0; }
    return ok(cr.n ? '' : D.ING[cr.ing].name + 'を全部しまった' + (half ? '（ぬるくなっていたので日持ちが短め）' : '') + '（空の段ボールは捨てよう）');
  };
  A.stock = function (S, a) {
    const hid = K.held(S, a.pid), cr = hid && S.k.items[hid];
    if (!cr || cr.t !== 'crate') return ng('段ボールを持ってこよう');
    if ((cr.sp || 0) >= 2) return ng('傷んでいます。ゴミ箱へ');
    _.invAdd(S, cr.ing, cr.n, cr.u, (cr.sp || 0) >= 1);
    del(S, hid);
    return ok(D.ING[cr.ing].name + '×' + cr.n + ' を棚にしまった');
  };
  // 看板：OPEN／CLOSE
  A.sign = function (S, a, now) {
    if (S.phase === 'prep') return sim.ACT.open(S, a, now);
    if (S.phase === 'open') return sim.ACT.close(S, a, now);
    return ng('今日の営業は終わりました');
  };
  // 注文を受ける
  A.takeOrder = function (S, a, now) {
    const c = S.cust[a.c]; if (!c || c.st !== 'q') return ng();
    if (K.queue(S, c.lane)[0] !== a.c) return ng('先頭のお客さんから注文を受けよう');
    return takeOrder(S, a.c, now);
  };
  function takeOrder(S, cid, now) {
    const c = S.cust[cid];
    c.st = 'w'; c.no = ++S.k.ordNo; c.tOrd = now;
    const n = Object.values(c.ord).reduce((s, x) => s + x, 0);
    const short = K.shortage(S), mk = Object.keys(c.ord).filter((r) => short._by && short._by[cid] && short[r] > 0);
    c.make = mk.length ? 1 : 0;
    c.pw = now + R.WAIT_MS + n * 9000 + (mk.length ? (R.MAKE_MS || 180000) + (mk.length - 1) * 45000 : 0);
    c.say = c.make ? '作ってもらえるなら待つよ' : '注文 #' + c.no;
    _.fx(S, 'order', '注文 #' + c.no + '：' + K.ordText(S, c.ord) + (c.make ? '（商品棚に無い → 急いで作ろう！' + K.ordText(S, Object.fromEntries(mk.map((r) => [r, Math.min(c.ord[r], short[r])]))) + '）' : ''));
    return ok();
  }
  K.ordText = (S, ord) => Object.keys(ord).map((r) => ((sim.recipe(S, r) || {}).name || r) + '×' + ord[r]).join('、');
  // 手渡し
  A.serve = function (S, a, now) {
    const c = S.cust[a.c]; if (!c || c.st !== 'w') return ng('注文を待っているお客さんに渡そう');
    const hid = K.held(S, a.pid), box = hid && S.k.items[hid];
    if (!box || box.t !== 'box') return ng('ケーキを箱に詰めて渡そう');
    const got = {}; box.s.forEach((x) => (got[x[0]] = (got[x[0]] || 0) + 1));
    const same = Object.keys(c.ord).every((r) => got[r] === c.ord[r]) && Object.keys(got).every((r) => got[r] === c.ord[r]);
    if (!same) { c.say = '注文と違うよ…'; c.sayT = now; return ng('注文と違います：' + K.ordText(S, c.ord)); }
    del(S, hid);
    pay(S, c, box.s, now);
    return ok();
  };
  function pay(S, c, slices, now) {
    const ct = D.CUSTOMERS.find((x) => x.id === c.ty) || D.CUSTOMERS[0];
    let sales = 0, cogs = 0, qs = 0, pen = 0, surplus = 0, worst = null, priceF = 0; const df = [];
    slices.forEach(([rid, q, d, cost]) => {
      const price = (c.price && c.price[rid]) || (S.menu[rid] && S.menu[rid].price) || 0;
      sales += price; cogs += cost || 0; qs += q;
      const r = sim.recipe(S, rid);
      surplus += r ? (_.wtp(S, r, q, ct, 1, rid) * _.appearance(d) - price) / Math.max(1, price) : 0;
      const over = r ? price / _.cakeMarket(S, rid, r) : 1; if (over > priceF) priceF = over;
      (d || []).forEach((x) => { if (df.indexOf(x) < 0) df.push(x); });
      S.today.best[rid] = (S.today.best[rid] || 0) + 1;
    });
    const n = slices.length; qs /= n; surplus /= n;
    df.forEach((x) => { const X = D.DEFECTS[x]; pen += X.sat * (ct.picky > 0.6 ? 1.3 : 1); if (!worst || X.sat > D.DEFECTS[worst].sat) worst = x; });
    const waitF = clamp((now - c.tOrd) / Math.max(1, c.pw - c.tOrd), 0, 1);
    const cash = S.staff.find((x) => x && x.task === 'cashier');
    S.today.sales += sales; S.funds += sales; S.today.cogs += Math.round(cogs); S.today.sold += n;
    // 座って食べる？
    let seat = -1; const seats = 2 * (S.furn.table || 0);
    if (seats && Math.random() < 0.5) { const used = {}; for (const id in S.cust) if (S.cust[id].seat >= 0) used[S.cust[id].seat] = 1; for (let i = 0; i < seats; i++) if (!used[i]) { seat = i; break; } }
    if (seat >= 0 && S.furn.coffee && Math.random() < 0.55 + (cash ? 0.15 : 0)) { S.today.drinks += 350; S.funds += 350; S.today.cogs += 80; c.drink = 1; }
    let sat = clamp(0.38 + surplus * 1.3 + (qs - 0.6) * 0.9 + (1 - waitF) * 0.14 + 0.04 * (S.up.interior || 0) + (seat >= 0 ? 0.06 : 0) + (S.furn.speaker ? 0.03 : 0) + (cash ? 0.02 : 0) - pen, 0, 1);
    // 傷んだケーキを売った → 味や値段に関係なく最悪の評価
    const bad = df.indexOf('spoil') >= 0;
    if (bad) { sat = Math.min(sat, 0.04); _.rate(S, 1, 0.08); }
    S.today.sat += sat; S.today.cust++;
    // 相場より高めで買ったお客さんは、味がいまいちだと値段に文句を言う
    if (priceF > 1.12 && !df.length && sat < 0.55 && Math.random() < 0.5) {
      S.today.pcomp = (S.today.pcomp || 0) + 1; S.today.complaints = (S.today.complaints || 0) + 1; _.rate(S, 1.8, 0.03);
      _.fx(S, 'review', '口コミ ★2「値段のわりにふつう…」');
    }
    if (!df.length) _.addXp(S, n + (sat > 0.6 ? 1 : 0));
    if (df.length) {
      S.today.complaints = (S.today.complaints || 0) + 1;
      df.forEach((x) => (S.today.issues[x] = (S.today.issues[x] || 0) + 1));
      _.rate(S, 1 + sat * 4, 0.07);
      if (!D.DEFECTS[worst].vis) _.fx(S, 'review', '口コミ ★' + Math.max(1, Math.round(1 + sat * 4)) + '「' + D.DEFECTS[worst].say + '」');
    } else _.rate(S, 1 + sat * 4, 0.03);
    c.say = bad ? D.DEFECTS.spoil.say : worst && D.DEFECTS[worst].vis ? D.DEFECTS[worst].say : ct.id === 'gourmet' && qs > 0.8 ? _.pick(D.SAY.gourmet) : sat > 0.65 ? _.pick(D.SAY.great) : sat > 0.4 ? _.pick(D.SAY.ok) : _.pick(D.SAY.meh);
    c.sayT = now; c.paid = sales;
    if (seat >= 0) { c.seat = seat; c.st = 'eat'; c.tEnd = now + 3500 + R.SIT_MS; } else { c.st = 'out'; c.tEnd = now + R.WALK_MS; }
    _.fx(S, 'sale', '¥' + sales.toLocaleString(), '');
  }

  // =====================================================================
  //  お客さん（OPEN のときだけ来る）
  // =====================================================================
  K.queue = function (S, lane) { return Object.keys(S.cust).filter((id) => S.cust[id].st === 'q' && S.cust[id].lane === lane).sort((a, b) => S.cust[a].tq - S.cust[b].tq); };
  K.spawn = function (S, now) {
    const lanes = K.count(S, 'reg');
    const inShop = Object.values(S.cust).filter((c) => c.st === 'in' || c.st === 'q' || c.st === 'w').length;
    if (inShop >= 5 * lanes + 2) { S.today.miss++; S.today.cust++; return; }
    const ct = _.wpick(D.CUSTOMERS);
    let lane = 0, best = 1e9; for (let l = 0; l < lanes; l++) { const n = Object.values(S.cust).filter((c) => c.lane === l && (c.st === 'q' || c.st === 'in')).length; if (n < best) { best = n; lane = l; } }
    S.cust[_.uid(S, 'u')] = { ty: ct.id, v: Math.floor(Math.random() * 4), st: 'in', t0: now, tq: now + R.WALK_MS, lane, seat: -1 };
  };
  // 並んだら何を買うか決める：販売中（解放済み・有効）の商品から好きな個数。商品棚に無い物は注文を受けてから作る
  K.shelfStock = function (S) { const st = {}; S.showcase.forEach((k) => { if (k && k.p > 0) st[k.r] = (st[k.r] || 0) + k.p; }); return st; };
  // 待っているお客さんの注文に、商品棚の在庫を受付順に割り当てたときの不足（作らないといけない数）
  K.shortage = function (S) {
    const left = K.shelfStock(S), short = {};
    Object.keys(S.cust).filter((id) => S.cust[id].st === 'w').sort((a, b) => (S.cust[a].no || 0) - (S.cust[b].no || 0)).forEach((id) => {
      const o = S.cust[id].ord || {};
      for (const r in o) { const use = Math.min(left[r] || 0, o[r]); left[r] = (left[r] || 0) - use; if (o[r] > use) { short[r] = (short[r] || 0) + o[r] - use; (short._by = short._by || {})[id] = 1; } }
    });
    return short;
  };
  function decide(S, c, now) {
    const ct = D.CUSTOMERS.find((x) => x.id === c.ty) || D.CUSTOMERS[0];
    const noise = Math.exp(_.gauss() * 0.15);
    const opts = [];
    let seen = 0, worstP = null;
    const avail = {}; S.showcase.forEach((k) => { if (k && k.p > 0) avail[k.r] = { p: (avail[k.r] ? avail[k.r].p : 0) + k.p, q: k.q, df: k.df }; });
    for (const rid of _.menuRecipes(S)) {
      const m = S.menu[rid], r = sim.recipe(S, rid);
      seen++;
      const a = avail[rid];
      // 並んでいる物は見た目で判断。無い物は「このお店ならこのくらい」の期待で選ぶ
      const w = _.wtp(S, r, a ? a.q : 0.78, ct, noise, rid) * (a ? _.appearance(a.df) : 1);
      const mk = _.cakeMarket(S, rid, r); if (!worstP || m.price / mk > worstP.f) worstP = { rid, f: m.price / mk, mk };
      if (w > m.price && m.price <= mk * R.PRICE_LIMIT) opts.push({ rid, s: (w - m.price) / m.price + (a ? 0.12 : 0) + Math.random() * 0.25, price: m.price });
    }
    if (!opts.length) {
      c.st = 'out'; c.tEnd = now + R.WALK_MS; c.sayT = now; S.today.miss++; S.today.cust++;
      if (!seen) { c.say = _.pick(D.SAY.soldout); S.today.soldout++; _.rate(S, 1.8, 0.02); }
      else if (worstP && worstP.f > R.PRICE_LIMIT) {
        // 相場より高すぎる → クレーム
        c.say = _.pick(['高すぎる！相場の倍近いよ', 'この値段はないでしょ…', 'ぼったくりじゃない？']);
        S.today.pcomp = (S.today.pcomp || 0) + 1; S.today.complaints = (S.today.complaints || 0) + 1;
        _.rate(S, 1.4, 0.035);
        if (Math.random() < 0.45) _.fx(S, 'review', '口コミ ★1「' + ((sim.recipe(S, worstP.rid) || {}).name || 'ケーキ') + 'が高すぎる。相場は' + worstP.mk + '円くらいなのに」');
      } else { c.say = _.pick(D.SAY.pricey); _.rate(S, 2.6, 0.012); }
      return;
    }
    opts.sort((a, b) => b.s - a.s);
    // 好きな個数：ふつうは1〜2個、家族・まとめ買いの人は多め（1人6個＝箱いっぱいまで）
    const ord = {}, price = {}, MAX = R.ORDER_MAX || 6;
    const kinds = Math.min(opts.length, ct.multi ? (Math.random() < 0.55 ? 2 : Math.random() < 0.4 ? 3 : 1) : Math.random() < 0.2 ? 2 : 1);
    let total = 0;
    for (let i = 0; i < kinds && total < MAX; i++) {
      const o = opts[i], want = ct.multi ? 1 + Math.floor(Math.random() * 3) : Math.random() < 0.3 ? 2 : 1;
      const n = Math.min(MAX - total, want); if (n <= 0) break;
      ord[o.rid] = n; price[o.rid] = o.price; total += n;
    }
    c.ord = ord; c.price = price; c.st = 'q'; c.pq = now + R.QUEUE_MS; c.say = '';
  }
  K.tickCustomers = function (S, now) {
    for (const id in S.cust) {
      const c = S.cust[id];
      if (c.st === 'in' && now >= c.tq) decide(S, c, now);
      else if (c.st === 'q' && now >= c.pq) { c.st = 'out'; c.tEnd = now + R.WALK_MS; c.say = '待ちきれない…'; c.sayT = now; S.today.miss++; S.today.cust++; _.rate(S, 1.6, 0.03); }
      else if (c.st === 'w' && now >= c.pw) { c.st = 'out'; c.tEnd = now + R.WALK_MS; c.say = c.make ? '遅すぎる…もういいです' : 'まだ来ない…もういいです'; c.sayT = now; S.today.miss++; S.today.cust++; S.today.slow = (S.today.slow || 0) + 1; _.rate(S, 1.3, 0.05); _.fx(S, 'err', '注文 #' + c.no + ' のお客さんが待ちきれずに帰ってしまった…'); }
      else if ((c.st === 'out' || c.st === 'eat') && now >= c.tEnd) { if (c.st === 'eat') { c.st = 'out'; c.tEnd = now + R.WALK_MS; c.seat = -1; } else delete S.cust[id]; }
    }
  };
  // 閉店・CLOSE のとき：並んでいる人には帰ってもらう
  K.sendAway = function (S, now, msg) {
    for (const id in S.cust) { const c = S.cust[id]; if (c.st === 'in' || c.st === 'q') { c.st = 'out'; c.tEnd = now + R.WALK_MS; c.say = msg || ''; c.sayT = now; } }
  };

  // =====================================================================
  //  仕入れ（段ボールで届く）
  // =====================================================================
  // 仕入れはトラックで裏口の外に届く（到着までは持てない）
  // 仕入れ：1回の注文＝1台のトラック。到着したら荷台から段ボールを下ろす（全部下ろすと帰る）
  K.TRUCK = { IN: 9000, OUT: 8000, WAIT: 2500 };
  K.deliver = function (S, list, now) {
    if (S.k.truck) return 0;
    const at = now + K.TRUCK.IN;
    S.k.truck = { at, out: 0 };
    list.slice(0, KD.deliv).forEach((x, j) => add(S, { t: 'crate', ing: x.ing, n: x.n, u: x.u, ar: at, at: 'dl:' + j }));
    return at;
  };
  K.arrived = (it, now) => !it || it.t !== 'crate' || !(it.ar > now);
  K.deliveryFree = (S) => (S.k.truck ? 0 : KD.deliv);

  // =====================================================================
  //  毎ティック（オーブンの火・焼き過ぎ・アルバイト）
  // =====================================================================
  K.tick = function (S, now) {
    // 予熱が終わったオーブンに待っている型があれば焼き始める
    S.ovens.forEach((o, i) => { const id = K.at(S, 'ov:' + i); if (id) { const it = S.k.items[id]; if (it.st === 'raw' && o.h) putInOven(S, it, i, now); } });
    // ゲージを放置しすぎたら自動で止まる（分離・混ぜすぎ）
    ['mix', 'whip'].forEach((st) => S.k[st].forEach((b, i) => { if (b.st === 'run' && !b.by && K.prog(b, now) > 1.8) A.run(S, { st, i, pid: '' }, now); }));
    S.k.deco.forEach((b, i) => { if (b.st === 'run' && K.prog(b, now) > 1.8) runDeco(S, { i, pid: '' }, now); if (b.st === 'spread' && now - (b.t0 || 0) > 180000) { b.st = 'idle'; b.by = null; } });
    const tk = S.k.truck;
    if (tk) {
      if (!tk.out && now >= tk.at && !Object.keys(S.k.items).some((id) => String(S.k.items[id].at).startsWith('dl:'))) tk.out = now + K.TRUCK.WAIT;
      if (tk.out && now > tk.out + K.TRUCK.OUT) S.k.truck = null;
    }
    K.tickFresh(S, now);
    if (S.phase === 'open') K.tickCustomers(S, now);
    else for (const id in S.cust) { const c = S.cust[id]; if ((c.st === 'out' || c.st === 'eat') && now >= c.tEnd) { if (c.st === 'eat') { c.st = 'out'; c.tEnd = now + R.WALK_MS; } else delete S.cust[id]; } }
    staffTick(S, now);
  };
  // 1日の終わり：作りかけ・クリームは廃棄（段ボールは残る）。厨房の冷蔵庫に入れた物は翌日も使える（1晩まで）
  K.endDay = function (S) {
    let waste = 0;
    for (const id in S.k.items) {
      const it = S.k.items[id], inFr = kindOf(it.at) === 'fr';
      if (it.t === 'crate') {
        if (String(it.at).startsWith('h:')) it.at = freeSpot(S, 'sp') || it.at;
        // 要冷蔵の材料を段ボールのまま一晩置いた → 傷む
        if (K.spoilSec(S, it) && !coldSlot(it.at) && (it.sp || 0) < 2) { it.sp = 2; it.wm = K.spoilSec(S, it) * 1000; it.w0 = 0; }
        continue;
      }
      if (it.t === 'pan' && it.st === 'empty') { delete S.k.items[id]; continue; }
      if (it.t === 'pan' && it.st === 'baked') { it.q *= inFr ? 0.97 : 0.9; if (String(it.at).startsWith('h:')) it.at = freeSpot(S, 'rk') || freeSpot(S, 'sp') || it.at; continue; }
      // 冷蔵庫のケーキは賞味期限（作った日を入れて2日）まで残る。作りかけ・クリームは1晩まで
      if (inFr && it.t === 'cake' && (it.sp || 0) < 2 && !_.cakeExpired(S, it.d, 1)) { it.o = (it.o || 0) + 1; it.q = (it.q || 0.5) * 0.95; continue; }
      if (inFr && it.t === 'cake') S.today.expired = (S.today.expired || 0) + (it.p || 0);
      if (inFr && (it.t === 'cream' || it.t === 'deco') && !it.o && (it.sp || 0) < 2) { it.o = 1; it.q = (it.q || 0.5) * 0.9; continue; }
      waste += itemCost(it); delete S.k.items[id];
    }
    ['mix', 'whip'].forEach((st) => S.k[st] = S.k[st].map((b) => { waste += b.c || 0; return { ings: [], st: 'idle' }; }));
    S.k.deco = S.k.deco.map(() => ({ st: 'idle' }));
    S.ovens.forEach((o) => { o.h = 0; });
    return Math.round(waste);
  };
  function freeSpot(S, kind) {
    const n = { rk: KD.rack, sp: KD.spots, dl: KD.deliv, pk: KD.pack }[kind] || 0;
    for (let j = 0; j < n; j++) if (!K.at(S, kind + ':' + j)) return kind + ':' + j;
    return null;
  }
  K.freeSpot = freeSpot;

  // =====================================================================
  //  アルバイト（1人1業務。物を確保してから作業し、結果を置き場へ）
  // =====================================================================
  const staffQ = (lv) => clamp(0.48 + 0.048 * lv + _.gauss() * 0.05, 0.3, 0.99);
  const staffDf = (lv, kinds) => (Math.random() < 0.2 - 0.02 * lv ? [_.pick(kinds)] : []);
  const free = (S, id) => { const it = S.k.items[id]; return it && !it.res && !String(it.at).startsWith('h:'); };
  function staffTick(S, now) {
    if (!S.staff || !(S.phase === 'prep' || S.phase === 'open')) return;
    const recs = _.menuRecipes(S).map((rid) => [rid, sim.recipe(S, rid)]);
    S.staff.forEach((st, slot) => {
      if (!st) return;
      const sp = D.STAFF.speed[st.lv - 1] || 0.3;
      const dur = (k) => ((D.STAFF.jobSec[k] || 10) * 1000) / sp * (k === 'mix' ? _.eqv(S, 'mixer').fast || 1 : 1);
      if (st.job) { if (now >= st.job.end) finish(S, st, slot, now); return; }
      if (st.wait && now < st.wait) return;
      st.wait = now + 1200;
      const job = (o) => { st.job = Object.assign(o, { t0: now }); };
      const I = S.k.items;
      if (st.task === 'mix') {
        const raw = Object.values(I).filter((it) => it.t === 'pan' && (it.st === 'raw' || it.st === 'baking')).length;
        if (raw >= S.ovens.length) return;
        const i = S.k.mix.findIndex((b, k) => b.st === 'idle' && !b.ings.length && !b.by && !K.at(S, 'mo:' + k));
        if (i < 0) return;
        let base = D.BASES[st.opt] ? st.opt : null;
        if (!base) { const need = {}; recs.forEach(([, r]) => (need[r.base] = 0)); Object.values(I).forEach((it) => { if (it.t === 'pan' && it.b in need) need[it.b]++; }); let best = 1e9; for (const k in need) if (need[k] < best && _.hasAll(S, D.BASES[k].ing)) { best = need[k]; base = k; } }
        if (!base || !_.hasAll(S, D.BASES[base].ing)) return;
        const cost = _.takeAll(S, D.BASES[base].ing);
        S.k.mix[i].by = 'staff' + slot;
        job({ k: 'mix', i, base, cost, end: now + dur('mix') });
      } else if (st.task === 'bake') {
        const err = Math.max(0.02, 0.22 - 0.022 * st.lv);
        // 焼き上がりを取り出す
        for (let i = 0; i < S.ovens.length; i++) {
          const id = K.at(S, 'ov:' + i); if (!id || !free(S, id)) continue; const it = I[id];
          if (it.st !== 'baking' || !it.bk) continue;
          if (it.tg == null) it.tg = 1 + _.gauss() * err;
          const d = (now - it.bk.t0) / it.bk.dur;
          if (d >= it.tg - dur('out') / it.bk.dur) { it.res = 'staff' + slot; return job({ k: 'out', i, id, end: now + dur('out') }); }
        }
        // 生地の型をオーブンへ
        const rid = Object.keys(I).find((id) => free(S, id) && I[id].t === 'pan' && I[id].st === 'raw' && kindOf(I[id].at) !== 'ov');
        if (!rid) return;
        const B = D.BASES[I[rid].b], i = S.ovens.findIndex((o, k) => !K.at(S, 'ov:' + k));
        if (i < 0) return;
        const o = S.ovens[i];
        if (!o.h || o.temp !== B.temp) { A.oven(S, { i, op: 'set', temp: B.temp }, now); st.wait = now + 2500; return; }
        if (now >= (o.hot || 0) || (st.lv <= 2 && Math.random() < 0.08)) { I[rid].res = 'staff' + slot; job({ k: 'in', i, id: rid, end: now + dur('in') }); }
      } else if (st.task === 'whip') {
        let cream = D.CREAMS[st.opt] && st.opt !== 'none' ? st.opt : null;
        const have = (k) => Object.values(I).filter((it) => it.t === 'cream' && it.k === k && (it.sp || 0) < 2).reduce((a, it) => a + it.n, 0);
        if (!cream) { let best = 1e9; recs.forEach(([, r]) => { if (r.cream !== 'none' && have(r.cream) < best && _.hasAll(S, D.CREAMS[r.cream].ing)) { best = have(r.cream); cream = r.cream; } }); }
        if (!cream || have(cream) >= 2 || !_.hasAll(S, D.CREAMS[cream].ing)) return;
        const i = S.k.whip.findIndex((b, k) => b.st === 'idle' && !b.ings.length && !b.by && (!K.at(S, 'wo:' + k + ':0') || !K.at(S, 'wo:' + k + ':1')));
        if (i < 0) return;
        const cost = _.takeAll(S, D.CREAMS[cream].ing);
        S.k.whip[i].by = 'staff' + slot;
        job({ k: 'whip', i, cream, cost, end: now + dur('whip') });
      } else if (st.task === 'deco') {
        const ci = S.showcase.findIndex((c) => !c); if (ci < 0) return;
        const di = S.k.deco.findIndex((b, k) => b.st === 'idle' && !K.at(S, 'dt:' + k)); if (di < 0) return;
        const short = K.shortage(S), stock = K.shelfStock(S);
        const cand = (st.opt && S.known[st.opt] ? [[st.opt, sim.recipe(S, st.opt)]] : recs).sort((a, b) => (short[b[0]] || 0) - (short[a[0]] || 0) || (stock[a[0]] || 0) - (stock[b[0]] || 0));
        for (const [rid, r] of cand) {
          const pid = Object.keys(I).filter((id) => free(S, id) && I[id].t === 'pan' && I[id].st === 'baked' && I[id].b === r.base && now >= (I[id].cool || 0) && kindOf(I[id].at) !== 'dt').sort((x, y) => (I[x].df || []).length - (I[y].df || []).length)[0];
          if (!pid) continue;
          const cid = r.cream === 'none' ? null : Object.keys(I).find((id) => free(S, id) && I[id].t === 'cream' && I[id].k === r.cream && I[id].n > 0 && (I[id].sp || 0) < 2);
          if (r.cream !== 'none' && !cid) continue;
          if (!_.hasAll(S, r.tops || {})) continue;
          const b = I[pid]; del(S, pid);
          let cr = null; if (cid) { const c = I[cid]; cr = { q: c.q, c: c.c, df: c.df || [] }; c.n -= 1; if (c.n <= 0) del(S, cid); }
          const tc = _.takeAll(S, r.tops || {});
          S.k.deco[di].by = 'staff' + slot;
          return job({ k: 'deco', di, ci, r: rid, b: { q: b.q, df: b.df, c: b.c }, cr, tc, end: now + dur('deco') });
        }
      } else if (st.task === 'stock') {
        const cid = Object.keys(I).find((id) => free(S, id) && I[id].t === 'crate' && K.arrived(I[id], now));
        if (cid) { I[cid].res = 'staff' + slot; return job({ k: 'stock', id: cid, end: now + dur('stock') }); }
        if (S.funds < 8000 || S.k.truck) return;
        const need = {};
        recs.forEach(([, r]) => { [D.BASES[r.base].ing, r.cream !== 'none' ? D.CREAMS[r.cream].ing : {}, r.tops || {}].forEach((g) => { for (const k in g) need[k] = Math.max(need[k] || 0, g[k]); }); });
        const ing = Object.keys(need).find((k) => _.invCount(S, k) < need[k] * 2 + 2);
        if (ing) sim.ACT.buy(S, { id: ing, n: 10 }, now);
      } else if (st.task === 'cashier') {
        // 先頭のお客さんの注文を受ける
        for (let l = 0; l < K.count(S, 'reg'); l++) { const q = K.queue(S, l); if (q.length) return job({ k: 'order', c: q[0], end: now + dur('order') }); }
        // そろっている注文を箱に詰めて渡す
        const waiting = Object.keys(S.cust).filter((id) => S.cust[id].st === 'w' && !S.cust[id].res).sort((a, b) => S.cust[a].tOrd - S.cust[b].tOrd);
        for (const id of waiting) {
          const ord = S.cust[id].ord, have = {};
          S.showcase.forEach((k) => { if (k && k.p > 0) have[k.r] = (have[k.r] || 0) + k.p; });
          if (Object.keys(ord).every((r) => (have[r] || 0) >= ord[r])) { S.cust[id].res = 'staff' + slot; return job({ k: 'serve', c: id, end: now + dur('serve') * Object.values(ord).reduce((a, x) => a + x, 0) }); }
        }
      }
    });
  }
  function finish(S, st, slot, now) {
    const j = st.job; st.job = null;
    const I = S.k.items;
    let done = true;
    if (j.k === 'mix') {
      S.k.mix[j.i].by = null;
      const spot = !K.at(S, 'mo:' + j.i) ? 'mo:' + j.i : freeSpot(S, 'sp');
      if (spot) add(S, { t: 'pan', st: 'raw', b: j.base, q: staffQ(st.lv), df: staffDf(st.lv, ['lump', 'flat']), c: j.cost, at: spot }); else { S.today.waste += j.cost; done = false; }
    } else if (j.k === 'whip') {
      S.k.whip[j.i].by = null;
      const spot = !K.at(S, 'wo:' + j.i + ':0') ? 'wo:' + j.i + ':0' : !K.at(S, 'wo:' + j.i + ':1') ? 'wo:' + j.i + ':1' : freeSpot(S, 'sp');
      if (spot) add(S, { t: 'cream', k: j.cream, q: staffQ(st.lv), df: staffDf(st.lv, ['soft', 'sep']), n: D.CREAM_YIELD, c: j.cost / D.CREAM_YIELD, day: S.day, at: spot }); else done = false;
    } else if (j.k === 'in') {
      const it = I[j.id];
      if (it && !K.at(S, 'ov:' + j.i)) { it.res = null; it.at = 'ov:' + j.i; putInOven(S, it, j.i, now); } else { if (it) it.res = null; done = false; }
    } else if (j.k === 'out') {
      const it = I[j.id];
      if (it && it.at === 'ov:' + j.i) { takeFromOven(S, it, now); it.res = null; it.at = freeSpot(S, 'rk') || freeSpot(S, 'sp') || it.at; delete it.tg; } else { if (it) it.res = null; done = false; }
    } else if (j.k === 'deco') {
      S.k.deco[j.di].by = null;
      const r = sim.recipe(S, j.r), n = sim.pieceCount(r);
      const q = clamp(j.b.q * 0.35 + (j.cr ? j.cr.q * 0.25 : 0.25) + staffQ(st.lv) * 0.4, 0, 1);
      const df = _.union(j.b.df, j.cr ? j.cr.df : [], staffDf(st.lv, r.cream === 'none' ? ['messy'] : ['messy', 'uneven']));
      const cake = { r: j.r, q, p: n, n, c: Math.round((j.b.c || 0) + (j.cr ? j.cr.c : 0) + (j.tc || 0)), d: S.day, o: 0, df };
      if (!S.showcase[j.ci]) S.showcase[j.ci] = cake;
      else { const spot = freeSpot(S, 'sp'); if (spot) add(S, Object.assign({ t: 'cake', at: spot }, cake)); }
      _.fx(S, 'cake', st.name + ' さんが ' + r.name + ' を仕上げた');
    } else if (j.k === 'stock') {
      const it = I[j.id];
      if (it && (it.sp || 0) >= 2) { S.today.waste += Math.round(itemCost(it)); S.today.spoiled = (S.today.spoiled || 0) + 1; _.fx(S, 'info', st.name + ' さんが傷んだ' + ingName(it.ing) + 'の段ボールを捨てた'); del(S, j.id); }
      else if (it) { _.invAdd(S, it.ing, it.n, it.u, (it.sp || 0) >= 1); S.today.shelved = (S.today.shelved || 0) + it.n; del(S, j.id); } else done = false;
    } else if (j.k === 'order') {
      const c = S.cust[j.c]; if (c && c.st === 'q') takeOrder(S, j.c, now); else done = false;
    } else if (j.k === 'serve') {
      const c = S.cust[j.c]; if (c) c.res = null;
      if (c && c.st === 'w') {
        const slices = [];
        for (const r in c.ord) for (let n = 0; n < c.ord[r]; n++) { const ci = S.showcase.findIndex((k) => k && k.r === r && k.p > 0); if (ci < 0) break; const k = S.showcase[ci]; slices.push([k.r, k.q, k.df || [], Math.round(k.c / (k.n || R.PIECES))]); k.p -= 1; if (k.p <= 0) S.showcase[ci] = 0; }
        if (slices.length === Object.values(c.ord).reduce((a, x) => a + x, 0)) pay(S, c, slices, now); else done = false;
      } else done = false;
    }
    if (!done) return;
    st.xp = (st.xp || 0) + 1; st.done = (st.done || 0) + 1;
    while (st.lv < 10 && st.xp >= D.STAFF.xp[st.lv]) { st.lv++; _.fx(S, 'info', st.name + ' さんが Lv' + st.lv + ' に！仕事が速くなった'); }
  }
  // スタッフが確保した物を戻す（解雇・担当替え）
  K.releaseStaff = function (S, slot) {
    const tag = 'staff' + slot;
    for (const id in S.k.items) if (S.k.items[id].res === tag) S.k.items[id].res = null;
    ['mix', 'whip', 'deco'].forEach((k) => S.k[k].forEach((b) => { if (b.by === tag) b.by = null; }));
    for (const id in S.cust) if (S.cust[id].res === tag) S.cust[id].res = null;
  };
})(typeof window !== 'undefined' ? window : globalThis);
