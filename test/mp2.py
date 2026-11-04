# 一人称版の共同経営：クライアントの操作がホストで処理され、全員に反映されるか
import asyncio, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]; URL = 'http://localhost:8765/test/index-mp.html'
HELP = r"""
window.T = (() => {
  const W = CS.world, K = CS.kitchen, R = () => CS.ui.room, S = () => CS.ui.room.S;
  const aim = (sx, sz, p) => { W.me.x = sx; W.me.z = sz; const dx = p[0] - sx, dz = p[2] - sz; W.me.yaw = Math.atan2(-dx, -dz); W.me.pitch = Math.atan2(p[1] - 1.58, Math.hypot(dx, dz)); W.updateCamera(); W.updateTarget(S()); return W.target ? [W.target.name, W.target.pri && W.target.pri.label, W.target.sec && W.target.sec.label] : null; };
  const go = (fn) => { const t = W.target; const r = fn === 'p' ? (t && t.pri && t.pri.a) : (t && t.sec && t.sec.a); if (fn === 'p') W.primary(); else W.secondary(); return r ? r.t : 'NONE'; };
  const held = () => { const id = K.held(S(), R().pid); return id ? S().k.items[id] : null; };
  return { W, K, aim, go, held, S, R };
})();
"""
async def newdev(b, name, w, h, touch=False):
  ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch)
  pg = await ctx.new_page(); pg.logs = []
  pg.on('pageerror', lambda e: pg.logs.append('PAGEERROR ' + str(e)))
  await pg.goto(URL); await pg.wait_for_timeout(1500)
  if await pg.locator('#md-in').count(): await pg.fill('#md-in', name); await pg.click('#modal .btn.pink')
  await pg.wait_for_timeout(300)
  return ctx, pg
async def ev(pg, js): return await pg.evaluate(js)
async def until(pg, js, n=30):
  for i in range(n):
    v = await pg.evaluate(js)
    if v: return round(i * 0.5, 1)
    await pg.wait_for_timeout(500)
  return 'TIMEOUT'
