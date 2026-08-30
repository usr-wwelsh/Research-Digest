"""relay.py — stateless CORS relay. The only real network boundary is the
upstream HTTP call (fetch_upstream); everything else runs unmocked against
a real server on a loopback port."""
import threading
import urllib.error
import urllib.request

import pytest

import relay


# --- build_query(): pure allowlist/clamping logic, no network/server needed ---

def test_build_query_forwards_known_string_param():
    q = relay.build_query("arxiv", {"search_query": "cat:cs.LG"})
    assert q["search_query"] == "cat:cs.LG"


def test_build_query_drops_unknown_params():
    q = relay.build_query("arxiv", {"search_query": "x", "evil": "rm -rf /"})
    assert "evil" not in q
    assert q["search_query"] == "x"


def test_build_query_omits_missing_optional_params():
    q = relay.build_query("semanticscholar", {"query": "edge ai"})
    assert q == {"query": "edge ai", "limit": "20"}  # default filled in


def test_build_query_clamps_int_param_above_max():
    q = relay.build_query("semanticscholar", {"query": "x", "limit": "99999"})
    assert q["limit"] == "50"


def test_build_query_clamps_int_param_below_min():
    q = relay.build_query("arxiv", {"search_query": "x", "start": "-5"})
    assert q["start"] == "0"


def test_build_query_falls_back_to_default_on_unparseable_int():
    q = relay.build_query("openreview", {"term": "x", "limit": "not-a-number"})
    assert q["limit"] == "20"


def test_build_query_truncates_absurdly_long_string_param():
    q = relay.build_query("arxiv", {"search_query": "a" * 10_000})
    assert len(q["search_query"]) <= 500


def test_build_query_unknown_source_raises():
    with pytest.raises(KeyError):
        relay.build_query("not-a-real-source", {})


# --- HTTP-level behavior, real server on a loopback port ---

@pytest.fixture
def server():
    httpd = relay.ThreadingHTTPServer(("127.0.0.1", 0), relay.RelayHandler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield port
    finally:
        httpd.shutdown()
        thread.join()


@pytest.fixture(autouse=True)
def fresh_rate_limit_buckets(monkeypatch):
    # Isolate each test from rate-limit state left by prior tests.
    monkeypatch.setattr(relay, "_BUCKETS", relay._make_buckets())


def http_get(port, path):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def test_unknown_route_is_404(server):
    status, _, _ = http_get(server, "/relay/not-a-source?query=x")
    assert status == 404


def test_non_relay_path_is_404(server):
    status, _, _ = http_get(server, "/anything")
    assert status == 404


def test_successful_relay_passes_through_body_and_adds_cors_header(server, monkeypatch):
    monkeypatch.setattr(relay, "fetch_upstream", lambda url: (b'{"ok":true}', 200, "application/json"))
    status, headers, body = http_get(server, "/relay/semanticscholar?query=edge")
    assert status == 200
    assert body == b'{"ok":true}'
    assert headers["Access-Control-Allow-Origin"] == relay.ALLOWED_ORIGIN


def test_upstream_error_status_is_passed_through(server, monkeypatch):
    monkeypatch.setattr(relay, "fetch_upstream", lambda url: (b'{"error":"rate limited"}', 429, "application/json"))
    status, headers, body = http_get(server, "/relay/semanticscholar?query=edge")
    assert status == 429
    assert headers["Access-Control-Allow-Origin"] == relay.ALLOWED_ORIGIN


def test_upstream_connection_failure_returns_502(server, monkeypatch):
    def boom(url):
        raise urllib.error.URLError("connection refused")
    monkeypatch.setattr(relay, "fetch_upstream", boom)
    status, _, _ = http_get(server, "/relay/arxiv?search_query=x")
    assert status == 502


def test_rate_limit_returns_429_once_bucket_is_exhausted(server, monkeypatch):
    monkeypatch.setattr(relay, "fetch_upstream", lambda url: (b"{}", 200, "application/json"))
    monkeypatch.setattr(relay, "_BUCKETS", {
        name: relay.TokenBucket(rate_per_sec=0.0, capacity=1) for name in relay.SOURCES
    })
    first_status, _, _ = http_get(server, "/relay/arxiv?search_query=x")
    second_status, _, _ = http_get(server, "/relay/arxiv?search_query=x")
    assert first_status == 200
    assert second_status == 429


def test_response_never_forwards_upstream_to_client_as_cacheable(server, monkeypatch):
    monkeypatch.setattr(relay, "fetch_upstream", lambda url: (b"{}", 200, "application/json"))
    _, headers, _ = http_get(server, "/relay/openreview?term=x")
    assert headers.get("Cache-Control") == "no-store"
