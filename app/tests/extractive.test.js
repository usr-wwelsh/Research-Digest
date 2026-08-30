import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences, cosineSimilarity, selectSummarySentences } from "../extractive.js";

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
