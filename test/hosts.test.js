const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../src/hosts.js');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const hosts = H.siteHosts(manifest);

test('the hosts come from the manifest, loopback is not one of them', () => {
  assert.deepStrictEqual(hosts.sort(), ['disneyplus.com', 'netflix.com', 'youtube.com']);
});

test('own sites pass (https, host or subdomain)', () => {
  for (const u of ['https://www.netflix.com/watch/81234567', 'https://netflix.com/watch/1', 'https://www.disneyplus.com/play/abc',
    'https://www.netflix.com:443/watch/1', 'https://WWW.NETFLIX.COM/watch/1']) assert.ok(H.isSiteUrl(u, hosts), u);
});

test('everything else is refused', () => {
  for (const u of ['http://www.netflix.com/watch/1', // not https
    'https://netflix.com.evil.com/watch/1', 'https://evilnetflix.com/', 'https://notnetflix.com/', // dot boundary
    'https://evil.com/?https://www.netflix.com/', 'https://www.netflix.com@evil.com/', 'https://user:pw@www.netflix.com/',
    'https://www.netflix.com:8443/', 'http://127.0.0.1:27631/v1/hello', 'file:///C:/x', 'javascript:alert(1)', 'chrome://extensions',
    '', 'not a url', null, undefined]) assert.ok(!H.isSiteUrl(u, hosts), String(u));
  assert.ok(!H.isSiteUrl('https://www.netflix.com/', []));
});
