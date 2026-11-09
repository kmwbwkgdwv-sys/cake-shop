# 起動時の「データを守ろう」（引き継ぎコードの発行と保存・データ同期）と、ランキング
#  node fakedb-server.js 8790 ＆ python3 -m http.server 8765（プロジェクトのフォルダで）を起動してから
#  python3 rank.py 出力フォルダ
import asyncio, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]; URL = 'http://localhost:8765/test/index-mp.html'
fails = []
def ok(c, m):
  print(('ok   ' if c else 'FAIL ') + m)
  if not c: fails.append(m)
async def ev(pg, js): return await pg.evaluate(js)
async def newdev(b, name, w=390, h=844, touch=True):
  ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch, device_scale_factor=2)
  pg = await ctx.new_page(); pg.logs = []
  pg.on('pageerror', lambda e: pg.logs.append('PAGEERROR ' + str(e)))
  pg.on('console', lambda m: pg.logs.append('CONSOLE ' + m.type + ': ' + m.text) if m.type == 'error' else None)
  await pg.goto(URL); await pg.wait_for_timeout(1500)
  if await pg.locator('#md-in').count(): await pg.fill('#md-in', name); await pg.click('#modal .btn.pink')
  await pg.wait_for_timeout(400)
  return ctx, pg
async def dismiss(pg):
  for _ in range(4):
    await ev(pg, "(()=>{const b=document.querySelector('#modal:not([hidden]) .row.end .btn.pink'); if(b) b.click()})()"); await pg.wait_for_timeout(250)
