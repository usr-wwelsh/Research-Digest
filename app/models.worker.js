// Dedicated Worker, not SharedWorker — SharedWorker never reports crossOriginIsolated=true here, which silently kills WASM threading.
import { pipeline, env } from "./vendor/transformers.min.js";
import { difficulty, layman, tags } from "./heuristics.js";
import { planExtractiveBatch, assembleExtractiveBatch } from "./extractive.js";
import { getAll, putMany, getSetting, setSetting, del } from "./db.js";
import { computeRelated } from "./relate.js";
import { computeBatchSize } from "./batch-size.js";
import { createSummaryQueue } from "./summary-queue.js";

// Self-hosted asyncify build (see scripts/fetch_vendor_assets.sh) — the plain threaded build hangs post-download in Firefox.
env.backends.onnx.wasm.wasmPaths = {
  mjs: "/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs",
  wasm: "/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm",
};
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(self.navigator?.hardwareConcurrency || 1, 4));

const EMBEDDING_MODEL = "Xenova/distilbert-base-uncased";
const EMBEDDER_DTYPE = "q8";
const SUMMARY_SENTENCE_COUNT = 2;
const BATCH_SIZE = computeBatchSize(self.navigator?.deviceMemory); // papers per model call, sized off deviceMemory

function post(message) {
  self.postMessage(message);
}

let embedderPromise = null;

function reportProgress(data) {
  if (data.status === "initiate") {
    post({ type: "progress", status: { message: `Loading model: ${data.file}…` } });
  } else if (data.status === "progress") {
    const pct = data.progress != null ? ` ${Math.round(data.progress)}%` : "";
    post({ type: "progress", status: { message: `Loading model: ${data.file}${pct}…` } });
  }
}

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", EMBEDDING_MODEL, {
      dtype: EMBEDDER_DTYPE,
      progress_callback: reportProgress,
    });
  }
  return embedderPromise;
}

// Mean-pooled, not normalized — matches local_ai.py's _mean_pool. Batched:
// one tokenize+forward pass for the whole array, not one per text — this is
// the dominant cost, since each call pays fixed tokenization/WASM overhead
// on top of the matmuls.
async function embedBatch(texts) {
  const embedder = await getEmbedder();
  const out = await embedder(texts, { pooling: "mean", normalize: false });
  return out.tolist();
}

// Batched doc + sentence embeddings for a whole chunk at once (extractive.js does the pure grouping/pairing).
async function extractiveSummaryBatch(texts) {
  const plan = planExtractiveBatch(texts, SUMMARY_SENTENCE_COUNT);
  const docEmbeddings = await embedBatch(texts);
  const flatEmbeddings = plan.flatSentences.length ? await embedBatch(plan.flatSentences) : [];
  return assembleExtractiveBatch(texts, plan, docEmbeddings, flatEmbeddings, SUMMARY_SENTENCE_COUNT);
}

// items: [{ title, abstract, category, keywords }]
async function summarizeBatch(items) {
  const texts = items.map(({ title, abstract }) => abstract || title || "");
  const longIdx = [];
  const longTexts = [];
  texts.forEach((text, i) => {
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount >= 15) {
      longIdx.push(i);
      longTexts.push(text);
    }
  });
  const longResults = longTexts.length ? await extractiveSummaryBatch(longTexts) : [];
  const perText = texts.map((text) => ({ summary: text, embedding: null }));
  longIdx.forEach((i, j) => {
    perText[i] = longResults[j];
  });

  return items.map(({ title, abstract, category, keywords }, i) => ({
    summary: perText[i].summary,
    embedding: perText[i].embedding,
    layman: layman(abstract || title),
    difficulty: difficulty(abstract || title, category || ""),
    tags: tags(title, abstract || "", keywords || []),
  }));
}

// Persisted so the queue can be picked back up after this worker dies on page nav.
const QUEUE_STATE_KEY = "summaryQueueState";

const summaryQueue = createSummaryQueue({
  batchSize: BATCH_SIZE,
  summarize: summarizeBatch,
  embed: embedBatch,
  loadPapers: () => getAll("papers"),
  savePapers: (papers) => putMany("papers", papers),
  persist: (state) =>
    state === null
      ? del("settings", QUEUE_STATE_KEY).catch(() => {})
      : setSetting(QUEUE_STATE_KEY, state).catch(() => {}),
  relate: computeRelated,
  post,
  reply: (id, payload) => self.postMessage({ id, ...payload }),
});

// Runs the moment this worker instance boots (including after the browser
// reaped a previous instance mid-batch): rehydrates whatever was last
// persisted and resumes on its own, so no page has to notice and resubmit.
async function resumePendingQueue() {
  const state = await getSetting(QUEUE_STATE_KEY, null).catch(() => null);
  if (!state || !state.pending || !state.pending.length) return;
  const allPapers = await getAll("papers");
  const byId = new Map(allPapers.map((p) => [p.arxiv_id, p]));
  if (!summaryQueue.resume(state, byId)) await del("settings", QUEUE_STATE_KEY).catch(() => {});
}

// a getStatus right after boot waits on this for the resumed total; a failed
// resume (IndexedDB blocked in a private window) must not mute onmessage.
const resumeReady = resumePendingQueue().catch((err) => {
  console.warn("models.worker: could not resume a pending batch", err);
});

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};
  resumeReady
    .then(() => {
      if (type === "summarizeBatch") {
        summaryQueue.enqueue(id, payload.papers, payload.interests);
      } else if (type === "getStatus") {
        self.postMessage({ id, ok: true, result: summaryQueue.status() });
      } else if (type === "cancel") {
        summaryQueue.cancel();
        self.postMessage({ id, ok: true, result: { cancelled: true } });
      }
    })
    .catch((err) => {
      self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
    });
};
