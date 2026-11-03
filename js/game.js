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
      if (ST.tips && !CS.LS.get('cs.tut', false)) { CS.LS.set('cs.tut', true); setTimeout(game.tutorial, 500); }
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
  //  画面の骨組み（3D）
  // =====================================================================
  const touch = () => (G.matchMedia ? matchMedia('(pointer: coarse)').matches : false);
  game.build = function () {
    $('#scr-game').innerHTML = `
      <header class="hud">
        <div class="hud-day"><b id="h-day">1日目</b><span id="h-sub">月・晴れ</span></div>
        <div class="hud-clock"><span class="phase" id="h-phase">準備</span><b id="h-clock" class="num">7:30</b><i class="bar"><u id="h-bar"></u></i></div>
        <div class="hud-money num" id="h-money">¥0</div>
        <div class="hud-rep" title="お店の評判"><b id="h-rep">★2.8</b><small>評判</small></div>
        <button class="hud-lv" id="h-lv" title="店舗レベル"><b id="h-lvn">Lv1</b><i class="bar"><u id="h-lvb"></u></i></button>
        <div class="hud-party" id="h-party"></div>
        <button class="icon-btn" id="h-menu" aria-label="設定とお店の情報">${ic('gear')}</button>
      </header>
      <div class="floor" id="floor">
        <div class="world" id="world"></div>
        <div class="phase-band" id="pband" hidden></div>
        <div class="chat-float" id="chatFloat" aria-live="polite"></div>
        <div class="keyhint" id="keyhint" ${touch() ? 'hidden' : ''}>WASD：移動　ドラッグ：視点　ホイール：ズーム　E / Space：操作</div>
        <div class="fabs" id="fabs">
          <div class="mv joy" data-id="joy" id="joy" ${touch() ? '' : 'hidden'}><i></i></div>
          <button class="mv act-btn" data-id="act" id="actBtn" aria-label="操作"><span class="ab-ic">${ic('hand')}</span><span class="ab-t" id="actText">操作</span></button>
          <button class="mv fab c2" data-id="menu">${ic('book')}メニュー</button>
          <button class="mv fab c3" data-id="biz">${ic('chart')}経営</button>
          <button class="mv fab c4" data-id="chat">${ic('chat')}スタンプ</button>
        </div>
        <div class="overlay" id="gov" hidden></div>
      </div>`;
    $('#h-menu').onclick = () => UI.openSettings(true);
    $('#h-money').onclick = () => game.openBiz('today');
    $('#h-lv').onclick = () => game.openBiz('level');
    $$('#fabs .fab').forEach((b) => (b.onclick = () => {
      if (game.editingFabs) return;
      CS.sound.play('tap');
      ({ menu: () => game.openMenu('sell'), biz: () => game.openBiz('today'), chat: game.openChat })[b.dataset.id]();
    }));
    const ab = $('#actBtn');
    ab.addEventListener('pointerdown', (e) => { e.preventDefault(); if (game.editingFabs) return; ab.classList.add('pressed'); CS.world.doAction(); });
    ab.addEventListener('pointerup', () => ab.classList.remove('pressed'));
    ab.addEventListener('pointerleave', () => ab.classList.remove('pressed'));
    const W = CS.world;
    if (!W.init($('#world'))) UI.toast('3D 表示が使えない端末です', 'err');
    W.bindJoystick($('#joy'));
    W.onAction = (st) => game.stationAction(st);
    W.onNear = (st) => {
      const t = st ? st.verb : '近づいて操作';
      if (game._near !== t) { game._near = t; $('#actText').textContent = t; ab.classList.toggle('on', !!st); }
    };
    UI.layoutFabs();
  };
  game.stationAction = function (st) {
    const s = S(); if (!s) return;
    if (st.oven !== undefined) { const o = s.ovens[st.oven]; if (o && o.s) act({ t: 'ovenOut', slot: st.oven }); else game.openOven(st.oven); return; }
    switch (st.id) {
      case 'mix': case 'whip': case 'deco': case 'rack': return game.openStation(st.id);
      case 'market': return game.openMarket();
      case 'biz': return game.openBiz('today');
      case 'menu': return game.openMenu('sell');
      case 'case': return game.openCase();
      case 'sign':
        if (s.phase === 'prep') { CS.sound.play('open'); act({ t: 'open' }); }
        else UI.toast(s.phase === 'open' ? '営業中です（閉店は20:00）' : '開店準備のときに開店できます');
        return;
      default: return undefined;
    }
  };

  // =====================================================================
  //  ボタン配置（大きさ・位置の変更） ※スティックと操作ボタンも動かせる
  // =====================================================================
  const DEF_POS = {
    right: { joy: { x: 15, y: 76 }, act: { x: 86, y: 78 }, menu: { x: 93, y: 22 }, biz: { x: 93, y: 38 }, chat: { x: 93, y: 54 } },
    left: { joy: { x: 85, y: 76 }, act: { x: 14, y: 78 }, menu: { x: 7, y: 22 }, biz: { x: 7, y: 38 }, chat: { x: 7, y: 54 } },
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
    const down = (e) => { const b = e.target.closest('.mv'); if (!b) return; drag = { b, id: e.pointerId }; f.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); };
    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const r = floor.getBoundingClientRect();
      const x = clamp(((e.clientX - r.left) / r.width) * 100, 5, 95), y = clamp(((e.clientY - r.top) / r.height) * 100, 6, 94);
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
  };
  game.renderParty = function () {
    const r = game.room; if (!r || !$('#h-party')) return;
    const hostPid = r.meta && r.devices[r.meta.host] ? r.devices[r.meta.host].pid : r.local ? r.pid : '';
    const ids = Object.keys(r.members).sort((a, b) => (r.members[a].joined || 0) - (r.members[b].joined || 0));
    $('#h-party').innerHTML = ids.map((pid) => `<span class="pa ${r.isOnline(pid) || r.local ? '' : 'off'} ${pid === hostPid ? 'host' : ''}" title="${esc(r.members[pid].name || '')}${pid === hostPid ? '（ホスト）' : ''}">${face(r.members[pid].skin)}</span>`).join('');
  };
  function decoReady(s, rid, g) {
    const r = sim.recipe(s, rid); if (!r) return { ok: false };
    const bases = Object.keys(s.bases).filter((id) => s.bases[id].k === r.base);
    const cool = bases.filter((id) => g >= s.bases[id].cool);
    const creams = r.cream === 'none' ? ['-'] : Object.keys(s.creams).filter((id) => s.creams[id].k === r.cream && s.creams[id].n > 0);
    const tops = sim.hasAll(s, r.tops || {});
    return { ok: cool.length > 0 && creams.length > 0 && tops, bases, cool, creams, tops, r };
  }

  // ---------- 毎フレーム ----------
  game.frame = function () {
    const r = game.room;
    if (!r || !r.S) return;
    const s = r.S, g = r.now();
    CS.world.frame();
    const pi = sim.phaseInfo(s, g);
    const ph = $('#h-phase');
    if (ph) {
      ph.textContent = pi.label; ph.className = 'phase ' + pi.phase;
      $('#h-clock').textContent = sim.clockStr(pi.min);
      $('#h-bar').style.width = pi.f * 100 + '%';
      const band = $('#pband');
      if (s.phase === 'prep') {
        band.hidden = false;
        const t = '開店まで ' + mmss(pi.left);
        if (band.dataset.t !== t) { band.dataset.t = t; band.innerHTML = `<span class="num">${t}</span><button class="btn sm mint" id="pb-open">今すぐ開店</button>`; $('#pb-open').onclick = () => act({ t: 'open' }); }
      } else if (!band.hidden) { band.hidden = true; band.dataset.t = ''; }
    }
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
        <button class="btn big pink wide" id="ov-start">${ic('play')} 開店準備をはじめる！</button>
        <p class="muted small" style="margin:0;text-align:center">だれが押してもスタートできます。営業中でも途中から参加できます。</p>
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
      if (h.profit > 0 && s.funds > 30000) tips.push('資金に余裕があります。仕入れ棚の「設備」「家具」や「経営 → 拡張」でお店を育てよう！');
      if (h.wages) tips.push('アルバイトの日給 合計 ' + yen(h.wages) + '。働くほどレベルが上がって速くなります。');
      if (!tips.length) tips.push('いい調子！この調子でお店を大きくしよう。');
      const stat = (l, v, cls) => `<div class="stat"><small>${l}</small><b class="${cls || ''}">${v}</b></div>`;
      ov.innerHTML = `<div class="panel ov-card"><h2>${h.d}日目の営業結果</h2>
        <div class="report-grid">${stat('来店', h.cust + '人')}${stat('販売', h.sold + '切れ')}${stat('売上', yen(h.sales))}${stat('原価', yen(h.cogs))}${stat('廃棄', yen(h.waste), h.waste ? 'neg' : '')}${stat('家賃・光熱費・人件費', yen(h.fixed))}${stat('広告・試作', yen(h.ads))}${stat('利益', yen(h.profit), h.profit >= 0 ? 'pos' : 'neg')}${stat('クレーム', (h.cmp || 0) + '件', h.cmp ? 'neg' : '')}${stat('評判', '★' + h.rep.toFixed(1) + (repD ? (repD > 0 ? ' ↑' : ' ↓') : ''), repD > 0 ? 'pos' : repD < 0 ? 'neg' : '')}</div>
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
      case 'cake': UI.toast(f.x, 'good'); if (CS.world.ready) { const p = CS.world.eng.project([1.7, 1.2, -1.55]); const r = $('#world').getBoundingClientRect(); if (p) CS.sparkle(r.left + p.x, r.top + p.y, 18); } break;
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
  //  作業台
  // =====================================================================
  const ingChips = (s, req) => Object.keys(req).map((id) => { const have = sim.invCount(s, id); return `<span class="chip ${have >= req[id] ? 'ok' : 'bad'}" title="在庫${have}">${D.ING[id].icon}×${req[id]}</span>`; }).join('');
  game.openStation = function (kind) {
    const r = game.room;
    r.setStation(kind);
    const titles = { mix: 'ミキサー台', oven: 'オーブン', rack: '冷却ラック', whip: 'クリーム台', deco: 'デコ台' };
    UI.openSheet({
      title: titles[kind] || '作業台', live: true, key: kind,
      onClose: () => r.setStation(''),
      render(body) {
        const s = S(); const g = r.now();
        if (kind === 'mix') {
          body.innerHTML = `${working() ? '' : '<div class="banner">開店準備・営業中に作業できます</div>'}<div class="list">${Object.keys(D.BASES).filter((id) => Object.keys(s.known).some((rid) => { const rr = sim.recipe(s, rid); return rr && rr.base === id; })).map((id) => { const b = D.BASES[id]; const ok = sim.hasAll(s, b.ing); return `<div class="item"><div class="ico" style="background:${b.color}"></div><div class="mid"><b>${esc(b.name)}</b><small>${ingChips(s, b.ing)} 焼き${Math.round(sim.ovenDur(s, id) / 1000)}秒</small></div><div class="end"><button class="btn sm sky" data-mix="${id}" ${ok && working() ? '' : 'disabled'}>作る</button></div></div>`; }).join('')}</div>
          <div class="card soft"><h3>オーブン待ちの生地</h3>${Object.keys(s.batters).length ? `<div class="list">${Object.keys(s.batters).map((id) => { const b = s.batters[id]; return `<div class="item"><div class="ico" style="background:${D.BASES[b.k].color}"></div><div class="mid"><b>${esc(D.BASES[b.k].short)}生地</b><small>品質 ${qtxt(b.q)}・推奨 ${D.BASES[b.k].temp}℃</small>${dfChips(b.df)}</div><div class="end"><button class="btn sm ghost" data-disc="batter" data-id="${id}" aria-label="捨てる">${ic('trash')}</button><button class="btn sm" data-oin="${id}">オーブンへ</button></div></div>`; }).join('')}</div>` : '<p class="muted small" style="margin:0">まだありません</p>'}</div>
          <p class="muted small" style="margin:0">材料の投入順はレシピ帳に書いてあります。品質＝投入順＋かき混ぜの上手さ。</p>`;
        } else if (kind === 'oven') {
          body.innerHTML = `<div class="list">${s.ovens.map((o, i) => o.s ? `<div class="item"><div class="ico">${ic('oven')}</div><div class="mid"><b>オーブン${i + 1}：${esc(D.BASES[o.k].short)}</b><small>焼き上がりまで ${mmss((o.t0 + o.dur) - g)}</small></div><div class="end"><button class="btn sm pink" data-oout="${i}">取り出す</button></div></div>` : `<div class="item"><div class="ico">${ic('oven')}</div><div class="mid"><b>オーブン${i + 1}</b><small>空き</small></div><div class="end"><button class="btn sm" data-oslot="${i}" ${Object.keys(s.batters).length ? '' : 'disabled'}>生地を入れる</button></div></div>`).join('')}</div>
          <div class="banner sky">${ic('fire')} メーターの緑の枠に針が入ったら取り出そう。早すぎると生焼け、遅すぎると焦げて廃棄に。</div>`;
        } else if (kind === 'rack') {
          const ids = Object.keys(s.bases);
          body.innerHTML = ids.length ? `<div class="list">${ids.map((id) => { const b = s.bases[id]; const c = g >= b.cool; return `<div class="item"><div class="ico" style="background:${D.BASES[b.k].color}"></div><div class="mid"><b>${esc(D.BASES[b.k].name)}</b><small>品質 ${qtxt(b.q)} ・ ${c ? '冷めた（仕上げOK）' : 'あと' + mmss(b.cool - g) + 'で冷める'}${b.day < s.day ? ' ・ 前日の残り' : ''}</small>${dfChips(b.df)}</div><div class="end"><button class="btn sm ghost" data-disc="base" data-id="${id}" aria-label="捨てる">${ic('trash')}</button></div></div>`; }).join('')}</div>` : '<div class="banner">焼き上がったスポンジがここで冷まされます</div>';
          body.innerHTML += `<p class="muted small" style="margin:0">温かいままデコするとクリームが溶けて品質ダウン。スポンジは翌日まで持ちます（品質-10%）。</p>`;
        } else if (kind === 'whip') {
          body.innerHTML = `${working() ? '' : '<div class="banner">開店準備・営業中に作業できます</div>'}<div class="list">${Object.keys(D.CREAMS).filter((k) => k !== 'none' && Object.keys(s.known).some((rid) => { const rr = sim.recipe(s, rid); return rr && rr.cream === k; })).map((id) => { const c = D.CREAMS[id]; const ok = sim.hasAll(s, c.ing); return `<div class="item"><div class="ico"><span class="sw" style="width:30px;height:30px;border-radius:50%;border:1.5px solid rgba(242,235,225,.35);background:${c.color}"></span></div><div class="mid"><b>${esc(c.name)}</b><small>${ingChips(s, c.ing)} ${D.CREAM_YIELD}台分</small></div><div class="end"><button class="btn sm lilac" data-whip="${id}" ${ok && working() ? '' : 'disabled'}>作る</button></div></div>`; }).join('')}</div>
          <div class="card soft"><h3>できているクリーム</h3>${Object.keys(s.creams).length ? Object.keys(s.creams).map((id) => { const c = s.creams[id]; return `<div class="row between"><span>${esc(D.CREAMS[c.k].name)} ×${c.n}（品質${qtxt(c.q)}）${dfChips(c.df)}</span><button class="btn sm ghost" data-disc="cream" data-id="${id}" aria-label="捨てる">${ic('trash')}</button></div>`; }).join('') : '<p class="muted small" style="margin:0">まだありません。クリームはその日のうちに使い切ろう（閉店で廃棄）</p>'}</div>`;
        } else if (kind === 'deco') {
          const rids = Object.keys(s.known).filter((rid) => s.menu[rid]);
          body.innerHTML = `${working() ? '' : '<div class="banner">開店準備・営業中に作業できます</div>'}<div class="list">${rids.map((rid) => {
            const d = decoReady(s, rid, g); const rr = d.r; if (!rr) return '';
            const cr = rr.cream === 'none' ? '' : `<span class="chip ${d.creams.length ? 'ok' : 'bad'}">${esc(D.CREAMS[rr.cream].short)}</span>`;
            return `<div class="item"><div class="ico">${cakeImg(rr)}</div><div class="mid"><b>${esc(rr.name)}${s.menu[rid].on ? '' : '（販売OFF）'}</b><small><span class="chip ${d.cool.length ? 'ok' : d.bases.length ? 'warn' : 'bad'}">${esc(D.BASES[rr.base].short)}${d.cool.length ? '' : d.bases.length ? ' 冷却中' : ' なし'}</span> ${cr} ${ingChips(s, rr.tops || {})}</small></div><div class="end"><button class="btn sm pink" data-deco="${rid}" ${(d.ok || (d.bases.length && d.creams.length && d.tops)) && working() ? '' : 'disabled'}>デコる</button></div></div>`;
          }).join('')}</div><p class="muted small" style="margin:0">完成したケーキは自動でショーケースに並びます（満杯ならバックヤードへ）。</p>`;
        }
        // 共通ハンドラ
        $$('[data-mix]', body).forEach((b) => (b.onclick = () => game.mixFlow(b.dataset.mix)));
        $$('[data-whip]', body).forEach((b) => (b.onclick = () => game.whipFlow(b.dataset.whip)));
        $$('[data-deco]', body).forEach((b) => (b.onclick = () => game.decoFlow(b.dataset.deco)));
        $$('[data-oin]', body).forEach((b) => (b.onclick = () => { const s2 = S(); const slot = s2.ovens.findIndex((o) => !o.s); if (slot < 0) return UI.toast('空いているオーブンがありません', 'err'); act({ t: 'ovenIn', slot, id: b.dataset.oin }); }));
        $$('[data-oslot]', body).forEach((b) => (b.onclick = () => game.openOven(+b.dataset.oslot)));
        $$('[data-oout]', body).forEach((b) => (b.onclick = () => act({ t: 'ovenOut', slot: +b.dataset.oout })));
        $$('[data-disc]', body).forEach((b) => (b.onclick = async () => { if (await UI.confirm('捨てる', '廃棄すると原価がロスになります。', '捨てる', true)) act({ t: 'discard', kind: b.dataset.disc, id: b.dataset.id }); }));
      },
    });
  };
  // ---------- オーブン：温度設定・予熱・投入 ----------
  game.openOven = function (slot) {
    const r = game.room;
    r.setStation('oven');
    UI.openSheet({
      title: 'オーブン' + (slot + 1), live: true, key: 'oven',
      onClose: () => r.setStation(''),
      render(body) {
        const s = S(); const o = s.ovens[slot]; const g = r.now();
        if (!o) { body.innerHTML = ''; return; }
        if (o.s) { body.innerHTML = `<div class="banner">${esc(D.BASES[o.k].name)}を ${o.temp}℃ で焼いています</div><button class="btn primary wide" id="ov-out">取り出す</button>`; $('#ov-out', body).onclick = () => { act({ t: 'ovenOut', slot }); UI.closeSheet(); }; return; }
        const heating = o.h && g < (o.hot || 0);
        const status = !o.h ? '<span class="chip">停止中</span>' : heating ? `<span class="chip warn">予熱中 ${o.temp}℃（あと${Math.ceil(((o.hot || 0) - g) / 1000)}秒）</span>` : `<span class="chip ok">${o.temp}℃ 予熱完了</span>`;
        const cur = o.h ? o.temp : 170;
        const bat = Object.keys(s.batters);
        body.innerHTML = `<div class="card"><div class="row between"><h3>温度</h3>${status}</div>
          <div class="seg" id="ov-t">${D.OVEN_TEMPS.map((t) => `<button data-t="${t}" aria-pressed="${t === cur && o.h ? 'true' : 'false'}">${t}℃</button>`).join('')}</div>
          <p class="muted small" style="margin:0">温度を選ぶと予熱が始まります。予熱が終わる前に入れるとふくらみ不足に。生地ごとの適温より高いと表面が焦げ、低いとパサつきます。</p></div>
          <div class="card"><h3>入れる生地</h3>${bat.length ? `<div class="list">${bat.map((id) => { const b = s.batters[id], B0 = D.BASES[b.k], dT = cur - B0.temp; return `<div class="item"><div class="ico" style="background:${B0.color}"></div><div class="mid"><b>${esc(B0.name)}</b><small>品質 ${qtxt(b.q)}・適温 ${B0.temp}℃ ${o.h && dT ? `<span class="${Math.abs(dT) >= 20 ? 'neg' : ''}">（今の温度との差 ${dT > 0 ? '+' : ''}${dT}℃）</span>` : ''}</small>${dfChips(b.df)}</div><div class="end"><button class="btn sm primary" data-in="${id}">入れる</button></div></div>`; }).join('')}</div>` : '<p class="muted small" style="margin:0">ミキサー台で生地を作ってください</p>'}</div>`;
        $$('#ov-t button', body).forEach((b) => (b.onclick = () => { CS.sound.play('tap'); act({ t: 'ovenHeat', slot, temp: +b.dataset.t }); }));
        $$('[data-in]', body).forEach((b) => (b.onclick = async () => {
          const s2 = S(), o2 = s2.ovens[slot];
          if (!o2.h || r.now() < (o2.hot || 0)) { if (!(await UI.confirm('予熱が終わっていません', 'このまま入れると、ふくらみ不足になります。', '入れる', true))) return; }
          act({ t: 'ovenIn', slot, id: b.dataset.in }); UI.closeSheet();
        }));
      },
    });
  };
  game.ovenIn = async function (slot) {
    const s = S(); const ids = Object.keys(s.batters);
    if (!ids.length) return UI.toast('オーブンに入れる生地がありません。ミキサー台で作ろう', 'err');
    let id = ids[0];
    if (ids.length > 1) {
      id = await UI.choose('どの生地を焼く？', `<div class="list">${ids.map((k) => `<button class="item" style="cursor:pointer;text-align:left" data-pick="${k}"><div class="ico" style="background:${D.BASES[s.batters[k].k].color}"></div><div class="mid"><b>${esc(D.BASES[s.batters[k].k].name)}</b><small>品質 ${qtxt(s.batters[k].q)}</small></div><span></span></button>`).join('')}</div>`, '[data-pick]');
      if (!id) return;
    }
    act({ t: 'ovenIn', slot, id });
  };

  game.mixFlow = async function (baseId) {
    const s = S(); const b = D.BASES[baseId];
    if (!working()) return UI.toast('開店準備・営業中に作業できます', 'err');
    if (!sim.hasAll(s, b.ing)) return UI.toast('材料が足りません：' + sim.missing(s, b.ing).join('、'), 'err');
    UI.closeSheet(true);
    game.room.setStation('mix');
    const mt = sim.eqv(s, 'mixer'); const res = await CS.mg.mix(baseId, { diff: s.diff, mixWin: mt.win, mixFast: mt.fast });
    game.room && game.room.setStation('');
    if (res && game.room) await act({ t: 'mix', base: baseId, q: res.q, df: res.df || [] });
  };
  game.whipFlow = async function (creamId) {
    const s = S(); const c = D.CREAMS[creamId];
    if (!working()) return UI.toast('開店準備・営業中に作業できます', 'err');
    if (!sim.hasAll(s, c.ing)) return UI.toast('材料が足りません：' + sim.missing(s, c.ing).join('、'), 'err');
    UI.closeSheet(true);
    game.room.setStation('whip');
    const wt = sim.eqv(s, 'whisk'); const res = await CS.mg.whip(creamId, { diff: s.diff, win: wt.win, gain: wt.gain });
    game.room && game.room.setStation('');
    if (res && game.room) await act({ t: 'whip', cream: creamId, q: res.q, df: res.df || [] });
  };
  game.decoFlow = async function (rid) {
    const s = S(); const g = game.room.now();
    if (!working()) return UI.toast('開店準備・営業中に作業できます', 'err');
    const d = decoReady(s, rid, g);
    if (!d.bases.length) return UI.toast(D.BASES[d.r.base].short + 'のスポンジがありません', 'err');
    if (!d.creams.length) return UI.toast(D.CREAMS[d.r.cream].short + 'クリームがありません', 'err');
    if (!d.tops) return UI.toast('トッピングが足りません：' + sim.missing(s, d.r.tops).join('、'), 'err');
    let baseId;
    if (d.cool.length) baseId = d.cool.sort((a, b) => ((s.bases[a].df || []).length - (s.bases[b].df || []).length) || s.bases[b].q - s.bases[a].q)[0];
    else {
      if (!(await UI.confirm('まだ温かいよ', 'スポンジが冷めていません。クリームが溶けて品質が3割下がります。それでもデコる？', 'デコる', true))) return;
      baseId = d.bases.sort((a, b) => s.bases[a].cool - s.bases[b].cool)[0];
    }
    const creamId = d.r.cream === 'none' ? '' : d.creams.sort((a, b) => ((s.creams[a].df || []).length - (s.creams[b].df || []).length) || s.creams[b].q - s.creams[a].q)[0];
    const bad = [].concat((s.bases[baseId] || {}).df || [], creamId ? (s.creams[creamId] || {}).df || [] : []);
    if (bad.length && !(await UI.confirm('失敗した材料を使う？', '使うスポンジ／クリームに欠点（' + bad.map((x) => D.DEFECTS[x].name).join('・') + '）があります。売るとお客さんの満足度と評判が下がります。', '使う', true))) return;
    UI.closeSheet(true);
    game.room.setStation('deco');
    const res = await CS.mg.deco(d.r, { diff: s.diff });
    game.room && game.room.setStation('');
    if (res && game.room) await act({ t: 'deco', r: rid, base: baseId, cream: creamId, q: res.q, df: res.df || [] });
  };

  // ---------- ショーケース全体 ----------
  game.openCase = function () {
    UI.openSheet({
      title: 'ショーケース', live: true,
      render(body) {
        const s = S();
        const rows = s.showcase.map((k, i) => {
          if (!k) return `<div class="item"><div class="ico">${ic('case')}</div><div class="mid"><b>${i + 1}番：あき</b><small>デコ台で完成したケーキが自動で並びます</small></div><span></span></div>`;
          const r = sim.recipe(s, k.r); const m = s.menu[k.r] || { price: 0 };
          return `<div class="item"><div class="ico">${cakeImg(r, k.p, k.df)}</div><div class="mid"><b>${esc(r.name)}${k.o ? '（前日）' : ''}</b><small>残り${k.p}切れ・品質${qtxt(k.q)}・${yen(m.price)}／切れ</small>${dfChips(k.df)}</div><div class="end"><button class="btn sm ghost" data-dc="${i}" aria-label="廃棄">${ic('trash')}</button></div></div>`;
        }).join('');
        const n = Object.keys(s.stock).length;
        body.innerHTML = `<div class="list">${rows}</div>${n ? `<div class="banner sky">バックヤードに ${n} 台（空きができると自動で並びます）</div>` : ''}<button class="btn pink" id="cs-price">${ic('book')} 価格を変える</button>`;
        $('#cs-price', body).onclick = () => game.openMenu('sell');
        $$('[data-dc]', body).forEach((b) => (b.onclick = async () => { if (await UI.confirm('廃棄する', '残りのケーキを捨てます（原価がロスになります）。', '捨てる', true)) act({ t: 'discard', kind: 'case', slot: +b.dataset.dc }); }));
      },
    });
  };
  // ---------- ショーケースの1台 ----------
  game.openSlot = function (i) {
    const s = S(); const k = s.showcase[i];
    if (!k) { UI.toast('完成したケーキがここに並びます'); return; }
    const r = sim.recipe(s, k.r);
    UI.openSheet({
      title: r.name, live: true,
      render(body) {
        const s2 = S(); const k2 = s2.showcase[i];
        if (!k2 || k2.r !== k.r) { body.innerHTML = '<div class="banner">売り切れました！</div>'; return; }
        const m = s2.menu[k2.r];
        body.innerHTML = `<div class="lab-preview"><div>${cakeImg(r, k2.p, k2.df, 'big')}</div><dl class="kv"><dt>品質</dt><dd>${qtxt(k2.q)}</dd><dt>残り</dt><dd>${k2.p} / ${k2.n || R.PIECES} ${esc(r.unit || '切れ')}</dd><dt>価格（1切れ）</dt><dd>${yen(m.price)}</dd><dt>原価（1${esc(r.unit || '切れ')}）</dt><dd>${yen(k2.c / (k2.n || R.PIECES))}</dd><dt>作った日</dt><dd>${k2.d}日目${k2.o ? '（前日）' : ''}</dd></dl></div>${k2.df && k2.df.length ? `<div class="banner pink">${dfChips(k2.df)}<span>欠点のあるケーキは売れにくく、買ったお客さんの満足度と評判が下がります</span></div>` : ''}
          <div class="row wrap"><button class="btn pink" id="sl-price">${ic('book')} 価格を変える</button><button class="btn ghost" id="sl-disc">${ic('trash')} 廃棄</button></div>`;
        $('#sl-price', body).onclick = () => game.openMenu('sell');
        $('#sl-disc', body).onclick = async () => { if (await UI.confirm('廃棄する', '残りのケーキを捨てます。', '捨てる', true)) { act({ t: 'discard', kind: 'case', slot: i }); UI.closeSheet(); } };
      },
    });
  };

  // =====================================================================
  //  仕入れ
  // =====================================================================
  game.openMarket = function () {
    const r = game.room;
    r.setStation('market');
    UI.openSheet({
      title: '仕入れ', live: true, key: 'market', tab: game.mkTab || 'ing',
      tabs: [{ id: 'ing', label: '材料' }, { id: 'furn', label: '家具' }, { id: 'eq', label: '設備' }],
      onClose: () => r.setStation(''),
      render(body, tab) {
        const s = S();
        game.mkTab = tab;
        if (tab === 'furn') return game.renderFurn(body, s);
        if (tab === 'eq') return game.renderEquip(body, s);
        const ev = s.mEvent && s.mEvent.id ? `<div class="banner ${s.mEvent.up ? 'pink' : 'mint'}">${D.ING[s.mEvent.id].icon} 今日は${esc(D.ING[s.mEvent.id].name)}が${s.mEvent.up ? '高騰中！' : '特売中！'}</div>` : '';
        body.innerHTML = `${ev}<div class="row between wrap"><span class="small">資金 <b class="num">${yen(s.funds)}</b></span><button class="btn sm mint" id="mk-bulk">${ic('cart')} 販売中メニュー2台分をまとめ買い</button></div>
          <div class="list">${Object.keys(D.ING).map((id) => {
            const ing = D.ING[id]; const p = s.market[id]; const n = game.mq[id] || 5; const have = sim.invCount(s, id);
            const ch = Math.round((p / ing.price - 1) * 100);
            const exp = sim.expSoon(s, id);
            const unit = p * (n >= 10 ? 0.95 : 1); const cost = Math.round(unit * n);
            return `<div class="item mk"><div class="ico">${ing.icon}</div><div class="mid"><b>${esc(ing.name)} <span class="chip ${have ? '' : 'bad'}">在庫 ${have}</span></b><small>${yen(p)}/個 <span class="${ch > 3 ? 'neg' : ch < -3 ? 'pos' : ''}">${ch > 3 ? '▲' + ch + '%' : ch < -3 ? '▼' + -ch + '%' : '±0'}</span>・${ing.life ? (exp !== null ? 'いちばん古いのはあと' + Math.max(0, exp) + '日' : '日持ち' + Math.round(ing.life * sim.eqv(s, 'fridge').life) + '日') : '日持ちする'}</small></div>
              <div class="end"><div class="step"><button data-q="${id}" data-d="-1" aria-label="減らす">${ic('minus')}</button><output>${n}</output><button data-q="${id}" data-d="1" aria-label="増やす">${ic('plus')}</button></div><button class="btn sm yellow num" data-buy="${id}" ${s.funds >= cost ? '' : 'disabled'}>${yen(cost)}</button></div></div>`;
          }).join('')}</div>
          <p class="muted small" style="margin:0">10個以上で5%オフ。生ものは期限が来ると閉店時に廃棄されます。</p>`;
        const hold = (b) => {
          let t = null, n = 0;
          const stepOnce = () => { const id = b.dataset.q; const v = clamp((game.mq[id] || 5) + +b.dataset.d * (n > 6 ? 5 : 1), 1, 99); game.mq[id] = v; n++; const o = b.parentNode.querySelector('output'); o.textContent = v; const s2 = S(); const cost = Math.round(s2.market[id] * (v >= 10 ? 0.95 : 1) * v); const bb = body.querySelector('[data-buy="' + id + '"]'); bb.textContent = yen(cost); bb.disabled = s2.funds < cost; };
          b.onpointerdown = (e) => { e.preventDefault(); n = 0; stepOnce(); t = setInterval(stepOnce, 140); const stop = () => { clearInterval(t); document.removeEventListener('pointerup', stop); }; document.addEventListener('pointerup', stop); };
        };
        $$('[data-q]', body).forEach(hold);
        $$('[data-buy]', body).forEach((b) => (b.onclick = () => { CS.sound.play('coin'); act({ t: 'buy', id: b.dataset.buy, n: game.mq[b.dataset.buy] || 5 }); }));
        $('#mk-bulk', body).onclick = () => game.bulkBuy();
      },
    });
  };
  game.bulkBuy = async function () {
    const s = S(); const need = {};
    const add = (req, k) => { for (const id in req) need[id] = (need[id] || 0) + req[id] * k; };
    Object.keys(s.menu).filter((rid) => s.menu[rid].on && s.known[rid]).forEach((rid) => { const r = sim.recipe(s, rid); add(D.BASES[r.base].ing, 2); if (r.cream !== 'none') add(D.CREAMS[r.cream].ing, 1); add(r.tops || {}, 2); });
    const buy = []; let total = 0;
    for (const id in need) { const n = Math.ceil(need[id] - sim.invCount(s, id)); if (n > 0) { const c = Math.round(s.market[id] * (n >= 10 ? 0.95 : 1) * n); buy.push({ id, n, c }); total += c; } }
    if (!buy.length) return UI.toast('いまの在庫で足りています', 'good');
    const ok = await UI.confirm('まとめ買い', `<span style="display:grid;gap:4px">${buy.map((b) => `<span>${D.ING[b.id].icon} ${esc(D.ING[b.id].name)} ×${b.n}　<b class="num">${yen(b.c)}</b></span>`).join('')}<b style="border-top:1px solid var(--line);padding-top:4px">合計 ${yen(total)}</b></span>`, '買う');
    if (!ok) return;
    if (S().funds < total) return UI.toast('資金が足りません', 'err');
    for (const b of buy) await act({ t: 'buy', id: b.id, n: b.n });
    CS.sound.play('coin');
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
    UI.openSheet({
      title: '経営', live: true, key: 'biz',
      tabs: [{ id: 'today', label: '収支' }, { id: 'trend', label: '推移' }, { id: 'level', label: 'レベル' }, { id: 'staff', label: 'アルバイト' }, { id: 'up', label: '拡張' }, { id: 'ad', label: '広告' }], tab,
      render(body, t) {
        const s = S();
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
            <div class="card"><dl class="kv"><dt>来店</dt><dd>${T.cust}人</dd><dt>販売</dt><dd>${T.sold}切れ</dd><dt>買わずに帰った</dt><dd>${T.miss}人（うち売り切れ ${T.soldout}人）</dd><dt>満足度</dt><dd>${T.cust - T.miss > 0 ? Math.round((T.sat / (T.cust - T.miss)) * 100) + '%' : '—'}</dd><dt>今日の仕入れ額</dt><dd>${yen(T.buy || 0)}</dd><dt>設備投資</dt><dd>${yen(T.capex || 0)}</dd><dt class="tot">現在の資金</dt><dd class="tot">${yen(s.funds)}</dd></dl></div>
            <p class="muted small" style="margin:0">原価＝売れたケーキに使った材料費。仕入れ額とは別に計算しています。資金が ${yen(R.BANKRUPT)} を下回ると倒産です。</p>`;
        } else if (t === 'trend') {
          body.innerHTML = s.history.length ? `<div class="card"><h3>売上と利益（直近14日）</h3><div class="chart">${chartSVG(s.history.slice(-14))}</div><div class="row small" style="gap:14px"><span><i style="display:inline-block;width:12px;height:12px;background:rgba(201,163,94,.55);border:1.5px solid var(--gold);border-radius:3px"></i> 売上</span><span><i style="display:inline-block;width:14px;height:3px;background:var(--good)"></i> 利益</span></div></div>
            <div class="card" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums"><thead><tr style="text-align:right"><th style="text-align:left">日</th><th>来店</th><th>販売</th><th>売上</th><th>利益</th><th>評判</th></tr></thead><tbody>${s.history.slice().reverse().map((h) => `<tr style="text-align:right;border-top:1px solid var(--line)"><td style="text-align:left">${h.d}</td><td>${h.cust}</td><td>${h.sold}</td><td>${yen(h.sales)}</td><td class="${h.profit >= 0 ? 'pos' : 'neg'}">${yen(h.profit)}</td><td>${h.rep.toFixed(1)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="banner">1日目の営業が終わると、ここに推移が表示されます</div>';
        } else if (t === 'level') {
          game.renderLevel(body, s);
        } else if (t === 'staff') {
          game.renderStaff(body, s);
        } else if (t === 'up') {
          const SL = sim.shopLevel(s).lv;
          body.innerHTML = `<div class="row between"><span class="small">資金 <b class="num">${yen(s.funds)}</b>・店舗 <b>Lv${SL}</b></span><span class="small muted">設備1つごとに光熱費 +${yen(R.UTIL_PER_EQUIP)}/日</span></div><div class="list">${D.UPGRADES.map((u) => {
            const lv = s.up[u.id] || 0, max = u.levels.length, cost = u.levels[lv], need = sim.upReq(u, lv);
            const cur = u.vals ? `いま ${u.vals[lv]}${u.id === 'oven' ? '台' : '台分'}` : '';
            const btn = lv >= max ? '<span class="chip ok">導入済み</span>' : SL < need ? `<span class="chip">${ic('lock')} Lv${need}</span>` : `<button class="btn sm pink num" data-up="${u.id}" ${s.funds >= cost ? '' : 'disabled'}>${yen(cost)}</button>`;
            return `<div class="card upg"><div class="ico">${ic(u.icon)}</div><div style="min-width:0;display:grid;gap:2px"><b>${esc(u.name)}</b><span class="small muted">${esc(u.desc)}${cur ? '（' + cur + '）' : ''}</span><span class="lv">${u.levels.map((_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span></div>${btn}</div>`;
          }).join('')}</div><p class="muted small" style="margin:0">機械（オーブンの機種・ミキサーなど）と家具は、厨房の「仕入れ棚」から買えます。</p>`;
          $$('[data-up]', body).forEach((b) => (b.onclick = async () => { const u = D.UPGRADES.find((x) => x.id === b.dataset.up); if (await UI.confirm(u.name, `${yen(u.levels[S().up[u.id] || 0])} で導入しますか？`, '導入する')) act({ t: 'upgrade', id: u.id }); }));
        } else if (t === 'ad') {
          body.innerHTML = `${s.phase === 'prep' ? '' : '<div class="banner">広告は「開店準備」のあいだに出せます</div>'}<div class="list">${Object.keys(D.ADS).map((k) => { const a = D.ADS[k]; return `<div class="item"><div class="ico">${ic('megaphone')}</div><div class="mid"><b>${esc(a.name)}</b><small>${a.cost ? yen(a.cost) + '・今日の来店数 ×' + a.mult : '広告を出さない'}</small></div><div class="end">${s.ad === k ? '<span class="chip ok">実施中</span>' : `<button class="btn sm" data-ad="${k}" ${s.phase === 'prep' ? '' : 'disabled'}>えらぶ</button>`}</div></div>`; }).join('')}</div><p class="muted small" style="margin:0">広告はその日だけ有効です。作れる量より客が多いと売り切れで評判が下がるので注意！</p>`;
          $$('[data-ad]', body).forEach((b) => (b.onclick = () => act({ t: 'ad', kind: b.dataset.ad })));
        }
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
  // ---------- 仕入れ棚：家具・設備 ----------
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
  game.tutorial = function () {
    const steps = [
      ['仕入れ', '「仕入れ」ボタンや冷蔵庫から材料を買います。いちご・生クリームは日持ちが短いので買いすぎ注意。'],
      ['生地 → オーブン', 'ミキサー台で生地を作り（投入順＋かき混ぜ）、オーブンへ。焼き加減メーターの緑で「取り出す」！'],
      ['冷ます → クリーム', '焼けたスポンジは冷却ラックで冷めるのを待つ間に、クリーム台で泡立て。'],
      ['デコ → 販売', 'デコ台でナッペとトッピング。完成したケーキはショーケースに並び、お客さんが買っていきます。'],
      ['価格と拡張', '「メニュー」で1切れの価格を設定。品質と価格で売れ行き・満足度が変わります。儲けたら「経営」で設備投資！'],
      ['みんなで', '4人なら役割分担（焼き係・クリーム係・デコ係・店長）がおすすめ。スタンプで声をかけ合おう。'],
    ];
    UI.modal({
      title: '遊び方',
      html: `<ol style="margin:0;padding-left:1.4em;display:grid;gap:8px">${steps.map((s) => `<li><b>${esc(s[0])}</b><br><span class="muted">${esc(s[1])}</span></li>`).join('')}</ol>`,
      buttons: [{ label: 'わかった！', cls: 'pink', value: true }],
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
