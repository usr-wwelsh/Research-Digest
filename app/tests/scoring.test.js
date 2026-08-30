import { test } from "node:test";
import assert from "node:assert/strict";
import { score } from "../scoring.js";

test("title hits are weighted higher than abstract hits", () => {
  const titleHit = { title: "Edge computing for IoT", abstract: "a general survey" };
  assert.equal(score(titleHit, ["edge"]), 3);

  const abstractHit = { title: "A general survey", abstract: "applications in edge computing" };
  assert.equal(score(abstractHit, ["edge"]), 1);
});

test("is case-insensitive and sums multiple keyword hits", () => {
  const paper = { title: "EDGE and Efficient models", abstract: "quantization details" };
  assert.equal(score(paper, ["edge", "efficient", "quantization"]), 3 + 3 + 1);
});

test("is zero when no keywords match", () => {
  const paper = { title: "Unrelated topic", abstract: "nothing relevant here" };
  assert.equal(score(paper, ["quantum", "biology"]), 0);
});

test("treats a missing abstract as empty rather than throwing", () => {
  const paper = { title: "Edge computing", abstract: undefined };
  assert.equal(score(paper, ["edge"]), 3);
});

test("empty keyword list scores zero", () => {
  const paper = { title: "Anything", abstract: "at all" };
  assert.equal(score(paper, []), 0);
});
