import { test } from "node:test";
import assert from "node:assert/strict";
import { createSummaryQueue } from "../summary-queue.js";

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function papers(n) {
  return Array.from({ length: n }, (_, i) => ({ arxiv_id: `p${i}`, title: `T${i}`, abstract: `abstract ${i}` }));
}

function harness(overrides = {}) {
  const calls = { summarize: 0, embed: 0, relate: 0, saved: [], persisted: [] };
  const replies = [];
  const statuses = [];
  const queue = createSummaryQueue({
    batchSize: 8,
    summarize: async (items) => { calls.summarize += 1; return items.map((_, i) => ({ summary: `sum${i}`, embedding: [1] })); },
    embed: async (texts) => { calls.embed += 1; return texts.map(() => [2]); },
    loadPapers: async () => [],
    savePapers: async (rows) => { calls.saved.push(rows.map((p) => p.arxiv_id)); },
    persist: async (state) => { calls.persisted.push(state); },
    relate: () => { calls.relate += 1; return {}; },
    post: (msg) => statuses.push(msg.status),
    reply: (id, payload) => replies.push({ id, ...payload }),
    ...overrides,
  });
  return { queue, calls, replies, statuses };
}

test("cancel stops a run whose entire batch is already in flight", async () => {
  const gate = deferred();
  const h = harness({
    summarize: async (items) => { await gate.promise; return items.map(() => ({ summary: "s", embedding: [1] })); },
  });
  h.queue.enqueue(1, papers(5), []);
  await flush();
  h.queue.cancel();
  gate.resolve();
  await flush();

  assert.equal(h.calls.embed, 0, "embed stage should be skipped once cancel lands");
  assert.equal(h.calls.relate, 0, "corpus-wide relate should be skipped once cancel lands");
  assert.equal(h.replies.length, 1);
  assert.equal(h.replies[0].result.cancelled, true);
});

test("papers queued behind the in-flight chunk are dropped by cancel", async () => {
  const gate = deferred();
  const h = harness({
    batchSize: 2,
    summarize: async (items) => { await gate.promise; return items.map(() => ({ summary: "s", embedding: [1] })); },
  });
  h.queue.enqueue(1, papers(6), []);
  await flush();
  h.queue.cancel();
  gate.resolve();
  await flush();

  const savedIds = h.calls.saved.flat();
  assert.ok(savedIds.length <= 2, `only the in-flight chunk should be written, got ${savedIds}`);
  assert.equal(h.replies[0].result.cancelled, true);
});

test("work finished before cancel landed is still written", async () => {
  const gate = deferred();
  const h = harness({
    summarize: async (items) => { await gate.promise; return items.map((_, i) => ({ summary: `done${i}` })); },
  });
  const batch = papers(3);
  h.queue.enqueue(1, batch, []);
  await flush();
  h.queue.cancel();
  gate.resolve();
  await flush();

  assert.deepEqual(h.calls.saved[0], ["p0", "p1", "p2"]);
  assert.equal(batch[0].summary, "done0");
});

test("a cancelled run clears the persisted queue so a reload does not resume it", async () => {
  const gate = deferred();
  const h = harness({
    batchSize: 2,
    summarize: async (items) => { await gate.promise; return items.map(() => ({ summary: "s" })); },
  });
  h.queue.enqueue(1, papers(6), []);
  await flush();
  h.queue.cancel();
  gate.resolve();
  await flush();

  assert.equal(h.calls.persisted.at(-1), null, "last persist should clear the stored batch");
});

test("a batch started after a cancelled one runs to completion", async () => {
  const gate = deferred();
  const h = harness({ summarize: async (items) => { await gate.promise; return items.map(() => ({ summary: "s" })); } });
  h.queue.enqueue(1, papers(3), []);
  await flush();
  h.queue.cancel();
  gate.resolve();
  await flush();

  h.queue.enqueue(2, papers(2), []);
  await flush();
  const second = h.replies.find((r) => r.id === 2);
  assert.ok(second && second.ok && !second.result.cancelled, "second batch should complete normally");
  assert.equal(h.calls.relate, 1, "the relate pass should run for the uncancelled batch");
});

test("cancel while idle reports no work rather than hanging", async () => {
  const h = harness();
  h.queue.cancel();
  await flush();
  assert.equal(h.queue.status(), null);
});

test("a job resolves once every paper it waited on is processed", async () => {
  const h = harness();
  h.queue.enqueue(7, papers(3), []);
  await flush();
  const reply = h.replies.find((r) => r.id === 7);
  assert.ok(reply.ok);
  assert.equal(reply.result.processed, 3);
});

test("two jobs asking for the same paper share one processing pass", async () => {
  const h = harness();
  const shared = papers(2);
  h.queue.enqueue(1, shared, []);
  h.queue.enqueue(2, shared, []);
  await flush();
  assert.equal(h.calls.summarize, 1, "the paper should be summarized once, not once per job");
  assert.equal(h.replies.filter((r) => r.ok).length, 2, "both jobs should still be answered");
});

test("a systemic model failure degrades to abstracts instead of failing the batch", async () => {
  const h = harness({
    summarize: async () => { throw new Error("Could not create a session"); },
  });
  h.queue.enqueue(1, papers(2), []);
  await flush();
  const reply = h.replies.find((r) => r.id === 1);
  assert.ok(reply.ok, "the batch should still resolve");
  assert.ok(h.statuses.some((s) => s && /showing abstracts instead/.test(s.message)));
});

test("an embedding failure does not discard the summaries from the same chunk", async () => {
  const batch = papers(2);
  const h = harness({ embed: async () => { throw new Error("wasm oom"); } });
  h.queue.enqueue(1, batch, []);
  await flush();
  assert.equal(batch[0].summary, "sum0");
  assert.deepEqual(h.calls.saved[0], ["p0", "p1"]);
});

test("a storage failure fails the waiting jobs instead of wedging the queue", async () => {
  let failNext = true;
  const h = harness({
    savePapers: async () => { if (failNext) throw new Error("QuotaExceeded"); },
  });
  h.queue.enqueue(1, papers(2), []);
  await flush();
  assert.equal(h.replies[0].ok, false);

  failNext = false;
  h.queue.enqueue(2, papers(2), []);
  await flush();
  const second = h.replies.find((r) => r.id === 2);
  assert.ok(second && second.ok, "the queue must still accept work after an aborted batch");
});

test("resume picks up a persisted batch and skips papers already finished", async () => {
  const h = harness();
  const pending = [{ id: "p0", keywords: [] }, { id: "p1", keywords: [] }];
  const byId = new Map([
    ["p0", { arxiv_id: "p0", title: "T0", abstract: "a", summary: "done", embedding: [1] }],
    ["p1", { arxiv_id: "p1", title: "T1", abstract: "a" }],
  ]);
  assert.equal(h.queue.resume({ total: 2, done: 0, pending }, byId), true);
  await flush();
  assert.deepEqual(h.calls.saved[0], ["p1"], "only the unfinished paper should be reprocessed");
});
