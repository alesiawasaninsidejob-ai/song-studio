/* Service worker: also adds cross-origin isolation headers (COOP/COEP) so the singer can use
   several CPU threads on GitHub Pages, which cannot set those headers itself.
   Service worker: app files are network-first (always the newest version online, cache offline).
   Big, never-changing files (runtime, voices) are cache-first. The voice model itself is cached
   by the singer worker, so it is not stored twice. */
const CACHE = 'song-studio-v4';
const STATIC = 'song-studio-static-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'js/parser.js', 'js/composer.js', 'js/lyrics.js', 'js/voice.js', 'js/voice-worker.js', 'js/sing-plan.js', 'js/singer-worker.js', 'js/synth.js', 'js/app.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('song-studio-') && k !== CACHE && k !== STATIC).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  if (url.pathname.includes('/models/')) { e.respondWith(fetch(req).then(isolate)); return; } // stored by the singer worker's own cache
  if (url.pathname.includes('/vendor/') || url.pathname.includes('/voices/')) {
    e.respondWith(caches.open(STATIC).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; }))).then(isolate));
    return;
  }
  e.respondWith(
    fetch(req, { cache: 'no-store' }).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))).then(isolate)
  );
});
