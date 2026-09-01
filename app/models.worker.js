// In-browser summarization + embedding via transformers.js, off the UI
// thread. Summarization is extractive (extractive.js), so the one DistilBERT
// embedder does both jobs — no separate generative model.
//
// SharedWorker, and it owns the batch queue itself (not just the model):
// this app is a multi-page site (no SPA router), so a loop driven by a
// page's own JS dies the instant that page navigates away. Papers are
// enqueued here, processed and written to IndexedDB from inside the worker,
// so a batch keeps draining regardless of which page (if any) is open —
// as long as at least one tab of the app is still connected, the queue
// keeps moving. See refresh.js for the page-side API.
import { pipeline, env } from "./vendor/transformers.min.js";
import { difficulty, layman, tags } from "./heuristics.js";
import { splitSentences, selectSummarySentences } from "./extractive.js";
import { getAll, putMany, getSetting, setSetting, del } from "./db.js";
import { computeRelated } from "./relate.js";

// Self-hosted, not transformers.js's jsdelivr default (see
// scripts/fetch_vendor_assets.sh). Must be the exact asyncify mjs/wasm pair:
// a bare path prefix falls back to onnxruntime-web's plain threaded build,
// which hangs indefinitely post-download in Firefox with no console error.
env.backends.onnx.wasm.wasmPaths = {
  mjs: "/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs",
  wasm: "/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm",
};
env.allowLocalModels = false;
// COI is enabled (see commit a20c1c8) specifically so this can thread —
// the self-hosted asyncify build above doesn't hit the Firefox hang that a
// plain threaded build would, so it's safe to actually use the cores.
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(self.navigator?.hardwareConcurrency || 1, 4));

const EMBEDDING_MODEL = "Xenova/distilbert-base-uncased";
const EMBEDDER_DTYPE = "q8";
const SUMMARY_SENTENCE_COUNT = 2;

const ports = new Set();

function broadcast(message) {
  for (const port of ports) port.postMessage(message);
}

let embedderPromise = null;

