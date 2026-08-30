// OpenReview source adapter. API v2 notes are public/keyless for read
// access at this volume (confirmed); content fields may be raw values or
// {value: ...} wrapped depending on the invitation schema, so unwrap both.
const RELAY_BASE = "/relay/openreview";

function fieldValue(v) {
  if (v == null) return null;
  if (typeof v === "object" && "value" in v) return v.value;
  return v;
}

export function normalizeNote(note) {
  const content = note.content || {};
  let authors = fieldValue(content.authors) || [];
  if (!Array.isArray(authors)) authors = [];
  const createdMs = note.cdate || note.pdate || null;
  const published = createdMs ? new Date(createdMs).toISOString().slice(0, 10) : null;
  return {
    arxiv_id: `or:${note.id}`,
    source: "openreview",
    title: fieldValue(content.title) || "",
    abstract: fieldValue(content.abstract) || "",
    primary_category: null,
    categories: [],
    authors,
    published,
    updated: published,
    abs_url: `https://openreview.net/forum?id=${note.id}`,
    pdf_url: `https://openreview.net/pdf?id=${note.id}`,
    doi: null,
    dedup_arxiv_id: null,
    venue: fieldValue(content.venue) || null,
  };
}

export function parseResponse(json) {
  const notes = (json && json.notes) || [];
  return notes.map(normalizeNote);
}

export async function search(query, limit = 20) {
  const params = new URLSearchParams({ term: query, limit: String(limit) });
  const res = await fetch(`${RELAY_BASE}?${params}`);
  if (!res.ok) throw new Error(`openreview relay error: ${res.status}`);
  return parseResponse(await res.json());
}

export async function fetchForInterest(interest, { limit = 20 } = {}) {
  const query =
    (interest.query_by_source && interest.query_by_source.openreview) ||
    (interest.keywords || []).join(" ") ||
    interest.name;
  return search(query, limit);
}
