"""Mirrors app/tests/extractive.test.js — same algorithm, same test cases,
kept in sync so the seed corpus (server-side) and the live PWA (browser-side)
produce the same kind of summary."""
import extractive


def test_split_sentences_splits_on_sentence_ending_punctuation():
    assert extractive.split_sentences("First sentence. Second sentence! Third one?") == [
        "First sentence.", "Second sentence!", "Third one?",
    ]


def test_split_sentences_returns_whole_text_when_no_terminator():
    assert extractive.split_sentences("no terminal punctuation here") == ["no terminal punctuation here"]


def test_cosine_similarity_identical_and_orthogonal_vectors():
    assert extractive.cosine_similarity([1, 0], [1, 0]) == 1
    assert extractive.cosine_similarity([1, 0], [0, 1]) == 0


def test_cosine_similarity_zero_not_nan_for_zero_vector():
    assert extractive.cosine_similarity([0, 0], [1, 1]) == 0


def test_select_summary_sentences_returns_all_when_under_count():
    sentences = ["Only one."]
    assert extractive.select_summary_sentences(sentences, [[1, 0]], [1, 0], 2) == sentences


def test_select_summary_sentences_picks_closest_to_doc_embedding_in_original_order():
    sentences = ["On-topic first.", "Off-topic filler.", "On-topic last."]
    embeddings = [[1, 0], [0, 1], [0.9, 0.1]]
    doc_embedding = [1, 0]
    assert extractive.select_summary_sentences(sentences, embeddings, doc_embedding, 2) == [
        "On-topic first.", "On-topic last.",
    ]
