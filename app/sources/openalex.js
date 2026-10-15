import { getJson } from "./http.js";

const API = "https://api.openalex.org/works";
const ARXIV_SOURCE_ID = "S4306400194";
const ARXIV_DOI = /10\.48550\/arxiv\.(.+)$/i;
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i;
const SELECT = "title,publication_date,doi,abstract_inverted_index,authorships,locations";

export function rebuildAbstract(index) {
  if (!index) return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(" ");
}

export function arxivIdFromWork(work) {
  const fromDoi = (work.doi || "").match(ARXIV_DOI);
  if (fromDoi) return fromDoi[1];
  for (const loc of work.locations || []) {
    const m = (loc.landing_page_url || "").match(ARXIV_URL);
    if (m) return m[1];
  }
  return null;
}

export function normalizeWork(work) {
  const id = arxivIdFromWork(work);
  if (!id) return null;
  return {
    arxiv_id: id,
    source: "arxiv",
    title: work.title || "",
    abstract: rebuildAbstract(work.abstract_inverted_index),
    primary_category: null,
    categories: [],
    authors: (work.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean),
    published: work.publication_date || null,
    updated: null,
    abs_url: `https://arxiv.org/abs/${id}`,
    pdf_url: `https://arxiv.org/pdf/${id}.pdf`,
    doi: null,
    dedup_arxiv_id: id,
    venue: null,
  };
}

export function parseResponse(json) {
  return ((json && json.results) || []).map(normalizeWork).filter(Boolean);
}

function request(searchText, perPage, recentDays) {
  const filters = [`primary_location.source.id:${ARXIV_SOURCE_ID}`];
  if (recentDays > 0) {
    const from = new Date(Date.now() - recentDays * 86400000).toISOString().slice(0, 10);
    filters.push(`from_publication_date:${from}`);
  }
  const params = new URLSearchParams({
    filter: filters.join(","),
    search: searchText,
    "per-page": String(perPage),
    select: SELECT,
  });
  return getJson(`${API}?${params}`, "openalex");
}

export async function fetchForInterest(interest, { recentDays = 7, maxResults = 60 } = {}) {
  const text = (interest.keywords || []).join(" ") || interest.name;
  return parseResponse(await request(text, maxResults, recentDays));
}

export async function search(query, limit = 20) {
  return parseResponse(await request(query, limit, 0));
}
