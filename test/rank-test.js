// ランキング用の記録：プレイ時間・総売上（つくった人／あとから参加した人）・お店のレベル
global.window = global;
['data', 'sim', 'plan', 'kitchen'].forEach((f) => require('../js/' + f + '.js'));
const sim = CS.sim, D = CS.data;
CS.ui = { $: () => null, $$: () => [], esc: (s) => String(s), yen: (n) => '¥' + Math.round(n).toLocaleString('ja-JP') };
CS.art = { icon: () => '' };
CS.net = { online: false };
CS.save = { data: { name: 'テスト', skin: {}, shops: {}, stats: {} }, update(fn) { fn(this.data); } };
require('../js/rank.js');
const R = CS.rank;
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

// 自分でつくったお店：最初からの売上が入る
const d = { name: 'A', skin: {}, shops: {}, stats: { cakes: 3 } };
const S1 = sim.newState({ name: 'Aのお店' }); S1.life = 12000; S1.xp = 0;
const own = { code: 'ABC123', S: S1, meta: { name: 'Aのお店' }, pid: 'p1', members: { p1: { joined: 100 }, p2: { joined: 200 } } };
ok(R.isCreator(own), 'the first member is the creator');
R.apply(d, own, 60);
ok(d.stats.play === 60 && d.stats.sales === 12000 && d.stats.lv === 1 && d.shops.ABC123.sales === 12000, 'own shop: sales from the start, play time added (' + JSON.stringify(d.stats) + ')');
S1.life = 15500; S1.xp = D.SHOP_XP[3]; R.apply(d, own, 30);
ok(d.stats.sales === 15500 && d.stats.play === 90 && d.stats.lv === sim.shopLevel(S1).lv && d.stats.lv >= 4, 'more sales and a level up are added (lv ' + d.stats.lv + ')');
// あとから参加したお店：参加してからの分だけ
const S2 = sim.newState({ name: 'Bのお店' }); S2.life = 500000; S2.xp = D.SHOP_XP[8];
const joined = { code: 'XYZ789', S: S2, meta: { name: 'Bのお店' }, pid: 'p9', members: { p1: { joined: 100 }, p9: { joined: 900 } } };
ok(!R.isCreator(joined), 'a later member is not the creator');
R.apply(d, joined, 10);
ok(d.stats.sales === 15500, 'joining a shop does not add its old sales');
ok(d.stats.lv === sim.shopLevel(S2).lv, 'but the best shop level counts (lv ' + d.stats.lv + ')');
S2.life = 503000; R.apply(d, joined, 10);
ok(d.stats.sales === 18500, 'sales after joining are added');
// オフラインのお店は自分のお店
ok(R.isCreator({ code: 'LABCDE', local: true, members: {} }), 'offline shop counts as own');
// 一番レベルが高いお店の名前
const m = R.mine(d);
ok(m.shop === 'Bのお店' && m.lv === d.stats.lv && m.play === 110 && m.sales === 18500, 'my record: ' + JSON.stringify(m));
// 表示
ok(R.fmtPlay(0) === '0分' && R.fmtPlay(30) === '1分未満' && R.fmtPlay(125) === '2分' && R.fmtPlay(3 * 3600 + 5 * 60) === '3時間5分' && R.fmtPlay(7200) === '2時間', 'play time format');
ok(R.fmtYen(98000) === '¥98,000' && R.fmtYen(123400) === '¥12.3万' && R.fmtYen(4567000) === '¥457万' && R.fmtYen(250000000) === '¥2.5億', 'yen format: ' + [R.fmtYen(123400), R.fmtYen(4567000), R.fmtYen(250000000)].join(' '));
// ランキングに書く記録
CS.save.data = d;
const e = R.entry();
ok(e.lvs === e.lv * 1e12 + e.sales && e.name === 'A' && e.shop === 'Bのお店' && e.play === 110, 'ranking entry: lv ' + e.lv + ' sales ' + e.sales + ' play ' + e.play);
// 古いお店：これまでの売上は残っている記録から
const S3 = sim.newState({}); delete S3.life; S3.history = [{ sales: 1000 }, { sales: 2500 }]; S3.today.sales = 300; S3.today.drinks = 350;
sim.normalize(S3);
ok(S3.life === 4150, 'old shops get lifetime sales from their history: ' + S3.life);
const S4 = sim.newState({}); delete S4.life; S4.phase = 'report'; S4.history = [{ sales: 1000 }, { sales: 2500 }]; S4.today.sales = 2500;
sim.normalize(S4);
ok(S4.life === 3500, 'after closing (report), today is already in the history: ' + S4.life);
console.log(fail ? fail + ' FAILED' : 'ALL OK');
