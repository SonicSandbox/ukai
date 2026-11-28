#!/usr/bin/env node
// Builds the store zip: node tools/pack.js  ->  dist/ukai-<version>.zip
// The store build has NO developer capture probe: popup/probe.js is left out and the probe markup and its one
// line in popup.js (between `probe:start` / `probe:end` marker lines) are cut. No packages needed (own zip writer).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const INCLUDE = ['manifest.json', 'LICENSE', 'icons', 'src', 'popup', 'options', 'offscreen', 'ui'];
const SKIP = new Set(['popup/probe.js']);
const MARKED = new Set(['popup/popup.html', 'popup/popup.js']);

// remove every block from a `probe:start` line to the next `probe:end` line (HTML, CSS or // comments)
function stripProbe(text) {
  const re = /^[ \t]*(?:<!--|\/\*|\/\/)\s*probe:start[^\n]*\n[\s\S]*?^[ \t]*(?:<!--|\/\*|\/\/)\s*probe:end[^\n]*\n/gm;
  return text.replace(/\r\n/g, '\n').replace(re, '');
}

function walk(dir, rel, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    if (fs.statSync(full).isDirectory()) walk(full, r, out);
    else out.push(r);
  }
}

// -> Map(path in zip -> Buffer)
function stage(root) {
  const files = [];
  for (const item of INCLUDE) {
    const full = path.join(root, item);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) walk(full, item, files); else files.push(item);
  }
  const out = new Map();
  for (const f of files) {
    if (SKIP.has(f)) continue;
    let data = fs.readFileSync(path.join(root, f));
    if (MARKED.has(f)) data = Buffer.from(stripProbe(data.toString('utf8')), 'utf8');
    // the store build logs nothing to the console: the switch in src/debug.js is off
    if (f === 'src/debug.js') data = Buffer.from(data.toString('utf8').replace('self.UKAI_DEBUG = true;', 'self.UKAI_DEBUG = false;'), 'utf8');
    out.set(f, data);
  }
  return out;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// minimal zip (deflate), UTF-8 names, fixed timestamp so the same input gives the same bytes
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); // 00:00:00, 1980-01-01
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

module.exports = { stage, zip, stripProbe, crc32 };

if (require.main === module) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
  const files = stage(ROOT);
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const outFile = path.join(ROOT, 'dist', `ukai-${version}.zip`);
  fs.writeFileSync(outFile, zip(files));
  console.log(`${outFile}: ${files.size} files, no capture probe`);
}
