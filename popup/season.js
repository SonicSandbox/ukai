// Season walk (experimental, Netflix): chosen in the learner's episode, started once the learner has left the
// player, and run in a window of Ukai's own (never the learner's tab). It needs no capture, only the subtitle text.
async function initSeasonPending(tab) {
  const box = document.getElementById('seasonPending');
  const H = self.SurasuraHosts;
  const { season } = await chrome.storage.session.get('season').catch(() => ({}));
  if (!season) return;
  const el = (tag, text, props) => Object.assign(document.createElement(tag), { textContent: text || '' }, props || {});
  const msg = el('p', '');
  const clear = async () => { await chrome.storage.session.remove('season'); box.hidden = true; };

  const start = el('button', `Start the season walk (${season.episodes.length} episodes)`);
  start.onclick = async () => {
    const own = Object.keys((await chrome.storage.session.get('own').catch(() => ({}))).own || {}).map(Number);
    const open = H.watchTabs(await chrome.tabs.query({ url: ['*://*.netflix.com/*', '*://*.disneyplus.com/*'] }), own);
    if (open.length) {
      msg.className = 'bad';
      msg.textContent = 'You still have a video open. Netflix lets only one play, so go back from the player to the browse page first, then press this again.';
      return;
    }
    start.disabled = true;
    const url = 'https://www.netflix.com/watch/' + season.episodes[0].id;
    const { token } = await chrome.storage.local.get('token');
    // one message: the background opens the window AND starts the walk (the popup closes when the window takes focus)
    const r = await chrome.runtime.sendMessage({ type: 'startSeasonOwn', url, token, episodes: season.episodes, language: season.language });
    if (!r || !r.ok) { msg.className = 'bad'; msg.textContent = 'Could not start: ' + ((r && r.why) || 'no answer'); start.disabled = false; return; }
    await clear();
  };
  const cancel = el('button', 'Cancel');
  cancel.onclick = clear;

  box.replaceChildren(el('h3', 'Season walk (experimental)'),
    el('p', `"${season.show || 'The show'}": ${season.episodes.length} episodes, ${season.language || ''} subtitles. Ukai opens a window of its own and plays each episode muted for about 20-30 seconds to collect its subtitles (roughly ${Math.ceil(season.episodes.length * 25 / 60)} minutes). It never uses your own tab.`, { className: 'muted' }),
    msg, start, cancel);
  box.hidden = false;
}
