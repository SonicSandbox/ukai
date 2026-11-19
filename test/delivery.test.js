const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/delivery.js');

function fakeFetch(script) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push([url, opts]);
    const r = script(url, opts);
    if (r instanceof Error) throw r;
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  f.calls = calls;
  return f;
}
const mkDeps = (f, init = {}) => {
  const mem = Object.assign({ token: 't' }, init);
  return { mem, fetch: f, storage: { get: async (k) => mem[k], set: async (k, v) => { mem[k] = v; } } };
};
const payload = { schema: 1, site: 'netflix', video_id: '1', language: 'ja', title: 'x', cues: [[0, 1, 'a']] };

test('added / exists', async () => {
  const d = mkDeps(fakeFetch(() => ({ status: 200, body: { ok: true, added: true, item: 3 } })));
  assert.deepStrictEqual(await D.deliver(payload, d), { status: 'added', item: 3 });
  const d2 = mkDeps(fakeFetch(() => ({ status: 200, body: { ok: true, added: false, item: 3 } })));
  assert.strictEqual((await D.deliver(payload, d2)).status, 'exists');
});

test('sends token header to the loopback address only', async () => {
  const f = fakeFetch(() => ({ status: 200, body: { ok: true, added: true, item: 1 } }));
  await D.deliver(payload, mkDeps(f));
  assert.strictEqual(f.calls[0][0], 'http://127.0.0.1:27631/v1/online-subtitle');
  assert.strictEqual(f.calls[0][1].headers['X-Surasura-Token'], 't');
});

test('offline is queued once (dedupe) and flushed when hello answers', async () => {
  let up = false;
  const f = fakeFetch((url) => {
    if (!up) return new Error('refused');
    if (url.endsWith('/hello')) return { status: 200, body: { app: 'surasura', contract: 1 } };
    return { status: 200, body: { ok: true, added: true, item: 1 } };
  });
  const d = mkDeps(f);
  assert.strictEqual((await D.deliver(payload, d)).queued, true);
  await D.deliver(payload, d);
  assert.strictEqual(d.mem.queue.length, 1);
  assert.deepStrictEqual(await D.flush(d), { sent: 0, left: 1 });
  up = true;
  assert.deepStrictEqual(await D.flush(d), { sent: 1, left: 0 });
});

test('401 is queued, 400 is not, 503 is busy', async () => {
  const d1 = mkDeps(fakeFetch(() => ({ status: 401, body: {} })));
  const r1 = await D.deliver(payload, d1);
  assert.strictEqual(r1.status, 'badtoken'); assert.ok(r1.queued);
  const d2 = mkDeps(fakeFetch(() => ({ status: 400, body: { ok: false, why: 'nope' } })));
  const r2 = await D.deliver(payload, d2);
  assert.deepStrictEqual(r2, { status: 'rejected', why: 'nope' }); assert.ok(!d2.mem.queue);
  const d3 = mkDeps(fakeFetch(() => ({ status: 503, body: {} })));
  assert.strictEqual((await D.deliver(payload, d3)).status, 'busy');
});

test('buildPayload: film has no show, season/episode optional, query stripped', () => {
  const st = { site: 'disneyplus', videoId: 'v', url: 'https://x/play/v?a=1#b', docTitle: 'Doc' };
  const p = D.buildPayload(st, { language: null }, [], { title: '', show: '', season: '', episode: '' });
  assert.strictEqual(p.show, undefined);
  assert.strictEqual(p.title, 'Doc');
  assert.strictEqual(p.language, 'und');
  assert.strictEqual(p.url, 'https://x/play/v');
  const q = D.buildPayload(st, { language: 'ja' }, [], { title: 'T', show: 'S', season: '', episode: '4' });
  assert.deepStrictEqual(q.show, { title: 'S', episode: 4 });
});

test('v2 posts: a busy (503) Surasura is tried again before giving up; a missing job is not retried', async () => {
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  let n = 0;
  const busyTwice = async () => ({ status: ++n <= 2 ? 503 : 200 });
  assert.strictEqual(await D.postDone('t', 7, [], busyTwice, sleep), true);
  assert.deepStrictEqual(sleeps, [2000, 5000]);
  assert.ok(D.WAITS.reduce((a, b) => a + b, 0) >= 150000, 'patient for at least 2 1/2 minutes');
  n = 0; sleeps.length = 0;
  assert.strictEqual(await D.postClip('t', 7, 0, new Blob(['x']), 1, 2, busyTwice, sleep), 'ok');
  let calls = 0;
  const always503 = async () => { calls++; return { status: 503 }; };
  assert.strictEqual(await D.postDone('t', 7, [], always503, sleep), false);
  assert.strictEqual(calls, D.WAITS.length + 1);
  calls = 0;
  assert.strictEqual(await D.postClip('t', 7, 0, new Blob(['x']), 1, 2, async () => { calls++; return { status: 404 }; }, sleep), 'gone');
  assert.strictEqual(calls, 1);
  assert.strictEqual(await D.postClip('t', 7, 0, new Blob(['x']), 1, 2, async () => { throw new Error('down'); }, sleep), 'abort');
});
