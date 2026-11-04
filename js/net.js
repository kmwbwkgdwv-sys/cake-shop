/* ケーキ屋さんシミュレーター : 通信（Firebase Realtime Database）
 *  - 匿名ログイン
 *  - セーブデータのクラウド同期（rev 番号つき・競合マージ）
 *  - 引き継ぎコード
 *  - ルーム（ロビー / 共同経営 / ホスト自動交代）
 *  Firebase 未設定のときは端末内だけで遊べるオフラインモードになる
 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const sim = CS.sim;
  const ROOT = 'cakeshop/';
  const TRANSFER_TTL = 72 * 3600 * 1000;
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  // ---------- 小物 ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できない環境 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } },
  };
  function rnd(n, alpha) {
    alpha = alpha || ALPHA;
    const a = new Uint32Array(n);
    (G.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.floor(Math.random() * 4294967296)));
    return Array.from(a, (x) => alpha[x % alpha.length]).join('');
  }
  const rid = (n) => rnd(n, 'abcdefghijkmnopqrstuvwxyz23456789');
  const clean = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function emitter() {
    const m = {};
    return {
      on(e, f) { (m[e] = m[e] || []).push(f); return () => { m[e] = (m[e] || []).filter((x) => x !== f); }; },
      emit(e, ...a) { (m[e] || []).slice().forEach((f) => { try { f(...a); } catch (err) { console.error(err); } }); },
    };
  }
  function normCode(s, len) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[O]/g, '0').replace(/[I]/g, '1').slice(0, len); }

  // =====================================================================
  //  net : 接続とログイン
  // =====================================================================
  const net = Object.assign(emitter(), {
    online: false, uid: null, db: null, offset: 0, connected: false, error: '',
    async init() {
      const cfg = G.FIREBASE_CONFIG;
      if (!cfg || !cfg.apiKey || !cfg.databaseURL || !G.firebase) {
        this.online = false;
        this.uid = LS.get('cs.localUid', null) || 'L' + rid(16);
        LS.set('cs.localUid', this.uid);
        this.error = !cfg || !cfg.apiKey ? 'Firebase未設定（オフライン）' : 'Firebaseを読み込めませんでした';
        return;
      }
      try {
        if (!firebase.apps.length) firebase.initializeApp(cfg);
        const auth = firebase.auth();
        const user = await new Promise((res) => { const off = auth.onAuthStateChanged((u) => { off(); res(u); }); });
        this.uid = user ? user.uid : (await auth.signInAnonymously()).user.uid;
        this.db = firebase.database();
        this.db.ref('.info/serverTimeOffset').on('value', (s) => { this.offset = s.val() || 0; });
        this.db.ref('.info/connected').on('value', (s) => { this.connected = !!s.val(); this.emit('conn', this.connected); });
        this.online = true;
      } catch (e) {
        console.warn('[firebase]', e);
        this.online = false;
        this.error = 'オンライン接続に失敗：' + (e.code || e.message);
        this.uid = LS.get('cs.localUid', null) || 'L' + rid(16);
        LS.set('cs.localUid', this.uid);
      }
    },
    now() { return Date.now() + this.offset; },
    ref(p) { return this.db.ref(ROOT + p); },
    TS() { return firebase.database.ServerValue.TIMESTAMP; },
  });

  // =====================================================================
  //  save : プレイヤーデータ（名前・スキン・ショップ一覧）
  //   スマホ→PC で「古いデータのまま」になる不具合への対策：
  //    1) クラウドを正とし、rev（版番号）で新旧を判定する
  //    2) 起動時はクラウドの最新を受け取るまで上書き保存しない
  //    3) 保存は transaction で「自分が見ている版」からの更新だけを通す
  //       → 他端末が先に更新していたら取り込んでマージしてから保存し直す
  //    4) アプリを裏に回す・閉じる時は即座に保存し、戻ってきたら再取得
  //    5) 常に購読しているので、別端末の変更がリアルタイムに反映される
  // =====================================================================
  function defaultData() {
    return { name: 'パティシエ' + Math.floor(100 + Math.random() * 900), skin: Object.assign({}, CS.data.DEFAULT_SKIN), shops: {}, stats: { cakes: 0, days: 0 }, edited: { name: 0, skin: 0 }, created: Date.now() };
  }
  function fillData(d) {
    const x = Object.assign(defaultData(), d || {});
    x.skin = Object.assign({}, CS.data.DEFAULT_SKIN, x.skin || {});
    x.shops = x.shops || {}; x.stats = x.stats || {}; x.edited = x.edited || { name: 0, skin: 0 };
    return x;
  }
  function mergeData(remote, local) {
    const r = fillData(remote), l = fillData(local);
    const out = clone(r);
    ['name', 'skin'].forEach((f) => { if ((l.edited[f] || 0) > (r.edited[f] || 0)) { out[f] = l[f]; out.edited[f] = l.edited[f]; } });
    for (const c in l.shops) { const a = out.shops[c], b = l.shops[c]; if (!a || (b.last || 0) > (a.last || 0)) out.shops[c] = b; }
    for (const k in l.stats) out.stats[k] = Math.max(out.stats[k] || 0, l.stats[k] || 0);
    return out;
  }

  const save = Object.assign(emitter(), {
    sid: null, rev: 0, data: null, dirty: false, pushing: false, editSeq: 0, ready: false,
    status: 'idle', lastSync: 0, updatedAt: 0, ref: null, timer: null,
    setStatus(s) { this.status = s; this.emit('status', s); },
    persist() { LS.set('cs.save', { sid: this.sid, rev: this.rev, data: this.data, dirty: this.dirty, at: Date.now() }); },
    async init() {
      const cache = LS.get('cs.save', null);
      if (!net.online) {
        this.sid = (cache && cache.sid) || 'local';
        this.data = fillData(cache && cache.data);
        this.rev = (cache && cache.rev) || 0;
        this.ready = true; this.setStatus('offline');
        this.persist();
        return;
      }
      // キャッシュを先に表示しつつ、クラウドの最新を待つ
      if (cache && cache.data) { this.data = fillData(cache.data); this.rev = cache.rev || 0; this.dirty = !!cache.dirty; }
      this.setStatus('syncing');
      let sid = cache && cache.sid && cache.sid !== 'local' ? cache.sid : null;
      if (!sid) { try { sid = (await net.ref('links/' + net.uid).once('value')).val(); } catch (e) { sid = null; } }
      if (sid && (await this.attach(sid, cache && cache.sid === sid ? cache : null))) return;
      await this.create(cache && cache.data);
    },
    async create(fromData) {
      const sid = rid(20);
      const data = fillData(fromData);
      const upd = {};
      upd['saves/' + sid] = { owners: { [net.uid]: 'origin' }, rev: 1, updatedAt: net.now(), data: clean(data) };
      upd['links/' + net.uid] = sid;
      await net.db.ref(ROOT.slice(0, -1)).update(upd);
      this.sid = sid; this.rev = 0; this.data = data; this.dirty = false;
      await this.attach(sid, null);
    },
    attach(sid, cache) {
      if (this.ref) this.ref.off();
      return new Promise((resolve) => {
        let first = true;
        const ref = net.ref('saves/' + sid);
        const timeout = setTimeout(() => { if (first) { first = false; this.setStatus('error'); resolve(false); } }, 15000);
        ref.on('value', (snap) => {
          const v = snap.val();
          if (first) {
            first = false; clearTimeout(timeout);
            if (!v || !v.owners || !v.owners[net.uid]) { ref.off(); resolve(false); return; }
            this.ref = ref; this.sid = sid;
            if (cache) { this.rev = cache.rev || 0; this.dirty = !!cache.dirty; this.data = fillData(cache.data); } else { this.rev = -1; this.dirty = false; }
            this.onRemote(v);
            this.ready = true;
            resolve(true);
            return;
          }
          this.onRemote(v);
        }, (err) => {
          console.warn('[save]', err);
          if (first) { first = false; clearTimeout(timeout); resolve(false); } else this.setStatus('error');
        });
      });
    },
    onRemote(v) {
      if (!v) return;
      if (!v.owners || !v.owners[net.uid]) { this.setStatus('unlinked'); this.emit('unlinked'); return; }
      this.updatedAt = v.updatedAt || 0;
      const rrev = v.rev || 0;
      if (rrev > this.rev) {
        const before = JSON.stringify(this.data);
        this.data = this.dirty && this.data ? mergeData(v.data, this.data) : fillData(v.data);
        this.rev = rrev;
        this.persist();
        if (JSON.stringify(this.data) !== before) this.emit('change', this.data);
      }
      this.lastSync = Date.now();
      if (this.dirty) this.schedule(300); else this.setStatus('synced');
    },
    // データ変更（UI から呼ぶ）
    update(fn, field) {
      const d = this.data;
      fn(d);
      if (field) d.edited[field] = Date.now();
      this.dirty = net.online; this.editSeq++;
      this.persist();
      this.emit('change', d);
      if (net.online) this.schedule(1200);
    },
    schedule(ms) {
      clearTimeout(this.timer);
      if (!net.online || !this.ref) return;
      this.setStatus('syncing');
      this.timer = setTimeout(() => this.push(), ms);
    },
    push() {
      if (!net.online || !this.ref || !this.dirty || this.pushing) return Promise.resolve();
      this.pushing = true;
      const data = clean(this.data), base = this.rev, seq = this.editSeq;
      return new Promise((resolve) => {
        this.ref.transaction((cur) => {
          if (!cur) return; // 中断（データ未取得）
          if ((cur.rev || 0) !== base) return; // 他端末が先に更新 → 中断して取り込み直す
          cur.rev = base + 1; cur.data = data; cur.updatedAt = net.now();
          return cur;
        }, (err, committed, snap) => {
          this.pushing = false;
          if (err) { console.warn('[save push]', err); this.setStatus('error'); this.schedule(5000); resolve(); return; }
          if (committed) {
            const v = snap && snap.val();
            this.rev = v ? v.rev : base + 1;
            if (this.editSeq === seq) this.dirty = false;
            this.lastSync = Date.now();
            this.persist();
          } else {
            // 最新を取り直してマージ
            this.ref.once('value').then((s) => this.onRemote(s.val()));
          }
          if (this.dirty) this.schedule(400); else this.setStatus('synced');
          resolve();
        }, false);
      });
    },
    flush() { clearTimeout(this.timer); return this.push(); },
    refresh() { if (net.online && this.ref) return this.ref.once('value').then((s) => this.onRemote(s.val())).catch(() => {}); return Promise.resolve(); },
    // ---------- 引き継ぎコード ----------
    async issueCode() {
      if (!net.online) throw new Error('オンラインのときだけ使えます');
      await this.flush();
      for (let i = 0; i < 4; i++) {
        const code = rnd(12);
        const now = net.now();
        try {
          await net.ref('transfer/' + code).set({ saveId: this.sid, by: net.uid, createdAt: now, expiresAt: now + TRANSFER_TTL });
          LS.set('cs.lastCode', { code, exp: now + TRANSFER_TTL });
          return { code, expiresAt: now + TRANSFER_TTL };
        } catch (e) { if (i === 3) throw e; }
      }
    },
    async redeem(input) {
      if (!net.online) throw new Error('オンラインのときだけ使えます');
      const code = normCode(input, 12);
      if (code.length !== 12) throw new Error('コードは12文字です');
      const v = (await net.ref('transfer/' + code).once('value')).val();
      if (!v) throw new Error('コードが見つかりません');
      if ((v.expiresAt || 0) < net.now()) throw new Error('コードの有効期限が切れています');
      if (v.saveId === this.sid) throw new Error('これはこの端末のデータのコードです');
      const oldShops = clone((this.data && this.data.shops) || {});
      await net.ref('saves/' + v.saveId + '/owners/' + net.uid).set(code);
      await net.ref('links/' + net.uid).set(v.saveId);
      if (this.ref) this.ref.off();
      this.ref = null; this.dirty = false; this.rev = -1; this.sid = v.saveId;
      const ok = await this.attach(v.saveId, null);
      if (!ok) throw new Error('データを読み込めませんでした');
      // この端末で遊んでいたお店も一覧に残す
      if (Object.keys(oldShops).length) this.update((d) => { for (const c in oldShops) if (!d.shops[c]) d.shops[c] = oldShops[c]; });
      this.emit('change', this.data);
      return this.data;
    },
    async unlinkOthers() {
      // この端末以外の連携を解除（引き継ぎ「移動」として使いたいとき）
      if (!net.online) return;
      const owners = (await net.ref('saves/' + this.sid + '/owners').once('value')).val() || {};
      const upd = {};
      for (const u in owners) if (u !== net.uid) upd[u] = null;
      upd[net.uid] = owners[net.uid] || 'origin';
      await net.ref('saves/' + this.sid + '/owners').update(upd);
    },
    async ownersCount() { if (!net.online) return 1; const o = (await net.ref('saves/' + this.sid + '/owners').once('value')).val() || {}; return Object.keys(o).length; },
  });

  // =====================================================================
  //  Room : お店（最大4人で共同経営）
  //   ・state はホスト端末が計算して書き込む
  //   ・ほかの端末は actions に操作を積み、ホストが処理する
  //   ・ホストが落ちたら、残った端末のうち最古参が自動でホストになる
  // =====================================================================
  class Room {
    constructor(code, opts) {
      Object.assign(this, emitter());
      this.code = code; this.local = !net.online || code[0] === 'L';
      this.S = null; this.meta = null; this.members = {}; this.devices = {};
      this.isHost = false; this.queue = []; this.lastSent = {}; this.offs = []; this.light = !!(opts && opts.light);
      this.chatLog = []; this.lastFx = 0; this.loaded = false; this.pos = {}; this.posT = 0; this.lastPos = null;
    }
    get pid() { return save.sid || 'local'; }
    now() { return this.S ? sim.gt(this.S, net.now()) : 0; }
    me() { return { name: save.data.name, skin: save.data.skin }; }

    // ---------- 作成・参加 ----------
    static async create(opt) {
      const S = sim.newState({ name: opt.name, diff: opt.diff });
      if (!net.online) {
        const code = 'L' + rnd(5);
        LS.set('cs.room.' + code, { meta: { name: opt.name, diff: opt.diff, host: net.uid, created: Date.now() }, state: S });
        return code;
      }
      const meData = { name: save.data.name, skin: clean(save.data.skin), joined: net.TS() };
      for (let i = 0; i < 6; i++) {
        const code = rnd(6);
        const upd = {
          meta: { name: opt.name, diff: opt.diff, host: net.uid, created: net.TS(), v: 1 },
          ['members/' + save.sid]: meData,
          ['devices/' + net.uid]: { pid: save.sid, on: true, t: net.TS(), seen: net.TS() },
          state: clean(S),
        };
        try { await net.ref('rooms/' + code).update(upd); return code; } catch (e) {
          if (!/permission/i.test(String(e.code || e.message)) || i === 5) throw e;
        }
      }
    }
    static async join(codeIn) {
      const code = codeIn[0] === 'L' ? codeIn : normCode(codeIn, 6);
      if (code[0] === 'L' || !net.online) {
        if (!LS.get('cs.room.' + code, null)) throw new Error('この端末にそのお店はありません');
        return code;
      }
      if (code.length !== 6) throw new Error('招待コードは6文字です');
      const meta = (await net.ref('rooms/' + code + '/meta').once('value')).val();
      if (!meta) throw new Error('お店が見つかりません（コードを確認してね）');
      const members = (await net.ref('rooms/' + code + '/members').once('value')).val() || {};
      const upd = {};
      if (!members[save.sid]) {
        if (Object.keys(members).length >= CS.data.RULES.MAX_PLAYERS) throw new Error('このお店は満員です（' + CS.data.RULES.MAX_PLAYERS + '人まで）');
        upd['members/' + save.sid] = { name: save.data.name, skin: clean(save.data.skin), joined: net.TS() };
      }
      upd['devices/' + net.uid] = { pid: save.sid, on: true, t: net.TS(), seen: net.TS() };
      await net.ref('rooms/' + code).update(upd);
      return code;
    }

    // ---------- 入店 ----------
    async enter() {
      if (this.local) return this.enterLocal();
      const ref = (this.ref = net.ref('rooms/' + this.code));
      const devRef = ref.child('devices/' + net.uid);
      this.joinT = net.now();
      const posRef = ref.child('pos/' + this.pid);
      const onConn = (c) => {
        if (!c) { if (this.isHost) this.hostPaused = true; return; }
        posRef.onDisconnect().remove();
        this.lastPos = null;
        devRef.onDisconnect().update({ on: false, seen: net.TS() });
        devRef.update({ pid: this.pid, on: true, seen: net.TS(), t: this.joinT });
        if (this.hostPaused) {
          // 切断中に別の端末がホストになっていないか確かめてから再開
          ref.child('meta').once('value').then((s) => { this.meta = s.val() || {}; this.hostPaused = false; if (this.meta.host !== net.uid && this.isHost) this.stopHosting(); this.checkHost(); });
        }
      };
      this.offs.push(net.on('conn', onConn));
      onConn(net.connected);
      // 自分のメンバー情報を最新に
      ref.child('members/' + this.pid).update({ name: save.data.name, skin: clean(save.data.skin) }).catch(() => {});
      const S0 = (await ref.child('state').once('value')).val();
      this.S = sim.normalize(S0 || sim.newState({}));
      this.loaded = true;
      this.lastFx = this.S.fxi || 0;
      const sub = (path, ev, fn) => { const r = ref.child(path); r.on(ev, fn, (e) => console.warn('[room ' + path + ']', e)); this.offs.push(() => r.off(ev, fn)); };
      sub('meta', 'value', (s) => { this.meta = s.val() || {}; this.emit('meta', this.meta); this.checkHost(); });
      sub('members', 'value', (s) => { this.members = s.val() || {}; this.emit('members', this.members); });
      sub('devices', 'value', (s) => { this.devices = s.val() || {}; this.emit('members', this.members); this.checkHost(); });
      sub('pos', 'value', (s) => { this.pos = s.val() || {}; });
      sub('state', 'value', (s) => {
        if (this.isHost) return;
        const v = s.val(); if (!v) return;
        this.S = sim.normalize(v);
        this.playFx();
        this.emit('state', this.S);
      });
      const chatRef = ref.child('chat').limitToLast(20);
      const onChat = (s) => { const m = s.val(); if (!m) return; this.chatLog.push(Object.assign({ id: s.key }, m)); if (this.chatLog.length > 30) this.chatLog.shift(); this.emit('chat', m, s.key); };
      chatRef.on('child_added', onChat);
      this.offs.push(() => chatRef.off('child_added', onChat));
      this.emit('state', this.S);
    }
    enterLocal() {
      const saved = LS.get('cs.room.' + this.code, null);
      if (!saved) throw new Error('お店のデータがありません');
      this.meta = saved.meta; this.S = sim.normalize(saved.state);
      this.members = { [this.pid]: { name: save.data.name, skin: save.data.skin, joined: 0 } };
      this.devices = { [net.uid]: { pid: this.pid, on: true, t: 0 } };
      this.loaded = true; this.lastFx = this.S.fxi || 0;
      this.startHosting();
      this.emit('meta', this.meta); this.emit('members', this.members); this.emit('state', this.S);
    }

    // ---------- ホスト選出 ----------
    onlineDevices() { return Object.keys(this.devices).filter((u) => this.devices[u] && this.devices[u].on); }
    onlinePlayers() { return new Set(this.onlineDevices().map((u) => this.devices[u].pid)).size || 1; }
    isOnline(pid) { return this.onlineDevices().some((u) => this.devices[u].pid === pid); }
    checkHost() {
      if (this.local || !this.meta || !this.loaded || this.closed) return;
      const host = this.meta.host;
      const hostOn = host && this.devices[host] && this.devices[host].on;
      if (host === net.uid) { if (!this.isHost) this.startHosting(); return; }
      if (this.isHost) this.stopHosting();
      if (hostOn) { clearTimeout(this.electT); this.electT = null; return; }
      if (this.electT) return;
      this.electT = setTimeout(() => {
        this.electT = null;
        const on = this.onlineDevices().sort((a, b) => (this.devices[a].t || 0) - (this.devices[b].t || 0) || (a < b ? -1 : 1));
        if (on[0] !== net.uid) return;
        const cur0 = this.meta.host;
        this.ref.child('meta/host').transaction((cur) => (cur === cur0 || !cur || !(this.devices[cur] && this.devices[cur].on) ? net.uid : undefined)).catch(() => {});
      }, host ? 2500 : 200);
    }
    async startHosting() {
      if (this.isHost) return;
      this.isHost = true;
      if (!this.local) {
        const S0 = (await this.ref.child('state').once('value')).val();
        if (S0) this.S = sim.normalize(S0);
      }
      const n = net.now();
      const g = sim.gt(this.S, n);
      this.S.clock = { base: g, at: n, run: this.S.phase !== 'lobby' };
      this.lastSent = {};
      this.pushState(true);
      if (!this.local) {
        const aref = this.ref.child('actions');
        const onA = (s) => { if (!this.queue.some((x) => x.key === s.key)) this.queue.push({ key: s.key, a: s.val() }); };
        aref.on('child_added', onA);
        this.offA = () => aref.off('child_added', onA);
      }
      clearInterval(this.loop);
      this.loop = setInterval(() => this.hostTick(), this.light ? 500 : 250);
      this.emit('host', true);
    }
    stopHosting() {
      this.isHost = false;
      clearInterval(this.loop); this.loop = null;
      if (this.offA) { this.offA(); this.offA = null; }
      this.queue = [];
      this.emit('host', false);
    }
    setLight(v) { this.light = v; if (this.isHost) { clearInterval(this.loop); this.loop = setInterval(() => this.hostTick(), v ? 500 : 250); } }
    hostTick() {
      const S = this.S; if (!S) return;
      if (!this.local && (!net.connected || this.hostPaused)) return; // 切断中は書き込まない（古い状態で上書きしないため）
      const n = net.now();
      if (S.phase !== 'lobby' && !S.clock.run) S.clock = { base: sim.gt(S, n), at: n, run: true };
      const g = sim.gt(S, n);
      const q = this.queue.splice(0);
      for (const it of q) {
        const a = it.a;
        // 同じ操作を二度処理しない（ホスト交代のときに、処理済みの操作がもう一度届いても無視する）
        S.ak = Array.isArray(S.ak) ? S.ak : [];
        if (it.key && S.ak.indexOf(it.key) >= 0) { if (!this.local) this.ref.child('actions/' + it.key).remove().catch(() => {}); continue; }
        if (it.key) { S.ak.push(it.key); if (S.ak.length > 80) S.ak.splice(0, S.ak.length - 80); }
        if (a && a.t) {
          const res = sim.apply(S, a, g);
          if (res && res.msg) sim.fx(S, res.ok ? 'toast' : 'err', res.msg, a.by);
          if (a.t === 'deco' && res.ok) this.emit('cakeMade', a);
        }
        if (!this.local) this.ref.child('actions/' + it.key).remove().catch(() => {});
      }
      S.np = this.onlinePlayers();
      sim.tick(S, g);
      if (S.clock.run && n - S.clock.at > 4000) S.clock = { base: g, at: n, run: true };
      this.pushState(false);
      this.playFx();
      this.emit('state', S);
    }
    pushState(force) {
      const S = this.S;
      if (this.local) {
        const now = Date.now();
        if (force || !this.lastLocalSave || now - this.lastLocalSave > 3000) { this.lastLocalSave = now; this.saveLocal(); }
        return;
      }
      const upd = {};
      for (const k in S) {
        const j = JSON.stringify(S[k]);
        if (force || this.lastSent[k] !== j) { upd['state/' + k] = clean(S[k]); this.lastSent[k] = j; }
      }
      for (const k in this.lastSent) if (!(k in S)) { upd['state/' + k] = null; delete this.lastSent[k]; }
      if (Object.keys(upd).length) this.ref.update(upd).catch((e) => console.warn('[state push]', e));
    }
    saveLocal() { if (this.local && this.S) LS.set('cs.room.' + this.code, { meta: this.meta, state: this.S }); }
    playFx() {
      const S = this.S; if (!S || !S.fx) return;
      for (const f of S.fx) {
        if (f.i <= this.lastFx) continue;
        this.lastFx = f.i;
        if (f.to && f.to !== net.uid) continue;
        this.emit('fx', f);
      }
    }

    // ---------- 操作 ----------
    act(a) {
      a = Object.assign({}, a, { by: net.uid, pid: this.pid });
      if (this.isHost) {
        const res = sim.apply(this.S, a, this.now());
        if (res && res.msg) this.emit('fx', { k: res.ok ? 'toast' : 'err', x: res.msg });
        this.pushState(false);
        this.playFx();
        this.emit('state', this.S);
        return Promise.resolve(res);
      }
      if (!this.ref) return Promise.resolve({ ok: false });
      a.ts = net.TS();
      return this.ref.child('actions').push(clean(a)).then(() => ({ ok: true, pending: true })).catch((e) => ({ ok: false, msg: '送信できませんでした' }));
    }
    // 3D 上の自分の位置（ほかの人の画面に表示される）
    sendPos(p) {
      if (this.local || !this.ref || this.closed) return;
      const now = Date.now();
      if (now - this.posT < (this.light ? 300 : 150)) return;
      const l = this.lastPos;
      const moved = !l || Math.abs(l.x - p.x) > 0.03 || Math.abs(l.z - p.z) > 0.03 || Math.abs(l.r - p.r) > 0.08 || Math.abs((l.p || 0) - (p.p || 0)) > 0.1 || l.a !== p.a;
      if (!moved && now - this.posT < 4000) return;
      this.posT = now; this.lastPos = p;
      this.ref.child('pos/' + this.pid).set({ x: p.x, z: p.z, r: p.r, p: p.p || 0, a: p.a, t: net.TS() }).catch(() => {});
    }
    setStation(st) {
      if (this.local || !this.ref) { if (this.members[this.pid]) this.members[this.pid].st = st || ''; this.emit('members', this.members); return; }
      this.ref.child('members/' + this.pid + '/st').set(st || '').catch(() => {});
    }
    chat(text) {
      text = String(text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
      if (!text) return;
      if (this.local || !this.ref) { const m = { pid: this.pid, text, t: Date.now() }; this.chatLog.push(m); if (this.chatLog.length > 30) this.chatLog.shift(); this.emit('chat', m, 'l' + Date.now()); return; }
      this.ref.child('chat').push({ by: net.uid, pid: this.pid, text, t: net.TS() }).catch(() => {});
      if (this.isHost && Math.random() < 0.2) this.pruneChat();
    }
    pruneChat() {
      const r = this.ref.child('chat');
      r.once('value').then((s) => { const v = s.val() || {}; const keys = Object.keys(v).sort(); const del = {}; keys.slice(0, Math.max(0, keys.length - 30)).forEach((k) => (del[k] = null)); if (Object.keys(del).length) r.update(del); }).catch(() => {});
    }
    updateMe() {
      if (this.local) { this.members[this.pid] = Object.assign({}, this.members[this.pid], { name: save.data.name, skin: save.data.skin }); this.emit('members', this.members); return; }
      if (this.ref) this.ref.child('members/' + this.pid).update({ name: save.data.name, skin: clean(save.data.skin) }).catch(() => {});
    }
    async leave(removeMember) {
      this.closed = true;
      clearTimeout(this.electT);
      if (this.isHost) { this.hostTick(); this.stopHosting(); }
      this.offs.forEach((f) => f()); this.offs = [];
      if (this.local) { this.saveLocal(); return; }
      const devRef = this.ref.child('devices/' + net.uid);
      try {
        await devRef.onDisconnect().cancel();
        await this.ref.child('pos/' + this.pid).remove().catch(() => {});
        if (removeMember) {
          const upd = { ['devices/' + net.uid]: null };
          const others = Object.keys(this.devices).filter((u) => u !== net.uid && this.devices[u].pid === this.pid);
          others.forEach((u) => (upd['devices/' + u] = null));
          upd['members/' + this.pid] = null;
          if (this.meta && this.meta.host === net.uid) upd['meta/host'] = '';
          await this.ref.update(upd);
        } else {
          const upd = { ['devices/' + net.uid + '/on']: false, ['devices/' + net.uid + '/seen']: net.TS() };
          if (this.meta && this.meta.host === net.uid) upd['meta/host'] = '';
          await this.ref.update(upd);
        }
      } catch (e) { console.warn('[leave]', e); }
    }
  }

  // ---------- お店リスト（セーブに記録） ----------
  function rememberShop(code, name) {
    save.update((d) => { d.shops[code] = { name: String(name || '').slice(0, 20), last: Date.now() }; });
  }
  function forgetShop(code) { save.update((d) => { delete d.shops[code]; }); if (code[0] === 'L') LS.del('cs.room.' + code); }

  CS.net = net; CS.save = save; CS.Room = Room; CS.LS = LS; CS.rememberShop = rememberShop; CS.forgetShop = forgetShop; CS.normCode = normCode;
})(typeof window !== 'undefined' ? window : globalThis);
