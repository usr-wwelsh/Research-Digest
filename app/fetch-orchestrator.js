// Runs a client-side fetch cycle: pull candidates from each of an
// interest's enabled sources, dedup against the existing corpus (and
// against each other within the same run), score+rank new candidates,
// merge new external ids into existing matches, and write the result to
// IndexedDB. Boost keywords from feedback.js are folded into scoring
// before any of this runs, for this run only — the interest's own
// configured keywords are never mutated.
import { getAll, putMany, getSetting, setSetting } from "./db.js";
import { score } from "./scoring.js";
import { findDuplicate } from "./dedup.js";
import { computeBoostKeywords } from "./feedback.js";
import * as arxivSource from "./sources/arxiv.js";
import * as semanticscholarSource from "./sources/semanticscholar.js";
import * as openreviewSource from "./sources/openreview.js";

const SOURCE_MODULES = {
  arxiv: arxivSource,
  semanticscholar: semanticscholarSource,
  openreview: openreviewSource,
};

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;

function mergeIntoExisting(existing, candidate) {
  const merged = { ...existing };
  if (!merged.doi && candidate.doi) merged.doi = candidate.doi;
  if (!merged.venue && candidate.venue) merged.venue = candidate.venue;
  return merged;
}

// Pure planning core — no IndexedDB, no network. Given this run's raw
// candidates and the existing corpus, decides what's a genuinely new paper
// (scored, ranked, trimmed to maxPapers) vs a duplicate whose external ids
// should be merged into an existing record (never overwriting fields it
// already has — "never clobber, only add").
export function planFetch(candidates, existingPapers, interest, effectiveKeywords, maxPapers = 25) {
  const pool = existingPapers.slice();
  const newCandidates = [];
  const merges = [];

  for (const candidate of candidates) {
    const dup = findDuplicate(candidate, pool);
    if (dup) {
      merges.push(mergeIntoExisting(dup, candidate));
      continue;
    }
    const withMeta = { ...candidate, interest, score: score(candidate, effectiveKeywords) };
    newCandidates.push(withMeta);
    pool.push(withMeta);
  }

  newCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { insert: newCandidates.slice(0, maxPapers), merge: merges };
}

async function boostKeywordsFor(interest) {
  const [savedRows, papers] = await Promise.all([getAll("saved"), getAll("papers")]);
  const paperById = new Map(papers.map((p) => [p.arxiv_id, p]));
  const entries = savedRows
    .map((s) => {
      const p = paperById.get(s.arxiv_id);
      if (!p || p.interest !== interest.name) return null;
      return { title: p.title, abstract: p.abstract, tags: p.tags, savedAt: s.saved_at };
    })
    .filter(Boolean);
  return computeBoostKeywords(entries, interest.keywords, {});
}

async function fetchOneInterest(interest) {
  const sources = interest.sources && interest.sources.length ? interest.sources : ["arxiv"];
  const boost = await boostKeywordsFor(interest);
  const effectiveKeywords = [...(interest.keywords || []), ...boost];

  const candidates = [];
  for (const sourceName of sources) {
    const mod = SOURCE_MODULES[sourceName];
    if (!mod) continue;
    try {
      candidates.push(...(await mod.fetchForInterest(interest)));
    } catch (err) {
      console.warn(`fetch-orchestrator: ${sourceName} failed for "${interest.name}"`, err);
    }
  }

  const existingPapers = await getAll("papers");
  const { insert, merge } = planFetch(candidates, existingPapers, interest.name, effectiveKeywords, interest.maxPapers || 25);

  const toWrite = [...insert, ...merge];
  if (toWrite.length) await putMany("papers", toWrite);
  return insert.length;
}

export async function runFetchCycle(interests) {
  let total = 0;
  for (const interest of interests.filter((i) => i.enabled !== false)) {
    total += await fetchOneInterest(interest);
  }
  await setSetting("last_fetch_at", new Date().toISOString());
  return total;
}

export async function isStale(maxAgeMs = DEFAULT_STALE_MS) {
  const last = await getSetting("last_fetch_at", null);
  if (!last) return true;
  return Date.now() - new Date(last).getTime() > maxAgeMs;
}
