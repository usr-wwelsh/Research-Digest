"""Centroid-based extractive summarization: no generation, so any tiny
embedding model works (DistilBERT here, already loaded for embed()) — the
summarizer is the embedder, not a separate abstractive model.

Ported to app/extractive.js verbatim for the browser side; keep both in sync.
"""
import re

_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]+(?:\s|$)")


def split_sentences(text):
    sentences = [s.strip() for s in _SENTENCE_RE.findall(text)]
    return [s for s in sentences if s] or ([text] if text else [])


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    denom = na * nb
    return dot / denom if denom else 0


def select_summary_sentences(sentences, embeddings, doc_embedding, count):
    """`embeddings[i]` must correspond to `sentences[i]`. Selected sentences
    are returned in their original order, not score order."""
    if len(sentences) <= count:
        return sentences
    scored = sorted(
        range(len(sentences)),
        key=lambda i: cosine_similarity(embeddings[i], doc_embedding),
        reverse=True,
    )[:count]
    return [sentences[i] for i in sorted(scored)]
