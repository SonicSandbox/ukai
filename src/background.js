importScripts('debug.js', 'delivery.js', 'hosts.js');
const D = self.SurasuraDelivery;
const H = self.SurasuraHosts;
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

// Minimizing Ukai's window can make Netflix's page 'hidden' so it neither seeks nor plays: off by default, the window
// is shrunk to a small one instead. Set to true to try minimizing again.
const MINIMIZE = false;

// Ukai's own window on a site address: muted; `badge` puts a mark on its icon (the one press for a recording).
async function openOwnWindow(url, badge) {
  if (!H.isSiteUrl(url, H.siteHosts(chrome.runtime.getManifest()))) return { error: 'not an allowed site address' };
  const win = await chrome.windows.create({ url, type: 'normal', width: 1100, height: 700, focused: true });
  const tab = win.tabs[0];
  await chrome.tabs.update(tab.id, { muted: true }); // nothing is heard before the capture takes over
  const { own } = await chrome.storage.session.get('own');
  await chrome.storage.session.set({ own: Object.assign({}, own, { [tab.id]: win.id }) });
  if (badge) {
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#f5b73b' }).catch(() => {});
    chrome.action.setBadgeText({ tabId: tab.id, text: '▶' }).catch(() => {}); // the icon to press, in this window
  }
  quietUntilReady(tab.id); // not awaited
  return { ok: true, tabId: tab.id, windowId: win.id };
}

// Best effort: pause the video of a just-opened own window as soon as its player answers (Netflix autoplays).
async function quietUntilReady(tabId) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const s = await chrome.tabs.sendMessage(tabId, { type: 'player', op: 'state' });
      if (s && s.result && s.result.ok && s.result.apiReady) {
        await chrome.tabs.sendMessage(tabId, { type: 'player', op: 'pause' });
        return;
      }
    } catch (e) { /* the page is still loading */ }
  }
}

const OWN = new Set(['openOwn', 'startSeasonOwn', 'tabAlive', 'ownReady', 'closeWindow', 'content', 'startSeason', 'send', 'status', 'startBatch', 'page', 'navigate', 'closeTab']);

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (!m || (m.to && m.to !== 'background') || !OWN.has(m.type)) return false; // not for us: let others answer
  (async () => {
    switch (m.type) {
      case 'send': {
        const r = await D.deliver(m.payload, deps);
        globalThis.UKAI_DEBUG && console.log('[surasura] send ->', r.status, r.queued ? '(queued)' : '', r.why || '');
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
        // only to this extension's own site hosts (the address may come from Surasura or a page)
        if (!H.isSiteUrl(m.url, H.siteHosts(chrome.runtime.getManifest()))) return { error: 'not an allowed site address' };
        await chrome.tabs.update(m.tabId, { url: m.url });
        await loadComplete(m.tabId, 60000);
        return { ok: true };
      }
      case 'openOwn': return openOwnWindow(m.url, true); // Ukai's own window for a job's episode (never the learner's tab)
      case 'startSeasonOwn': {
        // ONE message from the popup: opening the window takes the focus and Chrome then closes the popup, so the popup
        // cannot be the one that starts the walk afterwards.
        const st = await chrome.runtime.sendMessage({ to: 'offscreen', type: 'status' }).catch(() => null);
        if (st && st.state === 'running') return { ok: false, why: 'Ukai is already recording or walking a season. Stop that first.' };
        const w = await openOwnWindow(m.url, false);
        if (w.error) return { ok: false, why: w.error };
        await ensureOffscreen();
        const r = await chrome.runtime.sendMessage(Object.assign({}, m, { to: 'offscreen', type: 'startSeason', tabId: w.tabId, windowId: w.windowId }));
        if (!r || !r.ok) {
          await chrome.windows.remove(w.windowId).catch(() => {}); // refused: do not leave the window open
          return { ok: false, why: (r && r.why) || 'no answer' };
        }
        return { ok: true };
      }
      case 'tabAlive': {
        try { await chrome.tabs.get(m.tabId); return { alive: true }; } catch (e) { return { alive: false }; }
      }
      case 'ownReady': {
        chrome.action.setBadgeText({ tabId: m.tabId, text: '' }).catch(() => {});
        await chrome.tabs.update(m.tabId, { muted: false }).catch(() => {});
        if (MINIMIZE) await chrome.windows.update(m.windowId, { state: 'minimized' }).catch(() => {});
        else await chrome.windows.update(m.windowId, { width: 480, height: 320 }).catch(() => {});
        return { ok: true };
      }
      case 'closeWindow': {
        try { await chrome.windows.remove(m.windowId); } catch (e) { /* already closed */ }
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
  if (a.name === 'flush') D.flush(deps).then((r) => r.sent && globalThis.UKAI_DEBUG && console.log('[surasura] delivered queued subtitles:', r.sent));
});
chrome.runtime.onStartup.addListener(() => D.flush(deps));
