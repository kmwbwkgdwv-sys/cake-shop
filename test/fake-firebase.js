// テスト用：Firebase compat SDK の代わり（fakedb-server.js に WebSocket で接続）
(function () {
  const ws = new WebSocket('ws://localhost:' + (window.FAKE_PORT || 8790));
  let rid = 0, sid = 0; const waits = {}, subs = {}, queue = []; let open = false;
  const connCbs = [];
  ws.onopen = () => { open = true; queue.splice(0).forEach((m) => ws.send(m)); connCbs.forEach((f) => f(true)); };
  ws.onclose = () => { open = false; connCbs.forEach((f) => f(false)); };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.ev === 'ack') { const w = waits[m.rid]; delete waits[m.rid]; if (w) w(m); }
    else if (m.ev === 'snap') { const s = subs[m.id]; if (s) s.cb(snap(s.path, m.val)); }
    else if (m.ev === 'child') { const s = subs[m.id]; if (s) s.cb(snap(s.path + '/' + m.key, m.val)); }
  };
  const send = (o) => { const t = JSON.stringify(o); if (open) ws.send(t); else queue.push(t); };
  const req = (o) => new Promise((res) => { o.rid = ++rid; waits[o.rid] = res; send(o); });
  const norm = (p) => String(p || '').split('/').filter(Boolean).join('/');
  const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  function snap(path, val) { const key = path.split('/').pop(); return { key, val: () => clone(val), exists: () => val !== null && val !== undefined }; }
  function Ref(path, q) {
    path = norm(path);
    const r = {
      key: path.split('/').pop(), path,
      child: (p) => Ref(path + '/' + p),
      limitToLast: (n) => Ref(path, { limit: n }),
      orderByKey: () => r,
      on(ev, cb, err) {
        if (path === '.info/connected') { connCbs.push((v) => cb(snap(path, v))); setTimeout(() => cb(snap(path, open)), 0); return cb; }
        if (path === '.info/serverTimeOffset') { setTimeout(() => cb(snap(path, 0)), 0); return cb; }
        const id = ++sid; subs[id] = { path, cb, ev }; cb.__ids = (cb.__ids || []).concat(id);
        send({ op: 'sub', id, path, kind: ev === 'value' ? 'value' : 'child', limit: q && q.limit });
        return cb;
      },
      off(ev, cb) { for (const id in subs) if (subs[id].path === path && (!cb || subs[id].cb === cb)) { delete subs[id]; send({ op: 'unsub', id: +id }); } },
      once() { return req({ op: 'get', path }).then((m) => snap(path, m.val)); },
      set(v) { return req({ op: 'set', path, val: clone(v) }).then(() => undefined); },
      update(v) { return req({ op: 'update', path, vals: clone(v) }).then(() => undefined); },
      remove() { return r.set(null); },
      push(v) {
        const k = Date.now().toString(36).padStart(9, '0') + Math.random().toString(36).slice(2, 8);
        const c = Ref(path + '/' + k);
        const p = v === undefined ? Promise.resolve() : c.set(v);
        c.then = p.then.bind(p); c.catch = p.catch.bind(p);
        return c;
      },
      async transaction(fn, onComplete) {
        for (let i = 0; i < 20; i++) {
          const cur = (await req({ op: 'get', path })).val;
          const nv = fn(clone(cur));
          if (nv === undefined) { const s = snap(path, cur); onComplete && onComplete(null, false, s); return { committed: false, snapshot: s }; }
          const m = await req({ op: 'cas', path, expect: JSON.stringify(cur), val: clone(nv) });
          if (m.ok) { const s = snap(path, m.val); onComplete && onComplete(null, true, s); return { committed: true, snapshot: s }; }
        }
        onComplete && onComplete(new Error('maxretry'), false, null);
      },
      onDisconnect() {
        return {
          update: (v) => req({ op: 'ondc', path, kind: 'update', val: clone(v) }),
          set: (v) => req({ op: 'ondc', path, kind: 'set', val: clone(v) }),
          remove: () => req({ op: 'ondc', path, kind: 'set', val: null }),
          cancel: () => req({ op: 'ondc', path, kind: 'cancel' }),
        };
      },
    };
    return r;
  }
  const db = { ref: (p) => Ref(p) };
  let user = null; try { const u = localStorage.getItem('fake.uid'); if (u) user = { uid: u }; } catch (e) {}
  const auth = {
    onAuthStateChanged(cb) { setTimeout(() => cb(user), 0); return () => {}; },
    signInAnonymously() { user = { uid: 'u' + Math.random().toString(36).slice(2, 12) }; try { localStorage.setItem('fake.uid', user.uid); } catch (e) {} return Promise.resolve({ user }); },
    get currentUser() { return user; },
  };
  const database = () => db; database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  window.firebase = { apps: [], initializeApp(c) { this.apps.push(c); }, auth: () => auth, database };
  window.FIREBASE_CONFIG = { apiKey: 'fake', databaseURL: 'fake' };
})();
