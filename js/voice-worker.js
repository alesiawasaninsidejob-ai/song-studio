/* Song Studio — renders the vocal track off the main thread. */
importScripts('voice.js');
self.onmessage = (e) => {
  const { id, events, opts } = e.data;
  try {
    const t = self.SongVoice.renderVocalTrack(events, opts);
    self.postMessage({ id, sr: t.sr, L: t.L, R: t.R, durationSec: t.durationSec }, [t.L.buffer, t.R.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
