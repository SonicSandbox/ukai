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

  const RELOADS = 2; // a Netflix page stuck spinning between episodes is loaded again, at most this often

  // The episode's page open, its player up and its subtitles in the language there. A page that hangs (no page, no
  // player session, no subtitles at all after a few seconds) is reloaded; an episode whose subtitles are there but not
  // in the language is not (a reload won't bring them). -> {ok, s, t} | {ok:false, why}
  async function loadEpisode(ep, opts, env, onReload) {
    const url = 'https://www.netflix.com/watch/' + ep.id;
    let why = 'the episode page did not load';
    for (let attempt = 0; attempt <= RELOADS; attempt++) {
      if (attempt > 0) { onReload(attempt); await env.navigate(url); } else {
        const here = await env.getState().catch(() => null);
        if (!(here && here.videoId === String(ep.id))) await env.navigate(url);
      }
      const page = await waitFor(env, async () => {
        const s = await env.getState();
        return s && s.videoId === String(ep.id) && s;
      }, 20000);
      if (!page) { why = 'the episode page did not load'; continue; }
      // a fresh episode page has no player session for a moment: wait for it, then start (Netflix may autoplay anyway)
      if (!(await waitFor(env, () => env.playerReady(), 15000))) { why = 'the player did not start'; continue; }
      try { await env.mute(true); await env.play(); } catch (e) { /* autoplay may already be running */ }
      const found = await waitFor(env, async () => {
        const s = await env.getState();
        const t = s.tracks.find((x) => x.count > 0 && (!opts.language || x.language === opts.language));
        return t && { s, t };
      }, 20000);
      if (found) return Object.assign({ ok: true }, found);
      why = `no ${opts.language || ''} subtitles appeared (turn them on once for this show)`;
      const s = await env.getState().catch(() => null);
      if (s && s.tracks && s.tracks.some((x) => x.count > 0)) return { ok: false, why }; // other languages came: not stuck
    }
    return { ok: false, why: why + ` (after ${RELOADS} reloads)` };
  }

  // opts = {episodes:[{id,seq,title}], language, startId}
  async function walkSeason(opts, env) {
    const results = [];
    const n = opts.episodes.length;
    let status = 'done';
    let message;
    let known = null; // the show's metadata, read from an episode already walked
    try {
      for (let i = 0; i < n; i++) {
        const ep = opts.episodes[i];
        if (env.shouldStop()) throw STOP;
        if (env.tabAlive && !(await env.tabAlive())) { status = 'ended'; message = 'Ukai\'s window was closed, so the season walk stopped.'; break; }
        env.onProgress({ kind: 'season', i: i + 1, n, title: ep.title || 'episode ' + ep.seq, done: results.filter((r) => r.ok).length });
        try {
          const found = await loadEpisode(ep, opts, env, (attempt) => env.onProgress({
            kind: 'season', i: i + 1, n, title: (ep.title || 'episode ' + ep.seq) + ` (reloading, try ${attempt + 1})`,
            done: results.filter((r) => r.ok).length,
          }));
          if (!found.ok) { results.push({ id: ep.id, ok: false, why: found.why }); continue; }
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
    return { status, results, message };
  }

  const api = { walkSeason, STOP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraSeason = api;
})(typeof self !== 'undefined' ? self : globalThis);
