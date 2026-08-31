import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeEntry, dateFilter, buildSearchQuery } from "../sources/arxiv.js";
import { normalizeResult, parseResponse as parseS2Response } from "../sources/semanticscholar.js";
import { normalizeNote, parseResponse as parseOpenReviewResponse } from "../sources/openreview.js";

// --- arxiv.js: normalizeEntry is the pure half of parseFeed (the DOM half
// needs a real DOMParser and is verified manually in-browser) ---

test("arxiv normalizeEntry extracts a bare id without the version suffix", () => {
  const p = normalizeEntry({ id: "http://arxiv.org/abs/2508.01234v2", title: "T", summary: "S" });
  assert.equal(p.arxiv_id, "2508.01234");
  assert.equal(p.source, "arxiv");
});

test("arxiv normalizeEntry collapses whitespace in title and abstract", () => {
  const p = normalizeEntry({
    id: "http://arxiv.org/abs/2508.01234v1",
    title: "  Efficient   Edge   Inference  ",
    summary: "Line one\n  line two.",
  });
  assert.equal(p.title, "Efficient Edge Inference");
  assert.equal(p.abstract, "Line one line two.");
});

test("arxiv normalizeEntry derives pdf_url and truncates dates to YYYY-MM-DD", () => {
  const p = normalizeEntry({
    id: "http://arxiv.org/abs/2508.01234v1",
    title: "T",
    summary: "S",
    published: "2026-08-15T12:00:00Z",
    updated: "2026-08-20T09:30:00Z",
  });
  assert.equal(p.pdf_url, "https://arxiv.org/pdf/2508.01234.pdf");
  assert.equal(p.published, "2026-08-15");
  assert.equal(p.updated, "2026-08-20");
});

test("arxiv normalizeEntry handles missing dates/categories/authors", () => {
  const p = normalizeEntry({ id: "http://arxiv.org/abs/2508.01234v1", title: "T", summary: "S" });
  assert.equal(p.published, null);
  assert.deepEqual(p.categories, []);
  assert.deepEqual(p.authors, []);
});

test("arxiv dateFilter is empty for zero/negative/missing days", () => {
  assert.equal(dateFilter(0), "");
  assert.equal(dateFilter(-1), "");
  assert.equal(dateFilter(undefined), "");
});

test("arxiv dateFilter builds a submittedDate range", () => {
  const f = dateFilter(7);
  assert.match(f, /^submittedDate:\[\d{8}0000 TO \d{8}2359\]$/);
});

test("arxiv buildSearchQuery prefers query_by_source.arxiv when present", () => {
  const q = buildSearchQuery({ query_by_source: { arxiv: "cat:cs.LG" }, query: "ignored" }, 0);
  assert.equal(q, "cat:cs.LG");
});

test("arxiv buildSearchQuery falls back to a free-text keyword query for a custom interest", () => {
  const q = buildSearchQuery({ keywords: ["edge", "quantization"] }, 0);
  assert.equal(q, "all:edge OR quantization");
});

test("arxiv buildSearchQuery appends the date filter when recentDays is set", () => {
  const q = buildSearchQuery({ query: "cat:cs.LG" }, 7);
  assert.match(q, /^\(cat:cs\.LG\) AND submittedDate:\[/);
});

// --- semanticscholar.js: fully JSON, fully pure ---

test("semanticscholar normalizeResult maps fields and prefixes the id", () => {
  const p = normalizeResult({
    paperId: "abc123",
    title: "A Paper",
    abstract: "An abstract.",
    authors: [{ name: "Ada Researcher" }, { name: "Bo Scientist" }],
    venue: "NeurIPS",
    publicationDate: "2026-03-01",
    externalIds: { DOI: "10.1/x", ArXiv: "2508.01234" },
    openAccessPdf: { url: "https://example.com/x.pdf" },
  });
  assert.equal(p.arxiv_id, "s2:abc123");
  assert.equal(p.source, "semanticscholar");
  assert.deepEqual(p.authors, ["Ada Researcher", "Bo Scientist"]);
  assert.equal(p.doi, "10.1/x");
  assert.equal(p.dedup_arxiv_id, "2508.01234");
  assert.equal(p.pdf_url, "https://example.com/x.pdf");
});

test("semanticscholar normalizeResult tolerates missing optional fields", () => {
  const p = normalizeResult({ paperId: "abc123", title: "A Paper" });
  assert.equal(p.abstract, "");
  assert.deepEqual(p.authors, []);
  assert.equal(p.pdf_url, null);
  assert.equal(p.dedup_arxiv_id, null);
});

test("semanticscholar parseResponse maps the data array, empty when absent", () => {
  assert.equal(parseS2Response({}).length, 0);
  assert.equal(parseS2Response({ data: [{ paperId: "a", title: "T" }] }).length, 1);
});

// --- openreview.js: v2 notes, content fields may be raw or {value} wrapped ---

test("openreview normalizeNote unwraps {value} content fields", () => {
  const p = normalizeNote({
    id: "xyz789",
    cdate: 1700000000000,
    content: {
      title: { value: "A Submission" },
      abstract: { value: "An abstract." },
      authors: { value: ["Ada Researcher"] },
      venue: { value: "ICLR 2026" },
    },
  });
  assert.equal(p.arxiv_id, "or:xyz789");
  assert.equal(p.source, "openreview");
  assert.equal(p.title, "A Submission");
  assert.deepEqual(p.authors, ["Ada Researcher"]);
  assert.equal(p.venue, "ICLR 2026");
  assert.equal(p.abs_url, "https://openreview.net/forum?id=xyz789");
  assert.equal(p.pdf_url, "https://openreview.net/pdf?id=xyz789");
});

test("openreview normalizeNote also accepts raw (non-wrapped) content fields", () => {
  const p = normalizeNote({ id: "xyz789", content: { title: "Raw Title", abstract: "Raw abstract" } });
  assert.equal(p.title, "Raw Title");
  assert.equal(p.abstract, "Raw abstract");
});

test("openreview normalizeNote tolerates missing content entirely", () => {
  const p = normalizeNote({ id: "xyz789" });
  assert.equal(p.title, "");
  assert.deepEqual(p.authors, []);
});

test("openreview normalizeNote unwraps per-entry {value}-wrapped authors too", () => {
  const p = normalizeNote({
    id: "xyz789",
    content: { title: "T", authors: { value: [{ value: "Ada Researcher" }, "Zed Zed"] } },
  });
  assert.deepEqual(p.authors, ["Ada Researcher", "Zed Zed"]);
});

test("openreview parseResponse maps the notes array, empty when absent", () => {
  assert.equal(parseOpenReviewResponse({}).length, 0);
  assert.equal(parseOpenReviewResponse({ notes: [{ id: "a" }] }).length, 1);
});
