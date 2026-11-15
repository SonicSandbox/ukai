# Surasura subtitle sender (Chrome / Edge extension, v0.1)

Sends the subtitles of the Netflix or Disney+ video you are watching to your local Surasura app, so they land
in the library like a YouTube transcript. Plain JavaScript, Manifest V3, no build step.
The wire format is in [CONTRACT.md](CONTRACT.md).

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**.
2. **Load unpacked** → pick this folder. It should list no errors.
3. In Surasura, copy the extension token. In the extension's **Token / settings** (popup link, or *Details → Extension options*) paste it and Save.

## Use

1. Open a video on netflix.com or disneyplus.com, turn on subtitles in the language you study, let it play a few seconds.
   (Pages that were already open when you installed the extension must be reloaded once.)
2. Click the extension icon. It shows the subtitle tracks it found (language, cue count) and the title, show, season and episode it read from the player. Fix them if needed.
3. **Send to Surasura.** Result in plain words: added, already in the library, Surasura not running, wrong token.
   A subtitle that could not be delivered is kept in the browser and sent automatically (checked every minute) once Surasura answers.

Tip: Netflix and Disney+ only show the title while the player controls are visible; move the mouse over the video once.

## Capture probe (by hand)

The popup has **Run capture probe**: it records 5 s of the tab's audio and takes one picture of the video while it plays, shows both in the popup, and says whether each picture is black and whether the audio was silent. Nothing is saved or sent. It only tells us whether a later "mining" version is possible. Start the video first, then click it.

## What it does and does not do

- Reads only the subtitle text the page already receives (TTML/IMSC, WebVTT, HLS subtitle segments) by watching the page's own responses. It never requests anything from Netflix/Disney+ itself.
- Never downloads, saves, decrypts or sends video or audio. Nothing to do with DRM.
- Talks only to `http://127.0.0.1:27631`. Permissions: Netflix and Disney+ pages, that loopback address, storage, alarms, `activeTab` and `tabCapture` (the probe).
- Text-based subtitles only; image-based subtitle tracks cannot be read.
- Cue times of Disney+ segments are stored as written in the files (`X-TIMESTAMP-MAP` offsets are logged, not applied).

## Development

```
node --test test/                 # parser, delivery and hook tests (fixtures are hand-written, no real show content)
python tools/mock_surasura.py     # mock receiver per CONTRACT.md (--token, --port, --busy)
node tools/e2e_send.js            # simulated popup: fixture -> payload -> mock receiver
```

Console messages start with `[surasura]` (page console for the content script, `chrome://extensions` → *service worker* for sending).

Layout: `src/hook.js` (page side, listens to responses), `src/parsers.js`, `src/sites/netflix.js` and `src/sites/disneyplus.js` (one small adapter each), `src/content.js`, `src/delivery.js` (HTTP + retry queue), `src/background.js`, `popup/`, `options/`.
