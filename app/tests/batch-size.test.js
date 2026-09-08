import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBatchSize } from "../batch-size.js";

test("computeBatchSize: falls back to a conservative default when deviceMemory is unknown", () => {
  assert.equal(computeBatchSize(undefined), 4);
  assert.equal(computeBatchSize(null), 4);
  assert.equal(computeBatchSize(0), 4);
});

test("computeBatchSize: scales down for low-RAM devices", () => {
  assert.equal(computeBatchSize(1), 2);
  assert.equal(computeBatchSize(2), 2);
});

test("computeBatchSize: scales up for higher-RAM devices", () => {
  assert.equal(computeBatchSize(4), 4);
  assert.equal(computeBatchSize(8), 8);
});
