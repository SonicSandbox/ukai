// Isolated-world content script: collects subtitle files the page hook reports, parses them, and answers the popup.
(() => {
  const P = self.SurasuraParsers;
  const S = self.SurasuraSite;
  const log = (...a) => console.log('[surasura]', ...a);

  const tracks = new Map(); // key -> {key, videoId, language, cues:Map(start|text -> cue), files, seen}
  const urlLang = {}; // url without query -> language (from the Netflix manifest)
  let playlists = []; // Disney+ master playlist subtitle entries
  let metaCache = { videoId: null, info: null };

  const currentId = () => S.videoId(location.href);

  function langFor(url, parsed) {
    const base = url.split('?')[0];
    if (urlLang[base]) return P.normLang(urlLang[base]);
    if (parsed.language) return parsed.language;
    for (const pl of playlists) {
      const dir = pl.uri && pl.uri.replace(/[^/]*$/, '').replace(/^\.?\//, '');
      if (dir && base.includes(dir)) return pl.language;
    }
    const m = base.match(/[/_.-](ja|zh|ko|en|es|fr|de|pt|it)(?:[-_][A-Za-z]{2,4})?[/_.-]/);
    if (m) return m[1];
    return P.guessLanguage(parsed.cues);
  }

  function onText(msg) {
    const id = currentId();
    if (!id) return;
    if (msg.format === 'm3u8-subs') {
      playlists = P.parseSubtitlePlaylist(msg.body);
      log('subtitle playlist seen:', playlists.map((p) => p.language).join(', '));
      return;
    }
    const parsed = P.parseAny(msg.body);
    if (!parsed || !parsed.cues.length) return;
    const key = id + '|' + S.trackKey(msg.url);
    let tr = tracks.get(key);
    if (!tr) {
      tr = { key, videoId: id, language: null, cues: new Map(), files: 0, seen: 0 };
      tracks.set(key, tr);
    }
    tr.files++;
    tr.seen = Date.now();
    tr.language = langFor(msg.url, parsed) || tr.language;
    for (const c of parsed.cues) tr.cues.set(c[0] + '|' + c[2], c);
    log(`subtitle ${parsed.format} from ${msg.url.slice(0, 90)}: ${parsed.cues.length} cues, lang=${tr.language || '?'}, track now ${tr.cues.size} cues in ${tr.files} file(s)`,
      parsed.timestampMap ? '(' + parsed.timestampMap + ')' : '');
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== 'surasura-hook') return;
    try {
      if (ev.data.kind === 'text') onText(ev.data);
      else if (ev.data.kind === 'tracks') {
        Object.assign(urlLang, ev.data.map);
        log('manifest timed-text tracks:', Array.from(new Set(Object.values(ev.data.map))).join(', '));
      }
    } catch (e) {
      console.warn('[surasura] failed to handle subtitle message', e);
    }
  });

  // The title block is only visible while the player controls are showing, so remember it.
  function pollMeta() {
    const id = currentId();
    if (!id) return;
    if (metaCache.videoId !== id) metaCache = { videoId: id, info: null };
    try {
      const t = S.readTitle(document);
      if (t) {
        const ep = P.parseEpisodeInfo(t.parts);
        const info = t.film
          ? { title: t.parts[0], show: null, season: null, episode: null }
          : { title: ep.title || t.parts[t.parts.length - 1] || null, show: t.show, season: ep.season, episode: ep.episode };
        if (JSON.stringify(info) !== JSON.stringify(metaCache.info)) log('title info:', JSON.stringify(info));
        metaCache.info = info;
      }
    } catch (e) { /* ignore */ }
  }
  setInterval(pollMeta, 2000);

  function state() {
    const id = currentId();
    pollMeta();
    const info = (metaCache.videoId === id && metaCache.info) || null;
    const list = Array.from(tracks.values())
      .filter((t) => t.videoId === id)
      .map((t) => ({ key: t.key, language: t.language, count: t.cues.size, files: t.files, seen: t.seen }))
      .sort((a, b) => (isWanted(b.language) - isWanted(a.language)) || b.seen - a.seen);
    return {
      site: S.site, videoId: id, url: location.href,
      docTitle: S.cleanDocTitle(document.title),
      info, tracks: list,
    };
  }
  const isWanted = (l) => (l === 'ja' || l === 'zh' ? 1 : 0);

  function cuesOf(key) {
    const tr = tracks.get(key);
    return tr ? Array.from(tr.cues.values()).sort((a, b) => a[0] - b[0]) : null;
  }

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m && m.type === 'getState') reply(state());
    else if (m && m.type === 'getCues') reply({ cues: cuesOf(m.key) });
    return false;
  });

  log('content script ready on', location.hostname);
})();
