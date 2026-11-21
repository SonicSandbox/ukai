// Subtitle parsers: TTML/DFXP/IMSC and WebVTT -> cues [start, end, text]. No DOM needed (works in node too).
(function (root) {
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };

  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      const v = ENT[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }

  const CJK = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;

  // Join physical lines of one cue: no space between CJK characters, a space otherwise.
  function joinLines(lines) {
    let out = '';
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      if (out && !(CJK.test(out.slice(-1)) || CJK.test(l[0]))) out += ' ';
      out += l;
    }
    return out;
  }

  function stripMarkup(s) {
    return s
      .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '') // ruby readings
      .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\{\\an?\d+\}/g, '');
  }

  function cleanText(markup) {
    return joinLines(decodeEntities(stripMarkup(markup)).split(/\r?\n/));
  }

  // TTML2 / IMSC 1.1 ruby (Netflix's Japanese): the reading is a <span> whose tts:ruby is "text" (or the
  // "textContainer" holding it), set on the span itself or through a <style> it names. The base stays and the
  // reading goes, so a line reads 黒沼さん, never 黒沼くろぬまさん.
  const RUBY_TEXT = /^(?:text|textContainer)$/;

  function rubyStyles(xml) {
    const ids = new Set();
    const re = /<style\b([^>]*?)\/?>/g;
    let m;
    while ((m = re.exec(xml))) {
      const id = attr(m[1], 'id');
      const ruby = attr(m[1], 'ruby');
      if (id && ruby && RUBY_TEXT.test(ruby)) ids.add(id);
    }
    return ids;
  }

  function stripRubyText(markup, styles) {
    const isReading = (attrs) => {
      const ruby = attr(attrs, 'ruby');
      if (ruby && RUBY_TEXT.test(ruby)) return true;
      const style = attr(attrs, 'style');
      return !!style && style.split(/\s+/).some((id) => styles.has(id));
    };
    // innermost spans first, so a reading inside its text container (or the container itself) goes whole
    const inner = /<span\b([^>]*)>((?:(?!<span\b)[\s\S])*?)<\/span>/;
    let out = markup;
    for (let guard = 0; guard < 64 && inner.test(out); guard++) {
      out = out.replace(inner, (whole, attrs, body) => (isReading(attrs) ? '' : `<kept${attrs}>${body}</kept>`));
    }
    return out;
  }

  function normLang(l) {
    if (!l) return null;
    const b = String(l).toLowerCase().split(/[-_]/)[0];
    return /^[a-z]{2,3}$/.test(b) ? b : null;
  }

  // ---- TTML ----
  function ttmlTime(v, tickRate, frameRate) {
    if (v == null) return null;
    v = String(v).trim();
    let m;
    if ((m = v.match(/^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/))) {
      const n = parseFloat(m[1]);
      switch (m[2]) {
        case 'h': return n * 3600;
        case 'm': return n * 60;
        case 's': return n;
        case 'ms': return n / 1000;
        case 't': return n / tickRate;
        case 'f': return n / frameRate;
      }
    }
    if ((m = v.match(/^(\d+):(\d\d):(\d\d)(?:[.,](\d+)|:(\d+))?$/))) {
      let t = +m[1] * 3600 + +m[2] * 60 + +m[3];
      if (m[4]) t += parseFloat('0.' + m[4]);
      if (m[5]) t += +m[5] / frameRate;
      return t;
    }
    return null;
  }

  function attr(s, name) {
    const m = s.match(new RegExp('(?:^|\\s)(?:[\\w]+:)?' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')'));
    return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
  }

  function parseTTML(xml) {
    xml = xml.replace(/^\uFEFF/, '');
    const root_ = xml.match(/<tt\b[^>]*>/);
    const rootTag = root_ ? root_[0] : '';
    const language = normLang(attr(rootTag, 'lang'));
    const tickRate = parseFloat(attr(rootTag, 'tickRate')) || 10000000;
    const frameRate = parseFloat(attr(rootTag, 'frameRate')) || 30;
    const readingStyles = rubyStyles(xml);
    const cues = [];
    const re = /<p\b([^>]*?)(\/>|>([\s\S]*?)<\/p>)/g;
    let m;
    while ((m = re.exec(xml))) {
      if (m[2] === '/>') continue;
      const a = m[1];
      const b = ttmlTime(attr(a, 'begin'), tickRate, frameRate);
      let e = ttmlTime(attr(a, 'end'), tickRate, frameRate);
      const d = ttmlTime(attr(a, 'dur'), tickRate, frameRate);
      if (e == null && b != null && d != null) e = b + d;
      if (b == null || e == null) continue;
      const text = cleanText(stripRubyText(m[3], readingStyles));
      if (text) cues.push([round(b), round(e), text]);
    }
    cues.sort((x, y) => x[0] - y[0]);
    return { format: 'ttml', language, cues };
  }

  // ---- WebVTT ----
  function vttTime(s) {
    const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!m) return null;
    return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + parseFloat('0.' + m[4]);
  }

  function parseVTT(text) {
    text = text.replace(/^\uFEFF/, '');
    const cues = [];
    let tsMap = null;
    const mm = text.match(/X-TIMESTAMP-MAP=([^\r\n]*)/);
    if (mm) tsMap = mm[1].trim();
    const blocks = text.split(/\r?\n\r?\n+/);
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
      const t = lines[i].match(/^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/);
      if (!t) continue;
      const b = vttTime(t[1]);
      const e = vttTime(t[2]);
      if (b == null || e == null) continue;
      const body = cleanText(lines.slice(i + 1).join('\n'));
      if (body) cues.push([round(b), round(e), body]);
    }
    cues.sort((x, y) => x[0] - y[0]);
    return { format: 'vtt', language: null, cues, timestampMap: tsMap };
  }

  function round(n) {
    return Math.round(n * 1000) / 1000;
  }

  // What kind of text is this? 'ttml' | 'vtt' | 'm3u8-subs' | null
  function sniff(text) {
    const head = text.replace(/^\uFEFF/, '').trimStart().slice(0, 600);
    if (/^WEBVTT/.test(head)) return 'vtt';
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(\w+:)?tt[\s>]/.test(head)) return 'ttml';
    if (/^#EXTM3U/.test(head) && /TYPE=SUBTITLES/.test(text)) return 'm3u8-subs';
    return null;
  }

  function parseAny(text) {
    const k = sniff(text);
    if (k === 'ttml') return parseTTML(text);
    if (k === 'vtt') return parseVTT(text);
    return null;
  }

  // Guess ja / zh from the text itself when the file declares no language.
  function guessLanguage(cues) {
    let kana = 0, han = 0, latin = 0;
    for (const c of cues.slice(0, 200)) {
      for (const ch of c[2]) {
        if (/[\u3040-\u30ff]/.test(ch)) kana++;
        else if (/[\u3400-\u9fff]/.test(ch)) han++;
        else if (/[A-Za-z]/.test(ch)) latin++;
      }
    }
    if (kana > 5 && kana * 4 >= han) return 'ja';
    if (han > 5 && kana * 20 < han) return 'zh';
    if (latin > 20) return 'en';
    return null;
  }

  // #EXT-X-MEDIA:TYPE=SUBTITLES lines -> [{language, uri, name}]
  function parseSubtitlePlaylist(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('#EXT-X-MEDIA') || !/TYPE=SUBTITLES/.test(line)) continue;
      const g = (k) => {
        const m = line.match(new RegExp('[:,]' + k + '="([^"]*)"'));
        return m ? m[1] : null;
      };
      out.push({ language: normLang(g('LANGUAGE')), uri: g('URI'), name: g('NAME') });
    }
    return out;
  }

  // Titles. parts = texts shown by the player after the show name, e.g. ["E3", "Episode title"]
  function parseEpisodeInfo(parts) {
    let season = null, episode = null;
    const rest = [];
    for (const p of parts) {
      const s = p.match(/\bS(?:eason|äsong)?\s*(\d+)/i);
      const e = p.match(/\b(?:E|Ep\.?|Episode|Avsnitt)\s*(\d+)/i);
      if (s || e) {
        if (s) season = +s[1];
        if (e) episode = +e[1];
        const remainder = p.replace(s ? s[0] : '', '').replace(e ? e[0] : '', '').replace(/^[\s:·|\-–]+|[\s:·|\-–]+$/g, '');
        if (remainder) rest.push(remainder);
      } else if (p.trim()) rest.push(p.trim());
    }
    return { season, episode, title: rest.length ? rest[rest.length - 1] : null };
  }

  const api = { parseTTML, parseVTT, parseAny, sniff, guessLanguage, normLang, parseSubtitlePlaylist, parseEpisodeInfo, cleanText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraParsers = api;
})(typeof self !== 'undefined' ? self : globalThis);
