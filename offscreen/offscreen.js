// Offscreen document: lives while a batch runs, so closing the popup does not end the recording.
// Records the tab's picture + sound (tabCapture stream) one clip per line and posts it to Surasura.
const D = self.SurasuraDelivery;
const W = self.SurasuraWalk;
const log = (...a) => console.log('[surasura]', ...a);

let status = { state: 'idle' };
let stopFlag = false;

const relay = (msg) => chrome.runtime.sendMessage(Object.assign({ to: 'background' }, msg));

async function startBatch(m) {
  stopFlag = false;
  status = { state: 'running', message: 'Starting…' };
  let stream, ctx;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId } },
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId, maxWidth: 1280, maxHeight: 720, maxFrameRate: 30 } },
    });
    // Silent by design: tabCapture takes the tab's sound away from the speakers and nothing plays it back.
    ctx = new AudioContext();

    // quality: was anything but silence / a black picture recorded during this clip?
    const an = ctx.createAnalyser();
    const sink = ctx.createGain(); // gain 0: keeps the analyser running without a sound
    sink.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(an);
    an.connect(sink);
    sink.connect(ctx.destination);
    const abuf = new Float32Array(an.fftSize);
    let peak = 0, sampler = null;
    const vid = document.createElement('video');
    vid.muted = true;
    vid.srcObject = new MediaStream(stream.getVideoTracks());
    await vid.play();
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 36;
    const cg = cv.getContext('2d', { willReadFrequently: true });
    let bright = 0;
    const sample = () => {
      an.getFloatTimeDomainData(abuf);
      for (const v of abuf) peak = Math.max(peak, Math.abs(v));
      if (vid.videoWidth) {
        const w = vid.videoWidth, h = vid.videoHeight;
        cg.drawImage(vid, w * 0.2, h * 0.2, w * 0.6, h * 0.6, 0, 0, 64, 36);
        const d = cg.getImageData(0, 0, 64, 36).data;
        for (let i = 0; i < d.length; i += 4) bright = Math.max(bright, d[i], d[i + 1], d[i + 2]);
      }
    };

    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    let rec, chunks;
    const recorder = {
      start() {
        chunks = []; peak = 0; bright = 0;
        sampler = setInterval(sample, 200);
        rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1500000, audioBitsPerSecond: 96000 });
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        return new Promise((res) => { rec.onstart = res; rec.start(500); });
      },
      quality() { return { silent: peak < 1e-4, black: bright < 16 }; },
      stop() {
        clearInterval(sampler);
        return new Promise((res) => {
          if (!rec || rec.state === 'inactive') return res(new Blob(chunks || [], { type: 'video/webm' }));
          rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' }));
          rec.stop();
        });
      },
    };
    // the capture is live: un-mute the window's tab (the capture keeps its sound from the speakers) and minimize it
    if (m.windowId) await relay({ type: 'ownReady', tabId: m.tabId, windowId: m.windowId });
    const page = async (op, args) => {
      const r = await relay({ type: 'page', tabId: m.tabId, op, args });
      if (!r || r.error) throw new Error((r && r.error) || 'no answer from the page');
      return r.result;
    };
    const env = {
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      shouldStop: () => stopFlag,
      onProgress: (p) => { status = { state: 'running', progress: p }; log('progress', JSON.stringify(p)); },
      navigate: (url) => relay({ type: 'navigate', tabId: m.tabId, url }),
      streamAlive: () => stream.getVideoTracks().some((t) => t.readyState === 'live'),
      player: {
        seek: (t) => page('seek', { t }), play: () => page('play'), pause: () => page('pause'),
        hideUi: () => page('hideUi'), showUi: () => page('showUi'),
        state: () => page('state'),
      },
      recorder,
      api: {
        postClip: (job, n, blob, s, e) => D.postClip(m.token, job.job, n, blob, s, e, fetch, undefined, () => stopFlag),
        postDone: (job, failed) => D.postDone(m.token, job.job, failed, fetch, undefined, () => stopFlag),
      },
    };
    const r = await W.runBatch(m.jobs, env);
    log('batch finished:', JSON.stringify(r));
    status = { state: 'finished', result: r };
  } catch (e) {
    log('batch failed:', e);
    status = { state: 'finished', result: { status: 'error', message: String((e && e.message) || e), results: [] } };
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close();
    if (m.windowId) relay({ type: 'closeWindow', windowId: m.windowId });
  }
}

// EXPERIMENTAL: send a whole Netflix season (see src/season.js). Needs no capture, only the tab.
async function startSeason(m) {
  stopFlag = false;
  status = { state: 'running', progress: { kind: 'season', i: 0, n: m.episodes.length, title: '', done: 0 } };
  const ask = async (msg) => {
    const r = await relay({ type: 'content', tabId: m.tabId, msg });
    if (!r || r.error) throw new Error((r && r.error) || 'no answer from the page');
    return r;
  };
  const page = async (op, args) => (await ask({ type: 'player', op, args })).result;
  const env = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    shouldStop: () => stopFlag,
    onProgress: (p) => { status = { state: 'running', progress: p }; },
    navigate: (url) => relay({ type: 'navigate', tabId: m.tabId, url }),
    tabAlive: async () => ((await relay({ type: 'tabAlive', tabId: m.tabId })) || {}).alive !== false,
    getState: () => ask({ type: 'getState' }),
    getCues: (key) => ask({ type: 'getCues', key }),
    getMeta: async () => (await ask({ type: 'getMeta' })).meta,
    getCover: async () => (await ask({ type: 'getCover' })).cover,
    play: () => page('play'), pause: () => page('pause').catch(() => {}), mute: (on) => page('mute', { on }),
    playerReady: async () => { const s = await page('state'); return s && s.ok && s.apiReady && s.readyState >= 2; },
    build: (st, track, cues, meta, cover) => D.buildPayload(st, track, cues,
      { title: meta && meta.title, show: meta && meta.show, season: meta && meta.season, episode: meta && meta.episode }, cover),
    post: (payload) => D.post(payload, m.token, fetch),
  };
  try {
    const r = await self.SurasuraSeason.walkSeason({ episodes: m.episodes, language: m.language }, env);
    log('season finished:', JSON.stringify(r));
    status = { state: 'finished', result: { kind: 'season', status: r.status, results: r.results, message: r.message } };
  } catch (e) {
    status = { state: 'finished', result: { kind: 'season', status: 'error', message: String((e && e.message) || e), results: [] } };
  } finally {
    if (m.windowId) relay({ type: 'closeWindow', windowId: m.windowId });
  }
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (!m || m.to !== 'offscreen') return false;
  if (m.type === 'startSeason') {
    if (status.state === 'running') { reply({ ok: false, why: 'already running' }); return false; }
    startSeason(m);
    reply({ ok: true });
  } else if (m.type === 'start') {
    if (status.state === 'running') { reply({ ok: false, why: 'already running' }); return false; }
    startBatch(m);
    reply({ ok: true });
  } else if (m.type === 'stop') {
    stopFlag = true;
    reply({ ok: true });
  } else if (m.type === 'status') {
    reply(status);
  }
  return false;
});
