import { getJson } from "./http.js";

const API = "https://api.datacite.org/dois";
const ARXIV_DOI_PREFIX = "10.48550/arxiv.";

const collapseWhitespace = (s) => (s || "").split(/\s+/).filter(Boolean).join(" ");
const day = (iso) => (iso ? iso.split("T")[0] : null);
const dateOf = (dates, type) => (dates || []).find((d) => d.dateType === type);

export function categoriesFromQuery(query) {
  return Array.from((query || "").matchAll(/cat:([A-Za-z0-9.-]+)/g), (m) => m[1]);
}

function arxivIdOf(attrs) {
  const ident = (attrs.identifiers || []).find((i) => i.identifierType === "arXiv");
  if (ident) return ident.identifier;
  const doi = (attrs.doi || "").toLowerCase();
  return doi.startsWith(ARXIV_DOI_PREFIX) ? doi.slice(ARXIV_DOI_PREFIX.length) : null;
}

function authorName(c) {
  return c.givenName && c.familyName ? `${c.givenName} ${c.familyName}` : c.name;
}

export function normalizeRecord(attrs) {
  const id = arxivIdOf(attrs);
  if (!id) return null;
  const categories = (attrs.subjects || [])
    .filter((s) => s.subjectScheme === "arXiv")
    .map((s) => (s.subject.match(/\(([^()]+)\)\s*$/) || [])[1])
    .filter(Boolean);
  const abstract = (attrs.descriptions || []).find((d) => d.descriptionType === "Abstract");
  const submitted = dateOf(attrs.dates, "Submitted");
  const updated = dateOf(attrs.dates, "Updated");
  return {
    arxiv_id: id,
    source: "arxiv",
    title: collapseWhitespace(attrs.titles && attrs.titles[0] && attrs.titles[0].title),
    abstract: collapseWhitespace(abstract && abstract.description),
    primary_category: categories[0] || null,
    categories,
    authors: (attrs.creators || []).map(authorName).filter(Boolean),
    published: day(submitted ? submitted.date : attrs.created),
    updated: updated ? day(updated.date) : null,
    abs_url: `https://arxiv.org/abs/${id}`,
    pdf_url: `https://arxiv.org/pdf/${id}.pdf`,
    doi: null,
    dedup_arxiv_id: id,
    venue: null,
  };
}

export function parseResponse(json) {
  const data = (json && json.data) || [];
  return data.map((d) => normalizeRecord(d.attributes || {})).filter(Boolean);
}

export function dateFilter(days, now = new Date()) {
  if (!days || days <= 0) return "";
  const fmt = (d) => d.toISOString().slice(0, 10);
  return `created:[${fmt(new Date(now.getTime() - days * 86400000))} TO ${fmt(now)}]`;
}

export function buildQuery(interest, recentDays, now) {
  const cats = categoriesFromQuery(
    (interest.query_by_source && interest.query_by_source.arxiv) || interest.query,
  );
  const topic = cats.length
    ? `(${cats.map((c) => `subjects.subject:"${c}"`).join(" OR ")})`
    : `(${(interest.keywords || []).join(" OR ")})`;
  const df = dateFilter(recentDays, now);
  return df ? `${topic} AND ${df}` : topic;
}

function request(query, size) {
  const params = new URLSearchParams({
    prefix: "10.48550",
    query,
    sort: "-created",
    "page[size]": String(size),
  });
  return getJson(`${API}?${params}`, "datacite");
}

export async function fetchForInterest(interest, { recentDays = 7, maxResults = 60 } = {}) {
  return parseResponse(await request(buildQuery(interest, recentDays), maxResults));
}

export async function search(query, limit = 20) {
  return parseResponse(await request(`(${query})`, limit));
}
