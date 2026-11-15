#!/usr/bin/env python3
"""Mock of Surasura's local receiver (CONTRACT.md v1). Standard library only.

    python tools/mock_surasura.py [--token test-token] [--port 27631] [--busy]

Subtitles are kept in memory and printed; --busy answers 503 to every POST.
"""
import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

LIBRARY = {}  # (site, video_id) -> payload


class Handler(BaseHTTPRequestHandler):
    token = "test-token"
    busy = False

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/v1/hello":
            self._send(200, {"app": "surasura", "version": "0.0.0-mock", "contract": 1, "languages": ["ja", "zh"]})
        else:
            self._send(404, {"ok": False, "why": "not found"})

    def do_POST(self):
        if self.path != "/v1/online-subtitle":
            return self._send(404, {"ok": False, "why": "not found"})
        if self.headers.get("X-Surasura-Token") != self.token:
            return self._send(401, {"ok": False})
        if self.busy:
            return self._send(503, {"ok": False})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            p = json.loads(self.rfile.read(n).decode("utf-8"))
            assert p["schema"] == 1, "schema must be 1"
            assert p["site"] in ("netflix", "disneyplus"), "bad site"
            assert p["video_id"] and p["language"] and p["title"], "video_id, language and title are required"
            cues = p["cues"]
            assert isinstance(cues, list) and cues, "cues must be a non-empty list"
            for c in cues:
                assert len(c) == 3 and isinstance(c[0], (int, float)) and isinstance(c[1], (int, float)) and isinstance(c[2], str), "bad cue"
        except Exception as e:  # noqa: BLE001 - any bad body is a 400
            return self._send(400, {"ok": False, "why": str(e) or "bad body"})
        key = (p["site"], p["video_id"])
        added = key not in LIBRARY
        LIBRARY.setdefault(key, p)
        item = len(LIBRARY) if added else list(LIBRARY).index(key) + 1
        show = p.get("show")
        print(f"[mock] {'ADDED' if added else 'exists'} {p['site']}/{p['video_id']} lang={p['language']} "
              f"title={p['title']!r} show={show} cues={len(cues)}", flush=True)
        self._send(200, {"ok": True, "added": added, "item": item})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", default="test-token")
    ap.add_argument("--port", type=int, default=27631)
    ap.add_argument("--busy", action="store_true")
    a = ap.parse_args()
    Handler.token, Handler.busy = a.token, a.busy
    print(f"[mock] listening on 127.0.0.1:{a.port}, token={a.token!r}", flush=True)
    HTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
