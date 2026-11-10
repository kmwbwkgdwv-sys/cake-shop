// 借金：1万・3万・5万／5日（÷5 に50%上乗せ）・10日（÷10 に120%上乗せ）／閉店時に自動で返済／マイナスなら何も買えない／返し終わるまで次は借りられない
global.window = global;
['data', 'sim', 'plan', 'kitchen'].forEach((f) => require('../js/' + f + '.js'));
const sim = CS.sim, D = CS.data, R = D.RULES;
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
let now = 1000;
const S = sim.newState({}); sim.normalize(S);
const A = (a) => sim.apply(S, Object.assign({ pid: 'p1' }, a), now);
const tick = (ms) => { for (let t = 0; t < ms; t += 500) { now += 500; sim.tick(S, now); } };
const day = () => { A({ t: 'sign' }); tick(2000); A({ t: 'sign' }); const r = A({ t: 'endDay' }); A({ t: 'next' }); return r; };
A({ t: 'start' });

// ---- 1日に返す額 ----
const plans = [[10000, 5, 3000], [30000, 5, 9000], [50000, 5, 15000], [10000, 10, 2200], [30000, 10, 6600], [50000, 10, 11000]];
ok(plans.every(([a, d, per]) => sim.loanPlan(a, d).per === per && sim.loanPlan(a, d).total === per * d), 'daily payments: ' + plans.map(([a, d]) => a / 10000 + '万/' + d + '日=' + sim.loanPlan(a, d).per).join(' '));
ok(!A({ t: 'borrow', amt: 20000, days: 5 }).ok && !A({ t: 'borrow', amt: 60000, days: 10 }).ok && !A({ t: 'borrow', amt: 10000, days: 7 }).ok, 'only 1万/3万/5万 and 5 or 10 days');

// ---- 1万を5日で ----
let f0 = S.funds;
ok(A({ t: 'borrow', amt: 10000, days: 5 }).ok && S.funds === f0 + 10000 && S.loan.per === 3000 && S.loan.left === 5, 'borrow ¥10,000 for 5 days: +¥10,000, ¥3,000 a day');
const again = A({ t: 'borrow', amt: 10000, days: 10 });
ok(!again.ok && /返し終わる/.test(again.msg), 'cannot borrow again before paying back: ' + again.msg);
const pays = [];
for (let i = 0; i < 5; i++) { S.funds = 100000; day(); const h = S.history[S.history.length - 1]; pays.push(h.loan); }
ok(pays.join(',') === '3000,3000,3000,3000,3000', 'paid at each closing: ' + pays.join(','));
ok(S.loan === null || S.loan === undefined, 'loan finished after 5 closings');
ok(S.history[S.history.length - 1].lend === 1, 'the last day report says it is paid back');
ok(A({ t: 'borrow', amt: 50000, days: 10 }).ok && S.loan.per === 11000, 'can borrow again after paying back (5万/10日 = ¥11,000 a day)');

// ---- お金が足りない：マイナスになって、何も買えない ----
S.funds = 4000; // 家賃などと返済で足りない
const before = S.funds; day();
const h = S.history[S.history.length - 1];
ok(S.funds < 0 && h.loan === 11000 && S.funds === before - h.fixed - 11000, 'not enough money → funds go negative: ' + S.funds);
const tries = [A({ t: 'order', items: ['flour'] }), A({ t: 'tbuy', k: 'plate' }), A({ t: 'fbuy', k: 'shelf' }), A({ t: 'upgrade', id: 'storage' }), A({ t: 'ad', kind: 'flyer' })];
ok(tries.every((r) => !r.ok && /マイナス/.test(r.msg)), 'nothing can be bought while negative: ' + tries[0].msg);
ok(A({ t: 'ad', kind: 'none' }).ok, 'turning ads off still works');
S.funds = 5000;
ok(A({ t: 'tbuy', k: 'plate' }).ok, 'buying works again once the funds are positive');
// ---- 倒産のきまりはそのまま ----
S.funds = -12000; S.loan.left = 3; day();
ok(S.bankrupt === 1 || S.funds <= R.BANKRUPT, 'falling below ' + R.BANKRUPT + ' still means bankruptcy (funds ' + S.funds + ')');
// ---- Firebase で空の値が消えても大丈夫 ----
const S2 = sim.newState({}); S2.loan = { amt: 10000, per: 0 }; sim.normalize(S2); ok(!S2.loan, 'broken loan data is cleared');
console.log(fail ? fail + ' FAILED' : 'ALL OK');
