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
  // 商品の有効・無効はホストだけが変えられる
  const amHost = () => !!(game.room && (game.room.isHost || game.room.local));
  game.amHost = amHost;

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
      game.tutAuto(room.S);
    } catch (e) {
      console.error(e);
      UI.toast('お店に入れませんでした：' + (e.message || e), 'err');
      game.room = UI.room = null;
      UI.show('title'); UI.renderTitle();
    }
    UI.loading(false);
  };
  game.leave = async function (remove, silent) {
    if (CS.rank && game.room) CS.rank.commit(); // プレイ時間・売上の記録を残す
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
        <div class="lcol" id="lcol"><div class="orders" id="orders" aria-label="注文"></div><div class="rmemo panel" id="rmemo" hidden aria-label="レシピメモ"></div></div>
        <div class="tut panel" id="tut" hidden></div>
        <div class="buildbar panel" id="buildbar" hidden></div>
        <div class="chat-float" id="chatFloat" aria-live="polite"></div>
        <div class="prompt" id="prompt" aria-live="polite"></div>
        <div class="held" id="held" hidden></div>
        <div class="netwarn" id="netwarn" hidden></div>
        <div class="lockhint" id="lockhint" ${T || CS.LS.get('cs.mh', false) ? 'hidden' : ''}>${ic('hand')} マウスを動かすと見回せます（ボタンは押さなくてOK）・WASD＝移動・クリック＝つかむ／置く・右クリック＝使う</div>
        <div class="fabs" id="fabs">
          <div class="mv joy" data-id="joy" id="joy" ${T ? '' : 'hidden'}><i></i></div>
          <button class="mv act-btn" data-id="act" id="b-act" aria-label="つかむ・置く"><span class="ab-ic">${ic('hand')}</span><span class="ab-t">つかむ</span></button>
          <button class="mv act-btn sub" data-id="sec" id="b-sec" aria-label="使う"><span class="ab-ic">${ic('bolt')}</span><span class="ab-t">使う</span></button>
          <button class="mv act-btn sub del" data-id="del" id="b-del" aria-label="捨てる"><span class="ab-ic">${ic('trash')}</span><span class="ab-t">捨てる</span></button>
          <button class="mv fab" data-id="book">${ic('book')}レシピ</button>
          <button class="mv fab" data-id="chat">${ic('chat')}スタンプ</button>
          <button class="mv fab" data-id="build" id="b-build">${ic('move')}配置</button>
        </div>
        <div class="overlay" id="gov" hidden></div>
        <div class="rotate" id="rotate"><div class="panel">${ic('phone')}<b>スマホを横向きにしてね</b><small class="muted">このゲームは横画面で遊びます</small></div></div>
      </div>`;
    $('#scr-game').classList.toggle('touch', T);
    $('#h-menu').onclick = () => UI.openSettings(true);
    $('#h-money').onclick = () => game.openBiz('today');
    $('#h-lv').onclick = () => game.openBiz('level');
    $('#h-end').onclick = async () => { if (await UI.confirm('今日の営業を終える', '冷蔵の商品棚・冷蔵庫のケーキは賞味期限まで残ります。常温に置いた生ものや作りかけは片づけ（廃棄）になります。日報に進みますか？', '閉店する', true)) act({ t: 'endDay' }); };
    $$('#fabs .fab').forEach((b) => (b.onclick = () => {
      if (game.editingFabs) return;
      CS.sound.play('tap');
      ({ book: () => game.openRecipeBook(), chat: game.openChat, build: () => CS.world.setBuild(!CS.world.bm) })[b.dataset.id]();
    }));
    const W = CS.world;
    const press = (id, fn) => { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (game.editingFabs) return; b.classList.add('pressed'); fn(); }); const up = () => b.classList.remove('pressed'); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up); };
    if (!W.init($('#world'))) UI.toast('3D 表示が使えない端末です', 'err');
    W.bindJoystick($('#joy'));
    press('#b-act', () => { W.primary(); W.primaryHold(true); }); press('#b-sec', () => W.secondary()); press('#b-del', () => W.discard());
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('#b-act').addEventListener(ev, () => W.primaryHold(false)));
    W.onSpread = (fid) => game.openSpread(fid);
    W.onWash = (fid) => game.openWash(fid);
    W.onPay = (cid) => game.openChange(cid);
    W.onBuild = (on) => game.renderBuildBar(on);
    W.onTarget = (t, held) => game.renderPrompt(t, held);
    W.onUI = (k) => { if (k === 'pc') game.openPC(); else if (k === 'menu') game.openMenu('sell'); else if (String(k).startsWith('amode:')) game.openAutoMode(String(k).slice(6)); };
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
  const sliceText = (s, sl) => { const c = {}; (sl || []).forEach((x) => (c[x[0]] = (c[x[0]] || 0) + 1)); return Object.keys(c).map((r) => ((sim.recipe(s, r) || {}).name || r) + '×' + c[r]).join('、'); };
  // 配置モードの案内
  game.renderBuildBar = function (on) {
    const el = $('#buildbar'), b = $('#b-build'); if (!el) return;
    if (b) b.classList.toggle('on', !!on);
    const fl = $('#floor'); if (fl) fl.classList.toggle('building', !!on);
    el.hidden = !on;
    if (on) {
      const T = touch();
      el.innerHTML = `<b>${ic('move')} 配置モード</b><span class="small">家具をねらって「動かす」→ 置きたい床をねらって「ここに置く」。${T ? '「使う」' : '<kbd>F</kbd>'}で向きを変える。厨房と倉庫に置けます（ドアと通路はあけておく）</span><button class="btn sm mint" id="bb-done">${ic('check')} おわる</button>`;
      $('#bb-done', el).onclick = () => CS.world.setBuild(false);
    }
  };
  game.renderPrompt = function (t, held) {
    const s = S(); if (!s) return;
    const T = touch();
    const pri = t && t.pri, sec = t && t.sec, del = t && t.del;
    const hName = held ? CS.world.itemName(held, s) : '';
    const delLabel = del ? del.label : t && t.build ? '' : CS.world.delLabel(held);
    const fr = held ? CS.kitchen.fresh(s, held, game.room.now()) : null;
    const key = JSON.stringify([t && t.name, pri && pri.label, sec && sec.label, delLabel, hName, t && t.aimOK, T, fr && [fr.stage, fr.cold, Math.ceil(fr.left / 5)], held && held.df, held && [held.wet, held.dirty, (held.s || []).length]]);
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
    if (held) {
      const ex = held.t === 'cake' ? `<span class="chip ${sim.cakeExpDay(held.d, s) <= s.day ? 'warn' : 'cold'}">${esc(sim.cakeExpText(s, held.d))}</span>` : '';
      const ft = ex + (!fr ? '' : fr.stage >= 2 ? `<span class="chip bad">傷んでいる</span>` : `<span class="chip ${fr.stage ? 'bad' : 'warn'}">${ic('snow')} 要冷蔵 あと${CS.world.mmss(fr.left)}</span>`);
      const st2 = (held.dirty ? '<span class="chip warn">汚れている</span>' : held.wet ? '<span class="chip cold">💧 ぬれている</span>' : '') + ((held.t === 'box' || held.t === 'plate') && (held.s || []).length ? `<span class="chip">${esc(sliceText(s, held.s))}</span>` : '');
      hd.hidden = false; hd.innerHTML = `${ic('hand')}<span>${esc(hName)}</span>${st2}${held.df && held.df.length ? `<span class="chip bad">${esc(held.df.map((d) => (D.DEFECTS[d] || {}).name || d).join('・'))}</span>` : ''}${ft}`;
    } else hd.hidden = true;
    const setB = (id, a, fallback) => { const b = $(id); if (!b) return; const lab = a ? a.label || a : fallback; b.querySelector('.ab-t').textContent = lab || fallback || ''; b.classList.toggle('on', !!a); b.classList.toggle('off', !a); };
    setB('#b-act', pri, t && t.build ? '動かす' : held ? '置く' : 'つかむ');
    setB('#b-sec', sec, '使う');
    setB('#b-del', delLabel ? { label: delLabel } : null, '捨てる');
    const xh = $('#xhair'); if (xh) xh.className = 'xhair' + (pri || sec ? ' on' : '') + (t && t.pri && t.pri.aim ? (t.aimOK ? ' aim ok' : ' aim') : '');
  };

  // =====================================================================
  //  ボタン配置（大きさ・位置の変更） ※スティックと操作ボタンも動かせる
  // =====================================================================
  const DEF_POS = {
    right: { joy: { x: 13, y: 72 }, act: { x: 89, y: 74 }, sec: { x: 76, y: 85 }, del: { x: 78, y: 62 }, book: { x: 27, y: 90 }, chat: { x: 35, y: 90 }, build: { x: 43, y: 90 } },
    left: { joy: { x: 87, y: 72 }, act: { x: 11, y: 74 }, sec: { x: 24, y: 85 }, del: { x: 22, y: 62 }, book: { x: 73, y: 90 }, chat: { x: 65, y: 90 }, build: { x: 57, y: 90 } },
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
    try { CS.world.sync(s, game.room); } catch (e) { console.error('[sync]', e); }
    game.renderHud(s);
    game.renderOverlay();
    const t = performance.now();
    if (!game._tutT || t - game._tutT > 400) { game._tutT = t; game.tutCheck(s); game.renderMemo(s); }
    if (!game._shT || t - game._shT > 700) { game._shT = t; UI.renderSheet(false); }
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
    let nq = 0, np = 0; for (const id in s.cust) { if (s.cust[id].st === 'q') nq++; else if (s.cust[id].st === 'pay') np++; }
    // 並び（注文の中身）が変わったときだけ作り直し、残り時間は文字だけ書き換える（ちらつき防止）
    // ショーケースの在庫を受付順に割り当てて、足りない物には「作る」、ホールを切れば足りる物には「切る」を付ける
    const nd = CS.kitchen.need(s), cutLeft = CS.kitchen.shelfStock(s), need = {}, cutN = {};
    ws.forEach((id) => {
      const o = s.cust[id].ord || {}, pr = nd.per[id] || { p: {}, h: {} }; need[id] = pr; cutN[id] = {};
      for (const r in o) { const use = Math.min(cutLeft[r] || 0, o[r]); cutLeft[r] = (cutLeft[r] || 0) - use; if (o[r] > use && !pr.p[r]) cutN[id][r] = 1; }
    });
    const key = JSON.stringify([ws.map((id) => [id, s.cust[id].no, s.cust[id].ord, s.cust[id].wh, need[id], cutN[id], s.cust[id].dine]), nq, np]);
    if (game._ordKey !== key) {
      game._ordKey = key;
      const nmR = (r) => esc((sim.recipe(s, r) || {}).name || r);
      el.innerHTML = ws.map((id) => {
        const c = s.cust[id], pr = need[id], mk = Object.keys(pr.p).length || Object.keys(pr.h).length;
        const rows = Object.keys(c.wh || {}).map((r) => `${nmR(r)} <b class="hole">ホール</b>×${c.wh[r]}${pr.h[r] ? ` <em>あと${pr.h[r]}台作る</em>` : ''}`)
          .concat(Object.keys(c.ord || {}).map((r) => `${nmR(r)} ×${c.ord[r]}${pr.p[r] ? ` <em>あと${pr.p[r]}つ作る</em>` : cutN[id][r] ? ' <em class="cut">ホールを切る</em>' : ''}`));
        return `<div class="ord ${mk ? 'mk' : ''}" data-c="${esc(id)}"><b>#${c.no}<small>${c.dine ? '🍽店内' : '🛍持帰'}</small></b><span>${rows.join('<br>')}</span><i class="num"></i></div>`;
      }).join('') + (nq ? `<div class="ord q">${ic('people')} 注文待ち ${nq}人</div>` : '') + (np ? `<div class="ord q pay">${ic('cart')} お会計待ち ${np}人（レジへ）</div>` : '');
    }
    $$('.ord[data-c]', el).forEach((d) => { const c = s.cust[d.dataset.c]; if (!c) return; const left = Math.max(0, Math.ceil(((c.pw || 0) - g) / 1000)); const t = left + 's'; const i = d.lastChild; if (i.textContent !== t) i.textContent = t; d.classList.toggle('late', left < 12); });
  };
  // ---------- 毎フレーム ----------
  // 次のフレームは先に予約する：1フレームでエラーが出ても、画面が止まったままにならないように
  game.frame = function () {
    const r = game.room;
    if (!r) return;
    game.raf = requestAnimationFrame(game.frame);
    if (!r.S) return;
    try {
      const s = r.S, g = r.now();
      CS.world.hudH = (game._hudH = game._hudH || ($('.hud') ? $('.hud').offsetHeight : 52));
      CS.world.frame();
      const tn = performance.now(); if (!game._tutT || tn - game._tutT > 500) { game._tutT = tn; game.tutCheck(s); game.renderMemo(s); }
      const pi = sim.phaseInfo(s, g);
      const ph = $('#h-phase');
      if (ph) {
        const lb = pi.label, cl = 'phase ' + pi.phase, ck = sim.clockStr(pi.min), bw = Math.round(pi.f * 1000) / 10 + '%';
        if (ph.textContent !== lb) ph.textContent = lb; if (ph.className !== cl) ph.className = cl;
        const c = $('#h-clock'); if (c.textContent !== ck) c.textContent = ck;
        const b = $('#h-bar'); if (b.style.width !== bw) b.style.width = bw;
      }
      if (!game._ordT || performance.now() - game._ordT > 500) { game._ordT = performance.now(); game.renderOrders(s); game.renderNet(r); }
      game._ferr = 0;
    } catch (e) {
      game._ferr = (game._ferr || 0) + 1;
      if (game._ferr === 1 || game._ferr % 300 === 0) console.error('[frame]', e);
      // エラーが続くときは 3D の描画を作り直す
      if (game._ferr === 45 && CS.world.recover) CS.world.recover(true);
    }
  };
  // 通信が切れて時間が止まっているときは、そう表示する（固まったと思わないように）
  game.renderNet = function (r) {
    const el = $('#netwarn'); if (!el) return;
    let t = '';
    if (!r.local) {
      if (!net.connected) t = '通信が切れています。つながるまで時間が止まります…';
      else if (!r.isHost && r.meta && r.meta.host && !(r.devices[r.meta.host] && r.devices[r.meta.host].on)) t = 'ホストの端末と通信できません。少しするとほかの人がホストになります…';
    }
    if (el._t !== t) { el._t = t; el.textContent = t; el.hidden = !t; }
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
      if (h.slow) tips.push('注文の品ができるのが遅くて、帰ってしまったお客さんが ' + h.slow + ' 人。よく出る商品は開店前に作って商品棚に並べておこう。');
      if (h.exp) tips.push('賞味期限（作った日を入れて2日）が切れて ' + h.exp + ' 切れを廃棄しました。作る量を見直そう。');
      if (h.spl) tips.push('常温に置きっぱなしで傷ませた物が ' + h.spl + ' 件。生クリーム・ケーキは冷蔵庫か冷蔵の商品棚へ、要冷蔵の材料はすぐ冷蔵棚へ。');
      if (h.brk) tips.push('お皿を ' + h.brk + ' 枚割ってしまいました（落とすと割れます）。足りなくなったらパソコンの「家具・道具」で1枚ずつ買えます。');
      if (h.ovr) tips.push('お釣りを ' + yen(h.ovr) + ' 多く渡してしまいました。お会計の画面でお釣りの金額をよく見て渡そう。');
      if (h.pc) tips.push('「高すぎる」というクレームが ' + h.pc + ' 件。パソコンの「販売価格」で今日の相場と比べて値段を見直そう。');
      if (h.miss > h.cust * 0.3) tips.push('買わずに帰ったお客さんが ' + h.miss + ' 人。売り切れや値段の高さが原因かも。');
      if (h.waste > h.sales * 0.12) tips.push('廃棄が多めです。作る量や仕入れを見直そう。');
      if (h.sat && h.sat < 0.45) tips.push('満足度が低め。品質を上げるか、少し値下げしてみよう。');
      if (h.loan) tips.push(h.lend ? '借金の最後の返済 ' + yen(h.loan) + ' を払って、返し終わりました！また借りられます。' : '借金の返済 ' + yen(h.loan) + ' を引きました（あと' + (s.loan ? s.loan.left : 0) + '回・残り ' + yen(s.loan ? s.loan.total - s.loan.paid : 0) + '）。');
      if (s.funds < 0) tips.push('資金がマイナス（' + yen(s.funds) + '）です。黒字に戻るまで何も買えません。' + yen(R.BANKRUPT) + ' を下回ると倒産です。');
      if (h.profit < 0) tips.push('今日は赤字（' + yen(h.profit) + '）。たくさん作って売るほど家賃の負担は軽くなります。');
      if (h.profit > 0 && s.funds > 30000) tips.push('資金に余裕があります。パソコンの「家具・道具」でオーブンや棚を増やしたり、「拡張」でお店を広げよう！');
      if (h.wages) tips.push('アルバイトの日給 合計 ' + yen(h.wages) + '。働くほどレベルが上がって速くなります。');
      if (!tips.length) tips.push('いい調子！この調子でお店を大きくしよう。');
      const stat = (l, v, cls) => `<div class="stat"><small>${l}</small><b class="${cls || ''}">${v}</b></div>`;
      ov.innerHTML = `<div class="panel ov-card"><h2>${h.d}日目の営業結果</h2>
        <div class="report-grid">${stat('来店', h.cust + '人')}${stat('販売', h.sold + '個' + (h.hole ? '（ホール ' + h.hole + '台）' : ''))}${stat('売上', yen(h.sales))}${stat('原価', yen(h.cogs))}${stat('送料', yen(h.ship || 0))}${stat('廃棄', yen(h.waste), h.waste ? 'neg' : '')}${stat('家賃・光熱費・人件費', yen(h.fixed))}${h.loan ? stat('借金の返済', '-' + yen(h.loan), 'neg') : ''}${stat('広告・試作', yen(h.ads))}${stat('利益', yen(h.profit), h.profit >= 0 ? 'pos' : 'neg')}${stat('クレーム', (h.cmp || 0) + '件' + (h.pc ? '（値段 ' + h.pc + '）' : ''), h.cmp ? 'neg' : '')}${stat('評判', '★' + h.rep.toFixed(1) + (repD ? (repD > 0 ? ' ↑' : ' ↓') : ''), repD > 0 ? 'pos' : repD < 0 ? 'neg' : '')}</div>
        ${best ? `<div class="banner pink">${ic('star')} 一番人気：${esc(best.name)}</div>` : ''}
        <div class="banner sky" style="display:grid;gap:2px">${tips.map((t) => '<span>・' + esc(t) + '</span>').join('')}</div>
        <div class="row between small"><span>現在の資金</span><b class="num ${s.funds < 0 ? 'neg' : ''}">${yen(s.funds)}</b></div>
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
      case 'break': UI.toast(f.x, 'err'); CS.sound.play('bad'); break;
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
    game._tutPc = true;
    if (document.pointerLockElement) document.exitPointerLock();
    r.setStation('pc');
    UI.openSheet({
      title: 'パソコン', live: true, key: 'pc', tab: tab || game.pcTab || 'ing',
      tabs: [{ id: 'ing', label: '材料の注文' }, { id: 'furn', label: '家具・道具' }, { id: 'sell', label: '販売価格' }, { id: 'eq', label: '設備の性能' }, { id: 'staff', label: 'アルバイト' }, { id: 'up', label: '拡張' }, { id: 'ad', label: '広告' }, { id: 'today', label: '収支' }, { id: 'loan', label: '借金' }, { id: 'level', label: 'レベル' }],
      onClose: () => r.setStation(''),
      render(body, t) {
        const s = S(); game.pcTab = t;
        if (t === 'ing') return game.renderMarket(body, s);
        if (t === 'sell') return game.renderSell(body);
        if (t === 'eq') return game.renderEquip(body, s);
        if (t === 'furn') return game.renderFurn(body, s);
        if (t === 'staff') return game.renderStaff(body, s);
        if (t === 'loan') return game.renderLoan(body, s);
        return game.renderBizTab(body, s, t);
      },
    });
  };
  // ---------- 材料の注文：商品をえらんでカートへ → カートで確認（1つずつキャンセル可）→ 発送 ----------
  game.cart = game.cart || [];
  const truckState = (s) => {
    const tk = s.k && s.k.truck, g = game.room.now();
    if (!tk) return { busy: false, text: '待機中（すぐ発送できます）' };
    if (g < tk.at) return { busy: false, text: '配達中…あと' + Math.ceil((tk.at - g) / 1000) + '秒で到着（いま発送すると同じトラックに積みます）' };
    if (!tk.out) return { busy: true, text: '裏の路地に到着中。荷台から段ボールを下ろそう' };
    return { busy: true, text: '帰っていくところ' };
  };
  game.renderMarket = function (body, s) {
    const P = R.PACK, cart = game.cart, ts = truckState(s);
    const sub = cart.reduce((a, id) => a + Math.round(s.market[id] * P), 0), total = cart.length ? sub + R.SHIP : 0;
    const head = `<div class="row between wrap"><span class="small">資金 <b class="num">${yen(s.funds)}</b></span><span class="chip ${ts.busy ? 'warn' : 'ok'}">${ic('box')} トラック：${esc(ts.text)}</span></div>`;
    if (game.mkView === 'cart') {
      body.innerHTML = `${head}<div class="card"><div class="row between"><h3>${ic('cart')} カート（${cart.length} / ${R.CART_MAX}箱）</h3><button class="btn sm ghost" id="mk-back">${ic('back')} 商品をえらぶ</button></div>
        ${cart.length ? `<div class="list">${cart.map((id, k) => `<div class="item"><div class="ico">${D.ING[id].icon}</div><div class="mid"><b>${esc(D.ING[id].name)} ×${P}</b><small>1箱 ${yen(Math.round(s.market[id] * P))}（いまの値段）</small></div><div class="end"><button class="btn sm ghost" data-cancel="${k}">${ic('close')} キャンセル</button></div></div>`).join('')}</div>` : '<p class="muted small" style="margin:0">カートは空です。「商品をえらぶ」から入れよう</p>'}
        <dl class="kv"><dt>商品の合計</dt><dd>${yen(sub)}</dd><dt>送料（1回の注文ごと）</dt><dd>${cart.length ? yen(R.SHIP) : '—'}</dd><dt class="tot">お支払い</dt><dd class="tot">${yen(total)}</dd></dl>
        <button class="btn big pink wide" id="mk-send" ${cart.length && !ts.busy && s.funds >= total ? '' : 'disabled'}>${ic('box')} 発送する</button>
        ${ts.busy ? '<p class="muted small" style="margin:0">トラックが着いています。荷おろしが終わってトラックが帰ると、次の注文を発送できます。</p>' : s.funds < total ? '<p class="neg small" style="margin:0">資金が足りません</p>' : '<p class="muted small" style="margin:0">仕入れ値は注文のたびに少しずつ変わります（発送したときの値段で買います）。</p>'}</div>`;
      $('#mk-back', body).onclick = () => { game.mkView = 'list'; UI.renderSheet(true); };
      $$('[data-cancel]', body).forEach((b) => (b.onclick = () => { game.cart.splice(+b.dataset.cancel, 1); CS.sound.play('tap'); UI.renderSheet(true); }));
      const send = $('#mk-send', body);
      send.onclick = async () => {
        const items = game.cart.slice();
        CS.sound.play('coin'); send.disabled = true;
        const r = await act({ t: 'order', items });
        if (r && r.ok === false) { send.disabled = false; return; }
        game.cart = []; game.mkView = 'list'; UI.renderSheet(true);
      };
      return;
    }
    const ev = s.mEvent && s.mEvent.id ? `<div class="banner ${s.mEvent.up ? 'pink' : 'mint'}">${D.ING[s.mEvent.id].icon} 今日は${esc(D.ING[s.mEvent.id].name)}が${s.mEvent.up ? '高騰中！' : '特売中！'}</div>` : '';
    body.innerHTML = `${head}${ev}<div class="row between wrap"><button class="btn mint" id="mk-cart">${ic('cart')} カートを見る（${cart.length} / ${R.CART_MAX}）</button><button class="btn sm ghost" id="mk-bulk">${ic('plus')} 販売中メニューに足りない分を入れる</button></div>
      <p class="muted small" style="margin:0">1箱＝${P}個。1回の注文は${R.CART_MAX}箱まで・送料 ${yen(R.SHIP)}。届いたら倉庫の裏口から外に出て、トラックの荷台から段ボールを運び、開けて好きな棚に並べます（同じ物は同じ所に重なる・<b>1枠10個まで</b>。段ボールのままは棚に入らない）。運びきれない段ボールは床や机に置いておけます。<b>要冷蔵</b>の材料は常温だと傷むので、すぐ<b>冷蔵棚</b>へ。ケーキを入れる<b>箱</b>も仕入れが必要です。</p>
      <div class="list">${Object.keys(D.ING).filter((id) => sim.ingUnlocked(s, id)).map((id) => {
        const ing = D.ING[id], p = s.market[id], box = Math.round(p * P), have = sim.invCount(s, id), inCart = cart.filter((x) => x === id).length;
        const ch = Math.round((p / ing.price - 1) * 100), exp = sim.expSoon(s, id);
        return `<div class="item mk"><div class="ico">${ing.icon}</div><div class="mid"><b>${esc(ing.name)} <span class="chip ${have ? '' : 'bad'}">在庫 ${have}</span>${ing.cold ? ` <span class="chip cold">${ic('snow')} 要冷蔵</span>` : ''}${inCart ? ` <span class="chip pink">カート ${inCart}</span>` : ''}</b><small>1箱 ${yen(box)} <span class="${ch > 3 ? 'neg' : ch < -3 ? 'pos' : ''}">${ch > 3 ? '▲' + ch + '%' : ch < -3 ? '▼' + -ch + '%' : '±0'}</span>・${ing.life ? (exp !== null ? '古いのはあと' + Math.max(0, exp) + '日' : '日持ち' + Math.round(ing.life * sim.eqv(s, 'fridge').life) + '日') : '日持ちする'}</small></div>
          <div class="end"><button class="btn sm yellow" data-add="${id}" ${cart.length < R.CART_MAX ? '' : 'disabled'}>${ic('cart')} 入れる</button></div></div>`;
      }).join('')}</div>${(() => {
        const lk = Object.keys(D.ING).filter((id) => !sim.ingUnlocked(s, id));
        return lk.length ? `<div class="card soft"><h3>${ic('lock')} まだ仕入れられない材料</h3><p class="muted small" style="margin:0">その材料を使うお菓子が解放されると買えるようになります</p><div class="list">${lk.map((id) => { const by = sim.ingUnlockBy(id); return `<div class="row between small"><span>${D.ING[id].icon} ${esc(D.ING[id].name)}</span><span class="chip">${by ? '店舗Lv' + (by.lv || 1) + '「' + esc(by.name) + '」で解放' : '—'}</span></div>`; }).join('')}</div></div>` : '';
      })()}`;
    $('#mk-cart', body).onclick = () => { game.mkView = 'cart'; UI.renderSheet(true); };
    $$('[data-add]', body).forEach((b) => (b.onclick = () => { if (game.cart.length >= R.CART_MAX) return UI.toast('1回の注文は' + R.CART_MAX + '箱までです', 'err'); game.cart.push(b.dataset.add); CS.sound.play('pop'); UI.toast(D.ING[b.dataset.add].name + 'をカートに入れた（' + game.cart.length + '/' + R.CART_MAX + '）'); UI.renderSheet(true); }));
    $('#mk-bulk', body).onclick = () => game.bulkBuy();
  };
  // 販売中メニューの材料で、足りない分をカートに入れる
  game.bulkBuy = function () {
    const s = S(); const need = {};
    const add = (req, k) => { for (const id in req) need[id] = (need[id] || 0) + req[id] * k; };
    Object.keys(s.menu).filter((rid) => s.menu[rid].on && s.known[rid]).forEach((rid) => { const r = sim.recipe(s, rid); add(D.BASES[r.base].ing, 2); if (r.cream !== 'none') add(D.CREAMS[r.cream].ing, 1); add(r.tops || {}, 2); });
    if (D.ING.box) need.box = Math.max(need.box || 0, R.PACK); // ケーキの箱も
    let added = 0;
    for (const id in need) { if (!sim.ingUnlocked(s, id)) continue; let n = Math.ceil((need[id] - sim.invCount(s, id) - game.cart.filter((x) => x === id).length * R.PACK) / R.PACK); while (n-- > 0 && game.cart.length < R.CART_MAX) { game.cart.push(id); added++; } }
    if (!added) return UI.toast(game.cart.length >= R.CART_MAX ? 'カートがいっぱいです' : 'いまの在庫で足りています', 'good');
    UI.toast(added + '箱をカートに入れました'); CS.sound.play('pop'); game.mkView = 'cart'; UI.renderSheet(true);
  };
  // ---------- 借金（パソコン） ----------
  game.loanSel = game.loanSel || { amt: 10000, days: 5 };
  game.renderLoan = function (body, s) {
    const LN = R.LOAN, L = s.loan, fundsCls = s.funds < 0 ? 'neg' : '';
    const head = `<div class="row between"><span class="small">資金 <b class="num ${fundsCls}">${yen(s.funds)}</b></span>${L ? '<span class="chip warn">返済中</span>' : '<span class="chip ok">借りられます</span>'}</div>`;
    const rules = `<div class="card soft"><h3>借金のきまり</h3><ul class="small muted" style="margin:0;padding-left:1.2em;display:grid;gap:3px">
        <li>借りられるのは <b>1万・3万・5万円</b>（最大5万円）</li>
        <li><b>5日で返す</b>：1日に 借りた額÷5 に <b>50%上乗せ</b>（1万円なら1日 ${yen(sim.loanPlan(10000, 5).per)}）</li>
        <li><b>10日で返す</b>：1日に 借りた額÷10 に <b>120%上乗せ</b>（1万円なら1日 ${yen(sim.loanPlan(10000, 10).per)}）</li>
        <li>毎日、<b>閉店したときに自動で引かれます</b></li>
        <li>お金が足りないと資金が<b>マイナス</b>になり、黒字に戻るまで<b>何も買えなくなります</b>（${yen(R.BANKRUPT)} を下回ると倒産）</li>
        <li>返し終わるまで、次の借金はできません</li></ul></div>`;
    if (L) {
      const rest = L.total - L.paid, pct = Math.round((L.paid / L.total) * 100);
      const short = s.funds < L.per;
      body.innerHTML = head + `<div class="card loan-now"><h3>${ic('coin')} 返済中の借金</h3><dl class="kv">
          <dt>借りた額</dt><dd>${yen(L.amt)}（${L.day}日目）</dd><dt>返し方</dt><dd>${L.days}日で返す</dd>
          <dt>1日に返す額</dt><dd class="neg">-${yen(L.per)}</dd><dt>返した額</dt><dd>${yen(L.paid)} / ${yen(L.total)}</dd>
          <dt class="tot">残り</dt><dd class="tot neg">${yen(rest)}（あと${L.left}回）</dd></dl>
          <div class="loan-bar"><i style="width:${pct}%"></i></div>
          <p class="small ${short ? 'neg' : 'muted'}" style="margin:0">${s.phase === 'report' ? '次の閉店のときに' : '今日の閉店のときに'} ${yen(Math.min(L.per, rest))} 引かれます。${short ? 'いまの資金では足りません（マイナスになると何も買えなくなります）。' : ''}</p></div>` + rules;
      return;
    }
    const sel = game.loanSel, pl = sim.loanPlan(sel.amt, sel.days);
    const amtB = LN.amounts.map((a) => `<button class="btn ${sel.amt === a ? 'pink' : ''}" data-la="${a}">${a / 10000}万円</button>`).join('');
    const dayB = [5, 10].map((d) => { const p = sim.loanPlan(sel.amt, d); return `<button class="btn loan-plan ${sel.days === d ? 'pink' : ''}" data-ld="${d}"><b>${d}日で返す</b><small>1日 ${yen(p.per)}・合計 ${yen(p.total)}</small></button>`; }).join('');
    body.innerHTML = head + `<div class="card"><h3>${ic('coin')} お金を借りる</h3>
        <span class="small muted">借りる額</span><div class="loan-grid three">${amtB}</div>
        <span class="small muted">返し方</span><div class="loan-grid">${dayB}</div>
        <dl class="kv"><dt>すぐ入るお金</dt><dd class="pos">+${yen(pl.amt)}</dd><dt>閉店のたびに引かれる</dt><dd class="neg">-${yen(pl.per)} × ${pl.days}回</dd><dt class="tot">返す合計</dt><dd class="tot">${yen(pl.total)}（上乗せ ${yen(pl.total - pl.amt)}）</dd></dl>
        <button class="btn big pink wide" id="ln-go">${ic('coin')} ${yen(pl.amt)} を借りる</button></div>` + rules;
    $$('[data-la]', body).forEach((b) => (b.onclick = () => { CS.sound.play('tap'); sel.amt = +b.dataset.la; UI.renderSheet(true); }));
    $$('[data-ld]', body).forEach((b) => (b.onclick = () => { CS.sound.play('tap'); sel.days = +b.dataset.ld; UI.renderSheet(true); }));
    $('#ln-go', body).onclick = async () => {
      const p = sim.loanPlan(sel.amt, sel.days);
      if (!(await UI.confirm('お金を借りる', `${yen(p.amt)} を借りて、閉店のたびに ${yen(p.per)} ずつ ${p.days}回（合計 ${yen(p.total)}）返します。返し終わるまで次は借りられません。`, '借りる'))) return;
      CS.sound.play('coin'); act({ t: 'borrow', amt: p.amt, days: p.days });
    };
  };
  // ---------- 経営のタブ（収支・拡張・広告・レベル） ----------
  game.renderBizTab = function (body, s, t) {
    if (t === 'level') return game.renderLevel(body, s);
    if (t === 'today') {
      const T = s.today;
      let equip = 0; for (const u of D.UPGRADES) equip += s.up[u.id] || 0;
      const wages = s.staff.reduce((a, st) => a + (st ? D.STAFF.wage(st.lv, st.sp) : 0), 0);
      const rentU = R.RENT + (s.up.floor || 0) * (R.RENT_PER_FLOOR || 1500) + (equip + 2) * R.UTIL_PER_EQUIP;
      const fixed = s.phase === 'report' && s.history.length ? s.history[s.history.length - 1].fixed : rentU + wages;
      const rev = T.sales + T.drinks;
      const prof = rev - T.cogs - T.waste - T.ads - (T.lab || 0) - fixed;
      body.innerHTML = `<div class="card"><h3>${s.day}日目（${s.phase === 'report' ? '確定' : 'いまの時点'}）</h3><dl class="kv">
        <dt>売上（ケーキ）</dt><dd>${yen(T.sales)}</dd><dt>売上（ドリンク）</dt><dd>${yen(T.drinks)}</dd>
        <dt>原価（売れた分）</dt><dd class="neg">-${yen(T.cogs)}</dd><dt>廃棄ロス</dt><dd class="neg">-${yen(T.waste)}</dd>
        <dt>広告・試作</dt><dd class="neg">-${yen(T.ads + (T.lab || 0))}</dd><dt>家賃・光熱費・日給（閉店時）</dt><dd class="neg">-${yen(fixed)}</dd>
        <dt class="tot">営業利益（見込み）</dt><dd class="tot ${prof >= 0 ? 'pos' : 'neg'}">${yen(prof)}</dd>
        ${T.loanIn ? `<dt>借りたお金</dt><dd class="pos">+${yen(T.loanIn)}</dd>` : ''}
        ${(() => { const lp = s.phase === 'report' && s.history.length ? s.history[s.history.length - 1].loan || 0 : s.loan ? Math.min(s.loan.per, s.loan.total - s.loan.paid) : 0; return lp ? `<dt>借金の返済（閉店時）</dt><dd class="neg">-${yen(lp)}</dd>` : ''; })()}</dl></div>
        <div class="card"><dl class="kv"><dt>来店</dt><dd>${T.cust}人</dd><dt>販売</dt><dd>${T.sold}個${T.hole ? '（うちホール ' + T.hole + '台）' : ''}</dd><dt>買わずに帰った</dt><dd>${T.miss}人（うち売り切れ ${T.soldout}人）</dd><dt>満足度</dt><dd>${T.cust - T.miss > 0 ? Math.round((T.sat / (T.cust - T.miss)) * 100) + '%' : '—'}</dd><dt>今日の仕入れ額</dt><dd>${yen(T.buy || 0)}</dd><dt>設備投資</dt><dd>${yen(T.capex || 0)}</dd><dt class="tot">現在の資金</dt><dd class="tot">${yen(s.funds)}</dd></dl></div>
        ${s.history.length ? `<div class="card"><h3>売上と利益（直近14日）</h3><div class="chart">${chartSVG(s.history.slice(-14))}</div><div class="row small" style="gap:14px"><span><i style="display:inline-block;width:12px;height:12px;background:rgba(201,163,94,.55);border:1.5px solid var(--gold);border-radius:3px"></i> 売上</span><span><i style="display:inline-block;width:14px;height:3px;background:var(--good)"></i> 利益</span></div></div>` : ''}
        <p class="muted small" style="margin:0">資金が ${yen(R.BANKRUPT)} を下回ると倒産です。</p>`;
      return;
    }
    if (t === 'up') {
      const SL = sim.shopLevel(s).lv;
      body.innerHTML = `<div class="row between"><span class="small">資金 <b class="num">${yen(s.funds)}</b>・店舗 <b>Lv${SL}</b></span><span class="small muted">設備1つごとに光熱費 +${yen(R.UTIL_PER_EQUIP)}/日</span></div><div class="list">${D.UPGRADES.filter((u) => !u.hide && u.id !== 'showcase').map((u) => {
        const lv = s.up[u.id] || 0, max = u.levels.length, cost = u.levels[lv], need = sim.upReq(u, lv);
        const cur = u.vals ? `いま ${u.vals[lv]}台` : '';
        const btn = lv >= max ? '<span class="chip ok">導入済み</span>' : SL < need ? `<span class="chip">${ic('lock')} Lv${need}</span>` : `<button class="btn sm pink num" data-up="${u.id}" ${s.funds >= cost ? '' : 'disabled'}>${yen(cost)}</button>`;
        return `<div class="card upg"><div class="ico">${ic(u.icon)}</div><div style="min-width:0;display:grid;gap:2px"><b>${esc(u.name)}</b><span class="small muted">${esc(u.desc)}${cur ? '（' + cur + '）' : ''}</span><span class="lv">${u.levels.map((_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span></div>${btn}</div>`;
      }).join('')}</div><p class="muted small" style="margin:0">増床するとお店と厨房が広くなり、家具を置ける場所と席が増えます（家具の位置はできるだけそのまま）。</p>`;
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
          <li><b>道具をそろえる</b>：最初は机・棚・冷蔵棚・冷蔵庫・クリーム台・洗い場・商品棚・レジ・ゴミ箱、ケーキの型1つ・お皿1枚だけ。パソコン室のパソコンの「家具・道具」でオーブン・ミキサー台・デコ台を買う。<b>「配置」</b>で家具を好きな場所に動かせる</li>
          <li><b>仕入れ</b>：「材料の注文」でカートに入れて「発送」→ トラックが裏の路地に来たら、倉庫の裏口から出て荷台の段ボールを運ぶ →「開ける」→ 棚の好きな所に「置く」（同じ物は同じ所に重なる。空けるとまた何でも置ける）。ケーキの<b>箱</b>も仕入れる。箱の段ボールは開けて<b>カウンター裏の箱入れ</b>（レジの下の穴）にしまえる（30枚まで）</li>
          <li><b>生地</b>：棚の材料を「1つ取る」（長押しで続けて）→ ミキサーで<b>順番どおり</b>に入れる（取りすぎたら棚に「1つ戻す」）→ 回してゲージの<b class="pos">緑</b>で止める → きれいなケーキ型を持って「型に流す」</li>
          <li><b>焼く</b>：オーブンに入れて電源ON（温度は生地ごとの適温）→ ゲージの緑で「取り出す」→ 机や冷却ラックで冷ます</li>
          <li><b>クリーム</b>：クリーム台に材料を入れて泡立て、緑で止める →「すくう」</li>
          <li><b>デコ</b>：冷めた型をデコ台にのせる（空いた型は汚れる）→ クリームを持って「塗る」→ 指でなぞってまんべんなく → トッピングを棚から取ってケーキの上に1つずつ置く（まちがえたら「1つ取る」）→「仕上げる」</li>
          <li><b>並べる</b>：できたケーキを商品棚に置くと<b>切って並ぶ</b>。クリームのケーキは<b>冷蔵</b>の商品棚へ、クッキーなどは<b>常温</b>の商品棚でもOK</li>
          <li><b>接客</b>：外の看板を OPEN → レジで注文を受ける → <b>持ち帰り＝箱</b>（カウンター裏の箱入れから取る）、<b>店内＝お皿</b>を持って商品棚から1切れずつ入れる → お客さんに渡す（困ったお客さんはねらって「帰ってもらう」を2回） → <b>レジでお会計</b>（カードはタッチするだけ。現金はお釣りの硬貨・お札をえらんで渡す。足りないと渡せない）</li>
          <li><b>自動化</b>：店舗レベルが上がると「家具・道具」に<b>自動の機械</b>が並ぶ。自動ミキサー（材料を入れるだけ）→ 自動オーブン（入れるだけで適温・適時間）→ 自動ホイッパー → 自動デコ機（クリームとトッピングをセット）。<b>Lv10</b> の<b>全自動製造ライン</b>は投入口に材料を入れるだけでケーキが出口に出てくる。アルバイトを<b>「機械係」</b>にすると補充と運び出しも自動</li>
          <li><b>洗い物</b>：使った型、店内で食べ終わったお皿（席に残る）は洗い場の流しへ →「洗う」でこすって泡立て → 水を出す → 棚か水切りかごに置くと<b>30秒で乾く</b>。お皿は<b>床に落とすと割れる</b></li></ol></div>
          <div class="card soft"><h3>${ic('snow')} 冷蔵のルール</h3><ul class="howto">
          <li><b>要冷蔵の材料</b>（卵・バター・牛乳・生クリーム・チーズ・果物）は常温に置くと2〜5分で傷みます。トラックの荷台は冷蔵なので大丈夫。下ろしたら<b>すぐ冷蔵棚</b>へ</li>
          <li>半分を過ぎると「ぬるい」状態に。そのまま棚に置くと<b>日持ちが半分</b>になります。傷んだら使えないので捨てる（廃棄）しかありません</li>
          <li><b>生クリーム</b>（約${Math.round(D.SPOIL.cream / 60)}分）・<b>クリームを塗ったケーキ</b>（約${Math.round(D.SPOIL.cake / 60)}分）も常温だと「だれる・溶ける」→「傷む」。使うまでは<b>冷蔵庫</b>（1台にケーキ6ホール）へ</li>
          <li>傷んだクリームやケーキを売ると、お客さんがお腹をこわして<b>★1の口コミ</b>。評判が大きく下がります</li>
          <li>ケーキの<b>賞味期限は作った日を入れて2日</b>（3日目には消える）。冷蔵の商品棚・冷蔵庫に入れたケーキは翌日も売れます</li></ul></div>`;
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
    const ce = s.cEvent && s.cEvent.r && sim.recipe(s, s.cEvent.r);
    const host = amHost(), stock = CS.kitchen.shelfStock(s), hstock = CS.kitchen.holeStock(s), exps = {};
    Object.values(s.k.items).forEach((k) => { if (k.t === 'tray' && k.p > 0 && (!exps[k.r] || k.d < exps[k.r])) exps[k.r] = k.d; });
    body.innerHTML = `<div class="banner sky"><span>お客さんは<b>販売中（ON）</b>の商品から好きな数を注文します。ケーキは<b>カット（1切れ）</b>と<b>ホール（切らずに1台）</b>のどちらでも売れます（ホールはお祝い・家族のお客さんがよく買います）。ショーケースに無い物は、注文を受けてから急いで作ります（遅すぎると帰ってしまいます）。ケーキの相場は毎日変わり、相場より高すぎる（${Math.round(R.PRICE_LIMIT * 100)}%超）とほとんど売れず「高すぎる」とクレームが来ます。</span></div>${host ? '' : `<div class="banner">${ic('lock')}<span>販売する商品のON／OFFはホストだけが変えられます（値段はだれでも変えられます）</span></div>`}${ce ? `<div class="banner ${s.cEvent.up ? 'pink' : 'mint'}">今日は「${esc(ce.name)}」の相場が${s.cEvent.up ? '上がっています（人気！）' : '下がっています'}</div>` : ''}` + rids.map((rid) => {
      const r = sim.recipe(s, rid); const m = s.menu[rid];
      const cost = sim.costEstimate(s, r) / sim.pieceCount(r);
      return `<div class="card menu-card" data-r="${rid}"><div class="pic">${cakeImg(r)}</div><div class="ctl">
        <div class="row between"><b>${esc(r.name)}</b><label class="switch ${host ? '' : 'locked'}" title="${host ? '販売する' : 'ホストだけが変えられます'}"><input type="checkbox" data-on="${rid}" ${m.on ? 'checked' : ''} ${host ? '' : 'disabled'} aria-label="${esc(r.name)}を販売"><i></i></label></div>
        <div class="row small wrap"><span class="chip ${m.on ? 'ok' : ''}">${m.on ? '販売中' : '販売しない'}</span><span class="chip ${stock[rid] || hstock[rid] ? 'cold' : ''}">${ic('case')} ショーケース ${stock[rid] || 0}切れ${sim.wholeable(r) ? '・ホール ' + (hstock[rid] || 0) + '台' : ''}</span>${exps[rid] ? `<span class="chip ${sim.cakeExpDay(exps[rid], s) <= s.day ? 'warn' : ''}">${esc(sim.cakeExpText(s, exps[rid]))}</span>` : ''}</div>
        <div class="row small"><span class="stars">${'★'.repeat(Math.round(sim.stars(r)))}</span><span class="muted">今日の相場 <b class="num">${yen(sim.cakeMarket(s, rid, r))}</b></span>${r.orig ? `<button class="btn sm ghost" data-del="${rid}" style="margin-left:auto">${ic('trash')}</button>` : ''}</div>
        <div class="price-row"><div class="step"><button data-pd="-10" aria-label="10円下げる">${ic('minus')}</button><output class="price-val" data-pv>${yen(m.price)}</output><button data-pd="10" aria-label="10円上げる">${ic('plus')}</button></div></div>
        <input type="range" min="100" max="${Math.max(1500, Math.round(sim.cakeMarket(s, rid, r) * 2 / 10) * 10)}" step="10" value="${m.price}" data-pr="${rid}" aria-label="価格">
        <div class="row between small"><span>原価 ${yen(cost)}/切れ</span><span data-pf>利益 ${yen(m.price - cost)}（${Math.round((1 - cost / m.price) * 100)}%）</span></div>
        <div class="demand" data-dm></div><div class="small" data-mk></div>${sim.wholeable(r) ? `
        <div class="hole-box"><div class="row between small"><b>${ic('cake')} ホール（${sim.pieceCount(r)}切れぶん・切らずに1台）</b><span class="muted">相場 <b class="num">${yen(sim.holeMarket(s, rid, r))}</b></span></div>
        <div class="price-row"><div class="step"><button data-hd="-100" aria-label="100円下げる">${ic('minus')}</button><output class="price-val" data-hv>${yen(m.hp || 0)}</output><button data-hd="100" aria-label="100円上げる">${ic('plus')}</button></div></div>
        <input type="range" min="500" max="${Math.max(6000, Math.round(sim.holeMarket(s, rid, r) * 2 / 100) * 100)}" step="10" value="${m.hp || 0}" data-hr aria-label="ホールの価格">
        <div class="row between small"><span>原価 ${yen(cost * sim.pieceCount(r))}/台</span><span data-hf></span></div>
        <div class="demand" data-hdm></div><div class="small" data-hmk></div></div>` : ''}</div></div>`;
    }).join('');
    const fit = (f) => (f > R.PRICE_LIMIT ? `<span class="neg">${ic('megaphone')} 相場の${Math.round(f * 100)}%：高すぎてクレームが来ます</span>` : f > 1.12 ? `<span style="color:var(--warn)">相場の${Math.round(f * 100)}%：やや高め（味がいまいちだと文句が出るかも）</span>` : f < 0.85 ? `<span style="color:var(--info)">相場の${Math.round(f * 100)}%：安め（よく売れるが利益は少なめ）</span>` : `<span class="pos">相場の${Math.round(f * 100)}%：ちょうどいい</span>`);
    const updH = (card, hp) => {
      const rid = card.dataset.r, s2 = S(), r = sim.recipe(s2, rid), cost = sim.costEstimate(s2, r);
      $('[data-hv]', card).textContent = yen(hp);
      $('[data-hf]', card).textContent = `利益 ${yen(hp - cost)}（${Math.round((1 - cost / hp) * 100)}%）・1切れあたり ${yen(Math.round(hp / sim.pieceCount(r)))}`;
      $('[data-hmk]', card).innerHTML = fit(hp / sim.holeMarket(s2, rid, r));
      const p = sim.demandEstimate(s2, rid, hp, 0.8, 1); const [mk, col] = markOf(p);
      $('[data-hdm]', card).innerHTML = `<span>ホールを買う人の売れ行き</span><span class="bar"><u style="width:${Math.round(p * 100)}%;background:${col}"></u></span><span class="mark" style="color:${col}">${mk}</span>`;
    };
    const upd = (card, price) => {
      const rid = card.dataset.r; const s2 = S(); const r = sim.recipe(s2, rid); const cost = sim.costEstimate(s2, r) / sim.pieceCount(r);
      $('[data-pv]', card).textContent = yen(price);
      $('[data-pf]', card).textContent = `利益 ${yen(price - cost)}（${Math.round((1 - cost / price) * 100)}%）`;
      const mkp = sim.cakeMarket(s2, rid, r), f = price / mkp;
      $('[data-mk]', card).innerHTML = fit(f);
      const p = sim.demandEstimate(s2, rid, price, 0.8); const [mk, col] = markOf(p);
      $('[data-dm]', card).innerHTML = `<span>売れ行き</span><span class="bar"><u style="width:${Math.round(p * 100)}%;background:${col}"></u></span><span class="mark" style="color:${col}">${mk}</span>`;
    };
    const commit = (rid, price) => { clearTimeout(priceTimers[rid]); priceTimers[rid] = setTimeout(() => act({ t: 'price', r: rid, price }), 350); };
    const commitH = (rid, hp) => { clearTimeout(priceTimers[rid + '#h']); priceTimers[rid + '#h'] = setTimeout(() => act({ t: 'price', r: rid, hp }), 350); };
    $$('.menu-card', body).forEach((card) => {
      const rid = card.dataset.r; const range = $('[data-pr]', card);
      upd(card, +range.value);
      range.oninput = () => { upd(card, +range.value); commit(rid, +range.value); };
      $$('[data-pd]', card).forEach((b) => (b.onclick = () => { const v = clamp(+range.value + +b.dataset.pd, 100, 3000); range.value = v; upd(card, v); commit(rid, v); CS.sound.play('tap'); }));
      const hr = $('[data-hr]', card);
      if (hr) {
        updH(card, +hr.value);
        hr.oninput = () => { updH(card, +hr.value); commitH(rid, +hr.value); };
        $$('[data-hd]', card).forEach((b) => (b.onclick = () => { const v = clamp(+hr.value + +b.dataset.hd, 500, 20000); hr.value = v; updH(card, v); commitH(rid, v); CS.sound.play('tap'); }));
      }
      $('[data-on]', card).onchange = (e) => { if (!amHost()) { e.target.checked = !e.target.checked; UI.toast('ホストだけが変えられます', 'err'); return; } act({ t: 'menuOn', r: rid, on: e.target.checked }); };
      const del = $('[data-del]', card); if (del) del.onclick = async () => { if (await UI.confirm('メニューから削除', 'このオリジナルケーキを削除します（並んでいる分も片づけます）。', '削除', true)) act({ t: 'unregister', r: rid }); };
    });
  };
  const memoOn = (rid) => { const m = CS.LS.get('cs.rmemo', {}) || {}; return !!m.show && m.r === rid; };
  game.renderBook = function (body) {
    const s = S();
    const comp = (r) => `${esc(D.BASES[r.base].short)}生地 ＋ ${r.cream === 'none' ? 'クリームなし' : esc(D.CREAMS[r.cream].short)}${Object.keys(r.tops || {}).length ? ' ＋ ' + Object.keys(r.tops).map((k) => D.ING[k].icon + '×' + r.tops[k]).join(' ') : ''}`;
    const items = Object.keys(D.RECIPES).map((rid) => {
      const r = D.RECIPES[rid];
      if (s.known[rid]) return `<div class="rb">${cakeImg(r)}<b>${esc(r.name)}</b><span class="comp">${comp(r)}</span><span class="small">焼成 ${D.BASES[r.base].temp}℃・混ぜる順：${D.BASES[r.base].order.map((k) => D.ING[k].icon + D.BASES[r.base].ing[k]).join('→')}${r.cream !== 'none' ? '・' + esc(D.CREAMS[r.cream].short) + '：' + Object.keys(D.CREAMS[r.cream].ing).map((k) => D.ING[k].icon + D.CREAMS[r.cream].ing[k]).join('') : ''}</span><span class="small muted">${sim.wholeable(r) ? 'ホール・カット（ナイフで6等分）で売れる' : (r.unit || '個') + 'で売る（切らない）'}</span><button class="btn sm ${memoOn(rid) ? 'mint' : 'ghost'}" data-memo="${rid}">${ic('book')} ${memoOn(rid) ? 'メモに表示中' : 'メモに出す'}</button></div>`;
      return `<div class="rb unknown">${cakeImg(r)}<b>${esc(r.name)}</b><span class="chip">${ic('lock')} 店舗Lv${r.lv || 1} で解放</span><span class="comp">${comp(r)}</span></div>`;
    }).concat(Object.keys(s.originals).map((rid) => { const r = s.originals[rid]; return `<div class="rb">${cakeImg(r)}<b>${esc(r.name)}</b><span class="chip pink">オリジナル</span><span class="comp">${comp(r)}</span><button class="btn sm ${memoOn(rid) ? 'mint' : 'ghost'}" data-memo="${rid}">${ic('book')} ${memoOn(rid) ? 'メモに表示中' : 'メモに出す'}</button></div>`; }));
    const known = Object.keys(D.RECIPES).filter((k) => s.known[k]).length;
    body.innerHTML = `<div class="row between"><b>作れる商品 ${known} / ${Object.keys(D.RECIPES).length}</b><button class="btn sm lilac" id="bk-lab">${ic('flask')} レシピ開発へ</button></div>
      <div class="banner sky small">「メモに出す」を押すと、左上にレシピメモがずっと出ます（ミキサー・クリーム台に入れた材料に ✓ がつく）。メモの ‹ › でレシピを切りかえ。</div>
      <div class="card soft"><h3>生地の「混ぜる順」</h3><div class="list">${Object.keys(D.BASES).map((k) => `<div class="row between small"><span>${esc(D.BASES[k].name)}</span><span>${D.BASES[k].order.map((i) => D.ING[i].icon + D.ING[i].name).join(' → ')}</span></div>`).join('')}</div></div>
      <div class="recipe-book">${items.join('')}</div>`;
    $$('[data-memo]', body).forEach((b) => (b.onclick = () => { game.memoShow(b.dataset.memo, true); UI.renderSheet(true); }));
    $('#bk-lab', body).onclick = () => { UI.sheet.tab = 'lab'; $$('.sh-tabs button').forEach((x) => x.setAttribute('aria-selected', x.dataset.tab === 'lab')); UI.renderSheet(true); };
  };
  game.renderLab = function (body) {
    const s = S(); const L = game.lab;
    const okI = (g) => Object.keys(g || {}).every((k) => sim.ingUnlocked(s, k));
    const okB = (k) => okI(D.BASES[k].ing), okC = (k) => okI(D.CREAMS[k].ing), okT = (k) => sim.ingUnlocked(s, k);
    if (!okB(L.base)) L.base = 'plain'; if (!okC(L.cream)) L.cream = 'none'; for (const k in L.tops) if (!okT(k)) delete L.tops[k];
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
      <div class="card soft"><h3>生地</h3><div class="pick">${Object.keys(D.BASES).map((k) => `<button data-b="${k}" aria-pressed="${L.base === k}" ${okB(k) ? '' : 'disabled title="材料がまだ解放されていません"'}>${okB(k) ? `<span class="sw" style="background:${D.BASES[k].color}"></span>` : ic('lock')}${esc(D.BASES[k].short)}</button>`).join('')}</div></div>
      <div class="card soft"><h3>クリーム</h3><div class="pick">${Object.keys(D.CREAMS).map((k) => `<button data-c="${k}" aria-pressed="${L.cream === k}" ${okC(k) ? '' : 'disabled title="材料がまだ解放されていません"'}>${!okC(k) ? ic('lock') : D.CREAMS[k].color ? `<span class="sw" style="background:${D.CREAMS[k].color}"></span>` : ''}${esc(D.CREAMS[k].short)}</button>`).join('')}</div></div>
      <div class="card soft"><h3>トッピング（3種類・5個まで）</h3><div class="list">${Object.keys(D.TOPS).map((k) => okT(k) ? `<div class="row between"><span>${D.ING[k].icon} ${esc(D.ING[k].name)}</span><div class="step"><button data-t="${k}" data-d="-1" aria-label="減らす">${ic('minus')}</button><output>${L.tops[k] || 0}</output><button data-t="${k}" data-d="1" aria-label="増やす">${ic('plus')}</button></div></div>` : `<div class="row between small muted"><span>${ic('lock')} ${esc(D.ING[k].name)}</span><span>まだ解放されていません</span></div>`).join('')}</div></div>
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
      for (const k in CS.plan.KINDS) if (CS.plan.KINDS[k].lv === lv) items.push('🤖 ' + CS.plan.KINDS[k].name);
      D.STAFF.slots.forEach((x, i) => { if (x.lv === lv) items.push('🧑‍🍳 アルバイト' + (i + 1) + '人目'); });
      D.UPGRADES.filter((u) => !u.hide).forEach((u) => (u.req || []).forEach((r, i) => { if (r === lv) items.push('🏠 ' + u.name + (u.levels.length > 1 ? ' ' + (i + 1) + '段階目' : '')); }));
      const ru = sim.rush({ xp: D.SHOP_XP[lv - 1] }), rp = lv > 1 ? sim.rush({ xp: D.SHOP_XP[lv - 2] }) : null;
      items.push('👥 お客さん ×' + ru.rate.toFixed(2) + (rp && ru.size > rp.size ? '・まとめ買いが増える' : ''));
      rows.push(`<div class="item lvrow ${lv <= L.lv ? 'done' : ''}"><div class="ico"><b>${lv}</b></div><div class="mid"><b>Lv${lv}${lv > 1 ? `<small class="muted">（${D.SHOP_XP[lv - 1]}pt）</small>` : ''}</b><small>${items.length ? items.map(esc).join('　') : '—'}</small></div><span>${lv <= L.lv ? '<span class="chip ok">解放</span>' : ''}</span></div>`);
    }
    body.innerHTML = `<div class="card"><div class="row between"><h3>店舗レベル ${L.lv}${L.max ? '（最大）' : ''}</h3><span class="num">${L.xp}${L.max ? '' : ' / ' + L.next}pt</span></div><i class="bar lvbar"><u style="width:${L.max ? 100 : Math.round(L.f * 100)}%"></u></i>
      <p class="muted small" style="margin:0">ポイントは「欠点のない商品を売る」「お客さんを満足させる」「評判を上げる」でたまります。レベルが上がると、材料をセットするだけの<b>自動の機械</b>が買えるようになり、Lv10 で<b>全自動製造ライン</b>とアルバイトの「機械係」で完全自動化できます。</p></div><div class="list">${rows.join('')}</div>`;
  };
  // ---------- 自動の機械：作るケーキを選ぶ ----------
  game.openAutoMode = async function (fid) {
    const s = S(); if (!s || !s.fu[fid]) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const k = s.fu[fid].k, cur = ((s.k.st || {})[fid] || {}).r || '';
    const list = [['', 'おまかせ（足りない物から）']].concat(Object.keys(s.known).filter((r) => s.known[r] && sim.recipe(s, r) && (k !== 'line' || s.menu[r])).map((r) => [r, sim.recipe(s, r).name + (s.menu[r] && s.menu[r].on ? '' : '（メニュー外）')]));
    const html = `<p class="muted small" style="margin:0 0 8px">${k === 'line' ? '投入口に入れた材料から、選んだケーキを作り続けます。' : 'のせたスポンジとクリームで、選んだケーキに仕上げます。'}</p><div class="pick">${list.map(([r, n]) => `<button data-pick="${r || '-'}" aria-pressed="${cur === r}">${esc(n)}</button>`).join('')}</div>`;
    const v = await UI.choose(CS.plan.KINDS[k].name + '：作るケーキ', html, '[data-pick]');
    if (v == null) return;
    CS.sound.play('tap'); act({ t: 'amode', fid, r: v === '-' ? '' : v });
  };
  // ---------- アルバイト ----------
  game.renderStaff = function (body, s) {
    const SL = sim.shopLevel(s).lv, T = D.STAFF.tasks;
    const optSel = (st, i) => {
      const o = T[st.task].opt; if (!o) return '';
      const P = CS.plan, fname = (fid) => { const k = s.fu[fid].k, same = P.list(s, k); return P.KINDS[k].name + (same.length > 1 ? (same.indexOf(fid) + 1) : ''); };
      const list = o === 'base' ? Object.keys(D.BASES).filter((k) => Object.keys(D.BASES[k].ing).every((x) => sim.ingUnlocked(s, x))).map((k) => [k, D.BASES[k].name])
        : o === 'cream' ? Object.keys(D.CREAMS).filter((k) => k !== 'none' && Object.keys(D.CREAMS[k].ing).every((x) => sim.ingUnlocked(s, x))).map((k) => [k, D.CREAMS[k].name])
        : o === 'place' ? ['crack', 'cshelf', 'shelf', 'table'].reduce((a, k) => a.concat(P.list(s, k).map((f) => [f, fname(f) + (k === 'crack' ? '（段ボールのまま）' : '')])), [])
        : Object.keys(s.known).filter((k) => s.menu[k]).map((k) => [k, sim.recipe(s, k).name]);
      const lbl = o === 'place' ? '運ぶ場所' : '作るもの', auto = o === 'place' ? 'おまかせ（要冷蔵は冷蔵棚・ほかは棚）' : 'おまかせ（足りない物）';
      return `<label class="small">${lbl} <select data-sopt="${i}"><option value="">${auto}</option>${list.map(([k, n]) => `<option value="${k}" ${st.opt === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
    };
    const stars = (sp) => '★'.repeat(Math.max(1, Math.min(5, Math.round((sp - 0.7) / 0.15)))) + '☆'.repeat(5 - Math.max(1, Math.min(5, Math.round((sp - 0.7) / 0.15))));
    body.innerHTML = `<div class="banner sky">${ic('user')}<span>アルバイトは1人1つの業務を担当（最大8人。店舗Lv2から雇える）。人によって<b>手際</b>がちがい、作業の速さが変わります。働くほどレベルが上がって速く・上手に。「お菓子係」は作るお菓子を指定でき、生地から仕上げまで1人で作ります。「仕入れ係」はトラックの段ボールを指定の場所へ運びます。「機械係」は店の横の倉庫まで材料を取りに行って自動の機械にセットし、できた物を次の機械やショーケースへ運びます。日給は閉店時に支払い。</span></div><div class="list">${D.STAFF.slots.map((sl, i) => {
      const st = s.staff[i];
      if (!st) {
        const lock = SL < sl.lv, sp = D.STAFF.speed[sl.start - 1] * (sl.sp || 1);
        return `<div class="card staff ${lock ? 'locked' : ''}"><div class="sf-pic">${lock ? ic('lock') : CS.models.img(CS.models.thumb.face(Object.assign({}, D.DEFAULT_SKIN, sl.skin)), 'thumb')}</div><div class="mid"><b>${lock ? '？？？' : esc(sl.name)} <small class="muted">${i + 1}人目</small></b><small>${lock ? '店舗Lv' + sl.lv + ' で募集できます' : `Lv${sl.start}・手際 <span class="stars">${stars(sl.sp || 1)}</span>・作業スピード ${Math.round(sp * 100)}%・日給 ${yen(D.STAFF.wage(sl.start, sl.sp))}`}</small></div>${lock ? '' : `<button class="btn sm pink" data-hire="${i}">${ic('plus')} 雇う</button>`}</div>`;
      }
      const sp = D.STAFF.speed[st.lv - 1] * (st.sp || 1), nx = D.STAFF.xp[st.lv];
      return `<div class="card staff"><div class="sf-pic">${CS.models.img(CS.models.thumb.face(Object.assign({}, D.DEFAULT_SKIN, st.skin)), 'thumb')}</div><div class="mid" style="display:grid;gap:4px">
          <b>${esc(st.name)} <span class="chip ok">Lv${st.lv}</span> <small class="muted">手際 <span class="stars">${stars(st.sp || 1)}</span>・日給 ${yen(D.STAFF.wage(st.lv, st.sp))}</small></b>
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
  // ---------- パソコン：家具・道具（厨房の家具は買ったあと「配置」で好きな場所に動かせる） ----------
  game.renderFurn = function (body, s) {
    const SL = sim.shopLevel(s).lv, P = CS.plan;
    const cnt = (t, cond) => Object.values(s.k.items).filter((it) => it.t === t && (!cond || cond(it))).length;
    const furnRow = (k) => {
      const K2 = P.KINDS[k], n = P.count(s, k), pn = (s.k.pend || []).filter((x) => x === k).length + Object.values(s.k.items).filter((it) => it.t === 'fcrate' && it.k === k).length, lock = K2.lv && SL < K2.lv;
      const btn = lock ? `<span class="chip">${ic('lock')} Lv${K2.lv}</span>` : `<button class="btn sm pink num" data-fbuy="${k}" ${s.funds >= K2.price ? '' : 'disabled'}>${yen(K2.price)}</button>`;
      return `<div class="card upg ${lock ? 'locked' : ''}"><div class="ico">${ic(lock ? 'lock' : K2.icon)}</div><div style="min-width:0;display:grid;gap:2px"><b>${esc(K2.name)} <small class="muted">${n}台${pn ? '・配達／展開待ち ' + pn : ''}</small>${K2.cold ? ` <span class="chip cold">${ic('snow')} 冷蔵</span>` : ''}${K2.auto ? ' <span class="chip auto">自動</span>' : ''}</b><span class="small muted">${esc(K2.desc)}${lock ? `（店舗Lv${K2.lv}で買えるようになります・${yen(K2.price)}）` : ''}</span></div>${btn}</div>`;
    };
    const keys = Object.keys(P.KINDS).filter((k) => !P.KINDS[k].hide);
    const kitchen = keys.filter((k) => !P.KINDS[k].auto).map(furnRow).join('');
    const autos = keys.filter((k) => P.KINDS[k].auto).sort((a, b) => (P.KINDS[a].lv || 0) - (P.KINDS[b].lv || 0)).map(furnRow).join('');
    const tools = Object.keys(P.TOOLS).map((k) => {
      const T2 = P.TOOLS[k], n = cnt(k), u = k === 'plate' ? '枚' : k === 'knife' ? '本' : '個';
      return `<div class="card upg"><div class="ico">${ic(T2.icon)}</div><div style="min-width:0;display:grid;gap:2px"><b>${esc(T2.name)} <small class="muted">${n}${u}</small></b><span class="small muted">${esc(T2.desc)}（1回で1${u}。空いている棚に置かれます）</span></div><button class="btn sm yellow num" data-tbuy="${k}" ${s.funds >= T2.price ? '' : 'disabled'}>${yen(T2.price)}</button></div>`;
    }).join('');
    const hall = Object.keys(D.FURN).map((id) => {
      const f = D.FURN[id], n = (s.furn && s.furn[id]) || 0, mx = sim.furnMax(s, id), lock = SL < f.lv;
      const btn = lock ? `<span class="chip">${ic('lock')} Lv${f.lv}</span>` : n >= mx ? '<span class="chip ok">いっぱい</span>' : `<button class="btn sm yellow num" data-furn="${id}" ${s.funds >= f.price ? '' : 'disabled'}>${yen(f.price)}</button>`;
      return `<div class="card upg"><div class="ico">${ic(f.icon)}</div><div style="min-width:0;display:grid;gap:2px"><b>${esc(f.name)} <small class="muted">${n} / ${mx}</small></b><span class="small muted">${esc(f.desc)}${id === 'table' ? '（1台で2席。お皿も足りるように）' : ''}</span></div>${btn}</div>`;
    }).join('');
    body.innerHTML = `<div class="row between wrap"><span class="small">資金 <b class="num">${yen(s.funds)}</b></span><button class="btn sm mint" id="fu-build">${ic('move')} 配置モードにする</button></div>
      <h3 class="sec-h">厨房の家具</h3><p class="muted small" style="margin:0">買った家具は<b>トラックで大きな段ボール</b>に入って届きます（材料と同じトラック）。荷台の段ボールを持って、置きたい床をねらうと「ここに展開する」。置いたあとも<b>「配置」</b>ボタン（または <kbd>B</kbd>）でみんなで動かせます。</p><div class="list">${kitchen}</div>
      <h3 class="sec-h">自動の機械</h3><p class="muted small" style="margin:0">材料・型・クリームを<b>セットするだけ</b>で作業してくれる機械です（店舗レベルで解放）。アルバイトの<b>「機械係」</b>にすると、材料の補充やできた物の運び出しも任せられます。</p><div class="list">${autos}</div>
      <h3 class="sec-h">道具</h3><div class="list">${tools}</div>
      <h3 class="sec-h">売り場</h3><div class="list">${hall}</div>`;
    $$('[data-fbuy]', body).forEach((b) => (b.onclick = async () => { const K2 = P.KINDS[b.dataset.fbuy]; if (await UI.confirm(K2.name, `${yen(K2.price)} で買いますか？<br><small>${esc(K2.desc)}</small>`, '買う')) { CS.sound.play('coin'); act({ t: 'fbuy', k: b.dataset.fbuy, near: [CS.world.me.x, CS.world.me.z] }); } }));
    $$('[data-tbuy]', body).forEach((b) => (b.onclick = () => { CS.sound.play('coin'); act({ t: 'tbuy', k: b.dataset.tbuy }); }));
    $$('[data-furn]', body).forEach((b) => (b.onclick = () => { CS.sound.play('coin'); act({ t: 'buyFurn', id: b.dataset.furn }); }));
    $('#fu-build', body).onclick = () => { UI.closeSheet(); setTimeout(() => CS.world.setBuild(true), 50); };
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
      <div class="card"><div class="row between"><h3>販売する商品</h3>${amHost() ? '<span class="chip ok">ホストの端末</span>' : `<span class="chip">${ic('lock')} ホストだけが変更できます</span>`}</div>
        <p class="muted small" style="margin:0">OFF にした商品はお客さんに注文されません。値段はパソコンの「販売価格」かメニュー黒板で決めます。</p>
        <div class="list" id="ss-menu">${Object.keys(s.known).filter((rid) => s.menu[rid] && sim.recipe(s, rid)).map((rid) => { const rc = sim.recipe(s, rid); return `<div class="item"><div class="mid"><b>${esc(rc.name)}</b><small>${yen(s.menu[rid].price)}</small></div><div class="end"><label class="switch"><input type="checkbox" data-mon="${rid}" ${s.menu[rid].on ? 'checked' : ''} ${amHost() ? '' : 'disabled'} aria-label="${esc(rc.name)}を販売"><i></i></label></div></div>`; }).join('')}</div></div>
      <button class="btn wide" id="ss-tut">${ic('book')} 遊び方を見る</button>
      <button class="btn wide" id="ss-title">${ic('door')} タイトルにもどる</button>
      ${r.local ? '' : `<button class="btn ghost wide" id="ss-quit">このお店のメンバーから抜ける</button>`}
      <p class="muted small" style="margin:0">ホストの端末がお店の時間を進めます。ホストが抜けると、残っている人の端末が自動で引き継ぎます。全員いなくなるとお店の時間は止まります。</p>`;
    if (!r.local) { $('#ss-cc', body).onclick = () => UI.copy(r.code, $('#ss-code', body)); $('#ss-cl', body).onclick = () => UI.copy(link); }
    $$('[data-mon]', body).forEach((el) => (el.onchange = () => { if (!amHost()) { el.checked = !el.checked; UI.toast('ホストだけが変更できます', 'err'); return; } act({ t: 'menuOn', r: el.dataset.mon, on: el.checked }); CS.sound.play('tap'); }));
    $('#ss-tut', body).onclick = () => { UI.closeSheet(); game.tutorial(); };
    $('#ss-title', body).onclick = () => game.leave(false);
    const q = $('#ss-quit', body);
    if (q) q.onclick = async () => { if (await UI.confirm('メンバーから抜ける', '席が空き、ほかの人が参加できるようになります。お店はほかのメンバーが続けられます。', '抜ける', true)) game.leave(true); };
  };
  // =====================================================================
  //  クリームを塗る（指・マウスを押したまま、なぞって塗る。回転台はゆっくり回る）
  //  上面と側面をまんべんなく・厚さをそろえて・はみ出さないほど高得点
  // =====================================================================
  game.spreadMem = {};
  game.openSpread = function (fid) {
    const mg = $('#mg'); if (!mg || !mg.hidden) return;
    const s = S(); if (!s) return;
    const did = CS.kitchen.at(s, CS.kitchen.slot0(fid)), dk = did && s.k.items[did];
    if (!dk || dk.t !== 'deco') return;
    const hid = CS.kitchen.held(s, game.room.pid), held = hid && s.k.items[hid];
    const creamK = (held && held.t === 'cream' && held.k) || dk.cr || 'whip';
    const Bs = D.BASES[dk.b] || D.BASES.plain, tart = !!Bs.tart;
    const creamCol = (D.CREAMS[creamK] || {}).color || '#FFFDF7';
    if (document.pointerLockElement) document.exitPointerLock();
    mg.hidden = false; mg.className = 'spread-ov';
    mg.innerHTML = `<div class="sp-wrap panel"><canvas id="sp-cv" aria-label="ケーキ"></canvas>
      <div class="sp-side"><b class="sp-title">クリームを塗る</b><span class="small muted">画面を<b>押したまま</b>なぞって塗ろう。回転台はゆっくり回ります。上面と${tart ? '' : 'まわり（側面）を'}まんべんなく、はみ出さないように。</span>
        <div class="sp-m"><span>塗れた面積</span><i class="bar"><u id="sp-cov"></u></i><b id="sp-covn">0%</b></div>
        <div class="sp-m"><span>なめらかさ</span><i class="bar"><u id="sp-ev"></u></i><b id="sp-evn">-</b></div>
        <div class="sp-m"><span>はみ出し</span><i class="bar bad"><u id="sp-ms"></u></i><b id="sp-msn">0</b></div>
        <div class="sp-score">いまの点数 <b id="sp-q">0</b></div>
        <button class="btn big pink wide" id="sp-done">${ic('check')} 塗り終える</button>
        <button class="btn sm ghost" id="sp-later">あとで続ける</button></div></div>`;
    const cv = $('#sp-cv'), g = cv.getContext('2d');
    const size = Math.round(Math.min(innerHeight * 0.86, innerWidth * 0.6, 560)), dpr = Math.min(2, devicePixelRatio || 1);
    cv.style.width = cv.style.height = size + 'px'; cv.width = cv.height = Math.round(size * dpr);
    const W2 = cv.width, C0 = W2 / 2, Rr = W2 * 0.3, Rs = tart ? Rr : Rr * 1.24, Rm = Rr * 1.36;
    // 前回の続き（同じケーキ）
    const memKey = did + ':' + fid;
    const mem = game.spreadMem[memKey] || (game.spreadMem[memKey] = { N: 44, cnt: new Float32Array(44 * 44), mess: 0, layer: null, ang: 0 });
    const N = mem.N, cnt = mem.cnt;
    if (!mem.layer) { mem.layer = document.createElement('canvas'); mem.layer.width = mem.layer.height = W2; }
    const lay = mem.layer, lg = lay.getContext('2d');
    const cellR = (cx, cy) => { const x = ((cx + 0.5) / N) * 2 - 1, y = ((cy + 0.5) / N) * 2 - 1; return Math.hypot(x, y) * Rm; };
    const cells = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const r = cellR(x, y); if (r <= Rs) cells.push(y * N + x); }
    const rgbS = (h, a) => { const c = CS.gl.rgb(h); return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`; };
    const brush = Rr * 0.13;
    let down = false, px = 0, py = 0, last = null, dead = false;
    // 画面座標 → ケーキの座標（回転を戻す）
    const toLocal = (x, y) => { const dx = x - C0, dy = y - C0, a = -mem.ang; return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)]; };
    const stamp = (lx, ly) => {
      const r = Math.hypot(lx, ly);
      if (r > Rs * 1.06) { mem.mess += 1; }
      // 当たり判定の格子
      const gx0 = Math.floor(((lx - brush) / Rm + 1) / 2 * N), gx1 = Math.floor(((lx + brush) / Rm + 1) / 2 * N), gy0 = Math.floor(((ly - brush) / Rm + 1) / 2 * N), gy1 = Math.floor(((ly + brush) / Rm + 1) / 2 * N);
      for (let y = Math.max(0, gy0); y <= Math.min(N - 1, gy1); y++) for (let x = Math.max(0, gx0); x <= Math.min(N - 1, gx1); x++) {
        const cx = (((x + 0.5) / N) * 2 - 1) * Rm, cy = (((y + 0.5) / N) * 2 - 1) * Rm;
        const d = Math.hypot(cx - lx, cy - ly); if (d < brush) cnt[y * N + x] = Math.min(9, cnt[y * N + x] + 0.35 * (1 - d / brush) + 0.12);
      }
      // 見た目（クリームの層に重ねる）
      const gr = lg.createRadialGradient(C0 + lx, C0 + ly, 0, C0 + lx, C0 + ly, brush);
      gr.addColorStop(0, rgbS(creamCol, 0.5)); gr.addColorStop(0.7, rgbS(creamCol, 0.32)); gr.addColorStop(1, rgbS(creamCol, 0));
      lg.fillStyle = gr; lg.beginPath(); lg.arc(C0 + lx, C0 + ly, brush, 0, Math.PI * 2); lg.fill();
    };
    const paintTo = (x, y) => {
      const p = toLocal(x, y);
      if (last) { const dx = p[0] - last[0], dy = p[1] - last[1], d = Math.hypot(dx, dy), n = Math.max(1, Math.ceil(d / (brush * 0.35))); for (let k = 1; k <= n; k++) stamp(last[0] + (dx * k) / n, last[1] + (dy * k) / n); }
      else stamp(p[0], p[1]);
      last = p;
    };
    const score = () => {
      let cov = 0, sum = 0, sum2 = 0, n = 0;
      cells.forEach((c) => { const v = cnt[c]; if (v >= 0.6) { cov++; const t = Math.min(v, 6); sum += t; sum2 += t * t; n++; } });
      const covF = cov / cells.length, mean = n ? sum / n : 0, sd = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0;
      const even = n ? clamp(1 - (sd / Math.max(0.5, mean)) * 0.8, 0, 1) : 0;
      const messF = clamp(mem.mess / 260, 0, 1);
      const q = clamp(Math.pow(covF, 1.5) * (0.55 + 0.45 * even) - messF * 0.35, 0, 1);
      return { covF, even, messF, q };
    };
    const draw = () => {
      g.clearRect(0, 0, W2, W2);
      // 回転台・お皿
      g.fillStyle = '#C9CDD2'; g.beginPath(); g.arc(C0, C0, Rm * 1.06, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#F4F2EE'; g.beginPath(); g.arc(C0, C0, Rm * 0.98, 0, Math.PI * 2); g.fill();
      g.save(); g.translate(C0, C0); g.rotate(mem.ang); g.translate(-C0, -C0);
      // スポンジ（側面＝外側の輪、上面＝内側）
      if (!tart) { g.fillStyle = Bs.crumb || '#C98D45'; g.beginPath(); g.arc(C0, C0, Rs, 0, Math.PI * 2); g.fill(); for (let k = 0; k < 36; k++) { const a = (k / 36) * Math.PI * 2; g.strokeStyle = 'rgba(0,0,0,.06)'; g.lineWidth = W2 * 0.004; g.beginPath(); g.moveTo(C0 + Math.cos(a) * Rr, C0 + Math.sin(a) * Rr); g.lineTo(C0 + Math.cos(a) * Rs, C0 + Math.sin(a) * Rs); g.stroke(); } }
      g.fillStyle = Bs.color || '#EFC77C'; g.beginPath(); g.arc(C0, C0, Rr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = W2 * 0.004; g.beginPath(); g.arc(C0, C0, Rr, 0, Math.PI * 2); g.stroke();
      g.drawImage(lay, 0, 0);
      g.restore();
      // ガイド（側面の境目）
      if (!tart) { g.setLineDash([W2 * 0.01, W2 * 0.012]); g.strokeStyle = 'rgba(120,100,80,.35)'; g.lineWidth = W2 * 0.003; g.beginPath(); g.arc(C0, C0, Rs, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
      // 指（パレットナイフ）
      if (down) { g.fillStyle = 'rgba(220,224,228,.9)'; g.strokeStyle = 'rgba(80,80,80,.5)'; g.lineWidth = 2; g.beginPath(); g.ellipse(px, py, brush * 0.95, brush * 0.35, 0.6, 0, Math.PI * 2); g.fill(); g.stroke(); }
      const sc = score();
      $('#sp-cov').style.width = Math.round(sc.covF * 100) + '%'; $('#sp-covn').textContent = Math.round(sc.covF * 100) + '%';
      $('#sp-ev').style.width = Math.round(sc.even * 100) + '%'; $('#sp-evn').textContent = sc.covF > 0.05 ? Math.round(sc.even * 100) + '%' : '-';
      $('#sp-ms').style.width = Math.round(sc.messF * 100) + '%'; $('#sp-msn').textContent = Math.round(sc.messF * 100) + '%';
      $('#sp-q').textContent = Math.round(sc.q * 100);
    };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W2, ((e.clientY - r.top) / r.height) * W2]; };
    cv.addEventListener('pointerdown', (e) => { e.preventDefault(); down = true; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } [px, py] = pos(e); last = null; paintTo(px, py); });
    cv.addEventListener('pointermove', (e) => { if (!down) return; [px, py] = pos(e); paintTo(px, py); });
    const up = () => { down = false; last = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    let t0 = performance.now(), opened = performance.now();
    const close = () => { dead = true; mg.hidden = true; mg.innerHTML = ''; mg.className = ''; };
    const loop = () => {
      if (dead) return;
      try {
        if (!game.room || !mg.isConnected || mg.hidden) { close(); return; }
        const now = performance.now(), dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
        if (down) { mem.ang += dt * 0.9; last = null; paintTo(px, py); }
        draw();
        // ほかの人に取られた・終わっていたら閉じる
        const s2 = S(), b = s2 && s2.k.st[fid];
        if (now - opened > 3000 && (!b || b.st !== 'spread' || b.by !== game.room.pid)) { close(); if (b && b.st === 'spread') UI.toast('ほかの人が塗っています', 'err'); return; }
      } catch (e) { console.error('[spread]', e); close(); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    $('#sp-done').onclick = () => { const sc = score(); act({ t: 'spreadDone', fid, q: Math.round(sc.q * 100) / 100 }); delete game.spreadMem[memKey]; CS.sound.play(sc.q > 0.8 ? 'ok' : 'tap'); close(); };
    $('#sp-later').onclick = () => close();
  };

  // =====================================================================
  //  洗い物：流しのお皿・型を、押したままこすって泡立てる → 「水を出す」で流す
  // =====================================================================
  game.openWash = async function (fid) {
    const mg = $('#mg'); if (!mg || !mg.hidden) return;
    const s = S(); if (!s) return;
    const K = CS.kitchen, id = K.at(s, K.slot0(fid)), it = id && s.k.items[id];
    if (!it || !it.dirty) return;
    const r0 = await act({ t: 'washStart', fid }); if (r0 && r0.ok === false) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const plate = it.t === 'plate';
    mg.hidden = false; mg.className = 'spread-ov';
    mg.innerHTML = `<div class="sp-wrap panel"><canvas id="ws-cv" aria-label="${plate ? 'お皿' : 'ケーキ型'}"></canvas>
      <div class="sp-side"><b class="sp-title">${plate ? 'お皿' : 'ケーキ型'}を洗う</b><span class="small muted">スポンジで<b>押したまま</b>こすって、汚れのところを泡だらけにしよう。泡立ったら「水を出す」で流す → 棚か水切りかごに置くと30秒で乾きます。</span>
        <div class="sp-m"><span>泡</span><i class="bar"><u id="ws-f"></u></i><b id="ws-fn">0%</b></div>
        <div class="sp-m"><span>汚れ</span><i class="bar bad"><u id="ws-d"></u></i><b id="ws-dn">100%</b></div>
        <button class="btn big pink wide" id="ws-rinse" disabled>💧 水を出す</button>
        <button class="btn sm ghost" id="ws-x">やめる</button></div></div>`;
    const cv = $('#ws-cv'), g = cv.getContext('2d');
    const size = Math.round(Math.min(innerHeight * 0.86, innerWidth * 0.58, 520)), dpr = Math.min(2, devicePixelRatio || 1);
    cv.style.width = cv.style.height = size + 'px'; cv.width = cv.height = Math.round(size * dpr);
    const W2 = cv.width, C0 = W2 / 2, Rp = W2 * 0.42, N = 34;
    const dirt = new Float32Array(N * N), foam = new Float32Array(N * N), inside = [];
    const cellXY = (i) => [(((i % N) + 0.5) / N) * 2 - 1, ((Math.floor(i / N) + 0.5) / N) * 2 - 1];
    for (let i = 0; i < N * N; i++) { const [x, y] = cellXY(i); if (Math.hypot(x, y) < 0.92) inside.push(i); }
    // 汚れ（クリームやスポンジのかす）
    const blobs = []; for (let k = 0; k < 9; k++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.6; blobs.push([Math.cos(a) * rr, Math.sin(a) * rr, 0.14 + Math.random() * 0.16, Math.random() < 0.5 ? '#B98A55' : '#E8D9B5']); }
    inside.forEach((i) => { const [x, y] = cellXY(i); for (const b of blobs) if (Math.hypot(x - b[0], y - b[1]) < b[2]) dirt[i] = 1; });
    const dirtyCells = inside.filter((i) => dirt[i] > 0);
    const brush = 0.15;
    let down = false, px = 0, py = 0, last = null, dead = false, rinse = 0;
    const stamp = (lx, ly) => {
      const gx0 = Math.floor(((lx - brush) + 1) / 2 * N), gx1 = Math.floor(((lx + brush) + 1) / 2 * N), gy0 = Math.floor(((ly - brush) + 1) / 2 * N), gy1 = Math.floor(((ly + brush) + 1) / 2 * N);
      for (let y = Math.max(0, gy0); y <= Math.min(N - 1, gy1); y++) for (let x = Math.max(0, gx0); x <= Math.min(N - 1, gx1); x++) {
        const i = y * N + x, [cx, cy] = cellXY(i), d = Math.hypot(cx - lx, cy - ly);
        if (d < brush) foam[i] = Math.min(1, foam[i] + 0.09 * (1 - d / brush) + 0.02);
      }
    };
    const toLocal = (x, y) => [(x - C0) / Rp, (y - C0) / Rp];
    const paintTo = (x, y) => { const p = toLocal(x, y); if (last) { const dx = p[0] - last[0], dy = p[1] - last[1], d = Math.hypot(dx, dy), n = Math.max(1, Math.ceil(d / (brush * 0.35))); for (let k = 1; k <= n; k++) stamp(last[0] + (dx * k) / n, last[1] + (dy * k) / n); } else stamp(p[0], p[1]); last = p; };
    const score = () => {
      let fc = 0; inside.forEach((i) => { if (foam[i] > 0.5) fc++; });
      let ok = 0; dirtyCells.forEach((i) => { if (foam[i] >= 0.6) ok++; });
      return { foam: fc / inside.length, q: dirtyCells.length ? ok / dirtyCells.length : 1 };
    };
    const draw = (now) => {
      g.clearRect(0, 0, W2, W2);
      // 流し
      g.fillStyle = '#7E848A'; g.fillRect(0, 0, W2, W2);
      g.fillStyle = 'rgba(255,255,255,.06)'; for (let k = 0; k < 12; k++) g.fillRect(0, (k / 12) * W2, W2, W2 * 0.004);
      // お皿・型
      if (plate) { g.fillStyle = '#F7F5F0'; g.beginPath(); g.arc(C0, C0, Rp, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#C9A96E'; g.lineWidth = W2 * 0.012; g.beginPath(); g.arc(C0, C0, Rp * 0.95, 0, Math.PI * 2); g.stroke(); g.strokeStyle = 'rgba(0,0,0,.06)'; g.lineWidth = W2 * 0.006; g.beginPath(); g.arc(C0, C0, Rp * 0.62, 0, Math.PI * 2); g.stroke(); }
      else { g.fillStyle = '#A6ACB2'; g.beginPath(); g.arc(C0, C0, Rp, 0, Math.PI * 2); g.fill(); g.fillStyle = '#B9BEC4'; g.beginPath(); g.arc(C0, C0, Rp * 0.9, 0, Math.PI * 2); g.fill(); }
      // 汚れ（流したあとは消える）
      if (rinse < 1) { g.globalAlpha = 1 - rinse; blobs.forEach((b) => { g.fillStyle = b[3]; g.beginPath(); g.arc(C0 + b[0] * Rp, C0 + b[1] * Rp, b[2] * Rp, 0, Math.PI * 2); g.fill(); }); g.globalAlpha = 1; }
      // 泡
      const fa = rinse ? Math.max(0, 1 - rinse * 1.4) : 1;
      if (fa > 0) inside.forEach((i) => { const f = foam[i]; if (f < 0.08) return; const [x, y] = cellXY(i); const j = ((i * 7919) % 97) / 97; g.fillStyle = `rgba(255,255,255,${(0.35 + f * 0.6) * fa})`; g.beginPath(); g.arc(C0 + (x + (j - 0.5) * 0.05) * Rp, C0 + (y + (((i * 104729) % 89) / 89 - 0.5) * 0.05) * Rp, Rp * (0.03 + f * 0.035), 0, Math.PI * 2); g.fill(); });
      // 水
      if (rinse) { g.fillStyle = 'rgba(190,225,245,.35)'; g.fillRect(C0 - W2 * 0.04, 0, W2 * 0.08, W2); g.fillStyle = 'rgba(190,225,245,.18)'; g.beginPath(); g.arc(C0, C0, Rp * (0.3 + rinse * 0.7), 0, Math.PI * 2); g.fill(); }
      // スポンジ
      if (down && !rinse) { g.fillStyle = '#F2D16B'; g.strokeStyle = 'rgba(80,60,20,.5)'; g.lineWidth = 2; g.beginPath(); g.roundRect ? g.roundRect(px - W2 * 0.06, py - W2 * 0.04, W2 * 0.12, W2 * 0.08, W2 * 0.015) : g.rect(px - W2 * 0.06, py - W2 * 0.04, W2 * 0.12, W2 * 0.08); g.fill(); g.stroke(); }
      const sc = score();
      $('#ws-f').style.width = Math.round(sc.foam * 100) + '%'; $('#ws-fn').textContent = Math.round(sc.foam * 100) + '%';
      const dl = rinse ? 0 : 1 - sc.q; $('#ws-d').style.width = Math.round(dl * 100) + '%'; $('#ws-dn').textContent = Math.round(dl * 100) + '%';
      const btn = $('#ws-rinse'); const can = sc.q >= 0.6 && !rinse; if (btn.disabled === can) btn.disabled = !can;
      CS.world.foamLv = sc.foam;
      return sc;
    };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W2, ((e.clientY - r.top) / r.height) * W2]; };
    cv.addEventListener('pointerdown', (e) => { if (rinse) return; e.preventDefault(); down = true; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } [px, py] = pos(e); last = null; paintTo(px, py); });
    cv.addEventListener('pointermove', (e) => { if (!down || rinse) return; [px, py] = pos(e); paintTo(px, py); if (Math.random() < 0.08) CS.sound.play('tap'); });
    const up = () => { down = false; last = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    const opened = performance.now();
    let ping = opened;
    CS.world.washing = fid;
    const close = () => { dead = true; mg.hidden = true; mg.innerHTML = ''; mg.className = ''; if (CS.world.washing === fid) CS.world.washing = null; if (CS.world.rinse === fid) CS.world.rinse = null; CS.world.foamLv = 0; };
    const loop = () => {
      if (dead) return;
      try {
        if (!game.room || !mg.isConnected || mg.hidden) { close(); return; }
        const now = performance.now();
        if (rinse) rinse = Math.min(1, (now - rinse0) / 1300) || 0.001;
        if (now - ping > 30000) { ping = now; act({ t: 'washStart', fid }); } // 洗っているあいだは流しを使用中にしておく
        const sc = draw(now);
        if (rinse >= 1) { act({ t: 'wash', fid, q: Math.round(sc.q * 100) / 100 }); CS.sound.play('ok'); close(); return; }
        const s2 = S(), b = s2 && s2.k.st[fid], cur = s2 && K.at(s2, K.slot0(fid));
        if (now - opened > 2500 && (!b || b.by !== game.room.pid || cur !== id)) { close(); return; }
      } catch (e) { console.error('[wash]', e); close(); return; }
      requestAnimationFrame(loop);
    };
    let rinse0 = 0;
    requestAnimationFrame(loop);
    $('#ws-rinse').onclick = () => { if (rinse) return; rinse0 = performance.now(); rinse = 0.001; CS.world.rinse = fid; CS.sound.play('pop'); };
    $('#ws-x').onclick = () => { act({ t: 'wash', fid, q: 0 }); close(); };
  };

  // =====================================================================
  //  お会計（現金）：お釣りの硬貨・お札をえらんで渡す（足りないと渡せない）
  // =====================================================================
  const MONEY = [5000, 1000, 500, 100, 50, 10, 5, 1];
  game.openChange = function (cid) {
    const mg = $('#mg'); if (!mg || !mg.hidden) return;
    const s = S(); if (!s) return;
    const c = s.cust[cid]; if (!c || c.st !== 'pay') return;
    if (c.pm === 'card') { act({ t: 'pay', c: cid }); return; }
    if (document.pointerLockElement) document.exitPointerLock();
    const need = CS.kitchen.change(c), pick = [];
    mg.hidden = false; mg.className = 'spread-ov';
    const coin = (v) => `<button class="money ${v >= 1000 ? 'mbill' : 'mcoin'} m${v}" data-m="${v}" aria-label="${v}円">${v >= 1000 ? `<b>${v}</b><small>円</small>` : `<b>${v}</b>`}</button>`;
    mg.innerHTML = `<div class="panel chg-wrap">
      <div class="chg-head"><div><small>お会計</small><b class="num">${yen(c.due)}</b></div><div><small>お預かり（現金）</small><b class="num">${yen(c.tend)}</b></div><div class="hl"><small>お釣り</small><b class="num">${yen(need)}</b></div></div>
      <div class="chg-tray" id="cg-tray" aria-live="polite"></div>
      <div class="chg-sum"><span>渡すお釣り</span><b class="num" id="cg-sum">¥0</b><small id="cg-msg"></small></div>
      <div class="chg-money">${MONEY.map(coin).join('')}</div>
      <div class="row wrap" style="justify-content:center;gap:8px"><button class="btn sm ghost" id="cg-undo">${ic('back')} 1つ戻す</button><button class="btn sm ghost" id="cg-clear">クリア</button><button class="btn sm ghost" id="cg-x">${ic('close')} とじる</button></div>
      <button class="btn big pink wide" id="cg-ok">${need ? 'お釣りを渡す' : 'ちょうどお預かり・お会計する'}</button></div>`;
    const upd = () => {
      const sum = pick.reduce((a, x) => a + x, 0);
      $('#cg-sum').textContent = yen(sum);
      $('#cg-tray').innerHTML = pick.length ? pick.map((v) => `<i class="money ${v >= 1000 ? 'mbill' : 'mcoin'} m${v} sm"><b>${v}</b></i>`).join('') : '<span class="muted small">下のお金をタップしてトレーにのせよう</span>';
      const msg = $('#cg-msg'), ok = $('#cg-ok');
      if (sum < need) { msg.textContent = 'あと ' + yen(need - sum) + ' 足りない'; msg.className = 'neg'; ok.disabled = true; }
      else if (sum > need) { msg.textContent = yen(sum - need) + ' 多い（損をします）'; msg.className = 'warn'; ok.disabled = false; }
      else { msg.textContent = need ? 'ぴったり！' : ''; msg.className = 'pos'; ok.disabled = false; }
    };
    $$('[data-m]', mg).forEach((b) => (b.onclick = () => { if (pick.length >= 30) return; pick.push(+b.dataset.m); CS.sound.play('coin'); upd(); }));
    $('#cg-undo').onclick = () => { pick.pop(); CS.sound.play('tap'); upd(); };
    $('#cg-clear').onclick = () => { pick.length = 0; upd(); };
    let dead = false;
    const close = () => { dead = true; mg.hidden = true; mg.innerHTML = ''; mg.className = ''; };
    $('#cg-x').onclick = close;
    $('#cg-ok').onclick = async () => {
      const sum = pick.reduce((a, x) => a + x, 0); if (sum < need) return;
      const r = await act({ t: 'pay', c: cid, ch: sum });
      if (!r || r.ok !== false) close();
    };
    upd();
    const watch = () => { if (dead) return; const s2 = S(), c2 = s2 && s2.cust[cid]; if (!game.room || !mg.isConnected || !c2 || c2.st !== 'pay') { close(); return; } setTimeout(watch, 400); };
    setTimeout(watch, 400);
  };

  // ---------- チュートリアル（お店ごと。買い物 → 作る → 並べる → 接客 → お会計まで。3D の目印つき） ----------
  const items = (s) => Object.values(s.k.items);
  const PL = () => CS.plan;
  const fid1 = (s, k) => PL().list(s, k)[0];
  const cntK = (s, k) => PL().count(s, k);
  const ordered = (s, k) => cntK(s, k) > 0 || (s.k.pend || []).includes(k) || items(s).some((it) => it.t === 'fcrate' && it.k === k);
  const onF = (it) => String(it.at).startsWith('f:');
  const dist2 = (id) => { const o = CS.world.items[id], m = CS.world.me; if (!o || !m) return 0; return Math.hypot(o.n.p[0] - m.x, o.n.p[2] - m.z); };
  // 条件に合う物（いちばん近い物）の ID
  function nearItem(s, f) { let best = null, bd = 1e9; for (const id in s.k.items) { const it = s.k.items[id]; if (!f(it, id)) continue; const d = dist2(id); if (d < bd) { bd = d; best = id; } } return best; }
  const ingAt = (s, k) => nearItem(s, (it) => it.t === 'ing' && it.ing === k && onF(it) && (it.sp || 0) < 2 && !it.res);
  const nmI = (k) => (D.ING[k] || {}).name || k;
  // 材料を順に入れる設備（ミキサー・クリーム台）の次の材料
  function nextIng(b, need, order) { const c = {}; (b.ings || []).forEach((k) => (c[k] = (c[k] || 0) + 1)); for (const k of order) if ((c[k] || 0) < need[k]) return { k, left: need[k] - (c[k] || 0) }; return null; }
  function bowlStep(s, ctx, kind, need, order, word) {
    const fid = PL().list(s, kind === 'mix' ? 'mixer' : 'whip').map((f) => [f, s.k.st[f] || {}]).sort((a, b) => (b[1].ings || []).length - (a[1].ings || []).length)[0];
    if (!fid) return { d: '', g: null };
    const [f, b] = fid;
    if (b.st === 'run') return { d: 'ゲージが緑のところで「止める」', g: { fid: f, label: '緑で止める' } };
    if (b.st === 'done') return { d: '', g: { fid: f, label: word } };
    const nx = nextIng(b, need, order);
    if (!nx) return { d: '材料がそろった！ねらって「回す」（使うボタン）', g: { fid: f, label: '回す' } };
    const h = ctx.held;
    if (h && h.t === 'ing' && h.ing === nx.k) return { d: '「' + nmI(nx.k) + '」をあと' + nx.left + 'つ入れる（長押しで続けて）', g: { fid: f, label: nmI(nx.k) + 'を入れる' } };
    if (h) return { d: '手に持っている物を置いてから、「' + nmI(nx.k) + '」を取りにいこう', g: null };
    const at = ingAt(s, nx.k);
    return { d: '次は「' + nmI(nx.k) + '」×' + nx.left + '（棚から取る）', g: at ? { item: at, label: nmI(nx.k) } : null, miss: !at && nx.k };
  }
  const BASE = () => D.BASES[D.RECIPES.short.base], CRM = () => D.CREAMS[D.RECIPES.short.cream];
  const waitC = (s) => Object.keys(s.cust).filter((id) => s.cust[id].st === 'w').sort((a, b) => (s.cust[a].no || 0) - (s.cust[b].no || 0))[0];
  const sold = (s) => (s.today.sold || 0) > 0 || s.history.length > 0;
  const TUT = [
    { id: 'pc', t: 'パソコンへ行く', d: '奥の「パソコン室」に入って、パソコンをねらって「パソコンを使う」（パソコンの場所はピンクの目印）', ok: (s) => game._tutPc || ordered(s, 'oven') || ordered(s, 'mixer') || sold(s), g: () => ({ pc: 1, label: 'パソコン' }) },
    { id: 'buy', t: 'オーブン・ミキサー台・デコ台を買う', d: 'パソコンの「家具・道具」で3つとも買う。家具はトラックで大きな段ボールに入って届きます', ok: (s) => (ordered(s, 'oven') && ordered(s, 'mixer') && ordered(s, 'deco')) || sold(s), g: () => ({ pc: 1, label: 'パソコン（家具・道具）' }) },
    { id: 'order', t: '材料とケーキの箱を注文する', d: 'パソコンの「材料の注文」→「販売中メニューに足りない分」でカートに入れて「発送」。家具と同じトラックに積んでくれます', ok: (s) => (s.today.buy || 0) > 0 || items(s).some((it) => it.t === 'crate' || (it.t === 'ing' && it.ing !== 'box')) || sold(s), g: () => ({ pc: 1, label: 'パソコン（材料の注文）' }) },
    {
      id: 'unpack', t: '大きな段ボールを展開して家具を置く', ok: (s) => (cntK(s, 'oven') > 0 && cntK(s, 'mixer') > 0 && cntK(s, 'deco') > 0) || sold(s),
      d: (s, c) => (c.held && c.held.t === 'fcrate' ? '置きたい床をねらって「ここに展開する」（向きは「使う」で回す）。置く場所は自由！' : (s.k.pend || []).length && s.k.truck && !(c.now < s.k.truck.at) ? 'いまのトラックの段ボールを全部下ろすとトラックが帰り、次の便で家具が届きます' : s.k.truck ? 'トラックが着いたら倉庫の裏口から外へ。荷台の横の大きな段ボールを持つ' : 'トラックを待っています（パソコンで買った家具が届きます）'),
      g: (s, c) => { if (c.held && c.held.t === 'fcrate') return null; const id = nearItem(s, (it) => it.t === 'fcrate' && String(it.at).startsWith('dl:')); const tk = s.k.truck; if (id && tk && !(c.now < tk.at)) return { item: id, label: '大きな段ボール' }; return tk ? { truck: 1, label: 'トラック' + (c.now < tk.at ? '（到着まで ' + Math.ceil((tk.at - c.now) / 1000) + '秒）' : '') } : null; },
    },
    {
      id: 'stock', t: '材料の段ボールを棚に並べる', ok: (s) => (!items(s).some((it) => it.t === 'crate' && it.n > 0) && ((s.today.shelved || 0) > 0 || Object.keys(BASE().ing).every((k) => sim.invCount(s, k) > 0))) || sold(s),
      d: (s, c) => { const h = c.held; if (h && h.t === 'crate') return !h.open ? '「段ボールを開ける」（使うボタン）' : (D.ING[h.ing] && D.ING[h.ing].cold ? '「' + nmI(h.ing) + '」は要冷蔵。冷蔵棚の空いている所に「置けるだけ置く」' : '棚の空いている所に「置けるだけ置く」') + '（1枠10個まで。空の段ボールはゴミ箱か床へ）'; return '荷台の段ボールを持って、棚まで運ぶ（段ボールは棚には入らないので、開けて中身を並べる）。卵・乳製品・いちごは冷蔵棚へ。運びきれないときは床に置いておける'; },
      g: (s, c) => {
        const h = c.held;
        if (h && h.t === 'crate') {
          if (!(h.n > 0)) return { fid: fid1(s, 'trash'), label: 'ゴミ箱' };
          const cold = D.ING[h.ing] && D.ING[h.ing].cold, kinds = cold ? ['cshelf'] : ['shelf', 'cshelf'];
          for (const k of kinds) for (const f of PL().list(s, k)) for (const sl of PL().slots(s, f)) { const ex = CS.kitchen.inSlot(s, sl).map((x) => s.k.items[x]); if (!ex.length || (ex[0].t === 'ing' && ex[0].ing === h.ing && ex[0].n < CS.kitchen.STACK_CAP.ing)) return { at: sl, label: cold ? '冷蔵棚' : '棚' }; }
          return null;
        }
        const id = nearItem(s, (it) => it.t === 'crate' && it.n > 0 && !(String(it.at).startsWith('dl:') && s.k.truck && c.now < s.k.truck.at)); if (id) return { item: id, label: '段ボール' };
        return s.k.truck ? { truck: 1, label: 'トラック' } : null;
      },
    },
    {
      id: 'mix', t: 'ミキサーで生地を作る', memo: 'short', ok: (s) => Object.keys(s.k.st).some((f) => s.fu[f] && s.fu[f].k === 'mixer' && s.k.st[f].st === 'done' && s.k.st[f].k) || items(s).some((it) => (it.t === 'pan' && it.st !== 'empty') || it.t === 'deco' || it.t === 'cake' || it.t === 'tray') || sold(s),
      d: (s, c) => { const r = bowlStep(s, c, 'mix', BASE().ing, BASE().order, '型に流す'); return 'ショートケーキの生地：' + BASE().order.map((k) => nmI(k) + '×' + BASE().ing[k]).join(' → ') + '。' + (r.miss ? '「' + nmI(r.miss) + '」が棚にありません（注文しよう）' : r.d); },
      g: (s, c) => bowlStep(s, c, 'mix', BASE().ing, BASE().order, '型に流す').g,
    },
    {
      id: 'pour', t: '型に流す', ok: (s) => items(s).some((it) => (it.t === 'pan' && it.st !== 'empty') || it.t === 'deco' || it.t === 'cake' || it.t === 'tray') || sold(s),
      d: (s, c) => (c.held && c.held.t === 'pan' && c.held.st === 'empty' ? 'ミキサーをねらって「型に流す」' : '棚の「ケーキ型」を持ってくる'),
      g: (s, c) => { const mx = Object.keys(s.k.st).find((f) => s.fu[f] && s.fu[f].k === 'mixer' && s.k.st[f].st === 'done'); if (c.held && c.held.t === 'pan' && c.held.st === 'empty') return mx ? { fid: mx, label: '型に流す' } : null; const id = nearItem(s, (it) => it.t === 'pan' && it.st === 'empty' && !it.dirty && !it.wet && onF(it)); return id ? { item: id, label: 'ケーキ型' } : null; },
    },
    {
      id: 'bake', t: 'オーブンで焼く', ok: (s) => items(s).some((it) => (it.t === 'pan' && (it.st === 'baking' || it.st === 'baked')) || it.t === 'deco' || it.t === 'cake' || it.t === 'tray') || sold(s),
      d: (s, c) => 'オーブンの電源を入れて（' + BASE().temp + '℃）、生地の入った型を入れる',
      g: (s, c) => { const ov = fid1(s, 'oven'); if (c.held && c.held.t === 'pan' && c.held.st === 'raw') return ov ? { fid: ov, label: 'オーブンに入れる', y: 1.2 } : null; const id = nearItem(s, (it) => it.t === 'pan' && it.st === 'raw' && onF(it)); return id ? { item: id, label: '生地の入った型' } : ov ? { fid: ov, label: 'オーブン', y: 1.2 } : null; },
    },
    {
      id: 'out', t: '焼けたら取り出して冷ます', ok: (s) => items(s).some((it) => (it.t === 'pan' && it.st === 'baked' && (PL().slotDef(s, it.at) || {}).type !== 'oven') || it.t === 'deco' || it.t === 'cake' || it.t === 'tray') || sold(s),
      d: 'ゲージが緑のうちに「取り出す」→ 机や棚に置いて冷ます（焼きすぎると焦げる）',
      g: (s, c) => { const id = nearItem(s, (it) => it.t === 'pan' && (it.st === 'baking' || it.st === 'baked') && (PL().slotDef(s, it.at) || {}).type === 'oven'); if (c.held && c.held.t === 'pan' && c.held.st === 'baked') { const sl = CS.kitchen.findSlot(s, c.held, ['rack', 'table', 'shelf']); return sl ? { at: sl, label: '置いて冷ます' } : null; } return id ? { item: id, label: '焼けたら取り出す' } : null; },
    },
    {
      id: 'whip', t: 'クリームを泡立てる', memo: 'short', ok: (s) => items(s).some((it) => it.t === 'cream' || (it.t === 'deco' && it.cr) || it.t === 'cake' || it.t === 'tray') || sold(s),
      d: (s, c) => { const r = bowlStep(s, c, 'whip', CRM().ing, Object.keys(CRM().ing), 'すくう'); return 'クリーム台に ' + Object.keys(CRM().ing).map((k) => nmI(k) + '×' + CRM().ing[k]).join('・') + '。' + (r.miss ? '「' + nmI(r.miss) + '」が棚にありません' : r.d || '緑で止めたら「クリームをすくう」'); },
      g: (s, c) => bowlStep(s, c, 'whip', CRM().ing, Object.keys(CRM().ing), 'すくう').g,
    },
    {
      id: 'deco', t: 'デコ台でクリームを塗る', ok: (s) => items(s).some((it) => (it.t === 'deco' && it.cr) || it.t === 'cake' || it.t === 'tray') || sold(s),
      d: (s, c) => { const df = fid1(s, 'deco'), dk = df && s.k.items[CS.kitchen.at(s, CS.kitchen.slot0(df))]; if (!dk) return '冷めたスポンジ（型）を持って、デコ台に「のせる」（空いた型は洗い場へ）'; return c.held && c.held.t === 'cream' ? 'デコ台をねらって「クリームを塗る」→ 画面を指（マウス）でなぞる' : 'クリーム（ボウル）を持ってくる'; },
      g: (s, c) => { const df = fid1(s, 'deco'); if (!df) return null; const dk = s.k.items[CS.kitchen.at(s, CS.kitchen.slot0(df))]; if (!dk) { if (c.held && c.held.t === 'pan' && c.held.st === 'baked') return { fid: df, label: 'デコ台にのせる', y: 1.25 }; const id = nearItem(s, (it) => it.t === 'pan' && it.st === 'baked' && onF(it) && (PL().slotDef(s, it.at) || {}).type !== 'oven'); return id ? { item: id, label: '冷めたスポンジ' } : null; } if (c.held && c.held.t === 'cream') return { fid: df, label: 'クリームを塗る', y: 1.25 }; const cr = nearItem(s, (it) => it.t === 'cream'); return cr ? { item: cr, label: 'クリーム' } : null; },
    },
    {
      id: 'top', t: 'いちごをのせて仕上げる', ok: (s) => items(s).some((it) => it.t === 'cake' || it.t === 'tray') || sold(s),
      d: (s, c) => { const df = fid1(s, 'deco'), dk = df && s.k.items[CS.kitchen.at(s, CS.kitchen.slot0(df))], n = dk && dk.tops ? dk.tops.strawberry || 0 : 0; return n >= 3 ? '手を空けて、デコ台で「仕上げる」' : '冷蔵棚のいちごを取って、ケーキの上をねらって置く（あと' + (3 - n) + 'つ）'; },
      g: (s, c) => { const df = fid1(s, 'deco'); if (!df) return null; const dk = s.k.items[CS.kitchen.at(s, CS.kitchen.slot0(df))], n = dk && dk.tops ? dk.tops.strawberry || 0 : 0; if (n >= 3 || (c.held && c.held.t === 'ing' && c.held.ing === 'strawberry')) return { fid: df, label: n >= 3 ? '仕上げる' : 'ケーキの上に置く', y: 1.25 }; const id = ingAt(s, 'strawberry'); return id ? { item: id, label: 'いちご' } : null; },
    },
    {
      id: 'case', t: 'ショーケースに並べる', ok: (s) => items(s).some((it) => it.t === 'tray') || sold(s),
      d: 'できたケーキを持って、カウンターのショーケースの空いている所に置く（ホールのまま並びます）',
      g: (s, c) => { if (c.held && c.held.t === 'cake') { for (const f of PL().list(s, 'scase').concat(PL().list(s, 'pcaseN'))) for (const sl of PL().slots(s, f)) if (!CS.kitchen.inSlot(s, sl).length) return { at: sl, label: 'ショーケース' }; return null; } const id = nearItem(s, (it) => it.t === 'cake' && onF(it)); return id ? { item: id, label: 'できたケーキ' } : null; },
    },
    {
      id: 'cut', t: 'ケーキナイフで6等分に切る', ok: (s) => (s.today.cut || 0) > 0 || items(s).some((it) => it.t === 'tray' && !it.w) || sold(s),
      d: (s, c) => (c.held && c.held.t === 'knife' ? 'ショーケースのケーキをねらって「ケーキナイフで6等分に切る」' : '机の上の「ケーキナイフ」を持つ。切るとカット（1切れ）、切らなければホールで売れます'),
      g: (s, c) => { if (c.held && c.held.t === 'knife') { const id = nearItem(s, (it) => (it.t === 'tray' || it.t === 'cake') && it.w && onF(it)); return id ? { item: id, label: '6等分に切る' } : null; } const id = nearItem(s, (it) => it.t === 'knife' && onF(it)); return id ? { item: id, label: 'ケーキナイフ' } : null; },
    },
    { id: 'open', t: '看板を OPEN にする', d: (s, c) => (c.held ? '手に持っている物（ナイフなど）を置いてから、' : '') + '入口の外の看板をねらって「OPEN にする」。お客さんが来て時計が進みます', ok: (s) => s.phase === 'open' || sold(s), g: () => ({ sign: 1, label: '看板' }) },
    {
      id: 'take', t: 'レジで注文を受ける', ok: (s) => Object.values(s.cust).some((c) => c.st === 'w' || c.st === 'pay') || sold(s),
      d: (s) => (Object.values(s.cust).some((c) => c.st === 'q') ? 'レジに並んだ先頭のお客さんをねらって「注文を受ける」' : 'お客さんが来るのを待とう（来たらレジへ）'),
      g: (s) => { const q = Object.keys(s.cust).find((id) => s.cust[id].st === 'q'); return q ? { cust: q, label: '注文を受ける' } : { fid: fid1(s, 'reg'), y: 1.9, label: 'レジ' }; },
    },
    {
      id: 'serve', t: '箱（お皿）に入れて渡す', ok: (s) => Object.values(s.cust).some((c) => c.st === 'pay') || sold(s),
      d: (s, c) => { const cid = waitC(s), cu = cid && s.cust[cid]; if (!cu) return 'ショーケースから箱やお皿に入れて、注文したお客さんに渡す'; const what = CS.kitchen.ordText(s, cu.ord, cu.wh); return '注文「' + what + '」→ ' + (cu.dine ? '店内なのでお皿（棚）' : '持ち帰りなのでケーキの箱（カウンター裏の箱入れ）') + 'を持って、ショーケースのケーキをねらい' + (Object.keys(cu.wh || {}).length ? '「ホールのまま箱に入れる」' : '「1切れ入れる」を注文の数だけ') + ' → お客さんに渡す'; },
      g: (s, c) => {
        const cid = waitC(s), cu = cid && s.cust[cid]; if (!cu) return null;
        const h = c.held, want = cu.dine ? 'plate' : 'box';
        if (h && h.t === want) {
          const got = {}, gotH = {}; (h.s || []).forEach((x) => { const g2 = x[4] ? gotH : got; g2[x[0]] = (g2[x[0]] || 0) + 1; });
          for (const r in cu.wh || {}) if ((gotH[r] || 0) < cu.wh[r]) { const id = nearItem(s, (it) => (it.t === 'tray' || it.t === 'cake') && it.w && it.r === r && onF(it)); return id ? { item: id, label: 'ホールのまま箱に入れる' } : null; }
          for (const r in cu.ord || {}) if ((got[r] || 0) < cu.ord[r]) { const id = nearItem(s, (it) => (it.t === 'tray' || it.t === 'cake') && it.r === r && onF(it)); return id ? { item: id, label: s.k.items[id].w ? 'まずナイフで切る' : '1切れ入れる（あと' + (cu.ord[r] - (got[r] || 0)) + '）' } : null; }
          return { cust: cid, label: '渡す' };
        }
        if (h) return null;
        const id = want === 'box' ? nearItem(s, (it) => it.t === 'ing' && it.ing === 'box' && onF(it)) : nearItem(s, (it) => it.t === 'plate' && !it.dirty && !it.wet && !(it.s || []).length && onF(it));
        return id ? { item: id, label: want === 'box' ? 'ケーキの箱' : 'お皿' } : null;
      },
    },
    { id: 'pay', t: 'レジでお会計', d: 'レジをねらって「お会計」。カードはタッチするだけ、現金はお札・硬貨を選んでお釣りを渡す', ok: (s) => sold(s), g: (s) => ({ fid: fid1(s, 'reg'), y: 1.9, label: 'お会計' }) },
    {
      id: 'wash', t: '洗い物をする', d: '汚れた型・お皿を洗い場の流しに入れて「洗う」→ こすって泡立てる → 水切りかごや棚に置くと乾く', ok: (s) => (s.today.washed || 0) > 0 || s.history.some((h) => h.wsh > 0),
      g: (s, c) => { if (c.held && c.held.dirty) return { fid: fid1(s, 'sink'), label: '流しに入れる', y: 1.2 }; const id = nearItem(s, (it) => it.dirty && (it.t === 'pan' || it.t === 'plate') && !String(it.at).startsWith('c:')); return id ? { item: id, label: '汚れ物' } : null; },
    },
  ];
  game.TUT = TUT;
  const tutKey = () => 'cs.tut3:' + ((game.room && game.room.code) || '');
  game.tutMark = function () { /* 進み具合は状態から判定する */ };
  game.tutCheck = function (s) {
    const el = $('#tut'); if (!el) return;
    const W = CS.world, st = CS.LS.get(tutKey(), null);
    if (!st || st.off || !ST.tips) { el.hidden = true; W.guide = null; return; }
    const pid = game.room && game.room.pid, hid = pid && CS.kitchen.held(s, pid), ctx = { pid, held: hid ? s.k.items[hid] : null, now: game.room.now() };
    let i = st.i || 0;
    while (i < TUT.length && (st.sk || {})[TUT[i].id] || (i < TUT.length && TUT[i].ok(s, ctx))) i++;
    if (i !== st.i) { st.i = i; CS.LS.set(tutKey(), st); if (i > 0) CS.sound.play('ok'); }
    if (i >= TUT.length) {
      W.guide = null;
      const h = `<b>${ic('check')} チュートリアル完了！</b><span class="small">材料を買う → 作る → 並べる → 接客 → お会計 まで、ひと通りできました。あとは自由に！経営はパソコンから</span><button class="btn sm" id="tut-x">閉じる</button>`;
      if (el._h !== h) { el._h = h; el.innerHTML = h; $('#tut-x').onclick = () => { st.off = true; CS.LS.set(tutKey(), st); el.hidden = true; }; }
      el.hidden = false; return;
    }
    const step = TUT[i], d = typeof step.d === 'function' ? step.d(s, ctx) : step.d;
    let g = null; try { g = step.g ? step.g(s, ctx) : null; } catch (e) { g = null; }
    W.guide = g;
    if (step.memo && !game._memoAuto) { game._memoAuto = 1; const m0 = CS.LS.get('cs.rmemo', {}) || {}; if (!m0.show) { game.memoShow(step.memo); if (innerHeight < 600) { const m1 = CS.LS.get('cs.rmemo', {}) || {}; m1.open = false; CS.LS.set('cs.rmemo', m1); game._memoKey = ''; } } }
    const h = `<div class="row between"><b class="small">やること ${i + 1}/${TUT.length}</b><span class="row" style="gap:4px"><button class="btn sm ghost" id="tut-sk" title="この手順をとばす">とばす</button><button class="icon-btn sm" id="tut-x" aria-label="チュートリアルを閉じる">${ic('close')}</button></span></div><b>${esc(step.t)}</b><span class="small">${esc(d)}</span>${g ? `<span class="small tut-g">${ic('star')} ピンクの目印「${esc(g.label || '')}」へ</span>` : ''}<i class="bar"><u style="width:${Math.round((i / TUT.length) * 100)}%"></u></i>`;
    if (el._h !== h) {
      el._h = h; el.innerHTML = h;
      $('#tut-x').onclick = () => { st.off = true; CS.LS.set(tutKey(), st); el.hidden = true; W.guide = null; UI.toast('設定 →「遊び方を見る」でもう一度見られます'); };
      $('#tut-sk').onclick = () => { st.sk = st.sk || {}; st.sk[step.id] = 1; CS.LS.set(tutKey(), st); el._h = ''; game.tutCheck(S()); };
    }
    el.hidden = false;
  };
  // お店に入ったとき：始めたばかりのお店なら自動でチュートリアル
  game.tutAuto = function (s) {
    if (CS.LS.get(tutKey(), null)) return;
    const fresh = s && s.day <= 1 && !s.history.length && !(cntK(s, 'oven') > 0 && cntK(s, 'mixer') > 0);
    if (fresh) setTimeout(() => game.tutorial(true), 600);
    else CS.LS.set(tutKey(), { i: 0, off: true });
  };

  // ---------- レシピメモ（左上にいつでも出しておける。ミキサー・クリーム台に入れた分は ✓） ----------
  const MEMO = 'cs.rmemo';
  game.memoShow = function (rid, toggle) {
    const m = CS.LS.get(MEMO, {}) || {};
    if (toggle && m.show && (!rid || m.r === rid)) m.show = false; else { m.show = true; m.open = true; if (rid) m.r = rid; }
    CS.LS.set(MEMO, m); game._memoKey = ''; const s = S(); if (s) game.renderMemo(s);
  };
  function nearSt(s, kind) { const m = CS.world.me; let best = null, bd = 1e9; for (const f of PL().list(s, kind)) { const F = s.fu[f], d = m ? Math.hypot(F.x - m.x, F.z - m.z) : 0; if (d < bd) { bd = d; best = f; } } return best ? s.k.st[best] || {} : {}; }
  game.renderMemo = function (s) {
    const el = $('#rmemo'); if (!el) return;
    const m = CS.LS.get(MEMO, {}) || {};
    const list = Object.keys(D.RECIPES).filter((r) => s.known[r]).concat(Object.keys(s.originals || {}));
    if (!m.show || !list.length) { el.hidden = true; return; }
    const rid = list.includes(m.r) ? m.r : list[0], r = sim.recipe(s, rid); if (!r) { el.hidden = true; return; }
    const B = D.BASES[r.base], C = r.cream && r.cream !== 'none' ? D.CREAMS[r.cream] : null;
    const bm = nearSt(s, 'mixer'), bw = nearSt(s, 'whip');
    const cnt = (b) => { const c = {}; (b.ings || []).forEach((k) => (c[k] = (c[k] || 0) + 1)); return c; };
    const cm = cnt(bm), cw = cnt(bw);
    const ingRow = (k, n, c) => { const h = Math.min(n, c[k] || 0); return `<span class="mi ${h >= n ? 'done' : h ? 'part' : ''}">${D.ING[k].icon || ''}${esc(D.ING[k].name)}×${n}${h ? `<small>${h >= n ? '✓' : h + '/' + n}</small>` : ''}</span>`; };
    const key = JSON.stringify([rid, m.open, cm, cw, list.length]);
    if (game._memoKey === key && !el.hidden) return;
    game._memoKey = key;
    const tops = Object.keys(r.tops || {});
    el.innerHTML = `<div class="mh"><button class="icon-btn xs" data-mv="-1" aria-label="前のレシピ">‹</button><b data-mt>${ic('book')} ${esc(r.name)}</b><button class="icon-btn xs" data-mv="1" aria-label="次のレシピ">›</button><button class="icon-btn xs" data-mo aria-label="${m.open ? 'たたむ' : 'ひらく'}">${m.open ? '−' : '+'}</button><button class="icon-btn xs" data-mx aria-label="レシピメモを閉じる">×</button></div>` + (m.open ? `<div class="mb">
      <div><i>1</i><b>生地（${esc(B.short)}）</b> ミキサーにこの順で<div class="mis">${B.order.map((k) => ingRow(k, B.ing[k], cm)).join('<u>→</u>')}</div><small>回して緑で止める → 型に流す</small></div>
      <div><i>2</i><b>焼く</b> オーブン ${B.temp}℃・約${B.bake}秒 → 取り出して冷ます</div>
      ${C ? `<div><i>3</i><b>${esc(C.name)}</b> クリーム台に<div class="mis">${Object.keys(C.ing).map((k) => ingRow(k, C.ing[k], cw)).join('')}</div><small>泡立てて緑で止める → すくう</small></div>` : `<div><i>3</i><b>クリームなし</b></div>`}
      <div><i>4</i><b>デコ</b> デコ台にのせる${C ? ' → クリームを塗る' : ''}${tops.length ? ' → ' + tops.map((k) => esc(D.ING[k].name) + '×' + r.tops[k]).join('・') + 'をのせる' : ''} → 仕上げる</div>
      <div><i>5</i><b>売る</b> ショーケースへ。${sim.wholeable(r) ? 'ナイフで6等分→カット ¥' + ((s.menu[rid] || {}).price || 0) + '／そのまま→ホール ¥' + ((s.menu[rid] || {}).hp || 0) : (r.unit || '個') + 'で ¥' + ((s.menu[rid] || {}).price || 0)}</div></div>` : '');
    el.hidden = false;
    $$('[data-mv]', el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const i = (list.indexOf(rid) + +b.dataset.mv + list.length) % list.length; const m2 = CS.LS.get(MEMO, {}) || {}; m2.r = list[i]; CS.LS.set(MEMO, m2); game._memoKey = ''; game.renderMemo(S()); }));
    $('[data-mo]', el).onclick = () => { const m2 = CS.LS.get(MEMO, {}) || {}; m2.open = !m2.open; CS.LS.set(MEMO, m2); game._memoKey = ''; game.renderMemo(S()); };
    $('[data-mt]', el).onclick = () => { const m2 = CS.LS.get(MEMO, {}) || {}; m2.open = !m2.open; CS.LS.set(MEMO, m2); game._memoKey = ''; game.renderMemo(S()); };
    $('[data-mx]', el).onclick = () => { const m2 = CS.LS.get(MEMO, {}) || {}; m2.show = false; CS.LS.set(MEMO, m2); el.hidden = true; UI.toast('レシピ帳の「メモに出す」でまた表示できます'); };
  };
  game.tutorial = function (first) {
    const T = touch();
    const ctl = T
      ? [['移動', '左下のスティック'], ['見回す', '画面の右側をスワイプ'], ['つかむ・置く', '大きいボタン（長押しで続けて）'], ['使う', '小さいボタン（ミキサーを回す・電源など）'], ['捨てる・落とす', 'ゴミ箱のボタン'], ['家具の配置', '「配置」ボタン']]
      : [['移動', 'W A S D（Shift で小走り）'], ['見回す', 'マウスを動かすだけ（ボタンを押さなくてOK）'], ['つかむ・置く', 'E / 左クリック（長押しで続けて）'], ['使う', 'F / 右クリック'], ['捨てる・落とす', 'Q'], ['家具の配置', 'B'], ['パソコン・レシピ', 'Tab / R']];
    UI.modal({
      title: 'ようこそ！ケーキ屋さんへ',
      html: `<div style="display:grid;gap:10px"><p style="margin:0">一人称でお店の中を歩いて、<b>家具と材料を買う → トラックから運ぶ → 生地 → 焼く → クリーム → デコ → ショーケースに並べる（ホールのまま／ナイフで6等分）→ 接客・お会計 → 洗い物</b>を自分の手でやります。家具をどこに置くかもみんなで自由に。分担すると早い！</p>
        <dl class="kv">${ctl.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
        <div class="banner sky">お店は最初 <b>CLOSE</b>。CLOSE のあいだはお客さんが来ず、時計も止まります。準備ができたら入口の外の<b>看板</b>を OPEN に。</div>
        <p class="muted small" style="margin:0">画面右上に「やること」、行き先には<b style="color:#E8467C">ピンクの目印</b>が出ます。レシピはいつでも「レシピ」ボタン（R）で見られ、左上にメモとして出しておけます。</p></div>`,
      buttons: [{ label: 'はじめる！', cls: 'pink', value: true }],
    });
    CS.LS.set(tutKey(), { i: 0, off: false, sk: {} });
    game._memoAuto = 0;
    const s = S(); if (s) game.tutCheck(s);
  };
})(typeof window !== 'undefined' ? window : globalThis);