async def dismiss(pg):
  for _ in range(3):
    await ev(pg, "(()=>{const b=document.querySelector('#modal:not([hidden]) .btn.pink');if(b)b.click()})()"); await pg.wait_for_timeout(250)
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    cA, A = await newdev(b, 'アリス', 844, 390, True)
    cB, B = await newdev(b, 'ボブ', 1000, 600)
    await A.click('#btn-new'); await A.click('#modal .btn.pink'); await A.wait_for_timeout(1500)
    await dismiss(A)
    code = await ev(A, "CS.ui.room.code"); print('room', code, 'A host', await ev(A, "CS.ui.room.isHost"))
    await ev(B, f"CS.ui.joinShop('{code}')"); await B.wait_for_timeout(2500)
    await dismiss(B)
    await ev(B, "document.querySelector('#ov-start').click()"); await B.wait_for_timeout(1500)
    await dismiss(A); await dismiss(B)
    for pg in (A, B): await ev(pg, HELP)
    print('phase A/B', await ev(A, "CS.ui.room.S.phase"), await ev(B, "CS.ui.room.S.phase"))
    # B が注文 → 段ボールが両方に見える
    await ev(B, "CS.ui.room.act({t:'buy',id:'egg',n:10})"); await B.wait_for_timeout(1800)
    print('crates A', await ev(A, "Object.values(CS.ui.room.S.k.items).filter(i=>i.t==='crate').length"), 'B', await ev(B, "Object.values(CS.ui.room.S.k.items).filter(i=>i.t==='crate').length"))
    # B が照準で段ボールを持つ
    r = await ev(B, """(()=>{const {W,S,aim,go}=T; const c=Object.entries(S().k.items).find(([id,i])=>i.t==='crate'); const p=W.slotPos(c[1].at); const a=aim(p[0]+1.3,p[2]+0.3,[p[0],p[1]+0.17,p[2]]); return a+' -> '+go('p');})()""")
    print('B pick', r, 'applied on A after', await until(A, "Object.values(CS.ui.room.S.k.items).some(i=>i.t==='crate'&&String(i.at).startsWith('h:'))"), 's')
    print('A sees crate at', await ev(A, "Object.values(CS.ui.room.S.k.items).filter(i=>i.t==='crate').map(i=>i.at).join(',')"), 'B pid', await ev(B, "CS.ui.room.pid"))
    # A から B が見えて、手に段ボールが見える
    await ev(A, "(()=>{const W=CS.world; W.me.x=-W.dims.RX+3.5; W.me.z=-W.dims.RZ+3.0; W.me.yaw=Math.PI/2; W.me.pitch=-0.15;})()")
    await A.wait_for_timeout(2500)
    print('A others', await ev(A, "Object.keys(CS.world.others).length"), 'A item vis', await ev(A, "(()=>{const W=CS.world;const e=Object.entries(W.items).find(([id,o])=>o.it.t==='crate');return e?JSON.stringify([e[1].n.vis, e[1].n.p.map(v=>+v.toFixed(2))]):'none'})()"))
    await A.screenshot(path=f'{OUT}/mp2_A_sees_B.png')
    print('B yaw', await ev(B, "CS.world.me.yaw"), 'A pos[B]', await ev(A, "JSON.stringify(Object.values(CS.ui.room.pos).map(p=>[p.x,p.z,p.r]))"), 'A other.r', await ev(A, "JSON.stringify(Object.values(CS.world.others).map(o=>[o.x,o.z,o.r, o.ch.node.r]))"))
    # B が在庫棚へ
    r = await ev(B, """(()=>{const {W,aim,go}=T; const L=W.L; const a=aim(L.shelf[0]+1.5, L.shelf[1], [L.shelf[0]+0.3,1.0,L.shelf[1]]); return a+' -> '+go('p');})()""")
    print('B stock', r, 'applied on A after', await until(A, "!Object.values(CS.ui.room.S.k.items).some(i=>i.t==='crate')"), 's')
    print('inv egg A/B', await ev(A, "CS.sim.invCount(CS.ui.room.S,'egg')"), await ev(B, "CS.sim.invCount(CS.ui.room.S,'egg')"))
    # B がミキサーに卵を入れる → A のボウルに反映
    r = await ev(B, """(()=>{const {W,aim,go}=T; const m=W.L.mix[1]; const bn=m.bins.find(x=>x.ing==='egg'); const a=aim(m.stand[0], m.stand[1], bn.p); return a+' -> '+go('p');})()""")
    print('B addIng', r, 'applied on A after', await until(A, "CS.ui.room.S.k.mix[1].ings.length>0"), 's')
    print('mix1 A', await ev(A, "JSON.stringify(CS.ui.room.S.k.mix[1])"))
    # B が看板を OPEN → A の時計が進む
    r = await ev(B, """(()=>{const {W,aim,go}=T; const L=W.L; const a=aim(L.sign[0]-0.2, L.sign[1]+1.4, [L.sign[0],0.55,L.sign[1]]); return a+' -> '+go('p');})()""")
    print('B sign', r, 'applied on A after', await until(A, "CS.ui.room.S.phase==='open'"), 's', 'B sees open after', await until(B, "CS.ui.room.S.phase==='open'"))
    print('phase A/B', await ev(A, "CS.ui.room.S.phase"), await ev(B, "CS.ui.room.S.phase"), 'dayT A', await ev(A, "CS.ui.room.S.dayT"))
    await B.screenshot(path=f'{OUT}/mp2_B_view.png')
    # ホストが抜ける → B がホストに
    await ev(A, "CS.game.leave(false)"); await A.wait_for_timeout(500)
    for i in range(8):
      await B.wait_for_timeout(1000)
      if await ev(B, "CS.ui.room.isHost"): break
    t0 = await ev(B, "CS.ui.room.S.dayT"); await B.wait_for_timeout(2500); t1 = await ev(B, "CS.ui.room.S.dayT")
    print('B host', await ev(B, "CS.ui.room.isHost"), 'dayT advanced', t1 - t0)
    print('logs A', A.logs[:5], 'B', B.logs[:5])
    await b.close()
asyncio.run(main())
