// The mining walk: for each wanted line, seek, play, record, post the clip. Pure logic over an `env`
// (player, recorder, api, clock) so it can be tested with fakes; offscreen/offscreen.js supplies the real ones.
//
// env = {
//   player:   {seek(t), play(), pause(), state() -> {ok, t, paused, seeking, readyState, url, blocker}}
//   recorder: {start() -> Promise, stop() -> Promise<{size}>}      (one clip at a time)
//   api:      {postClip(job, n, blob, start, end) -> 'ok'|'gone'|'toolarge'|'abort', postDone(job, failed) -> bool}
//   navigate(url), streamAlive() -> bool, sleep(ms), now() -> ms, shouldStop() -> bool, onProgress(p)
// }
(function (root) {
  const MAX_CLIP = 40 * 1024 * 1024;
  const GIVE_UP_AFTER = 3; // consecutive failed lines in one job
  const STOP = { stop: true };
  const ABORT = { abort: true };

  async function waitFor(env, pred, timeoutMs, step) {
    const t0 = env.now();
    for (;;) {
      if (env.shouldStop()) throw STOP;
      const v = await pred();
      if (v) return v;
      if (env.now() - t0 > timeoutMs) return null;
      await env.sleep(step || 100);
    }
  }

  const blockerNote = (s) => (s && s.blocker ? ` (${s.blocker})` : '') +
    (s && s.visibility ? ` [t=${Number(s.t).toFixed(1)}, readyState=${s.readyState}, page ${s.visibility}]` : '');

  async function recordLine(job, line, env) {
    // everything but the video is hidden from before the seek until the clip is done (also on failure / Stop)
    if (env.player.hideUi) await env.player.hideUi().catch(() => {});
    try {
      return await recordLineInner(job, line, env);
    } finally {
      if (env.player.showUi) { try { await env.player.showUi(); } catch (e) { /* ignore */ } }
    }
  }

  async function recordLineInner(job, line, env) {
    const P = env.player;
    const target = Math.max(0, line.start - job.pad_before);
    const endT = line.end + job.pad_after;
    await P.pause();
    await P.seek(target);
    let s = await waitFor(env, async () => {
      const x = await P.state();
      return x.ok && !x.seeking && x.readyState >= 3 && Math.abs(x.t - target) <= 3 && x;
    }, 15000);
    if (!s) return { why: 'seek failed' + blockerNote(await P.state()) };
    const base = s.t;
    await P.play();
    s = await waitFor(env, async () => {
      const x = await P.state();
      return x.ok && !x.paused && !x.seeking && x.readyState >= 3 && x.t >= base + 0.15 && x;
    }, 8000);
    if (!s) return { why: 'play did not start' + blockerNote(await P.state()) };

    await env.recorder.start();
    let recording = true;
    try {
      const first = await P.state();
      const clipStart = first.t;
      let last = clipStart, lastMove = env.now(), cur = first;
      const deadline = env.now() + Math.max(0, endT - clipStart) * 2000 + 15000;
      while (cur.t < endT) {
        if (env.shouldStop()) throw STOP;
        if (cur.t > last + 0.01) { last = cur.t; lastMove = env.now(); }
        else if (env.now() - lastMove > 6000) return { why: 'playback stalled' + blockerNote(cur) };
        if (!cur.ok || cur.blocker) return { why: 'player blocked' + blockerNote(cur) };
        if (env.now() > deadline) return { why: 'timed out while recording' };
        await env.sleep(100);
        cur = await P.state();
      }
      const clipEnd = cur.t;
      recording = false;
      const blob = await env.recorder.stop();
      await P.pause();
      if (blob.size > MAX_CLIP) return { why: 'clip too large' };
      if (!blob.size) return { why: 'empty recording' };
      const q = env.recorder.quality ? await env.recorder.quality() : {};
      const tip = ' - turn off hardware/graphics acceleration in the browser settings and restart it';
      if (q.black) return { why: 'recorded a black picture' + tip };
      if (q.silent) return { why: 'recorded exact silence' + tip };
      const r = await env.api.postClip(job, line.n, blob, clipStart, clipEnd);
      if (r === 'abort') throw ABORT;
      if (r === 'toolarge') return { why: 'clip too large for Surasura' };
      return { ok: true, gone: r === 'gone' };
    } finally {
      if (recording) { try { await env.recorder.stop(); } catch (e) { /* ignore */ } }
      try { await P.pause(); } catch (e) { /* ignore */ }
    }
  }

  // -> {status: 'done'|'stopped'|'aborted', recorded, failed:[{n,why}]}
  async function walkJob(job, env, prog) {
    const failed = [];
    let recorded = 0, streak = 0;
    const lines = job.lines;
    try {
      for (let i = 0; i < lines.length; i++) {
        if (env.shouldStop()) throw STOP;
        env.onProgress(Object.assign({}, prog, { line: i + 1, lines: lines.length, recorded, failed: failed.length }));
        if (streak >= GIVE_UP_AFTER) {
          failed.push({ n: lines[i].n, why: `skipped after ${GIVE_UP_AFTER} failures in a row` });
          continue;
        }
        let r;
        try {
          r = await recordLine(job, lines[i], env);
        } catch (e) {
          if (e === STOP || e === ABORT) throw e;
          r = { why: 'error: ' + (e && e.message ? e.message : e) };
        }
        if (r.ok) { if (!r.gone) recorded++; streak = 0; }
        else { failed.push({ n: lines[i].n, why: r.why }); streak++; }
      }
    } catch (e) {
      if (e === STOP) return { status: 'stopped', recorded, failed };
      if (e === ABORT) return { status: 'aborted', recorded, failed };
      throw e;
    }
    if (!(await env.api.postDone(job, failed))) return { status: 'aborted', recorded, failed };
    return { status: 'done', recorded, failed };
  }

  // Make the tab show this job's video, paused. -> {ok} | {ok:false, why, fatal?}
  async function openJob(job, env) {
    const P = env.player;
    let s = await P.state().catch(() => ({ ok: false }));
    if (!(s.ok && s.url && s.url.includes(job.video_id))) {
      await env.navigate(job.url);
      s = await waitFor(env, async () => {
        const x = await P.state().catch(() => ({ ok: false }));
        return x.ok && x.url.includes(job.video_id) && x.readyState >= 2 && x;
      }, 45000, 500);
      if (!s) return { ok: false, why: 'the player did not start (profile, sign-in or "still watching" screen?)' };
    }
    if (!env.streamAlive()) return { ok: false, fatal: true, why: 'the capture ended when the tab changed page' };
    await P.pause();
    return { ok: true };
  }

  // jobs in the order to walk, in Ukai's own window. -> {status, results:[{job, status, recorded, failed}], message?}
  async function runBatch(jobs, env) {
    return runJobs(jobs, env);
  }

  async function runJobs(jobs, env) {
    const results = [];
    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      const prog = { jobIndex: j + 1, jobs: jobs.length, title: job.title };
      if (env.shouldStop()) return { status: 'stopped', results };
      env.onProgress(Object.assign({}, prog, { line: 0, lines: job.lines.length, recorded: 0, failed: 0, opening: true }));
      let o;
      try { o = await openJob(job, env); } catch (e) { if (e === STOP) return { status: 'stopped', results }; throw e; }
      if (!o.ok) {
        if (o.fatal) return { status: 'needs-click', results, message: `${o.why}. Click the extension icon on this tab again to continue with "${job.title}".` };
        const failed = job.lines.map((l) => ({ n: l.n, why: o.why }));
        if (!(await env.api.postDone(job, failed))) return { status: 'aborted', results };
        results.push({ job: job.job, status: 'done', recorded: 0, failed });
        continue;
      }
      const r = await walkJob(job, env, prog);
      results.push({ job: job.job, status: r.status, recorded: r.recorded, failed: r.failed });
      if (r.status !== 'done') return { status: r.status, results };
    }
    return { status: 'done', results };
  }

  const api = { walkJob, openJob, runBatch, STOP, ABORT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraWalk = api;
})(typeof self !== 'undefined' ? self : globalThis);
