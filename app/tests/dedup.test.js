import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicate } from "../dedup.js";

const existing = [
  { arxiv_id: "2508.01234", title: "Efficient Edge Inference", authors: ["Ada Researcher"], doi: null },
  { arxiv_id: "s2:abc", title: "Some Other Paper", authors: ["Zed Zed"], doi: "10.1/xyz" },
];

test("matches on dedup_arxiv_id when the candidate names a known arXiv id", () => {
  const candidate = { dedup_arxiv_id: "2508.01234", doi: null, title: "different title", authors: [] };
  const match = findDuplicate(candidate, existing);
  assert.equal(match.arxiv_id, "2508.01234");
});

test("falls back to DOI match when no arxiv id hint is present", () => {
  const candidate = { dedup_arxiv_id: null, doi: "10.1/xyz", title: "different title", authors: [] };
  const match = findDuplicate(candidate, existing);
  assert.equal(match.arxiv_id, "s2:abc");
});

test("falls back to normalized title + first-author match", () => {
  const candidate = {
    dedup_arxiv_id: null, doi: null,
    title: "  EFFICIENT   edge-inference!! ", authors: ["Ada Researcher", "Someone Else"],
  };
  const match = findDuplicate(candidate, existing);
  assert.equal(match.arxiv_id, "2508.01234");
});

test("returns null when nothing matches", () => {
  const candidate = { dedup_arxiv_id: null, doi: null, title: "Totally New Paper", authors: ["New Author"] };
  assert.equal(findDuplicate(candidate, existing), null);
});

test("title match requires the first author to also match", () => {
  const candidate = { dedup_arxiv_id: null, doi: null, title: "Efficient Edge Inference", authors: ["Someone Else"] };
  assert.equal(findDuplicate(candidate, existing), null);
});

test("a non-string first author (malformed source data) does not throw", () => {
  const candidate = {
    dedup_arxiv_id: null, doi: null,
    title: "Some New Paper", authors: [{ value: "Ada Researcher" }],
  };
  assert.doesNotThrow(() => findDuplicate(candidate, existing));
  assert.equal(findDuplicate(candidate, existing), null);
});
