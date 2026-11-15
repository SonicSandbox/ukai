// Popup: jobs waiting in Surasura, start / stop / progress of a recording batch.
async function initMining(tab, st) {
  const box = document.getElementById('mining');
  const D = self.SurasuraDelivery;
  const say = (html) => { box.hidden = false; box.replaceChildren(...html); };
  const el = (tag, text, props) => Object.assign(document.createElement(tag), { textContent: text || '' }, props || {});

  const offStatus = () => chrome.runtime.sendMessage({ to: 'offscreen', type: 'status' }).catch(() => null);

  async function render() {
    const bs = await offStatus();
    if (bs && bs.state === 'running') return renderRunning(bs);
    const { token } = await chrome.storage.local.get('token');
    const j = await D.getJobs(token, fetch);
    const parts = [];
    if (bs && bs.state === 'finished') parts.push(el('p', describe(bs.result), { className: 'ok' }));
    if (j.status !== 'ok' || !j.jobs.length) {
      if (parts.length) say(parts);
      else box.hidden = true;
      return;
    }
    const lines = j.jobs.reduce((n, x) => n + x.lines.length, 0);
    parts.push(el('h3', 'Mining'));
    parts.push(el('p', `${j.jobs.length} episode(s) wait: ${lines} lines.`));
    const here = st && j.jobs.find((x) => x.site === st.site && x.video_id === st.videoId);
    if (here) {
      const others = j.jobs.filter((x) => x !== here);
      const cb = el('input', '', { type: 'checkbox', id: 'cont', checked: true });
      if (others.length) {
        const lab = el('label', ` also continue with the other ${others.length} episode(s) in this tab`);
        lab.prepend(cb);
        parts.push(lab);
      }
      const b = el('button', `Record ${here.lines.length} clips for "${here.title}"`);
      b.onclick = async () => {
        b.disabled = true;
        const { opened } = await chrome.storage.session.get('opened').catch(() => ({}));
        const order = [here].concat(others.length && cb.checked ? others : []);
        let streamId;
        try {
          streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        } catch (e) {
          return say([el('p', 'Could not start capturing this tab: ' + e.message, { className: 'bad' })]);
        }
        const r = await chrome.runtime.sendMessage({
          type: 'startBatch', tabId: tab.id, streamId, token, jobs: order,
          openedTab: !!(opened && opened[tab.id]),
        });
        if (!r || !r.ok) return say([el('p', 'Could not start: ' + ((r && r.why) || 'no answer'), { className: 'bad' })]);
        render();
      };
      parts.push(b);
    } else {
      const j0 = j.jobs[0];
      parts.push(el('p', `Next: "${j0.title}" (${j0.lines.length} lines). Open it, then click the extension icon on that tab.`, { className: 'muted' }));
      const b = el('button', 'Open this episode');
      b.onclick = async () => {
        const found = await chrome.tabs.query({ url: ['*://*.netflix.com/*', '*://*.disneyplus.com/*'] });
        let t = found.find((x) => x.url.includes(j0.video_id));
        let created = false;
        if (!t) { t = await chrome.tabs.create({ url: j0.url, active: true }); created = true; }
        else await chrome.tabs.update(t.id, { active: true });
        if (created) {
          const { opened } = await chrome.storage.session.get('opened').catch(() => ({}));
          await chrome.storage.session.set({ opened: Object.assign({}, opened, { [t.id]: true }) });
        }
        window.close();
      };
      parts.push(b);
    }
    say(parts);
  }

  function renderRunning(bs) {
    const p = bs.progress || {};
    const text = p.opening ? `Opening "${p.title}"…`
      : `Episode ${p.jobIndex || 1} of ${p.jobs || 1}: line ${p.line || 0} of ${p.lines || 0} (${p.recorded || 0} recorded, ${p.failed || 0} failed)`;
    const stop = el('button', 'Stop');
    stop.onclick = () => { chrome.runtime.sendMessage({ to: 'offscreen', type: 'stop' }); stop.disabled = true; };
    say([el('h3', 'Mining'), el('p', text), el('p', 'Keep this tab open and the video visible. You can close this popup.', { className: 'muted' }), stop]);
    setTimeout(render, 1000);
  }

  function describe(r) {
    const done = (r.results || []).reduce((n, x) => n + x.recorded, 0);
    const failed = (r.results || []).reduce((n, x) => n + x.failed.length, 0);
    const base = `${done} clip(s) recorded, ${failed} line(s) failed.`;
    if (r.status === 'done') return 'Finished. ' + base;
    if (r.status === 'stopped') return 'Stopped. ' + base;
    if (r.status === 'aborted') return 'Surasura stopped answering, so the batch was stopped. ' + base;
    if (r.status === 'needs-click') return r.message + ' ' + base;
    return 'Stopped by an error: ' + (r.message || '') + ' ' + base;
  }

  render();
}
