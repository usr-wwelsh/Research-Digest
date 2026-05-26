"""One-time salvage: recover the existing paper backlog from archived HTML.

Touches no network. v1 only kept the *summarised* text (not the original abstract),
so that text is stored as the `abstract` placeholder and `needs_abstract_backfill`
is set — fetch.py batch-refetches the originals later via id_list. The turbolab
summary/layman/difficulty fields are left empty so the summarize stage regenerates them.
"""
import os
import sys
import glob
from html.parser import HTMLParser

import db

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _classes(attrs):
    for k, v in attrs:
        if k == "class":
            return v.split()
    return []


def _href(attrs):
    for k, v in attrs:
        if k == "href":
            return v
    return None


def arxiv_id_from_url(url):
    # http://arxiv.org/abs/2401.12345v1  ->  2401.12345
    if not url or "/abs/" not in url:
        return None
    tail = url.split("/abs/")[-1].strip("/")
    return tail.split("v")[0]


class DigestParser(HTMLParser):
    """Extracts paper records from a v1-generated digest page."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.records = []
        self.interest = None
        self.in_article = False
        self.rec = None
        self.cur = None      # field currently being captured
        self.cur_tag = None  # tag that opened the current capture
        self.buf = []

    def _begin(self, field, tag):
        self.cur, self.cur_tag, self.buf = field, tag, []

    def handle_starttag(self, tag, attrs):
        cls = _classes(attrs)
        if tag == "h2" and "interest-title" in cls:
            self._begin("interest", "h2")
        elif tag == "article" and "paper" in cls:
            self.in_article = True
            self.rec = {"links": []}
        elif self.in_article:
            if tag == "h3":
                self._begin("title", "h3")
            elif tag == "div" and "summary" in cls:
                self._begin("abstract", "div")
            elif tag == "span" and "category-tag" in cls:
                self._begin("category", "span")
            elif tag == "span" and "date" in cls:
                self._begin("published", "span")
            elif tag == "a":
                href = _href(attrs)
                if href:
                    self.rec["links"].append(href)

    def handle_data(self, data):
        if self.cur is not None:
            self.buf.append(data)

    def handle_endtag(self, tag):
        if self.cur is not None and tag == self.cur_tag:
            text = "".join(self.buf).strip()
            if self.cur == "interest":
                self.interest = text
            elif self.rec is not None:
                self.rec[self.cur] = text
            self.cur = self.cur_tag = None
            self.buf = []
        if tag == "article" and self.in_article:
            self._finalize()
            self.in_article = False
            self.rec = None

    def _finalize(self):
        links = self.rec.get("links", [])
        abs_url = links[0] if links else None
        arxiv_id = arxiv_id_from_url(abs_url)
        title = self.rec.get("title")
        if not arxiv_id or not title:
            return
        self.records.append({
            "arxiv_id": arxiv_id,
            "title": title,
            "abstract": self.rec.get("abstract") or None,
            "primary_category": self.rec.get("category"),
            "categories": [self.rec["category"]] if self.rec.get("category") else [],
            "interest": self.interest,
            "published": self.rec.get("published"),
            "abs_url": abs_url,
            "pdf_url": links[1] if len(links) > 1 else (
                f"https://arxiv.org/pdf/{arxiv_id}.pdf"),
        })


def parse_file(path):
    p = DigestParser()
    with open(path, "r", encoding="utf-8") as f:
        p.feed(f.read())
    return p.records


def collect_files(root):
    files = sorted(glob.glob(os.path.join(root, "arxiv_archive", "*.html")))
    latest = os.path.join(root, "latest.html")
    if os.path.exists(latest):
        files.append(latest)
    return files


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else SCRIPT_DIR
    files = collect_files(root)
    if not files:
        print(f"No digest HTML found under {root}. Nothing to salvage.")
        return

    conn = db.connect()
    before = db.count(conn)
    seen = 0
    for path in files:
        recs = parse_file(path)
        seen += len(recs)
        for r in recs:
            db.upsert_paper(
                conn, r["arxiv_id"],
                title=r["title"],
                abstract=r["abstract"],
                primary_category=r["primary_category"],
                categories=r["categories"],
                interest=r["interest"],
                published=r["published"],
                abs_url=r["abs_url"],
                pdf_url=r["pdf_url"],
                needs_abstract_backfill=1,
            )
        print(f"  {os.path.basename(path)}: {len(recs)} cards")
    db.rebuild_fts(conn)
    conn.commit()
    after = db.count(conn)
    print(f"\nParsed {seen} cards across {len(files)} files.")
    print(f"Corpus: {before} -> {after} papers ({after - before} new).")
    conn.close()


if __name__ == "__main__":
    main()
