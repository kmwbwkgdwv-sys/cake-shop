# 画面側のファズ：でたらめな操作＋「Firebase を通した状態（空の配列が消える）」で、3D・ラベル・HUD が例外を出さないか
import asyncio, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1]
STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 2500
FUZZ = r"""
window.__fz = async (steps, seed) => {
  const D = CS.data, sim = CS.sim, r = CS.ui.room, W = CS.world;
  let sd = seed; const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const ings = Object.keys(D.ING), pids = [r.pid, 'p2', 'p3'], P = CS.plan, K = CS.kitchen;
  const strip = (o) => { if (Array.isArray(o)) { const a2 = o.map(strip); return a2.length ? a2 : undefined; } if (o && typeof o === 'object') { const q = {}; for (const k in o) { const v = strip(o[k]); if (v !== undefined && v !== null && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) q[k] = v; } return q; } return o; };
  let errs = [];
  try { localStorage.setItem('cs.tut3:' + r.code, JSON.stringify({ i: 0, off: false })); CS.game.memoShow('short'); } catch (e) { errs.push('tut ' + e.message); }
  for (let step = 0; step < steps; step++) {
    const S = r.S, items = Object.keys(S.k.items), fids = Object.keys(S.fu);
    const SL = fids.reduce((a, f) => a.concat(P.slots(S, f)), []);
    const t = pick(['pick', 'take', 'put', 'put', 'trash', 'drop', 'addIng', 'run', 'pour', 'scoop', 'dump', 'oven', 'spreadDone', 'topPlace', 'topTake', 'finish', 'slice', 'unslice', 'caseTake', 'cut', 'cut', 'hole', 'unhole', 'unpack', 'openCrate', 'shelve', 'washStart', 'wash', 'order', 'sign', 'takeOrder', 'serve', 'pay', 'fmove', 'fbuy', 'tbuy', 'endDay', 'next']);
    const g = P.geomOf(S);
    const a = { t, pid: pick(pids), id: pick(items.concat(fids).concat(['x'])), slot: pick(SL.concat(['f:x:0'])), fid: pick(fids), k: pick(Object.keys(P.KINDS).concat(['plate', 'pan', 'knife'])), op: pick(['set', 'next', 'off']), temp: 170, q: rnd(), x: t === 'fmove' ? -g.RX + rnd() * 2 * g.RX : rnd() - 0.5, z: t === 'fmove' ? -g.RZ + rnd() * (g.CZ + g.RZ) : rnd() - 0.5, r: Math.floor(rnd() * 4), one: rnd() < 0.4 ? 1 : 0, all: rnd() < 0.5 ? 1 : 0, items: [pick(ings), pick(ings)], c: pick(Object.keys(S.cust).concat(['z'])), ch: Math.floor(rnd() * 2000) };
    try { sim.apply(S, a, r.now()); } catch (e) { errs.push('apply ' + t + ': ' + e.message); }
    if (S.funds < 50000) S.funds += 300000; if (S.bankrupt) S.bankrupt = 0;
    if (step % 200 === 0) for (const k of ings) if (sim.invCount(S, k) < 5) K.invAdd(S, k, 20, 50);
    if (step % 25 === 0) { const sl = SL.find((x) => !K.inSlot(S, x).length && ['any', 'tray'].includes((P.slotDef(S, x) || {}).type)); if (sl) K.add(S, { t: P.slotDef(S, sl).type === 'tray' ? 'tray' : 'cake', r: pick(['short', 'chocolate', 'baked_cheese']), q: 0.8, df: [], p: 6, n: 6, w: rnd() < 0.6 ? 1 : undefined, dish: rnd() < 0.2 ? 1 : undefined, c: 900, d: S.day, at: sl, pl: 0 }); }
    // 自分の視点を設備の近くにランダムに置く（ラベル・照準のコードを通す）
    if (step % 10 === 0) { const f = S.fu[pick(Object.keys(S.fu))], L = W.L; const sp = pick([f ? P.stand(f, 0.7) : [0, 0], [L.desk[0], L.desk[1] + 1], [1, W.dims.CZ - 1], [L.truck.x, L.truck.z - 3.5], [2, W.dims.CZ + 2]]); W.me.x = sp[0]; W.me.z = sp[1]; W.me.yaw = rnd() * 6.28; W.me.pitch = -0.6 + rnd() * 0.8; }
    if (step % 37 === 0) { W.setBuild(rnd() < 0.5); if (W.bm && rnd() < 0.7) { const id = pick(Object.keys(S.fu)); W.mv = { id, x: S.fu[id].x, z: S.fu[id].z, r: S.fu[id].r }; } }
    if (step % 41 === 0) { try { W.primary(); W.secondary(); } catch (e) { errs.push('ui ' + e.message); } }
    // Firebase を通したのと同じ状態に置き換えて画面に反映
    if (step % 3 === 0) { const S2 = sim.normalize(strip(JSON.parse(JSON.stringify(r.S)))); Object.keys(r.S).forEach((k) => delete r.S[k]); Object.assign(r.S, S2); }
    r.emit('state', r.S);
    if (step % 5 === 0) await new Promise((res) => requestAnimationFrame(() => res()));
  }
  return errs.slice(0, 10);
};
"""
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = await b.new_context(viewport={'width': 640, 'height': 360}, has_touch=True, is_mobile=True)
    await ctx.add_init_script("localStorage.setItem('cs.settings',JSON.stringify({autoQ:false,light:true}))")
    pg = await ctx.new_page(); logs = []; pg.set_default_timeout(600000)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.on('console', lambda m: logs.append('CONSOLE ' + m.type + ': ' + m.text) if m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'Failed to load' not in m.text else None)
    js = lambda c: pg.evaluate(c)
    click = "(()=>{const b=document.querySelector('#modal:not([hidden]) .btn.pink');if(b)b.click()})()"
    await pg.goto('http://localhost:8765/index.html'); await pg.wait_for_timeout(2500)
    await js("(()=>{const i=document.querySelector('#md-in'); if(i){i.value='いちご'; document.querySelector('#modal .btn.pink').click()}})()")
    await pg.wait_for_timeout(400); await js("document.querySelector('#btn-new').click()"); await pg.wait_for_timeout(500)
    await js("document.querySelector('#modal .btn.pink').click()"); await pg.wait_for_timeout(3000)
    for _ in range(3): await js(click); await pg.wait_for_timeout(300)
    await js("document.querySelector('#ov-start').click()"); await pg.wait_for_timeout(1200)
    for _ in range(3): await js(click); await pg.wait_for_timeout(300)
    await js(FUZZ)
    for seed in (11, 23):
      r = await js(f"__fz({STEPS}, {seed})")
      print('seed', seed, 'apply errors', r)
    await pg.wait_for_timeout(1500)
    print('frame still running', await js("(()=>{const a=performance.now(); return new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(()=>res(performance.now()-a))))})()"))
    await pg.screenshot(path=f'{OUT}/wfuzz.png')
    seen = set(); out = []
    for l in logs:
      k = l[:140]
      if k not in seen: seen.add(k); out.append(l[:400])
    print('errors', len(logs)); print('\n'.join(out[:15]))
    await b.close()
asyncio.run(main())
