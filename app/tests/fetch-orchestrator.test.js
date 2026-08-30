import { test } from "node:test";
import assert from "node:assert/strict";
import { planFetch } from "../fetch-orchestrator.js";

test("scores and sorts new candidates by keyword relevance", () => {
  const candidates = [
    { arxiv_id: "a", title: "Unrelated paper", abstract: "nothing relevant" },
    { arxiv_id: "b", title: "Edge Inference", abstract: "efficient edge computing" },
  ];
  const { insert } = planFetch(candidates, [], "My Interest", ["edge", "efficient"], 25);
  assert.equal(insert[0].arxiv_id, "b");
  assert.equal(insert[0].interest, "My Interest");
});

test("trims new candidates to maxPapers", () => {
  const candidates = Array.from({ length: 5 }, (_, i) => ({
    arxiv_id: `p${i}`, title: `Edge paper ${i}`, abstract: "edge computing",
  }));
  const { insert } = planFetch(candidates, [], "Interest", ["edge"], 2);
  assert.equal(insert.length, 2);
});

test("a candidate matching an existing paper is merged, not inserted", () => {
  const existing = [{ arxiv_id: "2508.01234", title: "Efficient Edge Inference", authors: ["Ada"], doi: null }];
  const candidates = [{ dedup_arxiv_id: "2508.01234", doi: "10.1/x", title: "different", authors: [] }];
  const { insert, merge } = planFetch(candidates, existing, "Interest", [], 25);
  assert.equal(insert.length, 0);
  assert.equal(merge.length, 1);
  assert.equal(merge[0].arxiv_id, "2508.01234");
});

test("merging never overwrites fields the existing record already has", () => {
  const existing = [{ arxiv_id: "2508.01234", title: "Original Title", doi: "10.1/original", authors: ["Ada"] }];
  const candidates = [{ dedup_arxiv_id: "2508.01234", doi: "10.1/different", title: "Should Not Win", authors: [] }];
  const { merge } = planFetch(candidates, existing, "Interest", [], 25);
  assert.equal(merge[0].title, "Original Title");
  assert.equal(merge[0].doi, "10.1/original");
});

test("merging fills in a field the existing record was missing", () => {
  const existing = [{ arxiv_id: "2508.01234", title: "T", doi: null, venue: null }];
  const candidates = [{ dedup_arxiv_id: "2508.01234", doi: "10.1/x", venue: "NeurIPS", title: "x", authors: [] }];
  const { merge } = planFetch(candidates, existing, "Interest", [], 25);
  assert.equal(merge[0].doi, "10.1/x");
  assert.equal(merge[0].venue, "NeurIPS");
});

test("two duplicate candidates within the same run dedup against each other too", () => {
  const candidates = [
    { dedup_arxiv_id: null, doi: null, title: "Same Paper", authors: ["Ada Researcher"] },
    { dedup_arxiv_id: null, doi: null, title: "Same Paper", authors: ["Ada Researcher"] },
  ];
  const { insert } = planFetch(candidates, [], "Interest", [], 25);
  assert.equal(insert.length, 1);
});
