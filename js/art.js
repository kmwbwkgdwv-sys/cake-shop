/* ケーキ屋さんシミュレーター : SVG イラスト（アバター・ケーキ・アイコン） */
(function (G) {
  'use strict';
  const CS = (G.CS = G.CS || {});
  const D = CS.data;
  const INK = '#3B2430';
  let uidN = 0;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const col = (c, d) => (/^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : d);

  function shade(hex, amt) {
    hex = col(hex, '#888888').slice(1);
    if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return '#' + [f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  // ============ アバター ============
  const HAIR_BACK = {
    short: 'M23,66 C17,28 40,15 60,15 C80,15 103,28 97,66 C92,50 28,50 23,66Z',
    spiky: 'M23,66 C17,28 40,15 60,15 C80,15 103,28 97,66 C92,50 28,50 23,66Z',
    bob: 'M21,88 C12,40 30,15 60,15 C90,15 108,40 99,88 C93,92 87,90 85,84 L35,84 C33,90 27,92 21,88Z',
    long: 'M19,126 C8,60 22,15 60,15 C98,15 112,60 101,126 C91,131 84,124 82,110 L38,110 C36,124 29,131 19,126Z',
    wavy: 'M19,98 C10,46 30,15 60,15 C90,15 110,46 101,98 C97,106 88,103 86,96 C82,104 74,102 73,95 L47,95 C46,102 38,104 34,96 C32,103 23,106 19,98Z',
    pony: 'M23,66 C17,28 40,15 60,15 C80,15 103,28 97,66 C92,50 28,50 23,66Z M90,36 C116,40 120,90 104,110 C100,88 94,66 84,52Z',
    twin: 'M23,66 C17,28 40,15 60,15 C80,15 103,28 97,66 C92,50 28,50 23,66Z M26,46 C2,54 2,100 14,116 C17,94 24,74 32,60Z M94,46 C118,54 118,100 106,116 C103,94 96,74 88,60Z',
    bun: 'M23,66 C17,28 40,15 60,15 C80,15 103,28 97,66 C92,50 28,50 23,66Z M47,14 a13,13 0 1,0 26,0 a13,13 0 1,0 -26,0Z',
  };
  const BANGS = {
    def: 'M25,57 C22,30 40,20 60,20 C80,20 98,30 95,57 C89,45 81,40 74,45 C70,36 64,36 60,45 C55,36 47,38 45,46 C38,40 30,44 25,57Z',
    blunt: 'M25,54 C24,28 42,19 60,19 C78,19 96,28 95,54 C80,48 40,48 25,54Z',
    spiky: 'M24,58 L29,31 L39,41 L45,19 L55,36 L61,13 L69,35 L78,20 L82,40 L92,30 L96,58 C86,47 34,47 24,58Z',
    side: 'M25,58 C22,28 44,18 64,20 C84,22 98,34 95,56 C84,40 66,34 48,42 C38,46 30,50 25,58Z',
  };
  const BANG_FOR = { short: 'def', spiky: 'spiky', bob: 'blunt', long: 'blunt', wavy: 'side', pony: 'side', twin: 'def', bun: 'def' };

  function eyes(s) {
    const c = col(s.eyeColor, '#3A2A22');
    const one = (x, dir) => {
      const y = 64;
      switch (s.eyes) {
        case 'smile': return `<path d="M${x - 6},${y + 1} Q${x},${y - 7} ${x + 6},${y + 1}" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
        case 'jito': return `<path d="M${x - 6.5},${y - 1} L${x + 6.5},${y - 1} A6.5,5.5 0 0,1 ${x - 6.5},${y - 1}Z" fill="${c}" stroke="${INK}" stroke-width="2"/><circle cx="${x + 1.5}" cy="${y + 1.5}" r="1.6" fill="#fff"/>`;
        case 'sparkle': return `<ellipse cx="${x}" cy="${y}" rx="6.8" ry="8.2" fill="${c}" stroke="${INK}" stroke-width="2"/><ellipse cx="${x}" cy="${y + 3}" rx="4.2" ry="3.4" fill="${shade(c, 0.35)}"/><circle cx="${x - 2.2}" cy="${y - 3}" r="2.4" fill="#fff"/><path d="M${x + 3},${y + 1.5} l0.9,1.9 1.9,0.9 -1.9,0.9 -0.9,1.9 -0.9,-1.9 -1.9,-0.9 1.9,-0.9Z" fill="#fff"/>`;
        default: {
          let lid = '';
          if (s.eyes === 'tare') lid = `<path d="M${x - 7.5 * dir},${y - 3} Q${x},${y - 10} ${x + 7 * dir},${y - 6}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
          if (s.eyes === 'tsuri') lid = `<path d="M${x - 7 * dir},${y - 7} Q${x},${y - 10} ${x + 7.5 * dir},${y - 3}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
          return `<ellipse cx="${x}" cy="${y}" rx="5.4" ry="7" fill="${c}" stroke="${INK}" stroke-width="2"/><circle cx="${x - 1.6}" cy="${y - 2.6}" r="2.1" fill="#fff"/>${lid}`;
        }
      }
    };
    return one(46, -1) + one(74, 1);
  }
  function brows(s) {
    if (s.brows === 'none') return '';
    const w = s.brows === 'thick' ? 3.6 : 2.2;
    const hc = shade(col(s.hairColor, '#3A2A22'), -0.35);
    if (s.brows === 'worried') return `<path d="M40,53 L51,50" stroke="${hc}" stroke-width="${w}" stroke-linecap="round"/><path d="M80,53 L69,50" stroke="${hc}" stroke-width="${w}" stroke-linecap="round"/>`;
    return `<path d="M40,52 Q46,48 52,51" fill="none" stroke="${hc}" stroke-width="${w}" stroke-linecap="round"/><path d="M80,52 Q74,48 68,51" fill="none" stroke="${hc}" stroke-width="${w}" stroke-linecap="round"/>`;
  }
  function mouth(s) {
    switch (s.mouth) {
      case 'cat': return `<path d="M52,76 Q56,81 60,76 Q64,81 68,76" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`;
      case 'open': return `<path d="M53,75 Q60,74 67,75 Q66,87 60,87 Q54,87 53,75Z" fill="#B8344C" stroke="${INK}" stroke-width="2"/><path d="M55.5,83 Q60,79 64.5,83 Q62,86.5 60,86.5 Q58,86.5 55.5,83Z" fill="#FF8FA3"/>`;
      case 'flat': return `<path d="M54,78 L66,78" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
      case 'tongue': return `<path d="M53,76 Q60,82 67,76" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/><path d="M61,79 Q63,85 66,79" fill="#FF8FA3" stroke="${INK}" stroke-width="1.6"/>`;
      default: return `<path d="M53,76 Q60,83 67,76" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
  }
  function patternDef(id, s) {
    const a = col(s.apronColor, '#FF7FA8'); const l = shade(a, 0.55);
    switch (s.pattern) {
      case 'stripe': return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${l}"/><rect width="4" height="8" fill="${a}"/></pattern>`;
      case 'dot': return `<pattern id="${id}" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="${a}"/><circle cx="4.5" cy="4.5" r="1.8" fill="${l}"/></pattern>`;
      case 'gingham': return `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="${l}"/><rect width="5" height="10" fill="${a}" opacity=".55"/><rect width="10" height="5" fill="${a}" opacity=".55"/></pattern>`;
      default: return '';
    }
  }
  function body(s, pid) {
    const c = col(s.clothesColor, '#FFFFFF');
    const dk = shade(c, -0.18);
    let out = '';
    const torso = 'M30,142 C30,110 40,93 60,93 C80,93 90,110 90,142Z';
    if (s.clothes === 'hoodie') out += `<path d="M38,96 C40,86 80,86 82,96 L76,102 L44,102Z" fill="${dk}" stroke="${INK}" stroke-width="2.2"/>`;
    if (s.clothes === 'dress') out += `<path d="M26,142 C30,112 40,93 60,93 C80,93 90,112 94,142Z" fill="${c}" stroke="${INK}" stroke-width="2.4"/><path d="M50,94 L60,104 L70,94" fill="#fff" stroke="${INK}" stroke-width="2"/><circle cx="60" cy="106" r="3.4" fill="${shade(c, -0.35)}" stroke="${INK}" stroke-width="1.6"/>`;
    else if (s.clothes === 'vest') out += `<path d="${torso}" fill="#FFFFFF" stroke="${INK}" stroke-width="2.4"/><path d="M30,142 C30,110 40,94 52,93 L60,118 L68,93 C80,94 90,110 90,142Z" fill="${c}" stroke="${INK}" stroke-width="2.2"/><circle cx="60" cy="126" r="1.8" fill="${INK}"/><circle cx="60" cy="135" r="1.8" fill="${INK}"/>`;
    else {
      out += `<path d="${torso}" fill="${c}" stroke="${INK}" stroke-width="2.4"/>`;
      if (s.clothes === 'coat') out += `<path d="M48,94 L60,106 L72,94" fill="none" stroke="${INK}" stroke-width="2"/>` + [112, 124, 136].map((y) => `<circle cx="53" cy="${y}" r="2" fill="${dk}" stroke="${INK}" stroke-width="1.2"/><circle cx="67" cy="${y}" r="2" fill="${dk}" stroke="${INK}" stroke-width="1.2"/>`).join('');
      if (s.clothes === 'hoodie') out += `<path d="M54,100 L53,116 M66,100 L67,116" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/><path d="M44,128 L76,128 L74,140 L46,140Z" fill="${dk}" stroke="${INK}" stroke-width="1.8"/>`;
    }
    const af = s.pattern && s.pattern !== 'plain' ? `url(#${pid})` : col(s.apronColor, '#FF7FA8');
    if (s.apron === 'bib') out += `<path d="M46,100 L44,96 M74,100 L76,96" stroke="${INK}" stroke-width="2"/><path d="M45,101 L75,101 L80,142 L40,142Z" fill="${af}" stroke="${INK}" stroke-width="2.2"/><path d="M52,120 L68,120 L67,132 L53,132Z" fill="none" stroke="${INK}" stroke-width="1.6" opacity=".6"/>`;
    if (s.apron === 'waist') out += `<path d="M34,120 L86,120 L90,142 L30,142Z" fill="${af}" stroke="${INK}" stroke-width="2.2"/><path d="M33,120 L87,120" stroke="${shade(col(s.apronColor, '#FF7FA8'), -0.3)}" stroke-width="4"/>`;
    return out;
  }
  function hat(s, layer) {
    const c = col(s.hatColor, '#FFFFFF'); const dk = shade(c, -0.15);
    switch (s.hat) {
      case 'chef': return layer === 'front' ? `<path d="M34,32 C22,16 34,-2 48,4 C52,-8 70,-8 72,4 C86,-2 98,16 86,32Z" fill="${c}" stroke="${INK}" stroke-width="2.4"/><rect x="33" y="26" width="54" height="14" rx="5" fill="${dk}" stroke="${INK}" stroke-width="2.4"/>` : '';
      case 'chefS': return layer === 'front' ? `<path d="M38,30 C30,18 40,8 50,12 C54,4 66,4 70,12 C80,8 90,18 82,30Z" fill="${c}" stroke="${INK}" stroke-width="2.4"/><rect x="37" y="25" width="46" height="11" rx="4.5" fill="${dk}" stroke="${INK}" stroke-width="2.4"/>` : '';
      case 'beret': return layer === 'front' ? `<path d="M22,34 C20,14 56,6 84,14 C100,19 98,32 88,34 C70,26 44,26 22,34Z" fill="${c}" stroke="${INK}" stroke-width="2.4"/><path d="M60,10 L62,3" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` : '';
      case 'bandana': return layer === 'front' ? `<path d="M24,44 C26,26 94,26 96,44 C80,38 40,38 24,44Z" fill="${c}" stroke="${INK}" stroke-width="2.2"/><path d="M95,38 L108,32 L104,44Z M95,40 L106,50 L96,48Z" fill="${dk}" stroke="${INK}" stroke-width="2"/>` : '';
      case 'kerchief': return layer === 'front' ? `<path d="M22,48 C22,18 98,18 98,48 C82,36 38,36 22,48Z" fill="${c}" stroke="${INK}" stroke-width="2.4"/><path d="M28,40 C40,32 80,32 92,40" fill="none" stroke="${dk}" stroke-width="2"/>` : '';
      case 'cat': return layer === 'back' ? `<path d="M28,34 L30,8 L50,24Z" fill="${c}" stroke="${INK}" stroke-width="2.4"/><path d="M33,28 L34,15 L44,24Z" fill="#FFB3C8"/><path d="M92,34 L90,8 L70,24Z" fill="${c}" stroke="${INK}" stroke-width="2.4"/><path d="M87,28 L86,15 L76,24Z" fill="#FFB3C8"/>` : '';
      default: return '';
    }
  }
  function acc(s) {
    const c = col(s.accColor, '#FF5C8A');
    switch (s.acc) {
      case 'glasses': return `<circle cx="46" cy="64" r="9" fill="rgba(255,255,255,.25)" stroke="${INK}" stroke-width="2"/><circle cx="74" cy="64" r="9" fill="rgba(255,255,255,.25)" stroke="${INK}" stroke-width="2"/><path d="M55,63 Q60,60 65,63" fill="none" stroke="${INK}" stroke-width="2"/>`;
      case 'ribbon': return `<path d="M30,34 L18,26 L18,44Z M30,34 L42,26 L42,44Z" fill="${c}" stroke="${INK}" stroke-width="2"/><circle cx="30" cy="35" r="3.6" fill="${shade(c, -0.25)}" stroke="${INK}" stroke-width="1.6"/>`;
      case 'star': return `<path d="M88,36 l3,6 6.6,1 -4.8,4.6 1.2,6.6 -6,-3.2 -6,3.2 1.2,-6.6 -4.8,-4.6 6.6,-1Z" fill="${c}" stroke="${INK}" stroke-width="1.8"/>`;
      case 'bandaid': return `<g transform="rotate(-20 82 76)"><rect x="74" y="72" width="16" height="7" rx="3.5" fill="#F6C99A" stroke="${INK}" stroke-width="1.6"/><rect x="79" y="72" width="6" height="7" fill="#EDB27C"/></g>`;
      case 'flower': return `<g transform="translate(30 36)">${[0, 72, 144, 216, 288].map((a) => `<circle cx="${Math.cos((a * Math.PI) / 180) * 5}" cy="${Math.sin((a * Math.PI) / 180) * 5}" r="4.2" fill="${c}" stroke="${INK}" stroke-width="1.4"/>`).join('')}<circle r="3.4" fill="#FFE07A" stroke="${INK}" stroke-width="1.4"/></g>`;
      default: return '';
    }
  }
  function avatar(skinIn, opt) {
    const s = Object.assign({}, D.DEFAULT_SKIN, skinIn || {});
    opt = opt || {};
    const id = 'av' + ++uidN;
    const skin = col(s.skin, '#FFE3D0');
    const hc = col(s.hairColor, '#8A5A3B');
    const hairStyle = HAIR_BACK[s.hair] ? s.hair : 'bob';
    const bang = BANGS[BANG_FOR[hairStyle]];
    const view = opt.head ? '14 -6 92 96' : '0 -10 120 154';
    const blush = s.blush ? `<ellipse cx="38" cy="74" rx="6.5" ry="3.6" fill="${col(s.blushColor, '#FF9EB5')}" opacity=".65"/><ellipse cx="82" cy="74" rx="6.5" ry="3.6" fill="${col(s.blushColor, '#FF9EB5')}" opacity=".65"/>` : '';
    return `<svg class="avatar" viewBox="${view}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${patternDef(id, s)}</defs>` +
      `<g stroke-linejoin="round">` +
      (opt.head ? '' : body(s, id)) +
      hat(s, 'back') +
      `<path d="${HAIR_BACK[hairStyle]}" fill="${shade(hc, -0.08)}" stroke="${INK}" stroke-width="2.4"/>` +
      `<ellipse cx="25" cy="64" rx="5" ry="7" fill="${skin}" stroke="${INK}" stroke-width="2.2"/><ellipse cx="95" cy="64" rx="5" ry="7" fill="${skin}" stroke="${INK}" stroke-width="2.2"/>` +
      `<ellipse cx="60" cy="58" rx="35" ry="32" fill="${skin}" stroke="${INK}" stroke-width="2.4"/>` +
      blush + eyes(s) + brows(s) + mouth(s) +
      `<path d="${bang}" fill="${hc}" stroke="${INK}" stroke-width="2.4"/>` +
      `<path d="M40,28 Q50,24 58,26" fill="none" stroke="${shade(hc, 0.45)}" stroke-width="3" stroke-linecap="round" opacity=".8"/>` +
      acc(s) + hat(s, 'front') +
      `</g></svg>`;
  }
  function randomSkin() {
    const A = D.AVATAR; const k = (o) => { const ks = Object.keys(o); return ks[Math.floor(Math.random() * ks.length)]; };
    const p = (a) => a[Math.floor(Math.random() * a.length)];
    return { skin: p(A.skinColors), hair: k(A.hair), hairColor: p(A.hairColors), eyes: k(A.eyes), eyeColor: p(A.eyeColors), brows: k(A.brows), mouth: k(A.mouth), blush: Math.random() < 0.7, blushColor: '#FF9EB5', hat: k(A.hat), hatColor: p(A.clothColors), clothes: k(A.clothes), clothesColor: p(A.clothColors), apron: k(A.apron), apronColor: p(['#FF7FA8', '#7EC8E3', '#FFD25C', '#9ED69A', '#C8B6FF', '#FF9F6B']), pattern: k(A.pattern), acc: k(A.acc), accColor: p(['#FF5C8A', '#FFD25C', '#7EC8E3', '#9E8CFF']) };
  }
  // お客さん用（タイプとバリエーションから決まる）
  function customerSkin(type, v) {
    const ct = D.CUSTOMERS.find((c) => c.id === type) || D.CUSTOMERS[0];
    const hairs = ['short', 'bob', 'long', 'pony', 'wavy', 'bun', 'spiky', 'twin'];
    const eyesL = ['round', 'smile', 'tare', 'round'];
    return { skin: D.AVATAR.skinColors[(v * 3 + type.length) % 4], hair: hairs[(v + type.length) % hairs.length], hairColor: ct.hair, eyes: eyesL[v % 4], eyeColor: '#3A2A22', brows: 'normal', mouth: 'smile', blush: v % 2 === 0, hat: type === 'gourmet' ? 'beret' : 'none', hatColor: '#3B2A30', clothes: type === 'worker' ? 'vest' : type === 'parent' ? 'dress' : type === 'student' ? 'hoodie' : 'coat', clothesColor: ct.color, apron: 'none', pattern: 'plain', acc: type === 'elder' ? 'glasses' : 'none' };
  }

  // ============ ケーキ ============
  function topGlyph(kind, x, y, s) {
    s = s || 1;
    const T = (inner) => `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;
    switch (kind) {
      case 'strawberry': return T(`<path d="M0,6 C-7,1 -6,-6 0,-5 C6,-6 7,1 0,6Z" fill="#F0435F" stroke="${INK}" stroke-width="1.3"/><path d="M-3,-5 L0,-8 L3,-5 L0,-4Z" fill="#4FAE52"/><circle cx="-2" cy="-1" r=".7" fill="#FFE6A8"/><circle cx="2" cy="1" r=".7" fill="#FFE6A8"/>`);
      case 'blueberry': return T(`<circle cx="-2.6" cy="1" r="3.2" fill="#3F4FA8" stroke="${INK}" stroke-width="1.1"/><circle cx="2.6" cy="1" r="3.2" fill="#4A5BBE" stroke="${INK}" stroke-width="1.1"/><circle cx="0" cy="-3" r="3.2" fill="#3A479B" stroke="${INK}" stroke-width="1.1"/>`);
      case 'peach': return T(`<path d="M-6,2 C-6,-6 6,-6 6,2 C3,4 -3,4 -6,2Z" fill="#FFB18A" stroke="${INK}" stroke-width="1.2"/><path d="M-4,0 C-1,-3 2,-3 4,0" fill="none" stroke="#FF8F7A" stroke-width="1.4"/>`);
      case 'lemon': return T(`<circle r="5.2" fill="#FFE45C" stroke="${INK}" stroke-width="1.2"/><circle r="3.6" fill="#FFF6B8"/><path d="M0,-3.6 V3.6 M-3.6,0 H3.6 M-2.5,-2.5 L2.5,2.5 M2.5,-2.5 L-2.5,2.5" stroke="#FFE45C" stroke-width=".8"/>`);
      case 'choco': return T(`<path d="M-5,-4 L5,-5 L6,4 L-4,5Z" fill="#5A3322" stroke="${INK}" stroke-width="1.2"/><path d="M-2,-3 L3,-3.5" stroke="#8A5A3B" stroke-width="1.2"/>`);
      case 'chestnut': return T(`<path d="M0,-6 C6,-2 6,5 0,5 C-6,5 -6,-2 0,-6Z" fill="#B57538" stroke="${INK}" stroke-width="1.2"/><path d="M-2,-2 C-1,-3 1,-3 2,-2" stroke="#F2C27A" stroke-width="1.2" fill="none"/>`);
      default: return '';
    }
  }
  function topsList(r) { const out = []; for (const k in r.tops || {}) for (let i = 0; i < r.tops[k]; i++) out.push(k); return out; }

  // 上から見たホール (pieces = 残りピース数)
  function cakeTop(r, opt) {
    opt = opt || {};
    const pieces = opt.pieces == null ? 6 : opt.pieces;
    const b = D.BASES[r.base] || D.BASES.plain;
    const cr = D.CREAMS[r.cream] || D.CREAMS.none;
    const top = cr.color || b.color;
    const rim = r.base === 'tart' ? b.color : (cr.color ? shade(cr.color, -0.06) : b.crumb);
    const id = 'ck' + ++uidN;
    const R0 = 42, cx = 50, cy = 50;
    const wedge = (i) => {
      const a0 = (-90 + i * 60) * Math.PI / 180, a1 = (-90 + (i + 1) * 60) * Math.PI / 180;
      return `M${cx},${cy} L${cx + R0 * Math.cos(a0)},${cy + R0 * Math.sin(a0)} A${R0},${R0} 0 0,1 ${cx + R0 * Math.cos(a1)},${cy + R0 * Math.sin(a1)}Z`;
    };
    let wedges = '';
    for (let i = 0; i < pieces; i++) wedges += `<path d="${wedge(i)}" fill="url(#${id})" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
    const tl = topsList(r);
    let tops = '';
    if (tl.length) for (let i = 0; i < pieces; i++) { const a = (-60 + i * 60) * Math.PI / 180; tops += topGlyph(tl[i % tl.length], cx + 30 * Math.cos(a), cy + 30 * Math.sin(a), 1.15); }
    if (tl.length && pieces === 6) tops += topGlyph(tl[0], cx, cy, 1.3);
    const sc = r.base === 'tart' ? `<circle cx="${cx}" cy="${cy}" r="${R0 + 3}" fill="none" stroke="${b.crumb}" stroke-width="5" stroke-dasharray="4 3" opacity="${pieces ? 0.9 : 0}"/>` : '';
    return `<svg class="cake" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><radialGradient id="${id}" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="${shade(top, 0.25)}"/><stop offset=".72" stop-color="${top}"/><stop offset="1" stop-color="${rim}"/></radialGradient></defs>` +
      `<ellipse cx="50" cy="54" rx="48" ry="46" fill="rgba(59,36,48,.12)"/><circle cx="50" cy="50" r="47" fill="#EAF3FA" stroke="${INK}" stroke-width="1.6"/><circle cx="50" cy="50" r="44.5" fill="none" stroke="#fff" stroke-width="1.5"/>` +
      sc + wedges + tops + `</svg>`;
  }
  // 横から見たホール
  function cakeSide(r, opt) {
    opt = opt || {};
    const b = D.BASES[r.base] || D.BASES.plain;
    const cr = D.CREAMS[r.cream] || D.CREAMS.none;
    const creamC = cr.color;
    const tart = r.base === 'tart';
    const cheese = r.base === 'cheese' && !creamC;
    const x0 = 18, x1 = 102, yTop = tart ? 44 : 30, yBot = 72;
    let g = `<ellipse cx="60" cy="${yBot + 4}" rx="52" ry="9" fill="#fff" stroke="${INK}" stroke-width="2"/>`;
    if (tart) {
      g += `<path d="M${x0},${yTop} L${x0 + 4},${yBot} Q60,${yBot + 10} ${x1 - 4},${yBot} L${x1},${yTop}Z" fill="${b.color}" stroke="${INK}" stroke-width="2.2"/>`;
      for (let x = x0 + 6; x < x1 - 4; x += 9) g += `<path d="M${x},${yTop + 2} L${x + 1},${yBot}" stroke="${b.crumb}" stroke-width="2"/>`;
      g += `<ellipse cx="60" cy="${yTop}" rx="42" ry="9" fill="${creamC || b.color}" stroke="${INK}" stroke-width="2.2"/>`;
      if (r.cream === 'maron') { for (let i = 0; i < 5; i++) g += `<path d="M${36 + i * 6},${yTop - 2} Q${60},${yTop - 34 + i * 3} ${84 - i * 6},${yTop - 2}" fill="none" stroke="${shade(creamC, -0.12)}" stroke-width="4" stroke-linecap="round"/>`; g += `<path d="M38,${yTop} Q60,${yTop - 34} 82,${yTop}" fill="none" stroke="${INK}" stroke-width="1.4" opacity=".5"/>`; }
    } else {
      const outer = creamC || b.color;
      g += `<path d="M${x0},${yTop} L${x0},${yBot} Q60,${yBot + 12} ${x1},${yBot} L${x1},${yTop}Z" fill="${outer}" stroke="${INK}" stroke-width="2.2"/>`;
      if (creamC) {
        // 断面ライン（スポンジとクリームの層）
        g += `<path d="M${x0 + 2},${yTop + 14} Q60,${yTop + 24} ${x1 - 2},${yTop + 14}" fill="none" stroke="${b.color}" stroke-width="7"/>`;
        g += `<path d="M${x0 + 2},${yTop + 30} Q60,${yTop + 40} ${x1 - 2},${yTop + 30}" fill="none" stroke="${b.color}" stroke-width="7"/>`;
        for (let i = 0; i < 6; i++) { const x = x0 + 8 + i * 13; g += `<path d="M${x},${yTop + 2} q4,${8 + (i % 3) * 4} 8,0" fill="${creamC}" stroke="${INK}" stroke-width="1.4"/>`; }
      } else if (cheese) {
        g += `<path d="M${x0},${yTop} L${x0},${yTop + 6} Q60,${yTop + 18} ${x1},${yTop + 6} L${x1},${yTop}Z" fill="${b.crumb}" opacity=".7"/>`;
      }
      g += `<ellipse cx="60" cy="${yTop}" rx="42" ry="10" fill="${cheese ? shade(b.crumb, 0.15) : shade(outer, 0.18)}" stroke="${INK}" stroke-width="2.2"/>`;
      if (creamC) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g += `<circle cx="${60 + Math.cos(a) * 34}" cy="${yTop + Math.sin(a) * 7}" r="4" fill="${shade(creamC, 0.1)}" stroke="${INK}" stroke-width="1.2"/>`; }
    }
    const tl = topsList(r);
    tl.forEach((k, i) => { const a = (i / Math.max(1, tl.length)) * Math.PI * 2 + 0.6; g += topGlyph(k, 60 + Math.cos(a) * (tl.length > 1 ? 18 : 0), yTop - 5 + Math.sin(a) * 3, 1.6); });
    return `<svg class="cake" viewBox="0 0 120 92" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g stroke-linejoin="round">${g}</g></svg>`;
  }

  // ============ アイコン ============
  const IC = {
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l8-8"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    cart: '<path d="M3 4h2.5l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6.3"/><circle cx="10" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 8h7M9 11.5h5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.8 3.2-6 6.5-6s5.9 2.2 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2c3 .2 5 2.2 5.5 5.3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.5L20 16"/><path d="M20 21v-5h-5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
    shirt: '<path d="M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3c-.5 2-2 3-4 3s-3.5-1-4-3z"/>',
    door: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18"/><circle cx="15" cy="12" r="1"/>',
    move: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    case: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 12h18M8 5v14"/>',
    oven: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6" y="9" width="12" height="9" rx="1"/><path d="M7 6h.01M11 6h.01M15 6h3"/>',
    fire: '<path d="M12 22c4 0 7-2.8 7-7 0-4.5-4-7-5-11-2 2-3 4-3 6-1-1-2-2-2-4-2 2-4 5-4 9 0 4.2 3 7 7 7z"/>',
    mixer: '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M12 3v8M9 4l3 3 3-3"/>',
    snow: '<path d="M12 2v20M4 7l16 10M20 7L4 17"/>',
    fridge: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 10h14M8 6v2M8 13v3"/>',
    sign: '<path d="M12 3v4M4 7h16v8H4zM12 15v6"/>',
    home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    cup: '<path d="M4 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3"/>',
    lab: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/>',
    megaphone: '<path d="M3 10v4h4l8 5V5L7 10z"/><path d="M19 9a4 4 0 0 1 0 6"/>',
    light: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6 7-2.6 0-4-1.2-5.5-3.5L3.5 14a1.5 1.5 0 0 1 2.5-1.6L8 15"/>',
    sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  };
  function icon(name, cls) { return `<svg class="ic ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[name] || ''}</svg>`; }

  // ============ 厨房の器具イラスト ============
  function station(kind) {
    const s = (inner) => `<svg class="st-art" viewBox="0 0 80 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${inner}</g></svg>`;
    switch (kind) {
      case 'mix': return s('<path d="M14,30 L66,30 C66,50 54,58 40,58 C26,58 14,50 14,30Z" fill="#CFE8F7"/><ellipse cx="40" cy="30" rx="26" ry="6" fill="#FFF3D6"/><path d="M46,6 L40,30" fill="none"/><path d="M40,30 C34,24 36,16 42,16 C48,16 48,24 40,30Z" fill="none"/><rect x="43" y="2" width="6" height="8" rx="2" fill="#FF7FA8"/>');
      case 'oven': return s('<rect x="10" y="6" width="60" height="52" rx="7" fill="#F4F0F7"/><rect x="17" y="20" width="46" height="31" rx="4" fill="#3B2430"/><rect x="21" y="24" width="38" height="23" rx="3" fill="#FFB65C" class="oven-glow"/><circle cx="20" cy="13" r="2.6" fill="#FF7FA8"/><circle cx="29" cy="13" r="2.6" fill="#FFD25C"/><path d="M46,13 L62,13"/>');
      case 'rack': return s('<path d="M12,12 L12,58 M68,12 L68,58" fill="none"/><path d="M12,24 L68,24 M12,40 L68,40" fill="none"/><ellipse cx="30" cy="20" rx="12" ry="4" fill="#F2CC7E"/><ellipse cx="52" cy="36" rx="12" ry="4" fill="#8A5A3B"/><path d="M58,10 q3,-4 0,-8 M50,12 q3,-4 0,-8" fill="none" stroke="#9FD8F5"/>');
      case 'whip': return s('<path d="M12,28 L68,28 C68,48 56,58 40,58 C24,58 12,48 12,28Z" fill="#E7DDF6"/><path d="M22,28 C26,16 34,22 38,14 C42,22 50,14 56,26 C58,28 22,28 22,28Z" fill="#FFFDF7"/><path d="M58,4 L44,22" fill="none"/><path d="M44,22 l-6,6 M44,22 l-2,8 M44,22 l-8,2" fill="none"/>');
      case 'deco': return s('<path d="M18,52 L62,52 L54,60 L26,60Z" fill="#C8B6FF"/><rect x="36" y="44" width="8" height="8" fill="#E7DDF6"/><path d="M16,32 L64,32 L64,42 Q40,48 16,42Z" fill="#FFFDF7"/><ellipse cx="40" cy="32" rx="24" ry="6" fill="#FFF8EE"/><path d="M33,26 C29,22 33,18 36,21 C39,18 43,22 39,26 L36,29Z" fill="#F0435F"/><path d="M60,6 L70,18 L56,26 Z" fill="#FFD6E2"/>');
      case 'fridge': return s('<rect x="18" y="4" width="44" height="56" rx="6" fill="#DDF1F7"/><path d="M18,24 L62,24" fill="none"/><path d="M24,12 L24,18 M24,30 L24,40" fill="none"/><circle cx="50" cy="40" r="5" fill="#FFB6C9"/>');
      default: return '';
    }
  }

  CS.art = { avatar, randomSkin, customerSkin, cakeTop, cakeSide, topGlyph, icon, station, esc, shade };
})(typeof window !== 'undefined' ? window : globalThis);
