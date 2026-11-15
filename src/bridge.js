// PAGE world. Answers commands from the content script about the player: seek/play/pause/state.
// Site files (sites/*_page.js) define window.__surasuraPlayer first; this fills in what they leave out.
(() => {
  const site = window.__surasuraPlayer || {};
  const video = () => {
    const vs = Array.from(document.querySelectorAll('video'));
    return vs.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0] || null;
  };
  const ops = {
    seek: (a) => (site.seek ? site.seek(a.t) : (video().currentTime = a.t)),
    play: () => (site.play ? site.play() : video().play()),
    pause: () => (site.pause ? site.pause() : video() && video().pause()),
    hideUi: () => {
      let st = document.getElementById('surasura-hide');
      if (!st) { st = document.createElement('style'); st.id = 'surasura-hide'; document.documentElement.appendChild(st); }
      st.textContent = (site.hideCss ? site.hideCss() : '') + ' { visibility: hidden !important; }';
    },
    showUi: () => { const st = document.getElementById('surasura-hide'); if (st) st.remove(); },
    state: () => {
      const v = video();
      return {
        ok: !!v, t: v ? v.currentTime : 0, paused: v ? v.paused : true, seeking: v ? v.seeking : false,
        readyState: v ? v.readyState : 0, url: location.href, blocker: site.blocker ? site.blocker() : null,
      };
    },
  };
  window.addEventListener('message', async (ev) => {
    const d = ev.data;
    if (ev.source !== window || !d || d.source !== 'surasura-cmd') return;
    let result, error;
    try { result = await ops[d.op](d.args || {}); } catch (e) { error = String((e && e.message) || e); }
    window.postMessage({ source: 'surasura-reply', id: d.id, result: result === undefined ? null : result, error }, '*');
  });
})();
