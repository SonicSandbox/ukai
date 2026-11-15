# Surasura subtitle sender (Chrome / Edge extension, v0.2)

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

## Mining: clips for the lines Surasura asks for (v2)

Surasura queues an episode, picks its words and waits for one short video clip (picture + sound, webm) per line.
The popup then shows "N episodes wait: M lines". What you do:

1. **Click the extension icon on the episode's own tab** (the watch page of that episode, logged in as usual).
   If that episode is not open, the popup has **Open this episode**; it opens (or finds) the tab, then you click the icon again on that tab.
   This click is required: Chrome only lets an extension capture a tab after you invoke the extension on that tab. Nothing fakes it.
2. Press **Record N clips**. Tick "also continue with the other waiting episodes in this tab" to let it walk through the rest by navigating the same tab (best effort: if Chrome ends the capture when the tab changes page, it stops and says "click the icon again").
3. Leave the tab open and the video visible (do not minimise the window). The popup can be closed; progress is in the popup when you reopen it ("episode 1 of 2: line 5 of 14"). **Stop** ends it; clips already sent stay, lines not done stay waiting.

Per line it seeks to `start - pad_before` with the player's own API, waits until the frame is really showing and the video is playing, records (VP9/VP8 + Opus, 720p max, ~1.5 Mbit/s) until `end + pad_after`, pauses and posts the clip with the real first-frame time. A line that fails (seek or play timeout, "still watching" screen, stalled, tab closed) is skipped, never retried, and listed in `done`; 3 failures in a row skip the rest of that episode. If Surasura stops answering the batch stops. A tab the extension opened itself is closed afterwards. Sound stays audible while recording (the captured sound is played back, since Chrome would otherwise mute the tab). Before each clip the site's own subtitles and controls are hidden, and put back after. A clip that is exact silence or a black picture (typical when hardware acceleration is on) is not sent: the line is reported as failed with that advice. A keyboard shortcut (default Alt+Shift+S, changeable at `chrome://extensions/shortcuts`) opens the popup and grants the same tab permission as the icon. Only what plays in your own tab is recorded; the stream itself is never downloaded or saved, and clips go only to 127.0.0.1:27631.

"Send to Surasura" also adds the show's artwork (`og:image`, fetched by the page, at most 400 KB) as `cover` when it can be had.

Try without Surasura: `python tools/mock_surasura.py --job-url https://www.netflix.com/watch/<id>` (lines via `--job-lines 60-63,120-124`); clips land in the system temp folder, in `mock_surasura_clips`.

## What it does and does not do

- Reads only the subtitle text the page already receives (TTML/IMSC, WebVTT, HLS subtitle segments) by watching the page's own responses. It never requests anything from Netflix/Disney+ itself.
- Never downloads, saves or decrypts the stream. Nothing to do with DRM. Audio/picture are recorded only in the mining batch above (your own tab, one short clip per line) and the hand-run probe.
- Talks only to `http://127.0.0.1:27631`. Permissions: Netflix and Disney+ pages, that loopback address, storage, alarms, `activeTab` and `tabCapture` (probe and mining) and `offscreen` (keeps the recorder alive when the popup closes).
- Text-based subtitles only; image-based subtitle tracks cannot be read.
- Cue times of Disney+ segments are stored as written in the files (`X-TIMESTAMP-MAP` offsets are logged, not applied).

## Development

```
node --test test/                 # parser, delivery and hook tests (fixtures are hand-written, no real show content)
python tools/mock_surasura.py     # mock receiver per CONTRACT.md (--token, --port, --busy)
node tools/e2e_send.js            # simulated popup: fixture -> payload -> mock receiver
```

Console messages start with `[surasura]` (page console for the content script, `chrome://extensions` → *service worker* for sending).

Layout: `src/hook.js` (page side, listens to responses), `src/parsers.js`, `src/sites/netflix.js` and `src/sites/disneyplus.js` (one small adapter each), `src/content.js`, `src/delivery.js` (HTTP + retry queue), `src/background.js`, `src/walk.js` (mining state machine), `src/bridge.js` + `src/sites/*_page.js` (page-world player control), `offscreen/` (recorder), `popup/`, `options/`.
