"""Summarize stage — fill papers missing a turbolab summary. Offline-safe, idempotent.

Reads the best available text (original abstract, or the salvaged text placeholder),
asks turbolab for a structured summary, and stores summary/layman/difficulty + topical
tags. Papers turbolab can't process this run are simply left for the next run.
"""
import sys

import db
import turbolab


def main():
    conn = db.connect()
    rows = db.papers_missing_summary(conn)
    print(f"Summarize: {len(rows)} papers need a summary (turbolab @ {turbolab.CFG['url']})")
    if rows and not turbolab.healthcheck():
        print("  turbolab unreachable — skipping this stage (papers stay queued).")
        return

    done = 0
    for r in rows:
        text = r["abstract"] or r["title"]
        res = turbolab.summarize(r["title"], text)
        if not res:
            continue
        db.update_paper(
            conn, r["arxiv_id"],
            summary=res["summary"],
            layman=res["layman"],
            difficulty=res["difficulty"],
            summary_model=turbolab.CFG["chat_model"],
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
