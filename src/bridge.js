// PAGE world. Answers commands from the content script about the player: seek/play/pause/state.
// Site files (sites/*_page.js) define window.__surasuraPlayer first; this fills in what they leave out.
(() => {
  const site = window.__surasuraPlayer || {};
  const video = () => {
    const vs = Array.from(document.querySelectorAll('video'));
    return vs.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0] || null;
  };
  let undoIsolate = null;
  const ops = {
    seek: (a) => (site.seek ? site.seek(a.t) : (video().currentTime = a.t)),
    play: () => (site.play ? site.play() : video().play()),
    pause: () => (site.pause ? site.pause() : video() && video().pause()),
    meta: () => (site.meta ? site.meta() : null),
    mute: (a) => { const v = video(); if (v) v.muted = !!a.on; },
    hideUi: () => {
      if (undoIsolate) return;
      const v = video();
      if (v) undoIsolate = self.SurasuraIsolate.isolate(document, v);
    },
    showUi: () => { if (undoIsolate) { undoIsolate(); undoIsolate = null; } },
    state: () => {
      const v = video();
      return {
        ok: !!v, t: v ? v.currentTime : 0, paused: v ? v.paused : true, seeking: v ? v.seeking : false,
        readyState: v ? v.readyState : 0, apiReady: site.ready ? !!site.ready() : true, url: location.href, visibility: document.visibilityState, blocker: site.blocker ? site.blocker() : null,
      };
    },
  };
  window.addEventListener('message', async (ev) => {
    const d = ev.data;
    if (ev.source !== window || !d || d.source !== 'surasura-cmd') return;
    let result, error;
    try { result = await ops[d.op](d.args || {}); } catch (e) { error = String((e && e.message) || e); }
    if (d.op !== 'state') globalThis.UKAI_DEBUG && console.log('[surasura] page command', d.op, JSON.stringify(d.args || {}), error ? 'FAILED: ' + error : 'ok');
    window.postMessage({ source: 'surasura-reply', id: d.id, result: result === undefined ? null : result, error }, '*');
  });
})();
