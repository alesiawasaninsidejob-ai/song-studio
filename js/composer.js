/* Song Studio — composer. Turns parsed parameters into a timed list of notes and drum hits.
   Pure JS (no audio), works in browser and Node. */
(function (root) {
  'use strict';
  const P = (typeof module !== 'undefined' && module.exports) ? require('./parser.js') : root.SongParser;
  const { SCALES, makeRng, hashString } = P;

  // ---------- Genre profiles ----------
  const PROFILES = {
    lofi:      { chords: 'epiano', pad: 'pad',     lead: 'bell',      bass: 'bass_round', arp: null,    comp: 'lofi',     drums: 'lofi',      swing: 0.18, sevenths: 0.9, ninths: 0.5, barsPerChord: 1, reverb: [2.2, 0.22], delay: 0.16, lofi: true },
    pop:       { chords: 'piano',  pad: 'pad',     lead: 'synthlead', bass: 'bass_synth', arp: 'pluck', comp: 'pop',      drums: 'pop',       swing: 0,    sevenths: 0.15, ninths: 0.1, barsPerChord: 1, reverb: [1.8, 0.18], delay: 0.12 },
    rock:      { chords: 'dguitar', pad: 'organ',  lead: 'leadguitar', bass: 'bass_pick', arp: null,    comp: 'rock',     drums: 'rock',      swing: 0,    sevenths: 0,   ninths: 0,   barsPerChord: 1, reverb: [1.4, 0.14], delay: 0.08 },
    edm:       { chords: 'supersaw', pad: 'pad',   lead: 'supersawlead', bass: 'bass_saw', arp: 'pluck', comp: 'edm',     drums: 'edm',       swing: 0,    sevenths: 0.2, ninths: 0.1, barsPerChord: 1, reverb: [2.4, 0.2], delay: 0.18, sidechain: true },
    hiphop:    { chords: 'epiano', pad: 'pad',     lead: 'bell',      bass: 'bass_808',   arp: null,    comp: 'hiphop',   drums: 'hiphop',    swing: 0.12, sevenths: 0.6, ninths: 0.3, barsPerChord: 1, reverb: [1.8, 0.16], delay: 0.15 },
    jazz:      { chords: 'epiano', pad: null,      lead: 'sax',       bass: 'bass_upright', arp: null,  comp: 'jazz',     drums: 'jazz',      swing: 0.33, sevenths: 1,   ninths: 0.6, barsPerChord: 1, reverb: [1.6, 0.18], delay: 0 },
    ambient:   { chords: null,     pad: 'pad',     lead: 'flute',     bass: 'bass_sub',   arp: 'bell',  comp: null,       drums: 'ambient',   swing: 0,    sevenths: 0.7, ninths: 0.7, barsPerChord: 2, reverb: [5.5, 0.45], delay: 0.3 },
    cinematic: { chords: 'piano',  pad: 'strings', lead: 'brass',     bass: 'strings_low', arp: 'piano', comp: 'cinematic', drums: 'cinematic', swing: 0,  sevenths: 0.1, ninths: 0.1, barsPerChord: 1, reverb: [3.6, 0.32], delay: 0.06 },
    country:   { chords: 'guitar', pad: 'organ',   lead: 'fiddle',    bass: 'bass_pick',  arp: null,    comp: 'country',  drums: 'country',   swing: 0.08, sevenths: 0.05, ninths: 0, barsPerChord: 1, reverb: [1.4, 0.14], delay: 0.06 },
    classical: { chords: 'piano',  pad: null,      lead: 'piano',     bass: null,         arp: null,    comp: 'alberti',  drums: null,        swing: 0,    sevenths: 0.15, ninths: 0, barsPerChord: 1, reverb: [2.6, 0.26], delay: 0 }
  };

  const INSTRUMENT_LABELS = {
    piano: 'Piano', epiano: 'Electric piano', guitar: 'Acoustic guitar', dguitar: 'Electric guitar', leadguitar: 'Lead guitar',
    strings: 'Strings', strings_low: 'Low strings', pad: 'Synth pad', organ: 'Organ', supersaw: 'Supersaw', supersawlead: 'Synth lead',
    synthlead: 'Synth lead', pluck: 'Pluck synth', bell: 'Bells', flute: 'Flute', brass: 'Brass', sax: 'Sax-style lead', fiddle: 'Fiddle',
    choir: 'Choir', bass_synth: 'Synth bass', bass_round: 'Round bass', bass_pick: 'Bass guitar', bass_saw: 'Saw bass', bass_808: '808 bass',
    bass_upright: 'Upright bass', bass_sub: 'Sub bass'
  };

  // ---------- Progressions (scale degrees, 0-based) ----------
  const PROGS = {
    major:  { verse: [[0,5,3,4],[0,4,5,3],[0,3,5,4],[5,3,0,4],[0,2,3,4],[3,0,4,5],[0,5,1,4],[0,3,0,4]],
              chorus: [[3,0,4,5],[0,4,5,3],[3,4,0,5],[5,3,0,4],[0,3,4,3],[3,4,5,0]],
              bridge: [[5,3,0,4],[1,4,0,5],[3,4,5,5],[5,4,3,4],[1,2,3,4]] },
    minor:  { verse: [[0,5,2,6],[0,3,4,0],[0,6,5,6],[0,5,3,4],[0,3,6,2],[0,0,5,6],[0,6,5,4]],
              chorus: [[5,2,6,0],[5,6,0,0],[3,5,6,0],[5,3,0,6],[0,5,2,6],[5,6,2,4]],
              bridge: [[3,4,5,6],[5,6,3,4],[2,6,3,4],[3,6,2,5]] },
    dorian: { verse: [[0,3,0,3],[0,6,3,0],[0,1,6,0],[0,3,6,3]], chorus: [[2,3,0,0],[5,6,0,3],[3,6,0,0]], bridge: [[6,5,3,4],[1,2,3,3]] },
    mixolydian: { verse: [[0,6,3,0],[0,4,6,3],[0,6,0,3]], chorus: [[3,6,0,0],[6,3,0,4],[3,0,6,3]], bridge: [[5,3,6,4],[1,6,3,4]] },
    lydian: { verse: [[0,1,0,1],[0,1,4,0],[0,1,5,4]], chorus: [[3,4,0,1],[5,1,0,4],[0,1,3,4]], bridge: [[5,4,1,1],[2,3,4,4]] },
    phrygian: { verse: [[0,1,0,1],[0,1,6,0],[0,6,5,1]], chorus: [[5,6,0,1],[5,1,0,0],[3,1,0,6]], bridge: [[3,4,5,1],[5,6,1,1]] },
    jazzMajor: { verse: [[1,4,0,0],[1,4,0,5],[0,5,1,4],[2,5,1,4],[3,2,1,4]], chorus: [[3,6,2,5],[1,4,2,5],[0,3,1,4]], bridge: [[5,1,4,0],[3,3,2,5],[2,5,1,4]] },
    jazzMinor: { verse: [[0,3,0,3],[1,4,0,0],[0,5,1,4]], chorus: [[5,1,4,0],[3,6,2,5]], bridge: [[3,4,5,4],[2,5,1,4]] }
  };

  // ---------- Drum patterns (16 steps) x=accent o=soft ----------
  const DRUMS = {
    pop: {
      verse:  { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
      chorus: { kick: 'x.....x.x.x.....', snare: '....x.......x...', clap: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo', ohat: '..............x.' },
      bridge: { kick: 'x.........x.....', snare: '....x.......x...', hat: 'x...x...x...x...' },
      intro:  { hat: 'x.o.x.o.x.o.x.o.' }
    },
    rock: {
      verse:  { kick: 'x.....x.x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      chorus: { kick: 'x.x...x.x.x...x.', snare: '....x.......x...', ride: 'x.x.x.x.x.x.x.x.' },
      bridge: { kick: 'x.......x.......', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.' },
      intro:  { kick: 'x.......x.......', hat: 'x.x.x.x.x.x.x.x.' }
    },
    edm: {
      verse:  { kick: 'x...x...x...x...', hat: '..x...x...x...x.', clap: '............x...' },
      chorus: { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.', hat: 'oooooooooooooooo' },
      bridge: { hat: '..x...x...x...x.', clap: '....x.......x...' },
      intro:  { hat: '..x...x...x...x.' }
    },
    hiphop: {
      verse:  { kick: 'x......x.x......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      chorus: { kick: 'x......x.x....x.', snare: '....x.......x...', hat: 'x.x.x.xox.x.x.xo', clap: '....x.......x...' },
      bridge: { kick: 'x.........x.....', snare: '....x.......x...', hat: 'x...x...x...x...' },
      intro:  { hat: 'x.x.x.x.x.x.x.x.' }
    },
    trap: {
      verse:  { kick: 'x......x..x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.' },
      chorus: { kick: 'x.....x...x..x..', snare: '........x.......', clap: '........x.......', hat: 'xoxoxoxoxoxoxoxo' },
      bridge: { kick: 'x...............', snare: '........x.......', hat: 'x...x...x...x...' },
      intro:  { hat: 'x.x.x.x.x.x.x.x.' }
    },
    lofi: {
      verse:  { kick: 'x......x.x......', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
      chorus: { kick: 'x......x.x....o.', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', shaker: '..o...o...o...o.' },
      bridge: { kick: 'x.........x.....', rim: '....x.......x...', hat: 'x...x...x...x...' },
      intro:  { hat: 'o.o.o.o.o.o.o.o.' }
    },
    jazz: {
      verse:  { ride: 'x...x.o.x...x.o.', hatfoot: '....x.......x...', kick: 'o...........o...' },
      chorus: { ride: 'x...x.o.x...x.o.', hatfoot: '....x.......x...', kick: 'o.......o.......', snare: '......o.......o.' },
      bridge: { ride: 'x...x...x...x...', hatfoot: '....x.......x...' },
      intro:  { ride: 'o...o...o...o...' }
    },
    country: {
      verse:  { kick: 'x.......x.......', rim: '....x.......x...', shaker: 'x.o.x.o.x.o.x.o.' },
      chorus: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
      bridge: { kick: 'x...............', rim: '....x.......x...', shaker: 'x.o.x.o.x.o.x.o.' },
      intro:  { shaker: 'x.o.x.o.x.o.x.o.' }
    },
    cinematic: {
      verse:  { boom: 'x...............', hat: '' },
      chorus: { boom: 'x.......x.......', tomlo: '..x..x....x..x..', tomhi: '...........x.x.x', snare: '....x.......x...' },
      bridge: { boom: 'x...............' },
      intro:  {}
    },
    ambient: {
      verse:  { shaker: '........o.......' },
      chorus: { rim: '....o.......o...', shaker: '..o...o...o...o.' },
      bridge: {},
      intro:  {}
    }
  };

  // ---------- helpers ----------
  const mod = (n, m) => ((n % m) + m) % m;
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function makeScaleTools(rootPc, scaleName) {
    const steps = SCALES[scaleName].steps;
    const degToSemis = (d) => 12 * Math.floor(d / 7) + steps[mod(d, 7)];
    return { steps, degToSemis, rootPc };
  }

  function chordPcs(tools, deg, size, scaleName, raiseV) {
    const pcs = [];
    for (let i = 0; i < size; i++) {
      let semis = tools.degToSemis(deg + i * 2);
      // Harmonic-minor dominant: raise the third of V in minor keys
      if (raiseV && mod(deg, 7) === 4 && i === 1 && (scaleName === 'minor')) semis += 1;
      pcs.push(mod(tools.rootPc + semis, 12));
    }
    return pcs;
  }

  // Choose the voicing (inversion/octave) closest to the previous one
  function voiceLead(pcs, prev, lo, hi, center) {
    const cands = [];
    const n = pcs.length;
    for (let inv = 0; inv < n; inv++) {
      const order = pcs.slice(inv).concat(pcs.slice(0, inv));
      for (let base = lo - 12; base <= hi; base++) {
        if (mod(base, 12) !== order[0]) continue;
        const v = [base];
        for (let i = 1; i < n; i++) {
          let x = v[i - 1] + 1;
          while (mod(x, 12) !== order[i]) x++;
          v.push(x);
        }
        if (v[0] < lo || v[n - 1] > hi) continue;
        cands.push(v);
      }
    }
    if (!cands.length) {
      const v = pcs.map(pc => { let x = lo; while (mod(x, 12) !== pc) x++; return x; }).sort((a, b) => a - b);
      return v;
    }
    let best = cands[0], bestCost = Infinity;
    for (const v of cands) {
      let cost = 0;
      if (prev && prev.length) {
        for (const note of v) {
          let m = Infinity; for (const p of prev) m = Math.min(m, Math.abs(note - p));
          cost += m;
        }
        for (const p of prev) { let m = Infinity; for (const note of v) m = Math.min(m, Math.abs(note - p)); cost += m * 0.5; }
      }
      const avg = v.reduce((a, b) => a + b, 0) / v.length;
      cost += Math.abs(avg - center) * 0.6;
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
    return best;
  }

  function nearestChordTone(d, chordDegs) {
    let best = d, bestDist = Infinity;
    for (let o = -4; o <= 4; o++) {
      const c = d + o;
      if (chordDegs.includes(mod(c, 7)) && Math.abs(o) < bestDist) { best = c; bestDist = Math.abs(o); }
    }
    return best;
  }

  // ---------- Section planning ----------
  function planSections(totalBars, genre, rng) {
    let intro = totalBars >= 28 ? 4 : 2;
    let outro = totalBars >= 28 ? 4 : 2;
    const mid = Math.max(2, totalBars - intro - outro);
    const tmpl = ['verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus'];
    while (tmpl.length < 40) tmpl.push('verse', 'chorus', 'bridge', 'chorus');
    let body;
    if (mid < 10) body = [{ name: 'chorus', bars: mid }];
    else {
      // number of sections: even count so the song ends on a chorus; sections of ~8 bars (6..12)
      let K = Math.max(2, Math.round(mid / 8 / 2) * 2);
      while (mid / K > 12) K += 2;
      while (K > 2 && mid / K < 6) K -= 2;
      const base = Math.floor(mid / K / 2) * 2;
      body = tmpl.slice(0, K).map(name => ({ name, bars: base }));
      let rem = mid - base * K;
      // give extra bars to the later sections, choruses first
      const order = body.map((x, i) => i).sort((a, b) => (body[b].name === 'chorus') - (body[a].name === 'chorus') || b - a);
      let k = 0;
      while (rem >= 2 && k < 200) { const i = order[k % order.length]; if (body[i].bars < 12) { body[i].bars += 2; rem -= 2; } k++; }
      outro += rem;
    }
    const sections = [{ name: 'intro', bars: intro }].concat(body, [{ name: 'outro', bars: outro }]);
    for (let k = sections.length - 1; k >= 0; k--) if (sections[k].name === 'chorus') { sections[k].final = true; break; }
    const counts = {};
    for (const s of sections) { counts[s.name] = (counts[s.name] || 0) + 1; s.index = counts[s.name]; }
    for (const s of sections) {
      const cap = s.name[0].toUpperCase() + s.name.slice(1);
      s.label = (counts[s.name] > 1 && s.name !== 'intro' && s.name !== 'outro') ? cap + ' ' + s.index : cap;
    }
    return sections;
  }

  const INTENSITY = { intro: 0.45, verse: 0.7, chorus: 1.0, bridge: 0.6, outro: 0.45 };

  // ---------- Melody motifs ----------
  function makeRhythm(rng, density, syncopation, phraseBars) {
    // returns [{step, len}] over phraseBars bars (16 steps per bar)
    const cells = [
      [[0, 4]], [[0, 2], [2, 2]], [[0, 3], [3, 1]], [[0, 2], [2, 1], [3, 1]], [[0, 1], [1, 1], [2, 2]],
      [[0, 6]], [[0, 8]], [], [[2, 2]], [[1, 3]], [[0, 1], [1, 3]]
    ];
    const weights = (beatPos, isLastBeat) => {
      const d = density;
      if (isLastBeat) return [[0, 2], [7, 3 - d * 1.5], [8, 1 + syncopation], [5, 1]];
      return [
        [0, 2.2 - d], [1, 0.8 + d * 2], [2, 0.6 + d * 0.6], [3, d * 1.4], [4, d * 1.2],
        [5, beatPos % 2 === 0 ? 0.8 - d * 0.4 : 0.1], [6, beatPos === 0 ? 0.5 - d * 0.3 : 0],
        [7, 0.6 - d * 0.4], [8, syncopation * 1.5], [9, syncopation], [10, syncopation * 0.6 + d * 0.3]
      ].map(([k, w]) => [k, Math.max(0.01, w)]);
    };
    const out = [];
    const beats = phraseBars * 4;
    let b = 0;
    while (b < beats) {
      const isLast = b === beats - 1 || b === beats - 2;
      const c = rng.weighted(weights(b % 4, b === beats - 1));
      const cell = cells[c];
      let span = 1;
      for (const [s, l] of cell) span = Math.max(span, Math.ceil((s + l) / 4));
      if (b + span > beats) { b++; continue; }
      for (const [s, l] of cell) out.push({ step: b * 4 + s, len: l });
      b += span;
      if (isLast && out.length && rng.chance(0.6)) {
        // let the final note ring to the end of the phrase
        const last = out[out.length - 1];
        last.len = Math.max(last.len, beats * 4 - last.step - 2);
        break;
      }
    }
    if (!out.length) out.push({ step: 0, len: 8 });
    return out;
  }

  function makeContour(rng, n, rangeTop) {
    const iv = [];
    let pos = 0;
    for (let i = 0; i < n; i++) {
      if (i === 0) { iv.push(0); continue; }
      const arc = i < n * 0.6 ? 0.6 : -0.8; // rise then fall
      const pull = -pos * 0.25;
      const choices = [[-3, 0.4], [-2, 1.1], [-1, 2.4], [0, 1.0], [1, 2.4], [2, 1.2], [3, 0.5], [4, 0.25], [-4, 0.2]];
      const bias = arc + pull;
      const w = choices.map(([s, ww]) => [s, Math.max(0.05, ww * (1 + 0.35 * bias * Math.sign(s)))]);
      let step = rng.weighted(w);
      if (pos + step > rangeTop) step = -Math.abs(step);
      if (pos + step < -rangeTop) step = Math.abs(step);
      pos += step;
      iv.push(step);
    }
    return iv;
  }

  function makeMotif(rng, opts) {
    const rhythm = makeRhythm(rng, opts.density, opts.syncopation, 2);
    const intervals = makeContour(rng, rhythm.length, 5);
    return { rhythm, intervals, start: opts.start };
  }

  // ---------- Main compose ----------
  function compose(params) {
    const rng = makeRng(params.seed ^ 0x9e3779b9);
    const genre = params.genre;
    const prof = Object.assign({}, PROFILES[genre]);
    const tools = makeScaleTools(params.root, params.scale);
    const bpm = params.bpm;
    const beatSec = 60 / bpm;
    const barSec = beatSec * 4;
    const stepSec = beatSec / 4;
    const energy = params.energy;

    // ----- instrument assignment from named instruments -----
    const roles = { chords: prof.chords, pad: prof.pad, lead: prof.lead, bass: prof.bass, arp: prof.arp };
    const named = params.instruments || [];
    const taken = {};
    const assign = (role, inst) => { if (!taken[role]) { roles[role] = inst; taken[role] = true; return true; } return false; };
    for (const n of named) {
      if (n === 'piano') { if (!assign('chords', 'piano')) assign('lead', 'piano'); }
      else if (n === 'epiano') { if (!assign('chords', 'epiano')) assign('lead', 'epiano'); }
      else if (n === 'guitar') { const g = (genre === 'rock' || (genre === 'pop' && energy > 0.7)) ? 'dguitar' : 'guitar'; if (!assign('chords', g)) assign('lead', genre === 'rock' ? 'leadguitar' : 'guitar'); }
      else if (n === 'organ') { if (!assign('chords', 'organ')) assign('pad', 'organ'); }
      else if (n === 'strings') { if (!assign('pad', 'strings')) assign('lead', 'fiddle'); }
      else if (n === 'pad') assign('pad', 'pad');
      else if (n === 'choir') { if (!assign('pad', 'choir')) roles.pad2 = 'choir'; }
      else if (n === 'synth') { if (!assign('lead', genre === 'edm' ? 'supersawlead' : 'synthlead')) assign('arp', 'pluck'); }
      else if (n === 'flute') { if (!assign('lead', 'flute')) assign('arp', 'flute'); }
      else if (n === 'brass') { if (!assign('lead', 'brass')) roles.pad2 = 'brass'; }
      else if (n === 'bell') { if (!assign('arp', 'bell')) assign('lead', 'bell'); }
      else if (n === 'arp') { if (!roles.arp) roles.arp = genre === 'ambient' ? 'bell' : 'pluck'; taken.arp = true; }
      else if (n === 'bass808') { roles.bass = 'bass_808'; }
    }
    // Classical with strings named: give a cello line
    if (genre === 'classical' && named.includes('strings')) roles.bass = 'strings_low';
    if (params.flags && params.flags.melodyOff) roles.lead = null;
    // If a lead instrument would duplicate the chord instrument for piano-led genres keep it; otherwise fine.

    // ----- drums style -----
    let drumStyle = prof.drums;
    if (genre === 'hiphop' && (bpm >= 115 || /trap|drill/.test((params.text || '').toLowerCase()))) drumStyle = 'trap';
    if (params.drums === 'none' || (params.flags && params.flags.noDrums)) drumStyle = null;
    if (!drumStyle && params.drums === 'heavy') drumStyle = 'cinematic';
    if ((genre === 'ambient' || genre === 'classical') && params.drums === 'heavy') drumStyle = 'cinematic';
    const drumGain = params.drums === 'heavy' ? 1.15 : params.drums === 'light' ? 0.65 : 1;
    const halfTimeFeel = drumStyle === 'trap';

    // ----- structure -----
    const minBars = 8;
    let totalBars = Math.round(params.lengthSec / barSec);
    totalBars = Math.max(minBars, totalBars + (totalBars % 2));
    const sections = planSections(totalBars, genre, rng);

    // ----- progressions per section type -----
    let progFamily;
    if (genre === 'jazz') progFamily = (params.scale === 'major' || params.scale === 'lydian' || params.scale === 'mixolydian') ? 'jazzMajor' : 'jazzMinor';
    else if (params.scale === 'harmonicMinor') progFamily = 'minor';
    else progFamily = PROGS[params.scale] ? params.scale : 'major';
    const fam = PROGS[progFamily];
    const progs = {
      verse: rng.pick(fam.verse),
      chorus: rng.pick(fam.chorus),
      bridge: rng.pick(fam.bridge)
    };
    if (progs.chorus.join() === progs.verse.join() && fam.chorus.length > 1) progs.chorus = fam.chorus[(fam.chorus.indexOf(progs.chorus) + 1) % fam.chorus.length];
    progs.intro = progs.verse; progs.outro = rng.chance(0.5) ? progs.chorus : progs.verse;
    const raiseV = (params.scale === 'minor' && (params.mood === 'dark' || params.mood === 'epic' || genre === 'classical' || genre === 'jazz')) || params.scale === 'harmonicMinor';

    // ----- key lift for final chorus -----
    const lift = (['pop', 'country', 'rock'].includes(genre) && sections.filter(s => s.name === 'chorus').length >= 3 && rng.chance(0.45)) ? (rng.chance(0.7) ? 2 : 1) : 0;

    // ----- motifs (one per section type, reused for hooks) -----
    const baseDensity = clamp(0.25 + energy * 0.5 + (genre === 'jazz' ? 0.15 : 0) + (genre === 'ambient' ? -0.25 : 0) + (genre === 'classical' ? 0.1 : 0), 0.08, 0.9);
    const sync = ({ hiphop: 0.6, lofi: 0.45, jazz: 0.7, edm: 0.4, pop: 0.35, rock: 0.25, country: 0.15, cinematic: 0.1, classical: 0.05, ambient: 0.05 })[genre];
    const motifs = {
      verseA: makeMotif(rng, { density: baseDensity * 0.8, syncopation: sync, start: rng.pick([0, 2, 4]) }),
      verseB: makeMotif(rng, { density: baseDensity * 0.85, syncopation: sync, start: rng.pick([1, 3, 4]) }),
      chorusA: makeMotif(rng, { density: clamp(baseDensity * 1.05, 0.1, 0.95), syncopation: sync * 0.8, start: rng.pick([4, 5, 7]) }),
      chorusB: makeMotif(rng, { density: baseDensity, syncopation: sync * 0.8, start: rng.pick([2, 4, 6]) }),
      bridgeA: makeMotif(rng, { density: baseDensity * 0.6, syncopation: sync * 0.5, start: rng.pick([3, 5]) }),
      bridgeB: makeMotif(rng, { density: baseDensity * 0.6, syncopation: sync * 0.5, start: rng.pick([1, 2, 4]) })
    };

    // Lead register: tonic around C5..B5, keep melody roughly 64..86
    const leadBase = (60 + params.root > 67) ? 48 + params.root : 60 + params.root; // degree 0 of melody (G#3..G4 -> sits mid register)
    const leadInst = roles.lead || 'guide';
    const leadOct = (roles.lead === 'brass' || roles.lead === 'sax' || roles.lead === 'leadguitar' || roles.lead === 'fiddle') ? -12 : 0;

    const notes = [];
    const hits = [];
    const chordTimeline = [];
    let prevVoicing = null;
    let prevBass = null;

    const swing = params.flags && params.flags.swing ? Math.max(prof.swing, 0.2) : prof.swing;
    const timeOf = (barStart, step) => {
      let t = barStart + step * stepSec;
      if (swing > 0) {
        if (genre === 'jazz' || swing >= 0.3) { if (mod(step, 4) === 2) t += stepSec * 0.66 * (swing / 0.33); }
        else if (step % 2 === 1) t += stepSec * swing;
      }
      return t;
    };
    const human = (ms) => (rng() + rng() - 1) * ms / 1000;
    const pushNote = (n) => { if (n.d > 0.01 && n.t >= 0) notes.push(n); };

    let bar = 0;
    let liftActive = 0;
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      sec.startBar = bar; sec.startSec = bar * barSec; sec.endSec = (bar + sec.bars) * barSec;
      sec.intensity = INTENSITY[sec.name] * (sec.final ? 1.08 : 1);
      if (sec.final && lift) liftActive = lift;
      const transpose = liftActive;
      const prog = progs[sec.name];
      const bpc = (genre === 'ambient' || (genre === 'cinematic' && sec.name === 'intro')) ? 2 : prof.barsPerChord;
      const nextSec = sections[si + 1];
      const vel = sec.intensity;

      // per-section melody plan
      let phrasePlan = null;
      if (sec.name !== 'intro') {
        const A = motifs[(sec.name === 'outro' ? 'chorus' : sec.name) + 'A'];
        const B = motifs[(sec.name === 'outro' ? 'chorus' : sec.name) + 'B'];
        if (sec.name === 'chorus') phrasePlan = [A, A, A, B];
        else if (sec.name === 'verse') phrasePlan = [A, B, A, B];
        else if (sec.name === 'bridge') phrasePlan = [A, B, A, B];
        else phrasePlan = [A, null];
      }

      for (let b = 0; b < sec.bars; b++, bar++) {
        const barStart = bar * barSec;
        const ci = Math.floor(b / bpc) % prog.length;
        const deg = prog[ci];
        const nextDeg = prog[(Math.floor((b + 1) / bpc)) % prog.length];
        const size = (rng() < prof.sevenths) ? 4 : 3;
        const addNine = rng() < prof.ninths && size === 4;
        let pcs = chordPcs(tools, deg, size, params.scale, raiseV).map(pc => mod(pc + transpose, 12));
        if (addNine) pcs = pcs.slice(0, 1).concat(pcs.slice(1)).concat([mod(params.root + tools.degToSemis(deg + 8) + transpose, 12)]).filter((v, i, a) => i < 4 ? true : true);
        // For 5-note chords drop the fifth to keep voicing tight
        if (pcs.length > 4) pcs.splice(2, 1);
        const rootPc = pcs[0];
        const isBarStartOfChord = b % bpc === 0;
        const voicing = voiceLead(pcs, prevVoicing, 50, 77, 62);
        prevVoicing = voicing;
        let bassRoot = 28 + mod(rootPc - 4, 12); // E1..D#2 region -> raise to octave 2
        bassRoot += 12; // 40..51
        if (bassRoot > 47) bassRoot -= 12;
        const fifth = bassRoot + 7;
        chordTimeline.push({ bar, deg, pcs, voicing, bassRoot, section: sec.label });

        const chordDegs = [];
        for (let i = 0; i < size; i++) chordDegs.push(mod(deg + i * 2, 7));
        const isLastBar = b === sec.bars - 1;
        const sn = sec.name;

        // ---------- Chords / comping ----------
        const ci_ = roles.chords;
        if (ci_ && isBarStartOfChord) {
          const strumAll = (t, d, v, spread) => voicing.forEach((m, i) => pushNote({ t: t + i * spread + human(4), d, inst: ci_, m, v: v * (0.9 + rng() * 0.15) }));
          const compStyle = prof.comp;
          const chordDur = barSec * bpc;
          const cv = 0.42 * vel;
          if (compStyle === 'alberti') {
            const lh = voiceLead(pcs.slice(0, 3), null, 43, 62, 52);
            const pat = genre === 'classical' && bpm > 96 ? [0, 2, 1, 2] : [0, 2, 1, 2, 0, 2, 1, 2];
            const stepLen = 16 / pat.length / (bpm > 96 ? 1 : 1);
            const reps = sn === 'intro' || sn === 'outro' ? 1 : 2;
            for (let r = 0; r < 16 / (stepLen * pat.length) * reps && r < 2; r++) { /* placeholder to keep loop simple */ }
            const nPer = pat.length * (16 / (stepLen * pat.length));
            for (let k = 0; k < 16 / stepLen; k++) {
              const m = lh[pat[k % pat.length]];
              pushNote({ t: timeOf(barStart, k * stepLen) + human(6), d: stepLen * stepSec * 1.6, inst: 'piano', m, v: (k % pat.length === 0 ? 0.42 : 0.3) * vel * (0.9 + rng() * 0.2) });
            }
            pushNote({ t: barStart + human(5), d: barSec, inst: 'piano', m: bassRoot, v: 0.38 * vel });
            void nPer;
          } else if (compStyle === 'pop' || compStyle === 'cinematic') {
            if (sn === 'chorus' && compStyle === 'pop') { [0, 6, 10].forEach(s => strumAll(timeOf(barStart, s), stepSec * (s === 0 ? 5.5 : 3.5), cv, 0.006)); strumAll(timeOf(barStart, 12), stepSec * 4, cv * 0.8, 0.006); }
            else if (compStyle === 'cinematic' && (sn === 'chorus' || sn === 'bridge')) strumAll(barStart, barSec * 0.95, cv * 0.8, 0.01);
            else if (sn === 'verse' && compStyle === 'pop') { strumAll(barStart, beatSec * 1.4, cv, 0.008); strumAll(timeOf(barStart, 6), beatSec * 1.4, cv * 0.75, 0.008); strumAll(timeOf(barStart, 12), beatSec * 0.9, cv * 0.7, 0.008); }
            else strumAll(barStart, chordDur * 0.98, cv * 0.85, 0.012);
          } else if (compStyle === 'lofi' || compStyle === 'hiphop') {
            strumAll(barStart + 0.012, beatSec * 2.6, cv, 0.018);
            if (sn !== 'intro' && rng.chance(0.7)) strumAll(timeOf(barStart, 10), beatSec * 1.4, cv * 0.7, 0.016);
            if (bpc > 1) strumAll(barStart + barSec, beatSec * 3, cv * 0.85, 0.018);
          } else if (compStyle === 'jazz') {
            const rhythms = [[0, 6], [[6, 2]], [[0, 3], [6, 2]], [[2, 2], [10, 4]], [[0, 2], [6, 4], [14, 2]], [[4, 2], [10, 2]]];
            const pick = rng.pick([[[0, 4], [6, 3]], [[2, 3], [10, 4]], [[0, 3], [14, 2]], [[4, 3], [10, 3]], [[0, 6], [11, 3]]]);
            void rhythms;
            for (const [s, l] of pick) strumAll(timeOf(barStart, s), stepSec * l, cv * 0.9, 0.006);
          } else if (compStyle === 'rock') {
            // power chords: root, fifth, octave, chugging eighths
            let r = 40 + mod(rootPc - 4, 12); if (r > 50) r -= 12;
            const pc = [r, r + 7, r + 12];
            const pat = sn === 'verse' ? [0, 2, 4, 6, 8, 10, 12, 14] : sn === 'chorus' ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 8];
            for (const s of pat) {
              const len = sn === 'bridge' || sn === 'intro' || sn === 'outro' ? 7.5 : (sn === 'verse' ? 1.6 : 1.9);
              const accent = s % 4 === 0 ? 1 : 0.8;
              pc.forEach((m, i) => pushNote({ t: timeOf(barStart, s) + i * 0.004 + human(4), d: stepSec * len, inst: 'dguitar', m, v: cv * accent * (sn === 'verse' ? 0.8 : 1) }));
            }
          } else if (compStyle === 'country') {
            // boom-chick strums on 2 and 4 plus eighth upstrokes in chorus
            const pat = sn === 'chorus' ? [[4, 1, 1], [6, -1, 0.6], [12, 1, 1], [14, -1, 0.6]] : [[4, 1, 1], [12, 1, 1]];
            if (sn === 'intro' || sn === 'outro') pat.unshift([0, 1, 0.9]);
            for (const [s, dir, a] of pat) {
              const vv = dir > 0 ? voicing : voicing.slice().reverse();
              vv.forEach((m, i) => pushNote({ t: timeOf(barStart, s) + i * 0.012 + human(4), d: beatSec * 0.9, inst: ci_, m, v: cv * a }));
            }
          } else if (compStyle === 'edm') {
            if (sn === 'chorus') { [2, 6, 10, 14].forEach(s => strumAll(timeOf(barStart, s), stepSec * 1.6, cv * 0.9, 0)); }
            else if (sn === 'verse') { [0, 3, 6, 10].forEach(s => strumAll(timeOf(barStart, s), stepSec * 1.8, cv * 0.65, 0)); }
            else strumAll(barStart, chordDur * 0.98, cv * 0.6, 0);
          } else {
            strumAll(barStart, chordDur * 0.98, cv, 0.01);
          }
        }

        // ---------- Pad ----------
        if (roles.pad && isBarStartOfChord && !(sn === 'verse' && genre === 'rock') && !(genre === 'country' && sn === 'verse')) {
          const pv = (sn === 'chorus' ? 0.32 : sn === 'verse' ? 0.22 : 0.26) * (genre === 'ambient' || genre === 'cinematic' ? 1.25 : 1);
          const padVoicing = voiceLead(pcs, null, 55, 79, roles.pad === 'strings' ? 64 : 62);
          if (!(genre === 'pop' && sn === 'verse' && b < 4) || genre !== 'pop')
            padVoicing.forEach(m => pushNote({ t: barStart + 0.005, d: barSec * bpc + 0.05, inst: roles.pad, m: m + (roles.pad === 'strings' && sn === 'chorus' ? 0 : 0), v: pv }));
          if (roles.pad === 'strings' && sn === 'chorus') pushNote({ t: barStart, d: barSec * bpc, inst: 'strings', m: padVoicing[padVoicing.length - 1] + 12, v: pv * 0.6 });
        }
        if (roles.pad2 && isBarStartOfChord && (sn === 'chorus' || sn === 'bridge' || genre === 'ambient')) {
          const v2 = voiceLead(pcs.slice(0, 3), null, 57, 76, 66);
          v2.forEach(m => pushNote({ t: barStart + 0.01, d: barSec * bpc, inst: roles.pad2, m, v: 0.24 }));
        }

        // ---------- Bass ----------
        if (roles.bass && !(sn === 'intro' && b < sec.bars - 2 && genre !== 'ambient' && genre !== 'cinematic' && genre !== 'jazz')) {
          const bi = roles.bass;
          const bv = 0.62 * Math.min(1, vel + 0.15);
          let pattern;
          const nextRoot = (() => { const pcsN = chordPcs(tools, nextDeg, 3, params.scale, raiseV); let r = 28 + mod(pcsN[0] + transpose - 4, 12) + 12; if (r > 47) r -= 12; return r; })();
          if (bi === 'bass_upright' || genre === 'jazz') {
            // walking bass
            const tones = [bassRoot, bassRoot + (pcs[1] - pcs[0] + 12) % 12, bassRoot + 7, bassRoot + (pcs[2] !== undefined ? (pcs[2] - pcs[0] + 12) % 12 : 7)];
            const walk = [bassRoot, rng.pick([tones[1], tones[2], bassRoot + 12]), rng.pick([tones[2], tones[3], tones[1] + 0]), nextRoot + rng.pick([-1, 1, 2, -2])];
            walk.forEach((m, k) => pushNote({ t: timeOf(barStart, k * 4) + human(5), d: beatSec * 0.92, inst: 'bass_upright', m: clamp(m, 28, 55), v: bv * (k === 0 ? 1 : 0.85) }));
          } else {
            if (bi === 'bass_808') pattern = halfTimeFeel ? [[0, 7, 'r'], [7, 3, 'r'], [10, 6, 'r']] : [[0, 6, 'r'], [7, 3, 'r'], [10, 5, 'r']];
            else if (genre === 'edm') pattern = sn === 'chorus' ? [[2, 2, 'r'], [6, 2, 'r'], [10, 2, 'r'], [14, 2, 'o']] : [[2, 2, 'r'], [6, 2, 'r'], [10, 2, 'r'], [14, 2, 'r']];
            else if (genre === 'rock') pattern = [0, 2, 4, 6, 8, 10, 12, 14].map(s => [s, 1.8, 'r']);
            else if (genre === 'country') pattern = sn === 'chorus' ? [[0, 3.5, 'r'], [8, 3.5, '5'], [12, 2, 'r'], [14, 2, 'a']] : [[0, 3.5, 'r'], [8, 3.5, '5']];
            else if (genre === 'lofi' || genre === 'hiphop') pattern = [[0, 6, 'r'], [7, 2, '5'], [10, 5, 'r'], [15, 1, 'a']];
            else if (genre === 'ambient') pattern = b % bpc === 0 ? [[0, 16 * bpc, 'r']] : [];
            else if (genre === 'cinematic') pattern = sn === 'chorus' ? [0, 2, 4, 6, 8, 10, 12, 14].map(s => [s, 1.8, s % 8 === 0 ? 'r' : (s === 6 || s === 14 ? 'o' : 'r')]) : [[0, 16, 'r']];
            else if (genre === 'classical') pattern = [[0, 8, 'r'], [8, 8, '5']];
            else pattern = sn === 'chorus' ? [[0, 3, 'r'], [3, 3, 'r'], [6, 2, 'r'], [8, 3, 'r'], [11, 3, 'r'], [14, 2, 'o']] : [[0, 6, 'r'], [6, 2, 'r'], [8, 6, 'r'], [14, 2, '5']];
            if (sn === 'bridge' && genre !== 'ambient') pattern = pattern.filter(([s]) => s % 8 === 0 || s === 10);
            if (sn === 'outro' && isLastBar) pattern = [[0, 16, 'r']];
            if (genre === 'ambient' && !isBarStartOfChord) pattern = [];
            for (const [s, l, w] of pattern) {
              let m = w === 'r' ? bassRoot : w === '5' ? fifth : w === 'o' ? bassRoot + 12 : nextRoot - 1;
              if (w === 'a' && rng.chance(0.5)) m = nextRoot + 2;
              const glide = bi === 'bass_808' && rng.chance(0.18) && s === 10 ? bassRoot + 12 : null;
              pushNote({ t: timeOf(barStart, s) + human(3), d: stepSec * l * 0.95, inst: bi, m: clamp(m, 26, 58), v: bv * (s === 0 ? 1 : 0.85), glide });
            }
          }
        }

        // ---------- Arp ----------
        const arpOn = roles.arp && (sn === 'chorus' || (genre === 'cinematic' && sn !== 'outro') || genre === 'ambient' || (sn === 'bridge' && rng.chance(0.5)) || (genre === 'edm' && sn !== 'verse'));
        if (arpOn) {
          const ai = roles.arp;
          const tones = voiceLead(pcs.slice(0, 3), null, 62, 80, 69);
          const seq = tones.concat([tones[0] + 12, tones[1] + 12]);
          if (genre === 'ambient') {
            const n = rng.int(2, 4);
            for (let k = 0; k < n; k++) {
              const s = rng.int(0, 7) * 2;
              pushNote({ t: timeOf(barStart, s) + human(10), d: beatSec * 2.5, inst: ai, m: rng.pick(seq) + 12, v: 0.2 + rng() * 0.08 });
            }
          } else {
            const sixteenth = genre === 'edm' || genre === 'pop';
            const stepEvery = sixteenth ? 1 : 2;
            const pattern = rng.pick([[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [0, 1, 2, 1, 3, 2, 4, 2]]);
            for (let s = 0, k = 0; s < 16; s += stepEvery, k++) {
              const m = seq[pattern[k % pattern.length]] + (ai === 'piano' ? 0 : 0);
              pushNote({ t: timeOf(barStart, s) + human(3), d: stepSec * stepEvery * 0.9, inst: ai, m, v: (0.2 + (s % 4 === 0 ? 0.06 : 0)) * vel });
            }
          }
        }

        // ---------- Drums ----------
        if (drumStyle) {
          const kit = DRUMS[drumStyle];
          let pat = kit[sn] || kit.verse;
          if (sn === 'outro') pat = isLastBar ? { kick: 'x...............', crash: 'x...............' } : (kit.bridge || kit.verse);
          if (sn === 'intro' && b >= sec.bars - 2 && kit.verse.kick && (genre === 'edm' || genre === 'pop' || genre === 'rock')) pat = Object.assign({}, kit.intro, { kick: kit.verse.kick });
          const fillBar = isLastBar && nextSec && nextSec.name === 'chorus' && sn !== 'intro';
          const lanes = Object.assign({}, pat);
          if (fillBar) {
            if (drumStyle === 'edm') { lanes.snare = 'x.x.x.x.xxxxxxxx'; lanes.kick = 'x...x...x...x...'; hits.push({ t: barStart, kind: 'riser', v: 0.5, d: barSec }); }
            else if (drumStyle === 'rock' || drumStyle === 'pop' || drumStyle === 'country') { lanes.snare = (pat.snare || '....x.......x...').slice(0, 12) + 'xoxx'; if (drumStyle === 'rock') { lanes.tomhi = '............x.x.'; lanes.tomlo = '.............x.x'; lanes.snare = '....x.......x...'; } }
            else if (drumStyle === 'trap' || drumStyle === 'hiphop') { lanes.hat = (pat.hat || '').slice(0, 8) + 'xxxxxxxx'; }
            else if (drumStyle === 'cinematic') { lanes.snare = '........xoxoxxxx'; lanes.tomlo = 'x..x..x.x.x.x.xx'; }
            else if (drumStyle === 'lofi') { lanes.snare = '....x.......x.oo'; }
          }
          if (b === 0 && (sn === 'chorus' || (sn === 'outro' && sec.bars > 1)) && drumStyle !== 'lofi' && drumStyle !== 'jazz' && drumStyle !== 'ambient') hits.push({ t: barStart, kind: 'crash', v: 0.55 * drumGain });
          if (b === 0 && sn === 'chorus' && drumStyle === 'jazz') hits.push({ t: barStart, kind: 'crash', v: 0.28 });
          for (const lane of Object.keys(lanes)) {
            const str = lanes[lane];
            if (!str) continue;
            for (let s = 0; s < 16; s++) {
              const ch = str[s];
              if (ch !== 'x' && ch !== 'o') continue;
              let v = ch === 'x' ? 1 : 0.5;
              if (lane === 'hat' || lane === 'shaker') v *= (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.8 : 0.6);
              if (fillBar && lane === 'snare' && drumStyle === 'edm') v *= 0.4 + 0.6 * (s / 15);
              v *= (0.85 + rng() * 0.25) * drumGain * (0.75 + 0.25 * vel);
              let t = timeOf(barStart, s) + human(lane === 'kick' ? 3 : 6);
              hits.push({ t, kind: lane, v: Math.min(1.1, v) });
              // trap hat rolls
              if (drumStyle === 'trap' && lane === 'hat' && s % 4 === 2 && rng.chance(sn === 'chorus' ? 0.22 : 0.1)) {
                const n = rng.pick([2, 3, 4]);
                for (let r = 1; r < n; r++) hits.push({ t: t + r * stepSec / n, kind: 'hat', v: v * 0.7 });
              }
            }
          }
          // jazz ghost notes
          if (drumStyle === 'jazz' && sn !== 'intro') for (let s = 2; s < 16; s += 4) if (rng.chance(0.25)) hits.push({ t: timeOf(barStart, s + 0) + human(6), kind: 'snare', v: 0.18 });
          // sidechain markers come from kick hits (handled by synth)
        }
        // Vinyl / rain flags handled as ambience by synth
      }

      // ---------- Melody for the section ----------
      if (phrasePlan) {
        const lv = (sec.name === 'chorus' ? 0.6 : sec.name === 'verse' ? 0.48 : 0.45) * (sec.final ? 1.06 : 1);
        const octShift = sec.name === 'chorus' ? 0 : sec.name === 'bridge' ? 0 : -0;
        const phrases = Math.floor(sec.bars / 2);
        let lastDeg = null;
        for (let ph = 0; ph < phrases; ph++) {
          const motif = phrasePlan[ph % phrasePlan.length];
          if (!motif) continue;
          if (sec.name === 'outro' && ph > 0) break;
          const phraseStartBar = sec.startBar + ph * 2;
          const isVariation = ph >= 2 || sec.index > 1;
          let d = motif.start + (sec.name === 'chorus' ? 0 : 0);
          if (lastDeg !== null && ph % 2 === 1 && Math.abs(lastDeg - d) > 4) d = lastDeg + Math.sign(d - lastDeg) * 2;
          const isLastPhrase = ph === phrases - 1;
          for (let i = 0; i < motif.rhythm.length; i++) {
            const r = motif.rhythm[i];
            let step = motif.intervals[i];
            if (isVariation && i > 0 && rng.chance(0.18)) step += rng.pick([-1, 1]);
            if (i > 0) d += step;
            const absStep = r.step;
            const barIdx = phraseStartBar + Math.floor(absStep / 16);
            const ct = chordTimeline[barIdx];
            if (!ct) continue;
            const cdeg = [];
            for (let k = 0; k < 3; k++) cdeg.push(mod(ct.deg + k * 2, 7));
            const strong = absStep % 8 === 0 || r.len >= 6;
            if (strong) d = nearestChordTone(d, cdeg);
            // final note of a section resolves
            const lastNote = i === motif.rhythm.length - 1;
            if (lastNote && isLastPhrase) {
              const targets = sec.name === 'chorus' || sec.name === 'outro' ? [0, 2, 4] : cdeg;
              let best = d, bd = 99; for (let o = -3; o <= 3; o++) if (targets.includes(mod(d + o, 7)) && Math.abs(o) < bd) { bd = Math.abs(o); best = d + o; }
              d = best;
            }
            // range guard (degrees relative to leadBase)
            const lo = sec.name === 'chorus' ? 2 : 0, hi = sec.name === 'chorus' ? 11 : 9;
            while (d > hi) d -= 7; while (d < lo) d += 7;
            let semis = tools.degToSemis(d);
            if (raiseV && params.scale === 'minor' && mod(d, 7) === 6 && cdeg.includes(1) && cdeg.includes(4) && mod(ct.deg, 7) === 4) semis += 1; // leading tone over V
            const m = leadBase + semis + leadOct + octShift + transpose;
            const t = timeOf(sec.startSec + ph * 2 * barSec, absStep) + human(9);
            const dur = r.len * stepSec * (genre === 'jazz' || genre === 'hiphop' ? 0.85 : 0.95);
            const accent = (absStep % 16 === 0 ? 1.05 : absStep % 4 === 0 ? 0.95 : 0.82);
            pushNote({ t, d: dur, inst: leadInst, m, v: lv * accent * (0.92 + rng() * 0.14), sec: si, ph, secName: sec.name });
            // doubled octave lift in the final chorus
            if (roles.lead && sec.final && sec.name === 'chorus' && m + 12 <= 90 && (genre === 'pop' || genre === 'edm' || genre === 'cinematic')) pushNote({ t: t + 0.003, d: dur, inst: roles.lead === 'brass' ? 'strings' : roles.lead, m: m + 12, v: lv * accent * 0.35 });
            lastDeg = d;
          }
        }
      }
    }

    const songSec = bar * barSec;
    // Final ringing chord
    if (prevVoicing) {
      const fin = roles.pad || roles.chords || 'pad';
      prevVoicing.forEach(m => pushNote({ t: songSec, d: barSec * 0.9, inst: fin, m, v: 0.18 }));
    }

    notes.sort((a, b) => a.t - b.t);
    hits.sort((a, b) => a.t - b.t);

    const fx = {
      reverbSec: prof.reverb[0], reverbMix: prof.reverb[1], delayMix: prof.delay,
      delayTime: beatSec * (genre === 'ambient' ? 1.5 : 0.75), lofi: !!prof.lofi || !!(params.flags && params.flags.vinyl),
      vinyl: !!(params.flags && params.flags.vinyl), rain: !!(params.flags && params.flags.rain), sidechain: !!prof.sidechain && !!drumStyle,
      brightness: clamp(0.4 + energy * 0.5, 0.3, 1)
    };

    const usedInsts = {};
    for (const n of notes) usedInsts[n.inst] = true;
    const layers = Object.keys(usedInsts).filter(k => k !== 'guide').map(k => INSTRUMENT_LABELS[k] || k);
    if (drumStyle) layers.push('Drums');

    return {
      params, bpm, beatSec, barSec, stepSec, totalBars: bar, songSec, totalSec: songSec + barSec + Math.min(4, fx.reverbSec * 0.8),
      sections: sections.map(s => ({ name: s.name, label: s.label, startBar: s.startBar, bars: s.bars, startSec: s.startSec, endSec: s.endSec, final: !!s.final })),
      chords: chordTimeline, notes, hits, roles, drumStyle, fx, lift, layers,
      progression: { verse: progs.verse, chorus: progs.chorus, bridge: progs.bridge }
    };
  }

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  function progressionLabel(prog, scaleName) {
    const steps = SCALES[scaleName].steps;
    return prog.map(d => {
      const third = (steps[(d + 2) % 7] - steps[d % 7] + 12) % 12;
      const fifth = (steps[(d + 4) % 7] - steps[d % 7] + 12) % 12;
      let r = ROMAN[d % 7];
      if (third === 3) r = r.toLowerCase();
      if (fifth === 6) r += '°';
      return r;
    }).join('–');
  }

  const api = { compose, PROFILES, INSTRUMENT_LABELS, progressionLabel, planSections, voiceLead };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SongComposer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
