// arXiv source adapter. All calls go through relay.py — arXiv sends no
// Access-Control-Allow-Origin header (confirmed by direct testing), so a
// browser cannot fetch export.arxiv.org directly.
const RELAY_BASE = "/relay/arxiv";
const NS = { atom: "http://www.w3.org/2005/Atom", arxiv: "http://arxiv.org/schemas/atom" };

function collapseWhitespace(s) {
  return (s || "").split(/\s+/).filter(Boolean).join(" ");
}

// Pure normalization: Atom-entry fields -> the shared paper shape. Split out
// from parseFeed() so it's testable without a DOMParser (unavailable in
// Node); parseFeed's DOM-walking is thin enough to verify manually.
export function normalizeEntry(fields) {
  const link = (fields.id || "").trim();
  const arxivId = link.split("/abs/").pop().split("v")[0];
  return {
    arxiv_id: arxivId,
    source: "arxiv",
    title: collapseWhitespace(fields.title),
    abstract: collapseWhitespace(fields.summary),
    primary_category: fields.primaryCategory || (fields.categories && fields.categories[0]) || null,
    categories: fields.categories || [],
    authors: fields.authors || [],
    published: fields.published ? fields.published.split("T")[0] : null,
    updated: fields.updated ? fields.updated.split("T")[0] : null,
    abs_url: link,
    pdf_url: `https://arxiv.org/pdf/${arxivId}.pdf`,
    doi: null,
    dedup_arxiv_id: arxivId,
    venue: null,
  };
}

export function dateFilter(days) {
  if (!days || days <= 0) return "";
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  return `submittedDate:[${fmt(start)}0000 TO ${fmt(end)}2359]`;
}

function textOf(el) {
  return el ? el.textContent : null;
}

// DOM-dependent glue — walks the Atom XML and delegates to normalizeEntry.
// Requires a real browser DOMParser; not unit-tested under Node, verified
// manually in-browser (see plan's testing strategy).
export function parseFeed(xmlText) {
  if (!xmlText) return [];
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return [];
  const entries = Array.from(doc.getElementsByTagNameNS(NS.atom, "entry"));
  return entries
    .map((entry) => {
      const idEl = entry.getElementsByTagNameNS(NS.atom, "id")[0];
      const titleEl = entry.getElementsByTagNameNS(NS.atom, "title")[0];
      const summaryEl = entry.getElementsByTagNameNS(NS.atom, "summary")[0];
      if (!idEl || !titleEl || !summaryEl) return null;
      const primaryCatEl = entry.getElementsByTagNameNS(NS.arxiv, "primary_category")[0];
      const categories = Array.from(entry.getElementsByTagNameNS(NS.atom, "category"))
        .map((c) => c.getAttribute("term"))
        .filter(Boolean);
      const authors = Array.from(entry.getElementsByTagNameNS(NS.atom, "author"))
        .map((a) => textOf(a.getElementsByTagNameNS(NS.atom, "name")[0]))
        .filter(Boolean);
      return normalizeEntry({
        id: textOf(idEl),
        title: textOf(titleEl),
        summary: textOf(summaryEl),
        published: textOf(entry.getElementsByTagNameNS(NS.atom, "published")[0]),
        updated: textOf(entry.getElementsByTagNameNS(NS.atom, "updated")[0]),
        primaryCategory: primaryCatEl ? primaryCatEl.getAttribute("term") : null,
        categories,
        authors,
      });
    })
    .filter(Boolean);
}

export async function fetchForInterest(interest, { recentDays = 7, maxResults = 60 } = {}) {
  const df = dateFilter(recentDays);
  const query = (interest.query_by_source && interest.query_by_source.arxiv) || interest.query;
  const searchQuery = df ? `(${query}) AND ${df}` : query;
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: String(maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending",
  });
  const res = await fetch(`${RELAY_BASE}?${params}`);
  if (!res.ok) throw new Error(`arxiv relay error: ${res.status}`);
  return parseFeed(await res.text());
}

export async function search(query, limit = 20) {
  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: "0",
    max_results: String(limit),
    sortBy: "relevance",
    sortOrder: "descending",
  });
  const res = await fetch(`${RELAY_BASE}?${params}`);
  if (!res.ok) throw new Error(`arxiv relay error: ${res.status}`);
  return parseFeed(await res.text());
}
