import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, isTransient, backoffDelay } from "../retry.js";

const noSleep = async () => {};

function httpError(status) {
  const err = new Error(`relay error: ${status}`);
  err.status = status;
  return err;
}

test("a call that succeeds first time runs exactly once", async () => {
  let calls = 0;
  const result = await withRetry(async () => { calls += 1; return "ok"; }, { sleep: noSleep });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("a transient failure is retried and the later success is returned", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw httpError(503);
    return "ok";
  }, { sleep: noSleep });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("a 4xx failure rethrows immediately without retrying", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls += 1; throw httpError(404); }, { sleep: noSleep }),
    /404/,
  );
  assert.equal(calls, 1);
});

test("a persistent transient failure stops after the retry budget", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls += 1; throw httpError(503); }, { retries: 2, sleep: noSleep }),
    /503/,
  );
  assert.equal(calls, 3);
});

test("each retry waits longer than the last", async () => {
  const waits = [];
  await assert.rejects(
    withRetry(async () => { throw httpError(500); }, {
      retries: 3,
      sleep: async (ms) => { waits.push(ms); },
      random: () => 1,
    }),
  );
  assert.equal(waits.length, 3);
  assert.ok(waits[1] > waits[0] && waits[2] > waits[1], `expected growth, got ${waits}`);
});

test("a timeout or dropped connection carries no status and counts as transient", () => {
  assert.equal(isTransient(new DOMException("timed out", "TimeoutError")), true);
  assert.equal(isTransient(new TypeError("Failed to fetch")), true);
});

test("a rate-limited response is transient but a bad request is not", () => {
  assert.equal(isTransient(httpError(429)), true);
  assert.equal(isTransient(httpError(500)), true);
  assert.equal(isTransient(httpError(400)), false);
});

test("jitter keeps the delay inside half the nominal backoff", () => {
  const low = backoffDelay(2, 100, () => 0);
  const high = backoffDelay(2, 100, () => 1);
  assert.equal(high, 400);
  assert.equal(low, 200);
});
