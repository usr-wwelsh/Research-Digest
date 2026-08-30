import { test } from "node:test";
import assert from "node:assert/strict";
import { difficulty, layman, tags } from "../heuristics.js";

// Ported verbatim from local_ai.py's _difficulty/_layman/_tags — same
// keyword tables, same thresholds, same behavior, just JS instead of Python.

test("difficulty: theory-heavy when complexity words dominate", () => {
  const abstract = "We give a rigorous proof of a theorem establishing convergence " +
    "under an optimal asymptotic bound, with a formal lemma and proposition.";
  assert.equal(difficulty(abstract, "cs.LG"), "Theory-Heavy");
});

test("difficulty: math/stat/quant-ph categories nudge the score up", () => {
  const abstract = "We prove a theorem about convergence.";
  assert.equal(difficulty(abstract, "math.OC"), "Theory-Heavy");
});

test("difficulty: applied words pull the score down", () => {
  const abstract = "We present a practical system and framework, evaluated on a " +
    "benchmark dataset with an empirical implementation and experiments.";
  assert.equal(difficulty(abstract, "cs.LG"), "Applied");
});

test("difficulty: defaults to Applied for a plain empty-ish abstract", () => {
  assert.equal(difficulty("", ""), "Applied");
});

test("layman: matches an action phrase from the abstract's opening and a domain", () => {
  const text = layman("This paper proposes a method for federated learning across devices.");
  assert.match(text, /^This research /);
  assert.match(text, /privacy-preserving AI/);
});

test("layman: falls back to generic action/domain when nothing matches", () => {
  const text = layman("Lorem ipsum dolor sit amet.");
  assert.equal(text, "This research explores techniques in machine learning.");
});

test("tags: returns only interest keywords that actually appear in the text, capped at 6", () => {
  const t = tags("Efficient Edge Inference", "quantization and pruning for edge devices",
    ["efficient", "edge", "quantization", "pruning", "unrelated-keyword"]);
  assert.deepEqual(t, ["efficient", "edge", "quantization", "pruning"]);
});

test("tags: empty when the interest has no keyword list", () => {
  assert.deepEqual(tags("Title", "abstract text", []), []);
});
