/* Song Studio — neural singer worker.
   Runs the free Kokoro-82M voice model (Apache-2.0) locally with ONNX Runtime Web.
   The model was modified so the melody can drive it directly: we give it every phoneme's
   length and the pitch curve, and its neural vocoder sings the line in a real human timbre. */
import * as ort from '../vendor/ort/ort.wasm.min.mjs';
import { phonemize } from '../vendor/phonemizer/phonemizer.js';
import './sing-plan.js';
import './voice.js';

const SP = globalThis.SingPlan, SV = globalThis.SongVoice;
const MODEL_URL = new URL('../models/kokoro-82m-sing-q8.onnx', import.meta.url).href;
const MODEL_CACHE = 'studio-voice-model-v1';
const SR = 24000;

ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;

let session = null, loading = null;
const voices = new Map();
const ipaCache = new Map();
const chunkCache = new Map();
let current = 0; // latest render id; older jobs stop early

// let queued messages (a newer render request) in between chunks: ORT runs without yielding to the event loop
const yieldNow = () => new Promise(r => setTimeout(r, 0));

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

async function fetchWithProgress(url, onProgress) {
  let cache = null;
  try { cache = await caches.open(MODEL_CACHE); const hit = await cache.match(url); if (hit) { onProgress(1, 1, true); return await hit.arrayBuffer(); } } catch (e) { cache = null; }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Could not download the singer (' + resp.status + ')');
  // when the server compresses the file, content-length is the compressed size, not the bytes we count
  const enc = resp.headers.get('content-encoding');
  const total = (!enc || enc === 'identity') && Number(resp.headers.get('content-length')) || 87110542;
  let buf;
  if (resp.body && resp.body.getReader) {
    const reader = resp.body.getReader(); const parts = []; let got = 0, lastT = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      parts.push(value); got += value.length;
      const now = Date.now(); if (now - lastT > 150) { lastT = now; onProgress(Math.min(got, total), total, false); }
    }
    buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    buf = buf.buffer;
  } else buf = await resp.arrayBuffer();
  onProgress(total, total, false);
  if (cache) { try { await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* storage full: fine, just re-download next time */ } }
  return buf;
}

async function load() {
  if (session) return session;
  if (!loading) loading = (async () => {
    const buf = await fetchWithProgress(MODEL_URL, (got, total, cached) => post({ type: 'load', got, total, cached }));
    post({ type: 'load', stage: 'init' });
    session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    await phonemize('hello', 'en-us');
    post({ type: 'ready' });
    return session;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

async function voice(name) {
  if (voices.has(name)) return voices.get(name);
  const r = await fetch(new URL('../voices/' + name + '.bin', import.meta.url).href);
  if (!r.ok) throw new Error('voice ' + name + ' missing');
  const v = new Float32Array(await r.arrayBuffer()); voices.set(name, v); return v;
}

async function ipa(word) {
  if (ipaCache.has(word)) return ipaCache.get(word);
  let s = '';
  try { s = (await phonemize(word.replace(/-/g, ' '), 'en-us')).join(' '); } catch (e) { s = ''; }
  ipaCache.set(word, s); return s;
}

function hashChunk(vname, ch) {
  let h = 2166136261 >>> 0;
  const mix = (x) => { h ^= x; h = Math.imul(h, 16777619) >>> 0; };
  for (const c of vname) mix(c.charCodeAt(0));
  ch.ids.forEach(mix); ch.dur.forEach(mix);
  for (let i = 0; i < ch.f0.length; i += 3) mix(Math.round(ch.f0[i] * 4));
  return h + ':' + ch.ids.length + ':' + ch.f0.length;
}

async function runChunk(vname, vb, ch) {
  const key = hashChunk(vname, ch);
  if (chunkCache.has(key)) return chunkCache.get(key);
  const N = ch.ids.length;
  const off = 256 * Math.min(Math.max(N - 2, 0), 509);
  const feeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ch.ids.map(BigInt)), [1, N]),
    style: new ort.Tensor('float32', vb.slice(off, off + 256), [1, 256]),
    durations: new ort.Tensor('float32', Float32Array.from(ch.dur), [1, N]),
    f0: new ort.Tensor('float32', ch.f0, [1, ch.f0.length])
  };
  const r = await session.run(feeds);
  const w = new Float32Array(r.waveform.data);
  // guard against rare numeric glitches: no NaNs, and clip isolated spikes far above the chunk's level
  const sorted = new Float32Array(Math.ceil(w.length / 7)); for (let i = 0, j = 0; i < w.length; i += 7, j++) sorted[j] = Math.abs(w[i]) || 0;
  sorted.sort(); const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  const lim = Math.max(0.05, p99 * 3);
  for (let i = 0; i < w.length; i++) { const v = w[i]; w[i] = v !== v ? 0 : v > lim ? lim : v < -lim ? -lim : v; }
  // even loudness from line to line: normalise the voiced part to a fixed RMS
  let s = 0, n = 0;
  for (let i = 0; i < w.length; i++) { const a = w[i] * w[i]; if (a > 1e-6) { s += a; n++; } }
  const rms = n ? Math.sqrt(s / n) : 0;
  const g = rms > 1e-4 ? Math.min(8, 0.12 / rms) : 1;
  for (let i = 0; i < w.length; i++) w[i] *= g;
  if (chunkCache.size > 400) chunkCache.delete(chunkCache.keys().next().value);
  chunkCache.set(key, w);
  return w;
}

