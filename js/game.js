/* ケーキ屋さんシミュレーター : ゲーム画面 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data, sim = CS.sim, A = CS.art, net = CS.net, save = CS.save, ST = CS.settings, UI = CS.ui;
  const { $, $$, yen, esc } = UI;
  const ic = A.icon;
  const R = D.RULES;
  const clamp = sim.clamp;
  const qtxt = (q) => Math.round(q * 100);
  const MD = CS.models;
  const cakeImg = (r, pieces, df, cls) => MD.img(MD.thumb.cake(r, pieces, df), 'thumb ' + (cls || ''), r.name || '');
  const face = (skin) => MD.img(MD.thumb.face(skin), 'face');
  const dfChips = (df) => (df && df.length ? `<span class="dfc">${df.map((d) => `<span class="chip bad">⚠ ${esc(D.DEFECTS[d].name)}</span>`).join('')}</span>` : '');
  const mmss = (ms) => { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  const game = (CS.game = { room: null, keys: {}, raf: 0, custEls: {}, alerted: {}, mq: {}, lab: { base: 'plain', cream: 'whip', tops: {} }, lastFunds: null, lastPieces: [], lastKitchen: 0 });
  const S = () => game.room && game.room.S;
  const act = (a) => game.room && game.room.act(a);
  const working = () => S() && (S().phase === 'prep' || S().phase === 'open');

  // =====================================================================
  //  入店・退店
  // =====================================================================
  game.enter = async function (code) {
    CS.landscape && CS.landscape();
    UI.loading(true, 'お店に向かっています…');
    try {
      if (game.room) await game.leave(false, true);
      const room = new CS.Room(code, { light: ST.light });
      game.room = UI.room = room;
      game.keys = {}; game.custEls = {}; game.alerted = {}; game.lastFunds = null; game.lastPieces = [];
      room.on('state', () => game.onState());
      room.on('members', () => { game.keys.kitchen = ''; game.keys.ov = ''; game.renderParty(); game.renderOverlay(); });
      room.on('meta', () => { game.keys.ov = ''; game.renderOverlay(); game.renderParty(); });
      room.on('fx', (f) => game.onFx(f));
      room.on('chat', (m, id) => game.onChat(m, id));
      room.on('host', () => game.renderParty());
      game.build();
      await room.enter();
      CS.rememberShop(code, (room.meta && room.meta.name) || room.S.name);
      UI.show('game');
      CS.applySettings();
      game.onState();
      cancelAnimationFrame(game.raf);
      game.raf = requestAnimationFrame(game.frame);
      if (!CS.LS.get('cs.tut2', null)) setTimeout(() => game.tutorial(true), 600);
    } catch (e) {
      console.error(e);
      UI.toast('お店に入れませんでした：' + (e.message || e), 'err');
      game.room = UI.room = null;
      UI.show('title'); UI.renderTitle();
    }
    UI.loading(false);
  };
  game.leave = async function (remove, silent) {
    cancelAnimationFrame(game.raf);
    CS.world.destroy();
    const r = game.room;
    game.room = UI.room = null;
    UI.closeSheet();
    if (r) { try { await r.leave(remove); } catch (e) { /* noop */ } if (remove) CS.forgetShop(r.code); }
    if (!silent) { UI.show('title'); UI.renderTitle(); }
  };

  // =====================================================================
  //  画面の骨組み（一人称の 3D）
  // =====================================================================
  const touch = () => (G.matchMedia ? matchMedia('(pointer: coarse)').matches : false);
  game.build = function () {
    const T = touch();
    $('#scr-game').innerHTML = `
      <header class="hud">
        <div class="hud-day"><b id="h-day">1日目</b><span id="h-sub">月・晴れ</span></div>
        <div class="hud-clock"><span class="phase" id="h-phase">CLOSE</span><b id="h-clock" class="num">10:00</b><i class="bar"><u id="h-bar"></u></i></div>
        <button class="btn sm ghost hud-end" id="h-end" hidden>${ic('door')} 今日は閉店</button>
        <div class="hud-money num" id="h-money">¥0</div>
        <div class="hud-rep" title="お店の評判"><b id="h-rep">★2.8</b><small>評判</small></div>
        <button class="hud-lv" id="h-lv" title="店舗レベル"><b id="h-lvn">Lv1</b><i class="bar"><u id="h-lvb"></u></i></button>
        <div class="hud-party" id="h-party"></div>
        <button class="icon-btn" id="h-menu" aria-label="設定とお店の情報">${ic('gear')}</button>
      </header>
      <div class="floor" id="floor">
        <div class="world" id="world"></div>
        <div class="orders" id="orders" aria-label="注文"></div>
        <div class="tut panel" id="tut" hidden></div>
        <div class="chat-float" id="chatFloat" aria-live="polite"></div>
        <div class="prompt" id="prompt" aria-live="polite"></div>
        <div class="held" id="held" hidden></div>
        <div class="lockhint" id="lockhint" ${T || CS.LS.get('cs.mh', false) ? 'hidden' : ''}>${ic('hand')} マウスを動かすと見回せます（ボタンは押さなくてOK）・WASD＝移動・クリック＝つかむ／置く・右クリック＝使う</div>
        <div class="fabs" id="fabs">
          <div class="mv joy" data-id="joy" id="joy" ${T ? '' : 'hidden'}><i></i></div>
          <button class="mv act-btn" data-id="act" id="b-act" aria-label="つかむ・置く"><span class="ab-ic">${ic('hand')}</span><span class="ab-t">つかむ</span></button>
          <button class="mv act-btn sub" data-id="sec" id="b-sec" aria-label="使う"><span class="ab-ic">${ic('bolt')}</span><span class="ab-t">使う</span></button>
          <button class="mv act-btn sub del" data-id="del" id="b-del" aria-label="捨てる"><span class="ab-ic">${ic('trash')}</span><span class="ab-t">捨てる</span></button>
          <button class="mv fab" data-id="book">${ic('book')}レシピ</button>
          <button class="mv fab" data-id="chat">${ic('chat')}スタンプ</button>
        </div>
        <div class="overlay" id="gov" hidden></div>
        <div class="rotate" id="rotate"><div class="panel">${ic('phone')}<b>スマホを横向きにしてね</b><small class="muted">このゲームは横画面で遊びます</small></div></div>
      </div>`;
    $('#scr-game').classList.toggle('touch', T);
    $('#h-menu').onclick = () => UI.openSettings(true);
    $('#h-money').onclick = () => game.openBiz('today');
    $('#h-lv').onclick = () => game.openBiz('level');
    $('#h-end').onclick = async () => { if (await UI.confirm('今日の営業を終える', 'ショーケースの残りや作りかけは閉店時に片づけ（廃棄）になります。日報に進みますか？', '閉店する', true)) act({ t: 'endDay' }); };
    $$('#fabs .fab').forEach((b) => (b.onclick = () => {
      if (game.editingFabs) return;
      CS.sound.play('tap');
      ({ book: () => game.openRecipeBook(), chat: game.openChat })[b.dataset.id]();
    }));
    const W = CS.world;
    const press = (id, fn) => { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (game.editingFabs) return; b.classList.add('pressed'); fn(); }); const up = () => b.classList.remove('pressed'); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up); };
    if (!W.init($('#world'))) UI.toast('3D 表示が使えない端末です', 'err');
    W.bindJoystick($('#joy'));
    press('#b-act', () => W.primary()); press('#b-sec', () => W.secondary()); press('#b-del', () => W.discard());
    W.onTarget = (t, held) => game.renderPrompt(t, held);
    W.onUI = (k) => { if (k === 'pc') game.openPC(); else if (k === 'menu') game.openMenu('sell'); };
    { const used = {}; W.onMouseUsed = (k) => { used[k] = 1; if (used.move && used.click) { const h = $('#lockhint'); if (h && !h.hidden) { h.hidden = true; CS.LS.set('cs.mh', true); } } }; }
    if (!game._plBound) {
      game._plBound = true;
      document.addEventListener('keydown', (e) => {
        if (!game.room || UI.scr !== 'game' || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
        if (UI.sheet || !$('#modal').hidden) return;
        if (e.code === 'KeyR') game.openRecipeBook();
        else if (e.code === 'KeyT') game.openChat();
        else if (e.code === 'Tab') { e.preventDefault(); game.openPC(); }
      });
    }
    game._prompt = ''; game._ordKey = '';
    UI.layoutFabs();
  };
  // 照準の先にあるものと、できる操作
  const keyCap = (k) => `<kbd>${k}</kbd>`;
  game.renderPrompt = function (t, held) {
    const s = S(); if (!s) return;
    const T = touch();
    const pri = t && t.pri, sec = t && t.sec, del = t && t.del;
    const hName = held ? CS.world.itemName(held, s) : '';
    const delLabel = del ? del.label : held ? (held.t === 'crate' ? '' : '捨てる') : '';
    const key = JSON.stringify([t && t.name, pri && pri.label, sec && sec.label, delLabel, hName, t && t.aimOK, T]);
    if (game._prompt === key) return;
    game._prompt = key;
    const el = $('#prompt'); if (!el) return;
    if (t) {
      const rows = [];
      if (pri) rows.push(`<span class="pa">${T ? '' : keyCap('E')}${esc(pri.label)}</span>`);
      if (sec) rows.push(`<span class="pa">${T ? '' : keyCap('F')}${esc(sec.label)}</span>`);
      if (delLabel && !T) rows.push(`<span class="pa dim">${keyCap('Q')}${esc(delLabel)}</span>`);
      el.innerHTML = `<b>${esc(t.name || '')}</b>${rows.length ? `<span class="pr">${rows.join('')}</span>` : ''}`;
      el.hidden = false;
    } else el.hidden = true;
    const hd = $('#held');
    if (held) { hd.hidden = false; hd.innerHTML = `${ic('hand')}<span>${esc(hName)}</span>${held.df && held.df.length ? `<span class="chip bad">${esc(held.df.map((d) => (D.DEFECTS[d] || {}).name || d).join('・'))}</span>` : ''}`; } else hd.hidden = true;
    const setB = (id, a, fallback) => { const b = $(id); if (!b) return; const lab = a ? a.label || a : fallback; b.querySelector('.ab-t').textContent = lab || fallback || ''; b.classList.toggle('on', !!a); b.classList.toggle('off', !a); };
    setB('#b-act', pri, held ? '置く' : 'つかむ');
    setB('#b-sec', sec, '使う');
    setB('#b-del', delLabel ? { label: delLabel } : null, '捨てる');
    const xh = $('#xhair'); if (xh) xh.className = 'xhair' + (pri || sec ? ' on' : '') + (t && t.pri && t.pri.aim ? (t.aimOK ? ' aim ok' : ' aim') : '');
  };

  // =====================================================================
  //  ボタン配置（大きさ・位置の変更） ※スティックと操作ボタンも動かせる
  // =====================================================================
  const DEF_POS = {
    right: { joy: { x: 13, y: 72 }, act: { x: 89, y: 74 }, sec: { x: 76, y: 85 }, del: { x: 78, y: 62 }, book: { x: 27, y: 90 }, chat: { x: 35, y: 90 } },
    left: { joy: { x: 87, y: 72 }, act: { x: 11, y: 74 }, sec: { x: 24, y: 85 }, del: { x: 22, y: 62 }, book: { x: 73, y: 90 }, chat: { x: 65, y: 90 } },
  };
  UI.layoutFabs = function () {
    const f = $('#fabs'); if (!f) return;
    f.className = 'fabs' + (game.editingFabs ? ' editing' : '');
    const def = DEF_POS[ST.hand === 'left' ? 'left' : 'right'];
    $$('.mv', f).forEach((b) => {
      const p = (ST.fab && ST.fab[b.dataset.id]) || def[b.dataset.id];
      b.style.left = p.x + '%'; b.style.top = p.y + '%';
    });
  };
  UI.editFabs = function () {
    const f = $('#fabs'), floor = $('#floor'); if (!f || !floor) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const def = DEF_POS[ST.hand === 'left' ? 'left' : 'right'];
    ST.fab = Object.assign({}, def, ST.fab || {});
    const joy = $('#joy'); const joyWas = joy.hidden; joy.hidden = false;
    game.editingFabs = true; CS.world.editing = true;
    UI.layoutFabs();
    const bar = document.createElement('div');
    bar.className = 'edit-bar panel'; bar.id = 'editbar';
    bar.innerHTML = `<span class="small">ボタンをドラッグして移動</span><button class="btn sm ghost" id="eb-reset">元に戻す</button><button class="btn sm mint" id="eb-done">${ic('check')} 完了</button>`;
    floor.appendChild(bar);
    let drag = null;
    const down = (e) => { const b = e.target.closest('.mv'); if (!b) return; drag = { b, id: e.pointerId }; try { f.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } e.preventDefault(); e.stopPropagation(); };
    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const r = floor.getBoundingClientRect();
      const x = clamp(((e.clientX - r.left) / r.width) * 100, 4, 96), y = clamp(((e.clientY - r.top) / r.height) * 100, 10, 94);
      ST.fab[drag.b.dataset.id] = { x, y };
      drag.b.style.left = x + '%'; drag.b.style.top = y + '%';
    };
    const up = () => { if (drag) { ST.save(); drag = null; } };
    f.addEventListener('pointerdown', down, true); f.addEventListener('pointermove', move); f.addEventListener('pointerup', up); f.addEventListener('pointercancel', up);
    const end = () => { game.editingFabs = false; CS.world.editing = false; joy.hidden = joyWas; f.removeEventListener('pointerdown', down, true); f.removeEventListener('pointermove', move); f.removeEventListener('pointerup', up); f.removeEventListener('pointercancel', up); bar.remove(); ST.save(); UI.layoutFabs(); };
    $('#eb-done', bar).onclick = () => { end(); UI.toast('ボタンの位置を保存しました', 'good'); };
    $('#eb-reset', bar).onclick = () => { ST.fab = null; end(); UI.toast('元の位置に戻しました'); };
  };

  // =====================================================================
  //  描画
  // =====================================================================
  game.onState = function () {
    const s = S(); if (!s) return;
    CS.world.sync(s, game.room);
    game.renderHud(s);
    game.renderOverlay();
    game.renderOrders(s);
    game.tutCheck(s);
    UI.renderSheet(false);
  };
  game.renderHud = function (s) {
    const w = D.WEATHER.find((x) => x.id === s.weather) || D.WEATHER[0];
    $('#h-day').textContent = s.day + '日目';
    $('#h-sub').textContent = D.DOW[(s.day - 1) % 7] + '曜・' + w.name;
    const m = $('#h-money');
    if (game.lastFunds !== null && s.funds !== game.lastFunds) { m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); }
    game.lastFunds = s.funds;
    m.textContent = yen(s.funds);
    m.classList.toggle('neg', s.funds < 0);
    $('#h-rep').textContent = '★' + s.rep.toFixed(1);
    const L = sim.shopLevel(s);
    $('#h-lvn').textContent = 'Lv' + L.lv; $('#h-lvb').style.width = (L.max ? 100 : Math.round(L.f * 100)) + '%';
    $('#h-lv').title = '店舗レベル ' + L.lv + (L.max ? '（最大）' : '・次まで ' + (L.next - L.xp) + 'pt');
    $('#h-end').hidden = !(s.phase === 'prep' && s.dayT > 0);
  };
  game.renderParty = function () {
    const r = game.room; if (!r || !$('#h-party')) return;
    const hostPid = r.meta && r.devices[r.meta.host] ? r.devices[r.meta.host].pid : r.local ? r.pid : '';
    const ids = Object.keys(r.members).sort((a, b) => (r.members[a].joined || 0) - (r.members[b].joined || 0));
    $('#h-party').innerHTML = ids.map((pid) => `<span class="pa ${r.isOnline(pid) || r.local ? '' : 'off'} ${pid === hostPid ? 'host' : ''}" title="${esc(r.members[pid].name || '')}${pid === hostPid ? '（ホスト）' : ''}">${face(r.members[pid].skin)}</span>`).join('');
  };
  // 注文票（待っているお客さん）— 画面の左上
  game.renderOrders = function (s) {
    const el = $('#orders'); if (!el) return;
    const g = game.room.now();
    const ws = Object.keys(s.cust).filter((id) => s.cust[id].st === 'w').sort((a, b) => s.cust[a].no - s.cust[b].no).slice(0, 6);
    let nq = 0; for (const id in s.cust) if (s.cust[id].st === 'q') nq++;
    // 並び（注文の中身）が変わったときだけ作り直し、残り時間は文字だけ書き換える（ちらつき防止）
    const key = JSON.stringify([ws.map((id) => [id, s.cust[id].no, s.cust[id].ord]), nq]);
    if (game._ordKey !== key) {
      game._ordKey = key;
      el.innerHTML = ws.map((id) => { const c = s.cust[id]; return `<div class="ord" data-c="${esc(id)}"><b>#${c.no}</b><span>${Object.keys(c.ord).map((r) => `${esc((sim.recipe(s, r) || {}).name || r)} ×${c.ord[r]}`).join('<br>')}</span><i class="num"></i></div>`; }).join('') + (nq ? `<div class="ord q">${ic('people')} レジ待ち ${nq}人</div>` : '');
    }
    $$('.ord[data-c]', el).forEach((d) => { const c = s.cust[d.dataset.c]; if (!c) return; const left = Math.max(0, Math.ceil(((c.pw || 0) - g) / 1000)); const t = left + 's'; const i = d.lastChild; if (i.textContent !== t) i.textContent = t; d.classList.toggle('late', left < 12); });
  };
  // ---------- 毎フレーム ----------
  game.frame = function () {
    const r = game.room;
    if (!r || !r.S) return;
    const s = r.S, g = r.now();
    CS.world.hudH = (game._hudH = game._hudH || ($('.hud') ? $('.hud').offsetHeight : 52));
    CS.world.frame();
    const pi = sim.phaseInfo(s, g);
    const ph = $('#h-phase');
    if (ph) {
      ph.textContent = pi.label; ph.className = 'phase ' + pi.phase;
      $('#h-clock').textContent = sim.clockStr(pi.min);
      $('#h-bar').style.width = pi.f * 100 + '%';
    }
    if (!game._ordT || performance.now() - game._ordT > 500) { game._ordT = performance.now(); game.renderOrders(s); }
    game.raf = requestAnimationFrame(game.frame);
  };
  // =====================================================================
  //  オーバーレイ（ロビー・日報・倒産）
  // =====================================================================
  game.renderOverlay = function () {
    const r = game.room, s = S(); if (!r || !s) return;
    const ov = $('#gov'); if (!ov) return;
    const mem = Object.keys(r.members).map((p) => [p, r.members[p].name, r.isOnline(p)]);
    const key = JSON.stringify([s.phase, s.day, s.bankrupt, mem, s.history.length, r.meta && r.meta.host]);
    if (game.keys.ov === key) return;
    game.keys.ov = key;
    if (s.bankrupt) {
      ov.hidden = false;
      ov.innerHTML = `<div class="panel ov-card"><h2>倒産してしまった…</h2><p style="text-align:center;margin:0">資金が ${yen(R.BANKRUPT)} を下回りました。<br>原価と価格、作りすぎ（廃棄）を見直して、もう一度挑戦しよう。</p><button class="btn big pink wide" id="ov-reset">最初からやり直す</button><button class="btn ghost" id="ov-title">タイトルへ</button></div>`;
      $('#ov-reset').onclick = async () => { if (await UI.confirm('やり直す', 'このお店を1日目からやり直します。', 'やり直す', true)) act({ t: 'reset' }); };
      $('#ov-title').onclick = () => game.leave(false);
      return;
    }
    if (s.phase === 'lobby') {
      ov.hidden = false;
      const ids = Object.keys(r.members).sort((a, b) => (r.members[a].joined || 0) - (r.members[b].joined || 0));
      const seats = [];
      for (let i = 0; i < R.MAX_PLAYERS; i++) {
        const p = ids[i];
        if (p) seats.push(`<div class="seat ${r.isOnline(p) || r.local ? '' : 'off'}"><div class="av">${MD.img(MD.thumb.body(r.members[p].skin), 'body')}</div><span class="nm">${esc(r.members[p].name)}</span><span class="chip ${r.isOnline(p) || r.local ? 'ok' : ''}">${p === r.pid ? 'あなた' : r.isOnline(p) ? '入店中' : 'おやすみ'}</span></div>`);
        else seats.push(`<div class="seat empty">${r.local ? '—' : 'あき席'}</div>`);
      }
      const link = location.origin + location.pathname + '?room=' + r.code;
      ov.innerHTML = `<div class="panel ov-card"><h2>${esc((r.meta && r.meta.name) || s.name)}</h2>
        <p class="muted" style="text-align:center;margin:-6px 0 0">ロビー・むずかしさ「${esc(D.DIFF[s.diff].name)}」</p>
        ${r.local ? '<div class="banner">オフラインのお店です（ひとり用）。Firebase を設定すると、招待コードでみんなと遊べます。</div>' : `<div class="invite"><span class="small">招待コード（最大${R.MAX_PLAYERS}人）</span><div class="code" id="ov-code">${esc(r.code)}</div><div class="row wrap" style="justify-content:center"><button class="btn sm" id="ov-cc">${ic('copy')} コードをコピー</button><button class="btn sm" id="ov-cl">${ic('link')} 招待リンクをコピー</button></div></div>`}
        <div class="seats">${seats.join('')}</div>
        <button class="btn big pink wide" id="ov-start">${ic('play')} お店に入る（準備から）</button>
        <p class="muted small" style="margin:0;text-align:center">だれが押してもスタートできます。お店は CLOSE から始まり、外の看板で OPEN にします。途中から参加もできます。</p>
        <div class="row" style="justify-content:center"><button class="btn sm ghost" id="ov-skin">${ic('shirt')} きせかえ</button><button class="btn sm ghost" id="ov-title">${ic('door')} タイトルへ</button></div></div>`;
      if (!r.local) { $('#ov-cc').onclick = () => UI.copy(r.code, $('#ov-code')); $('#ov-cl').onclick = () => UI.copy(link); }
      $('#ov-start').onclick = () => { CS.sound.play('open'); act({ t: 'start' }); };
      $('#ov-skin').onclick = () => UI.openSkin();
      $('#ov-title').onclick = () => game.leave(false);
      return;
    }
    if (s.phase === 'report') {
      const h = s.history[s.history.length - 1];
      if (!h) { ov.hidden = true; return; }
      ov.hidden = false;
      const prev = s.history[s.history.length - 2];
      const repD = prev ? h.rep - prev.rep : 0;
      const best = h.best ? sim.recipe(s, h.best) : null;
      const tips = [];
      if (h.cmp) tips.push('失敗したケーキでクレームが ' + h.cmp + ' 件（' + Object.keys(h.iss || {}).map((k) => D.DEFECTS[k].name + '×' + h.iss[k]).join('、') + '）。評判が大きく下がりました。');
      if (h.miss > h.cust * 0.3) tips.push('買わずに帰ったお客さんが ' + h.miss + ' 人。売り切れや値段の高さが原因かも。');
      if (h.waste > h.sales * 0.12) tips.push('廃棄が多めです。作る量や仕入れを見直そう。');
      if (h.sat && h.sat < 0.45) tips.push('満足度が低め。品質を上げるか、少し値下げしてみよう。');
      if (h.profit < 0) tips.push('今日は赤字（' + yen(h.profit) + '）。たくさん作って売るほど家賃の負担は軽くなります。');
      if (h.profit > 0 && s.funds > 30000) tips.push('資金に余裕があります。パソコンの「設備」「家具」「拡張」でお店を育てよう！');
      if (h.wages) tips.push('アルバイトの日給 合計 ' + yen(h.wages) + '。働くほどレベルが上がって速くなります。');
      if (!tips.length) tips.push('いい調子！この調子でお店を大きくしよう。');
      const stat = (l, v, cls) => `<div class="stat"><small>${l}</small><b class="${cls || ''}">${v}</b></div>`;
      ov.innerHTML = `<div class="panel ov-card"><h2>${h.d}日目の営業結果</h2>
        <div class="report-grid">${stat('来店', h.cust + '人')}${stat('販売', h.sold + '個')}${stat('売上', yen(h.sales))}${stat('原価', yen(h.cogs))}${stat('廃棄', yen(h.waste), h.waste ? 'neg' : '')}${stat('家賃・光熱費・人件費', yen(h.fixed))}${stat('広告・試作', yen(h.ads))}${stat('利益', yen(h.profit), h.profit >= 0 ? 'pos' : 'neg')}${stat('クレーム', (h.cmp || 0) + '件', h.cmp ? 'neg' : '')}${stat('評判', '★' + h.rep.toFixed(1) + (repD ? (repD > 0 ? ' ↑' : ' ↓') : ''), repD > 0 ? 'pos' : repD < 0 ? 'neg' : '')}</div>
        ${best ? `<div class="banner pink">${ic('star')} 一番人気：${esc(best.name)}</div>` : ''}
        <div class="banner sky" style="display:grid;gap:2px">${tips.map((t) => '<span>・' + esc(t) + '</span>').join('')}</div>
        <div class="row between small"><span>現在の資金</span><b class="num">${yen(s.funds)}</b></div>
        <button class="btn big pink wide" id="ov-next">${ic('play')} 次の日へ！</button>
        <div class="row" style="justify-content:center"><button class="btn sm ghost" id="ov-biz">${ic('chart')} 収支の推移</button><button class="btn sm ghost" id="ov-up">${ic('home')} 店舗拡張</button></div></div>`;
      $('#ov-next').onclick = () => { CS.sound.play('open'); act({ t: 'next' }); };
      $('#ov-biz').onclick = () => game.openBiz('trend');
      $('#ov-up').onclick = () => game.openBiz('up');
      return;
    }
    ov.hidden = true; ov.innerHTML = '';
  };

  // =====================================================================
  //  演出・チャット
  // =====================================================================
  game.onFx = function (f) {
    switch (f.k) {
      case 'toast': UI.toast(f.x); break;
      case 'err': UI.toast(f.x, 'err'); CS.sound.play('bad'); break;
      case 'phase': UI.toast(f.x, 'big'); CS.sound.play('open'); break;
      case 'cake': UI.toast(f.x, 'good'); CS.sound.play('ok'); CS.sparkle(innerWidth / 2, innerHeight / 2, 18); break;
      case 'discover': UI.toast(f.x, 'big', 3500); CS.sound.play('fanfare'); CS.sparkle(innerWidth / 2, innerHeight / 3, 30); break;
      case 'up': {
        const m = /Lv(\d+) に上がった！\s*(.*)$/.exec(f.x || '');
        if (m) game.levelUp(+m[1], m[2]); else UI.toast(f.x, 'big');
        CS.sound.play('fanfare'); break;
      }
      case 'fail': UI.toast(f.x, 'err'); CS.sound.play('bad'); break;
      case 'good': UI.toast(f.x, 'good'); break;
      case 'info': UI.toast(f.x); break;
      case 'review': UI.toast(f.x, 'err', 3500); CS.sound.play('bad'); break;
      default: break;
    }
  };
  // レベルアップの演出（解放されたものを一覧で）
  game.levelUp = function (lv, text) {
    const old = document.getElementById('lvup'); if (old) old.remove();
    const items = [];
    const t = (text || '').replace(/\s*が解放$/, '');
    t.split('・').forEach((part) => { const names = part.match(/「[^」]+」/g); if (names) names.forEach((n) => items.push((/^新商品/.test(part) ? '🍰 ' : '🔧 ') + n.slice(1, -1))); else if (part.trim()) items.push('🧑‍🍳 ' + part.trim()); });
    const el = document.createElement('div');
    el.id = 'lvup'; el.className = 'lvup'; el.setAttribute('role', 'status');
    el.innerHTML = `<div class="lvup-card"><small>LEVEL UP</small><b>店舗レベル ${lv}</b>${items.length ? `<ul>${items.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}${items.length > 8 ? `<li class="muted">ほか ${items.length - 8} 件</li>` : ''}</ul>` : ''}<span class="muted small">タップで閉じる・「経営 → レベル」で確認</span></div>`;
    document.body.appendChild(el);
    CS.sparkle(innerWidth / 2, innerHeight * 0.35, 40);
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 350); };
    el.onclick = close; setTimeout(close, 5200);
  };
  game.onChat = function (m) {
    const box = $('#chatFloat'); if (!box) return;
    if (m.t && typeof m.t === 'number' && Math.abs(net.now() - m.t) > 20000 && !game.room.local) return;
    const mem = game.room.members[m.pid] || {};
    const el = document.createElement('div');
    el.className = 'cb';
    el.innerHTML = `<span class="h">${face(mem.skin)}</span><span></span>`;
    el.lastChild.textContent = m.text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    CS.sound.play('pop');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 5000);
    if (UI.sheet && UI.sheet.o.key === 'chat') UI.renderSheet(true);
  };

  // =====================================================================
  //  パソコン（仕入れ・設備・家具・アルバイト・経営）
  // =====================================================================
  game.openPC = function (tab) {
    const r = game.room; if (!r) return;
    if (document.pointerLockElement) document.exitPointerLock();
    r.setStation('pc');
    UI.openSheet({
      title: 'パソコン', live: true, key: 'pc', tab: tab || game.pcTab || 'ing',
      tabs: [{ id: 'ing', label: '材料の注文' }, { id: 'eq', label: '設備' }, { id: 'furn', label: '家具' }, { id: 'staff', label: 'アルバイト' }, { id: 'up', label: '拡張' }, { id: 'ad', label: '広告' }, { id: 'today', label: '収支' }, { id: 'level', label: 'レベル' }],
      onClose: () => r.setStation(''),
      render(body, t) {
        const s = S(); game.pcTab = t;
        if (t === 'ing') return game.renderMarket(body, s);
        if (t === 'eq') return game.renderEquip(body, s);
        if (t === 'furn') return game.renderFurn(body, s);
        if (t === 'staff') return game.renderStaff(body, s);
        return game.renderBizTab(body, s, t);
      },
    });
  };
  // ---------- 材料の注文（裏口に段ボールで届く） ----------
  game.renderMarket = function (body, s) {
    const ev = s.mEvent && s.mEvent.id ? `<div class="banner ${s.mEvent.up ? 'pink' : 'mint'}">${D.ING[s.mEvent.id].icon} 今日は${esc(D.ING[s.mEvent.id].name)}が${s.mEvent.up ? '高騰中！' : '特売中！'}</div>` : '';
    const free = CS.kitchen.deliveryFree(s);
    body.innerHTML = `${ev}<div class="row between wrap"><span class="small">資金 <b class="num">${yen(s.funds)}</b>・裏口の置き場 あと<b>${free}</b>箱</span><button class="btn sm mint" id="mk-bulk">${ic('cart')} 販売中メニュー2台分をまとめて注文</button></div>
      <div class="banner sky">${ic('box')}<span>注文した材料は<b>トラック</b>で届きます。到着したら<b>裏口（左奥）から外に出て</b>、段ボール（1箱10個まで）を持って店の中の<b>在庫の棚</b>にしまうと使えるようになります。</span></div>
      <div class="list">${Object.keys(D.ING).map((id) => {
        const ing = D.ING[id]; const p = s.market[id]; const n = game.mq[id] || 5; const have = sim.invCount(s, id);
        const ch = Math.round((p / ing.price - 1) * 100);
        const exp = sim.expSoon(s, id);
        const unit = p * (n >= 10 ? 0.95 : 1); const cost = Math.round(unit * n);
        return `<div class="item mk"><div class="ico">${ing.icon}</div><div class="mid"><b>${esc(ing.name)} <span class="chip ${have ? '' : 'bad'}">在庫 ${have}</span></b><small>${yen(p)}/個 <span class="${ch > 3 ? 'neg' : ch < -3 ? 'pos' : ''}">${ch > 3 ? '▲' + ch + '%' : ch < -3 ? '▼' + -ch + '%' : '±0'}</span>・${ing.life ? (exp !== null ? 'いちばん古いのはあと' + Math.max(0, exp) + '日' : '日持ち' + Math.round(ing.life * sim.eqv(s, 'fridge').life) + '日') : '日持ちする'}</small></div>
          <div class="end"><div class="step"><button data-q="${id}" data-d="-1" aria-label="減らす">${ic('minus')}</button><output>${n}</output><button data-q="${id}" data-d="1" aria-label="増やす">${ic('plus')}</button></div><button class="btn sm yellow num" data-buy="${id}" ${s.funds >= cost && free >= Math.ceil(n / 10) ? '' : 'disabled'}>${yen(cost)}</button></div></div>`;
      }).join('')}</div>
      <p class="muted small" style="margin:0">10個以上で5%オフ。生ものは期限が来ると閉店時に廃棄されます。</p>`;
    const hold = (b) => {
      let t = null, n = 0;
      const stepOnce = () => { const id = b.dataset.q; const v = clamp((game.mq[id] || 5) + +b.dataset.d * (n > 6 ? 5 : 1), 1, 40); game.mq[id] = v; n++; const o = b.parentNode.querySelector('output'); o.textContent = v; const s2 = S(); const cost = Math.round(s2.market[id] * (v >= 10 ? 0.95 : 1) * v); const bb = body.querySelector('[data-buy="' + id + '"]'); bb.textContent = yen(cost); bb.disabled = s2.funds < cost || CS.kitchen.deliveryFree(s2) < Math.ceil(v / 10); };
      b.onpointerdown = (e) => { e.preventDefault(); n = 0; stepOnce(); t = setInterval(stepOnce, 140); UI.busyUntil = Date.now() + 1500; const stop = () => { clearInterval(t); document.removeEventListener('pointerup', stop); }; document.addEventListener('pointerup', stop); };
    };
    $$('[data-q]', body).forEach(hold);
    $$('[data-buy]', body).forEach((b) => (b.onclick = () => { CS.sound.play('coin'); act({ t: 'buy', id: b.dataset.buy, n: game.mq[b.dataset.buy] || 5 }); game.tutMark('order'); }));
    $('#mk-bulk', body).onclick = () => game.bulkBuy();
  };
  game.bulkBuy = async function () {
    const s = S(); const need = {};
    const add = (req, k) => { for (const id in req) need[id] = (need[id] || 0) + req[id] * k; };
    Object.keys(s.menu).filter((rid) => s.menu[rid].on && s.known[rid]).forEach((rid) => { const r = sim.recipe(s, rid); add(D.BASES[r.base].ing, 2); if (r.cream !== 'none') add(D.CREAMS[r.cream].ing, 1); add(r.tops || {}, 2); });
    const buy = []; let total = 0, boxes = 0;
    for (const id in need) { const n = Math.ceil(need[id] - sim.invCount(s, id)); if (n > 0) { const c = Math.round(s.market[id] * (n >= 10 ? 0.95 : 1) * n); buy.push({ id, n, c }); total += c; boxes += Math.ceil(n / 10); } }
    if (!buy.length) return UI.toast('いまの在庫で足りています', 'good');
    const free = CS.kitchen.deliveryFree(s);
    const ok = await UI.confirm('まとめて注文', `<span style="display:grid;gap:4px">${buy.map((b) => `<span>${D.ING[b.id].icon} ${esc(D.ING[b.id].name)} ×${b.n}　<b class="num">${yen(b.c)}</b></span>`).join('')}<b style="border-top:1px solid var(--line);padding-top:4px">合計 ${yen(total)}・段ボール ${boxes}箱</b>${boxes > free ? `<span class="neg">裏口の置き場が足りません（あと${free}箱）。先に段ボールを棚にしまおう</span>` : ''}</span>`, '注文する');
    if (!ok) return;
    if (S().funds < total) return UI.toast('資金が足りません', 'err');
    for (const b of buy) await act({ t: 'buy', id: b.id, n: b.n });
    CS.sound.play('coin'); game.tutMark('order');
  };
  // ---------- 経営のタブ（収支・拡張・広告・レベル） ----------
  game.renderBizTab = function (body, s, t) {
    if (t === 'level') return game.renderLevel(body, s);
    if (t === 'today') {
      const T = s.today;
      let equip = 0; for (const u of D.UPGRADES) equip += s.up[u.id] || 0;
      const wages = s.staff.reduce((a, st) => a + (st ? D.STAFF.wage(st.lv) : 0), 0);
      const rentU = R.RENT + (s.up.floor || 0) * (R.RENT_PER_FLOOR || 1500) + (equip + 2) * R.UTIL_PER_EQUIP;
      const fixed = s.phase === 'report' && s.history.length ? s.history[s.history.length - 1].fixed : rentU + wages;
      const rev = T.sales + T.drinks;
      const prof = rev - T.cogs - T.waste - T.ads - (T.lab || 0) - fixed;
      body.innerHTML = `<div class="card"><h3>${s.day}日目（${s.phase === 'report' ? '確定' : 'いまの時点'}）</h3><dl class="kv">
        <dt>売上（ケーキ）</dt><dd>${yen(T.sales)}</dd><dt>売上（ドリンク）</dt><dd>${yen(T.drinks)}</dd>
        <dt>原価（売れた分）</dt><dd class="neg">-${yen(T.cogs)}</dd><dt>廃棄ロス</dt><dd class="neg">-${yen(T.waste)}</dd>
        <dt>広告・試作</dt><dd class="neg">-${yen(T.ads + (T.lab || 0))}</dd><dt>家賃・光熱費・日給（閉店時）</dt><dd class="neg">-${yen(fixed)}</dd>
        <dt class="tot">営業利益（見込み）</dt><dd class="tot ${prof >= 0 ? 'pos' : 'neg'}">${yen(prof)}</dd></dl></div>
        <div class="card"><dl class="kv"><dt>来店</dt><dd>${T.cust}人</dd><dt>販売</dt><dd>${T.sold}個</dd><dt>買わずに帰った</dt><dd>${T.miss}人（うち売り切れ ${T.soldout}人）</dd><dt>満足度</dt><dd>${T.cust - T.miss > 0 ? Math.round((T.sat / (T.cust - T.miss)) * 100) + '%' : '—'}</dd><dt>今日の仕入れ額</dt><dd>${yen(T.buy || 0)}</dd><dt>設備投資</dt><dd>${yen(T.capex || 0)}</dd><dt class="tot">現在の資金</dt><dd class="tot">${yen(s.funds)}</dd></dl></div>
        ${s.history.length ? `<div class="card"><h3>売上と利益（直近14日）</h3><div class="chart">${chartSVG(s.history.slice(-14))}</div><div class="row small" style="gap:14px"><span><i style="display:inline-block;width:12px;height:12px;background:rgba(201,163,94,.55);border:1.5px solid var(--gold);border-radius:3px"></i> 売上</span><span><i style="display:inline-block;width:14px;height:3px;background:var(--good)"></i> 利益</span></div></div>` : ''}
        <p class="muted small" style="margin:0">資金が ${yen(R.BANKRUPT)} を下回ると倒産です。</p>`;
      return;
    }
    if (t === 'up') {
      const SL = sim.shopLevel(s).lv;
      body.innerHTML = `<div class="row between"><span class="small">資金 <b class="num">${yen(s.funds)}</b>・店舗 <b>Lv${SL}</b></span><span class="small muted">設備1つごとに光熱費 +${yen(R.UTIL_PER_EQUIP)}/日</span></div><div class="list">${D.UPGRADES.map((u) => {
        const lv = s.up[u.id] || 0, max = u.levels.length, cost = u.levels[lv], need = sim.upReq(u, lv);
        const cur = u.vals ? `いま ${u.vals[lv]}台` : '';
        const btn = lv >= max ? '<span class="chip ok">導入済み</span>' : SL < need ? `<span class="chip">${ic('lock')} Lv${need}</span>` : `<button class="btn sm pink num" data-up="${u.id}" ${s.funds >= cost ? '' : 'disabled'}>${yen(cost)}</button>`;
        return `<div class="card upg"><div class="ico">${ic(u.icon)}</div><div style="min-width:0;display:grid;gap:2px"><b>${esc(u.name)}</b><span class="small muted">${esc(u.desc)}${cur ? '（' + cur + '）' : ''}</span><span class="lv">${u.levels.map((_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span></div>${btn}</div>`;
      }).join('')}</div><p class="muted small" style="margin:0">増床するとお店と厨房が広くなり、ミキサー・クリーム台・デコ台・レジの数も増えます。</p>`;
      $$('[data-up]', body).forEach((b) => (b.onclick = async () => { const u = D.UPGRADES.find((x) => x.id === b.dataset.up); if (await UI.confirm(u.name, `${yen(u.levels[S().up[u.id] || 0])} で導入しますか？`, '導入する')) act({ t: 'upgrade', id: u.id }); }));
      return;
    }
    if (t === 'ad') {
      body.innerHTML = `${s.phase === 'prep' ? '' : '<div class="banner">広告は CLOSE（準備中）のあいだに出せます</div>'}<div class="list">${Object.keys(D.ADS).map((k) => { const a = D.ADS[k]; return `<div class="item"><div class="ico">${ic('megaphone')}</div><div class="mid"><b>${esc(a.name)}</b><small>${a.cost ? yen(a.cost) + '・今日の来店数 ×' + a.mult : '広告を出さない'}</small></div><div class="end">${s.ad === k ? '<span class="chip ok">実施中</span>' : `<button class="btn sm" data-ad="${k}" ${s.phase === 'prep' ? '' : 'disabled'}>えらぶ</button>`}</div></div>`; }).join('')}</div><p class="muted small" style="margin:0">広告はその日だけ有効です。作れる量より客が多いと売り切れで評判が下がるので注意！</p>`;
      $$('[data-ad]', body).forEach((b) => (b.onclick = () => act({ t: 'ad', kind: b.dataset.ad })));
    }
  };
  // ---------- レシピ帳（作り方。どこでも見られる） ----------
  game.openRecipeBook = function () {
    if (document.pointerLockElement) document.exitPointerLock();
    UI.openSheet({
      title: 'レシピ帳', live: false, key: 'book',
      render(body) {
        const s = S();
        const howTo = `<div class="card soft"><h3>作り方（ショートケーキの例）</h3><ol class="howto">
          <li><b>型</b>：左奥の棚で「型を取る」</li>
          <li><b>生地</b>：ミキサー上の材料を<b>順番どおり</b>に入れる → ミキサーを回し、ゲージが<b class="pos">緑</b>で止める → 型を持ってミキサーをねらい「型に流す」</li>
          <li><b>焼く</b>：オーブンに入れて電源ON（温度は生地ごとの適温）→ ゲージの緑で「取り出す」</li>
          <li><b>冷ます</b>：右の冷却ラックに置いて冷めるまで待つ</li>
          <li><b>クリーム</b>：クリーム台に材料を入れて泡立て、緑で止める → 「クリームを取る」</li>
          <li><b>デコ</b>：冷めた型をデコ台にのせる → クリームを持って「塗る」（緑で止める）→ トッピングを取ってケーキの上に1つずつ置く → 「仕上げる」</li>
          <li><b>販売</b>：ショーケースに並べる → 外の看板を OPEN → レジで注文を受ける → 箱を取ってショーケースから入れる → お客さんに渡す</li></ol></div>`;
        const comp = (r) => `${esc(D.BASES[r.base].short)}生地 ＋ ${r.cream === 'none' ? 'クリームなし' : esc(D.CREAMS[r.cream].short)}${Object.keys(r.tops || {}).length ? ' ＋ ' + Object.keys(r.tops).map((k) => D.ING[k].icon + '×' + r.tops[k]).join(' ') : ''}`;
        const ingTxt = (req, order) => (order || Object.keys(req)).map((k) => D.ING[k].icon + esc(D.ING[k].name) + '×' + req[k]).join(' → ');
        const known = Object.keys(D.RECIPES).filter((k) => s.known[k]);
        const rows = known.map((rid) => {
          const r = D.RECIPES[rid], B = D.BASES[r.base], Cr = D.CREAMS[r.cream];
          return `<div class="card rcp"><div class="row" style="gap:10px">${cakeImg(r)}<div style="min-width:0;display:grid;gap:2px"><b>${esc(r.name)}</b><span class="small muted">${comp(r)}</span></div></div>
            <dl class="kv small"><dt>生地（${esc(B.short)}）</dt><dd>${ingTxt(B.ing, B.order)}</dd><dt>焼き</dt><dd>${B.temp}℃・約${Math.round(sim.ovenDur(s, r.base) / 1000)}秒</dd>${r.cream !== 'none' ? `<dt>クリーム</dt><dd>${ingTxt(Cr.ing)}</dd>` : ''}${Object.keys(r.tops || {}).length ? `<dt>トッピング</dt><dd>${Object.keys(r.tops).map((k) => D.ING[k].icon + esc(D.ING[k].name) + '×' + r.tops[k]).join('、')}</dd>` : ''}</dl></div>`;
        }).join('');
        const locked = Object.keys(D.RECIPES).filter((k) => !s.known[k]).map((rid) => `<span class="chip">${ic('lock')} ${esc(D.RECIPES[rid].name)}（Lv${D.RECIPES[rid].lv || 1}）</span>`).join(' ');
        body.innerHTML = howTo + rows + (locked ? `<div class="card soft"><h3>まだ作れない商品</h3><div class="row wrap">${locked}</div></div>` : '');
      },
    });
  };

  // =====================================================================
  //  メニュー（販売・価格／レシピ帳／レシピ開発）
  // =====================================================================
  const priceTimers = {};
  game.openMenu = function (tab) {
    UI.openSheet({
      title: 'メニュー', live: true, key: 'menu',
      tabs: [{ id: 'sell', label: '販売・価格' }, { id: 'book', label: 'レシピ帳' }, { id: 'lab', label: 'レシピ開発' }], tab,
      render(body, t) { if (t === 'sell') game.renderSell(body); else if (t === 'book') game.renderBook(body); else game.renderLab(body); },
    });
  };
  function markOf(p) { return p >= 0.7 ? ['◎', 'var(--good)'] : p >= 0.45 ? ['○', 'var(--info)'] : p >= 0.2 ? ['△', 'var(--warn)'] : ['×', 'var(--bad)']; }
  game.renderSell = function (body) {
    const s = S();
    const rids = Object.keys(s.known).filter((rid) => s.menu[rid]).sort((a, b) => (D.RECIPES[a] ? 0 : 1) - (D.RECIPES[b] ? 0 : 1));
    body.innerHTML = `<div class="banner sky">売れ行き予想は「品質80」のケーキを並べたときの目安。評判が上がると高くても売れるようになります。</div>` + rids.map((rid) => {
      const r = sim.recipe(s, rid); const m = s.menu[rid];
      const cost = sim.costEstimate(s, r) / sim.pieceCount(r);
      return `<div class="card menu-card" data-r="${rid}"><div class="pic">${cakeImg(r)}</div><div class="ctl">
        <div class="row between"><b>${esc(r.name)}</b><label class="switch" title="販売する"><input type="checkbox" data-on="${rid}" ${m.on ? 'checked' : ''} aria-label="${esc(r.name)}を販売"><i></i></label></div>
        <div class="row small"><span class="stars">${'★'.repeat(Math.round(sim.stars(r)))}</span><span class="muted">相場 ${yen(sim.recipeValue(r))}</span>${r.orig ? `<button class="btn sm ghost" data-del="${rid}" style="margin-left:auto">${ic('trash')}</button>` : ''}</div>
        <div class="price-row"><div class="step"><button data-pd="-10" aria-label="10円下げる">${ic('minus')}</button><output class="price-val" data-pv>${yen(m.price)}</output><button data-pd="10" aria-label="10円上げる">${ic('plus')}</button></div></div>
        <input type="range" min="100" max="1500" step="10" value="${m.price}" data-pr="${rid}" aria-label="価格">
        <div class="row between small"><span>原価 ${yen(cost)}/切れ</span><span data-pf>利益 ${yen(m.price - cost)}（${Math.round((1 - cost / m.price) * 100)}%）</span></div>
        <div class="demand" data-dm></div></div></div>`;
    }).join('');
    const upd = (card, price) => {
      const rid = card.dataset.r; const s2 = S(); const r = sim.recipe(s2, rid); const cost = sim.costEstimate(s2, r) / sim.pieceCount(r);
      $('[data-pv]', card).textContent = yen(price);
      $('[data-pf]', card).textContent = `利益 ${yen(price - cost)}（${Math.round((1 - cost / price) * 100)}%）`;
      const p = sim.demandEstimate(s2, rid, price, 0.8); const [mk, col] = markOf(p);
      $('[data-dm]', card).innerHTML = `<span>売れ行き</span><span class="bar"><u style="width:${Math.round(p * 100)}%;background:${col}"></u></span><span class="mark" style="color:${col}">${mk}</span>`;
    };
    const commit = (rid, price) => { clearTimeout(priceTimers[rid]); priceTimers[rid] = setTimeout(() => act({ t: 'price', r: rid, price }), 350); };
    $$('.menu-card', body).forEach((card) => {
      const rid = card.dataset.r; const range = $('[data-pr]', card);
      upd(card, +range.value);
      range.oninput = () => { upd(card, +range.value); commit(rid, +range.value); };
      $$('[data-pd]', card).forEach((b) => (b.onclick = () => { const v = clamp(+range.value + +b.dataset.pd, 100, 3000); range.value = v; upd(card, v); commit(rid, v); CS.sound.play('tap'); }));
      $('[data-on]', card).onchange = (e) => act({ t: 'menuOn', r: rid, on: e.target.checked });
      const del = $('[data-del]', card); if (del) del.onclick = async () => { if (await UI.confirm('メニューから削除', 'このオリジナルケーキを削除します（並んでいる分も片づけます）。', '削除', true)) act({ t: 'unregister', r: rid }); };
    });
  };
  game.renderBook = function (body) {
    const s = S();
    const comp = (r) => `${esc(D.BASES[r.base].short)}生地 ＋ ${r.cream === 'none' ? 'クリームなし' : esc(D.CREAMS[r.cream].short)}${Object.keys(r.tops || {}).length ? ' ＋ ' + Object.keys(r.tops).map((k) => D.ING[k].icon + '×' + r.tops[k]).join(' ') : ''}`;
    const items = Object.keys(D.RECIPES).map((rid) => {
      const r = D.RECIPES[rid];
      if (s.known[rid]) return `<div class="rb">${cakeImg(r)}<b>${esc(r.name)}</b><span class="comp">${comp(r)}</span><span class="small">焼成 ${D.BASES[r.base].temp}℃・混ぜる順：${D.BASES[r.base].order.map((k) => D.ING[k].icon).join('→')}</span></div>`;
      return `<div class="rb unknown">${cakeImg(r)}<b>${esc(r.name)}</b><span class="chip">${ic('lock')} 店舗Lv${r.lv || 1} で解放</span><span class="comp">${comp(r)}</span></div>`;
    }).concat(Object.keys(s.originals).map((rid) => { const r = s.originals[rid]; return `<div class="rb">${cakeImg(r)}<b>${esc(r.name)}</b><span class="chip pink">オリジナル</span><span class="comp">${comp(r)}</span></div>`; }));
    const known = Object.keys(D.RECIPES).filter((k) => s.known[k]).length;
    body.innerHTML = `<div class="row between"><b>作れる商品 ${known} / ${Object.keys(D.RECIPES).length}</b><button class="btn sm lilac" id="bk-lab">${ic('flask')} レシピ開発へ</button></div>
      <div class="card soft"><h3>生地の「混ぜる順」</h3><div class="list">${Object.keys(D.BASES).map((k) => `<div class="row between small"><span>${esc(D.BASES[k].name)}</span><span>${D.BASES[k].order.map((i) => D.ING[i].icon + D.ING[i].name).join(' → ')}</span></div>`).join('')}</div></div>
      <div class="recipe-book">${items.join('')}</div>`;
    $('#bk-lab', body).onclick = () => { UI.sheet.tab = 'lab'; $$('.sh-tabs button').forEach((x) => x.setAttribute('aria-selected', x.dataset.tab === 'lab')); UI.renderSheet(true); };
  };
  game.renderLab = function (body) {
    const s = S(); const L = game.lab;
    const r = { name: '試作', base: L.base, cream: L.cream, tops: Object.assign({}, L.tops) };
    const key = sim.comboKey(r.base, r.cream, r.tops);
    const tested = s.tested[key];
    const match = sim.findRecipeByCombo(r.base, r.cream, r.tops);
    const cost = Math.round(sim.costEstimate(s, r) * (s.up.lab ? 0.5 : 1));
    const nt = Object.keys(L.tops).length, tt = Object.values(L.tops).reduce((a, b) => a + b, 0);
    const already = Object.keys(s.originals).some((id) => sim.comboKey(s.originals[id].base, s.originals[id].cream, s.originals[id].tops) === key);
    let res = '';
    if (match && s.known[match]) res = `<div class="banner mint">これは「${esc(D.RECIPES[match].name)}」のレシピです（発見済み）</div>`;
    else if (tested) res = `<div class="card"><div class="row between"><b>試作の評価</b><span class="stars" style="font-size:20px">${'★'.repeat(Math.round(tested))}${'☆'.repeat(5 - Math.round(tested))}</span></div>${already ? '<p class="muted small" style="margin:0">この組み合わせはメニューに登録済みです</p>' : `<label class="field"><span>名前をつけてメニューに追加（${Object.keys(s.originals).length}/${R.MAX_ORIGINALS}）</span><input class="input" id="lb-name" maxlength="16" placeholder="例：ふわふわピーチカスタード"></label><button class="btn pink" id="lb-reg">${ic('plus')} メニューに追加</button>`}</div>`;
    else if (s.up.lab) res = `<div class="banner sky">${ic('flask')} 研究室の予想：★${sim.stars(r)} くらい</div>`;
    body.innerHTML = `<div class="lab-preview"><div>${cakeImg(r, 6, [], 'big')}</div><div style="display:grid;gap:6px"><b>生地・クリーム・トッピングを組み合わせて試作しよう</b><span class="small muted">隠しレシピと同じ組み合わせなら新レシピ発見！ほかの組み合わせはオリジナルとして登録できます。</span></div></div>
      <div class="card soft"><h3>生地</h3><div class="pick">${Object.keys(D.BASES).map((k) => `<button data-b="${k}" aria-pressed="${L.base === k}"><span class="sw" style="background:${D.BASES[k].color}"></span>${esc(D.BASES[k].short)}</button>`).join('')}</div></div>
      <div class="card soft"><h3>クリーム</h3><div class="pick">${Object.keys(D.CREAMS).map((k) => `<button data-c="${k}" aria-pressed="${L.cream === k}">${D.CREAMS[k].color ? `<span class="sw" style="background:${D.CREAMS[k].color}"></span>` : ''}${esc(D.CREAMS[k].short)}</button>`).join('')}</div></div>
      <div class="card soft"><h3>トッピング（3種類・5個まで）</h3><div class="list">${Object.keys(D.TOPS).map((k) => `<div class="row between"><span>${D.ING[k].icon} ${esc(D.ING[k].name)}</span><div class="step"><button data-t="${k}" data-d="-1" aria-label="減らす">${ic('minus')}</button><output>${L.tops[k] || 0}</output><button data-t="${k}" data-d="1" aria-label="増やす">${ic('plus')}</button></div></div>`).join('')}</div></div>
      ${res}
      <button class="btn big lilac wide" id="lb-try" ${match && s.known[match] ? 'disabled' : ''}>${ic('flask')} 試作する（${yen(cost)}）</button>`;
    $$('[data-b]', body).forEach((b) => (b.onclick = () => { L.base = b.dataset.b; UI.renderSheet(true); }));
    $$('[data-c]', body).forEach((b) => (b.onclick = () => { L.cream = b.dataset.c; UI.renderSheet(true); }));
    $$('[data-t]', body).forEach((b) => (b.onclick = () => {
      const k = b.dataset.t, d = +b.dataset.d, cur = L.tops[k] || 0, nv = clamp(cur + d, 0, 3);
      if (d > 0 && ((cur === 0 && nt >= 3) || tt >= 5)) return UI.toast('トッピングは3種類・5個までです', 'err');
      if (nv) L.tops[k] = nv; else delete L.tops[k];
      UI.renderSheet(true);
    }));
    $('#lb-try', body).onclick = () => { if (S().funds < cost) return UI.toast('資金が足りません', 'err'); CS.sound.play('pop'); act({ t: 'research', base: L.base, cream: L.cream, tops: L.tops }); };
    const reg = $('#lb-reg', body);
    if (reg) reg.onclick = () => { const name = $('#lb-name', body).value.trim(); if (!name) return UI.toast('名前を入れてね', 'err'); act({ t: 'register', key, name, tops: L.tops }); };
  };

  // =====================================================================
  //  経営（収支・推移・拡張・広告）
  // =====================================================================
  game.openBiz = function (tab) {
    if (document.pointerLockElement) document.exitPointerLock();
    UI.openSheet({
      title: '経営', live: true, key: 'biz',
      tabs: [{ id: 'today', label: '収支' }, { id: 'trend', label: '推移' }, { id: 'level', label: 'レベル' }], tab: ['today', 'trend', 'level'].includes(tab) ? tab : 'today',
      render(body, t) {
        const s = S();
        if (t !== 'trend') return game.renderBizTab(body, s, t);
        body.innerHTML = s.history.length ? `<div class="card"><h3>売上と利益（直近14日）</h3><div class="chart">${chartSVG(s.history.slice(-14))}</div></div>
          <div class="card" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums"><thead><tr style="text-align:right"><th style="text-align:left">日</th><th>来店</th><th>販売</th><th>売上</th><th>利益</th><th>評判</th></tr></thead><tbody>${s.history.slice().reverse().map((h) => `<tr style="text-align:right;border-top:1px solid var(--line)"><td style="text-align:left">${h.d}</td><td>${h.cust}</td><td>${h.sold}</td><td>${yen(h.sales)}</td><td class="${h.profit >= 0 ? 'pos' : 'neg'}">${yen(h.profit)}</td><td>${h.rep.toFixed(1)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="banner">1日目の営業が終わると、ここに推移が表示されます</div>';
      },
    });
  };
  // ---------- 店舗レベル ----------
  game.renderLevel = function (body, s) {
    const L = sim.shopLevel(s);
    const rows = [];
    for (let lv = 1; lv <= D.SHOP_XP.length; lv++) {
      const items = [];
      Object.keys(D.RECIPES).forEach((rid) => { if ((D.RECIPES[rid].lv || 1) === lv) items.push('🍰 ' + D.RECIPES[rid].name); });
      for (const k in D.EQUIP) D.EQUIP[k].tiers.forEach((t) => { if (t.lv === lv && t.price) items.push('🔧 ' + t.name); });
      for (const k in D.FURN) if (D.FURN[k].lv === lv) items.push('🪑 ' + D.FURN[k].name);
      D.STAFF.slots.forEach((x, i) => { if (x.lv === lv) items.push('🧑‍🍳 アルバイト' + (i + 1) + '人目'); });
      D.UPGRADES.forEach((u) => (u.req || []).forEach((r, i) => { if (r === lv) items.push('🏠 ' + u.name + (u.levels.length > 1 ? ' ' + (i + 1) + '段階目' : '')); }));
      rows.push(`<div class="item lvrow ${lv <= L.lv ? 'done' : ''}"><div class="ico"><b>${lv}</b></div><div class="mid"><b>Lv${lv}${lv > 1 ? `<small class="muted">（${D.SHOP_XP[lv - 1]}pt）</small>` : ''}</b><small>${items.length ? items.map(esc).join('　') : '—'}</small></div><span>${lv <= L.lv ? '<span class="chip ok">解放</span>' : ''}</span></div>`);
    }
    body.innerHTML = `<div class="card"><div class="row between"><h3>店舗レベル ${L.lv}${L.max ? '（最大）' : ''}</h3><span class="num">${L.xp}${L.max ? '' : ' / ' + L.next}pt</span></div><i class="bar lvbar"><u style="width:${L.max ? 100 : Math.round(L.f * 100)}%"></u></i>
      <p class="muted small" style="margin:0">ポイントは「欠点のない商品を売る」「お客さんを満足させる」「評判を上げる」でたまります。Lv10 ですべての商品が作れるようになります。</p></div><div class="list">${rows.join('')}</div>`;
  };
  // ---------- アルバイト ----------
  game.renderStaff = function (body, s) {
    const SL = sim.shopLevel(s).lv, T = D.STAFF.tasks;
    const optSel = (st, i) => {
      const o = T[st.task].opt; if (!o) return '';
      const list = o === 'base' ? Object.keys(D.BASES).map((k) => [k, D.BASES[k].name]) : o === 'cream' ? Object.keys(D.CREAMS).filter((k) => k !== 'none').map((k) => [k, D.CREAMS[k].name]) : Object.keys(s.known).filter((k) => s.menu[k]).map((k) => [k, sim.recipe(s, k).name]);
      return `<label class="small">作るもの <select data-sopt="${i}"><option value="">おまかせ（足りない物）</option>${list.map(([k, n]) => `<option value="${k}" ${st.opt === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
    };
    body.innerHTML = `<div class="banner sky">${ic('user')} アルバイトは1人1つの業務を担当。最初はとても遅いけど、働くほどレベルが上がって速く・上手になります。日給は閉店時に支払い。</div><div class="list">${D.STAFF.slots.map((sl, i) => {
      const st = s.staff[i];
      if (!st) {
        const lock = SL < sl.lv, sp = D.STAFF.speed[sl.start - 1];
        return `<div class="card staff ${lock ? 'locked' : ''}"><div class="sf-pic">${lock ? ic('lock') : CS.models.img(CS.models.thumb.face(Object.assign({}, D.DEFAULT_SKIN, sl.skin)), 'thumb')}</div><div class="mid"><b>${lock ? '？？？' : esc(sl.name)} <small class="muted">${i + 1}人目</small></b><small>${lock ? '店舗Lv' + sl.lv + ' で募集できます' : `Lv${sl.start}・作業スピード ${Math.round(sp * 100)}%・日給 ${yen(D.STAFF.wage(sl.start))}`}</small></div>${lock ? '' : `<button class="btn sm pink" data-hire="${i}">${ic('plus')} 雇う</button>`}</div>`;
      }
      const sp = D.STAFF.speed[st.lv - 1], nx = D.STAFF.xp[st.lv];
      return `<div class="card staff"><div class="sf-pic">${CS.models.img(CS.models.thumb.face(Object.assign({}, D.DEFAULT_SKIN, st.skin)), 'thumb')}</div><div class="mid" style="display:grid;gap:4px">
          <b>${esc(st.name)} <span class="chip ok">Lv${st.lv}</span> <small class="muted">日給 ${yen(D.STAFF.wage(st.lv))}</small></b>
          <small>作業スピード ${Math.round(sp * 100)}%・こなした仕事 ${st.done || 0}${nx ? `・次のLvまで ${nx - (st.xp || 0)}` : '（最大）'}${st.job ? '・<b class="pos">作業中</b>' : ''}</small>
          <div class="seg sm" role="group" aria-label="担当">${Object.keys(T).map((k) => `<button data-stask="${i}" data-k="${k}" aria-pressed="${st.task === k}">${esc(T[k].name)}</button>`).join('')}</div>
          <small class="muted">${esc(T[st.task].desc)}</small>${optSel(st, i)}
        </div><button class="btn sm ghost" data-fire="${i}" aria-label="やめてもらう">${ic('trash')}</button></div>`;
    }).join('')}</div>`;
    $$('[data-hire]', body).forEach((b) => (b.onclick = () => { CS.sound.play('fanfare'); act({ t: 'hire', slot: +b.dataset.hire }); }));
    $$('[data-fire]', body).forEach((b) => (b.onclick = async () => { const st = S().staff[+b.dataset.fire]; if (st && (await UI.confirm('アルバイトをやめてもらう', st.name + ' さんのレベル（Lv' + st.lv + '）はリセットされます。', 'やめてもらう', true))) act({ t: 'fire', slot: +b.dataset.fire }); }));
    $$('[data-stask]', body).forEach((b) => (b.onclick = () => { CS.sound.play('tap'); act({ t: 'staffTask', slot: +b.dataset.stask, task: b.dataset.k, opt: '' }); }));
    $$('[data-sopt]', body).forEach((el) => (el.onchange = () => { const st = S().staff[+el.dataset.sopt]; act({ t: 'staffTask', slot: +el.dataset.sopt, task: st.task, opt: el.value }); }));
  };
  // ---------- パソコン：家具・設備 ----------
  game.renderFurn = function (body, s) {
    const SL = sim.shopLevel(s).lv;
    body.innerHTML = `<div class="row between"><span class="small">資金 <b class="num">${yen(s.funds)}</b></span><span class="small muted">増床すると置ける数が増えます</span></div><div class="list">${Object.keys(D.FURN).map((id) => {
      const f = D.FURN[id], n = (s.furn && s.furn[id]) || 0, mx = sim.furnMax(s, id), lock = SL < f.lv;
      const btn = lock ? `<span class="chip">${ic('lock')} Lv${f.lv}</span>` : n >= mx ? '<span class="chip ok">いっぱい</span>' : `<button class="btn sm yellow num" data-furn="${id}" ${s.funds >= f.price ? '' : 'disabled'}>${yen(f.price)}</button>`;
      return `<div class="card upg"><div class="ico">${ic(f.icon)}</div><div style="min-width:0;display:grid;gap:2px"><b>${esc(f.name)} <small class="muted">${n} / ${mx}</small></b><span class="small muted">${esc(f.desc)}</span></div>${btn}</div>`;
    }).join('')}</div>`;
    $$('[data-furn]', body).forEach((b) => (b.onclick = () => { CS.sound.play('coin'); act({ t: 'buyFurn', id: b.dataset.furn }); }));
  };
  game.renderEquip = function (body, s) {
    const SL = sim.shopLevel(s).lv;
    body.innerHTML = `<div class="row between"><span class="small">資金 <b class="num">${yen(s.funds)}</b>・店舗 <b>Lv${SL}</b></span></div><div class="list">${Object.keys(D.EQUIP).map((k) => {
      const E = D.EQUIP[k], cur = (s.eq && s.eq[k]) || 0, t = E.tiers[cur], nx = E.tiers[cur + 1];
      const btn = !nx ? '<span class="chip ok">最上位</span>' : SL < nx.lv ? `<span class="chip">${ic('lock')} Lv${nx.lv}</span>` : `<button class="btn sm pink num" data-eq="${k}" ${s.funds >= nx.price ? '' : 'disabled'}>${yen(nx.price)}</button>`;
      return `<div class="card upg eq"><div class="ico">${ic(E.icon)}</div><div style="min-width:0;display:grid;gap:3px"><b>${esc(E.name)}：${esc(t.name)}</b><span class="small muted">${esc(t.desc || '')}</span>${nx ? `<span class="small">次 → <b>${esc(nx.name)}</b>：${esc(nx.desc || '')}</span>` : ''}<span class="lv">${E.tiers.map((_, i) => `<i class="${i <= cur ? 'on' : ''}"></i>`).join('')}</span></div>${btn}</div>`;
    }).join('')}</div>`;
    $$('[data-eq]', body).forEach((b) => (b.onclick = async () => { const E = D.EQUIP[b.dataset.eq], nx = E.tiers[((S().eq || {})[b.dataset.eq] || 0) + 1]; if (nx && (await UI.confirm(nx.name, `${yen(nx.price)} で買い替えますか？<br><small>${esc(nx.desc || '')}</small>`, '買い替える'))) act({ t: 'buyEq', kind: b.dataset.eq }); }));
  };
  function chartSVG(h) {
    const W = 340, H = 170, pl = 44, pr = 8, pt = 10, pb = 22;
    const max = Math.max(1000, ...h.map((x) => x.sales), ...h.map((x) => x.profit));
    const min = Math.min(0, ...h.map((x) => x.profit));
    const nice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, Math.abs(v))))); return Math.ceil(v / p) * p; };
    const top = nice(max), bot = min < 0 ? -nice(-min) : 0;
    const y = (v) => pt + (H - pt - pb) * (1 - (v - bot) / (top - bot));
    const bw = (W - pl - pr) / h.length;
    let g = '';
    [bot, (top + bot) / 2, top].forEach((v) => { g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(242,235,225,.14)" stroke-dasharray="3 3"/><text x="${pl - 4}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#B3A595">${v >= 10000 || v <= -10000 ? Math.round(v / 1000) + 'k' : Math.round(v)}</text>`; });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(242,235,225,.45)" stroke-width="1"/>`;
    h.forEach((d, i) => { const x = pl + i * bw + bw * 0.18; g += `<rect x="${x}" y="${y(d.sales)}" width="${bw * 0.64}" height="${Math.max(0, y(0) - y(d.sales))}" rx="2" fill="rgba(201,163,94,.5)" stroke="#C9A35E" stroke-width="1"/><text x="${x + bw * 0.32}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#B3A595">${d.d}</text>`; });
    const pts = h.map((d, i) => `${pl + i * bw + bw / 2},${y(d.profit)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="#8DB580" stroke-width="2" stroke-linejoin="round"/>`;
    h.forEach((d, i) => { g += `<circle cx="${pl + i * bw + bw / 2}" cy="${y(d.profit)}" r="${i === h.length - 1 ? 4.5 : 3}" fill="${d.profit >= 0 ? '#8DB580' : '#E06A6A'}" stroke="#14110F" stroke-width="1.5"/>`; });
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="売上と利益の推移" font-family="Zen Kaku Gothic New, sans-serif">${g}</svg>`;
  }

  // =====================================================================
  //  スタンプ・チャット
  // =====================================================================
  const STAMPS = ['オーブン見て！', '生地つくって！', 'クリームお願い！', 'デコするね', '仕入れてくる', 'いちご足りない！', 'ナイス！', 'ありがとう！', 'ごめん！', '開店しよう！', '値上げしよう', '次の日いこう！'];
  game.openChat = function () {
    UI.openSheet({
      title: 'スタンプ・チャット', live: false, key: 'chat',
      render(body) {
        const r = game.room;
        const log = r.chatLog.slice(-12);
        body.innerHTML = `<div class="pick">${STAMPS.map((t) => `<button data-st="${esc(t)}">${esc(t)}</button>`).join('')}</div>
          <div class="row"><input class="input" id="ch-in" maxlength="40" placeholder="ひとこと（40文字まで）"><button class="btn pink" id="ch-send">送る</button></div>
          <div class="list">${log.length ? log.slice().reverse().map((m) => { const mem = r.members[m.pid] || {}; return `<div class="row" style="align-items:flex-start"><span style="width:30px;height:30px;border-radius:50%;overflow:hidden;border:1px solid var(--line);flex:none;background:var(--paper)">${face(mem.skin)}</span><div style="min-width:0"><b class="small">${esc(mem.name || '？')}</b><div class="ch-t"></div></div></div>`; }).join('') : '<p class="muted small" style="margin:0">まだメッセージはありません</p>'}</div>`;
        $$('.ch-t', body).forEach((el, i) => (el.textContent = log.slice().reverse()[i].text));
        const send = (t) => { r.chat(t); CS.sound.play('pop'); };
        $$('[data-st]', body).forEach((b) => (b.onclick = () => send(b.dataset.st)));
        const inp = $('#ch-in', body);
        $('#ch-send', body).onclick = () => { send(inp.value); inp.value = ''; };
        inp.onkeydown = (e) => { if (e.key === 'Enter') { send(inp.value); inp.value = ''; } };
      },
    });
  };

  // =====================================================================
  //  設定の「お店」タブ・遊び方
  // =====================================================================
  game.renderShopSettings = function (body) {
    const r = game.room; if (!r) { body.innerHTML = ''; return; }
    const s = r.S;
    const link = location.origin + location.pathname + '?room=' + r.code;
    const hostPid = r.meta && r.devices[r.meta.host] ? r.devices[r.meta.host].pid : r.pid;
    body.innerHTML = `<div class="card"><h3>${esc((r.meta && r.meta.name) || s.name)}</h3><dl class="kv"><dt>むずかしさ</dt><dd>${esc(D.DIFF[s.diff].name)}</dd><dt>メンバー</dt><dd>${Object.keys(r.members).length} / ${R.MAX_PLAYERS}人</dd><dt>ホスト（計算担当）</dt><dd>${esc((r.members[hostPid] || {}).name || '—')}${r.isHost ? '（この端末）' : ''}</dd></dl>
      ${r.local ? '<p class="muted small" style="margin:0">オフラインのお店です</p>' : `<div class="invite"><span class="small">招待コード</span><div class="code" id="ss-code">${esc(r.code)}</div><div class="row wrap" style="justify-content:center"><button class="btn sm" id="ss-cc">${ic('copy')} コード</button><button class="btn sm" id="ss-cl">${ic('link')} 招待リンク</button></div></div>`}</div>
      <button class="btn wide" id="ss-tut">${ic('book')} 遊び方を見る</button>
      <button class="btn wide" id="ss-title">${ic('door')} タイトルにもどる</button>
      ${r.local ? '' : `<button class="btn ghost wide" id="ss-quit">このお店のメンバーから抜ける</button>`}
      <p class="muted small" style="margin:0">ホストの端末がお店の時間を進めます。ホストが抜けると、残っている人の端末が自動で引き継ぎます。全員いなくなるとお店の時間は止まります。</p>`;
    if (!r.local) { $('#ss-cc', body).onclick = () => UI.copy(r.code, $('#ss-code', body)); $('#ss-cl', body).onclick = () => UI.copy(link); }
    $('#ss-tut', body).onclick = () => { UI.closeSheet(); game.tutorial(); };
    $('#ss-title', body).onclick = () => game.leave(false);
    const q = $('#ss-quit', body);
    if (q) q.onclick = async () => { if (await UI.confirm('メンバーから抜ける', '席が空き、ほかの人が参加できるようになります。お店はほかのメンバーが続けられます。', '抜ける', true)) game.leave(true); };
  };
  // ---------- チュートリアル（最初に1回。画面右上のチェックリスト） ----------
  const TUT = [
    { id: 'order', t: 'パソコンで材料を注文', d: '右の壁ぎわのパソコンをねらって使う。卵・砂糖・小麦粉・バター・生クリーム・いちごを注文しよう（「まとめて注文」が便利）', ok: (s) => (s.today.buy || 0) > 0 || s.history.length > 0 },
    { id: 'stock', t: 'トラックの段ボールを運び入れる', d: 'トラックが来たら裏口（左奥）から外に出て、段ボールを持って店の中の「在庫の棚」にしまう', ok: (s) => ((s.today.buy || 0) > 0 || s.history.length > 0) && !Object.values(s.k.items).some((it) => it.t === 'crate') },
    { id: 'mix', t: 'ミキサーで生地を作る', d: '奥のミキサーの上の材料を順番に入れる（卵→砂糖→小麦粉→バター）→ 回して緑で止める', ok: (s) => s.k.mix.some((b) => b.st === 'done' && b.k) || Object.values(s.k.items).some((it) => it.t === 'pan' && it.st !== 'empty') },
    { id: 'bake', t: '型に流してオーブンへ', d: '左奥の棚で型を取り、ミキサーをねらって「型に流す」→ オーブンに入れて電源を入れる', ok: (s) => Object.values(s.k.items).some((it) => it.t === 'pan' && (it.st === 'baking' || it.st === 'baked')) || Object.values(s.k.items).some((it) => it.t === 'deco' || it.t === 'cake') },
    { id: 'cool', t: '焼けたら取り出して冷ます', d: 'ゲージが緑のうちに取り出し、右の冷却ラックに置く', ok: (s) => Object.values(s.k.items).some((it) => (it.t === 'pan' && it.st === 'baked' && !String(it.at).startsWith('ov:')) || it.t === 'deco' || it.t === 'cake') },
    { id: 'whip', t: 'クリームを泡立てる', d: 'クリーム台に生クリーム×2・砂糖×1を入れて泡立て、緑で止めて「クリームを取る」', ok: (s) => Object.values(s.k.items).some((it) => it.t === 'cream' || (it.t === 'deco' && it.cr) || it.t === 'cake') },
    { id: 'deco', t: 'デコして仕上げる', d: '冷めた型をデコ台にのせる → クリームを塗る → いちごを3つ置く → 仕上げる', ok: (s) => Object.values(s.k.items).some((it) => it.t === 'cake') || s.showcase.some((c) => c) },
    { id: 'case', t: 'ショーケースに並べる', d: 'できたケーキを持って、ショーケースの空いている台に「並べる」', ok: (s) => s.showcase.some((c) => c) },
    { id: 'open', t: '看板を OPEN にする', d: '入口の外にある看板をねらって OPEN に。お客さんが来て時間が進みます', ok: (s) => s.phase === 'open' || s.today.sold > 0 },
    { id: 'serve', t: '接客して売る', d: 'レジで注文を受ける → 箱を取り、ショーケースから注文の数だけ入れる → 待っているお客さんに渡す', ok: (s) => s.today.sold > 0 || s.history.length > 0 },
  ];
  game.tutMark = function () { /* 進み具合は状態から判定するので何もしない（呼び出し側の互換用） */ };
  game.tutCheck = function (s) {
    const el = $('#tut'); if (!el) return;
    const st = CS.LS.get('cs.tut2', null);
    if (!st || st.off || !ST.tips) { el.hidden = true; return; }
    let i = st.i || 0;
    while (i < TUT.length && TUT[i].ok(s)) i++;
    if (i !== st.i) { st.i = i; CS.LS.set('cs.tut2', st); if (i > 0) CS.sound.play('ok'); }
    if (i >= TUT.length) { el.hidden = false; el.innerHTML = `<b>${ic('check')} チュートリアル完了！</b><span class="small muted">あとは自由に。経営はパソコンから</span><button class="btn sm" id="tut-x">閉じる</button>`; $('#tut-x').onclick = () => { st.off = true; CS.LS.set('cs.tut2', st); el.hidden = true; }; return; }
    const step = TUT[i];
    const h = `<div class="row between"><b class="small">やること ${i + 1}/${TUT.length}</b><button class="icon-btn sm" id="tut-x" aria-label="チュートリアルを閉じる">${ic('close')}</button></div><b>${esc(step.t)}</b><span class="small">${esc(step.d)}</span><i class="bar"><u style="width:${Math.round((i / TUT.length) * 100)}%"></u></i>`;
    if (el._h !== h) { el._h = h; el.innerHTML = h; $('#tut-x').onclick = () => { st.off = true; CS.LS.set('cs.tut2', st); el.hidden = true; UI.toast('設定 → お店 → 「遊び方」でもう一度見られます'); }; }
    el.hidden = false;
  };
  game.tutorial = function (first) {
    const T = touch();
    const ctl = T
      ? [['移動', '左下のスティック'], ['見回す', '画面の右側をスワイプ'], ['つかむ・置く', '大きいボタン（照準の先の物）'], ['使う', '小さいボタン（ミキサーを回す・電源など）'], ['捨てる', 'ゴミ箱のボタン']]
      : [['移動', 'W A S D（Shift で小走り）'], ['見回す', 'マウスを動かすだけ（ボタンを押さなくてOK）'], ['つかむ・置く', 'E / 左クリック'], ['使う', 'F / 右クリック'], ['捨てる', 'Q'], ['パソコン・レシピ', 'Tab / R']];
    UI.modal({
      title: 'ようこそ！ケーキ屋さんへ',
      html: `<div style="display:grid;gap:10px"><p style="margin:0">一人称でお店の中を歩いて、<b>材料を注文 → 生地 → 焼く → クリーム → デコ → 並べる → 接客</b>を自分の手でやります。みんなで分担すると早い！</p>
        <dl class="kv">${ctl.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
        <div class="banner sky">お店は最初 <b>CLOSE</b>。CLOSE のあいだはお客さんが来ず、時計も止まります。準備ができたら入口の外の<b>看板</b>を OPEN に。</div>
        <p class="muted small" style="margin:0">画面右上に「やること」が出ます。設定でボタンの位置・大きさ・視点の感度を変えられます。</p></div>`,
      buttons: [{ label: 'はじめる！', cls: 'pink', value: true }],
    });
    const st = CS.LS.get('cs.tut2', null) || {};
    if (first || st.off) CS.LS.set('cs.tut2', { i: 0, off: false });
    const s = S(); if (s) game.tutCheck(s);
  };
})(typeof window !== 'undefined' ? window : globalThis);
