"""Summarize stage — fill papers missing a summary. Offline, idempotent, no network.

Reads the best available text (original abstract, or the salvaged text placeholder),
extracts the sentence(s) closest to the abstract's own DistilBERT embedding (see
extractive.py — no generation), and stores summary/layman/difficulty + topical tags.
Papers left unprocessed (model unavailable) are simply left for the next run.
"""
import sys

import db
import local_ai

SUMMARY_MODEL_LABEL = f"extractive/{local_ai.CFG['embedding_model']}"


def main():
    conn = db.connect()
    rows = db.papers_missing_summary(conn)
    print(f"Summarize: {len(rows)} papers need a summary ({SUMMARY_MODEL_LABEL})")
    if rows and not local_ai.summarizer_available():
        print("  summarizer unavailable — skipping this stage (papers stay queued).")
        return

    done = 0
    for r in rows:
        text = r["abstract"] or r["title"]
        res = local_ai.summarize(r["title"], text, category=r["primary_category"], interest=r["interest"])
        if not res:
            continue
        db.update_paper(
            conn, r["arxiv_id"],
            summary=res["summary"],
            layman=res["layman"],
            difficulty=res["difficulty"],
            summary_model=SUMMARY_MODEL_LABEL,
            summary_at=db.now_iso(),
        )
        if res["tags"]:
            db.set_tags(conn, r["arxiv_id"], [(t, 1.0) for t in res["tags"]])
        done += 1
        if done % 10 == 0:
            conn.commit()
            print(f"  ...{done}/{len(rows)}")

    db.rebuild_fts(conn)  # summaries are now searchable
    conn.commit()
    conn.close()
    print(f"Summarized {done}/{len(rows)}.")
    if done < len(rows):
        print(f"  {len(rows) - done} left for next run.", file=sys.stderr)


if __name__ == "__main__":
    main()
