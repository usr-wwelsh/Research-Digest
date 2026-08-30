![Python](https://img.shields.io/badge/python-3.9+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![PWA](https://img.shields.io/badge/installable-PWA-6ba3ff.svg)
![Summaries](https://img.shields.io/badge/summaries-in--browser-ff6b6b.svg)
![Platform](https://img.shields.io/badge/platform-linux-lightgrey.svg)

![research-digest status](https://vitals.wwel.sh/badge/proxmox/research-digest/status.svg)
![research-digest uptime](https://vitals.wwel.sh/badge/proxmox/research-digest/uptime.svg)
![research-digest cpu](https://vitals.wwel.sh/badge/proxmox/research-digest/cpu.svg)
![research-digest ram](https://vitals.wwel.sh/badge/proxmox/research-digest/ram.svg)
![research-digest cpu trend](https://vitals.wwel.sh/badge/proxmox/research-digest/sparkline.svg?metric=cpu)
![research-digest ram trend](https://vitals.wwel.sh/badge/proxmox/research-digest/sparkline.svg?metric=ram)

# Research Digest

An installable, offline-first research digest. Fetching, scoring, and summarization all run
**in your browser** — arXiv, Semantic Scholar, and OpenReview papers are summarized and tagged
by tiny BERT/BART-family models running entirely on your own device. No API keys, no cloud, no
account, nothing synced.

---

## Features

- **Installable PWA** — add it to your home screen/desktop; works offline after the first visit.
- **Client-side everything** — interests, saved papers, and the fetch/summarize/embed pipeline
  all run in your browser via IndexedDB and [transformers.js](https://huggingface.co/docs/transformers.js).
  Your data never leaves your device.
- **Three sources** — arXiv, Semantic Scholar, and OpenReview, deduped against each other and
  your existing corpus.
- **Live search** — search all three sources on demand, not just what's already been fetched.
- **Saves shape future fetches** — liking papers nudges what gets pulled in next time, via a
  small deterministic keyword-feedback loop (no ML, no black box).
- **Corpus-first** — everything you've fetched stays in IndexedDB; a failed/offline fetch never
  loses what you already have.

---

## How it works

Almost everything runs client-side. The server is intentionally as small as it can possibly
be — just enough to work around one hard constraint: browsers enforce CORS on every request,
and none of arXiv, Semantic Scholar, or OpenReview send the header that would let a browser
call them directly (confirmed by testing, not assumed).

| Piece | Where it runs | Does |
|-------|:---:|------|
| `relay.py` | Server (stdlib only) | Stateless CORS relay — forwards an allowlisted query to one of the three source APIs and adds the CORS header. No database, no auth, no state. |
| `app/sources/*.js` | Browser | Normalizes each source's response into a common paper shape. |
| `app/models.worker.js` | Browser (Web Worker) | Summarizes + embeds papers in-browser via `transformers.js`, so inference never blocks the UI. |
| `app/feedback.js` | Browser | Turns saved papers into extra scoring keywords for your *next* fetch — recency-decayed, gated behind a minimum-saves threshold so a couple of early saves can't overfit it. |
| `app/db.js` | Browser (IndexedDB) | Your corpus, interests, saves, and settings. Nothing here ever reaches the server. |
| `sw.js` | Browser (Service Worker) | Caches the app shell for offline use. Live data (`/relay/*`) is always network-only. |

The **server-side Python pipeline** (`fetch.py → summarize.py → embed.py → relate.py →
export_seed.py`) still exists, unchanged in method, but its job has shrunk: it runs on a
schedule (cron) purely to keep `seed-corpus.json` fresh, so a brand-new install isn't empty on
first open. Once installed, the PWA fetches and summarizes for itself and never needs that file
again.

---

## Quick Start (developing/reviewing locally)

```bash
git clone https://github.com/usr-wwelsh/research-digest.git
cd research-digest
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt

./run.sh            # fetch -> summarize -> embed -> relate -> export_seed
# or, no network:
./run.sh --offline  # rebuild seed-corpus.json from the existing corpus
```

The first `summarize`/`embed` run downloads ~650MB of model weights (cached under
`.hf_cache/` after that).

The client also needs the `transformers.js` runtime it ships with:

```bash
cd app
npm install
npm run build:vendor          # rebuilds app/vendor/transformers.min.js
cd .. && ./scripts/fetch_vendor_assets.sh   # one-time onnxruntime-web WASM download
```

**Serving it locally:** a plain static file server (`python -m http.server`, etc.) is *not*
enough — search and fetching go through `relay.py` at `/relay/*`, and only Caddy actually
proxies that path (see [How it works](#how-it-works)). Everything else will load fine under a
plain static server; only the Refresh/Search actions will fail with a 404. Run both pieces
locally instead, in two terminals from the repo root:

```bash
# terminal 1
RELAY_ALLOWED_ORIGIN=http://localhost:8080 ./venv/bin/python relay.py

# terminal 2
RESEARCH_DIGEST_ROOT="$(pwd)" caddy run --config Caddyfile --adapter caddyfile
```

Then open `http://localhost:8080` — the landing page links to the app itself
(`app/digest.html`). `RESEARCH_DIGEST_ROOT` overrides the Caddyfile's production default of
`/opt/research-digest`; the systemd services don't set it, so deployment is unaffected.

**Run the test suites:**

```bash
./venv/bin/pip install -r requirements-dev.txt && ./venv/bin/python -m pytest
cd app && npm test
```

**Migrating from the old static-site version?** Recover your old backlog from the archived
HTML with zero arXiv calls:

```bash
./venv/bin/python migrate_from_html.py   # parses arxiv_archive/*.html into digest.db
./run.sh --offline                       # summarize + embed + re-export the backlog
```

---

## Configuration

Two separate things are configured in two separate places, on purpose — they serve different
audiences:

- **`config.json`** — the *server-side seed pipeline's* interests (same shape as before: a
  query + keyword list per interest). This only controls what goes into `seed-corpus.json`,
  i.e. what a fresh install sees before it starts fetching for itself.
- **In-app Settings** (`app/settings.html`) — *your* interests, saved on your device. Seeded
  once from `config.json`'s 5 defaults on first run, then fully yours to edit — add/remove
  interests, change keywords, pick which of the three sources each one uses. Nothing here is
  sent to the server.

```json
{
  "interests": {
    "Efficient ML / Edge AI": {
      "query": "cat:cs.LG OR cat:cs.CV OR cat:cs.CL",
      "keywords": ["efficient", "edge", "quantization", "distillation"]
    }
  },
  "settings": {
    "papers_per_interest": 25,
    "recent_days": 7,
    "fetch_multiplier": 3
  },
  "local_ai": {
    "embedding_model": "distilbert-base-uncased"
  }
}
```

arXiv query syntax: combine category codes with `OR`/`AND`, e.g. `cat:cs.LG OR cat:cs.AI`
([full taxonomy](https://arxiv.org/category_taxonomy)).

---

## Self-hosted deployment (Proxmox LXC)

From your Proxmox host:

```bash
bash <(curl -sL https://raw.githubusercontent.com/usr-wwelsh/Research-Digest/main/create-lxc.sh)
```

This creates a Debian LXC, installs Caddy + cloudflared, sets up the venv, pre-downloads the
model weights, starts **two** services behind Caddy — the static file server and `relay.py`
(bound to `127.0.0.1:8081`, reverse-proxied at `/relay/*`) — and configures the weekly seed
cron (Monday 8am). After it finishes, edit `config.json` and run
`sudo -u www-data /opt/research-digest/run.sh`.

Idle footprint is small — Caddy + cloudflared + the always-on `relay.py` process (a few MB,
stdlib only). The Python/torch pipeline only runs during the weekly cron job; budget headroom
for that run same as before (DistilBERT — the only model, summarization is extractive and
needs no separate model — needs well under 1GB of RAM while it's executing).

---

## Project structure

```
research-digest/
├── config.json           # seed-pipeline interests (see Configuration)
├── db.py                 # SQLite schema + data access — unchanged, still the seed corpus's source of truth
├── fetch.py               # arXiv ingest for the seed corpus (backoff, upsert, --backfill)
├── summarize.py            # extractive summaries + heuristics, for the seed corpus
├── extractive.py               # centroid-based extractive summarization (shared algorithm)
├── embed.py                # DistilBERT embeddings, for the seed corpus
├── relate.py                # nearest-neighbour "related papers", for the seed corpus
├── export_seed.py            # writes seed-corpus.json (atomic, refuses empty)
├── local_ai.py                # local model client used by the seed pipeline
├── relay.py                    # stateless CORS relay (stdlib only) — the only always-on server piece
├── migrate_from_html.py        # one-time v1 backlog salvage
├── run.sh                      # seed pipeline runner (cron entrypoint)
├── setup.sh / create-lxc.sh    # LXC bootstrap (installs Caddy + relay.py as systemd services)
├── Caddyfile                   # static file server + /relay/* reverse proxy
├── research-digest-*.service   # systemd units (Caddy, relay)
├── scripts/fetch_vendor_assets.sh  # one-time onnxruntime-web WASM download
├── manifest.json / sw.js        # PWA manifest + service worker
├── icons/                        # app icons (flat mono book glyph)
├── index.html                    # static landing page ("install this PWA")
├── app/                           # the actual PWA — plain ES modules, no bundler
│   ├── digest.html / search.html / saved.html / settings.html
│   ├── db.js                      # IndexedDB wrapper (papers/interests/saved/settings)
│   ├── sources/                   # arXiv/Semantic Scholar/OpenReview adapters (via relay.py)
│   ├── models.worker.js            # in-browser summarize/embed (transformers.js, off the UI thread)
│   ├── feedback.js                 # save -> future-fetch keyword feedback loop
│   ├── fetch-orchestrator.js        # wires sources + scoring + dedup + feedback + IndexedDB together
│   └── vendor/transformers.min.js    # self-hosted, esbuild-bundled transformers.js
└── digest.db                      # the seed corpus (gitignored)
```

---

## Requirements

- **Server**: Python 3.9+ · deps: `requests`, `numpy`, `torch` (CPU), `transformers` — internet
  only for the weekly seed-pipeline fetch and the one-time model download. `relay.py` itself
  needs nothing beyond the stdlib.
- **Client**: any evergreen browser (Service Workers, IndexedDB, Web Workers, WebAssembly).
  Nothing to install — it's a website until you choose to install it.
- **Dev-only**: Node.js, to rebuild `app/vendor/transformers.min.js` when the library updates
  (`app/package.json`'s `build:vendor` script) and to run the client-side test suite.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Acknowledgments

- [arXiv](https://arxiv.org/), [Semantic Scholar](https://www.semanticscholar.org/), and
  [OpenReview](https://openreview.net/) for the open research APIs
- Hugging Face `transformers` / `transformers.js`, and the DistilBERT model authors,
  for local inference — server-side and now in-browser
