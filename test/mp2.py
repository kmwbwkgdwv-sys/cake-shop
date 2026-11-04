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
    # B がカートで注文（クライアント → ホストで処理）
    print('B order', await ev(B, "CS.ui.room.act({t:'order',items:['egg','egg','sugar']}).then(r=>JSON.stringify(r))"), 'applied on A after', await until(A, "!!CS.ui.room.S.k.truck"))
    await ev(A, "(()=>{const S=CS.ui.room.S,n=CS.ui.room.now(); S.k.truck.at=n-500; Object.values(S.k.items).forEach(i=>{ if(i.t==='crate') i.ar=n-500; }); CS.ui.room.pushState(false); CS.ui.room.emit('state', S);})()"); await B.wait_for_timeout(1500)
    print('crates A', await ev(A, "Object.values(CS.ui.room.S.k.items).filter(i=>i.t==='crate').length"), 'B', await ev(B, "Object.values(CS.ui.room.S.k.items).filter(i=>i.t==='crate').length"))
    # A（ホスト）と B（クライアント）が同時に同じ段ボールをつかむ → 1人だけが持てて、数は増えない
    cid = await ev(A, "Object.keys(CS.ui.room.S.k.items).find(id=>CS.ui.room.S.k.items[id].t==='crate'&&CS.ui.room.S.k.items[id].at==='dl:0')")
    await asyncio.gather(ev(A, f"CS.ui.room.act({{t:'pick',id:'{cid}'}})"), ev(B, f"CS.ui.room.act({{t:'pick',id:'{cid}'}})"), ev(B, f"CS.ui.room.act({{t:'pick',id:'{cid}'}})"))
    await B.wait_for_timeout(2500)
    print('after simultaneous pick: crates A', await ev(A, "Object.values(CS.ui.room.S.k.items).filter(i=>i.t==='crate').length"), 'B', await ev(B, "Object.values(CS.ui.room.S.k.items).filter(i=>i.t==='crate').length"), 'holder', await ev(A, f"CS.ui.room.S.k.items['{cid}'].at"), 'A pid', await ev(A, "CS.ui.room.pid"))
    # B が別の段ボールを持って在庫室で開けて棚へ（同時に A も同じ棚に置こうとしても数が合う）
    for pg in (A, B):
      await ev(pg, "(()=>{const R=CS.ui.room,S=R.S; if (CS.kitchen.held(S,R.pid)) return; const id=Object.keys(S.k.items).find(k=>S.k.items[k].t==='crate'&&String(S.k.items[k].at).startsWith('dl:')); R.act({t:'pick',id});})()")
    print('both holding after', await until(A, "Object.values(CS.ui.room.S.k.items).filter(i=>i.t==='crate'&&String(i.at).startsWith('h:')).length===2"), 's')
    await ev(A, "(()=>{const W=CS.world; W.me.x=W.L.truck.x-1.6; W.me.z=W.L.truck.z-4.4; W.me.yaw=-2.6; W.me.pitch=-0.12;})()")
    await A.wait_for_timeout(2500)
    await A.screenshot(path=f'{OUT}/mp2_A_sees_B.png')
    e0 = await ev(A, "CS.sim.invCount(CS.ui.room.S,'egg')")
    await ev(B, "CS.ui.room.act({t:'openCrate'})"); await ev(A, "CS.ui.room.act({t:'openCrate'})"); await B.wait_for_timeout(1500)
    await asyncio.gather(ev(A, "CS.ui.room.act({t:'shelve',ing:'egg',all:1})"), ev(B, "CS.ui.room.act({t:'shelve',ing:CS.ui.room.S.k.items[CS.kitchen.held(CS.ui.room.S,CS.ui.room.pid)].ing,all:1})"))
    print('B stock applied on A after', await until(A, "Object.values(CS.ui.room.S.k.items).filter(i=>i.t==='crate'&&i.n===0).length===2"), 's')
    print('egg before/after (A view)', e0, await ev(A, "CS.sim.invCount(CS.ui.room.S,'egg')"), 'B view', await ev(B, "CS.sim.invCount(CS.ui.room.S,'egg')"))
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
