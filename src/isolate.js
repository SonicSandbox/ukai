// Show only the <video>: mark it and its ancestors, hide every other element with one attribute-based rule
// (visibility, not display, so layout and the player's own logic do not change). The rule also covers elements
// the site adds later, e.g. controls and subtitles. Returns an undo function. Works with any DOM-like doc.
(function (root) {
  const KEEP = 'data-surasura-keep';
  const ISO = 'data-surasura-iso';
  const CSS = `html[${ISO}], html[${ISO}] body { background: #000 !important; overflow: hidden !important; scrollbar-width: none !important; }
html[${ISO}]::-webkit-scrollbar, html[${ISO}] body::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
html[${ISO}] body *:not([${KEEP}]) { visibility: hidden !important; }
html[${ISO}] [${KEEP}] { visibility: visible !important; }`;

  function isolate(doc, video) {
    const marked = [];
    for (let e = video; e && e !== doc.documentElement; e = e.parentElement) {
      e.setAttribute(KEEP, '');
      marked.push(e);
    }
    const style = doc.createElement('style');
    style.setAttribute('id', 'surasura-isolate');
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
    doc.documentElement.setAttribute(ISO, '');
    let undone = false;
    return function undo() {
      if (undone) return;
      undone = true;
      doc.documentElement.removeAttribute(ISO);
      style.remove();
      marked.forEach((e) => e.removeAttribute(KEEP));
    };
  }

  const api = { isolate, KEEP, ISO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SurasuraIsolate = api;
})(typeof self !== 'undefined' ? self : globalThis);
