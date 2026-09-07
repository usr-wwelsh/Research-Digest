// Fetching and summarizing are split so Refresh stays cheap: summarizePapers()
// is called lazily by digest.js for just the visible batch, not the whole corpus.
import { getAll } from "./db.js";
import { runFetchCycle } from "./fetch-orchestrator.js";
import { DEFAULT_INTERESTS } from "./default-interests.js";

let worker = null;
let msgId = 0;
const pending = new Map();

// The onStatus for whichever callWorker() call this page itself has in
// flight, plus an optional page-wide subscriber (see onRemoteSummaryStatus)
// that hears every status change regardless of who started the batch.
let activeOnStatus = null;
let globalStatusCallback = null;

// SharedWorker: this app is a multi-page site (no SPA router), and the
// actual batch loop now lives inside models.worker.js itself, not in this
// page's JS — so it keeps draining after this page navigates away, as long
// as at least one tab of the app is still connected. See models.worker.js.
function getWorker() {
  if (!worker) {
    worker = new SharedWorker(new URL("./models.worker.js", import.meta.url), { type: "module" });
    worker.port.onmessage = (event) => {
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
    worker.port.start();
  }
  return worker;
}

function callWorker(type, payload, onStatus) {
  const id = ++msgId;
  const w = getWorker();
  activeOnStatus = onStatus || null;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.port.postMessage({ id, type, payload });
  });
}

// Pages call this once on load to keep their status line accurate even for
// a batch they didn't start themselves (running on another tab, or started
// on this page before a previous navigation). Immediately queries the
// worker for whatever's running right now, then stays live for anything
// that happens after.
export function onRemoteSummaryStatus(callback) {
  globalStatusCallback = callback;
  callWorker("getStatus", {}, () => {}).then(callback).catch(() => {});
}

// Drops whatever's still queued (but not yet started) in the worker's
// summarize batch, so a slow/stuck model load doesn't keep a page or its
// queue occupied indefinitely. The one paper already mid-processing, if
// any, still finishes naturally — transformers.js gives no way to abort a
// forward pass already in flight.
export async function cancelSummarize() {
  return callWorker("cancel", {});
}

export async function getInterests() {
  const rows = await getAll("interests");
  return rows.length ? rows : DEFAULT_INTERESTS;
}

// No summarization — just new candidates for enabled interests.
export async function fetchNewPapers(onStatus = () => {}, interests = null) {
  onStatus("Checking interests…");
  const list = interests || (await getInterests()).filter((i) => i.enabled !== false);
  onStatus("Fetching new papers…");
  const added = await runFetchCycle(list);
  onStatus(null);
  return added;
}

// Hands the given papers to the worker's persistent queue and resolves once
// every one of them has been processed (summary + embedding), regardless of
// whether other jobs from other pages/tabs are sharing the same queue. The
// actual processing and IndexedDB writes happen in the worker, so it keeps
// going even if this page navigates away before the promise resolves.
export async function summarizePapers(papers, interests, onStatus = () => {}) {
  const toProcess = papers.filter((p) => !p.summary || !p.embedding);
  if (!toProcess.length) {
    onStatus(null);
    return { processed: 0, total: 0 };
  }
  const result = await callWorker("summarizeBatch", { papers: toProcess, interests }, onStatus);
  onStatus(null);
  return result;
}

// Fetch everything, then summarize everything — for callers that want the
// old all-in-one behavior (a background sync, not a foreground page view).
export async function runFullRefresh(onStatus = () => {}) {
  await fetchNewPapers(onStatus);
  const [papers, interests] = await Promise.all([getAll("papers"), getInterests()]);
  return summarizePapers(papers, interests, onStatus);
}
