# Surasura browser extension ⇄ Surasura: the local contract (v1, draft)

Both sides build against this file. Change it only together (say so in your report).

Surasura listens on loopback only: `http://127.0.0.1:27631`. Nothing else is ever contacted.

## GET /v1/hello
→ `200 {"app": "surasura", "version": "<x.y.z>", "contract": 1, "languages": ["ja", "zh"]}`

## Pairing (replaces copying a token)
`POST /v1/pair` (body `{"version": "<manifest version>"}`, no token) → `{"pair": "<id>", "code": "<4 digits>", "wait_s": 600}`;
Surasura's window asks *Allow Ukai to send to Surasura?* and shows the same code. The extension shows the code and
looks at `GET /v1/pair/<id>` about every second: `{"state": "waiting"}` · `{"state": "denied"}` (once) ·
`{"state": "allowed", "token": "<token>"}` (once; the extension keeps it as `X-Surasura-Token`) · `404` gone/expired ·
`409` Surasura is asking about another extension · `403`. A new Allow replaces the pairing: the old token gets `401`,
and the extension then offers Connect again.

## POST /v1/online-subtitle
Header: `X-Surasura-Token: <token>` (from the pairing above).
Body (JSON, UTF-8):
```json
{
  "schema": 1,
  "site": "netflix" | "disneyplus",
  "video_id": "81234567",
  "url": "https://www.netflix.com/watch/81234567",
  "language": "ja",
  "title": "Episode title, or the film's title",
  "show": {"title": "Show name", "season": 1, "episode": 3},
  "cues": [[12.34, 15.02, "text of the cue"], ...]
}
```
`show` is omitted for a film. `cues` are [start seconds, end seconds, text], in order, plain text (no markup).

Responses:
- `200 {"ok": true, "added": true|false, "item": <id>}` — `added: false`: already in the library (same site + video_id).
- `401` wrong or missing token · `400 {"ok": false, "why": "..."}` bad body · `503` Surasura busy: try again later.

The extension keeps a subtitle it couldn't deliver and tries again when Surasura answers `hello`.

## Out of scope for v1
No video or audio is ever downloaded or sent. Mining (recording clips while a line plays) is a later version.

---

# v2: mining after the fact (draft)

Connect queues an episode's job as usual. For a `netflix` / `disneyplus` item it picks its words, then waits for the
extension to record each picked line in the browser. Surasura then gives each clip to Anki Miner as it gives any
video (one short video per line), so the cards are the same as all others. No video is downloaded: only what plays
in the user's own tab is recorded, one short clip per line.

All calls carry `X-Surasura-Token`, as v1. `hello` answers `"contract": 2` once these exist.

## GET /v1/jobs
→ `200 {"jobs": [{"job": 412, "site": "netflix", "video_id": "81234567", "url": "https://www.netflix.com/watch/81234567",
   "title": "Show S01E03", "pad_before": 1.0, "pad_after": 1.0,
   "lines": [{"n": 0, "start": 705.29, "end": 708.84}, {"n": 1, "start": 912.0, "end": 915.5}]}]}`
Only jobs waiting for clips, oldest first. Times are seconds in the video, as the subtitle sent in v1 had them.
`lines` holds only the lines still missing a clip.

## POST /v1/jobs/<job>/clips/<n>
Body: the clip's bytes, `Content-Type: video/webm` (video + audio, as `MediaRecorder` writes it). At most 40 MB.
Headers: `X-Clip-Start: <seconds>` — the video time at the clip's first frame (so `start - pad_before`, as actually
recorded), `X-Clip-End: <seconds>`.
→ `200 {"ok": true}` · `404` no such job or line (dropped meanwhile: skip it) · `413` too large · `401` · `503` busy.

## POST /v1/jobs/<job>/done
Body: `{"failed": [{"n": 1, "why": "seek failed"}], "rev": 2}` (`failed` empty when every line was recorded).
→ `200 {"ok": true}`. Surasura makes the cards from the clips it has; a failed line is said plainly on the job.
`rev` (optional): the job's `rev` as `GET /v1/jobs` listed it. Surasura may add lines to a waiting job (a new pick);
each addition raises `rev`. A `done` whose `rev` is older closes only the lines it knew: the job stays listed with the
new lines. Without `rev` Surasura closes the job only once every line has a clip or is in `failed`.

`GET /v1/jobs` lists each job's `"rev": <int>` beside its `lines`.

## Optional in v1's POST /v1/online-subtitle
`"cover": "<base64 JPEG or PNG, at most 400 KB>"` — the show's artwork as the page shows it. Surasura may ignore it.

---

# v3 additions (draft)

## POST /v1/youtube
YouTube needs no recording: Surasura's own transcript downloader takes links. The extension only hands them over.
Body: `{"schema": 1, "urls": ["https://www.youtube.com/watch?v=…", "https://www.youtube.com/playlist?list=…"]}`
(1 to 50 links; a video, a list or a playlist, exactly what the downloader's own window takes).
→ `200 {"ok": true, "queued": <n>}` — the downloader runs them as if pasted in its window; the transcripts arrive in
the library as usual · `409 {"ok": false, "why": "..."}` when the downloader is off or its risk tick isn't given
(the words say which) · `400` bad links · `401` · `503` busy.

## The cover (v1's optional `cover`)
Surasura stores it as the title's cover when the title has none of its own. The extension sends it with the first
episode of a title it posts (and may send it with each).

## A whole season
No new call: the extension posts each episode with `POST /v1/online-subtitle`, one after another, slowest first
(`503` → wait and retry). `show.season` and `show.episode` are numbers read from the player's own data.
