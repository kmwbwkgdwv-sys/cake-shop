/* ケーキ屋さんシミュレーター : 起動 */
(async function () {
  'use strict';
  const CS = window.CS, UI = CS.ui;
  UI.show('boot');
  $boot('ログイン中…');
  await CS.net.init();
  $boot('データを同期中…');
  try { await CS.save.init(); } catch (e) { console.error(e); }
  if (!CS.save.data) { CS.save.data = { name: 'パティシエ', skin: Object.assign({}, CS.data.DEFAULT_SKIN), shops: {}, stats: {}, edited: { name: 0, skin: 0 } }; }
  CS.applySettings();
  UI.bindTitle();
  UI.renderTitle();
  UI.show('title');

  CS.save.on('status', () => { if (UI.scr === 'title') UI.renderTitle(); });
  CS.save.on('change', (d) => {
    if (UI.scr === 'title') UI.renderTitle();
    // 別の端末で名前・きせかえを変えたら、お店のメンバー表示にも反映
    const r = UI.room;
    if (r && r.members[r.pid] && (r.members[r.pid].name !== d.name || JSON.stringify(r.members[r.pid].skin) !== JSON.stringify(d.skin))) r.updateMe();
  });
  CS.save.on('unlinked', () => UI.toast('このデータは別の端末で連携が解除されました', 'err', 4000));

  // 端末を裏に回した・閉じるときは即保存、戻ってきたら最新を取り直す
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { CS.save.flush(); if (UI.room) UI.room.saveLocal(); }
    else { CS.save.refresh(); }
  });
  window.addEventListener('pagehide', () => { CS.save.flush(); if (UI.room) UI.room.saveLocal(); });
  window.addEventListener('online', () => CS.save.refresh());
  document.addEventListener('pointerdown', () => CS.sound.unlock(), { once: true });
  // iPhone の Safari：2本指で画面が拡大されて操作できなくなるのを防ぐ
  ['gesturestart', 'gesturechange'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

  if (!CS.save.data.edited || !CS.save.data.edited.name) await UI.welcome();

  // 招待リンク (?room=XXXXXX)
  const invite = new URLSearchParams(location.search).get('room');
  if (invite) {
    history.replaceState(null, '', location.pathname);
    if (CS.net.online) UI.joinShop(invite);
    else UI.toast('オフラインのため招待リンクを開けません', 'err');
  }

  function $boot(t) { const el = document.querySelector('.boot-text'); if (el) el.textContent = t; }
})();
