// Semantic Scholar source adapter. Keyless at this volume (confirmed).
// Routed through relay.py like every other source, uniformly — not because
// S2's own CORS support is known either way, but to keep one code path.
const RELAY_BASE = "/relay/semanticscholar";
const FIELDS = "paperId,title,abstract,authors,venue,year,publicationDate,externalIds,openAccessPdf";

export function normalizeResult(item) {
  const externalIds = item.externalIds || {};
  return {
    arxiv_id: `s2:${item.paperId}`,
    source: "semanticscholar",
    title: item.title || "",
    abstract: item.abstract || "",
    primary_category: null,
    categories: [],
    authors: (item.authors || []).map((a) => a.name).filter(Boolean),
    published: item.publicationDate || (item.year ? `${item.year}-01-01` : null),
    updated: item.publicationDate || null,
    abs_url: `https://www.semanticscholar.org/paper/${item.paperId}`,
    pdf_url: (item.openAccessPdf && item.openAccessPdf.url) || null,
    doi: externalIds.DOI || null,
    dedup_arxiv_id: externalIds.ArXiv || null,
    venue: item.venue || null,
  };
}

export function parseResponse(json) {
  const data = (json && json.data) || [];
  return data.map(normalizeResult);
}

export async function search(query, limit = 20) {
  const params = new URLSearchParams({ query, limit: String(limit), fields: FIELDS });
  const res = await fetch(`${RELAY_BASE}?${params}`);
  if (!res.ok) throw new Error(`semanticscholar relay error: ${res.status}`);
  return parseResponse(await res.json());
}

export async function fetchForInterest(interest, { limit = 20 } = {}) {
  const query =
    (interest.query_by_source && interest.query_by_source.semanticscholar) ||
    (interest.keywords || []).join(" ") ||
    interest.name;
  return search(query, limit);
}
