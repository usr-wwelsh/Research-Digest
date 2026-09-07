import * as arxiv from "./sources/arxiv.js";
import * as semanticscholar from "./sources/semanticscholar.js";
import * as openreview from "./sources/openreview.js";
import { getAll, put } from "./db.js";
import { findDuplicate } from "./dedup.js";
import { navHtml, paperCardHtml, wireSearchSaveButtons, getSavedIdSet, setStatus, slugify, ALL_SOURCES } from "./ui-common.js";
import { onRemoteSummaryStatus, cancelSummarize } from "./refresh.js";
import { DEFAULT_INTERESTS } from "./default-interests.js";

document.getElementById("nav").innerHTML = navHtml("search.html");

const inputEl = document.getElementById("q");
const resultsEl = document.getElementById("results");
const emptyEl = document.getElementById("empty");
const hintEl = document.getElementById("hint");
const addInterestBtn = document.getElementById("add-interest-btn");

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
  addInterestBtn.disabled = inputEl.value.trim().length < 2;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSearch(inputEl.value), 300);
});

// Turns the current search into a recurring interest — same fields
// settings.js writes, so it's editable there afterwards like any other
// interest. Defaults to all three sources, since that's what the search
// this button sits next to actually covered.
addInterestBtn.addEventListener("click", async () => {
  const query = inputEl.value.trim();
  if (query.length < 2) return;
  addInterestBtn.disabled = true;
  try {
    let persisted = await getAll("interests");
    if (!persisted.length) {
      for (const it of DEFAULT_INTERESTS) await put("interests", it);
      persisted = await getAll("interests");
    }
    const id = slugify(query);
    if (persisted.some((i) => i.id === id)) {
      setStatus(`Already an interest: ${query}`);
    } else {
      await put("interests", { id, name: query, keywords: [query], sources: ALL_SOURCES, enabled: true, query_by_source: {} });
      setStatus(`Added interest: ${query} — edit it any time in Settings.`);
    }
    setTimeout(() => setStatus(null), 3000);
  } finally {
    addInterestBtn.disabled = inputEl.value.trim().length < 2;
  }
});

async function init() {
  onRemoteSummaryStatus((status) => setStatus(status, cancelSummarize));
  [existingPapers, savedIds] = await Promise.all([getAll("papers"), getSavedIdSet()]);
  wireSearchSaveButtons(resultsEl, (id) => currentResults.get(id), "search");
}

init();
