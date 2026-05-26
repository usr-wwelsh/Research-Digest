"""turbolab client — summaries via /v1/chat/completions, embeddings via /v1/embeddings.

turbolab is the self-hosted, OpenAI-compatible model server. Summaries come from the
loaded chat model; embeddings come from the dedicated e5 model exposed on the new
/v1/embeddings route. Every call degrades to None on failure so a stage can skip a
paper rather than crash the pipeline.
"""
import os
import re
import json
import time

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULTS = {
    "url": "http://localhost:7860",
    "chat_model": "default",
    "embed_model": "default",
    "passage_prefix": "passage: ",   # e5 requires these prefixes
    "query_prefix": "query: ",
    "chat_timeout": 120,
    "embed_timeout": 30,
    "retries": 4,
}


def load_config():
    cfg = dict(DEFAULTS)
    path = os.path.join(SCRIPT_DIR, "config.json")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                cfg.update(json.load(f).get("turbolab", {}))
        except (ValueError, OSError):
            pass
    if os.environ.get("TURBOLAB_URL"):
        cfg["url"] = os.environ["TURBOLAB_URL"]
    cfg["url"] = cfg["url"].rstrip("/")
    return cfg


CFG = load_config()


def _post(path, payload, timeout):
    """POST JSON with exponential backoff on 429/5xx/network errors. None on failure."""
    url = CFG["url"] + path
    delay = 2.0
    for attempt in range(CFG["retries"]):
        try:
            r = requests.post(url, json=payload, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429 or r.status_code >= 500:
                wait = float(r.headers.get("Retry-After", delay))
                print(f"  turbolab {r.status_code} on {path}, retry in {wait:.0f}s")
                time.sleep(wait)
                delay *= 2
                continue
            print(f"  turbolab {r.status_code} on {path}: {r.text[:200]}")
            return None
        except requests.RequestException as e:
            print(f"  turbolab request failed ({e}); retry in {delay:.0f}s")
            time.sleep(delay)
            delay *= 2
    return None


# --- embeddings ---

def embed(text, kind="passage"):
    """Return an embedding for `text`. kind: 'passage' (documents) or 'query'."""
    prefix = CFG["query_prefix"] if kind == "query" else CFG["passage_prefix"]
    data = _post("/v1/embeddings",
                 {"input": prefix + text, "model": CFG["embed_model"]},
                 CFG["embed_timeout"])
    try:
        vec = data["data"][0]["embedding"]
        return vec if vec else None
    except (TypeError, KeyError, IndexError):
        return None


# --- summaries ---

_SYSTEM = (
    "You are a precise research-paper summarizer. Respond with ONLY a single minified "
    "JSON object, no markdown, no commentary. Schema: "
    '{"summary": string (2-3 plain sentences, no jargon), '
    '"layman": string (one sentence: what it does and why it matters, for a non-expert), '
    '"difficulty": one of "Applied" | "Advanced" | "Theory-Heavy", '
    '"tags": array of 3-6 short lowercase topical tags}.'
)


def _extract_json(text):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?|\n?```$", "", text).strip()
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except ValueError:
                return None
    return None


def summarize(title, abstract):
    """Return {summary, layman, difficulty, tags} or None on failure."""
    user = f"Title: {title}\n\nAbstract: {abstract}"
    data = _post("/v1/chat/completions", {
        "model": CFG["chat_model"],
        "messages": [{"role": "system", "content": _SYSTEM},
                     {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_tokens": 400,
    }, CFG["chat_timeout"])
    try:
        content = data["choices"][0]["message"]["content"]
    except (TypeError, KeyError, IndexError):
        return None

    parsed = _extract_json(content)
    if not parsed or "summary" not in parsed:
        return None

    diff = str(parsed.get("difficulty", "Applied"))
    if diff not in ("Applied", "Advanced", "Theory-Heavy"):
        diff = "Applied"
    tags = parsed.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    return {
        "summary": str(parsed["summary"]).strip(),
        "layman": str(parsed.get("layman", "")).strip(),
        "difficulty": diff,
        "tags": [str(t).strip().lower() for t in tags if str(t).strip()][:6],
    }


def healthcheck():
    try:
        r = requests.get(CFG["url"] + "/v1/models", timeout=5)
        return r.status_code == 200
    except requests.RequestException:
        return False


if __name__ == "__main__":
    print("turbolab:", CFG["url"], "| reachable:", healthcheck())
