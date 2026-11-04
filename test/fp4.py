# 商品棚の値札・賞味期限の表示、注文票の「作る」、販売価格タブ、家具タブ（商品棚の購入）
import asyncio, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1]
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
    await ctx.add_init_script("localStorage.setItem('cs.settings',JSON.stringify({autoQ:false}));localStorage.setItem('cs.tut2',JSON.stringify({i:0,off:true}));localStorage.setItem('cs.mh','true')")
    pg = await ctx.new_page(); pg.set_default_timeout(60000); logs = []
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
    await js("""(()=>{const r=CS.ui.room,S=r.S,n=r.now(); S.day=3; S.funds=200000;
      S.showcase[0]={r:'short',q:0.9,p:5,n:6,c:900,d:3,o:0,df:[]}; S.showcase[1]={r:'chocolate',q:0.9,p:2,n:6,c:900,d:2,o:1,df:[]}; S.showcase[2]={r:'baked_cheese',q:0.9,p:6,n:6,c:900,d:3,o:0,df:[]};
      S.phase='open'; S.dayAt=n; S.k.ordNo=4;
      S.cust.a1={ty:'parent',v:1,st:'w',t0:n-9000,tq:n,lane:0,seat:-1,ord:{short:2,baked_cheese:1},no:3,pw:n+40000,tOrd:n};
      S.cust.a2={ty:'student',v:2,st:'w',t0:n-9000,tq:n,lane:0,seat:-1,ord:{chocolate:3,chiffon:1},no:4,pw:n+210000,tOrd:n,make:1};
      S.k.items.ck={t:'cake',r:'short',q:0.9,df:[],p:6,n:6,c:900,d:2,at:'fr:4'};
      r.emit('state',S); const W=CS.world; W.me.x=-3.0; W.me.z=W.dims.CASE_Z+1.7; W.me.yaw=0.05; W.me.pitch=-0.3;})()""")
    await pg.wait_for_timeout(2500); await pg.screenshot(path=f'{OUT}/fp4_shelf.png')
    await js("(()=>{const W=CS.world; W.me.x=-1.5; W.me.z=W.dims.CASE_Z+4.6; W.me.yaw=0.15; W.me.pitch=-0.12;})()")
    await pg.wait_for_timeout(1800); await pg.screenshot(path=f'{OUT}/fp4_shelf_far.png')
    await js("(()=>{const W=CS.world,F=W.L.fridge,p=F.slots[4]; W.me.x=F.x+0.1; W.me.z=-W.dims.RZ+1.6; const dx=p[0]-W.me.x, dz=p[2]-W.me.z; W.me.yaw=Math.atan2(-dx,-dz); W.me.pitch=-0.15;})()")
    await pg.wait_for_timeout(1800); await pg.screenshot(path=f'{OUT}/fp4_fridge_cake.png')
    await js("CS.game.openPC('sell')"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f'{OUT}/fp4_sell.png')
    await js("CS.ui.closeSheet(); CS.game.openPC('furn')"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f'{OUT}/fp4_furn.png')
    n0 = await js("CS.ui.room.S.showcase.length")
    await js("document.querySelector('[data-shelf]').click()"); await pg.wait_for_timeout(500); await js("document.querySelector('#modal:not([hidden]) .btn.mint').click()"); await pg.wait_for_timeout(1500)
    print('shelves', n0, '->', await js("CS.ui.room.S.showcase.length"))
    await js("CS.ui.closeSheet(); CS.ui.openSettings(true)"); await pg.wait_for_timeout(600)
    await js("(()=>{const t=[...document.querySelectorAll('.sh-tabs button')].find(b=>/お店/.test(b.textContent)); if(t) t.click();})()"); await pg.wait_for_timeout(800)
    await js("(()=>{const el=document.querySelector('[data-mon=chocolate]'); el.click();})()"); await pg.wait_for_timeout(800)
    print('host toggled chocolate ->', await js("CS.ui.room.S.menu.chocolate.on"))
    await pg.screenshot(path=f'{OUT}/fp4_settings.png')
    print('\n'.join(logs[:10]))
    await b.close()
asyncio.run(main())
