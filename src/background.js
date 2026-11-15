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

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  (async () => {
    if (m.type === 'send') {
      const r = await D.deliver(m.payload, deps);
      console.log('[surasura] send ->', r.status, r.queued ? '(queued)' : '', r.why || '');
      return r;
    }
    if (m.type === 'status') {
      const f = await D.flush(deps);
      return Object.assign(await status(), { flushed: f.sent, running: !!(await D.hello(deps.fetch)) });
    }
  })().then(reply, (e) => reply({ status: 'error', why: String(e) }));
  return true; // async reply
});

chrome.alarms.create('flush', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'flush') D.flush(deps).then((r) => r.sent && console.log('[surasura] delivered queued subtitles:', r.sent));
});
chrome.runtime.onStartup.addListener(() => D.flush(deps));
