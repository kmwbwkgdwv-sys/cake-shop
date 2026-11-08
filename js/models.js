/* ケーキ屋さんシミュレーター : 3D モデル（人物・ケーキ・質感テクスチャ・サムネイル） */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data;
  const { M, Geo, Builder, Node, rgb, mix } = CS.gl;
  const PI = Math.PI, TAU = Math.PI * 2;
  const SPH = (r, a, b) => Geo.sphere(r || 1, a || 16, b || 12);
  const shade = (c, t) => (t < 0 ? mix(c, '#000000', -t) : mix(c, '#ffffff', t));
  const MAT = { skin: { rough: 0.55 }, cloth: { rough: 0.85 }, hair: { rough: 0.45 }, leather: { rough: 0.35 }, metal: { rough: 0.3, metal: 1 }, gloss: { rough: 0.18 }, eye: { rough: 0.1 } };

  // =====================================================================
  //  人物（等身大・関節つき）
  //   断面を積み重ねた曲面（loft）で胴や手足を、変形した球で頭部を作る
  // =====================================================================
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerpN = (a, b, t) => a + (b - a) * t;
  // ---- 頭部の形 ----
  const HC = [0, 0.152, 0.006], HR = [0.079, 0.116, 0.097];
  function headWarp(x, y, z) {
    let X = x, Y = y, Z = z;
    if (Y < 0) { const t = -Y; X *= 1 - 0.3 * t * t; Z *= Z > 0 ? 1 - 0.06 * t : 1 - 0.5 * t * t; }
    if (Z < 0 && Y > -0.35) Z *= 1.08;
    if (Z > 0) { X *= 1 - 0.07 * Z; const f = Math.max(0, 1 - Math.max(0, Y - 0.55) / 0.45); Z = Z * (1 - f) + Math.pow(Z, 0.72) * f; }
    let px = X * HR[0], py = Y * HR[1], pz = Z * HR[2];
    if (Y < -0.5 && Z > 0) pz += 0.007 * ((-Y - 0.5) / 0.5) * Z;
    if (z > 0.45) {
      for (const sd of [-1, 1]) { const dx = x - sd * 0.4, dy = y - 0.13; pz -= 0.0058 * Math.exp(-(dx * dx + dy * dy) / 0.02); }
      pz += 0.0032 * Math.exp(-((y - 0.34) ** 2) / 0.012) * Math.max(0, 1 - Math.abs(x) / 0.75);
      for (const sd of [-1, 1]) { const d2 = (x - sd * 0.56) ** 2 + (y + 0.06) ** 2; const b = Math.exp(-d2 / 0.03); px += sd * 0.0025 * b; pz += 0.0028 * b; }
    }
    return [px + HC[0], py + HC[1], pz + HC[2]];
  }
  const headPt = (ux, uy) => headWarp(ux, uy, Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy)));
  const headN = (p) => { const v = [(p[0] - HC[0]) / (HR[0] * HR[0]), (p[1] - HC[1]) / (HR[1] * HR[1]), (p[2] - HC[2]) / (HR[2] * HR[2])]; const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  // 顔の表面の z（x, y から）
  function faceZ(x, y) {
    const uy = Math.max(-0.999, Math.min(0.999, (y - HC[1]) / HR[1])), lim = Math.sqrt(1 - uy * uy);
    let lo = 0, hi = lim; const ax = Math.abs(x);
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (Math.abs(headPt(m, uy)[0]) < ax) lo = m; else hi = m; }
    return headPt(Math.sign(x || 1) * lo, uy)[2];
  }
  // 頭にそった殻（髪・帽子・ひげ）：region>0 の所だけ外側へ、それ以外は頭の内側へ沈める
  function headShell(B, region, k, col, mat, colFn, res) {
    const g = Geo.warp(Geo.sphere(1, res || 48, Math.round((res || 48) * 0.7)), (x, y, z) => {
      const p = headWarp(x, y, z), t = smooth(-0.035, 0.03, region(x, y, z)), kk = lerpN(0.93, k(x, y, z), t);
      const q = [HC[0] + (p[0] - HC[0]) * kk, HC[1] + (p[1] - HC[1]) * kk, HC[2] + (p[2] - HC[2]) * kk];
      if (colFn) { const c = colFn(x, y, z); return [q[0], q[1], q[2], c, c, c]; }
      return q;
    });
    B.put(g, [0, 0, 0], 0, 1, col, mat);
  }
  // 頭の中心を軸に回す行列
  function about(c, r) { const m = M.compose(M.ident(), [c[0], c[1], c[2]], r, [1, 1, 1]); return M.mul(m, m, M.compose(M.ident(), [-c[0], -c[1], -c[2]], [0, 0, 0], [1, 1, 1])); }
  // A→B に y 軸を向けた行列（ひも・ストラップ用）
  function alignMat(A, Bp) {
    const Y = [Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]]; const l = Math.hypot(Y[0], Y[1], Y[2]) || 1; Y[0] /= l; Y[1] /= l; Y[2] /= l;
    let X = [Y[1] * 1 - Y[2] * 0, Y[2] * 0 - Y[0] * 1, Y[0] * 0 - Y[1] * 0]; X = [Y[1], -Y[0], 0]; let xl = Math.hypot(X[0], X[1], X[2]); if (xl < 1e-4) { X = [1, 0, 0]; xl = 1; } X = [X[0] / xl, X[1] / xl, X[2] / xl];
    X = [Y[1] * 0 - Y[2] * 0, 0, 0]; // 下で作り直す
    const Zr = [0, 0, 1]; X = [Y[1] * Zr[2] - Y[2] * Zr[1], Y[2] * Zr[0] - Y[0] * Zr[2], Y[0] * Zr[1] - Y[1] * Zr[0]]; xl = Math.hypot(X[0], X[1], X[2]) || 1; X = [X[0] / xl, X[1] / xl, X[2] / xl];
    const Z = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    const m = M.ident(); m[0] = X[0]; m[1] = X[1]; m[2] = X[2]; m[4] = Y[0]; m[5] = Y[1]; m[6] = Y[2]; m[8] = Z[0]; m[9] = Z[1]; m[10] = Z[2]; m[12] = (A[0] + Bp[0]) / 2; m[13] = (A[1] + Bp[1]) / 2; m[14] = (A[2] + Bp[2]) / 2;
    return m;
  }
  // 断面リストの y での値（ボタン位置などに使う）
  function ringAt(R, y) { for (let i = 0; i < R.length - 1; i++) { const a = R[i], b = R[i + 1]; if ((y - a.y) * (y - b.y) <= 0) { const t = (y - a.y) / (b.y - a.y || 1); return { rx: lerpN(a.rx, b.rx, t), rz: lerpN(a.rz, b.rz, t), cz: lerpN(a.cz || 0, b.cz || 0, t), sq: a.sq || 2 }; } } return R[R.length - 1]; }
  function surfZ(R, x, y, off) { const r = ringAt(R, y); const u = Math.min(1, Math.abs(x) / (r.rx + (off || 0))); return r.cz + (r.rz + (off || 0)) * Math.pow(1 - Math.pow(u, r.sq), 1 / r.sq); }
  const offR = (R, d, extra) => R.map((r) => Object.assign({}, r, { rx: r.rx + d, rz: r.rz + d }, extra || {}));
  const hashN = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

  const partCache = {};
  function buildParts(eng, skin) {
    const s = Object.assign({}, D.DEFAULT_SKIN, skin || {});
    const key = eng.id + '|' + JSON.stringify(s);
    if (partCache[key]) return partCache[key];
    const bw = { slim: 0.9, normal: 1, sturdy: 1.15 }[s.body] || 1, bz = 1 + (bw - 1) * 0.85;
    const SK = rgb(s.skin), HCOL = rgb(s.hairColor), CL = rgb(s.clothesColor), PA = rgb(s.pantsColor || '#1F1F22'), AP = rgb(s.apronColor);
    const LIP = mix(s.skin, '#B0545A', 0.36), SHOE = rgb('#231C18');
    const shortSl = s.clothes === 'polo';
    const darkC = shade(s.clothesColor, s.clothesColor.toUpperCase() > '#C' ? -0.12 : 0.12);
    const coat = s.clothes === 'coat', knit = s.clothes === 'knit', tucked = s.clothes === 'shirt' || s.clothes === 'polo';
    const W = (R) => R.map((r) => Object.assign({}, r, { rx: r.rx * bw, rz: r.rz * bz, cz: (r.cz || 0) * bz }));

    // ---------- 腰（ズボン・ベルト） ----------
    const HIP = new Builder();
    const RH = W([tucked ? { y: 0.115, rx: 0.147, rz: 0.097 } : { y: 0.09, rx: 0.138, rz: 0.092 }, { y: 0.06, rx: 0.155, rz: 0.102 }, { y: -0.01, rx: 0.162, rz: 0.106 }, { y: -0.07, rx: 0.157, rz: 0.104, cz: -0.004 }, { y: -0.12, rx: 0.12, rz: 0.085 }, { y: -0.15, rx: 0.05, rz: 0.05 }]);
    HIP.put(Geo.loft(RH, { seg: 28, capTop: true, capBot: true }), 0, 0, 1, PA, MAT.cloth);
    if (tucked) {
      HIP.put(Geo.loft(offR(W([{ y: 0.104, rx: 0.149, rz: 0.098 }, { y: 0.072, rx: 0.153, rz: 0.101 }]), 0.004), { seg: 28, thick: 0.004 }), 0, 0, 1, rgb('#2A221D'), MAT.leather);
      HIP.put(Geo.rbox(0.03, 0.026, 0.006, 0.003), [0, 0.088, 0.102 * bz + 0.008], 0, 1, rgb('#B9A06A'), MAT.metal);
    }
    // ---------- 胴 ----------
    const TOR = new Builder();
    const RT = W([].concat(
      coat ? [{ y: -0.17, rx: 0.17, rz: 0.113, sq: 2.2 }, { y: -0.1, rx: 0.164, rz: 0.108, sq: 2.2 }] : knit ? [{ y: -0.15, rx: 0.16, rz: 0.106 }, { y: -0.1, rx: 0.159, rz: 0.105 }] : [{ y: -0.07, rx: 0.144, rz: 0.096 }],
      [{ y: -0.02, rx: 0.149, rz: 0.099, sq: 2.2 }, { y: 0.06, rx: 0.143, rz: 0.096, sq: 2.2 }, { y: 0.14, rx: 0.148, rz: 0.101, cz: 0.003, sq: 2.3 }, { y: 0.22, rx: 0.16, rz: 0.108, cz: 0.008, sq: 2.4 }, { y: 0.3, rx: 0.17, rz: 0.11, cz: 0.01, sq: 2.4 }, { y: 0.36, rx: 0.178, rz: 0.104, cz: 0.006, sq: 2.5 }, { y: 0.4, rx: 0.184, rz: 0.094, sq: 2.6 }, { y: 0.428, rx: 0.172, rz: 0.086, sq: 2.4 }, { y: 0.452, rx: 0.13, rz: 0.075 }, { y: 0.478, rx: 0.06, rz: 0.055 }]));
    TOR.put(Geo.loft(RT, { seg: 36, capTop: true, capBot: true }), 0, 0, 1, CL, MAT.cloth);
    TOR.put(Geo.loft([{ y: 0.43, rx: 0.055, rz: 0.052 }, { y: 0.5, rx: 0.051, rz: 0.048 }], { seg: 18 }), 0, 0, 1, SK, MAT.skin);
    const onT = (x, y, off) => [x, y, surfZ(RT, x, y, off || 0)];
    const seamLine = (x, y0, y1, col, w) => { const R = []; for (let y = y0; y <= y1 + 1e-6; y += (y1 - y0) / 8) R.push({ y, rx: w || 0.0016, rz: w || 0.0016, cx: x, cz: surfZ(RT, x, y, 0.0005) }); TOR.put(Geo.loft(R, { seg: 6, capTop: true, capBot: true }), 0, 0, 1, col, MAT.cloth); };
    if (coat) {
      // ダブルのコックコート：打ち合わせ・2 列ボタン・スタンドカラー
      seamLine(0.07 * bw, -0.16, 0.43, shade(s.clothesColor, -0.18), 0.0018);
      [0.02, 0.1, 0.18, 0.26, 0.34].forEach((y) => [-1, 1].forEach((sd) => { const q = onT(sd * 0.042 * bw, y, 0.002); TOR.put(SPH(1, 10, 6), q, 0, [0.0068, 0.0068, 0.0035], rgb(s.clothesColor.toUpperCase() === '#F7F5F0' || s.clothesColor.toUpperCase() > '#E' ? '#D9D2C6' : '#EDE7DB'), MAT.gloss); }));
      TOR.put(Geo.loft([{ y: 0.448, rx: 0.068, rz: 0.062, cz: 0.002 }, { y: 0.498, rx: 0.063, rz: 0.058, cz: 0.002 }], { seg: 24, a0: 0.3, a1: TAU - 0.3, thick: 0.005 }), 0, 0, 1, shade(s.clothesColor, -0.04), MAT.cloth);
      const pk = onT(-0.085 * bw, 0.31, 0.001); TOR.put(Geo.box(0.05, 0.0025, 0.004), pk, [0, -0.45, 0], 1, shade(s.clothesColor, -0.2), MAT.cloth);
    } else if (s.clothes === 'shirt' || s.clothes === 'polo') {
      seamLine(0.006, s.clothes === 'polo' ? 0.33 : -0.06, 0.45, shade(s.clothesColor, -0.12), 0.0014);
      (s.clothes === 'polo' ? [0.36, 0.41] : [0.03, 0.12, 0.21, 0.3, 0.39]).forEach((y) => TOR.put(SPH(1, 8, 6), onT(0.012, y, 0.0015), 0, [0.0045, 0.0045, 0.002], rgb('#EDE7DD'), MAT.gloss));
      [-1, 1].forEach((sd) => TOR.put(Geo.rbox(0.05, 0.004, 0.034, 0.002), [sd * 0.033, 0.468, 0.048], [0.55, sd * 0.55, sd * 0.35], 1, shade(s.clothesColor, 0.04), MAT.cloth));
      TOR.put(Geo.loft([{ y: 0.455, rx: 0.064, rz: 0.06 }, { y: 0.49, rx: 0.06, rz: 0.056 }], { seg: 24, a0: 0.45, a1: TAU - 0.45, thick: 0.004 }), 0, 0, 1, shade(s.clothesColor, 0.03), MAT.cloth);
    } else if (knit) {
      TOR.put(Geo.loft(offR(W([{ y: -0.152, rx: 0.16, rz: 0.106, wav: [0.012, 64] }, { y: -0.11, rx: 0.159, rz: 0.105, wav: [0.012, 64] }]), 0.004), { seg: 128, thick: 0.004 }), 0, 0, 1, shade(s.clothesColor, -0.06), MAT.cloth);
      TOR.put(Geo.loft([{ y: 0.45, rx: 0.07, rz: 0.064, wav: [0.03, 40] }, { y: 0.488, rx: 0.062, rz: 0.058, wav: [0.03, 40] }], { seg: 80, thick: 0.006 }), 0, 0, 1, shade(s.clothesColor, -0.06), MAT.cloth);
    }
    if (s.apron === 'bib') {
      const RB = RT.filter((r) => r.y >= 0.0 && r.y <= 0.36).map((r) => Object.assign({}, r, { rx: r.rx + 0.006, rz: r.rz + 0.006 }));
      RB.push(Object.assign({}, ringAt(RT, 0.37), { y: 0.37, rx: ringAt(RT, 0.37).rx + 0.006, rz: ringAt(RT, 0.37).rz + 0.006 }));
      TOR.put(Geo.loft(RB, { seg: 20, a0: -0.68, a1: 0.68, thick: 0.004 }), 0, 0, 1, AP, MAT.cloth);
      [-1, 1].forEach((sd) => { const a = onT(sd * 0.075 * bw, 0.365, 0.007), b = [sd * 0.058, 0.478, -0.01]; TOR.add(Geo.rbox(0.014, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) + 0.01, 0.004, 0.0018), alignMat(a, b), shade(s.apronColor, -0.1), MAT.cloth); });
      TOR.put(Geo.loft([{ y: 0.47, rx: 0.062, rz: 0.06, cz: -0.006 }, { y: 0.485, rx: 0.06, rz: 0.058, cz: -0.006 }], { seg: 24, a0: 1.2, a1: TAU - 1.2, thick: 0.004 }), 0, 0, 1, shade(s.apronColor, -0.1), MAT.cloth);
    }
    if (s.acc === 'scarf') {
      TOR.put(Geo.loft([{ y: 0.45, rx: 0.075, rz: 0.07, wav: [0.06, 7] }, { y: 0.49, rx: 0.068, rz: 0.064, wav: [0.06, 7, 1] }, { y: 0.515, rx: 0.06, rz: 0.057 }], { seg: 42, thick: 0.012 }), 0, 0, 1, rgb(s.accColor), MAT.cloth);
      TOR.put(Geo.loft([{ y: 0.47, rx: 0.02, rz: 0.008 }, { y: 0.38, rx: 0.026, rz: 0.008 }, { y: 0.28, rx: 0.028, rz: 0.008 }].map((r, i) => Object.assign(r, { cx: 0.03 + i * 0.006, cz: surfZ(RT, 0.03, r.y, 0.012) })), { seg: 10, capBot: true, capTop: true }), 0, 0, 1, shade(s.accColor, -0.05), MAT.cloth);
    }

    // ---------- 頭 ----------
    const HD = new Builder();
    HD.put(Geo.loft([{ y: -0.03, rx: 0.053, rz: 0.049 }, { y: 0.04, rx: 0.05, rz: 0.046, cz: 0.002 }, { y: 0.1, rx: 0.046, rz: 0.044, cz: 0.006 }], { seg: 20, capTop: true }), 0, 0, 1, SK, MAT.skin);
    const headGeo = Geo.warp(Geo.sphere(1, 40, 30), (x, y, z) => {
      const p = headWarp(x, y, z);
      let c = 1; const r = [1, 1, 1];
      for (const sd of [-1, 1]) { const b = Math.exp(-(((x - sd * 0.5) ** 2) + ((y + 0.18) ** 2)) / 0.035) * (z > 0 ? 1 : 0); r[1] -= b * 0.07; r[2] -= b * 0.06; }
      if (y < -0.6) c -= (-0.6 - y) * 0.25;
      if (z > 0.45) for (const sd of [-1, 1]) { const d2 = (x - sd * 0.4) ** 2 + (y - 0.15) ** 2; c -= 0.08 * Math.exp(-d2 / 0.015); }
      return [p[0], p[1], p[2], r[0] * c, r[1] * c, r[2] * c];
    });
    HD.put(headGeo, 0, 0, 1, SK, MAT.skin);
    // 耳（髪で隠れる髪型では作らない）
    if (!['bob', 'long', 'wavy'].includes(s.hair)) [-1, 1].forEach((sd) => {
      const q = headWarp(sd * 0.98, 0.06, -0.12);
      HD.put(Geo.warp(SPH(1, 14, 10), (x, y, z) => [x * 0.0075 + (x > 0 ? 0 : 0), y * 0.029 * (1 - 0.15 * Math.max(0, -y)), z * 0.019 * (1 - 0.3 * Math.max(0, -y))]), [q[0] + sd * 0.006, q[1], q[2]], [0.1, sd * -0.35, sd * 0.1], 1, shade(s.skin, -0.02), MAT.skin);
      HD.put(SPH(1, 10, 8), [q[0] + sd * 0.0095, q[1] - 0.002, q[2] + 0.002], [0.1, sd * -0.35, sd * 0.1], [0.003, 0.016, 0.01], shade(s.skin, -0.18), MAT.skin);
    });
    // 目（眼球・虹彩・まぶた・まつげ）
    const lid = { normal: [0.4, 0.13, 0, 0.66], round: [0.37, 0.02, 0, 0.7], narrow: [0.43, 0.24, 0, 0.6], droop: [0.41, 0.2, 0.16, 0.66] }[s.eyes] || [0.4, 0.13, 0, 0.66];
    [-1, 1].forEach((sd) => {
      const sp = headPt(sd * 0.4, 0.13), nr = headN(sp);
      const E = [sp[0] - nr[0] * 0.0052, sp[1] - nr[1] * 0.0052 + 0.0004, sp[2] - nr[2] * 0.0052];
      const F = M.compose(M.ident(), E, [0, sd * 0.06, 0], [1, 1, 1]);
      const er = 0.0118, lr = 0.01245;
      HD.put(SPH(er, 18, 12), 0, 0, 1, rgb('#ECE6DE'), MAT.eye, F);
      HD.put(SPH(1, 18, 8), [0, 0, er - 0.0011], 0, [0.0056, 0.0056, 0.0017], rgb(s.eyeColor), MAT.eye, F);
      HD.put(SPH(1, 12, 6), [0, 0, er + 0.0002], 0, [0.0025, 0.0025, 0.0009], rgb('#0A0807'), MAT.eye, F);
      HD.put(SPH(0.0008, 6, 4), [-0.0018 * sd - 0.001, 0.0021, er + 0.0006], 0, 1, [1, 1, 1], MAT.eye, F);
      const L = M.mul(M.ident(), F, M.compose(M.ident(), [0, 0, 0], [lid[1], 0, sd * lid[2]], [1, 1, 1]));
      HD.put(Geo.sphere(lr, 20, 8, 0, Math.PI * lid[0]), 0, 0, 1, shade(s.skin, -0.04), MAT.skin, L);
      HD.put(Geo.torus(lr * Math.sin(Math.PI * lid[0]), 0.00095, 5, 20, Math.PI), [0, lr * Math.cos(Math.PI * lid[0]), 0], [Math.PI / 2, 0, 0], [1, 1, 1], rgb('#1C1310'), MAT.hair, L);
      HD.put(Geo.sphere(lr * 0.985, 20, 6, Math.PI * lid[3], Math.PI * (1 - lid[3])), 0, [-0.12, 0, 0], 1, shade(s.skin, -0.02), MAT.skin, F);
      // 眉（弧にそって細くなる 1 本の形）
      const bt = s.brows === 'thick' ? 0.0034 : s.brows === 'thin' ? 0.0016 : 0.0025, BR = shade(s.hairColor, -0.12);
      const arc = (t) => { const ux = sd * (0.14 + 0.47 * t), uy = 0.35 + 0.055 * Math.sin(Math.PI * Math.min(1, t * 1.1)) - 0.045 * t; const q = headPt(ux, uy), n2 = headN(q); return [q[0] + n2[0] * 0.0009, q[1] + n2[1] * 0.0009, q[2] + n2[2] * 0.0009, n2]; };
      HD.put(Geo.warp(SPH(1, 24, 8), (x, y, z) => {
        const t = (x * sd + 1) / 2, a = arc(t), b = arc(Math.min(1, t + 0.02)), c0 = arc(Math.max(0, t - 0.02));
        let tx = b[0] - c0[0], ty = b[1] - c0[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const w = bt * (0.75 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.15))) * (1 - 0.55 * t * t);
        return [a[0] - ty * y * w * sd + a[3][0] * z * 0.0012, a[1] + tx * y * w * sd + a[3][1] * z * 0.0012, a[2] + a[3][2] * z * 0.0012];
      }), 0, 0, 1, BR, MAT.hair);
    });
    // 鼻
    const zs = (y) => faceZ(0, y);
    const nose = [[0.172, 0.005, 0.005, -0.003], [0.16, 0.0052, 0.006, 0.0], [0.148, 0.006, 0.0078, 0.0038], [0.137, 0.0075, 0.0094, 0.0082], [0.129, 0.0095, 0.0102, 0.0112], [0.1225, 0.0102, 0.0088, 0.0104], [0.1175, 0.008, 0.0062, 0.0062], [0.1145, 0.004, 0.003, 0.002]].map(([y, rx, rz, dz]) => ({ y, rx, rz, cz: zs(y) + dz, sq: 2.2 }));
    HD.put(Geo.loft(nose, { seg: 16, capTop: true, capBot: true }), 0, 0, 1, shade(s.skin, 0.01), MAT.skin);
    [-1, 1].forEach((sd) => { HD.put(SPH(1, 12, 8), [sd * 0.0104, 0.1215, zs(0.121) + 0.0052], [0, sd * 0.45, 0], [0.0072, 0.0064, 0.0078], shade(s.skin, -0.02), MAT.skin); HD.put(SPH(1, 8, 6), [sd * 0.0056, 0.1165, zs(0.116) + 0.0076], [0.5, 0, 0], [0.0029, 0.0013, 0.0024], rgb('#3A2220'), MAT.skin); });
    // 口
    const lipGeo = (sx, sy, sz, y0, dz) => Geo.warp(SPH(1, 20, 10), (x, y, z) => { const X = x * sx; return [X, y0 + y * sy, faceZ(X, y0) + dz + z * sz]; });
    const mY = 0.092, open = s.mouth === 'grin' ? 0.0028 : 0;
    if (open) { HD.put(lipGeo(0.019, 0.0055, 0.003, mY, -0.001), 0, 0, 1, rgb('#3A1C1C'), MAT.gloss); HD.put(lipGeo(0.016, 0.0028, 0.002, mY + 0.0012, 0.0012), 0, 0, 1, rgb('#F1ECE4'), MAT.gloss); }
    HD.put(lipGeo(0.0205, 0.0046, 0.0055, mY + 0.0042 + open, 0.0012), [0, 0, 0], 0, 1, LIP, { rough: 0.38 });
    HD.put(lipGeo(0.0182, 0.0056, 0.006, mY - 0.0046 - open, 0.0008), [0, 0, 0], 0, 1, shade(LIP, 0.05), { rough: 0.32 });
    if (!open) HD.put(lipGeo(0.0198, 0.0009, 0.002, mY, 0.0028), 0, 0, 1, rgb('#55302C'), MAT.skin);
    if (s.mouth === 'smile' || s.mouth === 'grin') [-1, 1].forEach((sd) => HD.put(SPH(1, 8, 6), [sd * 0.0215, mY + 0.0022, faceZ(sd * 0.0215, mY) + 0.0006], [0, 0, sd * 0.6], [0.0042, 0.0016, 0.002], shade(LIP, -0.1), MAT.skin));
    // ひげ
    const jaw = (x, y, z) => { const a = Math.abs(Math.atan2(x, z)); if (a > 1.75) return -1; const mouthHole = Math.abs(x) < 0.3 && y > -0.62 && y < -0.38 && z > 0.5 ? -0.2 : 0; return Math.min(-0.08 - y, 1.7 - a) + mouthHole; };
    if (s.beard === 'stubble') headShell(HD, jaw, () => 1.012, mix(s.skin, s.hairColor, 0.45), MAT.skin, null, 40);
    if (s.beard === 'beard') { headShell(HD, (x, y, z) => jaw(x, y, z) + (Math.abs(x) < 0.3 && y > -0.62 && y < -0.38 && z > 0.5 ? 0.2 : 0), (x, y) => 1.05 + 0.04 * Math.max(0, -y - 0.5), HCOL, MAT.hair, (x, y) => 0.9 + 0.1 * hashN(x * 9, y * 9), 44); }
    if (s.beard === 'mustache' || s.beard === 'beard') HD.put(Geo.warp(SPH(1, 18, 8), (x, y, z) => { const X = x * 0.025; return [X, 0.1065 + y * 0.0045 - Math.abs(x) * 0.004, faceZ(X, 0.1065) + 0.004 + z * 0.0045]; }), 0, 0, 1, HCOL, MAT.hair);
    // 髪
    hair(HD, s, HCOL);
    // 帽子・アクセ
    hat(HD, s);
    if (s.acc === 'glasses') {
      const fr = rgb('#2A2420');
      [-1, 1].forEach((sd) => { const q = headPt(sd * 0.4, 0.13); HD.put(Geo.torus(0.0165, 0.0016, 6, 24), [q[0], q[1], q[2] + 0.011], [0, sd * 0.08, 0], [1.12, 0.86, 1], fr, MAT.gloss); HD.put(Geo.box(0.0022, 0.0022, 0.085), [sd * 0.073, q[1] + 0.004, q[2] - 0.035], [0, sd * 0.06, 0], 1, fr, MAT.gloss); });
      HD.put(Geo.box(0.016, 0.0022, 0.0022), [0, headPt(0, 0.16)[1], faceZ(0, 0.17) + 0.009], 0, 1, fr, MAT.gloss);
    }
    if (s.acc === 'earring') [-1, 1].forEach((sd) => { const q = headWarp(sd * 0.98, -0.12, -0.08); HD.put(SPH(0.0042, 8, 6), [q[0] + sd * 0.008, q[1] - 0.004, q[2]], 0, 1, rgb(s.accColor), MAT.metal); });

    // ---------- 腕 ----------
    const UA = new Builder();
    const RUA = [{ y: 0.046, rx: 0.012, rz: 0.016 }, { y: 0.038, rx: 0.032, rz: 0.042 }, { y: 0.018, rx: 0.045, rz: 0.053 }, { y: -0.015, rx: 0.049, rz: 0.053 }, { y: -0.07, rx: 0.047, rz: 0.049 }, { y: -0.15, rx: 0.043, rz: 0.045 }, { y: -0.23, rx: 0.039, rz: 0.041 }, { y: -0.272, rx: 0.037, rz: 0.039 }, { y: -0.29, rx: 0.022, rz: 0.022 }].map((r) => Object.assign({}, r, { rx: r.rx * bw, rz: r.rz * bz }));
    if (shortSl) {
      UA.put(Geo.loft(RUA.map((r) => Object.assign({}, r, { rx: r.rx * 0.88, rz: r.rz * 0.88 })), { seg: 18, capTop: true, capBot: true }), 0, 0, 1, SK, MAT.skin);
      UA.put(Geo.loft(RUA.slice(0, 6).map((r, i) => Object.assign({}, r, { rx: r.rx + 0.006 + i * 0.001, rz: r.rz + 0.006 + i * 0.001 })), { seg: 22, capTop: true, thick: 0.004 }), 0, 0, 1, CL, MAT.cloth);
    } else UA.put(Geo.loft(RUA, { seg: 20, capTop: true, capBot: true }), 0, 0, 1, CL, MAT.cloth);
    const RFA = [{ y: 0.032, rx: 0.02, rz: 0.02 }, { y: 0.02, rx: 0.036, rz: 0.038 }, { y: -0.02, rx: 0.041, rz: 0.039 }, { y: -0.07, rx: 0.04, rz: 0.036 }, { y: -0.14, rx: 0.034, rz: 0.031 }, { y: -0.2, rx: 0.029, rz: 0.026 }, { y: -0.228, rx: 0.028, rz: 0.025 }].map((r) => Object.assign({}, r, { rx: r.rx * bw, rz: r.rz * bz }));
    const mkFA = (sd, watch) => {
      const F = new Builder();
      if (shortSl) F.put(Geo.loft(RFA.map((r) => Object.assign({}, r, { rx: r.rx * 0.9, rz: r.rz * 0.9 })).concat([{ y: -0.245, rx: 0.023, rz: 0.019 }]), { seg: 18, capTop: true, capBot: true }), 0, 0, 1, SK, MAT.skin);
      else {
        F.put(Geo.loft(RFA, { seg: 18, capTop: true, capBot: true }), 0, 0, 1, CL, MAT.cloth);
        F.put(Geo.loft([{ y: -0.2, rx: 0.034 * bw, rz: 0.031 * bz, wav: knit ? [0.04, 20] : null }, { y: -0.232, rx: 0.033 * bw, rz: 0.03 * bz, wav: knit ? [0.04, 20] : null }], { seg: knit ? 40 : 18, thick: 0.004 }), 0, 0, 1, coat ? shade(s.clothesColor, -0.05) : knit ? shade(s.clothesColor, -0.06) : CL, MAT.cloth);
        F.put(Geo.loft([{ y: -0.215, rx: 0.023, rz: 0.02 }, { y: -0.25, rx: 0.024, rz: 0.019 }], { seg: 14, capBot: true }), 0, 0, 1, SK, MAT.skin);
      }
      // 手（手のひらは体側を向く）
      const palm = Geo.warp(Geo.rbox(0.024, 0.082, 0.074, 0.011), (x, y, z) => { const t = (y + 0.041) / 0.082; return [x * (0.85 + 0.15 * (1 - t)) + sd * 0.002 * (1 - Math.abs(z) / 0.037), y, z * (0.82 + 0.18 * (1 - t))]; });
      F.put(palm, [0, -0.287, 0.002], 0, 1, SK, MAT.skin);
      [[0.026, 0.044], [0.009, 0.05], [-0.008, 0.047], [-0.024, 0.039]].forEach(([z, len], i) => {
        const fg = Geo.loft([{ y: 0, rx: 0.0082, rz: 0.0085 }, { y: -len * 0.5, rx: 0.0075, rz: 0.0078 }, { y: -len, rx: 0.0066, rz: 0.0068 }, { y: -len - 0.006, rx: 0.003, rz: 0.003 }], { seg: 10, capTop: true, capBot: true });
        F.put(fg, [sd * 0.002, -0.322, z], [0, 0, -sd * (0.28 + i * 0.04)], 1, SK, MAT.skin);
      });
      F.put(Geo.loft([{ y: 0, rx: 0.0105, rz: 0.011 }, { y: -0.028, rx: 0.0095, rz: 0.0095 }, { y: -0.048, rx: 0.0078, rz: 0.008 }, { y: -0.054, rx: 0.003, rz: 0.003 }], { seg: 10, capTop: true, capBot: true }), [-sd * 0.004, -0.265, 0.03], [-0.25, 0, -sd * 0.55], 1, SK, MAT.skin);
      if (watch) { F.put(Geo.loft([{ y: -0.226, rx: 0.026, rz: 0.023 }, { y: -0.24, rx: 0.026, rz: 0.023 }], { seg: 18, thick: 0.004 }), 0, 0, 1, rgb('#2A2420'), MAT.leather); F.put(Geo.cyl(0.012, 0.012, 0.005, 16), [sd * 0.027, -0.233, 0], [0, 0, Math.PI / 2], 1, rgb(s.accColor), MAT.metal); }
      return F;
    };
    // ---------- 脚 ----------
    const TH = new Builder();
    TH.put(Geo.loft([{ y: 0.06, rx: 0.06, rz: 0.06 }, { y: 0.02, rx: 0.078, rz: 0.082 }, { y: -0.06, rx: 0.08, rz: 0.083 }, { y: -0.2, rx: 0.072, rz: 0.074 }, { y: -0.33, rx: 0.064, rz: 0.066 }, { y: -0.43, rx: 0.058, rz: 0.06 }].map((r) => Object.assign(r, { rx: r.rx * bw, rz: r.rz * bz })), { seg: 20, capTop: true, capBot: true }), 0, 0, 1, PA, MAT.cloth);
    const SH = new Builder();
    SH.put(Geo.loft([{ y: 0.03, rx: 0.056, rz: 0.058 }, { y: -0.05, rx: 0.059, rz: 0.061 }, { y: -0.2, rx: 0.057, rz: 0.058 }, { y: -0.33, rx: 0.055, rz: 0.056 }, { y: -0.372, rx: 0.054, rz: 0.055 }, { y: -0.372, rx: 0.03, rz: 0.03 }].map((r) => Object.assign(r, { rx: r.rx * bw, rz: r.rz * bz })), { seg: 20, capTop: true, capBot: true }), 0, 0, 1, PA, MAT.cloth);
    const shoe = Geo.warp(Geo.rbox(0.094, 0.082, 0.262, 0.036), (x, y, z) => { const t = Math.max(0, z / 0.131), hb = Math.max(0, -z / 0.131); const top = Math.max(0, y / 0.041); return [x * (1 - 0.3 * t * t - 0.1 * hb * hb) * (1 - 0.12 * top), y - (y > 0 ? 0.034 * smooth(-0.02, 0.12, z) * top : 0), z]; });
    SH.put(shoe, [0, -0.407, 0.045], 0, 1, SHOE, { rough: 0.26 });
    SH.put(Geo.warp(Geo.rbox(0.096, 0.01, 0.266, 0.004), (x, y, z) => { const t = Math.max(0, z / 0.133), hb = Math.max(0, -z / 0.133); return [x * (1 - 0.3 * t * t - 0.1 * hb * hb), y, z]; }), [0, -0.447, 0.045], 0, 1, rgb('#3A302A'), MAT.cloth);
    SH.put(Geo.box(0.03, 0.002, 0.05), [0, -0.37, 0.085], [-0.42, 0, 0], 1, rgb('#15100E'), MAT.cloth);
    // ---------- 腰エプロン（脚の動きに合わせて揺らすので別パーツ） ----------
    let apr = null;
    if (s.apron !== 'none') {
      const A = new Builder(), b0 = coat ? [0.176, 0.12] : knit ? [0.168, 0.113] : [0.162, 0.108];
      const RA = [[0.075, 0, 0], [0.0, 0.01, 0.008], [-0.15, 0.025, 0.022], [-0.33, 0.04, 0.035], [-0.48, 0.05, 0.045]].map(([y, dx, dz]) => ({ y, rx: b0[0] * bw + dx, rz: b0[1] * bz + dz, cz: 0.004 }));
      A.put(Geo.loft(RA, { seg: 44, a0: -2.35, a1: 2.35, thick: 0.004 }), 0, 0, 1, [1, 1, 1], MAT.cloth);
      A.put(Geo.loft([{ y: 0.09, rx: b0[0] * bw + 0.003, rz: b0[1] * bz + 0.003, cz: 0.004 }, { y: 0.06, rx: b0[0] * bw + 0.004, rz: b0[1] * bz + 0.004, cz: 0.004 }], { seg: 40, thick: 0.004 }), 0, 0, 1, shade(s.apronColor, -0.18), MAT.cloth);
      A.put(Geo.loft([{ y: -0.09, rx: b0[0] * bw + 0.016, rz: b0[1] * bz + 0.014, cz: 0.004 }, { y: -0.21, rx: b0[0] * bw + 0.03, rz: b0[1] * bz + 0.026, cz: 0.004 }], { seg: 14, a0: -0.42, a1: 0.42, thick: 0.003 }), 0, 0, 1, shade(s.apronColor, -0.1), MAT.cloth);
      const bk = -(b0[1] * bz + 0.006);
      A.put(SPH(1, 10, 8), [0, 0.075, bk], 0, [0.022, 0.016, 0.012], shade(s.apronColor, -0.18), MAT.cloth);
      [-1, 1].forEach((sd) => { A.put(SPH(1, 10, 8), [sd * 0.028, 0.078, bk + 0.002], [0, 0, sd * 0.3], [0.03, 0.018, 0.008], shade(s.apronColor, -0.18), MAT.cloth); A.put(Geo.rbox(0.016, 0.16, 0.004, 0.002), [sd * 0.014, -0.005, bk - 0.002], [0, 0, sd * 0.12], 1, shade(s.apronColor, -0.18), MAT.cloth); });
      apr = A.build(eng);
    }
    const out = { hip: HIP.build(eng), tor: TOR.build(eng), head: HD.build(eng), ua: UA.build(eng), faL: mkFA(-1, s.acc === 'watch').build(eng), faR: mkFA(1, false).build(eng), th: TH.build(eng), sh: SH.build(eng), apr, aprTex: s.apron !== 'none' ? apronTex(eng, s) : null, bw, hs: { s: 0.95, m: 1, l: 1.05 }[s.height] || 1 };
    ['hip', 'tor', 'head', 'ua', 'faL', 'faR', 'th', 'sh', 'apr'].forEach((k) => out[k] && CS.gl.keep(out[k]));
    partCache[key] = out;
    return out;
  }
  // エプロンの柄（UV にそって描く）
  const apronTexCache = {};
  function apronTex(eng, s) {
    const k = eng.id + s.apronColor + s.pattern;
    if (apronTexCache[k]) return apronTexCache[k];
    const L = s.apronColor.toUpperCase() > '#C' ? shade(s.apronColor, -0.28) : shade(s.apronColor, 0.42);
    const toHex = (c) => '#' + rgb(c).map((v) => ('0' + Math.round(v * 255).toString(16)).slice(-2)).join('');
    const cv = canvas(256, 256, (g, w, h) => {
      g.fillStyle = toHex(s.apronColor); g.fillRect(0, 0, w, h);
      if (s.pattern === 'stripe') { g.fillStyle = toHex(L); for (let i = 0; i < 20; i++) g.fillRect(i * (w / 20) + 3, 0, w / 20 * 0.35, h); }
      if (s.pattern === 'check') { g.fillStyle = toHex(L); g.globalAlpha = 0.55; for (let i = 0; i < 16; i++) { g.fillRect(i * (w / 16), 0, w / 32, h); g.fillRect(0, i * (h / 10), w, h / 20); } g.globalAlpha = 1; }
      for (let i = 0; i < 1800; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.05)'; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
    });
    return (apronTexCache[k] = eng.texFromCanvas(cv, true));
  }
  // ---- 髪型 ----
  function hairLine(x, y, z, o) {
    const a = Math.abs(Math.atan2(x, z));
    let L;
    if (a < 0.8) L = o.front - 0.2 * (a / 0.8) ** 2;
    else if (a < 1.28) L = o.front - 0.2 - (o.front - 0.2 - o.burn) * ((a - 0.8) / 0.48);
    else if (a < 1.85) L = o.ear;
    else L = o.ear - (o.ear - o.nape) * ((a - 1.85) / (Math.PI - 1.85));
    if (o.bang && a < 1.1) L = Math.min(L, o.bang + (o.side ? 0.18 * smooth(-0.6, 0.6, x * o.side) : 0));
    return y - L;
  }
  function hair(B, s, HCOL) {
    const tight = s.hat !== 'none' && s.hat !== 'beret';
    const st = {
      crew: { front: 0.78, burn: 0.12, ear: 0.36, nape: -0.5, k: 1.035, vol: 0.006 },
      short: { front: 0.74, burn: 0.02, ear: 0.32, nape: -0.55, k: 1.07, vol: 0.03, bang: 0.58, side: 1 },
      bob: { front: 0.72, burn: -0.3, ear: -0.35, nape: -0.6, k: 1.075, vol: 0.02, bang: 0.42 },
      long: { front: 0.72, burn: -0.2, ear: -0.3, nape: -0.65, k: 1.07, vol: 0.02, bang: 0.5, side: -1 },
      wavy: { front: 0.72, burn: -0.2, ear: -0.3, nape: -0.65, k: 1.09, vol: 0.035, bang: 0.52, side: 1 },
      pony: { front: 0.74, burn: 0.12, ear: 0.3, nape: -0.55, k: 1.045, vol: 0.01 },
      bun: { front: 0.74, burn: 0.12, ear: 0.3, nape: -0.5, k: 1.045, vol: 0.01 },
      braid: { front: 0.73, burn: 0.1, ear: 0.28, nape: -0.55, k: 1.05, vol: 0.012, bang: 0.6, side: -1 },
    }[s.hair] || { front: 0.74, burn: 0.05, ear: 0.32, nape: -0.55, k: 1.06, vol: 0.02 };
    const k = (x, y) => st.k + (tight ? 0 : st.vol) * Math.max(0, y) + 0.008 * Math.max(0, -y);
    const col = (x, y, z) => { const ph = Math.atan2(x, z); let c = 0.93 + 0.07 * Math.sin(ph * 46 + y * 7) * (0.6 + 0.4 * hashN(Math.round(ph * 23), 1)); if (y > 0.45 && z > -0.2 && Math.abs(x - (st.side ? st.side * 0.18 : 0)) < 0.035) c *= 0.82; if (y < 0) c *= 0.92; return c; };
    headShell(B, (x, y, z) => hairLine(x, y, z, st), k, HCOL, MAT.hair, col, 56);
    const dk = shade(s.hairColor, -0.08);
    const curtain = (rows, a, wav) => { const y0 = rows[rows.length - 1][0]; B.put(Geo.warp(Geo.loft(rows.map(([y, rx, rz, cz]) => ({ y, rx, rz, cz, wav })), { seg: 48, a0: a, a1: TAU - a, thick: 0.007 }), (x, y, z) => { const ph = Math.atan2(x, z); const c = (0.9 + 0.1 * Math.sin(ph * 31 + Math.sin(ph * 7) * 2)) * (1 - 0.18 * Math.max(0, 1 - (y - y0) / 0.06)); return [x, y, z, c, c, c]; }), 0, 0, 1, dk, MAT.hair); };
    if (s.hair === 'bob') curtain([[0.215, 0.066, 0.08, -0.004], [0.18, 0.088, 0.104, -0.006], [0.14, 0.094, 0.109, -0.008], [0.1, 0.093, 0.107, -0.011], [0.062, 0.087, 0.1, -0.013]], 1.0);
    if (s.hair === 'long') curtain([[0.2, 0.068, 0.08, -0.012], [0.15, 0.084, 0.1, -0.016], [0.07, 0.092, 0.108, -0.02], [-0.03, 0.094, 0.11, -0.034], [-0.13, 0.094, 0.106, -0.044], [-0.2, 0.088, 0.098, -0.046]], 1.3);
    if (s.hair === 'wavy') curtain([[0.2, 0.072, 0.088, -0.01], [0.14, 0.096, 0.112, -0.012], [0.06, 0.102, 0.116, -0.02], [-0.02, 0.104, 0.114, -0.03], [-0.08, 0.098, 0.106, -0.034]], 1.1, [0.07, 11]);
    if (s.hair === 'pony') { B.put(Geo.loft([{ y: 0.21, rx: 0.022, rz: 0.02, cz: -0.112 }, { y: 0.17, rx: 0.03, rz: 0.028, cz: -0.13 }, { y: 0.08, rx: 0.029, rz: 0.026, cz: -0.14 }, { y: -0.02, rx: 0.022, rz: 0.02, cz: -0.135 }, { y: -0.09, rx: 0.008, rz: 0.008, cz: -0.125 }], { seg: 16, capTop: true, capBot: true }), 0, 0, 1, HCOL, MAT.hair); B.put(Geo.torus(0.017, 0.005, 6, 16), [0, 0.2, -0.115], [Math.PI / 2 - 0.5, 0, 0], 1, rgb('#2A2420'), MAT.gloss); }
    if (s.hair === 'bun') B.put(Geo.warp(SPH(1, 18, 12), (x, y, z) => { const w = 1 + 0.06 * Math.sin(Math.atan2(x, z) * 6 + y * 4); return [x * 0.047 * w, y * 0.04 * w, z * 0.045 * w]; }), [0, 0.245, -0.088], [0.6, 0, 0], 1, HCOL, MAT.hair);
    if (s.hair === 'braid') for (let i = 0; i < 8; i++) B.put(SPH(1, 10, 8), [(i % 2 ? 0.006 : -0.006), 0.14 - i * 0.038, -0.108 - Math.min(i, 3) * 0.008], [0, 0, (i % 2 ? 0.4 : -0.4)], [0.022, 0.028, 0.019], i % 2 ? HCOL : dk, MAT.hair);
  }
  function hat(B, s) {
    const C = rgb(s.hatColor), dk = shade(s.hatColor, -0.07), tilt = about(HC, [-0.14, 0, 0]);
    const band = (y0, y1, rx, rz, col, wav) => B.put(Geo.loft([{ y: y0, rx, rz, cz: -0.004, wav }, { y: y1, rx: rx + 0.003, rz: rz + 0.003, cz: -0.005, wav }], { seg: wav ? 64 : 36, thick: 0.005 }), 0, 0, 1, col, MAT.cloth, tilt);
    switch (s.hat) {
      case 'chef':
        band(0.2, 0.258, 0.087, 0.103, dk);
        B.put(Geo.loft([{ y: 0.255, rx: 0.088, rz: 0.104, cz: -0.005 }, { y: 0.3, rx: 0.103, rz: 0.118, cz: -0.006, wav: [0.05, 14] }, { y: 0.37, rx: 0.118, rz: 0.13, cz: -0.008, wav: [0.06, 14] }, { y: 0.41, rx: 0.118, rz: 0.128, cz: -0.009, wav: [0.05, 14] }, { y: 0.428, rx: 0.095, rz: 0.104, cz: -0.009, wav: [0.03, 14] }, { y: 0.437, rx: 0.045, rz: 0.05, cz: -0.009 }], { seg: 84, capTop: true }), 0, 0, 1, C, MAT.cloth, tilt);
        break;
      case 'chefS':
        band(0.2, 0.25, 0.087, 0.103, dk);
        B.put(Geo.loft([{ y: 0.248, rx: 0.088, rz: 0.104, cz: -0.005 }, { y: 0.275, rx: 0.098, rz: 0.113, cz: -0.006, wav: [0.04, 10] }, { y: 0.298, rx: 0.08, rz: 0.092, cz: -0.006, wav: [0.03, 10] }, { y: 0.306, rx: 0.03, rz: 0.035, cz: -0.006 }], { seg: 60, capTop: true }), 0, 0, 1, C, MAT.cloth, tilt);
        break;
      case 'cap':
        headShell(B, (x, y) => y - 0.32, (x, y) => 1.1 + 0.03 * Math.max(0, y), C, MAT.cloth, (x, y, z) => (Math.abs(Math.sin(Math.atan2(x, z) * 3)) < 0.04 && y > 0.4 ? 0.85 : 1), 40);
        B.put(Geo.warp(Geo.rbox(0.15, 0.008, 0.08, 0.004), (x, y, z) => [x * (1 - 0.35 * Math.max(0, z / 0.04) ** 2), y - 0.012 * (x / 0.075) ** 2, z]), [0, 0.205, 0.128], [0.12, 0, 0], 1, dk, MAT.cloth);
        B.put(SPH(0.008, 8, 6), [0, 0.282, -0.003], 0, 1, dk, MAT.cloth);
        break;
      case 'bandana':
        band(0.175, 0.225, 0.088, 0.106, C);
        B.put(SPH(1, 10, 8), [0.012, 0.19, -0.118], 0, [0.02, 0.016, 0.012], dk, MAT.cloth);
        [-1, 1].forEach((sd) => B.put(Geo.rbox(0.018, 0.06, 0.004, 0.002), [0.012 + sd * 0.012, 0.155, -0.12], [0.2, 0, sd * 0.35], 1, dk, MAT.cloth));
        break;
      case 'kerchief':
        headShell(B, (x, y, z) => Math.min(y - 0.28 + (z < 0 ? 0.5 * -z : 0), 1), () => 1.1, C, MAT.cloth, null, 40);
        B.put(SPH(1, 10, 8), [0, 0.11, -0.112], 0, [0.024, 0.018, 0.014], dk, MAT.cloth);
        B.put(Geo.warp(SPH(1, 12, 8), (x, y, z) => [x * 0.03 * (1 - 0.5 * Math.max(0, -y)), y * 0.045, z * 0.006]), [0, 0.06, -0.112], 0, 1, C, MAT.cloth);
        break;
      case 'beret':
        B.put(Geo.warp(SPH(1, 28, 14), (x, y, z) => [x * 0.118, y * (y > 0 ? 0.036 : 0.02), z * 0.124]), [-0.012, 0.258, -0.012], [-0.18, 0, 0.16], 1, C, MAT.cloth);
        B.put(Geo.cyl(0.003, 0.003, 0.012, 6), [-0.025, 0.296, -0.02], [0, 0, 0.2], 1, dk, MAT.cloth);
        break;
      default: break;
    }
  }
  // 骨格を組む
  function character(eng, skin) {
    const P = buildParts(eng, skin);
    const root = new Node();
    const body = root.add(new Node()); body.s = [P.hs, P.hs, P.hs];
    const hip = body.add(new Node(P.hip)); hip.p = [0, 0.88, 0];
    const tor = hip.add(new Node(P.tor)); tor.p = [0, 0.06, 0];
    const head = tor.add(new Node(P.head)); head.p = [0, 0.47, 0];
    const mkArm = (sd, fa) => { const u = tor.add(new Node(P.ua)); u.p = [sd * 0.196 * P.bw, 0.378, 0]; const f = u.add(new Node(fa)); f.p = [0, -0.27, 0]; return [u, f]; };
    const [uaL, faL] = mkArm(-1, P.faL), [uaR, faR] = mkArm(1, P.faR);
    const mkLeg = (sd) => { const t = hip.add(new Node(P.th)); t.p = [sd * 0.088 * P.bw, -0.02, 0]; const k = t.add(new Node(P.sh)); k.p = [0, -0.41, 0]; return [t, k]; };
    const [thL, knL] = mkLeg(-1), [thR, knR] = mkLeg(1);
    let apr = null;
    if (P.apr) { apr = hip.add(new Node(P.apr)); apr.p = [0, 0.0, 0]; if (P.aprTex) apr.tex = P.aprTex; else apr.color = rgb((Object.assign({}, D.DEFAULT_SKIN, skin || {})).apronColor); }
    const ch = { node: root, body, hip, tor, head, uaL, faL, uaR, faR, thL, knL, thR, knR, apr, phase: Math.random() * 10, w: 0 };
    ch.anim = function (dt, mode, speed) {
      const k = 1 - Math.exp(-dt * 10);
      const L = (n, i, v) => { n.r[i] += (v - n.r[i]) * k; };
      ch.phase += dt * (mode === 'walk' ? 7.2 * clamp01(speed || 1, 0.5, 1.4) : mode === 'work' ? 5 : 1.4);
      const t = ch.phase;
      if (mode === 'walk') {
        const sw = Math.sin(t), cs = Math.cos(t);
        L(thL, 0, -sw * 0.42); L(thR, 0, sw * 0.42);
        L(knL, 0, Math.max(0, cs) * 0.75 + 0.06); L(knR, 0, Math.max(0, -cs) * 0.75 + 0.06);
        L(uaL, 0, sw * 0.32); L(uaR, 0, -sw * 0.32); L(uaL, 2, -0.07); L(uaR, 2, 0.07);
        L(faL, 0, -0.25 - Math.max(0, -sw) * 0.25); L(faR, 0, -0.25 - Math.max(0, sw) * 0.25);
        hip.p[1] = 0.875 + Math.abs(cs) * 0.016 - 0.01; L(hip, 1, -sw * 0.06); L(tor, 1, sw * 0.1); L(head, 1, -sw * 0.04); L(tor, 0, 0.035); L(head, 0, 0);
      } else if (mode === 'work') {
        L(thL, 0, 0); L(thR, 0, 0); L(knL, 0, 0.02); L(knR, 0, 0.02); L(hip, 1, 0);
        L(uaL, 0, -0.7 + Math.sin(t) * 0.1); L(uaR, 0, -0.7 + Math.cos(t * 1.1) * 0.1); L(uaL, 2, 0.1); L(uaR, 2, -0.1);
        L(faL, 0, -0.8 + Math.sin(t * 1.3) * 0.12); L(faR, 0, -0.8 + Math.cos(t) * 0.12);
        hip.p[1] = 0.88; L(tor, 0, 0.12); L(tor, 1, 0); L(head, 0, 0.3); L(head, 1, Math.sin(t * 0.3) * 0.08);
      } else if (mode === 'sit') {
        L(thL, 0, -1.5); L(thR, 0, -1.5); L(knL, 0, 1.45); L(knR, 0, 1.45); L(hip, 1, 0);
        L(uaL, 0, -0.55); L(uaR, 0, -0.7 + Math.sin(t * 0.8) * 0.15); L(uaL, 2, 0.05); L(uaR, 2, -0.05);
        L(faL, 0, -0.9); L(faR, 0, -1.2 + Math.sin(t * 0.8) * 0.2);
        hip.p[1] = 0.5; L(tor, 0, 0.12); L(tor, 1, 0); L(head, 0, 0.18 + Math.sin(t * 0.5) * 0.05); L(head, 1, Math.sin(t * 0.3) * 0.2);
      } else if (mode === 'happy') {
        L(uaL, 0, 0.02); L(uaL, 2, -0.08); L(uaR, 0, -0.35); L(uaR, 2, 2.3 + Math.sin(t * 6) * 0.15); L(faR, 0, -0.3);
        L(head, 0, -0.06); L(hip, 1, 0); hip.p[1] = 0.88 + Math.abs(Math.sin(t * 3)) * 0.008;
      } else {
        L(thL, 0, 0); L(thR, 0, 0); L(knL, 0, 0.03); L(knR, 0, 0.03); L(hip, 1, 0);
        L(uaL, 0, 0.03 + Math.sin(t) * 0.015); L(uaR, 0, 0.03 - Math.sin(t) * 0.015); L(uaL, 2, -0.1); L(uaR, 2, 0.1);
        L(faL, 0, -0.14); L(faR, 0, -0.14);
        hip.p[1] = 0.88 + Math.sin(t) * 0.002; L(tor, 0, 0.01 + Math.sin(t) * 0.008); L(tor, 1, 0); L(head, 0, 0.02); L(head, 1, Math.sin(t * 0.35) * 0.14);
      }
      if (apr) { const f = Math.min(0, thL.r[0], thR.r[0]); apr.r[0] += (f * 0.85 - apr.r[0]) * k; }
    };
    return ch;
  }
  const clamp01 = (v, a, b) => Math.max(a, Math.min(b, v));

  // =====================================================================
  //  ケーキ（写実寄り）
  // =====================================================================
  const cakeCache = {};
  const GL = { sponge: { rough: 0.9 }, cream: { rough: 0.42 }, glaze: { rough: 0.12 }, fruit: { rough: 0.22 }, plate: { rough: 0.15 }, crust: { rough: 0.75 } };
  function strawberry(B, p, s, rot) {
    B.put(Geo.cyl(0.0, 0.016, 0.03, 12), [p[0], p[1] + 0.017 * s, p[2]], [PI + (rot || 0), 0, 0], [s, s, s], rgb('#C8102E'), GL.fruit);
    B.put(Geo.sphere(0.016, 12, 8, 0, PI / 2), [p[0], p[1] + 0.032 * s, p[2]], 0, [s, s * 0.5, s], rgb('#C8102E'), GL.fruit);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; B.put(Geo.box(0.004, 0.0015, 0.012), [p[0] + Math.sin(a) * 0.006 * s, p[1] + 0.037 * s, p[2] + Math.cos(a) * 0.006 * s], [0.3, a, 0], [s, s, s], rgb('#3E8E3A'), GL.cream); }
  }
  function topPiece(B, kind, p, s, opt) {
    s = s || 1;
    switch (kind) {
      case 'strawberry': strawberry(B, p, s); break;
      case 'blueberry': [[-0.008, 0], [0.008, 0.002], [0, -0.008]].forEach((o) => B.put(SPH(0.0075, 10, 8), [p[0] + o[0] * s, p[1] + 0.007 * s, p[2] + o[1] * s], 0, s, rgb('#2E3560'), GL.fruit)); break;
      case 'peach': B.put(Geo.sphere(0.02, 12, 8, 0, PI / 2), [p[0], p[1], p[2]], [0, (opt && opt.a) || 0, PI / 2], [s * 0.5, s * 1.2, s * 0.9], rgb('#F6A06B'), GL.fruit); break;
      case 'lemon': B.put(Geo.cyl(0.017, 0.017, 0.004, 16), [p[0], p[1] + 0.012 * s, p[2]], [1.1, 0, 0], s, rgb('#F7D94C'), GL.fruit); B.put(Geo.cyl(0.0145, 0.0145, 0.0042, 16), [p[0], p[1] + 0.012 * s, p[2]], [1.1, 0, 0], s, rgb('#FFF3B0'), GL.fruit); break;
      case 'choco': B.put(Geo.box(0.028, 0.002, 0.018), [p[0], p[1] + 0.012 * s, p[2]], [0.5, (opt && opt.a) || 0.3, 0.1], s, rgb('#3B2116'), GL.glaze); break;
      case 'chestnut': B.put(SPH(0.014, 12, 10), [p[0], p[1] + 0.013 * s, p[2]], 0, [s, s * 1.2, s], rgb('#9A5A22'), GL.glaze); break;
      default: break;
    }
  }
  function rosette(B, p, col, s) { B.put(Geo.cyl(0.0, 0.011, 0.016, 10), [p[0], p[1] + 0.009 * s, p[2]], 0, s, col, GL.cream); B.put(Geo.torus(0.008, 0.0045, 6, 12), [p[0], p[1] + 0.004 * s, p[2]], [PI / 2, 0, 0], s, col, GL.cream); }
  // 切ったケーキの切れ目（中心から6本）
  function cutLines(B, pieces, R, h, th0, col) {
    const list = pieces >= 6 ? [0, 1, 2, 3, 4, 5] : Array.from({ length: Math.max(0, pieces - 1) }, (_, k) => k + 1);
    for (const i of list) { const a = th0 + (i / 6) * PI * 2; B.put(Geo.box(0.0016, h + 0.004, R), [Math.sin(a) * R / 2, h / 2, Math.cos(a) * R / 2], [0, a, 0], 1, shade(col, -0.08), GL.sponge); }
  }
  function cake(eng, r, pieces, scale, df, cut) {
    pieces = pieces == null ? 6 : pieces;
    df = df || [];
    const key = eng.id + '|' + r.base + r.cream + JSON.stringify(r.tops || {}) + '|' + pieces + '|' + df.slice().sort().join(',') + (cut ? '|c' : '');
    if (cakeCache[key]) { const n = new Node(cakeCache[key]); if (scale) n.s = [scale, scale, scale]; return n; }
    const B = new Builder();
    const base = D.BASES[r.base] || D.BASES.plain, cr = D.CREAMS[r.cream] || D.CREAMS.none;
    const burnt = df.includes('burnt'), flat = df.includes('flat'), melt = df.includes('melt'), messy = df.includes('messy') || df.includes('uneven'), tilt = df.includes('tilt'), sep = df.includes('sep');
    const SP = burnt ? mix(base.color, '#2A160C', 0.55) : rgb(base.color), CRUMB = burnt ? rgb('#24130A') : rgb(base.crumb);
    const CR = cr.color ? (sep ? mix(cr.color, '#E8D9A8', 0.4) : rgb(cr.color)) : null;
    const th = (pieces / 6) * PI * 2, th0 = PI, R = 0.09, hk = flat ? 0.75 : 1;
    const jit = () => (messy ? (Math.random() - 0.5) * 0.02 : 0);
    const tl = []; for (const k in r.tops || {}) for (let i = 0; i < r.tops[k]; i++) tl.push(k);
    if (pieces > 0 && base.cookie) {
      // 焼き菓子：かごに並べる（残り個数ぶん）
      const n = Math.min(8, pieces);
      B.put(Geo.loft([{ y: 0.03, rx: 0.112, rz: 0.086 }, { y: 0.0, rx: 0.1, rz: 0.075 }], { seg: 32, thick: 0.006, capBot: true }), [0, 0.004, 0], 0, 1, rgb('#B98A55'), { rough: 0.8 });
      B.put(Geo.cyl(0.098, 0.098, 0.004, 32), [0, 0.008, 0], 0, [1, 1, 0.75], rgb('#F2EEE6'), { rough: 0.9 });
      const SP2 = burnt ? mix(base.color, '#2A160C', 0.6) : base.shell && tl.includes('choco') ? mix(base.color, '#5A3322', 0.7) : rgb(base.color);
      for (let i = 0; i < n; i++) {
        const row = i < 4 ? 0 : 1, k = i % 4, x = -0.06 + k * 0.04, z = row ? -0.025 : 0.02, y = 0.016 + row * 0.006;
        if (base.shell) { B.put(Geo.warp(SPH(1, 14, 8), (px, py, pz) => [px * 0.016 * (1 + 0.06 * Math.cos(Math.atan2(px, pz) * 9)), py * (py > 0 ? 0.008 : 0.003), pz * 0.024 * (pz > 0 ? 1 : 0.8)]), [x, y, z], [0.25, 0.3 * (k - 1.5), 0], 1, shade(SP2, (k % 2) * 0.04), GL.crust); }
        else {
          B.put(Geo.cyl(0.017, 0.017, 0.006, 16), [x, y, z], [0.3, 0, 0.1 * (k - 1.5)], 1, shade(SP2, (k % 2) * 0.05 - 0.02), GL.crust);
          if (tl.includes('choco')) for (let c2 = 0; c2 < 4; c2++) B.put(SPH(0.0028, 5, 4), [x + Math.cos(c2 * 1.7 + i) * 0.009, y + 0.004, z + Math.sin(c2 * 1.7 + i) * 0.007 + 0.002], 0, 1, rgb('#3B2116'), GL.glaze);
        }
        if (tl.includes('lemon') && base.shell) B.put(SPH(0.003, 5, 4), [x, y + 0.006, z], 0, 1, rgb('#F7E27C'), GL.glaze);
      }
    } else if (pieces > 0) {
      if (base.tart) {
        B.put(Geo.cyl(R, R * 0.96, 0.008, 28, th0, th), [0, 0.004, 0], 0, 1, CRUMB, GL.crust);
        B.put(Geo.cyl(R, R * 0.97, 0.026, 28, th0, th, true), [0, 0.017, 0], 0, 1, SP, GL.crust);
        const n = Math.round(30 * pieces / 6); for (let i = 0; i < n; i++) { const a = th0 + ((i + 0.5) / n) * th; B.put(Geo.cyl(0.0055, 0.006, 0.027, 6), [Math.sin(a) * R, 0.017, Math.cos(a) * R], 0, 1, SP, GL.crust); }
        if (CR) B.put(Geo.cyl(R * 0.93, R * 0.93, 0.018, 28, th0, th), [0, 0.02, 0], 0, 1, CR, r.cream === 'custard' ? GL.glaze : GL.cream);
        if (r.cream === 'maron') { for (let ring = 0; ring < 5; ring++) { const rr = 0.07 - ring * 0.013, y = 0.034 + ring * 0.01; const segs = Math.max(4, Math.round(16 * rr / 0.07)); for (let i = 0; i < segs; i++) { const a = th0 + (i / segs) * th; B.put(Geo.cyl(0.0045, 0.0045, 0.02, 6), [Math.sin(a) * rr, y + Math.sin(i * 1.7) * 0.003, Math.cos(a) * rr], [PI / 2, a + PI / 2, 0], 1, shade(cr.color, (i % 2) * 0.05 - 0.02), GL.cream); } } for (let i = 0; i < 14; i++) B.put(SPH(0.0018, 4, 3), [Math.sin(i * 2.3) * 0.04, 0.085, Math.cos(i * 1.7) * 0.04], 0, 1, [0.98, 0.98, 0.98], GL.sponge); }
        const topY = r.cream === 'maron' ? 0.08 : 0.03;
        tl.forEach((k, i) => { const a = th0 + ((i + 0.5) / Math.max(1, tl.length)) * th; const rr = tl.length > 1 ? 0.045 : 0; if (pieces === 6 || Math.sin(a) !== 0) topPiece(B, k, [Math.sin(a) * rr + jit(), topY, Math.cos(a) * rr + jit()], 1.1, { a }); });
      } else if (base.layered || base.ring || !CR) {
        const lay = [];
        if (r.base === 'cheese' && !CR) { lay.push([CRUMB, 0.008 * hk, GL.crust], [SP, 0.05 * hk, GL.sponge]); }
        else if (CR) { lay.push([SP, 0.028 * hk, GL.sponge], [CR, 0.013, GL.cream], [SP, 0.028 * hk, GL.sponge], [CR, 0.006, GL.cream]); }
        else lay.push([SP, 0.07 * hk, GL.sponge]);
        let y = 0;
        lay.forEach(([c, h, m], li) => { B.put(Geo.cyl(R, R, h, 32, th0, th), [tilt ? (li - 1.5) * 0.004 : 0, y + h / 2, 0], tilt ? [0, 0, 0.05] : 0, 1, c, m); y += h; });
        // 断面のフルーツ
        if (CR && pieces < 6 && tl.some((k) => k !== 'choco' && k !== 'chestnut')) {
          const fk = tl.find((k) => k !== 'choco' && k !== 'chestnut'); const fc = { strawberry: '#C8102E', blueberry: '#2E3560', peach: '#F6A06B', lemon: '#F7D94C' }[fk];
          [th0, th0 + th].forEach((a) => { for (let i = 1; i <= 3; i++) { const rr = R * (i / 3.6); B.put(SPH(0.008, 8, 6), [Math.sin(a) * rr, 0.034 * hk, Math.cos(a) * rr], 0, [1, 0.8, 1], rgb(fc), GL.fruit); } });
        }
        if (r.base === 'cheese' && !CR) B.put(Geo.cyl(R * 0.99, R, 0.003, 32, th0, th), [0, y + 0.0015, 0], 0, 1, burnt ? rgb('#1E0F08') : mix(base.crumb, base.color, 0.25), GL.crust);
        if (CR) {
          const topY = y + (melt ? -0.004 : 0);
          B.put(Geo.cyl(R + 0.004, R + 0.004, y, 32, th0, th, true), [0, y / 2, 0], 0, 1, CR, GL.cream);
          if (melt) for (let i = 0; i < 8 * pieces / 6; i++) { const a = th0 + ((i + 0.3) / (8 * pieces / 6)) * th; B.put(SPH(0.006, 6, 4), [Math.sin(a) * (R + 0.004), y * 0.5, Math.cos(a) * (R + 0.004)], 0, [1, 2.4, 1], CR, GL.cream); }
          if (r.cream === 'choco') B.put(Geo.cyl(R + 0.0045, R + 0.0045, 0.004, 32, th0, th), [0, y + 0.002, 0], 0, 1, rgb('#3A2116'), GL.glaze);
          const n = Math.max(1, Math.round(pieces * 2));
          for (let i = 0; i < n; i++) { const a = th0 + ((i + 0.5) / n) * th; rosette(B, [Math.sin(a) * R * 0.84 + jit(), topY, Math.cos(a) * R * 0.84 + jit()], r.cream === 'choco' ? rgb('#5A3322') : CR, messy ? 0.8 + Math.random() * 0.5 : 1); }
          if (r.cream === 'matcha' || r.base === 'matcha') for (let i = 0; i < 18 * pieces / 6; i++) { const a = th0 + Math.random() * th, rr = Math.random() * R * 0.75; B.put(SPH(0.0022, 4, 3), [Math.sin(a) * rr, topY + 0.001, Math.cos(a) * rr], 0, [1, 0.3, 1], rgb('#6E8A46'), GL.sponge); }
          if (tl.length) for (let i = 0; i < pieces; i++) { const a = th0 + ((i + 0.5) / 6) * PI * 2; topPiece(B, tl[i % tl.length], [Math.sin(a) * R * 0.55 + jit(), topY, Math.cos(a) * R * 0.55 + jit()], 1, { a }); }
          if (tl.length && pieces === 6) topPiece(B, tl[0], [0, topY, 0], 1.2);
        } else if (tl.length) { for (let i = 0; i < pieces; i++) { const a = th0 + ((i + 0.5) / 6) * PI * 2; topPiece(B, tl[i % tl.length], [Math.sin(a) * R * 0.6 + jit(), y, Math.cos(a) * R * 0.6 + jit()], 1, { a }); } }
        if (base.ring && pieces === 6) B.put(Geo.cyl(0.018, 0.018, 0.002, 16), [0, y + 0.012, 0], 0, 1, rgb('#4A3A2A'), GL.sponge);
        if (cut) cutLines(B, pieces, R + 0.005, y + 0.002, th0, burnt ? '#24130A' : base.crumb);
      }
      if (cut && base.tart) cutLines(B, pieces, R + 0.003, 0.03, th0, burnt ? '#24130A' : base.crumb);
    }
    // お皿
    B.put(Geo.cyl(0.115, 0.1, 0.008, 36), [0, -0.004, 0], 0, 1, rgb('#F6F4F0'), GL.plate);
    B.put(Geo.torus(0.108, 0.003, 6, 36), [0, 0.0, 0], [PI / 2, 0, 0], 1, rgb('#C9A96E'), { rough: 0.25, metal: 1 });
    const meshes = CS.gl.keep(B.build(eng));
    cakeCache[key] = meshes;
    const n = new Node(meshes);
    if (scale) n.s = [scale, scale, scale];
    return n;
  }

  // =====================================================================
  //  質感テクスチャ（キャンバスで生成）
  // =====================================================================
  function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function noise(g, w, h, n, a, cols) { for (let k = 0; k < n; k++) { g.fillStyle = cols[k % cols.length]; g.globalAlpha = rnd() * a; const s = 1 + rnd() * 3; g.fillRect(rnd() * w, rnd() * h, s, s); } g.globalAlpha = 1; }
  const TX = {
    // 木目（u=1m）
    wood: (c1, c2, plank) => canvas(512, 512, (g, w, h) => {
      g.fillStyle = c1; g.fillRect(0, 0, w, h);
      const pw = plank || 80;
      for (let x = 0; x < w; x += pw) {
        g.fillStyle = rnd() < 0.5 ? c1 : mix2(c1, c2, 0.25 + rnd() * 0.3); g.fillRect(x, 0, pw, h);
        for (let k = 0; k < 26; k++) {
          g.strokeStyle = c2; g.globalAlpha = 0.08 + rnd() * 0.18; g.lineWidth = 0.6 + rnd() * 1.8;
          const x0 = x + rnd() * pw, amp = 2 + rnd() * 5, fr = 0.01 + rnd() * 0.02, ph = rnd() * 10;
          g.beginPath(); for (let y = 0; y <= h; y += 8) { const xx = x0 + Math.sin(y * fr + ph) * amp; y ? g.lineTo(xx, y) : g.moveTo(xx, y); } g.stroke();
        }
        g.globalAlpha = 0.35; g.fillStyle = c2; g.fillRect(x, 0, 1.5, h); g.globalAlpha = 1;
      }
    }),
    marble: () => canvas(512, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#F4F2EE'); gr.addColorStop(1, '#ECE8E2'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      noise(g, w, h, 1800, 0.08, ['#BDB7AE', '#FFFFFF']);
      for (let v = 0; v < 9; v++) {
        let x = rnd() * w, y = rnd() * h, ang = rnd() * Math.PI * 2;
        const width = 0.5 + rnd() * 2.2, al = 0.12 + rnd() * 0.25;
        for (let pass = 0; pass < 3; pass++) {
          g.strokeStyle = pass ? '#8E877D' : '#B3ACA2'; g.globalAlpha = al / (pass + 1); g.lineWidth = width * (3 - pass);
          g.beginPath(); let xx = x, yy = y, a = ang; g.moveTo(xx, yy);
          for (let i = 0; i < 60; i++) { a += (rnd() - 0.5) * 0.6; xx += Math.cos(a) * 9; yy += Math.sin(a) * 9; g.lineTo(xx, yy); }
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    }),
    // 石タイルの床（50cm 角 → 1m に 2×2）
    floor: () => canvas(512, 512, (g, w) => {
      const n = 2, s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const t = rnd() * 0.06;
        g.fillStyle = mix2('#D8CFC3', '#C9BDAE', t * 8); g.fillRect(i * s, j * s, s, s);
        noise(g, s, s, 0, 0, ['#000']);
        for (let k = 0; k < 900; k++) { g.fillStyle = rnd() < 0.5 ? '#B8AC9C' : '#EDE6DC'; g.globalAlpha = rnd() * 0.25; g.fillRect(i * s + rnd() * s, j * s + rnd() * s, 1.5, 1.5); }
        g.globalAlpha = 1;
      }
      g.strokeStyle = '#9C9184'; g.lineWidth = 4; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, w); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
    }),
    // 厨房の床：小さめの磁器タイル（15cm 角、テクスチャ1枚で 60cm）
    ktile: () => canvas(512, 512, (g, w) => {
      const n = 4, t = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = mix2('#CFD1CD', '#BDBFBB', rnd()); g.fillRect(i * t, j * t, t, t); for (let k = 0; k < 160; k++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.08)'; g.fillRect(i * t + rnd() * t, j * t + rnd() * t, 2, 2); } }
      g.strokeStyle = '#8F918D'; g.lineWidth = 5; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, w); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(w, i * t); g.stroke(); }
    }),
    // 売り場の床：オークのフローリング（板幅15cm・千鳥張り、テクスチャ1枚で 1.2m）
    parquet: () => canvas(512, 512, (g, w) => {
      const rows = 8, rh = w / rows, L = 256;
      for (let r = 0; r < rows; r++) {
        const off = Math.floor(rnd() * 4) * 64;
        for (let k = -1; k < 3; k++) {
          const x = off + k * L, base = mix2('#B98A5A', '#9E6F45', rnd());
          [x, x - w, x + w].forEach((xx) => { if (xx + L < 0 || xx > w) return; g.fillStyle = base; g.fillRect(xx, r * rh, L, rh); });
          for (let q = 0; q < 9; q++) { g.strokeStyle = 'rgba(80,50,25,' + (0.08 + rnd() * 0.15) + ')'; g.lineWidth = 0.8 + rnd(); const y0 = r * rh + rnd() * rh; const amp = 1 + rnd() * 3; [x, x - w, x + w].forEach((xx) => { g.beginPath(); for (let t2 = 0; t2 <= L; t2 += 16) { const yy = y0 + Math.sin((t2 + q * 30) * 0.03) * amp; t2 ? g.lineTo(xx + t2, yy) : g.moveTo(xx, yy); } g.stroke(); }); }
          g.fillStyle = 'rgba(40,25,12,.55)'; [x, x - w, x + w].forEach((xx) => g.fillRect(xx, r * rh, 2, rh));
        }
        g.fillStyle = 'rgba(40,25,12,.5)'; g.fillRect(0, r * rh, w, 2);
      }
    }),
    plaster: (c) => canvas(256, 256, (g, w, h) => { g.fillStyle = c || '#EFE8DD'; g.fillRect(0, 0, w, h); noise(g, w, h, 2500, 0.06, ['#C9BFAE', '#FFFFFF']); }),
    panel: () => canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#F2EEE8'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(120,105,90,.35)'; g.lineWidth = 3; g.strokeRect(24, 30, w / 2 - 36, h - 60); g.strokeRect(w / 2 + 12, 30, w / 2 - 36, h - 60);
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.strokeRect(27, 33, w / 2 - 42, h - 66); g.strokeRect(w / 2 + 15, 33, w / 2 - 42, h - 66);
    }),
    // 倉庫の床（コンクリート・1.5mごとの目地）と、外壁（波板）
    concrete: () => canvas(512, 512, (g, w, h) => { g.fillStyle = '#B9B6B0'; g.fillRect(0, 0, w, h); noise(g, w, h, 7000, 0.12, ['#9E9A93', '#D3D0CA']); g.strokeStyle = 'rgba(90,86,80,.45)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3); }),
    siding: () => canvas(256, 256, (g, w, h) => { for (let x = 0; x < w; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, '#AEB7B2'); gr.addColorStop(0.45, '#E3E8E4'); gr.addColorStop(1, '#A3ACA7'); g.fillStyle = gr; g.fillRect(x, 0, 16, h); } noise(g, w, h, 900, 0.06, ['#8F9893', '#FFFFFF']); }),
    asphalt: () => canvas(256, 256, (g, w, h) => { g.fillStyle = '#6B6B6E'; g.fillRect(0, 0, w, h); noise(g, w, h, 3000, 0.25, ['#4A4A4D', '#8A8A8D']); }),
    sidewalk: () => canvas(256, 256, (g, w, h) => { g.fillStyle = '#B9B4AC'; g.fillRect(0, 0, w, h); noise(g, w, h, 1500, 0.15, ['#9E988F', '#D2CDC5']); g.strokeStyle = '#8F897F'; g.lineWidth = 3; g.strokeRect(0, 0, w, h); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); }),
    grass: () => canvas(256, 256, (g, w) => { g.fillStyle = '#6E9A4E'; g.fillRect(0, 0, w, w); for (let k = 0; k < 2500; k++) { g.fillStyle = rnd() < 0.5 ? '#5E8A40' : '#86B263'; g.fillRect(rnd() * w, rnd() * w, 1.5, 4); } }),
    brushed: () => canvas(256, 256, (g, w, h) => { g.fillStyle = '#C9CDD2'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y++) { g.fillStyle = rnd() < 0.5 ? '#B8BDC3' : '#DADDE1'; g.globalAlpha = rnd() * 0.5; g.fillRect(0, y, w, 1); } g.globalAlpha = 1; }),
    shadow: () => canvas(64, 64, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(20,14,10,.55)'); gr.addColorStop(0.6, 'rgba(20,14,10,.2)'); gr.addColorStop(1, 'rgba(20,14,10,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }),
    sky: () => canvas(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5E8FC4'); gr.addColorStop(0.45, '#A8C8E6'); gr.addColorStop(0.5, '#DCE6EE'); gr.addColorStop(1, '#C9C2B8'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }),
    facade: () => canvas(256, 256, (g, w, h) => { g.fillStyle = '#8C4A3A'; g.fillRect(0, 0, w, h); const bh = 16, bw = 48; for (let y = 0; y < h; y += bh) for (let x = -((y / bh) % 2) * bw / 2; x < w; x += bw) { g.fillStyle = mix2('#9A5442', '#7A3E30', rnd()); g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3); } }),
    sign: (name) => canvas(1024, 256, (g, w, h) => {
      g.fillStyle = '#1F2A24'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#C9A96E'; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = '#E8D3A6'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 96; g.font = `600 ${fs}px "Shippori Mincho B1","Zen Old Mincho",serif`;
      while (g.measureText(name).width > w - 120 && fs > 30) { fs -= 6; g.font = `600 ${fs}px "Shippori Mincho B1","Zen Old Mincho",serif`; }
      g.fillText(name, w / 2, h / 2 - 8);
      g.font = '500 28px "Zen Kaku Gothic New",sans-serif'; g.fillStyle = '#C9A96E'; g.fillText('PÂTISSERIE', w / 2, h - 46);
    }),
    // 厨房の壁のサブウェイタイル（u=1m で 8×16 枚）
    subway: () => canvas(512, 512, (g, w, h) => {
      g.fillStyle = '#CFC9C0'; g.fillRect(0, 0, w, h);
      const tw = 64, th = 32;
      for (let y = 0; y < h; y += th) for (let x = -((y / th) % 2) * tw / 2; x < w; x += tw) {
        const gr = g.createLinearGradient(0, y, 0, y + th); const base = mix2('#F7F5F1', '#ECE8E1', rnd());
        gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.18, base); gr.addColorStop(0.85, base); gr.addColorStop(1, '#DCD7CF');
        g.fillStyle = gr; g.fillRect(x + 2, y + 2, tw - 4, th - 4);
      }
      noise(g, w, h, 1200, 0.05, ['#BDB6AB', '#FFFFFF']);
    }),
    // 作業場の黒いゴムマット
    mat: () => canvas(128, 128, (g, w, h) => {
      g.fillStyle = '#26282A'; g.fillRect(0, 0, w, h);
      for (let y = 8; y < h; y += 16) for (let x = (y / 16) % 2 ? 16 : 8; x < w; x += 16) { g.fillStyle = '#121314'; g.beginPath(); g.arc(x, y, 4.2, 0, Math.PI * 2); g.fill(); }
      noise(g, w, h, 400, 0.12, ['#3A3D40']);
    }),
    // 壁の絵（抽象画）
    art: (k) => canvas(256, 256, (g, w, h) => {
      const P = [['#E9DCC9', '#C9826B', '#6E8B74', '#2F3E4E'], ['#EFE6D8', '#D9A441', '#8FA9B8', '#7A3B3B'], ['#F2EBDD', '#B7695C', '#E3C08D', '#3C4A3A']][k % 3];
      g.fillStyle = P[0]; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) { g.fillStyle = P[1 + (i % 3)]; g.globalAlpha = 0.55 + rnd() * 0.4; g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * 70, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1; g.strokeStyle = P[3]; g.lineWidth = 3; g.beginPath(); g.moveTo(20, h * 0.7); g.bezierCurveTo(w * 0.3, h * 0.2, w * 0.7, h * 0.9, w - 20, h * 0.35); g.stroke();
    }),
    // 時計の文字盤
    clock: () => canvas(256, 256, (g, w) => {
      g.fillStyle = '#F7F3EC'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2A2624'; g.lineWidth = 10; g.stroke();
      g.fillStyle = '#2A2624'; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.save(); g.translate(w / 2, w / 2); g.rotate(a); g.fillRect(-3, -w / 2 + 18, 6, i % 3 ? 14 : 26); g.restore(); }
      g.font = 'italic 600 26px "Shippori Mincho B1",serif'; g.textAlign = 'center'; g.fillText('Pâtisserie', w / 2, w * 0.68);
    }),
    // ショーケースのプライスカード列
    cards: () => canvas(512, 64, (g, w, h) => { g.fillStyle = '#2A2624'; g.fillRect(0, 0, w, h); g.fillStyle = '#C9A35E'; g.fillRect(0, h - 4, w, 4); }),
  };
  function mix2(a, b, t) { const A = rgb(a), B2 = rgb(b); const c = A.map((v, i) => Math.round((v + (B2[i] - v) * Math.max(0, Math.min(1, t))) * 255)); return 'rgb(' + c.join(',') + ')'; }

  // =====================================================================
  //  UI 用のサムネイル（実物の 3D を撮影して画像に）
  // =====================================================================
  const thumbCache = {};
  let tEng = null, tScene = null;
  function thumbEngine() {
    if (tEng) return tEng;
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    cv.style.cssText = 'position:fixed;left:-9999px;top:0;width:256px;height:256px';
    document.body.appendChild(cv);
    tEng = new CS.gl.Engine(cv, { aa: true, alpha: true });
    tEng.env.clear = [0, 0, 0]; tEng.env.clearA = 0; tEng.shadows = false;
    tEng.env.sky = [0.55, 0.57, 0.6]; tEng.env.ground = [0.25, 0.22, 0.2]; tEng.env.sun = [2.4, 2.3, 2.15]; tEng.env.fogR = [100, 200];
    tEng.lights = [{ p: [1.2, 1.6, 1.8], c: [1.6, 1.45, 1.3], r: 8 }];
    tScene = new Node();
    return tEng;
  }
  function snap(setup) {
    const e = thumbEngine();
    tScene.clear();
    setup(e, tScene);
    e.render(tScene);
    return e.canvas.toDataURL('image/png');
  }
  const thumb = {
    cake(r, pieces, df) {
      const k = 'c|' + r.base + r.cream + JSON.stringify(r.tops || {}) + (pieces == null ? 6 : pieces) + (df || []).join(',');
      if (thumbCache[k]) return thumbCache[k];
      try {
        return (thumbCache[k] = snap((e, sc) => { const n = cake(e, r, pieces == null ? 6 : pieces, 1, df); n.r = [0, 0.5, 0]; sc.add(n); e.cam.pos = [0, 0.23, 0.33]; e.cam.target = [0, 0.045, 0]; e.cam.fov = 0.62; e.cam.near = 0.02; }));
      } catch (err) { return ''; }
    },
    face(skin) {
      const k = 'f|' + JSON.stringify(skin || {});
      if (thumbCache[k]) return thumbCache[k];
      try {
        return (thumbCache[k] = snap((e, sc) => { const ch = character(e, skin); ch.anim(1, 'idle'); ch.anim(1, 'idle'); ch.node.r = [0, 0.25, 0]; sc.add(ch.node); const hs = ({ s: 0.95, m: 1, l: 1.05 }[(skin || {}).height] || 1); e.cam.pos = [0.12, 1.6 * hs, 0.62]; e.cam.target = [0, 1.55 * hs, 0]; e.cam.fov = 0.55; e.cam.near = 0.05; }));
      } catch (err) { return ''; }
    },
    body(skin) {
      const k = 'b|' + JSON.stringify(skin || {});
      if (thumbCache[k]) return thumbCache[k];
      try {
        return (thumbCache[k] = snap((e, sc) => { const ch = character(e, skin); ch.anim(1, 'idle'); ch.node.r = [0, 0.35, 0]; sc.add(ch.node); e.cam.pos = [0.5, 1.15, 2.6]; e.cam.target = [0, 0.86, 0]; e.cam.fov = 0.62; }));
      } catch (err) { return ''; }
    },
  };
  const img = (src, cls, alt) => (src ? `<img class="${cls || ''}" src="${src}" alt="${alt || ''}" draggable="false">` : '');

  // きせかえ用：回せる 3D プレビュー
  function preview3d(host, skin) {
    const cv = document.createElement('canvas'); host.innerHTML = ''; host.appendChild(cv);
    let e;
    try { e = new CS.gl.Engine(cv, { aa: true }); } catch (err) { host.innerHTML = img(thumb.body(skin)); return { set(s) { host.innerHTML = img(thumb.body(s)); }, stop() {} }; }
    e.env.clear = rgb('#2B2522'); e.env.fog = rgb('#2B2522'); e.env.fogR = [30, 60]; e.shadows = false;
    e.env.sky = [0.5, 0.5, 0.55]; e.env.ground = [0.22, 0.19, 0.17];
    e.lights = [{ p: [1.0, 2.2, 1.6], c: [2.2, 2.0, 1.8], r: 9 }, { p: [-1.5, 1.2, -1], c: [0.6, 0.7, 0.9], r: 6 }];
    e.cam.pos = [0, 1.15, 2.7]; e.cam.target = [0, 0.86, 0]; e.cam.fov = 0.6;
    const scene = new Node();
    const disc = new Node(e.mesh(Geo.cyl(0.55, 0.58, 0.04, 40), '#3A322E', { rough: 0.6 })); disc.p = [0, -0.02, 0]; scene.add(disc);
    let ch = null, key = '', rot = 0.4, drag = null, raf = 0, last = performance.now(), alive = true, zoom = 0;
    cv.addEventListener('pointerdown', (ev) => { drag = ev.clientX; try { cv.setPointerCapture(ev.pointerId); } catch (err) { /* noop */ } });
    cv.addEventListener('pointermove', (ev) => { if (drag === null) return; rot += (ev.clientX - drag) * 0.012; drag = ev.clientX; });
    cv.addEventListener('pointerup', () => (drag = null)); cv.addEventListener('pointercancel', () => (drag = null));
    cv.addEventListener('dblclick', () => { zoom = zoom ? 0 : 1; });
    const set = (s) => { const k = JSON.stringify(s); if (k === key) return; key = k; if (ch) scene.remove(ch.node); ch = character(e, s); scene.add(ch.node); };
    const loop = () => {
      if (!alive) return;
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (drag === null) rot += dt * 0.35;
      if (ch) { ch.node.r[1] = rot; ch.anim(dt, 'idle'); }
      const tz = zoom ? [0, 1.52, 0.75] : [0, 1.15, 2.7], tt = zoom ? [0, 1.5, 0] : [0, 0.86, 0];
      for (let i = 0; i < 3; i++) { e.cam.pos[i] += (tz[i] - e.cam.pos[i]) * 0.15; e.cam.target[i] += (tt[i] - e.cam.target[i]) * 0.15; }
      e.render(scene); raf = requestAnimationFrame(loop);
    };
    set(skin); loop();
    return { set, stop() { alive = false; cancelAnimationFrame(raf); const x = e.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } };
  }

  // お客さんの見た目（タイプとバリエーションから）
  function customerSkin(type, v) {
    const A = D.AVATAR, pick = (arr, i) => arr[i % arr.length];
    const base = { body: pick(['slim', 'normal', 'sturdy', 'normal'], v), height: pick(['m', 's', 'l', 'm'], v + 1), skin: pick(A.skinColors, v * 2 + type.length), hair: pick(['short', 'bob', 'long', 'crew', 'pony', 'wavy', 'bun', 'braid'], v + type.length), hairColor: pick(A.hairColors.slice(0, 6), v + 2), eyes: pick(['normal', 'round', 'narrow', 'droop'], v), eyeColor: A.eyeColors[v % 3], brows: 'normal', mouth: pick(['smile', 'neutral', 'grin'], v), beard: 'none', hat: 'none', hatColor: '#3B4B63', apron: 'none', pattern: 'plain', acc: 'none', accColor: '#B8862E', pantsColor: pick(A.pantsColors, v) };
    const T = {
      student: { clothes: 'knit', clothesColor: pick(['#3B4B63', '#7A1F2B', '#C9B79C', '#4F6B4A'], v), height: 's' },
      worker: { clothes: 'shirt', clothesColor: pick(['#F7F5F0', '#DCE6F2', '#E8E2D6'], v), pantsColor: '#2E3440', hair: pick(['short', 'crew', 'bob'], v), beard: v % 3 === 0 ? 'stubble' : 'none' },
      parent: { clothes: pick(['knit', 'polo'], v), clothesColor: pick(['#E8D5C4', '#9DB4C0', '#D9A6A0'], v), hair: pick(['bob', 'long', 'pony'], v) },
      gourmet: { clothes: 'shirt', clothesColor: '#1F1F22', hat: 'beret', hatColor: '#2B2523', acc: 'scarf', accColor: '#7A1F2B', beard: v % 2 ? 'mustache' : 'none' },
      tourist: { clothes: 'polo', clothesColor: pick(['#2F8F83', '#F2C14E', '#E86A5A'], v), hat: 'cap', hatColor: pick(['#F7F5F0', '#2F4858'], v), acc: 'watch' },
      party: { clothes: 'polo', clothesColor: pick(['#F49AC2', '#FFD166', '#A0C4FF', '#F7F5F0'], v), acc: 'watch', hair: pick(['bob', 'wavy', 'short'], v) },
      elder: { clothes: 'knit', clothesColor: pick(['#8C8F94', '#6B5A4A', '#4F6B4A'], v), hairColor: pick(['#D8D4CE', '#8A8580'], v), acc: 'glasses', hair: pick(['crew', 'short', 'bun'], v), body: 'normal' },
    };
    return Object.assign(base, T[type] || {});
  }

  CS.models = { character, buildParts, cake, topPiece, TX, canvas, shade, thumb, img, preview3d, customerSkin, mix2 };
})(typeof window !== 'undefined' ? window : globalThis);
