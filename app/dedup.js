// Cross-source dedup: before inserting a non-arXiv result, check whether it
// already exists in the local corpus. On a match, callers should merge
// external ids into the existing record rather than inserting a duplicate —
// the same "never clobber, only add" ethos as db.upsert_paper on the server
// side.
function normalizeTitle(t) {
  return (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstAuthor(authors) {
  const a = authors && authors[0];
  return typeof a === "string" ? a.toLowerCase() : "";
}

export function findDuplicate(candidate, existingPapers) {
  if (candidate.dedup_arxiv_id) {
    const match = existingPapers.find((p) => p.arxiv_id === candidate.dedup_arxiv_id);
    if (match) return match;
  }
  if (candidate.doi) {
    const match = existingPapers.find((p) => p.doi && p.doi === candidate.doi);
    if (match) return match;
  }
  const candTitle = normalizeTitle(candidate.title);
  const candAuthor = firstAuthor(candidate.authors);
  if (candTitle && candAuthor) {
    const match = existingPapers.find(
      (p) => normalizeTitle(p.title) === candTitle && firstAuthor(p.authors) === candAuthor
    );
    if (match) return match;
  }
  return null;
}
