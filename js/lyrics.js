/* Song Studio — lyric writer, syllabifier and syllable-to-melody mapper. Pure JS. */
(function (root) {
  'use strict';
  const P = (typeof module !== 'undefined' && module.exports) ? require('./parser.js') : root.SongParser;
  const { makeRng, hashString } = P;

  // ---------- Rhyme families: nouns usable after "the", and complete tail phrases ----------
  const FAMILIES = [
    { nouns: ['night', 'light', 'moonlight', 'streetlight'], tails: ['tonight', 'hold on tight', 'feels so right', 'burning bright', 'out of sight', 'into the light'] },
    { nouns: ['rain', 'lane', 'train', 'window pane'], tails: ['again', 'call my name', 'still the same', 'feel no pain', 'here I remain'] },
    { nouns: ['sky', 'firefly', 'open sky', 'summer sky'], tails: ['so high', 'you and I', 'learn to fly', 'never say goodbye', 'passing by', 'wonder why'] },
    { nouns: ['heart', 'dark', 'spark', 'park'], tails: ['from the start', 'worlds apart', 'make a mark', 'play my part', 'a brand new start'] },
    { nouns: ['day', 'highway', 'bay', 'doorway'], tails: ['far away', 'here to stay', 'come what may', 'every day', 'what you say', 'fade away'] },
    { nouns: ['road', 'glow', 'radio', 'snow'], tails: ['on my own', 'let it go', 'take it slow', 'now I know', 'here we go', 'never know'] },
    { nouns: ['dream', 'stream', 'screen', 'scene'], tails: ['it seems', 'in between', 'all I need', 'by the sea', 'set me free', 'you and me'] },
    { nouns: ['sound', 'town', 'ground', 'crowd'], tails: ['all around', 'upside down', 'lost and found', 'spinning round', 'hold your ground'] },
    { nouns: ['fire', 'wire', 'choir'], tails: ['climbing higher', 'my desire', 'set on fire', 'take me higher'] },
    { nouns: ['sun', 'drum', 'morning sun'], tails: ['just begun', 'having fun', 'on the run', 'we are one', 'never done', 'here it comes'] },
    { nouns: ['stars', 'car', 'guitar', 'bar'], tails: ['where you are', 'near or far', 'who we are', 'not too far', 'shooting star'] },
    { nouns: ['blue', 'view', 'avenue', 'moon'], tails: ['me and you', 'something new', 'breaking through', 'coming true', 'all for you', 'see it through'] }
  ];

  const BANK = {
    happy:     { verbs: ['danced', 'sang', 'laughed', 'ran', 'smiled'], openers: ['Turn it up', 'Feel the sun', 'Hands up high', 'Come on now', 'Here we go'], adjs: ['golden', 'shining', 'easy', 'bright', 'sunny'], theme: 'summer' },
    sad:       { verbs: ['cried', 'waited', 'wandered', 'fell', 'whispered'], openers: ['I still wait', 'Every time', 'Close my eyes', 'All these years', 'If you knew'], adjs: ['empty', 'quiet', 'fading', 'heavy', 'broken'], theme: 'rain' },
    chill:     { verbs: ['drifted', 'floated', 'wandered', 'rested', 'breathed'], openers: ['Take it slow', 'Let it be', 'Breathe it in', 'Easy now', 'Stay a while'], adjs: ['gentle', 'quiet', 'warm', 'slow', 'hazy'], theme: 'morning' },
    epic:      { verbs: ['rose', 'fought', 'stood', 'marched', 'climbed'], openers: ['Raise your voice', 'Stand up tall', 'Here we rise', 'Never fall', 'Hear the call'], adjs: ['endless', 'mighty', 'burning', 'ancient', 'wild'], theme: 'glory' },
    dark:      { verbs: ['hid', 'burned', 'crawled', 'watched', 'fell'], openers: ['In the dark', 'Can you hear', 'Shadows move', 'Cold as stone', 'No way out'], adjs: ['cold', 'hollow', 'silent', 'bitter', 'dark'], theme: 'shadows' },
    romantic:  { verbs: ['danced', 'dreamed', 'kissed', 'held on', 'fell'], openers: ['Hold me close', 'Only you', 'Say my name', 'Stay with me', 'Every night'], adjs: ['tender', 'golden', 'sweet', 'warm', 'soft'], theme: 'love' },
    energetic: { verbs: ['ran', 'raced', 'jumped', 'flew', 'burned'], openers: ['Turn it up', 'Let it go', 'Feel it now', 'Faster now', 'Here we go'], adjs: ['wild', 'electric', 'burning', 'loud', 'restless'], theme: 'fire' }
  };
  const PREPS = ['beneath', 'under', 'into', 'across', 'beyond', 'inside', 'along'];
  const SUBJ = ['I', 'We', 'You'];

  const STOP = new Set(('a an the and or but with without of for to in on at by from into about like song songs track music tune beat beats make me some something that this it its is are be very really super kind sort type style vibe vibes feel feeling ' +
    'minute minutes min mins second seconds sec secs long short bpm tempo key major minor slow fast upbeat moderate please want would could should my your our their his her them they we you i ' +
    'drums drum melody instrumental vocals vocal voice singing sings sung lyrics lyric no not').split(' '));

  function themeWords(params) {
    const norm = P.normalize(params.text);
    const vocab = new Set();
    for (const g of Object.values(P.GENRES)) g.words.forEach(w => w.split(' ').forEach(x => vocab.add(x)));
    for (const g of Object.values(P.MOODS)) g.words.forEach(w => w.split(' ').forEach(x => vocab.add(x)));
    for (const g of Object.values(P.INSTRUMENTS)) g.forEach(w => w.split(' ').forEach(x => vocab.add(x)));
    const words = norm.trim().split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(w => w.length >= 3 && !STOP.has(w) && !vocab.has(w) && !/^\d/.test(w));
    const out = [];
    const ab = norm.match(/\b(?:about|of|called|titled|named)\s+(?:a\s+|an\s+|the\s+|my\s+|our\s+)?([a-z]{3,})/);
    if (ab && !STOP.has(ab[1])) out.push(ab[1]);
    for (const w of words) if (!out.includes(w)) out.push(w);
    // keep theme-friendly words that also happen to be mood words
    for (const w of ['rain', 'summer', 'love', 'coffee', 'night', 'party', 'ocean', 'city', 'road', 'space', 'heart', 'birthday', 'wedding']) if (norm.includes(' ' + w) && !out.includes(w)) out.push(w);
    return out.slice(0, 3);
  }

  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function lineCandidates(rng, bank, fam, theme, kind, su, usedVerbs) {
    const N = rng.pick(fam.nouns), T = rng.pick(fam.tails);
    let v = rng.pick(bank.verbs); for (let k = 0; k < 4 && usedVerbs && usedVerbs.has(v); k++) v = rng.pick(bank.verbs);
    const adj = rng.pick(bank.adjs), op = rng.pick(bank.openers), pr = rng.pick(PREPS);
    su = su || rng.pick(SUBJ);
    const c = [
      { s: `${su} ${v} ${pr} the ${adj} ${N}`, v },
      { s: `${su} ${v} ${pr} the ${N}`, v },
      { s: `${op}, ${T}` },
      { s: `${cap(theme)} on my mind, ${T}` },
      { s: `${cap(theme)} in the ${adj} ${N}` },
      { s: `Oh, ${theme}, ${T}` },
      { s: `In the ${adj} ${N}` },
      { s: `${su} ${v} and ${T}`, v },
      { s: `${op}, ${su === 'I' ? 'I' : 'we'} ${v} ${pr} the ${N}`, v }
    ];
    if (kind === 'chorus') c.push({ s: `${op}, ${theme}, ${T}` });
    return c.map(x => ({ s: x.s.replace(/\s+/g, ' ').trim(), v: x.v }));
  }

  function pickLine(rng, cands, target, used, usedVerbs) {
    let best = null, bd = Infinity;
    for (const c of cands) {
      const str = typeof c === 'string' ? c : c.s;
      if (used.has(str)) continue;
      const n = countSyllables(str);
      const dist = Math.abs(n - target) + rng() * 1.5;
      if (dist < bd) { bd = dist; best = c; }
    }
    if (!best) best = cands[0] || { s: 'Oh, oh, oh' };
    const str = typeof best === 'string' ? best : best.s;
    used.add(str);
    if (usedVerbs && best.v) usedVerbs.add(best.v);
    return str;
  }

  // targets: { verse: [n,n,n,n], chorus: [...], bridge: [...] } syllable targets per line
  function generateLyrics(params, targets, variation) {
    const rng = makeRng(hashString((params.text || '') + '|lyrics|' + (variation || 0)));
    const mood = params.mood;
    const bank = BANK[mood] || BANK.happy;
    const themes = themeWords(params);
    const theme = themes[0] || bank.theme;
    const theme2 = themes[1] || theme;
    const t = targets || {};
    const tg = (k, i) => (t[k] && t[k].length ? t[k][i % t[k].length] : 7);
    const used = new Set();
    const fams = FAMILIES.slice();
    for (let i = fams.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [fams[i], fams[j]] = [fams[j], fams[i]]; }
    let fi = 0;
    const stanza = (key, scheme, th) => {
      const lines = []; const famFor = {}; const su = rng.pick(['I', 'We', 'I']); const uv = new Set();
      scheme.split('').forEach((letter, i) => {
        if (!famFor[letter]) famFor[letter] = fams[fi++ % fams.length];
        lines.push(pickLine(rng, lineCandidates(rng, bank, famFor[letter], th, key, su, uv), tg(key, i), used, uv));
      });
      return lines;
    };
    const verse1 = stanza('verse', rng.pick(['ABAB', 'AABB']), theme2);
    const verse2 = stanza('verse', rng.pick(['ABAB', 'AABB']), theme2);
    // Chorus: hook line repeats on lines 1 and 3
    const hookFam = fams[fi++ % fams.length];
    const csu = rng.pick(['I', 'We']); const cuv = new Set();
    const hook = pickLine(rng, lineCandidates(rng, bank, hookFam, theme, 'chorus', csu, cuv).filter(c => c.s.toLowerCase().includes(theme.toLowerCase())).concat([{ s: `Oh, ${theme}, ${hookFam.tails[0]}` }]), tg('chorus', 0), used, cuv);
    const noTheme = (list) => { const f = list.filter(c => !c.s.toLowerCase().includes(theme.toLowerCase())); return f.length ? f : list; };
    const c2 = pickLine(rng, noTheme(lineCandidates(rng, bank, hookFam, theme, 'chorus', csu, cuv)), tg('chorus', 1), used, cuv);
    const c4 = pickLine(rng, noTheme(lineCandidates(rng, bank, hookFam, theme, 'chorus', csu, cuv)), tg('chorus', 3), used, cuv);
    const chorus = [hook, c2, hook, c4];
    const bridge = stanza('bridge', 'AABB', theme);
    return { 'Verse 1': verse1, 'Chorus': chorus, 'Verse 2': verse2, 'Bridge': bridge };
  }

  function lyricsToText(ly) {
    return Object.keys(ly).map(k => '[' + k + ']\n' + ly[k].join('\n')).join('\n\n');
  }

  // Parse user text: [Verse], [Verse 2], [Chorus], [Bridge] headers or blank-line stanzas
  function parseLyricsText(text) {
    const out = {};
    const src = String(text || '').replace(/\r/g, '');
    if (/\[[^\]]+\]/.test(src)) {
      let cur = null;
      for (const raw of src.split('\n')) {
        const line = raw.trim();
        const h = line.match(/^\[([^\]]+)\]$/);
        if (h) {
          let name = h[1].trim().toLowerCase();
          let key;
          if (/chorus|hook|refrain/.test(name)) key = 'Chorus';
          else if (/bridge/.test(name)) key = 'Bridge';
          else if (/outro/.test(name)) key = 'Outro';
          else if (/verse/.test(name)) { const n = (name.match(/\d+/) || [null])[0]; key = 'Verse ' + (n || (out['Verse 1'] ? (Object.keys(out).filter(k => k.startsWith('Verse')).length + 1) : 1)); }
          else key = cap(name);
          cur = key; if (!out[cur]) out[cur] = [];
          continue;
        }
        if (line && cur) out[cur].push(line);
        else if (line && !cur) { cur = 'Verse 1'; out[cur] = [line]; }
      }
    } else {
      const stanzas = src.split(/\n\s*\n/).map(s => s.split('\n').map(x => x.trim()).filter(Boolean)).filter(s => s.length);
      const names = ['Verse 1', 'Chorus', 'Verse 2', 'Bridge'];
      stanzas.forEach((s, i) => {
        const key = i < names.length ? names[i] : (i % 2 ? 'Chorus' : 'Verse ' + (Math.floor(i / 2) + 1));
        if (key === 'Chorus' && out['Chorus']) return;
        out[key] = (out[key] || []).concat(s);
      });
    }
    for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
    return out;
  }

  // ---------- Syllabification ----------
  const VOWELS = 'aeiouy';
  const EXCEPT = { the: ['the'], you: ['you'], your: ['your'], are: ['are'], fire: ['fi', 're'], higher: ['hi', 'gher'], desire: ['de', 'si', 're'], choir: ['choi', 'r'], every: ['ev', 'ery'], our: ['our'], hour: ['hour'], alive: ['a', 'live'], goodbye: ['good', 'bye'], into: ['in', 'to'], into_: [], tonight: ['to', 'night'], again: ['a', 'gain'], away: ['a', 'way'], alone: ['a', 'lone'], around: ['a', 'round'], apart: ['a', 'part'], begun: ['be', 'gun'], beneath: ['be', 'neath'], beyond: ['be', 'yond'], electric: ['e', 'lec', 'tric'], something: ['some', 'thing'], whispered: ['whis', 'pered'], wandered: ['wan', 'dered'], waited: ['wait', 'ed'], rested: ['rest', 'ed'], drifted: ['drift', 'ed'], floated: ['float', 'ed'], danced: ['danced'], laughed: ['laughed'], smiled: ['smiled'], breathed: ['breathed'], marched: ['marched'], climbed: ['climbed'], burned: ['burned'], crawled: ['crawled'], watched: ['watched'], kissed: ['kissed'], dreamed: ['dreamed'], jumped: ['jumped'], raced: ['raced'], cried: ['cried'], seems: ['seems'], comes: ['comes'], somewhere: ['some', 'where'], people: ['peo', 'ple'], little: ['lit', 'tle'], coffee: ['cof', 'fee'], summer: ['sum', 'mer'], morning: ['morn', 'ing'], shadows: ['sha', 'dows'], glory: ['glo', 'ry'], heavy: ['hea', 'vy'], empty: ['emp', 'ty'], quiet: ['qui', 'et'], ocean: ['o', 'cean'], restless: ['rest', 'less'], endless: ['end', 'less'], broken: ['bro', 'ken'], golden: ['gol', 'den'], gentle: ['gen', 'tle'], mighty: ['migh', 'ty'], ancient: ['an', 'cient'], bitter: ['bit', 'ter'], hollow: ['hol', 'low'], silent: ['si', 'lent'], tender: ['ten', 'der'], hazy: ['ha', 'zy'], easy: ['ea', 'sy'], sunny: ['sun', 'ny'], shining: ['shin', 'ing'], burning: ['burn', 'ing'], fading: ['fad', 'ing'], wire: ['wi', 're'], tire: ['ti', 're'], brand: ['brand'] };

  function splitWord(word) {
    const w = word.toLowerCase().replace(/[^a-z']/g, '').replace(/'/g, '');
    if (!w) return [];
    if (EXCEPT[w]) return EXCEPT[w].slice();
    // vowel groups
    const groups = [];
    let i = 0;
    const isV = (ch, idx) => VOWELS.includes(ch) && !(ch === 'y' && idx === 0);
    while (i < w.length) {
      if (isV(w[i], i)) { let j = i; while (j < w.length && isV(w[j], j)) j++; groups.push([i, j]); i = j; } else i++;
    }
    // silent final e (but keep "-le" and single-group words)
    if (groups.length > 1) {
      const last = groups[groups.length - 1];
      if (last[0] === w.length - 1 && w[w.length - 1] === 'e' && !/[^aeiou]le$/.test(w)) groups.pop();
      else if (/[^aeiou]es$|[^aeioudt]ed$/.test(w) && last[0] === w.length - 2) groups.pop();
    }
    if (groups.length <= 1) return [w];
    const sylls = [];
    let start = 0;
    for (let g = 0; g < groups.length - 1; g++) {
      const vEnd = groups[g][1], nextV = groups[g + 1][0];
      const cons = nextV - vEnd;
      let cut = cons <= 1 ? vEnd : vEnd + 1; // V-CV or VC-CV
      if (cons >= 2 && /^(ch|sh|th|ph|wh|ck|ng)$/.test(w.slice(vEnd, vEnd + 2)) && cons === 2) cut = vEnd;
      sylls.push(w.slice(start, cut)); start = cut;
    }
    sylls.push(w.slice(start));
    return sylls.filter(Boolean);
  }

  function vowelOf(s) {
    const m = s.match(/[aeiouy]+/); const v = m ? m[0] : 'a';
    const tail = s.slice((m ? m.index : 0) + v.length);
    if (/^(ee|ea|ie|ey|y|i)$/.test(v) && (v !== 'i' || /^(ght|nd|ne|ke|me|te|ve|re|se|ce)?$/.test(tail) === false)) return v === 'i' ? 'ih' : 'i';
    if (v === 'i') return /^(ght|gh|nd|ne|ke|me|te|ve|re|se|ce|de|fe|le)/.test(tail) || tail === '' ? 'ai' : 'ih';
    if (/^(oo|ou|ue|ew|u)$/.test(v)) return v === 'u' && /^[^aeiou]{1,2}$/.test(tail) && !/^(re|le|ne)/.test(tail) ? 'uh' : (v === 'ou' && /^(nd|t|r|d|n|s)/.test(tail) ? 'au' : 'u');
    if (/^(o|oa|ow|oe)$/.test(v)) return (v === 'o' && /^[^aeiou]{2,}$/.test(tail) && !/^(ld|ll|st)/.test(tail)) ? 'aa' : (v === 'ow' && /^(n|d)?$/.test(tail) && /(d|n|t|h|br|cr|cl)ow/.test(s) ? 'au' : 'o');
    if (/^(a|ai|ay|ei)$/.test(v)) return v === 'a' && /^(r)/.test(tail) ? 'aa' : (v === 'a' && /^[^aeiou]{1,2}$/.test(tail) && !/^(ke|me|ne|te|ve|ce|de|ge|se)/.test(tail) ? 'ae' : (v === 'a' && tail === '' ? 'uh' : 'ei'));
    if (v === 'e' || v === 'ea') return /^r/.test(tail) ? 'er' : (tail === '' && s.length <= 3 ? 'i' : 'e');
    if (v === 'au' || v === 'aw') return 'aa';
    if (v === 'oi' || v === 'oy') return 'oi';
    return 'uh';
  }

  function consonantClass(c) {
    if (!c) return null;
    const ch = c.slice(0, 2);
    if (/^(sh|ch)/.test(ch)) return 'sh';
    if (/^th/.test(ch)) return 'th';
    if (/^[sz]/.test(c)) return 's';
    if (/^[fv]/.test(c)) return 'f';
    if (/^h/.test(c)) return 'h';
    if (/^[ptk]|^c(?!h)|^q/.test(c)) return 'k';
    if (/^[bdg]|^j/.test(c)) return 'b';
    if (/^[mn]/.test(c)) return 'm';
    if (/^[lrwy]/.test(c)) return 'l';
    return 'k';
  }

  function syllabify(line) {
    const out = [];
    const words = String(line || '').split(/\s+/).filter(Boolean);
    words.forEach((word, wi) => {
      const parts = splitWord(word);
      parts.forEach((s, i) => {
        const on = (s.match(/^[^aeiouy]+/) || [''])[0];
        const coda = (s.match(/[^aeiouy]+$/) || [''])[0];
        out.push({ text: s, vowel: vowelOf(s), onset: consonantClass(on), coda: coda && !/^(e|r|w|y|gh|h)$/.test(coda) ? consonantClass(coda) : null, wi, wordStart: i === 0, wordEnd: i === parts.length - 1, word: word.toLowerCase().replace(/[^a-z']/g, '').replace(/'/g, ''), raw: word.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z'-]/g, '') });
      });
    });
    return out;
  }
  function countSyllables(line) { return syllabify(line).length; }

  // ---------- Map lyrics onto the composed melody ----------
  // returns vocal events [{t, d, m, syl, legato}]
  function mapVocals(song, lyrics, opts) {
    opts = opts || {};
    const center = opts.center || 64;
    const lead = song.notes.filter(n => n.sec !== undefined && n.secName !== 'intro');
    if (!lead.length) return [];
    // single octave offset for the whole song so the voice sits near its centre
    const sorted = lead.map(n => n.m).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    let oct = Math.round((center - median) / 12) * 12;
    const groups = new Map();
    for (const n of lead) {
      const key = n.sec + ':' + n.ph;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    const out = [];
    const verseKeys = Object.keys(lyrics).filter(k => /^Verse/.test(k)).sort();
    for (const [key, notesRaw] of groups) {
      const [si, ph] = key.split(':').map(Number);
      const sec = song.sections[si];
      let lines;
      if (sec.name === 'chorus' || sec.name === 'outro') lines = lyrics['Chorus'] || lyrics[verseKeys[0]];
      else if (sec.name === 'bridge') lines = lyrics['Bridge'] || lyrics['Chorus'];
      else {
        const idx = (sec.label.match(/\d+/) || ['1'])[0];
        lines = lyrics['Verse ' + idx] || lyrics[verseKeys[(Number(idx) - 1) % Math.max(1, verseKeys.length)]] || lyrics['Chorus'];
      }
      if (sec.name === 'outro' && lyrics['Outro']) lines = lyrics['Outro'];
      if (!lines || !lines.length) continue;
      const line = lines[ph % lines.length];
      let syls = syllabify(line);
      if (!syls.length) continue;
      let notes = notesRaw.map(n => ({ t: n.t, d: n.d, m: n.m + oct }));
      // need more notes: split the longest notes
      let guard = 0;
      while (notes.length < syls.length && guard++ < 64) {
        let li = 0; for (let i = 1; i < notes.length; i++) if (notes[i].d > notes[li].d) li = i;
        const n = notes[li];
        if (n.d < 0.16) break;
        const half = n.d / 2;
        notes.splice(li, 1, { t: n.t, d: half * 0.96, m: n.m }, { t: n.t + half, d: half, m: n.m });
      }
      if (notes.length < syls.length) {
        // squeeze: merge the extra syllables into the last ones
        const keep = syls.slice(0, notes.length - 1);
        const rest = syls.slice(notes.length - 1);
        keep.push(Object.assign({}, rest[0], { text: rest.map(s => s.text).join(''), coda: rest[rest.length - 1].coda, wiEnd: rest[rest.length - 1].wi, wordEnd: true }));
        syls = keep;
      }
      // distribute syllables over notes; extra notes become melisma (legato vowel)
      const N = notes.length, S = syls.length;
      for (let i = 0; i < N; i++) {
        const sIdx = Math.min(S - 1, Math.floor(i * S / N));
        const first = i === 0 || Math.min(S - 1, Math.floor((i - 1) * S / N)) !== sIdx;
        const syl = syls[sIdx];
        const next = notes[i + 1];
        // hold into the next note when legato (melisma) so it glides
        let d = notes[i].d;
        const nextSame = next && Math.min(S - 1, Math.floor((i + 1) * S / N)) === sIdx;
        if (nextSame) d = Math.max(d, next.t - notes[i].t + 0.02);
        out.push({ t: notes[i].t, d, m: notes[i].m, syl, legato: !first, lastOfSyl: !nextSame, sec: sec.name, secIndex: si, final: !!sec.final, phrase: key, line });
      }
    }
    out.sort((a, b) => a.t - b.t);
    // portamento source: previous note pitch if close in time
    for (let i = 1; i < out.length; i++) {
      const gap = out[i].t - (out[i - 1].t + out[i - 1].d);
      if (gap < 0.12) out[i].from = out[i - 1].m;
    }
    return out;
  }

  // syllable targets for a song (notes per phrase) -> help the generator fit lines
  function syllableTargets(song) {
    const t = { verse: [], chorus: [], bridge: [] };
    const seen = {};
    for (const n of song.notes) {
      if (n.sec === undefined) continue;
      const nm = n.secName; if (!t[nm]) continue;
      const sec = song.sections[n.sec];
      if (sec.label !== 'Verse 1' && sec.label !== 'Verse' && sec.label !== 'Chorus 1' && sec.label !== 'Chorus' && sec.label !== 'Bridge' && sec.label !== 'Bridge 1') continue;
      const k = nm + n.ph; seen[k] = (seen[k] || 0) + 1;
    }
    for (const nm of Object.keys(t)) for (let ph = 0; ph < 4; ph++) t[nm].push(Math.max(4, Math.min(12, seen[nm + ph] || 7)));
    return t;
  }

  const api = { generateLyrics, lyricsToText, parseLyricsText, syllabify, countSyllables, mapVocals, syllableTargets, themeWords, splitWord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SongLyrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
