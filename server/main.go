package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

var exactPaths = map[string]string{
	"/index.html":       "no-cache, must-revalidate",
	"/manifest.json":    "no-cache, must-revalidate",
	"/seed-corpus.json": "no-cache, must-revalidate",
	"/sw.js":            "no-cache",
}

var prefixes = []struct{ prefix, cache string }{
	{"/app/", ""},
	{"/vendor/", "public, max-age=2592000, immutable"},
	{"/icons/", "public, max-age=2592000"},
}

func cachePolicy(path string) (string, bool) {
	if c, ok := exactPaths[path]; ok {
		return c, true
	}
	for _, p := range prefixes {
		if strings.HasPrefix(path, p.prefix) {
			if p.cache == "" && strings.HasSuffix(path, ".html") {
				return "no-cache, must-revalidate", true
			}
			return p.cache, true
		}
	}
	return "", false
}

func newHandler(root string) http.Handler {
	dir := http.Dir(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Embedder-Policy", "require-corp")
		h.Set("X-Content-Type-Options", "nosniff")

		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			h.Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		cache, ok := cachePolicy(path)
		if !ok || strings.Contains(path, "..") {
			http.NotFound(w, r)
			return
		}

		f, err := dir.Open(path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}

		if cache != "" {
			h.Set("Cache-Control", cache)
		}
		http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	})
}

func main() {
	root := os.Getenv("ROOT")
	if root == "" {
		root = "/srv"
	}
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           newHandler(root),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	log.Fatal(srv.ListenAndServe())
}
