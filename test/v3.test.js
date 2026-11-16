const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/meta.js');
const Y = require('../src/youtube.js');
const S = require('../src/season.js');
const D = require('../src/delivery.js');

// made-up metadata shaped like the player's
const vmeta = {
  100: { _metadata: { video: { type: 'show', title: 'Made-up Show', boxart: [{ w: 200, url: 'small' }, { w: 360, url: 'mid' }, { w: 900, url: 'big' }],
    seasons: [
      { seq: 1, episodes: [{ id: 101, seq: 1, title: 'One' }, { id: 102, seq: 2, title: 'Two' }] },
      { seq: 2, episodes: [{ id: 201, seq: 1, title: 'Again' }] },
    ] } } },
  300: { _metadata: { video: { type: 'movie', title: 'A Film', artwork: [{ w: 100, url: 'only' }] } } },
};
// the player keys metadata by the id of the thing watched; give each episode its own entry the same way
for (const id of [101, 102, 201]) vmeta[id] = vmeta[100];

test('netflixMeta: episode gives numbers, season list and artwork; film has no show', () => {
  const m = M.netflixMeta(vmeta, '102');
  assert.deepStrictEqual([m.film, m.show, m.season, m.episode, m.title, m.coverUrl], [false, 'Made-up Show', 1, 2, 'Two', 'mid']);
  assert.deepStrictEqual(m.episodes.map((e) => e.id), ['101', '102']);
  assert.strictEqual(M.netflixMeta(vmeta, '201').season, 2);
  const f = M.netflixMeta(vmeta, '300');
  assert.deepStrictEqual([f.film, f.title, f.show, f.coverUrl], [true, 'A Film', undefined, 'only']);
  assert.strictEqual(M.netflixMeta(vmeta, '999'), null);
  assert.strictEqual(M.netflixMeta(null, '1'), null);
});

test('youtube links', () => {
  assert.deepStrictEqual(Y.parse('https://www.youtube.com/watch?v=abcDEF12345&t=5s'), { video: 'https://www.youtube.com/watch?v=abcDEF12345', playlist: null });
  assert.deepStrictEqual(Y.parse('https://www.youtube.com/watch?v=abcDEF12345&list=PLabcdefghij123'),
    { video: 'https://www.youtube.com/watch?v=abcDEF12345', playlist: 'https://www.youtube.com/playlist?list=PLabcdefghij123' });
  assert.deepStrictEqual(Y.parse('https://www.youtube.com/playlist?list=PLabcdefghij123'), { video: null, playlist: 'https://www.youtube.com/playlist?list=PLabcdefghij123' });
  assert.strictEqual(Y.parse('https://www.youtube.com/watch?v=abcDEF12345&list=RDabcDEF12345').playlist, null);
  assert.strictEqual(Y.parse('https://youtu.be/abcDEF12345').video, 'https://www.youtube.com/watch?v=abcDEF12345');
  assert.deepStrictEqual(Y.parse('https://www.youtube.com/'), { video: null, playlist: null });
  assert.deepStrictEqual(Y.parse('https://example.com/watch?v=abcDEF12345'), { video: null, playlist: null });
});

test('postYoutube: ok, 409 words, 401', async () => {
  const f = (status, body) => async () => ({ status, json: async () => body });
  assert.deepStrictEqual(await D.postYoutube('t', ['u'], f(200, { ok: true, queued: 1 })), { status: 'ok', queued: 1 });
  assert.deepStrictEqual(await D.postYoutube('t', ['u'], f(409, { ok: false, why: 'downloader is off' })), { status: 'refused', why: 'downloader is off' });
  assert.strictEqual((await D.postYoutube('t', ['u'], f(401, {}))).status, 'badtoken');
  assert.strictEqual((await D.postYoutube('t', ['u'], async () => { throw new Error('x'); })).status, 'offline');
});

// ---- season walk with a fake player / tab ----
function world(opts = {}) {
  const w = { clock: 0, url: opts.startId || '101', posts: [], navs: [], muted: [], playing: false, covers: 0, stopAfter: opts.stopAfter };
  const trackReady = (id) => !(opts.noTrack || []).includes(id);
  w.env = {
    now: () => w.clock,
    sleep: async (ms) => { w.clock += ms; },
    shouldStop: () => w.stopAfter != null && w.posts.length >= w.stopAfter,
    onProgress: () => {},
    navigate: async (u) => { w.navs.push(u); w.url = u.split('/').pop(); },
    getState: async () => ({
      site: 'netflix', videoId: w.url, url: 'https://www.netflix.com/watch/' + w.url, docTitle: null,
      tracks: trackReady(w.url) ? [{ key: 'k' + w.url, language: 'ja', count: 3 }] : [{ key: 'e' + w.url, language: 'en', count: 3 }],
    }),
    getCues: async () => ({ cues: [[0, 1, 'x']] }),
    getMeta: async () => ({ show: 'S', season: 1, episode: +w.url - 100, title: 't' + w.url }),
    getCover: async () => { w.covers++; return 'COVER'; },
    playerReady: async () => (w.readyCalls = (w.readyCalls || 0) + 1) > 1,
    play: async () => { w.playing = true; }, pause: async () => { w.playing = false; },
    mute: async (on) => { w.muted.push(on); },
    build: (st, t, cues, meta, cover) => ({ video_id: st.videoId, language: t.language, episode: meta.episode, cover }),
    post: async (p) => { w.posts.push(p); return opts.post ? opts.post(p, w.posts.length) : { status: 'added' }; },
  };
  return w;
}
const eps = [101, 102, 103].map((id, i) => ({ id: String(id), seq: i + 1, title: 'E' + (i + 1) }));

