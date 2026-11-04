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
