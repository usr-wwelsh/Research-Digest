import { test } from "node:test";
import assert from "node:assert/strict";

import { categoriesFromQuery, normalizeRecord, parseResponse, buildQuery, dateFilter } from "../sources/datacite.js";
import { rebuildAbstract, normalizeWork, parseResponse as parseOpenAlex, arxivIdFromWork } from "../sources/openalex.js";
import { withFallback } from "../sources/fallback.js";

const record = {
  doi: "10.48550/arxiv.2610.18871",
  identifiers: [{ identifier: "2610.18871", identifierType: "arXiv" }],
  creators: [
    { name: "Su, Chih-Hai", givenName: "Chih-Hai", familyName: "Su" },
    { name: "Consortium" },
  ],
  titles: [{ title: "Cepheid:  Decoupling\n Scale" }],
  descriptions: [{ descriptionType: "Abstract", description: "Sparse  motion\ncompletion." }],
  subjects: [
    { subject: "Computer Vision and Pattern Recognition (cs.CV)", subjectScheme: "arXiv" },
    { subject: "Machine Learning (cs.LG)", subjectScheme: "arXiv" },
    { subject: "FOS: Computer and information sciences", subjectScheme: "Fields of Science and Technology (FOS)" },
  ],
  dates: [
    { date: "2026-10-13T17:59:53Z", dateType: "Submitted", dateInformation: "v1" },
    { date: "2026-10-14T04:15:26Z", dateType: "Updated", dateInformation: "v1" },
  ],
  created: "2026-10-14T08:09:53Z",
  url: "https://arxiv.org/abs/2610.18871",
};

test("datacite categoriesFromQuery pulls every cat: term out of an arXiv query", () => {
  assert.deepEqual(categoriesFromQuery("cat:cs.LG OR cat:cs.CV OR cat:stat.ML"), ["cs.LG", "cs.CV", "stat.ML"]);
});

test("datacite categoriesFromQuery is empty when the query has no categories", () => {
  assert.deepEqual(categoriesFromQuery("all:edge"), []);
});

test("datacite normalizeRecord maps a DOI record to the shared paper shape", () => {
  const p = normalizeRecord(record);
  assert.equal(p.arxiv_id, "2610.18871");
  assert.equal(p.dedup_arxiv_id, "2610.18871");
  assert.equal(p.source, "arxiv");
  assert.equal(p.title, "Cepheid: Decoupling Scale");
  assert.equal(p.abstract, "Sparse motion completion.");
  assert.equal(p.abs_url, "https://arxiv.org/abs/2610.18871");
  assert.equal(p.pdf_url, "https://arxiv.org/pdf/2610.18871.pdf");
});

test("datacite normalizeRecord keeps only arXiv subjects as category codes, first is primary", () => {
  const p = normalizeRecord(record);
  assert.deepEqual(p.categories, ["cs.CV", "cs.LG"]);
  assert.equal(p.primary_category, "cs.CV");
});

test("datacite normalizeRecord writes authors Given Family to match the arXiv feed", () => {
  assert.deepEqual(normalizeRecord(record).authors, ["Chih-Hai Su", "Consortium"]);
});

test("datacite normalizeRecord takes published from the Submitted date and updated from Updated", () => {
  const p = normalizeRecord(record);
  assert.equal(p.published, "2026-10-13");
  assert.equal(p.updated, "2026-10-14");
});

test("datacite normalizeRecord falls back to created when there is no Submitted date", () => {
  const p = normalizeRecord({ ...record, dates: [] });
  assert.equal(p.published, "2026-10-14");
  assert.equal(p.updated, null);
});

test("datacite normalizeRecord derives the id from the DOI when identifiers are absent", () => {
  const p = normalizeRecord({ ...record, identifiers: [] });
  assert.equal(p.arxiv_id, "2610.18871");
});

