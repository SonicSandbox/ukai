const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const zlib = require('node:zlib');
const path = require('node:path');
const { stage, zip, stripProbe, crc32 } = require('../tools/pack.js');

const root = path.join(__dirname, '..');
const files = stage(root);
const text = (n) => files.get(n).toString('utf8');

test('the store build has no probe: no file, no markup, no leftover reference', () => {
  assert.ok(!files.has('popup/probe.js'));
  for (const n of ['popup/popup.html', 'popup/popup.js']) assert.ok(!/probe/i.test(text(n)), n + ' still mentions the probe');
  for (const [n, d] of files) if (/\.(js|html)$/.test(n)) assert.ok(!/runProbe/.test(d.toString('utf8')), n + ' calls runProbe');
});

test('the popup still works without it: every script it loads is in the zip and parses', () => {
  const html = text('popup/popup.html');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => path.posix.normalize('popup/' + m[1]));
  assert.ok(srcs.includes('popup/popup.js') && srcs.length >= 4);
  for (const s of srcs) {
    assert.ok(files.has(s), s + ' is missing from the zip');
    assert.doesNotThrow(() => new vm.Script(text(s), { filename: s }), s + ' does not parse');
  }
  // nothing at the top of popup.js may touch an element that was cut
  assert.ok(!/\$\('probe/.test(text('popup/popup.js')));
});

test('everything the manifest points at is in the zip; no tests, tools or dist inside', () => {
  const m = JSON.parse(text('manifest.json'));
  const need = [m.background.service_worker, m.action.default_popup, m.options_ui.page, ...Object.values(m.icons),
    ...m.content_scripts.flatMap((c) => c.js)];
  for (const n of need) assert.ok(files.has(n), n + ' missing');
  for (const n of files.keys()) assert.ok(!/^(test|tools|dist|\.github)\//.test(n), n + ' should not ship');
  assert.ok(files.has('offscreen/offscreen.html'));
});

test('stripProbe cuts marked blocks only, in html, css and js style', () => {
  const s = 'a\n<!-- probe:start -->\nX\n<!-- probe:end -->\nb\n  /* probe:start */\nY\n  /* probe:end */\nc\n// probe:start\nZ\n// probe:end\nd\n';
  assert.strictEqual(stripProbe(s), 'a\nb\nc\nd\n');
});

test('the zip is a valid archive: entries inflate back to the staged bytes', () => {
  const buf = zip(files);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.strictEqual(buf.readUInt16LE(end + 10), files.size);
  let p = buf.readUInt32LE(end + 16);
  const seen = new Map();
  while (buf.readUInt32LE(p) === 0x02014b50) {
    const crc = buf.readUInt32LE(p + 16), csz = buf.readUInt32LE(p + 20), usz = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26);
    const data = zlib.inflateRawSync(buf.subarray(off + 30 + lnl, off + 30 + lnl + csz));
    assert.strictEqual(data.length, usz); assert.strictEqual(crc32(data), crc);
    assert.ok(data.equals(files.get(name)), name);
    seen.set(name, true);
    p += 46 + nl;
  }
  assert.strictEqual(seen.size, files.size);
});

test('the store build has the console logs off; the source has them on', () => {
  const fs = require('node:fs');
  const files = stage(path.join(__dirname, '..'));
  assert.match(files.get('src/debug.js').toString('utf8'), /self\.UKAI_DEBUG = false;/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'debug.js'), 'utf8'), /self\.UKAI_DEBUG = true;/);
});
