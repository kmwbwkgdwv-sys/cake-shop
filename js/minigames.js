/* ケーキ屋さんシミュレーター : 調理ミニゲーム（工程ごと）
 *  生地   : 投入順 → 計量（はかり） → かき混ぜ
 *  クリーム: 泡立て（分離・ゆるさ）
 *  仕上げ : スライス → サンド → ナッペ → 絞り → トッピング（タルトは流し込み）
 *  戻り値 { q: 0〜1, df: [欠点コード] } / 途中でやめたら null
 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data, A = CS.art, ST = () => CS.settings;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const PI = Math.PI;

  function shell(title, sub) {
    const root = document.getElementById('mg');
    root.innerHTML = `<div class="mg-card pop-in" role="dialog" aria-modal="true" aria-label="${A.esc(title)}">
      <div class="mg-head"><div><h3>${A.esc(title)}</h3><p class="mg-sub">${A.esc(sub || '')}</p></div><button class="icon-btn mg-x" aria-label="やめる">${A.icon('close')}</button></div>
      <ol class="mg-steps"></ol>
      <div class="mg-timer"><i></i></div>
      <div class="mg-stage"></div>
      <p class="mg-hint"></p>
      <div class="mg-foot"></div>
    </div>`;
    root.hidden = false;
    document.body.classList.add('mg-open');
    return { root, stage: $('.mg-stage', root), hint: $('.mg-hint', root), foot: $('.mg-foot', root), timer: $('.mg-timer i', root), x: $('.mg-x', root), steps: $('.mg-steps', root), sub: $('.mg-sub', root) };
  }
  function setSteps(ui, list, cur) { ui.steps.innerHTML = list.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}">${A.esc(s)}</li>`).join(''); }
  function close() { const r = document.getElementById('mg'); r.hidden = true; r.innerHTML = ''; document.body.classList.remove('mg-open'); }
  function grade(q) { return q >= 0.95 ? ['Excellent', 'p'] : q >= 0.8 ? ['Great', 'g'] : q >= 0.6 ? ['Good', 'o'] : q >= 0.35 ? ['Fair', 'm'] : ['Failed', 'x']; }
  function result(ui, q, df, img) {
    const [txt, cls] = grade(q);
    const el = document.createElement('div');
    el.className = 'mg-result r-' + cls;
    ui.hint.textContent = ''; ui.foot.innerHTML = '';
    el.innerHTML = `${img || ''}<b>${txt}</b><span>この工程の出来 ${Math.round(q * 100)}</span>${df && df.length ? `<em>${df.map((d) => '⚠ ' + A.esc(D.DEFECTS[d].name)).join('　')}</em>` : '<em>欠点なし</em>'}`;
    ui.stage.appendChild(el);
    CS.sound.play(q >= 0.8 && !(df && df.length) ? 'fanfare' : q >= 0.5 ? 'ok' : 'bad');
    if (q >= 0.85 && !(df && df.length)) { const r = ui.stage.getBoundingClientRect(); CS.sparkle(r.left + r.width / 2, r.top + r.height / 2, 18); }
    return new Promise((res) => setTimeout(res, 1600));
  }
  function setupCanvas(stage, size) {
    const c = document.createElement('canvas');
    const dpr = ST().light ? 1 : Math.min(2, G.devicePixelRatio || 1);
    c.width = size * dpr; c.height = size * dpr; c.style.width = size + 'px'; c.style.height = size + 'px';
    c.className = 'mg-canvas';
    stage.appendChild(c);
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    return { c, g };
  }
  const stageSize = () => Math.round(clamp(Math.min(G.innerWidth - 64, G.innerHeight - 360), 200, 330));
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function loop(fn) { let raf, last = performance.now(), on = true; const f = (t) => { if (!on) return; const dt = Math.min(0.05, (t - last) / 1000); last = t; if (fn(dt) !== false) raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); return () => { on = false; cancelAnimationFrame(raf); }; }
  const posOf = (c, e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  // ---------- 描画ヘルパ（写実寄り：グラデーションと反射） ----------
  function steelBowl(g, cx, cy, R) {
    const gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.12);
    gr.addColorStop(0, '#F4F6F8'); gr.addColorStop(0.55, '#B9BFC6'); gr.addColorStop(0.85, '#8E959D'); gr.addColorStop(1, '#5E646B');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 1.1, 0, PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R * 1.06, PI * 1.05, PI * 1.6); g.stroke();
  }
  function fillBatter(g, cx, cy, R, col, light) {
    const gr = g.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R);
    gr.addColorStop(0, shadeHex(col, 0.35 * (light || 1))); gr.addColorStop(1, shadeHex(col, -0.18));
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, PI * 2); g.fill();
  }
  function shadeHex(hex, t) { const c = CS.gl.rgb(hex).map((v) => (t < 0 ? v * (1 + t) : v + (1 - v) * t)); return 'rgb(' + c.map((v) => Math.round(v * 255)).join(',') + ')'; }
  function marbleBoard(g, s) {
    const gr = g.createLinearGradient(0, 0, s, s); gr.addColorStop(0, '#EEEBE6'); gr.addColorStop(1, '#D9D4CC'); g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(140,130,120,.25)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, s * 0.3); g.bezierCurveTo(s * 0.3, s * 0.2, s * 0.6, s * 0.55, s, s * 0.4); g.stroke();
  }

  // =====================================================================
  //  生地：投入順 → 計量 → かき混ぜ
  // =====================================================================
  function mix(baseId, opt) {
    const B = D.BASES[baseId];
    const diff = D.DIFF[opt.diff] || D.DIFF.normal;
    const ui = shell(B.name, '正しい順に材料を入れ、量って、一定の速さで混ぜる');
    const STEPS = ['投入順', '計量', 'かき混ぜ'];
    return new Promise((resolve) => {
      let done = false, stop = () => {};
      const finish = (v) => { if (done) return; done = true; stop(); close(); resolve(v); };
      ui.x.onclick = () => finish(null);
      const df = []; let qOrder = 1, qWeigh = 1;
      // ---- 1. 投入順 ----
      setSteps(ui, STEPS, 0);
      let wrong = 0, idx = 0;
      const order = B.order, showOrder = diff.hint;
      ui.stage.innerHTML = `<div class="mg-order">${order.map((id, i) => `<span class="slot" data-i="${i}">${showOrder ? D.ING[id].icon : '?'}<small>${showOrder ? D.ING[id].name : i + 1}</small></span>`).join('<i>›</i>')}</div>
        <div class="mg-ings">${shuffle(order).map((id) => `<button class="ing-btn" data-id="${id}"><span>${D.ING[id].icon}</span>${D.ING[id].name}<small>×${B.ing[id]}</small></button>`).join('')}</div>`;
      ui.hint.textContent = showOrder ? '表示された順番で投入' : '順番はレシピ帳に記載（この難易度では非表示）';
      if (!showOrder) {
        ui.foot.innerHTML = `<button class="btn ghost sm" id="mg-peek">${A.icon('book')} レシピを見る（品質-5）</button>`;
        $('#mg-peek', ui.root).onclick = (e) => {
          qOrder -= 0.05; e.currentTarget.disabled = true;
          ui.stage.querySelectorAll('.mg-order .slot').forEach((s, i) => { if (i >= idx) { s.innerHTML = D.ING[order[i]].icon + '<small>' + D.ING[order[i]].name + '</small>'; s.classList.add('peek'); } });
          setTimeout(() => ui.stage.querySelectorAll('.mg-order .slot.peek').forEach((s) => { const i = +s.dataset.i; s.classList.remove('peek'); if (i >= idx) s.innerHTML = '?<small>' + (i + 1) + '</small>'; }), 1500);
        };
      }
      ui.stage.querySelectorAll('.ing-btn').forEach((b) => {
        b.onclick = () => {
          if (b.dataset.id === order[idx]) {
            CS.sound.play('pop'); b.disabled = true; b.classList.add('used');
            const s = ui.stage.querySelector('.mg-order .slot[data-i="' + idx + '"]'); s.classList.add('ok'); s.innerHTML = D.ING[order[idx]].icon + '<small>' + D.ING[order[idx]].name + '</small>';
            idx++;
            if (idx >= order.length) { if (wrong >= 2) df.push('flat'); qOrder = clamp(qOrder - wrong * 0.1, 0.5, 1); setTimeout(weigh, 350); }
          } else { CS.sound.play('bad'); wrong++; b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); ui.hint.textContent = '順番が違う（生地のふくらみに影響）'; }
        };
      });
      // ---- 2. 計量 ----
      function weigh() {
        setSteps(ui, STEPS, 1);
        const list = Object.keys(B.weigh || {});
        let k = 0; const errs = [];
        const next = () => {
          if (k >= list.length) { const worst = Math.max(0, ...errs); qWeigh = clamp(1 - Math.max(0, worst - 0.02) * 4, 0.4, 1); if (worst > 0.08) df.push('weight'); return setTimeout(stir, 300); }
          const id = list[k], target = B.weigh[id];
          let gr = 0, pouring = false, vel = 0, settled = false;
          ui.sub.textContent = D.ING[id].name + 'を ' + target + 'g 量る';
          ui.stage.innerHTML = `<div class="scale"><div class="scale-top"><span class="pile" style="background:${id === 'cocoa' ? '#5A3826' : id === 'matcha' ? '#7E9B4E' : id === 'cheese' ? '#F2EAD2' : id === 'butter' ? '#F2DC8C' : id === 'milk' ? '#F5F3EE' : '#F2EEE6'}"></span></div><div class="scale-disp"><b id="sc-g">0</b><small>g</small></div><div class="scale-target">目標 ${target}g（±${Math.max(1, Math.round(target * 0.03))}g）</div></div>`;
          ui.foot.innerHTML = `<button class="btn big pour-btn" id="mg-pour">${D.ING[id].icon} 押している間 注ぐ</button><button class="btn" id="mg-ok">${A.icon('check')} 決定</button>`;
          ui.hint.textContent = '最後はゆっくり。ボタンを短く押すと少しずつ足せます（PC: スペース長押し）';
          const pour = $('#mg-pour', ui.root);
          const on = (e) => { if (e) e.preventDefault(); pouring = true; pour.classList.add('pressed'); };
          const off = () => { pouring = false; pour.classList.remove('pressed'); };
          pour.addEventListener('pointerdown', on); pour.addEventListener('pointerup', off); pour.addEventListener('pointerleave', off); pour.addEventListener('pointercancel', off);
          const kd = (e) => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) on(); } if (e.code === 'Enter') ok(); };
          const ku = (e) => { if (e.code === 'Space') off(); };
          document.addEventListener('keydown', kd); document.addEventListener('keyup', ku);
          let held = 0;
          const ok = () => { if (settled) return; settled = true; stop(); document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); errs.push(Math.abs(gr - target) / target); CS.sound.play(Math.abs(gr - target) / target <= 0.03 ? 'ok' : 'tap'); k++; setTimeout(next, 250); };
          $('#mg-ok', ui.root).onclick = ok;
          stop = loop((dt) => {
            held = pouring ? held + dt : 0;
            const rate = target * (0.12 + Math.min(1.2, held * 1.1)) * (1 / Math.max(0.5, ST().sens));
            vel += ((pouring ? rate : 0) - vel) * Math.min(1, dt * 10);
            gr += vel * dt;
            const el = document.getElementById('sc-g'); if (el) { el.textContent = gr.toFixed(target < 30 ? 1 : 0); el.parentNode.classList.toggle('ok', Math.abs(gr - target) <= Math.max(1, target * 0.03)); el.parentNode.classList.toggle('over', gr > target * 1.03); }
            const pile = ui.stage.querySelector('.pile'); if (pile) { const f = clamp(gr / target, 0, 1.4); pile.style.transform = `scale(${0.2 + f * 0.8}, ${0.15 + f * 0.6})`; }
          });
        };
        next();
      }
      // ---- 3. かき混ぜ ----
      function stir() {
        setSteps(ui, STEPS, 2);
        ui.foot.innerHTML = ''; ui.stage.innerHTML = '';
        ui.sub.textContent = 'ボウルの上で円を描くように混ぜる';
        const size = Math.min(stageSize(), Math.round(ui.stage.clientWidth - 50));
        const wrap = document.createElement('div'); wrap.className = 'mg-stir'; ui.stage.appendChild(wrap);
        const { c, g } = setupCanvas(wrap, size);
        const gauge = document.createElement('div'); gauge.className = 'mg-gauge';
        gauge.innerHTML = '<div class="zone"></div><div class="needle"></div><span class="lbl hi">速い</span><span class="lbl lo">遅い</span>';
        wrap.appendChild(gauge);
        const sens = ST().sens;
        const center = 7.5, hw = 2.2 * diff.win * (opt.mixWin || 1);
        const lo = center - hw, hi = center + hw, maxW = center * 2.2;
        $('.zone', gauge).style.cssText = `bottom:${(lo / maxW) * 100}%;height:${((hi - lo) / maxW) * 100}%`;
        const limit = opt.diff === 'expert' ? 7.5 : opt.diff === 'hard' ? 8 : 9;
        let t = 0, w = 0, prog = 0, splash = 0, lumps = 0, lastA = null, lastT = 0, swirl = 0, active = false;
        const pos = (e) => { const [x, y] = posOf(c, e); return [x - size / 2, y - size / 2]; };
        c.onpointerdown = (e) => { active = true; try { c.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } const [x, y] = pos(e); lastA = Math.atan2(y, x); lastT = performance.now(); };
        c.onpointermove = (e) => {
          if (!active) return;
          const [x, y] = pos(e); if (Math.hypot(x, y) < size * 0.08) return;
          const a = Math.atan2(y, x), now = performance.now();
          if (lastA != null) { let d = a - lastA; if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI; const dt = Math.max(0.008, (now - lastT) / 1000); w = w * 0.82 + ((Math.abs(d) / dt) * sens) * 0.18; swirl += d; }
          lastA = a; lastT = now;
        };
        c.onpointerup = c.onpointercancel = () => { active = false; lastA = null; };
        ui.hint.textContent = 'ゲージの緑の範囲を保つ';
        stop = loop((dt) => {
          t += dt;
          if (!active || performance.now() - lastT > 120) w *= Math.pow(0.08, dt);
          if (w >= lo && w <= hi) prog += dt / (3.2 * (opt.mixFast || 1)); else if (w > hi) { prog += dt / 6; splash += dt; } else if (w > 0.8) { prog += dt / 12; lumps += dt; }
          prog = Math.min(1, prog);
          ui.timer.style.width = 100 - (t / limit) * 100 + '%';
          $('.needle', gauge).style.bottom = clamp(w / maxW, 0, 1) * 100 + '%';
          gauge.classList.toggle('hot', w > hi); gauge.classList.toggle('ok', w >= lo && w <= hi);
          drawBowl(g, size, prog, swirl, splash, B.color, lumps);
          if (prog >= 1 || t >= limit) {
            if (lumps > 2.5 || prog < 0.75) df.push('lump');
            const mq = clamp(1 - splash / 2.5 - lumps / 6, 0.2, 1) * (prog < 1 ? 0.4 + 0.6 * prog : 1);
            const q = clamp(mq * qOrder * qWeigh, 0, 1);
            c.onpointerdown = c.onpointermove = null;
            result(ui, q, df).then(() => finish({ q, df }));
            return false;
          }
        });
      }
    });
  }
  function drawBowl(g, s, prog, swirl, splash, color, lumps) {
    const cx = s / 2, cy = s / 2, R = s * 0.4;
    g.clearRect(0, 0, s, s);
    steelBowl(g, cx, cy, R);
    g.save(); g.beginPath(); g.arc(cx, cy, R * 0.92, 0, PI * 2); g.clip();
    fillBatter(g, cx, cy, R * 0.92, '#F4E7C6');
    g.globalAlpha = 0.3 + prog * 0.7; fillBatter(g, cx, cy, R * 0.92, color); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 4;
    for (let i = 0; i < 4; i++) { g.beginPath(); for (let a = 0; a < PI * 3; a += 0.12) { const r = (a / (PI * 3)) * R * 0.9; const x = cx + Math.cos(a + swirl + i * 1.57) * r, y = cy + Math.sin(a + swirl + i * 1.57) * r; a === 0 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
    if (prog < 0.7 || lumps > 1) { g.fillStyle = 'rgba(250,245,232,.9)'; for (let i = 0; i < 10; i++) { const a = i * 0.7 + swirl * 0.5, r = R * (0.2 + (i % 4) * 0.17); g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4 * (1 - prog * 0.8), 0, PI * 2); g.fill(); } }
    g.restore();
    g.strokeStyle = '#3CA88F'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, R * 1.18, -PI / 2, -PI / 2 + prog * PI * 2); g.stroke();
    if (splash > 0.2) { g.fillStyle = color; for (let i = 0; i < Math.min(12, splash * 6); i++) { const a = i * 2.1; g.beginPath(); g.arc(cx + Math.cos(a) * (R * 1.25), cy + Math.sin(a) * (R * 1.25), 3, 0, PI * 2); g.fill(); } }
  }

  // =====================================================================
  //  クリーム：泡立て
  // =====================================================================
  function whip(creamId, opt) {
    const C = D.CREAMS[creamId];
    const diff = D.DIFF[opt.diff] || D.DIFF.normal;
    const custard = creamId === 'custard';
    const ui = shell(C.name, custard ? '火にかけて混ぜ、とろみがついたら火から下ろす' : '泡立てて、8分立て（ツノがおじぎする）で止める');
    ui.steps.innerHTML = '';
    return new Promise((resolve) => {
      let done = false, stop = () => {};
      const finish = (v) => { if (done) return; done = true; stop(); document.removeEventListener('keydown', onKey); close(); resolve(v); };
      ui.x.onclick = () => finish(null);
      const size = stageSize();
      ui.stage.innerHTML = `<div class="mg-whip"><div class="mg-meter"><div class="zone"></div><div class="fill"></div><div class="sep"></div><span class="lbl a">${custard ? 'さらさら' : '6分立て'}</span><span class="lbl b">${custard ? 'とろみ' : '8分立て'}</span><span class="lbl c">${custard ? '固まる' : '分離'}</span></div><div class="mg-cream"></div></div>`;
      const wrap = $('.mg-cream', ui.stage);
      const sz = Math.round(size * 0.85);
      const { g } = setupCanvas(wrap, sz);
      const center = 0.89, hw = 0.05 * diff.win * (opt.win || 1), maxS = 1.2;
      const meter = $('.mg-meter', ui.stage);
      $('.zone', meter).style.cssText = `bottom:${((center - hw) / maxS) * 100}%;height:${((2 * hw) / maxS) * 100}%`;
      $('.sep', meter).style.bottom = (1 / maxS) * 100 + '%';
      ui.foot.innerHTML = `<button class="btn big whisk-btn" id="mg-whisk">${A.icon('hand')} ${custard ? '混ぜる' : '泡立てる'}</button><button class="btn big primary" id="mg-done">${A.icon('check')} 止める</button>`;
      ui.hint.textContent = 'ボタンを連打（PC: スペース）。Enter で止める';
      let s = 0, t = 0, idle = 0, wob = 0, ended = false;
      const limit = opt.diff === 'expert' ? 8 : 10, sens = ST().sens;
      const hit = () => { s += 0.028 * sens * (opt.gain || 1) * (0.85 + Math.random() * 0.3); idle = 0; wob = 1; CS.sound.play('whisk'); };
      const btn = $('#mg-whisk', ui.root);
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); hit(); btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump'); });
      const onKey = (e) => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) hit(); } if (e.code === 'Enter') end(); };
      document.addEventListener('keydown', onKey);
      const end = () => {
        if (ended) return; ended = true;
        const d = s - center; const df = [];
        let q;
        if (Math.abs(d) <= hw) q = 1;
        else if (d < 0) { q = clamp(1 - (-d - hw) * 3.2, 0.2, 1); if (d < -hw * 2) df.push('soft'); }
        else if (s > 1) { q = clamp(0.55 - (s - 1) * 3, 0.1, 0.55); df.push('sep'); }
        else q = clamp(1 - (d - hw) * 4, 0.3, 1);
        btn.disabled = true; $('#mg-done', ui.root).disabled = true;
        result(ui, q, df).then(() => finish({ q, df }));
      };
      $('#mg-done', ui.root).onclick = end;
      stop = loop((dt) => {
        t += dt; idle += dt; wob = Math.max(0, wob - dt * 6);
        if (idle > 0.5 && s < 1) s = Math.max(0, s - dt * 0.02);
        $('.fill', meter).style.height = clamp(s / maxS, 0, 1) * 100 + '%';
        meter.classList.toggle('ok', Math.abs(s - center) <= hw); meter.classList.toggle('bad', s > 1);
        ui.timer.style.width = 100 - (t / limit) * 100 + '%';
        drawCream(g, sz, s, wob, C.color, custard);
        if (t >= limit && !ended) end();
      });
    });
  }
  function drawCream(g, s, st, wob, color, custard) {
    g.clearRect(0, 0, s, s);
    const cx = s / 2, cy = s * 0.55, R = s * 0.4;
    steelBowl(g, cx, cy, R);
    g.save(); g.beginPath(); g.arc(cx, cy, R * 0.92, 0, PI * 2); g.clip();
    const sep = st > 1;
    fillBatter(g, cx, cy, R * 0.92, sep ? '#E6D9A8' : color, 0.6);
    // ツノ（陰影つきの山）
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + wob * 0.3, r = R * (0.25 + (i % 3) * 0.2);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, h = clamp(st, 0, 1) * R * 0.35 * (custard ? 0.3 : 1);
      const gr = g.createRadialGradient(x - h * 0.3, y - h * 0.3, 1, x, y, h + 6);
      gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.6, sep ? '#E9DDB0' : shadeHex(color, 0.15)); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, h + 6, 0, PI * 2); g.fill();
    }
    if (sep) { g.fillStyle = 'rgba(220,200,120,.6)'; for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(cx + Math.cos(i * 2.1) * R * 0.6, cy + Math.sin(i * 1.3) * R * 0.6, 3, 0, PI * 2); g.fill(); } }
    g.restore();
    // 泡立て器
    g.save(); g.translate(cx + R * 0.35 + Math.sin(wob * 9) * 8, cy - R * 0.2); g.rotate(0.6 + Math.sin(wob * 12) * 0.25);
    g.strokeStyle = '#8E959D'; g.lineWidth = 2;
    for (let k = -2; k <= 2; k++) { g.beginPath(); g.ellipse(0, 0, R * 0.04 * Math.abs(k) + 2, R * 0.22, 0, 0, PI * 2); g.stroke(); }
    g.fillStyle = '#3A3A3A'; g.fillRect(-4, -R * 0.75, 8, R * 0.5);
    g.restore();
  }

  // =====================================================================
  //  仕上げ（レシピに応じた工程）
  // =====================================================================
  function deco(recipe, opt) {
    const diff = D.DIFF[opt.diff] || D.DIFF.normal;
    const B = D.BASES[recipe.base], C = D.CREAMS[recipe.cream] || D.CREAMS.none;
    const tops = []; for (const k in recipe.tops || {}) for (let i = 0; i < recipe.tops[k]; i++) tops.push(k);
    const fruit = tops.filter((k) => ['strawberry', 'blueberry', 'peach', 'lemon'].includes(k));
    const steps = [];
    if (B.cookie) { if (tops.length) steps.push('top'); steps.push('pack'); }
    else if (B.tart) { steps.push('pour'); if (recipe.cream === 'maron') steps.push('mont'); }
    else {
      if (B.layered && C.color) { steps.push('slice'); steps.push('fill'); }
      if (C.color) { steps.push('nappe'); steps.push('pipe'); }
    }
    if (tops.length && !B.cookie) steps.push('top');
    if (!steps.length) steps.push('top');
    const NAMES = { pack: '袋詰め', slice: 'スライス', fill: 'サンド', nappe: 'ナッペ', pipe: '絞り', top: 'トッピング', pour: '流し込み', mont: 'モンブラン絞り' };
    const ui = shell(recipe.name, '工程ごとに丁寧に仕上げる');
    return new Promise((resolve) => {
      let done = false, stop = () => {};
      const finish = (v) => { if (done) return; done = true; stop(); close(); resolve(v); };
      ui.x.onclick = () => finish(null);
      const size = stageSize();
      const qs = [], df = [];
      let si = 0;
      const next = () => {
        stop(); ui.foot.innerHTML = ''; ui.stage.innerHTML = ''; ui.hint.textContent = '';
        if (si >= steps.length) {
          const q = qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : 1;
          const im = CS.models && CS.models.thumb ? CS.models.img(CS.models.thumb.cake(recipe, 6, df), 'mg-cakeimg') : '';
          return result(ui, q, df, im).then(() => finish({ q, df }));
        }
        setSteps(ui, steps.map((k) => NAMES[k]), si);
        const k = steps[si++];
        ({ slice, fill, nappe, pipe, top, pour, mont, pack })[k]();
      };
      const step = (q, d) => { qs.push(clamp(q, 0, 1)); if (d && df.indexOf(d) < 0) df.push(d); setTimeout(next, 450); };
      const canvas = () => setupCanvas(ui.stage, size);
      const cx = size / 2, cy = size / 2, R = size * 0.38;
      // ---- スライス：スポンジを水平に2枚に ----
      function slice() {
        ui.sub.textContent = '目印の高さで、ナイフを水平に端から端まで引く';
        const { c, g } = canvas();
        const top = size * 0.3, bot = size * 0.72, mid = (top + bot) / 2, x0 = size * 0.1, x1 = size * 0.9;
        const pts = []; let down = false;
        const draw = () => {
          g.clearRect(0, 0, size, size); marbleBoard(g, size);
          const gr = g.createLinearGradient(0, top, 0, bot); gr.addColorStop(0, shadeHex(B.crumb, 0.1)); gr.addColorStop(0.08, B.color); gr.addColorStop(1, shadeHex(B.color, -0.1));
          g.fillStyle = gr; g.fillRect(x0, top, x1 - x0, bot - top);
          g.setLineDash([6, 6]); g.strokeStyle = 'rgba(40,30,25,.45)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0 - 8, mid); g.lineTo(x1 + 8, mid); g.stroke(); g.setLineDash([]);
          if (pts.length > 1) { g.strokeStyle = '#2A2A2A'; g.lineWidth = 2.5; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); }
        };
        draw();
        c.onpointerdown = (e) => { down = true; pts.length = 0; try { c.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } pts.push(posOf(c, e)); };
        c.onpointermove = (e) => { if (!down) return; pts.push(posOf(c, e)); draw(); };
        c.onpointerup = () => {
          if (!down) return; down = false;
          const span = pts.length ? Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])) : 0;
          if (span < (x1 - x0) * 0.8) { ui.hint.textContent = '端から端まで引いてください'; pts.length = 0; draw(); return; }
          const dev = pts.reduce((a, p) => a + Math.abs(p[1] - mid), 0) / pts.length / (bot - top);
          const tiltv = Math.abs(pts[pts.length - 1][1] - pts[0][1]) / (bot - top);
          const tol = 0.05 * diff.win;
          const q = clamp(1 - Math.max(0, dev - tol) * 5 - Math.max(0, tiltv - tol) * 3, 0.2, 1);
          c.onpointerdown = c.onpointermove = c.onpointerup = null;
          ui.hint.textContent = q > 0.85 ? 'まっすぐ切れた' : '少し傾いた…';
          step(q, q < 0.6 ? 'tilt' : null);
        };
        ui.hint.textContent = '指（マウス）でなぞる';
      }
      // ---- サンド：クリームの上にフルーツを並べる ----
      function fill() {
        if (!fruit.length) { qs.push(1); return next(); }
        ui.sub.textContent = '下のスポンジにクリームとフルーツを。外周から少し内側に並べる';
        placeGame(fruit[0], 6, R * 0.55, 'ring', (q) => step(q, q < 0.5 ? 'messy' : null));
      }
      // ---- ナッペ ----
      function nappe() {
        ui.sub.textContent = 'クリームをムラなく塗る（同じ場所を何度も塗るとムラになる）';
        ui.hint.textContent = '指（マウス）でなぞって全体に塗る';
        const { c, g } = canvas();
        const N = 16, cell = (2 * R) / N, cells = [];
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const x = cx - R + (i + 0.5) * cell, y = cy - R + (j + 0.5) * cell; if (Math.hypot(x - cx, y - cy) <= R - cell * 0.3) cells.push({ x, y, cov: 0, pass: 0, st: -1 }); }
        const limit = opt.diff === 'expert' ? 5.5 : opt.diff === 'hard' ? 6.5 : 8;
        const rad = R * 0.17 * (0.85 + 0.15 * ST().sens);
        let t = 0, sn = 0, down = false, last = null, ended = false;
        const paint = (x, y) => { for (const k of cells) if (Math.hypot(k.x - x, k.y - y) <= rad) { if (k.st !== sn) { k.st = sn; k.pass++; } k.cov = 1; } };
        c.onpointerdown = (e) => { down = true; sn++; try { c.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } last = posOf(c, e); paint(last[0], last[1]); };
        c.onpointermove = (e) => { if (!down) return; const p = posOf(c, e); const d = Math.hypot(p[0] - last[0], p[1] - last[1]); const n = Math.max(1, Math.ceil(d / (rad * 0.4))); for (let i = 1; i <= n; i++) paint(last[0] + ((p[0] - last[0]) * i) / n, last[1] + ((p[1] - last[1]) * i) / n); last = p; };
        c.onpointerup = c.onpointercancel = () => { down = false; };
        ui.foot.innerHTML = `<div class="mg-cov">塗れた範囲 <b id="mg-cov">0</b>%</div><button class="btn primary" id="mg-next">${A.icon('check')} 完了</button>`;
        const end = () => {
          if (ended) return; ended = true; stop();
          const cov = cells.filter((k) => k.cov).length / cells.length, over = cells.filter((k) => k.pass >= 4).length / cells.length;
          const q = clamp(Math.pow(cov, 1.6) - over * 0.6, 0, 1);
          step(q, cov < 0.9 || over > 0.2 ? 'uneven' : null);
        };
        $('#mg-next', ui.root).onclick = end;
        stop = loop((dt) => {
          t += dt; ui.timer.style.width = 100 - (t / limit) * 100 + '%';
          g.clearRect(0, 0, size, size); marbleBoard(g, size);
          turntable(g); fillBatter(g, cx, cy, R, B.color, 0.5);
          for (const k of cells) if (k.cov) { g.fillStyle = k.pass >= 4 ? shadeHex(C.color, -0.12) : C.color; g.beginPath(); g.arc(k.x, k.y, cell * 0.8, 0, PI * 2); g.fill(); }
          const hl = g.createRadialGradient(cx - R * 0.4, cy - R * 0.4, 2, cx, cy, R); hl.addColorStop(0, 'rgba(255,255,255,.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = hl; g.beginPath(); g.arc(cx, cy, R, 0, PI * 2); g.fill();
          const cov = cells.filter((k) => k.cov).length / cells.length; const el = document.getElementById('mg-cov'); if (el) el.textContent = Math.round(cov * 100);
          if (t >= limit || cov >= 0.995) { end(); return false; }
        });
      }
      function turntable(g) { g.fillStyle = '#D8DCE0'; g.beginPath(); g.arc(cx, cy, R * 1.15, 0, PI * 2); g.fill(); g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2; g.stroke(); }
      // ---- 絞り：同じ大きさのクリームを目印の上に ----
      function pipe() {
        ui.sub.textContent = '目印を長押しして絞る。外側の円の大きさで指を離す';
        const { c, g } = canvas();
        const n = 8, spots = [], target = R * 0.13;
        for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2 - PI / 2; spots.push({ x: cx + Math.cos(a) * R * 0.8, y: cy + Math.sin(a) * R * 0.8, r: 0, done: false }); }
        let cur = null, t = 0, ended = false;
        const limit = 6 + n * 0.8;
        c.onpointerdown = (e) => { const p = posOf(c, e); const s = spots.filter((x) => !x.done).sort((a, b) => Math.hypot(a.x - p[0], a.y - p[1]) - Math.hypot(b.x - p[0], b.y - p[1]))[0]; if (!s) return; cur = s; s.off = Math.hypot(s.x - p[0], s.y - p[1]); s.px = p[0]; s.py = p[1]; };
        const up = () => { if (!cur) return; cur.done = true; CS.sound.play('pop'); cur = null; if (spots.every((s) => s.done)) end(); };
        c.onpointerup = up; c.onpointercancel = up; c.onpointerleave = up;
        const end = () => {
          if (ended) return; ended = true; stop();
          const errs = spots.map((s) => (s.done ? Math.abs(s.r - target) / target + (s.off || 0) / (R * 0.6) : 1));
          const avg = errs.reduce((a, b) => a + b, 0) / n;
          const q = clamp(1 - Math.max(0, avg - 0.12 * diff.win) * 1.6, 0.1, 1);
          step(q, q < 0.55 ? 'uneven' : null);
        };
        stop = loop((dt) => {
          t += dt; ui.timer.style.width = 100 - (t / limit) * 100 + '%';
          if (cur) cur.r += dt * target * 1.1 * ST().sens;
          g.clearRect(0, 0, size, size); marbleBoard(g, size); turntable(g); fillBatter(g, cx, cy, R, C.color, 0.4);
          spots.forEach((s) => {
            if (!s.done && s !== cur) { g.setLineDash([4, 4]); g.strokeStyle = 'rgba(60,45,40,.5)'; g.lineWidth = 1.5; g.beginPath(); g.arc(s.x, s.y, target, 0, PI * 2); g.stroke(); g.setLineDash([]); }
            if (s.r > 0) { const x = s.px || s.x, y = s.py || s.y; const gr = g.createRadialGradient(x - s.r * 0.3, y - s.r * 0.4, 1, x, y, s.r); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.5, shadeHex(C.color, 0.1)); gr.addColorStop(1, shadeHex(C.color, -0.15)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, s.r, 0, PI * 2); g.fill(); g.strokeStyle = 'rgba(0,0,0,.08)'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x, y, s.r * (0.3 + k * 0.15), k, k + 2); g.stroke(); } }
          });
          if (t >= limit) { spots.forEach((s) => { if (s === cur) s.done = true; }); end(); return false; }
        });
      }
      // ---- トッピング ----
      function top() {
        if (!tops.length) { qs.push(1); return next(); }
        ui.sub.textContent = '目印の位置にトッピングを置く' + (diff.vanish ? '（目印はすぐ消える）' : '');
        placeGame(null, tops.length, tops.length <= 3 ? R * 0.42 : R * 0.6, 'spots', (q) => step(q, q < 0.5 ? 'messy' : null));
      }
      // 置くゲーム（共通）
      function placeGame(kind, n, ringR, mode, done) {
        const { c, g } = canvas();
        const list = kind ? new Array(n).fill(kind) : tops.slice();
        const spots = [];
        if (n === 1) spots.push([cx, cy]); else { const off = Math.random() * PI; for (let i = 0; i < n; i++) { const a = off + (i / n) * PI * 2; spots.push([cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR]); } }
        const used = new Array(n).fill(false), placed = [];
        let show = true, t = 0, ended = false;
        const limit = 5 + n * 1.2, tol = R * 0.2 * diff.win;
        if (diff.vanish) setTimeout(() => { show = false; ui.hint.textContent = '覚えた位置に置く'; }, 1300);
        ui.hint.textContent = '点線の円をタップ';
        const imgs = {};
        list.forEach((k) => { if (imgs[k]) return; const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 20 20">${A.topGlyph(k, 0, 0, 1.2)}</svg>`); imgs[k] = im; });
        c.onpointerdown = (e) => {
          if (ended) return;
          const [x, y] = posOf(c, e); let bi = -1, bd = 1e9;
          spots.forEach((p, i) => { if (used[i]) return; const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; bi = i; } });
          if (bi < 0) return; used[bi] = true;
          placed.push({ k: list[placed.length], x, y, sc: clamp(1 - bd / tol, 0, 1) });
          CS.sound.play(bd < tol * 0.5 ? 'pop' : 'tap');
          if (placed.length >= n) end();
        };
        const end = () => { if (ended) return; ended = true; const q = placed.length ? placed.reduce((a, p) => a + p.sc, 0) / n : 0; setTimeout(() => done(q), 300); };
        stop = loop((dt) => {
          t += dt; ui.timer.style.width = 100 - (t / limit) * 100 + '%';
          g.clearRect(0, 0, size, size); marbleBoard(g, size); turntable(g);
          fillBatter(g, cx, cy, R, mode === 'ring' ? B.color : (C.color || B.color), 0.45);
          if (mode === 'ring') { g.globalAlpha = 0.85; fillBatter(g, cx, cy, R * 0.92, C.color || '#FFFDF7', 0.3); g.globalAlpha = 1; }
          if (show) { g.setLineDash([5, 5]); g.strokeStyle = 'rgba(200,60,80,.75)'; g.lineWidth = 2; spots.forEach((p, i) => { if (!used[i]) { g.beginPath(); g.arc(p[0], p[1], tol * 0.55, 0, PI * 2); g.stroke(); } }); g.setLineDash([]); }
          placed.forEach((p) => { const im = imgs[p.k]; const s = R * 0.3; if (im && im.complete) { g.save(); g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 4; g.shadowOffsetY = 2; g.drawImage(im, p.x - s / 2, p.y - s / 2, s, s); g.restore(); } });
          if (t >= limit && !ended) end();
          if (ended && t > limit + 1) return false;
        });
      }
      // ---- 袋詰め（焼き菓子）：割れていない物だけを選んで詰める ----
      function pack() {
        const unit = recipe.unit || '袋', badN = Math.min(4, Math.max(2, Math.round(3 / diff.win))), need = 8;
        ui.sub.textContent = '割れ・焦げのない物だけを ' + need + ' 個えらんで' + (unit === '袋' ? '袋に詰める' : '並べる');
        const { c, g } = canvas();
        const items = [], cols = 4, rows = 3, cw = size / (cols + 0.6), ch2 = size / (rows + 1.4);
        const badIdx = shuffle([...Array(cols * rows).keys()]).slice(0, badN);
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { const i = r * cols + k; items.push({ x: cw * (k + 0.8), y: ch2 * (r + 1.0), bad: badIdx.includes(i), crack: Math.random(), got: false }); }
        let picked = 0, wrong = 0, t = 0, ended = false;
        const limit = 9 / Math.max(0.7, diff.win);
        const R2 = Math.min(cw, ch2) * 0.36;
        c.onpointerdown = (e) => {
          if (ended) return;
          const [x, y] = posOf(c, e); const it = items.find((q) => !q.got && Math.hypot(q.x - x, q.y - y) < R2 * 1.1);
          if (!it) return;
          it.got = true;
          if (it.bad) { wrong++; CS.sound.play('bad'); ui.hint.textContent = '割れたものを入れてしまった…'; } else { picked++; CS.sound.play('pop'); }
          if (picked >= need || items.every((q) => q.got || q.bad)) end();
        };
        const end = () => { if (ended) return; ended = true; stop(); const q = clamp(picked / need - wrong * 0.18, 0, 1); step(q, wrong >= 2 ? 'messy' : null); };
        ui.hint.textContent = 'タップで選ぶ';
        stop = loop((dt) => {
          t += dt; ui.timer.style.width = 100 - (t / limit) * 100 + '%';
          g.clearRect(0, 0, size, size); marbleBoard(g, size);
          g.fillStyle = '#A9AEB3'; g.fillRect(cw * 0.25, ch2 * 0.45, cw * cols + cw * 0.1, ch2 * rows + ch2 * 0.1);
          items.forEach((it) => {
            if (it.got) return;
            g.save(); g.translate(it.x, it.y);
            const base = it.bad && it.crack > 0.5 ? shadeHex(B.color, -0.45) : B.color;
            g.fillStyle = base; g.strokeStyle = shadeHex(B.crumb, -0.1); g.lineWidth = 1.5;
            g.beginPath(); if (B.shell) g.ellipse(0, 0, R2 * 0.75, R2, 0, 0, PI * 2); else g.arc(0, 0, R2, 0, PI * 2); g.fill(); g.stroke();
            if (B.shell) { g.strokeStyle = 'rgba(120,70,25,.35)'; for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(0, R2 * 0.9); g.lineTo(k * R2 * 0.2, -R2 * 0.8); g.stroke(); } }
            if (tops.includes('choco')) { g.fillStyle = '#3B2116'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(Math.cos(k * 2.1) * R2 * 0.5, Math.sin(k * 2.1) * R2 * 0.45, R2 * 0.12, 0, PI * 2); g.fill(); } }
            if (it.bad && it.crack <= 0.5) { g.strokeStyle = '#4A2A14'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(-R2 * 0.8, -R2 * 0.2); g.lineTo(-R2 * 0.1, R2 * 0.1); g.lineTo(R2 * 0.3, -R2 * 0.3); g.lineTo(R2 * 0.85, R2 * 0.15); g.stroke(); }
            g.restore();
          });
          g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '700 15px "Zen Kaku Gothic New",sans-serif'; g.textAlign = 'center'; g.fillText(picked + ' / ' + need + ' ' + unit, size / 2, size - 12);
          if (t >= limit && !ended) { end(); return false; }
        });
      }
      // ---- 流し込み（タルト） ----
      function pour() {
        ui.sub.textContent = 'クリームを流し込む。線の高さで止める（入れすぎるとあふれる）';
        const { c, g } = canvas();
        let lv = 0, pouring = false, t = 0, ended = false;
        const line = 0.72, limit = 8;
        ui.foot.innerHTML = `<button class="btn big pour-btn" id="mg-pour">押している間 流す</button><button class="btn primary" id="mg-ok">${A.icon('check')} 止める</button>`;
        const pb = $('#mg-pour', ui.root);
        pb.addEventListener('pointerdown', (e) => { e.preventDefault(); pouring = true; }); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => pb.addEventListener(ev, () => (pouring = false)));
        const end = () => { if (ended) return; ended = true; stop(); const err = Math.abs(lv - line); const q = clamp(1 - Math.max(0, err - 0.04 * diff.win) * 4, 0.1, 1); step(q, lv > 0.95 ? 'messy' : null); };
        $('#mg-ok', ui.root).onclick = end;
        stop = loop((dt) => {
          t += dt; ui.timer.style.width = 100 - (t / limit) * 100 + '%';
          if (pouring) lv += dt * 0.22 * ST().sens;
          g.clearRect(0, 0, size, size); marbleBoard(g, size);
          const x0 = size * 0.12, x1 = size * 0.88, y0 = size * 0.35, y1 = size * 0.7;
          g.fillStyle = B.color; g.fillRect(x0, y0, x1 - x0, y1 - y0);
          g.fillStyle = shadeHex(B.color, 0.35); g.fillRect(x0 + 10, y0, x1 - x0 - 20, y1 - y0 - 10);
          const fy = y1 - 10 - (y1 - y0 - 10) * clamp(lv, 0, 1.1);
          g.fillStyle = C.color || '#FFE07A'; g.fillRect(x0 + 10, fy, x1 - x0 - 20, y1 - 10 - fy);
          if (lv > 1) { g.fillRect(x0 - 6, y0 - 4, 12, (y1 - y0) * (lv - 1) * 3); }
          const ly = y1 - 10 - (y1 - y0 - 10) * line; g.setLineDash([6, 4]); g.strokeStyle = 'rgba(60,45,40,.7)'; g.beginPath(); g.moveTo(x0 - 10, ly); g.lineTo(x1 + 10, ly); g.stroke(); g.setLineDash([]);
          if (pouring) { g.fillStyle = C.color || '#FFE07A'; g.fillRect(cx - 4, 0, 8, fy); }
          if (t >= limit && !ended) end();
        });
      }
      // ---- モンブラン絞り：中心からうず巻き ----
      function mont() {
        ui.sub.textContent = '中心から外へ、うず巻きを途切れずに描く';
        const { c, g } = canvas();
        const pts = []; let down = false, ended = false;
        c.onpointerdown = (e) => { down = true; try { c.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } pts.push(posOf(c, e)); };
        c.onpointermove = (e) => { if (down) pts.push(posOf(c, e)); };
        c.onpointerup = () => {
          if (!down || ended) return; down = false;
          let turn = 0; for (let i = 2; i < pts.length; i++) { const a1 = Math.atan2(pts[i - 1][1] - cy, pts[i - 1][0] - cx), a2 = Math.atan2(pts[i][1] - cy, pts[i][0] - cx); let d = a2 - a1; if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI; turn += d; }
          const reach = pts.length ? Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy))) / R : 0;
          ended = true; stop();
          const q = clamp(Math.min(1, Math.abs(turn) / (PI * 6)) * 0.7 + Math.min(1, reach / 0.85) * 0.3, 0.1, 1);
          step(q, q < 0.55 ? 'uneven' : null);
        };
        stop = loop(() => {
          g.clearRect(0, 0, size, size); marbleBoard(g, size); turntable(g); fillBatter(g, cx, cy, R, B.color, 0.4);
          if (pts.length > 1) { g.strokeStyle = C.color; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 9; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 3; g.stroke(); }
        });
        ui.hint.textContent = 'ゆっくり3周以上';
      }
      next();
    });
  }

  CS.mg = { mix, whip, deco, close };
})(typeof window !== 'undefined' ? window : globalThis);
