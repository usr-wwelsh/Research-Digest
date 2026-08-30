// Fetching and summarizing are split on purpose: fetching new candidates is
// cheap (a few HTTP calls), but summarizing/embedding is real CPU-bound
// in-browser inference — doing it for 100+ papers up front on every
// Refresh click is slow enough to feel broken. So the Refresh button only
// calls fetchNewPapers(); summarizePapers() is called lazily by digest.js
// for just the batch of papers it's actually about to show (see its
// pagination), and again for whatever new batch becomes visible as the
// user pages further.
import { getAll, putMany } from "./db.js";
import { runFetchCycle } from "./fetch-orchestrator.js";
import { computeRelated } from "./relate.js";
import { DEFAULT_INTERESTS } from "./default-interests.js";

let worker = null;
let msgId = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./models.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data;
      const resolver = pending.get(id);
      if (!resolver) return;
      pending.delete(id);
      if (ok) resolver.resolve(result);
      else resolver.reject(new Error(error));
    };
  }
  return worker;
}

function callWorker(type, payload) {
  const id = ++msgId;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, payload });
  });
}

export async function getInterests() {
  const rows = await getAll("interests");
  return rows.length ? rows : DEFAULT_INTERESTS;
}

// Pulls new candidates for enabled interests (or just the ones passed in —
// used for a single interest's "Fetch more" button). No summarization.
export async function fetchNewPapers(onStatus = () => {}, interests = null) {
  onStatus("Checking interests…");
  const list = interests || (await getInterests()).filter((i) => i.enabled !== false);
  onStatus("Fetching new papers…");
  const added = await runFetchCycle(list);
  onStatus(null);
  return added;
}

// Set once the worker reports what looks like a systemic model-load
// failure (a broken/incompatible ONNX session for this browser+build, not
// a per-paper problem), so the rest of this session stops paying the cost
// of re-attempting it for every remaining paper and just falls back to
// showing the abstract instead — mirrors local_ai.py's _summarizer_failed
// flag on the server side.
let summarizerBroken = false;

function looksSystemic(err) {
  const msg = String((err && err.message) || err);
  return /create a session|session creation|backend not found/i.test(msg);
}

// Summarizes/embeds exactly the given papers — call this with only the
// papers a page is about to render, not the whole corpus.
export async function summarizePapers(papers, interests, onStatus = () => {}) {
  const toProcess = papers.filter((p) => !p.summary || !p.embedding);
  const total = toProcess.length;
  let done = 0;
  let warnedBroken = false;

  for (const paper of toProcess) {
    if (total > 1 && !summarizerBroken) onStatus(`Summarizing ${done + 1}/${total}…`);
    const interest = interests.find((i) => i.name === paper.interest);
    const keywords = interest ? interest.keywords : [];
    try {
      if (!paper.summary && !summarizerBroken) {
        const result = await callWorker("summarize", {
          title: paper.title, abstract: paper.abstract, category: paper.primary_category, keywords,
        });
        Object.assign(paper, result);
      }
      if (!paper.embedding) {
        const { embedding } = await callWorker("embed", { text: paper.abstract || paper.title });
        paper.embedding = embedding;
      }
    } catch (err) {
      if (!summarizerBroken && looksSystemic(err)) {
        summarizerBroken = true;
        onStatus("Local summarizer unavailable this session — showing abstracts instead.");
        warnedBroken = true;
      }
      console.warn("refresh: model step failed for", paper.arxiv_id, err);
    }
    done += 1;
  }

  if (done > 0) {
    const allPapers = await getAll("papers");
    const related = computeRelated(allPapers);
    for (const p of allPapers) p.related = related[p.arxiv_id] || p.related || [];
    await putMany("papers", allPapers);
  }

  if (!warnedBroken) onStatus(null);
  return { processed: done, total };
}

// Fetch everything, then summarize everything — the old all-in-one
// behavior, kept for callers that genuinely want it (a periodic background
// sync, not a foreground page view where it'd block on 100+ papers).
export async function runFullRefresh(onStatus = () => {}) {
  await fetchNewPapers(onStatus);
  const [papers, interests] = await Promise.all([getAll("papers"), getInterests()]);
  return summarizePapers(papers, interests, onStatus);
}
