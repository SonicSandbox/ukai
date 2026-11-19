// Which addresses Ukai may open. The list comes from the manifest's own site host permissions
// (e.g. "*://*.netflix.com/*"), never from anything a page or Surasura sends.
(function (root) {
  // manifest -> ['netflix.com', 'disneyplus.com', 'youtube.com']; loopback and other forms are skipped
  function siteHosts(manifest) {
    const out = [];
    for (const p of (manifest && manifest.host_permissions) || []) {
      const m = /^\*:\/\/\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/\*$/i.exec(p);
      if (m) out.push(m[1].toLowerCase());
    }
    return out;
  }

  // https only, and the hostname is a listed host or a subdomain of one (matched on a dot boundary:
  // "netflix.com.evil.com" and "evilnetflix.com" do not pass). No credentials in the address, no odd port.
  function isSiteUrl(url, hosts) {
    let u;
    try { u = new URL(String(url)); } catch (e) { return false; }
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
    const h = u.hostname.toLowerCase();
    return (hosts || []).some((x) => h === x || h.endsWith('.' + x));
  }

  const api = { siteHosts, isSiteUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraHosts = api;
})(typeof self !== 'undefined' ? self : globalThis);
