<img src="icons/icon-512.png" alt="Research Digest logo" width="96" />

[![Read about the commits](https://img.shields.io/badge/commits-code%20blog-1a1a1a?style=flat-square)](https://wwel.sh/digest.html?repo=research-digest)

[![research-digest status](https://vitals.wwel.sh/badge/proxmox/research-digest/status.svg)](https://github.com/usr-wwelsh/vitalSVG) [![research-digest cpu](https://vitals.wwel.sh/badge/proxmox/research-digest/cpu.svg)](https://github.com/usr-wwelsh/vitalSVG) [![research-digest ram](https://vitals.wwel.sh/badge/proxmox/research-digest/ram.svg)](https://github.com/usr-wwelsh/vitalSVG) [![research-digest uptime](https://vitals.wwel.sh/badge/proxmox/research-digest/uptime.svg)](https://github.com/usr-wwelsh/vitalSVG)
[![research-digest cpu trend](https://vitals.wwel.sh/badge/proxmox/research-digest/sparkline.svg?metric=cpu)](https://github.com/usr-wwelsh/vitalSVG) [![research-digest ram trend](https://vitals.wwel.sh/badge/proxmox/research-digest/sparkline.svg?metric=ram)](https://github.com/usr-wwelsh/vitalSVG)

# Research Digest

Offline-first arXiv digest. Fetching, scoring, and summarization run in your browser — papers are summarized extractively (key sentences selected, not generated) by a small DistilBERT model on your own device. No API keys, no cloud, no account.

## Features

- **Installable PWA** — works offline after the first visit.
- **Client-side everything** — corpus, interests, and saves live in IndexedDB; inference runs via [transformers.js](https://huggingface.co/docs/transformers.js).
- **Direct from your browser** — arXiv metadata via DataCite with an OpenAlex fallback (arXiv's own API sends no CORS header), deduped against your corpus.
- **Live search** — query arXiv on demand.
- **Saves shape future fetches** — a deterministic, recency-decayed keyword loop gated behind a minimum-saves threshold. No ML.
- **Seed corpus** — an optional server-side pipeline keeps `seed-corpus.json` fresh so a new install isn't empty.

## Run

Container (tiny Go file server on `scratch`, non-root), published on version tags:

```bash
docker run -d -p 8080:8080 ghcr.io/usr-wwelsh/research-digest:latest
```

Runs fine with `--read-only --cap-drop ALL` too. Optionally bind-mount a `seed-corpus.json` at `/srv/seed-corpus.json`.

## Develop

```bash
git clone https://github.com/usr-wwelsh/research-digest.git && cd research-digest
./scripts/fetch_vendor_assets.sh              # onnxruntime-web WASM
(cd app && npm ci && npm run build:vendor)    # app/vendor/transformers.min.js
(cd server && ROOT=.. go run .)               # http://localhost:8080
```

Tests:

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements-dev.txt
./venv/bin/python -m pytest
(cd app && npm test)
(cd server && go test ./...)
```

## Seed pipeline

`./run.sh` runs `fetch → summarize → embed → relate → export_seed` and writes `seed-corpus.json`. `./run.sh --offline` skips the fetch. Needs a venv: `python3 -m venv venv && ./venv/bin/pip install -r requirements.txt`. Run it from cron to keep the seed fresh. The first run downloads ~270MB (DistilBERT) of model weights to `.hf_cache/`.

## Configuration

- **`config.json`** — interests for the seed pipeline only (arXiv query + keywords per interest). Syntax: [category taxonomy](https://arxiv.org/category_taxonomy).
- **In-app Settings** — your interests, stored on-device. Seeded once from `config.json`, then yours to edit.

```json
{
  "interests": {
    "Efficient ML / Edge AI": {
      "query": "cat:cs.LG OR cat:cs.CV OR cat:cs.CL",
      "keywords": ["efficient", "edge", "quantization", "distillation"]
    }
  },
  "settings": { "papers_per_interest": 25, "recent_days": 7, "fetch_multiplier": 3 }
}
```

## Layout

```
app/        PWA: plain ES modules, no bundler (db, sources, models.worker, feedback, fetch-orchestrator)
server/     Go static file server used by the container
*.py        seed pipeline (fetch, summarize, embed, relate, export_seed)
sw.js       service worker (app shell cache; API data is network-only)
```

## Requirements

- **Client**: any evergreen browser (Service Workers, IndexedDB, Web Workers, WebAssembly).
- **Seed pipeline**: Python 3.9+, `requests`, `numpy`, `torch` (CPU), `transformers`.
- **Dev**: Node.js (vendor build, client tests), Go (server tests).

## License

MIT — see [LICENSE](LICENSE).

Thanks to [arXiv](https://arxiv.org/), [DataCite](https://datacite.org/), [OpenAlex](https://openalex.org/), and Hugging Face.
