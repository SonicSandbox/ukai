const $ = (id) => document.getElementById(id);
const D = self.SurasuraDelivery;
let tab, st;

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
  try {
    st = await chrome.tabs.sendMessage(tab.id, { type: 'getState' });
  } catch (e) {
    st = null;
  }
  if (!st) {
    $('none').hidden = false;
    $('none').textContent = 'Open a Netflix or Disney+ watch page (reload it once after installing the extension), start the video with subtitles on, then open this again.';
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
  const i = st.info || {};
  $('title').value = i.title || st.docTitle || '';
  $('show').value = i.show || '';
  $('season').value = i.season ?? '';
  $('episode').value = i.episode ?? '';
  if (!i.title) say('The player has not shown the title yet (move the mouse over the video), so check the title here.');
  $('send').onclick = send;
}

async function send() {
  $('send').disabled = true;
  try {
    const track = st.tracks.find((t) => t.key === $('track').value);
    const { cues } = await chrome.tabs.sendMessage(tab.id, { type: 'getCues', key: track.key });
    const payload = D.buildPayload(st, track, cues, {
      title: $('title').value, show: $('show').value, season: $('season').value, episode: $('episode').value,
    });
    const r = await chrome.runtime.sendMessage({ type: 'send', payload });
    if (r.status === 'rejected') say('Surasura did not accept it: ' + r.why, 'bad');
    else if (r.status === 'error') say('Something went wrong: ' + r.why, 'bad');
    else {
      const [text, cls] = WORDS[r.status];
      say(`${text}\n(${payload.title}, ${payload.language}, ${cues.length} cues)`, cls);
    }
  } catch (e) {
    say('Something went wrong: ' + e, 'bad');
  }
  $('send').disabled = false;
}

$('probe').onclick = () => runProbe(tab, $('probeOut'), $('probe'));
init();
