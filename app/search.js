import * as arxiv from "./sources/arxiv.js";
import * as semanticscholar from "./sources/semanticscholar.js";
import * as openreview from "./sources/openreview.js";
import { getAll } from "./db.js";
import { findDuplicate } from "./dedup.js";
import { navHtml, paperCardHtml, wireSearchSaveButtons, getSavedIdSet, setStatus } from "./ui-common.js";
import { fetchNewPapers } from "./refresh.js";

document.getElementById("nav").innerHTML = navHtml("search.html");

const inputEl = document.getElementById("q");
const resultsEl = document.getElementById("results");
const emptyEl = document.getElementById("empty");
const hintEl = document.getElementById("hint");
const refreshBtn = document.getElementById("refresh-btn");

let existingPapers = [];
let savedIds = new Set();
let currentResults = new Map();
let debounceTimer = null;

async function runSearch(query) {
  const q = query.trim();
  if (q.length < 2) {
    resultsEl.innerHTML = "";
    emptyEl.hidden = true;
    hintEl.hidden = false;
    setStatus(null);
    return;
  }

  hintEl.hidden = true;
  setStatus("Searching arXiv, Semantic Scholar, OpenReview…");

  const [a, s, o] = await Promise.allSettled([
    arxiv.search(q, 15),
    semanticscholar.search(q, 15),
    openreview.search(q, 15),
  ]);
  const raw = [a, s, o].flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  const deduped = [];
  for (const candidate of raw) {
    const dup = findDuplicate(candidate, [...existingPapers, ...deduped]);
    if (!dup) deduped.push(candidate);
  }

  currentResults = new Map(deduped.map((p) => [p.arxiv_id, p]));
  setStatus(null);
  emptyEl.hidden = deduped.length !== 0;
  resultsEl.innerHTML = deduped.map((p) => paperCardHtml(p, savedIds.has(p.arxiv_id))).join("");
}

inputEl.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSearch(inputEl.value), 300);
});

async function init() {
  [existingPapers, savedIds] = await Promise.all([getAll("papers"), getSavedIdSet()]);
  wireSearchSaveButtons(resultsEl, (id) => currentResults.get(id), "search");

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      await fetchNewPapers(setStatus);
      existingPapers = await getAll("papers");
    } finally {
      refreshBtn.disabled = false;
    }
  });
}

init();
