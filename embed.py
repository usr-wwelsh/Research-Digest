"""Embed stage — fill papers missing a vector via turbolab's e5 model. Offline-safe, idempotent."""
import db
import turbolab


def main():
    conn = db.connect()
    rows = db.papers_missing_embedding(conn)
    print(f"Embed: {len(rows)} papers need a vector (turbolab @ {turbolab.CFG['url']})")
    if rows and not turbolab.healthcheck():
        print("  turbolab unreachable — skipping this stage (papers stay queued).")
        return

    done = 0
    for r in rows:
        text = r["abstract"] or r["title"]
        vec = turbolab.embed(text, kind="passage")
        if not vec:
            continue
        db.update_paper(
            conn, r["arxiv_id"],
            embedding=db.vec_to_blob(vec),
            embedding_model=turbolab.CFG["embed_model"],
            embedded_at=db.now_iso(),
        )
        done += 1
        if done % 20 == 0:
            conn.commit()
            print(f"  ...{done}/{len(rows)}")

    conn.commit()
    conn.close()
    print(f"Embedded {done}/{len(rows)}.")


if __name__ == "__main__":
    main()
