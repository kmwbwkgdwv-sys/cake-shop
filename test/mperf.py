# スマホ想定の負荷テスト：GPU バッファの増え方・1フレームの JS 時間・状態更新ごとの処理時間・フレームループが止まらないか
import asyncio, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
THR = float(sys.argv[2]) if len(sys.argv) > 2 else 4
DPR = int(sys.argv[3]) if len(sys.argv) > 3 else 1
INIT = r"""
(() => {
  const P = WebGLRenderingContext.prototype;
  window.__gl = { buf: 0, del: 0, bytes: 0, tex: 0, lost: 0 };
  const cb = P.createBuffer, db = P.deleteBuffer, bd = P.bufferData, ct = P.createTexture;
  P.createBuffer = function () { window.__gl.buf++; return cb.apply(this, arguments); };
  P.deleteBuffer = function () { window.__gl.del++; return db.apply(this, arguments); };
  P.bufferData = function (t, d) { if (d && d.byteLength) window.__gl.bytes += d.byteLength; return bd.apply(this, arguments); };
  P.createTexture = function () { window.__gl.tex++; return ct.apply(this, arguments); };
})();
"""
PROBE = r"""
(() => {
  const W = CS.world; if (W.__probe) return; W.__probe = 1;
  window.__ft = []; window.__st = []; window.__err = [];
  const f = W.frame; W.frame = function () { const t = performance.now(); try { return f.apply(this, arguments); } finally { window.__ft.push(performance.now() - t); } };
  const sy = W.sync; W.sync = function () { const t = performance.now(); try { return sy.apply(this, arguments); } finally { window.__st.push(performance.now() - t); } };
  window.addEventListener('error', (e) => window.__err.push(String(e.message)));
})();
"""
STATS = r"""
(() => { const a = window.__ft.splice(0), b = window.__st.splice(0); const q = (x, p) => { if (!x.length) return 0; const s = x.slice().sort((m, n) => m - n); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1); };
  return JSON.stringify({ frames: a.length, f50: q(a, 0.5), f95: q(a, 0.95), fmax: q(a, 1), syncs: b.length, s50: q(b, 0.5), s95: q(b, 0.95), smax: q(b, 1), live: __gl.buf - __gl.del, mb: +(__gl.bytes / 1e6).toFixed(1), tex: __gl.tex, err: window.__err.slice(0, 3), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : 0 }); })()
"""
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--enable-precise-memory-info'])
    ctx = await b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, device_scale_factor=DPR)
    await ctx.add_init_script(INIT)
    pg = await ctx.new_page(); logs = []; pg.set_default_timeout(60000)
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
    await js("localStorage.setItem('cs.tut2','1'); CS.game.tutorial && document.querySelector('#tut') && (document.querySelector('#tut').hidden=true)")
    cdp = await ctx.new_cdp_session(pg)
    await cdp.send('Emulation.setCPUThrottlingRate', {'rate': THR})
    await js(PROBE)
    await pg.wait_for_timeout(3000); print('idle', await js(STATS))
    # 在庫を増やして、棚に1つずつ置く（長押し）のと同じ頻度で状態が変わる
    await js("""(()=>{const r=CS.ui.room,S=r.S; S.funds=999999; ['shelf','cshelf','table'].forEach(k=>r.act({t:'fbuy',k})); Object.keys(CS.data.ING).forEach(k=>CS.kitchen.invAdd(S,k,30,50)); r.emit('state',S);
      const W=CS.world, st=W.L.store; W.me.x=st.x0+2.2; W.me.z=st.z0+2.6; W.me.yaw=Math.PI*0.5; W.me.pitch=-0.15; })()""")
    await pg.wait_for_timeout(1500); await js(STATS)
    await js("""window.__iv=setInterval(()=>{const r=CS.ui.room,S=r.S; const ks=Object.keys(CS.data.ING); const k=ks[Math.floor(Math.random()*ks.length)]; CS.kitchen.invAdd(S,k,1,50); r.emit('state',S);},170)""")
    await pg.wait_for_timeout(8000); await js("clearInterval(window.__iv)")
    print('shelving', await js(STATS))
    # ショーケースのケーキが1切れずつ売れていく
    await js("""(()=>{const r=CS.ui.room,S=r.S; const ids=['short','chocolate','baked_cheese','lemon_tart'].filter(x=>CS.sim.recipe(S,x)); r.act({t:'fbuy',k:'pcase'}); r.act({t:'fbuy',k:'pcaseN'}); const P=CS.plan; let i=0; ['pcase','pcaseN'].forEach(k=>P.list(S,k).forEach(f=>P.slots(S,f).forEach(sl=>{ if(!CS.kitchen.inSlot(S,sl).length) CS.kitchen.add(S,{t:'tray',r:ids[i++%ids.length]||'short',q:0.9,p:6,n:6,c:900,d:1,o:0,df:i%3?[]:['messy'],at:sl,pl:0}); }))); r.emit('state',S);
      const W=CS.world, f=S.fu[P.list(S,'pcase')[0]], st=P.stand(f,1.0); W.me.x=st[0]; W.me.z=st[1]; W.me.yaw=Math.atan2(-(f.x-st[0]),-(f.z-st[1])); W.me.pitch=-0.35; })()""")
    await pg.wait_for_timeout(1500); await js(STATS)
    await js("""window.__iv=setInterval(()=>{const r=CS.ui.room,S=r.S; const ts=CS.kitchen.trays(S); const c=S.k.items[ts[Math.floor(Math.random()*ts.length)]]; if(c){ c.p-=1; if(c.p<=0) c.p=6; } r.emit('state',S);},400)""")
    await pg.wait_for_timeout(8000); await js("clearInterval(window.__iv)")
    print('selling', await js(STATS))
    # デコ台でトッピングを置き続ける
    await js("""(()=>{const r=CS.ui.room,S=r.S; r.act({t:'fbuy',k:'deco'}); const P=CS.plan, fid=P.list(S,'deco')[0], f=S.fu[fid]; S.k.items.dz={t:'deco',b:'plain',q:1,df:[],c:300,cr:'whip',crq:1,sq:1,tops:{},tp:[],warm:0,at:'f:'+fid+':0'}; r.emit('state',S); const W=CS.world, st=P.stand(f,0.5); W.me.x=st[0]; W.me.z=st[1]; W.me.yaw=Math.atan2(-(f.x-st[0]),-(f.z-st[1])); W.me.pitch=-0.7;})()""")
    await js("""window.__iv=setInterval(()=>{const r=CS.ui.room,S=r.S,it=S.k.items.dz; if(!it) return; it.tp.push([Math.random()-0.5,Math.random()-0.5,'strawberry']); if(it.tp.length>8) it.tp=[]; r.emit('state',S);},300)""")
    await pg.wait_for_timeout(6000); await js("clearInterval(window.__iv)")
    print('topping', await js(STATS))
    # スティックとスワイプを長く続ける
    joy = await js("(()=>{const r=document.getElementById('joy').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]})()")
    for k in range(20):
      await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': joy[0], 'y': joy[1], 'id': 1}, {'x': 600, 'y': 200, 'id': 2}]})
      for s in range(6):
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': joy[0] + 20, 'y': joy[1] - 30, 'id': 1}, {'x': 600 + s * 12, 'y': 200 + (s % 2) * 6, 'id': 2}]})
        await pg.wait_for_timeout(40)
      await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd' if k % 3 else 'touchCancel', 'touchPoints': []})
    await pg.wait_for_timeout(1000)
    print('touch', await js(STATS), 'joy stuck?', await js("JSON.stringify(CS.world.input.joy)"))
    # 1フレームで例外が起きてもループが続くか
    await js("(()=>{const W=CS.world; const u=W.updateLights; let n=0; W.updateLights=function(){ if(n++<2) throw new Error('test-throw'); return u.apply(this,arguments); };})()")
    await pg.wait_for_timeout(500); await js(STATS); await pg.wait_for_timeout(2500)
    print('after throw (frames keep coming?)', await js(STATS))
    # WebGL が落ちても作り直されるか（スマホでメモリ不足のとき）
    e0 = await js("CS.world.eng.id")
    await js("CS.world.eng.gl.getExtension('WEBGL_lose_context').loseContext()")
    await pg.wait_for_timeout(4000)
    print('context lost → new engine', e0, '->', await js("CS.world.eng.id"), 'ready', await js("CS.world.ready"), 'qlv', await js("CS.world.qlv"), await js(STATS))
    await pg.wait_for_timeout(2000)
    print('after recover', await js(STATS), 'items', await js("Object.keys(CS.world.items).length"), 'toast', await js("(document.querySelector('#toasts')||{}).textContent"))
    await pg.screenshot(path=f'{OUT}/mperf_end.png')
    print('\n'.join(logs[:10]))
    await b.close()
asyncio.run(main())
