# 小さな確認用：注文票・吹き出し・縦向き表示
import asyncio, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1]
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = await b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, device_scale_factor=2)
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
    await pg.screenshot(path=f'{OUT}/m_tut.png')
    for _ in range(3): await js(click); await pg.wait_for_timeout(300)
    await js("""(()=>{const r=CS.ui.room,S=r.S,n=r.now(); S.phase='open'; S.dayAt=n;
      S.cust.a1={ty:'worker',v:1,st:'w',t0:n-9000,tq:n,lane:0,seat:-1,ord:{short:2},no:3,pw:n+40000};
      S.cust.a2={ty:'parent',v:2,st:'w',t0:n-9000,tq:n,lane:0,seat:-1,ord:{short:1,choco:1},no:4,pw:n+8000};
      S.cust.a3={ty:'elder',v:0,st:'q',t0:n-9000,tq:n,lane:0,seat:-1,ord:{short:1},pq:n+30000};
      S.showcase[0]={r:'short',q:1,p:5,n:6,c:888,d:1,o:0,df:[]}; S.showcase[1]={r:'choco',q:0.9,p:6,n:6,c:900,d:1,o:0,df:[]};
      r.emit('state', S);
      const W=CS.world; W.me.x=1.0; W.me.z=W.dims.CASE_Z-0.9; W.me.yaw=Math.PI; W.me.pitch=-0.12;})()""")
    await pg.wait_for_timeout(6000)
    print('orders', await js("document.getElementById('orders').innerHTML.slice(0,300)"))
    await pg.screenshot(path=f'{OUT}/m_front.png')
    await js("(()=>{const W=CS.world; const m=W.L.mix[0]; W.me.x=m.x; W.me.z=m.stand[1]+0.1; W.me.yaw=0; W.me.pitch=-0.4;})()")
    await pg.wait_for_timeout(2500)
    await pg.screenshot(path=f'{OUT}/m_mix.png')
    await js("""(()=>{const r=CS.ui.room,S=r.S,n=r.now(); S.k.items.zz={t:'deco',b:'plain',q:1,df:[],c:300,cr:'whip',crq:1,sq:1,tops:{},tp:[],warm:0,at:'dt:0'}; S.k.deco[0]={st:'spread',by:r.pid,t0:n}; r.emit('state',S); CS.game.openSpread(0);})()""")
    await pg.wait_for_timeout(1200)
    await pg.screenshot(path=f'{OUT}/m_spread.png')
    await js("document.getElementById('sp-later').click()")
    await js("CS.game.openPC('ing')"); await pg.wait_for_timeout(1000); await pg.screenshot(path=f'{OUT}/m_pc.png'); await js("CS.ui.closeSheet()")
    await pg.set_viewport_size({'width': 390, 'height': 844}); await pg.wait_for_timeout(1500)
    await pg.screenshot(path=f'{OUT}/m_portrait.png')
    print('\n'.join(logs[:10]))
    await b.close()
asyncio.run(main())
