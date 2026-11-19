// Talks to Surasura on 127.0.0.1:27631 (and nothing else) and keeps undelivered subtitles.
(function (root) {
  const BASE = 'http://127.0.0.1:27631';
  const MAX_QUEUE = 20;

  async function hello(fetchFn) {
    try {
      const r = await fetchFn(BASE + '/v1/hello', { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.app === 'surasura' ? j : null;
    } catch (e) {
      return null;
    }
  }

  // -> {status: added|exists|offline|busy|badtoken|rejected, why?, item?}
  async function post(payload, token, fetchFn) {
    let r;
    try {
      r = await fetchFn(BASE + '/v1/online-subtitle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Surasura-Token': token || '' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return { status: 'offline' };
    }
    if (r.status === 401) return { status: 'badtoken' };
    if (r.status === 503) return { status: 'busy' };
    let j = null;
    try { j = await r.json(); } catch (e) { /* ignore */ }
    if (r.status === 200 && j && j.ok) return { status: j.added ? 'added' : 'exists', item: j.item };
    if (r.status >= 500) return { status: 'busy' };
    return { status: 'rejected', why: (j && j.why) || 'HTTP ' + r.status };
  }

  const keyOf = (p) => [p.site, p.video_id, p.language].join('|');
  const RETRY = new Set(['offline', 'busy', 'badtoken']);

  // deps: {fetch, storage: {get(key), set(key, value)}}
  async function deliver(payload, deps) {
    const token = await deps.storage.get('token');
    const res = await post(payload, token, deps.fetch);
    if (RETRY.has(res.status)) {
      const q = ((await deps.storage.get('queue')) || []).filter((p) => keyOf(p) !== keyOf(payload));
      q.push(payload);
      await deps.storage.set('queue', q.slice(-MAX_QUEUE));
      res.queued = true;
    }
    return res;
  }

  async function flush(deps) {
    const q = (await deps.storage.get('queue')) || [];
    if (!q.length) return { sent: 0, left: 0 };
    if (!(await hello(deps.fetch))) return { sent: 0, left: q.length };
    const token = await deps.storage.get('token');
    const left = [];
    let sent = 0, stop = false;
    for (const p of q) {
      if (stop) { left.push(p); continue; }
      const res = await post(p, token, deps.fetch);
      if (RETRY.has(res.status)) { left.push(p); stop = true; } else sent++;
    }
    await deps.storage.set('queue', left);
    return { sent, left: left.length };
  }

  // info: {title, show, season, episode} (edited in the popup); strips the URL's query/hash.
  function buildPayload(st, track, cues, info, cover) {
    const num = (v) => (v === '' || v == null || !Number.isFinite(+v) ? null : +v);
    const p = {
      schema: 1,
      site: st.site,
      video_id: st.videoId,
      url: String(st.url).split(/[?#]/)[0],
      language: track.language || 'und',
      title: (info.title || '').trim() || st.docTitle || st.videoId,
      cues,
    };
    if (info.show && info.show.trim()) {
      p.show = { title: info.show.trim() };
      if (num(info.season) != null) p.show.season = num(info.season);
      if (num(info.episode) != null) p.show.episode = num(info.episode);
    }
    if (cover) p.cover = cover;
    return p;
  }

  // ---- v2: jobs and clips ----
  const hdr = (token, extra) => Object.assign({ 'X-Surasura-Token': token || '' }, extra || {});

  // -> {status: 'ok', jobs} | {status: 'offline'|'badtoken'|'busy'|'unsupported'}
  async function getJobs(token, fetchFn) {
    try {
      const r = await fetchFn(BASE + '/v1/jobs', { headers: hdr(token), cache: 'no-store' });
      if (r.status === 401) return { status: 'badtoken' };
      if (r.status === 503) return { status: 'busy' };
      if (r.status === 404) return { status: 'unsupported' };
      const j = await r.json();
      return { status: 'ok', jobs: (j && j.jobs) || [] };
    } catch (e) {
      return { status: 'offline' };
    }
  }

  // Surasura answers 503 while it is busy (e.g. making cards from the clips it just got) and a connection can drop for a
  // moment: try again a few times before calling it "not answering". -> the last Response, or throws the last error.
  const WAITS = [2000, 5000, 10000];
  const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function fetchRetry(fetchFn, url, opts, sleep) {
    for (let i = 0; ; i++) {
      let r = null, err = null;
      try { r = await fetchFn(url, opts); } catch (e) { err = e; }
      if (r && r.status !== 503) return r;
      console.log('[surasura] ' + url.split('/v1/')[1] + ' ->', r ? r.status + ' (busy)' : 'no answer: ' + err, i < WAITS.length ? '; trying again' : '; giving up');
      if (i >= WAITS.length) { if (r) return r; throw err; }
      await (sleep || realSleep)(WAITS[i]);
    }
  }

  // -> 'ok' | 'gone' (404: skip) | 'toolarge' | 'abort' (Surasura still busy / not answering after retries, wrong token)
  async function postClip(token, job, n, blob, start, end, fetchFn, sleep) {
    try {
      const r = await fetchRetry(fetchFn, BASE + '/v1/jobs/' + job + '/clips/' + n, {
        method: 'POST',
        headers: hdr(token, { 'Content-Type': 'video/webm', 'X-Clip-Start': String(start), 'X-Clip-End': String(end) }),
        body: blob,
      }, sleep);
      if (r.status === 200) return 'ok';
      if (r.status === 404) return 'gone';
      if (r.status === 413) return 'toolarge';
      console.log('[surasura] clip ' + n + ' of job ' + job + ': HTTP ' + r.status);
      return 'abort';
    } catch (e) {
      return 'abort';
    }
  }

  async function postDone(token, job, failed, fetchFn, sleep) {
    try {
      const r = await fetchRetry(fetchFn, BASE + '/v1/jobs/' + job + '/done', {
        method: 'POST', headers: hdr(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ failed }),
      }, sleep);
      if (r.status !== 200) console.log('[surasura] done of job ' + job + ': HTTP ' + r.status);
      return r.status === 200;
    } catch (e) {
      return false;
    }
  }

  // -> {status:'ok', queued} | {status:'refused', why} (409) | badtoken | busy | offline | {status:'rejected', why}
  async function postYoutube(token, urls, fetchFn) {
    let r;
    try {
      r = await fetchFn(BASE + '/v1/youtube', { method: 'POST', headers: hdr(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ schema: 1, urls }) });
    } catch (e) { return { status: 'offline' }; }
    if (r.status === 401) return { status: 'badtoken' };
    if (r.status === 503) return { status: 'busy' };
    let j = null;
    try { j = await r.json(); } catch (e) { /* ignore */ }
    if (r.status === 200 && j && j.ok) return { status: 'ok', queued: j.queued };
    if (r.status === 409) return { status: 'refused', why: (j && j.why) || 'Surasura said no' };
    return { status: 'rejected', why: (j && j.why) || 'HTTP ' + r.status };
  }

  const api = { BASE, hello, post, deliver, flush, keyOf, buildPayload, getJobs, postClip, postDone, postYoutube };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraDelivery = api;
})(typeof self !== 'undefined' ? self : globalThis);
