import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitSentences,
  cosineSimilarity,
  selectSummarySentences,
  planExtractiveBatch,
  assembleExtractiveBatch,
} from "../extractive.js";

test("splitSentences: splits on sentence-ending punctuation", () => {
  const sentences = splitSentences("First sentence. Second sentence! Third one?");
  assert.deepEqual(sentences, ["First sentence.", "Second sentence!", "Third one?"]);
});

test("splitSentences: returns the whole text as one sentence when there's no terminator", () => {
  assert.deepEqual(splitSentences("no terminal punctuation here"), ["no terminal punctuation here"]);
});

test("cosineSimilarity: 1 for identical vectors, 0 for orthogonal vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity: 0 (not NaN) when a vector is all zeros", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test("selectSummarySentences: returns every sentence unchanged when under the count", () => {
  const sentences = ["Only one."];
  assert.deepEqual(selectSummarySentences(sentences, [[1, 0]], [1, 0], 2), sentences);
});

test("selectSummarySentences: picks the sentences closest to the document embedding, in original order", () => {
  const sentences = ["On-topic first.", "Off-topic filler.", "On-topic last."];
  const embeddings = [[1, 0], [0, 1], [0.9, 0.1]];
  const docEmbedding = [1, 0];
  assert.deepEqual(
    selectSummarySentences(sentences, embeddings, docEmbedding, 2),
    ["On-topic first.", "On-topic last."],
  );
});

test("planExtractiveBatch: docs at or under the sentence count get no span (no sentence embedding needed)", () => {
  const texts = ["Only one sentence."];
  const plan = planExtractiveBatch(texts, 2);
  assert.deepEqual(plan.spans, [null]);
  assert.deepEqual(plan.flatSentences, []);
});

test("planExtractiveBatch: flattens sentences from multiple docs into one array with correct spans", () => {
  const texts = [
    "Short doc.",
    "Doc two sentence one. Doc two sentence two. Doc two sentence three.",
    "Doc three sentence one. Doc three sentence two. Doc three sentence three.",
  ];
  const plan = planExtractiveBatch(texts, 2);
  assert.deepEqual(plan.spans[0], null);
  assert.deepEqual(plan.spans[1], { start: 0, length: 3 });
  assert.deepEqual(plan.spans[2], { start: 3, length: 3 });
  assert.equal(plan.flatSentences.length, 6);
  assert.deepEqual(plan.flatSentences.slice(0, 3), plan.perDocSentences[1]);
  assert.deepEqual(plan.flatSentences.slice(3, 6), plan.perDocSentences[2]);
});

test("assembleExtractiveBatch: short doc gets its own embedding and text as summary", () => {
  const texts = ["Only one sentence."];
  const plan = planExtractiveBatch(texts, 2);
  const docEmbeddings = [[1, 0]];
  const result = assembleExtractiveBatch(texts, plan, docEmbeddings, [], 2);
  assert.deepEqual(result, [{ summary: "Only one sentence.", embedding: [1, 0] }]);
});

test("assembleExtractiveBatch: matches single-doc selectSummarySentences behavior when batched", () => {
  const texts = ["On-topic first. Off-topic filler. On-topic last."];
  const plan = planExtractiveBatch(texts, 2);
  const docEmbeddings = [[1, 0]];
  const flatEmbeddings = [[1, 0], [0, 1], [0.9, 0.1]];
  const [result] = assembleExtractiveBatch(texts, plan, docEmbeddings, flatEmbeddings, 2);
  assert.equal(result.summary, "On-topic first. On-topic last.");
  assert.deepEqual(result.embedding, [1, 0]);
});

test("assembleExtractiveBatch: multiple docs each pull from their own span of flatEmbeddings", () => {
  const texts = [
    "Short doc.",
    "A relevant one. A filler one.",
  ];
  const plan = planExtractiveBatch(texts, 1);
  const docEmbeddings = [[0, 0], [1, 0]];
  const flatEmbeddings = [[1, 0], [0, 1]];
  const results = assembleExtractiveBatch(texts, plan, docEmbeddings, flatEmbeddings, 1);
  assert.deepEqual(results[0], { summary: "Short doc.", embedding: [0, 0] });
  assert.equal(results[1].summary, "A relevant one.");
});
