// Talks to Surasura on 127.0.0.1:27631 (and nothing else) and keeps undelivered subtitles.
(function (root) {
  const BASE = 'http://127.0.0.1:27631';

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

  // Pairing (Surasura's one-Allow flow): ask, show the code, then look every second until the learner answers there.
  // -> {status: 'asked', pair, code} | offline | busy (another extension is being asked, or Surasura is busy) |
  //    unsupported (this Surasura has no pairing) | rejected
  async function pairAsk(version, fetchFn) {
    let r;
    try {
      r = await fetchFn(BASE + '/v1/pair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: version || '' }),
      });
    } catch (e) {
      return { status: 'offline' };
    }
    let j = null;
    try { j = await r.json(); } catch (e) { /* ignore */ }
    if (r.status === 200 && j && typeof j.pair === 'string' && j.code != null) return { status: 'asked', pair: j.pair, code: String(j.code) };
    if (r.status === 404) return { status: 'unsupported' };
    if (r.status === 409 || r.status >= 500) return { status: 'busy', why: j && j.why };
    return { status: 'rejected', why: (j && j.why) || 'HTTP ' + r.status };
  }

  // -> {status: 'waiting' | 'denied' | 'gone' | 'offline' | 'busy' | 'rejected'} | {status: 'allowed', token}
  // (the token comes once: the caller keeps it before anything else)
  async function pairClaim(pair, fetchFn) {
    let r;
    try {
      r = await fetchFn(BASE + '/v1/pair/' + encodeURIComponent(pair), { cache: 'no-store' });
    } catch (e) {
      return { status: 'offline' };
    }
    let j = null;
    try { j = await r.json(); } catch (e) { /* ignore */ }
    if (r.status === 404) return { status: 'gone' };
    if (r.status >= 500) return { status: 'busy' };
    if (r.status !== 200 || !j) return { status: 'rejected', why: (j && j.why) || 'HTTP ' + r.status };
    if (j.state === 'allowed') return typeof j.token === 'string' && j.token ? { status: 'allowed', token: j.token } : { status: 'rejected', why: 'no token' };
    if (j.state === 'denied') return { status: 'denied' };
    return { status: 'waiting' };
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

  // The waiting list is capped in BYTES (chrome.storage.local holds 10 MB in all; cues are ~3 bytes per
  // Japanese character and a cover is base64). Counted as UTF-8 bytes of the JSON, as Chrome counts.
  const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
  const byteSize = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

  // Pure. Put `incoming` last (replacing the same episode) and fit the list under `cap` bytes:
  // first the artwork of waiting payloads is dropped (oldest first, the incoming one last); if it still does
  // not fit, the incoming subtitle is refused. Nothing already waiting is ever thrown away.
  // -> {queue, refused, coversDropped}
  function fitQueue(queue, incoming, cap) {
    const q = queue.filter((p) => keyOf(p) !== keyOf(incoming)).concat([incoming]);
    let coversDropped = 0;
    let total = byteSize(q);
    for (let i = 0; i < q.length && total > cap; i++) {
      if (q[i].cover) {
        const { cover, ...rest } = q[i]; // eslint-disable-line no-unused-vars
        q[i] = rest;
        coversDropped++;
        total = byteSize(q);
      }
    }
    if (total > cap) return { queue: queue.filter((p) => keyOf(p) !== keyOf(incoming)), refused: true, coversDropped: 0 };
    return { queue: q, refused: false, coversDropped };
  }

  // deps: {fetch, storage: {get(key), set(key, value)}}
  async function deliver(payload, deps, cap) {
    const token = await deps.storage.get('token');
    const res = await post(payload, token, deps.fetch);
    if (RETRY.has(res.status)) {
      const old = (await deps.storage.get('queue')) || [];
      const fit = fitQueue(old, payload, cap || MAX_QUEUE_BYTES);
      let saved = !fit.refused;
      if (saved) {
        try { await deps.storage.set('queue', fit.queue); } catch (e) { saved = false; } // quota said no
      }
      res.queued = saved;
      if (!saved) res.queueFull = true;
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
  // about 3 1/2 minutes in all: making cards from a finished episode can keep Surasura busy for a while
  const WAITS = [2000, 5000, 10000, 15000, 20000, 30000, 30000, 30000, 30000, 30000];
  const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // waits `ms` in half-second steps so a Stop is noticed within half a second
  async function waitInterruptible(ms, sleep, shouldStop) {
    for (let left = ms; left > 0; left -= 500) {
      if (shouldStop && shouldStop()) throw new Error('stopped');
      await (sleep || realSleep)(Math.min(500, left));
    }
    if (shouldStop && shouldStop()) throw new Error('stopped');
  }

  async function fetchRetry(fetchFn, url, opts, sleep, shouldStop) {
    for (let i = 0; ; i++) {
      let r = null, err = null;
      try { r = await fetchFn(url, opts); } catch (e) { err = e; }
      if (r && r.status !== 503) return r;
      console.log('[surasura] ' + url.split('/v1/')[1] + ' ->', r ? r.status + ' (busy)' : 'no answer: ' + err, i < WAITS.length ? '; trying again' : '; giving up');
      if (i >= WAITS.length) { if (r) return r; throw err; }
      await waitInterruptible(WAITS[i], sleep, shouldStop);
    }
  }

  // -> 'ok' | 'gone' (404: skip) | 'toolarge' | 'abort' (Surasura still busy / not answering after retries, wrong token)
  async function postClip(token, job, n, blob, start, end, fetchFn, sleep, shouldStop) {
    try {
      const r = await fetchRetry(fetchFn, BASE + '/v1/jobs/' + job + '/clips/' + n, {
        method: 'POST',
        headers: hdr(token, { 'Content-Type': 'video/webm', 'X-Clip-Start': String(start), 'X-Clip-End': String(end) }),
        body: blob,
      }, sleep, shouldStop);
      if (r.status === 200) return 'ok';
      if (r.status === 404) return 'gone';
      if (r.status === 413) return 'toolarge';
      console.log('[surasura] clip ' + n + ' of job ' + job + ': HTTP ' + r.status);
      return 'abort';
    } catch (e) {
      return 'abort';
    }
  }

  // `rev`: the job's lines' revision as GET /v1/jobs listed it (echoed so a `done` for an older set of lines never
  // closes lines Surasura added since; Surasura without it keeps the job open until every line has a clip or failed)
  async function postDone(token, job, failed, fetchFn, sleep, shouldStop, rev) {
    try {
      const body = Number.isInteger(rev) ? { failed, rev } : { failed };
      const r = await fetchRetry(fetchFn, BASE + '/v1/jobs/' + job + '/done', {
        method: 'POST', headers: hdr(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(body),
      }, sleep, shouldStop);
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

  const api = { WAITS, BASE, hello, pairAsk, pairClaim, post, deliver, flush, keyOf, fitQueue, byteSize, MAX_QUEUE_BYTES, buildPayload, getJobs, postClip, postDone, postYoutube };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraDelivery = api;
})(typeof self !== 'undefined' ? self : globalThis);
