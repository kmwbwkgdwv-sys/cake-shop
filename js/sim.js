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
      market: {}, mEvent: 0,
      stock: {}, k: null, dayT: 0, v: 2,
      menu: {}, known: {}, originals: {}, tested: {},
      up: {}, eq: {}, furn: { table: 2 }, staff: [0, 0, 0, 0, 0, 0, 0, 0], ad: 'none', weather: 'sun',
      xp: 0, life: 0, today: blankToday(), history: [], cust: {}, fx: [], fxi: 0, seq: 0, np: 1, bankrupt: 0,
    };
    for (const id in D.RECIPES) if ((D.RECIPES[id].lv || 1) <= 1) addKnown(S, id);
    genMarket(S, true);
    // 最初は家具だけ（材料はなし）
    normalize(S);
    return S;
  }
  function blankToday() { return { sales: 0, drinks: 0, cogs: 0, waste: 0, ads: 0, cust: 0, sold: 0, miss: 0, soldout: 0, sat: 0, best: {}, buy: 0, complaints: 0, pcomp: 0, ship: 0, shelved: 0, spoiled: 0, expired: 0, slow: 0, issues: {} }; }
  const cleanDf = (arr) => { const out = []; (Array.isArray(arr) ? arr : []).forEach((d) => { if (D.DEFECTS[d] && out.indexOf(d) < 0) out.push(d); }); return out; };
  const union = (...arrs) => cleanDf([].concat(...arrs.map((a) => a || [])));
  // 見た目の欠点による「買いたさ」の倍率
  function appearance(df) { let m = 1; (df || []).forEach((d) => { const x = D.DEFECTS[d]; if (x && x.vis) m *= x.wtp; }); return m; }

  // Realtime Database から戻ってきたデータは空配列・空オブジェクトが消えるので整える
  function normalize(S) {
    if (!S || typeof S !== 'object') return S;
    const obj = (k) => { if (!S[k] || typeof S[k] !== 'object' || Array.isArray(S[k])) S[k] = S[k] && typeof S[k] === 'object' ? Object.assign({}, S[k]) : {}; };
    ['market', 'batters', 'bases', 'creams', 'stock', 'menu', 'known', 'originals', 'tested', 'up', 'cust', 'eq', 'furn'].forEach(obj);
    if (!S.clock) S.clock = { base: 0, at: 0, run: false };
    if (!S.today) S.today = blankToday();
    if (S.xp == null) S.xp = toArr(S.history).reduce((a, h) => a + ((h && h.sold) || 0), 0);
    if (!S.today.best) S.today.best = {};
    if (!S.today.issues) S.today.issues = {};
    ['batters', 'bases', 'creams', 'stock'].forEach((k) => { for (const id in S[k]) if (S[k][id]) S[k][id].df = toArr(S[k][id].df).filter((x) => x); });
    S.history = toArr(S.history);
    // これまでの売上の合計（ランキング用）。前のバージョンのお店は、残っている記録（最大30日）と今日の分から
    if (!(S.life >= 0)) S.life = S.history.reduce((a, h) => a + ((h && h.sales) || 0), 0) + (S.phase === 'report' ? 0 : (S.today.sales || 0) + (S.today.drinks || 0)); // 閉店後の報告中は、今日の分はもう記録に入っている
    S.fx = toArr(S.fx);
    for (const id in S.originals) { const o = S.originals[id]; if (!o.tops) o.tops = {}; }
    for (const id in S.menu) holeDefault(S, id);
    // 旧データの設備を新しい「設備・家具」に移す
    const U = S.up;
    if (U.proOven && !S.eq.oven) S.eq.oven = 2; if (U.mixer && !S.eq.mixer) S.eq.mixer = 1; if (U.cooler && !S.eq.cooler) S.eq.cooler = 1; if (U.fridge && !S.eq.fridge) S.eq.fridge = 1;
    if (U.eatin && !S.furn.table) { S.furn.table = 3; S.furn.coffee = 1; }
    delete U.proOven; delete U.mixer; delete U.cooler; delete U.fridge; delete U.eatin;
    S.staff = toArr(S.staff, 8).slice(0, 8).map((x) => (x && typeof x === 'object' ? x : 0));
    S.staff.forEach((x, i) => { if (x && !(x.sp > 0)) x.sp = (D.STAFF.slots[i] || {}).sp || 1; });
    unlockByLevel(S);
    for (const id in D.ING) if (!(S.market[id] > 0)) S.market[id] = D.ING[id].price;
    if (!S.cmk || typeof S.cmk !== 'object' || !Object.keys(S.cmk).length) { const m0 = S.market, w0 = S.weather, e0 = S.mEvent; genMarket(S, true); if (m0 && Object.keys(m0).length) S.market = m0; S.weather = w0 || 'sun'; S.mEvent = e0 || 0; }
    S.ak = toArr(S.ak).filter((x) => typeof x === 'string').slice(-80);
    if (CS.kitchen) CS.kitchen.normalize(S);
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
  // お店のレベルが上がるほど、お客さんが来るペースと1人あたりの注文が増える
  function rush(S) {
    const lv = shopLevel(S).lv;
    return { lv, rate: 0.8 + 0.12 * (lv - 1), size: lv >= 7 ? 2 : lv >= 4 ? 1 : 0, cap: Math.floor((lv - 1) / 2) };
  }
  function addXp(S, n) {
    const before = shopLevel(S).lv;
    S.xp = (S.xp || 0) + n;
    const after = shopLevel(S).lv;
    if (after > before) {
      const ing0 = unlockedIngs(S);
      const items = unlockByLevel(S);
      const newIng = Object.keys(unlockedIngs(S)).filter((k) => !ing0[k]).map((k) => D.ING[k].name);
      const ups = D.UPGRADES.filter((u) => !u.hide && (u.req || []).some((r, i) => r === after && (S.up[u.id] || 0) <= i)).map((u) => u.name);
      for (const k in D.EQUIP) D.EQUIP[k].tiers.forEach((t) => { if (t.lv === after && t.price) ups.push(t.name); });
      for (const k in D.FURN) if (D.FURN[k].lv === after) ups.push(D.FURN[k].name);
      if (CS.plan) for (const k in CS.plan.KINDS) if (CS.plan.KINDS[k].lv === after) ups.push(CS.plan.KINDS[k].name);
      const st = D.STAFF.slots.filter((x) => x.lv === after).length;
      const parts = [];
      if (items.length) parts.push('新商品「' + items.join('」「') + '」');
      if (ups.length) parts.push('「' + ups.join('」「') + '」');
      if (st) parts.push('アルバイト枠 +1');
      if (newIng.length) parts.push('材料「' + newIng.join('」「') + '」');
      fx(S, 'up', 'お店のレベルが Lv' + after + ' に上がった！' + (parts.length ? ' ' + parts.join('・') + ' が解放。' : '') + ' お客さんの数 ×' + rush(S).rate.toFixed(2) + (rush(S).size > rush({ xp: T_XP(after - 1) }).size ? '・まとめ買いが増えます' : ''));
    }
  }
  const T_XP = (lv) => D.SHOP_XP[Math.max(0, lv - 1)] || 0;
  function upReq(u, lv) { return (u.req || [])[lv] || 1; }
  // 材料の解放：作れる（解放済みの）お菓子に使う材料だけ買える。ケーキの箱はいつでも
  function recipeIngs(r) { const out = []; if (!r) return out; const B = D.BASES[r.base], C = D.CREAMS[r.cream || 'none']; [B && B.ing, C && C.ing, r.tops].forEach((g) => { for (const k in g || {}) out.push(k); }); return out; }
  function unlockedIngs(S) {
    const u = { box: 1 };
    for (const rid in S.known || {}) if (S.known[rid]) recipeIngs(recipe(S, rid)).forEach((k) => (u[k] = 1));
    return u;
  }
  function ingUnlocked(S, id) { return !!unlockedIngs(S)[id]; }
  // その材料が解放されるお菓子（いちばん早いレベル）
  function ingUnlockBy(id) { let best = null; for (const rid in D.RECIPES) { const r = D.RECIPES[rid]; if (recipeIngs(r).includes(id) && (!best || (r.lv || 1) < (best.lv || 1))) best = Object.assign({ id: rid }, r); } return best; }
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
    const el = (S.dayT || 0) + (S.phase === 'open' ? clamp(t - (S.dayAt || t), 0, 3000) : 0);
    const f = clamp(el / R.OPEN_MS, 0, 1);
    if (S.phase === 'prep') return { phase: 'prep', label: 'CLOSE', f, min: 600 + f * 600, left: R.OPEN_MS - el };
    if (S.phase === 'open') return { phase: 'open', label: 'OPEN', f, min: 600 + f * 600, left: R.OPEN_MS - el };
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
    // ケーキの相場（毎日変わる）
    const cm = {}; S.cEvent = 0;
    const rids = Object.keys(D.RECIPES).concat(Object.keys(S.originals || {}));
    rids.forEach((rid) => {
      const r = recipe(S, rid); if (!r) return;
      const base = recipeValue(r), prev = (S.cmk && S.cmk[rid]) || base;
      let p = first ? base : prev * (1 + (Math.random() - 0.5) * 0.16);
      p += (base - p) * 0.3;
      cm[rid] = Math.round(clamp(p, base * 0.75, base * 1.35) / 10) * 10;
    });
    if (!first && Math.random() < 0.4) { const rid = pick(rids.filter((x) => S.known && S.known[x]).concat(['short'])); if (cm[rid]) { const up = Math.random() < 0.6; cm[rid] = Math.round((cm[rid] * (up ? 1.2 : 0.85)) / 10) * 10; S.cEvent = { r: rid, up: up ? 1 : 0 }; } }
    S.cmk = cm;
    S.weather = first ? 'sun' : wpick(D.WEATHER).id;
  }

  // ===================== 在庫 =====================
  // 在庫は棚・机に置いた材料の山（厨房のしくみ側で数える）
  function invCount(S, id) { return CS.kitchen.invCount(S, id); }
  function invAdd(S, id, n, unitCost, half) { return CS.kitchen.invAdd(S, id, n, unitCost, half); }
  function invTake(S, id, n) { return CS.kitchen.invTake(S, id, n); }
  function hasAll(S, req) { for (const id in req) if (invCount(S, id) < req[id]) return false; return true; }
  function missing(S, req) { const out = []; for (const id in req) { const h = invCount(S, id); if (h < req[id]) out.push(D.ING[id].name + '×' + (req[id] - h)); } return out; }
  function takeAll(S, req) { if (!hasAll(S, req)) return -1; let c = 0; for (const id in req) c += invTake(S, id, req[id]); return c; }
  function expSoon(S, id) { return CS.kitchen.expSoon(S, id); }

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
    holeDefault(S, rid);
  }
  // ホール売り：切っていない1台。焼き菓子（袋・個で売る物）はホールなし
  function wholeable(r) { return !!r && !r.pieces && !(D.BASES[r.base] || {}).cookie; }
  function holeMarket(S, rid, r) { r = r || recipe(S, rid); return round10(cakeMarket(S, rid, r) * pieceCount(r) * (R.HOLE_K || 0.9)); }
  function holeWtp(S, r, q, ct, noise, rid) { return wtp(S, r, q, ct, noise, rid) * pieceCount(r) * (R.HOLE_K || 0.9) * ((ct.hole || 0) >= 0.3 ? 1.06 : 1); }
  function holeDefault(S, rid) { const m = S.menu[rid], r = recipe(S, rid); if (m && wholeable(r) && !(m.hp > 0)) m.hp = round10((m.price || recipeValue(r)) * pieceCount(r) * (R.HOLE_K || 0.9)); }
  function costEstimate(S, r) {
    const m = S.market; let c = 0;
    const b = D.BASES[r.base]; for (const id in b.ing) c += b.ing[id] * m[id];
    if (r.cream && r.cream !== 'none') { let cc = 0; const cr = D.CREAMS[r.cream]; for (const id in cr.ing) cc += cr.ing[id] * m[id]; c += cc / D.CREAM_YIELD; }
    for (const id in r.tops || {}) c += r.tops[id] * m[id];
    return Math.round(c);
  }

  // ===================== 需要モデル =====================
  // ケーキの今日の相場
  function cakeMarket(S, rid, r) { r = r || recipe(S, rid); return (S.cmk && S.cmk[rid]) || (r ? recipeValue(r) : 400); }
  function wtp(S, r, q, ct, noise, rid) {
    let v = (rid ? cakeMarket(S, rid, r) : recipeValue(r)) * (0.5 + 0.75 * q) * ct.budget * (0.88 + 0.05 * S.rep);
    const tags = recipeTags(r);
    if (tags.some((t) => ct.likes.includes(t))) v *= 1.18;
    if (ct.picky > 0.6 && q < 0.65) v *= 0.6;
    v *= 1 + 0.03 * (S.up.interior || 0);
    return v * (noise || 1);
  }
  // 価格に対して、お客さんのうち何割が買ってくれそうか (メニュー画面の予想表示用)
  function demandEstimate(S, rid, price, q, hole) {
    const r = recipe(S, rid); if (!r) return 0;
    let tot = 0, ok = 0;
    const lim = (hole ? holeMarket(S, rid, r) : cakeMarket(S, rid, r)) * R.PRICE_LIMIT;
    for (const ct of D.CUSTOMERS) for (let i = -2; i <= 2; i++) { const n = Math.exp(i * 0.15); tot += ct.w; if ((hole ? holeWtp(S, r, q, ct, n, rid) : wtp(S, r, q, ct, n, rid)) >= price && price <= lim) ok += ct.w; }
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
    const kinds = Object.keys(CS.kitchen.shelfStock(S)).length;
    const variety = 1 + Math.min(0.2, Math.max(0, kinds - 1) * 0.05);
    return 6.2 * players * rep * attract * w * dow * ad * variety * rush(S).rate * D.HOUR_CURVE[clamp(hourIdx, 0, 9)];
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
    const kf = CS.kitchen && CS.kitchen.ACT[a.t];
    const f = ACT[a.t] || kf;
    if (!f) return { ok: false, msg: '不明な操作' };
    if (S.bankrupt && a.t !== 'reset') return { ok: false, msg: 'お店は倒産しました' };
    if (kf && !ACT[a.t] && !working(S) && !(CS.kitchen.ANYTIME || {})[a.t]) return { ok: false, msg: S.phase === 'report' ? '今日の営業は終わりました' : 'まだ営業日が始まっていません' };
    try { return f(S, a, now) || { ok: true }; } catch (e) { return { ok: false, msg: 'エラー: ' + e.message }; }
  }
  const working = (S) => S.phase === 'prep' || S.phase === 'open';
  const ACT = {
    start(S, a, now) { if (S.phase !== 'lobby') return { ok: false }; S.phase = 'prep'; S.phaseAt = now; S.dayT = 0; fx(S, 'phase', '準備中（CLOSE）。仕込みができたら入口の看板を OPEN に！'); return { ok: true }; },
    open(S, a, now) { if (S.phase !== 'prep') return { ok: false }; openShop(S, now); return { ok: true }; },
    close(S, a, now) { if (S.phase !== 'open') return { ok: false }; S.phase = 'prep'; CS.kitchen.sendAway(S, now, '準備中なんだ…'); fx(S, 'phase', 'CLOSE（準備中）。時計が止まりました'); return { ok: true }; },
    next(S, a, now) { if (S.phase !== 'report') return { ok: false }; nextDay(S, now); return { ok: true }; },
    endDay(S, a, now) { if (S.phase !== 'prep' || !(S.dayT > 0)) return { ok: false, msg: 'OPEN してから閉店できます' }; closeDay(S, now); return { ok: true }; },

    // 仕入れ：カートの中身（最大10箱）をまとめて発送。送料は1回ごとに固定
    order(S, a, now) {
      const items = toArr(a.items).filter((id) => D.ING[id]);
      if (!items.length) return { ok: false, msg: 'カートが空です' };
      const locked = items.filter((id) => !ingUnlocked(S, id));
      if (locked.length) { const by = ingUnlockBy(locked[0]); return { ok: false, msg: '「' + D.ING[locked[0]].name + '」はまだ仕入れられません' + (by ? '（店舗Lv' + (by.lv || 1) + '「' + by.name + '」で解放）' : '') }; }
      if (items.length > R.CART_MAX) return { ok: false, msg: '一度に注文できるのは' + R.CART_MAX + '箱までです' };
      if (S.k && S.k.truck && !(now < S.k.truck.at)) return { ok: false, msg: 'トラックが来ています。荷おろしが終わって帰ったら次を注文できます' };
      const P = R.PACK;
      let cost = R.SHIP; const list = items.map((id) => { const u = S.market[id]; cost += u * P; return { ing: id, n: P, u }; });
      cost = Math.round(cost);
      if (S.funds < cost) return { ok: false, msg: '資金が足りません（合計 ¥' + cost.toLocaleString() + '）' };
      const at = CS.kitchen.deliver(S, list, now);
      if (!at) return { ok: false, msg: 'トラックの荷台がいっぱいです（次の便で注文しよう）' };
      S.funds -= cost; S.today.buy += cost; S.today.ship = (S.today.ship || 0) + R.SHIP;
      // 仕入れ値は注文のたびに動く（たくさん買った物は少し上がる）
      for (const id in D.ING) {
        const base = D.ING[id].price, k = items.filter((x) => x === id).length;
        let p = S.market[id] * (1 + (Math.random() - 0.5) * 0.06 + k * 0.025);
        p += (base - p) * 0.04;
        S.market[id] = Math.round(clamp(p, base * 0.6, base * 1.8));
      }
      return { ok: true, msg: items.length + '箱を発送（¥' + cost.toLocaleString() + '・送料込み）。約' + Math.round((at - now) / 1000) + '秒でトラックが裏の路地に着きます' };
    },
    buy(S, a, now) { const n = Math.max(1, Math.min(R.CART_MAX, Math.ceil((+a.n || 10) / R.PACK))); return ACT.order(S, { items: Array(n).fill(a.id) }, now); },
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
      S.staff[a.slot] = { name: sl.name, lv: sl.start, xp: D.STAFF.xp[sl.start - 1], sp: sl.sp || 1, task: ['chef', 'stock', 'chef', 'cashier', 'bake', 'wash', 'chef', 'deco'][a.slot] || 'chef', opt: '', skin: sl.skin, days: 0 };
      fx(S, 'info', sl.name + ' さんがアルバイトに来てくれた！');
      return { ok: true };
    },
    fire(S, a) { const st = S.staff[a.slot]; if (!st) return { ok: false }; CS.kitchen.releaseStaff(S, a.slot); S.staff[a.slot] = 0; fx(S, 'info', st.name + ' さんとお別れした'); return { ok: true }; },
    staffTask(S, a) {
      const st = S.staff[a.slot]; if (!st || !D.STAFF.tasks[a.task]) return { ok: false };
      if (st.task !== a.task) { st.job = null; CS.kitchen.releaseStaff(S, a.slot); }
      st.task = a.task; st.opt = String(a.opt || ''); st.wait = 0;
      return { ok: true };
    },
    price(S, a) {
      if (!S.menu[a.r]) return { ok: false };
      if (a.hp != null) { if (!wholeable(recipe(S, a.r))) return { ok: false, msg: 'これはホールで売れません' }; S.menu[a.r].hp = clamp(round10(+a.hp || 0), 500, 20000); }
      if (a.price != null) S.menu[a.r].price = clamp(round10(+a.price || 0), 100, 3000);
      return { ok: true };
    },
    menuOn(S, a) { if (!S.menu[a.r]) return { ok: false }; S.menu[a.r].on = !!a.on; return { ok: true }; },
    upgrade(S, a) {
      const u = D.UPGRADES.find((x) => x.id === a.id); if (!u || u.hide) return { ok: false };
      const lv = S.up[u.id] || 0;
      if (lv >= u.levels.length) return { ok: false, msg: 'これ以上は拡張できません' };
      const cost = u.levels[lv], need = upReq(u, lv);
      if (shopLevel(S).lv < need) return { ok: false, msg: '店舗レベル ' + need + ' で解放されます' };
      if (S.funds < cost) return { ok: false, msg: '資金が足りません' };
      S.funds -= cost; S.up[u.id] = lv + 1;
      S.today.capex = (S.today.capex || 0) + cost;
      if (u.id === 'floor') moveForFloor(S, lv, lv + 1);
      if (u.id === 'storage') CS.kitchen.normalize(S); // 倉庫の壁が動く → かかった家具・段ボールは近くの空いている所へ
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
      const lockedI = recipeIngs(r).filter((k) => !ingUnlocked(S, k));
      if (lockedI.length) return { ok: false, msg: '「' + D.ING[lockedI[0]].name + '」はまだ解放されていない材料です' };
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
      for (const id in S.k.items) { const it = S.k.items[id]; if ((it.t === 'tray' || it.t === 'cake') && it.r === a.r) delete S.k.items[id]; }
      for (const id in S.stock) if (S.stock[id].r === a.r) delete S.stock[id];
      return { ok: true };
    },
    reset(S) { const fresh = newState({ name: S.name, diff: S.diff }); Object.keys(S).forEach((k) => delete S[k]); Object.assign(S, fresh); return { ok: true }; },
  };

  const df0 = (k) => (k.df || []).length > 0;
  // ===================== 営業 =====================
  // ===================== アルバイト =====================
  function menuRecipes(S) { return Object.keys(S.menu).filter((rid) => S.menu[rid].on && S.known[rid] && recipe(S, rid)); }
  function openShop(S, now) {
    S.phase = 'open'; S.dayAt = now; S.lastSpawn = now;
    fx(S, 'phase', 'OPEN！いらっしゃいませ！');
  }
  // OPEN のあいだだけ時計が進み、お客さんが来る
  function tick(S, now) {
    if (S.bankrupt) return;
    if (S.phase === 'open') {
      const dt = clamp(now - (S.dayAt || now), 0, 3000);
      S.dayAt = now;
      S.dayT = (S.dayT || 0) + dt;
      if (S.dayT >= R.OPEN_MS) { closeDay(S, now); return; }
      const last = S.lastSpawn || now;
      const sdt = Math.min(now - last, 5000);
      S.lastSpawn = now;
      if (sdt > 0) {
        const hourIdx = Math.floor((S.dayT / R.OPEN_MS) * 10);
        const expect = arrivalRate(S, hourIdx) * (sdt / (R.OPEN_MS / 10));
        let n = 0; let p = Math.exp(-expect), cum = p, u = Math.random();
        while (u > cum && n < 6) { n++; p *= expect / n; cum += p; }
        for (let i = 0; i < n; i++) CS.kitchen.spawn(S, now + i * 400);
      }
    }
    CS.kitchen.tick(S, now);
  }
  // ケーキの賞味期限：作った日 d を入れて CAKE_DAYS 日。after=1 は「今日が終わったら」で判定（閉店時）
  function cakeExpDay(d, S) { return (d || (S && S.day) || 1) + (R.CAKE_DAYS || 2) - 1; }
  function cakeExpired(S, d, after) { return S.day + (after ? 1 : 0) > cakeExpDay(d, S); }
  function cakeExpText(S, d) { const left = cakeExpDay(d, S) - S.day; return left <= 0 ? '賞味期限 今日まで' : left === 1 ? '賞味期限 明日まで' : '賞味期限 あと' + left + '日'; }
  // 増床：家具ごと奥の左の角を基準に動かす（はみ出したら空いている所へ）
  function moveForFloor(S, from, to) {
    const P = CS.plan, st = S.up.storage || 0, a = P.geom(from, st), b = P.geom(to, st), dx = b.store.x0 - a.store.x0, dz = b.store.z0 - a.store.z0;
    for (const id in S.fu) { const f = S.fu[id]; if (P.KINDS[f.k].counter) { f.x += dx; f.z = b.counter.z; } else { f.x += dx; f.z += dz; } }
    for (const id in S.k.items) { const it = S.k.items[id]; if (it.at === 'fl') { it.fx += dx; it.fz += dz; } } // 厨房・倉庫・路地とも、奥の左の角に合わせて動く
    for (const id in S.fu) { const f = S.fu[id]; if (P.valid(S, id, f.k, f.x, f.z, f.r)) { const old = S.fu[id]; delete S.fu[id]; const sp = P.findSpot(S, old.k, [old.x, old.z]); S.fu[id] = sp ? Object.assign(old, sp) : old; } }
    CS.kitchen.normalize(S);
  }
  function rate(S, stars5, w) { S.rep = clamp(S.rep + (stars5 - S.rep) * w, 1, 5); }

  function closeDay(S, now) {
    const T = S.today;
    let waste = 0;
    // 商品棚・冷蔵庫のケーキは賞味期限（作った日を入れて2日）まで翌日も売れる。期限切れの材料もここで捨てる
    S.stock = {};
    waste += CS.kitchen.endDay(S);
    waste = Math.round(waste);
    T.waste += waste;
    let equip = 0; for (const u of D.UPGRADES) equip += S.up[u.id] || 0;
    let wages = 0; S.staff.forEach((st, i) => { if (st) { wages += D.STAFF.wage(st.lv, st.sp); st.job = null; CS.kitchen.releaseStaff(S, i); st.days = (st.days || 0) + 1; } });
    T.wages = wages;
    const fixed = R.RENT + (S.up.floor || 0) * (R.RENT_PER_FLOOR || 1500) + (equip + 2) * R.UTIL_PER_EQUIP + wages;
    S.funds -= fixed;
    const revenue = T.sales + T.drinks;
    const profit = revenue - T.cogs - T.waste - fixed - T.ads - (T.lab || 0) - (T.ship || 0);
    const satAvg = T.cust - T.miss > 0 ? T.sat / Math.max(1, T.cust - T.miss) : 0;
    let bestR = null, bestN = 0; for (const r in T.best) if (T.best[r] > bestN) { bestN = T.best[r]; bestR = r; }
    S.history.push({ brk: T.broken || 0, ovr: T.over || 0, wsh: T.washed || 0, exp: T.expired || 0, slow: T.slow || 0, spl: T.spoiled || 0, pc: T.pcomp || 0, ship: T.ship || 0, cmp: T.complaints || 0, iss: Object.assign({}, T.issues || {}), d: S.day, sales: revenue, cogs: T.cogs, waste: T.waste, fixed, ads: T.ads + (T.lab || 0), profit, cust: T.cust, sold: T.sold, hole: T.hole || 0, miss: T.miss, rep: Math.round(S.rep * 100) / 100, sat: Math.round(satAvg * 100) / 100, funds: S.funds, best: bestR || '', buy: T.buy || 0, capex: T.capex || 0, wages });
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
    S.phase = 'prep'; S.phaseAt = now; S.dayT = 0;
    fx(S, 'phase', S.day + '日目：準備中（CLOSE）。看板を OPEN にすると開店');
  }

  CS.sim = {
    shopLevel, rush, unlockedIngs, ingUnlocked, ingUnlockBy, recipeIngs, wholeable, holeMarket, holeWtp, addXp, upReq, eqv, pieceCount, furnMax, unlockByLevel, newState, normalize, gt, phaseInfo, clockStr, tick, apply, recipe, recipeTags, stars, recipeValue, comboKey, findRecipeByCombo,
    costEstimate, demandEstimate, wtp, cakeMarket, arrivalRate, invCount, hasAll, missing, expSoon, bakeQuality, bakeWindow, ovenDur, coolMs, upVal,
    DECIDE_MS, LEAVE_MS, clamp, fx, appearance, cleanDf, ACT, working, cakeExpDay, cakeExpired, cakeExpText, HOST_ONLY: ['menuOn'],
    _: { cakeExpired, toArr, uid, union, cleanDf, fx, invCount, invTake, invAdd, hasAll, takeAll, eqv, ovenDur, bakeQuality, bakeWindow, coolMs, findRecipeByCombo, wtp, cakeMarket, appearance, addXp, rate, pick, wpick, gauss, menuRecipes },
  };
})(typeof window !== 'undefined' ? window : globalThis);
