// The summarize queue, lifted out of models.worker.js so its cancel, failure
// and resume paths can be driven by fakes under Node — the worker itself
// can't load there (transformers.js and IndexedDB at module scope).
export function looksSystemic(err) {
  const msg = String((err && err.message) || err);
  return /create a session|session creation|backend not found/i.test(msg);
}

export function createSummaryQueue({
  summarize,
  embed,
  loadPapers,
  savePapers,
  persist,
  relate,
  post,
  reply,
  batchSize = 4,
}) {
  const queue = []; // { paper, keywords } — at most one entry per arxiv_id
  const waiters = new Map(); // arxiv_id -> Set of jobIds waiting on it (queued OR in flight)
  const jobRemaining = new Map(); // jobId -> distinct papers that job is still waiting on
  let queueTotal = 0;
  let queueDone = 0;
  let running = false;
  let summarizerBroken = false;
  let cancelRequested = false;

  function currentStatus() {
    if (!running) return null;
    return { message: `Summarizing ${queueDone + 1}/${queueTotal}…`, done: queueDone, total: queueTotal };
  }

  function persistState() {
    if (!queue.length) return persist(null);
    return persist({
      total: queueTotal,
      done: queueDone,
      pending: queue.map(({ paper, keywords }) => ({ id: paper.arxiv_id, keywords })),
    });
  }

  function finishJob(jobId) {
    const remaining = (jobRemaining.get(jobId) || 0) - 1;
    if (remaining > 0) {
      jobRemaining.set(jobId, remaining);
      return;
    }
    jobRemaining.delete(jobId);
    // cancelRequested rides along: a chunk settled during the wind-down kept
    // its summaries but skipped embedding, so it is not fully processed.
    reply(jobId, { ok: true, result: { processed: queueDone, total: queueTotal, cancelled: cancelRequested } });
  }

  // Settles every outstanding job and drops the work behind them, so nothing
  // is left pending on a queue that is about to stop.
  function drainJobs(payload) {
    const jobIds = new Set(jobRemaining.keys());
    for (const ids of waiters.values()) for (const id of ids) jobIds.add(id);
    queue.length = 0;
    waiters.clear();
    jobRemaining.clear();
    for (const jobId of jobIds) reply(jobId, payload);
  }

  async function runChunk(chunk) {
    const needSummary = chunk.filter(({ paper }) => !paper.summary && !summarizerBroken);
    if (needSummary.length) {
      try {
        const results = await summarize(
          needSummary.map(({ paper, keywords }) => ({
            title: paper.title,
            abstract: paper.abstract,
            category: paper.primary_category,
            keywords,
          })),
        );
        needSummary.forEach(({ paper }, i) => Object.assign(paper, results[i]));
      } catch (err) {
        if (!summarizerBroken && looksSystemic(err)) {
          summarizerBroken = true;
          post({ type: "progress", status: { message: "Local summarizer unavailable this session — showing abstracts instead." } });
        }
        console.warn("summary-queue: batch summarize failed for", needSummary.map(({ paper }) => paper.arxiv_id), err);
      }
    }

    // Between stages, not only between chunks: batchSize is >= the page's own
    // batch in the common case, so the whole run is a single chunk and a
    // between-chunks check would make Cancel a no-op exactly when it's used.
    if (cancelRequested) return;

    const needEmbedding = chunk.filter(({ paper }) => !paper.embedding);
    if (needEmbedding.length) {
      try {
        const embeddings = await embed(needEmbedding.map(({ paper }) => paper.abstract || paper.title));
        needEmbedding.forEach(({ paper }, i) => {
          paper.embedding = embeddings[i];
        });
      } catch (err) {
        console.warn("summary-queue: batch embed failed for", needEmbedding.map(({ paper }) => paper.arxiv_id), err);
      }
    }
  }

  // Outer loop, not a single pass: a new batch can arrive (and push into
  // `queue`) while we're mid-`await` on the wrap-up steps below — re-check
  // queue.length before declaring idle instead of resetting the counters out
  // from under a job that just snuck in.
  async function runQueue() {
    if (running) return;
    running = true;
    try {
      while (true) {
        while (queue.length && !cancelRequested) {
          const chunk = queue.splice(0, batchSize);
          post({ type: "progress", status: currentStatus() });
          await runChunk(chunk);
          await savePapers(chunk.map(({ paper }) => paper));
          queueDone += chunk.length;
          await persistState();
          for (const { paper } of chunk) {
            const jobIds = waiters.get(paper.arxiv_id) || new Set();
            waiters.delete(paper.arxiv_id);
            for (const jobId of jobIds) finishJob(jobId);
          }
        }
        if (cancelRequested) {
          // The corpus-wide relate pass is skipped deliberately: it's the
          // longest step in the run and the next uncancelled batch redoes it.
          drainJobs({ ok: true, result: { processed: queueDone, total: queueTotal, cancelled: true } });
          await persistState();
          break;
        }
        const allPapers = await loadPapers();
        if (queue.length) continue;
        const related = relate(allPapers);
        for (const p of allPapers) p.related = related[p.arxiv_id] || p.related || [];
        await savePapers(allPapers);
        if (queue.length) continue;
        break;
      }
    } catch (err) {
      // Without this the `running` guard stays true for the life of the
      // worker and every later batch is silently dropped, its callers waiting
      // forever.
      console.error("summary-queue: aborted", err);
      drainJobs({ ok: false, error: String((err && err.message) || err) });
    } finally {
      running = false;
      cancelRequested = false;
      queueTotal = 0;
      queueDone = 0;
      post({ type: "progress", status: null });
    }
  }

  // Dedupes against whatever's already queued or actively being processed —
  // two jobs asking for the same paper share one processing pass, not two.
  function enqueue(jobId, papers, interests) {
    const toProcess = papers.filter((p) => !p.summary || !p.embedding);
    if (!toProcess.length) {
      reply(jobId, { ok: true, result: { processed: 0, total: 0 } });
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
    persistState();
    runQueue();
  }

  // A model call already in flight can't be interrupted — transformers.js
  // gives no way to abort a forward pass — but runQueue re-checks this after
  // every stage, so the tail is one stage rather than the rest of the batch.
  function cancel() {
    if (!running) {
      drainJobs({ ok: true, result: { processed: queueDone, total: queueTotal, cancelled: true } });
      persistState();
      post({ type: "progress", status: null });
      return;
    }
    cancelRequested = true;
    post({ type: "progress", status: { message: "Cancelling…" } });
  }

  function resume(state, byId) {
    if (!state || !state.pending || !state.pending.length) return false;
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
    if (!queue.length) return false;
    runQueue();
    return true;
  }

  return { enqueue, cancel, resume, status: currentStatus };
}
