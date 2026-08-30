// Ported verbatim from local_ai.py's _difficulty/_layman/_tags — same
// keyword tables, same thresholds, same behavior, just JS instead of
// Python. These are deterministic keyword heuristics, not model output;
// no reason to redesign them for the client-side rewrite.
const COMPLEXITY_WORDS = ["theoretical", "proof", "theorem", "convergence", "optimal",
  "asymptotic", "lemma", "proposition", "rigorous", "formalism"];
const APPLIED_WORDS = ["system", "framework", "application", "dataset", "benchmark",
  "implementation", "experiment", "empirical", "practical"];
const MATH_CATEGORIES = ["math.", "stat.", "quant-ph"];

export function difficulty(abstract, category) {
  const text = (abstract || "").toLowerCase();
  let score = 0;
  for (const w of COMPLEXITY_WORDS) if (text.includes(w)) score += 1;
  for (const w of APPLIED_WORDS) if (text.includes(w)) score -= 0.5;
  if (category && MATH_CATEGORIES.some((c) => category.startsWith(c))) score += 1;
  if (score > 2) return "Theory-Heavy";
  if (score > 0.5) return "Advanced";
  return "Applied";
}

const ACTION_MAP = [
  ["improv", "improves"], ["reduc", "reduces"], ["enhanc", "enhances"],
  ["optimi", "optimizes"], ["acceler", "speeds up"], ["efficient", "makes more efficient"],
  ["novel", "introduces a new approach to"], ["outperform", "works better than existing methods for"],
  ["achiev", "achieves better"], ["propose", "proposes a method for"],
  ["present", "presents techniques for"], ["address", "tackles the problem of"],
  ["privacy", "protecting data privacy in"], ["federated", "distributed machine learning across"],
  ["emotion", "understanding emotions in"], ["embedded", "running AI on low-power devices for"],
  ["edge", "running AI locally on devices for"], ["compression", "making models smaller for"],
  ["inference", "faster predictions in"], ["generative", "creating new content with"],
  ["detection", "automatically finding"], ["classification", "categorizing"],
  ["prediction", "forecasting"],
];

const DOMAIN_MAP = [
  [["language model", "llm", "nlp"], "language AI"],
  [["vision", "image", "visual"], "computer vision"],
  [["speech", "audio"], "speech processing"],
  [["privacy", "federated"], "privacy-preserving AI"],
  [["edge", "embedded", "device"], "edge computing"],
  [["emotion", "affective"], "emotion AI"],
];

export function layman(abstract) {
  const text = (abstract || "").toLowerCase();
  const head = text.slice(0, 300);
  const action = (ACTION_MAP.find(([kw]) => head.includes(kw)) || [null, "explores techniques in"])[1];
  const domain = (DOMAIN_MAP.find(([kws]) => kws.some((kw) => text.includes(kw))) || [null, "machine learning"])[1];
  return `This research ${action} ${domain}.`;
}

export function tags(title, abstract, keywords) {
  const text = `${title} ${abstract}`.toLowerCase();
  const matched = (keywords || []).filter((kw) => text.includes(kw.toLowerCase())).map((kw) => kw.toLowerCase());
  return matched.slice(0, 6);
}
