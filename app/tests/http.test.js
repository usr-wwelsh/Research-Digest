import { test } from "node:test";
import assert from "node:assert/strict";
import { getJson } from "../sources/http.js";

const fast = { sleep: async () => {} };

function withFakeFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => { globalThis.fetch = original; });
}

const ok = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(body) });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

test("a 503 is retried and the eventual body returned", async () => {
  let calls = 0;
  const json = await withFakeFetch(async () => {
    calls += 1;
    return calls < 2 ? fail(503) : ok('{"data":[1]}');
  }, () => getJson("https://x/api", "datacite", fast));
  assert.deepEqual(json, { data: [1] });
  assert.equal(calls, 2);
});

test("a 404 fails fast and names the source", async () => {
  let calls = 0;
  await withFakeFetch(async () => { calls += 1; return fail(404); }, async () => {
    await assert.rejects(getJson("https://x/api", "datacite", fast), /datacite error: 404/);
  });
  assert.equal(calls, 1);
});

test("the body is parsed inside the retried region", async () => {
  let calls = 0;
  const json = await withFakeFetch(async () => {
    calls += 1;
    if (calls === 1) return { ok: true, status: 200, json: async () => { throw new Error("truncated"); } };
    return ok('{"data":[1]}');
  }, () => getJson("https://x/api", "openalex", fast));
  assert.deepEqual(json, { data: [1] });
  assert.equal(calls, 2);
});

test("every request carries an abort signal so a hung upstream cannot stall the cycle", async () => {
  let seen = null;
  await withFakeFetch(async (_url, init) => { seen = init; return ok("{}"); },
    () => getJson("https://x/api", "datacite", fast));
  assert.ok(seen && seen.signal, "expected an AbortSignal on the request");
});

test("a 429 carries the server's Retry-After hint into the retry policy", async () => {
  const waits = [];
  await withFakeFetch(
    async () => ({ ok: false, status: 429, headers: { get: (h) => (h === "Retry-After" ? "1" : null) } }),
    async () => {
      await assert.rejects(getJson("https://x/api", "datacite", {
        retries: 1,
        sleep: async (ms) => { waits.push(ms); },
      }));
    },
  );
  assert.deepEqual(waits, [1000]);
});
