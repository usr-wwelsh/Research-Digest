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
import { planExtractiveBatch, assembleExtractiveBatch } from "./extractive.js";
import { getAll, putMany, getSetting, setSetting, del } from "./db.js";
import { computeRelated } from "./relate.js";
import { computeBatchSize } from "./batch-size.js";

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
// How many papers get summarized/embedded per model call — folding several
// papers' texts into one tokenize+forward pass amortizes the fixed
// per-call overhead (see embedBatch below), which dominates at this text
// length. Sized off deviceMemory so a bigger batch's extra padding cost
// doesn't blow the memory budget on a cheap phone.
const BATCH_SIZE = computeBatchSize(self.navigator?.deviceMemory);

const ports = new Set();

function broadcast(message) {
  for (const port of ports) port.postMessage(message);
}

let embedderPromise = null;

function reportProgress(data) {
  if (data.status === "initiate") {
    broadcast({ type: "progress", status: { message: `Loading model: ${data.file}…` } });
  } else if (data.status === "progress") {
    const pct = data.progress != null ? ` ${Math.round(data.progress)}%` : "";
    broadcast({ type: "progress", status: { message: `Loading model: ${data.file}${pct}…` } });
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

// Centroid extractive summaries for a whole chunk of docs at once: one
// batched call for the doc embeddings, one for every sentence across every
// doc that needs sentence-level scoring (planExtractiveBatch/
// assembleExtractiveBatch in extractive.js do the pure grouping/pairing).
// Kept separate from each other — the tokenizer pads every item in a batch
// to its longest member, so mixing docs + sentences would pad each short
// sentence out to document length and erase the win.
async function extractiveSummaryBatch(texts) {
  const plan = planExtractiveBatch(texts, SUMMARY_SENTENCE_COUNT);
  const docEmbeddings = await embedBatch(texts);
  const flatEmbeddings = plan.flatSentences.length ? await embedBatch(plan.flatSentences) : [];
  return assembleExtractiveBatch(texts, plan, docEmbeddings, flatEmbeddings, SUMMARY_SENTENCE_COUNT);
}

// `items`: [{ title, abstract, category, keywords }]. Texts under the word
// floor skip the model entirely (same threshold as before, just applied
// per-item before the batched call goes out).
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

function currentStatus() {
  if (!running) return null;
  return { message: `Summarizing ${queueDone + 1}/${queueTotal}…`, done: queueDone, total: queueTotal };
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
      const chunk = queue.splice(0, BATCH_SIZE);
      broadcast({ type: "progress", status: currentStatus() });

      const needSummary = chunk.filter(({ paper }) => !paper.summary && !summarizerBroken);
      try {
        if (needSummary.length) {
          const results = await summarizeBatch(
            needSummary.map(({ paper, keywords }) => ({
              title: paper.title,
              abstract: paper.abstract,
              category: paper.primary_category,
              keywords,
            })),
          );
          needSummary.forEach(({ paper }, i) => Object.assign(paper, results[i]));
        }
      } catch (err) {
        if (!summarizerBroken && looksSystemic(err)) {
          summarizerBroken = true;
          broadcast({ type: "progress", status: { message: "Local summarizer unavailable this session — showing abstracts instead." } });
        }
        console.warn("models.worker: batch summarize failed for", needSummary.map(({ paper }) => paper.arxiv_id), err);
      }

      const needEmbedding = chunk.filter(({ paper }) => !paper.embedding);
      if (needEmbedding.length) {
        try {
          const embeddings = await embedBatch(needEmbedding.map(({ paper }) => paper.abstract || paper.title));
          needEmbedding.forEach(({ paper }, i) => {
            paper.embedding = embeddings[i];
          });
        } catch (err) {
          console.warn("models.worker: batch embed failed for", needEmbedding.map(({ paper }) => paper.arxiv_id), err);
        }
      }

      await putMany("papers", chunk.map(({ paper }) => paper));
      queueDone += chunk.length;
      await persistQueueState();
      for (const { paper } of chunk) {
        const jobIds = waiters.get(paper.arxiv_id) || new Set();
        waiters.delete(paper.arxiv_id);
        for (const jobId of jobIds) finishJob(jobId);
      }
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
  broadcast({ type: "progress", status: null });
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

// Drops every paper still sitting in `queue` (i.e. not yet claimed by
// queue.shift() in runQueue) and resolves whichever jobs were waiting only
// on those, immediately, with whatever they already had processed. A paper
// mid-processing right now is left alone — runQueue notices the emptied
// queue right after it finishes and winds down on its own.
function cancelAll() {
  const dropped = queue.splice(0, queue.length);
  const affectedJobIds = new Set();
  for (const { paper } of dropped) {
    const jobIds = waiters.get(paper.arxiv_id);
    if (!jobIds) continue;
    waiters.delete(paper.arxiv_id);
    for (const jobId of jobIds) affectedJobIds.add(jobId);
  }
  for (const jobId of affectedJobIds) {
    jobRemaining.delete(jobId);
    const port = jobPorts.get(jobId);
    jobPorts.delete(jobId);
    if (port) port.postMessage({ id: jobId, ok: true, result: { processed: queueDone, total: queueTotal, cancelled: true } });
  }
  persistQueueState();
  // Without this, the status line just sits frozen on the last
  // "Summarizing N/M…" until the in-flight paper finishes on its own —
  // which can be a long wait during model load. Give immediate feedback
  // that the click landed even though that one paper can't be interrupted.
  broadcast({ type: "progress", status: running ? { message: "Cancelling…" } : null });
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
        port.postMessage({ id, ok: true, result: currentStatus() });
      } else if (type === "cancel") {
        cancelAll();
        port.postMessage({ id, ok: true, result: { cancelled: true } });
      }
    });
  };
  port.start();
};
