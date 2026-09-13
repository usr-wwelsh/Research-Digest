// Worker plumbing, split from refresh.js so it can be driven by a fake
// worker under Node. A worker that dies — WASM OOM during model load is the
// realistic case — delivers none of its outstanding replies, so onerror has
// to reject them or every caller awaits forever.
export function createWorkerClient(spawn) {
  let worker = null;
  let msgId = 0;
  const pending = new Map();
  let activeOnStatus = null;
  let globalStatusCallback = null;

  function rejectAll(err) {
    const waiting = [...pending.values()];
    pending.clear();
    worker = null;
    activeOnStatus = null;
    for (const { reject } of waiting) reject(err);
    if (globalStatusCallback) globalStatusCallback(null);
  }

  function getWorker() {
    if (worker) return worker;
    worker = spawn();
    worker.onmessage = (event) => {
      const { id, ok, result, error, type, status } = event.data;
      if (type === "progress") {
        if (activeOnStatus) activeOnStatus(status);
        if (globalStatusCallback) globalStatusCallback(status);
        return;
      }
      const resolver = pending.get(id);
      if (!resolver) return;
      pending.delete(id);
      if (ok) resolver.resolve(result);
      else resolver.reject(new Error(error));
    };
    worker.onerror = (event) => {
      rejectAll(new Error(`summarizer worker died: ${(event && event.message) || "unknown error"}`));
    };
    worker.onmessageerror = () => {
      rejectAll(new Error("summarizer worker sent an unreadable message"));
    };
    return worker;
  }

  return {
    call(type, payload, onStatus) {
      const id = ++msgId;
      const w = getWorker();
      activeOnStatus = onStatus || null;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, type, payload });
      });
    },
    onProgress(callback) {
      globalStatusCallback = callback;
    },
  };
}
