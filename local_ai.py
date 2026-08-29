"""local_ai — in-process summarization and embeddings. No server, no network.

Summaries come from DistilBART (sshleifer/distilbart-cnn-12-6, CPU). It only produces
a summary string — no structured output — so layman explanation and difficulty are
keyword heuristics (cheap, deterministic, carried over from v1) and tags are keywords
from the paper's matched interest that actually appear in its text. Embeddings are
mean-pooled DistilBERT hidden states, used only for coarse "related papers" similarity.

Models are loaded lazily and cached at module scope, so a stage that finds nothing
to do never pays the load cost. A model that fails to load (no internet on first
run, no disk space, etc.) is remembered as unavailable rather than retried per paper.
"""
import os
import json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULTS = {
    "summarizer_model": "sshleifer/distilbart-cnn-12-6",
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

_summarizer_tokenizer = None
_summarizer_model = None
_summarizer_failed = False
_embed_tokenizer = None
_embed_model = None
_embedder_failed = False


def _load_summarizer():
    """Load tokenizer + seq2seq model directly (not the `pipeline` task shortcut,
    whose task-name registry has churned across transformers major versions)."""
    global _summarizer_tokenizer, _summarizer_model, _summarizer_failed
    if _summarizer_model is not None or _summarizer_failed:
        return _summarizer_model
    try:
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
        _summarizer_tokenizer = AutoTokenizer.from_pretrained(CFG["summarizer_model"])
        _summarizer_model = AutoModelForSeq2SeqLM.from_pretrained(CFG["summarizer_model"])
        _summarizer_model.eval()
    except Exception as e:
        print(f"  local_ai: summarizer unavailable ({e})")
        _summarizer_failed = True
    return _summarizer_model


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
    return _load_summarizer() is not None



def embedder_available():
    return _load_embedder()[1] is not None


def warm():
    """Force both models to load (and download weights on first run)."""
    _load_summarizer()
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
    """Return {summary, layman, difficulty, tags} or None if the summarizer is unavailable."""
    model = _load_summarizer()
    if model is None:
        return None
    text = abstract or title
    if len(text.split()) < 15:
        summary = text
    else:
        import torch
        max_len = min(CFG.get("summary_max_length", 142), 142)
        inputs = _summarizer_tokenizer(text, return_tensors="pt", truncation=True, max_length=1024)
        with torch.no_grad():
            out = model.generate(**inputs, max_length=max_len, min_length=30,
                                  num_beams=4, early_stopping=True)
        summary = _summarizer_tokenizer.decode(out[0], skip_special_tokens=True)
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
    print("local_ai:", CFG["summarizer_model"], "/", CFG["embedding_model"],
          "| summarizer:", summarizer_available(), "| embedder:", embedder_available())
