import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INTERESTS } from "../default-interests.js";

test("ships exactly the 5 interests from the original config.json", () => {
  assert.equal(DEFAULT_INTERESTS.length, 5);
});

test("every interest has a unique slug id and required fields", () => {
  const ids = new Set();
  for (const interest of DEFAULT_INTERESTS) {
    assert.match(interest.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(interest.id), `duplicate id: ${interest.id}`);
    ids.add(interest.id);
    assert.ok(interest.name);
    assert.ok(interest.query_by_source.arxiv);
    assert.ok(Array.isArray(interest.keywords) && interest.keywords.length > 0);
    assert.deepEqual(interest.sources, ["arxiv"]);
    assert.equal(interest.enabled, true);
  }
});
