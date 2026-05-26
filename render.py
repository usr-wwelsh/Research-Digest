"""Render stage — build the static site from the DB. Atomic, refuses to publish empty.

Outputs (all match the Caddy allowlist of /, *.html, /arxiv_archive/*):
  index.html    landing/about page (links research-digest + turbolab, Latest/Archive)
  latest.html   current digest, desktop grid, grouped by interest
  archive.html  list of dated snapshots
  feed.html     mobile feed with client-side keyword filter
  arxiv_archive/arxiv_digest_YYYYMMDD.html   dated snapshot of this run
"""
import os
import sys
import json
import glob
from collections import OrderedDict
from datetime import datetime

from jinja2 import Environment, FileSystemLoader, select_autoescape

import db

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TPL_DIR = os.path.join(SCRIPT_DIR, "templates")
ARCHIVE_DIR = os.path.join(SCRIPT_DIR, "arxiv_archive")

PROJECTS = {
    "research_digest": "https://git.wwel.sh/research-digest",
    "turbolab": "https://git.wwel.sh/turbolab",
    "portfolio": "https://wwel.sh",
}

env = Environment(
    loader=FileSystemLoader(TPL_DIR),
    autoescape=select_autoescape(["html", "j2", "xml"]),
)


def config():
    path = os.path.join(SCRIPT_DIR, "config.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def atomic_write(path, content):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)


def paper_view(conn, row, idx):
    d = db.row_to_dict(row)
    d["tags"] = db.tags_for(conn, row["arxiv_id"])
    related = d.get("related") or []
    d["related_papers"] = [idx[i] for i in related if i in idx][:3]
    d["display"] = d.get("summary") or d.get("abstract") or ""
    d["search_text"] = " ".join(filter(None, [
        d.get("title", ""), d.get("display", ""), " ".join(d["tags"]),
    ])).lower()
    return d


def build_groups(conn, idx, per_interest, order):
    rows = conn.execute(
        "SELECT * FROM papers ORDER BY (published IS NULL), published DESC"
    ).fetchall()
    groups = OrderedDict((k, []) for k in order)
    for r in rows:
        groups.setdefault(r["interest"] or "Other", []).append(r)
    out = OrderedDict()
    for name, rs in groups.items():
        if rs:
            out[name] = [paper_view(conn, r, idx) for r in rs[:per_interest]]
    return out


def archive_entries():
    entries = []
    for path in sorted(glob.glob(os.path.join(ARCHIVE_DIR, "arxiv_digest_*.html")), reverse=True):
        fn = os.path.basename(path)
        ds = fn.replace("arxiv_digest_", "").replace(".html", "")
        try:
            dt = datetime.strptime(ds, "%Y%m%d")
        except ValueError:
            continue
        entries.append({"filename": fn, "date": dt.strftime("%B %d, %Y"),
                        "day": dt.strftime("%A")})
    return entries


def main():
    conn = db.connect()
    total = db.count(conn)
    if total == 0:
        print("Render ABORTED: corpus is empty — refusing to publish over good output.",
              file=sys.stderr)
        sys.exit(1)

    cfg = config()
    per_interest = cfg.get("settings", {}).get("papers_per_interest", 25)
    order = list(cfg.get("interests", {}).keys())

    rows = conn.execute("SELECT arxiv_id, title, abs_url FROM papers").fetchall()
    idx = {r["arxiv_id"]: {"id": r["arxiv_id"], "title": r["title"],
                           "url": r["abs_url"] or f"https://arxiv.org/abs/{r['arxiv_id']}"}
           for r in rows}

    groups = build_groups(conn, idx, per_interest, order)
    shown = sum(len(v) for v in groups.values())
    now = datetime.now()
    common = {"projects": PROJECTS, "generated": now.strftime("%B %d, %Y"),
              "year": now.year}

    # feed: round-robin interleave across interests (slim dicts for embedding)
    feed_papers = []
    i = 0
    while True:
        added = False
        for name, ps in groups.items():
            if i < len(ps):
                s = ps[i]
                feed_papers.append({
                    "title": s["title"], "summary": s["display"],
                    "layman": s.get("layman") or "", "difficulty": s.get("difficulty") or "",
                    "category": s.get("primary_category") or "", "published": s.get("published") or "",
                    "abs_url": s.get("abs_url") or "", "pdf_url": s.get("pdf_url") or "",
                    "tags": s.get("tags") or [], "interest": name,
                })
                added = True
        if not added:
            break
        i += 1

    os.makedirs(ARCHIVE_DIR, exist_ok=True)

    digest_html = env.get_template("digest.j2").render(
        groups=groups, total=total, shown=shown, **common)
    snapshot = os.path.join(ARCHIVE_DIR, f"arxiv_digest_{now.strftime('%Y%m%d')}.html")
    atomic_write(snapshot, digest_html)
    atomic_write(os.path.join(SCRIPT_DIR, "latest.html"), digest_html)

    atomic_write(os.path.join(SCRIPT_DIR, "index.html"),
                 env.get_template("landing.j2").render(total=total, **common))
    atomic_write(os.path.join(SCRIPT_DIR, "archive.html"),
                 env.get_template("archive.j2").render(
                     entries=archive_entries(), **common))
    atomic_write(os.path.join(SCRIPT_DIR, "feed.html"),
                 env.get_template("feed.j2").render(papers=feed_papers, **common))

    conn.close()
    print(f"Rendered {shown} papers across {len(groups)} interests "
          f"(corpus: {total}). Wrote index/latest/archive/feed + snapshot.")


if __name__ == "__main__":
    main()
