/* ケーキ屋さんシミュレーター : 軽量 WebGL エンジン
 *  ・トゥーン陰影（2段＋リムライト）と輪郭線（反転ハル）でアニメ調に
 *  ・影マップ（RGBA にパックした深度、PCF 4タップ）
 *  ・静的メッシュを頂点カラーで1つに結合して描画回数を減らす
 *  外部ライブラリ不要（GitHub Pages でもそのまま動く）
 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const TAU = Math.PI * 2;

  // =============== 行列（列優先） ===============
  const M = {
    ident() { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    mul(o, a, b) {
      const t = M._t || (M._t = new Float32Array(16));
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      o.set(t); return o;
    },
    persp(o, fy, asp, n, f) { const t = 1 / Math.tan(fy / 2); o.fill(0); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f); return o; },
    ortho(o, l, r, b, t, n, f) { o.fill(0); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; },
    lookAt(o, e, c, u) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx; l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0; o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0; o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); o[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); o[14] = -(zx * e[0] + zy * e[1] + zz * e[2]); o[15] = 1;
      return o;
    },
    // T * Ry * Rx * Rz * S
    compose(o, p, r, s) {
      const cx = Math.cos(r[0]), sx = Math.sin(r[0]), cy = Math.cos(r[1]), sy = Math.sin(r[1]), cz = Math.cos(r[2]), sz = Math.sin(r[2]);
      const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
      const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
      const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
      o[0] = r00 * s[0]; o[1] = r10 * s[0]; o[2] = r20 * s[0]; o[3] = 0;
      o[4] = r01 * s[1]; o[5] = r11 * s[1]; o[6] = r21 * s[1]; o[7] = 0;
      o[8] = r02 * s[2]; o[9] = r12 * s[2]; o[10] = r22 * s[2]; o[11] = 0;
      o[12] = p[0]; o[13] = p[1]; o[14] = p[2]; o[15] = 1;
      return o;
    },
    normal3(o, m) {
      const a00 = m[0], a10 = m[1], a20 = m[2], a01 = m[4], a11 = m[5], a21 = m[6], a02 = m[8], a12 = m[9], a22 = m[10];
      const c00 = a11 * a22 - a12 * a21, c01 = -(a10 * a22 - a12 * a20), c02 = a10 * a21 - a11 * a20;
      const c10 = -(a01 * a22 - a02 * a21), c11 = a00 * a22 - a02 * a20, c12 = -(a00 * a21 - a01 * a20);
      const c20 = a01 * a12 - a02 * a11, c21 = -(a00 * a12 - a02 * a10), c22 = a00 * a11 - a01 * a10;
      const det = a00 * c00 + a01 * c01 + a02 * c02 || 1;
      o[0] = c00 / det; o[1] = c10 / det; o[2] = c20 / det; o[3] = c01 / det; o[4] = c11 / det; o[5] = c21 / det; o[6] = c02 / det; o[7] = c12 / det; o[8] = c22 / det;
      return o;
    },
    xform(m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]]; },
  };

  // =============== 形状 ===============
  function geo() { return { p: [], n: [], o: [], uv: [], i: [], m: null }; }
  function vert(g, x, y, z, nx, ny, nz, u, v, ox, oy, oz) {
    g.p.push(x, y, z); g.n.push(nx, ny, nz); g.uv.push(u || 0, v || 0);
    if (ox === undefined) { const l = Math.hypot(x, y, z) || 1; g.o.push(x / l, y / l, z / l); } else g.o.push(ox, oy, oz);
    return g.p.length / 3 - 1;
  }
  // 4点の四角形を、法線 n の向きが表になるように追加
  function quad(g, a, b, c, d, n, uvs, noOutline) {
    uvs = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const base = g.p.length / 3;
    [a, b, c, d].forEach((q, k) => vert(g, q[0], q[1], q[2], n[0], n[1], n[2], uvs[k][0], uvs[k][1], ...(noOutline ? [0, 0, 0] : [])));
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else g.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
    return g;
  }
  // 面から頂点法線を計算（同じ位置で向きの近い頂点同士はなめらかにつなぐ）
  function computeNormals(g, sharp) {
    const nv = g.p.length / 3, P = g.p, acc = new Float64Array(nv * 3), own = new Float64Array(nv * 3);
    for (let k = 0; k < g.i.length; k += 3) {
      const a = g.i[k] * 3, b = g.i[k + 1] * 3, c = g.i[k + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz; acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz; acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz;
    }
    for (let v = 0; v < nv; v++) { const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]) || 1; own[v * 3] = acc[v * 3] / l; own[v * 3 + 1] = acc[v * 3 + 1] / l; own[v * 3 + 2] = acc[v * 3 + 2] / l; }
    const groups = new Map();
    for (let v = 0; v < nv; v++) { const key = Math.round(P[v * 3] * 2e4) + ',' + Math.round(P[v * 3 + 1] * 2e4) + ',' + Math.round(P[v * 3 + 2] * 2e4); const gl2 = groups.get(key); if (gl2) gl2.push(v); else groups.set(key, [v]); }
    const thr = sharp === undefined ? 0.5 : sharp, n = new Array(nv * 3);
    groups.forEach((list) => {
      for (const v of list) {
        let sx = 0, sy = 0, sz = 0;
        for (const w of list) if (w === v || own[v * 3] * own[w * 3] + own[v * 3 + 1] * own[w * 3 + 1] + own[v * 3 + 2] * own[w * 3 + 2] > thr) { sx += acc[w * 3]; sy += acc[w * 3 + 1]; sz += acc[w * 3 + 2]; }
        const l = Math.hypot(sx, sy, sz) || 1; n[v * 3] = sx / l; n[v * 3 + 1] = sy / l; n[v * 3 + 2] = sz / l;
      }
    });
    g.n = n; g.o = n.slice();
    return g;
  }
  const Geo = {
    box(w, h, d, uvScale) {
      const g = geo(), x = w / 2, y = h / 2, z = d / 2, s = uvScale || 1;
      quad(g, [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1], [[0, 0], [w * s, 0], [w * s, h * s], [0, h * s]]);
      quad(g, [x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1], [[0, 0], [w * s, 0], [w * s, h * s], [0, h * s]]);
      quad(g, [x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], [1, 0, 0], [[0, 0], [d * s, 0], [d * s, h * s], [0, h * s]]);
      quad(g, [-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], [-1, 0, 0], [[0, 0], [d * s, 0], [d * s, h * s], [0, h * s]]);
      quad(g, [-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], [0, 1, 0], [[0, 0], [w * s, 0], [w * s, d * s], [0, d * s]]);
      quad(g, [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], [0, -1, 0], [[0, 0], [w * s, 0], [w * s, d * s], [0, d * s]]);
      return g;
    },
    // 角が丸い箱（家具をやわらかい見た目に）：分割した立方体の頂点を内側の箱から半径 r だけ押し出す
    rbox(w, h, d, r) {
      const g = geo(), H = [w / 2, h / 2, d / 2];
      r = Math.min(r, H[0], H[1], H[2]) * 0.999;
      const ax = (hh) => [-hh, -hh + r * 0.4, -hh + r, hh - r, hh - r * 0.4, hh];
      for (let f = 0; f < 3; f++) for (const sg of [1, -1]) {
        const u = (f + 1) % 3, v = (f + 2) % 3, U = ax(H[u]), V = ax(H[v]), base = g.p.length / 3, n = U.length;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const p = [0, 0, 0]; p[f] = sg * H[f]; p[u] = U[i]; p[v] = V[j];
          const inner = p.map((x, k) => Math.max(-(H[k] - r), Math.min(H[k] - r, x)));
          let nx = p[0] - inner[0], ny = p[1] - inner[1], nz = p[2] - inner[2];
          const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
          const q = [inner[0] + nx * r, inner[1] + ny * r, inner[2] + nz * r];
          const lo = Math.hypot(q[0], q[1], q[2]) || 1;
          vert(g, q[0], q[1], q[2], nx, ny, nz, q[u] + H[u], q[v] + H[v], q[0] / lo, q[1] / lo, q[2] / lo);
        }
        for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
          const A = base + i * n + j, B = base + (i + 1) * n + j, C = base + (i + 1) * n + j + 1, Dd = base + i * n + j + 1;
          if (sg > 0) g.i.push(A, B, C, A, C, Dd); else g.i.push(A, C, B, A, Dd, C);
        }
      }
      return g;
    },
    sphere(r, ws, hs, th0, thL) {
      ws = ws || 16; hs = hs || 12; th0 = th0 || 0; thL = thL === undefined ? Math.PI : thL;
      const g = geo(), grid = [];
      for (let iy = 0; iy <= hs; iy++) {
        const row = [], v = iy / hs, th = th0 + v * thL;
        for (let ix = 0; ix <= ws; ix++) {
          const u = ix / ws, ph = u * TAU;
          const x = -Math.cos(ph) * Math.sin(th), y = Math.cos(th), z = Math.sin(ph) * Math.sin(th);
          row.push(vert(g, x * r, y * r, z * r, x, y, z, u, 1 - v, x, y, z));
        }
        grid.push(row);
      }
      const end = th0 + thL;
      for (let iy = 0; iy < hs; iy++) for (let ix = 0; ix < ws; ix++) {
        const a = grid[iy][ix + 1], b = grid[iy][ix], c = grid[iy + 1][ix], d = grid[iy + 1][ix + 1];
        if (iy !== 0 || th0 > 0) g.i.push(a, b, d);
        if (iy !== hs - 1 || end < Math.PI - 1e-6) g.i.push(b, c, d);
      }
      return g;
    },
    // 円柱（thL < 2π なら切り口つき＝ケーキの残りピース）
    cyl(rt, rb, h, seg, th0, thL, open) {
      seg = seg || 20; th0 = th0 || 0; thL = thL === undefined ? TAU : thL;
      const g = geo(), hh = h / 2, slope = (rb - rt) / h, grid = [];
      for (let y = 0; y <= 1; y++) {
        const row = [], rad = y * (rb - rt) + rt;
        for (let x = 0; x <= seg; x++) {
          const t = th0 + (x / seg) * thL, s = Math.sin(t), c = Math.cos(t);
          const nl = Math.hypot(s, slope, c);
          row.push(vert(g, rad * s, -y * h + hh, rad * c, s / nl, slope / nl, c / nl, x / seg, 1 - y));
        }
        grid.push(row);
      }
      for (let x = 0; x < seg; x++) { const a = grid[0][x], b = grid[1][x], c = grid[1][x + 1], d = grid[0][x + 1]; g.i.push(a, b, d, b, c, d); }
      if (open) {
        // ふたの無い筒（ボウル・型・カップ）は内側の面も作る（中をのぞいても向こうが透けない）
        const inner = grid.map((row) => row.map((k) => vert(g, g.p[k * 3], g.p[k * 3 + 1], g.p[k * 3 + 2], -g.n[k * 3], -g.n[k * 3 + 1], -g.n[k * 3 + 2], g.uv[k * 2], g.uv[k * 2 + 1], 0, 0, 0)));
        for (let x = 0; x < seg; x++) { const a = inner[0][x], b = inner[1][x], c = inner[1][x + 1], d = inner[0][x + 1]; g.i.push(a, d, b, b, d, c); }
      }
      if (!open) {
        [1, -1].forEach((sg) => {
          const rad = sg > 0 ? rt : rb; if (rad <= 0) return;
          const c0 = vert(g, 0, hh * sg, 0, 0, sg, 0, 0.5, 0.5, 0, sg, 0);
          const ring = [];
          for (let x = 0; x <= seg; x++) { const t = th0 + (x / seg) * thL; ring.push(vert(g, rad * Math.sin(t), hh * sg, rad * Math.cos(t), 0, sg, 0, 0.5 + Math.sin(t) / 2, 0.5 + Math.cos(t) / 2)); }
          for (let x = 0; x < seg; x++) { if (sg > 0) g.i.push(ring[x], ring[x + 1], c0); else g.i.push(ring[x + 1], ring[x], c0); }
        });
        if (thL < TAU - 1e-6) {
          [th0, th0 + thL].forEach((t, k) => {
            const s = Math.sin(t), c = Math.cos(t);
            const n = k === 0 ? [-c, 0, s] : [c, 0, -s];
            quad(g, [0, hh, 0], [rt * s, hh, rt * c], [rb * s, -hh, rb * c], [0, -hh, 0], n);
          });
        }
      }
      return g;
    },
    torus(R, r, rs, ts, arc) {
      rs = rs || 8; ts = ts || 24; arc = arc || TAU;
      const g = geo();
      for (let j = 0; j <= rs; j++) for (let i = 0; i <= ts; i++) {
        const u = (i / ts) * arc, v = (j / rs) * TAU;
        const x = (R + r * Math.cos(v)) * Math.cos(u), y = (R + r * Math.cos(v)) * Math.sin(u), z = r * Math.sin(v);
        const cx = R * Math.cos(u), cy = R * Math.sin(u);
        const nx = x - cx, ny = y - cy, nz = z; const l = Math.hypot(nx, ny, nz) || 1;
        vert(g, x, y, z, nx / l, ny / l, nz / l, i / ts, j / rs, nx / l, ny / l, nz / l);
      }
      for (let j = 1; j <= rs; j++) for (let i = 1; i <= ts; i++) {
        const a = (ts + 1) * j + i - 1, b = (ts + 1) * (j - 1) + i - 1, c = (ts + 1) * (j - 1) + i, d = (ts + 1) * j + i;
        g.i.push(a, b, d, b, c, d);
      }
      return g;
    },
    // 頂点を関数で動かして形を作る（fn が 6 要素を返すと頂点色も付く）
    warp(g, fn, sharp) {
      const o = { p: [], n: [], o: [], uv: g.uv.slice(), i: g.i.slice(), m: null }; let vc = null;
      for (let k = 0; k < g.p.length; k += 3) { const r = fn(g.p[k], g.p[k + 1], g.p[k + 2], k / 3); o.p.push(r[0], r[1], r[2]); if (r.length >= 6) { vc = vc || []; vc[k] = r[3]; vc[k + 1] = r[4]; vc[k + 2] = r[5]; } else if (vc) { vc[k] = vc[k + 1] = vc[k + 2] = 1; } }
      if (vc) { for (let k = 0; k < o.p.length; k++) if (vc[k] === undefined) vc[k] = 1; o.vc = vc; }
      return computeNormals(o, sharp);
    },
    // 断面（楕円／超楕円）を積み重ねた曲面：胴・腕・脚・帽子・エプロンなど
    // rings: [{y, rx, rz, cx, cz, sq, wav:[振幅,回数,位相]}]  o: {seg, a0, a1, capTop, capBot, thick, sharp}
    loft(rings, o) {
      o = o || {};
      const seg = o.seg || 24, a0 = o.a0 || 0, a1 = o.a1 === undefined ? a0 + TAU : o.a1, full = Math.abs(a1 - a0 - TAU) < 1e-6;
      const g = geo(), n = rings.length, th = o.thick || 0;
      const pt = (R, t, off) => {
        const s = Math.sin(t), c = Math.cos(t), e = 2 / (R.sq || 2);
        const fx = Math.sign(s) * Math.pow(Math.abs(s), e), fz = Math.sign(c) * Math.pow(Math.abs(c), e);
        const w = R.wav ? 1 + R.wav[0] * Math.cos(R.wav[1] * t + (R.wav[2] || 0)) : 1;
        return [(R.cx || 0) + Math.max(0, R.rx * w + off) * fx, R.y, (R.cz || 0) + Math.max(0, R.rz * w + off) * fz];
      };
      const T = (j) => a0 + (j / seg) * (a1 - a0);
      const P = g.p;
      const cr = (A, B, C) => { const ux = P[B * 3] - P[A * 3], uy = P[B * 3 + 1] - P[A * 3 + 1], uz = P[B * 3 + 2] - P[A * 3 + 2], vx = P[C * 3] - P[A * 3], vy = P[C * 3 + 1] - P[A * 3 + 1], vz = P[C * 3 + 2] - P[A * 3 + 2]; return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; };
      const tri = (A, B, C, out) => { const c = cr(A, B, C); if (c[0] * out[0] + c[1] * out[1] + c[2] * out[2] >= 0) g.i.push(A, B, C); else g.i.push(A, C, B); };
      const grid = (off, inward) => {
        const idx = [];
        for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j <= seg; j++) { const q = pt(rings[i], T(j), off); row.push(vert(g, q[0], q[1], q[2], 0, 1, 0, j / seg, n > 1 ? i / (n - 1) : 0, 0, 0, 0)); } idx.push(row); }
        let sum = 0;
        for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const A = idx[i][j], B = idx[i + 1][j], C = idx[i + 1][j + 1]; const c = cr(A, B, C); const R = rings[i]; sum += c[0] * (P[A * 3] - (R.cx || 0)) + c[2] * (P[A * 3 + 2] - (R.cz || 0)); }
        const flip = (sum < 0) !== !!inward;
        for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const A = idx[i][j], B = idx[i + 1][j], C = idx[i + 1][j + 1], D = idx[i][j + 1]; if (flip) g.i.push(A, C, B, A, D, C); else g.i.push(A, B, C, A, C, D); }
        return idx;
      };
      const out = grid(th ? th / 2 : 0, false);
      const cap = (i, other, ring) => { const R = rings[i]; const c = vert(g, R.cx || 0, R.y, R.cz || 0, 0, 1, 0, 0.5, i ? 1 : 0, 0, 0, 0); const dir = [0, Math.sign(R.y - rings[other].y) || 1, 0]; const rr = []; for (let j = 0; j <= seg; j++) { const q = pt(R, T(j), th ? th / 2 : 0); rr.push(vert(g, q[0], q[1], q[2], 0, 1, 0, j / seg, i ? 1 : 0, 0, 0, 0)); } for (let j = 0; j < seg; j++) tri(c, rr[j], rr[j + 1], dir); };
      if (o.capTop) cap(0, 1); if (o.capBot) cap(n - 1, n - 2);
      if (th) {
        const inn = grid(-th / 2, true);
        const strip = (a, b, c, d, dir) => { const v = [a, b, c, d].map((x) => vert(g, P[x * 3], P[x * 3 + 1], P[x * 3 + 2], 0, 1, 0, 0, 0, 0, 0, 0)); tri(v[0], v[1], v[2], dir); tri(v[0], v[2], v[3], dir); };
        if (!full) for (const [j, j2] of [[0, 1], [seg, seg - 1]]) for (let i = 0; i < n - 1; i++) { const q1 = pt(rings[i], T(j), 0), q2 = pt(rings[i], T(j2), 0); strip(out[i][j], out[i + 1][j], inn[i + 1][j], inn[i][j], [q1[0] - q2[0], 0, q1[2] - q2[2]]); }
        for (const [i, i2] of [[0, 1], [n - 1, n - 2]]) { if ((i === 0 && o.capTop) || (i === n - 1 && o.capBot)) continue; const dir = [0, Math.sign(rings[i].y - rings[i2].y) || 1, 0]; for (let j = 0; j < seg; j++) strip(out[i][j], out[i][j + 1], inn[i][j + 1], inn[i][j], dir); }
      }
      return computeNormals(g, o.sharp === undefined ? 0.55 : o.sharp);
    },
    // XZ 平面（上向き）
    plane(w, d, uw, ud) { return quad(geo(), [-w / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2], [0, 1, 0], [[0, 0], [uw || 1, 0], [uw || 1, ud || 1], [0, ud || 1]], true); },
    // XY 平面（+Z 向き）文字や絵の板
    card(w, h) { return quad(geo(), [-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], true); },
    disc(r, seg) { const g = geo(); seg = seg || 20; const c = vert(g, 0, 0, 0, 0, 1, 0, 0.5, 0.5, 0, 0, 0); const ring = []; for (let i = 0; i <= seg; i++) { const t = (i / seg) * TAU; ring.push(vert(g, Math.sin(t) * r, 0, Math.cos(t) * r, 0, 1, 0, 0.5 + Math.sin(t) / 2, 0.5 + Math.cos(t) / 2, 0, 0, 0)); } for (let i = 0; i < seg; i++) g.i.push(ring[i], ring[i + 1], c); return g; },
  };

  // =============== 結合ビルダー ===============
  const tmpN = new Float32Array(9);
  class Builder {
    constructor() { this.chunks = [geo()]; this.chunks[0].c = []; this.chunks[0].m = []; }
    add(g, m, color, opt) {
      opt = opt || {};
      let ch = this.chunks[this.chunks.length - 1];
      if (ch.p.length / 3 + g.p.length / 3 > 65000) { ch = geo(); ch.c = []; ch.m = []; this.chunks.push(ch); }
      const rough = opt.rough === undefined ? 0.65 : opt.rough, metal = opt.metal || 0;
      const base = ch.p.length / 3;
      const nm = M.normal3(tmpN, m);
      const col = color || [1, 1, 1], vc = g.vc;
      for (let k = 0; k < g.p.length; k += 3) {
        const x = g.p[k], y = g.p[k + 1], z = g.p[k + 2];
        ch.p.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        const nx = g.n[k], ny = g.n[k + 1], nz = g.n[k + 2];
        let a = nm[0] * nx + nm[3] * ny + nm[6] * nz, b = nm[1] * nx + nm[4] * ny + nm[7] * nz, c = nm[2] * nx + nm[5] * ny + nm[8] * nz;
        let l = Math.hypot(a, b, c) || 1; ch.n.push(a / l, b / l, c / l);
        const ox = opt.noOutline ? 0 : g.o[k], oy = opt.noOutline ? 0 : g.o[k + 1], oz = opt.noOutline ? 0 : g.o[k + 2];
        a = nm[0] * ox + nm[3] * oy + nm[6] * oz; b = nm[1] * ox + nm[4] * oy + nm[7] * oz; c = nm[2] * ox + nm[5] * oy + nm[8] * oz;
        l = Math.hypot(a, b, c); if (l > 1e-6) ch.o.push(a / l, b / l, c / l); else ch.o.push(0, 0, 0);
        if (vc) ch.c.push(col[0] * vc[k], col[1] * vc[k + 1], col[2] * vc[k + 2]); else ch.c.push(col[0], col[1], col[2]); ch.m.push(rough, metal);
      }
      for (let k = 0; k < g.uv.length; k++) ch.uv.push(g.uv[k]);
      for (let k = 0; k < g.i.length; k++) ch.i.push(base + g.i[k]);
      return this;
    }
    // 位置・回転・拡大で追加
    put(g, p, r, s, color, opt, parent) {
      const m = M.compose(M.ident(), p || [0, 0, 0], r || [0, 0, 0], typeof s === 'number' ? [s, s, s] : s || [1, 1, 1]);
      if (parent) M.mul(m, parent, m);
      return this.add(g, m, color, opt);
    }
    empty() { return this.chunks.length === 1 && !this.chunks[0].p.length; }
    build(eng) { return this.chunks.filter((c) => c.p.length).map((c) => eng.upload(c)); }
  }

  // =============== 色 ===============
  function rgb(hex) {
    if (Array.isArray(hex)) return hex;
    hex = String(hex || '#ffffff').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function mix(a, b, t) { a = rgb(a); b = rgb(b); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // =============== シーン ===============
  class Node {
    constructor(meshes, o) {
      this.meshes = meshes ? (Array.isArray(meshes) ? meshes : [meshes]) : [];
      this.p = [0, 0, 0]; this.r = [0, 0, 0]; this.s = [1, 1, 1];
      this.kids = []; this.vis = true; this.color = [1, 1, 1]; this.op = 1; this.em = 0; this.tex = null;
      this.outline = true; this.cast = true; this.recv = true; this.blend = false; this.rk = 1; this.mk = 0; this.ao = 1; this.local = M.ident(); this.world = M.ident(); this.nm = new Float32Array(9);
      Object.assign(this, o || {});
    }
    add(n) { this.kids.push(n); n.parent = this; return n; }
    remove(n) { const i = this.kids.indexOf(n); if (i >= 0) this.kids.splice(i, 1); n.parent = null; }
    clear() { this.kids.length = 0; }
  }

  // =============== シェーダー ===============
  const VS = `
attribute vec3 aP; attribute vec3 aN; attribute vec3 aO; attribute vec3 aC; attribute vec2 aUV; attribute vec2 aM;
uniform mat4 uM, uVP, uLVP; uniform mat3 uNM; uniform float uOut; uniform vec3 uCam;
varying vec3 vN; varying vec3 vW; varying vec3 vC; varying vec2 vUV; varying vec4 vL; varying vec2 vM;
void main(){
  vec4 w = uM * vec4(aP,1.0);
  vec3 n = normalize(uNM * aN);
  if (uOut > 0.0) { vec3 o = uNM * aO; float l = length(o); if (l > 0.0001) { float d = distance(w.xyz, uCam); w.xyz += (o/l) * uOut * (0.35 + d * 0.1); } else { w.xyz = vec3(0.0, -999.0, 0.0); } }
  vW = w.xyz; vN = n; vC = aC; vUV = aUV; vL = uLVP * w; vM = aM;
  gl_Position = uVP * w;
}`;
  const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uColor, uLight, uSky, uGround, uSun, uCam, uFog, uInk, uWall; uniform vec2 uFogR;
uniform float uOp, uEm, uOut, uUseTex, uShadow, uRecv, uRK, uMK, uAO, uExpo, uSMs, uSQ, uLampR;
uniform sampler2D uTex, uSM;
uniform vec4 uPL[4]; uniform vec3 uPC[4]; uniform int uNPL;
varying vec3 vN; varying vec3 vW; varying vec3 vC; varying vec2 vUV; varying vec4 vL; varying vec2 vM;
const float PI = 3.14159265;
float unpack(vec4 c){ return dot(c, vec4(1.0/16777216.0, 1.0/65536.0, 1.0/256.0, 1.0)); }
float sAt(vec3 sc, vec2 o){ return step(sc.z, unpack(texture2D(uSM, sc.xy + o * uSMs))); }
// 影の縁をなめらかに（4点の補間）
float sBil(vec2 uv, float z){
  vec2 p = uv / uSMs - 0.5; vec2 f = fract(p); vec2 b = (floor(p) + 0.5) * uSMs;
  float a = step(z, unpack(texture2D(uSM, b))), c = step(z, unpack(texture2D(uSM, b + vec2(uSMs, 0.0))));
  float d = step(z, unpack(texture2D(uSM, b + vec2(0.0, uSMs)))), e = step(z, unpack(texture2D(uSM, b + vec2(uSMs))));
  return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
}
float ggx(float nh, float a){ float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d + 1e-5); }
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  if (uOut > 0.0) { gl_FragColor = vec4(uInk, 1.0); return; }
  vec4 tx = uUseTex > 0.5 ? texture2D(uTex, vUV) : vec4(1.0);
  vec3 srgb = uColor * vC * tx.rgb;
  if (uEm > 0.99) { gl_FragColor = vec4(srgb, uOp * tx.a); return; }
  vec3 alb = pow(srgb, vec3(2.2));
  float rough = clamp(vM.x * uRK, 0.05, 1.0), metal = clamp(vM.y + uMK, 0.0, 1.0);
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCam - vW);
  float NdV = max(dot(N, V), 0.001);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 dif = alb * (1.0 - metal);
  float a = rough * rough;
  float sh = 1.0;
  if (uShadow > 0.5 && uRecv > 0.5) {
    vec3 sc = vL.xyz / vL.w * 0.5 + 0.5;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
      sc.z -= 0.0007 + 0.0022 * (1.0 - max(dot(N, uLight), 0.0));
      sh = 0.0;
      if (uSQ > 0.5) {
        sh = sBil(sc.xy + vec2(-0.9, -0.9) * uSMs, sc.z) + sBil(sc.xy + vec2(0.9, -0.9) * uSMs, sc.z) + sBil(sc.xy + vec2(-0.9, 0.9) * uSMs, sc.z) + sBil(sc.xy + vec2(0.9, 0.9) * uSMs, sc.z);
        sh *= 0.25;
      } else {
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) sh += sAt(sc, vec2(float(x), float(y)));
        sh /= 9.0;
      }
      vec2 eg = abs(sc.xy - 0.5) * 2.0; sh = mix(sh, 1.0, smoothstep(0.82, 1.0, max(eg.x, eg.y)));
    }
  }
  // 太陽（窓からの光）
  vec3 L = uLight, H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0), NdH = max(dot(N, H), 0.0), VdH = max(dot(V, H), 0.0);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float Gv = NdV / (NdV * (1.0 - k) + k), Gl = NdL / (NdL * (1.0 - k) + k);
  vec3 spec = F * ggx(NdH, a) * Gv * Gl / max(4.0 * NdL * NdV, 0.001);
  vec3 col = (dif * (1.0 - F) / PI + spec) * uSun * NdL * sh;
  // 店内の照明
  for (int i = 0; i < 4; i++) {
    if (i >= uNPL) break;
    vec3 lv = uPL[i].xyz - vW; float d = length(lv); vec3 l = lv / d;
    float fall = clamp(1.0 - pow(d / uPL[i].w, 4.0), 0.0, 1.0); float att = fall * fall / (d * d + 1.0);
    float nl = max(dot(N, l), 0.0); vec3 h = normalize(l + V);
    vec3 f = F0 + (1.0 - F0) * pow(1.0 - max(dot(V, h), 0.0), 5.0);
    col += (dif * (1.0 - f) / PI + f * ggx(max(dot(N, h), 0.0), max(a, 0.02)) * 0.3) * uPC[i] * nl * att;
  }
  // 環境光と映り込み
  vec3 amb = mix(uGround, uSky, N.y * 0.5 + 0.5);
  vec3 Fr = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  // 映り込み：床・壁・天井（店内）と、天井の照明のきらめき
  vec3 env = R.y > 0.0 ? mix(uWall, uSky * 1.2, smoothstep(0.05, 0.75, R.y)) : mix(uWall, uGround * 0.85, smoothstep(-0.05, -0.6, R.y));
  env += uSky * pow(max(R.y, 0.0), 10.0) * uLampR * (1.0 - rough);
  float ao = mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 0.5, vW.y)), uAO);
  col += (dif * (1.0 - Fr) * amb + Fr * env * (1.0 - rough * 0.75)) * ao;
  col += alb * uEm * 3.0;
  float fd = distance(uCam, vW);
  col = mix(col, pow(uFog, vec3(2.2)), smoothstep(uFogR.x, uFogR.y, fd));
  col = pow(aces(col * uExpo), vec3(1.0 / 2.2));
  float alpha = uOp * tx.a;
  if (uOp < 0.999) alpha = clamp(alpha + pow(1.0 - NdV, 3.0) * 0.5 + length(spec * uSun * NdL) * 0.2, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}`;
  const DVS = `attribute vec3 aP; uniform mat4 uM, uLVP; void main(){ gl_Position = uLVP * uM * vec4(aP,1.0); }`;
  const DFS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
void main(){ vec4 b = vec4(16777216.0, 65536.0, 256.0, 1.0); vec4 m = vec4(0.0, 1.0/256.0, 1.0/256.0, 1.0/256.0); vec4 r = fract(gl_FragCoord.z * b); r -= r.xxyz * m; gl_FragColor = r; }`;

  // =============== 仕上げ（ブルーム・FXAA・周辺減光・色味） ===============
  const PVS = `attribute vec2 aQ; varying vec2 vU; void main(){ vU = aQ * 0.5 + 0.5; gl_Position = vec4(aQ, 0.0, 1.0); }`;
  const PHEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vU; uniform sampler2D uT; uniform vec2 uPx;
`;
  const PBRIGHT = PHEAD + `uniform float uThr;
void main(){
  vec3 c = (texture2D(uT, vU + uPx * vec2(-1.0, -1.0)).rgb + texture2D(uT, vU + uPx * vec2(1.0, -1.0)).rgb + texture2D(uT, vU + uPx * vec2(-1.0, 1.0)).rgb + texture2D(uT, vU + uPx * vec2(1.0, 1.0)).rgb) * 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * smoothstep(uThr, 1.0, l), 1.0);
}`;
  const PBLUR = PHEAD + `uniform vec2 uDir;
void main(){
  vec3 c = texture2D(uT, vU).rgb * 0.227027;
  c += (texture2D(uT, vU + uDir * 1.3846).rgb + texture2D(uT, vU - uDir * 1.3846).rgb) * 0.316216;
  c += (texture2D(uT, vU + uDir * 3.2308).rgb + texture2D(uT, vU - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;
  const PCOMP = PHEAD + `uniform sampler2D uB; uniform float uBloom, uVig;
vec3 fxaa(vec2 uv){
  vec3 nw = texture2D(uT, uv + vec2(-1.0, -1.0) * uPx).rgb, ne = texture2D(uT, uv + vec2(1.0, -1.0) * uPx).rgb;
  vec3 sw = texture2D(uT, uv + vec2(-1.0, 1.0) * uPx).rgb, se = texture2D(uT, uv + vec2(1.0, 1.0) * uPx).rgb, m = texture2D(uT, uv).rgb;
  vec3 W = vec3(0.299, 0.587, 0.114);
  float lnw = dot(nw, W), lne = dot(ne, W), lsw = dot(sw, W), lse = dot(se, W), lm = dot(m, W);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), ((lnw + lsw) - (lne + lse)));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, -8.0, 8.0) * uPx;
  vec3 a = 0.5 * (texture2D(uT, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(uT, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(uT, uv - dir * 0.5).rgb + texture2D(uT, uv + dir * 0.5).rgb);
  float lb = dot(b, W);
  return (lb < lmin || lb > lmax) ? a : b;
}
void main(){
  vec3 c = fxaa(vU);
  vec3 bl = texture2D(uB, vU).rgb * uBloom;
  c = 1.0 - (1.0 - c) * (1.0 - bl);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.07);
  c *= vec3(1.015, 1.0, 0.975);
  vec2 d = vU - 0.5; float v = 1.0 - uVig * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
  gl_FragColor = vec4(clamp(c * v, 0.0, 1.0), 1.0);
}`;

  // =============== レンダラー ===============
  class Engine {
    constructor(canvas, opt) {
      opt = opt || {};
      this.canvas = canvas; this.id = Engine.n = (Engine.n || 0) + 1;
      const gl = (this.gl = canvas.getContext('webgl', { antialias: opt.aa !== false, alpha: !!opt.alpha, premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }));
      if (!gl) throw new Error('WebGL が使えません');
      this.prog = this.program(VS, FS);
      this.dprog = this.program(DVS, DFS);
      this.loc = this.locations(this.prog, ['uM', 'uVP', 'uLVP', 'uNM', 'uOut', 'uCam', 'uColor', 'uLight', 'uSky', 'uGround', 'uSun', 'uFog', 'uInk', 'uFogR', 'uOp', 'uEm', 'uUseTex', 'uShadow', 'uRecv', 'uTex', 'uSM', 'uSMs', 'uRK', 'uMK', 'uAO', 'uExpo', 'uPL', 'uPC', 'uNPL', 'uWall', 'uSQ', 'uLampR']);
      this.dloc = this.locations(this.dprog, ['uM', 'uLVP']);
      this.attr = { aP: gl.getAttribLocation(this.prog, 'aP'), aN: gl.getAttribLocation(this.prog, 'aN'), aO: gl.getAttribLocation(this.prog, 'aO'), aC: gl.getAttribLocation(this.prog, 'aC'), aUV: gl.getAttribLocation(this.prog, 'aUV'), aM: gl.getAttribLocation(this.prog, 'aM') };
      this.dattr = gl.getAttribLocation(this.dprog, 'aP');
      this.env = { light: norm([0.35, 0.8, 0.5]), sky: [0.42, 0.45, 0.5], ground: [0.2, 0.17, 0.15], sun: [2.6, 2.45, 2.2], fog: rgb('#DCE3EA'), fogR: [30, 80], ink: rgb('#2A211C'), clear: rgb('#CFE0EE'), expo: 1.0 };
      this.lights = []; this.outline = 0; this.shadows = true; this.smSize = 2048; this.scale = 1;
      this.post = false; this.bloom = 0.55; this.vignette = 0.22; this.bloomThr = 0.8; this.softShadow = true;
      this.view = M.ident(); this.proj = M.ident(); this.vp = M.ident(); this.lvp = M.ident();
      this.white = this.texFromPixels(new Uint8Array([255, 255, 255, 255]), 1, 1);
      this.cam = { pos: [0, 5, 8], target: [0, 0, 0], fov: 0.9, near: 0.1, far: 120 };
      this.stats = { draws: 0 };
    }
    program(vs, fs) {
      const gl = this.gl;
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    locations(p, names) { const o = {}; names.forEach((n) => (o[n] = this.gl.getUniformLocation(p, n))); return o; }
    upload(g) {
      const gl = this.gl;
      const buf = (arr, T, target) => { const b = gl.createBuffer(); gl.bindBuffer(target || gl.ARRAY_BUFFER, b); gl.bufferData(target || gl.ARRAY_BUFFER, new T(arr), gl.STATIC_DRAW); return b; };
      const c = g.c && g.c.length ? g.c : new Array(g.p.length).fill(1);
      let m = g.m && g.m.length ? g.m : null; if (!m) { m = []; for (let k = 0; k < g.p.length / 3; k++) m.push(0.65, 0); }
      return { p: buf(g.p, Float32Array), n: buf(g.n, Float32Array), o: buf(g.o, Float32Array), c: buf(c, Float32Array), uv: buf(g.uv, Float32Array), m: buf(m, Float32Array), i: buf(g.i, Uint16Array, gl.ELEMENT_ARRAY_BUFFER), count: g.i.length };
    }
    mesh(g, color, opt) { const b = new Builder(); b.add(g, M.ident(), color ? rgb(color) : [1, 1, 1], opt); return b.build(this); }
    // GPU のバッファを返す（作り直した物を捨てるとき。共有キャッシュの物は keep で残す）
    free(meshes) {
      const gl = this.gl; if (!meshes) return;
      (Array.isArray(meshes) ? meshes : [meshes]).forEach((m) => { if (!m || m.keep || m.dead) return; ['p', 'n', 'o', 'c', 'uv', 'm', 'i'].forEach((k) => { if (m[k]) gl.deleteBuffer(m[k]); }); m.dead = true; m.count = 0; });
    }
    freeTree(n) { if (!n) return; this.free(n.meshes); for (const k of n.kids) this.freeTree(k); }
    texFromCanvas(cv, repeat) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      const pot = (v) => (v & (v - 1)) === 0;
      if (pot(cv.width) && pot(cv.height)) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); const w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w); }
      else { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    }
    updateTex(t, cv) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); if ((cv.width & (cv.width - 1)) === 0 && (cv.height & (cv.height - 1)) === 0) gl.generateMipmap(gl.TEXTURE_2D); }
    texFromPixels(px, w, h) { const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; }
    shadowTarget() {
      if (this.sm && this.sm.size === this.smSize) return this.sm;
      const gl = this.gl, size = this.smSize;
      if (this.sm) { gl.deleteTexture(this.sm.tex); gl.deleteFramebuffer(this.sm.fb); if (this.sm.rb) gl.deleteRenderbuffer(this.sm.rb); this.sm = null; }
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST));
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return (this.sm = { tex, fb, rb, size });
    }
    // 仕上げ用のフレームバッファ（作れない端末では自動でオフ）
    ensurePost() {
      const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
      try {
        if (!this.pprog) {
          const mk = (fs) => { const p = this.program(PVS, fs); return { p, aQ: gl.getAttribLocation(p, 'aQ'), L: this.locations(p, ['uT', 'uB', 'uPx', 'uThr', 'uDir', 'uBloom', 'uVig']) }; };
          this.pprog = { bright: mk(PBRIGHT), blur: mk(PBLUR), comp: mk(PCOMP) };
          this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        }
        if (this.pp && this.pp.w === w && this.pp.h === h) return true;
        const fbo = (fw, fh, depth) => {
          const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
          [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
          const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          let rb = null;
          // 深度は DEPTH_STENCIL（たいていの端末で 24bit）を使う。16bit だと奥の床や壁の飾りがちらつく。だめなら 16bit
          const depthRB = (fmt, att) => { if (rb) { gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, null); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null); gl.deleteRenderbuffer(rb); } rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, fmt, fw, fh); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, att, gl.RENDERBUFFER, rb); return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; };
          if (depth && !depthRB(gl.DEPTH_STENCIL, gl.DEPTH_STENCIL_ATTACHMENT)) depthRB(gl.DEPTH_COMPONENT16, gl.DEPTH_ATTACHMENT);
          const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          if (!ok) throw new Error('fbo');
          return { tex, fb, rb, w: fw, h: fh };
        };
        if (this.pp) [this.pp.scene, this.pp.a, this.pp.b].forEach((f) => { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fb); if (f.rb) gl.deleteRenderbuffer(f.rb); });
        const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4));
        this.pp = { w, h, scene: fbo(w, h, true), a: fbo(bw, bh), b: fbo(bw, bh) };
        return true;
      } catch (e) { this.post = false; this.pp = null; return false; }
    }
    dropPost() { const gl = this.gl; if (this.pp) [this.pp.scene, this.pp.a, this.pp.b].forEach((f) => { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fb); if (f.rb) gl.deleteRenderbuffer(f.rb); }); this.pp = null; }
    postProcess() {
      const gl = this.gl, P = this.pprog, pp = this.pp;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(false);
      Object.values(this.attr).forEach((l) => { if (l >= 0) gl.disableVertexAttribArray(l); });
      const pass = (pr, target, src, setup) => {
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
        gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(pr.aQ); gl.vertexAttribPointer(pr.aQ, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(pr.L.uT, 0);
        gl.uniform2f(pr.L.uPx, 1 / src.w, 1 / src.h);
        if (setup) setup(pr.L);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(pr.aQ);
      };
      pass(P.bright, pp.a, pp.scene, (L) => gl.uniform1f(L.uThr, this.bloomThr));
      for (let k = 0; k < 2; k++) {
        pass(P.blur, pp.b, pp.a, (L) => gl.uniform2f(L.uDir, (1 + k) / pp.a.w, 0));
        pass(P.blur, pp.a, pp.b, (L) => gl.uniform2f(L.uDir, 0, (1 + k) / pp.a.h));
      }
      pass(P.comp, null, pp.scene, (L) => { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, pp.a.tex); gl.uniform1i(L.uB, 1); gl.activeTexture(gl.TEXTURE0); gl.uniform1f(L.uBloom, this.bloom); gl.uniform1f(L.uVig, this.vignette); });
      gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    }
    resize() {
      const c = this.canvas, dpr = Math.min(2, G.devicePixelRatio || 1) * this.scale;
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }
    collect(n, parentM, out) {
      if (!n.vis) return;
      M.compose(n.local, n.p, n.r, n.s);
      if (parentM) M.mul(n.world, parentM, n.local); else n.world.set(n.local);
      if (n.meshes.length) { M.normal3(n.nm, n.world); (n.blend || n.op < 1 ? out.tr : out.op).push(n); }
      for (const k of n.kids) this.collect(k, n.world, out);
    }
    bind(m, depthOnly) {
      const gl = this.gl;
      if (depthOnly) { gl.bindBuffer(gl.ARRAY_BUFFER, m.p); gl.vertexAttribPointer(this.dattr, 3, gl.FLOAT, false, 0, 0); }
      else {
        const A = this.attr;
        [[A.aP, m.p, 3], [A.aN, m.n, 3], [A.aO, m.o, 3], [A.aC, m.c, 3], [A.aUV, m.uv, 2], [A.aM, m.m, 2]].forEach(([l, b, s]) => { if (l < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.vertexAttribPointer(l, s, gl.FLOAT, false, 0, 0); });
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.i);
    }
    render(scene) {
      const gl = this.gl, L = this.loc, E = this.env, cam = this.cam;
      if (gl.isContextLost()) return;
      this.resize();
      if (!this.post && this.pp) this.dropPost();
      if (!this.shadows && this.sm) { gl.deleteTexture(this.sm.tex); gl.deleteFramebuffer(this.sm.fb); if (this.sm.rb) gl.deleteRenderbuffer(this.sm.rb); this.sm = null; }
      const out = { op: [], tr: [] };
      this.collect(scene, null, out);
      this.stats.draws = 0;
      const aspect = this.canvas.width / this.canvas.height;
      M.persp(this.proj, cam.fov, aspect, cam.near, cam.far);
      M.lookAt(this.view, cam.pos, cam.target, [0, 1, 0]);
      M.mul(this.vp, this.proj, this.view);
      // ---- 影マップ ----
      const useSM = this.shadows;
      if (useSM) {
        const sm = this.shadowTarget();
        const c = this.shadowCenter || [0, 0, 0], R = this.shadowRadius || 12;
        const lp = [c[0] + E.light[0] * 30, c[1] + E.light[1] * 30, c[2] + E.light[2] * 30];
        const lv = M.lookAt(M.ident(), lp, c, [0, 1, 0]), lo = M.ortho(M.ident(), -R, R, -R, R, 10, 50);
        M.mul(this.lvp, lo, lv);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sm.fb); gl.viewport(0, 0, sm.size, sm.size);
        gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.BLEND);
        gl.useProgram(this.dprog); gl.enableVertexAttribArray(this.dattr);
        Object.values(this.attr).forEach((l) => { if (l >= 0 && l !== this.dattr) gl.disableVertexAttribArray(l); });
        gl.uniformMatrix4fv(this.dloc.uLVP, false, this.lvp);
        for (const n of out.op) { if (!n.cast) continue; gl.uniformMatrix4fv(this.dloc.uM, false, n.world); for (const m of n.meshes) { if (m.dead) continue; this.bind(m, true); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0); this.stats.draws++; } }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      // ---- 本描画 ----
      const usePost = this.post && this.ensurePost();
      gl.bindFramebuffer(gl.FRAMEBUFFER, usePost ? this.pp.scene.fb : null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(E.clear[0], E.clear[1], E.clear[2], E.clearA === undefined ? 1 : E.clearA); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.prog);
      Object.values(this.attr).forEach((l) => { if (l >= 0) gl.enableVertexAttribArray(l); });
      gl.uniformMatrix4fv(L.uVP, false, this.vp); gl.uniformMatrix4fv(L.uLVP, false, this.lvp);
      gl.uniform3fv(L.uCam, cam.pos); gl.uniform3fv(L.uLight, E.light); gl.uniform3fv(L.uSky, E.sky); gl.uniform3fv(L.uGround, E.ground); gl.uniform3fv(L.uSun, E.sun);
      gl.uniform3fv(L.uFog, E.fog); gl.uniform2fv(L.uFogR, E.fogR); gl.uniform3fv(L.uInk, E.ink);
      gl.uniform3fv(L.uWall, E.wall || [(E.sky[0] + E.ground[0]) / 2, (E.sky[1] + E.ground[1]) / 2, (E.sky[2] + E.ground[2]) / 2]); gl.uniform1f(L.uSQ, this.softShadow ? 1 : 0); gl.uniform1f(L.uLampR, E.lampR || 0);
      gl.uniform1f(L.uShadow, useSM ? 1 : 0);
      gl.uniform1f(L.uSMs, 1.0 / (this.smSize || 2048)); gl.uniform1f(L.uExpo, E.expo || 1);
      const nl = Math.min(4, this.lights.length); gl.uniform1i(L.uNPL, nl);
      if (nl) { const pl = new Float32Array(16), pc = new Float32Array(12); this.lights.slice(0, 4).forEach((l, i) => { pl.set([l.p[0], l.p[1], l.p[2], l.r || 8], i * 4); pc.set(l.c, i * 3); }); gl.uniform4fv(L.uPL, pl); gl.uniform3fv(L.uPC, pc); }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, useSM ? this.sm.tex : this.white); gl.uniform1i(L.uSM, 1);
      gl.activeTexture(gl.TEXTURE0); gl.uniform1i(L.uTex, 0);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      const draw = (n, outline) => {
        gl.uniformMatrix4fv(L.uM, false, n.world); gl.uniformMatrix3fv(L.uNM, false, n.nm);
        gl.uniform3fv(L.uColor, n.color); gl.uniform1f(L.uOp, n.op); gl.uniform1f(L.uEm, n.em); gl.uniform1f(L.uRecv, n.recv ? 1 : 0);
        gl.uniform1f(L.uRK, n.rk); gl.uniform1f(L.uMK, n.mk); gl.uniform1f(L.uAO, n.ao);
        gl.uniform1f(L.uOut, outline ? this.outline * (n.outlineW || 1) : 0);
        gl.uniform1f(L.uUseTex, n.tex ? 1 : 0); gl.bindTexture(gl.TEXTURE_2D, n.tex || this.white);
        for (const m of n.meshes) { if (m.dead) continue; this.bind(m); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0); this.stats.draws++; }
      };
      for (const n of out.op) { if (n.twoSide) gl.disable(gl.CULL_FACE); draw(n, false); if (n.twoSide) gl.enable(gl.CULL_FACE); }
      if (this.outline > 0) { gl.cullFace(gl.FRONT); for (const n of out.op) if (n.outline) draw(n, true); gl.cullFace(gl.BACK); }
      // 軽量化：影が無いときはオブジェクトの接地影（ブロブ）だけで済ませる
      // ---- 半透明（奥から手前へ） ----
      if (out.tr.length) {
        const cp = cam.pos;
        out.tr.sort((a, b) => dist2(b.world, cp) - dist2(a.world, cp));
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        for (const n of out.tr) { if (n.twoSide) gl.disable(gl.CULL_FACE); draw(n, false); if (n.twoSide) gl.enable(gl.CULL_FACE); }
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      if (usePost) this.postProcess();
    }
    // ワールド座標 → 画面座標（CSS px）
    project(p) {
      const v = M.xform(this.vp, p[0], p[1], p[2]);
      if (v[3] <= 0.01) return null;
      const x = v[0] / v[3], y = v[1] / v[3];
      return { x: ((x + 1) / 2) * this.canvas.clientWidth, y: ((1 - y) / 2) * this.canvas.clientHeight, z: v[2] / v[3], d: v[3] };
    }
  }
  function dist2(m, p) { const dx = m[12] - p[0], dy = m[13] - p[1], dz = m[14] - p[2]; return dx * dx + dy * dy + dz * dz; }
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  // 共有キャッシュのメッシュに印をつける（free で消さない）
  const keep = (ms) => { (Array.isArray(ms) ? ms : [ms]).forEach((m) => { if (m) m.keep = true; }); return ms; };
  CS.gl = { M, Geo, Builder, Node, Engine, rgb, mix, quad, geo, computeNormals, keep };
})(typeof window !== 'undefined' ? window : globalThis);
