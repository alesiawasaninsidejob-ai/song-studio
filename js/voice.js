/* Song Studio — singing voice. A source–filter singer rendered sample by sample in plain JS:
   glottal pulse source (Rosenberg flow derivative, anti-aliased closure) with jitter, shimmer and
   pulsed breath noise, a 5-formant cascade vocal tract with continuously moving formants
   (coarticulation), separate frication/burst branch for consonants, natural pitch behaviour
   (portamento, onset scoops, delayed vibrato, slow drift) and optional double-tracks and harmony.
   Free and offline: no APIs, no samples. Works in browsers, Web Workers and Node. */
(function (root) {
  'use strict';

  // ---------- phonetics ----------
  // vowel targets, male reference (Hz). Two entries = diphthong (start, end).
  const VOW = {
    i: [[300, 2200, 2950]], ih: [[410, 1900, 2550]], e: [[550, 1780, 2500]], ae: [[690, 1660, 2450]],
    aa: [[740, 1150, 2500]], uh: [[630, 1210, 2480]], o: [[560, 960, 2450], [390, 820, 2400]],
    u: [[330, 920, 2300]], er: [[490, 1360, 1720]], ai: [[740, 1240, 2500], [420, 1900, 2550]],
    ei: [[520, 1830, 2500], [350, 2120, 2700]], au: [[740, 1200, 2500], [400, 860, 2400]],
    oi: [[560, 920, 2450], [420, 1880, 2550]], oo: [[440, 1080, 2350]]
  };
  const BV = [70, 95, 140];
  // consonants
  const CON = {
    p: { k: 'stop', vl: 1, F: [250, 900, 2200], bf: 1100, bb: 1800, ba: 0.45 },
    b: { k: 'stop', vl: 0, F: [250, 900, 2200], bf: 1100, bb: 1800, ba: 0.22 },
    t: { k: 'stop', vl: 1, F: [300, 1750, 2750], bf: 4300, bb: 2600, ba: 0.55 },
    d: { k: 'stop', vl: 0, F: [300, 1700, 2700], bf: 4000, bb: 2600, ba: 0.25 },
    k: { k: 'stop', vl: 1, F: [300, 1950, 2450], bf: 2300, bb: 1300, ba: 0.55 },
    g: { k: 'stop', vl: 0, F: [300, 1950, 2450], bf: 2200, bb: 1300, ba: 0.25 },
    s: { k: 'fric', vl: 1, F: [380, 1700, 2700], ff: 6200, fb: 2600, fa: 0.5, dur: 0.085 },
    z: { k: 'fric', vl: 0, F: [380, 1700, 2700], ff: 6000, fb: 2600, fa: 0.3, dur: 0.07 },
    sh: { k: 'fric', vl: 1, F: [380, 1850, 2500], ff: 3000, fb: 1700, fa: 0.55, dur: 0.09 },
    zh: { k: 'fric', vl: 0, F: [380, 1850, 2500], ff: 3000, fb: 1700, fa: 0.3, dur: 0.07 },
    f: { k: 'fric', vl: 1, F: [380, 1100, 2400], ff: 7000, fb: 6000, fa: 0.2, dur: 0.075 },
    v: { k: 'fric', vl: 0, F: [380, 1100, 2400], ff: 7000, fb: 6000, fa: 0.1, dur: 0.05 },
    th: { k: 'fric', vl: 1, F: [380, 1450, 2600], ff: 6500, fb: 6000, fa: 0.14, dur: 0.065 },
    dh: { k: 'fric', vl: 0, F: [380, 1450, 2600], ff: 6500, fb: 6000, fa: 0.06, dur: 0.04 },
    h: { k: 'asp', dur: 0.055 },
    ch: { k: 'aff', vl: 1, F: [330, 1850, 2500], ff: 3000, fb: 1700, fa: 0.55 },
    jh: { k: 'aff', vl: 0, F: [330, 1850, 2500], ff: 3000, fb: 1700, fa: 0.3 },
    m: { k: 'nas', F: [270, 1100, 2200], B: [110, 320, 420], av: 0.5, dur: 0.075 },
    n: { k: 'nas', F: [270, 1600, 2600], B: [110, 320, 420], av: 0.5, dur: 0.07 },
    ng: { k: 'nas', F: [270, 2000, 2650], B: [110, 320, 420], av: 0.45, dur: 0.07 },
    l: { k: 'liq', F: [360, 1000, 2800], B: [80, 130, 190], av: 0.8, dur: 0.06 },
    r: { k: 'liq', F: [420, 1150, 1550], B: [80, 120, 160], av: 0.85, dur: 0.065 },
    w: { k: 'liq', F: [300, 650, 2300], B: [80, 110, 160], av: 0.75, dur: 0.06 },
    y: { k: 'liq', F: [280, 2200, 3000], B: [70, 110, 160], av: 0.8, dur: 0.05 }
  };
  const DH_WORDS = new Set(['the', 'this', 'that', 'these', 'those', 'they', 'them', 'their', 'there', 'then', 'than', 'though', 'thus', 'with', 'other', 'mother', 'father', 'brother', 'together', 'breathe', 'smooth', 'without', 'within', 'weather', 'feather', 'either', 'neither', 'rather', 'whether', 'gather', 'further', 'thee', 'thy', 'thine']);
  const SHORT_I = new Set(['city', 'pity', 'river', 'rivers', 'given', 'giving', 'living', 'liver', 'visit', 'minute', 'minutes', 'finish', 'image', 'spirit', 'limit', 'civil', 'timid', 'vivid', 'lily', 'shiver', 'quiver', 'glitter', 'widow', 'window', 'windows', 'livid', 'ticket', 'pillow', 'willow', 'whisper', 'whispers', 'whispered', 'silver', 'sister', 'mirror', 'little', 'bitter', 'misty', 'dizzy', 'busy', 'lyric', 'physics', 'liquid', 'figure', 'digit', 'piano']);
  const VOICED_END = /[bdgvzmnlrw]$|[aeiouy]$/;

  function consonantPhones(str, pos, word, prev) {
    const out = [];
    let i = 0;
    str = str.replace(/(.)\1/g, '$1'); // doubled letters sound once
    while (i < str.length) {
      const c = str[i], c2 = str.slice(i, i + 2), c3 = str.slice(i, i + 3);
      if (c3 === 'tch') { out.push('ch'); i += 3; continue; }
      if (c3 === 'sch') { out.push('s', 'k'); i += 3; continue; }
      if (c2 === 'ch') { out.push('ch'); i += 2; continue; }
      if (c2 === 'sh') { out.push('sh'); i += 2; continue; }
      if (c2 === 'th') { out.push(DH_WORDS.has(word) ? 'dh' : 'th'); i += 2; continue; }
      if (c2 === 'ph') { out.push('f'); i += 2; continue; }
      if (c2 === 'wh') { out.push('w'); i += 2; continue; }
      if (c2 === 'ck') { out.push('k'); i += 2; continue; }
      if (c2 === 'ng') { out.push(pos === 'coda' ? 'ng' : 'n'); if (pos !== 'coda') out.push('g'); i += 2; continue; }
      if (c2 === 'nk') { out.push('ng', 'k'); i += 2; continue; }
      if (c2 === 'gh') { if (pos === 'onset' && i === 0) out.push('g'); i += 2; continue; }
      if (c2 === 'kn' && pos === 'onset' && i === 0) { out.push('n'); i += 2; continue; }
      if (c2 === 'wr' && pos === 'onset' && i === 0) { out.push('r'); i += 2; continue; }
      if (c2 === 'mb' && pos === 'coda' && i + 2 === str.length) { out.push('m'); i += 2; continue; }
      if (c2 === 'qu') { out.push('k', 'w'); i += 2; continue; }
      if (c2 === 'dg') { out.push('jh'); i += 2; continue; }
      switch (c) {
        case 'b': out.push('b'); break;
        case 'c': out.push('k'); break;
        case 'd': out.push('d'); break;
        case 'f': out.push('f'); break;
        case 'g': out.push('g'); break;
        case 'h': if (pos === 'onset') out.push('h'); break;
        case 'j': out.push('jh'); break;
        case 'k': out.push('k'); break;
        case 'l': out.push('l'); break;
        case 'm': out.push('m'); break;
        case 'n': out.push('n'); break;
        case 'p': out.push('p'); break;
        case 'q': out.push('k'); break;
        case 'r': out.push('r'); break;
        case 's': out.push(pos === 'coda' && i === str.length - 1 && i > 0 && VOICED_END.test(prev + str.slice(0, i)) ? 'z' : (pos === 'coda' && i === 0 && str.length === 1 && /[aeiouy]$/.test(prev) && /(e|ie|ee|ou|ay|ey|oe)$/.test(prev) ? 'z' : 's')); break;
        case 't': out.push('t'); break;
        case 'v': out.push('v'); break;
        case 'w': if (pos === 'onset') out.push('w'); break;
        case 'x': out.push('k', 's'); break;
        case 'y': if (pos === 'onset') out.push('y'); break;
        case 'z': out.push('z'); break;
        default: break;
      }
      i++;
    }
    return out;
  }

  // syllable -> { onset: [phones], vowel, coda: [phones] }
  function phonesOf(syl) {
    let text = String(syl.text || '').toLowerCase().replace(/[^a-z]/g, '');
    const word = syl.word || text;
    let vowel = VOW[syl.vowel] ? syl.vowel : 'uh';
    if (!text) return { onset: [], vowel, coda: [] };
    // consonant + "le" endings (lit-tle, peo-ple)
    let m = text.match(/^([^aeiouy]*)([^aeiouy])le$/);
    if (m && m[2] !== 'l' && syl.wordEnd !== false && text.length >= 3 && !/^[^aeiouy]*[aeiouy]/.test(text.slice(0, -2))) {
      return { onset: consonantPhones(m[1] + m[2], 'onset', word, ''), vowel: 'uh', coda: ['l'] };
    }
    // silent final e in a closed syllable (time, home, alone)
    if (syl.wordEnd !== false && /[aeiouy][^aeiouy]+e$/.test(text) && !/^[^aeiouy]*e$/.test(text)) text = text.slice(0, -1);
    m = text.match(/^([^aeiouy]*)([aeiouy]+)([^aeiouy]*)(.*)$/);
    if (!m) return { onset: consonantPhones(text, 'onset', word, ''), vowel, coda: [] };
    // a leading 'y' followed by a vowel is a consonant
    let on = m[1], vl = m[2], coda = m[3] + m[4].replace(/[aeiouy]/g, '');
    if (!on && vl.length > 1 && vl[0] === 'y') { on = 'y'; vl = vl.slice(1); }
    if (vl === 'oo' && /^(k|d|t)/.test(coda) && syl.vowel === 'u') vowel = 'oo'; // book, good, foot
    // qu-: the u is part of the consonant (quick, queen)
    if (/q$/.test(on) && vl[0] === 'u' && vl.length > 1) { on += 'u'; vl = vl.slice(1); vowel = vl === 'i' ? (coda && !/e$/.test(syl.text) ? 'ih' : 'ai') : vl === 'ee' ? 'i' : vl === 'a' ? 'ei' : vowel; }
    if ((/^(to|do|who|into)$/.test(word) || (text === 'to' && syl.wordStart !== false)) && vl === 'o') vowel = 'u';
    if (word === 'of') return { onset: [], vowel: 'uh', coda: ['v'] };
    if (text === 're' && syl.wordStart === false) return { onset: [], vowel: 'er', coda: [] };
    if (/al$/.test(text) && /alk/.test(word)) { vowel = 'aa'; coda = coda.slice(0, -1); }
    if (vl === 'i' && !coda && vowel === 'ai' && SHORT_I.has(word)) vowel = 'ih';
    if (vl === 'i' && /^gh/.test(coda)) vowel = 'ai';
    if (on === 'w' && vl === 'o' && /^r[^aeiouy]/.test(coda) && /^(word|world|work|worth|worse|worst|worm)/.test(word)) { vowel = 'er'; coda = coda.slice(1); }
    if ((vl === 'u' || vl === 'i' || vl === 'ea' || vl === 'o') && /^r/.test(coda) && (vl !== 'ea' || /^r[^aeiouy]/.test(coda)) && !(vl === 'o')) { vowel = vl === 'ea' && /^rt/.test(coda) ? 'aa' : 'er'; if (vowel === 'er') coda = coda.slice(1); }
    if (vl === 'eo') vowel = 'i';
    if (/^(c|w|sh)ould(n't)?$/.test(word) && coda.startsWith('ld')) { vowel = 'oo'; coda = coda.slice(1); }
    if (vl === 'a' && /^lk/.test(coda)) { vowel = 'aa'; coda = coda.slice(1); }
    // soft c before e/i/y
    if (/c$/.test(on) && /^[eiy]/.test(vl)) on = on.slice(0, -1) + 's';
    const ghF = /^(laugh|laughs|laughed|laughing|laughter|cough|rough|tough|enough)$/.test(word) && /^gh/.test(coda);
    if (ghF) { coda = 'f' + coda.slice(2); if (vl === 'au') vowel = 'ae'; }
    let codaPh = consonantPhones(coda, 'coda', word, on + vl);
    if (ghF && /ed$/.test(word) && codaPh[codaPh.length - 1] === 'd') codaPh[codaPh.length - 1] = 't';
    if (vowel === 'er' && codaPh[0] === 'r') codaPh = codaPh.slice(1);
    // "-ed" past tense after voiceless consonants sounds like t
    if (syl.wordEnd !== false && /[^aeiouydt]ed$/.test(word) && /ed$/.test(text) && codaPh[codaPh.length - 1] === 'd' && /[pkfsx]|ch|sh/.test(word.slice(-3, -2))) codaPh[codaPh.length - 1] = 't';
    return { onset: consonantPhones(on, 'onset', word, ''), vowel, coda: codaPh };
  }

  function phoneDur(ph, pos) {
    const c = CON[ph]; if (!c) return 0.05;
    if (c.k === 'stop') return pos === 'coda' ? (c.vl ? 0.06 : 0.05) : (c.vl ? 0.1 : 0.05);
    if (c.k === 'aff') return 0.09;
    return c.dur;
  }

  // ---------- RNG ----------
  function rngOf(seed) {
    let a = (seed >>> 0) || 1;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------- control tracks ----------
  const TRACKS = ['F1', 'F2', 'F3', 'B1', 'B2', 'B3', 'AV', 'AH', 'AF', 'FF', 'FB'];
  function Tracks() { this.d = {}; for (const k of TRACKS) this.d[k] = []; }
  Tracks.prototype.push = function (k, t, v) {
    const a = this.d[k]; const n = a.length;
    if (n && t < a[n - 2]) t = a[n - 2];
    a.push(t, v);
  };
  Tracks.prototype.setF = function (t, F, B) {
    this.push('F1', t, F[0]); this.push('F2', t, F[1]); this.push('F3', t, F[2]);
    B = B || BV; this.push('B1', t, B[0]); this.push('B2', t, B[1]); this.push('B3', t, B[2]);
  };

  // ---------- plan one voice: phones + pitch ----------
  function planVoice(events, o, rng) {
    const tr = new Tracks();
    const notes = [];
    // group events into syllables
    const syls = [];
    for (const e of events) {
      if (!e.legato || !syls.length) syls.push({ T: e.t, E: e.t + e.d, notes: [e], syl: e.syl });
      else { const s = syls[syls.length - 1]; s.notes.push(e); s.E = Math.max(s.E, e.t + e.d); }
    }
    // humanised timing: a singer lands slightly around the beat
    for (const s of syls) {
      const dt = (rng() - 0.5) * 2 * o.timing;
      s.T += dt; s.notes.forEach(n => { n._t = n.t + dt; });
      s.E += dt;
      const ph = phonesOf(s.syl);
      s.on = ph.onset; s.vowel = ph.vowel; s.coda = ph.coda;
      s.onD = s.on.map(p => phoneDur(p, 'onset') * (s.on.length > 1 ? 0.78 : 1));
      s.coD = s.coda.map(p => phoneDur(p, 'coda') * (s.coda.length > 1 ? 0.75 : 0.9));
    }
    // a coda that repeats the next onset is sung once (lit-tle, sum-mer)
    for (let k = 0; k + 1 < syls.length; k++) {
      const s = syls[k], nx = syls[k + 1];
      if (s.coda.length && nx.on.length && s.coda[s.coda.length - 1] === nx.on[0]) { s.coda = s.coda.slice(0, -1); s.coD = s.coD.slice(0, -1); }
    }
    // fit consonants between vowels
    for (let k = 0; k < syls.length; k++) {
      const s = syls[k], nx = syls[k + 1];
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      let end = s.E;
      if (nx) end = Math.min(end, nx.T);
      const len = Math.max(0.03, end - s.T);
      const minV = Math.max(0.05, len * 0.45);
      if (nx) {
        // the next onset must start after this vowel's minimum
        const room = nx.T - (s.T + minV);
        const onSum = sum(nx.onD);
        if (onSum > room * 0.7) { const f = Math.max(0.15, (room * 0.7) / onSum); nx.onD = nx.onD.map(x => x * f); }
        end = Math.min(end, nx.T - sum(nx.onD));
      }
      if (k === 0 || s.T - sum(s.onD) < (syls[k - 1] ? syls[k - 1].vEnd || 0 : -1)) { /* fine */ }
      let coSum = sum(s.coD);
      const avail = end - s.T - minV;
      if (coSum > avail) { const f = Math.max(0.2, avail / Math.max(1e-3, coSum)); s.coD = s.coD.map(x => x * f); coSum = sum(s.coD); }
      s.end = Math.max(s.T + 0.04, end);
      s.vEnd = Math.max(s.T + 0.03, s.end - coSum);
      s.gapAfter = nx ? (nx.T - sum(nx.onD)) - s.end : 9;
    }
    // emit keyframes
    let voicingOn = false, lastEnd = -9;
    const breath = o.breath;
    for (let k = 0; k < syls.length; k++) {
      const s = syls[k], nx = syls[k + 1];
      const vt = VOW[s.vowel] || VOW.uh;
      const V1 = vt[0], V2 = vt[1] || vt[0];
      let c = s.T - s.onD.reduce((x, y) => x + y, 0);
      if (!voicingOn && o.breaths && c - lastEnd > 0.55) {
        // a quiet inhale before the phrase
        const b0 = c - Math.min(0.36, (c - lastEnd) * 0.45), b1 = c - 0.08;
        tr.push('AV', b0, 0); tr.push('AF', b0, 0); tr.push('AH', b0, 0);
        tr.setF(b0, [560, 1500, 2550], [260, 300, 360]);
        tr.push('AH', b0 + (b1 - b0) * 0.65, o.breaths); tr.push('AH', b1, 0);
      }
      if (!voicingOn) {
        tr.push('AV', c - 0.03, 0); tr.push('AH', c - 0.03, 0); tr.push('AF', c - 0.03, 0);
        tr.setF(c - 0.02, s.on.length ? (CON[s.on[0]].F || V1) : V1);
      }
      for (let j = 0; j < s.on.length; j++) { emitCons(tr, s.on[j], c, c + s.onD[j], V1, 'onset', breath, !voicingOn && j === 0); c += s.onD[j]; }
      // vowel
      const a = s.T, b = s.vEnd, L = b - a;
      const attack = (!voicingOn && !s.on.length) ? 0.045 : 0.018;
      tr.push('AF', a + 0.004, 0);
      tr.push('AH', a + 0.01, breath);
      tr.push('AV', a + attack, 0.88);
      tr.setF(a + Math.min(0.04, L * 0.3), V1);
      if (vt[1]) { tr.setF(Math.max(a + Math.min(0.045, L * 0.3), b - Math.max(0.08, L * 0.32)), V1); tr.setF(b, V2); }
      else tr.setF(b, V1);
      // gentle swell on held vowels
      if (L > 0.35) { tr.push('AV', a + L * 0.55, 1.0); }
      tr.push('AV', b, L > 0.35 ? 0.9 : 0.88);
      voicingOn = true;
      c = b;
      for (let j = 0; j < s.coda.length; j++) { emitCons(tr, s.coda[j], c, c + s.coD[j], null, 'coda', breath, false); c += s.coD[j]; }
      // release into silence
      if (!nx || s.gapAfter > 0.07) {
        const rel = Math.min(0.12, Math.max(0.05, (nx ? s.gapAfter : 0.3) * 0.6));
        const endsVoiced = !s.coda.length || ['m', 'n', 'ng', 'l', 'r', 'w', 'y', 'z', 'v', 'dh'].includes(s.coda[s.coda.length - 1]);
        if (endsVoiced) { tr.push('AH', c, breath * 1.6); tr.push('AV', c + rel, 0); tr.push('AH', c + rel * 1.3, 0); }
        else { tr.push('AV', c + 0.01, 0); tr.push('AH', c + 0.02, 0); }
        tr.push('AF', c + rel, 0);
        voicingOn = false; lastEnd = c + rel;
      }
      // pitch notes
      for (let j = 0; j < s.notes.length; j++) {
        const n = s.notes[j];
        notes.push({ t: n._t, d: n.d, m: n.m, start: j === 0 ? s.T - s.onD.reduce((x, y) => x + y, 0) : n._t, phraseStart: false, sylStart: j === 0 });
      }
      if (!nx || s.gapAfter > 0.07) notes[notes.length - 1].phraseEnd = c;
    }
    // phrase starts
    for (let i = 0; i < notes.length; i++) notes[i].phraseStart = i === 0 || !!notes[i - 1].phraseEnd;
    return { tr, notes };
  }

  function emitCons(tr, ph, a, b, nextV, pos, breath, fromSilence) {
    const c = CON[ph]; if (!c) return;
    const L = Math.max(0.01, b - a);
    if (c.k === 'liq' || c.k === 'nas') {
      tr.setF(a + L * 0.35, c.F, c.B); tr.setF(b - L * 0.15, c.F, c.B);
      tr.push('AF', a, 0);
      tr.push('AV', a + (fromSilence ? 0.03 : 0.012), c.av); tr.push('AV', b - 0.006, c.av);
      tr.push('AH', a + 0.01, breath * 0.5);
      return;
    }
    if (c.k === 'asp') {
      const F = nextV || [500, 1500, 2500];
      tr.setF(a + 0.005, F); tr.setF(b, F);
      tr.push('AV', a + 0.012, 0); tr.push('AV', b - 0.004, 0);
      tr.push('AF', a, 0);
      tr.push('AH', a + 0.015, 0.55); tr.push('AH', b - 0.005, 0.5);
      return;
    }
    if (c.k === 'fric') {
      tr.setF(a + L * 0.3, c.F); tr.setF(b - L * 0.1, c.F);
      tr.push('FF', a, c.ff); tr.push('FB', a, c.fb); tr.push('FF', b, c.ff); tr.push('FB', b, c.fb);
      const av = c.vl ? 0 : 0.32;
      tr.push('AV', a + 0.014, av); tr.push('AV', b - 0.012, av);
      tr.push('AH', a + 0.01, c.vl ? 0.04 : breath * 0.4); tr.push('AH', b - 0.01, c.vl ? 0.04 : breath * 0.4);
      tr.push('AF', a + 0.004, 0); tr.push('AF', a + Math.min(0.025, L * 0.35), c.fa); tr.push('AF', b - Math.min(0.015, L * 0.2), c.fa * 0.9); tr.push('AF', b, 0);
      return;
    }
    // stops and affricates
    const aff = c.k === 'aff';
    const cl = aff ? L * 0.35 : (pos === 'coda' ? L * 0.7 : (c.vl ? L * 0.48 : L * 0.72));
    const bu = aff ? L * 0.65 : Math.min(0.014, L * 0.16);
    const rel = a + cl;
    tr.setF(a + Math.min(0.02, cl * 0.5), c.F, [90, 140, 200]); tr.setF(rel + (aff ? bu * 0.3 : bu), c.F, [90, 140, 200]);
    tr.push('FF', a, c.bf || c.ff); tr.push('FB', a, c.bb || c.fb);
    tr.push('FF', rel + bu, c.bf || c.ff); tr.push('FB', rel + bu, c.bb || c.fb);
    const bar = c.vl ? 0 : 0.14;
    tr.push('AV', a + 0.01, bar); tr.push('AV', rel, bar);
    tr.push('AH', a + 0.008, 0); tr.push('AH', rel, 0);
    tr.push('AF', rel - 0.001, 0);
    if (aff) { tr.push('AF', rel + 0.012, c.fa); tr.push('AF', b - 0.012, c.fa * 0.8); tr.push('AF', b, 0); tr.push('AV', b - 0.01, c.vl ? 0 : 0.3); }
    else {
      const amp = (c.ba || 0.4) * (pos === 'coda' ? 0.55 : 1);
      tr.push('AF', rel + 0.001, amp); tr.push('AF', rel + bu, amp * 0.35); tr.push('AF', rel + bu + 0.006, 0);
      if (c.vl && pos === 'onset') { tr.push('AH', rel + bu * 0.5, 0.45); tr.push('AH', b - 0.004, 0.32); tr.push('AV', b - 0.004, 0); }
      else if (!c.vl) { tr.push('AV', rel + bu, 0.35); }
    }
  }

  // ---------- pitch contour (MIDI, control rate) ----------
  function pitchCurve(notes, o, rng, CR, nFrames) {
    const p = new Float32Array(nFrames);
    const vib = new Float32Array(nFrames); // vibrato depth (semitones)
    const rate = new Float32Array(nFrames);
    p.fill(-1);
    const fi = (t) => Math.max(0, Math.min(nFrames - 1, Math.round(t * CR)));
    const ss = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i], nx = notes[i + 1];
      const a = fi(n.start - 0.01);
      const endT = nx && !n.phraseEnd ? nx.t : (n.phraseEnd !== undefined ? n.phraseEnd + 0.15 : n.t + n.d + 0.15);
      const b = fi(endT);
      for (let k = a; k <= b; k++) p[k] = n.m;
      // onset scoop at the start of a phrase or after a breath
      if (n.phraseStart) {
        const s0 = n.t - 0.03, dur = 0.07 + rng() * 0.05, depth = 0.5 + rng() * 0.6;
        for (let k = a; k <= fi(s0 + dur); k++) { const x = (k / CR - s0) / dur; p[k] = n.m - depth * (1 - ss(x)); }
      }
      // fall-off at the end of a phrase
      if (n.phraseEnd !== undefined) {
        const s0 = n.phraseEnd - 0.03;
        for (let k = fi(s0); k <= b; k++) { const x = (k / CR - s0) / 0.14; p[k] = n.m - 0.9 * ss(x); }
      }
      // portamento into the next note
      if (nx && !n.phraseEnd) {
        const iv = Math.abs(nx.m - n.m);
        const gl = Math.min(0.13, 0.035 + iv * 0.011, nx.d * 0.45 + 0.02);
        const g0 = nx.t - gl * 0.4;
        const over = (rng() < 0.5 ? 0.12 : 0) * Math.sign(nx.m - n.m);
        for (let k = fi(g0); k <= fi(g0 + gl); k++) { const x = (k / CR - g0) / gl; p[k] = n.m + (nx.m - n.m + over * Math.sin(Math.PI * x)) * ss(x); }
      }
      // vibrato: delayed onset, grows through long notes
      const len = (nx && !n.phraseEnd ? nx.t : n.t + n.d) - n.t;
      const r = o.vibRate * (0.92 + rng() * 0.16);
      if (len > 0.28) {
        const v0 = n.t + Math.min(0.3, 0.12 + len * 0.15), v1 = n.t + Math.min(0.75, len * 0.7);
        const dep = o.vibDepth * (0.75 + rng() * 0.5) * (len > 0.8 ? 1 : 0.7);
        for (let k = fi(v0); k <= fi(n.t + len); k++) { const t = k / CR; vib[k] = dep * ss((t - v0) / Math.max(0.05, v1 - v0)); rate[k] = r; }
      }
      for (let k = a; k <= b; k++) if (!rate[k]) rate[k] = r;
    }
    // fill gaps by holding
    let last = notes.length ? notes[0].m : 60;
    for (let k = 0; k < nFrames; k++) { if (p[k] < 0) p[k] = last; else last = p[k]; if (!rate[k]) rate[k] = o.vibRate; }
    return { p, vib, rate };
  }

  // ---------- render one voice ----------
  function interpTrack(arr, CR, nFrames, def) {
    const out = new Float32Array(nFrames);
    if (!arr.length) { out.fill(def); return out; }
    let j = 0;
    for (let k = 0; k < nFrames; k++) {
      const t = k / CR;
      while (j + 2 < arr.length && arr[j + 2] <= t) j += 2;
      if (t <= arr[0]) out[k] = arr[1];
      else if (j + 2 >= arr.length) out[k] = arr[arr.length - 1];
      else { const t0 = arr[j], t1 = arr[j + 2]; const x = t1 > t0 ? (t - t0) / (t1 - t0) : 1; out[k] = arr[j + 1] + (arr[j + 3] - arr[j + 1]) * x; }
    }
    return out;
  }

  function renderVoice(events, o, seed, outL, outR, gain, pan, sr) {
    if (!events.length) return;
    const rng = rngOf(seed);
    const { tr, notes } = planVoice(events, o, rng);
    const BLOCK = 32, CR = sr / BLOCK;
    const firstT = Math.max(0, notes[0].start - 0.5);
    const lastT = notes[notes.length - 1].t + notes[notes.length - 1].d + 0.6;
    const nFrames = Math.ceil(lastT * CR) + 2;
    const pc = pitchCurve(notes, o, rng, CR, nFrames);
    const T = {};
    const defs = { F1: 500, F2: 1500, F3: 2500, B1: 70, B2: 95, B3: 140, AV: 0, AH: 0, AF: 0, FF: 4000, FB: 2000 };
    for (const k of TRACKS) T[k] = interpTrack(tr.d[k], CR, nFrames, defs[k]);
    const fs = o.formantShift, F4 = 3350 * Math.min(fs, 1.12), F5 = 3900 * Math.min(fs, 1.1);
    const gl = pan <= 0 ? 1 : 1 - pan, gr = pan >= 0 ? 1 : 1 + pan;
    const gL = gain * Math.sqrt(gl), gR = gain * Math.sqrt(gr);
    // resonator states
    let r1a = 0, r1b = 0, r2a = 0, r2b = 0, r3a = 0, r3b = 0, r4a = 0, r4b = 0, r5a = 0, r5b = 0;
    let fx1 = 0, fx2 = 0, fy1 = 0, fy2 = 0, hpX = 0, hpY = 0, tilt = 0, dcX = 0, dcY = 0;
    let phase = 0, gPrev = 0, period = 1, shim = 1, jit = 1, oq = o.oq;
    let noise = (seed * 2654435761) >>> 0 || 7, noise2 = (seed * 40503 + 99) >>> 0 || 11;
    const rnd = () => { noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5; return ((noise >>> 0) / 4294967296) * 2 - 1; };
    const rnd2 = () => { noise2 ^= noise2 << 13; noise2 ^= noise2 >>> 17; noise2 ^= noise2 << 5; return ((noise2 >>> 0) / 4294967296) * 2 - 1; };
    // slow drift
    const dph = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
    let vibPh = rng() * 6.28;
    const tiltA = 1 - Math.exp(-2 * Math.PI * o.tiltHz / sr);
    const coef = (F, B) => { const r = Math.exp(-Math.PI * B / sr); const C = -r * r; const Bc = 2 * r * Math.cos(2 * Math.PI * F / sr); return [1 - Bc - C, Bc, C]; };
    const c4 = coef(F4, 250), c5 = coef(F5, 300);
    let k1 = [1, 0, 0], k2 = k1, k3 = k1;
    let fb0 = 0, fb1 = 0, fb2 = 0, fa1 = 0, fa2 = 0;
    const startS = Math.floor(firstT * sr), endS = Math.min(outL.length, Math.floor(lastT * sr));
    let av = 0, ah = 0, af = 0, f0 = 120, dAV = 0, dAH = 0, dAF = 0, df0 = 0;
    for (let s0 = startS - (startS % BLOCK); s0 < endS; s0 += BLOCK) {
      const k = Math.min(nFrames - 1, Math.floor(s0 / BLOCK));
      const t = s0 / sr;
      // skip silent stretches once the tract has rung out
      if (T.AV[k] < 1e-4 && T.AH[k] < 1e-4 && T.AF[k] < 1e-4 && av < 1e-4 && ah < 1e-4 && af < 1e-4 &&
          Math.abs(r5a) + Math.abs(r5b) + Math.abs(r1a) + Math.abs(dcY) < 1e-5) {
        r1a = r1b = r2a = r2b = r3a = r3b = r4a = r4b = r5a = r5b = 0; dcX = dcY = 0; tilt = 0; av = ah = af = 0;
        vibPh += 2 * Math.PI * pc.rate[k] * BLOCK / sr;
        continue;
      }
      // pitch with vibrato and drift
      vibPh += 2 * Math.PI * pc.rate[k] * BLOCK / sr;
      const drift = o.drift * (Math.sin(t * 0.73 * 6.28 + dph[0]) * 0.5 + Math.sin(t * 1.37 * 6.28 + dph[1]) * 0.3 + Math.sin(t * 2.9 * 6.28 + dph[2]) * 0.2);
      const midi = pc.p[k] + pc.vib[k] * Math.sin(vibPh) + drift;
      const f0t = 440 * Math.pow(2, (midi - 69) / 12);
      // formants (scaled for the voice, F1 kept above the pitch for high notes)
      let F1 = T.F1[k] * fs, F2 = T.F2[k] * fs, F3 = T.F3[k] * fs;
      if (F1 < f0t * 1.12) F1 = f0t * 1.12;
      if (F2 < F1 + 250) F2 = F1 + 250;
      k1 = coef(F1, T.B1[k] + f0t * 0.14); k2 = coef(F2, T.B2[k] + f0t * 0.08); k3 = coef(F3, T.B3[k] + f0t * 0.05);
      // frication band-pass (RBJ, 0 dB peak)
      const ff = Math.min(sr * 0.45, T.FF[k] * (0.85 + 0.15 * fs)), Q = Math.max(0.5, ff / Math.max(200, T.FB[k]));
      const w0 = 2 * Math.PI * ff / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
      fb0 = al / a0; fb1 = 0; fb2 = -al / a0; fa1 = -2 * Math.cos(w0) / a0; fa2 = (1 - al) / a0;
      // smooth amplitude ramps across the block
      dAV = (T.AV[k] - av) / BLOCK; dAH = (T.AH[k] - ah) / BLOCK; dAF = (T.AF[k] - af) / BLOCK; df0 = (f0t - f0) / BLOCK;
      const e = Math.min(endS, s0 + BLOCK);
      for (let s = Math.max(s0, startS); s < e; s++) {
        av += dAV; ah += dAH; af += dAF; f0 += df0;
        // glottal source
        const dx = (f0 * jit) / sr;
        phase += dx;
        if (phase >= 1) {
          phase -= 1;
          jit = 1 + (rng() - 0.5) * 2 * o.jitter;
          shim = 1 + (rng() - 0.5) * 2 * o.shimmer;
          oq = o.oq + (rng() - 0.5) * 0.03;
        }
        const tp = oq * 0.68, tn = oq * 0.32, ta = o.ta;
        const x = phase;
        let g;
        if (x < tp) g = 0.5 * (1 - Math.cos(Math.PI * x / tp));
        else if (x < tp + tn) g = Math.cos(0.5 * Math.PI * (x - tp) / tn);
        else g = 0;
        // flow derivative; after closure an exponential return phase (LF model) instead of a hard
        // stop, which keeps the source band-limited and less buzzy
        const xc = tp + tn;
        let d;
        if (x < xc) d = x < tp ? 0.5 * Math.PI / tp * Math.sin(Math.PI * x / tp) : -0.5 * Math.PI / tn * Math.sin(0.5 * Math.PI * (x - tp) / tn);
        else d = -0.5 * Math.PI / tn * Math.exp(-(x - xc) / ta);
        gPrev = g;
        let src = d * 0.06 * av * shim;
        tilt += tiltA * (src - tilt); src = tilt;
        // breath noise, pulsed with the glottal flow while voicing
        const n1 = rnd();
        src += n1 * ah * 0.35 * (av > 0.05 ? (0.35 + 0.65 * g) : 1);
        // cascade vocal tract
        let y = k1[0] * src + k1[1] * r1a + k1[2] * r1b; r1b = r1a; r1a = y;
        y = k2[0] * y + k2[1] * r2a + k2[2] * r2b; r2b = r2a; r2a = y;
        y = k3[0] * y + k3[1] * r3a + k3[2] * r3b; r3b = r3a; r3a = y;
        y = c4[0] * y + c4[1] * r4a + c4[2] * r4b; r4b = r4a; r4a = y;
        y = c5[0] * y + c5[1] * r5a + c5[2] * r5b; r5b = r5a; r5a = y;
        // frication branch
        if (af > 1e-4) {
          const n2 = rnd2();
          const hp = n2 - hpX + 0.9 * hpY; hpX = n2; hpY = hp;
          const fy = fb0 * hp + fb2 * fx2 - fa1 * fy1 - fa2 * fy2; fx2 = fx1; fx1 = hp; fy2 = fy1; fy1 = fy;
          y += fy * af * o.consGain;
        } else { fy1 *= 0.9; fy2 *= 0.9; }
        // DC block
        const dc = y - dcX + 0.995 * dcY; dcX = y; dcY = dc;
        outL[s] += dc * gL; outR[s] += dc * gR;
      }
    }
  }

  // ---------- harmony ----------
  function harmonyEvents(events, song) {
    const steps = (song.scaleSteps || [0, 2, 4, 5, 7, 9, 11]);
    const root = song.root || 0;
    const barSec = song.barSec || 2;
    return events.map(e => {
      const lift = e.final && song.lift ? song.lift : 0;
      const chord = song.chords && song.chords[Math.floor(e.t / barSec)];
      const pcs = chord ? chord.pcs.map(p => (p + lift) % 12) : null;
      const inScale = (m) => steps.includes(((m - root - lift) % 12 + 12) % 12);
      let h = null;
      for (const iv of [3, 4]) if (pcs && pcs.includes((e.m + iv) % 12)) { h = e.m + iv; break; }
      if (h === null) for (const iv of [3, 4]) if (inScale(e.m + iv)) { h = e.m + iv; break; }
      if (h === null) h = e.m + 3;
      return Object.assign({}, e, { m: h });
    });
  }

  // gentle stereo-linked leveller, like a singer riding their own volume (3:1 above the median level)
  function level(L, R, sr) {
    const n = L.length, W = Math.max(1, Math.round(sr * 0.005));
    const nb = Math.ceil(n / W), env = new Float32Array(nb);
    for (let b = 0; b < nb; b++) { let s = 0; const e = Math.min(n, (b + 1) * W); for (let i = b * W; i < e; i++) s += L[i] * L[i] + R[i] * R[i]; env[b] = Math.sqrt(s / (2 * (e - b * W))); }
    const act = []; for (let b = 0; b < nb; b++) if (env[b] > 1e-4) act.push(env[b]);
    if (!act.length) return;
    act.sort((a, b) => a - b);
    const thr = act[Math.floor(act.length * 0.6)];
    const att = Math.exp(-1 / 2), rel = Math.exp(-1 / 16); // ~10 ms attack, ~80 ms release in 5 ms steps
    let e = 0; const gains = new Float32Array(nb + 1);
    for (let b = 0; b < nb; b++) { const x = env[b]; e = x > e ? att * e + (1 - att) * x : rel * e + (1 - rel) * x; gains[b] = e > thr ? Math.pow(thr / e, 2 / 3) : 1; }
    gains[nb] = gains[nb - 1];
    for (let b = 0; b < nb; b++) { const g0 = gains[b], g1 = gains[b + 1]; const e2 = Math.min(n, (b + 1) * W); for (let i = b * W; i < e2; i++) { const g = g0 + (g1 - g0) * ((i - b * W) / W); L[i] *= g; R[i] *= g; } }
  }

  // ---------- public: render the whole vocal track ----------
  // events: [{t,d,m,syl,legato,sec}], opts: {sr, formantShift, breathiness, style, seed, durationSec, song:{root, scaleSteps, chords, barSec, lift}}
  function renderVocalTrack(events, opts) {
    opts = opts || {};
    const sr = opts.sr || 24000;
    const dur = opts.durationSec || (events.length ? events[events.length - 1].t + events[events.length - 1].d + 1 : 1);
    const n = Math.ceil(dur * sr);
    const L = new Float32Array(n), R = new Float32Array(n);
    if (!events.length) return { sr, L, R, durationSec: dur };
    const fs = opts.formantShift || 1;
    const female = fs > 1.05;
    const base = {
      formantShift: fs,
      breath: opts.breathiness !== undefined ? opts.breathiness * 0.55 : 0.08,
      oq: female ? 0.68 : 0.6,
      tiltHz: female ? 5500 : 6000, ta: female ? 0.022 : 0.014,
      jitter: 0.006, shimmer: 0.05,
      consGain: opts.consGain || 1.2, vibRate: 5.4, vibDepth: 0.32, drift: 0.07, timing: 0.012, breaths: 0.16
    };
    const seed = (opts.seed >>> 0) || 1;
    const style = opts.style || 'harmony';
    renderVoice(events, base, seed, L, R, 1, 0, sr);
    const big = events.filter(e => e.sec === 'chorus' || e.sec === 'outro');
    const dbl = Object.assign({}, base, { breaths: 0, timing: 0.022, drift: 0.1, vibDepth: 0.26, jitter: 0.008, breath: base.breath * 1.3 });
    if (style === 'double') {
      renderVoice(events, dbl, seed + 101, L, R, 0.42, -0.55, sr);
      renderVoice(events, dbl, seed + 202, L, R, 0.42, 0.55, sr);
    } else if (style === 'harmony' && big.length) {
      renderVoice(big, dbl, seed + 101, L, R, 0.4, 0.5, sr);
      const harm = harmonyEvents(big, opts.song || {});
      renderVoice(harm, Object.assign({}, dbl, { timing: 0.016 }), seed + 303, L, R, 0.34, -0.5, sr);
    }
    level(L, R, sr);
    // normalise to a consistent level
    let peak = 0, sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(L[i]) > Math.abs(R[i]) ? Math.abs(L[i]) : Math.abs(R[i]); if (a > peak) peak = a; if (a > 1e-3) { sum += L[i] * L[i] + R[i] * R[i]; cnt += 2; } }
    const rms = cnt ? Math.sqrt(sum / cnt) : 0;
    let g = rms > 0 ? 0.13 / rms : 1;
    if (peak * g > 0.95) g = 0.95 / peak;
    if (!isFinite(g)) g = 1;
    for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
    return { sr, L, R, durationSec: dur, peak: peak * g, rms: rms * g };
  }

  const api = { renderVocalTrack, phonesOf, consonantPhones, harmonyEvents, VOW, CON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SongVoice = api;
})(typeof self !== 'undefined' ? self : this);
