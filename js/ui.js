/* ケーキ屋さんシミュレーター : UI 共通・タイトル・設定・きせかえ・引き継ぎ */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data, A = CS.art, net = CS.net, save = CS.save, ST = CS.settings;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = A.esc, ic = A.icon;
  const yen = (n) => (n < 0 ? '-¥' : '¥') + Math.abs(Math.round(n)).toLocaleString('ja-JP');

  const UI = (CS.ui = { $, $$, yen, esc, sheet: null, busyUntil: 0 });

  // ================= 画面切り替え =================
  UI.show = function (id) {
    $$('.screen').forEach((s) => s.classList.toggle('on', s.id === 'scr-' + id));
    UI.scr = id;
  };

  // ================= トースト =================
  UI.toast = function (msg, kind, ms) {
    if (!msg) return;
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms || (kind === 'big' ? 2600 : 2200));
  };

  // ================= モーダル =================
  UI.modal = function (o) {
    return new Promise((resolve) => {
      const m = $('#modal');
      m.innerHTML = `<div class="md panel" role="dialog" aria-modal="true" aria-labelledby="md-title"><h3 id="md-title">${esc(o.title || '')}</h3><div class="md-body">${o.html || ''}</div><div class="row end">${(o.buttons || [{ label: 'OK', value: true, cls: 'pink' }]).map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div></div>`;
      m.hidden = false;
      const done = (v) => { m.hidden = true; m.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape' && !o.sticky) done(o.cancelValue === undefined ? null : o.cancelValue); };
      document.addEventListener('keydown', onKey);
      $$('.row.end .btn', m).forEach((b) => (b.onclick = () => {
        const btn = o.buttons ? o.buttons[+b.dataset.i] : { value: true };
        if (btn.validate && !btn.validate(m)) return;
        done(typeof btn.value === 'function' ? btn.value(m) : btn.value);
      }));
      m.onclick = (e) => { if (e.target === m && !o.sticky) done(o.cancelValue === undefined ? null : o.cancelValue); };
      if (o.onOpen) o.onOpen(m, done);
      const f = $('input,button.pink,button.mint', m); if (f && f.tagName === 'INPUT') setTimeout(() => f.focus(), 50);
    });
  };
  UI.choose = (title, html, sel) => UI.modal({ title, html, buttons: [{ label: 'やめる', value: null, cls: 'ghost' }], onOpen: (m, done) => $$(sel, m).forEach((b) => (b.onclick = () => done(b.dataset.pick))) });
  UI.confirm = (title, text, ok, danger) => UI.modal({ title, html: `<p style="margin:0">${text}</p>`, buttons: [{ label: 'やめる', value: false, cls: 'ghost' }, { label: ok || 'OK', value: true, cls: danger ? 'pink' : 'mint' }], cancelValue: false });
  UI.ask = (title, label, value, max, ok) => UI.modal({
    title, html: `<label class="field"><span>${esc(label)}</span><input class="input" id="md-in" maxlength="${max || 20}" value="${esc(value || '')}"></label>`,
    buttons: [{ label: 'やめる', value: null, cls: 'ghost' }, { label: ok || '決定', cls: 'pink', value: (m) => $('#md-in', m).value.trim() }],
    onOpen: (m) => { $('#md-in', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.row.end .btn.pink', m).click(); }); },
  });
  UI.copy = function (text, el) {
    const ok = () => UI.toast('コピーしました', 'good');
    try {
      navigator.clipboard.writeText(text).then(ok, () => fallback());
    } catch (e) { fallback(); }
    function fallback() {
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      UI.toast('選択したのでコピーしてね');
    }
  };

  // ================= シート =================
  // o = { title, tabs:[{id,label}], tab, render(body, tab, sheet), live, onClose, key }
  UI.openSheet = function (o) {
    UI.closeSheet(true);
    const root = $('#sheet');
    root.innerHTML = `<div class="sh" role="dialog" aria-modal="true" aria-labelledby="sh-title"><div class="sh-head"><h2 id="sh-title">${esc(o.title)}</h2>${o.headExtra || ''}<button class="icon-btn" id="sh-x" aria-label="閉じる">${ic('close')}</button></div>${o.tabs ? `<div class="sh-tabs" role="tablist">${o.tabs.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === (o.tab || o.tabs[0].id)}">${esc(t.label)}</button>`).join('')}</div>` : ''}<div class="sh-body"></div></div>`;
    root.hidden = false;
    const sh = { o, tab: o.tab || (o.tabs ? o.tabs[0].id : null), body: $('.sh-body', root), root };
    UI.sheet = sh;
    const body = sh.body;
    $('#sh-x', root).onclick = () => UI.closeSheet();
    root.onclick = (e) => { if (e.target === root) UI.closeSheet(); };
    $$('.sh-tabs button', root).forEach((b) => (b.onclick = () => { sh.tab = b.dataset.tab; $$('.sh-tabs button', root).forEach((x) => x.setAttribute('aria-selected', x === b)); body.scrollTop = 0; UI.renderSheet(true); CS.sound.play('tap'); }));
    // 入力中はライブ更新を止める（スライダー操作が途切れないように）
    const busy = () => (UI.busyUntil = Date.now() + 1500);
    body.addEventListener('pointerdown', busy); body.addEventListener('input', busy); body.addEventListener('focusin', busy);
    body.addEventListener('pointerup', () => (UI.busyUntil = Date.now() + 250));
    UI.renderSheet(true);
    return sh;
  };
  UI.renderSheet = function (force) {
    const sh = UI.sheet; if (!sh) return;
    if (!force && (!sh.o.live || Date.now() < UI.busyUntil)) return;
    const y = sh.body.scrollTop;
    if (force) sh.o.render(sh.body, sh.tab, sh);
    else {
      // ライブ更新：見た目が変わらないときは DOM を差し替えない（押そうとしたボタンが消えないように）
      const tmp = document.createElement('div');
      sh.o.render(tmp, sh.tab, sh);
      if (tmp.innerHTML !== sh.body.innerHTML) sh.body.replaceChildren(...tmp.childNodes);
    }
    sh.body.scrollTop = y;
  };
  UI.closeSheet = function (silent) {
    const sh = UI.sheet; if (!sh) return;
    UI.sheet = null;
    const root = $('#sheet'); root.hidden = true; root.innerHTML = '';
    if (sh.o.onClose) sh.o.onClose(silent);
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.sheet && $('#modal').hidden && $('#mg').hidden) UI.closeSheet(); });

  // ================= 設定 =================
  CS.applySettings = function () {
    document.body.classList.toggle('light', !!ST.light);
    if (CS.world && CS.world.ready) CS.world.applyQuality();
    document.documentElement.style.setProperty('--btn', ST.btnScale);
    if (UI.room) UI.room.setLight(!!ST.light);
    if (UI.layoutFabs) UI.layoutFabs();
  };
  // スマホは横画面で遊ぶ：全画面にして横向きに固定（対応ブラウザのみ。iPhone の Safari は「横にしてね」表示）
  CS.landscape = function () {
    if (!(G.matchMedia && matchMedia('(pointer: coarse)').matches)) return;
    const lock = () => { try { const o = screen.orientation; if (o && o.lock) { const r = o.lock('landscape'); if (r && r.catch) r.catch(() => {}); } } catch (e) { /* 未対応 */ } };
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement && el.requestFullscreen) { const r = el.requestFullscreen({ navigationUI: 'hide' }); if (r && r.then) r.then(lock, lock); else lock(); }
      else lock();
    } catch (e) { lock(); }
  };
  UI.syncLabel = function () {
    if (!net.online) return { cls: 'offline', text: 'オフライン（この端末のみ）' };
    const s = save.status;
    if (s === 'synced') return { cls: 'online', text: 'クラウド同期済み' };
    if (s === 'syncing') return { cls: 'online', text: '同期中…' };
    if (s === 'unlinked') return { cls: 'error', text: '別の端末で連携が解除されました' };
    if (s === 'error') return { cls: 'error', text: '同期エラー（再接続を待っています）' };
    return { cls: 'online', text: 'オンライン' };
  };
  UI.openSettings = function (inGame) {
    UI.openSheet({
      title: '設定',
      tabs: [{ id: 'play', label: '操作' }, { id: 'view', label: '表示・音' }, { id: 'data', label: 'データ' }].concat(inGame ? [{ id: 'shop', label: 'お店' }] : []),
      live: false,
      render(body, tab) {
        if (tab === 'play') {
          body.innerHTML = `
          <div class="card"><h3>視点の感度</h3><p class="muted small" style="margin:0">マウス・スワイプで見回す速さ。PC はマウスを動かすだけで見回せます（画面の端に寄せると回り続けます）。</p>
            <div class="row"><input type="range" id="set-cam" min="0.3" max="2.5" step="0.05" value="${ST.camSens}"><b class="num" id="set-cam-v" style="min-width:48px;text-align:right">${ST.camSens.toFixed(2)}</b></div>
            <div class="row between"><span class="small">上下を反転</span><label class="switch"><input type="checkbox" id="set-inv" ${ST.invertY ? 'checked' : ''} aria-label="上下反転"><i></i></label></div>
            <div class="row between"><span class="small">PC：マウスを画面に固定する（FPS 方式・Esc で解除）</span><label class="switch"><input type="checkbox" id="set-lock" ${ST.lockMouse ? 'checked' : ''} aria-label="マウスを固定"><i></i></label></div></div>
          <div class="card"><h3>視野角（FOV）</h3><p class="muted small" style="margin:0">広くすると周りがよく見え、狭くすると手元が大きく見えます。</p>
            <div class="row"><input type="range" id="set-fov" min="55" max="95" step="1" value="${ST.fov}"><b class="num" id="set-fov-v" style="min-width:48px;text-align:right">${ST.fov}°</b></div>
            <div class="row between"><span class="small">歩くときの画面の揺れ</span><label class="switch"><input type="checkbox" id="set-bob" ${ST.bob ? 'checked' : ''} aria-label="画面の揺れ"><i></i></label></div></div>
          <div class="card"><h3>ボタンの大きさ</h3>
            <div class="row"><input type="range" id="set-btn" min="0.8" max="1.6" step="0.05" value="${ST.btnScale}"><b class="num" id="set-btn-v" style="min-width:48px;text-align:right">${Math.round(ST.btnScale * 100)}%</b></div></div>
          <div class="card"><h3>ボタンの位置</h3>
            <div class="seg" id="set-hand"><button data-v="right" aria-pressed="${!ST.fab && ST.hand === 'right'}">右手用（スティック左）</button><button data-v="left" aria-pressed="${!ST.fab && ST.hand === 'left'}">左手用（スティック右）</button><button data-v="free" aria-pressed="${!!ST.fab}">自由配置</button></div>
            <div class="row wrap"><button class="btn sm" id="set-edit" ${inGame ? '' : 'disabled'}>${ic('move')} スティック・ボタンを動かす</button>${inGame ? '' : '<span class="muted small">お店の中で動かせます</span>'}</div>
            <p class="muted small" style="margin:0">位置と大きさはこの端末だけに保存されます（スマホとPCで別々に設定できます）。</p></div>`;
          const fov = $('#set-fov', body), btn = $('#set-btn', body), cam = $('#set-cam', body);
          cam.oninput = () => { ST.camSens = +cam.value; $('#set-cam-v', body).textContent = ST.camSens.toFixed(2); ST.save(); };
          $('#set-inv', body).onchange = (e) => { ST.invertY = e.target.checked; ST.save(); };
          $('#set-lock', body).onchange = (e) => { ST.lockMouse = e.target.checked; ST.save(); if (!ST.lockMouse && document.pointerLockElement) document.exitPointerLock(); };
          fov.oninput = () => { ST.fov = +fov.value; $('#set-fov-v', body).textContent = ST.fov + '°'; ST.save(); };
          $('#set-bob', body).onchange = (e) => { ST.bob = e.target.checked; ST.save(); };
          btn.oninput = () => { ST.btnScale = +btn.value; $('#set-btn-v', body).textContent = Math.round(ST.btnScale * 100) + '%'; ST.save(); };
          $$('#set-hand button', body).forEach((b) => (b.onclick = () => {
            const v = b.dataset.v;
            if (v === 'free') { if (inGame) { UI.closeSheet(); UI.editFabs(); } else UI.toast('お店の中で「ボタンを動かす」から配置できます'); return; }
            ST.hand = v; ST.fab = null; ST.save(); if (UI.layoutFabs) UI.layoutFabs();
            $$('#set-hand button', body).forEach((x) => x.setAttribute('aria-pressed', x === b));
          }));
          const e = $('#set-edit', body); if (e) e.onclick = () => { UI.closeSheet(); UI.editFabs(); };
        } else if (tab === 'view') {
          body.innerHTML = `
          <div class="card"><div class="row between"><div><h3>軽量モード</h3><p class="muted small" style="margin:0">3D の解像度を下げ、影・照明の数・遠くの街並み・紙吹雪を減らし、通信の頻度も下げます。古いスマホや電池を節約したいときに。</p></div><label class="switch"><input type="checkbox" id="set-light" ${ST.light ? 'checked' : ''} aria-label="軽量モード"><i></i></label></div></div>
          <div class="card"><div class="row between"><div><h3>画質の自動調整</h3><p class="muted small" style="margin:0">動きが重い端末では、影や仕上げ処理を自動で減らしてなめらかにします。いまの画質：<b id="set-q-v">${ST.light ? '軽量モード' : ST.autoQ === false ? '標準（固定）' : (CS.world.QNAME || [])[CS.world.qlv || 0] || '標準'}</b></p></div><label class="switch"><input type="checkbox" id="set-autoq" ${ST.autoQ !== false ? 'checked' : ''} aria-label="画質の自動調整"><i></i></label></div>
            <div class="row"><button class="btn sm ghost" id="set-q-reset">${ic('sync')} 画質を標準に戻す</button></div></div>
          <div class="card"><div class="row between"><div><h3>効果音</h3><p class="muted small" style="margin:0">ほかのアプリの音楽を止めずに、いっしょに鳴ります</p></div><label class="switch"><input type="checkbox" id="set-sound" ${ST.sound ? 'checked' : ''} aria-label="効果音"><i></i></label></div>
            <div class="row"><span class="small">音量</span><input type="range" id="set-vol" min="0" max="1" step="0.05" value="${ST.vol}"></div></div>
          <div class="card"><div class="row between"><div><h3>チュートリアル・ヒント</h3><p class="muted small" style="margin:0">画面右上の「やること」を表示</p></div><label class="switch"><input type="checkbox" id="set-tips" ${ST.tips ? 'checked' : ''} aria-label="ヒント"><i></i></label></div></div>`;
          $('#set-light', body).onchange = (e) => { ST.light = e.target.checked; ST.save(); };
          const qv = () => { const el = $('#set-q-v', body); if (el) el.textContent = ST.light ? '軽量モード' : ST.autoQ === false ? '標準（固定）' : (CS.world.QNAME || [])[CS.world.qlv || 0] || '標準'; };
          $('#set-autoq', body).onchange = (e) => { ST.autoQ = e.target.checked; if (!ST.autoQ) { CS.world.qlv = 0; CS.LS.set('cs.qlv', 0); } ST.save(); qv(); };
          $('#set-q-reset', body).onclick = () => { CS.world.qlv = 0; CS.world.pf = null; CS.world.qT = performance.now(); CS.LS.set('cs.qlv', 0); CS.applySettings(); qv(); UI.toast('画質を標準に戻しました'); };
          $('#set-sound', body).onchange = (e) => { ST.sound = e.target.checked; ST.save(); CS.sound.play('ok'); };
          $('#set-vol', body).oninput = (e) => { ST.vol = +e.target.value; ST.save(); };
          $('#set-vol', body).onchange = () => CS.sound.play('coin');
          $('#set-tips', body).onchange = (e) => { ST.tips = e.target.checked; ST.save(); };
        } else if (tab === 'data') {
          UI.renderDataTab(body);
        } else if (tab === 'shop' && CS.game) {
          CS.game.renderShopSettings(body);
        }
      },
    });
  };
  UI.renderDataTab = function (body) {
    const sl = UI.syncLabel();
    const upd = save.updatedAt ? new Date(save.updatedAt).toLocaleString('ja-JP') : '—';
    body.innerHTML = `
      <div class="card"><div class="row between"><h3>同期</h3><span class="chip sync-chip ${sl.cls}"><span class="dot"></span>${esc(sl.text)}</span></div>
        <dl class="kv"><dt>クラウドの最終更新</dt><dd>${esc(upd)}</dd><dt>データの版</dt><dd>rev ${save.rev < 0 ? '—' : save.rev}</dd><dt>未送信の変更</dt><dd>${!net.online ? '—' : save.dirty ? 'あり' : 'なし'}</dd></dl>
        <button class="btn sm" id="set-sync" ${net.online ? '' : 'disabled'}>${ic('sync')} 今すぐ同期</button>
        ${net.online ? '' : `<p class="muted small" style="margin:0">${esc(net.error || 'Firebase が設定されていないため、データはこの端末だけに保存されます。')}</p>`}</div>
      <div class="card"><h3>引き継ぎ</h3><p class="muted small" style="margin:0">コードを使うと、スマホとPCなど複数の端末で同じデータを使えます。どちらで遊んでも常に最新に同期されます。</p><button class="btn pink" id="set-transfer">${ic('key')} 引き継ぎコード</button></div>
      <div class="card"><h3>プロフィール</h3><div class="row between"><span>${esc(save.data.name)}</span><button class="btn sm" id="set-name">名前を変える</button></div>
        ${CS.rank ? (() => { const m = CS.rank.mine(); return `<dl class="kv"><dt>お店のレベル（最高）</dt><dd>Lv${m.lv}</dd><dt>総売上</dt><dd>${yen(m.sales)}</dd><dt>プレイ時間</dt><dd>${CS.rank.fmtPlay(m.play)}</dd></dl><button class="btn sm" id="set-rank">${ic('trophy')} ランキングを見る</button>`; })() : ''}</div>`;
    $('#set-sync', body).onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try { await save.syncNow(); if (CS.rank) await CS.rank.push(true); UI.toast('同期しました', 'good'); } catch (err) { UI.toast(err.message || String(err), 'err'); }
      UI.renderSheet(true);
    };
    const rk = $('#set-rank', body); if (rk) rk.onclick = () => UI.openRanking();
    $('#set-transfer', body).onclick = () => UI.openTransfer();
    $('#set-name', body).onclick = async () => { const n = await UI.ask('名前を変える', '名前（12文字まで）', save.data.name, 12); if (n) { save.update((d) => (d.name = n), 'name'); if (UI.room) UI.room.updateMe(); UI.renderSheet(true); } };
  };

  // ================= 引き継ぎ =================
  UI.openTransfer = function () {
    UI.openSheet({
      title: '引き継ぎ・データ連携', live: false,
      render(body) {
        if (!net.online) {
          body.innerHTML = `<div class="banner">${ic('key')} 引き継ぎには Firebase の設定が必要です（js/firebase-config.js）。いまはこの端末だけにデータが保存されています。</div>`;
          return;
        }
        body.innerHTML = `
          <div class="card"><h3>① 今の端末でコードを発行</h3>
            <p class="muted small" style="margin:0">新しい端末でこのコードを入力すると、同じデータを両方の端末で使えます（片方で遊んだ内容は、もう片方にも自動で反映されます）。コードは発行し直すまで使えるので、コピーしてメモに貼るか、画像で保存しておこう。</p>
            <div id="tf-cb"></div></div>
          <div class="card"><h3>② 新しい端末でコードを入力</h3>
            <label class="field"><span>12文字のコード（ハイフンなしでもOK）</span><input class="input code" id="tf-in" maxlength="16" autocomplete="off" placeholder="XXXX-XXXX-XXXX"></label>
            <button class="btn mint" id="tf-redeem">${ic('sync')} 引き継ぐ</button>
            <p class="muted small" style="margin:0">この端末のプロフィールは、引き継ぎ元のものに置き換わります。この端末で遊んでいたお店は一覧に残ります。</p></div>
          <div class="card soft"><h3>連携している端末</h3><p class="muted small" style="margin:0" id="tf-own">確認中…</p><button class="btn sm ghost" id="tf-unlink">この端末以外の連携を解除</button></div>`;
        save.ownersCount().then((n) => { const el = $('#tf-own', body); if (el) el.textContent = n + '台の端末でこのデータを使っています'; });
        CS.rank.codeBox($('#tf-cb', body), { renew: true });
        $('#tf-redeem', body).onclick = async (e) => {
          const btn = e.currentTarget, v = $('#tf-in', body).value; // await のあとは e.currentTarget が消えるので先に取っておく
          if (!(await UI.confirm('データを引き継ぐ', 'この端末で、コードのデータを使えるようにします。よろしいですか？', '引き継ぐ'))) return;
          btn.disabled = true;
          try { await save.redeem(v); UI.toast('引き継ぎ完了！ようこそ ' + save.data.name + ' さん', 'big'); CS.sound.play('fanfare'); UI.closeSheet(); UI.renderTitle(); }
          catch (err) { UI.toast(err.message || String(err), 'err'); btn.disabled = false; }
        };
        $('#tf-unlink', body).onclick = async () => {
          if (!(await UI.confirm('連携を解除', 'ほかの端末ではこのデータが使えなくなります（引き継ぎ「移動」にしたいとき用）。', '解除する', true))) return;
          try { await save.unlinkOthers(); UI.toast('解除しました', 'good'); UI.renderSheet(true); } catch (err) { UI.toast('解除できませんでした', 'err'); }
        };
      },
    });
  };
  const fmtCode = (c) => c.replace(/(.{4})(?=.)/g, '$1-');

  // ================= きせかえ =================
  UI.openSkin = function () {
    const draft = Object.assign({}, D.DEFAULT_SKIN, save.data.skin);
    const AV = D.AVATAR;
    const groups = [
      { id: 'body', label: '体型' }, { id: 'face', label: '顔' }, { id: 'hair', label: '髪' }, { id: 'hat', label: '帽子' }, { id: 'wear', label: '服' }, { id: 'acc', label: '小物' },
    ];
    const optRow = (key, opts, head) => `<div class="opt-grid">${Object.keys(opts).map((v) => `<button class="opt" data-k="${key}" data-v="${v}" aria-pressed="${draft[key] === v}">${CS.models.img(head ? CS.models.thumb.face(Object.assign({}, draft, { [key]: v })) : CS.models.thumb.body(Object.assign({}, draft, { [key]: v })), head ? 'face' : 'body')}<span>${esc(opts[v])}</span></button>`).join('')}</div>`;
    const colorRow = (key, colors) => `<div class="swatches">${colors.map((c) => `<button data-k="${key}" data-c="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${(draft[key] || '').toLowerCase() === c.toLowerCase()}"></button>`).join('')}<input type="color" data-k="${key}" value="${draft[key] || '#ffffff'}" aria-label="好きな色"></div>`;
    const sec = (title, inner) => `<div class="card"><h3>${title}</h3>${inner}</div>`;
    let pv = null;
    UI.openSheet({
      title: 'きせかえ', live: false,
      tabs: groups, tab: 'body',
      headExtra: `<button class="btn sm" id="sk-rand">${ic('sync')} ランダム</button>`,
      render(body, tab) {
        let parts = '';
        if (tab === 'body') parts = sec('体型', optRow('body', AV.body, false)) + sec('身長', optRow('height', AV.height, false)) + sec('肌の色', colorRow('skin', AV.skinColors));
        if (tab === 'face') parts = sec('目', optRow('eyes', AV.eyes, true)) + sec('瞳の色', colorRow('eyeColor', AV.eyeColors)) + sec('眉', optRow('brows', AV.brows, true)) + sec('口元', optRow('mouth', AV.mouth, true)) + sec('ひげ', optRow('beard', AV.beard, true));
        if (tab === 'hair') parts = sec('髪型', optRow('hair', AV.hair, true)) + sec('髪の色', colorRow('hairColor', AV.hairColors));
        if (tab === 'hat') parts = sec('帽子', optRow('hat', AV.hat, true)) + sec('帽子の色', colorRow('hatColor', AV.clothColors));
        if (tab === 'wear') parts = sec('トップス', optRow('clothes', AV.clothes, false)) + sec('トップスの色', colorRow('clothesColor', AV.clothColors)) + sec('パンツの色', colorRow('pantsColor', AV.pantsColors)) + sec('エプロン', optRow('apron', AV.apron, false)) + sec('エプロンの色', colorRow('apronColor', AV.apronColors)) + sec('エプロンの柄', optRow('pattern', AV.pattern, false));
        if (tab === 'acc') parts = sec('小物', optRow('acc', AV.acc, false)) + sec('小物の色', colorRow('accColor', ['#B8862E', '#C0C4C8', '#7A1F2B', '#2F4858', '#1F1F22', '#E9E4DA']));
        if (!$('.skin-ed', body)) {
          body.innerHTML = `<div class="skin-ed"><div class="skin-prev"><div class="av3d" id="sk-prev"></div><div style="display:grid;gap:8px;justify-items:center"><b>${esc(save.data.name)}</b><span class="muted small">ドラッグで回転</span><button class="btn pink" id="sk-save">${ic('check')} 保存</button></div></div><div class="skin-parts"></div></div>`;
          pv = CS.models.preview3d($('#sk-prev', body), draft);
          $('#sk-save', body).onclick = () => {
            save.update((d) => { d.skin = Object.assign({}, draft); }, 'skin');
            if (UI.room) UI.room.updateMe();
            CS.sound.play('ok'); UI.toast('きせかえを保存しました', 'good');
            UI.closeSheet();
          };
        }
        $('.skin-parts', body).innerHTML = parts;
        const prev = () => pv && pv.set(Object.assign({}, draft));
        prev();
        $$('.opt', body).forEach((b) => (b.onclick = () => { draft[b.dataset.k] = b.dataset.v; CS.sound.play('tap'); UI.renderSheet(true); }));
        $$('.swatches button', body).forEach((b) => (b.onclick = () => { draft[b.dataset.k] = b.dataset.c; CS.sound.play('tap'); UI.renderSheet(true); }));
        $$('.swatches input[type=color]', body).forEach((inp) => { inp.oninput = () => { draft[inp.dataset.k] = inp.value; prev(); }; inp.onchange = () => UI.renderSheet(true); });
        const bl = $('#sk-blush', body); if (bl) bl.onchange = () => { draft.blush = bl.checked; prev(); };
      },
      onClose() { if (pv) pv.stop(); pv = null; if (UI.scr === 'title') UI.renderTitle(); },
    });
    $('#sk-rand').onclick = () => { const r = CS.models.customerSkin(['student', 'worker', 'parent', 'gourmet', 'tourist', 'elder'][Math.floor(Math.random() * 6)], Math.floor(Math.random() * 12)); Object.assign(draft, r, { hat: draft.hat, apron: draft.apron, apronColor: draft.apronColor, clothes: Math.random() < 0.6 ? 'coat' : r.clothes }); CS.sound.play('pop'); UI.renderSheet(true); };
  };

  // ================= タイトル =================
  UI.renderTitle = function () {
    const d = save.data;
    $('#me-av').innerHTML = CS.models.img(CS.models.thumb.body(d.skin), 'body');
    $('#me-name').textContent = d.name;
    if (CS.rank) {
      let ms = $('#me-stats'); if (!ms) { ms = document.createElement('span'); ms.id = 'me-stats'; ms.className = 'me-stats'; $('#me-name').after(ms); }
      const m = CS.rank.mine(d); ms.textContent = 'Lv' + m.lv + '・総売上 ' + CS.rank.fmtYen(m.sales) + '・' + CS.rank.fmtPlay(m.play);
    }
    const sl = UI.syncLabel();
    const chip = $('#me-sync');
    chip.className = 'chip sync-chip ' + sl.cls; chip.innerHTML = '<span class="dot"></span>' + esc(sl.text);
    const shops = Object.keys(d.shops || {}).filter((c) => !(c[0] === 'L' && !CS.LS.get('cs.room.' + c, null))).map((c) => Object.assign({ code: c }, d.shops[c])).sort((a, b) => (b.last || 0) - (a.last || 0));
    const cont = $('#btn-continue');
    if (shops.length) { cont.hidden = false; $('small', cont).textContent = shops[0].name + (shops[0].code[0] === 'L' ? '' : '（' + shops[0].code + '）'); cont.dataset.code = shops[0].code; }
    else cont.hidden = true;
    $('#title-foot').textContent = net.online ? 'オンライン：最大4人で1つのお店を共同経営できます' : (net.error || 'オフライン') + '：ひとりで遊べます';
  };
  UI.openShops = function () {
    UI.openSheet({
      title: 'マイショップ', live: false,
      render(body) {
        const d = save.data;
        const shops = Object.keys(d.shops || {}).map((c) => Object.assign({ code: c }, d.shops[c])).sort((a, b) => (b.last || 0) - (a.last || 0));
        if (!shops.length) { body.innerHTML = `<div class="banner sky">まだお店がありません。「お店をつくる」から始めよう！</div>`; return; }
        body.innerHTML = `<div class="list">${shops.map((s) => `<div class="item"><div class="ico">${ic(s.code[0] === 'L' ? 'home' : 'people')}</div><div class="mid"><b>${esc(s.name || 'お店')}</b><small>${s.code[0] === 'L' ? 'オフライン（この端末）' : '招待コード ' + esc(s.code)}・${s.last ? new Date(s.last).toLocaleDateString('ja-JP') : ''}</small></div><div class="end"><button class="btn sm ghost" data-del="${esc(s.code)}" aria-label="一覧から消す">${ic('trash')}</button><button class="btn sm pink" data-go="${esc(s.code)}">入る</button></div></div>`).join('')}</div>`;
        $$('[data-go]', body).forEach((b) => (b.onclick = () => { UI.closeSheet(); CS.game.enter(b.dataset.go); }));
        $$('[data-del]', body).forEach((b) => (b.onclick = async () => {
          const c = b.dataset.del;
          if (!(await UI.confirm('一覧から消す', c[0] === 'L' ? 'このオフラインのお店のデータを削除します。元に戻せません。' : '一覧から消します（お店そのものは残ります。招待コードでまた入れます）。', '消す', true))) return;
          CS.forgetShop(c); UI.renderSheet(true); UI.renderTitle();
        }));
      },
    });
  };
  UI.newShop = async function () {
    let diff = 'normal';
    const r = await UI.modal({
      title: 'お店をつくる',
      html: `<div style="display:grid;gap:12px"><label class="field"><span>お店の名前</span><input class="input" id="ns-name" maxlength="16" value="${esc(save.data.name)}のケーキ屋さん"></label>
        <div class="field"><span>むずかしさ（ゲージの緑の幅・焼き加減の厳しさ）</span><div class="seg" id="ns-diff">${Object.keys(D.DIFF).map((k) => `<button data-v="${k}" aria-pressed="${k === diff}">${D.DIFF[k].name}</button>`).join('')}</div><small class="muted" id="ns-note">${D.DIFF[diff].note}</small></div>
        <div class="banner ${net.online ? 'mint' : ''}">${net.online ? '作ったあと、招待コードで最大4人まで参加できます。ひとりで遊ぶこともできます。' : 'オフラインなので、この端末でひとりで遊ぶお店になります。'}</div></div>`,
      buttons: [{ label: 'やめる', value: null, cls: 'ghost' }, { label: 'つくる！', cls: 'pink', value: (m) => ({ name: $('#ns-name', m).value.trim() || 'ケーキ屋さん', diff }) }],
      onOpen(m) { $$('#ns-diff button', m).forEach((b) => (b.onclick = () => { diff = b.dataset.v; $$('#ns-diff button', m).forEach((x) => x.setAttribute('aria-pressed', x === b)); $('#ns-note', m).textContent = D.DIFF[diff].note; })); },
    });
    if (!r) return;
    UI.loading(true, 'お店を準備中…');
    try {
      const code = await CS.Room.create(r);
      CS.rememberShop(code, r.name);
      await CS.game.enter(code);
    } catch (e) { console.error(e); UI.toast('お店をつくれませんでした：' + (e.code || e.message), 'err'); }
    UI.loading(false);
  };
  UI.joinShop = async function (preset) {
    const code = preset || (await UI.modal({
      title: 'お店に参加',
      html: `<label class="field"><span>招待コード（6文字）</span><input class="input code" id="js-code" maxlength="8" autocomplete="off" placeholder="ABC123"></label><p class="muted small" style="margin:0">お店をつくった人の画面に表示されています。</p>`,
      buttons: [{ label: 'やめる', value: null, cls: 'ghost' }, { label: '参加する', cls: 'mint', value: (m) => $('#js-code', m).value }],
      onOpen: (m) => { $('#js-code', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.row.end .btn.mint', m).click(); }); },
    }));
    if (!code) return;
    if (!net.online) { UI.toast('オフラインでは参加できません（Firebase の設定が必要です）', 'err'); return; }
    UI.loading(true, 'お店に向かっています…');
    try {
      const c = await CS.Room.join(code);
      await CS.game.enter(c);
    } catch (e) { UI.toast(e.message || String(e), 'err'); }
    UI.loading(false);
  };
  UI.loading = function (on, text) {
    let el = $('#loading');
    if (!on) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'loading'; el.className = 'overlay'; el.style.position = 'fixed'; el.style.zIndex = 70; document.body.appendChild(el); }
    el.innerHTML = `<div class="panel ov-card" style="justify-items:center"><div class="boot-cake">${CS.models.img(CS.models.thumb.cake(D.RECIPES.short), 'thumb')}</div><b>${esc(text || '読み込み中…')}</b></div>`;
  };
  UI.welcome = async function () {
    const n = await UI.modal({
      title: 'ようこそ！', sticky: true,
      html: `<div style="display:grid;gap:10px;justify-items:center"><div style="width:120px">${CS.models.img(CS.models.thumb.body(save.data.skin), 'body')}</div><p style="margin:0;text-align:center">あなたはケーキ屋さんのパティシエ。<br>まずは名前を教えてね。</p><label class="field" style="width:100%"><span>名前（12文字まで）</span><input class="input" id="md-in" maxlength="12" value="${esc(save.data.name)}"></label></div>`,
      buttons: [{ label: 'きめた！', cls: 'pink', value: (m) => $('#md-in', m).value.trim() }],
    });
    if (n) save.update((d) => (d.name = n), 'name');
    UI.renderTitle();
    UI.toast('「きせかえ」で見た目を細かく変えられるよ', 'good', 3200);
  };

  UI.bindTitle = function () {
    $('#btn-continue').onclick = (e) => CS.game.enter(e.currentTarget.dataset.code);
    $('#btn-new').onclick = () => UI.newShop();
    $('#btn-join').onclick = () => UI.joinShop();
    $('#btn-shops').onclick = () => UI.openShops();
    $('#btn-skin').onclick = () => UI.openSkin();
    $('#btn-transfer').onclick = () => UI.openTransfer();
    const br = $('#btn-rank'); if (br) br.onclick = () => UI.openRanking();
    $('#btn-settings').onclick = () => UI.openSettings(false);
    $('#me-edit').onclick = () => UI.openSkin();
    // 降ってくるスプリンクル
    const sky = $('.title-sky');
    const cols = ['#FF5C8A', '#FFCF4A', '#3CC4A8', '#7CC4F2', '#B79CFF', '#fff'];
    sky.innerHTML = Array.from({ length: 18 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${cols[i % cols.length]};animation-duration:${7 + (i % 5) * 2}s;animation-delay:-${i * 1.3}s;transform:rotate(${i * 40}deg)"></i>`).join('');
  };
})(typeof window !== 'undefined' ? window : globalThis);
