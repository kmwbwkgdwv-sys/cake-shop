/* ケーキ屋さんシミュレーター : ゲームデータ定義 */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});

  // ---- 材料 (life = 日持ち日数 / 0 は日持ちする・cold = 要冷蔵・warm = 常温に置いて傷むまでの秒数) ----
  const ING = {
    flour:      { name: '小麦粉',       icon: '🌾', price: 60,  life: 0 },
    egg:        { name: '卵',           icon: '🥚', price: 35,  life: 6, cold: 1, warm: 240 },
    sugar:      { name: '砂糖',         icon: '🍬', price: 25,  life: 0 },
    butter:     { name: 'バター',       icon: '🧈', price: 90,  life: 12, cold: 1, warm: 300 },
    milk:       { name: '牛乳',         icon: '🥛', price: 45,  life: 4, cold: 1, warm: 180 },
    cream:      { name: '生クリーム',   icon: '🍦', price: 120,  life: 3, cold: 1, warm: 150 },
    strawberry: { name: 'いちご',       icon: '🍓', price: 130,  life: 2, cold: 1, warm: 120 },
    blueberry:  { name: 'ブルーベリー', icon: '🫐', price: 140,  life: 3, cold: 1, warm: 150 },
    peach:      { name: 'もも',         icon: '🍑', price: 160, life: 2, cold: 1, warm: 120 },
    lemon:      { name: 'レモン',       icon: '🍋', price: 70,  life: 8, cold: 1, warm: 300 },
    choco:      { name: 'チョコ',       icon: '🍫', price: 100,  life: 0 },
    cocoa:      { name: 'ココア',       icon: '🟤', price: 80,  life: 0 },
    matcha:     { name: '抹茶',         icon: '🍵', price: 160, life: 0 },
    cheese:     { name: 'クリームチーズ', icon: '🧀', price: 150, life: 8, cold: 1, warm: 240 },
    chestnut:   { name: '栗',           icon: '🌰', price: 180, life: 15 },
    box:        { name: 'ケーキの箱',   icon: '📦', price: 60,  life: 0, supply: 1 },
  };

  // ---- 生地 (ミキサー台 → オーブン) / order = 正しい投入順 ----
  const BASES = {
    plain:   { name: 'プレーンスポンジ', short: 'プレーン', color: '#EFC77C', crumb: '#C98D45', ing: { egg: 3, sugar: 2, flour: 2, butter: 1 }, order: ['egg', 'sugar', 'flour', 'butter'], weigh: { sugar: 90, flour: 90 }, bake: 40, temp: 170, layered: true, tags: ['plain'] },
    cocoa:   { name: 'ココアスポンジ',   short: 'ココア',   color: '#7A4B30', crumb: '#4E2C1B', ing: { egg: 3, sugar: 2, flour: 2, cocoa: 1 },  order: ['egg', 'sugar', 'cocoa', 'flour'], weigh: { sugar: 90, cocoa: 15 }, bake: 42, temp: 170, layered: true, tags: ['choco'] },
    cheese:  { name: 'チーズ生地',       short: 'チーズ',   color: '#F3DEA4', crumb: '#B9772F', ing: { cheese: 3, sugar: 2, egg: 2, cream: 1 }, order: ['cheese', 'sugar', 'egg', 'cream'], weigh: { cheese: 250, sugar: 80 }, bake: 50, temp: 160, tags: ['cheese'] },
    matcha:  { name: '抹茶スポンジ',     short: '抹茶',     color: '#A3BE73', crumb: '#6E8A46', ing: { egg: 3, sugar: 2, matcha: 1, flour: 2 }, order: ['egg', 'sugar', 'matcha', 'flour'], weigh: { matcha: 10, flour: 85 }, bake: 42, temp: 170, layered: true, tags: ['matcha'] },
    tart:    { name: 'タルト生地',       short: 'タルト',   color: '#DDA463', crumb: '#A86A2E', ing: { butter: 2, sugar: 1, egg: 1, flour: 2 }, order: ['butter', 'sugar', 'egg', 'flour'], weigh: { butter: 100, flour: 160 }, bake: 34, temp: 180, tart: true, tags: ['butter'] },
    cookie:  { name: 'クッキー生地',     short: 'クッキー', color: '#E8C48A', crumb: '#C08A4A', ing: { butter: 2, sugar: 1, egg: 1, flour: 2 }, order: ['butter', 'sugar', 'egg', 'flour'], weigh: { butter: 120, flour: 180 }, bake: 26, temp: 170, cookie: true, tags: ['butter'] },
    madeleine: { name: 'マドレーヌ生地', short: 'マドレーヌ', color: '#E9B865', crumb: '#B87A36', ing: { egg: 2, sugar: 1, butter: 2, flour: 1 }, order: ['egg', 'sugar', 'flour', 'butter'], weigh: { sugar: 80, butter: 90 }, bake: 30, temp: 180, cookie: true, shell: true, tags: ['butter', 'egg'] },
    chiffon: { name: 'シフォン生地',     short: 'シフォン', color: '#F7DE98', crumb: '#C99545', ing: { egg: 4, sugar: 2, milk: 1, flour: 1 },  order: ['egg', 'milk', 'flour', 'sugar'], weigh: { milk: 60, flour: 70 }, bake: 46, temp: 170, ring: true, tags: ['light'] },
  };

  // ---- クリーム (クリーム台) 1回で2台分 ----
  const CREAMS = {
    none:    { name: 'クリームなし', short: 'なし', color: null, ing: {}, tags: [] },
    whip:    { name: 'ホイップクリーム', short: 'ホイップ', color: '#FFFDF7', ing: { cream: 2, sugar: 1 }, tags: ['milky'] },
    choco:   { name: 'チョコクリーム',   short: 'チョコ',   color: '#7A4A33', ing: { cream: 2, choco: 1, sugar: 1 }, tags: ['choco'] },
    matcha:  { name: '抹茶クリーム',     short: '抹茶',     color: '#B3D08F', ing: { cream: 2, matcha: 1, sugar: 1 }, tags: ['matcha'] },
    maron:   { name: 'マロンクリーム',   short: 'マロン',   color: '#C79A6A', ing: { chestnut: 2, cream: 1, sugar: 1 }, tags: ['nutty'] },
    custard: { name: 'カスタード',       short: 'カスタード', color: '#FFDC6E', ing: { milk: 2, egg: 2, sugar: 1 }, tags: ['milky', 'egg'] },
    lemon:   { name: 'レモンクリーム',   short: 'レモン',   color: '#FFF0A0', ing: { cream: 2, lemon: 1, sugar: 1 }, tags: ['citrus'] },
  };
  const CREAM_YIELD = 2;

  // ---- トッピング (材料をそのまま使う) ----
  const TOPS = {
    strawberry: { tag: 'berry' },
    blueberry:  { tag: 'berry' },
    peach:      { tag: 'fruit' },
    lemon:      { tag: 'citrus' },
    choco:      { tag: 'choco' },
    chestnut:   { tag: 'nutty' },
  };

  // ---- レシピ (known = 最初から作れる / hint = 未発見時のヒント) ----
  // lv = 解放される店舗レベル（Lv10 ですべて作れる） / pieces = 1台（1回）で何個売れるか
  const RECIPES = {
    short:        { name: 'いちごのショートケーキ', base: 'plain',   cream: 'whip',    tops: { strawberry: 3 }, value: 520, known: true, lv: 1 },
    chocolate:    { name: 'チョコレートケーキ',     base: 'cocoa',   cream: 'choco',   tops: { choco: 1 },      value: 500, known: true, lv: 1 },
    baked_cheese: { name: 'ベイクドチーズケーキ',   base: 'cheese',  cream: 'none',    tops: { lemon: 1 },      value: 480, known: true, lv: 1 },
    butter_cookie:{ name: 'バタークッキー',         base: 'cookie',  cream: 'none',    tops: {},                value: 260, lv: 2, pieces: 8, unit: '袋', kind: 'bake' },
    chiffon:      { name: 'ふわふわシフォン',       base: 'chiffon', cream: 'whip',    tops: {},                value: 420, lv: 2 },
    choco_cookie: { name: 'チョコチップクッキー',   base: 'cookie',  cream: 'none',    tops: { choco: 1 },      value: 300, lv: 3, pieces: 8, unit: '袋', kind: 'bake' },
    peach_short:  { name: 'ピーチショート',         base: 'plain',   cream: 'whip',    tops: { peach: 2 },      value: 560, lv: 3 },
    berry_cheese: { name: 'ベリーチーズケーキ',     base: 'cheese',  cream: 'whip',    tops: { blueberry: 2 },  value: 580, lv: 3 },
    madeleine:    { name: 'レモンマドレーヌ',       base: 'madeleine', cream: 'none',  tops: { lemon: 1 },      value: 240, lv: 4, pieces: 8, unit: '個', kind: 'bake' },
    matcha_short: { name: '抹茶のショートケーキ',   base: 'matcha',  cream: 'whip',    tops: { strawberry: 2 }, value: 560, lv: 4 },
    choco_berry:  { name: 'ショコラフレーズ',       base: 'cocoa',   cream: 'whip',    tops: { strawberry: 2, choco: 1 }, value: 600, lv: 4 },
    lemon_tart:   { name: 'レモンタルト',           base: 'tart',    cream: 'lemon',   tops: { lemon: 1, blueberry: 1 }, value: 560, lv: 5 },
    lemon_chiffon:{ name: 'レモンシフォン',         base: 'chiffon', cream: 'lemon',   tops: { lemon: 1 },      value: 480, lv: 5 },
    fruit_tart:   { name: 'フルーツタルト',         base: 'tart',    cream: 'custard', tops: { strawberry: 1, blueberry: 1, peach: 1 }, value: 680, lv: 6 },
    choco_madel:  { name: 'ショコラマドレーヌ',     base: 'madeleine', cream: 'none',  tops: { choco: 1 },      value: 280, lv: 6, pieces: 8, unit: '個', kind: 'bake' },
    montblanc:    { name: 'モンブラン',             base: 'tart',    cream: 'maron',   tops: { chestnut: 1 },   value: 620, lv: 7 },
    maron_choco:  { name: '栗とショコラのケーキ',   base: 'cocoa',   cream: 'maron',   tops: { chestnut: 1, choco: 1 }, value: 640, lv: 7 },
    matcha_deluxe:{ name: '濃い抹茶ケーキ',         base: 'matcha',  cream: 'matcha',  tops: { chestnut: 1 },   value: 600, lv: 8 },
    uji:          { name: '宇治抹茶モンブラン',     base: 'matcha',  cream: 'maron',   tops: { chestnut: 1 },   value: 650, lv: 9 },
    royal:        { name: 'ロイヤルフルーツショート', base: 'plain', cream: 'whip',    tops: { strawberry: 2, peach: 1, blueberry: 1 }, value: 820, lv: 10 },
  };

  // ---- 味の相性 (+ 合う / - 合わない) ----
  const PAIR = {};
  function pair(a, b, v) { PAIR[a + '|' + b] = v; PAIR[b + '|' + a] = v; }
  [
    ['plain', 'milky', 1], ['plain', 'berry', 1], ['plain', 'fruit', 1],
    ['choco', 'berry', 1], ['choco', 'nutty', 1], ['choco', 'milky', 0.5],
    ['cheese', 'berry', 1], ['cheese', 'citrus', 1], ['cheese', 'milky', 0.5],
    ['matcha', 'nutty', 1.2], ['matcha', 'milky', 0.8], ['matcha', 'berry', 0.6],
    ['butter', 'fruit', 1], ['butter', 'egg', 1], ['butter', 'nutty', 1], ['butter', 'citrus', 0.8],
    ['light', 'milky', 1], ['light', 'citrus', 1],
    ['milky', 'berry', 0.8], ['milky', 'fruit', 0.8], ['egg', 'fruit', 1], ['egg', 'berry', 0.6],
    ['citrus', 'berry', 1],
    ['choco', 'citrus', -1.2], ['matcha', 'citrus', -1.2], ['nutty', 'citrus', -1], ['choco', 'fruit', -0.6],
    ['matcha', 'fruit', -0.5], ['matcha', 'choco', -0.4], ['cheese', 'nutty', -0.5], ['cheese', 'choco', -0.3],
  ].forEach((p) => pair(p[0], p[1], p[2]));

  // ---- 店舗拡張 ----
  // req = その段階を導入できる「店舗レベル」
  const UPGRADES = [
    { id: 'floor', name: '店舗の増床', desc: 'お店と厨房がひと回り広くなり、家具を置ける場所が増える。来店数 +8%・席も増える（家賃 +¥1,500/日）', icon: 'home', levels: [90000, 200000, 380000], req: [3, 5, 7] },
    { id: 'showcase', hide: 1, name: '商品棚（冷蔵ショーケース）', desc: 'ケーキを並べる冷蔵の商品棚が1台増える。並べたケーキは賞味期限まで傷まない', icon: 'case', levels: [18000, 42000, 80000, 140000], req: [1, 2, 4, 6], vals: [4, 5, 6, 7, 8] },
    { id: 'oven', hide: 1, name: 'オーブン追加', desc: '同時に焼ける数が増える', icon: 'oven', levels: [30000, 70000, 130000], req: [1, 3, 5], vals: [3, 4, 5, 6] },
    { id: 'coldcase', name: '冷蔵ショーケース', desc: '（商品棚はすべて冷蔵になりました）', icon: 'case', levels: [45000], req: [3], hide: 1 },
    { id: 'storage', name: '倉庫の拡張', desc: '店の横の倉庫（別棟）を建て増しして、ひと回りずつ大きくする。棚・冷蔵棚・冷蔵庫を置ける場所が増える（中の家具はそのまま）', icon: 'box', levels: [25000, 60000, 120000], req: [2, 4, 6] },
    { id: 'sign', name: '看板', desc: '来店数 +10%', icon: 'sign', levels: [12000], req: [1] },
    { id: 'interior', name: '内装リフォーム', desc: '来店数 +12% / お客さんの払える額 +3%（段階ごと）', icon: 'home', levels: [40000, 90000, 180000], req: [1, 3, 5] },
    { id: 'lab', name: 'レシピ研究室', desc: '試作コスト半額、相性の予想が見える', icon: 'lab', levels: [30000], req: [2] },
  ];
  // ---- 設備（パソコンで買い替え。店舗レベルで上位機種が解放） ----
  const EQUIP = {
    oven: { name: 'オーブン', icon: 'oven', tiers: [
      { name: '家庭用オーブン', desc: '最初の1台。小さくて焼きムラが出やすい', price: 0, lv: 1, speed: 1, win: 1, heat: 1 },
      { name: '業務用オーブン', desc: '焼き時間 -15%・ちょうどいい焼き加減の幅 +15%', price: 45000, lv: 3, speed: 0.85, win: 1.15, heat: 0.85 },
      { name: 'コンベクションオーブン', desc: '熱風循環。焼き時間 -30%・幅 +35%・予熱 -40%', price: 120000, lv: 6, speed: 0.7, win: 1.35, heat: 0.6 },
      { name: '石窯デッキオーブン', desc: '最上位。焼き時間 -45%・幅 +60%・焼き上がり品質 +5', price: 280000, lv: 9, speed: 0.55, win: 1.6, heat: 0.5, qb: 0.05 },
    ] },
    mixer: { name: 'ミキサー', icon: 'mixer', tiers: [
      { name: 'ハンドミキサー', desc: '手で持つ小型ミキサー', price: 0, lv: 1, win: 1, fast: 1 },
      { name: 'スタンドミキサー', desc: 'かき混ぜの適正スピードの幅 +40%', price: 30000, lv: 2, win: 1.4, fast: 0.9 },
      { name: '業務用ミキサー', desc: '幅 +80%・混ぜる時間 -25%', price: 90000, lv: 5, win: 1.8, fast: 0.75 },
      { name: 'プロ仕様縦型ミキサー', desc: '幅 +130%・混ぜる時間 -40%', price: 220000, lv: 8, win: 2.3, fast: 0.6 },
    ] },
    whisk: { name: '泡立て', icon: 'hand', tiers: [
      { name: '泡立て器', desc: '手で泡立てる', price: 0, lv: 1, win: 1, gain: 1 },
      { name: '電動ホイッパー', desc: '泡立ちが速く、ちょうどいい固さの幅 +40%', price: 28000, lv: 3, win: 1.4, gain: 1.3 },
      { name: '業務用ホイッパー', desc: '幅 +90%・泡立ち 1.6 倍', price: 110000, lv: 7, win: 1.9, gain: 1.6 },
    ] },
    cooler: { name: '冷却', icon: 'snow', tiers: [
      { name: 'ケーキクーラー', desc: '網の上で自然に冷ます', price: 0, lv: 1, cool: 1 },
      { name: '急速冷却ラック', desc: '冷ます時間 -50%', price: 25000, lv: 3, cool: 0.5 },
      { name: 'ブラストチラー', desc: '冷ます時間 -80%', price: 150000, lv: 7, cool: 0.2 },
    ] },
    fridge: { name: '冷蔵の性能', icon: 'fridge', tiers: [
      { name: 'ふつうの冷却', desc: '材料の日持ちは標準', price: 0, lv: 1, life: 1 },
      { name: '業務用の冷却', desc: '冷蔵棚・冷蔵庫の材料の日持ち ×1.5', price: 35000, lv: 2, life: 1.5 },
      { name: 'ウォークイン並みの冷却', desc: '材料の日持ち ×2', price: 140000, lv: 6, life: 2 },
    ] },
  };
  // ---- 家具（パソコンで購入。テーブルは増床すると多く置ける） ----
  const FURN = {
    table: { name: 'テーブルセット（2席）', desc: 'お客さんが座って食べていく。座ったお客さんは満足度アップ', icon: 'cup', price: 6000, lv: 2, max: [3, 5, 7, 9] },
    coffee: { name: 'コーヒーマシン', desc: '席に座ったお客さんがドリンクも注文（+¥350）', icon: 'cup', price: 28000, lv: 3, max: [1, 1, 1, 1] },
    plant: { name: '観葉植物', desc: 'お店の雰囲気が良くなる（来店数 +2%／鉢）', icon: 'leaf', price: 4000, lv: 1, max: [2, 3, 4, 5] },
    speaker: { name: 'BGMスピーカー', desc: '落ち着いた音楽で満足度 +3%', icon: 'music', price: 15000, lv: 4, max: [1, 1, 1, 1] },
  };
  // ---- アルバイト（1人1業務・日給制。働くほどレベルが上がって速くなる） ----
  const STAFF = {
    // 雇える人（店舗Lv1 ではまだ雇えない。最大8人）。sp = 手際（人によって作業の速さが違う）
    slots: [
      { lv: 2, start: 1, sp: 1.0, name: 'さくら', skin: { hair: 'pony', hairColor: '#3B2A20', skin: '#F2D3B8', clothes: 'shirt', clothesColor: '#F7F5F0', apron: 'bib', apronColor: '#7A1F2B', hat: 'none', eyes: 'round', mouth: 'smile' } },
      { lv: 3, start: 1, sp: 1.25, name: 'ゆうと', skin: { hair: 'short', hairColor: '#1F1A17', skin: '#E9C3A0', clothes: 'polo', clothesColor: '#2F4858', apron: 'waist', apronColor: '#2A2420', hat: 'cap', hatColor: '#2F4858', eyes: 'normal', mouth: 'neutral' } },
      { lv: 4, start: 2, sp: 0.85, name: 'みお', skin: { hair: 'bob', hairColor: '#6B4A35', skin: '#F5DCC6', clothes: 'coat', clothesColor: '#F7F5F0', apron: 'waist', apronColor: '#3B4B63', hat: 'chefS', hatColor: '#F7F5F0', eyes: 'droop', mouth: 'smile' } },
      { lv: 5, start: 2, sp: 1.1, name: 'あおい', skin: { hair: 'long', hairColor: '#2A1E18', skin: '#F0CDB0', clothes: 'knit', clothesColor: '#9DB4C0', apron: 'bib', apronColor: '#E8A0B4', hat: 'none', eyes: 'round', mouth: 'smile' } },
      { lv: 6, start: 3, sp: 0.95, name: 'はると', skin: { hair: 'crew', hairColor: '#3A2A22', skin: '#E2B796', clothes: 'shirt', clothesColor: '#DCE6F2', apron: 'waist', apronColor: '#4F6B4A', hat: 'cap', hatColor: '#4F6B4A', eyes: 'narrow', mouth: 'neutral' } },
      { lv: 7, start: 4, sp: 1.35, name: 'ひなた', skin: { hair: 'bun', hairColor: '#8A5A3C', skin: '#F5DCC6', clothes: 'coat', clothesColor: '#F7F5F0', apron: 'bib', apronColor: '#C9A35E', hat: 'chefS', hatColor: '#F7F5F0', eyes: 'round', mouth: 'grin' } },
      { lv: 8, start: 5, sp: 1.15, name: 'そうた', skin: { hair: 'wavy', hairColor: '#1F1A17', skin: '#D9AE8A', clothes: 'polo', clothesColor: '#7A1F2B', apron: 'waist', apronColor: '#2A2420', hat: 'none', eyes: 'normal', mouth: 'smile' } },
      { lv: 9, start: 8, sp: 1.2, name: 'けんじ', skin: { hair: 'crew', hairColor: '#8A8580', skin: '#D9AE8A', clothes: 'coat', clothesColor: '#F7F5F0', apron: 'waist', apronColor: '#1F1F22', hat: 'chef', hatColor: '#F7F5F0', beard: 'mustache', eyes: 'narrow', mouth: 'neutral', body: 'sturdy' } },
    ],
    tasks: {
      chef: { name: 'お菓子係', desc: '指定したお菓子を、生地 → 焼く → クリーム → 仕上げまで1人で作ってショーケースに並べる（「おまかせ」なら足りない物）', opt: 'recipe' },
      mix: { name: '生地係', desc: 'ミキサー台で生地を作る', opt: 'base' },
      bake: { name: 'オーブン係', desc: '予熱・焼成・取り出し', opt: null },
      whip: { name: 'クリーム係', desc: 'クリームを泡立てる', opt: 'cream' },
      deco: { name: '仕上げ係', desc: 'デコ台でケーキを仕上げる', opt: 'recipe' },
      stock: { name: '仕入れ係', desc: 'トラックや床の段ボールを運んで、指定した場所（棚・冷蔵棚・在庫棚・机）に入れる。少なくなった材料・箱を買い足す', opt: 'place' },
      wash: { name: '洗い場係', desc: '汚れたお皿・ケーキ型を洗って棚にしまう', opt: null },
      cashier: { name: 'レジ・接客', desc: '注文・箱詰め・お皿出し・お会計。席のお客さんにドリンクをすすめる', opt: null },
      feed: { name: '機械係', desc: '倉庫などから材料を取ってきて、自動の機械（自動ミキサー・自動ホイッパー・自動オーブン・自動デコ機・全自動ライン）に材料・型・クリームをセットし、できた物を次の機械やショーケースへ運ぶ。作るケーキを指定できる（「おまかせ」なら足りない物）', opt: 'recipe' },
    },
    // 仕事の速さ（1.0 ＝ 慣れた人）。Lv1 はとても遅い
    speed: [0.3, 0.38, 0.48, 0.6, 0.74, 0.9, 1.08, 1.3, 1.6, 2.0],
    xp: [0, 5, 12, 22, 35, 52, 74, 100, 132, 170],
    // 日給（手際がいい人ほど少し高い）
    wage: (lv, sp) => Math.round(((1200 + 450 * (lv - 1)) * (0.6 + 0.4 * (sp || 1))) / 10) * 10,
    jobSec: { mix: 20, whip: 14, deco: 24, in: 5, out: 4, stock: 8, order: 5, serve: 4, wash: 10, feed: 4 },
  };
  // 店舗レベル（売った数・お客さんの満足・評判で経験値がたまる）
  const SHOP_XP = [0, 150, 400, 800, 1400, 2200, 3300, 4800, 6800, 9500];
  // 増床レベルごとの店の大きさ（半幅 rx・半奥行き rz・厨房の奥行き kd、単位 m）
  // 縦長のお店（奥に広い厨房）：rx＝横幅の半分、rz＝奥行きの半分、kd＝奥の壁からカウンターまで
  const SHOP_SIZES = [{ rx: 8.0, rz: 11.5, kd: 16.0 }, { rx: 8.6, rz: 12.5, kd: 17.4 }, { rx: 9.2, rz: 13.5, kd: 18.8 }, { rx: 9.8, rz: 14.5, kd: 20.2 }];
  // 厨房の設備の数（増床レベルごと）と置き場の数
  const KITCHEN = { mix: [2, 3, 3, 4], whip: [2, 2, 3, 3], deco: [2, 3, 3, 4], reg: [2, 2, 3, 3], rack: 12, deliv: 10, spots: 12, pack: 4 };

  // ---- 広告 ----
  const ADS = {
    none:  { name: 'なし', cost: 0, mult: 1 },
    flyer: { name: 'チラシ配り', cost: 2500, mult: 1.2 },
    sns:   { name: 'SNS広告', cost: 6000, mult: 1.45 },
    tv:    { name: '地域情報番組', cost: 15000, mult: 1.9 },
  };

  // ---- お客さんタイプ ----
  const CUSTOMERS = [
    // hole = ホール（切っていない1台）を買う確率
    { id: 'student', name: '学生',   w: 3,   budget: 0.78, likes: ['berry', 'choco'],          picky: 0.2, color: '#7FB3FF', hair: '#3A2A22', hole: 0.02 },
    { id: 'worker',  name: '会社員', w: 3,   budget: 1.0,  likes: ['choco', 'cheese'],         picky: 0.4, color: '#5D6B82', hair: '#1F1A1A', hole: 0.08 },
    { id: 'parent',  name: '親子連れ', w: 2, budget: 0.92, likes: ['berry', 'fruit', 'milky'], picky: 0.3, color: '#F5A97F', hair: '#6B3E26', multi: true, hole: 0.3 },
    { id: 'gourmet', name: 'グルメ', w: 1,   budget: 1.42, likes: ['nutty', 'matcha', 'butter'], picky: 0.9, color: '#8F6BC9', hair: '#C9C2B8', hole: 0.1 },
    { id: 'tourist', name: '観光客', w: 1.5, budget: 1.15, likes: ['matcha', 'fruit'],         picky: 0.5, color: '#4FC1A6', hair: '#E2B04A', hole: 0.03 },
    { id: 'elder',   name: 'ご年配', w: 1.5, budget: 1.05, likes: ['nutty', 'cheese', 'light'], picky: 0.5, color: '#B59A7A', hair: '#E8E4DE', hole: 0.18 },
    { id: 'party',   name: 'お祝いの人', w: 0.8, budget: 1.12, likes: ['berry', 'fruit', 'choco'], picky: 0.4, color: '#F49AC2', hair: '#4A2E22', multi: true, hole: 0.85 },
  ];

  const SAY = {
    great: ['おいしそう〜！', 'これください！', 'いい香り…♪', 'ここのケーキ大好き！', 'ごほうびケーキ！', 'きれい〜！'],
    ok: ['これにしようかな', 'ひとつください', 'じゃあ、これで'],
    meh: ['うーん…まあいいか', '見た目がちょっと…'],
    pricey: ['ちょっと高いかな…', 'うーん、今日はやめとこ', 'お財布が…'],
    soldout: ['今日は何も売ってないの…？', 'また来ます…', 'ケーキないの…？'],
    gourmet: ['ほう…なかなか', '期待していますよ'],
  };

  const WEATHER = [
    { id: 'sun', name: '晴れ', mult: 1.0, w: 4 },
    { id: 'cloud', name: 'くもり', mult: 0.93, w: 3 },
    { id: 'rain', name: '雨', mult: 0.75, w: 2 },
    { id: 'snow', name: '雪', mult: 0.6, w: 0.6 },
  ];
  const DOW = ['月', '火', '水', '木', '金', '土', '日'];
  const DOW_MULT = [0.9, 0.9, 0.95, 1.0, 1.1, 1.35, 1.3];
  // 営業10時間ぶんの客足カーブ (10-11時 … 19-20時)
  const HOUR_CURVE = [0.6, 0.85, 1.35, 1.15, 0.8, 1.05, 1.4, 1.2, 1.05, 0.65];

  const DIFF = {
    easy:   { name: 'かんたん',   win: 1.6,  hint: true,  vanish: false, note: 'はじめての人向け' },
    normal: { name: 'ふつう',     win: 1.0,  hint: true,  vanish: false, note: '2〜3人におすすめ' },
    hard:   { name: 'むずかしい', win: 0.72, hint: false, vanish: true,  note: '4人で協力が前提' },
    expert: { name: 'パティシエ', win: 0.52, hint: false, vanish: true,  note: '一瞬の油断で焦げる' },
  };

  // ケーキの欠点（見た目で分かる = visible / 食べて分かる = hidden）
  const DEFECTS = {
    burnt:  { name: '焦げ', vis: true,  wtp: 0.6,  sat: 0.35, say: '焦げてる…' },
    crust:  { name: '表面が焦げ気味', vis: true, wtp: 0.85, sat: 0.12, say: 'ちょっと苦い…' },
    raw:    { name: '生焼け', vis: false, wtp: 1,  sat: 0.55, say: '中が生焼けだった…' },
    flat:   { name: 'ふくらみ不足', vis: true, wtp: 0.85, sat: 0.15, say: 'なんだか固い…' },
    dry:    { name: 'パサつき', vis: false, wtp: 1, sat: 0.2, say: 'パサパサしてる…' },
    lump:   { name: 'ダマ', vis: false, wtp: 1, sat: 0.22, say: '粉っぽいところが…' },
    weight: { name: '分量ミス', vis: false, wtp: 1, sat: 0.2, say: '味がいつもと違う…' },
    sep:    { name: 'クリーム分離', vis: true, wtp: 0.8, sat: 0.3, say: 'クリームがボソボソ…' },
    soft:   { name: 'クリームがゆるい', vis: true, wtp: 0.88, sat: 0.12, say: 'クリームがだれてる' },
    melt:   { name: 'クリームが溶けた', vis: true, wtp: 0.75, sat: 0.2, say: 'クリームが溶けてる…' },
    tilt:   { name: '層が傾いている', vis: true, wtp: 0.88, sat: 0.08, say: '形がちょっと…' },
    uneven: { name: '仕上げのムラ', vis: true, wtp: 0.88, sat: 0.08, say: '見た目がいまいち' },
    messy:  { name: 'デコが乱れている', vis: true, wtp: 0.85, sat: 0.08, say: 'ぐちゃっとしてる' },
    stale:  { name: '前日の売れ残り', vis: false, wtp: 0.9, sat: 0.1, say: 'ちょっと乾いてる' },
    spoil:  { name: '傷んでいた', vis: false, wtp: 0.4, sat: 0.7, say: 'なんだか酸っぱい…傷んでない？' },
  };
  const OVEN_TEMPS = [150, 160, 170, 180, 190, 200];
  const PREHEAT_MS = 9000;

  // 常温に置いたときに傷むまでの秒数（半分を過ぎると「ぬるい」→ だれる・溶ける。冷蔵庫・ショーケース・トラックの荷台は冷えている）
  const SPOIL = { cream: 240, cake: 300 };
  const RULES = {
    PREP_MS: 90000,      // （旧）開店準備
    OPEN_MS: 480000,     // OPEN のあいだに進む 1 日の長さ (10:00-20:00)。CLOSE 中は止まる
    COOL_MS: 15000,      // スポンジを冷ます時間
    SHIP: 500,           // 送料（1回の注文ごと）
    CART_MAX: 10,        // 1回に注文できる箱の数
    PACK: 10,            // 1箱に入っている数
    PRICE_LIMIT: 1.35,   // 相場のこれ以上だと、買わなかった人がクレームを言う
    PRICE_MAX: 1.8,      // 相場のこれ以上だと、だれも買わない
    PRICE_SOFT: 0.22,    // 買うかどうかのなだらかさ（値段を少し上げても、急に売れなくならないように）
    WTP_BASE: 1.15,      // お客さんが出してもいいと思う値段の基準
    HOLE_K: 0.9,         // ホール（切らずに1台）の相場 = 1切れの相場 × 切れ数 × これ    // 相場のこの倍を超えると、ほぼ誰も買わない（クレームも出る）
    WALK_MS: 7000,       // 入口からレジまで歩く時間
    QUEUE_MS: 50000,     // 注文を受けてもらえるまで待てる時間
    WAIT_MS: 45000,      // 注文してから受け取りまで待てる時間（＋1個ごとに9秒）
    MAKE_MS: 180000,     // 注文の品が商品棚に無いとき、作るのを待ってくれる時間（2種類目からは＋45秒ずつ）
    CAKE_DAYS: 2,        // ケーキの賞味期限：作った日を入れて2日（3日目になると消える）
    ORDER_MAX: 6,        // お客さん1人が注文する最大の個数（箱に入る数）
    EAT_MAX: 3,          // 店内で食べるお客さんの最大の個数（お皿1枚にのる数）
    PAY_MS: 60000,       // 商品を受け取ってからお会計を待てる時間
    DRY_MS: 30000,       // 洗ったお皿・型が乾くまで（置いてから）
    SIT_MS: 20000,       // イートインで座っている時間
    PIECES: 6,           // 1ホール = 6ピース
    START_FUNDS: 60000,  // オーブン・ミキサー・デコ台・材料・箱を買えるくらい
    RENT: 2500,
    RENT_PER_FLOOR: 1500,
    UTIL_PER_EQUIP: 250,
    BANKRUPT: -20000,
    // 借金（パソコン）：1万・3万・5万。5日で返す＝1日に 借りた額÷5 に50%上乗せ、10日で返す＝借りた額÷10 に120%上乗せ。閉店時に自動で引かれる
    LOAN: { amounts: [10000, 30000, 50000], plans: { 5: 0.5, 10: 1.2 } },
    MAX_ORIGINALS: 8,
    MAX_PLAYERS: 4,
  };

  // ---- アバター (各部位：リアル系) ----
  const AVATAR = {
    body: { slim: '細め', normal: 'ふつう', sturdy: 'がっしり' },
    height: { s: '小柄', m: 'ふつう', l: '高め' },
    hair: { short: 'ショート', crew: 'ベリーショート', bob: 'ボブ', long: 'ロング', pony: 'ポニーテール', bun: 'まとめ髪', wavy: 'ウェーブ', braid: '三つ編み' },
    eyes: { normal: 'ふつう', round: '丸め', narrow: '切れ長', droop: 'たれ目' },
    brows: { normal: 'ふつう', thin: '細め', thick: '太め' },
    mouth: { smile: 'ほほえみ', neutral: 'ふつう', grin: '笑顔' },
    beard: { none: 'なし', mustache: '口ひげ', beard: 'あごひげ', stubble: '無精ひげ' },
    hat: { chef: 'コック帽', chefS: '低いコック帽', cap: 'キャップ', bandana: 'バンダナ', kerchief: '三角巾', beret: 'ベレー帽', none: 'なし' },
    clothes: { coat: 'コックコート', shirt: 'シャツ', knit: 'ニット', polo: 'ポロシャツ' },
    apron: { none: 'なし', waist: '腰巻き（ロング）', bib: '胸当て' },
    pattern: { plain: '無地', stripe: 'ストライプ', check: 'チェック' },
    acc: { none: 'なし', glasses: 'めがね', scarf: 'スカーフ', watch: '腕時計', earring: 'ピアス' },
    skinColors: ['#F6D9C4', '#EFC7A8', '#E0AE88', '#C98F68', '#A06E4C', '#6E4A33'],
    hairColors: ['#1C1714', '#3A2A20', '#5B3E2B', '#7F5838', '#A7804F', '#C9A877', '#8A8580', '#D8D4CE', '#5A2A22', '#2E3A4C'],
    eyeColors: ['#2B1D14', '#4A3222', '#5A6B3A', '#3D5A80', '#6B6B6B'],
    clothColors: ['#F7F5F0', '#1F1F22', '#3B4B63', '#7A1F2B', '#4F6B4A', '#C9B79C', '#8C8F94', '#E8D5C4'],
    pantsColors: ['#1F1F22', '#2E3440', '#4A3B30', '#6B6F75', '#E8E2D6'],
    apronColors: ['#2B2523', '#5A3A2A', '#7A1F2B', '#2F4858', '#E9E4DA', '#9C7A5B', '#4F6B4A'],
  };
  const DEFAULT_SKIN = {
    body: 'normal', height: 'm', skin: '#EFC7A8', hair: 'bob', hairColor: '#3A2A20', eyes: 'normal', eyeColor: '#2B1D14', brows: 'normal', mouth: 'smile', beard: 'none',
    hat: 'chefS', hatColor: '#F7F5F0', clothes: 'coat', clothesColor: '#F7F5F0', pantsColor: '#1F1F22',
    apron: 'waist', apronColor: '#2B2523', pattern: 'plain', acc: 'none', accColor: '#B8862E',
  };

  CS.data = { SPOIL, KITCHEN, EQUIP, FURN, STAFF, SHOP_XP, SHOP_SIZES, DEFECTS, OVEN_TEMPS, PREHEAT_MS, ING, BASES, CREAMS, CREAM_YIELD, TOPS, RECIPES, PAIR, UPGRADES, ADS, CUSTOMERS, SAY, WEATHER, DOW, DOW_MULT, HOUR_CURVE, DIFF, RULES, AVATAR, DEFAULT_SKIN };
})(typeof window !== 'undefined' ? window : globalThis);
