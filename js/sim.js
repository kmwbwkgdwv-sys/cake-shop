/* ケーキ屋さんシミュレーター : ゲームロジック（ホストが実行する純粋ロジック） */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data;
  const R = D.RULES;
  const DECIDE_MS = 2600;
  const LEAVE_MS = 2400;
  const MAX_IN_SHOP = 9;
  const SIT_MS = 16000;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const round10 = (v) => Math.round(v / 10) * 10;
  const wpick = (arr) => { let t = 0; for (const a of arr) t += a.w; let r = Math.random() * t; for (const a of arr) { r -= a.w; if (r <= 0) return a; } return arr[arr.length - 1]; };

  function uid(S, p) { S.seq = (S.seq || 0) + 1; return p + S.seq.toString(36); }

  // ===================== 状態 =====================
  function newState(opt) {
    opt = opt || {};
    const S = {
      v: 1, name: opt.name || 'わたしのケーキ屋さん', diff: opt.diff || 'normal',
      day: 1, phase: 'lobby', phaseAt: 0,
      clock: { base: 0, at: 0, run: false },
      funds: R.START_FUNDS, rep: 2.8,
      inv: {}, market: {}, mEvent: 0,
      batters: {}, ovens: [{ s: 0 }, { s: 0 }], bases: {}, creams: {}, showcase: [0, 0, 0], stock: {},
      menu: {}, known: {}, originals: {}, tested: {},
      up: {}, eq: {}, furn: {}, staff: [0, 0, 0, 0], ad: 'none', weather: 'sun',
      xp: 0, today: blankToday(), history: [], cust: {}, fx: [], fxi: 0, seq: 0, np: 1, bankrupt: 0,
    };
    for (const id in D.RECIPES) if ((D.RECIPES[id].lv || 1) <= 1) addKnown(S, id);
    genMarket(S, true);
    // 初期在庫（ちょっとだけ）
    const start = { flour: 8, egg: 18, sugar: 14, butter: 4, cream: 8, strawberry: 6, choco: 3, cocoa: 2, cheese: 6, lemon: 3, milk: 2 };
    for (const id in start) invAdd(S, id, start[id], D.ING[id].price);
    return S;
  }
  function blankToday() { return { sales: 0, drinks: 0, cogs: 0, waste: 0, ads: 0, cust: 0, sold: 0, miss: 0, soldout: 0, sat: 0, best: {}, buy: 0, complaints: 0, issues: {} }; }
  const cleanDf = (arr) => { const out = []; (Array.isArray(arr) ? arr : []).forEach((d) => { if (D.DEFECTS[d] && out.indexOf(d) < 0) out.push(d); }); return out; };
  const union = (...arrs) => cleanDf([].concat(...arrs.map((a) => a || [])));
  // 見た目の欠点による「買いたさ」の倍率
  function appearance(df) { let m = 1; (df || []).forEach((d) => { const x = D.DEFECTS[d]; if (x && x.vis) m *= x.wtp; }); return m; }

  // Realtime Database から戻ってきたデータは空配列・空オブジェクトが消えるので整える
  function normalize(S) {
    if (!S || typeof S !== 'object') return S;
    const obj = (k) => { if (!S[k] || typeof S[k] !== 'object' || Array.isArray(S[k])) S[k] = S[k] && typeof S[k] === 'object' ? Object.assign({}, S[k]) : {}; };
    ['inv', 'market', 'batters', 'bases', 'creams', 'stock', 'menu', 'known', 'originals', 'tested', 'up', 'cust', 'eq', 'furn'].forEach(obj);
    if (!S.clock) S.clock = { base: 0, at: 0, run: false };
    if (!S.today) S.today = blankToday();
    if (S.xp == null) S.xp = toArr(S.history).reduce((a, h) => a + ((h && h.sold) || 0), 0);
    if (!S.today.best) S.today.best = {};
    if (!S.today.issues) S.today.issues = {};
    ['batters', 'bases', 'creams', 'stock'].forEach((k) => { for (const id in S[k]) if (S[k][id]) S[k][id].df = toArr(S[k][id].df).filter((x) => x); });
    S.history = toArr(S.history);
    S.fx = toArr(S.fx);
    for (const id in S.inv) { S.inv[id] = toArr(S.inv[id]).map(toArr).filter((l) => l.length === 3 && l[0] > 0); if (!S.inv[id].length) delete S.inv[id]; }
    const nOven = upVal('oven', S.up.oven || 0);
    S.ovens = toArr(S.ovens).map((o) => (o && typeof o === 'object' ? o : { s: 0 }));
    while (S.ovens.length < nOven) S.ovens.push({ s: 0 });
    const nCase = upVal('showcase', S.up.showcase || 0);
    S.showcase = toArr(S.showcase, nCase).map((c) => (c && typeof c === 'object' ? Object.assign(c, { df: toArr(c.df).filter((x) => x) }) : 0));
    S.ovens.forEach((o) => { if (o.s) o.df = toArr(o.df).filter((x) => x); });
    while (S.showcase.length < nCase) S.showcase.push(0);
    for (const id in S.originals) { const o = S.originals[id]; if (!o.tops) o.tops = {}; }
    // 旧データの設備を新しい「設備・家具」に移す
    const U = S.up;
    if (U.proOven && !S.eq.oven) S.eq.oven = 2; if (U.mixer && !S.eq.mixer) S.eq.mixer = 1; if (U.cooler && !S.eq.cooler) S.eq.cooler = 1; if (U.fridge && !S.eq.fridge) S.eq.fridge = 1;
    if (U.eatin && !S.furn.table) { S.furn.table = 3; S.furn.coffee = 1; }
    delete U.proOven; delete U.mixer; delete U.cooler; delete U.fridge; delete U.eatin;
    S.staff = toArr(S.staff, 4).slice(0, 4).map((x) => (x && typeof x === 'object' ? x : 0));
    unlockByLevel(S);
    return S;
  }
  function toArr(v, len) {
    if (Array.isArray(v)) { const a = v.slice(); if (len) while (a.length < len) a.push(0); return a.map((x) => (x === undefined || x === null ? 0 : x)); }
    if (v && typeof v === 'object') { const keys = Object.keys(v).map(Number).filter((n) => !isNaN(n)); const n = Math.max(len || 0, keys.length ? Math.max(...keys) + 1 : 0); const a = []; for (let i = 0; i < n; i++) a.push(v[i] === undefined || v[i] === null ? 0 : v[i]); return a; }
    const a = []; if (len) for (let i = 0; i < len; i++) a.push(0); return a;
  }

  // 店舗レベル
  function shopLevel(S) {
    const xp = Math.floor(S.xp || 0), T = D.SHOP_XP;
    let lv = 1; while (lv < T.length && xp >= T[lv]) lv++;
    const cur = T[lv - 1], next = lv < T.length ? T[lv] : null;
    return { lv, xp, cur, next, f: next ? (xp - cur) / (next - cur) : 1, max: lv >= T.length };
  }
  function addXp(S, n) {
    const before = shopLevel(S).lv;
    S.xp = (S.xp || 0) + n;
    const after = shopLevel(S).lv;
    if (after > before) {
      const items = unlockByLevel(S);
      const ups = D.UPGRADES.filter((u) => (u.req || []).some((r, i) => r === after && (S.up[u.id] || 0) <= i)).map((u) => u.name);
      for (const k in D.EQUIP) D.EQUIP[k].tiers.forEach((t) => { if (t.lv === after && t.price) ups.push(t.name); });
      for (const k in D.FURN) if (D.FURN[k].lv === after) ups.push(D.FURN[k].name);
      const st = D.STAFF.slots.filter((x) => x.lv === after).length;
      const parts = [];
      if (items.length) parts.push('新商品「' + items.join('」「') + '」');
      if (ups.length) parts.push('「' + ups.join('」「') + '」');
      if (st) parts.push('アルバイト枠 +1');
      fx(S, 'up', 'お店のレベルが Lv' + after + ' に上がった！' + (parts.length ? ' ' + parts.join('・') + ' が解放' : ''));
    }
  }
  function upReq(u, lv) { return (u.req || [])[lv] || 1; }
  // 店舗レベルで解放される商品
  function unlockByLevel(S) {
    const lv = shopLevel(S).lv, got = [];
    for (const id in D.RECIPES) if ((D.RECIPES[id].lv || 1) <= lv && !S.known[id]) { addKnown(S, id); got.push(D.RECIPES[id].name); }
    return got;
  }
  // 設備の性能
  function eqv(S, k) { const t = D.EQUIP[k].tiers; return t[Math.min(t.length - 1, (S.eq && S.eq[k]) || 0)]; }
  // 1台（1回）で何個売れるか
  function pieceCount(r) { return (r && r.pieces) || (r && D.BASES[r.base] && D.BASES[r.base].cookie ? 8 : R.PIECES); }
  const kN = (k) => k.n || R.PIECES;
  function furnMax(S, id) { const f = D.FURN[id]; return f.max[Math.min(f.max.length - 1, S.up.floor || 0)]; }
  function upVal(id, lv) { const u = D.UPGRADES.find((x) => x.id === id); return u && u.vals ? u.vals[lv] : lv; }

  // ===================== 時計 =====================
  // gt = ゲーム内経過ミリ秒。ホストがいないあいだは止まる
  function gt(S, now) {
    const c = S.clock || {};
    if (!c.run) return c.base || 0;
    return (c.base || 0) + clamp(now - (c.at || now), 0, 10000);
  }
  function phaseInfo(S, t) {
    const el = Math.max(0, t - (S.phaseAt || 0));
    if (S.phase === 'prep') { const f = clamp(el / R.PREP_MS, 0, 1); return { phase: 'prep', label: '開店準備', f, min: 7.5 * 60 + f * 150, left: R.PREP_MS - el }; }
    if (S.phase === 'open') { const f = clamp(el / R.OPEN_MS, 0, 1); return { phase: 'open', label: '営業中', f, min: 600 + f * 600, left: R.OPEN_MS - el }; }
    if (S.phase === 'report') return { phase: 'report', label: '閉店', f: 1, min: 20 * 60, left: 0 };
    return { phase: 'lobby', label: 'ロビー', f: 0, min: 7 * 60, left: 0 };
  }
  function clockStr(min) { const h = Math.floor(min / 60), m = Math.floor(min % 60); return h + ':' + String(m).padStart(2, '0'); }

  // ===================== 相場・天気 =====================
  function genMarket(S, first) {
    const m = {};
    for (const id in D.ING) {
      const base = D.ING[id].price;
      const prev = (S.market && S.market[id]) || base;
      let p = first ? base : prev * (1 + (Math.random() - 0.5) * 0.18);
      p += (base - p) * 0.25;
      m[id] = Math.round(clamp(p, base * 0.6, base * 1.7));
    }
    S.mEvent = 0;
    if (!first && Math.random() < 0.35) {
      const id = pick(Object.keys(D.ING));
      const up = Math.random() < 0.5;
      m[id] = Math.round(m[id] * (up ? 1.5 : 0.62));
      S.mEvent = { id, up: up ? 1 : 0 };
    }
    S.market = m;
    S.weather = first ? 'sun' : wpick(D.WEATHER).id;
  }

  // ===================== 在庫 =====================
  function invCount(S, id) { const l = S.inv[id]; if (!l) return 0; let n = 0; for (const x of l) n += x[0]; return n; }
  function invAdd(S, id, n, unitCost) {
    const life = D.ING[id].life;
    const exp = life ? S.day + Math.ceil(life * eqv(S, 'fridge').life) : 9999;
    const l = (S.inv[id] = S.inv[id] || []);
    const same = l.find((x) => x[1] === exp && x[2] === unitCost);
    if (same) same[0] += n; else l.push([n, exp, unitCost]);
    l.sort((a, b) => a[1] - b[1]);
  }
  function invTake(S, id, n) {
    if (invCount(S, id) < n) return -1;
    let cost = 0; const l = S.inv[id];
    while (n > 0) { const lot = l[0]; const k = Math.min(n, lot[0]); lot[0] -= k; n -= k; cost += k * lot[2]; if (lot[0] <= 0) l.shift(); }
    if (!l.length) delete S.inv[id];
    return cost;
  }
  function hasAll(S, req) { for (const id in req) if (invCount(S, id) < req[id]) return false; return true; }
  function missing(S, req) { const out = []; for (const id in req) { const h = invCount(S, id); if (h < req[id]) out.push(D.ING[id].name + '×' + (req[id] - h)); } return out; }
  function takeAll(S, req) { if (!hasAll(S, req)) return -1; let c = 0; for (const id in req) c += invTake(S, id, req[id]); return c; }
  function expSoon(S, id) { const l = S.inv[id]; if (!l || !l.length) return null; return l[0][1] === 9999 ? null : l[0][1] - S.day; }

  // ===================== レシピ =====================
  function recipe(S, rid) { return D.RECIPES[rid] || (S.originals && S.originals[rid]) || null; }
  function recipeTags(r) {
    const t = D.BASES[r.base].tags.slice();
    if (r.cream && r.cream !== 'none') t.push(...D.CREAMS[r.cream].tags);
    for (const k in r.tops || {}) t.push(D.TOPS[k].tag);
    return t;
  }
  function pairScore(tags) {
    const u = [...new Set(tags)]; let s = 0;
    for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) s += D.PAIR[u[i] + '|' + u[j]] || 0;
    return s;
  }
  function stars(r) {
    if (r.stars) return r.stars;
    const nt = Object.keys(r.tops || {}).length;
    let s = 2.3 + pairScore(recipeTags(r)) * 0.6 + nt * 0.2 + (r.cream === 'none' ? -0.2 : 0);
    if (D.RECIPES[r.key || ''] || r.value) s += 0.4;
    return clamp(Math.round(s * 2) / 2, 1, 5);
  }
  function recipeValue(r) { return r.value || 400; }
  function comboKey(base, cream, tops) { return base + '|' + (cream || 'none') + '|' + Object.keys(tops || {}).filter((k) => tops[k] > 0).sort().join('+'); }
  function findRecipeByCombo(base, cream, tops) {
    const k = comboKey(base, cream, tops);
    for (const id in D.RECIPES) { const r = D.RECIPES[id]; if (comboKey(r.base, r.cream, r.tops) === k) return id; }
    return null;
  }
  function addKnown(S, rid) {
    S.known[rid] = 1;
    if (!S.menu[rid]) { const r = recipe(S, rid); S.menu[rid] = { price: round10(recipeValue(r) * 0.9), on: true }; }
  }
  function costEstimate(S, r) {
    const m = S.market; let c = 0;
    const b = D.BASES[r.base]; for (const id in b.ing) c += b.ing[id] * m[id];
    if (r.cream && r.cream !== 'none') { let cc = 0; const cr = D.CREAMS[r.cream]; for (const id in cr.ing) cc += cr.ing[id] * m[id]; c += cc / D.CREAM_YIELD; }
    for (const id in r.tops || {}) c += r.tops[id] * m[id];
    return Math.round(c);
  }

  // ===================== 需要モデル =====================
  function wtp(S, r, q, ct, noise) {
    let v = recipeValue(r) * (0.5 + 0.75 * q) * ct.budget * (0.88 + 0.05 * S.rep);
    const tags = recipeTags(r);
    if (tags.some((t) => ct.likes.includes(t))) v *= 1.18;
    if (ct.picky > 0.6 && q < 0.65) v *= 0.6;
    v *= 1 + 0.03 * (S.up.interior || 0);
    return v * (noise || 1);
  }
  // 価格に対して、お客さんのうち何割が買ってくれそうか (メニュー画面の予想表示用)
  function demandEstimate(S, rid, price, q) {
    const r = recipe(S, rid); if (!r) return 0;
    let tot = 0, ok = 0;
    for (const ct of D.CUSTOMERS) for (let i = -2; i <= 2; i++) { const n = Math.exp(i * 0.15); tot += ct.w; if (wtp(S, r, q, ct, n) >= price) ok += ct.w; }
    return ok / tot;
  }
  function arrivalRate(S, hourIdx) {
    const np = clamp(S.np || 1, 1, 4);
    const players = [0, 0.55, 0.75, 0.9, 1.0][np];
    const rep = 0.45 + 0.2 * S.rep;
    const attract = 1 + (S.up.sign ? 0.1 : 0) + 0.12 * (S.up.interior || 0) + 0.08 * (S.up.floor || 0) + 0.02 * (S.furn.plant || 0);
    const w = (D.WEATHER.find((x) => x.id === S.weather) || D.WEATHER[0]).mult;
    const dow = D.DOW_MULT[(S.day - 1) % 7];
    const ad = (D.ADS[S.ad] || D.ADS.none).mult;
    const kinds = new Set(S.showcase.filter((c) => c && c.p > 0).map((c) => c.r)).size;
    const variety = 1 + Math.min(0.2, Math.max(0, kinds - 1) * 0.05);
    return 6.2 * players * rep * attract * w * dow * ad * variety * D.HOUR_CURVE[clamp(hourIdx, 0, 9)];
  }

  // ===================== 演出イベント =====================
  function fx(S, k, x, to) {
    S.fxi = (S.fxi || 0) + 1;
    S.fx.push({ i: S.fxi, k, x: x || '', to: to || '' });
    while (S.fx.length > 16) S.fx.shift();
  }

  // ===================== 品質計算 =====================
  function bakeWindow(S, dT) { return 0.06 * (D.DIFF[S.diff] || D.DIFF.normal).win * eqv(S, 'oven').win * (Math.abs(dT || 0) >= 10 ? 0.8 : 1); }
  // 焼き加減 d（1.0 = ちょうど）と温度差 dT から品質と欠点
  function bakeQuality(S, d, dT, cold) {
    const w = bakeWindow(S, dT), df = [];
    let q, label;
    if (d < 0.7) { q = 0.2; label = '生焼け'; df.push('raw'); }
    else if (d < 1 - w) { q = Math.max(0.3, 1 - (1 - w - d) * 3.2); label = '焼きが浅い'; if (d < 0.88) df.push('raw'); }
    else if (d <= 1 + w) { q = 1; label = 'ちょうどいい！'; }
    else { q = Math.max(0.1, 1 - (d - 1 - w) * 3.2); label = d >= 1.18 ? '焦げた' : '焼きすぎ'; if (d >= 1.18) df.push('burnt'); }
    if (dT >= 20) { df.push('crust'); q *= 0.85; } else if (dT >= 10) q *= 0.94;
    if (dT <= -20) { df.push('dry', 'flat'); q *= 0.8; } else if (dT <= -10) { df.push('dry'); q *= 0.9; }
    if (cold) { df.push('flat'); q *= 0.8; }
    return { q: clamp(q, 0, 1), label, df: cleanDf(df) };
  }
  function ovenDur(S, base, temp, cold) {
    const B = D.BASES[base], dT = (temp || B.temp) - B.temp;
    return B.bake * 1000 * eqv(S, 'oven').speed * clamp(1 - dT * 0.012, 0.6, 1.5) * (cold ? 1.15 : 1);
  }
  function coolMs(S) { return R.COOL_MS * eqv(S, 'cooler').cool; }

  // ===================== アクション =====================
  // a = { t: 種類, by: 端末ID, pid: プレイヤーID, ... }   戻り値 { ok, msg }
  function apply(S, a, now) {
    const f = ACT[a.t];
    if (!f) return { ok: false, msg: '不明な操作' };
    if (S.bankrupt && a.t !== 'reset') return { ok: false, msg: 'お店は倒産しました' };
    try { return f(S, a, now) || { ok: true }; } catch (e) { return { ok: false, msg: 'エラー: ' + e.message }; }
  }
  const working = (S) => S.phase === 'prep' || S.phase === 'open';
  const ACT = {
    start(S, a, now) { if (S.phase !== 'lobby') return { ok: false }; S.phase = 'prep'; S.phaseAt = now; fx(S, 'phase', '開店準備スタート！'); return { ok: true }; },
    open(S, a, now) { if (S.phase !== 'prep') return { ok: false }; openShop(S, now); return { ok: true }; },
    next(S, a, now) { if (S.phase !== 'report') return { ok: false }; nextDay(S, now); return { ok: true }; },

    buy(S, a) {
      const ing = D.ING[a.id]; const n = Math.floor(a.n);
      if (!ing || !(n > 0 && n <= 99)) return { ok: false, msg: '数量が不正です' };
      const unit = S.market[a.id] * (n >= 10 ? 0.95 : 1);
      const cost = Math.round(unit * n);
      if (S.funds < cost) return { ok: false, msg: '資金が足りません' };
      S.funds -= cost; S.today.buy += cost;
      invAdd(S, a.id, n, Math.round(unit));
      return { ok: true, msg: ing.name + '×' + n + ' を仕入れた（¥' + cost.toLocaleString() + '）' };
    },
    mix(S, a) {
      if (!working(S)) return { ok: false, msg: '営業時間外です' };
      const b = D.BASES[a.base]; if (!b) return { ok: false, msg: '生地が不明' };
      const cost = takeAll(S, b.ing);
      if (cost < 0) return { ok: false, msg: '材料が足りなかった…（' + missing(S, b.ing).join('、') + '）' };
      const id = uid(S, 'm');
      S.batters[id] = { k: a.base, q: clamp(+a.q || 0, 0, 1), c: cost, by: a.pid || '', df: cleanDf(a.df) };
      return { ok: true, msg: b.short + '生地ができた（品質' + Math.round(S.batters[id].q * 100) + '）' };
    },
    ovenHeat(S, a, now) {
      const o = S.ovens[a.slot]; if (!o) return { ok: false };
      if (o.s) return { ok: false, msg: '焼いている間は温度を変えられません' };
      const t = D.OVEN_TEMPS.indexOf(+a.temp) >= 0 ? +a.temp : 170;
      if (o.h && o.temp === t) return { ok: true, msg: t + '℃ で予熱済みです' };
      S.ovens[a.slot] = { s: 0, h: 1, temp: t, hot: now + D.PREHEAT_MS * (o.h ? 0.5 : 1) * (eqv(S, 'oven').heat || 1) };
      fx(S, 'info', 'オーブン' + (a.slot + 1) + 'を' + t + '℃ に予熱中…');
      return { ok: true };
    },
    ovenIn(S, a, now) {
      const o = S.ovens[a.slot]; const b = S.batters[a.id];
      if (!o || o.s) return { ok: false, msg: 'そのオーブンは使用中です' };
      if (!b) return { ok: false, msg: 'その生地はもうありません' };
      const B = D.BASES[b.k];
      const temp = o.h ? o.temp : 170;
      const cold = !o.h || now < (o.hot || 0);
      delete S.batters[a.id];
      S.ovens[a.slot] = { s: 1, h: 1, temp, hot: o.hot || now, k: b.k, q: b.q, c: b.c, t0: now, dur: ovenDur(S, b.k, temp, cold), cold: cold ? 1 : 0, dT: temp - B.temp, df: b.df || [], by: a.pid || '' };
      fx(S, cold ? 'err' : 'oven', cold ? '予熱が終わる前に入れた！ふくらみが悪くなりそう…' : B.short + 'を' + temp + '℃ で焼きはじめた');
      return { ok: true };
    },
    ovenOut(S, a, now) {
      const o = S.ovens[a.slot];
      if (!o || !o.s) return { ok: false, msg: 'オーブンは空です' };
      const d = (now - o.t0) / o.dur;
      const bq = bakeQuality(S, d, o.dT || 0, !!o.cold);
      S.ovens[a.slot] = { s: 0, h: 1, temp: o.temp, hot: o.hot || now };
      const id = uid(S, 'b');
      S.bases[id] = { k: o.k, q: clamp(o.q * 0.4 + bq.q * 0.6 + (eqv(S, 'oven').qb || 0), 0, 1), c: o.c, cool: now + coolMs(S), day: S.day, df: union(o.df, bq.df) };
      const bad = bq.df.length;
      fx(S, bad ? 'fail' : bq.q >= 1 ? 'good' : 'info', D.BASES[o.k].short + '：' + bq.label + (bad ? '（' + bq.df.map((x) => D.DEFECTS[x].name).join('・') + '）' : ''), '');
      return { ok: true };
    },
    whip(S, a) {
      if (!working(S)) return { ok: false, msg: '営業時間外です' };
      const c = D.CREAMS[a.cream]; if (!c || a.cream === 'none') return { ok: false, msg: 'クリームが不明' };
      const cost = takeAll(S, c.ing);
      if (cost < 0) return { ok: false, msg: '材料が足りなかった…（' + missing(S, c.ing).join('、') + '）' };
      const id = uid(S, 'c');
      S.creams[id] = { k: a.cream, q: clamp(+a.q || 0, 0, 1), n: D.CREAM_YIELD, c: cost / D.CREAM_YIELD, day: S.day, df: cleanDf(a.df) };
      return { ok: true, msg: c.short + 'クリームができた！（' + D.CREAM_YIELD + '台分）' };
    },
    deco(S, a, now) {
      if (!working(S)) return { ok: false, msg: '営業時間外です' };
      const r = recipe(S, a.r); if (!r || !S.known[a.r]) return { ok: false, msg: 'レシピが不明' };
      const b = S.bases[a.base];
      if (!b || b.k !== r.base) return { ok: false, msg: 'スポンジが見つかりません（だれかが先に使ったかも）' };
      let cr = null;
      if (r.cream !== 'none') { cr = S.creams[a.cream]; if (!cr || cr.k !== r.cream || cr.n < 1) return { ok: false, msg: 'クリームが見つかりません' }; }
      if (!hasAll(S, r.tops)) return { ok: false, msg: 'トッピングが足りない（' + missing(S, r.tops).join('、') + '）' };
      const tc = takeAll(S, r.tops);
      delete S.bases[a.base];
      let cost = b.c + tc;
      let cq = 1;
      if (cr) { cost += cr.c; cq = cr.q; cr.n -= 1; if (cr.n <= 0) delete S.creams[a.cream]; }
      const warm = now < b.cool;
      let q = b.q * 0.35 + cq * 0.25 + clamp(+a.q || 0, 0, 1) * 0.4;
      if (warm) q *= 0.7;
      q = clamp(q, 0, 1);
      const df = union(b.df, cr ? cr.df : [], cleanDf(a.df), warm && cr ? ['melt'] : []);
      const pc = pieceCount(r); const cake = { r: a.r, q, p: pc, n: pc, c: Math.round(cost), d: S.day, o: 0, df };
      placeCake(S, cake);
      fx(S, df.length ? 'fail' : 'cake', r.name + ' 完成（品質' + Math.round(q * 100) + '）' + (df.length ? '　欠点：' + df.map((x) => D.DEFECTS[x].name).join('・') : ''));
      return { ok: true, msg: (warm ? 'スポンジが温かくてクリームが溶けた…　' : '') + r.name + 'が完成！' };
    },
    buyEq(S, a) {
      const E = D.EQUIP[a.kind]; if (!E) return { ok: false };
      const cur = (S.eq[a.kind] || 0), t = E.tiers[cur + 1];
      if (!t) return { ok: false, msg: 'これが最上位の機種です' };
      if (shopLevel(S).lv < t.lv) return { ok: false, msg: '店舗レベル ' + t.lv + ' で買えるようになります' };
      if (S.funds < t.price) return { ok: false, msg: '資金が足りません' };
      S.funds -= t.price; S.today.capex = (S.today.capex || 0) + t.price; S.eq[a.kind] = cur + 1;
      fx(S, 'up', t.name + ' を導入！');
      return { ok: true };
    },
    buyFurn(S, a) {
      const f = D.FURN[a.id]; if (!f) return { ok: false };
      const n = S.furn[a.id] || 0;
      if (shopLevel(S).lv < f.lv) return { ok: false, msg: '店舗レベル ' + f.lv + ' で買えるようになります' };
      if (n >= furnMax(S, a.id)) return { ok: false, msg: 'これ以上置けません（増床すると置ける数が増えます）' };
      if (S.funds < f.price) return { ok: false, msg: '資金が足りません' };
      S.funds -= f.price; S.today.capex = (S.today.capex || 0) + f.price; S.furn[a.id] = n + 1;
      fx(S, 'up', f.name + ' を置いた！');
      return { ok: true };
    },
    hire(S, a) {
      const sl = D.STAFF.slots[a.slot]; if (!sl) return { ok: false };
      if (shopLevel(S).lv < sl.lv) return { ok: false, msg: '店舗レベル ' + sl.lv + ' で雇えるようになります' };
      if (S.staff[a.slot]) return { ok: false, msg: 'もう雇っています' };
      S.staff[a.slot] = { name: sl.name, lv: sl.start, xp: D.STAFF.xp[sl.start - 1], task: ['mix', 'bake', 'deco', 'whip'][a.slot] || 'mix', opt: '', skin: sl.skin, days: 0 };
      fx(S, 'info', sl.name + ' さんがアルバイトに来てくれた！');
      return { ok: true };
    },
    fire(S, a) { const st = S.staff[a.slot]; if (!st) return { ok: false }; S.staff[a.slot] = 0; fx(S, 'info', st.name + ' さんとお別れした'); return { ok: true }; },
    staffTask(S, a) {
      const st = S.staff[a.slot]; if (!st || !D.STAFF.tasks[a.task]) return { ok: false };
      if (st.task !== a.task) st.job = null;
      st.task = a.task; st.opt = String(a.opt || ''); st.wait = 0;
      return { ok: true };
    },
    discard(S, a) {
      let c = 0;
      if (a.kind === 'batter' && S.batters[a.id]) { c = S.batters[a.id].c; delete S.batters[a.id]; }
      else if (a.kind === 'base' && S.bases[a.id]) { c = S.bases[a.id].c; delete S.bases[a.id]; }
      else if (a.kind === 'cream' && S.creams[a.id]) { c = S.creams[a.id].c * S.creams[a.id].n; delete S.creams[a.id]; }
      else if (a.kind === 'case' && S.showcase[a.slot]) { const k = S.showcase[a.slot]; c = (k.c / kN(k)) * k.p; S.showcase[a.slot] = 0; fillCase(S); }
      else if (a.kind === 'stock' && S.stock[a.id]) { const k = S.stock[a.id]; c = (k.c / kN(k)) * k.p; delete S.stock[a.id]; }
      else return { ok: false, msg: 'もうありません' };
      S.today.waste += Math.round(c);
      return { ok: true, msg: '廃棄しました' };
    },
    price(S, a) {
      if (!S.menu[a.r]) return { ok: false };
      const p = clamp(round10(+a.price || 0), 100, 3000);
      S.menu[a.r].price = p; return { ok: true };
    },
    menuOn(S, a) { if (!S.menu[a.r]) return { ok: false }; S.menu[a.r].on = !!a.on; fillCase(S); return { ok: true }; },
    upgrade(S, a) {
      const u = D.UPGRADES.find((x) => x.id === a.id); if (!u) return { ok: false };
      const lv = S.up[u.id] || 0;
      if (lv >= u.levels.length) return { ok: false, msg: 'これ以上は拡張できません' };
      const cost = u.levels[lv], need = upReq(u, lv);
      if (shopLevel(S).lv < need) return { ok: false, msg: '店舗レベル ' + need + ' で解放されます' };
      if (S.funds < cost) return { ok: false, msg: '資金が足りません' };
      S.funds -= cost; S.up[u.id] = lv + 1;
      S.today.capex = (S.today.capex || 0) + cost;
      if (u.id === 'oven') while (S.ovens.length < upVal('oven', lv + 1)) S.ovens.push({ s: 0 });
      if (u.id === 'showcase') { while (S.showcase.length < upVal('showcase', lv + 1)) S.showcase.push(0); fillCase(S); }
      fx(S, 'up', u.name + (u.levels.length > 1 ? ' Lv' + (lv + 1) : '') + ' を導入！');
      return { ok: true };
    },
    ad(S, a) {
      if (S.phase !== 'prep') return { ok: false, msg: '広告は開店準備中に出せます' };
      const ad = D.ADS[a.kind]; if (!ad) return { ok: false };
      const prev = D.ADS[S.ad] || D.ADS.none;
      const diff = ad.cost - prev.cost;
      if (diff > 0 && S.funds < diff) return { ok: false, msg: '資金が足りません' };
      S.funds -= diff; S.today.ads += diff; S.ad = a.kind;
      if (a.kind !== 'none') fx(S, 'info', ad.name + 'を実施！今日は来店数アップ');
      return { ok: true };
    },
    research(S, a) {
      const b = D.BASES[a.base], c = D.CREAMS[a.cream || 'none'];
      if (!b || !c) return { ok: false, msg: '組み合わせが不正' };
      const tops = {}; let total = 0;
      for (const k in a.tops || {}) { const n = clamp(Math.floor(a.tops[k]), 0, 3); if (D.TOPS[k] && n > 0) { tops[k] = n; total += n; } }
      if (Object.keys(tops).length > 3 || total > 5) return { ok: false, msg: 'トッピングは3種類・5個まで' };
      const r = { base: a.base, cream: a.cream || 'none', tops };
      const cost = Math.round(costEstimate(S, r) * (S.up.lab ? 0.5 : 1));
      if (S.funds < cost) return { ok: false, msg: '資金が足りません' };
      S.funds -= cost; S.today.lab = (S.today.lab || 0) + cost;
      const key = comboKey(r.base, r.cream, tops);
      const found = findRecipeByCombo(r.base, r.cream, tops);
      if (found && (D.RECIPES[found].lv || 1) > shopLevel(S).lv) return { ok: true, msg: 'これは「' + D.RECIPES[found].name + '」…でも店舗レベル ' + D.RECIPES[found].lv + ' になるまで販売できない', key, stars: stars(r) };
      if (found) {
        if (S.known[found]) return { ok: true, msg: 'これは「' + D.RECIPES[found].name + '」だ！（もう知ってるレシピ）', found };
        addKnown(S, found);
        fx(S, 'discover', '新レシピ発見！「' + D.RECIPES[found].name + '」');
        return { ok: true, msg: '新レシピ発見！', found };
      }
      const st = stars(r);
      S.tested[key] = st;
      return { ok: true, msg: '試作の評価：★' + st, key, stars: st };
    },
    register(S, a) {
      const st = S.tested[a.key];
      if (!st) return { ok: false, msg: '先に試作してください' };
      if (Object.keys(S.originals).length >= R.MAX_ORIGINALS) return { ok: false, msg: 'オリジナルは' + R.MAX_ORIGINALS + '種類までです' };
      const parts = a.key.split('|'); const tops = {};
      (parts[2] ? parts[2].split('+') : []).forEach((k) => { tops[k] = clamp(Math.floor((a.tops && a.tops[k]) || 1), 1, 3); });
      const name = String(a.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'オリジナルケーキ';
      const value = round10(260 + st * 70 + Object.values(tops).reduce((x, y) => x + y, 0) * 25);
      const id = uid(S, 'o');
      S.originals[id] = { name, base: parts[0], cream: parts[1], tops, value, stars: st, orig: 1 };
      addKnown(S, id);
      fx(S, 'discover', 'オリジナル「' + name + '」をメニューに追加！');
      return { ok: true };
    },
    unregister(S, a) {
      if (!S.originals[a.r]) return { ok: false };
      delete S.originals[a.r]; delete S.menu[a.r]; delete S.known[a.r];
      S.showcase = S.showcase.map((c) => (c && c.r === a.r ? 0 : c));
      for (const id in S.stock) if (S.stock[id].r === a.r) delete S.stock[id];
      fillCase(S);
      return { ok: true };
    },
    reset(S) { const fresh = newState({ name: S.name, diff: S.diff }); Object.keys(S).forEach((k) => delete S[k]); Object.assign(S, fresh); return { ok: true }; },
  };

  const df0 = (k) => (k.df || []).length > 0;
  function placeCake(S, cake) {
    const i = S.showcase.findIndex((c) => !c);
    if (i >= 0 && S.menu[cake.r] && S.menu[cake.r].on) S.showcase[i] = cake;
    else S.stock[uid(S, 'k')] = cake;
  }
  function fillCase(S) {
    // 販売OFFのケーキはバックヤードへ
    S.showcase.forEach((c, i) => { if (c && (!S.menu[c.r] || !S.menu[c.r].on)) { S.stock[uid(S, 'k')] = c; S.showcase[i] = 0; } });
    const ids = Object.keys(S.stock).filter((id) => S.menu[S.stock[id].r] && S.menu[S.stock[id].r].on).sort((a, b) => S.stock[b].q - S.stock[a].q);
    for (const id of ids) {
      const i = S.showcase.findIndex((c) => !c);
      if (i < 0) break;
      S.showcase[i] = S.stock[id]; delete S.stock[id];
    }
  }

  // ===================== 営業 =====================
  // ===================== アルバイト =====================
  const staffQ = (lv) => clamp(0.48 + 0.048 * lv + gauss() * 0.05, 0.3, 0.99);
  const staffDf = (lv, kinds) => (Math.random() < 0.2 - 0.02 * lv ? [pick(kinds)] : []);
  function menuRecipes(S) { return Object.keys(S.menu).filter((rid) => S.menu[rid].on && S.known[rid] && recipe(S, rid)); }
  function staffTick(S, now) {
    if (!working(S) || !S.staff) return;
    S.staff.forEach((st, slot) => {
      if (!st) return;
      const sp = D.STAFF.speed[st.lv - 1] || 0.2;
      const dur = (k) => ((D.STAFF.jobSec[k] || 10) * 1000) / sp * (k === 'mix' ? eqv(S, 'mixer').fast || 1 : 1);
      if (st.job) { if (now >= st.job.end) finishJob(S, st, slot, now); return; }
      if (st.wait && now < st.wait) return;
      st.wait = now + 1200;
      const job = (o) => { st.job = Object.assign(o, { t0: now }); };
      const recs = menuRecipes(S).map((rid) => [rid, recipe(S, rid)]);
      if (st.task === 'mix') {
        if (Object.keys(S.batters).length >= Math.max(1, S.ovens.length)) return;
        let base = D.BASES[st.opt] ? st.opt : null;
        if (!base) { const need = {}; recs.forEach(([, r]) => (need[r.base] = 0)); for (const id in S.bases) if (id in need) need[S.bases[id].k]++; let best = 1e9; for (const k in need) { const n = (need[k] || 0) + Object.values(S.batters).filter((b) => b.k === k).length; if (n < best && hasAll(S, D.BASES[k].ing)) { best = n; base = k; } } }
        if (!base || !hasAll(S, D.BASES[base].ing)) return;
        const cost = takeAll(S, D.BASES[base].ing);
        job({ k: 'mix', base, cost, end: now + dur('mix') });
      } else if (st.task === 'bake') {
        const err = Math.max(0.02, 0.22 - 0.022 * st.lv);
        for (let i = 0; i < S.ovens.length; i++) {
          const o = S.ovens[i]; if (!o.s) continue;
          if (o.tg == null) o.tg = 1 + gauss() * err;
          const d = (now - o.t0) / o.dur;
          if (d >= o.tg - dur('out') / o.dur) return job({ k: 'out', slot: i, end: now + dur('out') });
        }
        const bid = Object.keys(S.batters).sort()[0];
        if (!bid) return;
        const B = D.BASES[S.batters[bid].k], i = S.ovens.findIndex((o) => !o.s);
        if (i < 0) return;
        const o = S.ovens[i];
        if (!o.h || o.temp !== B.temp) { ACT.ovenHeat(S, { slot: i, temp: B.temp }, now); st.wait = now + 2500; return; }
        if (now >= (o.hot || 0) || (st.lv <= 2 && Math.random() < 0.08)) job({ k: 'in', slot: i, id: bid, end: now + dur('in') });
      } else if (st.task === 'whip') {
        let cream = D.CREAMS[st.opt] && st.opt !== 'none' ? st.opt : null;
        const have = (k) => Object.values(S.creams).filter((c) => c.k === k).reduce((a, c) => a + c.n, 0);
        if (!cream) { let best = 1e9; recs.forEach(([, r]) => { if (r.cream !== 'none' && have(r.cream) < best && hasAll(S, D.CREAMS[r.cream].ing)) { best = have(r.cream); cream = r.cream; } }); }
        if (!cream || have(cream) >= 2 || !hasAll(S, D.CREAMS[cream].ing)) return;
        const cost = takeAll(S, D.CREAMS[cream].ing);
        job({ k: 'whip', cream, cost, end: now + dur('whip') });
      } else if (st.task === 'deco') {
        const made = S.showcase.filter((c) => c).length + Object.keys(S.stock).length;
        if (made >= S.showcase.length + 2) return;
        const cand = (st.opt && S.known[st.opt] ? [[st.opt, recipe(S, st.opt)]] : recs).sort((a, b) => S.showcase.filter((c) => c && c.r === a[0]).length - S.showcase.filter((c) => c && c.r === b[0]).length);
        for (const [rid, r] of cand) {
          const bid = Object.keys(S.bases).filter((id) => S.bases[id].k === r.base && now >= S.bases[id].cool).sort((x, y) => (S.bases[x].df || []).length - (S.bases[y].df || []).length)[0];
          if (!bid) continue;
          const cid = r.cream === 'none' ? null : Object.keys(S.creams).find((id) => S.creams[id].k === r.cream && S.creams[id].n > 0);
          if (r.cream !== 'none' && !cid) continue;
          if (!hasAll(S, r.tops)) continue;
          const b = S.bases[bid]; delete S.bases[bid];
          let cr = null; if (cid) { const c = S.creams[cid]; cr = { q: c.q, c: c.c, df: c.df || [] }; c.n -= 1; if (c.n <= 0) delete S.creams[cid]; }
          const tc = takeAll(S, r.tops);
          return job({ k: 'deco', r: rid, b, cr, tc, end: now + dur('deco') });
        }
      } else if (st.task === 'stock') {
        if (S.funds < 8000) return;
        const need = {};
        recs.forEach(([, r]) => { [D.BASES[r.base].ing, r.cream !== 'none' ? D.CREAMS[r.cream].ing : {}, r.tops || {}].forEach((g) => { for (const k in g) need[k] = Math.max(need[k] || 0, g[k]); }); });
        const id = Object.keys(need).find((k) => invCount(S, k) < need[k] * 2 + 2);
        if (id) job({ k: 'stock', id, end: now + dur('stock') });
      }
    });
  }
  function finishJob(S, st, slot, now) {
    const j = st.job; st.job = null;
    let ok = true;
    if (j.k === 'mix') { const id = uid(S, 'm'); S.batters[id] = { k: j.base, q: staffQ(st.lv), c: j.cost, by: 'staff' + slot, df: staffDf(st.lv, ['lump', 'weight', 'flat']) }; }
    else if (j.k === 'whip') { const id = uid(S, 'c'); S.creams[id] = { k: j.cream, q: staffQ(st.lv), n: D.CREAM_YIELD, c: j.cost / D.CREAM_YIELD, day: S.day, df: staffDf(st.lv, ['soft', 'sep']) }; }
    else if (j.k === 'in') { const o = S.ovens[j.slot]; ok = !!(o && !o.s && S.batters[j.id]); if (ok) ACT.ovenIn(S, { slot: j.slot, id: j.id, pid: 'staff' + slot }, now); }
    else if (j.k === 'out') { const o = S.ovens[j.slot]; ok = !!(o && o.s); if (ok) ACT.ovenOut(S, { slot: j.slot }, now); }
    else if (j.k === 'deco') {
      const r = recipe(S, j.r); if (!r) return;
      const q = clamp(j.b.q * 0.35 + (j.cr ? j.cr.q : 1) * 0.25 + staffQ(st.lv) * 0.4, 0, 1);
      const df = union(j.b.df, j.cr ? j.cr.df : [], staffDf(st.lv, r.cream === 'none' ? ['messy'] : ['messy', 'uneven', 'tilt']));
      const pc = pieceCount(r);
      placeCake(S, { r: j.r, q, p: pc, n: pc, c: Math.round(j.b.c + j.tc + (j.cr ? j.cr.c : 0)), d: S.day, o: 0, df });
      fx(S, df.length ? 'fail' : 'cake', st.name + 'が ' + r.name + ' を仕上げた（品質' + Math.round(q * 100) + '）' + (df.length ? '　欠点：' + df.map((x) => D.DEFECTS[x].name).join('・') : ''));
    } else if (j.k === 'stock') { const r = ACT.buy(S, { id: j.id, n: 6 }); ok = r && r.ok; }
    if (!ok) return;
    st.xp = (st.xp || 0) + 1; st.done = (st.done || 0) + 1;
    while (st.lv < 10 && st.xp >= D.STAFF.xp[st.lv]) { st.lv++; fx(S, 'info', st.name + ' さんが Lv' + st.lv + ' に！仕事が速くなった'); }
  }
  function openShop(S, now) {
    S.phase = 'open'; S.phaseAt = now; S.lastSpawn = now;
    fx(S, 'phase', '開店！いらっしゃいませ！');
  }
  function tick(S, now) {
    if (S.bankrupt) return;
    if (S.phase === 'prep' && now - S.phaseAt >= R.PREP_MS) openShop(S, now);
    if (S.phase === 'open') {
      const el = now - S.phaseAt;
      if (el >= R.OPEN_MS) { closeDay(S, now); return; }
      const last = S.lastSpawn || now;
      const dt = Math.min(now - last, 5000);
      S.lastSpawn = now;
      if (dt > 0) {
        const hourIdx = Math.floor((el / R.OPEN_MS) * 10);
        const expect = arrivalRate(S, hourIdx) * (dt / (R.OPEN_MS / 10));
        let n = 0; let p = Math.exp(-expect), cum = p, u = Math.random();
        while (u > cum && n < 5) { n++; p *= expect / n; cum += p; }
        for (let i = 0; i < n; i++) spawn(S, now + i * 400);
      }
    }
    staffTick(S, now);
    for (const id in S.cust) {
      const c = S.cust[id];
      if (c.st === 'walk' && now >= c.t1) decide(S, c);
      else if (c.st !== 'walk' && now >= c.t2) delete S.cust[id];
    }
  }
  function spawn(S, now) {
    if (Object.keys(S.cust).length >= MAX_IN_SHOP + 2 * (S.furn.table || 0)) { S.today.miss++; return; }
    const ct = wpick(D.CUSTOMERS);
    const id = uid(S, 'u');
    S.cust[id] = { ty: ct.id, t0: now, t1: now + DECIDE_MS, t2: now + DECIDE_MS + LEAVE_MS, st: 'walk', v: Math.floor(Math.random() * 4) };
  }
  function decide(S, c) {
    const ct = D.CUSTOMERS.find((x) => x.id === c.ty) || D.CUSTOMERS[0];
    const noise = Math.exp(gauss() * 0.15);
    let best = null, bestS = 0, anySeen = false;
    S.showcase.forEach((k, i) => {
      if (!k || k.p <= 0) return;
      const m = S.menu[k.r]; if (!m || !m.on) return;
      const r = recipe(S, k.r); if (!r) return;
      anySeen = true;
      const w = wtp(S, r, k.q, ct, noise) * appearance(k.df);
      const s = w - m.price;
      if (s > bestS) { bestS = s; best = { i, k, r, w, price: m.price }; }
    });
    S.today.cust++;
    if (!best) {
      c.st = 'miss';
      if (!anySeen) { c.say = pick(D.SAY.soldout); S.today.soldout++; rate(S, 1.8, 0.02); }
      else { c.say = pick(D.SAY.pricey); rate(S, 2.6, 0.012); }
      S.today.miss++;
      return;
    }
    let n = ct.multi ? 2 + Math.floor(Math.random() * 3) : (Math.random() < 0.22 ? 2 : 1);
    if (bestS < best.w * 0.12) n = 1;
    n = Math.min(n, best.k.p);
    best.k.p -= n;
    S.today.sales += best.price * n;
    S.funds += best.price * n;
    S.today.cogs += Math.round((best.k.c / kN(best.k)) * n);
    S.today.sold += n;
    S.today.best[best.k.r] = (S.today.best[best.k.r] || 0) + n;
    if (!df0(best.k)) addXp(S, n);
    // イートイン：空いている席があれば座って食べていく
    const seats = 2 * (S.furn.table || 0), cash = S.staff.find((x) => x && x.task === 'cashier');
    let seat = -1;
    if (seats && Math.random() < 0.5) { const used = {}; for (const id in S.cust) if (S.cust[id].seat >= 0) used[S.cust[id].seat] = 1; for (let i = 0; i < seats; i++) if (!used[i]) { seat = i; break; } }
    if (seat >= 0) {
      c.seat = seat; c.t2 = c.t1 + 1100 + 3200 + SIT_MS + LEAVE_MS;
      if (S.furn.coffee && Math.random() < 0.55 + (cash ? 0.15 + 0.01 * cash.lv : 0)) { S.today.drinks += 350; S.funds += 350; S.today.cogs += 80; c.drink = 1; }
    }
    const surplus = bestS / best.w;
    const df = best.k.df || [];
    let pen = 0, worst = null;
    df.forEach((d) => { const x = D.DEFECTS[d]; pen += x.sat * (ct.picky > 0.6 ? 1.3 : 1); if (!worst || x.sat > D.DEFECTS[worst].sat) worst = d; });
    const sat = clamp(0.35 + surplus * 1.6 + (best.k.q - 0.6) * 0.9 + 0.04 * (S.up.interior || 0) + (seat >= 0 ? 0.06 : 0) + (S.furn.speaker ? 0.03 : 0) + (cash ? 0.02 + 0.004 * cash.lv : 0) - pen, 0, 1);
    S.today.sat += sat;
    if (sat > 0.6 && !df.length) addXp(S, 1);
    // 失敗したケーキを売るとクレームになり、評判が大きく下がる
    if (df.length) {
      S.today.complaints = (S.today.complaints || 0) + 1;
      df.forEach((d) => { S.today.issues[d] = (S.today.issues[d] || 0) + 1; });
      rate(S, 1 + sat * 4, 0.07);
      if (!D.DEFECTS[worst].vis) fx(S, 'review', '口コミ ★' + Math.max(1, Math.round(1 + sat * 4)) + '「' + D.DEFECTS[worst].say + '」');
    } else rate(S, 1 + sat * 4, 0.03);
    c.st = 'buy'; c.r = best.k.r; c.n = n;
    c.say = worst && D.DEFECTS[worst].vis ? D.DEFECTS[worst].say : ct.id === 'gourmet' && best.k.q > 0.8 ? pick(D.SAY.gourmet) : sat > 0.65 ? pick(D.SAY.great) : sat > 0.4 ? pick(D.SAY.ok) : pick(D.SAY.meh);
    if (best.k.p <= 0) { S.showcase[best.i] = 0; fillCase(S); }
    fx(S, 'sale', '', '');
  }
  function rate(S, stars5, w) { S.rep = clamp(S.rep + (stars5 - S.rep) * w, 1, 5); }

  function closeDay(S, now) {
    const T = S.today;
    let waste = 0;
    const keepCold = !!S.up.coldcase;
    const ageCake = (k) => { if (!keepCold || k.o >= 1) { waste += (k.c / kN(k)) * k.p; return null; } return Object.assign({}, k, { o: (k.o || 0) + 1, q: k.q * 0.8, df: union(k.df, ['stale']) }); };
    S.showcase = S.showcase.map((k) => (k ? ageCake(k) || 0 : 0));
    for (const id in S.stock) { const k = ageCake(S.stock[id]); if (k) S.stock[id] = k; else delete S.stock[id]; }
    for (const id in S.creams) { waste += S.creams[id].c * S.creams[id].n; delete S.creams[id]; }
    for (const id in S.batters) { waste += S.batters[id].c; delete S.batters[id]; }
    S.ovens = S.ovens.map((o) => { if (o && o.s) waste += o.c; return { s: 0 }; });
    for (const id in S.bases) { const b = S.bases[id]; if (b.day < S.day) { waste += b.c; delete S.bases[id]; } else { b.q *= 0.9; } }
    for (const id in S.inv) {
      S.inv[id] = S.inv[id].filter((lot) => { if (lot[1] <= S.day) { waste += lot[0] * lot[2]; return false; } return true; });
      if (!S.inv[id].length) delete S.inv[id];
    }
    waste = Math.round(waste);
    T.waste += waste;
    let equip = 0; for (const u of D.UPGRADES) equip += S.up[u.id] || 0;
    let wages = 0; S.staff.forEach((st) => { if (st) { wages += D.STAFF.wage(st.lv); st.job = null; st.days = (st.days || 0) + 1; } });
    T.wages = wages;
    const fixed = R.RENT + (S.up.floor || 0) * (R.RENT_PER_FLOOR || 1500) + (equip + 2) * R.UTIL_PER_EQUIP + wages;
    S.funds -= fixed;
    const revenue = T.sales + T.drinks;
    const profit = revenue - T.cogs - T.waste - fixed - T.ads - (T.lab || 0);
    const satAvg = T.cust - T.miss > 0 ? T.sat / Math.max(1, T.cust - T.miss) : 0;
    let bestR = null, bestN = 0; for (const r in T.best) if (T.best[r] > bestN) { bestN = T.best[r]; bestR = r; }
    S.history.push({ cmp: T.complaints || 0, iss: Object.assign({}, T.issues || {}), d: S.day, sales: revenue, cogs: T.cogs, waste: T.waste, fixed, ads: T.ads + (T.lab || 0), profit, cust: T.cust, sold: T.sold, miss: T.miss, rep: Math.round(S.rep * 100) / 100, sat: Math.round(satAvg * 100) / 100, funds: S.funds, best: bestR || '', buy: T.buy || 0, capex: T.capex || 0, wages });
    while (S.history.length > 30) S.history.shift();
    S.cust = {};
    addXp(S, Math.round(Math.max(0, S.rep - 2) * 12));
    S.phase = 'report'; S.phaseAt = now;
    if (S.funds <= R.BANKRUPT) S.bankrupt = 1;
    fx(S, 'phase', '閉店！今日もおつかれさま');
  }
  function nextDay(S, now) {
    S.day += 1;
    genMarket(S);
    S.ad = 'none';
    S.today = blankToday();
    S.phase = 'prep'; S.phaseAt = now;
    fx(S, 'phase', S.day + '日目の開店準備スタート！');
  }

  CS.sim = {
    shopLevel, addXp, upReq, eqv, pieceCount, furnMax, unlockByLevel, newState, normalize, gt, phaseInfo, clockStr, tick, apply, recipe, recipeTags, stars, recipeValue, comboKey, findRecipeByCombo,
    costEstimate, demandEstimate, wtp, arrivalRate, invCount, hasAll, missing, expSoon, bakeQuality, bakeWindow, ovenDur, coolMs, upVal,
    DECIDE_MS, LEAVE_MS, clamp, fx, appearance, cleanDf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
