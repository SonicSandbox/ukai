// Readers for the player's own metadata (page world). Pure functions over plain objects, so they can be tested.
(function (root) {
  // smallest artwork at least 300 px wide, else the largest one
  function pickArt(v) {
    for (const k of ['boxart', 'artwork', 'storyart']) {
      const a = v[k];
      if (Array.isArray(a) && a.length) {
        const ok = a.filter((x) => x && x.url);
        const big = ok.filter((x) => (x.w || 0) >= 300).sort((x, y) => x.w - y.w)[0];
        const best = big || ok.sort((x, y) => (y.w || 0) - (x.w || 0))[0];
        if (best) return best.url;
      }
    }
    return null;
  }

  // Netflix: playerApp.getState().videoPlayer.videoMetadata[id]._metadata.video
  // -> {film, show, season, episode, title, coverUrl, episodes:[{id,seq,title}]} | null
  function netflixMeta(videoMetadata, id) {
    const entry = videoMetadata && (videoMetadata[id] || videoMetadata[String(id)]);
    const v = entry && ((entry._metadata && entry._metadata.video) || entry.video);
    if (!v) return null;
    const coverUrl = pickArt(v);
    if (v.type === 'movie' || !Array.isArray(v.seasons)) return { film: true, title: v.title || null, coverUrl };
    for (const s of v.seasons) {
      for (const e of s.episodes || []) {
        if (String(e.id) === String(id)) {
          return {
            film: false, show: v.title || null, season: Number.isFinite(+s.seq) ? +s.seq : null,
            episode: Number.isFinite(+e.seq) ? +e.seq : null, title: e.title || null, coverUrl,
            episodes: (s.episodes || []).map((x) => ({ id: String(x.id), seq: x.seq, title: x.title })),
          };
        }
      }
    }
    return { film: false, show: v.title || null, coverUrl };
  }

  const api = { netflixMeta, pickArt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraMeta = api;
})(typeof self !== 'undefined' ? self : globalThis);
