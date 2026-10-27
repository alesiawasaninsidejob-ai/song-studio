/* Song Studio — Web Audio synthesis engine: instruments, drums, singing voice, effects, player and offline render. */
(function (root) {
  'use strict';

  const AC = root.AudioContext || root.webkitAudioContext;
  const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- Formant tables (Hz) ----------
  const VOWELS = {
    aa: [730, 1090, 2440], ae: [660, 1720, 2410], uh: [620, 1190, 2390], e: [530, 1840, 2480], ih: [400, 1950, 2550],
    i: [290, 2250, 3000], o: [520, 860, 2410], u: [320, 870, 2240], er: [490, 1350, 1690], l: [360, 1100, 2600], m: [280, 1100, 2400]
  };
  const DIPH = { ai: ['aa', 'i'], ei: ['e', 'i'], au: ['aa', 'u'], o: ['o', 'u'] };
  const F_GAIN = { i: [1, 0.32, 0.38], ih: [1, 0.42, 0.32], e: [1, 0.5, 0.3], u: [1, 0.35, 0.1], o: [1, 0.5, 0.15] };

  // ---------- Graph ----------
  function makeNoise(ctx, sec) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
    return b;
  }
  function makeImpulse(ctx, sec, damp) {
    const sr = ctx.sampleRate, len = Math.floor(sr * sec), pre = Math.floor(sr * 0.012);
    const b = ctx.createBuffer(2, len + pre, sr);
    let seed = 987654;
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const n = (seed / 4294967296) * 2 - 1;
        const t = i / len;
        const coef = 0.15 + 0.8 * (1 - Math.pow(t, 0.6)) * (1 - damp * 0.5); // darker over time
        lp += coef * (n - lp);
        // early reflections
        const er = i < sr * 0.08 && (i % Math.floor(sr * (0.011 + ch * 0.003)) < 3) ? 0.6 : 0;
        d[i + pre] = (lp + er * n) * Math.exp(-t * 6.5);
      }
    }
    return b;
  }
  function makeCurve(amount) {
    const n = 1024, c = new Float32Array(n), k = amount;
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    return c;
  }
  function wave(ctx, harmonics) {
    const real = new Float32Array(harmonics.length + 1), imag = new Float32Array(harmonics.length + 1);
    harmonics.forEach((h, i) => { imag[i + 1] = h; });
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }
  function panner(ctx, pan) {
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; return p; }
    const g = ctx.createGain(); return g; // old Safari fallback: mono
  }

  function createGraph(ctx, song, opts) {
    opts = opts || {};
    const fx = song.fx;
    const g = { ctx, song, opts, sources: [] };
    g.noise = makeNoise(ctx, 2.5);
    g.waves = {
      piano: wave(ctx, [1, 0.55, 0.32, 0.22, 0.12, 0.09, 0.06, 0.05, 0.03, 0.02]),
      organ: wave(ctx, [1, 0.8, 0.5, 0.65, 0.2, 0.35, 0, 0.25, 0, 0, 0, 0.12]),
      glottal: wave(ctx, Array.from({ length: 40 }, (_, i) => 1 / Math.pow(i + 1, 1.15) * (i % 2 ? 0.92 : 1))),
      reed: wave(ctx, [1, 0.25, 0.6, 0.18, 0.4, 0.12, 0.25, 0.08, 0.15, 0.05])
    };

    // master chain
    const out = opts.destination || ctx.destination;
    g.master = ctx.createGain(); g.master.gain.value = opts.masterGain || 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 2; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 8; glue.ratio.value = 2.5; glue.attack.value = 0.015; glue.release.value = 0.2;
    g.mix = ctx.createGain(); g.mix.gain.value = 0.8;
    let tail = g.mix;
    if (fx.lofi) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4800; lp.Q.value = 0.5;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
      const wow = ctx.createDelay(0.05); wow.delayTime.value = 0.006;
      const wowLfo = ctx.createOscillator(); wowLfo.frequency.value = 0.55;
      const wowAmt = ctx.createGain(); wowAmt.gain.value = 0.0009;
      wowLfo.connect(wowAmt); wowAmt.connect(wow.delayTime); wowLfo.start(0); g.sources.push(wowLfo);
      tail.connect(hp); hp.connect(lp); lp.connect(wow); tail = wow;
    }
    tail.connect(glue); glue.connect(g.master); g.master.connect(limiter);
    limiter.connect(out);
    g.output = limiter;
    if (opts.analyser) { g.analyser = ctx.createAnalyser(); g.analyser.fftSize = 2048; g.analyser.smoothingTimeConstant = 0.78; limiter.connect(g.analyser); }

    // reverb + delay
    g.reverb = ctx.createConvolver(); g.reverb.buffer = makeImpulse(ctx, fx.reverbSec, fx.lofi ? 0.8 : 0.4);
    const revRet = ctx.createGain(); revRet.gain.value = 1;
    const revHp = ctx.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 200;
    g.reverbIn = ctx.createGain(); g.reverbIn.connect(revHp); revHp.connect(g.reverb); g.reverb.connect(revRet); revRet.connect(glue);
    g.delayIn = ctx.createGain();
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2);
    dl.delayTime.value = fx.delayTime; dr.delayTime.value = fx.delayTime * 1.5;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3200;
    const pl = panner(ctx, -0.5), pr = panner(ctx, 0.5);
    g.delayIn.connect(dlp); dlp.connect(dl); dl.connect(fb); fb.connect(dlp); dl.connect(pl); dl.connect(dr); dr.connect(pr);
    const dRet = ctx.createGain(); dRet.gain.value = 0.7; pl.connect(dRet); pr.connect(dRet); dRet.connect(glue); dRet.connect(g.reverbIn);

    // buses
    const mkBus = (name, gain, rev, del, pan) => {
      const b = ctx.createGain(); b.gain.value = gain;
      const p = panner(ctx, pan || 0);
      b.connect(p); p.connect(g.mix);
      const rs = ctx.createGain(); rs.gain.value = rev; p.connect(rs); rs.connect(g.reverbIn);
      const ds = ctx.createGain(); ds.gain.value = del; p.connect(ds); ds.connect(g.delayIn);
      return b;
    };
    const R = fx.reverbMix, D = fx.delayMix;
    g.duck = ctx.createGain(); g.duck.connect(g.mix);
    g.bus = {
      drums: mkBus('drums', 0.85, R * 0.35, 0, 0),
      bass: mkBus('bass', 0.85, R * 0.08, 0, 0),
      chords: mkBus('chords', 0.7, R, D * 0.3, -0.12),
      pad: mkBus('pad', 0.55, R * 1.3, D * 0.4, 0.15),
      lead: mkBus('lead', 0.62, R * 0.9, D, 0.05),
      arp: mkBus('arp', 0.5, R * 1.1, D * 1.3, 0.25),
      vocal: null
    };
    if (fx.sidechain) {
      // re-route chords/pad/arp through ducking gain
      for (const k of ['chords', 'pad', 'arp']) {
        const b = ctx.createGain(); b.gain.value = g.bus[k].gain.value;
        b.connect(g.duck); const rs = ctx.createGain(); rs.gain.value = R; b.connect(rs); rs.connect(g.reverbIn);
        const ds = ctx.createGain(); ds.gain.value = D * 0.6; b.connect(ds); ds.connect(g.delayIn);
        g.bus[k] = b;
      }
    }
    // distortion buses
    const dist = (amount, lpf) => {
      const inG = ctx.createGain(); inG.gain.value = 1;
      const ws = ctx.createWaveShaper(); ws.curve = makeCurve(amount); ws.oversample = '2x';
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpf; lp.Q.value = 0.9;
      const peak = ctx.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 1600; peak.gain.value = 3;
      const o = ctx.createGain(); o.gain.value = 0.22;
      inG.connect(hp); hp.connect(ws); ws.connect(peak); peak.connect(lp); lp.connect(o);
      return { input: inG, output: o };
    };
    const dg = dist(12, 3800); dg.output.connect(g.bus.chords); g.dguitar = dg.input;
    const lg = dist(18, 4200); lg.output.connect(g.bus.lead); g.leadDist = lg.input;
    const sat = ctx.createWaveShaper(); sat.curve = makeCurve(2.5); const satOut = ctx.createGain(); satOut.gain.value = 0.7;
    sat.connect(satOut); satOut.connect(g.bus.bass); g.bass808 = sat;

    // global LFOs
    g.vib = ctx.createOscillator(); g.vib.frequency.value = 5.3; g.vib.start(0); g.sources.push(g.vib);
    g.vibVoice = ctx.createOscillator(); g.vibVoice.frequency.value = 5.6; g.vibVoice.start(0); g.sources.push(g.vibVoice);

    // vocal bus: clean, upfront vocal chain. It bypasses the lo-fi tape filter so words stay clear.
    if (opts.vocals) {
      const vin = ctx.createGain();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 95; hp.Q.value = 0.7;
      const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 320; mud.Q.value = 1.0; mud.gain.value = -2.5;
      const box = ctx.createBiquadFilter(); box.type = 'peaking'; box.frequency.value = 900; box.Q.value = 1.4; box.gain.value = -1.5;
      const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = 3;
      const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 8500; air.gain.value = 2.5;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.14; comp.knee.value = 8;
      const vol = ctx.createGain(); vol.gain.value = (opts.vocalVolume === undefined ? 1 : opts.vocalVolume) * 0.95;
      vin.connect(hp); hp.connect(mud); mud.connect(box); box.connect(pres); pres.connect(air); air.connect(comp); comp.connect(vol);
      vol.connect(glue);
      const rs = ctx.createGain(); rs.gain.value = Math.min(0.32, Math.max(0.16, R * 0.75)); vol.connect(rs); rs.connect(g.reverbIn);
      const ds = ctx.createGain(); ds.gain.value = Math.min(0.14, Math.max(0.05, D * 0.5)); vol.connect(ds); ds.connect(g.delayIn);
      g.bus.vocal = vin;
    }
    g.mixBase = g.mix.gain.value;

    // ambience: vinyl crackle and rain beds
    const dur = song.totalSec + 1;
    if (fx.vinyl) {
      const sr = ctx.sampleRate, len = Math.floor(sr * 3);
      const b = ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
      let s = 4242;
      for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const r = s / 0x7fffffff; d[i] = r > 0.9993 ? (r - 0.9993) * 1400 * (s & 1 ? 1 : -1) : (r - 0.5) * 0.012; }
      const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2500; hp.Q.value = 0.4;
      const vg = ctx.createGain(); vg.gain.value = 0.07;
      src.connect(hp); hp.connect(vg); vg.connect(g.master);
      g.ambience = g.ambience || []; g.ambience.push(src);
    }
    if (fx.rain) {
      const src = ctx.createBufferSource(); src.buffer = g.noise; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
      const rg = ctx.createGain(); rg.gain.value = 0.05;
      src.connect(hp); hp.connect(lp); lp.connect(rg); rg.connect(g.master);
      g.ambience = g.ambience || []; g.ambience.push(src);
    }
    g.ambDur = dur;
    return g;
  }

  // ---------- helpers ----------
  function env(param, t, peak, a, d, s, rel, end) {
    // ADSR on a gain param, note held until `end`
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setTargetAtTime(Math.max(0.0001, peak * s), t + a, Math.max(0.005, d / 3));
    param.setTargetAtTime(0.0001, Math.max(end, t + a), Math.max(0.005, rel / 3));
  }
  function osc(ctx, type, f, t, stop, detune, waveObj) {
    const o = ctx.createOscillator();
    if (waveObj) o.setPeriodicWave(waveObj); else o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    o.start(t); o.stop(stop);
    return o;
  }
  function noiseSrc(g, t, stop) {
    const s = g.ctx.createBufferSource(); s.buffer = g.noise;
    s.start(t, Math.random() * 1.5); s.stop(stop);
    return s;
  }
  function filt(ctx, type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; return b; }
  function vibrato(g, o, t, depthCents, delay, lfo) {
    const vg = g.ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(depthCents, t + delay);
    (lfo || g.vib).connect(vg); vg.connect(o.detune);
    return vg;
  }

  // ---------- instruments ----------
  function playNote(g, n, t, volScale) {
    const ctx = g.ctx;
    const f = mtof(n.m), v = clamp(n.v * (volScale || 1), 0, 1.2), d = Math.max(0.03, n.d);
    const end = t + d;
    const inst = n.inst;
    const busFor = { piano: 'chords', epiano: 'chords', guitar: 'chords', organ: 'chords', supersaw: 'chords', strings: 'pad', pad: 'pad', choir: 'pad', strings_low: 'bass',
      synthlead: 'lead', supersawlead: 'lead', flute: 'lead', brass: 'lead', sax: 'lead', fiddle: 'lead', bell: 'arp', pluck: 'arp' };
    let bus = g.bus[busFor[inst] || 'lead'];
    if (n.role) bus = g.bus[n.role] || bus;
    const amp = ctx.createGain(); amp.gain.value = 0;
    let stop;

    switch (inst) {
      case 'piano': {
        const rel = 0.28, decay = clamp(3.2 - (n.m - 40) * 0.04, 0.8, 3.2);
        stop = end + rel + 0.1;
        const o1 = osc(ctx, null, f, t, stop, 0, g.waves.piano);
        const o2 = osc(ctx, 'sine', f, t, stop, 4);
        const lp = filt(ctx, 'lowpass', 1, 0.7);
        lp.frequency.setValueAtTime(Math.min(16000, 900 + v * 5000 + f * 3), t);
        lp.frequency.setTargetAtTime(Math.min(8000, f * 2.2 + 300), t + 0.01, 0.35);
        const g2 = ctx.createGain(); g2.gain.value = 0.35;
        o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(amp);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.55, t + 0.004);
        amp.gain.setTargetAtTime(v * 0.18, t + 0.005, decay * 0.25);
        amp.gain.setTargetAtTime(0.0001, end, rel / 3);
        break;
      }
      case 'epiano': {
        const rel = 0.3; stop = end + rel + 0.1;
        const car = osc(ctx, 'sine', f, t, stop);
        const mod = osc(ctx, 'sine', f, t, stop);
        const mg = ctx.createGain();
        mg.gain.setValueAtTime(f * (0.8 + v * 2.2), t); mg.gain.setTargetAtTime(f * 0.25, t, 0.25);
        mod.connect(mg); mg.connect(car.frequency);
        const tine = osc(ctx, 'sine', f * 4, t, Math.min(stop, t + 0.3)); const tg = ctx.createGain(); tg.gain.setValueAtTime(0.12 * v, t); tg.gain.setTargetAtTime(0.0001, t, 0.04);
        tine.connect(tg); tg.connect(amp);
        car.connect(amp);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.5, t + 0.005);
        amp.gain.setTargetAtTime(v * 0.22, t + 0.006, 0.5); amp.gain.setTargetAtTime(0.0001, end, rel / 3);
        break;
      }
      case 'guitar': {
        const rel = 0.15; stop = end + rel + 0.1;
        const o1 = osc(ctx, 'sawtooth', f, t, stop, -3); const o2 = osc(ctx, 'triangle', f * 2, t, stop, 3);
        const lp = filt(ctx, 'lowpass', 1, 1.5);
        lp.frequency.setValueAtTime(Math.min(9000, 2500 + v * 3000), t); lp.frequency.setTargetAtTime(f * 2 + 400, t, 0.12);
        const g2 = ctx.createGain(); g2.gain.value = 0.25;
        o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(amp);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.32, t + 0.003);
        amp.gain.setTargetAtTime(v * 0.05, t + 0.004, 0.45); amp.gain.setTargetAtTime(0.0001, end, rel / 3);
        break;
      }
      case 'dguitar': case 'leadguitar': {
        const lead = inst === 'leadguitar';
        const rel = 0.12; stop = end + rel + 0.1;
        const o1 = osc(ctx, 'sawtooth', f, t, stop, -6); const o2 = osc(ctx, 'sawtooth', f, t, stop, 6);
        if (lead) { vibrato(g, o1, t, 18, 0.25); vibrato(g, o2, t, 18, 0.25); if (n.from) { o1.frequency.setValueAtTime(mtof(n.from), t); o1.frequency.exponentialRampToValueAtTime(f, t + 0.05); } }
        o1.connect(amp); o2.connect(amp);
        env(amp.gain, t, v * 0.5, 0.004, 0.2, lead ? 0.8 : 0.65, rel, end);
        amp.connect(lead ? g.leadDist : g.dguitar);
        g.sources.push(o1, o2);
        return;
      }
      case 'organ': {
        const rel = 0.08; stop = end + rel + 0.1;
        const o = osc(ctx, null, f, t, stop, 0, g.waves.organ); vibrato(g, o, t, 6, 0.01);
        o.connect(amp); env(amp.gain, t, v * 0.22, 0.012, 0.05, 0.95, rel, end);
        break;
      }
      case 'supersaw': {
        const rel = 0.18; stop = end + rel + 0.1;
        const lp = filt(ctx, 'lowpass', Math.min(12000, 2500 + v * 6000), 0.8);
        [-16, 0, 16].forEach(dt => osc(ctx, 'sawtooth', f, t, stop, dt).connect(lp));
        lp.connect(amp); env(amp.gain, t, v * 0.16, 0.006, 0.15, 0.7, rel, end);
        break;
      }
      case 'strings': case 'strings_low': {
        const low = inst === 'strings_low';
        const rel = low ? 0.35 : 0.7; stop = end + rel + 0.2;
        const lp = filt(ctx, 'lowpass', low ? 1100 : 2600 + v * 1500, 0.6);
        const os = [-9, 0, 8].map(dt => osc(ctx, 'sawtooth', f, t, stop, dt));
        os.forEach(o => { vibrato(g, o, t, low ? 4 : 9, 0.4); o.connect(lp); });
        lp.connect(amp);
        const att = low ? 0.06 : clamp(d * 0.3, 0.12, 0.45);
        env(amp.gain, t, v * (low ? 0.36 : 0.16), att, 0.3, 0.85, rel, end);
        if (low) bus = g.bus.bass;
        break;
      }
      case 'pad': {
        const rel = 1.0; stop = end + rel + 0.2;
        const lp = filt(ctx, 'lowpass', 400, 1.2);
        lp.frequency.setValueAtTime(350, t); lp.frequency.linearRampToValueAtTime(1400 + g.song.fx.brightness * 1800, t + Math.min(d, 1.5));
        [-12, 0, 11].forEach((dt, i) => osc(ctx, i === 1 ? 'square' : 'sawtooth', f, t, stop, dt).connect(lp));
        lp.connect(amp); env(amp.gain, t, v * 0.12, clamp(d * 0.35, 0.2, 1.2), 0.4, 0.9, rel, end);
        break;
      }
      case 'choir': {
        const rel = 0.8; stop = end + rel + 0.2;
        const src = ctx.createGain();
        [-8, 7].forEach(dt => { const o = osc(ctx, null, f, t, stop, dt, g.waves.glottal); vibrato(g, o, t, 12, 0.5, g.vibVoice); o.connect(src); });
        const fm = VOWELS.u, gains = [1, 0.5, 0.2];
        fm.forEach((ff, i) => { const bp = filt(ctx, 'bandpass', ff * 1.1, 7); const fg = ctx.createGain(); fg.gain.value = gains[i] * 3; src.connect(bp); bp.connect(fg); fg.connect(amp); });
        env(amp.gain, t, v * 0.5, clamp(d * 0.3, 0.2, 0.8), 0.3, 0.9, rel, end);
        break;
      }
      case 'synthlead': case 'supersawlead': {
        const rel = 0.15; stop = end + rel + 0.1;
        const lp = filt(ctx, 'lowpass', 1, 2);
        lp.frequency.setValueAtTime(1200 + v * 4500, t); lp.frequency.setTargetAtTime(1400 + v * 1600, t + 0.01, 0.15);
        const dts = inst === 'supersawlead' ? [-14, 0, 14] : [0, 5];
        dts.forEach((dt, i) => {
          const o = osc(ctx, inst === 'synthlead' && i === 1 ? 'square' : 'sawtooth', f, t, stop, dt);
          if (n.from && Math.abs(n.from - n.m) <= 7) { o.frequency.setValueAtTime(mtof(n.from), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
          vibrato(g, o, t, 14, Math.min(0.35, d * 0.6)); o.connect(lp);
        });
        lp.connect(amp); env(amp.gain, t, v * 0.16, 0.008, 0.15, 0.75, rel, end);
        break;
      }
      case 'pluck': {
        const rel = 0.1; stop = end + rel + 0.3;
        const lp = filt(ctx, 'lowpass', 1, 3);
        lp.frequency.setValueAtTime(4500, t); lp.frequency.setTargetAtTime(500, t, 0.06);
        osc(ctx, 'sawtooth', f, t, stop, -7).connect(lp); osc(ctx, 'square', f, t, stop, 7).connect(lp);
        lp.connect(amp);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.2, t + 0.003);
        amp.gain.setTargetAtTime(0.0001, t + 0.004, 0.12); amp.gain.setTargetAtTime(0.0001, end, rel / 3);
        break;
      }
      case 'bell': {
        stop = end + 2.5;
        const car = osc(ctx, 'sine', f, t, stop); const mod = osc(ctx, 'sine', f * 3.5, t, stop);
        const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 1.6, t); mg.gain.setTargetAtTime(f * 0.05, t, 0.3);
        mod.connect(mg); mg.connect(car.frequency); car.connect(amp);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.3, t + 0.002);
        amp.gain.setTargetAtTime(0.0001, t + 0.003, 0.6);
        break;
      }
      case 'flute': {
        const rel = 0.12; stop = end + rel + 0.1;
        const o = osc(ctx, 'sine', f, t, stop); const o2 = osc(ctx, 'triangle', f * 2, t, stop);
        if (n.from && Math.abs(n.from - n.m) <= 7) { o.frequency.setValueAtTime(mtof(n.from), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05); o2.frequency.setValueAtTime(mtof(n.from) * 2, t); o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.05); }
        vibrato(g, o, t, 14, 0.3); vibrato(g, o2, t, 14, 0.3);
        const g2 = ctx.createGain(); g2.gain.value = 0.12; o2.connect(g2); g2.connect(amp); o.connect(amp);
        const ns = noiseSrc(g, t, stop); const bp = filt(ctx, 'bandpass', f * 2, 2); const ng = ctx.createGain(); ng.gain.setValueAtTime(0.25, t); ng.gain.setTargetAtTime(0.06, t + 0.05, 0.08);
        ns.connect(bp); bp.connect(ng); ng.connect(amp);
        env(amp.gain, t, v * 0.32, 0.06, 0.2, 0.85, rel, end);
        break;
      }
      case 'brass': {
        const rel = 0.15; stop = end + rel + 0.1;
        const lp = filt(ctx, 'lowpass', 1, 1.2);
        lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(800 + v * 3000, t + 0.08); lp.frequency.setTargetAtTime(700 + v * 1600, t + 0.1, 0.3);
        [-5, 5].forEach(dt => { const o = osc(ctx, 'sawtooth', f, t, stop, dt); vibrato(g, o, t, 10, 0.4); o.connect(lp); });
        lp.connect(amp); env(amp.gain, t, v * 0.22, 0.05, 0.25, 0.8, rel, end);
        break;
      }
      case 'sax': {
        const rel = 0.1; stop = end + rel + 0.1;
        const o = osc(ctx, null, f, t, stop, 0, g.waves.reed);
        if (n.from && Math.abs(n.from - n.m) <= 7) { o.frequency.setValueAtTime(mtof(n.from), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05); }
        vibrato(g, o, t, 16, 0.25);
        const lp = filt(ctx, 'lowpass', 1, 1.5); lp.frequency.setValueAtTime(900 + v * 2600, t); lp.frequency.setTargetAtTime(900 + v * 1200, t + 0.03, 0.2);
        const bp = filt(ctx, 'peaking', 1300, 1.5); bp.gain.value = 5;
        o.connect(bp); bp.connect(lp); lp.connect(amp); env(amp.gain, t, v * 0.3, 0.03, 0.2, 0.8, rel, end);
        break;
      }
      case 'fiddle': {
        const rel = 0.12; stop = end + rel + 0.1;
        const o = osc(ctx, 'sawtooth', f, t, stop);
        if (n.from && Math.abs(n.from - n.m) <= 7) { o.frequency.setValueAtTime(mtof(n.from), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
        vibrato(g, o, t, 22, 0.18);
        const lp = filt(ctx, 'lowpass', 3200, 1); const pk = filt(ctx, 'peaking', 2400, 2); pk.gain.value = 6;
        o.connect(pk); pk.connect(lp); lp.connect(amp); env(amp.gain, t, v * 0.2, 0.05, 0.2, 0.85, rel, end);
        break;
      }
      case 'bass_synth': case 'bass_saw': case 'bass_pick': case 'bass_round': case 'bass_upright': case 'bass_sub': {
        bus = g.bus.bass;
        const rel = inst === 'bass_sub' ? 0.4 : 0.08; stop = end + rel + 0.1;
        const lp = filt(ctx, 'lowpass', 1, inst === 'bass_saw' ? 4 : 1);
        if (inst === 'bass_round' || inst === 'bass_upright' || inst === 'bass_sub') {
          osc(ctx, inst === 'bass_sub' ? 'sine' : 'triangle', f, t, stop).connect(lp);
          osc(ctx, 'sine', f, t, stop).connect(lp);
          lp.frequency.setValueAtTime(inst === 'bass_upright' ? 1400 : 700, t); lp.frequency.setTargetAtTime(500, t, 0.15);
        } else {
          osc(ctx, 'sawtooth', f, t, stop).connect(lp);
          const sub = osc(ctx, 'sine', f, t, stop); const sg = ctx.createGain(); sg.gain.value = 0.8; sub.connect(sg); sg.connect(amp);
          lp.frequency.setValueAtTime(inst === 'bass_saw' ? 2500 : 1600, t); lp.frequency.setTargetAtTime(inst === 'bass_pick' ? 600 : 420, t, inst === 'bass_saw' ? 0.06 : 0.12);
        }
        lp.connect(amp);
        if (inst === 'bass_upright') { amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.7, t + 0.006); amp.gain.setTargetAtTime(v * 0.15, t + 0.01, 0.25); amp.gain.setTargetAtTime(0.0001, end, 0.03); }
        else env(amp.gain, t, v * 0.55, inst === 'bass_sub' ? 0.15 : 0.005, 0.25, inst === 'bass_pick' ? 0.55 : 0.8, rel, end);
        break;
      }
      case 'bass_808': {
        stop = end + 0.2;
        const o = osc(ctx, 'sine', f, t, stop);
        o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
        if (n.glide) { o.frequency.setValueAtTime(f, t + d * 0.55); o.frequency.exponentialRampToValueAtTime(mtof(n.glide), t + d * 0.75); }
        o.connect(amp);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.9, t + 0.004);
        amp.gain.setTargetAtTime(v * 0.5, t + 0.01, 0.4); amp.gain.setTargetAtTime(0.0001, end, 0.04);
        amp.connect(g.bass808);
        g.sources.push(o);
        return;
      }
      default: return;
    }
    amp.connect(bus);
  }

  // ---------- drums ----------
  function playHit(g, h, t) {
    const ctx = g.ctx, v = clamp(h.v, 0, 1.2), bus = g.bus.drums;
    const amp = ctx.createGain(); amp.connect(bus);
    const style = g.song.drumStyle;
    switch (h.kind) {
      case 'kick': {
        const long = style === 'trap' || style === 'hiphop';
        const o = osc(ctx, 'sine', 150, t, t + (long ? 0.7 : 0.45));
        o.frequency.setValueAtTime(style === 'edm' ? 170 : 140, t); o.frequency.exponentialRampToValueAtTime(long ? 42 : 48, t + (style === 'edm' ? 0.06 : 0.09));
        o.connect(amp);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 1.0, t + 0.002); amp.gain.setTargetAtTime(0.0001, t + 0.01, long ? 0.16 : 0.1);
        const c = noiseSrc(g, t, t + 0.02); const cf = filt(ctx, 'highpass', 3000); const cg = ctx.createGain(); cg.gain.setValueAtTime(v * 0.25, t); cg.gain.setTargetAtTime(0.0001, t, 0.004);
        c.connect(cf); cf.connect(cg); cg.connect(bus);
        if (g.song.fx.sidechain && g.duck) { g.duck.gain.setValueAtTime(0.3, t); g.duck.gain.setTargetAtTime(1, t + 0.02, 0.09); }
        break;
      }
      case 'snare': {
        const ns = noiseSrc(g, t, t + 0.3); const hp = filt(ctx, 'highpass', 1400); const bp = filt(ctx, 'peaking', 4000, 1); bp.gain.value = 4;
        ns.connect(hp); hp.connect(bp); bp.connect(amp);
        amp.gain.setValueAtTime(v * 0.55, t); amp.gain.setTargetAtTime(0.0001, t + 0.005, style === 'lofi' ? 0.04 : 0.06);
        const o = osc(ctx, 'triangle', 190, t, t + 0.15); o.frequency.exponentialRampToValueAtTime(150, t + 0.05); const og = ctx.createGain();
        og.gain.setValueAtTime(v * 0.45, t); og.gain.setTargetAtTime(0.0001, t, 0.03); o.connect(og); og.connect(bus);
        break;
      }
      case 'clap': {
        const ns = noiseSrc(g, t, t + 0.3); const bp = filt(ctx, 'bandpass', 1300, 1.2); ns.connect(bp); bp.connect(amp);
        amp.gain.setValueAtTime(0.0001, t);
        [0, 0.011, 0.022].forEach(o => { amp.gain.setValueAtTime(v * 0.55, t + o); amp.gain.setTargetAtTime(0.0001, t + o + 0.001, 0.004); });
        amp.gain.setValueAtTime(v * 0.5, t + 0.032); amp.gain.setTargetAtTime(0.0001, t + 0.033, 0.05);
        break;
      }
      case 'hat': case 'ohat': case 'hatfoot': {
        const open = h.kind === 'ohat';
        const ns = noiseSrc(g, t, t + (open ? 0.5 : 0.12)); const hp = filt(ctx, 'highpass', open ? 7000 : 8000); const bp = filt(ctx, 'peaking', 10000, 1); bp.gain.value = 6;
        ns.connect(hp); hp.connect(bp); bp.connect(amp);
        const lvl = h.kind === 'hatfoot' ? 0.12 : open ? 0.24 : 0.22;
        amp.gain.setValueAtTime(v * lvl, t); amp.gain.setTargetAtTime(0.0001, t + 0.002, open ? 0.09 : 0.015);
        break;
      }
      case 'ride': {
        const ns = noiseSrc(g, t, t + 0.9); const bp = filt(ctx, 'bandpass', 6500, 0.9); ns.connect(bp); bp.connect(amp);
        const o = osc(ctx, 'square', 2900, t, t + 0.6); const og = ctx.createGain(); og.gain.setValueAtTime(0.02 * v, t); og.gain.setTargetAtTime(0.0001, t, 0.15);
        const ohp = filt(ctx, 'highpass', 2000); o.connect(ohp); ohp.connect(og); og.connect(amp);
        amp.gain.setValueAtTime(v * 0.16, t); amp.gain.setTargetAtTime(0.0001, t + 0.003, 0.22);
        break;
      }
      case 'crash': {
        const ns = noiseSrc(g, t, t + 2.4); const hp = filt(ctx, 'highpass', 4500); ns.connect(hp); hp.connect(amp);
        amp.gain.setValueAtTime(v * 0.28, t); amp.gain.setTargetAtTime(0.0001, t + 0.01, 0.55);
        break;
      }
      case 'rim': {
        const o = osc(ctx, 'square', 1750, t, t + 0.05); const bp = filt(ctx, 'bandpass', 2200, 3); o.connect(bp); bp.connect(amp);
        amp.gain.setValueAtTime(v * 0.25, t); amp.gain.setTargetAtTime(0.0001, t, 0.008);
        break;
      }
      case 'shaker': {
        const ns = noiseSrc(g, t, t + 0.15); const bp = filt(ctx, 'bandpass', 6500, 1.5); ns.connect(bp); bp.connect(amp);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.22, t + 0.012); amp.gain.setTargetAtTime(0.0001, t + 0.014, 0.025);
        break;
      }
      case 'tomhi': case 'tomlo': case 'boom': {
        const f0 = h.kind === 'tomhi' ? 210 : h.kind === 'tomlo' ? 120 : 70, f1 = f0 * 0.6;
        const dec = h.kind === 'boom' ? 0.35 : 0.12;
        const o = osc(ctx, 'sine', f0, t, t + dec * 6); o.frequency.exponentialRampToValueAtTime(f1, t + dec);
        o.connect(amp); amp.gain.setValueAtTime(v * (h.kind === 'boom' ? 1.1 : 0.7), t); amp.gain.setTargetAtTime(0.0001, t + 0.01, dec);
        if (h.kind === 'boom') { const ns = noiseSrc(g, t, t + 0.6); const lp = filt(ctx, 'lowpass', 600); const ng = ctx.createGain(); ng.gain.setValueAtTime(v * 0.4, t); ng.gain.setTargetAtTime(0.0001, t, 0.08); ns.connect(lp); lp.connect(ng); ng.connect(bus); }
        break;
      }
      case 'riser': {
        const d = h.d || 2;
        const ns = noiseSrc(g, t, t + d + 0.1); const bp = filt(ctx, 'bandpass', 400, 2.5);
        bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(9000, t + d);
        ns.connect(bp); bp.connect(amp);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.35, t + d); amp.gain.linearRampToValueAtTime(0.0001, t + d + 0.05);
        break;
      }
      default: break;
    }
  }

  // ---------- singing voice (formant synthesis) ----------
  // ---------- vocal track (rendered by SongVoice) ----------
  // softer instrument bed while words are sung ("ducking"), driven by the vocal envelope
  function duckLevel(opts, pos) {
    const t = opts && opts.vocals && opts.vocalTrack, depth = (opts && opts.duck) || 0;
    if (!t || !t.env || !depth) return 1;
    const i = Math.floor(pos * 20);
    const e = i >= 0 && i < t.env.length ? t.env[i] : 0;
    return 1 - depth * e;
  }
  function duckAt(g, opts, pos, when) {
    if (!g || !g.mix) return;
    const v = g.mixBase * duckLevel(opts, pos);
    try { g.mix.gain.setTargetAtTime(v, when, 0.07); } catch (e) { /* ignore */ }
  }
  function vocalBuffer(ctx, track) {
    if (track._ab && track._abLen === track.L.length) return track._ab;
    const b = ctx.createBuffer(2, track.L.length, track.sr);
    b.getChannelData(0).set(track.L); b.getChannelData(1).set(track.R);
    track._ab = b; track._abLen = track.L.length;
    return b;
  }
  function startVocal(g, ctx, track, when, offset) {
    if (!g.bus.vocal || !track || !track.L || !track.L.length) return null;
    if (offset >= track.durationSec) return null;
    const src = ctx.createBufferSource();
    src.buffer = vocalBuffer(ctx, track);
    src.connect(g.bus.vocal);
    src.start(when, Math.max(0, offset));
    g.sources.push(src);
    g.vocalSrc = src;
    return src;
  }

  // ---------- event list ----------
  function buildEvents(song, vocals, opts) {
    opts = opts || {};
    const ev = [];
    const vocalOn = !!(opts.vocals && vocals && vocals.length);
    // sections that have sung lines
    const sung = new Set();
    if (vocalOn) for (const n of song.notes) if (n.sec !== undefined) sung.add(n.sec);
    for (const n of song.notes) {
      if (n.inst === 'guide') continue;
      let scale = 1;
      if (vocalOn && n.sec !== undefined && sung.has(n.sec)) scale = 0.28; // lead becomes a soft guide under the voice
      ev.push({ t: n.t, type: 'n', e: n, s: scale });
    }
    for (const h of song.hits) ev.push({ t: h.t, type: 'h', e: h });
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  function fire(g, item, when) {
    if (item.type === 'n') playNote(g, item.e, when, item.s);
    else if (item.type === 'h') playHit(g, item.e, when);
  }

  // ---------- realtime player ----------
  class Player {
    constructor() { this.ctx = null; this.state = 'stopped'; this.offset = 0; this.onEnd = null; this.onTick = null; }
    ensureContext() {
      if (!this.ctx) {
        if (!AC) throw new Error('Web Audio is not supported in this browser.');
        this.ctx = new AC({ latencyHint: 'playback' });
      }
      return this.ctx;
    }
    async unlock() {
      const ctx = this.ensureContext();
      if (ctx.state !== 'running') { try { await ctx.resume(); } catch (e) { /* ignore */ } }
      // iOS: play a silent buffer inside the tap to unlock output
      try { const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* ignore */ }
      return ctx;
    }
    // swap in a freshly rendered vocal track, even mid-song
    setVocalTrack(track) {
      this.opts = Object.assign({}, this.opts, { vocalTrack: track });
      const g = this.graph;
      if (this.state === 'playing' && g && this.opts.vocals) {
        const when = this.ctx.currentTime + 0.05;
        if (g.vocalSrc) { try { g.vocalSrc.stop(when); } catch (e) { /* ignore */ } g.vocalSrc = null; }
        startVocal(g, this.ctx, track, when, this.offset + (when - this.startTime));
      }
    }
    load(song, vocals, opts) { this.stop(); this.song = song; this.vocals = vocals; this.opts = opts || {}; this.events = buildEvents(song, vocals, this.opts); this.offset = 0; }
    play(from) {
      if (!this.song) return;
      const ctx = this.ensureContext();
      this._teardown();
      this.offset = from === undefined ? this.offset : from;
      if (this.offset >= this.song.totalSec - 0.05) this.offset = 0;
      const g = createGraph(ctx, this.song, Object.assign({}, this.opts, { analyser: true }));
      this.graph = g;
      this.startTime = ctx.currentTime + 0.08;
      this.idx = 0;
      while (this.idx < this.events.length && this.events[this.idx].t < this.offset - 0.001) this.idx++;
      if (g.ambience) g.ambience.forEach(s => { s.start(this.startTime); s.stop(this.startTime + this.song.totalSec - this.offset + 0.5); });
      if (this.opts.vocals && this.opts.vocalTrack) startVocal(g, ctx, this.opts.vocalTrack, this.startTime, this.offset);
      this.state = 'playing';
      this._pump();
      this.timer = setInterval(() => this._pump(), 60);
      if (ctx.state !== 'running') ctx.resume();
    }
    _pump() {
      if (this.state !== 'playing') return;
      const ctx = this.ctx, g = this.graph;
      const now = ctx.currentTime;
      const horizon = now + 0.35;
      while (this.idx < this.events.length) {
        const item = this.events[this.idx];
        const when = this.startTime + (item.t - this.offset);
        if (when > horizon) break;
        if (when >= now - 0.02) fire(g, item, Math.max(now, when));
        this.idx++;
      }
      const pos = this.position();
      duckAt(g, this.opts, pos + 0.08, now + 0.05);
      if (this.onTick) this.onTick(pos);
      if (pos >= this.song.totalSec) { this.stop(); this.offset = 0; if (this.onEnd) this.onEnd(); }
    }
    position() {
      if (this.state === 'playing') return Math.max(0, this.offset + (this.ctx.currentTime - this.startTime));
      return this.offset;
    }
    pause() { if (this.state !== 'playing') return; this.offset = this.position(); this.state = 'paused'; this._teardown(); }
    seek(sec) { const was = this.state === 'playing'; this.offset = clamp(sec, 0, this.song ? this.song.totalSec : 0); if (was) this.play(this.offset); else if (this.onTick) this.onTick(this.offset); }
    stop() { this.state = 'stopped'; this._teardown(); this.offset = 0; }
    _teardown() {
      clearInterval(this.timer); this.timer = null;
      const g = this.graph; this.graph = null;
      if (g && this.ctx) {
        const t = this.ctx.currentTime;
        try { g.master.gain.cancelScheduledValues(t); g.master.gain.setValueAtTime(g.master.gain.value, t); g.master.gain.linearRampToValueAtTime(0, t + 0.06); } catch (e) { /* ignore */ }
        setTimeout(() => { try { g.output.disconnect(); if (g.analyser) g.analyser.disconnect(); } catch (e) { /* ignore */ } (g.sources || []).forEach(s => { try { s.stop(); } catch (e) { /* ignore */ } }); if (g.ambience) g.ambience.forEach(s => { try { s.stop(); } catch (e) { /* ignore */ } }); }, 120);
      }
    }
    get analyser() { return this.graph && this.graph.analyser; }
  }

  // ---------- offline render ----------
  function total0(song) { return song.totalSec; }
  function renderOffline(song, vocals, opts, onProgress) {
    if (!OAC) return Promise.reject(new Error('Offline rendering is not supported in this browser.'));
    const sr = (opts && opts.sampleRate) || 44100;
    const len = Math.ceil(song.totalSec * sr);
    let ctx;
    try { ctx = new OAC(2, len, sr); } catch (e) { ctx = new OAC(2, len, 44100); }
    const g = createGraph(ctx, song, Object.assign({}, opts));
    if (g.ambience) g.ambience.forEach(s => { s.start(0); s.stop(song.totalSec); });
    if (opts && opts.vocals && opts.vocalTrack) {
      startVocal(g, ctx, opts.vocalTrack, 0, 0);
      if (opts.duck && opts.vocalTrack.env) {
        const n = Math.ceil(total0(song) * 20), curve = new Float32Array(Math.max(2, n));
        let v = 1;
        for (let i = 0; i < curve.length; i++) { const target = duckLevel(opts, (i + 1.6) / 20); v += (target - v) * 0.5; curve[i] = g.mixBase * v; }
        try { g.mix.gain.setValueCurveAtTime(curve, 0, song.totalSec); } catch (e) { /* ignore */ }
      }
    }
    const events = buildEvents(song, vocals, opts);
    const total = song.totalSec;
    const CHUNK = 4;
    const canSuspend = typeof ctx.suspend === 'function' && !(opts && opts.noChunk);
    let idx = 0;
    const scheduleUntil = (limit) => { while (idx < events.length && events[idx].t < limit) { fire(g, events[idx], Math.max(0, events[idx].t)); idx++; } };
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (buf) => { if (!done) { done = true; resolve(buf); } };
      ctx.oncomplete = (e) => finish(e.renderedBuffer);
      if (canSuspend) {
        // schedule incrementally so memory stays low and progress can be reported
        scheduleUntil(CHUNK + 0.5);
        for (let t = CHUNK; t < total - 0.1; t += CHUNK) {
          const tt = t;
          ctx.suspend(tt).then(() => { scheduleUntil(tt + CHUNK + 0.5); if (onProgress) onProgress(tt / total); ctx.resume(); }).catch(() => {});
        }
      } else scheduleUntil(Infinity);
      (g.sources || []).forEach(s => { try { s.stop(total); } catch (e) { /* ignore */ } });
      let p;
      try { p = ctx.startRendering(); } catch (e) { reject(e); return; }
      if (p && p.then) p.then(finish, reject);
    });
  }

  // ---------- WAV ----------
  function encodeWav(channels, sampleRate, normalize) {
    const n = channels[0].length, nc = channels.length;
    let peak = 0;
    for (const ch of channels) for (let i = 0; i < n; i++) { const a = Math.abs(ch[i]); if (a > peak && isFinite(a)) peak = a; }
    const gain = normalize && peak > 0 ? Math.min(4, 0.89 / peak) : (peak > 1 ? 1 / peak : 1);
    const buf = new ArrayBuffer(44 + n * nc * 2);
    const dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + n * nc * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true); dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * nc * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      let s = channels[c][i] * gain; if (!isFinite(s)) s = 0;
      s = Math.max(-1, Math.min(1, s));
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
    return { buffer: buf, peak, gain };
  }

  const api = { Player, renderOffline, encodeWav, buildEvents, createGraph, startVocal, supported: !!AC, offlineSupported: !!OAC, VOWELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SongSynth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