test("datacite parseResponse drops records that are not arXiv papers", () => {
  const other = { ...record, doi: "10.5445/ir/1000197858", identifiers: [], url: "https://publikationen.bibliothek.kit.edu/x" };
  const out = parseResponse({ data: [{ attributes: record }, { attributes: other }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].arxiv_id, "2610.18871");
});

test("datacite parseResponse tolerates an empty or malformed body", () => {
  assert.deepEqual(parseResponse(null), []);
  assert.deepEqual(parseResponse({}), []);
});

test("datacite dateFilter is empty for zero or missing days", () => {
  assert.equal(dateFilter(0), "");
  assert.equal(dateFilter(undefined), "");
});

test("datacite dateFilter builds an inclusive created range ending today", () => {
  const f = dateFilter(7, new Date("2026-10-14T12:00:00Z"));
  assert.equal(f, "created:[2026-10-07 TO 2026-10-14]");
});

test("datacite buildQuery ORs category subjects and appends the date range", () => {
  const q = buildQuery({ query_by_source: { arxiv: "cat:cs.LG OR cat:cs.CV" } }, 7, new Date("2026-10-14T12:00:00Z"));
  assert.equal(q, '(subjects.subject:"cs.LG" OR subjects.subject:"cs.CV") AND created:[2026-10-07 TO 2026-10-14]');
});

test("datacite buildQuery falls back to the interest keywords when there is no category", () => {
  const q = buildQuery({ keywords: ["edge", "quantization"] }, 0);
  assert.equal(q, "(edge OR quantization)");
});

test("openalex rebuildAbstract orders words by their positions", () => {
  assert.equal(rebuildAbstract({ world: [1, 3], hello: [0], again: [2] }), "hello world again world");
});

test("openalex rebuildAbstract is empty for a missing index", () => {
  assert.equal(rebuildAbstract(null), "");
});

const work = {
  title: "Test-Time Adaptation",
  publication_date: "2026-10-06",
  doi: "https://doi.org/10.48550/arxiv.2610.08358",
  abstract_inverted_index: { Post: [0], training: [1] },
  authorships: [{ author: { display_name: "Hyeongheon Cha" } }],
  locations: [{ landing_page_url: "https://arxiv.org/abs/2610.08358", pdf_url: "https://arxiv.org/pdf/2610.08358" }],
};

test("openalex arxivIdFromWork reads the id from the arXiv DOI", () => {
  assert.equal(arxivIdFromWork(work), "2610.08358");
});

test("openalex arxivIdFromWork falls back to an arxiv.org landing page", () => {
  assert.equal(arxivIdFromWork({ locations: work.locations }), "2610.08358");
});

test("openalex arxivIdFromWork is null when the work is not on arXiv", () => {
  assert.equal(arxivIdFromWork({ doi: "https://doi.org/10.1/x", locations: [] }), null);
});

test("openalex normalizeWork maps a work to the shared paper shape", () => {
  const p = normalizeWork(work);
  assert.equal(p.arxiv_id, "2610.08358");
  assert.equal(p.source, "arxiv");
  assert.equal(p.abstract, "Post training");
  assert.deepEqual(p.authors, ["Hyeongheon Cha"]);
  assert.equal(p.published, "2026-10-06");
  assert.equal(p.abs_url, "https://arxiv.org/abs/2610.08358");
  assert.equal(p.pdf_url, "https://arxiv.org/pdf/2610.08358.pdf");
  assert.deepEqual(p.categories, []);
});

test("openalex parseResponse drops works with no arXiv id", () => {
  const out = parseOpenAlex({ results: [work, { doi: "https://doi.org/10.1/x", locations: [] }] });
  assert.equal(out.length, 1);
});

const mod = (fn) => ({ fetchForInterest: fn, search: fn });

test("withFallback returns the primary result when it succeeds", async () => {
  const src = withFallback(mod(async () => ["a"]), mod(async () => ["b"]));
  assert.deepEqual(await src.fetchForInterest({}), ["a"]);
});

test("withFallback uses the next source when the primary throws", async () => {
  const src = withFallback(mod(async () => { throw new Error("down"); }), mod(async () => ["b"]));
  assert.deepEqual(await src.fetchForInterest({}), ["b"]);
  assert.deepEqual(await src.search("q"), ["b"]);
});

test("withFallback rethrows the last error when every source fails", async () => {
  const boom = (m) => mod(async () => { throw Object.assign(new Error(m), { status: 503 }); });
  const src = withFallback(boom("first"), boom("second"));
  await assert.rejects(src.fetchForInterest({}), (e) => e.message === "second" && e.status === 503);
});

test("withFallback does not fall back on an empty but successful result", async () => {
  let calls = 0;
  const src = withFallback(mod(async () => []), mod(async () => { calls += 1; return ["b"]; }));
  assert.deepEqual(await src.fetchForInterest({}), []);
  assert.equal(calls, 0);
});