function place(buf, w, start) {
  const o = Math.round(start * SR), F = 240;
  for (let i = 0; i < w.length; i++) {
    const j = o + i; if (j < 0 || j >= buf.length) continue;
    const g = Math.min(1, i / F, (w.length - 1 - i) / F);
    buf[j] += w[i] * g;
  }
}

// a second "take" for doubling: slightly late, slowly drifting in pitch/time
function adt(src, delayMs, depthMs, rate, seed) {
  const n = src.length, out = new Float32Array(n);
  const base = delayMs * SR / 1000, depth = depthMs * SR / 1000;
  let ph = seed * 1.7;
  const w = 2 * Math.PI * rate / SR;
  for (let i = 0; i < n; i++) {
    const d = base + depth * Math.sin(ph + i * w) + depth * 0.5 * Math.sin(ph * 1.3 + i * w * 2.31);
    const p = i - d; const k = Math.floor(p), f = p - k;
    if (k >= 0 && k + 1 < n) out[i] = src[k] * (1 - f) + src[k + 1] * f;
  }
  return out;
}

function sectionMask(events, n, pred) {
  const m = new Float32Array(n);
  for (const e of events) if (pred(e)) {
    const a = Math.max(0, Math.round((e.t - 0.4) * SR)), b = Math.min(n, Math.round((e.t + e.d + 0.5) * SR));
    for (let i = a; i < b; i++) m[i] = 1;
  }
  // smooth edges (~60 ms)
  const k = Math.round(0.06 * SR); let acc = 0; const o = new Float32Array(n);
  for (let i = 0; i < n; i++) { acc += m[i] - (i >= k ? m[i - k] : 0); o[i] = acc / k; }
  return o;
}

function mixdown(lead, harm, events, style, n) {
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = lead[i]; R[i] = lead[i]; }
  const chorusPred = (e) => e.sec === 'chorus' || e.sec === 'outro';
  if (style === 'double' || style === 'harmony') {
    const mask = style === 'double' ? null : sectionMask(events, n, chorusPred);
    const d1 = adt(lead, 19, 2.2, 0.31, 1), d2 = adt(lead, 27, 2.8, 0.23, 2);
    const g = style === 'double' ? 0.34 : 0.3;
    for (let i = 0; i < n; i++) { const m = mask ? mask[i] : 1; L[i] += d1[i] * g * m * 0.9; R[i] += d2[i] * g * m; L[i] -= 0; }
  }
  if (harm) {
    // harmony part, a little left of centre and behind the lead
    for (let i = 0; i < n; i++) { L[i] += harm[i] * 0.3; R[i] += harm[i] * 0.17; }
  }
  // soft safety limiter
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = pk > 0.95 ? 0.95 / pk : 1;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  return { L, R };
}

