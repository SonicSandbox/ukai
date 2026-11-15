// Netflix, PAGE world: seek/play/pause through the player's own API (setting video.currentTime directly breaks it).
// Based on public knowledge of the web player (netflix.appContext...videoPlayer); not verified on a live account.
(() => {
  function player() {
    const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const ids = vp.getAllPlayerSessionIds();
    if (!ids.length) throw new Error('netflix: no player session');
    return vp.getVideoPlayerBySessionId(ids[ids.length - 1]);
  }
  window.__surasuraPlayer = {
    seek(t) { player().seek(Math.round(t * 1000)); },
    play() { player().play(); },
    pause() { player().pause(); },
    meta() {
      const id = (location.pathname.match(/\/watch\/(\d+)/) || [])[1];
      const ps = window.netflix.appContext.state.playerApp.getState();
      const vm = ps && ps.videoPlayer && ps.videoPlayer.videoMetadata;
      if (!vm) throw new Error('no videoMetadata; videoPlayer keys: ' + Object.keys((ps && ps.videoPlayer) || {}).join(','));
      const m = id ? self.SurasuraMeta.netflixMeta(vm, id) : null;
      if (!m) {
        const e = vm[id] || {};
        const keys = (o) => (o && typeof o === 'object' ? Object.keys(o).slice(0, 15).join(',') : typeof o);
        throw new Error('entry has no video data; entry keys: ' + keys(e) + '; _metadata keys: ' + keys(e._metadata) + '; video keys: ' + keys(e._metadata && e._metadata.video));
      }
      return m;
    },
    blocker() {
      return document.querySelector('[data-uia="interrupt-autoplay-paused"]') ? 'are-you-still-watching' : null;
    },
  };
  console.log('[surasura] netflix page player ready');
})();
