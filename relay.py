"""relay.py — stateless CORS relay for the client-side PWA.

No database, no auth, no state: forwards an allowlisted query to arXiv,
Semantic Scholar, or OpenReview and echoes the response back with a CORS
header. This exists because a browser enforces CORS on every fetch —
including from an installed PWA or a service worker — and none of the three
source APIs send an Access-Control-Allow-Origin header themselves (confirmed
by direct testing, not assumed). Everything else the app needs (interests,
saved papers, scoring, summarization) lives client-side; this is only here
because CORS makes it unavoidable.
"""
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ALLOWED_ORIGIN = os.environ.get("RELAY_ALLOWED_ORIGIN", "https://research.wwel.sh")
USER_AGENT = "ResearchDigestRelay/1.0 (github.com/usr-wwelsh)"
PORT = int(os.environ.get("RELAY_PORT", "8081"))
UPSTREAM_TIMEOUT = 15
MAX_STRING_PARAM_LEN = 500


@dataclass(frozen=True)
class StrParam:
    pass


@dataclass(frozen=True)
class IntParam:
    default: int
    min: int
    max: int


# Only these param names are ever forwarded upstream, per source — an
# allowlist at the trust boundary, not a blocklist. Anything else in the
# client's query string is silently dropped.
SOURCES = {
    "arxiv": {
        "upstream": "https://export.arxiv.org/api/query",
        "params": {
            "search_query": StrParam(),
            "start": IntParam(default=0, min=0, max=10_000),
            "max_results": IntParam(default=20, min=1, max=100),
            "sortBy": StrParam(),
            "sortOrder": StrParam(),
        },
    },
    "semanticscholar": {
        "upstream": "https://api.semanticscholar.org/graph/v1/paper/search",
        "params": {
            "query": StrParam(),
            "limit": IntParam(default=20, min=1, max=50),
            "fields": StrParam(),
        },
    },
    "openreview": {
        "upstream": "https://api2.openreview.net/notes/search",
        "params": {
            "term": StrParam(),
            "limit": IntParam(default=20, min=1, max=50),
        },
    },
}


def build_query(source, raw_params):
    """Allowlist + clamp a client's raw query params for one source.

    Unknown param names are dropped. Known string params are forwarded
    verbatim (truncated defensively). Known int params are clamped into
    [min, max], falling back to their default if missing or unparseable.
    """
    spec = SOURCES[source]["params"]
    out = {}
    for name, kind in spec.items():
        if isinstance(kind, StrParam):
            if name in raw_params:
                out[name] = raw_params[name][:MAX_STRING_PARAM_LEN]
        elif isinstance(kind, IntParam):
            try:
                value = int(raw_params[name])
            except (KeyError, ValueError):
                value = kind.default
            out[name] = str(max(kind.min, min(kind.max, value)))
    return out


# --- rate limiting: protect the shared upstream quotas from being hammered
# now that this endpoint is internet-reachable, not just a weekly cron job ---

class TokenBucket:
    def __init__(self, rate_per_sec, capacity):
        self.rate = rate_per_sec
        self.capacity = capacity
        self.tokens = float(capacity)
        self.last = time.monotonic()
        self.lock = threading.Lock()

    def allow(self):
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
            self.last = now
            if self.tokens >= 1:
                self.tokens -= 1
                return True
            return False


def _make_buckets():
    return {name: TokenBucket(rate_per_sec=1.0, capacity=3) for name in SOURCES}


_BUCKETS = _make_buckets()


# --- the one real network boundary: swapped out in tests ---

def fetch_upstream(url):
    """GET url. Returns (body: bytes, status: int, content_type: str|None).

    An upstream non-2xx (429, 5xx, ...) is returned as a normal result, not
    raised — the caller passes that status straight through to the client.
    Only a genuine connection failure raises urllib.error.URLError.
    """
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
            return resp.read(), resp.status, resp.headers.get("Content-Type")
    except urllib.error.HTTPError as e:
        body = e.read()
        content_type = e.headers.get("Content-Type") if e.headers else None
        return body, e.code, content_type


class RelayHandler(BaseHTTPRequestHandler):
    server_version = "ResearchDigestRelay/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) != 2 or parts[0] != "relay" or parts[1] not in SOURCES:
            self._send_json(404, {"error": "not found"})
            return
        source = parts[1]

        if not _BUCKETS[source].allow():
            self._send_json(429, {"error": "rate limited, try again shortly"},
                             extra_headers={"Retry-After": "1"})
            return

        raw_params = dict(urllib.parse.parse_qsl(parsed.query))
        query = build_query(source, raw_params)
        upstream_url = SOURCES[source]["upstream"] + "?" + urllib.parse.urlencode(query)

        try:
            body, status, content_type = fetch_upstream(upstream_url)
        except urllib.error.URLError:
            self._send_json(502, {"error": "upstream unreachable"})
            return

        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self):
        # Scoped to the real origin (least privilege), not "*".
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Vary", "Origin")

    def _send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)


def run(port=None):
    port = PORT if port is None else port
    httpd = ThreadingHTTPServer(("127.0.0.1", port), RelayHandler)
    print(f"relay listening on 127.0.0.1:{port} (allowed origin: {ALLOWED_ORIGIN})")
    httpd.serve_forever()


if __name__ == "__main__":
    run()