function reportProgress(data) {
  if (data.status === "initiate") {
    broadcast({ type: "progress", message: `Loading model: ${data.file}…` });
  } else if (data.status === "progress") {
    const pct = data.progress != null ? ` ${Math.round(data.progress)}%` : "";
    broadcast({ type: "progress", message: `Loading model: ${data.file}${pct}…` });
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

async function embedText(text) {
  return (await embedBatch([text]))[0];
}

// Centroid extractive summary (extractive.js). Sentences are batched
// together in one forward pass, but kept separate from the (much longer)
// full-text embedding: the tokenizer pads every item in a batch to its
// longest member, so mixing doc + sentences would pad each short sentence
// out to the document's length and erase the win.
async function extractiveSummary(text) {
  const sentences = splitSentences(text);
  const docEmbedding = await embedText(text);
  if (sentences.length <= SUMMARY_SENTENCE_COUNT) {
    return { summary: text.trim(), embedding: docEmbedding };
  }
  const embeddings = await embedBatch(sentences);
  const summary = selectSummarySentences(sentences, embeddings, docEmbedding, SUMMARY_SENTENCE_COUNT).join(" ");
  return { summary, embedding: docEmbedding };
}

async function summarizeText(title, abstract, category, keywords) {
  const text = abstract || title || "";
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  const { summary, embedding } =
    wordCount < 15 ? { summary: text, embedding: null } : await extractiveSummary(text);

  return {
    summary,
    embedding,
    layman: layman(abstract || title),
    difficulty: difficulty(abstract || title, category || ""),
    tags: tags(title, abstract || "", keywords || []),
  };
}

// --- persistent batch queue — the actual point of this rewrite. Lives at
// worker scope, so it keeps draining across page navigations. Multiple
// jobs (from the same or different pages/tabs) share one FIFO queue and
// one running total; each job's caller is replied to individually, once
// every paper it submitted has been processed. ---

const queue = []; // { paper, keywords } — at most one entry per arxiv_id
const waiters = new Map(); // arxiv_id -> Set of jobIds waiting on that paper (queued OR being processed right now)
const jobRemaining = new Map(); // jobId -> count of distinct papers that job is still waiting on
const jobPorts = new Map(); // jobId -> port to reply to on that job's completion
let queueTotal = 0;
let queueDone = 0;
let running = false;

// Set once a systemic (not per-paper) model-load failure is seen, so the
// rest of the queue skips straight to leaving abstracts as-is.
let summarizerBroken = false;

function looksSystemic(err) {
  const msg = String((err && err.message) || err);
  return /create a session|session creation|backend not found/i.test(msg);
}

function currentStatusText() {
  if (!running) return null;
  return `Summarizing ${queueDone + 1}/${queueTotal}…`;
}

// This is an MPA, not an SPA (see refresh.js) — every nav is a full page
// unload/reload, so there's a real gap where zero ports are connected to
// this SharedWorker. Browsers are free to kill a SharedWorker as soon as
// its client count hits zero, which used to silently drop the whole queue
// mid-batch. Persisting {total, done, pending} to the settings store lets a
// freshly-booted worker instance pick the batch back up (see
// resumePendingQueue) instead of the next page quietly starting over.
const QUEUE_STATE_KEY = "summaryQueueState";

async function persistQueueState() {
  if (!queue.length) {
    await del("settings", QUEUE_STATE_KEY).catch(() => {});
    return;
  }
  const pending = queue.map(({ paper, keywords }) => ({ id: paper.arxiv_id, keywords }));
  await setSetting(QUEUE_STATE_KEY, { total: queueTotal, done: queueDone, pending }).catch(() => {});
}

function finishJob(jobId) {
  const remaining = (jobRemaining.get(jobId) || 0) - 1;
  if (remaining > 0) {
    jobRemaining.set(jobId, remaining);
    return;
  }
  jobRemaining.delete(jobId);
  const port = jobPorts.get(jobId);
  jobPorts.delete(jobId);
  if (port) port.postMessage({ id: jobId, ok: true, result: { processed: queueDone, total: queueTotal } });
}

// Outer loop, not a single pass: a new summarizeBatch message can arrive
// (and push into `queue`) while we're mid-`await` on the wrap-up steps
// below (getAll/putMany) — re-check queue.length before actually declaring
// idle instead of resetting the counters out from under a job that just
// snuck in.
async function runQueue() {
  if (running) return;
  running = true;
  while (true) {
    while (queue.length) {
      const { paper, keywords } = queue.shift();
      broadcast({ type: "progress", message: currentStatusText() });
      try {
        if (!paper.summary && !summarizerBroken) {
          const result = await summarizeText(paper.title, paper.abstract, paper.primary_category, keywords);
          Object.assign(paper, result);
        }
        if (!paper.embedding) {
          paper.embedding = await embedText(paper.abstract || paper.title);
        }
        await putMany("papers", [paper]);
      } catch (err) {
        if (!summarizerBroken && looksSystemic(err)) {
          summarizerBroken = true;
          broadcast({ type: "progress", message: "Local summarizer unavailable this session — showing abstracts instead." });
        }
        console.warn("models.worker: failed for", paper.arxiv_id, err);
      }
      queueDone += 1;
      await persistQueueState();
      const jobIds = waiters.get(paper.arxiv_id) || new Set();
      waiters.delete(paper.arxiv_id);
      for (const jobId of jobIds) finishJob(jobId);
    }

    const allPapers = await getAll("papers");
    if (queue.length) continue;
    const related = computeRelated(allPapers);
    for (const p of allPapers) p.related = related[p.arxiv_id] || p.related || [];
    await putMany("papers", allPapers);
    if (queue.length) continue;
    break;
  }

  running = false;
  queueTotal = 0;
  queueDone = 0;
  broadcast({ type: "progress", message: null });
}

// Dedupes against whatever's already queued or actively being processed —
// two jobs (e.g. a batch you started, then re-triggered before it finished)
// asking for the same paper share one actual processing pass, not two.
function enqueueBatch(jobId, papers, interests, port) {
  const toProcess = papers.filter((p) => !p.summary || !p.embedding);
  if (!toProcess.length) {
    port.postMessage({ id: jobId, ok: true, result: { processed: 0, total: 0 } });
    return;
  }
  jobPorts.set(jobId, port);
  let waitingOn = 0;
  for (const paper of toProcess) {
    waitingOn += 1;
    const arxivId = paper.arxiv_id;
    if (waiters.has(arxivId)) {
      waiters.get(arxivId).add(jobId);
      continue;
    }
    waiters.set(arxivId, new Set([jobId]));
    const interest = interests.find((i) => i.name === paper.interest);
    queue.push({ paper, keywords: interest ? interest.keywords : [] });
    queueTotal += 1;
  }
  jobRemaining.set(jobId, waitingOn);
  persistQueueState();
  runQueue();
}

// Runs once, the moment this worker instance boots (including after the
// browser reaped a previous instance mid-batch). Rehydrates from whatever
// was last persisted and, if there's still unfinished work, resumes the
// queue on its own — no page has to notice and resubmit a batch. Papers
// that already picked up a summary+embedding through some other path
// (or vanished from the corpus) are just counted done, not reprocessed.
async function resumePendingQueue() {
  const state = await getSetting(QUEUE_STATE_KEY, null).catch(() => null);
  if (!state || !state.pending || !state.pending.length) return;
  const allPapers = await getAll("papers");
  const byId = new Map(allPapers.map((p) => [p.arxiv_id, p]));
  queueTotal = state.total;
  queueDone = state.done;
  for (const { id, keywords } of state.pending) {
    const paper = byId.get(id);
    if (!paper || (paper.summary && paper.embedding)) {
      queueDone += 1;
      continue;
    }
    waiters.set(id, waiters.get(id) || new Set());
    queue.push({ paper, keywords });
  }
  if (queue.length) runQueue();
  else await del("settings", QUEUE_STATE_KEY).catch(() => {});
}

// Every connection's first message waits on this so a page that asks
// getStatus right after this worker boots gets the resumed total, not a
// blank slate while resume is still mid-flight.
const resumeReady = resumePendingQueue();

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.onmessage = (event) => {
    const { id, type, payload } = event.data || {};
    resumeReady.then(() => {
      if (type === "summarizeBatch") {
        enqueueBatch(id, payload.papers, payload.interests, port);
      } else if (type === "getStatus") {
        port.postMessage({ id, ok: true, result: currentStatusText() });
      }
    });
  };
  port.start();
};
