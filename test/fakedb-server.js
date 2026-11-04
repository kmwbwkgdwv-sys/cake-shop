// テスト用：Firebase Realtime Database っぽい挙動をする WebSocket サーバー（ルールは未適用）
const WebSocket = require('/opt/npm-tools/node_modules/ws');
const PORT = +process.argv[2] || 8790;
let root = {};
const clients = new Set();
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const parts = (p) => String(p || '').split('/').filter(Boolean);
function get(p) { let n = root; for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; }
function resolve(v) { if (v && typeof v === 'object') { if (v['.sv'] === 'timestamp') return Date.now(); const o = Array.isArray(v) ? [] : {}; for (const k in v) o[k] = resolve(v[k]); return o; } return v; }
function prune(v) { if (v && typeof v === 'object') { const o = {}; let any = false; for (const k in v) { const c = prune(v[k]); if (c !== null && c !== undefined) { o[k] = c; any = true; } } return any ? o : null; } return v; }
function setRaw(p, v) {
  v = prune(resolve(clone(v)));
  const ks = parts(p);
  if (!ks.length) { root = v || {}; return; }
  let n = root;
  for (let i = 0; i < ks.length - 1; i++) { if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') n[ks[i]] = {}; n = n[ks[i]]; }
  if (v === null) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = v;
  root = prune(root) || {};
}
function dispatch() {
  for (const c of clients) for (const id in c.subs) {
    const s = c.subs[id];
    const v = get(s.path);
    if (s.kind === 'value') { const j = JSON.stringify(v); if (j !== s.last) { s.last = j; send(c, { ev: 'snap', id, val: v }); } }
    else {
      const keys = v && typeof v === 'object' ? Object.keys(v).sort() : [];
      const fresh = keys.filter((k) => !s.seen.has(k));
      const list = s.first && s.limit ? fresh.slice(-s.limit) : fresh;
      s.first = false;
      fresh.forEach((k) => s.seen.add(k));
      list.forEach((k) => send(c, { ev: 'child', id, key: k, val: v[k] }));
    }
  }
}
function send(c, m) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); }
const wss = new WebSocket.Server({ port: PORT });
wss.on('connection', (ws) => {
  const c = { ws, subs: {}, ondc: [] };
  clients.add(c);
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    const ack = (o) => send(c, Object.assign({ ev: 'ack', rid: m.rid }, o));
    switch (m.op) {
      case 'sub': c.subs[m.id] = { path: m.path, kind: m.kind, limit: m.limit, last: undefined, seen: new Set(), first: true }; dispatchOne(c, m.id); break;
      case 'unsub': delete c.subs[m.id]; break;
      case 'get': ack({ val: get(m.path) }); break;
      case 'set': setRaw(m.path, m.val); ack({ ok: true }); dispatch(); break;
      case 'update': for (const k in m.vals) setRaw(m.path + '/' + k, m.vals[k]); ack({ ok: true }); dispatch(); break;
      case 'cas': { const cur = get(m.path); if (JSON.stringify(cur) === m.expect) { setRaw(m.path, m.val); ack({ ok: true, val: get(m.path) }); dispatch(); } else ack({ ok: false, val: cur }); break; }
      case 'ondc': if (m.kind === 'cancel') c.ondc = c.ondc.filter((x) => x.path !== m.path); else c.ondc.push({ path: m.path, kind: m.kind, val: m.val }); ack({ ok: true }); break;
      case 'dump': ack({ val: root }); break;
    }
  });
  ws.on('close', () => {
    clients.delete(c);
    for (const d of c.ondc) { if (d.kind === 'set') setRaw(d.path, d.val); else for (const k in d.val) setRaw(d.path + '/' + k, d.val[k]); }
    if (c.ondc.length) dispatch();
  });
});
function dispatchOne(c, id) { const s = c.subs[id]; const v = get(s.path); if (s.kind === 'value') { s.last = JSON.stringify(v); send(c, { ev: 'snap', id, val: v }); } else { const keys = v && typeof v === 'object' ? Object.keys(v).sort() : []; const list = s.limit ? keys.slice(-s.limit) : keys; keys.forEach((k) => s.seen.add(k)); s.first = false; list.forEach((k) => send(c, { ev: 'child', id, key: k, val: v[k] })); } }
console.log('fakedb on', PORT);
