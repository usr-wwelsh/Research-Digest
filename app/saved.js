import { getAll } from "./db.js";
import { navHtml, paperCardHtml, wireSaveButtons, setStatus } from "./ui-common.js";
import { onRemoteSummaryStatus, cancelSummarize } from "./refresh.js";

document.getElementById("nav").innerHTML = navHtml("saved.html");

const resultsEl = document.getElementById("results");
const emptyEl = document.getElementById("empty");

// Un-saving here only removes the `saved` pointer, never the underlying
// `papers` record (see ui-common.toggleSave / del("saved", ...)) — a paper
// you un-save stays in your local corpus, same "never delete" ethos as the
// server-side pipeline had.
async function load() {
  const [savedRows, papers] = await Promise.all([getAll("saved"), getAll("papers")]);
  const byId = new Map(papers.map((p) => [p.arxiv_id, p]));
  savedRows.sort((a, b) => (b.saved_at || "").localeCompare(a.saved_at || ""));
  const items = savedRows.map((s) => byId.get(s.arxiv_id)).filter(Boolean);

  emptyEl.hidden = items.length !== 0;
  resultsEl.innerHTML = items.map((p) => paperCardHtml(p, true, byId)).join("");
}

wireSaveButtons(resultsEl, "saved", () => load());

onRemoteSummaryStatus((status) => setStatus(status, cancelSummarize));
load();
