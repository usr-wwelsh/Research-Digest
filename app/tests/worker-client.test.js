import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerClient } from "../worker-client.js";

class FakeWorker {
  constructor() { this.sent = []; this.terminated = false; }
  postMessage(msg) { this.sent.push(msg); }
  terminate() { this.terminated = true; }
  reply(data) { this.onmessage({ data }); }
  progress(status) { this.onmessage({ data: { type: "progress", status } }); }
  crash(message = "out of memory") { this.onerror({ message }); }
}

function clientWithWorkers() {
  const spawned = [];
  const client = createWorkerClient(() => {
    const w = new FakeWorker();
    spawned.push(w);
    return w;
  });
  return { client, spawned };
}

test("a call resolves with the result of the reply carrying its id", async () => {
  const { client, spawned } = clientWithWorkers();
  const pending = client.call("summarizeBatch", { papers: [] });
  const { id } = spawned[0].sent[0];
  spawned[0].reply({ id, ok: true, result: { processed: 3 } });
  assert.deepEqual(await pending, { processed: 3 });
});

test("a failed reply rejects that call with the worker's error", async () => {
  const { client, spawned } = clientWithWorkers();
  const pending = client.call("summarizeBatch", {});
  const { id } = spawned[0].sent[0];
  spawned[0].reply({ id, ok: false, error: "model load failed" });
  await assert.rejects(pending, /model load failed/);
});

test("concurrent calls each resolve with their own reply", async () => {
  const { client, spawned } = clientWithWorkers();
  const first = client.call("summarizeBatch", {});
  const second = client.call("getStatus", {});
  const [a, b] = spawned[0].sent;
  spawned[0].reply({ id: b.id, ok: true, result: "second" });
  spawned[0].reply({ id: a.id, ok: true, result: "first" });
  assert.equal(await first, "first");
  assert.equal(await second, "second");
});

test("a worker that dies rejects every in-flight call instead of hanging", async () => {
  const { client, spawned } = clientWithWorkers();
  const first = client.call("summarizeBatch", {});
  const second = client.call("summarizeBatch", {});
  spawned[0].crash("out of memory");
  await assert.rejects(first, /out of memory/);
  await assert.rejects(second, /out of memory/);
});

test("a call made after a crash runs on a fresh worker", async () => {
  const { client, spawned } = clientWithWorkers();
  const first = client.call("summarizeBatch", {});
  spawned[0].crash();
  await assert.rejects(first);

  const retry = client.call("summarizeBatch", {});
  assert.equal(spawned.length, 2);
  const { id } = spawned[1].sent[0];
  spawned[1].reply({ id, ok: true, result: "recovered" });
  assert.equal(await retry, "recovered");
});

test("a lost reply rejects in-flight calls rather than stranding them", async () => {
  const { client, spawned } = clientWithWorkers();
  const pending = client.call("summarizeBatch", {});
  spawned[0].onmessageerror({});
  await assert.rejects(pending);
});

test("progress reaches both the call's own listener and the page-wide subscriber", async () => {
  const { client, spawned } = clientWithWorkers();
  const seen = [];
  const global = [];
  client.onProgress((s) => global.push(s));
  const pending = client.call("summarizeBatch", {}, (s) => seen.push(s));
  spawned[0].progress({ message: "Summarizing 1/2…" });
  const { id } = spawned[0].sent[0];
  spawned[0].reply({ id, ok: true, result: {} });
  await pending;
  assert.deepEqual(seen, [{ message: "Summarizing 1/2…" }]);
  assert.deepEqual(global, [{ message: "Summarizing 1/2…" }]);
});

test("a reply for an unknown id is ignored", () => {
  const { client, spawned } = clientWithWorkers();
  client.call("summarizeBatch", {});
  assert.doesNotThrow(() => spawned[0].reply({ id: 9999, ok: true, result: {} }));
});
