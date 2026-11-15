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
    // the site's own subtitles and controls, hidden while a clip is recorded (selectors from public knowledge)
    hideCss() {
      return '.player-timedtext, .watch-video--bottom-controls-container, [data-uia="controls-standard"], [data-uia="video-title"], .watch-video--back-container';
    },
    blocker() {
      return document.querySelector('[data-uia="interrupt-autoplay-paused"]') ? 'are-you-still-watching' : null;
    },
  };
  console.log('[surasura] netflix page player ready');
})();
