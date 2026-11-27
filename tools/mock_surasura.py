#!/usr/bin/env python3
"""Mock of Surasura's local receiver (CONTRACT.md v1 + v2 jobs). Standard library only.

    python tools/mock_surasura.py [--token test-token] [--port 27631] [--busy]

Subtitles are kept in memory and printed; --busy answers 503. --job-url makes a v2 job; clips go to %TEMP%/mock_surasura_clips.
"""
import argparse
import json
import os
import re
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

LIBRARY = {}  # (site, video_id) -> payload
JOBS = {}  # job id -> {"job": {...}, "missing": set(n), "done": bool}
CLIP_DIR = os.path.join(tempfile.gettempdir(), "mock_surasura_clips")
MAX_CLIP = 40 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    token = "test-token"
    busy = False
    youtube_off = False

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    pair_looks = 0
    PAIR_LOOKS = 4

    def do_GET(self):
        if self.path.startswith("/v1/pair/"):
            if self.path != "/v1/pair/mockmockmockmockmock12":
                return self._send(404, {"ok": False, "kind": "gone"})
            Handler.pair_looks += 1
            if Handler.pair_looks < self.PAIR_LOOKS:
                return self._send(200, {"state": "waiting"})
            return self._send(200, {"state": "allowed", "token": self.token})
        if self.path == "/v1/jobs":
            if self.headers.get("X-Surasura-Token") != self.token:
                return self._send(401, {"ok": False})
            if self.busy:
                return self._send(503, {"ok": False})
            jobs = []
            for j in JOBS.values():
                if j["done"]:
                    continue
                jobs.append(dict(j["job"], lines=[l for l in j["job"]["lines"] if l["n"] in j["missing"]]))
            return self._send(200, {"jobs": jobs})
        if self.path == "/v1/hello":
            self._send(200, {"app": "surasura", "version": "0.0.0-mock", "contract": 2, "languages": ["ja", "zh"]})
        else:
            self._send(404, {"ok": False, "why": "not found"})

    def _job_post(self):
        m = re.fullmatch(r"/v1/jobs/(\d+)/(clips/(\d+)|done)", self.path)
        if not m:
            return self._send(404, {"ok": False, "why": "not found"})
        if self.headers.get("X-Surasura-Token") != self.token:
            return self._send(401, {"ok": False})
        if self.busy:
            return self._send(503, {"ok": False})
        job = JOBS.get(int(m.group(1)))
        n = int(self.headers.get("Content-Length", "0"))
        if job is None or job["done"]:
            self.rfile.read(n)
            return self._send(404, {"ok": False, "why": "no such job"})
        if m.group(3) is not None:
            line = int(m.group(3))
            if n > MAX_CLIP:
                return self._send(413, {"ok": False})
            body = self.rfile.read(n)
            if line not in job["missing"]:
                return self._send(404, {"ok": False, "why": "no such line"})
            os.makedirs(CLIP_DIR, exist_ok=True)
            path = os.path.join(CLIP_DIR, f"job{job['job']['job']}_line{line}.webm")
            with open(path, "wb") as f:
                f.write(body)
            job["missing"].discard(line)
            job.setdefault("meta", {})[line] = (self.headers.get("X-Clip-Start"), self.headers.get("X-Clip-End"))
            print(f"[mock] clip job={job['job']['job']} line={line} {len(body)} bytes start={self.headers.get('X-Clip-Start')} "
                  f"end={self.headers.get('X-Clip-End')} type={self.headers.get('Content-Type')} -> {path}", flush=True)
            return self._send(200, {"ok": True})
        try:
            failed = json.loads(self.rfile.read(n).decode("utf-8"))["failed"]
        except Exception as e:  # noqa: BLE001
            return self._send(400, {"ok": False, "why": str(e)})
        job["done"] = True
        print(f"[mock] done job={job['job']['job']} failed={failed}", flush=True)
        self._send(200, {"ok": True})

    def _youtube(self):
        n = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(n)
        if self.headers.get("X-Surasura-Token") != self.token:
            return self._send(401, {"ok": False})
        if self.busy:
            return self._send(503, {"ok": False})
        if self.youtube_off:
            return self._send(409, {"ok": False, "why": "The transcript downloader is off. Turn it on in Surasura and tick the risk box."})
        try:
            urls = json.loads(raw.decode("utf-8"))["urls"]
            assert isinstance(urls, list) and 1 <= len(urls) <= 50, "1 to 50 links"
            for u in urls:
                assert re.match(r"https://(www\.)?youtube\.com/(watch\?v=|playlist\?list=)[\w-]+$", u), "bad link: " + str(u)
        except Exception as e:  # noqa: BLE001
            return self._send(400, {"ok": False, "why": str(e)})
        print(f"[mock] youtube {urls}", flush=True)
        self._send(200, {"ok": True, "queued": len(urls)})

    def do_POST(self):
        if self.path == "/v1/pair":  # mimics Surasura's pairing: the "Allow" comes after PAIR_LOOKS looks
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            Handler.pair_looks = 0
            return self._send(200, {"pair": "mockmockmockmockmock12", "code": "4821", "wait_s": 600})
        if self.path == "/v1/youtube":
            return self._youtube()
        if self.path.startswith("/v1/jobs/"):
            return self._job_post()
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
    ap.add_argument("--youtube-off", action="store_true", help="answer 409 to /v1/youtube")
    ap.add_argument("--job-url", help="make a fixed v2 job for this watch URL, e.g. https://www.netflix.com/watch/81234567")
    ap.add_argument("--job-lines", default="60-63,120-124,300-303", help="start-end seconds, comma separated")
    a = ap.parse_args()
    if a.job_url:
        site = "disneyplus" if "disneyplus" in a.job_url else "netflix"
        vid = re.search(r"([0-9a-f]{8}-[0-9a-f-]{27}|\d+)(?:[?#].*)?$", a.job_url).group(1)
        lines = [{"n": i, "start": float(r.split("-")[0]), "end": float(r.split("-")[1])} for i, r in enumerate(a.job_lines.split(","))]
        JOBS[1] = {"job": {"job": 1, "site": site, "video_id": vid, "url": a.job_url, "title": "Mock episode",
                           "pad_before": 1.0, "pad_after": 1.0, "lines": lines},
                   "missing": {l["n"] for l in lines}, "done": False}
        print(f"[mock] job 1: {len(lines)} lines for {a.job_url}", flush=True)
    Handler.token, Handler.busy, Handler.youtube_off = a.token, a.busy, a.youtube_off
    print(f"[mock] listening on 127.0.0.1:{a.port}, token={a.token!r}", flush=True)
    HTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