// vocal presence envelope (20 Hz) for ducking the instruments under the words
function envelope(lead, n) {
  const hop = SR / 20, m = Math.ceil(n / hop), env = new Float32Array(m);
  for (let b = 0; b < m; b++) { let s = 0; const e = Math.min(n, (b + 1) * hop); for (let i = b * hop; i < e; i++) s += lead[i] * lead[i]; env[b] = Math.sqrt(s / hop); }
  const out = new Float32Array(m);
  let v = 0; for (let b = 0; b < m; b++) { const x = Math.min(1, env[b] / 0.05); v = x > v ? 0.5 * v + 0.5 * x : 0.88 * v + 0.12 * x; out[b] = v; }
  return out;
}

async function render(id, events, opts) {
  await load();
  const vname = opts.voice || 'af_heart';
  const vb = await voice(vname);
  const n = Math.ceil((opts.durationSec + 0.5) * SR);
  const lead = new Float32Array(n);
  const phrases = SP.groupEvents(events);
  const words = new Set(); phrases.forEach(p => p.words.forEach(w => words.add(w.raw)));
  for (const w of words) await ipa(w);
  const ipaOf = (w) => ipaCache.get(w) || '';
  const style = opts.style || 'harmony';
  // plan lead chunks; identical repeats (e.g. choruses) share one take
  const plans = [];
  for (const ph of phrases) {
    const seed = (opts.seed || 1) ^ (ph.words.map(w => w.raw).join(' ').length * 2654435761);
    for (const ch of SP.planPhrase(ph, ipaOf, { seed: seed >>> 0, semitones: 0 })) plans.push({ ch, sec: ph.sec });
  }
  let harmPlans = [];
  if (style === 'harmony' && SV && SV.harmonyEvents) {
    const hev = SV.harmonyEvents(events.filter(e => e.sec === 'chorus' || e.sec === 'outro'), opts.song || {});
    for (const ph of SP.groupEvents(hev)) {
      const seed = ((opts.seed || 1) * 7 + 3) ^ (ph.words.length * 977);
      for (const ch of SP.planPhrase(ph, ipaOf, { seed: seed >>> 0, vibrato: 0.6 })) harmPlans.push({ ch });
    }
  }
  const totalWork = plans.reduce((a, p) => a + p.ch.frames, 0) + harmPlans.reduce((a, p) => a + p.ch.frames, 0);
  let done = 0, lastPost = 0;
  const t0 = Date.now();
  const sendPartial = (final, harm) => {
    const mix = mixdown(lead, harm || null, events, style, n);
    const env = envelope(lead, n);
    post({ type: final ? 'done' : 'partial', id, sr: SR, L: mix.L, R: mix.R, env, durationSec: n / SR, progress: done / Math.max(1, totalWork), upto: final ? opts.durationSec : upto, ms: Date.now() - t0 }, [mix.L.buffer, mix.R.buffer, env.buffer]);
  };
  let upto = 0;
  for (const p of plans) {
    await yieldNow();
    if (id !== current) return; // superseded
    const w = await runChunk(vname, vb, p.ch);
    place(lead, w, p.ch.start);
    done += p.ch.frames; upto = p.ch.start + w.length / SR;
    post({ type: 'progress', id, progress: done / Math.max(1, totalWork) });
    if (Date.now() - lastPost > 3000 || lastPost === 0) { lastPost = Date.now(); sendPartial(false); }
  }
  let harm = null;
  if (harmPlans.length) {
    sendPartial(false); // the whole lead is ready; harmonies follow

    harm = new Float32Array(n);
    for (const p of harmPlans) {
      await yieldNow();
      if (id !== current) return;
      const w = await runChunk(vname, vb, p.ch);
      place(harm, w, p.ch.start);
      done += p.ch.frames;
      post({ type: 'progress', id, progress: done / Math.max(1, totalWork), harmony: true });
    }
  }
  if (id !== current) return;
  sendPartial(true, harm);
}

self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type === 'load') { try { await load(); } catch (err) { post({ type: 'error', id: 0, error: String(err && err.message || err) }); } return; }
  if (d.type === 'render') {
    current = d.id;
    try { await render(d.id, d.events, d.opts || {}); }
    catch (err) { post({ type: 'error', id: d.id, error: String(err && err.message || err) }); }
  }
};
post({ type: 'hello' });
