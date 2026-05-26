"""Fetch stage — the only part that touches arXiv.

Upserts new papers into the corpus; never deletes. Honors 429 / Retry-After with
exponential backoff, so a rate limit just means "no new papers this run" — the
existing corpus is untouched. `--backfill` refetches original abstracts for papers
salvaged from old HTML, batched via id_list (hundreds of ids per request).
"""
import os
import sys
import time
import json
import xml.etree.ElementTree as ET

import requests

import db

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
API = "https://export.arxiv.org/api/query"
NS = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
REQUEST_SPACING = 3.0   # seconds between arXiv requests (be polite)
MAX_RETRIES = 5


def config():
    try:
        with open(os.path.join(SCRIPT_DIR, "config.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


CFG = config()
SETTINGS = CFG.get("settings", {})
USER_AGENT = SETTINGS.get("user_agent", "ResearchDigestBot/2.0 (github.com/usr-wwelsh)")


def _get(params):
    """GET arXiv with backoff. Returns XML text or None (never raises)."""
    delay = 5.0
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(API, params=params, headers={"User-Agent": USER_AGENT}, timeout=30)
            if r.status_code == 200:
                return r.text
            if r.status_code == 429 or r.status_code >= 500:
                wait = float(r.headers.get("Retry-After", delay))
                print(f"  arXiv {r.status_code} (rate limited); backing off {wait:.0f}s", file=sys.stderr)
                time.sleep(wait)
                delay *= 2
                continue
            print(f"  arXiv {r.status_code}: {r.text[:160]}", file=sys.stderr)
            return None
        except requests.RequestException as e:
            print(f"  arXiv request failed ({e}); retry in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
            delay *= 2
    return None


def date_filter(days):
    if not days or days <= 0:
        return ""
    from datetime import datetime, timedelta
    end = datetime.now()
    start = end - timedelta(days=days)
    return f"submittedDate:[{start.strftime('%Y%m%d')}0000 TO {end.strftime('%Y%m%d')}2359]"


def parse(xml_text):
    if not xml_text:
        return []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    out = []
    for e in root.findall("atom:entry", NS):
        title_el = e.find("atom:title", NS)
        summary_el = e.find("atom:summary", NS)
        id_el = e.find("atom:id", NS)
        if title_el is None or summary_el is None or id_el is None:
            continue
        link = id_el.text.strip()
        arxiv_id = link.split("/abs/")[-1].split("v")[0]
        pub = e.find("atom:published", NS)
        upd = e.find("atom:updated", NS)
        prim = e.find("arxiv:primary_category", NS)
        cats = [c.get("term") for c in e.findall("atom:category", NS) if c.get("term")]
        authors = [a.find("atom:name", NS).text for a in e.findall("atom:author", NS)
                   if a.find("atom:name", NS) is not None]
        out.append({
            "arxiv_id": arxiv_id,
            "title": " ".join(title_el.text.split()),
            "abstract": " ".join(summary_el.text.split()),
            "primary_category": prim.get("term") if prim is not None else (cats[0] if cats else None),
            "categories": cats,
            "authors": authors,
            "published": (pub.text.split("T")[0] if pub is not None else None),
            "updated": (upd.text.split("T")[0] if upd is not None else None),
            "abs_url": link,
            "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}.pdf",
        })
    return out


def score(paper, keywords):
    title = paper["title"].lower()
    abstract = paper["abstract"].lower()
    s = 0
    for kw in keywords:
        kw = kw.lower()
        if kw in title:
            s += 3
        elif kw in abstract:
            s += 1
    return s


def run_fetch():
    interests = CFG.get("interests", {})
    if not interests:
        print("No interests configured.", file=sys.stderr)
        return
    per = SETTINGS.get("papers_per_interest", 25)
    mult = SETTINGS.get("fetch_multiplier", 3)
    days = SETTINGS.get("recent_days", 7)

    conn = db.connect()
    started = db.now_iso()
    fetched = added = 0
    for name, ic in interests.items():
        query = ic["query"]
        df = date_filter(days)
        full = f"({query}) AND {df}" if df else query
        print(f"Fetching: {name}")
        xml = _get({"search_query": full, "start": 0, "max_results": per * mult,
                    "sortBy": "submittedDate", "sortOrder": "descending"})
        papers = parse(xml)
        fetched += len(papers)
        papers.sort(key=lambda p: score(p, ic.get("keywords", [])), reverse=True)
        for p in papers[:per]:
            existing = conn.execute("SELECT 1 FROM papers WHERE arxiv_id=?", (p["arxiv_id"],)).fetchone()
            db.upsert_paper(conn, p["arxiv_id"], title=p["title"], abstract=p["abstract"],
                            primary_category=p["primary_category"], categories=p["categories"],
                            authors=p["authors"], interest=name, published=p["published"],
                            updated=p["updated"], abs_url=p["abs_url"], pdf_url=p["pdf_url"],
                            fetched_at=db.now_iso(), needs_abstract_backfill=0)
            if not existing:
                added += 1
        print(f"  {len(papers)} found, kept top {min(per, len(papers))}")
        time.sleep(REQUEST_SPACING)

    db.rebuild_fts(conn)
    status = "ok" if fetched else "no_results"
    db.log_ingest_run(conn, started, fetched, added, status)
    conn.commit()
    conn.close()
    print(f"Fetch done: {fetched} seen, {added} new. ({status})")


def backfill_abstracts(batch=100):
    conn = db.connect()
    ids = db.needing_abstract_backfill(conn)
    if not ids:
        print("No abstracts need backfilling.")
        return
    print(f"Backfilling original abstracts for {len(ids)} papers...")
    filled = 0
    for i in range(0, len(ids), batch):
        chunk = ids[i:i + batch]
        xml = _get({"id_list": ",".join(chunk), "max_results": len(chunk)})
        for p in parse(xml):
            # real abstract replaces the salvaged placeholder → drop the derived
            # summary/embedding so summarize.py/embed.py regenerate from better text
            db.update_paper(conn, p["arxiv_id"], abstract=p["abstract"],
                            primary_category=p["primary_category"], categories=p["categories"],
                            authors=p["authors"], updated=p["updated"], needs_abstract_backfill=0,
                            summary=None, embedding=None)
            filled += 1
        conn.commit()
        print(f"  {min(i + batch, len(ids))}/{len(ids)}")
        time.sleep(REQUEST_SPACING)
    db.rebuild_fts(conn)
    conn.commit()
    conn.close()
    print(f"Backfilled {filled} abstracts. Re-run summarize.py/embed.py to refresh them.")


if __name__ == "__main__":
    if "--backfill" in sys.argv:
        backfill_abstracts()
    else:
        run_fetch()
