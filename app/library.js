// Read-only-by-default browse of everything already in IndexedDB — no
// fetch, no summarization, until the user explicitly asks (Summarize
// selected). Built for reading the existing local corpus with no network,
// e.g. while the relay/homelab is unreachable.
import { getAll } from "./db.js";
import { navHtml, paperCardHtml, escapeHtml, wireSaveButtons, getSavedIdSet, setStatus } from "./ui-common.js";
import { summarizePapers, getInterests, onRemoteSummaryStatus } from "./refresh.js";

document.getElementById("nav").innerHTML = navHtml("library.html");

const resultsEl = document.getElementById("results");
const emptyEl = document.getElementById("empty");
const noneMatchEl = document.getElementById("none-match");
const qEl = document.getElementById("q");
const categoryEl = document.getElementById("filter-category");
const sourceEl = document.getElementById("filter-source");
const interestEl = document.getElementById("filter-interest");
const hasSummaryEl = document.getElementById("filter-has-summary");
const selectAllEl = document.getElementById("select-all");
const selectCountEl = document.getElementById("select-count");
const summarizeBtn = document.getElementById("summarize-btn");

let allPapers = [];
let savedIds = new Set();
let interests = [];
const selected = new Set();

function populateOptions(selectEl, values, current) {
  const options = ['<option value="">' + selectEl.firstElementChild.textContent + "</option>"]
    .concat(values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`));
  selectEl.innerHTML = options.join("");
  selectEl.value = current;
}

function refreshFilterOptions() {
  const categories = [...new Set(allPapers.map((p) => p.primary_category).filter(Boolean))].sort();
  const sources = [...new Set(allPapers.map((p) => p.source).filter(Boolean))].sort();
  const interestNames = [...new Set(allPapers.map((p) => p.interest).filter(Boolean))].sort();
  populateOptions(categoryEl, categories, categoryEl.value);
  populateOptions(sourceEl, sources, sourceEl.value);
  populateOptions(interestEl, interestNames, interestEl.value);
}

function filteredSorted() {
  const q = qEl.value.toLowerCase().trim();
  const category = categoryEl.value;
  const source = sourceEl.value;
  const interest = interestEl.value;
  const needsSummary = hasSummaryEl.checked;

  return allPapers
    .filter((p) => {
      if (category && p.primary_category !== category) return false;
      if (source && p.source !== source) return false;
      if (interest && p.interest !== interest) return false;
      if (needsSummary && !p.summary) return false;
      if (q) {
        const text = `${p.title} ${p.summary || p.abstract || ""} ${(p.tags || []).join(" ")}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""));
}

function libraryCardHtml(paper, isSaved, byId) {
  return `
    <div class="library-card">
      <label class="select-check" title="Select for batch summarize">
        <input type="checkbox" class="lib-select" data-select-id="${escapeHtml(paper.arxiv_id)}" ${selected.has(paper.arxiv_id) ? "checked" : ""} />
      </label>
      ${paperCardHtml(paper, isSaved, byId)}
    </div>`;
}

function updateBatchBar(visible) {
  selectCountEl.textContent = selected.size ? `${selected.size} selected` : "";
  summarizeBtn.disabled = selected.size === 0;
  const shownIds = visible.map((p) => p.arxiv_id);
  selectAllEl.checked = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
}

function render() {
  emptyEl.hidden = allPapers.length !== 0;
  const visible = filteredSorted();
  noneMatchEl.hidden = !(allPapers.length !== 0 && visible.length === 0);
  const byId = new Map(allPapers.map((p) => [p.arxiv_id, p]));
  resultsEl.innerHTML = visible.map((p) => libraryCardHtml(p, savedIds.has(p.arxiv_id), byId)).join("");
  updateBatchBar(visible);
}

resultsEl.addEventListener("change", (event) => {
  const box = event.target.closest(".lib-select");
  if (!box) return;
  const id = box.dataset.selectId;
  if (box.checked) selected.add(id);
  else selected.delete(id);
  updateBatchBar(filteredSorted());
});

wireSaveButtons(resultsEl, "library", (id, nowSaved) => {
  if (nowSaved) savedIds.add(id);
  else savedIds.delete(id);
});

selectAllEl.addEventListener("change", () => {
  const visible = filteredSorted();
  if (selectAllEl.checked) {
    for (const p of visible) selected.add(p.arxiv_id);
  } else {
    for (const p of visible) selected.delete(p.arxiv_id);
  }
  render();
});

[qEl, categoryEl, sourceEl, interestEl].forEach((el) => el.addEventListener("input", render));
hasSummaryEl.addEventListener("change", render);

summarizeBtn.addEventListener("click", async () => {
  const targets = allPapers.filter((p) => selected.has(p.arxiv_id));
  if (!targets.length) return;
  summarizeBtn.disabled = true;
  try {
    await summarizePapers(targets, interests, setStatus);
    allPapers = await getAll("papers");
    selected.clear();
    refreshFilterOptions();
    render();
  } finally {
    summarizeBtn.disabled = false;
  }
});

async function init() {
  onRemoteSummaryStatus(setStatus);
  interests = await getInterests();
  [allPapers, savedIds] = await Promise.all([getAll("papers"), getSavedIdSet()]);
  refreshFilterOptions();
  render();
}

init();
