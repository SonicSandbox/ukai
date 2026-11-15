// Netflix specifics: which page is a watch page, and what the player shows as title.
// Based on public knowledge of the web player (not verified against a live account: see README).
self.SurasuraSite = {
  site: 'netflix',
  videoId(url) {
    const m = String(url).match(/netflix\.com\/(?:[a-z-]+\/)?watch\/(\d+)/i);
    return m ? m[1] : null;
  },
  // The group a subtitle file belongs to: one file = one track on Netflix.
  trackKey(url) {
    return String(url).split('?')[0];
  },
  // {show, parts[]} from the player's title block; only present while the controls are visible.
  readTitle(doc) {
    const el = doc.querySelector('[data-uia="video-title"]');
    if (!el) return null;
    const heading = el.querySelector('h4');
    const spans = Array.from(el.querySelectorAll('span')).map((s) => s.textContent.trim()).filter(Boolean);
    if (heading && spans.length) return { show: heading.textContent.trim(), parts: spans };
    const t = el.textContent.trim();
    return t ? { show: null, parts: [t], film: true } : null;
  },
  cleanDocTitle(t) {
    t = (t || '').replace(/\s*[-|–]\s*Netflix\s*$/i, '').trim();
    return /^netflix$/i.test(t) ? null : t || null;
  },
};
console.log('[surasura] netflix adapter loaded');
