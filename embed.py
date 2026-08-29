"""Embed stage — fill papers missing a vector via local DistilBERT. Offline, idempotent."""
import db
import local_ai


def main():
    conn = db.connect()
    rows = db.papers_missing_embedding(conn)
    print(f"Embed: {len(rows)} papers need a vector ({local_ai.CFG['embedding_model']})")
    if rows and not local_ai.embedder_available():
        print("  embedder unavailable — skipping this stage (papers stay queued).")
        return

    done = 0
    for r in rows:
        text = r["abstract"] or r["title"]
        vec = local_ai.embed(text)
        if not vec:
            continue
        db.update_paper(
            conn, r["arxiv_id"],
            embedding=db.vec_to_blob(vec),
            embedding_model=local_ai.CFG["embedding_model"],
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
