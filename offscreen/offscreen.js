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
    // tabCapture mutes the tab for the user; play the sound back so nothing is muted.
    ctx = new AudioContext();
    ctx.createMediaStreamSource(stream).connect(ctx.destination);

    // quality: was anything but silence / a black picture recorded during this clip?
    const an = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(an);
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
    const page = async (op, args) => {
      const r = await relay({ type: 'page', tabId: m.tabId, op, args });
      if (!r || r.error) throw new Error((r && r.error) || 'no answer from the page');
      return r.result;
    };
    const env = {
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      shouldStop: () => stopFlag,
      onProgress: (p) => { status = { state: 'running', progress: p }; },
      navigate: (url) => relay({ type: 'navigate', tabId: m.tabId, url }),
      streamAlive: () => stream.getVideoTracks().some((t) => t.readyState === 'live'),
      player: {
        seek: (t) => page('seek', { t }), play: () => page('play'), pause: () => page('pause'),
        state: () => page('state'),
      },
      recorder,
      api: {
        postClip: (job, n, blob, s, e) => D.postClip(m.token, job.job, n, blob, s, e, fetch),
        postDone: (job, failed) => D.postDone(m.token, job.job, failed, fetch),
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
    if (m.openedTab) relay({ type: 'closeTab', tabId: m.tabId });
  }
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (!m || m.to !== 'offscreen') return false;
  if (m.type === 'start') {
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
