/* Song Studio — description parser. Pure JS, works in browser and Node. */
(function (root) {
  'use strict';

  // ---------- Seeded RNG ----------
  function hashString(str) {
    // FNV-1a 32-bit, then mixed
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function makeRng(seed) {
    let a = seed >>> 0;
    const rng = function () { // mulberry32
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
    rng.chance = (p) => rng() < p;
    rng.range = (lo, hi) => lo + rng() * (hi - lo);
    rng.weighted = (items) => { // [[value, weight], ...]
      let total = 0; for (const it of items) total += it[1];
      let r = rng() * total;
      for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
      return items[items.length - 1][0];
    };
    return rng;
  }

  // ---------- Vocabulary ----------
  const GENRES = {
    lofi:      { label: 'Lo-fi',      bpm: [70, 88],   words: ['lo-fi', 'lofi', 'lo fi', 'chillhop', 'study beat', 'study beats', 'studying', 'study', 'jazzhop', 'vinyl', 'cozy', 'rainy'] },
    pop:       { label: 'Pop',        bpm: [96, 124],  words: ['pop', 'radio', 'catchy', 'anthem', 'singalong', 'sing-along', 'boy band', 'synthpop', 'indie pop', 'k-pop', 'kpop', 'ballad', 'love song'] },
    rock:      { label: 'Rock',       bpm: [110, 150], words: ['rock', 'punk', 'grunge', 'metal', 'garage', 'alt rock', 'alternative', 'indie rock', 'guitar solo', 'riff', 'riffs', 'heavy', 'distorted'] },
    edm:       { label: 'EDM',        bpm: [120, 132], words: ['edm', 'house', 'techno', 'trance', 'dubstep', 'dance', 'club', 'rave', 'electronic', 'electro', 'festival', 'drop', 'synthwave', 'retrowave', 'disco', 'dancefloor'] },
    hiphop:    { label: 'Hip-hop',    bpm: [80, 96],   words: ['hip-hop', 'hip hop', 'hiphop', 'rap', 'trap', 'boom bap', 'boombap', 'drill', '808', '808s', 'beat for rapping', 'freestyle', 'r&b', 'rnb'] },
    jazz:      { label: 'Jazz',       bpm: [84, 140], words: ['jazz', 'jazzy', 'swing', 'bebop', 'bossa', 'bossa nova', 'lounge', 'smooth jazz', 'noir', 'cocktail', 'speakeasy', 'big band'] },
    ambient:   { label: 'Ambient',    bpm: [60, 80],   words: ['ambient', 'drone', 'meditation', 'meditative', 'atmospheric', 'space', 'spacey', 'ethereal', 'dreamy', 'sleep', 'yoga', 'spa', 'floating', 'calm'] },
    cinematic: { label: 'Cinematic',  bpm: [70, 110],  words: ['cinematic', 'film', 'movie', 'orchestral', 'orchestra', 'trailer', 'soundtrack', 'score', 'heroic', 'battle', 'adventure', 'fantasy', 'video game', 'game music', 'boss fight'] },
    country:   { label: 'Country',    bpm: [88, 120],  words: ['country', 'folk', 'western', 'bluegrass', 'americana', 'cowboy', 'banjo', 'campfire', 'acoustic', 'road trip', 'southern', 'farm'] },
    classical: { label: 'Classical',  bpm: [66, 112],  words: ['classical', 'baroque', 'sonata', 'piano solo', 'string quartet', 'waltz', 'minuet', 'nocturne', 'chamber', 'mozart', 'bach', 'chopin', 'beethoven', 'etude'] }
  };

  const MOODS = {
    happy:     { label: 'Happy',     energy: 0.65, words: ['happy', 'joy', 'joyful', 'cheerful', 'bright', 'sunny', 'fun', 'playful', 'uplifting', 'upbeat', 'positive', 'summer', 'celebration', 'party', 'feel good', 'feel-good', 'hopeful', 'birthday'] },
    sad:       { label: 'Sad',       energy: 0.3,  words: ['sad', 'melancholy', 'melancholic', 'heartbreak', 'heartbroken', 'lonely', 'crying', 'tears', 'grief', 'blue', 'blues', 'nostalgic', 'nostalgia', 'rain', 'breakup', 'missing', 'sorrow', 'bittersweet', 'emotional'] },
    chill:     { label: 'Chill',     energy: 0.35, words: ['chill', 'relaxed', 'relaxing', 'mellow', 'laid back', 'laid-back', 'easy', 'smooth', 'peaceful', 'gentle', 'soft', 'lazy', 'sunday', 'coffee', 'cafe', 'lounge', 'calm', 'soothing'] },
    epic:      { label: 'Epic',      energy: 0.85, words: ['epic', 'heroic', 'triumphant', 'grand', 'majestic', 'powerful', 'victory', 'battle', 'legendary', 'huge', 'massive', 'trailer', 'inspiring', 'inspirational', 'motivational'] },
    dark:      { label: 'Dark',      energy: 0.6,  words: ['dark', 'spooky', 'scary', 'creepy', 'horror', 'sinister', 'evil', 'ominous', 'menacing', 'tense', 'suspense', 'mysterious', 'mystery', 'villain', 'haunted', 'halloween', 'gritty', 'aggressive', 'angry'] },
    romantic:  { label: 'Romantic',  energy: 0.4,  words: ['romantic', 'love', 'lovers', 'in love', 'tender', 'sweet', 'intimate', 'wedding', 'valentine', 'date night', 'crush', 'sensual', 'slow dance', 'warm'] },
    energetic: { label: 'Energetic', energy: 0.9,  words: ['energetic', 'energy', 'hype', 'hyped', 'intense', 'driving', 'workout', 'gym', 'running', 'fast-paced', 'pumped', 'wild', 'crazy', 'banger', 'explosive', 'adrenaline', 'racing', 'action'] }
  };

  const INSTRUMENTS = {
    piano:   ['piano', 'keys', 'grand piano', 'keyboard'],
    epiano:  ['rhodes', 'electric piano', 'e-piano', 'wurlitzer'],
    guitar:  ['guitar', 'guitars', 'acoustic guitar', 'electric guitar', 'strum', 'strumming', 'banjo', 'ukulele', 'uke'],
    strings: ['strings', 'string', 'violin', 'violins', 'cello', 'viola', 'orchestra', 'orchestral', 'string quartet'],
    pad:     ['pad', 'pads', 'atmosphere', 'texture', 'drone', 'warm synth'],
    synth:   ['synth', 'synths', 'synthesizer', 'lead synth', 'synth lead', 'analog', 'chiptune', '8-bit', '8 bit'],
    bell:    ['bell', 'bells', 'glockenspiel', 'music box', 'chimes', 'celesta', 'marimba', 'vibraphone', 'xylophone', 'kalimba'],
    organ:   ['organ', 'hammond', 'church organ'],
    flute:   ['flute', 'flutes', 'whistle', 'pan flute', 'recorder', 'ocarina'],
    brass:   ['brass', 'horn', 'horns', 'trumpet', 'trumpets', 'trombone', 'french horn', 'saxophone', 'sax'],
    choir:   ['choir', 'vocals', 'voices', 'ahh', 'oohs', 'chant', 'choral'],
    arp:     ['arp', 'arpeggio', 'arpeggios', 'arpeggiated', 'sequencer'],
    bass808: ['808', '808s', 'sub bass', 'sub-bass', 'subbass']
  };

  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NOTE_ALIASES = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, fb: 4, 'e#': 5, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11, cb: 11 };

  const SCALES = {
    major:          { label: 'major',          steps: [0, 2, 4, 5, 7, 9, 11] },
    minor:          { label: 'minor',          steps: [0, 2, 3, 5, 7, 8, 10] },
    dorian:         { label: 'Dorian',         steps: [0, 2, 3, 5, 7, 9, 10] },
    phrygian:       { label: 'Phrygian',       steps: [0, 1, 3, 5, 7, 8, 10] },
    lydian:         { label: 'Lydian',         steps: [0, 2, 4, 6, 7, 9, 11] },
    mixolydian:     { label: 'Mixolydian',     steps: [0, 2, 4, 5, 7, 9, 10] },
    harmonicMinor:  { label: 'harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] }
  };

  // Mood -> weighted scale choices
  const MOOD_SCALES = {
    happy:     [['major', 6], ['lydian', 1], ['mixolydian', 1]],
    sad:       [['minor', 6], ['dorian', 1]],
    chill:     [['major', 3], ['dorian', 3], ['minor', 2]],
    epic:      [['minor', 6], ['harmonicMinor', 1]],
    dark:      [['minor', 3], ['phrygian', 2], ['harmonicMinor', 2]],
    romantic:  [['major', 5], ['minor', 2], ['lydian', 1]],
    energetic: [['minor', 3], ['major', 3], ['mixolydian', 1]]
  };

  const GENRE_DEFAULT_MOOD = { lofi: 'chill', pop: 'happy', rock: 'energetic', edm: 'energetic', hiphop: 'dark', jazz: 'chill', ambient: 'chill', cinematic: 'epic', country: 'happy', classical: 'romantic' };
  const MOOD_DEFAULT_GENRE = { happy: 'pop', sad: 'lofi', chill: 'lofi', epic: 'cinematic', dark: 'hiphop', romantic: 'jazz', energetic: 'edm' };
  const GENRE_DEFAULT_LENGTH = { lofi: 90, pop: 105, rock: 100, edm: 110, hiphop: 95, jazz: 90, ambient: 120, cinematic: 105, country: 95, classical: 90 };

  // ---------- helpers ----------
  function normalize(text) {
    return (' ' + String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9#&:.\-\s]/g, ' ').replace(/\s+/g, ' ') + ' ');
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function countHits(norm, words) {
    let score = 0; const found = [];
    for (const w of words) {
      const re = new RegExp('(^|[^a-z0-9])' + escapeRe(w) + '(?=[^a-z0-9]|$)', 'g');
      const m = norm.match(re);
      if (m) { score += m.length * (w.includes(' ') ? 1.5 : 1); found.push(w); }
    }
    return { score, found };
  }
  function isNegated(norm, words) {
    for (const w of words) {
      const re = new RegExp('(no|without|minus|zero|skip|not|less|dont want|dont use|ditch)\\s+(any\\s+|the\\s+)?' + escapeRe(w) + '(?=[^a-z0-9]|$)');
      if (re.test(norm)) return true;
    }
    return false;
  }
  function bestOf(table, norm) {
    let best = null, bestScore = 0; const scores = {};
    for (const key of Object.keys(table)) {
      const { score } = countHits(norm, table[key].words);
      scores[key] = score;
      if (score > bestScore) { best = key; bestScore = score; }
    }
    return { best, scores };
  }

  function parseLength(norm) {
    let m = norm.match(/(\d{1,2}):(\d{2})/);
    if (m) return clamp(parseInt(m[1], 10) * 60 + parseInt(m[2], 10), 20, 300);
    m = norm.match(/(\d+|one|two|three|four|a|an)\s+and\s+a\s+half\s+min/);
    if (m) {
      const w = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
      return clamp(Math.round(((w[m[1]] !== undefined ? w[m[1]] : parseInt(m[1], 10)) + 0.5) * 60), 20, 300);
    }
    m = norm.match(/(\d+(?:\.\d+)?|a|an|one|two|three|four|five|half)\s*(?:-|\s)?(minutes?|mins?|m)(?=[^a-z]|$)(?:\s*(?:and\s*)?(\d+)\s*(?:seconds?|secs?|s\b))?/);
    if (m && !/bpm/.test(m[0])) {
      const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };
      let mins = words[m[1]] !== undefined ? words[m[1]] : parseFloat(m[1]);
      if (/half\s+(?:a\s+)?min/.test(norm)) mins = 0.5;
      if (/(\d+|one|two|three|a)\s+and\s+a\s+half\s+min/.test(norm)) mins += 0.5;
      let secs = mins * 60 + (m[3] ? parseInt(m[3], 10) : 0);
      return clamp(Math.round(secs), 20, 300);
    }
    m = norm.match(/(\d+)\s*(?:-|\s)?(seconds?|secs?|sec)(?=[^a-z]|$)/);
    if (m) return clamp(parseInt(m[1], 10), 20, 300);
    if (/\b(very short|tiny|jingle|quick|snippet|short)\b/.test(norm)) return 45;
    if (/\b(very long|extended|long)\b/.test(norm)) return 180;
    return null;
  }

  function parseBpm(norm) {
    const m = norm.match(/(\d{2,3})\s*(?:bpm|beats per minute)/) || norm.match(/(?:bpm|tempo)\s*(?:of\s*)?(\d{2,3})/);
    if (m) return clamp(parseInt(m[1], 10), 50, 190);
    return null;
  }

  function parseTempoWords(norm) {
    let shift = 0;
    if (/\b(very slow|super slow|really slow|glacial|crawling)\b/.test(norm)) shift -= 2;
    else if (/\b(slow|slower|slowly|downtempo|ballad|lullaby|sleepy)\b/.test(norm)) shift -= 1;
    if (/\b(very fast|super fast|really fast|breakneck|blazing|frantic)\b/.test(norm)) shift += 2;
    else if (/\b(fast|faster|quick tempo|uptempo|up-tempo|speedy|rapid|high tempo|high-tempo)\b/.test(norm)) shift += 1;
    if (/\b(moderate|mid-tempo|midtempo|medium tempo)\b/.test(norm)) shift = 0;
    return shift;
  }

  function parseKey(norm) {
    const re = /(?:^|[^a-z0-9])(?:in|key of|key)?\s*([a-g])\s*(#|sharp|b|flat)?\s*(major|minor|maj|min|m|dorian|phrygian|lydian|mixolydian|harmonic minor)(?=[^a-z]|$)/;
    const m = norm.match(re);
    if (!m) return null;
    // avoid matching words like "a minor detail" only if explicit "in" missing? keep simple but require scale word
    let name = m[1];
    if (m[2] === '#' || m[2] === 'sharp') name += '#';
    else if (m[2] === 'b' || m[2] === 'flat') name += 'b';
    const root = NOTE_ALIASES[name];
    if (root === undefined) return null;
    let scale = m[3];
    if (scale === 'maj') scale = 'major';
    if (scale === 'min' || scale === 'm') scale = 'minor';
    if (scale === 'harmonic minor') scale = 'harmonicMinor';
    return { root, scale };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- main ----------
  function parse(text, variation) {
    variation = variation || 0;
    const norm = normalize(text);
    const trimmed = norm.trim();
    const seedBase = hashString(trimmed || 'song maker');
    const seed = hashString(trimmed + '#' + variation) ^ seedBase;
    const rng = makeRng(seed);
    const notes = [];

    const g = bestOf(GENRES, norm);
    const md = bestOf(MOODS, norm);
    let genre = g.best, mood = md.best;
    const inferred = { genre: !genre, mood: !mood };

    if (!genre && mood) genre = MOOD_DEFAULT_GENRE[mood];
    if (!mood && genre) mood = GENRE_DEFAULT_MOOD[genre];
    if (!genre && !mood) {
      // Pick from the description hash so it is stable
      const r0 = makeRng(seedBase);
      genre = r0.pick(Object.keys(GENRES));
      mood = GENRE_DEFAULT_MOOD[genre];
      notes.push('No genre or mood words found, so one was chosen from your text.');
    }

    // Secondary mood blend (e.g. "sad but hopeful")
    const moodRanked = Object.keys(md.scores).filter(k => md.scores[k] > 0 && k !== mood).sort((a, b) => md.scores[b] - md.scores[a]);
    const secondaryMood = moodRanked[0] || null;

    // Key / scale
    const keyInfo = parseKey(norm);
    let root, scale;
    if (keyInfo) { root = keyInfo.root; scale = keyInfo.scale; }
    else {
      scale = rng.weighted(MOOD_SCALES[mood]);
      if (genre === 'jazz' && scale === 'minor') scale = 'dorian';
      if (genre === 'classical' && scale !== 'major' && scale !== 'minor' && scale !== 'harmonicMinor') scale = mood === 'sad' ? 'minor' : 'major';
      const rootPrefs = {
        rock: [4, 9, 2, 7, 0], country: [7, 2, 9, 0, 4], edm: [9, 5, 1, 6, 8, 0], hiphop: [1, 6, 8, 3, 0, 5],
        jazz: [5, 10, 3, 0, 7], cinematic: [2, 0, 9, 4], classical: [0, 7, 2, 5, 9, 10], ambient: [2, 4, 9, 0, 6],
        lofi: [5, 3, 10, 0, 8, 2], pop: [0, 7, 2, 9, 5, 4]
      };
      root = rng.pick(rootPrefs[genre]);
    }

    // Tempo
    const gr = GENRES[genre].bpm;
    let bpm = parseBpm(norm);
    const bpmExplicit = bpm !== null;
    if (!bpmExplicit) {
      const energy = MOODS[mood].energy;
      // position in genre range driven by mood energy
      let pos = 0.25 + energy * 0.6 + rng.range(-0.15, 0.15);
      const shift = parseTempoWords(norm);
      pos = clamp(pos + shift * 0.45, -0.3, 1.3);
      bpm = gr[0] + (gr[1] - gr[0]) * pos;
      if (shift <= -1) bpm = Math.min(bpm, gr[0] * (shift <= -2 ? 0.78 : 0.9));
      if (shift >= 2) bpm = Math.max(bpm, gr[1] * 1.08);
      if (shift >= 1) bpm = Math.max(bpm, gr[0] + (gr[1] - gr[0]) * 0.75);
      bpm = Math.round(clamp(bpm, 52, 180));
    }

    // Length
    let lengthSec = parseLength(norm);
    const lengthExplicit = lengthSec !== null;
    if (!lengthExplicit) lengthSec = GENRE_DEFAULT_LENGTH[genre];

    // Instruments
    const instruments = []; const excluded = [];
    for (const k of Object.keys(INSTRUMENTS)) {
      if (isNegated(norm, INSTRUMENTS[k])) { excluded.push(k); continue; }
      if (countHits(norm, INSTRUMENTS[k]).score > 0) instruments.push(k);
    }
    const drumWords = ['drums', 'drum', 'beat', 'beats', 'percussion', 'kick'];
    let drums = 'auto';
    if (isNegated(norm, drumWords) || /\b(drumless|a cappella|acapella)\b/.test(norm)) drums = 'none';
    else if (/\b(heavy drums|big drums|hard hitting|hard-hitting|punchy|booming|taiko)\b/.test(norm)) drums = 'heavy';
    else if (/\b(light drums|soft drums|brushes|minimal drums)\b/.test(norm)) drums = 'light';
    let melodyOff = /\b(no melody|without melody|no lead)\b/.test(norm);
    if (excluded.includes('piano') && instruments.includes('piano')) instruments.splice(instruments.indexOf('piano'), 1);

    // Intensity modifiers
    let energy = MOODS[mood].energy;
    if (secondaryMood) energy = energy * 0.75 + MOODS[secondaryMood].energy * 0.25;
    if (/\b(intense|aggressive|loud|hard|heavy|big)\b/.test(norm)) energy = Math.min(1, energy + 0.15);
    if (/\b(soft|quiet|gentle|minimal|sparse|delicate|subtle)\b/.test(norm)) energy = Math.max(0.1, energy - 0.15);
    energy = Math.round(energy * 100) / 100;

    // Extra flavour flags
    const flags = {
      vinyl: genre === 'lofi' || /\b(vinyl|crackle|tape|cassette|old record|retro|vintage)\b/.test(norm),
      rain: /\b(rain|rainy|storm)\b/.test(norm) && !/\bno rain\b/.test(norm),
      swing: genre === 'jazz' || /\b(swing|swung|shuffle|groovy|groove)\b/.test(norm),
      retro: /\b(synthwave|retrowave|80s|eighties|retro|chiptune|8-bit|8 bit)\b/.test(norm),
      halfTime: /\b(half time|half-time|halftime)\b/.test(norm),
      noDrums: drums === 'none',
      melodyOff
    };

    return {
      text: String(text || ''),
      genre, mood, secondaryMood,
      root, scale, bpm, lengthSec,
      instruments, excluded, drums, energy, flags,
      variation, seed: seed >>> 0,
      inferred: { genre: inferred.genre, mood: inferred.mood, key: !keyInfo, bpm: !bpmExplicit, length: !lengthExplicit },
      notes
    };
  }

  function keyName(root, scale) { return NOTE_NAMES[((root % 12) + 12) % 12] + ' ' + SCALES[scale].label; }

  const api = { parse, hashString, makeRng, GENRES, MOODS, SCALES, INSTRUMENTS, NOTE_NAMES, keyName, normalize, parseLength, parseBpm, parseKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SongParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
