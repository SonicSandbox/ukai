// Disney+ specifics. Disney+ streams subtitles as HLS WebVTT: many small .vtt segments per language,
// so several files make up one track. Based on public knowledge (not verified against a live account).
self.SurasuraSite = {
  site: 'disneyplus',
  videoId(url) {
    const m = String(url).match(/disneyplus\.com\/(?:[a-z-]+\/)?(?:play|video)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return m ? m[1] : null;
  },
  // Segments of one language share a folder.
  trackKey(url) {
    return String(url).split('?')[0].replace(/[^/]*$/, '');
  },
  readTitle(doc) {
    const t = doc.querySelector('[data-testid="title-field"], .title-field');
    const s = doc.querySelector('[data-testid="subtitle-field"], .subtitle-field');
    const title = t && t.textContent.trim();
    const sub = s && s.textContent.trim();
    if (title && sub) return { show: title, parts: sub.split(/\s*[·|]\s*/) };
    if (title) return { show: null, parts: [title], film: true };
    return null;
  },
  cleanDocTitle(t) {
    t = (t || '').replace(/^(Watch|Titta på)\s+/i, '').replace(/\s*[-|–]\s*Disney\+?\s*$/i, '').trim();
    return /^disney\+?$/i.test(t) ? null : t || null;
  },
};
globalThis.UKAI_DEBUG && console.log('[surasura] disneyplus adapter loaded');
