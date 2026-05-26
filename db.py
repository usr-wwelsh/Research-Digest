"""SQLite data layer for Research Digest v2.

The DB is the source of truth. The arXiv fetch only ever adds rows; everything
else (summaries, embeddings, tags, rendering) reads from here, so a failed fetch
never destroys the corpus.
"""
import os
import json
import struct
import sqlite3
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPT_DIR, "digest.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (
    arxiv_id                TEXT PRIMARY KEY,
    title                   TEXT NOT NULL,
    abstract                TEXT,          -- original abstract; never lose it again
    primary_category        TEXT,
    categories              TEXT,          -- JSON array
    authors                 TEXT,          -- JSON array
    interest                TEXT,          -- source interest bucket
    published               TEXT,
    updated                 TEXT,
    abs_url                 TEXT,
    pdf_url                 TEXT,
    fetched_at              TEXT,
    needs_abstract_backfill INTEGER DEFAULT 0,
    -- turbolab-generated (summarize stage)
    summary                 TEXT,
    layman                  TEXT,
    difficulty              TEXT,
    summary_model           TEXT,
    summary_at              TEXT,
    -- embedding (embed stage)
    embedding               BLOB,
    embedding_model         TEXT,
    embedded_at             TEXT,
    -- precomputed nearest neighbours (tag stage): JSON array of arxiv_ids
    related                 TEXT
);

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_tags (
    arxiv_id TEXT NOT NULL REFERENCES papers(arxiv_id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    score    REAL DEFAULT 0,
    PRIMARY KEY (arxiv_id, tag_id)
);

CREATE TABLE IF NOT EXISTS ingest_runs (
    id          INTEGER PRIMARY KEY,
    started_at  TEXT,
    finished_at TEXT,
    fetched     INTEGER DEFAULT 0,
    added       INTEGER DEFAULT 0,
    status      TEXT,
    note        TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
    arxiv_id UNINDEXED, title, abstract, summary
);
"""

# Columns a creator (salvage/fetch) or processor (summarize/embed/tag) may write.
_WRITABLE = {
    "title", "abstract", "primary_category", "categories", "authors", "interest",
    "published", "updated", "abs_url", "pdf_url", "fetched_at",
    "needs_abstract_backfill", "summary", "layman", "difficulty", "summary_model",
    "summary_at", "embedding", "embedding_model", "embedded_at", "related",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path=DB_PATH):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


# --- vectors: little-endian float32, matching turbolab's blob layout ---

def vec_to_blob(vec):
    return struct.pack("<%df" % len(vec), *vec)


def blob_to_vec(blob):
    if not blob:
        return []
    return list(struct.unpack("<%df" % (len(blob) // 4), blob))


# --- writes ---

def _coerce(cols):
    """JSON-encode list/dict values; pass everything else through."""
    out = {}
    for k, v in cols.items():
        if k not in _WRITABLE:
            raise KeyError(f"non-writable column: {k}")
        if isinstance(v, (list, dict)):
            v = json.dumps(v, ensure_ascii=False)
        out[k] = v
    return out


def upsert_paper(conn, arxiv_id, **cols):
    """Insert a paper or update the given columns. Used by salvage/fetch.

    Only the columns passed are touched, so stages never clobber each other
    (e.g. fetch writing the abstract won't wipe an existing turbolab summary).
    """
    cols = _coerce(cols)
    keys = ["arxiv_id"] + list(cols)
    placeholders = ", ".join("?" * len(keys))
    updates = ", ".join(f"{k}=excluded.{k}" for k in cols)
    sql = f"INSERT INTO papers ({', '.join(keys)}) VALUES ({placeholders})"
    if updates:
        sql += f" ON CONFLICT(arxiv_id) DO UPDATE SET {updates}"
    conn.execute(sql, [arxiv_id] + list(cols.values()))


def update_paper(conn, arxiv_id, **cols):
    """Update columns on an existing paper. Used by summarize/embed/tag."""
    cols = _coerce(cols)
    if not cols:
        return
    assignments = ", ".join(f"{k}=?" for k in cols)
    conn.execute(
        f"UPDATE papers SET {assignments} WHERE arxiv_id=?",
        list(cols.values()) + [arxiv_id],
    )


def set_tags(conn, arxiv_id, named_scores):
    """Replace a paper's tags. named_scores: list of (name, score)."""
    conn.execute("DELETE FROM paper_tags WHERE arxiv_id=?", (arxiv_id,))
    for name, score in named_scores:
        name = name.strip().lower()
        if not name:
            continue
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
        tag_id = conn.execute("SELECT id FROM tags WHERE name=?", (name,)).fetchone()[0]
        conn.execute(
            "INSERT OR REPLACE INTO paper_tags (arxiv_id, tag_id, score) VALUES (?, ?, ?)",
            (arxiv_id, tag_id, float(score)),
        )


def rebuild_fts(conn):
    conn.execute("DELETE FROM papers_fts")
    conn.execute(
        "INSERT INTO papers_fts (arxiv_id, title, abstract, summary) "
        "SELECT arxiv_id, title, COALESCE(abstract, ''), COALESCE(summary, '') FROM papers"
    )


def log_ingest_run(conn, started_at, fetched, added, status, note=""):
    conn.execute(
        "INSERT INTO ingest_runs (started_at, finished_at, fetched, added, status, note) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (started_at, now_iso(), fetched, added, status, note),
    )


# --- reads ---

def count(conn, where="", params=()):
    return conn.execute(f"SELECT COUNT(*) FROM papers {where}", params).fetchone()[0]


def papers_missing_summary(conn):
    return conn.execute(
        "SELECT * FROM papers WHERE summary IS NULL OR summary = '' ORDER BY published DESC"
    ).fetchall()


def papers_missing_embedding(conn):
    return conn.execute(
        "SELECT * FROM papers WHERE embedding IS NULL ORDER BY published DESC"
    ).fetchall()


def papers_with_embeddings(conn):
    return conn.execute(
        "SELECT arxiv_id, embedding FROM papers WHERE embedding IS NOT NULL"
    ).fetchall()


def needing_abstract_backfill(conn):
    return [r[0] for r in conn.execute(
        "SELECT arxiv_id FROM papers WHERE needs_abstract_backfill = 1"
    ).fetchall()]


def tags_for(conn, arxiv_id):
    return [r[0] for r in conn.execute(
        "SELECT t.name FROM paper_tags pt JOIN tags t ON t.id = pt.tag_id "
        "WHERE pt.arxiv_id = ? ORDER BY pt.score DESC",
        (arxiv_id,),
    ).fetchall()]


def row_to_dict(row):
    d = dict(row)
    for k in ("categories", "authors", "related"):
        if k in d and d[k]:
            try:
                d[k] = json.loads(d[k])
            except (ValueError, TypeError):
                d[k] = []
    d.pop("embedding", None)  # never serialise raw vectors into render data
    return d
