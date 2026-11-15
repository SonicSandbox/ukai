importScripts('delivery.js');
const D = self.SurasuraDelivery;
const deps = {
  fetch: (...a) => fetch(...a),
  storage: {
    get: (k) => chrome.storage.local.get(k).then((o) => o[k]),
    set: (k, v) => chrome.storage.local.set({ [k]: v }),
  },
};

async function status() {
  const q = (await deps.storage.get('queue')) || [];
  return { queued: q.length, hasToken: !!(await deps.storage.get('token')) };
}

async function ensureOffscreen() {
  const has = (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
  if (!has) {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Record short clips of the tab (picture and sound) for the lines Surasura asks for.',
    });
  }
}

function loadComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(); }
    function on(id, info) { if (id === tabId && info.status === 'complete') done(); }
    chrome.tabs.onUpdated.addListener(on);
  });
}

const OWN = new Set(['content', 'startSeason', 'send', 'status', 'startBatch', 'page', 'navigate', 'closeTab']);

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (!m || (m.to && m.to !== 'background') || !OWN.has(m.type)) return false; // not for us: let others answer
  (async () => {
    switch (m.type) {
      case 'send': {
        const r = await D.deliver(m.payload, deps);
        console.log('[surasura] send ->', r.status, r.queued ? '(queued)' : '', r.why || '');
        return r;
      }
      case 'status': {
        const f = await D.flush(deps);
        return Object.assign(await status(), { flushed: f.sent, running: !!(await D.hello(deps.fetch)) });
      }
      case 'startBatch': {
        await ensureOffscreen();
        return chrome.runtime.sendMessage(Object.assign({}, m, { to: 'offscreen', type: 'start' }));
      }
      case 'content': { // offscreen -> content script in the tab
        try { return await chrome.tabs.sendMessage(m.tabId, m.msg); } catch (e) { return { error: String(e.message || e) }; }
      }
      case 'startSeason': {
        await ensureOffscreen();
        return chrome.runtime.sendMessage(Object.assign({}, m, { to: 'offscreen', type: 'startSeason' }));
      }
      case 'page': { // offscreen -> player in the tab
        try {
          return await chrome.tabs.sendMessage(m.tabId, { type: 'player', op: m.op, args: m.args });
        } catch (e) {
          return { error: String(e.message || e) };
        }
      }
      case 'navigate': {
        await chrome.tabs.update(m.tabId, { url: m.url });
        await loadComplete(m.tabId, 60000);
        return { ok: true };
      }
      case 'closeTab': {
        try { await chrome.tabs.remove(m.tabId); } catch (e) { /* already closed */ }
        return { ok: true };
      }
    }
  })().then(reply, (e) => reply({ status: 'error', error: String(e), why: String(e) }));
  return true; // async reply
});

chrome.alarms.create('flush', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'flush') D.flush(deps).then((r) => r.sent && console.log('[surasura] delivered queued subtitles:', r.sent));
});
chrome.runtime.onStartup.addListener(() => D.flush(deps));
