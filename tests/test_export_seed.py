import json

import pytest

import db
import export_seed


def test_refuses_to_write_when_corpus_is_empty(tmp_path):
    db_path = str(tmp_path / "empty.db")
    db.connect(db_path).close()  # creates schema, zero rows
    out_path = tmp_path / "seed-corpus.json"

    with pytest.raises(SystemExit):
        export_seed.main(db_path=db_path, out_path=str(out_path))
    assert not out_path.exists()


def test_exports_papers_with_decoded_embedding_and_tags(tmp_path):
    db_path = str(tmp_path / "test.db")
    conn = db.connect(db_path)
    db.upsert_paper(conn, "1234.5678", title="A Paper", abstract="An abstract.",
                     categories=["cs.LG"], authors=["Ada Researcher"])
    db.update_paper(conn, "1234.5678", embedding=db.vec_to_blob([0.1, 0.2, 0.3]), summary="A summary.")
    db.set_tags(conn, "1234.5678", [("edge", 0.9)])
    conn.commit()
    conn.close()

    out_path = tmp_path / "seed-corpus.json"
    papers = export_seed.main(db_path=db_path, out_path=str(out_path))

    assert len(papers) == 1
    p = papers[0]
    assert p["arxiv_id"] == "1234.5678"
    assert p["categories"] == ["cs.LG"]
    assert p["embedding"] == pytest.approx([0.1, 0.2, 0.3])
    assert p["tags"] == ["edge"]

    on_disk = json.loads(out_path.read_text(encoding="utf-8"))
    assert on_disk == papers


def test_write_is_atomic_no_tmp_file_left_behind(tmp_path):
    db_path = str(tmp_path / "test.db")
    conn = db.connect(db_path)
    db.upsert_paper(conn, "1234.5678", title="A Paper")
    conn.commit()
    conn.close()

    out_path = tmp_path / "seed-corpus.json"
    export_seed.main(db_path=db_path, out_path=str(out_path))

    assert out_path.exists()
    assert not (tmp_path / "seed-corpus.json.tmp").exists()


def test_a_failed_run_never_overwrites_a_good_existing_seed_file(tmp_path):
    good_db_path = str(tmp_path / "good.db")
    conn = db.connect(good_db_path)
    db.upsert_paper(conn, "1234.5678", title="A Paper")
    conn.commit()
    conn.close()

    out_path = tmp_path / "seed-corpus.json"
    export_seed.main(db_path=good_db_path, out_path=str(out_path))
    original_content = out_path.read_text(encoding="utf-8")

    empty_db_path = str(tmp_path / "empty.db")
    db.connect(empty_db_path).close()
    with pytest.raises(SystemExit):
        export_seed.main(db_path=empty_db_path, out_path=str(out_path))

    assert out_path.read_text(encoding="utf-8") == original_content
