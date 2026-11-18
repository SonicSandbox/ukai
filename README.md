<div align="center">

<img src="icons/icon-512.png" width="96" height="96" alt="Ukai">

# Ukai 鵜飼

![Chrome · Edge](https://img.shields.io/badge/Chrome%20%C2%B7%20Edge-extension-f5b73b) ![Manifest V3](https://img.shields.io/badge/Manifest-V3-a06818) ![Local only](https://img.shields.io/badge/sends%20only%20to-127.0.0.1-03dac6) ![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg) [![Works with Surasura](https://img.shields.io/badge/works%20with-Surasura-22c3c9)](https://github.com/SonicSandbox/surasura)

**Surasura's watch companion.**

**Watch Netflix or Disney+ as you always do. The subtitles, and short clips of the lines you study, come home to your local Surasura.**

</div>

鵜飼 is cormorant fishing: the cormorant fishes the river at night by torchlight and brings each fish home to the boat.
Ukai brings the subtitles and clips of what you watch home to your local Surasura. Its gem is citrine, `#f5b73b`.

## What it does

| 📥 Subtitles into your library | 🎬 Clips for your cards |
| :---: | :---: |
| One click sends the subtitles of the episode you are watching to Surasura, where it lands in the library like a YouTube transcript. | When Surasura picks lines for your Anki cards, Ukai records one short clip (picture + sound) of each line, in your own tab. |
| **📚 A whole season** *(experimental, Netflix)* | **▶️ YouTube** |
| Walks your tab through the season's episodes and sends each one's subtitles, then brings you back. | On a video or a playlist, sends its link to Surasura. Nothing is recorded or downloaded. |

## Where it works

| Netflix | Disney+ | YouTube |
| :---: | :---: | :---: |
| Subtitles · clips · season, episode and cover from the player · the whole season *(experimental)* | Subtitles · clips *(not yet tried live)* · season and episode from the visible title | A video's or a playlist's link |

Text-based subtitles (TTML/IMSC, WebVTT, HLS subtitle segments) only.

## Get started

1. **Install it (unpacked).** Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
   **Load unpacked** → pick this folder. It should list no errors.
2. **Pair it with Surasura.** In Surasura, copy the extension token. In the extension's **Token / settings** (the
   popup's link, or *Details → Extension options*) paste it and Save.
3. **Watch as usual.** Open a video on netflix.com or disneyplus.com, turn on subtitles in the language you study and let
   it play a few seconds. (Pages that were already open when you installed the extension must be reloaded once.)

## Use

### Send the subtitles

1. Click the extension icon. It shows the subtitle tracks it found (language, cue count) and the title, show, season
   and episode it read from the player. Fix them if needed.
2. **Send to Surasura.** The result in plain words: added, already in the library, Surasura not running, wrong token.
   A subtitle that could not be delivered is kept in the browser and sent automatically (checked every minute) once
   Surasura answers.

*Tip: Netflix and Disney+ only show the title while the player controls are visible; move the mouse over the video
once.*

### Record clips for your cards

Surasura queues an episode, picks its words and waits for one short video clip (picture + sound, webm) per line. The
popup then shows "N episodes wait: M lines". What you do:

1. **Click the extension icon on the episode's own tab** (the watch page of that episode, logged in as usual). If that
   episode is not open, the popup has **Open this episode**: it opens (or finds) the tab, then you click the icon again
   on that tab. This click is required: Chrome only lets an extension capture a tab after you invoke the extension on
   that tab. Nothing fakes it. A keyboard shortcut (default **Alt+Shift+S**, changeable at
   `chrome://extensions/shortcuts`) opens the popup and grants the same tab permission as the icon.
2. Press **Record N clips**. Tick *also continue with the other waiting episodes in this tab* to let it walk through the
   rest by navigating the same tab (best effort: if Chrome ends the capture when the tab changes page, it stops and says
   "click the icon again").
3. Leave the tab open and the video visible (do not minimise the window). The popup can be closed; progress is in the
   popup when you reopen it ("episode 1 of 2: line 5 of 14"). **Stop** ends it; clips already sent stay, lines not done
   stay waiting.

<details>
<summary>How a clip is recorded</summary>

- **Per line**, it seeks to `start - pad_before` with the player's own API, waits until the frame is really showing and
  the video is playing, records (VP9/VP8 + Opus, 720p max, ~1.5 Mbit/s) until `end + pad_after`, pauses, and posts the
  clip with the real first-frame time.
- **A line that fails** (seek or play timeout, "still watching" screen, stalled, tab closed) is skipped, never retried,
  and listed in `done`. 3 failures in a row skip the rest of that episode. If Surasura stops answering, the batch stops.
- **A clip that is exact silence or a black picture** (typical when hardware acceleration is on) is not sent: the line
  is reported as failed, with that advice.
- **The page:** from before the seek until the clip is done, everything on the page except the video is made invisible
  (one attribute-based rule, black background, scrollbars hidden too; no class names guessed) and restored afterwards,
  also on failure or Stop.
- **Sound stays audible** while recording (the captured sound is played back, since Chrome would otherwise mute the
  tab).
- A tab the extension opened itself is closed afterwards.
- Only what plays in your own tab is recorded; the stream itself is never downloaded or saved, and clips go only to
  `127.0.0.1:27631`.

</details>

### Send the whole season *(experimental, Netflix)*

Netflix only delivers an episode's subtitle file when that episode's page plays. So this walks the same tab through each
episode of the season (muted, about 20–30 seconds each, roughly 10 minutes for 24 episodes), lets the player load the
subtitles in the language you chose, posts each one, then returns to your episode. Switch subtitles on once for the
show so Netflix remembers the language. Progress and Stop are in the popup; an episode without that language is
reported and skipped. Not yet tried against a live account.

### YouTube

On a watch page the popup offers **Send this video to Surasura**, and on a playlist (or a watch page inside one) **Send
the whole playlist**. Only the link goes to `POST /v1/youtube`; nothing is recorded or downloaded here. If Surasura
answers 409, its words are shown. The `youtube.com` host permission is used only to read the tab's address for that
popup.

<details>
<summary>Season, episode and cover: where they come from</summary>

- **Season / episode** are read as numbers from Netflix's own player metadata (`videoMetadata`), not from page text.
  The popup shows what was detected and you can still edit it. A film sends no `show`. On Disney+ no player data source
  is known yet, so its numbers still come from the visible title text.
- **Cover:** the title's own artwork from the same metadata (boxart), fetched by the page, at most 400 KB, sent with
  the first episode. If the player data has none, no cover is sent (the page's generic site image is never used).

</details>

<details>
<summary>The capture probe (by hand)</summary>

The popup has **Run capture probe**: it records 5 s of the tab's audio and takes one picture of the video while it
plays, shows both in the popup, and says whether each picture is black and whether the audio was silent. Nothing is
saved or sent. It only tells you whether mining can work on your machine. Start the video first, then click it.

</details>

## 🔒 What it does and does not do

- Reads only the subtitle text the page already receives (TTML/IMSC, WebVTT, HLS subtitle segments) by watching the
  page's own responses. The one thing it asks Netflix for itself is the title's cover image (once, from the player's
  own artwork link); nothing else is ever requested from Netflix/Disney+.
- Never downloads, saves or decrypts the stream. Nothing to do with DRM. Audio/picture are recorded only in the mining
  batch above (your own tab, one short clip per line) and the hand-run probe.
- Sends only to `http://127.0.0.1:27631` (your Surasura). Permissions: Netflix and Disney+ pages, YouTube pages (the tab's address
  only), that loopback address, storage, alarms, `activeTab` and `tabCapture` (probe and mining) and `offscreen` (keeps
  the recorder alive when the popup closes).

## ⚠️ Known limits

- Text-based subtitles only; image-based subtitle tracks cannot be read.
- Cue times of Disney+ segments are stored as written in the files (`X-TIMESTAMP-MAP` offsets are logged, not applied).
- On Disney+, season and episode come from the visible title text (no player data source is known yet).
- *Send the whole season* has not yet been tried against a live account, nor have Disney+ clips (its player control
  is written from public knowledge).
- With hardware acceleration on, clips can come out black; those lines are reported as failed, not sent.

<details>
<summary>🛠️ Development</summary>

Version 0.2. Plain JavaScript, Manifest V3, no build step. The wire format between Ukai and Surasura is in
[CONTRACT.md](CONTRACT.md).

```
node --test test/                 # parser, delivery and hook tests (fixtures are hand-written, no real show content)
python tools/mock_surasura.py     # mock receiver per CONTRACT.md (--token, --port, --busy)
node tools/e2e_send.js            # simulated popup: fixture -> payload -> mock receiver
```

**Try mining without Surasura:** `python tools/mock_surasura.py --job-url https://www.netflix.com/watch/<id>` (lines via
`--job-lines 60-63,120-124`); clips land in the system temp folder, in `mock_surasura_clips`.

Console messages start with `[surasura]` (the page console for the content script; `chrome://extensions` → *service
worker* for sending).

**Layout:** `src/hook.js` (page side, listens to responses), `src/parsers.js`, `src/sites/netflix.js` and
`src/sites/disneyplus.js` (one small adapter each), `src/content.js`, `src/delivery.js` (HTTP + retry queue),
`src/background.js`, `src/walk.js` (mining state machine), `src/bridge.js` + `src/sites/*_page.js` (page-world player
control), `offscreen/` (recorder), `popup/`, `options/`.

</details>

## 📜 Licence and scope

GPL-3.0-or-later; see [LICENSE](LICENSE).

This is a personal study tool and is not affiliated with Netflix, Disney or Surasura's authors. It reads the
subtitle text the player has already loaded and, for mining, records short clips of what plays in your own tab
through the capture you grant in the browser. It downloads no video, removes no protection and talks only to
Surasura on your own computer (`127.0.0.1`). Whether this fits a service's terms of use is for you to check.
