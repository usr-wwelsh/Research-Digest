// Fetching and summarizing are split so Refresh stays cheap: summarizePapers()
// is called lazily by digest.js for just the visible batch, not the whole corpus.
import { getAll, putMany } from "./db.js";
import { runFetchCycle } from "./fetch-orchestrator.js";
import { computeRelated } from "./relate.js";
import { DEFAULT_INTERESTS } from "./default-interests.js";

let worker = null;
let msgId = 0;
const pending = new Map();

// The onStatus for whichever callWorker() call is in flight — lets an
// unsolicited "progress" message (model loading) reach the caller too.
let activeOnStatus = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./models.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, ok, result, error, type, message } = event.data;
      if (type === "progress") {
        if (activeOnStatus) activeOnStatus(message);
        return;
      }
      const resolver = pending.get(id);
      if (!resolver) return;
      pending.delete(id);
      if (ok) resolver.resolve(result);
      else resolver.reject(new Error(error));
    };
  }
  return worker;
}

function callWorker(type, payload, onStatus) {
  const id = ++msgId;
  const w = getWorker();
  activeOnStatus = onStatus || null;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, payload });
  });
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

// Set once a systemic (not per-paper) model-load failure is seen, so the
// rest of the session skips straight to showing abstracts.
let summarizerBroken = false;

function looksSystemic(err) {
  const msg = String((err && err.message) || err);
  return /create a session|session creation|backend not found/i.test(msg);
}

// Summarizes/embeds exactly the given papers, persisting each as it finishes
// so a later call sees it as already done.
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
        }, onStatus);
        Object.assign(paper, result);
      }
      if (!paper.embedding) {
        const { embedding } = await callWorker("embed", { text: paper.abstract || paper.title }, onStatus);
        paper.embedding = embedding;
      }
      await putMany("papers", [paper]);
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

// Fetch everything, then summarize everything — for callers that want the
// old all-in-one behavior (a background sync, not a foreground page view).
export async function runFullRefresh(onStatus = () => {}) {
  await fetchNewPapers(onStatus);
  const [papers, interests] = await Promise.all([getAll("papers"), getInterests()]);
  return summarizePapers(papers, interests, onStatus);
}
