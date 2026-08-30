import pytest

import db


def test_upsert_paper_inserts_new_row(conn):
    db.upsert_paper(conn, "1234.5678", title="A Paper", abstract="An abstract.")
    row = conn.execute("SELECT * FROM papers WHERE arxiv_id=?", ("1234.5678",)).fetchone()
    assert row["title"] == "A Paper"
    assert row["abstract"] == "An abstract."


def test_upsert_paper_never_clobbers_columns_it_does_not_touch(conn):
    db.upsert_paper(conn, "1234.5678", title="A Paper", abstract="An abstract.")
    db.update_paper(conn, "1234.5678", summary="A summary.")
    db.upsert_paper(conn, "1234.5678", title="A Paper (updated)")
    row = conn.execute("SELECT * FROM papers WHERE arxiv_id=?", ("1234.5678",)).fetchone()
    assert row["title"] == "A Paper (updated)"
    assert row["summary"] == "A summary."  # untouched by the second upsert


def test_upsert_paper_json_encodes_list_columns(conn):
    db.upsert_paper(conn, "1234.5678", title="A Paper", categories=["cs.LG", "cs.AI"])
    row = conn.execute("SELECT categories FROM papers WHERE arxiv_id=?", ("1234.5678",)).fetchone()
    assert row["categories"] == '["cs.LG", "cs.AI"]'


def test_upsert_paper_rejects_non_writable_column(conn):
    with pytest.raises(KeyError):
        db.upsert_paper(conn, "1234.5678", bogus_column="nope")


def test_update_paper_on_missing_row_is_a_no_op_write(conn):
    # UPDATE on a non-existent row matches zero rows; should not raise.
    db.update_paper(conn, "does-not-exist", summary="x")


def test_set_tags_replaces_existing_tags(conn):
    db.upsert_paper(conn, "1234.5678", title="A Paper")
    db.set_tags(conn, "1234.5678", [("edge", 0.9), ("privacy", 0.4)])
    assert db.tags_for(conn, "1234.5678") == ["edge", "privacy"]
    db.set_tags(conn, "1234.5678", [("music", 0.5)])
    assert db.tags_for(conn, "1234.5678") == ["music"]


def test_row_to_dict_decodes_json_columns_and_strips_embedding(conn):
    db.upsert_paper(
        conn, "1234.5678", title="A Paper",
        categories=["cs.LG"], authors=["A. Author"], related=["9999.0001"],
    )
    db.update_paper(conn, "1234.5678", embedding=db.vec_to_blob([1.0, 2.0, 3.0]))
    row = conn.execute("SELECT * FROM papers WHERE arxiv_id=?", ("1234.5678",)).fetchone()
    d = db.row_to_dict(row)
    assert d["categories"] == ["cs.LG"]
    assert d["authors"] == ["A. Author"]
    assert d["related"] == ["9999.0001"]
    assert "embedding" not in d


def test_vec_blob_roundtrip():
    vec = [0.1, -2.5, 3.75]
    blob = db.vec_to_blob(vec)
    out = db.blob_to_vec(blob)
    assert out == pytest.approx(vec)


def test_blob_to_vec_handles_empty_blob():
    assert db.blob_to_vec(None) == []
    assert db.blob_to_vec(b"") == []


def test_papers_missing_summary_and_embedding(conn):
    db.upsert_paper(conn, "a", title="A")
    db.upsert_paper(conn, "b", title="B")
    db.update_paper(conn, "b", summary="done", embedding=db.vec_to_blob([1.0]))
    missing_summary = [r["arxiv_id"] for r in db.papers_missing_summary(conn)]
    missing_embedding = [r["arxiv_id"] for r in db.papers_missing_embedding(conn)]
    assert missing_summary == ["a"]
    assert missing_embedding == ["a"]


def test_connect_enables_foreign_keys(conn):
    fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    assert fk == 1