async def gate_state(pg):
  return await ev(pg, "(()=>{const b=document.querySelector('#modal:not([hidden]) .row.end .btn'); return b ? [b.disabled, b.textContent] : null})()")
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctxA, A = await newdev(b, 'あかり')
    # ---- 起動時の確認 ----
    ok(await A.locator('#gs1-box').count() == 1, 'the data gate shows on launch')
    st = await gate_state(A); ok(st and st[0], 'start is locked until both steps are done: ' + str(st))
    await A.screenshot(path=OUT + '/gate_0.png')
    await A.click('#gs1-box [data-c=issue]'); await A.wait_for_timeout(900)
    code = (await ev(A, "document.querySelector('#gs1-box .code').textContent")).replace('-', '')
    ok(len(code) == 12, 'a transfer code is issued: ' + code)
    st = await gate_state(A); ok(st and st[0], 'still locked: the code must be saved (copy / image)')
    await A.click('#gs1-box [data-c=img]'); await A.wait_for_timeout(900)
    ok(await ev(A, "!!document.querySelector('#gs1-box .cb-img img') && document.querySelector('#gs1').classList.contains('done')"), 'save as image: the picture is shown and step 1 is done')
    st = await gate_state(A); ok(st and st[0] and '②' in st[1], 'now waiting for the sync: ' + str(st))
    await A.click('#gs2-btn'); await A.wait_for_timeout(1500)
    ok(await ev(A, "document.querySelector('#gs2').classList.contains('done') && /同期しました/.test(document.querySelector('#gs2-t').textContent)"), 'data sync done')
    st = await gate_state(A); ok(st and not st[0], 'start is unlocked')
    await A.screenshot(path=OUT + '/gate_1.png')
    await A.click('#modal .row.end .btn'); await A.wait_for_timeout(400)
    ok(await ev(A, "document.querySelector('#modal').hidden && CS.ui.scr === 'title'"), 'title screen after the gate')
    saved = await ev(A, "JSON.stringify(CS.save.data.tcode)")
    ok(code in saved, 'the code is kept in the save data (shared with linked devices)')
    # ---- 再起動：一度発行したら、もう出ない。コードは「引き継ぎ」で同じものが見られる ----
    await A.reload(); await A.wait_for_timeout(2000)
    ok(await A.locator('#gs1-box').count() == 0 and await ev(A, "document.querySelector('#modal').hidden && CS.ui.scr === 'title'"), 'the gate does not show again once the code is issued')
    await A.click('#btn-transfer'); await A.wait_for_timeout(500)
    btn = await ev(A, "document.querySelector('#tf-cb [data-c=issue]').textContent")
    ok('表示' in btn, 'transfer screen offers to show the code: ' + btn.strip())
    await A.click('#tf-cb [data-c=issue]'); await A.wait_for_timeout(900)
    code2 = (await ev(A, "document.querySelector('#tf-cb .code').textContent")).replace('-', '')
    ok(code2 == code and '発行済み' in await ev(A, "document.querySelector('#tf-cb .invite').textContent"), 'same code as before (already issued)')
    await ev(A, "CS.ui.closeSheet()"); await A.wait_for_timeout(300)
    # ---- 遊ぶ：お店をつくって、プレイ時間と売上を記録 ----
    await A.click('#btn-new'); await A.click('#modal .btn.pink'); await A.wait_for_timeout(2500)
    ok(await ev(A, "CS.ui.scr") == 'game', 'A is in the shop'); await dismiss(A)
    await ev(A, "(()=>{const S=CS.ui.room.S; S.life=(S.life||0)+123456; S.xp=CS.data.SHOP_XP[4]; CS.rank.acc+=3725; CS.rank.commit();})()")
    await A.wait_for_timeout(1200)
    me = json.loads(await ev(A, "JSON.stringify(CS.rank.mine())"))
    ok(me['play'] >= 3725 and me['sales'] >= 123456 and me['lv'] >= 5, 'A record: ' + json.dumps(me, ensure_ascii=False))
    rk = json.loads(await ev(A, "new Promise(r=>CS.net.ref('ranking/'+CS.save.sid).once('value').then(s=>r(JSON.stringify(s.val()))))"))
    ok(rk and rk['sales'] == me['sales'] and rk['lv'] == me['lv'] and rk['play'] == me['play'] and rk['name'] == 'あかり', 'A is written to the ranking')
    # ---- B：別の人 ----
    ctxB, B = await newdev(b, 'ゆうき')
    await B.click('#gs1-box [data-c=issue]'); await B.wait_for_timeout(900); await B.click('#gs1-box [data-c=copy]'); await B.wait_for_timeout(200)
    await B.click('#gs2-btn'); await B.wait_for_timeout(1500); await B.click('#modal .row.end .btn'); await B.wait_for_timeout(400)
    await B.click('#btn-new'); await B.click('#modal .btn.pink'); await B.wait_for_timeout(2500); await dismiss(B)
    await ev(B, "(()=>{const S=CS.ui.room.S; S.life=(S.life||0)+987654; S.xp=CS.data.SHOP_XP[2]; CS.rank.acc+=600; CS.rank.commit();})()")
    await B.wait_for_timeout(800)
    # C, D もランキングにのせておく（画面の見た目用）
    await ev(B, """(()=>{ const n=CS.net; const put=(id,o)=>n.ref('ranking/'+id).set(Object.assign({t:Date.now(), skin: CS.data.DEFAULT_SKIN}, o));
      put('zz1',{name:'みなと',shop:'みなとパティスリー',lv:8,lvs:8e12+2345678,sales:2345678,play:41000});
      put('zz2',{name:'さくら',shop:'さくら洋菓子店',lv:3,lvs:3e12+45600,sales:45600,play:900}); })()""")
    await B.wait_for_timeout(500)
    # ---- ランキング画面（A） ----
    await ev(A, "CS.game.leave(false)"); await A.wait_for_timeout(1200)
    stats = await ev(A, "document.querySelector('#me-stats') && document.querySelector('#me-stats').textContent")
    ok(stats and 'Lv' in stats and '時間' in stats, 'title shows my level / sales / play time: ' + str(stats))
    await A.screenshot(path=OUT + '/title.png')
    await A.click('#btn-rank'); await A.wait_for_timeout(2500)
    rows = await ev(A, "[...document.querySelectorAll('.rk-row')].map(r=>r.querySelector('.mid b').textContent+'|'+r.querySelector('.rk-v b').textContent)")
    ok(len(rows) == 4 and rows[0].startswith('みなと') and rows[1].startswith('ゆうき') and rows[2].startswith('あかり'), 'sales ranking order: ' + str(rows))
    pos = await ev(A, "document.querySelector('#rk-pos').textContent")
    ok('3' in pos, 'my position: ' + pos)
    await A.wait_for_timeout(1200)
    await A.screenshot(path=OUT + '/rank_sales.png')
    await A.click('.sh-tabs button[data-tab=lvs]'); await A.wait_for_timeout(1500)
    rows = await ev(A, "[...document.querySelectorAll('.rk-row')].map(r=>r.querySelector('.mid b').textContent+'|'+r.querySelector('.rk-v b').textContent)")
    ok(rows[0].startswith('みなと') and rows[1].startswith('あかり') and 'Lv' in rows[1], 'level ranking order: ' + str(rows))
    await A.wait_for_timeout(800); await A.screenshot(path=OUT + '/rank_lv.png')
    await A.click('.sh-tabs button[data-tab=play]'); await A.wait_for_timeout(1500)
    rows = await ev(A, "[...document.querySelectorAll('.rk-row')].map(r=>r.querySelector('.mid b').textContent+'|'+r.querySelector('.rk-v b').textContent)")
    ok(rows[0].startswith('みなと') and rows[1].startswith('あかり') and '時間' in rows[1], 'play time ranking order: ' + str(rows))
    await A.wait_for_timeout(800); await A.screenshot(path=OUT + '/rank_play.png')
    # ---- 引き継ぎ：A のコードを新しい端末で使う ----
    ctxC, C = await newdev(b, 'しんたんまつ')
    await C.click('#gs1-box [data-c=issue]'); await C.wait_for_timeout(900); await C.click('#gs1-box [data-c=copy]'); await C.wait_for_timeout(200)
    await C.click('#gs2-btn'); await C.wait_for_timeout(1500); await C.click('#modal .row.end .btn'); await C.wait_for_timeout(400)
    await C.click('#btn-transfer'); await C.wait_for_timeout(500)
    await C.fill('#tf-in', code); await C.click('#tf-redeem'); await C.wait_for_timeout(300); await C.click('#modal .btn.mint'); await C.wait_for_timeout(2500)
    cme = json.loads(await ev(C, "JSON.stringify([CS.save.data.name, CS.rank.mine(), CS.save.currentCode() && CS.save.currentCode().code])"))
    ok(cme[0] == 'あかり' and cme[1]['play'] >= 3725 and cme[2] == code, 'the new device has A data, record and code: ' + json.dumps(cme, ensure_ascii=False))
    await C.reload(); await C.wait_for_timeout(2000)
    ok(await C.locator('#gs1-box').count() == 0, 'after taking over with the code, the gate does not show on that device either')
    for pg in (A, B, C):
      errs = [l for l in pg.logs if 'PAGEERROR' in l or ('CONSOLE' in l and 'TUNNEL' not in l and 'favicon' not in l)]
      ok(not errs, 'no errors: ' + str(errs[:3]))
    await b.close()
  print('FAILS', len(fails), 'RANK ALL OK' if not fails else '')
asyncio.run(main())
