// Simulated popup: parse a fixture, build the payload, deliver it to a running receiver (the mock).
//   node tools/e2e_send.js [token]
const fs = require('fs');
const path = require('path');
const P = require('../src/parsers.js');
const D = require('../src/delivery.js');

const mem = {};
const deps = { fetch, storage: { get: async (k) => mem[k], set: async (k, v) => { mem[k] = v; } } };

(async () => {
  mem.token = process.argv[2] || 'test-token';
  const parsed = P.parseAny(fs.readFileSync(path.join(__dirname, '../test/fixtures/sample.ttml'), 'utf8'));
  const st = { site: 'netflix', videoId: '81234567', url: 'https://www.netflix.com/watch/81234567?trackId=1', docTitle: null };
  const info = { title: 'Fixture episode', show: 'Fixture show', season: '1', episode: '3' };
  const payload = D.buildPayload(st, { language: parsed.language }, parsed.cues, info);
  console.log('hello:', await D.hello(fetch));
  console.log('first send :', await D.deliver(payload, deps));
  console.log('second send:', await D.deliver(payload, deps));
  console.log('queue length:', (mem.queue || []).length);
})();
