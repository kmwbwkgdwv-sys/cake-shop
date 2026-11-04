# 一人称視点：照準で操作して「注文→生地→焼成→クリーム→デコ→陳列→OPEN→接客」を通す
import asyncio, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
HELP = r"""
window.T = (() => {
  const W = CS.world, K = CS.kitchen, R = () => CS.ui.room, S = () => CS.ui.room.S;
  const aim = (sx, sz, p) => { W.me.x = sx; W.me.z = sz; const dx = p[0] - sx, dz = p[2] - sz; W.me.yaw = Math.atan2(-dx, -dz); W.me.pitch = Math.atan2(p[1] - 1.58, Math.hypot(dx, dz)); W.updateCamera(); W.updateTarget(S()); return W.target ? [W.target.name, W.target.pri && W.target.pri.label, W.target.sec && W.target.sec.label] : null; };
  const go = (fn) => { const t = W.target; const r = fn === 'p' ? (t && t.pri && t.pri.a) : (t && t.sec && t.sec.a); if (fn === 'p') W.primary(); else W.secondary(); return r ? r.t : 'NONE'; };
  const held = () => { const id = K.held(S(), R().pid); return id ? S().k.items[id] : null; };
  const waitStop = (kind, i, aimFn) => new Promise((res) => { const g = K.gauge(S(), kind); const tgt = (g.lo + g.hi) / 2; const arr = kind === 'deco' ? S().k.deco : S().k[kind]; W.ready = false; const iv = setInterval(() => { const b = (kind === 'deco' ? S().k.deco : S().k[kind])[i]; const m = K.prog(b, R().now()); if (m >= tgt) { clearInterval(iv); W.ready = true; aimFn(); res(go('s') + ' m=' + m.toFixed(3) + ' lo=' + g.lo.toFixed(3) + ' hi=' + g.hi.toFixed(3)); } }, 30); });
  return { W, K, aim, go, held, S, R, waitStop };
})();
"""
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
    await ctx.add_init_script("if(!localStorage.getItem('cs.settings'))localStorage.setItem('cs.settings',JSON.stringify({autoQ:false}))")
    pg = await ctx.new_page(); logs = []; pg.set_default_timeout(40000)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    js = lambda c: pg.evaluate(c)
    click = "(()=>{const b=document.querySelector('#modal:not([hidden]) .btn.pink');if(b)b.click()})()"
    await pg.goto('http://localhost:8765/index.html'); await pg.wait_for_timeout(2500)
    await js("(()=>{const i=document.querySelector('#md-in'); if(i){i.value='いちご'; document.querySelector('#modal .btn.pink').click()}})()")
    await pg.wait_for_timeout(400); await js("document.querySelector('#btn-new').click()"); await pg.wait_for_timeout(500)
    await js("document.querySelector('#modal .btn.pink').click()"); await pg.wait_for_timeout(3000)
    for _ in range(3): await js(click); await pg.wait_for_timeout(300)
    await js("document.querySelector('#ov-start').click()"); await pg.wait_for_timeout(1200)
    for _ in range(3): await js(click); await pg.wait_for_timeout(300)
    await js(HELP)
    step = lambda c: js("(()=>{const {W,K,aim,go,held,S,R}=T;" + c + "})()")
    # PC → 注文
    print('pc', await step("const L=W.L; return aim(L.desk[0]-1.2, L.desk[1], [L.pc[0]+0.15,1.0,L.pc[2]])"))
    await step("go('p')"); await pg.wait_for_timeout(700)
    await pg.screenshot(path=f'{OUT}/fp2_pc.png')
    print('sheet', await js("CS.ui.sheet && CS.ui.sheet.o.title"))
    # カートに入れて発送
    await js("CS.game.mkView='list'; CS.game.cart=['egg','sugar','flour','butter','cream','strawberry']; CS.game.mkView='cart'; CS.ui.renderSheet(true)"); await pg.wait_for_timeout(600)
    await pg.screenshot(path=f'{OUT}/fp2_cart.png')
    await js("document.getElementById('mk-send').click()"); await pg.wait_for_timeout(800)
    await js("CS.ui.closeSheet()")
    print('crates', await step("return Object.values(S().k.items).filter(i=>i.t==='crate').map(i=>i.ing+':'+i.at).join(' ')"))
    print('truck', await step("return JSON.stringify([S().k.truck, R().now(), S().funds])"))
    await step("W.me.x=-W.dims.RX-2.0; W.me.z=W.L.backDoor[1]-3.5; W.me.yaw=Math.PI*0.9; W.me.pitch=-0.12;")
    await pg.wait_for_timeout(2500)
    await pg.screenshot(path=f'{OUT}/fp2_truck_coming.png')
    # 到着まで早送り
    await step("const n=R().now(); S().k.truck.at=n-500; Object.values(S().k.items).forEach(i=>{ if(i.t==='crate') i.ar=n-500; }); R().emit('state', S()); W.me.x=W.L.truck.x+0.3; W.me.z=W.L.truck.z-3.4; W.me.yaw=Math.PI+0.1; W.me.pitch=-0.3;")
    await pg.wait_for_timeout(3000)
    await pg.screenshot(path=f'{OUT}/fp2_truck_parked.png')
    # 荷台から取る → 在庫室へ → 開ける → 棚に置く → 空箱を回収
    for k in range(8):
      r = await step("""const L=W.L; const c=Object.entries(S().k.items).find(([id,i])=>i.t==='crate'&&String(i.at).startsWith('dl:')); if(!c) return 'done';
        const p=W.slotPos(c[1].at); const a1=aim(L.truck.x + (p[0] < L.truck.x ? -0.4 : 0.4), L.truck.z-3.3, [p[0],p[1]+0.17,p[2]]); const r1=go('p');
        const st=L.stock[c[1].ing]; const sp=[st.p[0], st.p[2]+st.f*1.0];
        const a2=aim(sp[0], sp[1], [st.p[0],st.p[1]+0.12,st.p[2]+st.f*0.08]); const r2=go('s');
        const a3=aim(sp[0], sp[1], [st.p[0],st.p[1]+0.12,st.p[2]+st.f*0.08]); const r3=go('p'); const r4=go('s');
        return [a1, r1, a2, r2, a3, r3, r4].join(' / ');""")
      print('crate', r)
      if r == 'done': break
      await pg.wait_for_timeout(300)
      if k == 0: await pg.screenshot(path=f'{OUT}/fp2_storage.png')
      r = await step("""const L=W.L; const b=L.trash[2]; const a=aim(b[0]+1.0, b[1]-0.3, [b[0],0.6,b[1]]); return a+' -> '+go('p')""")
      print('  recycle', r)
    await pg.wait_for_timeout(1500)
    print('truck after', await step("return JSON.stringify(S().k.truck)"))
    await pg.screenshot(path=f'{OUT}/fp2_storage2.png')
    print('inv', await step("return JSON.stringify(Object.fromEntries(Object.keys(S().inv).map(k=>[k,CS.sim.invCount(S(),k)])))"))
    # 生地：卵3 砂糖2 小麦粉2 バター1
    for ing, n in [('egg', 3), ('sugar', 2), ('flour', 2), ('butter', 1)]:
      for _ in range(n):
        r = await step(f"const m=W.L.mix[0]; const b=m.bins.find(x=>x.ing==='{ing}'); const a=aim(m.stand[0], m.stand[1], b.p); return a+' -> '+go('p')")
      print(ing, r)
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=f'{OUT}/fp2_mixbins.png')
    print('run', await step("const m=W.L.mix[0]; const a=aim(m.stand[0], m.stand[1], [m.bowl[0],1.1,m.bowl[2]]); return a+' -> '+go('s')"))
    print('stop', await js("T.waitStop('mix', 0, () => { const m=T.W.L.mix[0]; T.aim(m.stand[0], m.stand[1], [m.bowl[0],1.1,m.bowl[2]]); })"))
    print('mix0', await step("return JSON.stringify(S().k.mix[0])"))
    # 型を取って流す
    print('pan', await step("const L=W.L; const a=aim(L.panShelf[0]+0.2, L.panShelf[1]+1.2, [L.panShelf[0],1.0,L.panShelf[1]]); return a+' -> '+go('p')"))
    print('pour', await step("const m=W.L.mix[0]; const a=aim(m.stand[0], m.stand[1], [m.bowl[0],1.1,m.bowl[2]]); return a+' -> '+go('p')+' held='+JSON.stringify(held())"))
    # オーブン
    print('ovenOn', await step("const o=W.L.ovens[0]; const a=aim(o.stand[0], o.stand[1], [o.x,0.95,o.z+0.45]); return a+' -> '+go('s')"))
    print('ovenIn', await step("const o=W.L.ovens[0]; const a=aim(o.stand[0], o.stand[1], [o.x,0.95,o.z+0.45]); return a+' -> '+go('p')"))
    await pg.wait_for_timeout(500)
    # 焼き上がりまで早送り（予熱済み・焼成時間を経過させる）
    await step("const S0=S(); const n=R().now(); S0.ovens[0].hot=n-1; const id=K.at(S0,'ov:0'); const it=S0.k.items[id]; K.tick(S0,n); if(it.st==='baking'){ it.bk.t0 = n - it.bk.dur*0.9; } return it.st")
    await pg.screenshot(path=f'{OUT}/fp2_oven.png')
    await step("const S0=S(); const n=R().now(); const it=S0.k.items[K.at(S0,'ov:0')]; it.bk.t0 = n - it.bk.dur;")
    print('take', await step("const o=W.L.ovens[0]; const a=aim(o.stand[0], o.stand[1], [o.x,0.95,o.z+0.45]); return a+' -> '+go('p')+' '+JSON.stringify(held()&&[held().st,held().q,held().df,held().lab])"))
    print('rack', await step("const p=W.L.rack[2]; const a=aim(p[0]-1.2, p[2], [p[0],p[1]+0.05,p[2]]); return a+' -> '+go('p')"))
    await step("const it=Object.values(S().k.items).find(i=>i.t==='pan'&&i.st==='baked'); it.cool=0; it.warm=0;")
    # クリーム
    for ing, n in [('cream', 2), ('sugar', 1)]:
      for _ in range(n):
        r = await step(f"const m=W.L.whip[0]; const b=m.bins.find(x=>x.ing==='{ing}'); const a=aim(m.stand[0], m.stand[1], b.p); return a+' -> '+go('p')")
      print(ing, r)
    print('whip', await step("const m=W.L.whip[0]; const a=aim(m.stand[0], m.stand[1], [m.bowl[0],1.02,m.bowl[2]]); return a+' -> '+go('s')"))
    print('whipStop', await js("T.waitStop('whip', 0, () => { const m=T.W.L.whip[0]; T.aim(m.stand[0], m.stand[1], [m.bowl[0],1.02,m.bowl[2]]); })"))
    print('whip0', await step("return JSON.stringify(S().k.whip[0])"))
    # スポンジをデコ台へ
    print('pickPan', await step("const p=W.L.rack[2]; const a=aim(p[0]-1.2, p[2], [p[0],p[1]+0.06,p[2]]); return a+' -> '+go('p')"))
    print('toTT', await step("const d=W.L.deco[0]; const a=aim(d.stand[0], d.stand[1], [d.tt[0],1.02,d.tt[2]]); return a+' -> '+go('p')"))
    print('scoop', await step("const m=W.L.whip[0]; const a=aim(m.stand[0], m.stand[1], [m.bowl[0],1.02,m.bowl[2]]); return a+' -> '+go('p')"))
    print('spread', await step("const d=W.L.deco[0]; const a=aim(d.stand[0], d.stand[1], [d.tt[0],1.02,d.tt[2]]); return a+' -> '+go('s')"))
    await pg.wait_for_timeout(1200)
    # 指でなぞる（円を何周も）
    await js("""(async()=>{const cv=document.getElementById('sp-cv'); const r=cv.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
      const ev=(t,x,y)=>cv.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,pointerId:1,bubbles:true,pointerType:'touch'}));
      for (const rr of [0.05,0.12,0.19,0.26,0.32,0.36]) { ev('pointerdown', cx+rr*r.width, cy); for(let a=0;a<=Math.PI*2+0.3;a+=0.12){ ev('pointermove', cx+Math.cos(a)*rr*r.width, cy+Math.sin(a)*rr*r.width); } ev('pointerup', cx, cy); }
    })()""")
    await pg.wait_for_timeout(800)
    await pg.screenshot(path=f'{OUT}/fp2_spread.png')
    print('spread score', await js("document.getElementById('sp-q').textContent"))
    await js("document.getElementById('sp-done').click()")
    await pg.wait_for_timeout(500)
    print('spreadDone', await step("const dk=S().k.items[K.at(S(),'dt:0')]; return JSON.stringify([S().k.deco[0], dk.sq, dk.df])"))
    print('putCream', await step("const h=held(); if(!h) return 'empty hands'; const p=W.L.deco[0].side[0]; const a=aim(p[0]-0.2, p[2]+1.0, [p[0],p[1]+0.05,p[2]]); return a+' -> '+go('p')"))
    for k, (x, z) in enumerate([(0.0, -0.45), (0.4, 0.25), (-0.4, 0.25)]):
      r1 = await step("const d=W.L.deco[0]; const b=d.bins.find(x=>x.ing==='strawberry'); const a=aim(d.stand[0], d.stand[1], [b.p[0],0.98,b.p[2]]); return a+' -> '+go('p')")
      r2 = await step(f"""const d=W.L.deco[0]; const dk=S().k.items[K.at(S(),'dt:0')]; const y=d.tt[1]+W.topY(dk); const RR=0.09*0.92*1.5;
        const a=aim(d.stand[0], d.stand[1]-0.2, [d.tt[0]+{x}*RR, y, d.tt[2]+{z}*RR]); const ta=W.target&&W.target.pri&&W.target.pri.a; return a+' aim='+JSON.stringify(ta)+' ok='+W.target.aimOK+' -> '+go('p')""")
      print('top', k, r1, '|', r2)
    await pg.wait_for_timeout(500)
    await pg.screenshot(path=f'{OUT}/fp2_deco.png')
    print('finish', await step("const d=W.L.deco[0]; const a=aim(d.stand[0], d.stand[1], [d.tt[0],1.02,d.tt[2]]); return a+' -> '+go('s')"))
    await pg.wait_for_timeout(300)
    print('pickCake', await step("const d=W.L.deco[0]; const a=aim(d.stand[0], d.stand[1], [d.tt[0],1.02,d.tt[2]]); return a+' -> '+go('p')+' '+JSON.stringify(held())"))
    print('case', await step("const p=W.L.cases[0]; const a=aim(p[0], p[2]-1.0, [p[0],1.08,p[2]]); return a+' -> '+go('p')+' '+JSON.stringify(S().showcase[0])"))
    # 販売する商品はショートケーキだけにする（ホスト＝この端末）
    await step("Object.keys(S().menu).forEach(r=>R().act({t:'menuOn',r,on:r==='short'}))")
    # 看板を OPEN
    print('sign', await step("const L=W.L; const a=aim(L.sign[0]-0.2, L.sign[1]+1.4, [L.sign[0],0.55,L.sign[1]]); return a+' -> '+go('p')+' phase='+S().phase"))
    # お客さん
    await step("const S0=S(); const n=R().now(); K.spawn(S0,n);")
    for _ in range(40):
      ok = await step("const q=K.queue(S(),0); return q.length>0 && W.custs[q[0]] && W.custs[q[0]].atSpot")
      if ok: break
      await pg.wait_for_timeout(500)
    print('cust', await step("return JSON.stringify(Object.values(S().cust).map(c=>[c.st,c.ord,c.say]))"))
    await step("const S0=S(); Object.values(S0.cust).forEach(c=>{ if(c.st==='q'){} }); ")
    r = await step("const L=W.L; const r0=L.reg[0]; const a=aim(r0.x-0.3, W.dims.CASE_Z-0.9, r0.till); return a+' -> '+go('p')")
    print('takeOrder', r)
    await pg.wait_for_timeout(800)
    print('box', await step("const L=W.L; const a=aim(L.boxStack[0], W.dims.CASE_Z-0.9, [L.boxStack[0],1.2,L.boxStack[2]]); return a+' -> '+go('p')"))
    for _ in range(3):
      print('slice', await step("const p=W.L.cases[0]; const c=Object.values(S().cust).find(c=>c.st==='w'); const need=c?c.ord.short||0:0; const h=held(); if(!h||h.s.length>=need) return 'enough '+need; const a=aim(p[0], p[2]-1.0, [p[0],1.08,p[2]]); return a+' -> '+go('p')"))
    await pg.wait_for_timeout(800)
    await pg.screenshot(path=f'{OUT}/fp2_order.png')
    print('serve', await step("const id=Object.keys(S().cust).find(k=>S().cust[k].st==='w'); const o=W.custs[id]; if(!o) return 'no waiting'; const a=aim(o.x, W.dims.CASE_Z-0.9, [o.x,1.25,o.z]); return a+' -> '+go('p')+' sales='+S().today.sales"))
    await pg.wait_for_timeout(1500)
    await pg.screenshot(path=f'{OUT}/fp2_served.png')
    print('tut', await js("JSON.stringify(CS.LS.get('cs.tut2',null))"))
    print('\n'.join(logs[:20]))
    await b.close()
asyncio.run(main())
