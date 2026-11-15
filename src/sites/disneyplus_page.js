// Disney+, PAGE world: the <video> element accepts currentTime / play / pause directly (public knowledge; not
// verified on a live account). Anything Disney+ needs beyond that belongs here.
(() => {
  const video = () => {
    const vs = Array.from(document.querySelectorAll('video'));
    return vs.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0];
  };
  window.__surasuraPlayer = {
    seek(t) { const v = video(); if (!v) throw new Error('disney+: no video element'); v.currentTime = t; },
    play() { const v = video(); if (v) return v.play(); },
    pause() { const v = video(); if (v) v.pause(); },
    blocker() { return null; },
  };
  console.log('[surasura] disneyplus page player ready');
})();
