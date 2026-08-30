// Save -> future-fetch feedback loop. JS port of the plan's
// compute_boost_keywords: turns saved papers into extra scoring keywords
// for the *next* fetch, without ever mutating the stored interest config.
// Deterministic and explainable, same heuristic style as scoring.js/
// heuristics.js — no ML model needed for this.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "with",
  "is", "are", "this", "that", "we", "our", "paper", "using", "based",
  "via", "from", "by", "as", "at", "be", "which", "can", "its", "into",
  "these", "their", "it", "than", "also", "such", "not", "but",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function daysBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime()) / 86400000;
}

// savedEntries: [{title, abstract, tags, savedAt}] — already the saved
// papers for one interest (caller joins `saved` + `papers` stores and
// filters by interest before calling this). existingKeywords: that
// interest's configured keyword list, never boosted since it's already
// active. Requires at least `minSaves` entries before contributing
// anything, an anti-overfit guard against a handful of early saves
// disproportionately steering future fetches.
export function computeBoostKeywords(savedEntries, existingKeywords, options = {}) {
  const {
    minSaves = 3,
    halfLifeDays = 60,
    maxKeywords = 5,
    now = new Date(),
  } = options;

  if (savedEntries.length < minSaves) return [];

  const existing = new Set((existingKeywords || []).map((k) => k.toLowerCase()));
  const weights = new Map();

  for (const entryItem of savedEntries) {
    const savedAt = entryItem.savedAt ? new Date(entryItem.savedAt) : now;
    const decay = Math.pow(0.5, daysBetween(now, savedAt) / halfLifeDays);
    const tagSet = new Set((entryItem.tags || []).map((t) => t.toLowerCase()));
    const tokens = tokenize(`${entryItem.title || ""} ${entryItem.abstract || ""}`);
    for (const token of tokens) {
      if (existing.has(token)) continue;
      const weight = decay * (tagSet.has(token) ? 2 : 1);
      weights.set(token, (weights.get(token) || 0) + weight);
    }
  }

  return Array.from(weights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([token]) => token);
}
