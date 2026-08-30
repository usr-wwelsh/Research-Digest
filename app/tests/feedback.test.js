import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBoostKeywords } from "../feedback.js";

const NOW = new Date("2026-08-30T00:00:00Z");

function entry({ title, abstract, tags = [], daysAgo = 0 }) {
  const savedAt = new Date(NOW.getTime() - daysAgo * 86400000).toISOString();
  return { title, abstract, tags, savedAt };
}

test("returns nothing below the min_saves anti-overfit threshold", () => {
  const saved = [
    entry({ title: "Quantized Edge Models", abstract: "quantization for edge" }),
    entry({ title: "Quantized Edge Models 2", abstract: "quantization for edge again" }),
  ];
  assert.deepEqual(computeBoostKeywords(saved, [], { minSaves: 3, now: NOW }), []);
});

test("surfaces a recurring keyword once min_saves is met", () => {
  const saved = [
    entry({ title: "Sparse Attention for LLMs", abstract: "a sparsity technique" }),
    entry({ title: "Sparse Training Methods", abstract: "sparsity in training" }),
    entry({ title: "Sparse Inference", abstract: "sparsity at inference time" }),
  ];
  const boosted = computeBoostKeywords(saved, [], { minSaves: 3, now: NOW });
  assert.ok(boosted.includes("sparsity") || boosted.includes("sparse"));
});

test("excludes keywords already in the interest's configured list", () => {
  const saved = [
    entry({ title: "Edge Edge Edge", abstract: "edge edge edge edge" }),
    entry({ title: "Edge Edge Edge", abstract: "edge edge edge edge" }),
    entry({ title: "Edge Edge Edge", abstract: "edge edge edge edge" }),
  ];
  const boosted = computeBoostKeywords(saved, ["edge"], { minSaves: 3, now: NOW });
  assert.ok(!boosted.includes("edge"));
});

test("recent saves outweigh old ones of equal raw frequency", () => {
  const saved = [
    entry({ title: "Recentword topic", abstract: "recentword appears here", daysAgo: 0 }),
    entry({ title: "Oldword topic", abstract: "oldword appears here", daysAgo: 300 }),
    entry({ title: "Filler paper", abstract: "nothing special" }),
  ];
  const boosted = computeBoostKeywords(saved, [], { minSaves: 3, halfLifeDays: 30, now: NOW, maxKeywords: 10 });
  const recentIdx = boosted.indexOf("recentword");
  const oldIdx = boosted.indexOf("oldword");
  assert.ok(recentIdx >= 0 && oldIdx >= 0);
  assert.ok(recentIdx < oldIdx);
});

test("a keyword that also appears in the paper's tags ranks above an equal-frequency non-tag word", () => {
  const saved = [
    entry({ title: "distillation study", abstract: "compression study", tags: ["distillation"] }),
    entry({ title: "distillation results", abstract: "compression results", tags: ["distillation"] }),
    entry({ title: "distillation review", abstract: "compression review", tags: ["distillation"] }),
  ];
  const boosted = computeBoostKeywords(saved, [], { minSaves: 3, now: NOW, maxKeywords: 10 });
  const distillationIdx = boosted.indexOf("distillation");
  const compressionIdx = boosted.indexOf("compression");
  assert.ok(distillationIdx < compressionIdx);
});

test("caps output at maxKeywords", () => {
  const saved = [
    entry({ title: "alpha beta gamma delta epsilon zeta", abstract: "" }),
    entry({ title: "alpha beta gamma delta epsilon zeta", abstract: "" }),
    entry({ title: "alpha beta gamma delta epsilon zeta", abstract: "" }),
  ];
  const boosted = computeBoostKeywords(saved, [], { minSaves: 3, now: NOW, maxKeywords: 3 });
  assert.equal(boosted.length, 3);
});

test("drops short tokens and stopwords", () => {
  const saved = [
    entry({ title: "a of to the for", abstract: "an on in is are" }),
    entry({ title: "a of to the for", abstract: "an on in is are" }),
    entry({ title: "a of to the for", abstract: "an on in is are" }),
  ];
  assert.deepEqual(computeBoostKeywords(saved, [], { minSaves: 3, now: NOW }), []);
});
