/* ケーキ屋さんシミュレーター : 端末ごとの設定・効果音・演出 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});

  // ---------- 設定（端末ごとに保存。スマホとPCで別々にできる） ----------
  const DEF = { light: false, sens: 1, camSens: 1, invertY: false, btnScale: 1, hand: 'right', fab: null, sound: true, vol: 0.6, tips: true };
  const settings = Object.assign({}, DEF, (CS.LS && CS.LS.get('cs.settings', {})) || {});
  settings.save = function () { const o = {}; for (const k in DEF) o[k] = settings[k]; CS.LS.set('cs.settings', o); CS.applySettings && CS.applySettings(); };
  settings.reset = function (keys) { (keys || Object.keys(DEF)).forEach((k) => (settings[k] = DEF[k])); settings.save(); };
  CS.settings = settings;

  // ---------- 効果音（WebAudio で合成。音声ファイル不要） ----------
  let ac = null;
  function ctx() {
    if (!ac) { const A = G.AudioContext || G.webkitAudioContext; if (!A) return null; ac = new A(); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, type, vol, delay, slide) {
    const a = ctx(); if (!a) return;
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const v = (vol || 0.25) * settings.vol;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const SFX = {
    tap: () => tone(660, 0.07, 'triangle', 0.18),
    pop: () => tone(520, 0.12, 'sine', 0.25, 0, 900),
    ok: () => { tone(784, 0.1, 'triangle', 0.22); tone(1047, 0.16, 'triangle', 0.22, 0.08); },
    bad: () => { tone(300, 0.18, 'square', 0.12, 0, 180); },
    ding: () => { tone(1568, 0.5, 'sine', 0.25); tone(2093, 0.6, 'sine', 0.12, 0.02); },
    coin: () => { tone(988, 0.07, 'square', 0.1); tone(1319, 0.18, 'square', 0.1, 0.06); },
    whisk: () => tone(1800 + Math.random() * 600, 0.04, 'triangle', 0.06),
    fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.2, i * 0.11)); tone(1319, 0.5, 'triangle', 0.18, 0.46); },
    open: () => { tone(880, 0.12, 'sine', 0.2); tone(1175, 0.3, 'sine', 0.2, 0.12); },
  };
  CS.sound = { play(k) { if (!settings.sound) return; try { (SFX[k] || SFX.tap)(); } catch (e) { /* 音が鳴らせない環境 */ } }, unlock() { ctx(); } };

  // ---------- きらきら演出 ----------
  CS.sparkle = function (x, y, n, colors) {
    if (settings.light || (G.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const layer = document.getElementById('fxlayer'); if (!layer) return;
    colors = colors || ['#E2C68E', '#FFFFFF', '#F1AFBE', '#C9A35E'];
    for (let i = 0; i < (n || 14); i++) {
      const s = document.createElement('i');
      s.className = 'spark' + (i % 3 === 0 ? ' star' : '');
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 70;
      s.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 30}px;background:${colors[i % colors.length]};color:${colors[i % colors.length]};animation-delay:${Math.random() * 80}ms`;
      layer.appendChild(s);
      setTimeout(() => s.remove(), 1100);
    }
  };
  CS.coinFly = function (fromEl, toEl, text) {
    if (settings.light) return;
    const layer = document.getElementById('fxlayer'); if (!layer || !fromEl || !toEl) return;
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const c = document.createElement('b');
    c.className = 'coin';
    c.textContent = text || '¥';
    c.style.cssText = `left:${a.left + a.width / 2}px;top:${a.top + a.height / 2}px;--tx:${b.left + b.width / 2 - (a.left + a.width / 2)}px;--ty:${b.top + b.height / 2 - (a.top + a.height / 2)}px`;
    layer.appendChild(c);
    setTimeout(() => c.remove(), 950);
  };
})(typeof window !== 'undefined' ? window : globalThis);
