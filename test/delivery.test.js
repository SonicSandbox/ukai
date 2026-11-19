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

// ---- the waiting list is capped in bytes ----
const big = (id, chars, cover) => {
  const p = { schema: 1, site: 'netflix', video_id: id, language: 'ja', title: 't', cues: [[0, 1, 'あ'.repeat(chars)]] };
  if (cover) p.cover = cover;
  return p;
};

test('byteSize counts UTF-8 bytes, not characters', () => {
  assert.strictEqual(D.byteSize('あ'), 5); // 3 bytes + 2 quotes
  assert.ok(D.byteSize(big('1', 1000)) > 3000);
});

test('fitQueue: under the cap everything stays, same episode is replaced', () => {
  const q = [big('1', 10), big('2', 10)];
  const r = D.fitQueue(q, big('2', 20), 100000);
  assert.deepStrictEqual(r.queue.map((p) => p.video_id), ['1', '2']);
  assert.strictEqual(r.queue[1].cues[0][2].length, 20);
  assert.strictEqual(r.refused, false);
});

test('fitQueue: at the edge the artwork goes first, and nothing waiting is dropped', () => {
  const cover = 'A'.repeat(2000);
  const a = big('1', 100, cover), b = big('2', 100, cover);
  const withCovers = D.byteSize([a, b]);
  const without = D.byteSize([big('1', 100), big('2', 100)]);
  // exactly fits: kept untouched
  let r = D.fitQueue([a], b, withCovers);
  assert.strictEqual(r.refused, false); assert.strictEqual(r.coversDropped, 0);
  // one byte short: covers are dropped, both subtitles stay
  r = D.fitQueue([a], b, withCovers - 1);
  assert.strictEqual(r.refused, false);
  assert.strictEqual(r.queue.length, 2);
  assert.ok(r.coversDropped >= 1);
  assert.ok(D.byteSize(r.queue) <= withCovers - 1);
  // the waiting one loses its cover before the incoming one does
  assert.ok(!r.queue[0].cover);
  // even without any artwork it does not fit: the NEW one is refused, the old stay
  r = D.fitQueue([a], b, without - 1);
  assert.strictEqual(r.refused, true);
  assert.deepStrictEqual(r.queue.map((p) => p.video_id), ['1']);
});

test('deliver: a full list says so (queueFull) and keeps what waits; a rejected storage.set is the same', async () => {
  const d = mkDeps(fakeFetch(() => new Error('refused')));
  d.mem.queue = [big('1', 100)];
  const r = await D.deliver(big('2', 100), d, D.byteSize([big('1', 100)]) + 10);
  assert.strictEqual(r.status, 'offline'); assert.strictEqual(r.queued, false); assert.strictEqual(r.queueFull, true);
  assert.deepStrictEqual(d.mem.queue.map((p) => p.video_id), ['1']);
  const d2 = mkDeps(fakeFetch(() => new Error('refused')));
  d2.storage.set = async () => { throw new Error('QUOTA_BYTES quota exceeded'); };
  const r2 = await D.deliver(big('3', 5), d2);
  assert.strictEqual(r2.queueFull, true);
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
