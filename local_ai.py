"""local_ai — in-process summarization and embeddings. No server, no network.

Summaries are extractive (see extractive.py): the sentence(s) of the abstract closest
to its own mean-pooled DistilBERT embedding, picked by cosine similarity — no
generation, so the only model needed is the same DistilBERT used for "related papers"
embeddings. Layman explanation and difficulty are keyword heuristics (cheap,
deterministic, carried over from v1) and tags are keywords from the paper's matched
interest that actually appear in its text.

The model is loaded lazily and cached at module scope, so a stage that finds nothing
to do never pays the load cost. A model that fails to load (no internet on first
run, no disk space, etc.) is remembered as unavailable rather than retried per paper.
"""
import os
import json

import extractive

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

SUMMARY_SENTENCE_COUNT = 2

DEFAULTS = {
    "embedding_model": "distilbert-base-uncased",
}


def load_config():
    cfg = dict(DEFAULTS)
    path = os.path.join(SCRIPT_DIR, "config.json")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
                cfg.update(data.get("local_ai", {}))
                cfg["interests"] = data.get("interests", {})
        except (ValueError, OSError):
            pass
    cfg.setdefault("interests", {})
    return cfg


CFG = load_config()

_embed_tokenizer = None
_embed_model = None
_embedder_failed = False


def _load_embedder():
    global _embed_tokenizer, _embed_model, _embedder_failed
    if _embed_model is not None or _embedder_failed:
        return _embed_tokenizer, _embed_model
    try:
        from transformers import AutoTokenizer, AutoModel
        _embed_tokenizer = AutoTokenizer.from_pretrained(CFG["embedding_model"])
        _embed_model = AutoModel.from_pretrained(CFG["embedding_model"])
        _embed_model.eval()
    except Exception as e:
        print(f"  local_ai: embedder unavailable ({e})")
        _embedder_failed = True
    return _embed_tokenizer, _embed_model


def summarizer_available():
    """Summarization is extractive, so it needs only the embedder."""
    return embedder_available()


def embedder_available():
    return _load_embedder()[1] is not None


def warm():
    """Force the model to load (and download weights on first run)."""
    _load_embedder()


# --- difficulty / layman heuristics (no model — v1's keyword scoring) ---

_COMPLEXITY_WORDS = ("theoretical", "proof", "theorem", "convergence", "optimal",
                      "asymptotic", "lemma", "proposition", "rigorous", "formalism")
_APPLIED_WORDS = ("system", "framework", "application", "dataset", "benchmark",
                   "implementation", "experiment", "empirical", "practical")
_MATH_CATEGORIES = ("math.", "stat.", "quant-ph")


def _difficulty(abstract, category):
    text = abstract.lower()
    score = sum(1 for w in _COMPLEXITY_WORDS if w in text)
    score -= sum(0.5 for w in _APPLIED_WORDS if w in text)
    if category and category.startswith(_MATH_CATEGORIES):
        score += 1
    if score > 2:
        return "Theory-Heavy"
    if score > 0.5:
        return "Advanced"
    return "Applied"


_ACTION_MAP = (
    ("improv", "improves"), ("reduc", "reduces"), ("enhanc", "enhances"),
    ("optimi", "optimizes"), ("acceler", "speeds up"), ("efficient", "makes more efficient"),
    ("novel", "introduces a new approach to"), ("outperform", "works better than existing methods for"),
    ("achiev", "achieves better"), ("propose", "proposes a method for"),
    ("present", "presents techniques for"), ("address", "tackles the problem of"),
    ("privacy", "protecting data privacy in"), ("federated", "distributed machine learning across"),
    ("emotion", "understanding emotions in"), ("embedded", "running AI on low-power devices for"),
    ("edge", "running AI locally on devices for"), ("compression", "making models smaller for"),
    ("inference", "faster predictions in"), ("generative", "creating new content with"),
    ("detection", "automatically finding"), ("classification", "categorizing"),
    ("prediction", "forecasting"),
)

_DOMAIN_MAP = (
    (("language model", "llm", "nlp"), "language AI"),
    (("vision", "image", "visual"), "computer vision"),
    (("speech", "audio"), "speech processing"),
    (("privacy", "federated"), "privacy-preserving AI"),
    (("edge", "embedded", "device"), "edge computing"),
    (("emotion", "affective"), "emotion AI"),
)


def _layman(abstract):
    text = abstract.lower()
    head = text[:300]
    action = next((phrase for kw, phrase in _ACTION_MAP if kw in head), "explores techniques in")
    domain = next((name for kws, name in _DOMAIN_MAP if any(kw in text for kw in kws)), "machine learning")
    return f"This research {action} {domain}."


def _tags(title, abstract, interest):
    keywords = CFG["interests"].get(interest, {}).get("keywords", [])
    text = f"{title} {abstract}".lower()
    matched = [kw.lower() for kw in keywords if kw.lower() in text]
    return matched[:6]


# --- summarize / embed ---

def summarize(title, abstract, category=None, interest=None):
    """Return {summary, layman, difficulty, tags} or None if the embedder is unavailable."""
    if not embedder_available():
        return None
    text = abstract or title
    if len(text.split()) < 15:
        summary = text
    else:
        sentences = extractive.split_sentences(text)
        if len(sentences) <= SUMMARY_SENTENCE_COUNT:
            summary = text
        else:
            doc_embedding = embed(text)
            embeddings = [embed(s) for s in sentences]
            summary = " ".join(extractive.select_summary_sentences(
                sentences, embeddings, doc_embedding, SUMMARY_SENTENCE_COUNT))
    return {
        "summary": summary.strip(),
        "layman": _layman(abstract or title),
        "difficulty": _difficulty(abstract or title, category or ""),
        "tags": _tags(title, abstract or "", interest),
    }


def _mean_pool(last_hidden_state, attention_mask):
    mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
    summed = (last_hidden_state * mask).sum(1)
    counts = mask.sum(1).clamp(min=1e-9)
    return summed / counts


def embed(text):
    """Return a mean-pooled DistilBERT embedding for `text`, or None if unavailable."""
    tokenizer, model = _load_embedder()
    if model is None:
        return None
    import torch
    with torch.no_grad():
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512, padding=True)
        out = model(**inputs)
        vec = _mean_pool(out.last_hidden_state, inputs["attention_mask"])[0]
    return vec.tolist()


if __name__ == "__main__":
    print("local_ai:", CFG["embedding_model"],
          "| summarizer (extractive):", summarizer_available(), "| embedder:", embedder_available())
