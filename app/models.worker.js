// Dedicated Worker, not SharedWorker — SharedWorker never reports crossOriginIsolated=true here, which silently kills WASM threading.
import { pipeline, env } from "./vendor/transformers.min.js";
import { difficulty, layman, tags } from "./heuristics.js";
import { planExtractiveBatch, assembleExtractiveBatch } from "./extractive.js";
import { getAll, putMany, getSetting, setSetting, del } from "./db.js";
import { computeRelated } from "./relate.js";
import { computeBatchSize } from "./batch-size.js";

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

// One FIFO queue shared by any overlapping summarizeBatch calls from this page.
const queue = []; // { paper, keywords } — at most one entry per arxiv_id
const waiters = new Map(); // arxiv_id -> Set of jobIds waiting on that paper (queued OR being processed right now)
const jobRemaining = new Map(); // jobId -> count of distinct papers that job is still waiting on
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

// Persisted so resumePendingQueue can pick the batch back up after this worker dies on page nav.
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
  self.postMessage({ id: jobId, ok: true, result: { processed: queueDone, total: queueTotal } });
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
      post({ type: "progress", status: currentStatus() });

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
          post({ type: "progress", status: { message: "Local summarizer unavailable this session — showing abstracts instead." } });
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
  post({ type: "progress", status: null });
}

// Dedupes against whatever's already queued or actively being processed —
// two jobs (e.g. a batch you started, then re-triggered before it finished)
// asking for the same paper share one actual processing pass, not two.
function enqueueBatch(jobId, papers, interests) {
  const toProcess = papers.filter((p) => !p.summary || !p.embedding);
  if (!toProcess.length) {
    self.postMessage({ id: jobId, ok: true, result: { processed: 0, total: 0 } });
    return;
  }
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
    self.postMessage({ id: jobId, ok: true, result: { processed: queueDone, total: queueTotal, cancelled: true } });
  }
  persistQueueState();
  // Immediate feedback that the click landed — the in-flight paper can't be
  // interrupted, so the status line would otherwise sit frozen until it's done.
  post({ type: "progress", status: running ? { message: "Cancelling…" } : null });
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

const resumeReady = resumePendingQueue(); // a getStatus right after boot waits on this for the resumed total

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};
  resumeReady.then(() => {
    if (type === "summarizeBatch") {
      enqueueBatch(id, payload.papers, payload.interests);
    } else if (type === "getStatus") {
      self.postMessage({ id, ok: true, result: currentStatus() });
    } else if (type === "cancel") {
      cancelAll();
      self.postMessage({ id, ok: true, result: { cancelled: true } });
    }
  });
};
