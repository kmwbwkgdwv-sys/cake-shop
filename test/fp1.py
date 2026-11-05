# 一人称視点：入店して家具・部屋をあちこち撮影・エラー確認（家具を自由に置ける版）
import asyncio, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
VW = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
VH = int(sys.argv[3]) if len(sys.argv) > 3 else 720
HELP = """
window.T = window.T || {};
T.S = () => CS.ui.room.S;
T.fr = (k, i) => { const S = T.S(), id = CS.plan.list(S, k)[i || 0]; return [id, S.fu[id]]; };
T.face = (k, d, pitch, side) => { const W = CS.world, [id, f] = T.fr(k); const o = CS.plan.dirs(f.r); const st = CS.plan.stand(f, d || 0.9); W.me.x = st[0] + o.rx * (side || 0); W.me.z = st[1] + o.rz * (side || 0); const dx = f.x - W.me.x, dz = f.z - W.me.z; W.me.yaw = Math.atan2(-dx, -dz); W.me.pitch = pitch == null ? -0.35 : pitch; return id; };
T.aim = (p) => { const W = CS.world; const dx = p[0] - W.me.x, dz = p[2] - W.me.z; W.me.yaw = Math.atan2(-dx, -dz); W.me.pitch = Math.atan2(p[1] - 1.58, Math.hypot(dx, dz)); };
T.slot = (k, i, n) => { const [id] = T.fr(k, i); return 'f:' + id + ':' + (n || 0); };
T.emit = () => CS.ui.room.emit('state', T.S());
"""
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': VW, 'height': VH}, has_touch=VW < 900, is_mobile=VW < 900)
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
    for _ in range(3): await js(click); await pg.wait_for_timeout(300)
    await pg.wait_for_timeout(1200)
    await js(HELP)
    await pg.screenshot(path=f'{OUT}/fp_start.png')
    print('start target', await js("(()=>{const t=CS.world.target;return t?t.name:null})()"))
    # 道具を買う（オーブン・ミキサー・デコ台）
    r = await js("(async()=>{const a=CS.ui.room; const out=[]; for (const k of ['oven','mixer','deco']) out.push((await a.act({t:'fbuy',k})).ok); return out})()")
    await js("(()=>{const S=T.S(); for (const id of Object.keys(S.k.items)) { const it=S.k.items[id]; if (it.t==='fcrate') { CS.kitchen.placeNew(S, it.k); delete S.k.items[id]; } } S.k.pend=[]; T.emit(); })()")
    print('fbuy', r, await js("Object.values(T.S().fu).map(f=>f.k+'@'+f.x.toFixed(1)+','+f.z.toFixed(1)+'r'+f.r).join(' ')"))
    # 物を置いてみる（材料・箱・ケーキ・お皿）
    await js("""(()=>{const S=T.S(), K=CS.kitchen; ['egg','butter','milk','cream','strawberry'].forEach(i=>K.invAdd(S,i,12,50)); ['flour','sugar'].forEach(i=>K.invAdd(S,i,14,40)); K.invAdd(S,'box',20,60);
      S.k.items.t1={t:'tray',r:'short',q:0.9,df:[],p:4,n:6,c:900,d:S.day,at:T.slot('scase',0,0),pl:1};
      S.k.items.t2={t:'tray',r:'chocolate',q:0.9,df:[],p:6,n:6,c:900,d:S.day,at:T.slot('scase',0,4),pl:1};
      S.k.items.t3={t:'tray',r:'short',q:0.9,df:[],p:6,n:6,w:1,c:900,d:S.day,at:T.slot('scase',0,1),pl:1};
      S.k.items.t4={t:'tray',r:'baked_cheese',q:0.9,df:[],p:6,n:6,w:1,c:900,d:S.day,at:T.slot('scase',0,7),pl:1};
      S.k.items.c3={t:'cake',r:'chocolate',q:0.9,df:[],p:4,n:6,dish:1,c:900,d:S.day,at:T.slot('table',0,0),pl:1};
      S.k.items.c1={t:'cake',r:'short',q:0.9,df:[],p:6,n:6,c:900,d:S.day,at:T.slot('fridge',0,1),pl:1};
      S.k.items.c2={t:'cream',k:'whip',q:1,df:[],n:3,c:100,at:T.slot('fridge',0,3),pl:1};
      S.k.items.p2={t:'plate',s:[],dirty:1,at:T.slot('sink',0,0),pl:1};
      S.k.items.p3={t:'plate',s:[],wet:1,at:T.slot('sink',0,1),pl:1};
      S.k.items.pn={t:'pan',st:'baked',b:'plain',q:0.9,df:[],c:200,cool:0,at:T.slot('table',0,1),pl:1};
      T.emit();})()""")
    views = [
      ('kitchen', "const W=CS.world; W.me.x=2.5; W.me.z=W.dims.CZ-1.0; W.me.yaw=0.5; W.me.pitch=-0.1"),
      ('kitchen2', "const W=CS.world; W.me.x=6.5; W.me.z=W.dims.CZ-1.2; W.me.yaw=0.9; W.me.pitch=-0.12"),
      ('store', "T.face('cshelf', 1.6, -0.2, 0.9)"),
      ('shelf', "T.face('shelf', 1.0, -0.35)"),
      ('pcroom', "const W=CS.world, L=W.L; W.me.x=L.desk[0]; W.me.z=L.desk[1]+1.5; W.me.yaw=0; W.me.pitch=-0.3"),
      ('pcdoor', "const W=CS.world, g=W.L.g; W.me.x=g.pc.door-0.3; W.me.z=g.pc.z1+2.6; W.me.yaw=0.1; W.me.pitch=-0.05"),
      ('fridge', "T.face('fridge', 1.0, -0.15)"),
      ('mixer', "T.face('mixer', 0.6, -0.55)"),
      ('oven', "T.face('oven', 0.9, -0.3)"),
      ('deco', "T.face('deco', 0.55, -0.7)"),
      ('whip', "T.face('whip', 0.6, -0.6)"),
      ('sink', "T.face('sink', 0.55, -0.6)"),
      ('table', "T.face('table', 0.6, -0.6)"),
      ('pcase', "const W=CS.world, [id,f]=T.fr('scase'); W.me.x=f.x; W.me.z=W.dims.CZ-1.2; W.me.yaw=Math.PI; W.me.pitch=-0.4"),
      ('scase_front', "const W=CS.world, [id,f]=T.fr('scase'); W.me.x=f.x+0.3; W.me.z=W.dims.CZ+2.2; W.me.yaw=0.1; W.me.pitch=-0.3"),
      ('pcase_aim', "const W=CS.world, [id,f]=T.fr('scase'); W.me.x=f.x-0.72; W.me.z=W.dims.CZ-0.95; const sl=T.slot('scase',0,0); T.aim(CS.plan.slotPos(T.S(), sl).map((v,i)=>i===1?v+0.12:v))"),
      ('reg_front', "const W=CS.world, [id,f]=T.fr('reg'); W.me.x=f.x-0.3; W.me.z=W.dims.CZ+2.4; W.me.yaw=0; W.me.pitch=-0.25"),
      ('reg_back', "const W=CS.world, [id,f]=T.fr('reg'); W.me.x=f.x-0.4; W.me.z=W.dims.CZ-0.8; W.me.yaw=Math.PI; W.me.pitch=-0.45"),
      ('salesfloor', "const W=CS.world; W.me.x=6; W.me.z=W.dims.RZ-1.2; W.me.yaw=Math.PI*0.25+Math.PI*0.75; W.me.pitch=-0.05"),
      ('backdoor', "const W=CS.world; W.me.x=-W.dims.RX+2.6; W.me.z=W.L.backDoor[1]+0.4; W.me.yaw=Math.PI/2; W.me.pitch=-0.1"),
      ('outside', "const W=CS.world; W.me.x=0.3; W.me.z=W.dims.RZ+2.6; W.me.yaw=0.3; W.me.pitch=-0.15"),
      ('town', "const W=CS.world; W.me.x=-2; W.me.z=W.dims.RZ+3.2; W.me.yaw=Math.PI*0.75; W.me.pitch=0.02"),
      ('town2', "const W=CS.world; W.me.x=3; W.me.z=W.dims.RZ+3.2; W.me.yaw=-Math.PI*0.7; W.me.pitch=0.05"),
      ('knife_table', "T.face('table', 0.5, -0.75)"),
      ('scase_whole', "const W=CS.world, [id,f]=T.fr('scase'); W.me.x=f.x-0.4; W.me.z=W.dims.CZ+1.3; W.me.yaw=-0.1; W.me.pitch=-0.35"),
      ('guide', "const S=T.S(); localStorage.setItem('cs.tut3:'+CS.ui.room.code, JSON.stringify({i:0,off:false,sk:{}})); CS.game._tutPc=false; CS.game.tutCheck(S); const W=CS.world; W.me.x=2; W.me.z=W.dims.CZ-2; W.me.yaw=0.4; W.me.pitch=-0.05"),
      ('guide_edge', "const W=CS.world; W.me.yaw=Math.PI; CS.game.tutCheck(T.S())"),
      ('memo', "CS.game.memoShow('short'); const W=CS.world; W.me.x=2.5; W.me.z=W.dims.CZ-1.0; W.me.yaw=0.5; W.me.pitch=-0.1"),
      ('floor_crates', "const S=T.S(), K=CS.kitchen, P=CS.plan; const g=P.geomOf(S); [['egg',1],['flour',0],['sugar',0]].forEach(([ing,op],i)=>{ const it={t:'crate',ing,n:10-i*4,u:40,open:op,ar:0,pl:1}; K.toFloor(S,it,[-g.RX+2.2,g.backDoor.z+1.8]); S.k.items['fc'+i]=it; }); const fb={t:'fcrate',k:'oven',ar:0,pl:1}; K.toFloor(S,fb,[-g.RX+3,g.backDoor.z+2.5]); S.k.items.fbx=fb; T.emit(); const W=CS.world; W.me.x=-g.RX+4.6; W.me.z=g.backDoor.z+2.0; W.me.yaw=Math.PI/2; W.me.pitch=-0.4"),
      ('crack', "const S=T.S(), K=CS.kitchen, P=CS.plan; const id=K.placeNew(S,'crack',[-6,-9]); P.slots(S,id).slice(0,3).forEach((sl,i)=>{ S.k.items['ck'+i]={t:'crate',ing:['egg','flour','box'][i],n:10,u:40,open:i===1?1:0,ar:0,at:sl,pl:1}; }); T.emit(); const W=CS.world, f=S.fu[id], st=P.stand(f,1.5); W.me.x=st[0]; W.me.z=st[1]; W.me.yaw=Math.atan2(-(f.x-st[0]),-(f.z-st[1])); W.me.pitch=-0.3"),
      ('pc_ing', "CS.game.openPC('ing'); setTimeout(()=>{ const b=document.querySelector('#sheet .sh-body, #sheet .sh .body, #sheet [class*=body]'); if(b) b.scrollTop=99999; }, 500)"),
      ('pc_staff', "CS.ui.closeSheet(); const S=T.S(); S.xp=900; CS.ui.room.act({t:'hire',slot:0}).then(()=>CS.ui.room.act({t:'hire',slot:1})).then(()=>CS.ui.room.act({t:'staffTask',slot:0,task:'chef',opt:'short'})).then(()=>CS.ui.room.act({t:'staffTask',slot:1,task:'stock',opt:''})).then(()=>CS.game.openPC('staff'))"),
      ('storage3', "CS.ui.closeSheet(); 0 || (()=>{})();"),
      ('storage3b', "const S=T.S(); S.up.storage=3; CS.kitchen.normalize(S); T.emit(); const W=CS.world, g=CS.plan.geomOf(S); W.me.x=g.store.door+0.3; W.me.z=g.store.z1+3.0; W.me.yaw=0.15; W.me.pitch=-0.12"),
    ]
    MODE = sys.argv[4] if len(sys.argv) > 4 else 'all'
    if MODE == 'act': views = []
    if MODE == 'mobile': views = [v for v in views if v[0] in ('kitchen', 'store', 'pcase_aim', 'sink', 'guide', 'memo')]
    if MODE == 'fix': views = [v for v in views if v[0] in ('kitchen', 'floor_crates', 'crack', 'pc_ing', 'pc_staff', 'storage3', 'storage3b')]
    for name, code in views:
      await js("(()=>{" + code + "})()")
      await pg.wait_for_timeout(1300)
      await pg.screenshot(path=f'{OUT}/fp_{name}.png')
      t = await js("(()=>{const t=CS.world.target;return t?t.name+' | '+(t.pri&&t.pri.label)+' | '+(t.sec&&t.sec.label):null})()")
      print(name, t)
    if MODE == 'fix': await b.close(); return
    if MODE == 'mobile':
      await js("(()=>{T.face('table', 1.4, -0.4); CS.world.setBuild(true)})()"); await pg.wait_for_timeout(900); await js("CS.world.primary()"); await pg.wait_for_timeout(900)
      await pg.screenshot(path=f'{OUT}/fpm_build.png'); await js("CS.world.setBuild(false)")
      await js("""(()=>{const S=T.S(), [rid]=T.fr('reg'); S.phase='open'; S.k.items.bx={t:'box',s:[['short',0.9,[],150]],at:'c:u99'}; S.cust.u99={ty:(CS.data.CUSTOMERS[0]||{}).id,v:0,st:'pay',t0:0,tq:0,reg:rid,seat:-1,ord:{short:1},price:{short:480},pm:'cash',due:480,tend:1000,tPay:CS.ui.room.now(),pt:CS.ui.room.now()+60000,tOrd:CS.ui.room.now()-10000,pw:CS.ui.room.now()+60000,no:1}; T.emit(); CS.game.openChange('u99');})()"""); await pg.wait_for_timeout(900)
      await pg.screenshot(path=f'{OUT}/fpm_change.png'); await js("document.querySelector('#cg-x').click()")
      await js("(()=>{const [id]=T.fr('sink'); CS.game.openWash(id)})()"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f'{OUT}/fpm_wash.png')
      print('\n'.join(logs[:20])); await b.close(); return
    # 配置モード
    await js("(()=>{T.face('table', 1.4, -0.4); CS.world.setBuild(true)})()"); await pg.wait_for_timeout(900)
    print('build target', await js("(()=>{const t=CS.world.target;return t?t.name+' | '+(t.pri&&t.pri.label):null})()"))
    await js("CS.world.primary()"); await pg.wait_for_timeout(300)
    await js("(()=>{CS.world.me.pitch=-0.55; CS.world.me.yaw+=0.4})()"); await pg.wait_for_timeout(900)
    await pg.screenshot(path=f'{OUT}/fp_build.png')
    print('ghost', await js("JSON.stringify(CS.world.mv)"), await js("(()=>{const t=CS.world.target;return t?t.name:null})()"))
    await js("CS.world.discard()"); await js("CS.world.setBuild(false)")
    # パソコン：家具・道具
    await js("CS.game.openPC('furn')"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f'{OUT}/fp_pcfurn.png')
    await js("CS.ui.closeSheet()"); await pg.wait_for_timeout(300)
    # 洗い物
    await js("(()=>{const [id]=T.fr('sink'); CS.game.openWash(id)})()"); await pg.wait_for_timeout(900)
    print('wash open', await js("JSON.stringify([document.getElementById('mg').hidden, !!document.querySelector('#ws-cv'), T.S().k.st[T.fr('sink')[0]], T.S().phase, CS.kitchen.at(T.S(), T.slot('sink',0,0))])"))
    box = await pg.locator('#ws-cv').bounding_box()
    if box:
      cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
      await pg.mouse.move(cx, cy); await pg.mouse.down()
      import math
      for k in range(90):
        a = k * 0.9; r = (k % 15) / 15 * box['width'] * 0.38
        await pg.mouse.move(cx + math.cos(a) * r, cy + math.sin(a) * r)
      await pg.mouse.up()
    await pg.wait_for_timeout(300); await pg.screenshot(path=f'{OUT}/fp_wash.png')
    print('wash btn disabled', await js("document.querySelector('#ws-rinse') && document.querySelector('#ws-rinse').disabled"))
    await js("document.querySelector('#ws-rinse') && document.querySelector('#ws-rinse').click()"); await pg.wait_for_timeout(2000)
    print('after wash', await js("JSON.stringify(Object.values(T.S().k.items).filter(i=>i.t==='plate').map(i=>[i.at,i.dirty||0,i.wet||0]))"))
    # お会計（現金）
    await js("""(()=>{const S=T.S(), [rid]=T.fr('reg'); S.phase='open'; S.k.items.bx={t:'box',s:[['short',0.9,[],150]],at:'c:u99'}; S.cust.u99={ty:(CS.data.CUSTOMERS[0]||{}).id,v:0,st:'pay',t0:0,tq:0,reg:rid,seat:-1,ord:{short:1},price:{short:480},pm:'cash',due:480,tend:1000,tPay:CS.ui.room.now(),pt:CS.ui.room.now()+60000,tOrd:CS.ui.room.now()-10000,pw:CS.ui.room.now()+60000,no:1}; T.emit();})()""")
    await pg.wait_for_timeout(2500)
    await js("(()=>{const W=CS.world, [id,f]=T.fr('reg'); W.me.x=f.x-0.2; W.me.z=W.dims.CZ-0.75; T.aim([f.x-0.1,1.05,f.z])})()"); await pg.wait_for_timeout(700)
    print('reg target', await js("(()=>{const t=CS.world.target;return t?t.name+' | '+(t.pri&&t.pri.label):null})()"))
    await pg.screenshot(path=f'{OUT}/fp_payreg.png')
    await js("CS.game.openChange('u99')"); await pg.wait_for_timeout(500)
    for v in [500]: await js(f"document.querySelector('[data-m=\"{v}\"]').click()")
    await pg.wait_for_timeout(300); await pg.screenshot(path=f'{OUT}/fp_change.png')
    print('ok disabled (500>=520?)', await js("document.querySelector('#cg-ok').disabled"))
    await js("document.querySelector('#cg-undo').click()")
    for v in [100, 100, 100, 100, 100, 10, 10]: await js(f"document.querySelector('[data-m=\"{v}\"]').click()")
    print('ok disabled (520)', await js("document.querySelector('#cg-ok').disabled"))
    await js("document.querySelector('#cg-ok').click()"); await pg.wait_for_timeout(700)
    print('cust after pay', await js("JSON.stringify(T.S().cust.u99 && [T.S().cust.u99.st, T.S().cust.u99.paid])"), 'funds', await js("T.S().funds"))
    await js("CS.game.openRecipeBook()"); await pg.wait_for_timeout(800); await pg.screenshot(path=f'{OUT}/fp_book.png')
    await js("CS.ui.closeSheet()"); await pg.wait_for_timeout(300)
    await js("CS.game.openMenu('sell')"); await pg.wait_for_timeout(900); await pg.screenshot(path=f'{OUT}/fp_menu.png')
    await js("CS.ui.closeSheet()")
    print('\n'.join(logs[:20]))
    await b.close()
asyncio.run(main())
