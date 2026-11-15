// Runs hook.js and content.js against a stubbed page: a subtitle response must arrive as a track in the popup state.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('fetch response with TTML -> hook -> content script -> state/cues', async () => {
  const listeners = [];
  const win = {
    postMessage(m) { setImmediate(() => listeners.forEach((l) => l({ source: win, data: m }))); },
    addEventListener(t, l) { if (t === 'message') listeners.push(l); },
  };
  const ttml = fx('sample.ttml');
  win.fetch = async () => ({
    url: 'https://x.nflxvideo.net/sub?o=1',
    headers: { get: (h) => ({ 'content-type': 'application/octet-stream', 'content-length': String(ttml.length) }[h]) },
    clone() { return { arrayBuffer: async () => new TextEncoder().encode(ttml).buffer }; },
  });
  win.XMLHttpRequest = function () {}; win.XMLHttpRequest.prototype.open = function () {};
  let onMsg;
  const ctx = vm.createContext({
    window: win, XMLHttpRequest: win.XMLHttpRequest, JSON, TextDecoder, Uint8Array, console: { log() {}, warn() {} },
    setInterval() {}, setImmediate, Date, Object, Array, Set, Map, JSON_: JSON,
    document: { title: 'Netflix', querySelector: () => null },
    location: { href: 'https://www.netflix.com/watch/81234567?x=1', hostname: 'www.netflix.com' },
    chrome: { runtime: { onMessage: { addListener(f) { onMsg = f; } } } },
  });
  ctx.self = ctx;
  vm.runInContext(src('hook.js'), ctx);
  for (const f of ['parsers.js', 'sites/netflix.js', 'content.js']) vm.runInContext(src(f), ctx);
  await win.fetch('https://x.nflxvideo.net/sub?o=1');
  await new Promise((r) => setTimeout(r, 30));
  let st; onMsg({ type: 'getState' }, null, (s) => (st = s));
  assert.strictEqual(st.videoId, '81234567');
  assert.strictEqual(st.tracks.length, 1);
  assert.strictEqual(st.tracks[0].language, 'ja');
  assert.strictEqual(st.tracks[0].count, 3);
  let c; onMsg({ type: 'getCues', key: st.tracks[0].key }, null, (r) => (c = r));
  assert.strictEqual(c.cues[0][2], 'こんにちは、元気？');
});
