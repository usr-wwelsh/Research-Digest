// Fetching and summarizing are split so Refresh stays cheap: summarizePapers()
// is called lazily by digest.js for just the visible batch, not the whole corpus.
import { getAll } from "./db.js";
import { runFetchCycle } from "./fetch-orchestrator.js";
import { DEFAULT_INTERESTS } from "./default-interests.js";
import { createWorkerClient } from "./worker-client.js";

// Dedicated Worker, not SharedWorker — see models.worker.js.
const client = createWorkerClient(
  () => new Worker(new URL("./models.worker.js", import.meta.url), { type: "module" }),
);

// Picks up a batch resumed from a previous navigation (see resumePendingQueue in models.worker.js).
export function onRemoteSummaryStatus(callback) {
  client.onProgress(callback);
  client.call("getStatus", {}, () => {}).then(callback).catch(() => {});
}

// Drops whatever's still queued (but not yet started) in the worker's
// summarize batch, so a slow/stuck model load doesn't keep a page or its
// queue occupied indefinitely. The one paper already mid-processing, if
// any, still finishes naturally — transformers.js gives no way to abort a
// forward pass already in flight.
export async function cancelSummarize() {
  return client.call("cancel", {});
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

// Hands papers to the worker's queue, resolves once each is processed.
export async function summarizePapers(papers, interests, onStatus = () => {}) {
  const toProcess = papers.filter((p) => !p.summary || !p.embedding);
  if (!toProcess.length) {
    onStatus(null);
    return { processed: 0, total: 0 };
  }
  const result = await client.call("summarizeBatch", { papers: toProcess, interests }, onStatus);
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
