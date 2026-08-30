// Orchestrates a full "Refresh" click: fetch new candidates, then backfill
// summary/embedding for anything missing one via models.worker.js (so
// model inference never blocks the UI thread), then recompute "related".
// Not unit-tested — needs a real Worker + IndexedDB; verified manually
// in-browser. Every page's Refresh button calls runFullRefresh() with a
// status callback.
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

async function getInterests() {
  const rows = await getAll("interests");
  return rows.length ? rows : DEFAULT_INTERESTS;
}

export async function runFullRefresh(onStatus = () => {}) {
  onStatus("Checking interests…");
  const interests = await getInterests();
  const enabled = interests.filter((i) => i.enabled !== false);

  onStatus("Fetching new papers…");
  await runFetchCycle(enabled);

  const papers = await getAll("papers");
  const toProcess = papers.filter((p) => !p.summary || !p.embedding);
  const total = toProcess.length;
  let done = 0;

  for (const paper of toProcess) {
    onStatus(`Summarizing ${done + 1}/${total}…`);
    const interest = enabled.find((i) => i.name === paper.interest);
    const keywords = interest ? interest.keywords : [];
    try {
      if (!paper.summary) {
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
      console.warn("refresh: model step failed for", paper.arxiv_id, err);
    }
    done += 1;
  }

  if (done > 0) {
    onStatus("Linking related papers…");
    const related = computeRelated(papers);
    for (const p of papers) p.related = related[p.arxiv_id] || p.related || [];
    await putMany("papers", papers);
  }

  onStatus(null);
  return { processed: done, total };
}
