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
  const ings = Object.keys(D.ING), pids = [r.pid, 'p2', 'p3'];
  const SL = []; ['sp', 'rk', 'pk', 'fr', 'mo', 'ov', 'dt'].forEach((k) => { for (let i = 0; i < 12; i++) SL.push(k + ':' + i); });
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) { SL.push('wo:' + i + ':' + k); SL.push('dp:' + i + ':' + k); } for (let i = 0; i < 8; i++) SL.push('cs:' + i);
  const strip = (o) => { if (Array.isArray(o)) { const a2 = o.map(strip); return a2.length ? a2 : undefined; } if (o && typeof o === 'object') { const q = {}; for (const k in o) { const v = strip(o[k]); if (v !== undefined && v !== null && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) q[k] = v; } return q; } return o; };
  let errs = [];
  for (let step = 0; step < steps; step++) {
    const S = r.S, items = Object.keys(S.k.items);
    const t = pick(['pick', 'put', 'put', 'trash', 'newPan', 'newBox', 'takeTop', 'addIng', 'run', 'pour', 'scoop', 'dump', 'oven', 'spreadDone', 'topPlace', 'finish', 'slice', 'caseTake', 'openCrate', 'shelve', 'order', 'sign', 'takeOrder', 'serve', 'endDay', 'next']);
    const a = { t, pid: pick(pids), id: pick(items.concat(['x'])), slot: pick(SL), k: pick(['strawberry', 'blueberry', 'peach', 'choco']), st: pick(['mix', 'whip', 'deco']), i: Math.floor(rnd() * 3), ing: pick(ings), op: pick(['set', 'next', 'off']), temp: 170, q: rnd(), x: rnd() - 0.5, z: rnd() - 0.5, ci: Math.floor(rnd() * 8), all: rnd() < 0.5 ? 1 : 0, items: [pick(ings), pick(ings)], c: pick(Object.keys(S.cust).concat(['z'])) };
    try { sim.apply(S, a, r.now()); } catch (e) { errs.push('apply ' + t + ': ' + e.message); }
    if (S.funds < 50000) S.funds += 300000; if (S.bankrupt) S.bankrupt = 0;
    if (step % 200 === 0) for (const k of ings) if (sim.invCount(S, k) < 5) sim._.invAdd(S, k, 20, 50);
    // 自分の視点を設備の近くにランダムに置く（ラベル・照準のコードを通す）
    if (step % 10 === 0) { const L = W.L, spots = [L.mix[0].stand, L.ovens[0].stand, L.deco[0].stand, [L.fridge.x, -W.dims.RZ + 1.6], [L.store.x0 + 2, L.store.z0 + 2.5], [1, W.dims.CASE_Z - 1], [L.truck.x, L.truck.z - 3.5]]; const sp = pick(spots); W.me.x = sp[0]; W.me.z = sp[1]; W.me.yaw = rnd() * 6.28; W.me.pitch = -0.6 + rnd() * 0.8; }
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
