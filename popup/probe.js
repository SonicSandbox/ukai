// Capture probe: answers only "can a later version record audio and picture from this tab?". Nothing is saved or sent.
async function runProbe(tab, out, btn) {
  btn.disabled = true;
  out.textContent = 'Recording 5 seconds… keep the video playing.';
  let stream, ctx;
  try {
    stream = await new Promise((res, rej) =>
      chrome.tabCapture.capture({ audio: true, video: true }, (s) =>
        s ? res(s) : rej(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'capture failed'))));
    // keep the tab audible while captured, and measure its level
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    src.connect(an);
    src.connect(ctx.destination);
    let peak = 0;
    const buf = new Float32Array(an.fftSize);
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
    }, 100);

    const rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()));
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();

    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = new MediaStream(stream.getVideoTracks());
    await video.play();
    await new Promise((r) => setTimeout(r, 1500));
    const streamShot = grab(video);
    const tabShot = await screenshot(tab);

    await new Promise((r) => setTimeout(r, 3500));
    rec.stop();
    await stopped;
    clearInterval(timer);

    const url = URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' }));
    out.textContent = '';
    add(out, 'p', `Audio: peak level ${peak.toFixed(3)} → ${peak < 0.005 ? 'SILENT (nothing recorded)' : 'sound was recorded'}`);
    const a = add(out, 'audio'); a.controls = true; a.src = url;
    add(out, 'p', `Picture from tabCapture video: ${streamShot.black ? 'BLACK' : 'has picture'}`);
    const i1 = add(out, 'img'); i1.src = streamShot.url;
    add(out, 'p', `Screenshot of the tab: ${tabShot.black ? 'BLACK' : 'has picture'}`);
    const i2 = add(out, 'img'); i2.src = tabShot.url;
    console.log('[surasura] probe', { peak, streamBlack: streamShot.black, tabBlack: tabShot.black, bytes: chunks.reduce((n, c) => n + c.size, 0) });
  } catch (e) {
    out.textContent = 'Probe failed: ' + (e && e.message ? e.message : e);
    console.log('[surasura] probe failed', e);
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close();
    btn.disabled = false;
  }
}

function add(parent, tag, text) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  parent.appendChild(e);
  return e;
}

// "black" = the middle of the picture is (almost) all dark
function analyse(source, w, h) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 36;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, w * 0.2, h * 0.2, w * 0.6, h * 0.6, 0, 0, 64, 36);
  const d = g.getImageData(0, 0, 64, 36).data;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
  return max < 16;
}

function grab(video) {
  const w = video.videoWidth || 640, h = video.videoHeight || 360;
  const c = document.createElement('canvas');
  c.width = 320; c.height = Math.round((320 * h) / w);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/jpeg', 0.7), black: analyse(c, c.width, c.height) };
}

async function screenshot(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { url: dataUrl, black: analyse(img, img.width, img.height) };
}
