import { test } from "node:test";
import assert from "node:assert/strict";
import { relayText, relayJson } from "../sources/relay.js";

const fast = { sleep: async () => {} };

function withFakeFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => { globalThis.fetch = original; });
}

const ok = (body) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
const fail = (status) => ({ ok: false, status, text: async () => "", json: async () => ({}) });

test("a relay 503 is retried and the eventual body returned", async () => {
  let calls = 0;
  const body = await withFakeFetch(async () => {
    calls += 1;
    return calls < 2 ? fail(503) : ok("<feed/>");
  }, () => relayText("/relay/arxiv", "arxiv", fast));
  assert.equal(body, "<feed/>");
  assert.equal(calls, 2);
});

test("a relay 404 fails fast and names the source", async () => {
  let calls = 0;
  await withFakeFetch(async () => { calls += 1; return fail(404); }, async () => {
    await assert.rejects(relayText("/relay/arxiv", "arxiv", fast), /arxiv relay error: 404/);
  });
  assert.equal(calls, 1);
});

test("relayJson parses the body inside the retried region", async () => {
  let calls = 0;
  const json = await withFakeFetch(async () => {
    calls += 1;
    if (calls === 1) return { ok: true, status: 200, json: async () => { throw new Error("truncated"); } };
    return ok('{"data":[1]}');
  }, () => relayJson("/relay/s2", "semanticscholar", fast));
  assert.deepEqual(json, { data: [1] });
  assert.equal(calls, 2);
});

test("every request carries an abort signal so a hung relay cannot stall the cycle", async () => {
  let seen = null;
  await withFakeFetch(async (_url, init) => { seen = init; return ok("x"); },
    () => relayText("/relay/arxiv", "arxiv", fast));
  assert.ok(seen && seen.signal, "expected an AbortSignal on the request");
});
