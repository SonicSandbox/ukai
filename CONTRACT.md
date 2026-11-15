# Surasura browser extension ⇄ Surasura: the local contract (v1, draft)

Both sides build against this file. Change it only together (say so in your report).

Surasura listens on loopback only: `http://127.0.0.1:27631`. Nothing else is ever contacted.

## GET /v1/hello
→ `200 {"app": "surasura", "version": "<x.y.z>", "contract": 1, "languages": ["ja", "zh"]}`

## POST /v1/online-subtitle
Header: `X-Surasura-Token: <token>` (the user copies it once from Surasura into the extension's options).
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
