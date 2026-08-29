![Python](https://img.shields.io/badge/python-3.9+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![arXiv](https://img.shields.io/badge/arXiv-API-red.svg)
![Summaries](https://img.shields.io/badge/summaries-distilbert-ff6b6b.svg)
![Platform](https://img.shields.io/badge/platform-linux-lightgrey.svg)

![research-digest status](https://vitals.wwel.sh/badge/proxmox/research-digest/status.svg)
![research-digest uptime](https://vitals.wwel.sh/badge/proxmox/research-digest/uptime.svg)
![research-digest cpu](https://vitals.wwel.sh/badge/proxmox/research-digest/cpu.svg)
![research-digest ram](https://vitals.wwel.sh/badge/proxmox/research-digest/ram.svg)
![research-digest cpu trend](https://vitals.wwel.sh/badge/proxmox/research-digest/sparkline.svg?metric=cpu)
![research-digest ram trend](https://vitals.wwel.sh/badge/proxmox/research-digest/sparkline.svg?metric=ram)

# Research Digest

A local-first arXiv feed with AI-written plain-language summaries, running entirely on your
own hardware.

Curate research interests, and Research Digest keeps a local corpus of matching papers, each
with a plain-English summary, a layman explanation, topical tags, and semantically-related
papers. Desktop grid for deep reading, mobile feed for quick scrolling, full-text filtering on
both. No API keys, no cloud, no separate model server. Summaries run in-process on DistilBART;
embeddings on DistilBERT — both CPU, both bundled in this one app.

---

## Features

- **AI summaries** — summary from DistilBART, layman explanation/difficulty/tags from local keyword heuristics. Runs entirely on-device; nothing leaves your network.
- **Search & relate** — client-side keyword filter on every page; "related papers" precomputed from DistilBERT embeddings.
- **Corpus-first** — SQLite is the source of truth. The site renders from the DB, so a failed arXiv fetch never wipes good output.
- **Resilient pipeline** — 429 backoff, upsert-never-delete, and a render step that refuses to publish an empty digest.
- **Desktop + mobile** — multi-column grid and a full-screen swipeable feed.
- **Configurable** — JSON interests, keyword scoring, look-back window.

---

## How it works

SQLite holds the corpus. The pipeline is a chain of independent, idempotent stages — and only
the first one touches the network:

| Stage | Network? | Does |
|-------|:---:|------|
| `fetch.py`     | arXiv | Upsert new papers (original abstract). 429 backoff; never deletes. |
| `summarize.py` | — | Fill missing summaries/layman/difficulty/tags via local DistilBART + heuristics. |
| `embed.py`     | — | Fill missing vectors via local DistilBERT (mean-pooled hidden states). |
| `relate.py`    | — | Precompute nearest-neighbour papers (cosine) for "related". |
| `render.py`    | — | Build the static site from the DB. Atomic writes; refuses to publish empty. |

`run.sh` chains them; a fetch failure is logged and the rest still run on the existing corpus.
Everything after `fetch` runs offline, so a multi-day arXiv rate limit just means "no new
papers" — the site stays fully live.

---

## Quick Start

```bash
git clone https://github.com/usr-wwelsh/research-digest.git
cd research-digest
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt

./run.sh            # fetch -> summarize -> embed -> relate -> render
# or, no network:
./run.sh --offline  # rebuild the site from the existing corpus
```

The first `summarize`/`embed` run downloads ~650MB of model weights (cached under
`.hf_cache/` after that — no repeat downloads).

Open `index.html` (landing), `latest.html` (digest), `archive.html`, or `feed.html` (mobile).

**Migrating from v1?** Recover your old backlog from the archived HTML with zero arXiv calls:

```bash
./venv/bin/python migrate_from_html.py   # parses arxiv_archive/*.html into digest.db
./run.sh --offline                       # summarize + embed + render the backlog
```

(The original abstracts aren't in old HTML, so salvaged papers are flagged
`needs_abstract_backfill`; `./venv/bin/python fetch.py --backfill` refetches them in batches.)

---

## Configuration

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
    "summarizer_model": "sshleifer/distilbart-cnn-12-6",
    "embedding_model": "distilbert-base-uncased"
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `papers_per_interest` | 25 | Papers kept per interest per fetch |
| `recent_days` | 7 | Look-back window (0 = all time) |
| `fetch_multiplier` | 3 | Over-fetch, then keyword-rank, then trim |

arXiv query syntax: combine category codes with `OR`/`AND`, e.g. `cat:cs.LG OR cat:cs.AI`
([full taxonomy](https://arxiv.org/category_taxonomy)).

---

## Self-hosted deployment (Proxmox LXC)

From your Proxmox host:

```bash
bash <(curl -sL https://raw.githubusercontent.com/usr-wwelsh/Research-Digest/main/create-lxc.sh)
```

This creates a Debian LXC, installs Caddy + cloudflared, sets up the venv, pre-downloads the
model weights, configures the weekly cron (Monday 8am), and serves on `:8080`. After it
finishes, edit `config.json` and run `sudo -u www-data /opt/research-digest/run.sh`.

Idle footprint is ~50-80MB (Caddy + cloudflared, the Python process only runs during the
weekly cron job). Budget headroom for that run: DistilBART + DistilBERT need roughly 1-2GB
of RAM while the pipeline is executing.

---

## Project structure

```
research-digest/
├── config.json          # interests, settings, local_ai block
├── db.py                # SQLite schema + data access (source of truth)
├── fetch.py             # arXiv ingest (backoff, upsert, --backfill)
├── summarize.py         # DistilBART summaries + heuristics
├── embed.py             # DistilBERT embeddings
├── relate.py            # nearest-neighbour "related papers"
├── render.py             # static site builder (atomic, refuses empty)
├── migrate_from_html.py # one-time v1 backlog salvage
├── local_ai.py           # local model client (summarize + embed, lazy-loaded)
├── templates/           # Jinja2 templates (autoescaped)
├── run.sh               # pipeline runner (cron entrypoint)
├── setup.sh             # LXC bootstrap
├── create-lxc.sh        # Proxmox LXC creator
├── Caddyfile             # static file server
└── digest.db             # the corpus (gitignored)
```

---

## Requirements

- Python 3.9+ · deps: `requests`, `jinja2`, `numpy`, `torch` (CPU), `transformers`
- Internet only for the `fetch` stage and the one-time model download

---

## License

MIT — see [LICENSE](LICENSE).

---

## Acknowledgments

- [arXiv](https://arxiv.org/) for the open research repository
- Hugging Face `transformers`, and the DistilBART/DistilBERT model authors, for local inference
