import { test } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, computeRelated } from "../relate.js";

test("cosineSimilarity is 1 for identical vectors", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});

test("cosineSimilarity is 0 for orthogonal vectors", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
});

test("cosineSimilarity handles a zero vector without dividing by zero", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test("computeRelated returns each paper's top-N nearest neighbours, excluding itself", () => {
  const papers = [
    { arxiv_id: "a", embedding: [1, 0] },
    { arxiv_id: "b", embedding: [0.9, 0.1] },   // close to a
    { arxiv_id: "c", embedding: [0, 1] },       // far from a
  ];
  const related = computeRelated(papers, 2);
  assert.equal(related.a[0], "b");
  assert.ok(!related.a.includes("a"));
});

test("computeRelated skips papers with no embedding", () => {
  const papers = [
    { arxiv_id: "a", embedding: [1, 0] },
    { arxiv_id: "b", embedding: null },
  ];
  const related = computeRelated(papers, 3);
  assert.deepEqual(related, {});
});

test("computeRelated returns empty when fewer than 2 embedded papers", () => {
  const papers = [{ arxiv_id: "a", embedding: [1, 0] }];
  assert.deepEqual(computeRelated(papers, 3), {});
});
