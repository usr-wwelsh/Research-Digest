import { test } from "node:test";
import assert from "node:assert/strict";

// Proves the node:test harness runs before any product code exists.
// Phase 3 replaces/supplements this with real tests for scoring.js etc.
test("node:test harness runs", () => {
  assert.equal(1 + 1, 2);
});
