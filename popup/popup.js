const $ = (id) => document.getElementById(id);
const D = self.SurasuraDelivery;
let tab, st, meta;

const WORDS = {
  added: ['Added to your Surasura library.', 'ok'],
  exists: ['Already in your Surasura library.', 'ok'],
  offline: ['Surasura is not running. Kept here; it will be sent when Surasura starts.', 'bad'],
  busy: ['Surasura is busy. Kept here; it will be sent again soon.', 'bad'],
  badtoken: ['Wrong or missing token. Paste the token from Surasura in "Token / settings". Kept here until it works.', 'bad'],
};

function say(text, cls) {
  const m = $('msg');
  m.hidden = false;
  m.className = cls || '';
  m.textContent = text;
}

async function init() {
  $('opts').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage({ type: 'status' }).then((s) => {
    if (s && s.queued) $('queue').textContent = `${s.queued} subtitle(s) waiting for Surasura.`;
    if (s && !s.hasToken) say('No token yet. Open "Token / settings" and paste the one from Surasura.', 'bad');
  });
  if (await initYoutube()) return;
  try {
    st = await chrome.tabs.sendMessage(tab.id, { type: 'getState' });
  } catch (e) {
    st = null;
  }
  initMining(tab, st);
  if (!st) {
    $('none').hidden = false;
    const onSite = /:\/\/[^/]*(netflix\.com|disneyplus\.com)\//.test(tab.url || '');
    $('none').textContent = onSite
      ? 'This page was opened before the extension was installed or reloaded, so the extension can\'t read it yet. Reload the page, start the video with subtitles on, then open this again.'
      : 'Open a Netflix or Disney+ watch page, start the video with subtitles on, then open this again.';
    if (onSite) {
      const b = document.createElement('button');
      b.textContent = 'Reload this page';
      b.onclick = () => { chrome.tabs.reload(tab.id); window.close(); };
      $('none').appendChild(document.createElement('br'));
      $('none').appendChild(b);
    }
    return;
  }
  if (!st.videoId) {
    $('none').hidden = false;
    $('none').textContent = 'This is not a watch page. Open a video and start it.';
    return;
  }
  if (!st.tracks.length) {
    $('none').hidden = false;
    $('none').textContent = 'No subtitles seen on this page yet. Turn subtitles on in the player (in the language you study), let it play a few seconds, and reload the page if you turned them on before installing.';
    return;
  }
  $('found').hidden = false;
  for (const t of st.tracks) {
    const o = document.createElement('option');
    o.value = t.key;
    o.textContent = `${t.language || 'unknown language'} – ${t.count} cues`;
    $('track').appendChild(o);
  }
  // the player's own data first (numbers for season / episode), the visible text only as a fallback
  const mm = await chrome.tabs.sendMessage(tab.id, { type: 'getMeta' }).catch(() => null);
  meta = (mm && mm.meta) || null;
  const why = mm && mm.error;
  const i = meta && (meta.title || meta.show) ? meta : st.info || {};
  $('title').value = i.title || st.docTitle || '';
  $('show').value = meta && meta.film ? '' : i.show || '';
  $('season').value = i.season ?? '';
  $('episode').value = i.episode ?? '';
  $('detected').textContent = !meta ? 'Title, season and episode were read from the page text (check them).' + (why ? ' Player data: ' + why : '')
    : meta.film ? 'Detected: a film (no season / episode).'
    : `Detected from the player: ${meta.show || '?'} season ${meta.season ?? '?'} episode ${meta.episode ?? '?'}`;
  if (meta && meta.episodes && meta.episodes.length > 1 && st.site === 'netflix') {
    $('seasonBtn').hidden = false;
    $('seasonBtn').textContent = `Send the whole season (${meta.episodes.length} episodes, experimental)`;
    $('seasonBtn').onclick = () => startSeason(meta);
  }
  if (!i.title) say('The player has not shown the title yet (move the mouse over the video), so check the title here.');
  $('send').onclick = send;
}

async function send() {
  $('send').disabled = true;
  try {
    const track = st.tracks.find((t) => t.key === $('track').value);
    const { cues } = await chrome.tabs.sendMessage(tab.id, { type: 'getCues', key: track.key });
    const cv = await chrome.tabs.sendMessage(tab.id, { type: 'getCover' }).catch(() => null);
    const payload = D.buildPayload(st, track, cues, {
      title: $('title').value, show: $('show').value, season: $('season').value, episode: $('episode').value,
    }, cv && cv.cover);
    const r = await chrome.runtime.sendMessage({ type: 'send', payload });
    if (r.status === 'rejected') say('Surasura did not accept it: ' + r.why, 'bad');
    else if (r.status === 'error') say('Something went wrong: ' + r.why, 'bad');
    else {
      const [text, cls] = WORDS[r.status];
      say(`${text}\n(${payload.title}, ${payload.language}, ${cues.length} cues)` + (payload.cover ? '\nCover sent.' : '\nNo cover: ' + ((cv && cv.why) || 'unknown')), cls);
    }
  } catch (e) {
    say('Something went wrong: ' + e, 'bad');
  }
  $('send').disabled = false;
}

$('probe').onclick = () => runProbe(tab, $('probeOut'), $('probe'));
init();

async function startSeason(m) {
  const lang = st.tracks.find((t) => t.key === $('track').value).language;
  const minutes = Math.ceil((m.episodes.length * 25) / 60);
  if (!confirm(`EXPERIMENTAL. This walks THIS tab through all ${m.episodes.length} episodes of the season, one after another, muted, about 20-30 seconds each (roughly ${minutes} minutes). It sends the ${lang || ''} subtitles of each and then returns to this episode. Keep the tab open; you can Stop from this popup. Continue?`)) return;
  const { token } = await chrome.storage.local.get('token');
  const r = await chrome.runtime.sendMessage({
    type: 'startSeason', tabId: tab.id, token, episodes: m.episodes, language: lang, startId: st.videoId,
  });
  if (!r || !r.ok) return say('Could not start: ' + ((r && r.why) || 'no answer'), 'bad');
  say('The season walk has started. Open this popup again to see progress.');
}

// YouTube: only hands links to Surasura (POST /v1/youtube); nothing is recorded there.
async function initYoutube() {
  const l = self.SurasuraYoutube.parse(tab.url || '');
  if (!l.video && !l.playlist) return false;
  const box = $('yt');
  box.hidden = false;
  const btn = (text, urls) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = async () => {
      b.disabled = true;
      const { token } = await chrome.storage.local.get('token');
      const r = await D.postYoutube(token, urls, fetch);
      const words = {
        ok: ['Sent to Surasura. It reads the ' + (urls[0].includes('/playlist') ? 'playlist' : 'video') +
          ' in the background; the videos arrive in New arrivals when it is done (a playlist can take a few minutes). ' +
          'Press once: a second press starts it again.', 'ok'],
        refused: ['Surasura says: ' + r.why, 'bad'],
        offline: ['Surasura is not running.', 'bad'],
        busy: ['Surasura is busy. Try again in a moment.', 'bad'],
        badtoken: ['Wrong or missing token (Token / settings).', 'bad'],
        rejected: ['Surasura did not accept it: ' + r.why, 'bad'],
      }[r.status];
      say(words[0], words[1]);
      b.disabled = false;
    };
    box.appendChild(b);
  };
  if (l.video) btn('Send this video to Surasura', [l.video]);
  if (l.playlist) btn('Send the whole playlist', [l.playlist]);
  return true;
}
