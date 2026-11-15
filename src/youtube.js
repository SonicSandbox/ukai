// YouTube links for POST /v1/youtube. -> {video, playlist} (either may be null)
(function (root) {
  function parse(href) {
    let u;
    try { u = new URL(href); } catch (e) { return { video: null, playlist: null }; }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    let list = u.searchParams.get('list');
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] || null;
    else if (host === 'youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] || null;
      else if (u.pathname !== '/playlist') list = null;
    } else return { video: null, playlist: null };
    if (id && !/^[\w-]{6,20}$/.test(id)) id = null;
    if (list && (!/^[\w-]{10,60}$/.test(list) || list.startsWith('RD'))) list = null; // RD... = auto-made mix
    return {
      video: id ? 'https://www.youtube.com/watch?v=' + id : null,
      playlist: list ? 'https://www.youtube.com/playlist?list=' + list : null,
    };
  }
  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraYoutube = api;
})(typeof self !== 'undefined' ? self : globalThis);
