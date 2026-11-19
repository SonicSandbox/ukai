const test = require('node:test');
const assert = require('node:assert');
const W = require('../src/walk.js');

// A fake player on a fake clock: sleep() advances time, and the video time while playing.
function world(opts = {}) {
  const w = {
    clock: 0, t: 0, playing: false, seekAt: null, url: 'https://x/watch/V1', clips: [], done: [], log: [], stopAfter: opts.stopAfter,
    postResult: opts.postResult || 'ok', rec: null, recStart: null,
  };
  w.env = {
    now: () => w.clock,
    sleep: async (ms) => {
      w.clock += ms;
      if (w.seekAt !== null && w.clock >= w.seekAt.ready) { w.t = w.seekAt.t; w.seekAt = null; }
      if (w.playing && w.seekAt === null && !(opts.frozen && opts.frozen(w))) w.t += ms / 1000;
    },
    shouldStop: () => !!(w.stopAfter != null && w.clips.length >= w.stopAfter),
    onProgress: (p) => w.log.push(p),
    navigate: async (u) => { w.url = u; w.t = 0; },
    streamAlive: () => (opts.alive === undefined ? true : opts.alive),
    player: {
      hideUi: async () => { w.hidden = true; w.hiddenBeforeSeek = w.seekCalls === undefined; },
      showUi: async () => { w.hidden = false; },
      pause: async () => { w.playing = false; },
      play: async () => { w.playing = true; },
      seek: async (t) => { w.seekCalls = (w.seekCalls || 0) + 1; if (opts.seekFails) return; w.seekAt = { t, ready: w.clock + 300 }; },
      state: async () => ({
        ok: true, t: w.t, paused: !w.playing, seeking: w.seekAt !== null, readyState: 4, url: w.url,
        blocker: opts.blocker && opts.blocker(w) ? 'are-you-still-watching' : null,
      }),
    },
    recorder: {
      start: async () => { w.rec = true; },
      stop: async () => { w.rec = false; return { size: opts.size === undefined ? 1000 : opts.size }; },
      quality: () => ({ black: !!opts.black, silent: !!opts.silent }),
    },
    api: {
      postClip: async (job, n, blob, s, e) => { w.clips.push({ job: job.job, n, s, e }); return w.postResult; },
      postDone: async (job, failed) => { w.done.push({ job: job.job, failed }); return true; },
    },
  };
  return w;
}
const job = (id, lines, extra = {}) => Object.assign({ job: id, site: 'netflix', video_id: 'V1', url: 'https://x/watch/V1', title: 'T', pad_before: 1, pad_after: 1,
  lines: lines.map(([n, start, end]) => ({ n, start, end })) }, extra);

test('records every line, clip start is the real first-frame time, done has no failures', async () => {
  const w = world();
  const r = await W.runBatch([job(1, [[0, 100, 103], [1, 200, 202]])], w.env);
  assert.strictEqual(r.status, 'done');
  assert.strictEqual(w.clips.length, 2);
  assert.ok(w.clips[0].s >= 99 && w.clips[0].s < 99.6, 'start near start-pad: ' + w.clips[0].s);
  assert.ok(w.clips[0].e >= 104, 'end covers end+pad: ' + w.clips[0].e);
  assert.deepStrictEqual(w.done, [{ job: 1, failed: [] }]);
  assert.strictEqual(w.playing, false);
  assert.strictEqual(w.rec, false);
});

test('a seek that never lands fails the line, is reported once, and the next job goes on', async () => {
  const w = world({ seekFails: true });
  const r = await W.runBatch([job(1, [[0, 100, 103]])], w.env);
  assert.strictEqual(r.status, 'done');
  assert.deepStrictEqual(w.done[0].failed, [{ n: 0, why: 'seek failed' }]);
});

test('gives up on a job after 3 failures in a row (no endless retries)', async () => {
  const w = world({ seekFails: true });
  await W.runBatch([job(1, [[0, 10, 12], [1, 20, 22], [2, 30, 32], [3, 40, 42], [4, 50, 52]])], w.env);
  const f = w.done[0].failed;
  assert.strictEqual(f.length, 5);
  assert.match(f[3].why, /in a row/);
});

test('"still watching" screen: line fails with the blocker named', async () => {
  const w = world({ blocker: () => true });
  await W.runBatch([job(1, [[0, 100, 103]])], w.env);
  assert.match(w.done[0].failed[0].why, /are-you-still-watching/);
});

test('stalled playback is skipped', async () => {
  const w = world({ frozen: (x) => x.t > 100 });
  await W.runBatch([job(1, [[0, 100, 103]])], w.env);
  assert.match(w.done[0].failed[0].why, /stalled|play did not start/);
});

test('Stop: no done is posted, rest is left for later', async () => {
  const w = world({ stopAfter: 1 });
  const r = await W.runBatch([job(1, [[0, 10, 12], [1, 20, 22], [2, 30, 32]])], w.env);
  assert.strictEqual(r.status, 'stopped');
  assert.strictEqual(w.clips.length, 1);
  assert.strictEqual(w.done.length, 0);
});

test('Surasura stops answering: abort, no done', async () => {
  const w = world({ postResult: 'abort' });
  const r = await W.runBatch([job(1, [[0, 10, 12], [1, 20, 22]])], w.env);
  assert.strictEqual(r.status, 'aborted');
  assert.strictEqual(w.clips.length, 1);
  assert.strictEqual(w.done.length, 0);
});

test('a line dropped by Surasura (404) is skipped quietly', async () => {
  const w = world({ postResult: 'gone' });
  const r = await W.runBatch([job(1, [[0, 10, 12]])], w.env);
  assert.strictEqual(r.results[0].recorded, 0);
  assert.deepStrictEqual(w.done[0].failed, []);
});

test('empty recording is a failure', async () => {
  const w = world({ size: 0 });
  await W.runBatch([job(1, [[0, 10, 12]])], w.env);
  assert.strictEqual(w.done[0].failed[0].why, 'empty recording');
});

test('second episode: navigates; if the capture died, stop and ask for a click without done', async () => {
  const w = world({ alive: false });
  const jobs = [job(1, [[0, 10, 12]]), job(2, [[0, 10, 12]], { video_id: 'V2', url: 'https://x/watch/V2' })];
  // job 1 is on the current page but the stream is dead -> fatal at once
  const r = await W.runBatch(jobs, w.env);
  assert.strictEqual(r.status, 'needs-click');
  assert.strictEqual(w.done.length, 0);

  const w2 = world();
  const r2 = await W.runBatch(jobs, w2.env);
  assert.strictEqual(r2.status, 'done');
  assert.strictEqual(w2.done.length, 2);
});

test('black picture / silence are failures with advice; UI is hidden while recording and restored', async () => {
  const w = world({ black: true });
  await W.runBatch([job(1, [[0, 10, 12]])], w.env);
  assert.match(w.done[0].failed[0].why, /black picture.*acceleration/);
  assert.strictEqual(w.clips.length, 0);
  assert.strictEqual(w.hidden, false);
  const w2 = world({ silent: true });
  await W.runBatch([job(1, [[0, 10, 12]])], w2.env);
  assert.match(w2.done[0].failed[0].why, /silence/);
});

test('UI is hidden before the first seek, and restored even when the line fails', async () => {
  const w = world({ seekFails: true });
  await W.runBatch([job(1, [[0, 10, 12]])], w.env);
  assert.strictEqual(w.hiddenBeforeSeek, true);
  assert.strictEqual(w.hidden, false);
});
