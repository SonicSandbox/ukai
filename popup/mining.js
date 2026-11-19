// Popup: jobs waiting in Surasura, start / stop / progress of a recording batch.
async function initMining(tab, st) {
  const box = document.getElementById('mining');
  const D = self.SurasuraDelivery;
  // the box is drawn again only when what it shows changed (a click on a checkbox or a pressed button is kept)
  let shown = null;
  const say = (html, key) => {
    if (key !== undefined && key === shown) return;
    shown = key === undefined ? null : key;
    box.hidden = false;
    box.replaceChildren(...html);
  };
  const hide = () => { shown = 'hidden'; box.hidden = true; };
  const el = (tag, text, props) => Object.assign(document.createElement(tag), { textContent: text || '' }, props || {});

  // the tabs Ukai opened itself (background keeps this in session storage)
  const ownIds = Object.keys((await chrome.storage.session.get('own').catch(() => ({}))).own || {}).map(Number);
  const isOwn = !!tab && ownIds.includes(tab.id);

  let note = null; // what to do next, kept on screen (the box is drawn again every few seconds)

  const offStatus = () => chrome.runtime.sendMessage({ to: 'offscreen', type: 'status' }).catch(() => null);

  // -> the ms until the next look (it keeps looking while the popup is open: nothing needs opening again)
  async function render() {
    const bs = await offStatus();
    if (bs && bs.state === 'running') { renderRunning(bs); return 1000; }
    const { token } = await chrome.storage.local.get('token');
    const j = await D.getJobs(token, fetch);
    const key = JSON.stringify([bs && bs.state, bs && bs.state === 'finished' ? bs.result : null, j.status,
      (j.jobs || []).map((x) => [x.job, x.lines.length])]);
    if (key === shown) return 2000;
    renderIdle(bs, j, token, key);
    return 2000;
  }

  function renderIdle(bs, j, token, key) {
    const parts = [];
    if (bs && bs.state === 'finished') parts.push(el('p', describe(bs.result), { className: 'ok' }));
    if (j.status === 'badtoken') {
      // never hidden: a token Surasura no longer knows would leave episodes waiting with nothing said
      parts.push(el('h3', 'Mining'));
      parts.push(el('p', 'Surasura doesn\'t know this extension\'s token. In Surasura\'s settings, press *Copy token* ' +
        '(Browser extension) and paste it into this extension\'s options. This box updates by itself.',
        { className: 'bad' }));
      const b = el('button', 'Open options');
      b.onclick = () => chrome.runtime.openOptionsPage();
      parts.push(b);
      return say(parts, key);
    }
    if (j.status !== 'ok' || !j.jobs.length) {
      if (parts.length) say(parts, key);
      else hide();
      return;
    }
    const lines = j.jobs.reduce((n, x) => n + x.lines.length, 0);
    parts.push(el('h3', 'Mining'));
    parts.push(el('p', `${j.jobs.length} episode(s) wait: ${lines} lines.`));
    const here = isOwn && st && j.jobs.find((x) => x.site === st.site && x.video_id === st.videoId);
    if (note && !isOwn) parts.push(el('p', note, { className: 'ok' }));
    if (isOwn && !here) {
      parts.push(el('p', `This is Ukai's own window, but no waiting episode matches this page (page: ${st ? st.site + ' ' + st.videoId : 'not readable yet'}; waiting: ${j.jobs.map((x) => x.site + ' ' + x.video_id).join(', ')}). Wait for the player to load, then open Ukai again.`, { className: 'bad' }));
    }
    if (here) {
      const others = j.jobs.filter((x) => x !== here);
      const cb = el('input', '', { type: 'checkbox', id: 'cont', checked: true });
      if (others.length) {
        const lab = el('label', ` also continue with the other ${others.length} episode(s) in this window`);
        lab.prepend(cb);
        parts.push(lab);
      }
      const b = el('button', `Record ${here.lines.length} clips for "${here.title}"`);
      b.onclick = async () => {
        b.disabled = true;
        const order = [here].concat(others.length && cb.checked ? others : []);
        let streamId;
        try {
          streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        } catch (e) {
          return say([el('p', 'Could not start capturing this tab: ' + e.message, { className: 'bad' })]);
        }
        const r = await chrome.runtime.sendMessage({
          type: 'startBatch', tabId: tab.id, streamId, token, jobs: order,
          windowId: tab.windowId, // Ukai's own window: it is minimized while recording and closed afterwards
        });
        if (!r || !r.ok) return say([el('p', 'Could not start: ' + ((r && r.why) || 'no answer'), { className: 'bad' })]);
        shown = null;
        render();
      };
      parts.push(b);
    } else {
      const j0 = j.jobs[0];
      parts.push(el('p', 'Ukai records in a small window of its own, muted and minimized. Netflix and Disney+ allow only one playing video, ' +
        'so leave any video you have open first. You press the Ukai icon once in that window.', { className: 'muted' }));
      const b = el('button', 'Record now');
      b.onclick = async () => {
        const H = self.SurasuraHosts;
        // a job's address comes from Surasura: only ever open it on one of this extension's own sites
        if (!H.isSiteUrl(j0.url, H.siteHosts(chrome.runtime.getManifest()))) {
          return say([el('p', 'Surasura sent an address that is not one of the sites Ukai works on, so it was not opened.', { className: 'bad' })]);
        }
        const open = H.watchTabs(await chrome.tabs.query({ url: ['*://*.netflix.com/*', '*://*.disneyplus.com/*'] }), ownIds);
        if (open.length) {
          return say([el('h3', 'Mining'), el('p', 'You have a video open (' + open.length + ' tab' + (open.length > 1 ? 's' : '') +
            '). Netflix lets only one play, so leave it first: go back from the player to the browse page, then press Record now again. ' +
            'Ukai never touches your own tab.', { className: 'bad' }), b]);
        }
        const r = await chrome.runtime.sendMessage({ type: 'openOwn', url: j0.url });
        if (!r || r.error) return say([el('p', 'Could not open the window: ' + ((r && r.error) || 'no answer'), { className: 'bad' })]);
        note = 'Ukai opened its own window. Go to that window and click the Ukai icon THERE (one press), then press "Record N clips".';
        shown = null;
        render();
      };
      parts.push(b);
    }
    say(parts, key);
  }

  let line = null; // the running box's progress line, updated in place (its Stop stays pressed)
  function renderRunning(bs) {
    const p = bs.progress || {};
    const season = p.kind === 'season';
    const text = season ? `Season walk: episode ${p.i} of ${p.n} (${p.title}), ${p.done} sent` : p.opening ? `Opening "${p.title}"…`
      : `Episode ${p.jobIndex || 1} of ${p.jobs || 1}: line ${p.line || 0} of ${p.lines || 0} (${p.recorded || 0} recorded, ${p.failed || 0} failed)`;
    if (shown === 'running' && line) { line.textContent = text; return; }
    line = el('p', text);
    const stop = el('button', 'Stop');
    stop.onclick = () => { chrome.runtime.sendMessage({ to: 'offscreen', type: 'stop' }); stop.disabled = true; };
    say([el('h3', season ? 'Season walk' : 'Mining'), line,
      el('p', season ? 'Keep this tab open. You can close this popup.' : 'Ukai\'s own window works by itself (it stays minimized). Don\'t close it and don\'t start a video on Netflix meanwhile. You can close this popup.', { className: 'muted' }), stop],
    'running');
  }

  function describe(r) {
    if (r.kind === 'season') {
      const ok = r.results.filter((x) => x.ok).length;
      const bad = r.results.filter((x) => !x.ok).map((x) => `${x.id}: ${x.why}`);
      return `Season walk ${r.status}: ${ok} episode(s) sent` + (bad.length ? `, ${bad.length} failed (${bad.slice(0, 4).join('; ')})` : '') + (r.message ? '. ' + r.message : '') + '.';
    }
    const done = (r.results || []).reduce((n, x) => n + x.recorded, 0);
    const failed = (r.results || []).reduce((n, x) => n + x.failed.length, 0);
    // say why, by reason (the same words go to Surasura in `done`)
    const why = {};
    for (const x of r.results || []) for (const f of x.failed) why[f.why] = (why[f.why] || 0) + 1;
    const reasons = Object.entries(why).map(([w, n]) => `${n} × ${w}`).join('; ');
    const base = `${done} clip(s) recorded, ${failed} line(s) failed` + (reasons ? ` (${reasons}).` : '.');
    if (r.status === 'done') return 'Finished. ' + base;
    if (r.status === 'stopped') return 'Stopped. ' + base;
    if (r.status === 'aborted') return 'Surasura did not answer (busy or closed) after several tries, so the batch was stopped. What it had got is kept; press Record now again to go on. ' + base;
    if (r.status === 'needs-click') return r.message + ' ' + base;
    return 'Stopped by an error: ' + (r.message || '') + ' ' + base;
  }

  (async function loop() {
    try { if (!(chrome.runtime && chrome.runtime.id)) return; } catch (e) { return; } // reloaded under the popup: stop
    let wait = 2000;
    try { wait = await render(); } catch (e) { /* the next look tries again */ }
    setTimeout(loop, wait);
  })();
  return { refresh: () => { shown = null; return render(); } };
}
