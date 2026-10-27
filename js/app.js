/* Song Studio — UI controller */
(function () {
  'use strict';
  const P = window.SongParser, C = window.SongComposer, L = window.SongLyrics, S = window.SongSynth;
  const $ = (id) => document.getElementById(id);

  const EXAMPLES = [
    'Chill lo-fi beat about rainy mornings with piano, 2 minutes',
    'Happy upbeat pop song about summer road trips',
    'Epic cinematic trailer music with strings and choir',
    'Dark trap beat with heavy 808s, 140 bpm',
    'Romantic slow jazz ballad about Paris at night',
    'Energetic EDM festival anthem, 3 minutes',
    'Peaceful ambient meditation with bells, no drums',
    'Country road trip song with acoustic guitar',
    'Melancholy classical piano waltz in A minor',
    'Driving rock song about breaking free'
  ];
  // neural voices (Kokoro-82M, Apache-2.0) and the song key centre each one sings around
  const VOICES = {
    fhigh: { voice: 'af_heart', center: 65, formantShift: 1.17, breathiness: 0.2 },
    flow: { voice: 'af_bella', center: 62, formantShift: 1.1, breathiness: 0.18 },
    mhigh: { voice: 'am_michael', center: 57, formantShift: 1.0, breathiness: 0.15 },
    mlow: { voice: 'am_fenrir', center: 52, formantShift: 0.92, breathiness: 0.13 }
  };
  const BEDS = { soft: 0.38, some: 0.2, off: 0 };

  const state = { text: '', variation: 0, base: null, overrides: {}, params: null, song: null, lyrics: null, lyricsCustom: false, vocals: [], lyricVariation: 0, wavUrl: null, vocalTrack: null, trackPromise: null, trackToken: 0 };
  const player = new S.Player();

  // ---------- persistence ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('songstudio:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('songstudio:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  // ---------- setup ----------
  const chips = $('chips');
  EXAMPLES.forEach(ex => {
    const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = ex;
    b.addEventListener('click', () => { $('desc').value = ex; $('desc').focus({ preventScroll: true }); });
    chips.appendChild(b);
  });
  const fillSelect = (sel, items) => { sel.innerHTML = ''; items.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }); };
  fillSelect($('o-genre'), Object.keys(P.GENRES).map(k => [k, P.GENRES[k].label]));
  fillSelect($('o-mood'), Object.keys(P.MOODS).map(k => [k, P.MOODS[k].label]));
  fillSelect($('o-root'), P.NOTE_NAMES.map((n, i) => [String(i), n]));
  fillSelect($('o-scale'), Object.keys(P.SCALES).map(k => [k, cap(P.SCALES[k].label)]));
  $('desc').value = store.get('desc', '');
  $('v-on').checked = store.get('vOn', true);
  $('v-type').value = store.get('vType', 'mhigh');
  $('v-vol').value = store.get('vVol', 1);
  $('v-style').value = store.get('vStyle', 'harmony');
  $('v-bed').value = store.get('vBed', 'soft');

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmt(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function setStatus(msg) { $('status').textContent = msg || ''; }
  function vocalOpts() {
    const v = VOICES[$('v-type').value] || VOICES.mhigh;
    return { vocals: $('v-on').checked, vocalVolume: parseFloat($('v-vol').value), formantShift: v.formantShift, breathiness: v.breathiness, center: v.center, style: $('v-style').value, voice: v.voice, duck: BEDS[$('v-bed').value] || 0 };
  }
  function trackOpts() {
    const vo = vocalOpts(), p = state.params, s = state.song;
    return {
      sr: 24000, voice: vo.voice, formantShift: vo.formantShift, breathiness: vo.breathiness, style: vo.style,
      seed: (p.seed ^ (state.lyricVariation * 2654435761)) >>> 0, durationSec: s.totalSec,
      song: { root: p.root, scaleSteps: P.SCALES[p.scale].steps, chords: s.chords.map(c => ({ pcs: c.pcs })), barSec: s.barSec, lift: s.lift }
    };
  }

  // ---------- singers ----------
  // 1) neural singer: Kokoro voice model in a module worker (human voice, needs a one-time download)
  // 2) fallback: the older formant singer, only if the neural one can't run on this device
  const neural = { worker: null, failed: false, ready: false, jobs: new Map(), id: 0, loadMsg: '' };
  function neuralWorker() {
    if (neural.failed) return null;
    if (neural.worker) return neural.worker;
    try {
      const w = new Worker('js/singer-worker.js', { type: 'module' });
      w.onmessage = (e) => onNeural(e.data || {});
      w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); neuralFail('The neural singer could not start on this browser.'); };
      neural.worker = w;
      w.postMessage({ type: 'load' });
    } catch (e) { neural.failed = true; return null; }
    return neural.worker;
  }
  function neuralFail(msg) {
    neural.failed = true; neural.lastError = msg;
    try { neural.worker && neural.worker.terminate(); } catch (e) { /* ignore */ }
    neural.worker = null;
    const jobs = Array.from(neural.jobs.values()); neural.jobs.clear();
    jobs.forEach(j => j.fallback());
  }
  function mb(x) { return (x / 1048576).toFixed(0); }
  function onNeural(d) {
    if (d.type === 'load') {
      if (d.stage === 'init') neural.loadMsg = 'Warming up the singer…';
      else if (d.cached) neural.loadMsg = 'Loading the singer…';
      else neural.loadMsg = 'Downloading the singer voice (one time, ' + mb(d.total) + ' MB): ' + Math.round(100 * d.got / Math.max(1, d.total)) + '%';
      setBar(d.stage === 'init' ? 1 : d.got / Math.max(1, d.total));
      if (neural.jobs.size) setVoiceStatus(neural.loadMsg);
      return;
    }
    if (d.type === 'ready') { neural.ready = true; neural.loadMsg = ''; if (!neural.jobs.size) { setVoiceStatus(state.vocalTrack ? $('v-status').textContent : ''); setBar(0); } return; }
    if (d.type === 'error') {
      if (!d.id || !neural.jobs.has(d.id)) { if (!neural.ready) neuralFail(d.error); return; }
      const j = neural.jobs.get(d.id); neural.jobs.delete(d.id); j.fallback(); return;
    }
    const j = neural.jobs.get(d.id); if (!j) return;
    if (d.type === 'progress') { j.onProgress && j.onProgress(d.progress, d.harmony); return; }
    if (d.type === 'partial' || d.type === 'done') {
      const track = { sr: d.sr, L: d.L, R: d.R, env: d.env, durationSec: d.durationSec, partial: d.type !== 'done', upto: d.upto };
      if (d.type === 'done') { neural.jobs.delete(d.id); j.resolve(track); }
      else j.onPartial && j.onPartial(track);
    }
  }
  // Start fetching the voice early (a little later on a first visit, which reloads once for multi-threading).
  let coiPending = false;
  try { coiPending = 'serviceWorker' in navigator && location.protocol !== 'file:' && !window.crossOriginIsolated && !sessionStorage.getItem('ss-coi-reload'); } catch (e) { /* ignore */ }
  if ($('v-on').checked) setTimeout(() => { if (!neural.worker) neuralWorker(); }, coiPending ? 3000 : 600);

  let worker = null, jobId = 0;
  const pending = new Map();
  function getWorker() {
    if (worker === false) return null;
    if (!worker) {
      try {
        worker = new Worker('js/voice-worker.js');
        worker.onmessage = (e) => { const j = pending.get(e.data.id); if (!j) return; pending.delete(e.data.id); if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data); };
        worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); worker = false; for (const j of pending.values()) j.fallback(); pending.clear(); };
      } catch (e) { worker = false; return null; }
    }
    return worker;
  }
  function renderFormant(events, opts) {
    const local = () => window.SongVoice.renderVocalTrack(events, opts);
    const w = getWorker();
    if (!w) return new Promise((res, rej) => setTimeout(() => { try { res(local()); } catch (e) { rej(e); } }, 0));
    return new Promise((resolve, reject) => {
      const id = ++jobId;
      pending.set(id, { resolve, reject, fallback: () => { try { resolve(local()); } catch (e) { reject(e); } } });
      w.postMessage({ id, events, opts });
    });
  }
  // render the vocal track; onPartial gets growing tracks while the neural singer records
  function renderTrack(events, opts, cb) {
    cb = cb || {};
    const w = neuralWorker();
    if (!w) { cb.onFallback && cb.onFallback(); return renderFormant(events, opts); }
    return new Promise((resolve, reject) => {
      const id = ++neural.id;
      // only the newest job matters
      for (const [k, j] of neural.jobs) { neural.jobs.delete(k); j.cancelled = true; }
      neural.jobs.set(id, { resolve, reject, onPartial: cb.onPartial, onProgress: cb.onProgress,
        fallback: () => { cb.onFallback && cb.onFallback(); renderFormant(events, opts).then(resolve, reject); } });
      w.postMessage({ type: 'render', id, events, opts });
    });
  }
  function setBar(f) { const b = $('v-bar'); if (!b) return; b.parentNode.hidden = !(f > 0 && f < 1); b.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }
  function setVoiceStatus(msg) { $('v-status').textContent = msg || ''; }

  // ---------- generation ----------
  function buildParams() {
    const base = P.parse(state.text, state.variation);
    state.base = base;
    const p = Object.assign({}, base, { instruments: base.instruments.slice(), flags: Object.assign({}, base.flags) });
    const o = state.overrides;
    if (o.genre && o.genre !== p.genre) { p.genre = o.genre; if (o.bpm === undefined) { const r = P.GENRES[o.genre].bpm; p.bpm = Math.round((r[0] + r[1]) / 2); } }
    if (o.mood) p.mood = o.mood;
    if (o.root !== undefined) p.root = o.root;
    if (o.scale) p.scale = o.scale;
    if (o.bpm) p.bpm = o.bpm;
    if (o.lengthSec) p.lengthSec = o.lengthSec;
    if (p.genre === 'lofi') p.flags.vinyl = true;
    return p;
  }

  function generate(opts) {
    opts = opts || {};
    const wasPlaying = player.state === 'playing';
    const pos = player.position();
    state.params = buildParams();
    state.song = C.compose(state.params);
    if (!state.lyricsCustom || opts.newLyrics) {
      state.lyrics = L.generateLyrics(state.params, L.syllableTargets(state.song), state.variation * 7 + state.lyricVariation);
      $('lyrics').value = L.lyricsToText(state.lyrics);
      state.lyricsCustom = false;
    } else {
      state.lyrics = L.parseLyricsText($('lyrics').value);
    }
    updateLyricSource();
    remapVocals();
    renderReadout();
    renderSegments();
    clearWav();
    ['play', 'wav', 'regen', 'lyr-apply', 'lyr-new'].forEach(id => { $(id).disabled = false; });
    if (opts.keepPosition && wasPlaying) player.play(Math.min(pos, state.song.totalSec - 1));
    tick(player.position());
  }

  function remapVocals(rerender) {
    if (rerender === undefined) rerender = true;
    const vo = vocalOpts();
    state.vocals = vo.vocals ? L.mapVocals(state.song, state.lyrics || {}, { center: vo.center }) : [];
    if (rerender || !vo.vocals) { state.vocalTrack = null; state.trackPromise = null; state.trackToken++; }
    player.load(state.song, state.vocals, Object.assign({}, vo, { vocalTrack: state.vocalTrack }));
    if (vo.vocals && state.vocals.length && !state.vocalTrack && !state.trackPromise) {
      const token = state.trackToken;
      const t0 = performance.now();
      setVoiceStatus(neural.ready ? 'Recording the vocals…' : (neural.loadMsg || 'Getting the singer ready…'));
      state.trackPromise = renderTrack(state.vocals, trackOpts(), {
        onPartial: (t) => { if (token !== state.trackToken) return; state.vocalTrack = t; player.setVocalTrack(t); maybeStartWaiting(t.upto || 0, false); },
        onProgress: (f, harm) => { if (token !== state.trackToken) return; if (harm) maybeStartWaiting(1e9, true); setBar(f); setVoiceStatus((harm ? 'Recording the harmonies… ' : 'Recording the vocals… ') + Math.round(f * 100) + '%'); },
        onFallback: () => { if (token === state.trackToken) { setVoiceStatus('Using the basic singer on this device…'); maybeStartWaiting(1e9, true); } }
      }).then((t) => {
        if (token !== state.trackToken) return null;
        state.vocalTrack = t; player.setVocalTrack(t); setBar(0); maybeStartWaiting(1e9, true);
        const basic = !t.env;
        setVoiceStatus((basic ? 'Basic vocals ready (' : 'Vocals ready (') + ((performance.now() - t0) / 1000).toFixed(1) + ' s).' + (basic && neural.lastError ? ' The neural singer could not run here: ' + neural.lastError : ''));
        return t;
      }).catch((e) => { if (token === state.trackToken) { setBar(0); maybeStartWaiting(1e9, true); setVoiceStatus('Could not render the vocals: ' + (e && e.message ? e.message : e)); } return null; });
    } else if (!vo.vocals) setVoiceStatus('');
  }

  // Start the song from the top. While the singer is still recording, wait until it is far enough
  // ahead that the vocals will not fall behind the music (so the first verse is never silent).
  function markPlaying() { $('play').classList.add('playing'); $('play').setAttribute('aria-label', 'Pause'); }
  function playFromTop() {
    state.waitPlay = null;
    if (state.trackPromise && state.vocals.length && !(state.vocalTrack && !state.vocalTrack.partial) && !neural.failed) {
      state.waitPlay = { token: state.trackToken, t0: performance.now() };
      setStatus('Starting as soon as the singer is far enough ahead…');
      return;
    }
    player.play(0); markPlaying();
  }
  function maybeStartWaiting(upto, final) {
    const w = state.waitPlay;
    if (!w || w.token !== state.trackToken) return;
    const last = state.vocals[state.vocals.length - 1];
    const leadEnd = last ? last.t + (last.d || 0) : 0;
    const el = (performance.now() - w.t0) / 1000;
    const v0 = state.vocals[0].t;
    const rate = Math.max(0, upto - v0) / Math.max(0.5, el); // song seconds sung per real second
    // playback reaches the last note at leadEnd; the singer needs (leadEnd - upto) / rate, plus a safety margin
    const need = rate > 0 ? 1.25 * (leadEnd - upto) / rate + 3 : Infinity;
    if (final || upto >= leadEnd - 0.5 || (upto > v0 + 2 && leadEnd >= need)) {
      state.waitPlay = null; setStatus('');
      player.play(0); markPlaying();
    }
  }

  function reloadKeepingPosition(rerender) {
    if (!state.song) return;
    const wasPlaying = player.state === 'playing';
    const pos = player.position();
    remapVocals(rerender);
    clearWav();
    if (wasPlaying) player.play(pos); else { player.offset = pos; tick(pos); }
  }

  function songTitle() {
    const th = L.themeWords(state.params)[0];
    if (th) return cap(th);
    const titles = { happy: 'Bright Side', sad: 'Quiet Rain', chill: 'Slow Morning', epic: 'Rise', dark: 'Shadows', romantic: 'Only You', energetic: 'Overdrive' };
    return titles[state.params.mood] || 'Untitled';
  }

  function renderReadout() {
    const p = state.params, s = state.song;
    const inf = (k) => (state.base.inferred[k] && !state.overrides[k === 'key' ? 'root' : k === 'length' ? 'lengthSec' : k] ? ' (auto)' : '');
    $('title').textContent = songTitle();
    $('meta').textContent = `${P.GENRES[p.genre].label} · ${P.MOODS[p.mood].label} · ${P.keyName(p.root, p.scale)} · ${s.bpm} BPM · ${fmt(s.songSec)}`;
    $('r-genre').textContent = P.GENRES[p.genre].label + inf('genre');
    $('r-mood').textContent = P.MOODS[p.mood].label + (p.secondaryMood && p.secondaryMood !== p.mood ? ' + ' + P.MOODS[p.secondaryMood].label.toLowerCase() : '');
    $('r-bpm').textContent = s.bpm + ' BPM' + inf('bpm');
    $('r-key').textContent = P.keyName(p.root, p.scale) + inf('key');
    $('r-len').textContent = fmt(s.songSec) + ' (' + s.totalBars + ' bars)';
    $('r-prog').textContent = C.progressionLabel(s.progression.chorus, p.scale);
    $('r-struct').textContent = s.sections.map(x => x.label).join(' → ') + (s.lift ? ' · key lift in the last chorus' : '');
    $('r-layers').textContent = s.layers.join(', ') + (state.vocals.length ? ', Vocals' : '') + (s.fx.vinyl ? ' · vinyl texture' : '') + (s.fx.rain ? ' · rain' : '');
    // overrides UI mirrors current values
    $('o-genre').value = p.genre; $('o-mood').value = p.mood; $('o-root').value = String(p.root); $('o-scale').value = p.scale;
    $('o-bpm').value = p.bpm; $('o-bpm-v').textContent = p.bpm;
    $('o-len').value = p.lengthSec; $('o-len-v').textContent = fmt(p.lengthSec);
  }

  function renderSegments() {
    const segs = $('segs'); segs.innerHTML = '';
    const s = state.song;
    for (const sec of s.sections) {
      const d = document.createElement('div');
      d.className = 'seg ' + sec.name;
      d.style.flex = String(sec.endSec - sec.startSec);
      d.title = sec.label;
      segs.appendChild(d);
    }
    const tailD = document.createElement('div'); tailD.className = 'seg'; tailD.style.flex = String(s.totalSec - s.songSec); segs.appendChild(tailD);
  }

  function updateLyricSource() { $('lyr-src').textContent = state.lyricsCustom ? '· your lyrics' : '· written from your description'; }

  // ---------- playback UI ----------
  function tick(pos) {
    const s = state.song; if (!s) return;
    const pct = Math.min(100, (pos / s.totalSec) * 100);
    $('fill').style.width = pct + '%'; $('knob').style.left = pct + '%';
    $('progress').setAttribute('aria-valuenow', String(Math.round(pct)));
    $('time').textContent = fmt(pos) + ' / ' + fmt(s.totalSec);
    let label = 'Ending';
    for (const sec of s.sections) if (pos >= sec.startSec && pos < sec.endSec) { label = sec.label; break; }
    $('section').textContent = player.state === 'stopped' && pos === 0 ? 'Ready' : label;
  }
  player.onTick = tick;
  player.onEnd = () => { $('play').classList.remove('playing'); $('play').setAttribute('aria-label', 'Play'); tick(0); };

  async function togglePlay() {
    if (!state.song) return;
    await player.unlock();
    if (state.waitPlay) { state.waitPlay = null; setStatus(""); }
    if (player.state === 'playing') { player.pause(); $('play').classList.remove('playing'); $('play').setAttribute('aria-label', 'Play'); }
    else { player.play(); $('play').classList.add('playing'); $('play').setAttribute('aria-label', 'Pause'); }
  }

  // progress seeking
  (function () {
    const el = $('progress'); let dragging = false;
    const seekTo = (clientX) => { if (!state.song) return; const r = el.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width)); player.seek(f * state.song.totalSec); tick(player.position()); };
    el.addEventListener('pointerdown', (e) => { dragging = true; try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } seekTo(e.clientX); });
    el.addEventListener('pointermove', (e) => { if (dragging) { const r = el.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); $('fill').style.width = f * 100 + '%'; $('knob').style.left = f * 100 + '%'; } });
    el.addEventListener('pointerup', (e) => { if (dragging) { dragging = false; seekTo(e.clientX); } });
    el.addEventListener('keydown', (e) => { if (!state.song) return; if (e.key === 'ArrowRight') player.seek(player.position() + 5); if (e.key === 'ArrowLeft') player.seek(player.position() - 5); });
  })();

  // ---------- visualizer ----------
  const canvas = $('viz'), g2 = canvas.getContext('2d');
  let freq = null;
  function draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, w, h);
    const an = player.analyser;
    const bars = Math.max(24, Math.floor(w / 7));
    const grad = g2.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, '#14b8a6'); grad.addColorStop(1, '#60a5fa');
    g2.fillStyle = grad;
    if (an && player.state === 'playing') {
      if (!freq || freq.length !== an.frequencyBinCount) freq = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(freq);
      const n = freq.length;
      for (let i = 0; i < bars; i++) {
        // log-spaced bins
        const a = Math.floor(Math.pow(i / bars, 2) * n * 0.7), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / bars, 2) * n * 0.7));
        let m = 0; for (let k = a; k < b; k++) m = Math.max(m, freq[k]);
        const bh = Math.max(2, (m / 255) * (h - 10));
        g2.globalAlpha = 0.9; g2.fillRect(i * (w / bars) + 1, h - bh - 4, w / bars - 2, bh);
      }
    } else {
      g2.globalAlpha = 0.35;
      for (let i = 0; i < bars; i++) { const bh = 3 + 3 * Math.abs(Math.sin(i * 0.45)); g2.fillRect(i * (w / bars) + 1, h - bh - 4, w / bars - 2, bh); }
    }
    g2.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // ---------- WAV ----------
  function clearWav() {
    if (state.wavUrl) { URL.revokeObjectURL(state.wavUrl); state.wavUrl = null; }
    $('wavlink').classList.add('hidden');
  }
  async function downloadWav() {
    if (!state.song) return;
    const btn = $('wav');
    btn.disabled = true; btn.textContent = 'Rendering…';
    setStatus('Rendering the full song' + (state.vocals.length ? ' with vocals' : '') + '. This can take a little while on a phone.');
    const t0 = performance.now();
    try {
      let track = state.vocalTrack;
      if (state.vocals.length && (!track || track.partial) && state.trackPromise) { btn.textContent = 'Finishing the vocals…'; track = (await state.trackPromise) || track; }
      const buf = await S.renderOffline(state.song, state.vocals, Object.assign(vocalOpts(), { vocalTrack: track }), (f) => { btn.textContent = 'Rendering… ' + Math.round(f * 100) + '%'; });
      const chans = []; for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
      const wav = S.encodeWav(chans, buf.sampleRate, true);
      const blob = new Blob([wav.buffer], { type: 'audio/wav' });
      clearWav();
      state.wavUrl = URL.createObjectURL(blob);
      const name = 'song-studio-' + songTitle().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + state.params.genre + '.wav';
      const a = $('wavlink'); a.href = state.wavUrl; a.download = name; a.textContent = 'Save ' + name.replace(/^song-studio-/, '') + ' (' + (blob.size / 1048576).toFixed(1) + ' MB)';
      a.classList.remove('hidden');
      a.click();
      setStatus('WAV ready in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s. If it did not save, tap "Save" above.');
    } catch (e) {
      setStatus('Could not render the WAV: ' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false; btn.textContent = 'Download WAV';
    }
  }

  // ---------- events ----------
  $('gen').addEventListener('click', async () => {
    const text = $('desc').value.trim();
    if (!text) { $('desc').focus(); setStatus('Type a description first, or tap an example.'); return; }
    await player.unlock(); // iOS: resume audio inside the tap
    if (text !== state.text) { state.overrides = {}; state.variation = 0; state.lyricVariation = 0; }
    state.text = text; store.set('desc', text);
    player.stop();
    generate();
    setStatus('');
    playFromTop();
  });
  $('regen').addEventListener('click', async () => {
    if (!state.text) return;
    await player.unlock();
    state.variation++;
    player.stop();
    generate();
    setStatus('Variation ' + (state.variation + 1) + ' of the same description.');
    playFromTop();
  });
  $('play').addEventListener('click', togglePlay);
  $('wav').addEventListener('click', downloadWav);
  $('adjust').addEventListener('click', () => {
    const o = $('overrides'); const open = o.classList.toggle('hidden') === false;
    $('adjust').setAttribute('aria-expanded', String(open)); $('adjust').textContent = open ? 'Close' : 'Adjust';
  });
  $('o-bpm').addEventListener('input', () => { $('o-bpm-v').textContent = $('o-bpm').value; });
  $('o-len').addEventListener('input', () => { $('o-len-v').textContent = fmt(+$('o-len').value); });
  $('apply').addEventListener('click', async () => {
    if (!state.text) { const t = $('desc').value.trim(); if (!t) return; state.text = t; }
    await player.unlock();
    const p = state.params || {};
    const o = {};
    if ($('o-genre').value !== (state.base && state.base.genre)) o.genre = $('o-genre').value;
    if ($('o-mood').value !== (state.base && state.base.mood)) o.mood = $('o-mood').value;
    if (+$('o-root').value !== (state.base && state.base.root)) o.root = +$('o-root').value;
    if ($('o-scale').value !== (state.base && state.base.scale)) o.scale = $('o-scale').value;
    if (+$('o-bpm').value !== p.bpm || state.overrides.bpm) o.bpm = +$('o-bpm').value;
    if (+$('o-len').value !== (state.base && state.base.lengthSec)) o.lengthSec = +$('o-len').value;
    state.overrides = o;
    player.stop(); generate();
    setStatus('Applied your changes.');
    playFromTop();
  });
  $('reset').addEventListener('click', async () => {
    state.overrides = {}; await player.unlock(); player.stop(); generate();
    setStatus('Back to the settings read from your description.');
    playFromTop();
  });
  $('v-on').addEventListener('change', () => { store.set('vOn', $('v-on').checked); reloadKeepingPosition(); if (state.song) renderReadout(); });
  $('v-type').addEventListener('change', () => { store.set('vType', $('v-type').value); reloadKeepingPosition(); });
  let volTimer = null;
  $('v-vol').addEventListener('input', () => { store.set('vVol', +$('v-vol').value); clearTimeout(volTimer); volTimer = setTimeout(() => reloadKeepingPosition(false), 250); });
  $('v-style').addEventListener('change', () => { store.set('vStyle', $('v-style').value); reloadKeepingPosition(); });
  $('v-bed').addEventListener('change', () => { store.set('vBed', $('v-bed').value); reloadKeepingPosition(false); });
  $('lyrics').addEventListener('input', () => { state.lyricsCustom = true; updateLyricSource(); });
  $('lyr-apply').addEventListener('click', async () => {
    const parsed = L.parseLyricsText($('lyrics').value);
    if (!Object.keys(parsed).length) { setStatus('Add some lyrics first.'); return; }
    await player.unlock();
    state.lyrics = parsed; state.lyricsCustom = true; updateLyricSource();
    if (!$('v-on').checked) { $('v-on').checked = true; store.set('vOn', true); }
    const wasPlaying = player.state === 'playing';
    remapVocals(); clearWav(); renderReadout();
    if (!wasPlaying) { player.play(0); $('play').classList.add('playing'); } else player.play(0);
    setStatus('Singing your lyrics from the top.');
  });
  $('lyr-new').addEventListener('click', () => {
    state.lyricVariation++;
    state.lyrics = L.generateLyrics(state.params, L.syllableTargets(state.song), state.variation * 7 + state.lyricVariation);
    $('lyrics').value = L.lyricsToText(state.lyrics); state.lyricsCustom = false; updateLyricSource();
    reloadKeepingPosition();
  });
  document.addEventListener('visibilitychange', () => { /* keep playing in background where allowed */ });

  if (!S.supported) { setStatus('This browser does not support Web Audio, so songs cannot play here.'); $('gen').disabled = true; }

  // ---------- service worker ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // The service worker adds the headers that let the singer use several CPU threads.
        // The first visit is not isolated yet, so reload once (before any song is playing).
        const tryReload = () => {
          if (window.crossOriginIsolated || !navigator.serviceWorker.controller) return;
          if (player.state === 'playing' || neural.jobs.size || state.song) return;
          try { if (sessionStorage.getItem('ss-coi-reload')) return; sessionStorage.setItem('ss-coi-reload', '1'); } catch (e) { return; }
          location.reload();
        };
        if (navigator.serviceWorker.controller) tryReload();
        else navigator.serviceWorker.addEventListener('controllerchange', tryReload, { once: true });
      }).catch(() => { /* ignore */ });
    });
  }
  window.__songStudio = { state, player };
})();
