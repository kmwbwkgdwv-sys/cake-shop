# 一人称の通しプレイ：照準とボタンだけで、仕入れ → 生地 → 焼く → クリーム → デコ → 切って並べる → 接客 → お会計 → 洗い物
import asyncio, sys, math
from playwright.async_api import async_playwright
OUT = sys.argv[1]
HELP = r"""
window.T = (() => {
  const W = CS.world, K = CS.kitchen, P = CS.plan, R = () => CS.ui.room, S = () => CS.ui.room.S;
  const look = () => { W.updateCamera(); W.updateTarget(S(), R().now()); const t = W.target; return t ? [t.name, t.pri && t.pri.label, t.sec && t.sec.label, t.del && t.del.label].join(' | ') : 'NONE'; };
  const aim = (sx, sz, p) => { W.me.x = sx; W.me.z = sz; const dx = p[0] - sx, dz = p[2] - sz; W.me.yaw = Math.atan2(-dx, -dz); W.me.pitch = Math.atan2(p[1] - 1.58, Math.hypot(dx, dz)); return look(); };
  const go = (fn) => { const t = W.target; const x = fn === 'p' ? t && t.pri : fn === 's' ? t && t.sec : t && t.del; if (fn === 'p') W.primary(); else if (fn === 's') W.secondary(); else W.discard(); return x ? (x.a ? x.a.t : x.label) : 'NONE'; };
  const held = () => { const id = K.held(S(), R().pid); return id ? S().k.items[id] : null; };
  const fr = (k, i) => P.list(S(), k)[i || 0];
  const aimF = (fid, lp, d) => { const f = S().fu[fid]; const st = P.stand(f, d || 0.7); return aim(st[0], st[1], P.local(f, lp[0], lp[1], lp[2])); };
  const aimSlot = (at, dy) => { const sd = P.slotDef(S(), at); const st = P.stand(sd.f, 0.75); const p = P.slotPos(S(), at); return aim(st[0], st[1], [p[0], p[1] + (dy == null ? 0.07 : dy), p[2]]); };
  const stackAt = (ing) => { const it = Object.values(S().k.items).find((i) => i.t === 'ing' && i.ing === ing && String(i.at).startsWith('f:')); return it && it.at; };
  const emptySlot = (k) => { for (const f of P.list(S(), k)) for (const sl of P.slots(S(), f)) if (!K.inSlot(S(), sl).length && P.slotDef(S(), sl).type === 'any') return sl; return null; };
  const st = (k) => S().k.st[fr(k)];
  return { W, K, P, S, R, look, aim, go, held, fr, aimF, aimSlot, stackAt, emptySlot, st };
})();
"""
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': 800, 'height': 450})
    await ctx.add_init_script("if(!localStorage.getItem('cs.settings'))localStorage.setItem('cs.settings',JSON.stringify({autoQ:false,light:true}))")
    pg = await ctx.new_page(); logs = []; pg.set_default_timeout(60000)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.on('console', lambda m: logs.append('CONSOLE ' + m.type + ': ' + m.text) if m.type in ('error',) else None)
    js = lambda c: pg.evaluate(c)
    fails = []
    def chk(c, m):
      print(('ok   ' if c else 'FAIL ') + m)
      if not c: fails.append(m)
    async def step(code, wait=120):
      r = await js("(()=>{const {W,K,P,S,R,look,aim,go,held,fr,aimF,aimSlot,stackAt,emptySlot,st}=T;" + code + "})()")
      await pg.wait_for_timeout(wait)
      return r
    click = "(()=>{const b=document.querySelector('#modal:not([hidden]) .btn.pink, #modal:not([hidden]) .btn.mint');if(b)b.click()})()"
    await pg.goto('http://localhost:8765/index.html'); await pg.wait_for_timeout(2000)
    await js("(()=>{const i=document.querySelector('#md-in'); if(i){i.value='テスト'; document.querySelector('#modal .btn.pink').click()}})()")
    await pg.wait_for_timeout(300); await js("document.querySelector('#btn-new').click()"); await pg.wait_for_timeout(400)
    await js("document.querySelector('#modal .btn.pink').click()"); await pg.wait_for_timeout(2500)
    for _ in range(3): await js(click); await pg.wait_for_timeout(200)
    await js("document.querySelector('#ov-start').click()"); await pg.wait_for_timeout(1200)
    for _ in range(3): await js(click); await pg.wait_for_timeout(200)
    await js(HELP)
    # 1) パソコンへ歩いていって家具を買う（UI のボタン → 確認）
    print('pc', await step("const L=W.L; return aim(L.pcScr[0], L.pcScr[2]+1.0, L.pcScr)"))
    print('go', await step("return go('p')", 900))
    await js("(()=>{const t=[...document.querySelectorAll('[role=tab], .sh-tabs button')].find(b=>/家具/.test(b.textContent)); if(t) t.click();})()"); await pg.wait_for_timeout(700)
    for k in ['oven', 'mixer', 'deco']:
      await js(f"document.querySelector('[data-fbuy=\"{k}\"]').click()"); await pg.wait_for_timeout(500); await js(click); await pg.wait_for_timeout(600)
    await js("(()=>{const b=[...document.querySelectorAll('[data-tbuy=\"pan\"]')][0]; if(b) b.click();})()"); await pg.wait_for_timeout(500)
    chk(await js("['oven','mixer','deco'].every(k=>CS.plan.count(T.S(),k)===0) && Object.values(T.S().k.items).filter(i=>i.t==='fcrate').length===3"), 'bought oven, mixer, deco from the PC → 3 big boxes on the truck')
    await js("CS.ui.closeSheet()"); await pg.wait_for_timeout(400)
    print('tutorial', await js("document.querySelector('#tut') && !document.querySelector('#tut').hidden ? document.querySelector('#tut').innerText.replace(/\\n/g,' / ').slice(0,140) : 'hidden'"))
    # 2) 注文（同じトラックに積む）→ トラック到着 → 大きな段ボールを展開 → 段ボールを運んで棚へ
    r = await js("CS.ui.room.act({t:'order',items:['egg','sugar','flour','butter','cream','strawberry','box']})"); await pg.wait_for_timeout(300)
    chk(await js("Object.values(T.S().k.items).filter(i=>i.t==='crate').length===7"), 'ingredients go on the same truck while it is on the way')
    await js("(()=>{const S=T.S(),n=T.R().now(); S.k.truck.at=n-500; Object.values(S.k.items).forEach(i=>{ if(i.t==='crate'||i.t==='fcrate') i.ar=n-500; }); T.R().emit('state',S);})()"); await pg.wait_for_timeout(1500)
    await pg.screenshot(path=f'{OUT}/fp2_truck.png')
    for k in ['oven', 'mixer', 'deco']:
      r = await step(f"const L=W.L; const it=Object.entries(S().k.items).find(([id,i])=>i.t==='fcrate'&&i.k==='{k}'); const p=W.truckSlot(+it[1].at.split(':')[1]); return aim(p[0]+0.95, p[2]+0.1, [p[0],p[1]+0.35,p[2]])+' -> '+go('p')", 200)
      print('big box', k, r[:80], 'held', await js("T.held() && T.held().t+':'+T.held().k"))
      # 置く場所：空いている所を 0.05 刻みで探して、床をねらう
      r2 = await step(f"const sp=P.findSpot(S(),'{k}'); let best=null; for (let dx=-0.1; dx<=0.1 && !best; dx+=0.05) for (let dz=-0.1; dz<=0.1 && !best; dz+=0.05) {{ const x=Math.round((sp.x+dx)*20)/20, z=Math.round((sp.z+dz)*20)/20; if(!P.valid(S(),null,'{k}',x,z,sp.r)) best=[x,z]; }} W.upR=sp.r; const o=P.dirs(sp.r); const sx=best[0]+o.fx*1.7, sz=best[1]+o.fz*1.7; return aim(sx, sz, [best[0],0,best[1]])+' ghost='+JSON.stringify(W.up)+' -> '+go('p')", 400)
      print('unpack', k, r2[:160])
    chk(await js("['oven','mixer','deco'].every(k=>CS.plan.count(T.S(),k)===1) && !Object.values(T.S().k.items).some(i=>i.t==='fcrate')"), 'unpacked oven, mixer, deco where I aimed')
    await pg.screenshot(path=f'{OUT}/fp2_unpacked.png')
    n_crates = await js("Object.values(T.S().k.items).filter(i=>i.t==='crate').length"); print('crates', n_crates)
    for j in range(n_crates):
      r = await step(f"const L=W.L; const it=Object.entries(S().k.items).find(([k,i])=>i.t==='crate'&&String(i.at).startsWith('dl:')); if(!it) return 'none'; const p=W.truckSlot(+it[1].at.split(':')[1]); return aim(L.truck.x+0.2, L.truck.z-3.6, [p[0],p[1]+0.17,p[2]])+' -> '+go('p')")
      ing = await js("T.held() && T.held().ing")
      if j == 0:
        # 段ボールは床にも置ける（足もとの少し先をねらう）→ 拾い直す。開けたら閉じられる
        r3 = await step("const g=P.geomOf(S()); const x=-g.RX+2.6, z=g.backDoor.z+1.0; return aim(x+1.5, z, [x,0,z])+' -> '+go('p')", 400)
        print('floor', r3)
        chk(await js("Object.values(T.S().k.items).some(i=>i.t==='crate'&&i.at==='fl')"), 'crate put on the floor by aiming at it')
        await pg.screenshot(path=f'{OUT}/fp2_floor.png')
        r4 = await step("const it=Object.values(S().k.items).find(i=>i.t==='crate'&&i.at==='fl'); return aim(it.fx+1.3, it.fz, [it.fx,0.2,it.fz])+' -> '+go('p')", 400)
        print('pick from floor', r4)
        chk(await js("T.held() && T.held().t==='crate'"), 'picked the crate up from the floor')
        await step("return go('s')", 200); r5 = await step("return look()+' -> '+go('s')", 200)
        chk(await js("T.held() && !T.held().open"), 'opened and closed the crate: ' + r5[:60])
        r6 = await step(f"const sl=emptySlot('shelf'); return aimSlot(sl)", 200)
        print('crate at shelf', r6)
        chk('段ボールを机に' not in r6 and '棚に入れられません' in r6, 'a closed crate cannot be put into a shelf')
      await step("return go('s')")  # 開ける（どこでも）
      cold = await js(f"!!(CS.data.ING['{ing}']||{{}}).cold")
      r2 = await step(f"const sl=emptySlot('{'cshelf' if cold else 'shelf'}'); return aimSlot(sl)+' -> '+go('s')")
      print(j, ing, r[:60], '|', r2[:80])
      await step("const L=W.L; const f=S().fu[fr('trash')]; const sp=P.stand(f,0.6); return aim(sp[0],sp[1],P.local(f,0,0.6,0))+' -> '+go('p')")
    chk(await js("['egg','sugar','flour','butter','cream','strawberry','box'].every(i=>CS.kitchen.invCount(T.S(),i)>=10)"), 'all crates shelved via aim (' + await js("['egg','sugar','flour','butter','cream','strawberry','box'].map(i=>i+CS.kitchen.invCount(T.S(),i)).join(' ')") + ')')
    chk(await js("!T.held()"), 'hands empty after trashing crates')
    # 3) 生地：棚から1つずつ取ってミキサーへ（取りすぎたら戻す）
    base = await js("JSON.stringify([CS.data.BASES.plain.order, CS.data.BASES.plain.ing])")
    import json; order, need = json.loads(base)
    for ing in order:
      for k in range(need[ing] + (1 if ing == 'egg' else 0)):
        rr = await step(f"return aimSlot(stackAt('{ing}'))+' -> '+go('p')+' held='+JSON.stringify(held()&&[held().ing,held().n])", 60)
        if k == 0: print('take', ing, rr, await js("JSON.stringify(T.S().fx.slice(-1))"))
      if ing == 'egg':
        r = await step(f"return aimSlot(stackAt('egg'))+' -> '+go('s')+' held='+held().n"); print('put one egg back', r)
      r = await step("return aimF(fr('mixer'), [-0.2,1.1,0.05])")
      for k in range(need[ing]): await step("return go('p')", 80)
      print('mixer', ing, r[:70], 'hand', await js("JSON.stringify(T.held())"))
    chk(await js("T.st('mixer').ings.length") == sum(need.values()), 'ingredients in the mixer: ' + await js("T.st('mixer').ings.join(',')"))
    print('run', await step("return aimF(fr('mixer'), [-0.2,1.1,0.05])+' -> '+go('s')", 800))
    await js("(()=>{const b=T.st('mixer'); b.t0 -= b.sec*1000*0.98; })()")
    print('stop', await step("return aimF(fr('mixer'), [-0.2,1.1,0.05])+' -> '+go('s')", 300))
    chk(await js("T.st('mixer').st==='done' && T.st('mixer').k==='plain'"), 'batter done: ' + str(await js("JSON.stringify([T.st('mixer').k, T.st('mixer').q])")))
    print('pan', await step("const sl=Object.values(S().k.items).find(i=>i.t==='pan'&&i.st==='empty'&&!i.dirty).at; return aimSlot(sl)+' -> '+go('p')"))
    print('pour', await step("return aimF(fr('mixer'), [-0.2,1.1,0.05])+' -> '+go('p')", 300))
    chk(await js("T.held() && T.held().st==='raw'"), 'poured batter into the pan')
    # 4) 焼く
    temp = await js("CS.data.BASES.plain.temp")
    for k in range(6):
      cur = await js("T.st('oven').h ? T.st('oven').temp : 0")
      if cur == temp: break
      await step("return aimF(fr('oven'), [0,0.95,0.45], 0.9)+' -> '+go('s')", 150)
    print('oven in', await step("return aimF(fr('oven'), [0,0.95,0.45], 0.9)+' -> '+go('p')", 300))
    await js("(()=>{const it=Object.values(T.S().k.items).find(i=>i.t==='pan'&&i.st==='baking'); if(it&&it.bk) it.bk.t0 -= it.bk.dur; T.st('oven').hot=0;})()")
    print('oven out', await step("return aimF(fr('oven'), [0,0.95,0.45], 0.9)+' -> '+go('p')", 300))
    chk(await js("T.held() && T.held().st==='baked'"), 'took the sponge out: ' + str(await js("T.held() && T.held().lab")))
    print('cool on table', await step("const sl=emptySlot('table'); return aimSlot(sl)+' -> '+go('p')"))
    await js("Object.values(T.S().k.items).forEach(i=>{ if(i.t==='pan'&&i.st==='baked') i.cool=0; })")
    # 5) クリーム
    for ing, n in [('cream', 2), ('sugar', 1)]:
      for k in range(n): await step(f"return aimSlot(stackAt('{ing}'))+' -> '+go('p')", 60)
      await step("return aimF(fr('whip'), [-0.15,1.02,0.04])")
      for k in range(n): await step("return go('p')", 80)
    print('whip', await step("return aimF(fr('whip'), [-0.15,1.02,0.04])+' -> '+go('s')", 800))
    await js("(()=>{const b=T.st('whip'); b.t0 -= b.sec*1000*0.98; })()")
    print('whip stop', await step("return aimF(fr('whip'), [-0.15,1.02,0.04])+' -> '+go('s')", 300))
    # 6) デコ：スポンジ → 回転台（空いた型は洗い場へ）
    print('pick sponge', await step("const sl=Object.values(S().k.items).find(i=>i.t==='pan'&&i.st==='baked').at; return aimSlot(sl)+' -> '+go('p')"))
    print('to turntable', await step("return aimF(fr('deco'), [0,1.02,0.04], 0.55)+' -> '+go('p')", 300))
    chk(await js("T.held() && T.held().t==='pan' && T.held().dirty===1"), 'dirty pan left in hand after unmolding')
    print('pan to sink', await step("return aimF(fr('sink'), [-0.36,0.95,0.02], 0.55)+' -> '+go('p')", 300))
    print('scoop', await step("return aimF(fr('whip'), [-0.15,1.02,0.04])+' -> '+go('p')", 300))
    print('spread', await step("return aimF(fr('deco'), [0,1.02,0.04], 0.55)+' -> '+go('s')", 900))
    cv = await pg.locator('#sp-cv').bounding_box()
    if cv:
      cx, cy = cv['x'] + cv['width'] / 2, cv['y'] + cv['height'] / 2
      await pg.mouse.move(cx, cy); await pg.mouse.down()
      for k in range(70):
        a = k * 0.5; r = (0.15 + (k % 14) / 14 * 0.7) * cv['width'] * 0.3
        await pg.mouse.move(cx + math.cos(a) * r, cy + math.sin(a) * r)
      await pg.mouse.up()
      await js("document.querySelector('#sp-done').click()"); await pg.wait_for_timeout(600)
    chk(await js("(()=>{const dk=T.S().k.items[CS.kitchen.at(T.S(),CS.kitchen.slot0(T.fr('deco')))]; return !!(dk&&dk.cr);})()"), 'cream spread (q=' + str(await js("(()=>{const dk=T.S().k.items[CS.kitchen.at(T.S(),CS.kitchen.slot0(T.fr('deco')))]; return dk&&dk.sq;})()")) + ')')
    print('cream to fridge', await step("const sl=P.slots(S(), fr('fridge')).find(x=>!K.inSlot(S(),x).length); return aimSlot(sl, 0.1)+' -> '+go('p')"))
    # いちごを3つ取って、ケーキの上をねらって置く。まちがえた1つは取って戻す
    for k in range(4): await step("return aimSlot(stackAt('strawberry'))+' -> '+go('p')", 60)
    print('hand', await js("JSON.stringify([T.held().ing, T.held().n])"))
    for k in range(4):
      a = k / 3 * math.pi * 2 if k < 3 else 0.3
      r = await step(f"const f=S().fu[fr('deco')]; const c=P.local(f,0,0.975,0.04); const dk=S().k.items[K.at(S(),K.slot0(fr('deco')))]; const y=c[1]+W.topY(dk); const RR=0.09*0.92*1.5*0.55; const sp=P.stand(f,0.45); return aim(sp[0],sp[1],[c[0]+Math.cos({a})*RR, y, c[2]+Math.sin({a})*RR])+' aimOK='+W.target.aimOK+' -> '+go('p')", 150)
      print('top', k, r[-60:])
    print('take back one', await step("return aimF(fr('deco'), [0,1.02,0.04], 0.55)+' -> '+go('d')", 200))
    print('put back on shelf', await step("return aimSlot(stackAt('strawberry'))+' -> '+go('d')", 200))
    chk(await js("!T.held()"), 'extra strawberry returned to the shelf')
    print('finish', await step("return aimF(fr('deco'), [0,1.02,0.04], 0.55)+' -> '+go('s')", 300))
    chk(await js("Object.values(T.S().k.items).some(i=>i.t==='cake')"), 'cake finished: ' + str(await js("(()=>{const c=Object.values(T.S().k.items).find(i=>i.t==='cake'); return c && c.r+' q'+c.q.toFixed(2);})()")))
    # 7) ショーケースに置く（ホールのまま）→ ケーキナイフで6等分
    print('pick cake', await step("return aimF(fr('deco'), [0,1.02,0.04], 0.55)+' -> '+go('p')", 200))
    print('to showcase', await step("const sl=P.slots(S(), fr('scase'))[0]; return aimSlot(sl, 0.12)+' -> '+go('p')", 300))
    chk(await js("Object.values(T.S().k.items).some(i=>i.t==='tray'&&i.w===1)"), 'whole cake placed in the showcase')
    print('knife', await step("const sl=Object.values(S().k.items).find(i=>i.t==='knife').at; return aimSlot(sl, 0.02)+' -> '+go('p')", 200))
    print('cut', await step("const sl=P.slots(S(), fr('scase'))[0]; return aimSlot(sl, 0.12)+' -> '+go('p')", 300))
    chk(await js("Object.values(T.S().k.items).some(i=>i.t==='tray'&&!i.w&&i.p===6)"), 'cut into 6 with the cake knife')
    print('knife back', await step("const sl=emptySlot('table'); return aimSlot(sl)+' -> '+go('p')", 200))
    await pg.screenshot(path=f'{OUT}/fp2_tray.png')
    # 8) OPEN → お客さん → 注文 → 箱に入れて渡す → お会計
    for r in await js("Object.keys(T.S().menu)"): await js(f"T.S().menu['{r}'].on = ('{r}'==='short')")
    await js("T.S().furn.table=0; CS.data.CUSTOMERS.forEach(c=>c.hole=0)")
    print('open', await step("const L=W.L; return aim(L.sign[0]-0.2, L.sign[1]+1.4, [L.sign[0],0.55,L.sign[1]])+' -> '+go('p')", 400))
    chk(await js("T.S().phase==='open'"), 'shop is open')
    cid = None
    print('tray', await js("JSON.stringify(Object.values(T.S().k.items).filter(i=>i.t==='tray').map(i=>[i.q.toFixed(2),i.df]))"))
    await js("Object.values(T.S().k.items).forEach(i=>{ if(i.t==='tray'){ i.df=[]; i.q=Math.max(i.q,0.8); } })")  # 塗りムラで売れないことがあるので（スワイプの点数は環境しだい）
    print('tut', await js("(()=>{try{CS.game.tutCheck(T.S()); return document.querySelector('#tut').innerText.slice(0,80)}catch(e){return 'ERR '+e.stack}})()"))
    for tries in range(12):
      await js("(()=>{const S=T.S(); S.cust={}; CS.kitchen.spawn(S, T.R().now()); const id=Object.keys(S.cust)[0]; S.cust[id].tq=T.R().now()-10; T.R().emit('state',S);})()")
      await pg.wait_for_timeout(700)
      cid = await js("Object.keys(T.S().cust).find(k=>T.S().cust[k].st==='q')")
      if cid: break
      print('no q', await js("JSON.stringify(Object.values(T.S().cust).map(c=>[c.st,c.say,c.ty]))"), logs[-3:])
    print('cust', await js(f"JSON.stringify([T.S().cust['{cid}'].st, T.S().cust['{cid}'].ord, T.S().cust['{cid}'].pm])"))
    await js(f"(()=>{{const c=T.S().cust['{cid}'], o=T.W.custs['{cid}']; const q=T.W.queueAt(T.S(), c.reg, 0); o.x=q[0]; o.z=q[1];}})()"); await pg.wait_for_timeout(500)
    print('takeOrder', await step("const f=S().fu[fr('reg')]; return aim(f.x-0.2, W.dims.CZ-0.75, P.local(f,-0.1,1.05,0))+' -> '+go('p')", 300))
    chk(await js(f"T.S().cust['{cid}'].st==='w'"), 'order taken at the register')
    need_n = await js(f"Object.values(T.S().cust['{cid}'].ord).reduce((a,b)=>a+b,0)")
    print('box', await step("return aimSlot(stackAt('box'))+' -> '+go('p')", 200))
    for k in range(need_n): await step("const sl=P.slots(S(), fr('scase'))[0]; return aimSlot(sl, 0.12)+' -> '+go('p')", 120)
    chk(await js("T.held() && T.held().t==='box' && T.held().s.length") == need_n, f'put {need_n} slices in the box')
    await js(f"(()=>{{const o=T.W.custs['{cid}'], q=T.W.waitSpot(T.S(),0); o.x=q[0]; o.z=q[1];}})()"); await pg.wait_for_timeout(300)
    print('serve', await step(f"const o=W.custs['{cid}']; return aim(o.x, W.dims.CZ-0.75, [o.x,1.25,o.z])+' -> '+go('p')", 400))
    chk(await js(f"T.S().cust['{cid}'].st==='pay'"), 'customer received the box and goes to pay')
    await js(f"(()=>{{const c=T.S().cust['{cid}'], o=T.W.custs['{cid}']; const q=T.W.payAt(T.S(), c.reg, 0); o.x=q[0]; o.z=q[1];}})()"); await pg.wait_for_timeout(500)
    pm = await js(f"T.S().cust['{cid}'].pm"); s0 = await js("T.S().today.sales")
    print('pay', pm, await step("const f=S().fu[fr('reg')]; return aim(f.x-0.2, W.dims.CZ-0.75, P.local(f,-0.1,1.05,0))+' -> '+go('p')", 800))
    if pm == 'cash':
      ch = await js(f"CS.kitchen.change(T.S().cust['{cid}'])")
      left = ch
      for v in [5000, 1000, 500, 100, 50, 10, 5, 1]:
        while left >= v:
          await js(f"document.querySelector('[data-m=\"{v}\"]').click()"); left -= v
      await pg.screenshot(path=f'{OUT}/fp2_change.png')
      await js("document.querySelector('#cg-ok').click()"); await pg.wait_for_timeout(600)
      print('change given', ch)
    chk(await js("T.S().today.sales") > s0, 'paid: sales ' + str(await js("T.S().today.sales")))
    # 9) 洗い物：流しの型をこすって泡立て → 水を出す → 棚に置いて乾かす
    print('wash', await step("return aimF(fr('sink'), [-0.36,0.95,0.02], 0.55)+' -> '+go('s')", 1200))
    cv = await pg.locator('#ws-cv').bounding_box()
    if cv:
      cx, cy = cv['x'] + cv['width'] / 2, cv['y'] + cv['height'] / 2
      await pg.mouse.move(cx, cy); await pg.mouse.down()
      for k in range(160):
        a = k * 0.61; r = ((k * 7) % 23) / 23 * cv['width'] * 0.4
        await pg.mouse.move(cx + math.cos(a) * r, cy + math.sin(a) * r)
      await pg.mouse.up(); await pg.wait_for_timeout(200)
      await pg.screenshot(path=f'{OUT}/fp2_wash.png')
      print('rinse enabled', await js("!document.querySelector('#ws-rinse').disabled"))
      await js("document.querySelector('#ws-rinse').click()"); await pg.wait_for_timeout(2500)
    chk(await js("(()=>{const it=Object.values(T.S().k.items).find(i=>i.t==='pan'&&i.st==='empty'&&i.wet); return !!it && !it.dirty;})()"), 'pan washed (wet)')
    print('pick wet pan', await step("return aimF(fr('sink'), [-0.36,0.95,0.02], 0.55)+' -> '+go('p')", 200))
    print('to dry rack', await step("const sl='f:'+fr('sink')+':1'; return aimSlot(sl, 0.06)+' -> '+go('p')", 300))
    await js("Object.values(T.S().k.items).forEach(i=>{ if(i.wet && !String(i.at).startsWith('h:')) i.wd = T.R().now()+50; })"); await pg.wait_for_timeout(1500)
    chk(await js("Object.values(T.S().k.items).some(i=>i.t==='pan'&&i.st==='empty'&&!i.dirty&&!i.wet&&(CS.plan.slotDef(T.S(),i.at)||{}).type==='dry')"), 'pan dried on the rack')
    # 10) お皿を落とすと割れる
    n0 = await js("Object.values(T.S().k.items).filter(i=>i.t==='plate').length")
    print('pick plate', await step("const sl=Object.values(S().k.items).find(i=>i.t==='plate').at; return aimSlot(sl)+' -> '+go('p')"))
    print('drop', await step("W.target=null; W.discard(); return 'dropped'", 300))
    chk(await js("Object.values(T.S().k.items).filter(i=>i.t==='plate').length") == n0 - 1, 'plate broke when dropped')
    await pg.screenshot(path=f'{OUT}/fp2_end.png')
    print('fx', await js("T.S().fx.slice(-4).map(f=>f.x).join(' / ')"))
    print('\n'.join(logs[:20]))
    print('FAILS', len(fails), fails if fails else 'FP2 ALL OK')
    await b.close()
asyncio.run(main())
