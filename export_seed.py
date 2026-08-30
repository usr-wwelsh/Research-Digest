"""export_seed.py — replaces render.py's HTML output.

fetch.py/summarize.py/embed.py/relate.py are unchanged; only the final
pipeline step changes. Instead of building static HTML pages, this
serializes the corpus to seed-corpus.json so a fresh PWA install has
something to show immediately (see app/ui-common.js's ensureSeedImported)
while it starts fetching for itself client-side. Same atomic-write,
refuse-if-empty discipline as the old render.py: a failed/partial run
never overwrites a good seed file with an empty one.
"""
import os
import sys
import json

import db

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(SCRIPT_DIR, "seed-corpus.json")


def atomic_write(path, content):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)


def paper_to_seed_dict(conn, row):
    d = db.row_to_dict(row)  # JSON-decodes categories/authors/related, strips embedding
    if row["embedding"]:
        # The client needs real vectors to compute "related papers" without
        # re-embedding a paper it already has a summary for — row_to_dict
        # strips the raw blob for HTML rendering's sake, not for this.
        d["embedding"] = db.blob_to_vec(row["embedding"])
    d["tags"] = db.tags_for(conn, row["arxiv_id"])
    return d


def main(db_path=None, out_path=None):
    out_path = out_path or OUT_PATH
    conn = db.connect(db_path) if db_path else db.connect()
    total = db.count(conn)
    if total == 0:
        print("Export ABORTED: corpus is empty — refusing to publish over a good seed file.",
              file=sys.stderr)
        sys.exit(1)

    rows = conn.execute(
        "SELECT * FROM papers ORDER BY (published IS NULL), published DESC"
    ).fetchall()
    papers = [paper_to_seed_dict(conn, row) for row in rows]

    atomic_write(out_path, json.dumps(papers, ensure_ascii=False))
    conn.close()
    print(f"Exported {len(papers)} papers to {out_path}.")
    return papers


if __name__ == "__main__":
    main()
