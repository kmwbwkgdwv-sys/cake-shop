# 一人称視点：入店してあちこちを撮影・エラー確認
import asyncio, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
VW = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
VH = int(sys.argv[3]) if len(sys.argv) > 3 else 720
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': VW, 'height': VH})
    await ctx.add_init_script("if(!localStorage.getItem('cs.settings'))localStorage.setItem('cs.settings',JSON.stringify({autoQ:false}))")
    pg = await ctx.new_page(); logs = []; pg.set_default_timeout(40000)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.on('console', lambda m: logs.append('CONSOLE ' + m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    js = lambda c: pg.evaluate(c)
    click = "(()=>{const b=document.querySelector('#modal:not([hidden]) .btn.pink');if(b)b.click()})()"
    await pg.goto('http://localhost:8765/index.html'); await pg.wait_for_timeout(2500)
    await js("(()=>{const i=document.querySelector('#md-in'); if(i){i.value='いちご'; document.querySelector('#modal .btn.pink').click()}})()")
    await pg.wait_for_timeout(400); await js("document.querySelector('#btn-new').click()"); await pg.wait_for_timeout(500)
    await js("document.querySelector('#modal .btn.pink').click()"); await pg.wait_for_timeout(3000)
    for _ in range(3): await js(click); await pg.wait_for_timeout(300)
    await js("document.querySelector('#ov-start').click()"); await pg.wait_for_timeout(1500)
    await pg.screenshot(path=f'{OUT}/fp_tutmodal.png')
    for _ in range(3): await js(click); await pg.wait_for_timeout(300)
    await pg.wait_for_timeout(1500)
    await pg.screenshot(path=f'{OUT}/fp_start.png')
    views = [
      ('kitchen_back', "W.me.x=-3; W.me.z=W.dims.CASE_Z-1.0; W.me.yaw=0; W.me.pitch=-0.12"),
      ('mixers', "const m=W.L.mix[0]; W.me.x=m.x+0.3; W.me.z=m.stand[1]+0.4; W.me.yaw=0.1; W.me.pitch=-0.45"),
      ('ovens', "const o=W.L.ovens[1]; W.me.x=o.x; W.me.z=o.stand[1]+0.5; W.me.yaw=0; W.me.pitch=-0.3"),
      ('deco', "const d=W.L.deco[0]; W.me.x=d.x; W.me.z=d.stand[1]; W.me.yaw=0; W.me.pitch=-0.7"),
      ('pc', "W.me.x=W.L.desk[0]-1.4; W.me.z=W.L.desk[1]; W.me.yaw=-Math.PI/2; W.me.pitch=-0.25"),
      ('backdoor', "W.me.x=-W.dims.RX+2.4; W.me.z=-W.dims.RZ+4.5; W.me.yaw=Math.PI/2+0.5; W.me.pitch=-0.35"),
      ('front', "W.me.x=-1; W.me.z=W.dims.CASE_Z-0.9; W.me.yaw=Math.PI; W.me.pitch=-0.1"),
      ('salesfloor', "W.me.x=6; W.me.z=W.dims.RZ-1.2; W.me.yaw=Math.PI*0.25+Math.PI*0.75; W.me.pitch=-0.05"),
      ('outside', "W.me.x=0.3; W.me.z=W.dims.RZ+2.6; W.me.yaw=0.3; W.me.pitch=-0.15"),
      ('store_in', "const S2=W.L.store; W.me.x=S2.x1-0.5; W.me.z=S2.z0+2.0; W.me.yaw=Math.PI/2+0.55; W.me.pitch=-0.15"),
      ('store_fridge', "const S2=W.L.store; W.me.x=S2.x0+2.2; W.me.z=S2.z0+1.4; W.me.yaw=Math.PI; W.me.pitch=-0.1"),
      ('store_door', "const S2=W.L.store; W.me.x=S2.x1+2.4; W.me.z=S2.door+0.6; W.me.yaw=Math.PI/2-0.2; W.me.pitch=-0.05"),
      ('office', "const O=W.L.office; W.me.x=O.x0+1.0; W.me.z=O.door+0.2; W.me.yaw=-Math.PI/2+0.3; W.me.pitch=-0.12"),
      ('fridge', "const F=W.L.fridge, S=CS.ui.room.S; S.k.items.f1={t:'cream',k:'whip',q:1,df:[],n:3,c:100,at:'fr:0'}; S.k.items.f2={t:'cake',r:'short',q:0.9,df:[],p:6,n:6,c:900,at:'fr:4'}; S.k.items.f3={t:'pan',st:'baked',b:'plain',q:0.9,df:[],c:200,at:'fr:2'}; CS.ui.room.emit('state',S); W.me.x=F.x-0.15; W.me.z=-W.dims.RZ+1.8; W.me.yaw=0.04; W.me.pitch=-0.22"),
      ('warm', "const S=CS.ui.room.S, n=CS.ui.room.now(), sp=W.L.spots[1]; S.k.items.f4={t:'cream',k:'whip',q:1,df:['soft'],n:3,c:100,at:'sp:1',w0:n-150000,sp:1}; S.k.items.f5={t:'crate',ing:'strawberry',n:10,u:130,ar:0,at:'sp:3',w0:n-200000,sp:2,open:1}; CS.ui.room.emit('state',S); W.me.x=sp[0]+0.3; W.me.z=sp[2]+1.3; W.me.yaw=0.15; W.me.pitch=-0.45"),
      ('fridge_aim', "const F=W.L.fridge, p=F.slots[4]; W.me.x=F.x+0.1; W.me.z=-W.dims.RZ+1.5; const dx=p[0]-W.me.x, dz=p[2]-W.me.z; W.me.yaw=Math.atan2(-dx,-dz); W.me.pitch=Math.atan2(p[1]+0.08-1.58, Math.hypot(dx,dz))"),
      ('alley', "W.me.x=-W.dims.RX-1.2; W.me.z=W.L.backDoor[1]-2.6; W.me.yaw=Math.PI+0.5; W.me.pitch=-0.05"),
    ]
    for name, code in views:
      await js("(()=>{const W=CS.world;" + code + "})()")
      await pg.wait_for_timeout(1600)
      await pg.screenshot(path=f'{OUT}/fp_{name}.png')
      t = await js("(()=>{const t=CS.world.target;return t?t.name+' | '+(t.pri&&t.pri.label)+' | '+(t.sec&&t.sec.label):null})()")
      print(name, t)
    await js("CS.game.openPC('ing')"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f'{OUT}/fp_pcsheet.png')
    await js("CS.ui.closeSheet(); CS.ui.openSettings(true)"); await pg.wait_for_timeout(1000); await pg.screenshot(path=f'{OUT}/fp_settings.png')
    await js("CS.ui.closeSheet(); CS.game.openRecipeBook()"); await pg.wait_for_timeout(1000); await pg.screenshot(path=f'{OUT}/fp_book.png')
    await js("CS.ui.closeSheet(); CS.settings.light=true; CS.settings.save(); (()=>{const W=CS.world; W.me.x=-3; W.me.z=W.dims.CASE_Z-1.0; W.me.yaw=0.4; W.me.pitch=-0.12})()"); await pg.wait_for_timeout(2500); await pg.screenshot(path=f'{OUT}/fp_light.png')
    print('\n'.join(logs[:20]))
    await b.close()
asyncio.run(main())
