package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func newSite(t *testing.T) http.Handler {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"index.html":                    "<html>home</html>",
		"app/digest.html":               "<html>digest</html>",
		"app/digest.js":                 "export {}",
		"app/sub/deep.js":               "x",
		"vendor/ort/a.wasm":             "\x00asm",
		"vendor/ort/a.mjs":              "export {}",
		"icons/icon.svg":                "<svg/>",
		"manifest.json":                 "{}",
		"sw.js":                         "//",
		"seed-corpus.json":              "[]",
		"config.json":                   "{}",
		".env":                          "SECRET=1",
		"db.py":                         "x",
		"Caddyfile":                     "x",
		"secret.html.bak":               "x",
		"notes/private.html":            "<html>private-but-html</html>",
		"app/node_modules/pkg/index.js": "x",
	}
	for name, body := range files {
		p := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return newHandler(root)
}

func get(h http.Handler, method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestServesAllowlistedPaths(t *testing.T) {
	h := newSite(t)
	for _, path := range []string{
		"/", "/index.html", "/app/digest.html", "/app/digest.js", "/app/sub/deep.js",
		"/vendor/ort/a.wasm", "/vendor/ort/a.mjs", "/icons/icon.svg",
		"/manifest.json", "/sw.js", "/seed-corpus.json",
	} {
		if got := get(h, "GET", path).Code; got != 200 {
			t.Errorf("%s: got %d, want 200", path, got)
		}
	}
}

func TestRootServesIndexContent(t *testing.T) {
	if body := get(newSite(t), "GET", "/").Body.String(); body != "<html>home</html>" {
		t.Errorf("got %q", body)
	}
}

func TestHidesEverythingElse(t *testing.T) {
	h := newSite(t)
	for _, path := range []string{
		"/config.json", "/.env", "/db.py", "/Caddyfile", "/secret.html.bak",
		"/nope", "/notes/private.html", "/app", "/app/", "/vendor/", "/icons/", "/app/missing.js",
	} {
		if got := get(h, "GET", path).Code; got != 404 {
			t.Errorf("%s: got %d, want 404", path, got)
		}
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	h := newSite(t)
	for _, path := range []string{
		"/app/../config.json", "/app/%2e%2e/config.json", "/vendor/../.env",
		"/app/..%2f..%2fconfig.json", "/icons/%2e%2e/%2e%2e/etc/passwd",
	} {
		if got := get(h, "GET", path).Code; got == 200 {
			t.Errorf("%s: served (200)", path)
		}
	}
}

func TestOnlyGetAndHead(t *testing.T) {
	h := newSite(t)
	if got := get(h, "HEAD", "/").Code; got != 200 {
		t.Errorf("HEAD: got %d", got)
	}
	for _, m := range []string{"POST", "PUT", "DELETE", "PATCH"} {
		if got := get(h, m, "/").Code; got != 405 {
			t.Errorf("%s: got %d, want 405", m, got)
		}
	}
}

func TestCrossOriginIsolationHeadersOnEveryResponse(t *testing.T) {
	h := newSite(t)
	for _, path := range []string{"/", "/missing", "/config.json"} {
		rec := get(h, "GET", path)
		if rec.Header().Get("Cross-Origin-Opener-Policy") != "same-origin" {
			t.Errorf("%s: COOP missing", path)
		}
		if rec.Header().Get("Cross-Origin-Embedder-Policy") != "require-corp" {
			t.Errorf("%s: COEP missing", path)
		}
	}
}

func TestSetsNosniff(t *testing.T) {
	if get(newSite(t), "GET", "/").Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("nosniff missing")
	}
}

func TestCachePolicy(t *testing.T) {
	h := newSite(t)
	cases := map[string]string{
		"/":                  "no-cache, must-revalidate",
		"/app/digest.html":   "no-cache, must-revalidate",
		"/sw.js":             "no-cache",
		"/manifest.json":     "no-cache, must-revalidate",
		"/seed-corpus.json":  "no-cache, must-revalidate",
		"/vendor/ort/a.wasm": "public, max-age=2592000, immutable",
		"/icons/icon.svg":    "public, max-age=2592000",
	}
	for path, want := range cases {
		if got := get(h, "GET", path).Header().Get("Cache-Control"); got != want {
			t.Errorf("%s: Cache-Control %q, want %q", path, got, want)
		}
	}
}

func TestContentTypes(t *testing.T) {
	h := newSite(t)
	cases := map[string]string{
		"/vendor/ort/a.wasm": "application/wasm",
		"/vendor/ort/a.mjs":  "text/javascript; charset=utf-8",
		"/app/digest.js":     "text/javascript; charset=utf-8",
		"/manifest.json":     "application/json",
		"/icons/icon.svg":    "image/svg+xml",
		"/":                  "text/html; charset=utf-8",
	}
	for path, want := range cases {
		if got := get(h, "GET", path).Header().Get("Content-Type"); got != want {
			t.Errorf("%s: Content-Type %q, want %q", path, got, want)
		}
	}
}
