// EXPERIMENTAL season walk (Netflix): walk the same tab through each episode of the season, let the player load
// the subtitle track in the wanted language, and post each episode. Pure logic over `env` (fakeable in tests).
// env = {navigate(url), getState(), getCues(key), getMeta(), getCover(), pause(), play(), mute(on),
//        build(state, track, cues, meta, cover) -> payload, post(payload) -> {status, why?},
//        sleep, now, shouldStop, onProgress}
(function (root) {
  const STOP = { stop: true };

  async function waitFor(env, pred, timeoutMs, step) {
    const t0 = env.now();
    for (;;) {
      if (env.shouldStop()) throw STOP;
      let v = null;
      try { v = await pred(); } catch (e) { v = null; }
      if (v) return v;
      if (env.now() - t0 > timeoutMs) return null;
      await env.sleep(step || 500);
    }
  }

  async function postWithRetry(env, payload) {
    let r;
    for (let i = 0; i < 4; i++) {
      r = await env.post(payload);
      if (r.status !== 'busy') return r;
      await env.sleep(5000);
    }
    return r;
  }

  // opts = {episodes:[{id,seq,title}], language, startId}
  async function walkSeason(opts, env) {
    const results = [];
    const n = opts.episodes.length;
    let status = 'done';
    let known = null; // the show's metadata, read from an episode already walked
    try {
      for (let i = 0; i < n; i++) {
        const ep = opts.episodes[i];
        if (env.shouldStop()) throw STOP;
        env.onProgress({ kind: 'season', i: i + 1, n, title: ep.title || 'episode ' + ep.seq, done: results.filter((r) => r.ok).length });
        const here = await env.getState().catch(() => null);
        if (!(here && here.videoId === String(ep.id))) {
          await env.navigate('https://www.netflix.com/watch/' + ep.id);
          const ready = await waitFor(env, async () => {
            const s = await env.getState();
            return s && s.videoId === String(ep.id) && s;
          }, 45000);
          if (!ready) { results.push({ id: ep.id, ok: false, why: 'the episode page did not load' }); continue; }
        }
        try {
          // a fresh episode page has no player session for a moment: wait for it, then start (Netflix may autoplay anyway)
          const up = await waitFor(env, () => env.playerReady(), 30000);
          if (!up) { results.push({ id: ep.id, ok: false, why: 'the player did not start' }); continue; }
          try { await env.mute(true); await env.play(); } catch (e) { /* autoplay may already be running */ }
          const found = await waitFor(env, async () => {
            const s = await env.getState();
            const t = s.tracks.find((x) => x.count > 0 && (!opts.language || x.language === opts.language));
            return t && { s, t };
          }, 30000);
          if (!found) {
            results.push({ id: ep.id, ok: false, why: `no ${opts.language || ''} subtitles appeared (turn them on once for this show)` });
            continue;
          }
          await env.sleep(1500); // let the file finish arriving
          const s = await env.getState();
          const t = s.tracks.find((x) => x.key === found.t.key) || found.t;
          const { cues } = await env.getCues(t.key);
          // the player's metadata for a fresh episode can arrive after its subtitles: wait for it; still none, this
          // episode's place from the season list on the show's metadata from an earlier episode
          let meta = await waitFor(env, () => env.getMeta(), 15000);
          if (!meta && known) meta = Object.assign({}, known, { episode: ep.seq ?? null, title: ep.title || null });
          if (!meta) meta = await env.getMeta(); // (throws the player's own reason)
          if (!meta.film && meta.show) known = { film: false, show: meta.show, season: meta.season, coverUrl: meta.coverUrl };
          const first = !results.some((r) => r.ok);
          const cover = first ? await env.getCover().catch(() => null) : null; // artwork goes with the first episode
          const r = await postWithRetry(env, env.build(s, t, cues, meta, cover));
          if (r.status === 'added' || r.status === 'exists') results.push({ id: ep.id, ok: true, status: r.status });
          else if (r.status === 'rejected') results.push({ id: ep.id, ok: false, why: 'Surasura did not accept it: ' + r.why });
          else { status = 'aborted'; results.push({ id: ep.id, ok: false, why: 'Surasura: ' + r.status }); break; }
        } catch (e) {
          if (e === STOP) throw e;
          results.push({ id: ep.id, ok: false, why: 'error: ' + (e && e.message ? e.message : e) });
        } finally {
          try { await env.pause(); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) {
      if (e !== STOP) throw e;
      status = 'stopped';
    }
    try {
      await env.mute(false);
      const now = await env.getState().catch(() => null);
      if (opts.startId && !(now && now.videoId === String(opts.startId))) await env.navigate('https://www.netflix.com/watch/' + opts.startId);
    } catch (e) { /* best effort */ }
    return { status, results };
  }

  const api = { walkSeason, STOP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraSeason = api;
})(typeof self !== 'undefined' ? self : globalThis);
