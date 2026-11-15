// Runs in the PAGE (world MAIN) at document_start. Only listens: it looks at the text responses the player
// already receives and forwards the ones that are subtitle files (TTML/WebVTT) to the content script.
// It never fetches anything itself and never touches video/audio responses.
(() => {
  if (window.__surasuraHook) return;
  window.__surasuraHook = true;
  const MAX_BYTES = 1500000;
  const post = (m) => window.postMessage(Object.assign({ source: 'surasura-hook' }, m), '*');

  function sniffText(t) {
    const head = t.replace(/^﻿/, '').trimStart().slice(0, 600);
    if (/^WEBVTT/.test(head)) return 'vtt';
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(\w+:)?tt[\s>]/.test(head)) return 'ttml';
    if (/^#EXTM3U/.test(head) && /TYPE=SUBTITLES/.test(t)) return 'm3u8-subs';
    return null;
  }

  function offer(url, text) {
    const kind = sniffText(text);
    if (kind) post({ kind: 'text', format: kind, url: String(url), body: text });
  }

  function looksBinary(buf) {
    const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 16));
    // fMP4/TS/etc. start with non-text bytes; subtitle text starts with '<', 'W', '#', BOM or whitespace.
    const c = b[0];
    return !(c === 0x3c || c === 0x57 || c === 0x23 || c === 0xef || c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09);
  }

  function offerBuffer(url, buf) {
    if (!buf || buf.byteLength === 0 || buf.byteLength > MAX_BYTES || looksBinary(buf)) return;
    offer(url, new TextDecoder('utf-8').decode(buf));
  }

  // fetch
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      p.then((r) => {
        try {
          const ct = (r.headers.get('content-type') || '').toLowerCase();
          if (/^(video|audio|image)\/|javascript|css|html|font/.test(ct)) return;
          const len = parseInt(r.headers.get('content-length') || '0', 10);
          const textual = /xml|vtt|ttml|text\/plain/.test(ct);
          if (!textual && !(len > 0 && len <= MAX_BYTES)) return;
          if (len > MAX_BYTES) return;
          r.clone().arrayBuffer().then((b) => offerBuffer(r.url, b)).catch(() => {});
        } catch (e) { /* never break the page */ }
      }).catch(() => {});
      return p;
    };
  }

  // XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this.__surasuraUrl = url;
      this.addEventListener('load', () => {
        try {
          const t = this.responseType;
          if (t === '' || t === 'text') {
            const s = this.responseText;
            if (s && s.length <= MAX_BYTES) offer(this.responseURL || url, s);
          } else if (t === 'arraybuffer') {
            offerBuffer(this.responseURL || url, this.response);
          }
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    return origOpen.call(this, method, url, ...rest);
  };

  // Netflix: the player's manifest (after the page has decrypted it) lists the timed-text tracks and their
  // language. We read only url -> language, so a downloaded subtitle file can be labelled.
  const origParse = JSON.parse;
  JSON.parse = function (...args) {
    const v = origParse.apply(this, args);
    try {
      const tracks = v && typeof v === 'object' && v.result && v.result.timedtexttracks;
      if (Array.isArray(tracks)) {
        const map = {};
        for (const tr of tracks) {
          const lang = tr.language || tr.bcp47;
          const dl = tr.ttDownloadables || {};
          for (const fmt of Object.keys(dl)) {
            const urls = (dl[fmt] && dl[fmt].downloadUrls) || {};
            for (const id of Object.keys(urls)) map[String(urls[id]).split('?')[0]] = lang;
          }
        }
        if (Object.keys(map).length) post({ kind: 'tracks', map });
      }
    } catch (e) { /* ignore */ }
    return v;
  };
})();
