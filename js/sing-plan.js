/* Song Studio — turns lyric/melody events into control tracks for the neural singer
   (Kokoro-82M, a free Apache-2.0 voice model). For each sung phrase it builds the phoneme
   tokens, a duration (in 25 ms frames) for every phoneme so each vowel lands on its note,
   and a pitch curve (12.5 ms steps) that follows the melody with natural slides and vibrato. */
(function (root) {
  'use strict';
  const FRAME = 0.025;             // one duration frame = 600 samples @ 24 kHz
  const SR = 24000, HOP = 600;
  const VOCAB = {"$":0,";":1,":":2,",":3,".":4,"!":5,"?":6,"—":9,"…":10,"\"":11,"(":12,")":13,"“":14,"”":15," ":16,"\u0303":17,"ʣ":18,"ʥ":19,"ʦ":20,"ʨ":21,"ᵝ":22,"ꭧ":23,"A":24,"I":25,"O":31,"Q":33,"S":35,"T":36,"W":39,"Y":41,"ᵊ":42,"a":43,"b":44,"c":45,"d":46,"e":47,"f":48,"h":50,"i":51,"j":52,"k":53,"l":54,"m":55,"n":56,"o":57,"p":58,"q":59,"r":60,"s":61,"t":62,"u":63,"v":64,"w":65,"x":66,"y":67,"z":68,"ɑ":69,"ɐ":70,"ɒ":71,"æ":72,"β":75,"ɔ":76,"ɕ":77,"ç":78,"ɖ":80,"ð":81,"ʤ":82,"ə":83,"ɚ":85,"ɛ":86,"ɜ":87,"ɟ":90,"ɡ":92,"ɥ":99,"ɨ":101,"ɪ":102,"ʝ":103,"ɯ":110,"ɰ":111,"ŋ":112,"ɳ":113,"ɲ":114,"ɴ":115,"ø":116,"ɸ":118,"θ":119,"œ":120,"ɹ":123,"ɾ":125,"ɻ":126,"ʁ":128,"ɽ":129,"ʂ":130,"ʃ":131,"ʈ":132,"ʧ":133,"ʊ":135,"ʋ":136,"ʌ":138,"ɣ":139,"ɤ":140,"χ":142,"ʎ":143,"ʒ":147,"ʔ":148,"ˈ":156,"ˌ":157,"ː":158,"ʰ":162,"ʲ":164,"↓":169,"→":171,"↗":172,"↘":173,"ᵻ":177};
  const VOWELS = new Set('aeiouyæɑɐɒɔəɚɛɜɝɪʊʌᵻɨøœɯɤɵʉɘᵊAIOQWY'.split(''));
  const DIPH = new Set(['aɪ', 'aʊ', 'eɪ', 'oʊ', 'ɔɪ', 'əʊ', 'eə', 'ɪə', 'ʊə', 'ɛə', 'iə', 'ɑɪ', 'oɪ', 'ɐʊ']);
  const UNVOICED = new Set('ptkfsʃθhçχʧʔxcq'.split(''));
  const STRESS = new Set(['ˈ', 'ˌ']);
  // typical consonant lengths in frames (25 ms) when there is room
  const CDUR = { p: 3, t: 3, k: 3, b: 2, d: 2, 'ɡ': 2, s: 4, 'ʃ': 4, f: 3, 'θ': 3, h: 2, z: 3, v: 2, 'ð': 2, 'ʒ': 3,
    m: 3, n: 3, 'ŋ': 3, l: 3, 'ɹ': 2, w: 2, j: 2, 'ʧ': 4, 'ʤ': 3, 'ɾ': 1, 'ʔ': 1 };

  function cleanIPA(s) {
    s = String(s || '').replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l')
      .replace(/tʃ/g, 'ʧ').replace(/dʒ/g, 'ʤ').replace(/ɝ/g, 'ɜɹ').replace(/[\s.,!?;:]+/g, '');
    let o = ''; for (const ch of s) if (VOCAB[ch] !== undefined && ch !== '$') o += ch;
    return o;
  }

  // split one word's IPA into syllables {on:[], nu:[], co:[]}
  function syllables(ipa) {
    const ch = Array.from(cleanIPA(ipa));
    const units = []; // {v:bool, s:string}
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (VOWELS.has(c)) {
        let nu = c;
        if (i + 1 < ch.length && DIPH.has(c + ch[i + 1])) { nu += ch[i + 1]; i++; }
        while (i + 1 < ch.length && (ch[i + 1] === 'ː' || ch[i + 1] === '\u0303')) { nu += ch[i + 1]; i++; }
        units.push({ v: true, s: nu });
      } else units.push({ v: false, s: c });
    }
    const nucIdx = units.map((u, i) => u.v ? i : -1).filter(i => i >= 0);
    if (!nucIdx.length) return ch.length ? [{ on: [], nu: ['ə'], co: ch }] : [];
    const out = nucIdx.map(i => ({ on: [], nu: Array.from(units[i].s), co: [] }));
    for (let i = 0; i < nucIdx[0]; i++) out[0].on.push(units[i].s);
    for (let k = 0; k < nucIdx.length; k++) {
      const a = nucIdx[k], b = k + 1 < nucIdx.length ? nucIdx[k + 1] : units.length;
      const cl = units.slice(a + 1, b).map(u => u.s);
      if (k + 1 === nucIdx.length) { out[k].co.push(...cl); break; }
      let cut;
      const st = cl.findIndex(c => STRESS.has(c));
      if (st >= 0) cut = st;
      else if (cl.length <= 1) cut = 0;
      else cut = 1;
      out[k].co.push(...cl.slice(0, cut));
      out[k + 1].on.push(...cl.slice(cut));
    }
    return out;
  }

  // ---- group the app's note events into phrases of words with their notes ----
  function groupEvents(events) {
    const byKey = new Map();
    for (const e of events) {
      const k = e.phrase != null ? String(e.phrase) : 'p' + Math.round(e.t);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }
    const phrases = [];
    for (const [key, evs] of byKey) {
      evs.sort((a, b) => a.t - b.t);
      const words = String(evs[0].line || '').split(/\s+/).filter(Boolean).map(w => ({ raw: w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z'-]/g, ''), notes: [] }));
      if (!words.length) {
        // no line text: rebuild from syllables
        for (const e of evs) if (!e.legato && e.syl && e.syl.wordStart) words.push({ raw: e.syl.raw || e.syl.word, notes: [] });
      }
      for (const e of evs) {
        const s = e.syl || {};
        const wi = s.wi != null ? s.wi : 0;
        const we = s.wiEnd != null ? s.wiEnd : wi;
        const n = { t: e.t, d: e.d, m: e.m };
        if (we > wi && !e.legato) {
          const parts = we - wi + 1, pd = e.d / parts;
          for (let j = 0; j < parts; j++) if (words[wi + j]) words[wi + j].notes.push({ t: e.t + j * pd, d: pd * 0.97, m: e.m });
        } else if (words[wi]) words[wi].notes.push(n);
      }
      const ws = words.filter(w => w.notes.length && w.raw);
      if (ws.length) phrases.push({ key, sec: evs[0].sec, words: ws, t: evs[0].t });
    }
    phrases.sort((a, b) => a.t - b.t);
    return phrases;
  }

  // assign IPA syllables to a word's notes
  function sylNotes(sy, notes) {
    const K = sy.length; let M = notes.length;
    notes = notes.slice();
    while (M < K) { // split the longest note
      let li = 0; for (let i = 1; i < M; i++) if (notes[i].d > notes[li].d) li = i;
      const n = notes[li], h = n.d / 2;
      notes.splice(li, 1, { t: n.t, d: h, m: n.m }, { t: n.t + h, d: h, m: n.m }); M++;
    }
    const out = [];
    for (let j = 0; j < K; j++) {
      const a = Math.floor(j * M / K), b = Math.floor((j + 1) * M / K);
      out.push({ syl: sy[j], notes: notes.slice(a, Math.max(a + 1, b)) });
    }
    return out;
  }

  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* Build model inputs for one phrase. ipaOf(word) -> IPA string.
     Returns chunks [{start (sec, absolute), ids, dur (frames), f0 (Float32Array, 2 per frame)}] */
  function planPhrase(phrase, ipaOf, opts) {
    opts = opts || {};
    const rng = mulberry(opts.seed || 1);
    const shift = opts.semitones || 0;
    // flatten to syllables
    const syls = [];
    for (const w of phrase.words) {
      const sy = syllables(ipaOf(w.raw));
      if (!sy.length) continue;
      sylNotes(sy, w.notes).forEach((x, j) => syls.push({ on: x.syl.on, nu: x.syl.nu, co: x.syl.co, notes: x.notes, wordStart: j === 0, wordEnd: j === sy.length - 1 }));
    }
    if (!syls.length) return [];
    // split into chunks at long rests
    // (also keep each chunk well inside the model's 512-token / ~20 s window)
    const tok = (x) => x.on.length + x.nu.length + x.co.length + 3;
    const chunks = []; let cur = [syls[0]], curTok = tok(syls[0]);
    for (let i = 1; i < syls.length; i++) {
      const p = cur[cur.length - 1], pe = p.notes[p.notes.length - 1];
      const gap = syls[i].notes[0].t - (pe.t + pe.d);
      const len = syls[i].notes[0].t - cur[0].notes[0].t;
      if ((gap > 0.6 || curTok > 300 || len > 16) && (syls[i].wordStart || curTok > 420)) { chunks.push(cur); cur = []; curTok = 0; }
      cur.push(syls[i]); curTok += tok(syls[i]);
    }
    chunks.push(cur);
    return chunks.map((c, ci) => buildChunk(c, rng, shift, opts, ci === chunks.length - 1));
  }

  function cd(c) { return (CDUR[c] || 2) * FRAME; }

  function buildChunk(syls, rng, shift, opts, lastChunk) {
    // per syllable timing (absolute seconds)
    const S = syls.map(s => {
      const n0 = s.notes[0], nl = s.notes[s.notes.length - 1];
      return { s, start: n0.t, end: nl.t + nl.d,
        onD: s.on.map(c => STRESS.has(c) ? FRAME : cd(c)), coD: s.co.map(c => STRESS.has(c) ? FRAME : cd(c) * 1.15) };
    });
    // squeeze consonants that don't fit
    for (let k = 0; k < S.length; k++) {
      const x = S[k], nxt = S[k + 1];
      const room = (nxt ? nxt.start : x.end + 0.3) - x.start;
      const onNext = nxt ? nxt.onD.reduce((a, b) => a + b, 0) : 0;
      let co = x.coD.reduce((a, b) => a + b, 0);
      const minV = Math.min(0.1, room * 0.35);
      const over = co + onNext + minV - room;
      if (over > 0) {
        const tot = co + onNext;
        const f = Math.max(0.2, (tot - over) / Math.max(1e-6, tot));
        x.coD = x.coD.map(d => Math.max(FRAME, d * f));
        if (nxt) nxt.onD = nxt.onD.map(d => Math.max(FRAME, d * f));
      }
    }
    const first = S[0];
    const onset0 = first.onD.reduce((a, b) => a + b, 0);
    const start = first.start - onset0 - 0.2;
    const toks = []; // {c, t0, t1}
    const push = (c, t0, t1) => toks.push({ c, t0, t1 });
    push('$', start, first.start - onset0);
    for (let k = 0; k < S.length; k++) {
      const x = S[k], nxt = S[k + 1];
      // onset before the beat
      let t = x.start - x.onD.reduce((a, b) => a + b, 0);
      x.s.on.forEach((c, i) => { push(c, t, t + x.onD[i]); t += x.onD[i]; });
      const coTot = x.coD.reduce((a, b) => a + b, 0);
      const nextOn = nxt ? nxt.start - nxt.onD.reduce((a, b) => a + b, 0) : x.end + coTot;
      const wordGap = nxt && x.s.wordEnd ? 1 : 0;
      let vEnd = nextOn - coTot - wordGap * FRAME;
      let pause = 0;
      if (nxt && x.s.wordEnd && nextOn - (x.end + coTot) > 0.22) { vEnd = Math.max(x.end, x.start + 0.08); pause = 1; }
      if (!nxt) vEnd = x.end - (lastChunk ? 0 : 0);
      vEnd = Math.max(vEnd, x.start + FRAME * 2);
      // nucleus: diphthongs hold the first vowel, glide late
      const nu = x.s.nu, vLen = vEnd - x.start;
      if (nu.length === 1) push(nu[0], x.start, vEnd);
      else {
        // tail = glide vowel(s) + length marks; length marks get one frame
        const rest = nu.slice(1);
        const glides = rest.filter(c => c !== 'ː' && c !== '\u0303').length;
        const marks = rest.length - glides;
        const tail = Math.min(vLen * 0.45, (glides ? Math.min(0.14, vLen * 0.3) : 0) + marks * FRAME);
        let a = vEnd - tail;
        push(nu[0], x.start, a);
        const unit = tail / Math.max(1e-6, glides * 4 + marks);
        for (const c of rest) { const l = (c === 'ː' || c === '\u0303') ? unit : unit * 4; push(c, a, a + l); a += l; }
      }
      t = vEnd;
      x.s.co.forEach((c, i) => { push(c, t, t + x.coD[i]); t += x.coD[i]; });
      if (pause) { push(',', t, nextOn - FRAME); push(' ', nextOn - FRAME, nextOn); }
      else if (wordGap) { push(' ', t, Math.max(t + FRAME * 0.5, nextOn)); }
    }
    const endT = toks[toks.length - 1].t1;
    push('$', endT, endT + 0.1);
    // quantise to frames, every token at least 1 frame
    const ids = [], dur = [];
    let prevB = 0;
    const kinds = [];
    for (const tk of toks) {
      let b = Math.round((tk.t1 - start) / FRAME);
      if (b < prevB + 1) b = prevB + 1;
      ids.push(VOCAB[tk.c]); dur.push(b - prevB); kinds.push(tk.c); prevB = b;
    }
    const frames = prevB;
    // ---- pitch curve ----
    const notes = []; S.forEach(x => x.s.notes.forEach((n, j) => notes.push({ t: n.t, d: n.d, m: n.m + shift, sylStart: j === 0 })));
    const F = frames * 2, f0 = new Float32Array(F);
    const vibRate = 5.0 + rng() * 0.9, vibDepth = (opts.vibrato != null ? opts.vibrato : 1) * (0.28 + rng() * 0.12);
    let drift = 0, driftV = 0;
    const tokAt = new Array(F); { let fi = 0; for (let i = 0; i < ids.length; i++) for (let k = 0; k < dur[i] * 2; k++) tokAt[fi++] = kinds[i]; }
    let ni = 0;
    for (let i = 0; i < F; i++) {
      const tt = start + (i + 0.5) * FRAME / 2;
      while (ni + 1 < notes.length && notes[ni + 1].t <= tt + 0.015) ni++;
      const n = notes[ni];
      let m = n.m;
      const prev = notes[ni - 1];
      const since = tt - n.t;
      if (prev && since < 0.09) {           // glide into the note
        const g = Math.max(0, Math.min(1, (since + 0.02) / 0.11));
        const e = g * g * (3 - 2 * g);
        m = prev.m + (n.m - prev.m) * e;
      } else if (!prev && since < 0.12) {   // gentle scoop at phrase start
        m = n.m - 0.7 * (1 - Math.max(0, since) / 0.12);
      }
      // vibrato on held notes
      const nd = (notes[ni + 1] ? Math.min(notes[ni + 1].t, n.t + n.d) : n.t + n.d) - n.t;
      if (nd > 0.38 && since > 0.18) {
        const ramp = Math.min(1, (since - 0.18) / 0.3);
        m += vibDepth * ramp * Math.sin(2 * Math.PI * vibRate * (since - 0.18));
      }
      // slow pitch wander (a few cents)
      driftV += (rng() - 0.5) * 0.02 - drift * 0.02; drift += driftV * 0.1;
      m += Math.max(-0.08, Math.min(0.08, drift));
      // phrase end: soft fall on the very last note
      if (!notes[ni + 1] && lastChunk && tt > n.t + n.d - 0.12 && n.d > 0.3) m -= 0.8 * Math.min(1, (tt - (n.t + n.d - 0.12)) / 0.12);
      const c = tokAt[i];
      f0[i] = (c === '$' || c === ',' || UNVOICED.has(c)) ? 0 : 440 * Math.pow(2, (m - 69) / 12);
    }
    return { start, ids, dur, f0, frames };
  }

  const api = { FRAME, SR, HOP, VOCAB, cleanIPA, syllables, groupEvents, planPhrase, sylNotes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SingPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
