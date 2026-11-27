// Popup: pairing with Surasura. One Allow in Surasura's window, nothing typed: Ukai asks, shows the 4-digit code
// (only to match the one Surasura shows) and looks every second until the learner answers there.
// The open question lives in session storage, so closing the popup and opening it again goes on with it.
function initPair() {
  const box = document.getElementById('pair');
  const D = self.SurasuraDelivery;
  const el = (tag, text, props) => Object.assign(document.createElement(tag), { textContent: text || '' }, props || {});
  let forced = false; // Surasura said no to the token it was given: pair again
  let note = null;    // [text, class] about the last try, kept until the next one
  let looping = false;

  const getPending = async () => (await chrome.storage.session.get('pairing')).pairing || null;
  const setPending = (p) => (p ? chrome.storage.session.set({ pairing: p }) : chrome.storage.session.remove('pairing'));

  async function draw() {
    const { token } = await chrome.storage.local.get('token');
    const pending = await getPending();
    if (token && !forced && !pending) { box.hidden = true; return; }
    box.hidden = false;
    const parts = [el('h3', 'Connect to Surasura')];
    if (pending) {
      parts.push(el('p', 'In Surasura, press Allow. Surasura shows this code too:'));
      parts.push(el('p', pending.code, { className: 'code' }));
      const b = el('button', 'Cancel');
      b.onclick = async () => { await setPending(null); note = null; draw(); };
      parts.push(b);
    } else {
      if (forced) parts.push(el('p', 'Surasura does not know this extension any more. Connect again.', { className: 'bad' }));
      else parts.push(el('p', 'Ukai asks Surasura once. You press Allow there; nothing is copied or typed.'));
      if (note) parts.push(el('p', note[0], { className: note[1] }));
      const b = el('button', 'Connect');
      b.onclick = () => { b.disabled = true; start(); };
      parts.push(b);
    }
    box.replaceChildren(...parts);
  }

  async function start() {
    const r = await D.pairAsk(chrome.runtime.getManifest().version, fetch);
    if (r.status === 'asked') {
      note = null;
      await setPending({ pair: r.pair, code: r.code });
      loop();
    } else {
      note = {
        offline: ['Surasura is not running. Start it, then press Connect.', 'bad'],
        busy: [r.why || 'Surasura is busy. Try again in a moment.', 'bad'],
        unsupported: ['This Surasura cannot pair with Ukai yet. Update Surasura.', 'bad'],
        rejected: ['Surasura did not accept it: ' + r.why, 'bad'],
      }[r.status];
    }
    draw();
  }

  async function loop() {
    if (looping) return;
    looping = true;
    try {
      for (;;) {
        const p = await getPending();
        if (!p) return;
        const r = await D.pairClaim(p.pair, fetch);
        if (r.status === 'allowed') {
          await chrome.storage.local.set({ token: r.token }); // first: it is handed over once
          await setPending(null);
          forced = false;
          note = null;
          box.hidden = true;
          chrome.runtime.sendMessage({ type: 'status' }).catch(() => {}); // sends what was waiting
          return;
        }
        if (r.status === 'denied') { await setPending(null); note = ['You pressed Not now in Surasura.', 'bad']; return draw(); }
        if (r.status === 'gone') { await setPending(null); note = ['The question ran out. Press Connect again.', 'bad']; return draw(); }
        if (r.status === 'offline') { await setPending(null); note = ['Surasura stopped answering. Press Connect when it runs.', 'bad']; return draw(); }
        if (r.status === 'rejected') { await setPending(null); note = ['Surasura did not accept it: ' + r.why, 'bad']; return draw(); }
        await new Promise((res) => setTimeout(res, 1000)); // waiting, or busy: look again
      }
    } finally {
      looping = false;
    }
  }

  draw().then(loop);
  return { need() { if (!forced) { forced = true; draw(); } } };
}
