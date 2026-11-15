const test = require('node:test');
const assert = require('node:assert');
const { isolate, KEEP, ISO } = require('../src/isolate.js');

function el(name, parent) {
  const attrs = new Map();
  const e = { name, parentElement: parent || null, attrs,
    setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), getAttribute: (k) => attrs.get(k),
    appendChild(c) { c.attached = true; }, remove() { this.removed = true; } };
  return e;
}

test('marks the video and its ancestors (not html), adds the rule, and undoes everything', () => {
  const html = el('html'); const body = el('body', html); const app = el('div', body); const player = el('div', app); const video = el('video', player);
  const doc = { documentElement: html, head: el('head', html), createElement: (n) => el(n) };
  const undo = isolate(doc, video);
  for (const e of [video, player, app, body]) assert.ok(e.attrs.has(KEEP), e.name + ' marked');
  assert.ok(!html.attrs.has(KEEP));
  assert.ok(html.attrs.has(ISO));
  undo();
  for (const e of [video, player, app, body]) assert.ok(!e.attrs.has(KEEP));
  assert.ok(!html.attrs.has(ISO));
  undo(); // second call is harmless
});