test('season walk: every episode posted once, cover only with the first, ends back at the start, unmuted', async () => {
  const w = world();
  const r = await S.walkSeason({ episodes: eps, language: 'ja', startId: '101' }, w.env);
  assert.strictEqual(r.status, 'done');
  assert.deepStrictEqual(w.posts.map((p) => p.video_id), ['101', '102', '103']);
  assert.deepStrictEqual(w.posts.map((p) => p.cover), ['COVER', null, null]);
  assert.strictEqual(w.covers, 1);
  assert.strictEqual(w.url, '101'); // back where it started
  assert.strictEqual(w.muted[w.muted.length - 1], false);
  assert.strictEqual(w.playing, false);
});

test('season walk: an episode without the language is reported and skipped, not retried', async () => {
  const w = world({ noTrack: ['102'] });
  const r = await S.walkSeason({ episodes: eps, language: 'ja', startId: '101' }, w.env);
  assert.strictEqual(r.results.filter((x) => x.ok).length, 2);
  assert.match(r.results[1].why, /no ja subtitles/);
  assert.strictEqual(w.posts.length, 2);
});

test('season walk: busy is retried, then goes on; offline aborts', async () => {
  let busyOnce = true;
  const w = world({ post: (p) => (p.video_id === '101' && busyOnce ? ((busyOnce = false), { status: 'busy' }) : { status: 'added' }) });
  const r = await S.walkSeason({ episodes: eps, language: 'ja', startId: '101' }, w.env);
  assert.strictEqual(r.status, 'done');
  assert.strictEqual(w.posts.length, 4); // 101 twice
  const w2 = world({ post: () => ({ status: 'offline' }) });
  const r2 = await S.walkSeason({ episodes: eps, language: 'ja', startId: '101' }, w2.env);
  assert.strictEqual(r2.status, 'aborted');
  assert.strictEqual(w2.posts.length, 1);
});

test('season walk: Stop leaves the tab muted state restored and returns to start', async () => {
  const w = world({ stopAfter: 1 });
  const r = await S.walkSeason({ episodes: eps, language: 'ja', startId: '101' }, w.env);
  assert.strictEqual(r.status, 'stopped');
  assert.strictEqual(w.posts.length, 1);
  assert.strictEqual(w.muted[w.muted.length - 1], false);
});

test('netflixMeta finds the video in other entry shapes', () => {
  const v = { type: 'show', title: 'Alt', seasons: [{ seq: 3, episodes: [{ episodeId: 7, seq: 4, title: 'x' }] }] };
  for (const entry of [{ video: v }, { _video: v }, { _metadata: { data: { video: v } } }, v]) {
    const m = M.netflixMeta({ 7: entry }, '7');
    assert.deepStrictEqual([m.show, m.season, m.episode], ['Alt', 3, 4]);
  }
});

test('season walk: an episode whose player data comes late is waited for; never coming, the season list fills it in', async () => {
  // Sakamoto Days, 81664948: "entry has no video data" when its subtitles were already there
  let tries = 0;
  const w = world();
  const real = w.env.getMeta;
  w.env.getMeta = async () => {
    if (w.url === '102' && ++tries < 4) throw new Error('entry has no video data');
    if (w.url === '103') throw new Error('entry has no video data');
    return real();
  };
  w.env.build = (st, t, cues, meta) => ({ video_id: st.videoId, show: meta.show, season: meta.season, episode: meta.episode, title: meta.title });
  const r = await S.walkSeason({ episodes: eps, language: 'ja', startId: '101' }, w.env);
  assert.strictEqual(r.results.filter((x) => x.ok).length, 3);
  assert.deepStrictEqual(w.posts[1], { video_id: '102', show: 'S', season: 1, episode: 2, title: 't102' }, 'late: its own data');
  assert.deepStrictEqual(w.posts[2], { video_id: '103', show: 'S', season: 1, episode: 3, title: 'E3' }, 'never: the season list');
});

test('season walk: waits for the player session; a throwing play() does not kill the walk', async () => {
  const w = world();
  w.env.play = async () => { throw new Error('netflix: no player session'); };
  const r = await S.walkSeason({ episodes: eps, language: 'ja', startId: '101' }, w.env);
  assert.strictEqual(r.status, 'done');
  assert.strictEqual(r.results.filter((x) => x.ok).length, 3);
});
