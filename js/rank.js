/* ケーキ屋さんシミュレーター : ランキング・プレイ記録・起動時の引き継ぎコード／同期の確認
 *  - プレイ時間：お店の画面にいて、画面が見えている間だけ数える（1分ごとにセーブ・クラウドへ）
 *  - 総売上：遊んだお店の売上の合計（お店をつくった人は最初から、あとから参加した人は参加してからの分）
 *  - お店のレベル：遊んだお店のうち一番高いレベル
 *  - ランキングは cakeshop/ranking/{セーブID} に自分の記録を書き、上位100人を読む
 */
(function (G) {
  'use strict';
  const CS = G.CS;
  const sim = CS.sim, net = CS.net, save = CS.save, UI = CS.ui, A = CS.art;
  const $ = UI.$, $$ = UI.$$, esc = UI.esc, yen = UI.yen, ic = A.icon;
  const clean = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
  const R = (CS.rank = { acc: 0, lastPush: 0, lastSig: '', phase: '', LIMIT: 100 });

  // ---------- 表示用 ----------
  R.fmtPlay = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h) return h + '時間' + (m ? m + '分' : '');
    return m ? m + '分' : sec > 0 ? '1分未満' : '0分';
  };
  R.fmtYen = function (n) {
    n = Math.round(n || 0);
    if (n >= 1e8) return '¥' + (n / 1e8).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + '億';
    if (n >= 1e5) return '¥' + (n / 1e4).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + '万';
    return yen(n);
  };

  // ---------- 自分の記録 ----------
  R.mine = function (d) {
    d = d || save.data || {};
    const st = d.stats || {};
    let best = null;
    for (const c in d.shops || {}) { const s = d.shops[c]; if (s && s.lv && (!best || s.lv > best.lv || (s.lv === best.lv && (s.sales || 0) > (best.sales || 0)))) best = s; }
    return { lv: Math.max(1, st.lv || 1, best ? best.lv : 1), sales: Math.max(0, Math.round(st.sales || 0)), play: Math.max(0, Math.round(st.play || 0)), shop: best ? best.name || '' : '' };
  };
  // お店をつくった人か（いちばん最初に入ったメンバー。オフラインのお店は自分のお店）
  R.isCreator = function (room) {
    if (!room) return false;
    if (room.local || String(room.code)[0] === 'L') return true;
    const ms = room.members || {};
    let first = null;
    for (const p in ms) { const j = +((ms[p] || {}).joined) || 0; if (j && (!first || j < first.j)) first = { p, j }; }
    return !first || first.p === room.pid;
  };
  // お店の記録をセーブデータに足す（d は save.data。テストからも呼ぶ）
  R.apply = function (d, room, addSec) {
    const st = d.stats || (d.stats = {});
    st.play = Math.round((st.play || 0) + (addSec || 0));
    const S = room && room.S;
    if (S && room.code) {
      d.shops = d.shops || {};
      const sh = d.shops[room.code] || (d.shops[room.code] = { name: (room.meta && room.meta.name) || S.name || 'お店', last: Date.now() });
      const life = Math.round(S.life || 0), lv = sim.shopLevel(S).lv;
      let prev = sh.sales;
      if (!(prev >= 0)) prev = R.isCreator(room) ? 0 : life; // あとから参加したお店は、参加してからの売上だけ
      if (life > prev) st.sales = Math.round((st.sales || 0) + (life - prev));
      sh.sales = life;
      sh.lv = lv;
      sh.name = (room.meta && room.meta.name) || S.name || sh.name;
      st.lv = Math.max(st.lv || 1, lv);
    }
    return d;
  };
  // 1秒ごと：お店の画面にいて、画面が見えている間だけプレイ時間を数える
  R.tick = function () {
    const room = UI.room;
    if (!room || !room.S || UI.scr !== 'game' || (G.document && document.hidden)) return;
    R.acc += 1;
    const ph = room.S.phase;
    if (ph !== R.phase) { const was = R.phase; R.phase = ph; if (ph === 'report' && was) { R.commit(); return; } }
    if (R.acc >= 60) R.commit();
  };
  // 記録をセーブデータへ（クラウドにも同期される）→ ランキングへ
  R.commit = function () {
    const room = UI.room, add = Math.round(R.acc);
    R.acc = 0;
    if (!save.data || (!add && !(room && room.S))) return;
    save.update((d) => R.apply(d, room, add));
    R.push();
  };
  // ランキングに自分の記録を書く（オンラインのときだけ。変わっていなければ書かない）
  R.entry = function () {
    const d = save.data, m = R.mine(d), sales = Math.min(m.sales, 1e12 - 1), lv = Math.min(99, m.lv);
    return { name: String(d.name || 'パティシエ').slice(0, 24), shop: String(m.shop || '').slice(0, 40), lv, lvs: lv * 1e12 + sales, sales, play: m.play, skin: clean(d.skin || {}) };
  };
  R.push = function (force) {
    if (!net.online || !save.sid || save.sid === 'local' || !save.data) return Promise.resolve(false);
    const e = R.entry();
    if (!e.play && !e.sales) return Promise.resolve(false); // まだ遊んでいない人はのせない
    const sig = JSON.stringify(e);
    if (!force && sig === R.lastSig) return Promise.resolve(false);
    e.t = net.TS();
    return net.ref('ranking/' + save.sid).set(e).then(() => { R.lastSig = sig; R.lastPush = Date.now(); return true; }, (err) => { console.warn('[ranking]', err); R.err = String((err && (err.code || err.message)) || err); return false; });
  };
  // 上位を読む（並べ替えは手元でも）
  R.fetch = async function (key) {
    const snap = await net.ref('ranking').orderByChild(key).limitToLast(R.LIMIT).once('value');
    const v = snap.val() || {};
    const list = Object.keys(v).map((id) => Object.assign({ id }, v[id])).filter((x) => x && typeof x[key] === 'number');
    list.sort((a, b) => b[key] - a[key] || (b.sales || 0) - (a.sales || 0) || (b.play || 0) - (a.play || 0));
    return list.slice(0, R.LIMIT);
  };
  if (G.setInterval && G.document) setInterval(R.tick, 1000);

  // =====================================================================
  //  ランキングの画面
  // =====================================================================
  const TABS = [{ id: 'sales', label: '総売上' }, { id: 'lvs', label: 'お店のレベル' }, { id: 'play', label: 'プレイ時間' }];
  const medal = (i) => (i < 3 ? `<span class="rk-n m${i + 1}">${i + 1}</span>` : `<span class="rk-n">${i + 1}</span>`);
  UI.openRanking = function () {
    const cache = {}, state = {};
    if (UI.room) R.commit(); else R.push();
    const load = (key, force) => {
      if (state[key] === 'loading' || (cache[key] && !force)) return;
      state[key] = 'loading';
      R.push().then(() => R.fetch(key)).then((list) => { cache[key] = { list, at: Date.now() }; state[key] = 'ok'; }, (err) => { console.warn('[ranking]', err); state[key] = 'err:' + String((err && (err.code || err.message)) || err); })
        .then(() => { if (UI.sheet && UI.sheet.o.rank) UI.renderSheet(true); });
    };
    UI.openSheet({
      title: 'ランキング', tabs: TABS, live: false, rank: true,
      render(body, tab) {
        const m = R.mine(), me = save.sid;
        const myCard = `<div class="card rk-me"><div class="rk-me-h"><span class="rk-av" data-me="1"></span><div class="mid"><b>${esc(save.data.name)}</b><small>${m.shop ? esc(m.shop) : 'まだお店で遊んでいません'}</small></div><span class="rk-pos" id="rk-pos"></span></div>
          <div class="rk-stats"><div><small>お店のレベル</small><b>Lv${m.lv}</b></div><div><small>総売上</small><b>${yen(m.sales)}</b></div><div><small>プレイ時間</small><b>${R.fmtPlay(m.play)}</b></div></div></div>`;
        if (!net.online) {
          body.innerHTML = myCard + `<div class="banner">${ic('lock')} ランキングはオンラインのときだけ見られます（Firebase の設定が必要です）。</div>`;
          paintAvatars(body);
          return;
        }
        const c = cache[tab], st = state[tab] || '';
        if (!c && st !== 'loading' && !st.startsWith('err')) load(tab);
        let list = '';
        if (c) {
          const rows = c.list.map((x, i) => {
            const main = tab === 'sales' ? R.fmtYen(x.sales) : tab === 'lvs' ? 'Lv' + x.lv : R.fmtPlay(x.play);
            const sub = [tab !== 'lvs' ? 'Lv' + x.lv : R.fmtYen(x.sales), tab !== 'play' ? R.fmtPlay(x.play) : R.fmtYen(x.sales)].join('・');
            return `<div class="rk-row ${x.id === me ? 'me' : ''}">${medal(i)}<span class="rk-av" data-i="${i}"></span><div class="mid"><b>${esc(x.name || '？')}${x.id === me ? ' <span class="chip">あなた</span>' : ''}</b><small>${esc(x.shop || '')}</small></div><div class="rk-v"><b>${main}</b><small>${sub}</small></div></div>`;
          }).join('');
          list = c.list.length ? `<div class="rk-list">${rows}</div>` : '<div class="banner sky">まだだれもいません。お店で遊ぶと、ここにのります！</div>';
        } else if (st.startsWith('err')) {
          list = `<div class="banner">${ic('lock')} ランキングを読み込めませんでした。${/permission/i.test(st) ? 'Firebase のルール（database.rules.json）を新しいものにしてください。' : '通信を確認してね。'}</div>`;
        } else list = '<div class="banner sky">読み込み中…</div>';
        body.innerHTML = myCard + list + `<div class="row between rk-foot"><small class="muted">${c ? '上位' + R.LIMIT + '人・' + new Date(c.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) + ' 時点' : ''}<br>プレイ時間・売上・レベルは、お店で遊ぶと1分ごとに更新されます</small><button class="btn sm" id="rk-reload">${ic('sync')} 更新</button></div>`;
        const pos = $('#rk-pos', body);
        if (c && pos) { const i = c.list.findIndex((x) => x.id === me); pos.innerHTML = i >= 0 ? `<b>${i + 1}</b>位` : `<small>${R.LIMIT}位より下</small>`; }
        $('#rk-reload', body).onclick = () => { state[tab] = ''; load(tab, true); UI.renderSheet(true); };
        paintAvatars(body, c && c.list);
      },
    });
  };
  // アバター（顔の絵）は1フレームに1人ずつ描く（一度に描くと固まるので）
  function paintAvatars(body, list) {
    const els = $$('.rk-av', body);
    let i = 0;
    const step = () => {
      if (!UI.sheet || !body.isConnected) return;
      for (let n = 0; n < 2 && i < els.length; n++, i++) {
        const el = els[i], skin = el.dataset.me ? save.data.skin : list && list[+el.dataset.i] && list[+el.dataset.i].skin;
        if (!skin || el.firstChild) continue;
        const src = CS.models.thumb.face(skin);
        if (src) el.innerHTML = `<img src="${src}" alt="" draggable="false">`;
      }
      if (i < els.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // =====================================================================
  //  引き継ぎコード：表示・コピー・画像で保存
  // =====================================================================
  const fmtCode = (c) => String(c || '').replace(/(.{4})(?=.)/g, '$1-');
  R.fmtCode = fmtCode;
  // コードを書いたカード画像（PNG）
  R.codeImage = function (code) {
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 640;
    const g = cv.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 640); bg.addColorStop(0, '#2A221D'); bg.addColorStop(1, '#1B1613');
    g.fillStyle = bg; g.fillRect(0, 0, 1080, 640);
    g.strokeStyle = 'rgba(201,163,94,.6)'; g.lineWidth = 4; g.strokeRect(24, 24, 1032, 592);
    g.fillStyle = '#E2C68E'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center';
    g.fillText('ケーキ屋さんシミュレーター', 540, 118);
    g.fillStyle = '#F2EBE1'; g.font = '34px sans-serif'; g.fillText('引き継ぎコード', 540, 190);
    g.fillStyle = 'rgba(201,163,94,.12)'; g.fillRect(90, 232, 900, 150);
    g.fillStyle = '#FFFFFF'; g.font = 'bold 92px monospace'; g.fillText(fmtCode(code), 540, 340);
    g.fillStyle = '#C4B8AA'; g.font = '30px sans-serif';
    g.fillText('プレイヤー：' + String(save.data.name || ''), 540, 450);
    g.fillText('発行：' + new Date().toLocaleDateString('ja-JP'), 540, 498);
    g.fillStyle = '#F0A090'; g.font = '26px sans-serif';
    g.fillText('このコードは人に見せないでね（同じデータを使えてしまいます）', 540, 572);
    return cv;
  };
  R.saveImage = async function (code) {
    const cv = R.codeImage(code);
    const url = cv.toDataURL('image/png');
    const blob = await new Promise((res) => (cv.toBlob ? cv.toBlob(res, 'image/png') : res(null)));
    const name = 'cake-shop-code-' + code + '.png';
    try {
      if (blob && G.File && navigator.canShare) {
        const file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '引き継ぎコード' }); return { ok: true, url }; }
      }
    } catch (e) { if (e && e.name === 'AbortError') return { ok: false, url }; }
    try { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { /* 画像を長押しで保存してもらう */ }
    return { ok: true, url };
  };
  R.copyCode = async function (code) {
    try { await navigator.clipboard.writeText(code); UI.toast('コピーしました（メモに貼り付けて保存してね）', 'good', 2600); return true; }
    catch (e) { UI.copy(code); return true; }
  };
  // コードの欄（起動時の確認と「引き継ぎ」の両方で使う）。onSaved：コピー・画像保存したら呼ぶ
  R.codeBox = function (box, opt) {
    opt = opt || {};
    const draw = (r) => {
      box.innerHTML = r
        ? `<div class="invite"><span class="small">引き継ぎコード</span><div class="code">${fmtCode(r.code)}</div><span class="small">${r.reused ? '発行済みのコードです（' + (r.at ? new Date(r.at).toLocaleDateString('ja-JP') + ' 発行・' : '') + '発行し直すまで使えます）' : '発行しました（発行し直すまで使えます）'}</span>
            <div class="row" style="justify-content:center;flex-wrap:wrap"><button class="btn sm" data-c="copy">${ic('copy')} コピー</button><button class="btn sm" data-c="img">${ic('download')} 画像で保存</button></div>
            <div class="cb-img" hidden></div></div>${opt.renew ? `<button class="btn sm ghost" data-c="renew">発行し直す（前のコードは使えなくなります）</button>` : ''}`
        : `<button class="btn pink" data-c="issue">${ic('key')} ${save.currentCode() ? 'コードを表示する' : 'コードを発行する'}</button>`;
      $$('[data-c]', box).forEach((b) => (b.onclick = () => act(b.dataset.c, b)));
    };
    let cur = null;
    const act = async (c, b) => {
      if (c === 'issue' || c === 'renew') {
        if (c === 'renew' && !(await UI.confirm('コードを発行し直す', '前のコードは使えなくなります（もう引き継いである端末はそのまま使えます）。', '発行し直す'))) return;
        b.disabled = true;
        try { cur = await save.issueCode(c === 'renew'); draw(cur); CS.sound.play('ok'); if (opt.onIssued) opt.onIssued(cur); }
        catch (err) { UI.toast('発行できませんでした：' + (err.message || err), 'err'); b.disabled = false; if (opt.onError) opt.onError(err); }
        return;
      }
      if (!cur) return;
      if (c === 'copy') { await R.copyCode(cur.code); if (opt.onSaved) opt.onSaved('copy'); }
      if (c === 'img') {
        const r = await R.saveImage(cur.code);
        const im = $('.cb-img', box);
        if (im) { im.hidden = false; im.innerHTML = `<img src="${r.url}" alt="引き継ぎコードの画像"><small class="muted">保存できないときは、画像を長押しして「写真に保存」</small>`; }
        if (r.ok && opt.onSaved) opt.onSaved('img');
      }
    };
    draw(null);
    return { show: () => act('issue', $('[data-c=issue]', box) || document.createElement('button')) };
  };

  // =====================================================================
  //  起動時：引き継ぎコードをまだ発行していなければ、発行と保存・データ同期を押してから始める
  // =====================================================================
  // 一度コードを発行したら（ほかの端末で発行・引き継ぎした場合も、セーブデータに入っているので）もう出さない
  R.needGate = () => !!(net.online && save.data && !save.currentCode());
  UI.dataGate = function () {
    if (!R.needGate()) return Promise.resolve();
    const lastSync = CS.LS.get('cs.lastSync', 0);
    return UI.modal({
      title: 'データを守ろう', sticky: true,
      html: `<div class="gate">
        <p class="muted small" style="margin:0">機種変更やブラウザのデータ削除で消えないように、最初に引き継ぎコードを発行して保存しておこう（この画面は発行するまで出ます。あとからは「引き継ぎ」でいつでも見られます）。</p>
        <div class="gate-step" id="gs1"><div class="gs-h"><span class="gs-n">1</span><b>引き継ぎコードを発行して保存</b><span class="gs-ok">${ic('check')}</span></div>
          <div id="gs1-box"></div><small class="muted">「コピー」してメモに貼るか、「画像で保存」してね。新しい端末で「引き継ぎ」に入力するとデータを戻せます。</small></div>
        <div class="gate-step" id="gs2"><div class="gs-h"><span class="gs-n">2</span><b>データを同期</b><span class="gs-ok">${ic('check')}</span></div>
          <div class="row between"><button class="btn mint" id="gs2-btn">${ic('sync')} データ同期</button><small class="muted" id="gs2-t">${lastSync ? '前回：' + new Date(lastSync).toLocaleString('ja-JP') : 'まだ同期していません'}</small></div></div>
      </div>`,
      buttons: [{ label: 'はじめる', cls: 'pink', value: true }],
      onOpen(m) {
        const go = $('.row.end .btn', m), done = { 1: false, 2: false };
        const upd = () => { go.disabled = !(done[1] && done[2]); go.textContent = go.disabled ? (!done[1] ? '①を済ませてね' : '②を済ませてね') : 'はじめる'; if (!go.disabled) try { go.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* noop */ } };
        const ok = (n) => { done[n] = true; $('#gs' + n, m).classList.add('done'); upd(); };
        R.codeBox($('#gs1-box', m), {
          onSaved: () => ok(1),
          onError: () => { if (!net.connected) { ok(1); UI.toast('オフラインのため、つながったときに発行してね', 'err', 3000); } },
        });
        $('#gs2-btn', m).onclick = async (e) => {
          const b = e.currentTarget; b.disabled = true; b.innerHTML = `${ic('sync')} 同期中…`;
          try {
            const t = await save.syncNow();
            await R.push(true);
            $('#gs2-t', m).textContent = '同期しました：' + new Date(t).toLocaleString('ja-JP');
            CS.sound.play('ok'); ok(2);
          } catch (err) {
            $('#gs2-t', m).textContent = err.message || String(err);
            if (!net.connected) { ok(2); $('#gs2-t', m).textContent = 'オフラインです。つながると自動で同期します'; }
          }
          b.disabled = false; b.innerHTML = `${ic('sync')} データ同期`;
        };
        upd();
      },
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
