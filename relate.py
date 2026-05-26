"""Relate stage — precompute nearest-neighbour papers from embeddings (cosine).

Tags come from turbolab in the summarize stage; this stage only fills each paper's
`related` list so the static site can show "related papers" without a live query.
"""
import numpy as np

import db

TOP_N = 6


def main():
    conn = db.connect()
    rows = db.papers_with_embeddings(conn)
    if len(rows) < 2:
        print(f"Relate: only {len(rows)} embedded papers — need >=2. Skipping.")
        return

    ids = [r[0] for r in rows]
    mat = np.array([db.blob_to_vec(r[1]) for r in rows], dtype=np.float32)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    unit = mat / norms
    sims = unit @ unit.T
    np.fill_diagonal(sims, -1.0)  # exclude self

    updated = 0
    for i, aid in enumerate(ids):
        top = np.argsort(-sims[i])[:TOP_N]
        related = [ids[j] for j in top if sims[i][j] > 0]
        db.update_paper(conn, aid, related=related)
        updated += 1

    conn.commit()
    conn.close()
    print(f"Relate: computed neighbours for {updated} papers.")


if __name__ == "__main__":
    main()
