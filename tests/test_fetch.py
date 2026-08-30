"""Characterization tests for fetch.py's parse()/score() — the safety net
for Phase 2, which moves this logic into sources/arxiv.py unchanged."""
import os

import fetch

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "arxiv_response.xml")


def load_fixture():
    with open(FIXTURE, encoding="utf-8") as f:
        return f.read()


def test_parse_extracts_bare_arxiv_id_without_version_suffix():
    papers = fetch.parse(load_fixture())
    assert papers[0]["arxiv_id"] == "2508.01234"
    assert papers[1]["arxiv_id"] == "2508.05678"


def test_parse_collapses_whitespace_in_title_and_abstract():
    papers = fetch.parse(load_fixture())
    assert papers[0]["title"] == "Efficient Edge Inference via Quantization"
    assert "efficient inference on edge devices" in papers[0]["abstract"]
    assert "\n" not in papers[0]["abstract"]


def test_parse_extracts_categories_authors_and_dates():
    papers = fetch.parse(load_fixture())
    p = papers[0]
    assert p["primary_category"] == "cs.LG"
    assert p["categories"] == ["cs.LG", "cs.CV"]
    assert p["authors"] == ["Ada Researcher", "Bo Scientist"]
    assert p["published"] == "2026-08-15"
    assert p["updated"] == "2026-08-20"
    assert p["pdf_url"] == "https://arxiv.org/pdf/2508.01234.pdf"


def test_parse_returns_empty_list_for_empty_or_malformed_xml():
    assert fetch.parse("") == []
    assert fetch.parse(None) == []
    assert fetch.parse("<not valid xml") == []


def test_score_weights_title_hits_higher_than_abstract_hits():
    paper = {"title": "Edge computing for IoT", "abstract": "a general survey"}
    assert fetch.score(paper, ["edge"]) == 3

    paper2 = {"title": "A general survey", "abstract": "applications in edge computing"}
    assert fetch.score(paper2, ["edge"]) == 1


def test_score_is_case_insensitive_and_sums_multiple_keywords():
    paper = {"title": "EDGE and Efficient models", "abstract": "quantization details"}
    assert fetch.score(paper, ["edge", "efficient", "quantization"]) == 3 + 3 + 1


def test_score_zero_when_no_keywords_match():
    paper = {"title": "Unrelated topic", "abstract": "nothing relevant here"}
    assert fetch.score(paper, ["quantum", "biology"]) == 0


def test_date_filter_empty_when_days_is_zero_or_none():
    assert fetch.date_filter(0) == ""
    assert fetch.date_filter(None) == ""


def test_date_filter_builds_submitted_date_range():
    result = fetch.date_filter(7)
    assert result.startswith("submittedDate:[")
    assert " TO " in result
